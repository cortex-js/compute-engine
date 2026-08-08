import { execFile } from 'node:child_process';
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
    vscode.commands.registerCommand('epsil.restartServer', restartServer),
    vscode.commands.registerCommand('epsil.showInlineResults', () =>
      showInlineResults(context)
    ),
    vscode.commands.registerCommand('epsil.clearInlineResults', () =>
      clearInlineResults()
    ),
    // Inline results are positioned by line: any edit invalidates them.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (decoratedDocument === event.document.uri.toString())
        clearInlineResults();
    }),
    // F5 on an .epsil file with no launch.json: synthesize a launch config
    // for the active editor. (The adapter itself is declared in
    // `contributes.debuggers` — program + runtime — so no descriptor factory
    // is needed.)
    vscode.debug.registerDebugConfigurationProvider('epsil', {
      resolveDebugConfiguration(_folder, config) {
        if (!config.type && !config.request && !config.name) {
          const document = vscode.window.activeTextEditor?.document;
          if (document?.languageId !== 'epsil') return undefined;
          if (document.isUntitled) {
            void vscode.window.showErrorMessage(
              'Save this file before debugging it: Epsil debugs a file from disk.'
            );
            return undefined;
          }
          return {
            type: 'epsil',
            request: 'launch',
            name: 'Debug Epsil File',
            program: document.uri.fsPath,
          };
        }
        return config;
      },
    })
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

// ── Inline results ─────────────────────────────────────────────────────────

/** One decoration type for values, one for error values. */
let valueDecoration: vscode.TextEditorDecorationType | undefined;
let errorDecoration: vscode.TextEditorDecorationType | undefined;
/** URI (string) of the document currently decorated, if any. */
let decoratedDocument: string | undefined;

function decorationTypes(): [
  vscode.TextEditorDecorationType,
  vscode.TextEditorDecorationType,
] {
  valueDecoration ??= vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('editorCodeLens.foreground'),
      margin: '0 0 0 2em',
      fontStyle: 'italic',
    },
  });
  errorDecoration ??= vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor('errorForeground'),
      margin: '0 0 0 2em',
      fontStyle: 'italic',
    },
  });
  return [valueDecoration, errorDecoration];
}

function clearInlineResults(): void {
  decoratedDocument = undefined;
  for (const editor of vscode.window.visibleTextEditors) {
    if (valueDecoration) editor.setDecorations(valueDecoration, []);
    if (errorDecoration) editor.setDecorations(errorDecoration, []);
  }
}

/**
 * Run the active Epsil file with the bundled inline runner (a separate node
 * process — never the extension host) and decorate each top-level
 * statement's last line with its value. Cleared on any edit.
 */
async function showInlineResults(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  if (!editor || !document || document.languageId !== 'epsil') {
    void vscode.window.showErrorMessage(
      'Epsil: Show Inline Results needs an Epsil file in the active editor.'
    );
    return;
  }
  if (document.isUntitled) {
    void vscode.window.showErrorMessage(
      'Save this file before running it: Epsil runs a file from disk.'
    );
    return;
  }
  if (!(await document.save())) return;

  const runner = context.asAbsolutePath(path.join('dist', 'inline-runner.js'));
  const timeLimit =
    vscode.workspace
      .getConfiguration('epsil')
      .get<number>('inlineResults.statementTimeLimit') ?? 5000;

  const output = await new Promise<{ stdout: string; stderr: string }>(
    (resolve) => {
      execFile(
        process.execPath,
        [runner, document.uri.fsPath, String(timeLimit)],
        {
          // The extension host's own executable doubles as node.
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          maxBuffer: 16 * 1024 * 1024,
        },
        (_error, stdout, stderr) => resolve({ stdout, stderr })
      );
    }
  );

  if (output.stderr.trim().length > 0) {
    // Parse errors and diagnostics: the language server already shows them
    // inline; a status message is enough here.
    void vscode.window.setStatusBarMessage(
      'Epsil: inline results — the file has diagnostics (see Problems).',
      5000
    );
  }

  const [valueType, errorType] = decorationTypes();
  const values: vscode.DecorationOptions[] = [];
  const errors: vscode.DecorationOptions[] = [];
  for (const line of output.stdout.split('\n')) {
    if (line.trim() === '') continue;
    let record: {
      type?: string;
      endLine?: number;
      value?: string;
      isError?: boolean;
    };
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record.type !== 'result' || record.value === undefined) continue;
    const at = Math.min((record.endLine ?? 1) - 1, document.lineCount - 1);
    const range = document.lineAt(at).range;
    (record.isError ? errors : values).push({
      range,
      renderOptions: {
        after: { contentText: ` ⇒ ${record.value}` },
      },
    });
  }
  editor.setDecorations(valueType, values);
  editor.setDecorations(errorType, errors);
  decoratedDocument = document.uri.toString();
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
