import type { MathJsonExpression } from '../math-json/types.js';
import { operands, operator, symbol } from '../math-json/utils.js';

import type { BoxedExpression, ComputeEngine } from '../compute-engine.js';

import { canonicalLibraryName } from './library-names.js';
import { documentBindings, type BinderSite } from './occurrences.js';

//
// The resolution pass: give the Epsil spellings of the standard library
// their meaning.
//
// The parser produces the tree exactly as written: `sin(x)` is
// `["sin", "x"]` and `pi` is the symbol `pi`. This pass, run before the
// program is boxed, rewrites every FREE occurrence of a spelling to the
// canonical library name (`["Sin", "x"]`, `Pi`), in call position and in
// value position alike (`map(sin, xs)` becomes `Map(Sin, xs)`). An
// occurrence is free when nothing in the program binds the name at that
// point — no enclosing `let`, parameter, loop pattern, match pattern,
// `function`, or variable of a library call (`binderSitesOf` says which
// operands bind one) — and nothing in the ENGINE binds it either
// (an earlier notebook cell's `let mean = 5`, a host `ce.declare`). The
// scope model is the one the language server uses for rename
// (`documentBindings`), so what the server treats as one binding, this pass
// treats as one binding.
//
// Two forms are never rewritten: a verbatim spelling (`` `sin` ``), which
// names the raw symbol, and a name that spells nothing in the library.
//
// The rewrite is done in place, node by node, and keeps every node's
// `sourceOffsets`, so the diagnostics of the later phases still point at
// the source.
//

/** The name at `path` inside a raw call node, following operand indices
 * (`[1]` is the second operand, `[2, 0]` the first operand of the third). */
function symbolAtPath(
  node: MathJsonExpression,
  path: readonly number[]
): string | undefined {
  let current: MathJsonExpression | null = node;
  for (const index of path) {
    if (current === null) return undefined;
    current = operands(current)[index] ?? null;
  }
  return current === null ? undefined : (symbol(current) ?? undefined);
}

/** Whether `name` occurs in `node` as a VALUE symbol (not as a call head). */
function occursAsValue(node: MathJsonExpression | null, name: string): boolean {
  if (node === null) return false;
  if (symbol(node) === name) return true;
  const head = operator(node);
  if (head === '') return false;
  return operands(node).some((op) => occursAsValue(op, name));
}

/** Whether `name` occurs in `node` as a call head (`name(…)`). */
function occursAsHead(node: MathJsonExpression | null, name: string): boolean {
  if (node === null) return false;
  const head = operator(node);
  if (head === '') return false;
  if (head === name) return true;
  return operands(node).some((op) => occursAsHead(op, name));
}

/** The operand shapes whose direct symbol elements can name variables: the
 * `{x, 2}` of a higher-order `D`, the `[x, y]` of a `Solve`. */
const VARIABLE_GROUP_HEADS = new Set([
  'List',
  'Set',
  'Tuple',
  'Pair',
  'Triple',
]);

/**
 * The variables a raw call to a library operator binds, and where each one
 * is visible.
 *
 * Two sources, combined:
 *
 * 1. The engine's binding-site selector of the callee (`Sum`, `Integrate`,
 *    `D`, the quantifiers, `Comprehension`, `Loop`), run in its `'pre'`
 *    phase on the raw operands. A site flagged clause-local (an iterator
 *    clause) is visible in the body — every operand before the first
 *    clause — and from its own operand onward; any other site is visible in
 *    the whole call.
 * 2. The rule the engine's own `Limit` handler applies, for the operators
 *    that take a variable as a plain operand without declaring a site
 *    (`Limit(expr, x, 0)`, `Solve(eq, x)`, the `{x, 2}` order form of `D`):
 *    a symbol that is a whole operand, or a direct element of a list, set,
 *    or tuple operand, and that also occurs as a value inside ANOTHER
 *    operand of the call, is the call's variable. A name that is used as a
 *    call head anywhere in the call (`map(sin, [sin(1)])`) is a function,
 *    never a variable. Such a variable is visible in the whole call.
 *
 * The callee is looked up under its written name first (an engine binding
 * wins), then under the library name its spelling stands for — unless it
 * was written verbatim (`` `integrate`(…) ``), which names the raw symbol
 * and borrows nothing from the library. A callee that is not a library
 * operator binds nothing; so does a recovered parse the engine cannot box.
 */
export function binderSitesOf(
  ce: ComputeEngine,
  node: MathJsonExpression,
  source: string
): readonly BinderSite[] | undefined {
  const head = operator(node);
  if (head === '') return undefined;
  const offsets = (node as { sourceOffsets?: [number, number] }).sourceOffsets;
  const verbatim = offsets !== undefined && source[offsets[0]] === '`';
  const name =
    verbatim || ce.lookupDefinition(head) !== undefined
      ? head
      : (canonicalLibraryName(head) ?? head);
  const def = ce.lookupDefinition(name);
  if (def === undefined || !('operator' in def)) return undefined;

  const ops = [...operands(node)];
  const sites: BinderSite[] = [];
  const bound = new Set<string>();

  const selector = def.operator.bindingSites;
  if (selector !== undefined) {
    let boxed: BoxedExpression[] | undefined;
    try {
      boxed = ops.map((op) => ce.box(op, { form: 'raw' }));
    } catch {
      // A recovered parse can hold a node the engine refuses to box; the
      // selector then has nothing to read. The heuristic below still runs.
      boxed = undefined;
    }
    if (boxed !== undefined) {
      const found = selector(boxed, 'pre');
      const firstClause = Math.min(
        ...found.filter((site) => site.clauseLocal).map((site) => site.path[0])
      );
      for (const site of found) {
        const variable = symbolAtPath(node, site.path);
        if (variable === undefined || bound.has(variable)) continue;
        bound.add(variable);
        const own = site.path[0];
        sites.push({
          name: variable,
          operands: site.clauseLocal
            ? ops.map((_, i) => i).filter((i) => i < firstClause || i >= own)
            : 'all',
        });
      }
    }
  }

  ops.forEach((op, i) => {
    const candidates: string[] = [];
    const direct = symbol(op);
    if (direct !== null) candidates.push(direct);
    else if (VARIABLE_GROUP_HEADS.has(operator(op)))
      for (const element of operands(op)) {
        const leaf = symbol(element);
        if (leaf !== null) candidates.push(leaf);
      }
    for (const candidate of candidates) {
      if (bound.has(candidate) || candidate === '_') continue;
      const elsewhere = ops.some(
        (other, j) => j !== i && occursAsValue(other, candidate)
      );
      if (!elsewhere || ops.some((other) => occursAsHead(other, candidate)))
        continue;
      bound.add(candidate);
      sites.push({ name: candidate, operands: 'all' });
    }
  });

  return sites;
}

/**
 * Rewrite, in place, every free occurrence of a standard-library spelling
 * in `ast` to the library name it stands for. `source` is the text `ast`
 * was parsed from (the occurrence spans index into it), `ce` the engine the
 * program will run on (its bindings shadow the library). Returns `ast`.
 */
export function resolveLibraryNames(
  ast: MathJsonExpression,
  source: string,
  ce: ComputeEngine
): MathJsonExpression {
  const groups = documentBindings(ast, source, {
    binderSites: (node) => binderSitesOf(ce, node, source),
  });

  // The occurrences to rewrite, keyed by the start offset AND the name of the
  // written occurrence: one span is one occurrence (the walker dedups), and
  // the name tells a call head from a symbol node that could share its
  // start offset.
  const targets = new Map<string, string>();
  const keyOf = (start: number, name: string): string => `${start}:${name}`;
  for (const group of groups) {
    if (group.kind !== 'free') continue;
    const canonical = canonicalLibraryName(group.name);
    if (canonical === undefined) continue;
    // An engine binding of the written name — a previous cell's `let`, a
    // host declaration, a lowercase library value such as `e` or a unit —
    // shadows the spelling.
    if (ce.lookupDefinition(group.name) !== undefined) continue;
    for (const occurrence of group.occurrences) {
      // The verbatim form names the raw symbol.
      if (source[occurrence.start] === '`') continue;
      targets.set(keyOf(occurrence.start, group.name), canonical);
    }
  }
  if (targets.size === 0) return ast;

  const offsetsOf = (node: object): [number, number] | undefined =>
    (node as { sourceOffsets?: [number, number] }).sourceOffsets;

  const rewrite = (node: MathJsonExpression | null): void => {
    if (node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      // A bare array is the `["head", …]` form without metadata; the parser
      // never produces one, but a LaTeX island can. Nothing in it carries
      // offsets, so nothing in it is a target; still descend for nested
      // object nodes.
      for (const item of node) rewrite(item as MathJsonExpression);
      return;
    }
    const offsets = offsetsOf(node);
    if ('sym' in node) {
      const canonical =
        offsets === undefined
          ? undefined
          : targets.get(keyOf(offsets[0], node.sym));
      if (canonical !== undefined) node.sym = canonical;
      return;
    }
    if ('fn' in node) {
      const fn = node.fn as (MathJsonExpression | string)[];
      const head = fn[0];
      if (typeof head === 'string') {
        const canonical =
          offsets === undefined
            ? undefined
            : targets.get(keyOf(offsets[0], head));
        if (canonical !== undefined) fn[0] = canonical;
      } else rewrite(head);
      for (let i = 1; i < fn.length; i++) rewrite(fn[i] as MathJsonExpression);
      return;
    }
    if ('dict' in node) {
      for (const value of Object.values(node.dict as Record<string, unknown>))
        rewrite(value as MathJsonExpression);
    }
  };
  rewrite(ast);
  return ast;
}
