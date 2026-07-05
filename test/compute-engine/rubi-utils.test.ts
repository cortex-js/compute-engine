// Regression tests for the Rubi predicate/utility layer
// (scripts/rubi/rubi-utils.ts): the BinomialParts/TrinomialParts predicate
// families, the IntBinomialQ/IntQuadraticQ gates, PolyQ[u, x^k] semantics,
// and the RtAux principal-branch root rendering. See docs/rubi/RUBI.md.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  evalCondition,
  build,
  containsHyperbolic,
  expandHyperbolicToExp,
  foldLnExponentialE,
  deactivateTrig,
  activateTrig,
  cofunctionShift,
  standaloneCosineShift,
  expandTrigToExp,
  sinCosArgNonlinearExpandableQ,
  numericallyEvaluable,
} from '../../src/compute-engine/rubi/rubi-utils';
import { loadIntegrationRules } from '../../src/integration-rules';
import type { Ctx } from '../../src/compute-engine/rubi/rubi-utils';
import type { Json } from '../../scripts/rubi/wl-parser';

let ce: ComputeEngine;
let ctx: Ctx;

beforeAll(() => {
  ce = new ComputeEngine();
  ctx = {
    ce,
    env: new Map<string, Expression>(),
    x: 'x',
    hooks: { int: () => null },
  };
});

const bind = (name: string, expr: Json): void => {
  ctx.env.set(name, ce.expr(expr as any));
};
const cond = (json: Json): boolean => evalCondition(json, ctx);

describe('binomial/trinomial form predicates', () => {
  beforeAll(() => {
    bind('bin4', ['Add', 3, ['Multiply', 2, ['Power', 'x', 4]]]);
    bind('binSym', ['Add', 3, ['Multiply', 2, ['Power', 'x', 'm']]]);
    bind('quad', ['Add', 1, 'x', ['Power', 'x', 2]]);
    bind('tri4', ['Add', 1, ['Power', 'x', 2], ['Power', 'x', 4]]);
    bind('prodBin', [
      'Multiply',
      ['Add', 1, 'x'],
      ['Subtract', 1, 'x'],
    ]);
    bind('sqBin', ['Power', ['Add', 1, ['Power', 'x', 3]], 2]);
    bind('genBin', [
      'Add',
      ['Multiply', 2, ['Power', 'x', 3]],
      ['Multiply', 5, 'x'],
    ]);
    bind('genTri', [
      'Add',
      'x',
      ['Multiply', 3, ['Power', 'x', 3]],
      ['Multiply', 2, ['Power', 'x', 5]],
    ]);
  });

  test('BinomialQ', () => {
    expect(cond(['BinomialQ', 'bin4', 'x'])).toBe(true);
    expect(cond(['BinomialQ', 'bin4', 'x', 4])).toBe(true);
    expect(cond(['BinomialQ', 'bin4', 'x', 3])).toBe(false);
    expect(cond(['BinomialQ', 'binSym', 'x'])).toBe(true); // symbolic degree
    expect(cond(['BinomialQ', 'quad', 'x'])).toBe(false);
    // equivalent-after-expansion binomial (Rubi polynomial branch)
    expect(cond(['BinomialQ', 'prodBin', 'x'])).toBe(true);
  });

  test('QuadraticQ and TrinomialQ', () => {
    expect(cond(['QuadraticQ', 'quad', 'x'])).toBe(true);
    expect(cond(['QuadraticQ', 'bin4', 'x'])).toBe(false);
    expect(cond(['TrinomialQ', 'tri4', 'x'])).toBe(true);
    // quadratics and squares of binomials are excluded by TrinomialQ
    expect(cond(['TrinomialQ', 'quad', 'x'])).toBe(false);
    expect(cond(['TrinomialQ', 'sqBin', 'x'])).toBe(false);
  });

  test('generalized forms', () => {
    expect(cond(['GeneralizedBinomialQ', 'genBin', 'x'])).toBe(true);
    expect(cond(['GeneralizedTrinomialQ', 'genTri', 'x'])).toBe(true);
    expect(cond(['GeneralizedBinomialQ', 'bin4', 'x'])).toBe(false);
  });

  test('MatchQ variants are structural (no expansion)', () => {
    expect(cond(['BinomialMatchQ', 'bin4', 'x'])).toBe(true);
    // (1+x)(1−x) is binomial-equivalent but not in binomial FORM —
    // this gate is what lets the 1.4.2 normalization rules fire
    expect(cond(['BinomialMatchQ', 'prodBin', 'x'])).toBe(false);
    expect(cond(['QuadraticMatchQ', 'quad', 'x'])).toBe(true);
    expect(cond(['TrinomialMatchQ', 'tri4', 'x'])).toBe(true);
  });
});

describe('PolyQ second-argument semantics', () => {
  test('PolyQ[u, x^k] requires exponents divisible by k', () => {
    bind('pq1', ['Add', 1, ['Power', 'x', 2], ['Power', 'x', 4]]);
    bind('pq2', ['Subtract', ['Multiply', -2, 'b'], ['Multiply', 'k', 'x']]);
    expect(cond(['PolyQ', 'pq1', ['Power', 'x', 2]])).toBe(true);
    // −2b − k·x has an x¹ term: NOT a polynomial in x². (Treating it as
    // one made 1.1.2.11#4 drop ArcTanh terms — 1.1.1.6 #19/#38/#39.)
    expect(cond(['PolyQ', 'pq2', ['Power', 'x', 2]])).toBe(false);
    expect(cond(['PolyQ', 'pq2', 'x'])).toBe(true);
    // degree in x^k units
    expect(cond(['PolyQ', 'pq1', ['Power', 'x', 2], 2])).toBe(true);
    expect(cond(['PolyQ', 'pq1', ['Power', 'x', 2], 1])).toBe(false);
  });
});

describe('integrability gates', () => {
  test('IntBinomialQ dispatches on arity', () => {
    // [a,b,c,n,m,p,x]: IGtQ[p,0]
    expect(cond(['IntBinomialQ', 'a', 'b', 'c', 2, 'm', 2, 'x'])).toBe(true);
    expect(cond(['IntBinomialQ', 'a', 'b', 'c', 2, 'm', 'p', 'x'])).toBe(
      false
    );
    // [a,b,c,d,n,p,q,x]: IntegersQ[p,q]
    expect(
      cond(['IntBinomialQ', 'a', 'b', 'c', 'd', 3, 1, 2, 'x'])
    ).toBe(true);
  });

  test('IntQuadraticQ', () => {
    expect(
      cond(['IntQuadraticQ', 'a', 'b', 'c', 'd', 'e2', 'm', 3, 'x'])
    ).toBe(true);
    expect(
      cond(['IntQuadraticQ', 'a', 'b', 'c', 'd', 'e2', 'm', 'p', 'x'])
    ).toBe(false);
  });
});

describe('EqQ/NeQ arity', () => {
  // Rubi defines both the binary form EqQ[u,v] := PossibleZeroQ[u-v] and the
  // unary form EqQ[u] := PossibleZeroQ[u]. The unary form appears in the
  // corpus (1.2.1.4#11 NeQ[e²−4df], 1.2.4.2#4 EqQ[m+1/2]) and previously
  // crashed the driver with "json is not iterable" (build(undefined)).
  test('binary EqQ/NeQ compare two operands', () => {
    expect(cond(['EqQ', 2, 2])).toBe(true);
    expect(cond(['EqQ', 2, 3])).toBe(false);
    expect(cond(['NeQ', 2, 3])).toBe(true);
    expect(cond(['NeQ', 2, 2])).toBe(false);
  });

  test('unary EqQ/NeQ compare against zero', () => {
    expect(cond(['EqQ', ['Subtract', 4, 4]])).toBe(true);
    expect(cond(['EqQ', ['Subtract', 4, 3]])).toBe(false);
    expect(cond(['NeQ', ['Subtract', 4, 3]])).toBe(true);
    expect(cond(['NeQ', ['Subtract', 4, 4]])).toBe(false);
    // does not throw on the single-argument shape
    expect(() => cond(['NeQ', ['Power', 'e_var', 2]])).not.toThrow();
  });
});

describe('sqrt-form predicates', () => {
  test('NiceSqrtQ tests even-power structure, not the folded root', () => {
    // CE soundly keeps √(b²) unfolded; NiceSqrtQ must still see "nice"
    expect(cond(['NiceSqrtQ', ['Power', 'b', 2]])).toBe(true);
    expect(cond(['NiceSqrtQ', 'b'])).toBe(false);
    expect(cond(['NiceSqrtQ', 4])).toBe(true);
    expect(cond(['NiceSqrtQ', -4])).toBe(false);
    expect(
      cond(['NiceSqrtQ', ['Multiply', 4, ['Power', 'b', 2]]])
    ).toBe(true);
    expect(
      cond(['NiceSqrtQ', ['Multiply', 2, ['Power', 'b', 2]]])
    ).toBe(false);
  });

  test('SimplerSqrtQ', () => {
    expect(cond(['SimplerSqrtQ', 4, 9])).toBe(true);
    expect(cond(['SimplerSqrtQ', 9, 4])).toBe(false);
    expect(cond(['SimplerSqrtQ', 4, 'b'])).toBe(true);
  });
});

describe('Rt — RtAux principal-branch rendering', () => {
  const rt = (u: Json, n: number): string =>
    build(['Rt', u, n] as Json, ctx).toString();

  test('quotient roots split over numerator and denominator', () => {
    // Rt[b/(b·c−a·d), 4] → b^(1/4)·(bc−ad)^(−1/4), NOT the root of the
    // whole quotient — the split is what lets the EllipticF amplitude
    // and prefactor phases cancel (1.1.1.2#1711 e^{iπ/4} cluster)
    bind('rad', [
      'Divide',
      'b',
      ['Subtract', ['Multiply', 'b', 'c'], ['Multiply', 'a', 'd']],
    ]);
    const r = rt('rad', 4);
    expect(r).toContain('root(4)(b)');
    expect(r).not.toContain('root(4)(b /');
  });

  test('odd roots pull negative-form sign out', () => {
    expect(build(['Rt', -8, 3] as Json, ctx).toString()).toBe('-2');
  });

  test('no runaway recursion on nested quotients', () => {
    // 1/(d·(a − bc/d)) used to regenerate itself through canonical mul
    bind('cyc', [
      'Divide',
      1,
      [
        'Multiply',
        'd',
        ['Add', 'a', ['Negate', ['Divide', ['Multiply', 'b', 'c'], 'd']]],
      ],
    ]);
    expect(() => build(['Rt', 'cyc', 4] as Json, ctx)).not.toThrow();
  });
});

describe('reverse chain rule — DerivativeDivides (4.7.5 #64–#67)', () => {
  // Rules pass ActivateTrig[y]/ActivateTrig[u]; pass active heads directly.
  const dd = (y: Json, u: Json): Expression =>
    build(['DerivativeDivides', y, u, 'x'] as Json, ctx);

  test('D(sin)=cos divides cos → 1 (∫cos·sin^m)', () => {
    expect(dd(['Sin', 'x'], ['Cos', 'x']).isSame(1)).toBe(true);
  });

  test('D(tan)=sec² divides sec² → 1 (∫sec²·tan^m)', () => {
    expect(dd(['Tan', 'x'], ['Power', ['Sec', 'x'], 2]).isSame(1)).toBe(true);
  });

  test('the wrong AC split returns the False symbol (not RuleFail)', () => {
    // y=cos, u=sin⁴: u/D(cos) = sin⁴/(−sin) = −sin³, not free of x
    expect(dd(['Cos', 'x'], ['Power', ['Sin', 'x'], 4]).symbol).toBe('False');
  });

  test('a bare linear y (a·x) is declined → False', () => {
    expect(dd(['Multiply', 2, 'x'], ['Cos', 'x']).symbol).toBe('False');
  });
});

describe('FunctionOfTrig (gates the universal substitution rule 4.7.5#83)', () => {
  const fot = (u: Json): Expression =>
    build(['FunctionOfTrig', u, 'x'] as Json, ctx);

  test('non-trig integrands are False (so #83 cannot fire on them)', () => {
    expect(fot(['Power', 'x', 4]).symbol).toBe('False');
    expect(fot(['Add', 1, ['Power', 'x', 2]]).symbol).toBe('False');
  });

  test('a function of trig of a single linear arg returns that argument', () => {
    expect(fot(['Multiply', ['Cos', 'x'], ['Power', ['Sin', 'x'], 4]]).symbol)
      .toBe('x');
    expect(fot(['Power', ['Tan', 'x'], 3]).symbol).toBe('x');
  });

  test('trig mixed with a non-trig function of x is False', () => {
    expect(fot(['Multiply', ['Sin', 'x'], ['Power', 'x', 2]]).symbol).toBe(
      'False'
    );
  });
});

describe('pure-trig substitution — FunctionOfQ + SubstFor (4.7.5 #15–#34)', () => {
  // The rules pass active trig substitution targets (Sin[x], Tan[x], …).
  const foq = (v: Json, u: Json): boolean =>
    cond(['FunctionOfQ', v, u, 'x', 'True'] as Json);

  test('FunctionOfQ accepts a pure function of the substitution trig', () => {
    expect(foq(['Sin', 'x'], ['Divide', 1, ['Add', 1, ['Power', ['Sin', 'x'], 2]]])).toBe(true);
    expect(foq(['Tan', 'x'], ['Power', ['Tan', 'x'], 3])).toBe(true);
  });

  test('FunctionOfQ rejects an impure integrand (other trig present)', () => {
    // 1/(1+cos²) is not a pure function of sin
    expect(foq(['Sin', 'x'], ['Divide', 1, ['Add', 1, ['Power', ['Cos', 'x'], 2]]])).toBe(false);
    // a bare x is not a function of the trig
    expect(foq(['Sin', 'x'], ['Multiply', 'x', ['Sin', 'x']])).toBe(false);
  });

  test('SubstFor replaces the trig variable, leaving a function of x', () => {
    // SubstFor[1, Sin[x], 1/(1+sin²), x] → 1/(1+x²)
    const r = build(
      ['SubstFor', 1, ['Sin', 'x'], ['Divide', 1, ['Add', 1, ['Power', ['Sin', 'x'], 2]]], 'x'] as Json,
      ctx
    );
    expect(r.has('x')).toBe(true);
    expect(r.isSame(ce.box(['Divide', 1, ['Add', 1, ['Power', 'x', 2]]]))).toBe(true);
  });

  test('SubstFor for the tangent target maps tan → x', () => {
    // SubstFor[1, Tan[x], tan³, x] → x³
    const r = build(['SubstFor', 1, ['Tan', 'x'], ['Power', ['Tan', 'x'], 3], 'x'] as Json, ctx);
    expect(r.isSame(ce.box(['Power', 'x', 3]))).toBe(true);
  });
});

describe('hyperbolic → exponential expansion (Chapter 6, ExpandTrigReduce)', () => {
  // numeric equality at sample points (the expansion is an exact rewrite, so it
  // must agree with the original everywhere it is defined)
  const sameNumerically = (a: Expression, b: Expression): boolean => {
    for (const xv of [0.3, 0.7, 1.2]) {
      const av = a.subs({ x: xv }).N().re;
      const bv = b.subs({ x: xv }).N().re;
      if (av === undefined || bv === undefined) return false;
      if (Math.abs(av - bv) > 1e-9 * Math.max(1, Math.abs(bv))) return false;
    }
    return true;
  };

  test('containsHyperbolic detects hyperbolic heads', () => {
    expect(containsHyperbolic(ce.box(['Power', ['Sinh', 'x'], 3]))).toBe(true);
    expect(containsHyperbolic(ce.box(['Multiply', 'x', ['Tanh', 'x']]))).toBe(true);
    expect(containsHyperbolic(ce.box(['Power', 'x', 3]))).toBe(false);
  });

  test('expandHyperbolicToExp rewrites Sinh^3 to an exp sum (no hyperbolic head, value preserved)', () => {
    const orig = ce.box(['Power', ['Sinh', 'x'], 3]);
    const r = expandHyperbolicToExp(ce, orig);
    expect(containsHyperbolic(r)).toBe(false);
    expect(sameNumerically(r, orig)).toBe(true);
  });

  test('expandHyperbolicToExp distributes a polynomial coefficient over a Cosh power', () => {
    const orig = ce.box(['Multiply', 'x', ['Power', ['Cosh', 'x'], 2]]);
    const r = expandHyperbolicToExp(ce, orig);
    expect(containsHyperbolic(r)).toBe(false);
    expect(r.operator).toBe('Add'); // x·Cosh²x → x·(¼e^2x + ½ + ¼e^-2x)
    expect(sameNumerically(r, orig)).toBe(true);
  });

  test('expandHyperbolicToExp leaves reciprocal hyperbolics (Tanh/Sech/…) as heads', () => {
    // those convert to exp quotients the driver routes elsewhere; keeping the
    // head lets the fallback skip them rather than grind on a rational-in-eˣ form
    const r = expandHyperbolicToExp(ce, ce.box(['Power', ['Tanh', 'x'], 4]));
    expect(containsHyperbolic(r)).toBe(true);
  });

  test('ExpandTrigReduce VALUE_FN matches the direct expansion (2-arg form)', () => {
    const r = build(['ExpandTrigReduce', ['Power', ['Sinh', 'x'], 2], 'x'] as Json, ctx);
    expect(containsHyperbolic(r)).toBe(false);
    expect(sameNumerically(r, ce.box(['Power', ['Sinh', 'x'], 2]))).toBe(true);
  });

  test('foldLnExponentialE folds Ln(ExponentialE) → 1', () => {
    const folded = foldLnExponentialE(
      ce,
      ce.box(['Divide', 'y', ['Multiply', 2, ['Ln', 'ExponentialE']]])
    );
    expect(folded.isSame(ce.box(['Divide', 'y', 2]))).toBe(true);
  });
});

// R11: the runtime cofunction deactivation shift (docs/rubi/RUBI.md §5, Phase
// R11). Rubi authors the sec/csc reduction rules in inert `csc`; at integration
// time `Sec` is reflected onto `csc[·+π/2]` (sec θ = csc(θ+π/2)) so the csc rule
// family covers sec. The shift is value-exact but only fires for pure-source
// (sec-only) forms — mixed cross-pair (sin/cos/tan/cot co-present) and within-
// pair arg desyncs (`csc·sec`) are left to the existing machinery.
describe('cofunction deactivation shift (Sec → csc[·+π/2], R11)', () => {
  const arg = ['Add', 'a', ['Multiply', 'b', 'x']] as Json; // a + b·x (linear)
  const inertSec = (a: Json) => ce.box(['sec', a] as any);
  // numeric agreement of two expressions (one may carry inert heads → activate)
  const sameNumerically = (a: Expression, b: Expression): boolean => {
    for (const xv of [0.3, 0.7, 1.2]) {
      const subs = { a: 0.4, b: 1.1, x: xv };
      const av = activateTrig(ce, a).subs(subs).N().re;
      const bv = activateTrig(ce, b).subs(subs).N().re;
      if (typeof av !== 'number' || typeof bv !== 'number') return false;
      if (Math.abs(av - bv) > 1e-8 * Math.max(1, Math.abs(bv))) return false;
    }
    return true;
  };

  test('maps a bare inert sec to csc at the +π/2-shifted argument', () => {
    const shifted = cofunctionShift(ce, inertSec(arg), 'x');
    // head is now csc, no sec left, and value is preserved (sec θ = csc(θ+π/2))
    expect(shifted.operator).toBe('csc');
    expect(shifted.toString().includes('sec')).toBe(false);
    expect(sameNumerically(shifted, inertSec(arg))).toBe(true);
  });

  test('reflects a sec POWER and a (a+b·sec) binomial, value-preserving', () => {
    const p = ce.box(['Power', ['sec', arg], ['Rational', 5, 2]] as any); // sec^(5/2)
    const sp = cofunctionShift(ce, p, 'x');
    expect(sp.toString().includes('sec')).toBe(false);
    expect(sp.toString().includes('csc')).toBe(true);
    expect(sameNumerically(sp, p)).toBe(true);

    const binom = ce.box(['Add', 2, ['Multiply', 3, ['sec', arg]]] as any); // 2 + 3·sec
    const sb = cofunctionShift(ce, binom, 'x');
    expect(sb.toString().includes('csc')).toBe(true);
    expect(sameNumerically(sb, binom)).toBe(true);
  });

  test('composes with deactivateTrig: active Sec deactivates + reflects to csc', () => {
    const active = ce.box(['Power', ['Sec', arg], 3] as any); // Sec[a+b x]^3
    const shifted = cofunctionShift(ce, deactivateTrig(ce, active), 'x');
    expect(shifted.toString().includes('csc')).toBe(true);
    expect(sameNumerically(shifted, active)).toBe(true);
  });

  test('leaves a MIXED cross-pair integrand (sin·sec) untouched', () => {
    // sin co-present ⇒ uniform +π/2 would desync arguments; unifyInertTrig owns it
    const mixed = ce.box(['Multiply', ['sin', arg], ['sec', arg]] as any);
    expect(cofunctionShift(ce, mixed, 'x')).toBe(mixed);
  });

  test('reverts a WITHIN-pair arg desync (csc·sec) rather than mis-routing', () => {
    // csc[θ]·sec[θ] would reflect to csc[θ]·csc[θ+π/2] — two csc arguments
    const within = ce.box(['Multiply', ['Power', ['csc', arg], 2], ['sec', arg]] as any);
    expect(cofunctionShift(ce, within, 'x')).toBe(within);
  });

  test('no sec/cot present ⇒ strict no-op (identity)', () => {
    const pureSin = ce.box(['Power', ['sin', arg], 2] as any);
    expect(cofunctionShift(ce, pureSin, 'x')).toBe(pureSin);
  });

  test('does NOT reflect a non-linear-argument sec (Rubi LinearQ guard)', () => {
    const nonlinear = ce.box(['sec', ['Power', 'x', 2]] as any); // sec(x²)
    expect(cofunctionShift(ce, nonlinear, 'x')).toBe(nonlinear);
  });
});

// End-to-end: the shipped bundle (ch1+ch2+ch6+4.1 Sine+4.5 Secant) closes secant
// integrands via the reflected csc rule family. Differentiate the result and
// compare to the integrand at sample points.
describe('cofunction shift — end-to-end secant integrals (shipped bundle)', () => {
  let engine: ComputeEngine;
  beforeAll(() => {
    engine = new ComputeEngine();
    loadIntegrationRules(engine);
  });

  const closes = (latex: string): boolean => {
    const integ = engine.parse(latex);
    const F = engine.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate') return false; // stayed inert
    // verify d/dx F ≈ integrand at a few points
    for (const xv of [0.4, 0.9, 1.3]) {
      const h = 1e-6;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
    }
    return true;
  };

  test('closes √(sec x)', () => expect(closes('\\sqrt{\\sec x}')).toBe(true));
  test('closes sec^(5/2)', () =>
    expect(closes('\\sec(x)^{5/2}')).toBe(true));
  test('closes 1/sec^(3/2)', () =>
    expect(closes('\\frac{1}{\\sec(x)^{3/2}}')).toBe(true));
  test('closes sec^3', () => expect(closes('\\sec(x)^3')).toBe(true));
});

// R9: standalone-cosine leaf shift for poly·cos products. cosBaseToSin/
// unifyInertTrig only reflected the base of a (a+b·cos)^n power (x-free coef);
// this generalizes cos→sin[+π/2] to a full-tree leaf rewrite so ∫(c+d·x)^m·cos
// and ∫cos/(c+d·x)^k route to the sine chapter (Rubi has no Cosine chapter).
describe('standalone-cosine leaf shift (poly·cos, R9)', () => {
  const arg = ['Add', 'a', ['Multiply', 'b', 'x']] as Json; // a + b·x
  const sameNumerically = (a: Expression, b: Expression): boolean => {
    for (const xv of [0.3, 0.7, 1.2]) {
      const subs = { a: 0.4, b: 1.1, c: 0.9, d: 1.3, x: xv };
      const av = activateTrig(ce, a).subs(subs).N().re;
      const bv = activateTrig(ce, b).subs(subs).N().re;
      if (typeof av !== 'number' || typeof bv !== 'number') return false;
      if (Math.abs(av - bv) > 1e-8 * Math.max(1, Math.abs(bv))) return false;
    }
    return true;
  };

  test('reflects x-dependent-coefficient cos (poly·cos), value-preserving', () => {
    const polyCos = ce.box(['Multiply', ['Power', 'x', 2], ['cos', arg]] as any);
    const shifted = standaloneCosineShift(ce, polyCos, 'x');
    expect(shifted.toString().includes('cos')).toBe(false);
    expect(shifted.toString().includes('sin')).toBe(true);
    expect(sameNumerically(shifted, polyCos)).toBe(true);
  });

  test('reflects cos/(c+d·x)^k, value-preserving', () => {
    const q = ce.box([
      'Divide',
      ['cos', arg],
      ['Power', ['Add', 'c', ['Multiply', 'd', 'x']], 2],
    ] as any);
    const shifted = standaloneCosineShift(ce, q, 'x');
    expect(shifted.toString().includes('cos')).toBe(false);
    expect(sameNumerically(shifted, q)).toBe(true);
  });

  test('no-op when a partner trig head is present (mixed sin·cos)', () => {
    const mixed = ce.box(['Multiply', ['sin', arg], ['cos', arg]] as any);
    expect(standaloneCosineShift(ce, mixed, 'x')).toBe(mixed);
  });

  test('no-op for a non-linear-argument cosine (cos(x²))', () => {
    const nonlinear = ce.box(['Multiply', 'x', ['cos', ['Power', 'x', 2]]] as any);
    expect(standaloneCosineShift(ce, nonlinear, 'x')).toBe(nonlinear);
  });

  test('no-op when no cosine present', () => {
    const s = ce.box(['Power', ['sin', arg], 2] as any);
    expect(standaloneCosineShift(ce, s, 'x')).toBe(s);
  });
});

// R9: trig → exponential fallback for nonlinear-argument sin/cos (4.1.11/4.1.12).
describe('trig → exponential fallback (nonlinear arguments, R9)', () => {
  const xn = ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 'n']]] as Json; // a+b·xⁿ

  test('gate accepts xᵐ·sin(a+b·xⁿ), declines linear-argument sin', () => {
    const nonlin = ce.box(['Multiply', ['Power', 'x', 2], ['sin', xn]] as any);
    expect(sinCosArgNonlinearExpandableQ(nonlin, 'x')).toBe(true);
    const lin = ce.box([
      'Multiply',
      ['Power', 'x', 2],
      ['sin', ['Add', 'a', ['Multiply', 'b', 'x']]],
    ] as any);
    expect(sinCosArgNonlinearExpandableQ(lin, 'x')).toBe(false);
  });

  test('gate declines a concrete-negative argument exponent (sin(a+b/x))', () => {
    const inv = ce.box(['Multiply', 'x', ['sin', ['Add', 'a', ['Divide', 'b', 'x']]]] as any);
    expect(sinCosArgNonlinearExpandableQ(inv, 'x')).toBe(false);
  });

  test('expandTrigToExp rewrites sin(a+b·xⁿ) to an exp sum (no trig head left)', () => {
    const orig = ce.box(['sin', xn] as any);
    const r = expandTrigToExp(ce, orig);
    expect(r.toString().toLowerCase().includes('sin(')).toBe(false);
  });

  test('numericallyEvaluable is true for a finite exp-form result, false for a complex Ei', () => {
    const finite = ce.parse('x^2 e^{-x}'); // evaluates fine
    expect(numericallyEvaluable(finite, 'x')).toBe(true);
    const ei = ce.parse('\\operatorname{ExpIntegralEi}(i b / x)'); // CE leaves symbolic
    expect(numericallyEvaluable(ei, 'x')).toBe(false);
  });
});

// R9 end-to-end: the shipped bundle closes the poly·cos and nonlinear-argument
// families, and declines the complex-Ei case (leaves it unsolved, not wrong).
describe('R9 end-to-end (shipped bundle)', () => {
  let engine: ComputeEngine;
  beforeAll(() => {
    engine = new ComputeEngine();
    loadIntegrationRules(engine);
  });
  const closes = (latex: string): boolean => {
    const integ = engine.parse(latex);
    const F = engine.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate') return false;
    for (const xv of [0.4, 0.9, 1.3]) {
      const h = 1e-6;
      const fp = (v: number) => F.subs({ a: 0.5, b: 1.2, x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ a: 0.5, b: 1.2, x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
    }
    return true;
  };
  const stayInert = (latex: string): boolean => {
    const integ = engine.parse(latex);
    const F = engine.box(['Integrate', integ, 'x']).evaluate();
    return F.operator === 'Integrate';
  };

  test('closes ∫x·cos(a+b·x)', () =>
    expect(closes('x \\cos(a+b x)')).toBe(true));
  test('closes ∫x²·cos(a+b·x)', () =>
    expect(closes('x^2 \\cos(a+b x)')).toBe(true));
  test('closes ∫x²·sin(a+b·x) (recurses through the cos sub-integral)', () =>
    expect(closes('x^2 \\sin(a+b x)')).toBe(true));
  test('declines ∫x·sin(a+b/x) (complex-Ei, unverifiable) rather than mis-solving', () =>
    expect(stayInert('x \\sin(a+b/x)')).toBe(true));
});
