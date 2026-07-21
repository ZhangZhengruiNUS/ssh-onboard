import type * as vscode from 'vscode';

import { serializeLogEvent, type SafeLogEvent } from './safeLog';

export class ExtensionLogger {
  public constructor(private readonly output: vscode.LogOutputChannel) {}

  public info(event: SafeLogEvent): void {
    this.output.info(serializeLogEvent(event));
  }

  public warn(event: SafeLogEvent): void {
    this.output.warn(serializeLogEvent(event));
  }

  public error(event: SafeLogEvent): void {
    this.output.error(serializeLogEvent(event));
  }

  public show(): void {
    this.output.show(true);
  }
}
