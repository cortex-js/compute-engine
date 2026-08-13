import { execFile } from 'node:child_process';
import { chmod } from 'node:fs/promises';
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

/** Absolute path of the CLI bundled with the extension, set on activation. */
let bundledCliPath = '';

export async function activate(
  context: vscode.ExtensionContext
): Promise<void> {
  const viewProvider = new EpsilViewProvider();

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
    vscode.commands.registerCommand('epsil.showRepresentation', () =>
      showRepresentation(viewProvider)
    ),
    vscode.workspace.registerTextDocumentContentProvider(
      VIEW_SCHEME,
      viewProvider
    ),
    viewProvider,
    // Keep open view panes tracking their source as it is edited.
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.languageId === 'epsil')
        scheduleViewRefresh(event.document.uri, viewProvider);
    }),
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

  bundledCliPath = context.asAbsolutePath(path.join('dist', 'cli.mjs'));

  // Put an `epsil` shim on the PATH of integrated terminals (controlled by
  // `epsil.terminal.addToPath`), and keep it in sync with the setting.
  void updateTerminalPath(context);
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('epsil.terminal.addToPath'))
        void updateTerminalPath(context);
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

  // An explicit `epsil.cliCommand` wins; by default run the CLI bundled
  // with the extension, so `Epsil: Run File` executes the same engine build
  // as the language server, inline results, and the debugger.
  const configured = vscode.workspace
    .getConfiguration('epsil')
    .get<string>('cliCommand')
    ?.trim();
  const cliCommand = configured || `node ${quoteArgument(bundledCliPath)}`;

  // Run from the file's workspace folder (or its directory) so a
  // workspace-relative `epsil.cliCommand` override resolves — e.g.
  // `npx epsil` finding a project-local install in the nearest
  // node_modules.
  const cwd =
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
    path.dirname(document.uri.fsPath);

  const terminal =
    vscode.window.terminals.find((x) => x.name === TERMINAL_NAME) ??
    vscode.window.createTerminal({ name: TERMINAL_NAME, cwd });
  terminal.show(true);
  terminal.sendText(`${cliCommand} ${quoteArgument(document.uri.fsPath)}`);
}

/**
 * Make `epsil` available on the PATH of integrated terminals, running the
 * CLI bundled with the extension — the same engine build as the language
 * server, inline results, and the debugger.
 *
 * The shim lives in global storage, whose path is stable across extension
 * updates (unlike the versioned extension directory), and is rewritten on
 * every activation so it always points at the current bundle. Integrated
 * terminals only: an extension cannot (and should not) reach the PATH of
 * external shells.
 */
async function updateTerminalPath(
  context: vscode.ExtensionContext
): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration('epsil')
    .get<boolean>('terminal.addToPath', true);

  const collection = context.environmentVariableCollection;
  if (!enabled) {
    // Existing terminals keep the stale environment until relaunched; VS
    // Code marks them with a relaunch indicator.
    collection.clear();
    return;
  }

  try {
    const shimDir = vscode.Uri.joinPath(context.globalStorageUri, 'bin');
    await vscode.workspace.fs.createDirectory(shimDir);
    if (process.platform === 'win32') {
      const shim = vscode.Uri.joinPath(shimDir, 'epsil.cmd');
      const body = `@echo off\r\nnode ${quoteArgument(bundledCliPath)} %*\r\n`;
      await vscode.workspace.fs.writeFile(shim, Buffer.from(body, 'utf8'));
    } else {
      const shim = vscode.Uri.joinPath(shimDir, 'epsil');
      const body = `#!/bin/sh\nexec node ${quoteArgument(bundledCliPath)} "$@"\n`;
      await vscode.workspace.fs.writeFile(shim, Buffer.from(body, 'utf8'));
      await chmod(shim.fsPath, 0o755);
    }

    collection.persistent = true;
    collection.description =
      'Adds the `epsil` command (the CLI bundled with the extension) to integrated terminals.';
    collection.prepend('PATH', shimDir.fsPath + path.delimiter);
  } catch (error) {
    // The PATH shim is a convenience, not a load-bearing feature: log and
    // move on rather than surfacing an error dialog on every activation.
    console.error('Epsil: could not add the CLI to the terminal PATH.', error);
  }
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

// ── Representation views ───────────────────────────────────────────────────
//
// `Epsil: Show Representation` opens a read-only pane beside the source
// showing what the engine makes of it: the MathJSON it parses to, its
// canonical form, or the JavaScript it compiles to. The content comes from
// the language server (the `epsil/view` request), which parses the live
// buffer — nothing is saved to disk and nothing is evaluated.

/** URI scheme of the virtual documents holding a rendered view. */
const VIEW_SCHEME = 'epsil-view';

/** Idle time before an edited source re-renders its open view panes. */
const VIEW_REFRESH_MS = 300;

const VIEWS = [
  {
    id: 'ast',
    label: 'MathJSON (as parsed)',
    description: 'What the parser produced, before canonicalization',
    // The suffix appended to the source path names the pane's tab AND picks
    // its syntax highlighting: both MathJSON views are JSON-with-comments.
    suffix: '.parsed.jsonc',
  },
  {
    id: 'canonical',
    label: 'MathJSON (canonical)',
    description: 'Each top-level statement in canonical form',
    suffix: '.canonical.jsonc',
  },
  {
    id: 'javascript',
    label: 'Compiled JavaScript',
    description: 'The program compiled by the JavaScript target',
    suffix: '.compiled.js',
  },
  {
    id: 'python',
    label: 'Compiled Python',
    description: 'The program compiled by the Python (NumPy) target',
    suffix: '.compiled.py',
  },
  {
    id: 'glsl',
    label: 'Compiled GLSL',
    description: 'The program compiled by the GLSL (GPU shader) target',
    suffix: '.compiled.glsl',
  },
] as const;

class EpsilViewProvider implements vscode.TextDocumentContentProvider {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const params = new URLSearchParams(uri.query);
    const view = params.get('view');
    const source = params.get('src');
    if (view === null || source === null) return '// Malformed view URI.';
    if (client === undefined || !client.isRunning())
      return '// The Epsil language server is not running (try “Epsil: Restart Language Server”).';
    try {
      const result = await client.sendRequest<{ content: string } | null>(
        'epsil/view',
        { uri: source, view }
      );
      // `null` means the server is not tracking the document — it was closed.
      return result?.content ?? '// The source document is no longer open.';
    } catch (error) {
      return `// The view could not be computed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  refresh(uri: vscode.Uri): void {
    this.emitter.fire(uri);
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

/** The virtual URI of `view` over `source`. Stable for a given pair, so
 * reopening a view reuses its pane instead of stacking new tabs. */
function viewUri(
  source: vscode.Uri,
  view: (typeof VIEWS)[number]
): vscode.Uri {
  return vscode.Uri.from({
    scheme: VIEW_SCHEME,
    path: source.path + view.suffix,
    query: new URLSearchParams({
      view: view.id,
      src: source.toString(),
    }).toString(),
  });
}

async function showRepresentation(provider: EpsilViewProvider): Promise<void> {
  const document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== 'epsil') {
    void vscode.window.showErrorMessage(
      'Epsil: Show Representation needs an Epsil file in the active editor.'
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    VIEWS.map((view) => ({
      label: view.label,
      description: view.description,
      view,
    })),
    { placeHolder: 'Show this file as…' }
  );
  if (picked === undefined) return;

  const uri = viewUri(document.uri, picked.view);
  // If this view is already open on a pane, its content may predate the
  // latest edits; opening must re-render, not just reveal.
  provider.refresh(uri);
  const pane = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(pane, {
    viewColumn: vscode.ViewColumn.Beside,
    preserveFocus: true,
    preview: true,
  });
}

/** Pending view-refresh timer, per source-document URI. */
const viewRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** After `VIEW_REFRESH_MS` of idle time, re-render every open view pane that
 * is showing `source`. The panes read through the language server, which the
 * LSP client keeps in sync with the buffer, so the render is always of the
 * text as it stands when the timer fires. */
function scheduleViewRefresh(
  source: vscode.Uri,
  provider: EpsilViewProvider
): void {
  const key = source.toString();
  const timer = viewRefreshTimers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  viewRefreshTimers.set(
    key,
    setTimeout(() => {
      viewRefreshTimers.delete(key);
      for (const open of vscode.workspace.textDocuments) {
        if (open.uri.scheme !== VIEW_SCHEME) continue;
        if (new URLSearchParams(open.uri.query).get('src') === key)
          provider.refresh(open.uri);
      }
    }, VIEW_REFRESH_MS)
  );
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
