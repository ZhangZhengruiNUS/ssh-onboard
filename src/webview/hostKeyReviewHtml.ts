import * as vscode from 'vscode';

export function renderHostKeyReviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'hostKeyReview.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'hostKeyReview.css'),
  );
  const text = (value: string): string => escapeHtml(vscode.l10n.t(value));
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    "img-src 'none'",
    "connect-src 'none'",
  ].join('; ');

  return `<!doctype html>
<html lang="${escapeHtml(vscode.env.language)}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${escapeHtml(styleUri.toString())}">
  <title>${text('Review SSH host identity')}</title>
</head>
<body>
  <main class="review-shell"
    data-first-title="${text('Trust this SSH host?')}"
    data-changed-title="${text('SSH host identity changed')}"
    data-first-summary="${text('SSH Onboard received this identity directly from the server. Trusting it pins the key for later connections, but does not independently prove this first connection.')}"
    data-changed-summary="${text('The server presented a different key. SSH Onboard blocked authentication until the new fingerprint is independently verified.')}"
    data-first-state="${text('First connection')}"
    data-changed-state="${text('Identity changed')}"
    data-copied="${text('Fingerprint copied to the clipboard.')}"
    data-mismatch="${text('The independently verified fingerprint does not match the server response.')}"
    data-changed-confirm="${text('Verify, replace saved identity, and continue')}"
  >
    <header class="review-header">
      <p class="eyebrow">SSH ONBOARD</p>
      <h1 id="review-title">${text('Trust this SSH host?')}</h1>
      <p id="review-summary" class="lede"></p>
    </header>

    <section class="identity-card" aria-labelledby="identity-heading">
      <div class="identity-heading-row">
        <div>
          <p class="section-label">${text('SERVER IDENTITY')}</p>
          <h2 id="identity-heading"></h2>
        </div>
        <span id="trust-state" class="state-badge">${text('First connection')}</span>
      </div>

      <dl class="identity-grid">
        <div>
          <dt>${text('Endpoint')}</dt>
          <dd id="endpoint"></dd>
        </div>
        <div>
          <dt>${text('Key algorithm')}</dt>
          <dd id="algorithm"></dd>
        </div>
      </dl>

      <div class="fingerprint-block">
        <div class="fingerprint-heading">
          <label for="fingerprint">${text('SHA-256 fingerprint')}</label>
          <button id="copy" class="text-button" type="button">${text('Copy fingerprint')}</button>
        </div>
        <code id="fingerprint" tabindex="0" aria-label="${text('SHA-256 fingerprint')}"></code>
      </div>

      <div id="previous-block" class="previous-block is-hidden">
        <span>${text('Previously trusted identity')}</span>
        <small id="previous-algorithm"></small>
        <code id="previous-fingerprint"></code>
      </div>
    </section>

    <section id="manual-section" class="manual-section is-hidden" aria-labelledby="manual-heading">
      <h2 id="manual-heading">${text('Verify through another channel')}</h2>
      <p>${text('Paste the SHA-256 fingerprint provided by your server console or administrator.')}</p>
      <label for="expected-fingerprint">${text('Expected fingerprint')}</label>
      <input id="expected-fingerprint" type="text" autocomplete="off" spellcheck="false" placeholder="SHA256:..." aria-describedby="manual-error">
      <p id="manual-error" class="field-error" role="alert"></p>
      <div class="manual-actions">
        <button id="confirm-manual" class="primary-button" type="button">${text('Verify and continue')}</button>
        <button id="close-manual" class="secondary-button" type="button">${text('Back')}</button>
      </div>
    </section>

    <p id="review-status" class="review-status" role="status" aria-live="polite"></p>
    <footer class="review-footer">
      <p>${text('No password or authentication data has been sent yet.')}</p>
      <div class="footer-actions">
        <button id="cancel" class="secondary-button" type="button">${text('Cancel')}</button>
        <button id="manual" class="secondary-button" type="button">${text('Verify manually...')}</button>
        <button id="trust" class="primary-button" type="button">${text('Trust and continue')}</button>
      </div>
    </footer>
  </main>
  <script nonce="${escapeHtml(nonce)}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
