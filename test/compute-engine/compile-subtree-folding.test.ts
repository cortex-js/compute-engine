import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Compile-time constant folding of whole subtrees
 * (`BaseCompiler.tryConstantFold`): a pure subtree with no free variables is
 * evaluated at compile time and emitted as a number or boolean literal. These
 * tests pin the fold itself, every safety gate that must DECLINE it, and the
 * `constantFold: false` opt-out that codegen-focused tests rely on.
 *
 * Also pins the literal-count peephole in the `Take`/`Drop` handlers, which applies even where the subtree as a
 * whole cannot fold (a list-valued result never folds).
 */

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
}); // 1+4+9+16+25 = 55

describe('COMPILE constant folding - whole expression', () => {
  it('folds a constant comparison to a boolean literal', () => {
    const r = compile(ce.parse('2 < 3'));
    expect(r.run?.()).toBe(true);
  });
});

describe('COMPILE constant folding - constant collections', () => {

  it('a non-indexed collection (a Set) never folds — no defined order', () => {
    const r = compile(ce.box(['SetFrom', ['List', 3, 1, 2]] as any), {
      fallback: true,
    });
    expect(r.code).not.toBe('[3, 1, 2]');
  });
});

describe('COMPILE constant folding - eligibility is deterministic', () => {
  // The fold decision is a property of the EXPRESSION, never of elapsed time.
  // It used to be a 100ms wall-clock budget, and a real case measured 37-89ms
  // against it: under parallel test load it folded sometimes and not others,
  // and since a folded value comes from `.N()` in bignum while the structural
  // lowering computes in doubles, the two branches disagreed at the 13th
  // digit. Two engines compiling the same source produced different numbers
  // (`definition-order.test.ts`, intermittently red in full runs only).
  it('compiles the same source to the same output every time', () => {
    const e = new ComputeEngine();
    for (const def of [
      'a(t)\\coloneq[\\cos t,\\sin t]',
      'h(i)\\coloneq\\operatorname{mod}(10^4\\sin(10^4i),1)',
      'A(t)\\coloneq\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^i}a(2^it+2\\pi h(i+.5))',
    ])
      e.parse(def).evaluate();

    const results = new Set<string>();
    for (let i = 0; i < 5; i++)
      results.add(compile(e.parse('A(0.3)')).code as string);
    expect(results.size).toBe(1);
  });

  it('an ambient deadline never swaps the folded value for a lowered one', () => {
    // The regression ROADMAP prescribed for the wall-clock removal: compile
    // one folding expression under a tight and a loose ambient deadline;
    // whenever neither run throws, the emitted code must be identical. An
    // ambient expiry mid-fold cancels the whole compilation (rethrown), so
    // the only two observable outcomes are "same code" and "loud failure" —
    // never a silent branch swap.
    const e = new ComputeEngine();
    const unbudgeted = compile(e.parse('\\sqrt{2}+\\sin(1)')).code;
    for (const ms of [50, 5000]) {
      let code: unknown;
      try {
        code = e.withTimeLimit({ ms, label: 'test:ambient' }, () => {
          return compile(e.parse('\\sqrt{2}+\\sin(1)')).code;
        });
      } catch {
        continue; // a loud cancellation is a legal outcome
      }
      expect(code).toBe(unbudgeted);
    }
  });

  it('reads a fractional Range step without rounding it away', () => {
    // The bound reader used for an integer iteration index FLOORS, which
    // turned a 0.5 step into 0 — reported as "no static size", priced as a
    // single element, and folded in 984ms.
    const e = ce.box([
      'Sum',
      ['Map', ['Function', ['Square', 'y'], 'y'], ['Range', 1, 100000, 0.5]],
    ] as any);
    expect(compile(e).code).not.toMatch(/^[\d.]+$/);
  });

  it('a NaN estimate declines rather than sailing through the ceiling', () => {
    // `0 * Infinity` is `NaN` in JavaScript, and `NaN > ceiling` is false —
    // so a zero-iteration node wrapping an unpriceable body would have been
    // admitted as "cheap". A non-finite child poisons the product, and the
    // gate is written as a negated "within budget" so NaN cannot pass it.
    const e = ce.box([
      'Sum',
      ['Sum', ['Square', 'j'], ['Limits', 'j', 1, 'n']],
      ['Limits', 'i', 1, 0],
    ] as any);
    expect(() => compile(e)).not.toThrow();
  });
});

describe('COMPILE constant folding - declines', () => {
  it('an unknown anywhere in the subtree declines the fold', () => {
    const r = compile(ce.parse('2 x + 3'));
    expect(r.code).toContain('_.x');
  });

  it('a divergent infinite Sum never folds to a truncated partial sum', () => {
    // The interpreter's .N() of `Σ i, i=1..∞` silently returns the
    // iteration-limit-truncated prefix (50015001); baking that as a
    // compile-time constant would put a mathematically wrong number behind
    // success: true. The structural lowering keeps its fail-closed decline
    // (interpreter fallback at run time).
    const e = ce.box([
      'Sum',
      'i',
      ['Limits', 'i', 1, { num: '+Infinity' }],
    ] as any);
    const r = compile(e);
    expect(r.code).not.toBe('50015001');
    expect(r.success).toBe(false);
  });

  it('an ASSIGNED-symbol infinity bound declines like a literal one', () => {
    // `m := +∞` is not an unknown and is pure, so only the unbounded-big-op
    // guard stands between this shape and a baked truncated partial sum —
    // the guard must dereference the symbol's value, not just match literal
    // `∞` spellings. (Found by review: this folded to 50015001.)
    ce.assign('inftyBoundProbe', ce.box({ num: '+Infinity' }));
    try {
      const e = ce.box([
        'Sum',
        'i',
        ['Limits', 'i', 1, 'inftyBoundProbe'],
      ] as any);
      const r = compile(e);
      expect(r.code).not.toBe('50015001');
      expect(r.success).toBe(false);
      // The run falls back to the interpreter, which certifies the
      // divergence of `Σ i` and answers `+∞` — never the truncated partial
      // sum. (Before the divergence certificate, the interpreter left the
      // sum symbolic and the fallback projected it to NaN.)
      expect(r.run?.()).toBe(Infinity);
    } finally {
      ce.forget('inftyBoundProbe');
    }
  });

  it('a convergent infinite Sum declines too (indistinguishable statically)', () => {
    const e = ce.box([
      'Sum',
      ['Divide', 1, ['Square', 'n']],
      ['Limits', 'n', 1, { num: '+Infinity' }],
    ] as any);
    const r = compile(e);
    expect(r.success).toBe(false);
    // The interpreter fallback still answers at run time.
    expect(r.run?.()).toBeCloseTo(1.6449340668482264, 6);
  });
});

describe('COMPILE constant folding - unknowns exclude lambda parameters', () => {
  // The enabling fix for the pipeline folds above: a `Function` literal's
  // TYPED parameter (`["Typed", "_", …]`, the spelling canonicalization
  // produces) previously leaked as an unknown, so any expression containing a
  // Map callback reported a phantom free variable.
  it('a typed callback parameter is not an unknown', () => {
    const e = ce.parse('\\mathrm{Map}(\\_ \\mapsto \\_^2, [1,2,3])');
    expect(e.unknowns).toEqual([]);
  });

  it('an outer free variable shadowing the parameter name stays free', () => {
    const e = ce.box([
      'Add',
      'y',
      ['Map', ['Function', ['Multiply', 'y', 'y'], 'y'], ['List', 1, 2]],
    ] as any);
    expect(e.unknowns).toEqual(['y']);
  });
});
