import * as path from 'node:path';

import * as vscode from 'vscode';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

/** Name of the integrated terminal reused by `Epsil: Run File`. */
const TERMINAL_NAME = 'Epsil';

let client: LanguageClient | undefined;

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  // Registered before the client is built, so `Epsil: Restart Language
  // Server` is available to recover from a server that failed to start.
  context.subscriptions.push(
    vscode.commands.registerCommand('epsil.runFile', runFile),
    vscode.commands.registerCommand('epsil.restartServer', restartServer)
  );

  const serverModule = context.asAbsolutePath(path.join('dist', 'server.js'));

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6019'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    // Untitled buffers get diagnostics too: an Epsil scratch buffer is the
    // usual way to try something out.
    documentSelector: [
      { scheme: 'file', language: 'epsil' },
      { scheme: 'untitled', language: 'epsil' },
    ],
    synchronize: {
      // The server reads `epsil.diagnostics.enable`; push changes to it.
      configurationSection: 'epsil',
    },
    outputChannelName: 'Epsil Language Server',
  };

  // The client id is `epsil`, so the client picks up `epsil.trace.server`
  // from the workspace configuration on its own (and follows changes to it).
  client = new LanguageClient(
    'epsil',
    'Epsil Language Server',
    serverOptions,
    clientOptions
  );

  try {
    await client.start();
  } catch (error) {
    // Diagnostics are one feature of the extension, not all of it: report the
    // failure and leave highlighting and `Epsil: Run File` working.
    void vscode.window.showErrorMessage(
      `The Epsil language server could not start; diagnostics are unavailable. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

export function deactivate(): Thenable<void> | undefined {
  const current = client;
  client = undefined;
  return current?.stop();
}

async function runFile(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  if (!document || document.languageId !== 'epsil') {
    void vscode.window.showErrorMessage(
      'Epsil: Run File needs an Epsil file in the active editor.'
    );
    return;
  }

  // The CLI runs against a path on disk, so an unsaved buffer has to be
  // written first — and an untitled one has no path at all.
  if (document.isUntitled) {
    void vscode.window.showErrorMessage(
      'Save this file before running it: Epsil runs a file from disk.'
    );
    return;
  }
  if (!(await document.save())) return;

  const cliCommand =
    vscode.workspace.getConfiguration('epsil').get<string>('cliCommand') ||
    'npx epsil';

  // Run from the file's workspace folder (or its directory) so a
  // project-local install of the CLI resolves — `npx epsil` finds the bin in
  // the nearest node_modules, and workspace-relative `epsil.cliCommand`
  // overrides work.
  const cwd =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
    path.dirname(document.uri.fsPath);

  const terminal =
    vscode.window.terminals.find((x) => x.name === TERMINAL_NAME) ??
    vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  terminal.show(true);
  terminal.sendText(`${cliCommand} ${quoteArgument(document.uri.fsPath)}`);
}

async function restartServer(): Promise<void> {
  if (!client) return;
  try {
    await client.restart();
  } catch (error) {
    void vscode.window.showErrorMessage(
      `Could not restart the Epsil language server: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

/** Quote a path for the shell the integrated terminal is running. */
function quoteArgument(value: string): string {
  if (process.platform === 'win32') return `"${value.replace(/"/g, '""')}"`;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
