import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Compile-time constant folding of whole subtrees
 * (`BaseCompiler.tryConstantFold`): a pure subtree with no free variables is
 * evaluated at compile time and emitted as a number or boolean literal. These
 * tests pin the fold itself, every safety gate that must DECLINE it, and the
 * `constantFold: false` opt-out that codegen-focused tests rely on.
 *
 * Also pins the literal-count peephole in the `Take`/`Drop` (and Python
 * `Tabulate`/`Fill`) handlers, which applies even where the subtree as a
 * whole cannot fold (a list-valued result never folds).
 */

let ce: ComputeEngine;
beforeAll(() => {
  ce = new ComputeEngine();
});

const SUM_SQUARES_1_TO_5 = [
  'Sum',
  ['Map', ['Function', ['Multiply', 'y', 'y'], 'y'], ['Range', 1, 5]],
] as const; // 1+4+9+16+25 = 55

describe('COMPILE constant folding - whole expression', () => {
  it('folds a constant collection pipeline to its value', () => {
    const e = ce.parse(
      '\\mathrm{Sum}(\\mathrm{Take}(\\mathrm{Map}(\\_ \\mapsto \\_^2, 1..20), 10))'
    );
    const r = compile(e);
    expect(r.code).toBe('385');
    expect(r.run?.()).toBe(385);
  });

  it('folds a Take-bounded infinite pipeline (lazy-stream shape)', () => {
    const e = ce.parse(
      '\\mathrm{Sum}(\\mathrm{Take}(\\mathrm{Map}(\\_ \\mapsto \\_^2, 1..\\infty), 10))'
    );
    const r = compile(e);
    expect(r.code).toBe('385');
    expect(r.run?.()).toBe(385);
  });

  it('folds a constant transcendental to the interpreter value', () => {
    // Structural lowering computes Math.sin(Math.PI/6) = 0.49999999999999994;
    // the fold bakes the interpreter's exact-argument reduction, 0.5. Compiled
    // output tracking evaluate() is the intended direction.
    const r = compile(ce.parse('\\sin(\\pi/6)'));
    expect(r.code).toBe('0.5');
    expect(r.run?.()).toBe(0.5);
  });

  it('folds a constant comparison to a boolean literal', () => {
    const r = compile(ce.parse('2 < 3'));
    expect(r.code).toBe('true');
    expect(r.run?.()).toBe(true);
  });

  it('folds on the Python target too', () => {
    const r = compile(ce.box(SUM_SQUARES_1_TO_5 as any), { to: 'python' });
    expect(r.code).toBe('55');
  });
});

describe('COMPILE constant folding - subtree inside a live expression', () => {
  it('folds the constant subtree, keeps the free variable live', () => {
    const e = ce.parse('x + \\mathrm{Sum}(\\mathrm{Map}(\\_ \\mapsto \\_^2, 1..5))');
    const r = compile(e);
    expect(r.code).toBe('_.x + 55');
    expect(r.run?.({ x: 1 })).toBe(56);
  });

  it('folds the constant subtree next to an impure draw', () => {
    // Purity gate: the Random() draw must stay a runtime draw while the
    // constant sibling folds.
    const e = ce.box(['Add', ['Random'], SUM_SQUARES_1_TO_5 as any] as any);
    const r = compile(e);
    expect(r.code).toContain('55');
    expect(r.code).toContain('drawNextRandomNumber');
    const v = r.run?.() as number;
    expect(v).toBeGreaterThanOrEqual(55);
    expect(v).toBeLessThan(56);
  });
});

describe('COMPILE constant folding - constant collections', () => {
  const MAP_SQUARES = (n: number) =>
    ['Map', ['Function', ['Square', 'y'], 'y'], ['Range', 1, n]] as const;

  it('folds a constant collection under a runtime index', () => {
    // The whole expression cannot fold (`k` is an unknown), but its BASE is
    // constant: indexing a baked array beats building the range and mapping
    // over it on every call.
    const r = compile(ce.box(['At', MAP_SQUARES(6), 'k'] as any));
    expect(r.code).toBe('_SYS.at([1, 4, 9, 16, 25, 36], _.k)');
    expect(r.run?.({ k: 3 })).toBe(9);
  });

  it('folds a bare constant collection to a literal', () => {
    const r = compile(ce.box(MAP_SQUARES(6) as any));
    expect(r.code).toBe('[1, 4, 9, 16, 25, 36]');
    expect(r.run?.()).toEqual([1, 4, 9, 16, 25, 36]);
  });

  it('folds on the Python target too', () => {
    const r = compile(ce.box(MAP_SQUARES(6) as any), { to: 'python' });
    expect(r.code).toBe('[1, 4, 9, 16, 25, 36]');
  });

  it('folds a Filter pipeline, agreeing with the interpreter', () => {
    const e = ce.box([
      'Filter',
      ['Range', 1, 10],
      ['Function', ['Equal', ['Mod', 'y', 2], 0], 'y'],
    ] as any);
    const r = compile(e);
    expect(r.code).toBe('[2, 4, 6, 8, 10]');
    expect(r.run?.()).toEqual([2, 4, 6, 8, 10]);
    expect(e.N().toString()).toBe('[2,4,6,8,10]');
  });

  it('a collection over the inline cap compiles structurally', () => {
    // 80 elements exceeds CONSTANT_FOLD_MAX_INLINE_ELEMENTS: inlining it
    // would trade a compact emission for a wall of literals.
    const r = compile(ce.box(['At', MAP_SQUARES(80), 'k'] as any));
    expect(r.code).toContain('Array.from');
    expect(r.run?.({ k: 3 })).toBe(9);
  });

  it('a non-indexed collection (a Set) never folds — no defined order', () => {
    const r = compile(ce.box(['SetFrom', ['List', 3, 1, 2]] as any), {
      fallback: true,
    });
    expect(r.code).not.toBe('[3, 1, 2]');
  });

  it('constantFold: false keeps the structural pipeline', () => {
    const r = compile(ce.box(['At', MAP_SQUARES(6), 'k'] as any), {
      constantFold: false,
    });
    expect(r.code).toContain('.map(');
    expect(r.run?.({ k: 3 })).toBe(9);
  });

  it('a folded Tuple stays a Tuple, not a List', () => {
    // A Python list is not a Python tuple — it is mutable, unhashable, and
    // `(1, 2) == [1, 2]` is `False` — so rebuilding a folded tuple through
    // the List lowering would silently change the value's type. The folded
    // emission must match the unfolded one.
    for (const mj of [['Tuple'], ['Tuple', 5], ['Tuple', 1, 2]] as any[]) {
      const e = ce.box(mj);
      const folded = compile(e, { to: 'python' }).code;
      const structural = compile(e, {
        to: 'python',
        constantFold: false,
      }).code;
      expect(folded).toBe(structural);
    }
  });

  it('a complex-ish expression with a real value does not fold', () => {
    // The structural lowering may return either shape for these — a bare
    // number, or the target's `{re, im}` convention — and nothing statically
    // readable says which. Folding either one risks silently changing the
    // shape a caller reads back, so the fold declines and the structural
    // path keeps defining it.
    const e = new ComputeEngine();
    e.declare('Qc', { signature: '(complex) -> complex' });
    e.assign(
      'Qc',
      e.box(['Function', ['Block', ['Add', 'z', ['Complex', 0, 1]]], 'z'])
    );
    const expr = e.box(['Qc', ['Complex', 1, -1]]);
    expect(expr.N().toString()).toBe('1'); // real-valued despite the type
    expect(compile(expr).code).toBe('_fn_Qc(({ re: 1, im: -1 }))');

    // The same rule keeps a real-valued `At` with a COMPLEX INDEX structural:
    // `isComplexValued` answers for the operands, so the index alone makes
    // the node look complex while the element it selects is a plain number.
    const at = ce.box(['At', ['List', 10, 20, 30], ['Complex', 1, 2]] as any);
    expect(at.N().re).toBe(10);
    expect(compile(at).code).toBe(
      '_SYS.at([10, 20, 30], ({ re: 1, im: 2 }))'
    );
  });

  it('a genuinely complex collection still folds', () => {
    const r = compile(ce.box(['Multiply', 2, ['List', ['Complex', 1, 1]]]));
    expect(r.code).toBe('[({ re: 2, im: 2 })]');
  });
});

describe('COMPILE constant folding - declines', () => {
  it('constantFold: false preserves the structural lowering', () => {
    const e = ce.parse(
      '\\mathrm{Sum}(\\mathrm{Take}(\\mathrm{Map}(\\_ \\mapsto \\_^2, 1..20), 10))'
    );
    const r = compile(e, { constantFold: false });
    expect(r.code).toContain('.reduce(');
    expect(r.run?.()).toBe(385);
  });

  it('a vars-mapped symbol stays a live input even with an engine value', () => {
    ce.assign('foldProbeVar', 3);
    try {
      const e = ce.box(['Add', 'foldProbeVar', 1]);
      const r = compile(e, { vars: { foldProbeVar: '_.foldProbeVar' } });
      expect(r.code).toBe('_.foldProbeVar + 1');
      expect(r.run?.({ foldProbeVar: 10 })).toBe(11);
    } finally {
      ce.forget('foldProbeVar');
    }
  });

  it('a caller-overridden function is not folded through', () => {
    // Folding would evaluate Gcd through the ENGINE (= 4); the caller's
    // custom implementation must win instead.
    const myGcd = function myGcd(): number {
      return 99;
    };
    const r = compile(ce.box(['Gcd', 8, 12]), { functions: { Gcd: myGcd } });
    expect(r.run?.()).toBe(99);
  });

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
      // The structural lowering's own non-finite trip-count guard then
      // answers NaN at run time (its documented projection) — never the
      // truncated partial sum.
      expect(r.run?.()).toBeNaN();
    } finally {
      ce.forget('inftyBoundProbe');
    }
  });

  it('a reused direct target does not retain a stale constantFold', () => {
    // The direct-target route stamps per-call state onto the caller's target;
    // an omitted option must RESET the folding choice to the default
    // (enabled), not inherit the previous call's `false`.
    const target = ce.getCompilationTarget('javascript')!.createTarget();
    const e = ce.box(SUM_SQUARES_1_TO_5 as any);
    const r1 = compile(e, { target, constantFold: false });
    expect(r1.code).toContain('.reduce(');
    const r2 = compile(e, { target });
    expect(r2.code).toBe('55');
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

  it('a capture-set request (symbolDeps) declines all folding', () => {
    // The implicit-compilation cache is keyed on the capture set; a fold
    // consults engine state transitively with no per-read hook, so folding
    // under a capture request would under-report dependencies and let the
    // cache serve a baked constant after a reassignment. The whole unit
    // compiles structurally instead.
    const deps = new Set<string>();
    const r = compile(ce.box(SUM_SQUARES_1_TO_5 as any), { symbolDeps: deps });
    expect(r.code).toContain('.reduce(');
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

describe('COMPILE Take/Drop - literal count peephole', () => {
  // A compile-time-constant COUNT is normalized (clamped to ≥ 0, rounded —
  // the interpreter's `toInteger` contract) and emitted as a bare literal.
  //
  // The peephole is what these pin, so the constant-collection cases compile
  // with `constantFold: false`: over a CONSTANT collection the whole slice
  // now folds to its result (`Take([1,2,3,4], 2)` → `[1, 2]`), which would
  // leave the peephole itself untested. It still governs every slice of a
  // RUNTIME collection — the case the last two tests cover without the
  // opt-out.
  const NO_FOLD = { constantFold: false } as const;

  it('emits a bare literal count', () => {
    const r = compile(ce.box(['Take', ['List', 1, 2, 3, 4], 2]), NO_FOLD);
    expect(r.code).toBe('([1, 2, 3, 4]).slice(0, 2)');
    expect(r.run?.()).toEqual([1, 2]);
  });

  it('rounds a fractional literal count like the interpreter', () => {
    // Take([1,2,3,4], 5/2) keeps 3 elements (toInteger rounds).
    const r = compile(
      ce.box(['Take', ['List', 1, 2, 3, 4], ['Divide', 5, 2]]),
      NO_FOLD
    );
    expect(r.code).toBe('([1, 2, 3, 4]).slice(0, 3)');
  });

  it('clamps a negative literal count to 0', () => {
    const r = compile(ce.box(['Take', ['List', 1, 2, 3], -2]), NO_FOLD);
    expect(r.code).toBe('([1, 2, 3]).slice(0, 0)');
    expect(r.run?.()).toEqual([]);
  });

  it('keeps the runtime guard for a non-constant count', () => {
    const r = compile(ce.box(['Take', ['List', 1, 2, 3, 4], 'n']));
    expect(r.code).toBe(
      '([1, 2, 3, 4]).slice(0, Math.max(0, Math.round(_.n)))'
    );
    expect(r.run?.({ n: 2.5 })).toEqual([1, 2, 3]);
  });

  it('Drop emits a bare literal count', () => {
    const r = compile(ce.box(['Drop', ['List', 1, 2, 3, 4], 2]), NO_FOLD);
    expect(r.code).toBe('([1, 2, 3, 4]).slice(2)');
    expect(r.run?.()).toEqual([3, 4]);
  });

  it('a constant slice folds to its result outright', () => {
    // The peephole's own inputs are constant, so by default the whole
    // expression folds — the emission the four tests above opt out of.
    expect(compile(ce.box(['Take', ['List', 1, 2, 3, 4], 2])).code).toBe(
      '[1, 2]'
    );
    expect(compile(ce.box(['Drop', ['List', 1, 2, 3, 4], 2])).code).toBe(
      '[3, 4]'
    );
  });
});

describe('COMPILE Python counts - rounding parity', () => {
  it('Take rounds a fractional literal count (was truncated)', () => {
    const r = compile(
      ce.box(['Take', ['List', 1, 2, 3, 4], ['Divide', 5, 2]]),
      { to: 'python', constantFold: false }
    );
    expect(r.code).toBe('[1, 2, 3, 4][:3]');
  });

  it('Take guards a runtime count with round-half-up, not int()', () => {
    const r = compile(ce.box(['Take', ['List', 1, 2, 3, 4], 'n']), {
      to: 'python',
    });
    expect(r.code).toBe('[1, 2, 3, 4][:max(0, int(np.floor((n) + 0.5)))]');
  });

  it('Tabulate emits a bare literal dimension', () => {
    const r = compile(
      ce.box(['Tabulate', ['Function', ['Multiply', 'y', 2], 'y'], 3]),
      { to: 'python', constantFold: false }
    );
    expect(r.code).toContain('range(3)');
    expect(r.code).not.toContain('round');
  });
});
