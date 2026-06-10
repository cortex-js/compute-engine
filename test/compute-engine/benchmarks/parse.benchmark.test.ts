/**
 * Scale benchmark for the LaTeX parsing pipeline (REVIEW.md §(c), LaTeX
 * parsing performance cluster).
 *
 * Guards against re-introducing the super-linear behaviors fixed in that
 * cluster:
 *
 *   1. Tokenizer O(n²): `Tokenizer.match()` used to slice the entire
 *      remaining input for every token. With sticky regexes, tokenization
 *      is O(n): tokenizing a 10x longer input should take ~10x longer,
 *      not ~100x.
 *
 *   2. Parser per-position dictionary scans: `peekDefinitions()` used to
 *      scan all ~800 dictionary definitions (and speculatively re-parse
 *      the symbol ahead once per symbolTrigger definition) at every token
 *      position. With the indexing done at dictionary-build time, parsing
 *      a k-term expression scales roughly linearly in k.
 *
 * Machine-independent methodology (same as `performance.test.ts` and
 * `rule-dispatch.benchmark.test.ts`): we assert RATIOS between two
 * in-process measurements, never absolute milliseconds, and the budgets
 * are deliberately VERY generous so this suite never fails CI because of
 * machine load — only because of an algorithmic regression (the fixed
 * O(n²) behaviors exceeded these budgets by a wide margin).
 */

import { tokenize } from '../../../src/compute-engine/latex-syntax/tokenizer';
import { LatexSyntax } from '../../../src/compute-engine/latex-syntax/latex-syntax';

jest.setTimeout(600_000);

const MEASURED_RUNS = 5;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Median time of `MEASURED_RUNS` runs of `fn()`, in ms. */
function bench(fn: () => void, warmup = 3): number {
  for (let i = 0; i < warmup; i++) fn();
  const runs: number[] = [];
  for (let i = 0; i < MEASURED_RUNS; i++) {
    const t0 = globalThis.performance.now();
    fn();
    runs.push(globalThis.performance.now() - t0);
  }
  return median(runs);
}

/** A k-term polynomial-ish LaTeX expression */
function longSum(k: number): string {
  return Array.from({ length: k }, (_, i) => `${i + 1}x^{${i + 1}}`).join('+');
}

describe('LaTeX parsing scale benchmarks', () => {
  it('tokenizer scales ~linearly with input length (non-ASCII path)', () => {
    // Non-ASCII input forces the grapheme-array path in the tokenizer,
    // where `match()` used to do `slice(pos).join('')` — a full copy of
    // the remaining input per token (the ASCII string path was already
    // effectively linear thanks to V8's SlicedString ropes).
    const term = (i: number) => `${i + 1}θ^{${i + 1}}`;
    const small = Array.from({ length: 50 }, (_, i) => term(i)).join('+');
    const large = Array.from({ length: 500 }, (_, i) => term(i)).join('+');

    // Repeat the small input so each measured run does comparable total
    // work at both sizes (reduces timer-resolution noise).
    const tSmall = bench(() => {
      for (let i = 0; i < 10; i++) tokenize(small);
    });
    const tLarge = bench(() => tokenize(large));

    // tLarge does 1x the characters of each tSmall run, so linear scaling
    // gives a ratio of ~1. The quadratic tokenizer measured ~8x here.
    // Budget: 4x.
    const ratio = tLarge / tSmall;
    console.info(
      `tokenize: 10x50 terms=${tSmall.toFixed(2)}ms, ` +
        `1x500 terms=${tLarge.toFixed(2)}ms, ratio=${ratio.toFixed(2)} (budget 4)`
    );
    expect(ratio).toBeLessThan(4);
  });

  it('parser scales ~linearly with term count', () => {
    const syntax = new LatexSyntax();
    const small = longSum(20);
    const large = longSum(200); // 10x the terms

    // 10 small parses ≈ one large parse in total terms: linear parsing
    // gives a ratio of ~1.
    const tSmall = bench(() => {
      for (let i = 0; i < 10; i++) syntax.parse(small);
    });
    const tLarge = bench(() => syntax.parse(large));

    // Some mild super-linearity is expected (deeper trees, GC); the budget
    // is generous. The pre-fix parser was ~2-4x slower overall but still
    // roughly linear here, so this mostly guards the tokenizer-in-parser
    // path and gross algorithmic regressions.
    const ratio = tLarge / tSmall;
    console.info(
      `parse: 10x20 terms=${tSmall.toFixed(2)}ms, ` +
        `1x200 terms=${tLarge.toFixed(2)}ms, ratio=${ratio.toFixed(2)} (budget 6)`
    );
    expect(ratio).toBeLessThan(6);
  });

  it('parses a mixed corpus (throughput report, no budget)', () => {
    const syntax = new LatexSyntax();
    const corpus = [
      '2x^2+3x+1',
      'x = \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}',
      '\\sin^2\\theta+\\cos^2\\theta=1',
      '\\int_1^2\\int_0^1 x^2+y^2 dx dy',
      '\\sum_{n=1}^{\\infty} \\frac{1}{n^2}',
      '\\lim_{x \\to 0} \\frac{\\sin(x)}{x}',
      '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
      '\\{x \\in \\R \\mid x > 0\\}',
      '\\forall x, \\exists y, R(x, y)',
      'a_1x_1+a_2x_2+a_3x_3+a_4x_4+a_5x_5',
    ];
    const t = bench(() => {
      for (let i = 0; i < 20; i++) for (const s of corpus) syntax.parse(s);
    });
    console.info(
      `parse corpus: ${corpus.length} expressions x 20 = ${t.toFixed(2)}ms/run`
    );
    // Smoke assertion only: all expressions parse
    for (const s of corpus) expect(syntax.parse(s)).not.toBeNull();
  });
});
