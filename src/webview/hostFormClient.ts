import type {
  ExtensionToHostFormMessage,
  HostFormDraftDto,
  HostFormField,
  HostFormToExtensionMessage,
} from './hostFormProtocol';

declare function acquireVsCodeApi(): {
  postMessage(message: HostFormToExtensionMessage): void;
  setState(state: unknown): void;
  getState(): unknown;
};

const vscode = acquireVsCodeApi();
const shell = requiredElement<HTMLElement>('.page-shell');
const form = requiredElement<HTMLFormElement>('#host-form');
const title = requiredElement<HTMLElement>('#form-title');
const saveButton = requiredElement<HTMLButtonElement>('#save');
const cancelButton = requiredElement<HTMLButtonElement>('#cancel');
const keyStrategy = requiredElement<HTMLSelectElement>('#keyStrategy');
const advancedKey = requiredElement<HTMLDetailsElement>('#advanced-key');
const existingKey = requiredElement<HTMLElement>('#existing-key');
const existingKeyLabel = requiredElement<HTMLElement>('#existing-key-label');
const chooseExistingKey = requiredElement<HTMLButtonElement>('#choose-existing-key');
const aliasSuggestion = requiredElement<HTMLButtonElement>('#alias-suggestion');
const status = requiredElement<HTMLElement>('#form-status');

let revision: string | undefined;
let baseline = '';
let existingSelectionToken: string | undefined;
let existingSelectionLabel: string | undefined;
let validationSequence = 0;
let latestValidationSequence = 0;
let validationTimer: ReturnType<typeof setTimeout> | undefined;
let aliasEdited = false;

input('alias').addEventListener('input', () => {
  aliasEdited = true;
});

input('host').addEventListener('input', () => {
  if (aliasEdited && input('alias').value.trim().length > 0) {
    return;
  }
  input('alias').value = aliasFrom(input('host').value);
});

form.addEventListener('input', () => {
  updateKeyControls();
  publishDirty();
  scheduleValidation();
});

form.addEventListener('change', () => {
  updateKeyControls();
  publishDirty();
  scheduleValidation();
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (revision === undefined) {
    return;
  }
  const draft = collectDraft();
  const errors = validateLocally(draft);
  renderErrors(errors);
  if (Object.keys(errors).length > 0) {
    status.textContent = data('review');
    focusFirstError(errors);
    return;
  }
  saveButton.disabled = true;
  status.textContent = data('saving');
  vscode.postMessage({ type: 'save', revision, draft });
});

cancelButton.addEventListener('click', () => {
  if (revision !== undefined) {
    vscode.postMessage({ type: 'cancel', revision });
  }
});

chooseExistingKey.addEventListener('click', () => {
  if (revision !== undefined) {
    vscode.postMessage({ type: 'pickExistingKey', revision });
  }
});

aliasSuggestion.addEventListener('click', () => {
  const suggestion = aliasSuggestion.dataset.alias;
  if (suggestion === undefined) {
    return;
  }
  input('alias').value = suggestion;
  aliasSuggestion.classList.add('is-hidden');
  publishDirty();
  scheduleValidation();
  input('alias').focus();
});

window.addEventListener('message', (event: MessageEvent<ExtensionToHostFormMessage>) => {
  const message = event.data;
  if (message.type === 'initialize') {
    initialize(message);
    return;
  }
  if (revision === undefined || message.revision !== revision) {
    return;
  }
  if (message.type === 'existingKeySelected') {
    existingSelectionLabel = message.selectionLabel;
    existingSelectionToken = message.selectionToken;
    existingKeyLabel.textContent = message.selectionLabel;
    publishDirty();
    scheduleValidation();
    return;
  }
  if (message.type === 'operationError') {
    saveButton.disabled = false;
    status.textContent = message.message;
    return;
  }
  if (message.type === 'validation' && message.sequence >= latestValidationSequence) {
    latestValidationSequence = message.sequence;
    renderErrors(message.errors);
    renderAliasSuggestion(message.suggestedAlias);
    status.textContent = Object.keys(message.errors).length === 0 ? data('ready') : data('review');
  }
});

vscode.postMessage({ type: 'ready' });

function initialize(
  message: Extract<ExtensionToHostFormMessage, { readonly type: 'initialize' }>,
): void {
  revision = message.revision;
  setInput('name', message.draft.name);
  setInput('host', message.draft.host);
  setInput('port', String(message.draft.port));
  setInput('username', message.draft.username);
  setInput('alias', message.draft.alias);
  setInput('defaultPath', message.draft.defaultPath ?? '');
  setInput('group', message.draft.group ?? '');
  keyStrategy.value = message.draft.keyStrategy.kind;
  advancedKey.open = message.draft.keyStrategy.kind !== 'generated-per-host';
  aliasEdited = message.mode === 'edit' || message.draft.alias.length > 0;
  if (message.draft.keyStrategy.kind === 'existing') {
    existingSelectionLabel = message.draft.keyStrategy.selectionLabel;
    existingSelectionToken = message.draft.keyStrategy.selectionToken;
  } else {
    existingSelectionLabel = undefined;
    existingSelectionToken = undefined;
  }
  existingKeyLabel.textContent = existingSelectionLabel ?? data('noKey');
  title.textContent = message.mode === 'add' ? data('addTitle') : data('editTitle');
  saveButton.textContent = message.mode === 'add' ? data('saveHost') : data('saveChanges');
  updateKeyControls();
  baseline = serializeDraft(collectDraft());
  status.textContent = '';
  renderErrors({});
  publishDirty();
  input('name').focus();
  scheduleValidation();
}

function scheduleValidation(): void {
  if (revision === undefined) {
    return;
  }
  if (validationTimer !== undefined) {
    clearTimeout(validationTimer);
  }
  const draft = collectDraft();
  const localErrors = validateLocally(draft);
  renderErrors(localErrors);
  renderAliasSuggestion(undefined);
  if (Object.keys(localErrors).length > 0) {
    status.textContent = data('review');
    return;
  }
  status.textContent = data('checking');
  validationTimer = setTimeout(() => {
    if (revision === undefined) {
      return;
    }
    validationSequence += 1;
    vscode.postMessage({
      type: 'validate',
      revision,
      sequence: validationSequence,
      draft: collectDraft(),
    });
  }, 280);
}

function collectDraft(): HostFormDraftDto {
  const port = Number(input('port').value);
  const defaultPath = input('defaultPath').value.trim();
  const group = input('group').value.trim();
  const selectedStrategy = keyStrategy.value;
  return {
    name: input('name').value.trim(),
    host: input('host').value.trim(),
    port: Number.isFinite(port) ? port : 0,
    username: input('username').value.trim(),
    alias: input('alias').value.trim(),
    ...(defaultPath.length === 0 ? {} : { defaultPath }),
    ...(group.length === 0 ? {} : { group }),
    keyStrategy:
      selectedStrategy === 'existing'
        ? {
            kind: 'existing',
            ...(existingSelectionLabel === undefined
              ? {}
              : { selectionLabel: existingSelectionLabel }),
            ...(existingSelectionToken === undefined
              ? {}
              : { selectionToken: existingSelectionToken }),
          }
        : selectedStrategy === 'generated-per-group'
          ? { kind: 'generated-per-group' }
          : { kind: 'generated-per-host' },
  };
}

function validateLocally(draft: HostFormDraftDto): Partial<Record<HostFormField, string>> {
  const errors: Partial<Record<HostFormField, string>> = {};
  if (draft.name.length === 0) errors.name = requiredMessage();
  if (draft.host.length === 0) errors.host = requiredMessage();
  if (draft.username.length === 0) errors.username = requiredMessage();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(draft.alias)) {
    errors.alias = requiredElement<HTMLElement>('#alias-help').textContent ?? '';
  }
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65_535) {
    errors.port = data('portError');
  }
  if (draft.defaultPath !== undefined && !draft.defaultPath.startsWith('/')) {
    errors.defaultPath = data('pathError');
  }
  if (draft.keyStrategy.kind === 'generated-per-group' && draft.group === undefined) {
    errors.group = requiredMessage();
  }
  if (draft.keyStrategy.kind === 'existing' && draft.keyStrategy.selectionLabel === undefined) {
    errors.keyStrategy = data('noKey');
  }
  return errors;
}

function requiredMessage(): string {
  return data('required');
}

function renderErrors(errors: Partial<Record<HostFormField, string>>): void {
  for (const element of document.querySelectorAll<HTMLElement>('[data-error-for]')) {
    const field = element.dataset.errorFor as HostFormField | undefined;
    const message = field === undefined ? undefined : errors[field];
    element.textContent = message ?? '';
    const control =
      field === 'keyStrategy' ? keyStrategy : field === undefined ? undefined : input(field);
    control?.setAttribute('aria-invalid', message === undefined ? 'false' : 'true');
  }
}

function focusFirstError(errors: Partial<Record<HostFormField, string>>): void {
  const first = (Object.keys(errors) as HostFormField[])[0];
  if (first === undefined) return;
  if (first === 'keyStrategy') keyStrategy.focus();
  else input(first).focus();
}

function renderAliasSuggestion(suggestion: string | undefined): void {
  if (suggestion === undefined) {
    aliasSuggestion.classList.add('is-hidden');
    aliasSuggestion.removeAttribute('data-alias');
    return;
  }
  aliasSuggestion.dataset.alias = suggestion;
  aliasSuggestion.textContent = `${data('useAlias')}: ${suggestion}`;
  aliasSuggestion.classList.remove('is-hidden');
}

function publishDirty(): void {
  if (revision === undefined) {
    return;
  }
  const dirty = serializeDraft(collectDraft()) !== baseline;
  vscode.setState({ dirty });
  vscode.postMessage({ type: 'dirty', revision, dirty });
}

function updateKeyControls(): void {
  existingKey.classList.toggle('is-hidden', keyStrategy.value !== 'existing');
}

function serializeDraft(draft: HostFormDraftDto): string {
  return JSON.stringify(draft);
}

function input(id: string): HTMLInputElement {
  return requiredElement<HTMLInputElement>(`#${id}`);
}

function setInput(id: string, value: string): void {
  input(id).value = value;
}

function data(key: string): string {
  return shell.dataset[key] ?? '';
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing host form element: ${selector}`);
  }
  return element;
}

function aliasFrom(source: string): string {
  const candidate = source
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 50);
  return candidate;
}
