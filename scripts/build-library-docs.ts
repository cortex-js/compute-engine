// Generates `src/epsil/docs/library.md` — the categorized index of the
// standard library — from the definitions themselves: the same
// `describeName()` that `epsil doc <name>` prints and the editor shows as a
// hover, over the same library list the engine loads. One source, so the
// page cannot drift from what the engine actually defines.
//
// Each definition contributes one table row (name, signature or type, the
// first sentence of its description). A definition that declares `examples`
// also contributes one fenced `epsil` block per example, with the value the
// example EVALUATES to written as a `// ➔` annotation: the documentation
// test (`test/epsil/documentation.test.ts`) executes every block of this
// page and compares the annotation against a fresh run, so an example that
// stops being true fails the build rather than misleading a reader. An
// example that does not parse or evaluates to an error fails THIS script.
// An example whose result is not reproducible (a random draw) is written
// without an annotation. Examples are Epsil source (`BaseDefinition.examples`).
//
// Run via `npm run doc` (scripts/doc.sh) or directly:
//   npx tsx scripts/build-library-docs.ts

import { writeFileSync } from 'node:fs';

import { ComputeEngine } from '../src/compute-engine/index.js';
import { STANDARD_LIBRARIES } from '../src/compute-engine/library/library.js';
import { describeName, type DocEntry } from '../src/cli/doc.js';
import { executeEpsil } from '../src/epsil/execute-epsil.js';
import { parseEpsil } from '../src/epsil/parse-epsil.js';

/** The page title of each library, in the engine's loading order. A library
 * missing here still renders, under its identifier. */
const TITLES: Record<string, string> = {
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
 * so those are entity-escaped everywhere except inside backtick spans. A
 * `|` outside a code span would end a table cell, so it is escaped too.
 */
function mdx(prose: string): string {
  return prose
    .split(/(`[^`\n]*`)/)
    .map((run, i) =>
      i % 2 === 1
        ? run.replaceAll('|', '\\|')
        : run
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('{', '&#123;')
            .replaceAll('}', '&#125;')
            .replaceAll('|', '\\|')
    )
    .join('');
}

/** The first sentence of a description's first paragraph, on one line. */
function summary(entry: DocEntry): string {
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

/** The middle column: an operator's signature, a symbol's kind and type. */
function shape(entry: DocEntry): string {
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
function exampleSource(example: string): string {
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
function evaluateExample(
  source: string,
  name: string
): { value: string } | { impure: true } {
  const [ast, parseDiagnostics] = parseEpsil(source);
  const broken = (why: string): never => {
    throw new Error(`library.md: the example of ${name} ${why}: ${source}`);
  };
  if (parseDiagnostics.some((d) => d.severity === 'error'))
    return broken(
      `does not parse (${JSON.stringify(parseDiagnostics.map((d) => d.message))})`
    );
  if (!new ComputeEngine().box(ast).isPure) return { impure: true };
  const result = executeEpsil(new ComputeEngine(), source);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    return broken(`reports ${JSON.stringify(errors.map((d) => d.message))}`);
  if (result.value.operator === 'Error')
    return broken(`evaluates to the error ${result.value.toString()}`);
  return { value: result.value.toString().replace(/\s+/g, ' ').trim() };
}

/** A table cell must not open a code span it never closes: an unmatched
 * backtick would swallow the rest of the row. */
function assertBalancedBackticks(cell: string, where: string): string {
  if ((cell.match(/`/g) ?? []).length % 2 !== 0)
    throw new Error(`library.md: unmatched backtick in ${where}: ${cell}`);
  return cell;
}

/** The slug the site gives a heading — the same reading
 * `test/epsil/documentation.test.ts` applies when it resolves an anchor. */
function headingSlug(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

const engine = new ComputeEngine();

type Row = { entry: DocEntry; examples: string[] };
type Section = { name: string; title: string; rows: Row[] };

const sections: Section[] = [];
let exampleCount = 0;

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
      // An internal name (`__unit__`) is not part of the documented surface.
      if (name.startsWith('_')) continue;
      const entry = describeName(engine, name);
      if (entry === undefined) continue;
      const raw = (def as { examples?: string | string[] }).examples;
      const examples =
        raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
      rows.push({ entry, examples });
    }
  }
  // Codepoint order: a locale collation may differ between machines, and a
  // regenerated page must not reorder rows without a change of content.
  rows.sort((a, b) =>
    a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0
  );
  sections.push({ name: lib.name, title: TITLES[lib.name] ?? lib.name, rows });
}

const anchor = (s: Section): string => headingSlug(s.title);

const contents = sections
  .map((s) => `- [${s.title}](#${anchor(s)}) — ${s.rows.length} definitions`)
  .join('\n');

const body = sections
  .map((s) => {
    const table = [
      '| Name | Signature | Summary |',
      '|:-----|:----------|:--------|',
      ...s.rows.map(
        (r) =>
          `| \`${r.entry.id}\` | ${assertBalancedBackticks(mdx(shape(r.entry)), r.entry.id)} | ${assertBalancedBackticks(mdx(summary(r.entry)), r.entry.id)} |`
      ),
    ].join('\n');
    const examples = s.rows
      .flatMap((r) =>
        r.examples.map((example) => {
          const source = exampleSource(example);
          const outcome = evaluateExample(source, r.entry.id);
          exampleCount += 1;
          return 'impure' in outcome
            ? `\`\`\`epsil\n${source}\n\`\`\``
            : `\`\`\`epsil\n${source}\n// ➔ ${outcome.value}\n\`\`\``;
        })
      )
      .join('\n\n');
    return `## ${s.title}\n\n${table}${examples ? `\n\n### Examples\n\n${examples}` : ''}`;
  })
  .join('\n\n');

const total = sections.reduce((n, s) => n + s.rows.length, 0);

// The slug is written `/epsil/`-rooted like every other page in this
// directory (see `build-error-docs.ts` for why).
const page = `---
title: Epsil Standard Library
sidebar_label: Standard Library
slug: /epsil/library/
description: "Every function and constant of the Epsil standard library, by category, with signatures, summaries, and executable examples."
hide_title: true
date: Last Modified
# GENERATED FILE — do not edit. Source: the library definitions
# (src/compute-engine/library/) as \`epsil doc\` describes them; regenerate
# with \`npm run doc\` (scripts/build-library-docs.ts).
---
# Epsil Standard Library

The ${total} functions and constants of the standard library, by category.
Each row gives a name, its signature (for a function) or its kind and type
(for a constant or variable), and the first sentence of its description —
the same description \`epsil doc <name>\` prints in full and the editor
shows as a hover. The examples are executed when this page is generated,
and the value each one evaluates to is written after it as \`// ➔\`; the
documentation test runs them again, so an example that stops being true
fails the build.

To search the library by concept rather than by name, use
\`epsil doc <keywords>\` (see the [CLI](/epsil/cli/)); the
[guide for agents](/epsil/for-agents/) lists the names most often needed.

${contents}

${body}
`;

writeFileSync(new URL('../src/epsil/docs/library.md', import.meta.url), page);
console.log(
  `library.md: ${total} definitions in ${sections.length} categories, ${exampleCount} examples written to src/epsil/docs/library.md`
);
