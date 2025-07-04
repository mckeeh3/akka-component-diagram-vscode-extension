import * as vscode from 'vscode';

/**
 * Creates a combined logger function that outputs to both VS Code output channel and console
 * @param outputChannel The VS Code output channel for logging
 * @returns A logger function that takes any number of arguments and logs them to both outputs
 */
export function createLogger(outputChannel: vscode.OutputChannel) {
  return (...args: any[]) => {
    const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    outputChannel.appendLine(msg);
    console.log(msg);
  };
}

/**
 * Creates a logger with a specific prefix for module identification
 * @param outputChannel The VS Code output channel for logging
 * @param prefix The prefix to prepend to all log messages (e.g., '[JavaParser]', '[CSTUtils]')
 * @returns A logger function that prepends the prefix to all messages
 */
export function createPrefixedLogger(outputChannel: vscode.OutputChannel, prefix: string) {
  return (...args: any[]) => {
    const msg = `${prefix} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`;
    outputChannel.appendLine(msg);
    console.log(msg);
  };
}
