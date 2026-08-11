import {
  CodeActionKind,
  createConnection,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type Diagnostic,
  type InitializeParams,
  type InitializeResult,
  type TextEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// The engine is bundled from source: esbuild resolves the repo's
// `.js`-suffixed TypeScript imports the same way the repo's own build does.
import { checkSource } from '../../src/cli/check.js';
import { diagnosticToJson } from '../../src/cli/format.js';
import type { ParsingDiagnostic } from '../../src/epsil/diagnostics.js';

/** Idle time before a modified document is re-checked. */
const DEBOUNCE_MS = 300;

// `createConnection()` picks its transport from the command line
// (`--node-ipc`, `--stdio`, `--socket=…`), so the same bundle serves the
// VS Code client and a plain stdio harness.
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let diagnosticsEnabled = true;

/** Pending debounce timer, per document URI. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Newest document version scheduled or validated, per document URI. */
const pendingVersion = new Map<string, number>();

/** A published diagnostic paired with its source fixits (absolute offsets
 * into the text that was checked), kept so `onCodeAction` can serve them as
 * quick fixes. */
type PublishedEntry = {
  diagnostic: Diagnostic;
  start: number;
  end: number;
  fixits: { start: number; end: number; value: string }[];
};
/** The entries behind the last publish, per document URI, stamped with the
 * document version they were computed from — a version mismatch means the
 * offsets no longer apply. */
const published = new Map<string, { version: number; entries: PublishedEntry[] }>();

connection.onInitialize((params: InitializeParams): InitializeResult => {
  hasConfigurationCapability =
    params.capabilities.workspace?.configuration === true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
    },
  };
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    void connection.client.register(
      DidChangeConfigurationNotification.type,
      undefined
    );
  }
  void refreshConfiguration();
});

connection.onDidChangeConfiguration(() => {
  void refreshConfiguration();
});

documents.onDidOpen((event) => schedule(event.document));
documents.onDidChangeContent((event) => schedule(event.document));

documents.onDidClose((event) => {
  const uri = event.document.uri;
  const timer = timers.get(uri);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(uri);
  pendingVersion.delete(uri);
  published.delete(uri);
  void connection.sendDiagnostics({ uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();

/**
 * Re-read `epsil.diagnostics.enable` and bring every open document in line
 * with it: publish fresh diagnostics when enabled, clear them when not.
 */
async function refreshConfiguration(): Promise<void> {
  diagnosticsEnabled = await readDiagnosticsEnabled();
  for (const document of documents.all()) {
    if (diagnosticsEnabled) {
      schedule(document);
      continue;
    }
    const timer = timers.get(document.uri);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(document.uri);
    published.delete(document.uri);
    void connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
  }
}

async function readDiagnosticsEnabled(): Promise<boolean> {
  if (!hasConfigurationCapability) return true;
  try {
    const value = await connection.workspace.getConfiguration({
      section: 'epsil.diagnostics.enable',
    });
    return typeof value === 'boolean' ? value : true;
  } catch {
    // A client that advertises the capability but fails the request should
    // not silently lose diagnostics.
    return true;
  }
}

function schedule(document: TextDocument): void {
  const uri = document.uri;
  pendingVersion.set(uri, document.version);

  const timer = timers.get(uri);
  if (timer !== undefined) clearTimeout(timer);

  if (!diagnosticsEnabled) {
    timers.delete(uri);
    return;
  }

  timers.set(
    uri,
    setTimeout(() => {
      timers.delete(uri);
      validate(uri);
    }, DEBOUNCE_MS)
  );
}

function validate(uri: string): void {
  if (!diagnosticsEnabled) return;
  const document = documents.get(uri);
  if (document === undefined) return;

  const version = document.version;
  // A newer version was scheduled while this one waited out the debounce.
  if ((pendingVersion.get(uri) ?? version) > version) return;

  const text = document.getText();

  let entries: PublishedEntry[];
  try {
    // `checkSource()` parses and canonicalizes but never evaluates, and
    // builds a fresh engine per call — canonicalization can retype symbols,
    // so a shared engine would leak state between validations.
    const result = checkSource(text, uri);
    entries = result.diagnostics.map((x) => toEntry(x, text, document));
  } catch (error) {
    // A check that throws is a bug in the engine, not in the user's program:
    // report it in place of diagnostics rather than going silent.
    connection.console.error(
      `Epsil check failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`
    );
    return;
  }

  // The document may have changed while we were checking it.
  const current = documents.get(uri);
  if (current === undefined || current.version !== version) return;

  published.set(uri, { version, entries });
  void connection.sendDiagnostics({
    uri,
    version,
    diagnostics: entries.map((e) => e.diagnostic),
  });
}

function toEntry(
  diagnostic: ParsingDiagnostic,
  text: string,
  document: TextDocument
): PublishedEntry {
  // `diagnosticToJson()` is the CLI's pure renderer: it turns the
  // code/argument tuple into a human-readable message and normalizes the
  // offsets (and carries the fixits through). Reusing it keeps the editor's
  // wording identical to `epsil check`.
  const json = diagnosticToJson(diagnostic, text);
  const start = Math.max(0, Math.min(json.start, text.length));
  const end = Math.max(start, Math.min(json.end, text.length));

  return {
    diagnostic: {
      severity: severityOf(diagnostic.severity),
      range: {
        start: document.positionAt(start),
        end: document.positionAt(end),
      },
      message: json.message,
      code: json.code,
      source: 'epsil',
    },
    start,
    end,
    fixits: json.fixits ?? [],
  };
}

//
// ─── Quick fixes ────────────────────────────────────────────────────────────
//
// A diagnostic's `fixits` are a SERIES of edits that together address it (not
// alternatives), so each fixit-carrying diagnostic becomes ONE quick fix
// applying all of its edits. Per the diagnostic contract, a warning's fixit
// is always safe (marked preferred); an error's is a best guess.
//

connection.onCodeAction((params) => {
  const uri = params.textDocument.uri;
  const document = documents.get(uri);
  const state = published.get(uri);
  if (document === undefined || state === undefined) return [];
  // The stored offsets are relative to the text that was checked; after an
  // edit, they no longer apply (a re-check is already scheduled).
  if (state.version !== document.version) return [];

  const rangeStart = document.offsetAt(params.range.start);
  const rangeEnd = document.offsetAt(params.range.end);

  const actions: CodeAction[] = [];
  for (const entry of state.entries) {
    if (entry.fixits.length === 0) continue;
    // Offer the fix when the requested range touches the diagnostic.
    if (entry.end < rangeStart || entry.start > rangeEnd) continue;

    const edits: TextEdit[] = entry.fixits.map((f) => ({
      range: {
        start: document.positionAt(f.start),
        end: document.positionAt(f.end),
      },
      newText: f.value,
    }));
    actions.push({
      title: fixTitle(entry),
      kind: CodeActionKind.QuickFix,
      diagnostics: [entry.diagnostic],
      isPreferred: entry.diagnostic.severity === DiagnosticSeverity.Warning,
      edit: { changes: { [uri]: edits } },
    });
  }
  return actions;
});

/** A short, action-shaped label for a diagnostic's quick fix. */
function fixTitle(entry: PublishedEntry): string {
  switch (entry.diagnostic.code) {
    case 'mapsto-arrow-expected':
      return 'Use the function arrow "|->"';
    case 'parameter-name-mismatch':
      return "Rename the annotation's parameters to match the lambda";
    default: {
      const [first] = entry.fixits;
      if (entry.fixits.length === 1 && first.start === first.end)
        return `Insert ${JSON.stringify(first.value)}`;
      if (entry.fixits.length === 1)
        return `Replace with ${JSON.stringify(first.value)}`;
      return 'Apply fix';
    }
  }
}

function severityOf(severity: string): DiagnosticSeverity {
  if (severity === 'error') return DiagnosticSeverity.Error;
  if (severity === 'warning') return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.Information;
}
