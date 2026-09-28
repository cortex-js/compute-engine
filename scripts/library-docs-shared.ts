// The parts of the Epsil library documentation that its two generators share:
// `build-library-docs.ts` (the one-page index, `src/epsil/docs/library.md`)
// and `build-library-reference.ts` (one page per category,
// `src/epsil/docs/reference/<category>.md`). Both read the same library
// definitions through the same `describeName()` that `epsil doc <name>`
// prints and the editor shows as a hover, execute the same examples, and
// escape prose the same way, so the two cannot disagree about what the
// engine defines.

import { ComputeEngine } from '../src/compute-engine/index.js';
import { STANDARD_LIBRARIES } from '../src/compute-engine/library/library.js';
import { describeName, type DocEntry } from '../src/cli/doc.js';
import { executeEpsil } from '../src/epsil/execute-epsil.js';
import {
  canonicalLibraryName,
  epsilNameOf,
} from '../src/epsil/library-names.js';
import { documentBindings, isNameVisibleAt } from '../src/epsil/occurrences.js';
import { parseEpsil } from '../src/epsil/parse-epsil.js';
import {
  binderSitesOf,
  resolveLibraryNames,
} from '../src/epsil/resolve-library-names.js';

/** The page title of each library, in the engine's loading order. A library
 * missing here still renders, under its identifier. */
export const TITLES: Record<string, string> = {
  'core': 'Core',
  'control-structures': 'Control structures',
  'logic': 'Logic',
  'collections': 'Collections',
  'colors': 'Colors',
  'regexp': 'Regular expressions',
  'fractals': 'Fractals',
  'relop': 'Relations',
  'arithmetic': 'Arithmetic',
  'trigonometry': 'Trigonometry',
  'calculus': 'Calculus',
  'polynomials': 'Polynomials',
  'combinatorics': 'Combinatorics',
  'number-theory': 'Number theory',
  'special-functions': 'Special functions',
  'linear-algebra': 'Linear algebra',
  'statistics': 'Statistics',
  'units': 'Units',
  'physics': 'Physics',
};

/**
 * Registry entries are plain text with backtick code spans. The site renders
 * MDX, where a bare `<`, `>`, `{` or `}` outside a code span is JSX syntax,
 * so those are entity-escaped everywhere except inside backtick spans. In a
 * table cell (`cell: true`) a `|` outside a code span would end the cell, so
 * it is escaped too; inside a code span a `|` is escaped in a cell only.
 */
export function mdx(prose: string, cell = true): string {
  return prose
    .split(/(`[^`\n]*`)/)
    .map((run, i) => {
      if (i % 2 === 1) return cell ? run.replaceAll('|', '\\|') : run;
      const escaped = run
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('{', '&#123;')
        .replaceAll('}', '&#125;');
      return cell ? escaped.replaceAll('|', '\\|') : escaped;
    })
    .join('');
}

/** The first sentence of a description's first paragraph, on one line. */
export function summary(entry: DocEntry): string {
  const first = entry.description?.[0] ?? '';
  const oneLine = first.replace(/\s+/g, ' ').trim();
  // A sentence ends at a period followed by a space and a capital letter or
  // a backtick; a period inside a code span (`1.5`) or before a lowercase
  // letter (`e.g. this`) does not end it.
  const m = oneLine.match(/^(.*?[.!?])\s+(?=[A-Z`(])/);
  const sentence = m ? m[1] : oneLine;
  if (sentence.length <= 240) return sentence;
  // Clamp at the last word boundary before the limit, never mid-word.
  const cut = sentence.lastIndexOf(' ', 239);
  return `${sentence.slice(0, cut > 120 ? cut : 239)}…`;
}

/** An operator's signature, or a symbol's kind and type (and value, for a
 * constant), as inline markdown. */
export function shape(entry: DocEntry): string {
  if (entry.signature !== undefined) return `\`${entry.signature}\``;
  const type = entry.type === undefined ? '' : ` \`${entry.type}\``;
  const value =
    entry.kind === 'constant' && entry.value !== undefined
      ? ` = \`${entry.value}\``
      : '';
  return `${entry.kind}${type}${value}`;
}

/** The example with its trailing `// …` comment removed: the annotation the
 * generator writes replaces whatever the author noted. The scan tracks
 * string literals, so a `//` inside one (`"http://…"`) is code, not a
 * comment. */
export function exampleSource(example: string): string {
  let quote: string | undefined;
  for (let i = 0; i < example.length; i++) {
    const c = example[i];
    if (quote !== undefined) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = undefined;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '/' && example[i + 1] === '/')
      return example.slice(0, i).trim();
  }
  return example.trim();
}

/**
 * The example in the Epsil style: every FREE occurrence of a library name
 * that has a lowercase spelling is written with the spelling (`Sin(1)` →
 * `sin(1)`, `Pi` → `pi`). A name the example binds itself (`let Total = …`)
 * and a verbatim name (`` `Sin` ``) are left as written, and so is a name
 * whose spelling the example binds at that point (`let pi = 3; Pi` keeps
 * `Pi`: written `pi`, it would read the local). A glyph (`π`, read as
 * `Pi`) stays a glyph: its source text is not the library name. A variable
 * a library call binds (`Sum(k^2, k in 1..n)`) is classified the way the
 * resolution pass classifies it, so it is never mistaken for a free library
 * name. The definitions write their examples with the MathJSON names; the
 * page shows the language's own spelling, and the program means the same
 * thing on both spellings, so the `// ➔` annotation is unchanged.
 */
export function epsilSpelling(source: string, engine: ComputeEngine): string {
  const [ast, diagnostics] = parseEpsil(source);
  if (diagnostics.some((d) => d.severity === 'error')) return source;
  const edits: { start: number; end: number; text: string }[] = [];
  const groups = documentBindings(ast, source, {
    binderSites: (node) => binderSitesOf(engine, node, source),
  });
  for (const group of groups) {
    if (group.kind !== 'free') continue;
    // The spelling must round-trip to this very name: a free `Total` that
    // fits the naming pattern but is no library member keeps its spelling.
    const spelling = epsilNameOf(group.name);
    if (spelling === undefined || canonicalLibraryName(spelling) !== group.name)
      continue;
    for (const occurrence of group.occurrences) {
      // A verbatim name's span includes its backticks, and a glyph's span is
      // the glyph: neither spells the plain name, so neither is rewritten.
      if (source.slice(occurrence.start, occurrence.end) !== group.name)
        continue;
      if (isNameVisibleAt(groups, spelling, occurrence.start)) continue;
      edits.push({
        start: occurrence.start,
        end: occurrence.end,
        text: spelling,
      });
    }
  }
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}

/**
 * What an example evaluates to: `{ value }` for the `// ➔` annotation, or
 * `{ impure: true }` when no annotation may be written because the program
 * is impure (a random draw — two runs need not agree, and one lucky
 * agreement proves nothing). A parse error, an error-severity diagnostic,
 * or an error VALUE is a broken example, and throws: the page must not
 * ship it, neither annotated nor unannotated (an unannotated block passes
 * the documentation test unchecked). A warning-only diagnostic keeps the
 * annotation. A value that prints on several lines is collapsed to one —
 * the annotation is one line, and the documentation test compares with
 * whitespace removed.
 */
export function evaluateExample(
  source: string,
  name: string,
  page: string
): { value: string } | { impure: true } {
  const [ast, parseDiagnostics] = parseEpsil(source);
  const broken = (why: string): never => {
    throw new Error(`${page}: the example of ${name} ${why}: ${source}`);
  };
  if (parseDiagnostics.some((d) => d.severity === 'error'))
    return broken(
      `does not parse (${JSON.stringify(parseDiagnostics.map((d) => d.message))})`
    );
  const purity = new ComputeEngine();
  if (!purity.box(resolveLibraryNames(ast, source, purity)).isPure)
    return { impure: true };
  const result = executeEpsil(new ComputeEngine(), source);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    return broken(`reports ${JSON.stringify(errors.map((d) => d.message))}`);
  if (result.value.operator === 'Error')
    return broken(`evaluates to the error ${result.value.toString()}`);
  return { value: result.value.toString().replace(/\s+/g, ' ').trim() };
}

/** An example as a fenced `epsil` block in the Epsil spelling, annotated
 * with the value it evaluates to (no annotation for an impure program). */
export function exampleBlock(
  example: string,
  name: string,
  page: string,
  engine: ComputeEngine
): string {
  const source = epsilSpelling(exampleSource(example), engine);
  const outcome = evaluateExample(source, name, page);
  return 'impure' in outcome
    ? `\`\`\`epsil\n${source}\n\`\`\``
    : `\`\`\`epsil\n${source}\n// ➔ ${outcome.value}\n\`\`\``;
}

/** A table cell must not open a code span it never closes: an unmatched
 * backtick would swallow the rest of the row. */
export function assertBalancedBackticks(
  cell: string,
  where: string,
  page: string
): string {
  if ((cell.match(/`/g) ?? []).length % 2 !== 0)
    throw new Error(`${page}: unmatched backtick in ${where}: ${cell}`);
  return cell;
}

/** The slug the site gives a heading — the same reading
 * `test/epsil/documentation.test.ts` applies when it resolves an anchor. */
export function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

export type Row = { entry: DocEntry; examples: string[] };
export type Section = { name: string; title: string; rows: Row[] };

/**
 * Every documented definition of the standard library, grouped by library in
 * the engine's loading order, each library's rows in codepoint order of the
 * MathJSON name (a locale collation may differ between machines, and a
 * regenerated page must not reorder rows without a change of content). An
 * internal name (`__unit__`) is not part of the documented surface.
 */
export function librarySections(engine: ComputeEngine): Section[] {
  const sections: Section[] = [];
  for (const lib of STANDARD_LIBRARIES) {
    const blocks =
      lib.definitions === undefined
        ? []
        : Array.isArray(lib.definitions)
          ? lib.definitions
          : [lib.definitions];
    const rows: Row[] = [];
    for (const block of blocks) {
      for (const [name, def] of Object.entries(block)) {
        if (name.startsWith('_')) continue;
        const entry = describeName(engine, name);
        if (entry === undefined) continue;
        const raw = (def as { examples?: string | string[] }).examples;
        const examples =
          raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
        rows.push({ entry, examples });
      }
    }
    rows.sort((a, b) =>
      a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
    );
    sections.push({
      name: lib.name,
      title: TITLES[lib.name] ?? lib.name,
      rows,
    });
  }
  return sections;
}
