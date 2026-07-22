import { randomBytes, randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { DomainError } from '../core/domainError';
import type { HostKeyObservation } from '../domain/hostKeys';
import { classifyHostKey, trustObservedHostKey } from '../domain/hostKeyTrust';
import type { ServerProfile, TrustedHostKey } from '../domain/profiles';
import { renderHostKeyReviewHtml } from './hostKeyReviewHtml';
import {
  HostKeyReviewProtocolError,
  parseHostKeyReviewMessage,
  type ExtensionToHostKeyReviewMessage,
  type HostKeyReviewMode,
} from './hostKeyReviewProtocol';

interface PendingReview {
  readonly sessionId: string;
  readonly profile: ServerProfile;
  readonly observation: HostKeyObservation;
  readonly mode: HostKeyReviewMode;
  readonly resolve: (trusted: TrustedHostKey) => void;
  readonly reject: (error: unknown) => void;
  settled: boolean;
  ready: boolean;
}

export class HostKeyReviewController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private pending: PendingReview | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public async review(
    profile: ServerProfile,
    observation: HostKeyObservation,
  ): Promise<TrustedHostKey> {
    const decision = classifyHostKey(profile, observation);
    if (decision.kind === 'known') {
      return decision.trusted;
    }
    if (this.pending !== undefined) {
      this.panel?.reveal(vscode.ViewColumn.Active, true);
      throw new DomainError('FEATURE_UNAVAILABLE', 'host-key-review-in-progress');
    }

    const mode: HostKeyReviewMode = decision.kind;
    const result = new Promise<TrustedHostKey>((resolve, reject) => {
      this.pending = {
        sessionId: randomUUID(),
        profile,
        observation,
        mode,
        resolve,
        reject,
        settled: false,
        ready: false,
      };
    });
    this.ensurePanel();
    this.updatePanelTitle(mode);
    this.panel?.reveal(vscode.ViewColumn.Active, true);
    return result;
  }

  public dispose(): void {
    this.cancelPending();
    this.panel?.dispose();
    this.panel = undefined;
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
  }

  private ensurePanel(): void {
    if (this.panel !== undefined) {
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'sshOnboard.hostKeyReview',
      vscode.l10n.t('Review SSH host identity'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
      },
    );
    this.panel.webview.html = renderHostKeyReviewHtml(
      this.panel.webview,
      this.extensionUri,
      randomBytes(24).toString('base64'),
    );
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        void this.receive(raw).catch((error: unknown) => this.failPending(error));
      }),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.cancelPending();
        for (const disposable of this.disposables.splice(0)) {
          disposable.dispose();
        }
      }),
    );
  }

  private async receive(raw: unknown): Promise<void> {
    let message;
    try {
      message = parseHostKeyReviewMessage(raw);
    } catch (error: unknown) {
      const detail = error instanceof HostKeyReviewProtocolError ? error.reason : 'invalid';
      throw new DomainError('HOST_KEY_UNTRUSTED', `review-message-${detail}`);
    }
    if (message.type === 'ready') {
      const pending = this.pending;
      if (pending === undefined || pending.settled) {
        throw new DomainError('HOST_KEY_UNTRUSTED', 'review-session');
      }
      if (pending.ready) {
        throw new DomainError('HOST_KEY_UNTRUSTED', 'review-replay');
      }
      pending.ready = true;
      await this.postInitialize(pending);
      return;
    }
    const pending = this.pending;
    if (pending === undefined || message.sessionId !== pending.sessionId || pending.settled) {
      throw new DomainError('HOST_KEY_UNTRUSTED', 'review-session');
    }
    if (!pending.ready) {
      throw new DomainError('HOST_KEY_UNTRUSTED', 'review-not-ready');
    }
    if (message.type === 'copy') {
      await vscode.env.clipboard.writeText(pending.observation.fingerprint);
      await this.post({ type: 'copied', sessionId: pending.sessionId });
      return;
    }
    if (message.type === 'cancel') {
      this.cancelPending();
      this.panel?.dispose();
      return;
    }
    if (message.type === 'trust') {
      if (pending.mode !== 'first-use') {
        throw new DomainError('HOST_KEY_CHANGED', 'manual-verification-required');
      }
      this.acceptPending();
      return;
    }
    if (message.expectedFingerprint.trim() !== pending.observation.fingerprint) {
      await this.post({
        type: 'validationError',
        sessionId: pending.sessionId,
        message: vscode.l10n.t(
          'The independently verified fingerprint does not match the server response.',
        ),
      });
      return;
    }
    this.acceptPending();
  }

  private async postInitialize(pending: PendingReview): Promise<void> {
    await this.post({
      type: 'initialize',
      sessionId: pending.sessionId,
      mode: pending.mode,
      displayName: pending.profile.name,
      endpoint: displayEndpoint(pending.profile),
      algorithm: pending.observation.algorithm,
      fingerprint: pending.observation.fingerprint,
      ...(pending.profile.trustedHostKey === undefined
        ? {}
        : {
            previousAlgorithm: pending.profile.trustedHostKey.algorithm,
            previousFingerprint: pending.profile.trustedHostKey.fingerprint,
          }),
    });
  }

  private acceptPending(): void {
    const pending = this.pending;
    if (pending === undefined || pending.settled) {
      return;
    }
    pending.settled = true;
    pending.resolve(trustObservedHostKey(pending.profile, pending.observation));
    this.pending = undefined;
    this.panel?.dispose();
  }

  private cancelPending(): void {
    const pending = this.pending;
    if (pending === undefined || pending.settled) {
      return;
    }
    pending.settled = true;
    pending.reject(new vscode.CancellationError());
    this.pending = undefined;
  }

  private failPending(error: unknown): void {
    const pending = this.pending;
    if (pending === undefined || pending.settled) {
      return;
    }
    pending.settled = true;
    pending.reject(error);
    this.pending = undefined;
    this.panel?.dispose();
  }

  private async post(message: ExtensionToHostKeyReviewMessage): Promise<void> {
    await this.panel?.webview.postMessage(message);
  }

  private updatePanelTitle(mode: HostKeyReviewMode): void {
    if (this.panel === undefined) {
      return;
    }
    this.panel.title =
      mode === 'first-use'
        ? vscode.l10n.t('Trust SSH host')
        : vscode.l10n.t('SSH host identity changed');
  }
}

function displayEndpoint(profile: ServerProfile): string {
  const host = profile.host.includes(':') ? `[${profile.host}]` : profile.host;
  return `${host}:${String(profile.port)}`;
}
