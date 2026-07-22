import * as vscode from 'vscode';

export function renderHostFormHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  nonce: string,
): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'hostForm.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'hostForm.css'));
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
  <title>${text('SSH host form')}</title>
</head>
<body>
  <main class="page-shell"
    data-add-title="${text('Add SSH host')}"
    data-edit-title="${text('Edit SSH host')}"
    data-save-host="${text('Save host')}"
    data-save-changes="${text('Save changes')}"
    data-use-alias="${text('Use suggested alias')}"
    data-checking="${text('Checking host details...')}"
    data-review="${text('Review the highlighted fields.')}"
    data-ready="${text('Ready to save.')}"
    data-saving="${text('Saving host...')}"
    data-no-key="${text('No key selected')}"
    data-required="${text('This field is required.')}"
    data-port-error="${text('Enter a port from 1 to 65535.')}"
    data-path-error="${text('Enter an absolute POSIX path beginning with /.')}"
  >
    <header class="page-header">
      <div>
        <p class="eyebrow">SSH ONBOARD</p>
        <h1 id="form-title">${text('Add SSH host')}</h1>
        <p class="lede">${text('Save the connection once, then let Microsoft Remote - SSH provide the full remote development experience.')}</p>
      </div>
      <div class="privacy-note" role="note">
        <span class="privacy-dot" aria-hidden="true"></span>
        ${text('Passwords are requested only during initialization and are never stored in this form.')}
      </div>
    </header>

    <form id="host-form" novalidate>
      <section class="form-section" aria-labelledby="connection-heading">
        <div class="section-heading">
          <span class="step-number" aria-hidden="true">01</span>
          <div>
            <h2 id="connection-heading">${text('Connection')}</h2>
            <p>${text('The Linux server address and account used for the first SSH connection.')}</p>
          </div>
        </div>
        <div class="field-grid">
          ${field('name', text('Display name'), text('Ascend test server'), true)}
          ${field('host', text('Hostname or IP address'), text('192.0.2.10'), true)}
          ${field('port', text('Port'), '22', true, 'number')}
          ${field('username', text('Username'), text('Remote Linux username'), true)}
        </div>
      </section>

      <section class="form-section" aria-labelledby="remote-heading">
        <div class="section-heading">
          <span class="step-number" aria-hidden="true">02</span>
          <div>
            <h2 id="remote-heading">${text('Remote - SSH')}</h2>
            <p>${text('Choose the alias shown by Remote - SSH and the folder to open after connecting.')}</p>
          </div>
        </div>
        <div class="field-grid">
          <div class="field field-wide">
            <label for="alias">${text('SSH alias')} <span aria-hidden="true">*</span></label>
            <input id="alias" name="alias" type="text" maxlength="64" autocomplete="off" spellcheck="false" aria-describedby="alias-help alias-error">
            <p id="alias-help" class="field-help">${text('Letters, numbers, dots, underscores, and hyphens only.')}</p>
            <button id="alias-suggestion" class="text-action is-hidden" type="button"></button>
            <p id="alias-error" class="field-error" data-error-for="alias"></p>
          </div>
          ${field('defaultPath', text('Default remote folder'), '/home/user/project', false)}
          ${field('group', text('Group'), text('Development'), false)}
        </div>
      </section>

      <section class="form-section" aria-labelledby="key-heading">
        <div class="section-heading">
          <span class="step-number" aria-hidden="true">03</span>
          <div>
            <h2 id="key-heading">${text('SSH key')}</h2>
            <p>${text('A dedicated key for each host is the safest default. Advanced options remain available when you need them.')}</p>
          </div>
        </div>
        <details id="advanced-key" class="key-card">
          <summary>
            <span>${text('Advanced key settings')}</span>
            <small>${text('Default: dedicated Ed25519 key for this host')}</small>
          </summary>
          <div class="key-controls">
            <label for="keyStrategy">${text('Key strategy')}</label>
            <select id="keyStrategy" name="keyStrategy" aria-describedby="key-help keyStrategy-error">
              <option value="generated-per-host">${text('Dedicated key for this host (Recommended)')}</option>
              <option value="existing">${text('Use an existing private key (Advanced)')}</option>
              <option value="generated-per-group">${text('Share one generated key with this group (Advanced)')}</option>
            </select>
            <p id="key-help" class="field-help">${text('Generated keys stay in the local SSH Onboard folder and are used only through OpenSSH.')}</p>
            <p id="keyStrategy-error" class="field-error" data-error-for="keyStrategy"></p>
            <div id="existing-key" class="existing-key is-hidden">
              <div>
                <span class="selection-label">${text('Selected key')}</span>
                <strong id="existing-key-label">${text('No key selected')}</strong>
              </div>
              <button id="choose-existing-key" class="secondary-button" type="button">${text('Choose key...')}</button>
            </div>
          </div>
        </details>
      </section>

      <div id="form-status" class="form-status" role="status" aria-live="polite"></div>
      <footer class="form-footer">
        <p>${text('Fields marked with * are required.')}</p>
        <div class="footer-actions">
          <button id="cancel" class="secondary-button" type="button">${text('Cancel')}</button>
          <button id="save" class="primary-button" type="submit">${text('Save host')}</button>
        </div>
      </footer>
    </form>
  </main>
  <script nonce="${escapeHtml(nonce)}" src="${escapeHtml(scriptUri.toString())}"></script>
</body>
</html>`;
}

function field(
  id: string,
  label: string,
  placeholder: string,
  required: boolean,
  type = 'text',
): string {
  const wide = id === 'name' || id === 'defaultPath' ? ' field-wide' : '';
  const requiredMarkup = required ? ' <span aria-hidden="true">*</span>' : '';
  const requiredAttribute = required ? ' required' : '';
  const numeric = type === 'number' ? ' min="1" max="65535" inputmode="numeric"' : '';
  const maximumLength =
    type === 'number'
      ? ''
      : ` maxlength="${id === 'name' || id === 'group' ? '100' : id === 'host' ? '253' : id === 'defaultPath' ? '4096' : '64'}"`;
  return `<div class="field${wide}">
    <label for="${escapeHtml(id)}">${label}${requiredMarkup}</label>
    <input id="${escapeHtml(id)}" name="${escapeHtml(id)}" type="${escapeHtml(type)}" placeholder="${placeholder}" autocomplete="off" spellcheck="false" aria-describedby="${escapeHtml(id)}-error"${requiredAttribute}${numeric}${maximumLength}>
    <p id="${escapeHtml(id)}-error" class="field-error" data-error-for="${escapeHtml(id)}"></p>
  </div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
