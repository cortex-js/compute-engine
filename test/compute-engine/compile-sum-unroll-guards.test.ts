import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Guards on the JavaScript target's UNROLL arm for `Sum`/`Product`.
 *
 * The unrolled form emits every term into the source, where the loop form
 * emits the body once. Two properties have to be built into the unrolled one:
 *
 * - it stops accumulating at the first NaN, instead of evaluating every
 *   remaining term to reach an answer NaN already determined;
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

  it('emits the constant list ONCE across 31 unrolled terms', () => {
    const ce = fixtureEngine();
    const r = compile(ce.parse(FIXTURE), { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    const js = source(r);
    expect(occurrences(js, /Array\.from/g)).toBe(1);
    // The single construction is a `const` in the accumulating IIFE, not a
    // term operand.
    expect(js).toMatch(/const _tv\d+ = _SYS\.bcast\(.*Array\.from/);
  });

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

  it('a Product over the same constant list also emits it once, unchanged in value', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    const expr = ce.parse('\\prod_{n=1}^{5} (x + \\mathrm{At}(K, n))');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    expect(occurrences(source(r), /Array\.from/g)).toBe(1);
    // `At(K, 1…5)` is `0, 2, 4, 6, 8`, so at `x = 1` the product is
    // `1·3·5·7·9`. The interpreter agrees.
    expect(r.run!({ x: 1 })).toBe(945);
    expect(expr.subs({ x: 1 }).evaluate().N().re).toBe(945);
  });

  it('a Sum over the same constant list keeps the interpreter value', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    const expr = ce.parse('\\sum_{n=1}^{5} (x + \\mathrm{At}(K, n))');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(occurrences(source(r), /Array\.from/g)).toBe(1);
    expect(r.run!({ x: 1 })).toBe(25);
    expect(expr.subs({ x: 1 }).evaluate().N().re).toBe(25);
  });

  it('a THREE-term sum keeps the flat chain, and with it the per-term emission', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    const r = compile(ce.parse('\\sum_{n=1}^{3} (x + \\mathrm{At}(K, n))'), {
      to: 'javascript',
      fallback: true,
    });
    expect(occurrences(source(r), /Array\.from/g)).toBe(3);
    expect(r.run!({ x: 1 })).toBe(9);
  });
});

describe('unrolled Sum/Product: accumulation stops at the first NaN', () => {
  /**
   * A five-element list. `At(K, i)` for an `i` outside `1…5` has no value, so
   * a term whose index leaves the list makes the running total NaN. Nothing
   * in the body comes from the caller, so the terms after that one are
   * unobservable and may be skipped.
   */
  function pureEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['List', 10, 20, 30, 40, 50]));
    return ce;
  }

  it('a pure Sum tests the accumulator between every pair of terms', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\sum_{n=0}^{9} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    // Ten terms leave nine gaps to test in. The test after the LAST
    // accumulation is omitted: `return` hands back the same NaN either way.
    expect(nanExits(source(r))).toBe(9);
    // `x = 4` puts every term's index at or below 4 − 0 = 4 and down to
    // 4 − 9 = −5, so the run leaves the list and the answer is NaN. The
    // interpreter, which never unrolls, agrees.
    expect(r.run!({ x: 4 })).toBeNaN();
    expect(expr.subs({ x: 4 }).evaluate().N().re).toBeNaN();
  });

  it('a pure Product does the same, accumulating with `*=`', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\prod_{n=0}^{9} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    expect(nanExits(source(r))).toBe(9);
    expect(source(r)).toMatch(/\*=/);
    expect(r.run!({ x: 4 })).toBeNaN();
    expect(expr.subs({ x: 4 }).evaluate().N().re).toBeNaN();
  });

  it('a Sum with no NaN reaches the same answer as the flat chain', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\sum_{n=0}^{4} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(nanExits(source(r))).toBe(4);
    // `x = 5` indexes 5, 4, 3, 2, 1 — the whole list, in reverse.
    expect(r.run!({ x: 5 })).toBe(150);
    expect(expr.subs({ x: 5 }).evaluate().N().re).toBe(150);
  });
});

describe('unrolled Sum/Product: caller-supplied source is never optimized around', () => {
  /**
   * A `functions` entry is stringified into the artifact, so it can count its
   * own calls, log, or mutate — and the counter has to be a global rather
   * than a captured binding to survive that stringification.
   */
  function countingSlow(): (v: number) => number {
    return (v: number) => {
      (globalThis as Record<string, unknown>).__unrollCalls =
        ((globalThis as Record<string, number>).__unrollCalls ?? 0) + 1;
      return v === 0 ? NaN : v;
    };
  }

  it('a term calling a caller function runs even after the total is NaN', () => {
    const ce = new ComputeEngine();
    ce.declare('slow', '(number) -> number');
    const r = compile(ce.parse('\\sum_{n=0}^{9} \\mathrm{slow}(x-n)'), {
      to: 'javascript',
      functions: { slow: countingSlow() },
    });
    expect(r.success).toBe(true);
    // How many times `slow` runs is observable, so the between-term exit is
    // not emitted at all: skipping terms would change what the caller sees.
    expect(source(r)).not.toMatch(NAN_EXIT);
    // The statement form itself is kept — it is what carries the hoisted
    // bindings; only the exits are dropped.
    expect(r.code).toMatch(/^\(\(\) => \{ let _tv\d+ = /);

    (globalThis as Record<string, number>).__unrollCalls = 0;
    // `x = 0` makes the FIRST term NaN, and all ten terms still run.
    expect(r.run!({ x: 0 })).toBeNaN();
    expect((globalThis as Record<string, number>).__unrollCalls).toBe(10);

    // `x = 4` makes the fifth term NaN — likewise all ten.
    (globalThis as Record<string, number>).__unrollCalls = 0;
    expect(r.run!({ x: 4 })).toBeNaN();
    expect((globalThis as Record<string, number>).__unrollCalls).toBe(10);

    // With no NaN the answer is unchanged: `Σ_{n=0}^{9} (100 − n)`.
    (globalThis as Record<string, number>).__unrollCalls = 0;
    expect(r.run!({ x: 100 })).toBe(955);
    expect((globalThis as Record<string, number>).__unrollCalls).toBe(10);
  });

  it('a Product over a caller function likewise keeps every term', () => {
    const ce = new ComputeEngine();
    ce.declare('slow', '(number) -> number');
    const r = compile(ce.parse('\\prod_{n=0}^{9} \\mathrm{slow}(x-n)'), {
      to: 'javascript',
      functions: { slow: countingSlow() },
    });
    expect(r.success).toBe(true);
    expect(source(r)).not.toMatch(NAN_EXIT);
    expect(source(r)).toMatch(/\*=/);

    (globalThis as Record<string, number>).__unrollCalls = 0;
    expect(r.run!({ x: 0 })).toBeNaN();
    expect((globalThis as Record<string, number>).__unrollCalls).toBe(10);
  });

  it('a collection operand of a caller function is built once per term', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['Multiply', 2, ['Range', 0, 100]]));
    ce.declare('pick', '(list<number>, number) -> number');
    const r = compile(ce.parse('\\sum_{n=1}^{5} \\mathrm{pick}(K, n)'), {
      to: 'javascript',
      fallback: true,
      constantFold: false,
      functions: { pick: (l: number[], i: number) => l[i - 1] },
    });
    expect(r.success).toBe(true);
    // `K` does not depend on `n`, so it looks like a textbook hoist — but the
    // caller's `pick` receives the array itself and may keep or mutate it, and
    // is free to evaluate its operand more or fewer times than once. Each
    // term therefore builds its own array, exactly as the flat chain did.
    expect(occurrences(source(r), /Array\.from/g)).toBe(5);
    expect(r.run!({})).toBe(20);
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
      // have no `Array.from` to count.
      constantFold: false,
    });
  }

  it('emits no binding that nothing refers to', () => {
    const r = fixture();
    expect(r.success).toBe(true);
    const js = source(r);
    const names = [...js.matchAll(/const (_tv\d+) = /g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    // A live binding occurs at least twice: once declaring it, once using it.
    // Listing the dead ones rather than asserting per name puts their names in
    // the failure message.
    const dead = names.filter(
      (name) => occurrences(js, new RegExp(`\\b${name}\\b`, 'g')) < 2
    );
    expect(dead).toEqual([]);
  });

  it('constructs the invariant collection exactly once', () => {
    const js = source(fixture());
    expect(occurrences(js, /Array\.from/g)).toBe(1);
  });

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

describe('unrolled Sum/Product: the flat chain survives below the threshold', () => {
  const ce = new ComputeEngine();

  it.each([
    ['\\sum_{i=1}^{2} i', '((1) + (2))'],
    ['\\sum_{i=1}^{3} i', '((1) + (2) + (3))'],
    ['\\prod_{i=1}^{2} i', '((1) * (2))'],
    ['\\prod_{i=1}^{3} i', '((1) * (2) * (3))'],
  ])('%s stays a flat chain', (latex, code) => {
    const r = compile(ce.parse(latex), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.code).toBe(code);
  });

  it('four terms is the first size that accumulates in statements', () => {
    const r = compile(ce.parse('\\sum_{i=1}^{4} i'), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.code).toBe(
      '(() => { let _tv1 = (1); if (_tv1 !== _tv1) return NaN; _tv1 += (2); ' +
        'if (_tv1 !== _tv1) return NaN; _tv1 += (3); ' +
        'if (_tv1 !== _tv1) return NaN; _tv1 += (4); return _tv1; })()'
    );
    expect(r.run!({})).toBe(10);
  });
});

/**
 * The loop arm keeps its shape — one emission of the body, a `while` over the
 * counter, no per-term statements and no hoisted bindings. What it gained is
 * the single between-iteration NaN exit, so these pin the emission verbatim
 * against both the unroll (which the range must not take) and the extra
 * statements the unroll needs.
 */
describe('the LOOP arm keeps its shape, with the NaN exit', () => {
  const ce = new ComputeEngine();

  it('a range past the unroll limit still emits the while-loop', () => {
    const r = compile(ce.parse('\\sum_{i=1}^{200} i'), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.code).toBe(
      '(() => { let _tv1 = 0; let i = 1; const _upper = 200; ' +
        'while (i <= _upper) { _tv1 += i; if (_tv1 !== _tv1) return NaN; ' +
        'i++; } return _tv1; })()'
    );
    // The body is emitted ONCE, however many iterations run.
    expect(nanExits(r.code!)).toBe(1);
    expect(r.run!({})).toBe(20100);
  });

  it('the Product loop arm has the same shape', () => {
    const r = compile(ce.parse('\\prod_{i=1}^{200} i'), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.code).toBe(
      '(() => { let _tv1 = 1; let i = 1; const _upper = 200; ' +
        'while (i <= _upper) { _tv1 *= i; if (_tv1 !== _tv1) return NaN; ' +
        'i++; } return _tv1; })()'
    );
    expect(nanExits(r.code!)).toBe(1);
  });

  it('an element-wise body takes the bcast fold loop, never the unroll', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('L', ce2.box(['List', 1, 2, 3]));
    const r = compile(ce2.parse('\\sum_{k=1}^{6} (L + k \\cdot x)'), {
      to: 'javascript',
      fallback: true,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/_SYS\.bcast/);
    expect(r.code).toMatch(/while \(/);
    // `Σ_{k=1}^{6} (L + k·x)` at `x = 1` is `6·L + 21`, element-wise.
    expect(r.run!({ x: 1 })).toEqual([27, 33, 39]);
  });
});

describe('looped Sum/Product: iteration stops at the first NaN', () => {
  /** The five-element list of the unroll cases above. */
  function pureEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['List', 10, 20, 30, 40, 50]));
    return ce;
  }

  it('a symbolic-bound Sum tests the accumulator once per iteration', () => {
    const ce = pureEngine();
    const expr = ce.parse('\\sum_{n=0}^{m} \\mathrm{At}(K, x-n)');
    const r = compile(expr, { to: 'javascript', fallback: true });
    expect(r.success).toBe(true);
    expect(source(r)).toMatch(/while/);
    // One exit, inside the loop body — not one per term, as the unroll emits.
    expect(nanExits(source(r))).toBe(1);
    expect(r.run!({ x: 4, m: 9 })).toBeNaN();
    expect(r.run!({ x: 5, m: 4 })).toBe(150);
  });

  it('a constant-bounds Sum past the unroll limit loops with the exit', () => {
    const ce = pureEngine();
    const r = compile(ce.parse('\\sum_{n=0}^{200} \\mathrm{At}(K, x-n)'), {
      to: 'javascript',
      fallback: true,
      constantFold: false,
    });
    expect(r.success).toBe(true);
    expect(source(r)).toMatch(/while/);
    expect(nanExits(source(r))).toBe(1);
    expect(r.run!({ x: 4 })).toBeNaN();
  });

  it('a Product loop accumulates with `*=` and exits the same way', () => {
    const ce = pureEngine();
    const r = compile(ce.parse('\\prod_{n=0}^{m} \\mathrm{At}(K, x-n)'), {
      to: 'javascript',
      fallback: true,
    });
    expect(r.success).toBe(true);
    expect(source(r)).toMatch(/\*=/);
    expect(nanExits(source(r))).toBe(1);
    expect(r.run!({ x: 4, m: 9 })).toBeNaN();
    expect(r.run!({ x: 5, m: 4 })).toBe(12000000);
  });

  it('a loop over a caller function keeps every iteration', () => {
    const ce = new ComputeEngine();
    ce.declare('slow', '(number) -> number');
    const r = compile(ce.parse('\\sum_{n=0}^{m} \\mathrm{slow}(x-n)'), {
      to: 'javascript',
      // A `functions` entry is stringified into the artifact, so the call
      // counter has to be a global rather than a captured binding.
      functions: {
        slow: (v: number) => {
          (globalThis as Record<string, unknown>).__unrollCalls =
            ((globalThis as Record<string, number>).__unrollCalls ?? 0) + 1;
          return v === 0 ? NaN : v;
        },
      },
    });
    expect(r.success).toBe(true);
    // How many times `slow` runs is observable, so no exit is emitted.
    expect(source(r)).not.toMatch(NAN_EXIT);

    (globalThis as Record<string, number>).__unrollCalls = 0;
    // `x = 0` makes the FIRST iteration NaN; all ten still run.
    expect(r.run!({ x: 0, m: 9 })).toBeNaN();
    expect((globalThis as Record<string, number>).__unrollCalls).toBe(10);
  });
});
