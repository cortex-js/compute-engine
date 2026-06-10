/**
 * Shared corpus and helpers for the rule-dispatch milestones
 * (FUNGRIM-PLAN-2-RULES.md M0/M2/M4).
 *
 * This module is intentionally NOT a `.test.ts` file: it is imported both by
 * `rule-dispatch-regression.test.ts` (the pre/post-index equivalence oracle)
 * and `benchmarks/rule-dispatch.benchmark.test.ts` (the scale benchmark), and
 * will be reused by later milestones (M2 differential invariant tests, M4
 * scale benchmarks).
 *
 * Design constraints:
 * - Every corpus expression is ASSUMPTION-FREE (no `ce.assume()` needed, no
 *   dependence on sign/integer assumptions) so the captured baselines are
 *   robust against the parallel REVIEW A3 work on `isLess`/`isGreater`.
 * - The corpus covers the rule families that the operator index will
 *   bucket: trig, log/exp, abs, power/radical, polynomial and rational
 *   expressions (drawn from `simplify.test.ts` and the Wester benchmark).
 */

import type { Rule } from '../../src/compute-engine';
import type { ComputeEngine } from '../../src/compute-engine';

/**
 * Expressions run through `.simplify()` and snapshotted.
 * Grouped by family; each entry is a LaTeX source string.
 *
 * IMPORTANT: snapshot names are derived from these strings. Do not reorder,
 * rename or remove entries without re-recording the M0 snapshot — additions
 * at the end of a family are safe.
 */
export const SIMPLIFY_CORPUS: ReadonlyArray<
  readonly [family: string, exprs: ReadonlyArray<string>]
> = [
  [
    'arithmetic',
    [
      '-23',
      '0.3',
      '\\frac{3}{4}',
      '\\frac{6}{8}',
      '\\frac{3}{4}+2',
      '\\frac{3}{4}+\\frac{5}{7}',
      '-1234 - 5678',
      '1.234 + 5.678',
      '2 + 4',
      '\\frac{1}{2} + 0.5',
      '\\frac{3.1}{2.8}',
      '\\frac12+\\frac13+\\frac14+\\frac15+\\frac16+\\frac17+\\frac18+\\frac19+\\frac{1}{10}',
      '\\frac{10!}{8!}',
      '0!',
      '5!',
      '\\frac{6!}{4!\\cdot 2!}',
    ],
  ],
  [
    'radicals',
    [
      '\\sqrt{3}',
      '\\sqrt{3}+3',
      '\\sqrt{3}+\\frac12',
      '\\sqrt{3} - 2',
      '\\frac{\\sqrt{5}+1}{4}',
      '\\sqrt{50}',
      '\\sqrt{12}+\\sqrt{27}',
      '\\frac{2}{\\sqrt{2}}',
      '\\sqrt{2}\\sqrt{3}',
      '(\\sqrt{2}+\\sqrt{3})^2',
      '\\sqrt{2\\sqrt{3}+4}',
      '\\sqrt{997} - (997^3)^{\\frac16}',
      '\\sqrt[3]{27}',
      '\\sqrt[4]{16}',
      '(-8)^{\\frac13}',
    ],
  ],
  [
    'polynomials',
    [
      'x+0',
      'x + x',
      'x+2x',
      '3x - 2x',
      'x - x',
      '0 \\cdot x',
      '1 \\cdot x',
      '-1 \\cdot x',
      '(-2)(-x)',
      '2(-x)',
      '-2+x',
      'x-(-1)',
      'x+(-1)',
      '2x \\times x \\times 3 \\times x',
      '2(13.1+x)',
      '2(13.1+x) - 26.2 - 2x',
      '(x+1)(x-1)',
      '(2x+1)(x-3)',
      'x^2+2x+1',
      '(x+1)^2 - x^2 - 2x - 1',
      '2\\pi x^2 - \\pi x^2 + 2\\pi',
      '\\sqrt{3}(\\sqrt{2}x + x)',
    ],
  ],
  [
    'powers',
    [
      '(x^1)^3',
      '(x^2)^3',
      '(x^2)^{-2}',
      'x^3 x^4',
      '\\frac{x^5}{x^2}',
      'x^0',
      'x^1',
      'x^{-1}',
      '\\frac{1}{x^{-2}}',
      '(x^{-2})^{-3}',
      '(xy)^2',
      '\\sqrt{x}\\sqrt{x}',
      '(\\sqrt{x})^2',
      '\\sqrt{x^2}',
      '\\sqrt{4x^2}',
      '\\sqrt[3]{x^3}',
      '2^x 2^y',
      '\\frac{2^x}{2^y}',
    ],
  ],
  [
    'rational expressions',
    [
      '\\frac{x}{x}',
      '\\frac{2x}{4}',
      '\\frac{x}{1}',
      '\\frac{0}{x}',
      '\\frac{1}{\\frac{1}{x}}',
      '\\frac{x}{\\frac{y}{2}}',
      '\\frac{1}{x}+\\frac{1}{y}',
      '\\frac{x+1}{x+1}',
      '\\frac{x^2 y}{x y^2}',
      'x/(y/2)^3',
      'x/(2/y)^3',
      'x/(\\pi/2)^3',
      '\\frac{x^2-1}{x-1}',
      '\\frac{x^2 - 4}{x^2 + 4x + 4}',
      '\\frac{a}{b}+\\frac{c}{d}',
    ],
  ],
  [
    'trigonometry',
    [
      '\\sin(0)',
      '\\cos(0)',
      '\\tan(0)',
      '\\sin(\\pi)',
      '\\cos(\\pi)',
      '\\sin(\\frac{\\pi}{2})',
      '\\cos(\\frac{\\pi}{2})',
      '\\sin(\\frac{\\pi}{6})',
      '\\cos(\\frac{\\pi}{3})',
      '\\tan(\\frac{\\pi}{4})',
      '\\sin(-x)',
      '\\cos(-x)',
      '\\tan(-x)',
      '\\sin^2(x) + \\cos^2(x)',
      '1 - \\sin^2(x)',
      '\\frac{\\sin(x)}{\\cos(x)}',
      '\\tan(x)\\cos(x)',
      '\\sec^2(x) - \\tan^2(x)',
      '\\sin(x + 2\\pi)',
      '\\cos(x + \\pi)',
      '\\sin(\\pi - x)',
      '2\\sin(x)\\cos(x)',
      '\\sin(\\arcsin(x))',
      '\\cos(\\arccos(x))',
      '\\tan(\\arctan(x))',
      '\\cot(x)\\tan(x)',
      '\\csc(x)\\sin(x)',
      '\\cosh^2(x) - \\sinh^2(x)',
      '\\sinh(-x)',
      '\\cosh(-x)',
      '\\tanh(0)',
    ],
  ],
  [
    'logarithms and exponentials',
    [
      '\\ln(1)',
      '\\ln(e)',
      '\\ln(e^2)',
      '\\log_{10}(100)',
      '\\log_{10}(1)',
      '\\log_2(8)',
      '\\ln(x)+\\ln(y)',
      '2\\ln(x) - \\ln(x)',
      '\\ln(\\frac{1}{x})',
      '\\ln(\\sqrt{x})',
      'e^0',
      'e^{\\ln(2)}',
      'e^{2\\ln(x)}',
      'e^x e^y',
      '(e^x)^2',
      '\\exp(x)\\exp(-x)',
      '10^{\\log_{10}(x)}',
      '\\log_{10}(10^x)',
      '\\ln(e^x)',
    ],
  ],
  [
    'absolute value',
    [
      '|3|',
      '|-3|',
      '|-x|',
      '|x|^2',
      '\\left|\\left|x\\right|\\right|',
      '|x^2|',
      '|2x|',
      '\\left|x\\right|\\cdot\\left|y\\right|',
      '\\frac{|x|}{|y|}',
      '|\\pi - 4|',
      '|e - 2|',
      '|\\sin(x)|',
    ],
  ],
  [
    'relational',
    ['2a < 4b', '2\\pi < 4\\pi'],
  ],
];

/** Flat list of all simplify corpus entries, in stable order. */
export const SIMPLIFY_CORPUS_FLAT: ReadonlyArray<string> =
  SIMPLIFY_CORPUS.flatMap(([, exprs]) => exprs);

/**
 * Representative equations run through `.solve('x')` and snapshotted.
 * Same stability constraints as `SIMPLIFY_CORPUS`.
 */
export const SOLVE_CORPUS: ReadonlyArray<string> = [
  '5x = 0',
  '5x - 10 = 0',
  '\\frac{x}{2} + 3 = 5',
  'ax + b = 0',
  'x^2 = 4',
  'x^2 - 16 = 0',
  '2x^2 + 4x = 0',
  'x^2 + 2x + 1 = 0',
  'x^2 - x - 6 = 0',
  'x^2 + 1 = 0',
  '(x-1)(x+2) = 0',
  'x^3 - 8 = 0',
  'x^4 - 1 = 0',
  '\\frac{1}{x} - 2 = 0',
  '\\sqrt{x} - 2 = 0',
  'e^x - 1 = 0',
  'e^{2x} - 4 = 0',
  '\\ln(x) - 1 = 0',
  '2^x - 8 = 0',
  '\\sin(x) = 0',
  '\\cos(x) = 1',
  '\\tan(x) - 1 = 0',
];

/** Number of distinct synthetic operator heads (`F0`…`F149`). */
export const SYNTHETIC_HEAD_COUNT = 150;

/** Number of synthetic rules pushed in the scale benchmark. */
export const SYNTHETIC_RULE_COUNT = 1500;

/**
 * Declare the synthetic operator heads `F0`…`F<headCount-1>` used by the
 * synthetic rules. Must be called once per engine before boxing the rules.
 */
export function declareSyntheticHeads(
  ce: ComputeEngine,
  headCount: number = SYNTHETIC_HEAD_COUNT
): void {
  for (let k = 0; k < headCount; k++)
    ce.declare(`F${k}`, '(number, number) -> number');
}

/**
 * Generate `count` synthetic, INERT pattern rules spread over `headCount`
 * distinct operator heads (`F0`…`F<headCount-1>`).
 *
 * Each rule is `F<k>(_a, <unique literal>) → _a`. Since no corpus expression
 * (and no expression produced by the standard simplification rules) ever
 * contains an `F<k>` operator, these rules can never fire: pushing them onto
 * `ce.simplificationRules` exercises pure rule-scan overhead without changing
 * any result. The heads are deliberately outside the cross-head matching
 * special cases in `match.ts` (Divide/Power/Root and the `useVariations`
 * arithmetic heads), so they remain inert under every dispatch strategy.
 *
 * Reused by later milestones (M2 differential invariant test, M4 scale
 * benchmark).
 */
export function makeSyntheticRules(
  count: number = SYNTHETIC_RULE_COUNT,
  headCount: number = SYNTHETIC_HEAD_COUNT
): Rule[] {
  const rules: Rule[] = [];
  for (let n = 0; n < count; n++) {
    const k = n % headCount;
    rules.push({
      match: [`F${k}`, '_a', 1_000_000 + n],
      replace: '_a',
      id: `synthetic-${n}`,
    });
  }
  return rules;
}
