import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Guards on the JavaScript target's UNROLL arm for `Sum`/`Product`.
 *
 * The unrolled form emits every term into the source, where the loop form
 * emits the body once. Two properties have to be built into the unrolled one:
 *
 * - it stops accumulating at the first NaN, instead of evaluating every
 *   remaining term to reach an answer NaN already determined — when a term
 *   can be NaN at all. The exit is an optimization, not a correctness device
 *   (NaN absorbs both `+` and `*`), so a body whose type is a `real` subtype
 *   and whose terms name no NaN gets none;
 * - a subexpression whose value does not depend on the index is emitted once,
 *   instead of once per term.
 *
 * Both take a sequence of statements to express, so they apply from
 * `UNROLL_STATEMENT_MIN_TERMS` terms on; below that the flat `a + b + c` chain
 * is kept. The second is intrinsic to looping and so is the loop form's for
 * free; the first was NOT — only the element-wise fold path carried a NaN
 * exit, as a shape-mismatch latch — and the last group covers the scalar loop
 * arm now carrying it too, for the same reason and under the same gate. Its
 * trip count is large or symbolic (that is when the arm is reached at all), so
 * iterating on past a NaN total costs more than the unrolled form ever did.
 */

/** The emitted artifact, preamble included. */
function source(r: { preamble?: string; code?: string }): string {
  return (r.preamble ?? '') + (r.code ?? '');
}

function occurrences(text: string, needle: RegExp): number {
  return (text.match(needle) ?? []).length;
}

/** The between-term NaN exit: `if (_tvN !== _tvN) return NaN;`. */
const NAN_EXIT = /if \((_tv\d+) !== \1\) return NaN;/;

/** How many between-term NaN exits `text` contains. */
function nanExits(text: string): number {
  return occurrences(text, new RegExp(NAN_EXIT.source, 'g'));
}

describe('unrolled Sum/Product: a constant collection is emitted once', () => {
  /**
   * The reported shape: a sinc-weighted lookup into `R`, a list derived from a
   * constant `Range`. `R` is the same array in all 31 terms — the index only
   * reaches the `At` position — so the array construction belongs outside the
   * accumulation.
   */
  function fixtureEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign(
      'R',
      ce.box([
        'Mod',
        ['Multiply', 10000, ['Sin', ['Multiply', 10000, ['Range', 0, 100]]]],
        1,
      ])
    );
    ce.assign('s', ce.parse('x \\mapsto \\frac{\\sin(\\pi x)}{\\pi x}'));
    return ce;
  }

  const FIXTURE =
    '\\sum_{n=-15}^{15} s(\\operatorname{mod}(5x,1)-n)\\cdot ' +
    '\\mathrm{At}(R, 5x+50+n)';

  it('returns the same values as the flat-chain emission did', () => {
    // Captured from the pre-fix emission (the flat `+` chain): every sample is
    // NaN, because `At` on the fractional index `5x + 50 + n` has no value.
    // That is the state the fix has to preserve exactly — it is a
    // short-circuit, not a change of answer.
    const ce = fixtureEngine();
    const expr = ce.parse(FIXTURE);
    const r = compile(expr, { to: 'javascript', fallback: true });
    for (const x of [0.31, 0.5, 0.2, 1.234, 2]) expect(r.run!({ x })).toBeNaN();
    // NaN is only the right answer if the interpreter reaches it too — a
    // compiled artifact that agrees with nothing but itself would pin a bug
    // as well as a fix. At `x = 2` the interpreter's own numeric evaluation
    // reduces the sum all the way, so its verdict is directly comparable.
    expect(expr.subs({ x: 2 }).evaluate().N().re).toBeNaN();
  });

});

describe('unrolled Sum/Product: a read of a list of integers gets no NaN exit', () => {
  /**
   * A five-element list. `At(K, i)` for an `i` outside `1…5` has no value, so
   * a term whose index leaves the list makes the running total NaN. The read
   * is typed `integer`: the marker of an absent read is implicit in a result
   * type (`docs/ERROR-MODEL.md`, "`Missing` is a result only"). A body whose
   * type is a `real` subtype gets no between-term NaN exit, so every term is
   * evaluated. The exit is an optimization only: NaN absorbs `+` and `*`,
   * and the value is the same.
   */
  function pureEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['List', 10, 20, 30, 40, 50]));
    return ce;
  }

  it('a pure Sum accumulates every term with no test between them', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\sum_{n=0}^{9} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    expect(nanExits(source(r))).toBe(0);
    // `x = 4` puts every term's index at or below 4 − 0 = 4 and down to
    // 4 − 9 = −5, so the run leaves the list and the answer is NaN. The
    // interpreter, which never unrolls, agrees.
    expect(r.run!({ x: 4 })).toBeNaN();
    expect(expr.subs({ x: 4 }).evaluate().N().re).toBeNaN();
  });

  it('a Sum with no NaN reaches the same answer as the flat chain', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\sum_{n=0}^{4} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(nanExits(source(r))).toBe(0);
    // `x = 5` indexes 5, 4, 3, 2, 1 — the whole list, in reverse.
    expect(r.run!({ x: 5 })).toBe(150);
    expect(expr.subs({ x: 5 }).evaluate().N().re).toBe(150);
  });
});

describe('unrolled Sum/Product: a multi-index unroll binds each invariant once', () => {
  /**
   * `Sum(body, Limits(i,…), Limits(j,…))` — ONE Sum with two clauses, not two
   * nested Sums — unrolls the first clause and compiles the second afresh
   * inside each of its terms. Both levels walk the SAME body tree, so the
   * outer level's hoist has to be visible to the inner one: `Take(K, 20)` is
   * bound once, and `K` — the collection it wraps, itself index-free and so
   * hoistable on its own — must not be bound again underneath it. The outer
   * binding emits as a name, and a name's emission never reaches its
   * operands, so any binding minted below it is code nothing can reference.
   */
  const NESTED = [
    'Sum',
    ['Multiply', 'x', ['At', ['Take', 'K', 20], ['Add', 'i', 'j']]],
    ['Limits', 'i', 1, 4],
    ['Limits', 'j', 1, 4],
  ];

  function fixture(): ReturnType<typeof compile> {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    return compile(ce.box(NESTED as never), {
      to: 'javascript',
      fallback: true,
      // Keep the collection an expression: folded to a literal array it would
      // have no `_SYS.range` call to count.
      constantFold: false,
    });
  }

  it('keeps the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    const expr = ce.box(NESTED as never);
    // `At(Take(K, 20), k)` is `2(k − 1)`, so the double sum is
    // `Σ_{i,j=1}^{4} 2(i + j − 1)` = 128 at `x = 1`.
    expect(fixture().run!({ x: 1 })).toBe(128);
    expect(expr.subs({ x: 1 }).evaluate().N().re).toBe(128);
  });
});

