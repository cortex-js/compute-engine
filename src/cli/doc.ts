import { ComputeEngine } from '../epsil.js';
import { canonicalLibraryName, epsilNameOf } from '../epsil/library-names.js';
import { explainErrorCode } from '../epsil/error-explanations.js';

import { CliUsageError, parseDocArguments } from './arguments.js';
import type { CliIo } from './io.js';

/**
 * One documentation entry, as printed by `epsil doc`. `signature` is set
 * for operators, `type` (and `value`, when it has one) for symbols.
 */
export interface DocEntry {
  id: string;
  /** The Epsil spelling of a standard-library name (`sin` for `Sin`), when
   * it has one. See `src/epsil/library-names.ts`. */
  epsilName?: string;
  kind: 'function' | 'opaque' | 'constant' | 'variable';
  signature?: string;
  type?: string;
  value?: string;
  description?: string[];
  keywords?: string[];
  url?: string;
  wikidata?: string;
}

/**
 * `epsil doc <name-or-keywords>` — look up a library definition by exact
 * name, or search the library (identifiers, descriptions, curated keywords,
 * LaTeX triggers) when the argument is not a known name.
 */
export function runDoc(args: readonly string[], io: CliIo): number {
  let options;
  try {
    options = parseDocArguments(args);
  } catch (error) {
    const message =
      error instanceof CliUsageError && error.message
        ? `${error.message}\n`
        : '';
    io.stderr.write(`${message}Try "epsil --help" for more information.\n`);
    return 2;
  }

  // Diagnostic codes are doc-addressable (`epsil doc zero-index`) — the
  // lookup surface a rendered diagnostic's `note:` footer points at.
  const explanation = explainErrorCode(options.query);
  if (explanation !== undefined) {
    const code = options.query.toLowerCase();
    if (options.json)
      io.stdout.write(
        `${JSON.stringify({ query: options.query, code, explanation }, null, 2)}\n`
      );
    else io.stdout.write(`${code} (diagnostic)\n\n${explanation}\n`);
    return 0;
  }

  const engine = new ComputeEngine();
  const { exact, entries } = lookupDoc(engine, options.query, options.limit);

  if (entries.length === 0) {
    if (options.json) {
      io.stdout.write(
        `${JSON.stringify({ query: options.query, matches: [] })}\n`
      );
    } else {
      io.stderr.write(`epsil: no documentation matches "${options.query}"\n`);
    }
    return 1;
  }

  if (options.json) {
    io.stdout.write(
      `${JSON.stringify({ query: options.query, matches: entries }, null, 2)}\n`
    );
    return 0;
  }

  if (exact) {
    io.stdout.write(formatEntry(entries[0]));
    const related = entries.slice(1, 6);
    if (related.length > 0)
      io.stdout.write(
        `\nRelated: ${related.map((entry) => entry.id).join(', ')}\n`
      );
  } else {
    for (const entry of entries) io.stdout.write(`${formatEntryLine(entry)}\n`);
  }
  return 0;
}

/**
 * Look up library documentation the way `epsil doc` does: an exact (or
 * case-insensitively exact) name gets the full entry first; other queries
 * get a ranked search-result list.
 */
export function lookupDoc(
  engine: ComputeEngine,
  query: string,
  limit: number
): { exact?: DocEntry; entries: DocEntry[] } {
  let exact = describeName(engine, query);
  const results = engine.searchDefinitions(query, { limit });
  if (!exact) {
    const top = results[0];
    if (top && top.id.toLowerCase() === query.toLowerCase())
      exact = describeName(engine, top.id);
  }

  if (exact) {
    return {
      exact,
      entries: [
        exact,
        ...results
          .filter((x) => x.id !== exact!.id)
          .map((x) => describeName(engine, x.id))
          .filter((x): x is DocEntry => x !== undefined),
      ],
    };
  }
  return {
    entries: results
      .map((x) => describeName(engine, x.id))
      .filter((x): x is DocEntry => x !== undefined),
  };
}

/**
 * The documentation entry for one exact name, or `undefined` when the engine
 * has no definition for it.
 *
 * Exported as the single describer of a library name: `epsil doc` prints it,
 * and the language server renders it as a hover, so the editor and the CLI
 * cannot drift apart on what a function is or what it takes.
 */
export function describeName(
  engine: ComputeEngine,
  name: string
): DocEntry | undefined {
  const def = engine.lookupDefinition(name);
  if (!def) {
    // An Epsil spelling (`sin`) with no engine binding of its own describes
    // the library name it stands for (`Sin`).
    const canonical = canonicalLibraryName(name);
    return canonical === undefined
      ? undefined
      : describeName(engine, canonical);
  }

  const entry: DocEntry = { id: name, kind: 'variable' };
  // The spelling belongs to the STANDARD library's definition: a user
  // binding that shadows a library name (`let Sin = 5` on a shared engine)
  // is described as what it is, with no spelling.
  const epsilName = epsilNameOf(name);
  if (
    epsilName !== undefined &&
    canonicalLibraryName(epsilName) === name &&
    engine.contextStack[0]?.lexicalScope.bindings.get(name) === def
  )
    entry.epsilName = epsilName;

  const base = 'operator' in def ? def.operator : def.value;
  if (base.description !== undefined)
    entry.description = Array.isArray(base.description)
      ? base.description
      : [base.description];
  if (base.keywords && base.keywords.length > 0) entry.keywords = base.keywords;
  if (base.url) entry.url = base.url;
  if (base.wikidata) entry.wikidata = base.wikidata;

  const operator = engine.operatorInfo(name);
  if (operator) {
    entry.kind = operator.kind;
    if (operator.signature) entry.signature = operator.signature.toString();
    return entry;
  }

  const symbol = engine.symbolInfo(name);
  if (symbol) {
    entry.kind = symbol.kind;
    entry.type = symbol.type.toString();
    if (symbol.kind === 'constant') {
      // The value of a constant is part of its documentation (`Pi` ≈ π).
      try {
        const value = 'value' in def ? def.value.value : undefined;
        if (value !== undefined && value !== null)
          entry.value = value.toString();
      } catch {
        // A value that cannot be computed is simply omitted.
      }
    }
  }
  return entry;
}

function formatEntry(entry: DocEntry): string {
  const lines: string[] = [formatEntryLine(entry)];
  if (entry.epsilName !== undefined) lines.push(`  epsil: ${entry.epsilName}`);
  if (entry.value !== undefined) lines.push(`  value: ${entry.value}`);
  if (entry.keywords) lines.push(`  keywords: ${entry.keywords.join(', ')}`);
  if (entry.url) lines.push(`  ${entry.url}`);
  return `${lines.join('\n')}\n`;
}

function formatEntryLine(entry: DocEntry): string {
  const shape = entry.signature ?? entry.type;
  const head = `${entry.id} (${entry.kind})${shape ? ` ${shape}` : ''}`;
  const description = entry.description?.[0];
  return description ? `${head} — ${description}` : head;
}
