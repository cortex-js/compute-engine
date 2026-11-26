import type { ComputeEngine } from '../compute-engine.js';

import { canonicalLibraryName, epsilNameOf } from './library-names.js';
import { documentBindings, isNameVisibleAt } from './occurrences.js';
import { parseEpsil } from './parse-epsil.js';
import { binderSitesOf } from './resolve-library-names.js';

//
// The examples of the library definitions are written with the MathJSON
// names (`Join([1, 2], [3, 4])`). The reference pages and the editor
// services show them in the Epsil spelling (`join([1, 2], [3, 4])`).
//

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
  return spell(source, engine).text;
}

/** `epsilSpelling()`, with the spellings it wrote. A spelling for which
 * `keep` is true is not written: the name keeps its MathJSON spelling. */
function spell(
  source: string,
  engine: ComputeEngine,
  keep?: (spelling: string, name: string) => boolean
): { text: string; spellings: Set<string> } {
  const spellings = new Set<string>();
  const [ast, diagnostics] = parseEpsil(source);
  if (diagnostics.some((d) => d.severity === 'error'))
    return { text: source, spellings };
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
    if (keep?.(spelling, group.name)) continue;
    for (const occurrence of group.occurrences) {
      // A verbatim name's span includes its backticks, and a glyph's span is
      // the glyph: neither spells the plain name, so neither is rewritten.
      if (source.slice(occurrence.start, occurrence.end) !== group.name)
        continue;
      if (isNameVisibleAt(groups, spelling, occurrence.start)) continue;
      spellings.add(spelling);
      edits.push({
        start: occurrence.start,
        end: occurrence.end,
        text: spelling,
      });
    }
  }
  let text = source;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return { text, spellings };
}

const spelled = new WeakMap<
  ComputeEngine,
  Map<string, { text: string; spellings: Set<string> }>
>();

/**
 * The examples of a definition in the Epsil spelling (`epsilSpelling()`),
 * each computed once per engine. A spelling that the engine binds to
 * another definition (`let pi = 3` run on the engine) is not written, since
 * the example would then read that binding: `Sin(Pi / 6)` stays
 * `sin(Pi / 6)`. The engine's bindings are read at each call, so a binding
 * made after the first call counts. `sourceNames` holds the names that the
 * source of an editor declares where the example would be written (`let pi
 * = 3` above the cursor): a spelling among them is not written either.
 */
export function epsilExamples(
  engine: ComputeEngine,
  examples: readonly string[],
  sourceNames?: { has(name: string): boolean }
): string[] {
  let cache = spelled.get(engine);
  if (cache === undefined) {
    cache = new Map();
    spelled.set(engine, cache);
  }
  const shadowed = (spelling: string, name?: string): boolean => {
    if (sourceNames?.has(spelling)) return true;
    const def = engine.lookupDefinition(spelling);
    if (def === undefined) return false;
    const target = name ?? canonicalLibraryName(spelling);
    return target === undefined || def !== engine.lookupDefinition(target);
  };
  return examples.map((example) => {
    let entry = cache!.get(example);
    if (entry === undefined) {
      entry = spell(example, engine);
      cache!.set(example, entry);
    }
    return [...entry.spellings].some((s) => shadowed(s))
      ? spell(example, engine, shadowed).text
      : entry.text;
  });
}

/** An inline code span of Markdown: a run of backticks, the code, and a run
 * of the same length that no other backtick follows. */
const CODE_SPAN = /(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g;

/**
 * The lines of a description with each inline code span in the Epsil
 * spelling: the code of a span goes through `epsilExamples()`, so it is
 * spelled by the rules of the examples, with the same shadowing: the span
 * `Join([1, 2], 3)` becomes `join([1, 2], 3)`, and the span `Pi` becomes
 * `pi`. A span that does not parse as Epsil is left as written. A span may run
 * over two lines: the lines are joined to find the spans. A line may hold
 * line breaks of its own (a paragraph of several lines): the result has one
 * line for each line of `lines`, with the same line breaks.
 */
export function epsilDescription(
  engine: ComputeEngine,
  lines: readonly string[]
): string[] {
  const text = lines.join('\n');
  if (!text.includes('`')) return [...lines];
  const converted = text.replace(
    CODE_SPAN,
    (span, fence: string, code: string) => {
      // A double-backtick span (``` `` `Sin` `` ```) pads its code with one
      // space on each side: the padding is not part of the code.
      const padded =
        code.length > 2 && code.startsWith(' ') && code.endsWith(' ');
      const inner = padded ? code.slice(1, -1) : code;
      const spelled = epsilExamples(engine, [inner])[0];
      if (spelled === inner) return span;
      return padded
        ? `${fence} ${spelled} ${fence}`
        : `${fence}${spelled}${fence}`;
    }
  );
  // The spelling rewrites names only, so the text keeps every line break:
  // the pieces are grouped back into the lines they came from.
  const pieces = converted.split('\n');
  let next = 0;
  return lines.map((line) => {
    const count = line.split('\n').length;
    next += count;
    return pieces.slice(next - count, next).join('\n');
  });
}
