import * as vscode from 'vscode';

/**
 * Creates a logger with a specific prefix for module identification
 * @param outputChannel The VS Code output channel for logging
 * @param prefix The prefix to prepend to all log messages (e.g., '[JavaParser]', '[CSTUtils]')
 * @returns A logger function that prepends the prefix to all messages
 */
export function createPrefixedLogger(outputChannel: vscode.OutputChannel | undefined, prefix: string) {
  return (...args: any[]) => {
    const msg = `${prefix} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
    if (outputChannel) {
      outputChannel.appendLine(msg);
    }
    console.log(msg);
  };
}
