import type {
  ExtensionToHostKeyReviewMessage,
  HostKeyReviewToExtensionMessage,
} from './hostKeyReviewProtocol';

declare function acquireVsCodeApi(): {
  postMessage(message: HostKeyReviewToExtensionMessage): void;
};

const vscode = acquireVsCodeApi();
const shell = requiredElement<HTMLElement>('.review-shell');
const title = requiredElement<HTMLElement>('#review-title');
const summary = requiredElement<HTMLElement>('#review-summary');
const identityHeading = requiredElement<HTMLElement>('#identity-heading');
const trustState = requiredElement<HTMLElement>('#trust-state');
const endpoint = requiredElement<HTMLElement>('#endpoint');
const algorithm = requiredElement<HTMLElement>('#algorithm');
const fingerprint = requiredElement<HTMLElement>('#fingerprint');
const previousBlock = requiredElement<HTMLElement>('#previous-block');
const previousAlgorithm = requiredElement<HTMLElement>('#previous-algorithm');
const previousFingerprint = requiredElement<HTMLElement>('#previous-fingerprint');
const manualSection = requiredElement<HTMLElement>('#manual-section');
const expectedFingerprint = requiredElement<HTMLInputElement>('#expected-fingerprint');
const manualError = requiredElement<HTMLElement>('#manual-error');
const status = requiredElement<HTMLElement>('#review-status');
const copyButton = requiredElement<HTMLButtonElement>('#copy');
const trustButton = requiredElement<HTMLButtonElement>('#trust');
const manualButton = requiredElement<HTMLButtonElement>('#manual');
const confirmManualButton = requiredElement<HTMLButtonElement>('#confirm-manual');
const closeManualButton = requiredElement<HTMLButtonElement>('#close-manual');
const cancelButton = requiredElement<HTMLButtonElement>('#cancel');

let sessionId: string | undefined;
let changed = false;
let operationPending = false;

copyButton.addEventListener('click', () => post('copy'));
trustButton.addEventListener('click', () => post('trust'));
cancelButton.addEventListener('click', () => post('cancel'));

manualButton.addEventListener('click', () => {
  manualSection.classList.remove('is-hidden');
  expectedFingerprint.focus();
});

closeManualButton.addEventListener('click', () => {
  if (changed) {
    return;
  }
  manualSection.classList.add('is-hidden');
  manualError.textContent = '';
  manualButton.focus();
});

confirmManualButton.addEventListener('click', () => {
  if (sessionId === undefined || operationPending) {
    return;
  }
  const expected = expectedFingerprint.value.trim();
  if (!expected.startsWith('SHA256:')) {
    manualError.textContent = data('mismatch');
    expectedFingerprint.focus();
    return;
  }
  setBusy(true);
  vscode.postMessage({ type: 'verify', sessionId, expectedFingerprint: expected });
});

expectedFingerprint.addEventListener('input', () => {
  manualError.textContent = '';
});

window.addEventListener('message', (event: MessageEvent<ExtensionToHostKeyReviewMessage>) => {
  const message = event.data;
  if (message.type === 'initialize') {
    initialize(message);
    return;
  }
  if (sessionId === undefined || message.sessionId !== sessionId) {
    return;
  }
  if (message.type === 'copied') {
    status.textContent = data('copied');
    return;
  }
  manualError.textContent = message.message;
  setBusy(false);
  expectedFingerprint.focus();
});

vscode.postMessage({ type: 'ready' });

function initialize(
  message: Extract<ExtensionToHostKeyReviewMessage, { readonly type: 'initialize' }>,
): void {
  sessionId = message.sessionId;
  changed = message.mode === 'changed';
  operationPending = false;
  identityHeading.textContent = message.displayName;
  endpoint.textContent = message.endpoint;
  algorithm.textContent = message.algorithm;
  fingerprint.textContent = message.fingerprint;
  title.textContent = changed ? data('changedTitle') : data('firstTitle');
  summary.textContent = changed ? data('changedSummary') : data('firstSummary');
  trustState.textContent = changed ? data('changedState') : data('firstState');
  trustState.classList.toggle('is-danger', changed);
  trustButton.classList.toggle('is-hidden', changed);
  previousBlock.classList.toggle('is-hidden', !changed);
  manualSection.classList.toggle('is-hidden', !changed);
  manualButton.classList.toggle('is-hidden', changed);
  closeManualButton.classList.toggle('is-hidden', changed);
  confirmManualButton.textContent = changed
    ? data('changedConfirm')
    : confirmManualButton.textContent;
  previousFingerprint.textContent = message.previousFingerprint ?? '';
  previousAlgorithm.textContent = message.previousAlgorithm ?? '';
  expectedFingerprint.value = '';
  manualError.textContent = '';
  status.textContent = '';
  setBusy(false);
  if (changed) {
    expectedFingerprint.focus();
  } else {
    fingerprint.focus();
  }
}

function post(type: 'copy' | 'trust' | 'cancel'): void {
  if (sessionId === undefined || operationPending) {
    return;
  }
  if (type === 'trust' || type === 'cancel') {
    setBusy(true);
  }
  vscode.postMessage({ type, sessionId });
}

function setBusy(value: boolean): void {
  operationPending = value;
  trustButton.disabled = value;
  manualButton.disabled = value;
  confirmManualButton.disabled = value;
  cancelButton.disabled = value;
}

function data(key: string): string {
  return shell.dataset[key] ?? '';
}

function requiredElement<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (value === null) {
    throw new Error(`Missing host key review element: ${selector}`);
  }
  return value;
}
