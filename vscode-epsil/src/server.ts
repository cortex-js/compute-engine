import {
  CodeActionKind,
  createConnection,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  MarkupKind,
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
import { describeName } from '../../src/cli/doc.js';
import { diagnosticToJson } from '../../src/cli/format.js';
import { ComputeEngine, parseEpsil } from '../../src/epsil.js';
import {
  definitionSites,
  type DefinitionSite,
} from '../../src/epsil/definition-sites.js';
import type { ParsingDiagnostic } from '../../src/epsil/diagnostics.js';
import { tokenize } from '../../src/epsil/lexer.js';
import type { Token } from '../../src/epsil/tokens.js';

/** Idle time before a modified document is re-checked. */
const DEBOUNCE_MS = 300;

// `createConnection()` picks its transport from the command line
// (`--node-ipc`, `--stdio`, `--socket=…`), so the same bundle serves the
// VS Code client and a plain stdio harness.
const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasRelatedInformationCapability = false;
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
  // A diagnostic's notes may point at a SECOND place in the file (the
  // definition of the function whose call failed). A client that supports
  // related information gets those as navigable entries; one that does not
  // gets them folded into the message, so the explanation is never lost.
  hasRelatedInformationCapability =
    params.capabilities.textDocument?.publishDiagnostics?.relatedInformation ===
    true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      hoverProvider: true,
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

connection.onHover(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  if (document === undefined) return null;

  const text = document.getText();
  const word = identifierAt(text, document.offsetAt(position));
  if (word === undefined) return null;

  const markdown = describeSymbol(word.name, text);
  if (markdown === undefined) return null;

  return {
    contents: { kind: MarkupKind.Markdown, value: markdown },
    range: {
      start: document.positionAt(word.start),
      end: document.positionAt(word.end),
    },
  };
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

  // A note is either prose (the callee's signature) or a pointer at a second
  // place in the file (where that callee was defined). Prose has nowhere else
  // to go, so it is always folded into the message — the hover is where a
  // reader looks for the explanation. A pointer becomes navigable related
  // information, and is folded in too when the client cannot show it.
  const notes = json.notes ?? [];
  const located = notes.filter(
    (note): note is typeof note & { start: number; end: number } =>
      note.start !== undefined && note.end !== undefined
  );
  const folded = notes.filter(
    (note) => note.start === undefined || !hasRelatedInformationCapability
  );
  const message = [
    json.message,
    ...folded.map((note) =>
      note.line === undefined
        ? `note: ${note.message}`
        : // Folded for want of the capability: the place it points at has to
          // be named in words, since there is no link to follow.
          `note: ${note.message} (line ${note.line})`
    ),
  ].join('\n');

  const relatedInformation = hasRelatedInformationCapability
    ? located.map((note) => ({
        location: {
          uri: document.uri,
          range: {
            start: document.positionAt(Math.min(note.start, text.length)),
            end: document.positionAt(Math.min(note.end, text.length)),
          },
        },
        message: note.message,
      }))
    : [];

  return {
    diagnostic: {
      severity: severityOf(diagnostic.severity),
      range: {
        start: document.positionAt(start),
        end: document.positionAt(end),
      },
      message,
      code: json.code,
      source: 'epsil',
      ...(relatedInformation.length === 0 ? {} : { relatedInformation }),
    },
    start,
    end,
    fixits: json.fixits ?? [],
  };
}

//
// ─── Hover ──────────────────────────────────────────────────────────────────

/** Longest declaration quoted in a hover, in characters. */
const HOVER_DECLARATION_LENGTH = 200;

/**
 * The engine consulted for hovers. Cached: constructing one costs ~10ms and
 * every lookup below is read-only (`lookupDefinition` of an unknown name
 * declares nothing), so — unlike `checkSource()`, whose canonicalization can
 * retype symbols and therefore needs a fresh engine per call — one instance
 * serves the whole session.
 */
let hoverEngine: ComputeEngine | undefined;

/**
 * The lexed and parsed views of the document a hover is being served for,
 * memoized so that moving the mouse across one buffer does not re-lex and
 * re-parse it per pixel. Keyed by the text itself — an edit produces different
 * text and therefore a miss — and one entry deep, since hovers arrive in runs
 * on a single document.
 */
let hoverCache: {
  text: string;
  tokens?: Token[];
  sites?: Map<string, DefinitionSite>;
} = { text: '' };

function cacheFor(text: string): typeof hoverCache {
  if (hoverCache.text !== text) hoverCache = { text };
  return hoverCache;
}

/** The document's tokens. The lexer never throws — a malformed run becomes an
 * `ERROR` token — so this needs no guard. */
function tokensOf(text: string): Token[] {
  const cache = cacheFor(text);
  cache.tokens ??= tokenize(text);
  return cache.tokens;
}

/** Where the document declares each of its names. The PARSER can throw (a
 * `#error` pragma), which for a hover just means "no declarations known". */
function sitesOf(text: string): Map<string, DefinitionSite> {
  const cache = cacheFor(text);
  if (cache.sites === undefined) {
    try {
      cache.sites = definitionSites(parseEpsil(text)[0]);
    } catch {
      cache.sites = new Map();
    }
  }
  return cache.sites;
}

/**
 * The identifier at `offset`, or `undefined` when there is no name there.
 *
 * Resolved through the LEXER rather than by scanning characters, so the word
 * a hover looks up is exactly the word the parser would have read — and, more
 * to the point, so that text which merely LOOKS like a name is not one. A
 * comment is trivia and produces no token, and the contents of a string are
 * inside a `STRING` token, so `// see Length` and `"call Length first"` both
 * resolve to nothing instead of popping up the library's `Length`.
 */
function identifierAt(
  text: string,
  offset: number
): { name: string; start: number; end: number } | undefined {
  for (const token of tokensOf(text)) {
    if (token.start > offset) return undefined;
    // Half-open, plus the position just past the token: hovering the boundary
    // after a name still means that name.
    if (offset > token.end) continue;
    if (token.type !== 'SYMBOL' && token.type !== 'VERBATIM_SYMBOL') continue;
    return {
      name: token.value ?? token.text,
      start: token.start,
      end: token.end,
    };
  }
  return undefined;
}

/**
 * The hover for a name: what this document declares it to be, or — failing
 * that — what the library says it is.
 *
 * The document is consulted FIRST because a program's own declaration shadows
 * a library name of the same spelling; showing the library's `Length` for a
 * file that declares its own would describe something the reader is not
 * looking at.
 */
function describeSymbol(name: string, text: string): string | undefined {
  return declarationHover(name, text) ?? libraryHover(name);
}

/**
 * What this document declares `name` to be, quoted from the source: the
 * header of a `function` definition, or the declaring statement otherwise.
 *
 * Parse-only — no canonicalization and nothing evaluated — so it works on a
 * buffer that does not yet run, and reports what is WRITTEN rather than what
 * the engine would infer.
 */
function declarationHover(name: string, text: string): string | undefined {
  const site = sitesOf(text).get(name);
  if (site === undefined) return undefined;

  const quoted = text
    .slice(site.header[0], site.header[1])
    .replaceAll(/\s+/g, ' ')
    .trim();
  if (quoted === '') return undefined;

  return codeBlock(
    quoted.length > HOVER_DECLARATION_LENGTH
      ? `${quoted.slice(0, HOVER_DECLARATION_LENGTH - 1)}…`
      : quoted
  );
}

/**
 * What the library says `name` is — the same entry `epsil doc <name>` prints
 * (`describeName`), rendered as markdown so the editor and the CLI cannot
 * drift apart on wording.
 */
function libraryHover(name: string): string | undefined {
  hoverEngine ??= new ComputeEngine();
  const entry = describeName(hoverEngine, name);
  if (entry === undefined) return undefined;

  const shape = entry.signature ?? entry.type;
  const sections = [
    codeBlock(shape === undefined ? entry.id : `${entry.id}: ${shape}`),
    `*${entry.kind}*`,
  ];
  if (entry.value !== undefined) sections.push(`value: \`${entry.value}\``);
  if (entry.description !== undefined) sections.push(...entry.description);
  if (entry.url !== undefined) sections.push(`[Documentation](${entry.url})`);
  return sections.join('\n\n');
}

/** A fenced Epsil code block — `epsil` is the language the extension
 * registers, so the hover gets the editor's own syntax highlighting. */
function codeBlock(code: string): string {
  return ['```epsil', code, '```'].join('\n');
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
