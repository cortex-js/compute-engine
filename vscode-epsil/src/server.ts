import {
  CodeActionKind,
  createConnection,
  DiagnosticSeverity,
  DidChangeConfigurationNotification,
  DocumentHighlightKind,
  LSPErrorCodes,
  MarkupKind,
  ProposedFeatures,
  ResponseError,
  SymbolKind,
  TextDocuments,
  TextDocumentSyncKind,
  type CodeAction,
  type Diagnostic,
  type DocumentHighlight,
  type DocumentSymbol,
  type InitializeParams,
  type InitializeResult,
  type Location,
  type Range,
  type SymbolInformation,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

// The engine is bundled from source: esbuild resolves the repo's
// `.js`-suffixed TypeScript imports the same way the repo's own build does.
import { checkSource, parseSource } from '../../src/cli/check.js';
import { describeName } from '../../src/cli/doc.js';
import {
  diagnosticToJson,
  sourceLocation,
  type JsonDiagnostic,
} from '../../src/cli/format.js';
import { compile } from '../../src/compute-engine/compilation/compile-expression.js';
import { ComputeEngine, parseEpsil } from '../../src/epsil.js';
import type { MathJsonExpression } from '../../src/math-json/types.js';
import {
  operand,
  operator,
  operands,
  stringValue,
} from '../../src/math-json/utils.js';
import {
  definitionSites,
  type DefinitionSite,
} from '../../src/epsil/definition-sites.js';
import {
  documentBindings,
  isNameVisibleAt,
  occurrenceAt,
  type BindingGroup,
  type Occurrence,
} from '../../src/epsil/occurrences.js';
import { ERROR_EXPLANATIONS } from '../../src/epsil/error-explanations.js';
import { HARD_RESERVED_WORDS } from '../../src/epsil/reserved-words.js';
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
let hasCodeDescriptionCapability = false;
let hasHierarchicalSymbolCapability = false;
let diagnosticsEnabled = true;

/** Where the extended error explanations are hosted — one section per
 * documented code, anchored by the code itself. The page is generated from
 * `ERROR_EXPLANATIONS` (the registry behind `epsil doc <code>`) into
 * `src/epsil/docs/errors.md` by `npm run doc`, so the link target and the
 * CLI print the same text. */
const ERROR_DOCS_URL = 'https://epsil.dev/errors/';

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
  /** The renderer's notes, kept structured so the hover can render them as
   * markdown. They are deliberately NOT part of `Diagnostic.message`, which
   * stays a one-line headline on the plain-text surfaces (see `toEntry`). */
  notes: NonNullable<JsonDiagnostic['notes']>;
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
  // A client with this capability renders a diagnostic's code as a link to
  // `codeDescription.href` (VS Code shows it as the clickable code in the
  // pop-over and the Problems panel).
  hasCodeDescriptionCapability =
    params.capabilities.textDocument?.publishDiagnostics
      ?.codeDescriptionSupport === true;
  // With this capability the outline is served as a TREE (a function's local
  // declarations nest under it); without it, as a flat symbol list.
  hasHierarchicalSymbolCapability =
    params.capabilities.textDocument?.documentSymbol
      ?.hierarchicalDocumentSymbolSupport === true;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix] },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      documentHighlightProvider: true,
      documentSymbolProvider: true,
      renameProvider: { prepareProvider: true },
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
  const offset = document.offsetAt(position);
  const word = identifierAt(text, offset);

  // Diagnostics first — an error under the cursor is what the reader is
  // asking about — then what the hovered name is. The editor stacks the raw
  // diagnostic headline (plain text) and this hover in one pop-over; the
  // sections built here carry the diagnostic's NOTES, which the headline
  // deliberately omits (see `toEntry` and `diagnosticMarkdown`). When the
  // symbol hover below already captions the hovered name's declaration, the
  // diagnostic's own "defined here" quote of that same declaration is elided
  // rather than shown twice.
  const symbol =
    word === undefined ? undefined : describeSymbol(word.name, text);
  const sections = diagnosticHovers(
    textDocument.uri,
    document,
    offset,
    text,
    symbol === undefined ? undefined : word?.name
  );
  if (symbol !== undefined) sections.push(symbol);
  if (sections.length === 0) return null;

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: sections.join('\n\n---\n\n'),
    },
    // Anchor to the hovered name when there is one; for a hover served only
    // by a diagnostic, let the client pick its default range.
    ...(word === undefined
      ? {}
      : {
          range: {
            start: document.positionAt(word.start),
            end: document.positionAt(word.end),
          },
        }),
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
  // place in the file (where that callee was defined). For a full-capability
  // client, notes are NOT folded into the message: the message stays a
  // one-line headline on every plain-text surface (hover top block, peek,
  // Problems panel), pointers become navigable related information, and the
  // notes render in full in the hover's markdown section (see
  // `diagnosticMarkdown`). A client without the related-information
  // capability gets every note folded into the message instead, so the
  // explanation is never lost. This leans on one assumption: a client that
  // advertises related information also implements hover — true of every
  // mainstream LSP client — since the hover is the prose notes' only home.
  const notes = json.notes ?? [];
  const located = notes.filter(
    (note): note is typeof note & { start: number; end: number } =>
      note.start !== undefined && note.end !== undefined
  );
  const folded = hasRelatedInformationCapability ? [] : notes;
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
      // A code with an extended explanation becomes a clickable link to its
      // section of the hosted reference. Gated on the registry, so a code
      // without an entry is never a dead link.
      ...(hasCodeDescriptionCapability &&
      ERROR_EXPLANATIONS[json.code] !== undefined
        ? { codeDescription: { href: `${ERROR_DOCS_URL}#${json.code}` } }
        : {}),
      source: 'epsil',
      ...(relatedInformation.length === 0 ? {} : { relatedInformation }),
    },
    start,
    end,
    fixits: json.fixits ?? [],
    notes,
  };
}

//
// ─── Hover ──────────────────────────────────────────────────────────────────

/** Longest declaration quoted in a hover, in characters. */
const HOVER_DECLARATION_LENGTH = 200;

/**
 * The markdown renderings of the published diagnostics that cover `offset`.
 *
 * This is the hover-only rich layer. `Diagnostic.message` is rendered by the
 * editor as plain text everywhere it appears (hover top block, peek,
 * Problems panel), so it is kept to a one-line headline; a diagnostic's
 * NOTES — the callee's signature, the definition it points at — appear only
 * here, as markdown: quoted names as code spans, the definition's source
 * line syntax-highlighted. A diagnostic without notes contributes nothing —
 * its headline, already on screen in the plain block, is the whole story.
 */
function diagnosticHovers(
  uri: string,
  document: TextDocument,
  offset: number,
  text: string,
  describedName?: string
): string[] {
  const state = published.get(uri);
  // The stored offsets are relative to the text that was checked; after an
  // edit they no longer apply (a re-check is already scheduled).
  if (state === undefined || state.version !== document.version) return [];
  return state.entries
    .filter(
      (entry) =>
        entry.start <= offset &&
        // Half-open, matching the published LSP range — the position just
        // past the underline is NOT covered; a zero-width diagnostic still
        // hovers at its anchor.
        (offset < entry.end || offset === entry.start)
    )
    .map((entry) => diagnosticMarkdown(entry, text, describedName))
    .filter((section) => section !== '');
}

/** One diagnostic's hover-only details: each note as a paragraph — and when
 * a note points at a second place in the file (the definition of the
 * callee), the source line it points at, quoted in a highlighted code block.
 * The message itself is NOT restated: the editor already shows it verbatim
 * in the plain block it stacks above this hover. A "defined here" note for
 * `describedName` — the name whose own declaration hover is already part of
 * this pop-over — is skipped, not shown twice. A diagnostic carrying a quick
 * fix closes with a preview: the source as it would read once the fix is
 * applied. */
function diagnosticMarkdown(
  entry: PublishedEntry,
  text: string,
  describedName?: string
): string {
  const sections: string[] = [];
  for (const note of entry.notes) {
    if (note.start === undefined || note.line === undefined) {
      sections.push(`*note:* ${proseMarkdown(note.message)}`);
      continue;
    }
    // A "defined here" pointer is captioned the way the declaration hover
    // captions its quote, so the two read in one voice; other located notes
    // (the redefinition diagnostics' "is first declared here" / "is first
    // defined here" pointers, for instance) keep their own wording.
    const definedHere = /^`([^`]+)` is defined here$/.exec(note.message);
    if (definedHere !== null && definedHere[1] === describedName) continue;
    sections.push(
      definedHere === null
        ? `*note:* ${proseMarkdown(note.message)} (line ${note.line}):`
        : `Declaration of \`${definedHere[1]}\` (line ${note.line}):`,
      codeBlock(clip(lineAt(text, note.start)))
    );
  }
  const preview = fixPreview(entry, text);
  if (preview !== undefined)
    sections.push(
      `*fix:* ${proseMarkdown(fixTitle(entry))}:`,
      codeBlock(preview)
    );
  return sections.join('\n\n');
}

/** Longest fix preview quoted in a hover, in lines. */
const FIX_PREVIEW_LINES = 8;

/**
 * The source as it would read after this diagnostic's quick fix — the
 * contiguous span from the first to the last line the edits touch,
 * post-edit, each line trimmed and clipped — or `undefined` when the
 * diagnostic carries no fixits. The fixits are a SERIES that applies
 * together (see the quick-fix section), and the entries behind a hover are
 * version-guarded, so the offsets are valid for `text` by construction; an
 * out-of-range edit is treated as "no preview" rather than quoting garbage.
 */
function fixPreview(entry: PublishedEntry, text: string): string | undefined {
  if (entry.fixits.length === 0) return undefined;
  // Ascending by start; at an equal start, the WIDER edit first, so that the
  // back-to-front application below never applies an edit whose region a
  // later-processed edit has already rewritten (a zero-width insertion at
  // the start of a replaced range must land after the replacement).
  const ascending = [...entry.fixits].sort(
    (a, b) => a.start - b.start || b.end - a.end
  );

  // Track the edited region's bounds in the FIXED text's coordinates: each
  // edit lands at its original offset shifted by the length change of the
  // edits before it. `last` is INCLUSIVE — for a pure deletion (empty
  // value), the affected point is the join where the deleted text was.
  let delta = 0;
  let from = Infinity;
  let last = 0;
  for (const edit of ascending) {
    if (edit.start < 0 || edit.start > edit.end || edit.end > text.length)
      return undefined;
    const at = edit.start + delta;
    from = Math.min(from, at);
    last = Math.max(last, at + Math.max(0, edit.value.length - 1));
    delta += edit.value.length - (edit.end - edit.start);
  }

  // Apply back-to-front so the earlier edits' offsets stay valid.
  let fixed = text;
  for (const edit of [...ascending].reverse())
    fixed = fixed.slice(0, edit.start) + edit.value + fixed.slice(edit.end);

  const firstLine = sourceLocation(fixed, from).line;
  const lastLine = sourceLocation(fixed, Math.max(from, last)).line;
  // Same line-break rules as `sourceLocation`, which numbered the lines.
  const lines = fixed
    .split(/\r\n|[\n\r\u2028\u2029]/)
    .slice(firstLine - 1, lastLine)
    .map((line) => clip(line.trim()));
  return lines.length > FIX_PREVIEW_LINES
    ? [...lines.slice(0, FIX_PREVIEW_LINES), '…'].join('\n')
    : lines.join('\n');
}

/**
 * Diagnostic prose as markdown. The renderer quotes names and types in
 * backticks, which markdown turns into real code spans; everything OUTSIDE a
 * quoted span is escaped, so a bare `*` cannot start emphasis and a bare
 * `<...>` cannot be dropped as unsupported HTML. Newlines become hard breaks.
 */
function proseMarkdown(prose: string): string {
  return prose
    .split(/(`[^`\n]*`)/)
    .map((run, i) =>
      // Odd indices are the captured code spans, kept verbatim.
      i % 2 === 1 ? run : run.replace(/[\\`*_{}[\]<>#|!~]/g, '\\$&')
    )
    .join('')
    .replaceAll('\n', '\\\n');
}

/** The full source line containing `offset`, trimmed. `sourceLocation` is
 * the CLI renderer's own offset-to-line resolver, so the line quoted here is
 * split by the same line-break rules (CRLF, lone CR, U+2028/U+2029) that
 * produced the diagnostic's `line` — and the offset is clamped into range. */
function lineAt(text: string, offset: number): string {
  return (sourceLocation(text, offset).text ?? '').trim();
}

/** The 1-based line number of `offset` in `text`, by the same line-break
 * rules as `lineAt`. */
function lineNumberAt(text: string, offset: number): number {
  return sourceLocation(text, offset).line;
}

/** `code` shortened to what a hover should quote at most. */
function clip(code: string): string {
  return code.length > HOVER_DECLARATION_LENGTH
    ? `${code.slice(0, HOVER_DECLARATION_LENGTH - 1)}…`
    : code;
}

/**
 * The engine consulted for hovers. Cached: constructing one costs ~10ms and
 * every lookup below is read-only (`lookupDefinition` of an unknown name
 * declares nothing), so — unlike `checkSource()`, whose canonicalization can
 * retype symbols and therefore needs a fresh engine per call — one instance
 * serves the whole session.
 */
let hoverEngine: ComputeEngine | undefined;

/**
 * The lexed and parsed views of the document a hover or navigation request is
 * being served for, memoized so that moving the mouse across one buffer does
 * not re-lex and re-parse it per pixel. Keyed by the text itself — an edit
 * produces different text and therefore a miss — and one entry deep, since
 * requests arrive in runs on a single document.
 */
let hoverCache: {
  text: string;
  tokens?: Token[];
  parse?: { ast: MathJsonExpression | null; errors: number };
  sites?: Map<string, DefinitionSite>;
  bindings?: BindingGroup[];
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

/** The document's raw AST with its error count. The PARSER can throw (a
 * `#error` pragma), which is reported as "no tree, one error" — hovers then
 * know no declarations and a rename knows to refuse. */
function parseOf(text: string): { ast: MathJsonExpression | null; errors: number } {
  const cache = cacheFor(text);
  if (cache.parse === undefined) {
    try {
      const [ast, diagnostics] = parseEpsil(text);
      cache.parse = {
        ast,
        errors: (diagnostics ?? []).filter((d) => d.severity === 'error')
          .length,
      };
    } catch {
      cache.parse = { ast: null, errors: 1 };
    }
  }
  return cache.parse;
}

/** Where the document declares each of its names. */
function sitesOf(text: string): Map<string, DefinitionSite> {
  const cache = cacheFor(text);
  if (cache.sites === undefined) {
    const { ast } = parseOf(text);
    cache.sites = ast === null ? new Map() : definitionSites(ast);
  }
  return cache.sites;
}

/** Every symbol occurrence in the document, resolved to its binding —
 * computed on the raw AST, which is the only tree carrying source offsets on
 * each written symbol. Best-effort on a recovered parse: what parsed,
 * resolves. */
function bindingsOf(text: string): BindingGroup[] {
  const cache = cacheFor(text);
  cache.bindings ??= documentBindings(parseOf(text).ast, text);
  return cache.bindings;
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

  const sections = [
    // Caption the quote: without it, hovering a USE of `x` pops up a bare
    // `let x` with nothing saying that this is where `x` was declared.
    `Declaration of \`${name}\` (line ${lineNumberAt(text, site.name[0])}):`,
    codeBlock(clip(quoted)),
  ];
  // The doc comment written before the definition (`///` lines or a
  // `/** … *\/` block) — markdown, shown below the quoted header exactly as
  // the library's description is shown below its signature.
  if (site.description !== undefined) sections.push(site.description);
  return sections.join('\n\n');
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
 * registers, so the hover gets the editor's own syntax highlighting. The
 * fence outgrows any backtick run in the quoted code (which can be an
 * arbitrary source line), so the code cannot close the fence early. */
function codeBlock(code: string): string {
  const backticks = code.match(/`+/g) ?? [];
  const fence = '`'.repeat(
    Math.max(3, ...backticks.map((run) => run.length + 1))
  );
  return [`${fence}epsil`, code, fence].join('\n');
}

//
// ─── Navigation: definition, references, highlights, outline, rename ────────
//
// All five are served from ONE analysis: `bindingsOf(text)` resolves every
// symbol occurrence in the raw AST to its binding, scope-aware (see
// `src/epsil/occurrences.ts`). A cursor position is first snapped to a name
// token by the LEXER (`identifierAt` — same rule as the hover, so comments
// and string contents are never names), then matched to the occurrence at
// that token's span.
//

/** The binding group under the cursor, with everything the handlers need.
 * `undefined` when the cursor is not on a resolved name occurrence — being
 * on a TOKEN is not enough: `number` in a type annotation lexes as a symbol
 * but is no occurrence (annotations are strings to the resolver). */
function bindingAt(
  uri: string,
  position: { line: number; character: number }
):
  | {
      document: TextDocument;
      text: string;
      word: { name: string; start: number; end: number };
      groups: BindingGroup[];
      group: BindingGroup;
    }
  | undefined {
  const document = documents.get(uri);
  if (document === undefined) return undefined;
  const text = document.getText();
  const word = identifierAt(text, document.offsetAt(position));
  if (word === undefined) return undefined;
  const groups = bindingsOf(text);
  const found = occurrenceAt(groups, word.start);
  if (found === undefined || found.group.name !== word.name) return undefined;
  return { document, text, word, groups, group: found.group };
}

function rangeOf(document: TextDocument, span: Occurrence): Range {
  return {
    start: document.positionAt(span.start),
    end: document.positionAt(span.end),
  };
}

connection.onDefinition(({ textDocument, position }): Location | null => {
  const at = bindingAt(textDocument.uri, position);
  if (at === undefined) return null;
  // The first definition occurrence: a multi-clause function's first clause.
  // A free name — undeclared, or a library builtin — has no source to go to.
  const definition = at.group.occurrences.find((o) => o.role === 'definition');
  if (definition === undefined) return null;
  return { uri: textDocument.uri, range: rangeOf(at.document, definition) };
});

connection.onReferences(({ textDocument, position, context }): Location[] | null => {
  const at = bindingAt(textDocument.uri, position);
  if (at === undefined) return null;
  return at.group.occurrences
    .filter((o) => context.includeDeclaration || o.role !== 'definition')
    .map((o) => ({ uri: textDocument.uri, range: rangeOf(at.document, o) }));
});

connection.onDocumentHighlight(({ textDocument, position }): DocumentHighlight[] | null => {
  const at = bindingAt(textDocument.uri, position);
  if (at === undefined) return null;
  return at.group.occurrences.map((o) => ({
    range: rangeOf(at.document, o),
    kind:
      o.role === 'read' ? DocumentHighlightKind.Read : DocumentHighlightKind.Write,
  }));
});

//
// ─── Outline ────────────────────────────────────────────────────────────────

/** The outline's kind for a binding — the bindings that are NOT listed
 * (parameters, loop and match-pattern variables, free names) return
 * `undefined`. */
function outlineKind(group: BindingGroup): SymbolKind | undefined {
  if (group.kind === 'function') return SymbolKind.Function;
  if (group.kind === 'variable') return SymbolKind.Variable;
  if (group.kind === 'type') return SymbolKind.Struct;
  return undefined;
}

connection.onDocumentSymbol(({ textDocument }): DocumentSymbol[] | SymbolInformation[] | null => {
  const document = documents.get(textDocument.uri);
  if (document === undefined) return null;
  const text = document.getText();

  type Entry = DocumentSymbol & { span: [number, number] };
  const entries: Entry[] = [];
  for (const group of bindingsOf(text)) {
    const kind = outlineKind(group);
    const definition = group.occurrences.find((o) => o.role === 'definition');
    if (kind === undefined || definition === undefined) continue;
    const span = group.declaration ?? [definition.start, definition.end];
    entries.push({
      name: group.name,
      kind,
      span,
      range: {
        start: document.positionAt(span[0]),
        end: document.positionAt(span[1]),
      },
      selectionRange: rangeOf(document, definition),
      children: [],
    });
  }
  // Source order; at an equal start the WIDER span first, so a container
  // precedes its contents when nesting below.
  entries.sort((a, b) => a.span[0] - b.span[0] || b.span[1] - a.span[1]);

  if (!hasHierarchicalSymbolCapability)
    return entries.map(({ name, kind, range }) => ({
      name,
      kind,
      location: { uri: textDocument.uri, range },
    }));

  // Nest by span containment: a function-local `let` files under its
  // function. The entries are in source order, so a stack of open containers
  // suffices. The internal `span` is split off here — only protocol fields
  // go over the wire.
  const roots: DocumentSymbol[] = [];
  const stack: { span: [number, number]; symbol: DocumentSymbol }[] = [];
  for (const entry of entries) {
    const { span, ...symbol } = entry;
    while (
      stack.length > 0 &&
      !(
        stack[stack.length - 1].span[0] <= span[0] &&
        span[1] <= stack[stack.length - 1].span[1]
      )
    )
      stack.pop();
    const parent = stack[stack.length - 1];
    (parent === undefined ? roots : parent.symbol.children!).push(symbol);
    stack.push({ span, symbol });
  }
  return roots;
});

//
// ─── Rename ─────────────────────────────────────────────────────────────────

/**
 * Every name used as a named-argument label anywhere in the document
 * (`f(x: 3)`). A label names the callee's PARAMETER; which callee a call
 * reaches is not resolved statically here, so a parameter whose name appears
 * as ANY label is refused a rename rather than renamed incompletely — a
 * left-behind label would change which parameter the argument binds to.
 */
function namedArgumentLabels(text: string): Set<string> {
  const labels = new Set<string>();
  const visit = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (operator(node) === 'NamedArgument') {
      const label = stringValue(operand(node, 1));
      if (label !== null) labels.add(label);
    }
    const head = operator(node);
    if (typeof head === 'object') visit(head);
    for (const op of operands(node)) visit(op);
  };
  visit(parseOf(text).ast);
  return labels;
}

/** Why this binding cannot be renamed, or `undefined` when it can. */
function renameRefusal(group: BindingGroup, text: string): string | undefined {
  if (group.kind === 'type')
    return (
      'Cannot rename a type: uses of a type name inside type annotations ' +
      'are not tracked, so they would not be renamed with it.'
    );
  if (group.kind === 'free') {
    // An undeclared name CAN be renamed (all its free uses rename together),
    // but a library builtin cannot — its definition is not in this file.
    hoverEngine ??= new ComputeEngine();
    if (describeName(hoverEngine, group.name) !== undefined)
      return `Cannot rename \`${group.name}\`: it is defined by the library, not by this file.`;
  }
  if (group.kind === 'parameter' && namedArgumentLabels(text).has(group.name))
    return (
      `Cannot rename the parameter \`${group.name}\`: a call site passes it ` +
      `by name (\`${group.name}: …\`), and named-argument labels are not ` +
      'tracked by rename yet.'
    );
  return undefined;
}

connection.onPrepareRename(({ textDocument, position }) => {
  const at = bindingAt(textDocument.uri, position);
  if (at === undefined) return null;
  const refusal = renameRefusal(at.group, at.text);
  if (refusal !== undefined)
    throw new ResponseError(LSPErrorCodes.RequestFailed, refusal);
  // Same gate as the rename itself: on a broken parse the occurrence list is
  // incomplete, so the rename WILL be refused — better to say so before the
  // user is offered an edit box and types a name.
  if (parseOf(at.text).errors > 0)
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      'Cannot rename while the file has parse errors.'
    );
  return {
    range: {
      start: at.document.positionAt(at.word.start),
      end: at.document.positionAt(at.word.end),
    },
    placeholder: at.word.name,
  };
});

connection.onRenameRequest(({ textDocument, position, newName }): WorkspaceEdit | null => {
  const at = bindingAt(textDocument.uri, position);
  if (at === undefined) return null;
  const refusal = renameRefusal(at.group, at.text);
  if (refusal !== undefined)
    throw new ResponseError(LSPErrorCodes.RequestFailed, refusal);

  // On a broken parse the occurrence list is incomplete (whatever failed to
  // parse resolved nothing), and an incomplete rename corrupts the program.
  if (parseOf(at.text).errors > 0)
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      'Cannot rename while the file has parse errors.'
    );

  // The new name must lex as ONE symbol token — plain or verbatim — covering
  // the whole input. A verbatim spelling must also be well-formed: the lexer
  // RECOVERS an unterminated `` `foo `` into a symbol token, but inserting
  // that raw spelling would leave an unterminated name in the program.
  const spelling = newName.trim();
  const tokens = tokenize(spelling).filter((t) => t.type !== 'EOF');
  const token =
    tokens.length === 1 &&
    tokens[0].start === 0 &&
    tokens[0].end === spelling.length &&
    (tokens[0].type === 'SYMBOL' ||
      (tokens[0].type === 'VERBATIM_SYMBOL' &&
        spelling.length >= 3 &&
        spelling.endsWith('`')))
      ? tokens[0]
      : undefined;
  if (token === undefined)
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      `\`${newName}\` is not a valid symbol name.`
    );
  // The checks below run on the COOKED name — `∞` lexes as the literal
  // `Infinity` and must be caught by what it MEANS, not how it is typed. An
  // underscore-only plain spelling is the discard wildcard in pattern
  // position: renaming a binding to `_` would orphan its uses.
  const cooked = token.value ?? token.text;
  if (token.type === 'SYMBOL' && /^_+$/.test(cooked))
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      `\`${spelling}\` is the discard wildcard, not a name.`
    );
  if (token.type === 'SYMBOL' && HARD_RESERVED_WORDS.has(cooked))
    throw new ResponseError(
      LSPErrorCodes.RequestFailed,
      `\`${cooked}\` is a reserved word. The verbatim form \`\`${cooked}\`\` can spell it.`
    );
  if (cooked === at.group.name) return null;

  // Renaming a FREE name to a library name would silently rebind every use
  // to the library's meaning (`x` → `Pi` turns `x + 1` into π + 1). A BOUND
  // group is safe: its binder shadows the library inside its scope.
  if (at.group.kind === 'free') {
    hoverEngine ??= new ComputeEngine();
    if (describeName(hoverEngine, cooked) !== undefined)
      throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        `\`${cooked}\` is a library name; renaming \`${at.group.name}\` to it would change what the program means.`
      );
  }

  // Refuse a rename that would change what any occurrence binds to — in
  // either direction: the new name already visible at a renamed occurrence
  // would capture it, and an existing use of the new name inside the renamed
  // binding's scope would be captured by it. Deliberately over-approximate
  // (scope spans, not exact shadowing): declining a safe rename costs a
  // manual edit; performing an unsafe one corrupts the program.
  const conflict = new ResponseError(
    LSPErrorCodes.RequestFailed,
    `\`${cooked}\` is already in use in an overlapping scope; renaming would change what it refers to.`
  );
  for (const o of at.group.occurrences)
    if (isNameVisibleAt(at.groups, cooked, o.start)) throw conflict;
  const visibleFrom = Math.max(at.group.scope[0], at.group.visibleFrom);
  for (const other of at.groups)
    if (other !== at.group && other.name === cooked)
      for (const o of other.occurrences)
        if (o.start >= visibleFrom && o.start < at.group.scope[1])
          throw conflict;

  return {
    changes: {
      [textDocument.uri]: at.group.occurrences.map((o) => ({
        range: rangeOf(at.document, o),
        // The spelling as typed: a verbatim occurrence being renamed to a
        // plain name loses its backticks (the span covers them).
        newText: spelling,
      })),
    },
  };
});

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
    case 'mapsto-arrow-legacy':
      return 'Use the function arrow "=>"';
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

//
// ─── Representation views ───────────────────────────────────────────────────
//
// The `epsil/view` request (custom, client → server) renders a document into
// one of the engine's representations, for the editor's read-only side pane:
//
//   - `ast`        — the MathJSON the parser produced, before canonicalization
//   - `canonical`  — each top-level statement in canonical form
//   - `javascript` / `python` / `glsl` — the program compiled by that target
//
// Everything here parses, canonicalizes, or compiles — nothing is ever
// evaluated, so rendering a view cannot run user code.
//

type ViewKind = 'ast' | 'canonical' | keyof typeof COMPILE_TARGETS;

connection.onRequest(
  'epsil/view',
  (params: { uri: string; view: ViewKind }): { content: string } | null => {
    const document = documents.get(params.uri);
    if (document === undefined) return null;
    try {
      return {
        content: renderView(document.getText(), params.uri, params.view),
      };
    } catch (error) {
      // A view that throws is a bug in the engine, not in the user's program:
      // put the failure where the reader is looking instead of going silent.
      const message =
        error instanceof Error ? error.stack ?? error.message : String(error);
      return {
        content: [
          '// This view could not be computed (this is a bug in the engine):',
          ...message.split('\n').map((line) => `// ${line}`),
        ].join('\n'),
      };
    }
  }
);

function renderView(text: string, uri: string, view: ViewKind): string {
  // A fresh engine per request, same rule as `validate()`: canonicalization
  // can retype symbols, so a shared engine would leak state between renders.
  const engine = new ComputeEngine();
  const { ast, diagnostics } = parseSource(text, uri, engine);
  const errors = diagnostics.filter((x) => x.severity === 'error');

  if (view === 'ast') {
    const lines = ['// MathJSON as parsed — before binding and canonicalization.'];
    if (diagnostics.length > 0)
      lines.push('//', ...diagnosticComments(diagnostics, text));
    lines.push('');
    if (ast === null) lines.push('// The program could not be parsed.');
    // Boxing with `form: 'raw'` neither binds nor canonicalizes; it is how
    // the parser's output serializes to shorthand MathJSON (full-form
    // `{fn: …}` nodes and their `sourceOffsets` collapse away).
    else lines.push(prettyJson(engine.box(ast, { form: 'raw' }).json));
    return lines.join('\n');
  }

  // The views below canonicalize. The recovered AST of a program with parse
  // errors is a guess, and its canonical form would be noise — same policy
  // as `epsil check`, which skips its canonicalization pass on parse errors.
  if (ast === null || errors.length > 0)
    return [
      '// This view needs a program that parses. Fix these first:',
      '//',
      ...diagnosticComments(errors, text),
    ].join('\n');

  if (view === 'canonical') return renderCanonical(engine, ast);
  return renderCompiled(engine, ast, view);
}

/**
 * Each top-level statement boxed canonically, in order, on the request's
 * engine — a statement's declarations are visible to the statements after it.
 *
 * Statement by statement, not the whole program at once: the parser wraps a
 * multi-statement program in `Block`, but its statements execute at the TOP
 * level (`executeEpsil` unwraps it), and canonicalizing the `Block` itself
 * would put them in a block scope — where a legal top-level `type` statement
 * is an error.
 */
function renderCanonical(
  engine: ComputeEngine,
  ast: MathJsonExpression
): string {
  const statements =
    operator(ast) === 'Block' ? [...operands(ast)] : undefined;

  if (statements === undefined) {
    // A single statement is not `Block`-wrapped; show its value bare.
    return [
      '// Canonical MathJSON (nothing evaluated).',
      '',
      prettyJson(engine.box(ast).json),
    ].join('\n');
  }

  const entries = statements.map((statement, i) => {
    try {
      return '  ' + prettyJson(engine.box(statement).json, '  ');
    } catch (error) {
      // Canonicalization is best-effort, as in `epsil check`: a statement the
      // engine cannot box gets a placeholder instead of crashing the view.
      const message = (
        error instanceof Error ? error.message : String(error)
      ).replaceAll(/\s+/g, ' ');
      return `  // Statement ${i + 1} could not be canonicalized: ${message}\n  null`;
    }
  });

  return [
    '// Canonical MathJSON — one entry per top-level statement (nothing evaluated).',
    '',
    '[',
    entries.join(',\n'),
    ']',
  ].join('\n');
}

/** The compile targets the views expose. Keys are the names the targets are
 * registered under (what `compile({to})` accepts); `comment` is the line
 * comment the rendered header and error messages must use in that language.
 *
 * `functionBody` marks a target whose `compile()` output is the BODY of a
 * function rather than a standalone program: the last statement is emitted as
 * a bare `return`, which is a syntax error at the top level of a Python module
 * or a GLSL translation unit. The JavaScript target is the exception — it
 * wraps its own output in an immediately-invoked arrow function, so what it
 * emits runs as written. The view says so in its header instead of silently
 * offering a fragment as a program; wrapping it here is not an option, because
 * the targets' wrapping routes (`compileFunction()`) need declared parameter
 * names and types the view does not have, and decline a declaration body
 * outright. */
const COMPILE_TARGETS = {
  javascript: { title: 'JavaScript', comment: '//', functionBody: false },
  python: { title: 'Python', comment: '#', functionBody: true },
  glsl: { title: 'GLSL', comment: '//', functionBody: true },
} as const;

/**
 * The whole program compiled by one of the engine's targets.
 * `fallback: false`: an operator the target has no lowering for should say so
 * here, not be papered over with an interpreter thunk whose source is
 * unprintable.
 */
function renderCompiled(
  engine: ComputeEngine,
  ast: MathJsonExpression,
  target: keyof typeof COMPILE_TARGETS
): string {
  const { title, comment, functionBody } = COMPILE_TARGETS[target];
  const header = `${comment} Compiled to ${title} by the Compute Engine.`;
  try {
    const result = compile(engine.box(ast), { to: target, fallback: false });
    const note = functionBody
      ? [`${comment} This is a function BODY — its result leaves through a`,
         `${comment} \`return\`, so it belongs inside a function, not at the`,
         `${comment} top level of a ${title} file.`]
      : [];
    return [header, ...note, '', result.code, ''].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      header,
      '',
      `${comment} This program cannot be compiled to ${title}:`,
      ...message.split('\n').map((line) => `${comment} ${line}`),
    ].join('\n');
  }
}

/** One `// severity, line N: message` comment per diagnostic. */
function diagnosticComments(
  diagnostics: ParsingDiagnostic[],
  text: string
): string[] {
  return diagnostics.map((diagnostic) => {
    const json = diagnosticToJson(diagnostic, text);
    const message = json.message.replaceAll(/\s*\n\s*/g, ' — ');
    return `// ${json.severity}, line ${json.line}: ${message}`;
  });
}

/** Longest line `prettyJson` tries to keep a subtree on. */
const PRETTY_WIDTH = 76;

/**
 * JSON with MathJSON-friendly line breaks: a subtree stays on one line when
 * it fits in `PRETTY_WIDTH` columns, and opens out one operand per line when
 * it does not — unlike `JSON.stringify(x, null, 2)`, which would spread
 * `["Add", "x", 1]` over five lines.
 */
function prettyJson(value: unknown, indent = ''): string {
  const flat = JSON.stringify(value);
  if (
    value === null ||
    typeof value !== 'object' ||
    indent.length + flat.length <= PRETTY_WIDTH
  )
    return flat;

  const inner = indent + '  ';
  if (Array.isArray(value))
    return [
      '[',
      value.map((x) => inner + prettyJson(x, inner)).join(',\n'),
      indent + ']',
    ].join('\n');
  return [
    '{',
    Object.entries(value)
      .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${prettyJson(v, inner)}`)
      .join(',\n'),
    indent + '}',
  ].join('\n');
}
