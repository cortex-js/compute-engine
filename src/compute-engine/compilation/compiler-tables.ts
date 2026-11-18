// The constant tables that the profile `ir` and the interpreter fallback
// read: the sets of operator heads that a rule applies to, a fold limit,
// and the color spaces.

import type { CompiledColorSpace } from './types.js';

/**
 * The color space each of the interpreter's five typed color heads names.
 *
 * The heads are the ones `library/colors.ts` builds after `.evaluate()`, and
 * their operand order is the channel order of the space they name — sRGB
 * `r, g, b` in 0-1 for `Rgb`, `h, s, v` for `Hsv`, and so on — which is
 * exactly the `c0, c1, c2` layout of a compiled color value.
 */
export const INTERPRETED_COLOR_SPACES: Readonly<
  Record<string, CompiledColorSpace>
> = {
  Rgb: 'rgb',
  Hsv: 'hsv',
  Hsl: 'hsl',
  Oklab: 'oklab',
  Oklch: 'oklch',
};

/**
 * The interpreter's typed color head for each color space a compiled color
 * value can carry — the inverse of {@link INTERPRETED_COLOR_SPACES}.
 *
 * It is what lets the interpreter fallback CONSUME a color: a color a
 * compiled runner produced, handed back in as a `vars` value, boxes to the
 * head that names its space with its channels as operands.
 */
export const COLOR_SPACE_HEADS: Readonly<Record<CompiledColorSpace, string>> = {
  rgb: 'Rgb',
  hsv: 'Hsv',
  hsl: 'Hsl',
  oklab: 'Oklab',
  oklch: 'Oklch',
};

/**
 * Largest EXPANDED node count a symbol's assigned value may have before
 * `tryFoldKnownSymbol` refuses to bake it into the generated source.
 *
 * The generated source is text, so a folded value that mentions the same
 * sub-value from several places is written out once per PATH, not once per
 * distinct node. A value that is a small shared graph can therefore emit an
 * enormous program: the `f(n+1) = f(n) + 2 f(n)` tower grows by three
 * distinct nodes per level while its emission quadruples. That is why the
 * measure here is the expanded (per-path) node count computed by
 * `expandedFoldSize`, and not the number of distinct nodes — no
 * distinct-node cap can separate the two classes.
 *
 * Calibrated from both sides on the JavaScript target, by instrumenting
 * this guard and reading the size of every fold performed:
 * - Legitimate side: across sixteen compile test suites (1149 tests,
 *   including `compile.test.ts`, `compile-assigned-symbol.test.ts`,
 *   `compile-subtree-folding.test.ts` and `compile-cse.test.ts`) the largest
 *   fold performed was 4 expanded nodes. A deliberately oversized ordinary
 *   value — a symbol assigned a 60-term polynomial — expands to 297 nodes
 *   and emits 1.5 KB, so the limit sits 5000x above what the corpus does
 *   and about 67x above a value already far larger than anything measured.
 * - Pathological side: the tower above expands to 4·2^n − 3 nodes and emits
 *   about three characters per expanded node. Depth 12 (16 381 nodes, 49 KB
 *   of source, ~8 s) is the deepest level still folded; depth 13 (32 765) is
 *   refused, and depth 14 (65 533 nodes, 197 KB, ~17 s) is already past the
 *   point where the compile visibly stalls, quadrupling with every level
 *   after it.
 * The limit therefore caps a single fold at roughly 60 KB of generated
 * source.
 *
 * On a target that can bind a folded value once as a shared local
 * (`bindsFoldedValue` — the JavaScript-family targets), the sharing is
 * removed rather than bounded: a symbol's compound pure value is emitted
 * ONCE in the preamble (`const _val_f = …;`) and every reference reads that
 * name, so the tower above emits three nodes per level. The size walk
 * charges what the emitter then actually writes — each bound value once,
 * each reference to it as one node — and this limit applies to that total.
 */
export const MAX_FOLD_EXPANDED_NODES = 20_000;

/**
 * Structural / control-flow heads that `compileExpr` special-cases directly
 * (their own bespoke lowering — loops, conditionals, blocks, sequences,
 * bindings). A user operator definition's custom `compile` handler does NOT
 * override these: their compilation is not a simple operand-wise call and a
 * handler cannot express it. Every OTHER head — including operator-mapped
 * arithmetic/relational heads and function-mapped heads — IS overridable by
 * a custom handler (see the handler consult in `compileExpr`, finding A5).
 */
export const CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
  'Sequence',
  'Sum',
  'Product',
  'Function',
  'Declare',
  'Assign',
  'Return',
  'Break',
  'Continue',
  'Loop',
  'Comprehension',
  'If',
  'Which',
  'Match',
  'Block',
]);

/**
 * The control-flow heads a custom per-operator `compile` handler MAY
 * override after all — the carve-out from the `CONTROL_FLOW_HEADS` guard
 * (Tycho item 180). `Which` qualifies because it has no binding structure:
 * its operands are plain condition/value pairs a handler can compile
 * operand-wise through the callback it is given, unlike a `Sum` index or
 * a `Function` parameter list. The handler keeps the standard
 * decline-falls-back contract — returning `undefined`/`null`/`''` falls
 * through to the bespoke `Which` lowering below — and the override is
 * per-engine (definition lookup), not process-global like a target
 * function-table entry. Extend deliberately: any head added here must not
 * bind variables, or the handler cannot see the binding structure its
 * lowering must respect.
 */
export const OVERRIDABLE_CONTROL_FLOW_HEADS: ReadonlySet<string> = new Set([
  'Which',
]);
