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
  reciprocalToPower,
  standaloneCosineShift,
  expandTrigToExp,
  sinCosArgNonlinearExpandableQ,
  numericallyEvaluable,
  expandRationalOverLinears,
  expandRationalOverComplexLinears,
  inverseSquareTrigFactor,
  containsInertTrig,
  singleAngleTrigRationalQ,
  singleAngleExponentialPieces,
  hasSingleAngleTrigRationalCandidate,
  circularTrigReduce,
  rationalNormalFormX,
  polyDegreeX,
  RuleFail,
} from '../../src/compute-engine/rubi/rubi-utils';
import { toTimesPower } from '../../src/compute-engine/rubi/normal-form';
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

describe('ExpandIntegrand binomial-denominator guard (R25)', () => {
  // A proper `(d+e·x^(n/2))/(a+b·x^n)` (pure even binomial denominator, n ≥ 4)
  // must NOT be distributed: the split pieces ping-pong with the 1.1.3.2
  // binomial rule and the family never closes. ExpandIntegrand fails so the
  // driver falls through to the binomial/trinomial terminal rules.
  const quadOverQuartic = (): Json => [
    'Divide',
    ['Add', ['Sqrt', 'a'], ['Multiply', ['Sqrt', 'b'], ['Power', 'x', 2]]],
    ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 4]]],
  ];
  test('fails (no distribution) on (√a+√b·x²)/(a+b·x⁴)', () => {
    expect(() =>
      build(['ExpandIntegrand', quadOverQuartic(), 'x'], ctx)
    ).toThrow(RuleFail);
  });
  test('fails on pure x²/(a+b·x⁴) as well', () => {
    const j: Json = [
      'Divide',
      ['Power', 'x', 2],
      ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 4]]],
    ];
    expect(() => build(['ExpandIntegrand', j, 'x'], ctx)).toThrow(RuleFail);
  });
  test('still distributes a linear numerator (a+b·x)/(2+3·x⁴)', () => {
    // degree-1 numerator is NOT a polynomial in x² → guard does not fire;
    // ExpandIntegrand distributes into a+b·x monomial pieces that each close
    const j: Json = [
      'Divide',
      ['Add', 'a', ['Multiply', 'b', 'x']],
      ['Add', 2, ['Multiply', 3, ['Power', 'x', 4]]],
    ];
    const r = build(['ExpandIntegrand', j, 'x'], ctx);
    expect(r.operator).toBe('Add');
  });
  test('unaffected: quadratic denominator (a+b·x²) still distributes', () => {
    const j: Json = [
      'Divide',
      ['Add', 1, ['Power', 'x', 2]],
      ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 2]]],
    ];
    expect(() =>
      build(['ExpandIntegrand', j, 'x'], ctx)
    ).not.toThrow();
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

// HalfIntegerQ gates the 5.1.3/5.1.4 (d+e·x²)^p arcsin reductions (RUBI.md §5,
// Phase R20/R22): true iff EVERY argument is a Rational with denominator 2
// (an odd multiple of 1/2). The exponents these rules see are p = ±1/2, ±3/2,
// ±5/2, so verify those box as CE Rationals and grade correctly.
describe('HalfIntegerQ (gates the (d+e·x²)^p arcsin power rules)', () => {
  test('true only for odd multiples of 1/2', () => {
    expect(cond(['HalfIntegerQ', ['Rational', 1, 2]])).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', 3, 2]])).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', -1, 2]])).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', -5, 2]])).toBe(true);
    // integers, other denominators, and non-rationals are NOT half-integers
    expect(cond(['HalfIntegerQ', 2])).toBe(false);
    expect(cond(['HalfIntegerQ', ['Rational', 1, 3]])).toBe(false);
    expect(cond(['HalfIntegerQ', ['Rational', 1, 4]])).toBe(false);
    // 2/4 reduces to 1/2 (denominator 2) → still a half-integer
    expect(cond(['HalfIntegerQ', ['Rational', 2, 4]])).toBe(true);
  });

  test('multi-argument: every argument must be a half-integer', () => {
    expect(
      cond(['HalfIntegerQ', ['Rational', 1, 2], ['Rational', 3, 2]])
    ).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', 1, 2], 2])).toBe(false);
  });
});

// Chapter-3 Logarithms utility layer (RUBI.md §5, Phase R17).
describe('Chapter-3 utilities (IntHide / MemberQ / ProductQ / Cancel / ...)', () => {
  test('ProductQ[u] is true only for a Times expression', () => {
    expect(cond(['ProductQ', ['Multiply', 'x', 2]])).toBe(true);
    expect(cond(['ProductQ', ['Add', 'x', 2]])).toBe(false);
    expect(cond(['ProductQ', 'x'])).toBe(false);
  });

  test('MemberQ[{…}, u] tests structural membership', () => {
    const inv = ['List', 'ArcSin', 'ArcCos', 'ArcSinh', 'ArcCosh'];
    expect(cond(['MemberQ', inv, 'ArcSin'])).toBe(true);
    expect(cond(['MemberQ', inv, 'ArcCosh'])).toBe(true);
    expect(cond(['MemberQ', inv, 'Sin'])).toBe(false);
    expect(cond(['MemberQ', inv, 'Tan'])).toBe(false);
  });

  test('IntegralFreeQ[u] detects a residual inert integral', () => {
    ctx.env.set('freeExpr', ce.parse('x^2 + 1'));
    ctx.env.set('inertExpr', ce.box(['Integrate', ce.symbol('x'), 'x']));
    expect(cond(['IntegralFreeQ', 'freeExpr'])).toBe(true);
    expect(cond(['IntegralFreeQ', 'inertExpr'])).toBe(false);
  });

  test('Cancel/FullSimplify normalize without throwing', () => {
    // Cancel[2·x/2] → x; both map to the bounded rubi-safe simplifier.
    const r = build(['Cancel', ['Divide', ['Multiply', 2, 'x'], 2]], ctx);
    expect(r.isSame(ce.symbol('x'))).toBe(true);
    expect(() => build(['FullSimplify', ['Add', 'x', 'x']], ctx)).not.toThrow();
  });

  test('Part[list, n] is 1-indexed', () => {
    const lst = ['List', 10, 20, 30];
    expect(build(['Part', lst, 1], ctx).isSame(10)).toBe(true);
    expect(build(['Part', lst, 2], ctx).isSame(20)).toBe(true);
    expect(build(['Part', lst, -1], ctx).isSame(30)).toBe(true);
  });

  test('RationalFunctionExponents[u, x] = {numDeg, denDeg}', () => {
    // (x²+1)/(x³+x) — numerator degree 2, denominator degree 3
    const r = build(
      ['RationalFunctionExponents', ['Divide', ['Add', ['Power', 'x', 2], 1], ['Add', ['Power', 'x', 3], 'x']], 'x'],
      ctx
    );
    expect(r.operator).toBe('List');
    expect(r.ops![0].isSame(2)).toBe(true);
    expect(r.ops![1].isSame(3)).toBe(true);
  });

  test('FunctionOfLog[u, x] detects u = F(Log[a·xⁿ]) (RUBI.md §5, R19)', () => {
    // The 3.5 `∫F(Log[a·xⁿ])/x` rule feeds Cancel[x·u]; the CE `Cancel` cannot
    // cancel a common x monomial (x/(x+x·Log²) → 1/(1+Log²)), so functionOfLog
    // does it itself. Result is the triple {F(x), a·xⁿ, n}.
    const asTriple = (j: Json) => build(['FunctionOfLog', j, 'x'], ctx);

    // uncanceled x·u form (exercises cancelCommonXPower): F(t)=1/(1+t²)
    const r1 = asTriple(
      ce.parse('x/(x+x(\\ln x)^2)').json as Json
    );
    expect(r1.operator).toBe('List');
    expect(r1.ops![0].isSame(ce.parse('1/(1+x^2)'))).toBe(true); // F(x)
    expect(r1.ops![1].isSame(ce.symbol('x'))).toBe(true); // v = a·xⁿ = x
    expect(r1.ops![2].isSame(1)).toBe(true); // n

    // nested log leaf Log[3x]² → x², records a·xⁿ = 3x, n = 1
    const r2 = asTriple(ce.parse('(\\ln(3x))^2').json as Json);
    expect(r2.operator).toBe('List');
    expect(r2.ops![0].isSame(ce.parse('x^2'))).toBe(true);
    expect(r2.ops![1].isSame(ce.parse('3x'))).toBe(true);
    expect(r2.ops![2].isSame(1)).toBe(true);

    // Fail-closed cases (return the symbol False):
    // (a) a bare integration variable outside any log
    expect(build(['FunctionOfLog', 'x', 'x'], ctx).symbol).toBe('False');
    // (b) no log at all
    expect(build(['FunctionOfLog', ['Sin', 'x'], 'x'], ctx).symbol).toBe(
      'False'
    );
    // (c) two logs with distinct arguments (purely structural, no Log[x²]=2Log[x])
    expect(
      build(
        ['FunctionOfLog', ce.parse('\\ln x + \\ln(x^2)').json as Json, 'x'],
        ctx
      ).symbol
    ).toBe('False');
  });

  test('IntHide integrates via the int hook, else fails the rule', () => {
    // A hook that closes the sub-integral: IntHide returns its antiderivative.
    const solving: Ctx = {
      ...ctx,
      env: new Map(),
      hooks: { int: (f) => f.mul(ce.symbol('x')) }, // pretend ∫f = f·x
    };
    const F = build(['IntHide', ['Multiply', 2, 'x'], 'x'], solving);
    expect(F.has('Integrate')).toBe(false);

    // A hook that cannot close (null) must throw RuleFail — NOT emit an inert
    // Integrate into the by-parts binding.
    const failing: Ctx = { ...ctx, env: new Map(), hooks: { int: () => null } };
    expect(() => build(['IntHide', ['Multiply', 2, 'x'], 'x'], failing)).toThrow(
      RuleFail
    );

    // A hook whose result still carries an inert Integrate also fails closed.
    const inertCtx: Ctx = {
      ...ctx,
      env: new Map(),
      hooks: { int: (f) => ce.box(['Integrate', f, 'x']) },
    };
    expect(() =>
      build(['IntHide', ['Multiply', 2, 'x'], 'x'], inertCtx)
    ).toThrow(RuleFail);
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

// R13 — sec-specific binomial routing (docs/rubi/RUBI.md §R). `reciprocalToPower`
// normally rewrites csc→1/sin, sec→1/cos so reciprocal integrands route through
// the sine/cosine POWER rules. But a `csc` produced by the R11 sec→csc[·+π/2]
// reflection, inside a binomial `a+b·csc[·+π/2]`, must stay RAW — converting it
// to `a+b/sin[·]` matches no csc-binomial rule. The carve-out keeps such
// reflected csc raw (keyed on the +π/2 argument signature) while natural
// (unshifted) csc/sec still convert, and switches back OFF for the 4.5.7
// `(a+b·sec^2)^p` family (a pure sec^2 binomial raised to a power).
describe('reciprocalToPower — reflected-csc binomial carve-out (R13)', () => {
  const arg = ['Add', 'a', ['Multiply', 'b', 'x']] as Json; // a + b·x (linear)
  // (a + b·sec[arg]) reflected by cofunctionShift → (a + b·csc[arg+π/2])
  const reflectedBinom = (): Expression =>
    cofunctionShift(
      ce,
      ce.box(['Add', 2, ['Multiply', 3, ['sec', arg]]] as any),
      'x'
    );

  test('keeps a reflected-csc binomial summand raw (no csc→1/sin)', () => {
    const out = reciprocalToPower(ce, reflectedBinom()).toString();
    // the reflected csc is preserved; no sine reciprocal is introduced
    expect(out.includes('csc')).toBe(true);
    expect(out.includes('sin')).toBe(false);
  });

  test('still converts a NATURAL (unshifted) csc binomial to 1/sin', () => {
    // no +π/2 signature ⇒ not a reflected head ⇒ normal reciprocal rewrite
    const natural = ce.box(['Add', 2, ['Multiply', 3, ['csc', arg]]] as any);
    const out = reciprocalToPower(ce, natural).toString();
    expect(out.includes('sin')).toBe(true);
    expect(out.includes('csc')).toBe(false);
  });

  test('converts a reflected pure sec^2 binomial power (4.5.7 routing)', () => {
    // (a + b·sec[arg]^2)^3 reflects to (a + b·csc[arg+π/2]^2)^3 — a pure
    // quadratic binomial raised to a power ⇒ the carve-out stays OFF here so
    // the csc convert (routing to the sin/cos-power rules, not the csc rules).
    const q = cofunctionShift(
      ce,
      ce.box([
        'Power',
        ['Add', 'a', ['Multiply', 'b', ['Power', ['sec', arg], 2]]],
        3,
      ] as any),
      'x'
    );
    const out = reciprocalToPower(ce, q).toString();
    expect(out.includes('sin')).toBe(true);
    expect(out.includes('csc')).toBe(false);
  });
});

// R13 end-to-end: the shipped bundle now closes integer-power SYMBOLIC secant
// binomials — `∫1/(a+b·sec)`, `∫(a+b·sec)^2`, `∫sec^k/(a+a·sec)` and the
// `A+B·sec+C·sec^2` polynomials — via the reflected csc-binomial rule family.
// These stay inert without the R13 carve-out (RUBI_NO_SECBIN reproduces that).
describe('R13 end-to-end secant binomials (shipped bundle)', () => {
  let engine: ComputeEngine;
  beforeAll(() => {
    engine = new ComputeEngine();
    loadIntegrationRules(engine);
  });

  // D-verify: differentiate the antiderivative and compare to the integrand.
  const closes = (latex: string, subs: Record<string, number> = {}): boolean => {
    const integ = engine.parse(latex);
    const F = engine.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate') return false; // stayed inert
    for (const xv of [0.4, 0.9, 1.3]) {
      const h = 1e-6;
      const fp = (v: number) => F.subs({ ...subs, x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ ...subs, x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
    }
    return true;
  };

  test('∫1/(2+3·sec x) dx', () =>
    expect(closes('\\frac{1}{2+3\\sec x}')).toBe(true));
  test('∫(2+3·sec x)^2 dx', () =>
    expect(closes('(2+3\\sec x)^2')).toBe(true));
  test('∫1/(a+b·sec x) dx (symbolic params)', () =>
    expect(closes('\\frac{1}{a+b\\sec x}', { a: 1.7, b: 0.6 })).toBe(true));
  test('∫sec^3 x/(a+a·sec x) dx', () =>
    expect(closes('\\frac{\\sec^3 x}{a+a\\sec x}', { a: 1.4 })).toBe(true));
  // 4.5.7 must remain closed (pure sec^2 binomial → sin/cos routing, unaffected)
  test('∫sec^5 x/(a+b·sec^2 x)^3 dx (4.5.7, still closes)', () =>
    expect(closes('\\frac{\\sec^5 x}{(a+b\\sec^2 x)^3}', { a: 1.3, b: 0.6 })).toBe(
      true
    ));
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

  // R18: the reciprocal-argument `sin(a+b/x)` (concrete-negative monomial
  // exponent) is now ADMITTED — it rewrites to a complex-Ei form the
  // 2026-07-09 kernels evaluate, and the driver's numeric-evaluability check is
  // the safety net. (Previously the gate declined it fail-closed.) The gate
  // reads the `x^(-1)` normal form the driver feeds it (via `toTimesPower`), so
  // build the input the same way rather than the raw `b/x` Divide form.
  const norm = (latex: string) => toTimesPower(ce, deactivateTrig(ce, ce.parse(latex)));
  test('gate accepts a reciprocal-argument sin(a+b/x) (R18)', () =>
    expect(sinCosArgNonlinearExpandableQ(norm('x \\sin(a+b/x)'), 'x')).toBe(true));
  test('gate still declines a non-monomial x-argument (two x-terms)', () =>
    expect(sinCosArgNonlinearExpandableQ(norm('x \\sin(b x + c/x)'), 'x')).toBe(
      false
    ));

  test('expandTrigToExp rewrites sin(a+b·xⁿ) to an exp sum (no trig head left)', () => {
    const orig = ce.box(['sin', xn] as any);
    const r = expandTrigToExp(ce, orig);
    expect(r.toString().toLowerCase().includes('sin(')).toBe(false);
  });

  test('numericallyEvaluable is true for a finite exp-form result and for a complex Ei', () => {
    const finite = ce.parse('x^2 e^{-x}'); // evaluates fine
    expect(numericallyEvaluable(finite, 'x')).toBe(true);
    // Complex-argument Ei evaluates since the 2026-07-09 kernel (commit
    // 2980a5a8: expIntegralEiComplex via Γ(0,z)), opening the R9 exp-route
    // self-check gate for the ∫x·sin(a+b/x) class.
    const ei = ce.parse('\\operatorname{ExpIntegralEi}(i b / x)');
    expect(numericallyEvaluable(ei, 'x')).toBe(true);
  });
});

// R14: linear-only trig deactivation. `deactivateTrig(ce, e, 'x')` mirrors
// Rubi's DeactivateTrigAux — it deactivates x-free / linear / bare-monomial
// arguments but leaves a COMPOSITE nonlinear argument (deg-2 quadratic, or a
// non-polynomial linear-inner like √(c+d·x)) ACTIVE so the substitution /
// 4.1.13 rules (authored on active `Sin`) can match it. deg ≥ 3 integer
// composites are deactivated (they reduce to a branch-fragile complex Γ).
describe('linear-only trig deactivation (DeactivateTrigAux, R14)', () => {
  const lin = ['Add', 'a', ['Multiply', 'b', 'x']] as Json; // a + b·x
  const quadComposite = ['Multiply', 'b', ['Power', lin, 2]] as Json; // b·(a+b x)²
  const sqrtComposite = ['Add', 'a', ['Multiply', 'b', ['Power', lin, ['Rational', 1, 2]]]] as Json; // a+b√(a+bx)
  const cubeComposite = ['Add', 'a', ['Multiply', 'b', ['Power', lin, 3]]] as Json; // a+b·(a+bx)³
  const bareMonomial = ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 3]]] as Json; // a+b·x³

  const headOfArg = (arg: Json): string =>
    deactivateTrig(ce, ce.box(['Sin', arg] as any), 'x').operator;

  test('deactivates a LINEAR-argument sin (→ inert)', () => {
    expect(headOfArg(lin)).toBe('sin');
  });
  test('deactivates an x-free-argument sin (→ inert)', () => {
    expect(headOfArg(['Add', 'a', 'b'])).toBe('sin');
  });
  test('deactivates a BARE MONOMIAL sin(a+b·x³) (→ inert, R9 fallback owns it)', () => {
    expect(headOfArg(bareMonomial)).toBe('sin');
  });
  test('leaves a deg-2 COMPOSITE sin(b·(a+b·x)²) ACTIVE (→ 4.1.13 Fresnel)', () => {
    expect(headOfArg(quadComposite)).toBe('Sin');
  });
  test('leaves a √-inner COMPOSITE sin(a+b·√(a+b·x)) ACTIVE (→ substitution)', () => {
    expect(headOfArg(sqrtComposite)).toBe('Sin');
  });
  test('deactivates a deg-3 integer COMPOSITE (branch-fragile Γ ⇒ unsolved)', () => {
    expect(headOfArg(cubeComposite)).toBe('sin');
  });
  test('recurses into a nonlinear-argument tree: a linear-arg cos inside stays deactivated', () => {
    // Sin[cube-composite]·Cos[a+b·x]: outer sin stays active, inner cos → inert
    const mixed = ce.box([
      'Multiply',
      ['Sin', cubeComposite],
      ['Cos', lin],
    ] as any);
    const d = deactivateTrig(ce, mixed, 'x');
    expect(d.toString().includes('cos(')).toBe(true); // linear cos deactivated
  });
  test('no-variable call performs FULL (legacy) deactivation of every head', () => {
    expect(deactivateTrig(ce, ce.box(['Sin', cubeComposite] as any)).operator).toBe('sin');
    expect(deactivateTrig(ce, ce.box(['Sin', quadComposite] as any)).operator).toBe('sin');
  });
});

// R14 end-to-end: the shipped bundle now closes the linear-inner Fresnel /
// Si-Ci families whose active-`Sin` substitution rules were previously
// unmatchable, while keeping the branch-fragile cubic composite unsolved.
describe('R14 end-to-end Si/Ci-routing (shipped bundle)', () => {
  let eng: ComputeEngine;
  beforeAll(() => {
    eng = new ComputeEngine();
    loadIntegrationRules(eng);
  });
  const closesLatex = (latex: string, subs: Record<string, number>): boolean => {
    const integ = eng.parse(latex);
    const F = eng.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate') return false;
    for (const xv of [0.4, 0.9, 1.3]) {
      const h = 1e-6;
      const fp = (v: number) => F.subs({ ...subs, x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ ...subs, x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
    }
    return true;
  };

  test('closes ∫sin(x)/x → SinIntegral(x)', () => {
    const F = eng.box(['Integrate', eng.parse('\\frac{\\sin x}{x}'), 'x']).evaluate();
    expect(F.toString().includes('SinIntegral')).toBe(true);
  });
  test('closes ∫sin(b·(c+d·x)²) → FresnelS (deg-2 composite)', () =>
    expect(closesLatex('\\sin(b (c + d x)^2)', { b: 0.7, c: 0.4, d: 0.6 })).toBe(true));
});

// R9 end-to-end: the shipped bundle closes the poly·cos and nonlinear-argument
// families — including (since R18) the reciprocal-argument complex-Ei case
// `∫x·sin(a+b/x)`, which the 2026-07-09 kernels now make numerically evaluable.
describe('R9 end-to-end (shipped bundle)', () => {
  let engine: ComputeEngine;
  beforeAll(() => {
    engine = new ComputeEngine();
    loadIntegrationRules(engine);
    engine.timeLimit = 30_000; // complex-Ei kernel is slow under ts-jest
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

  test('closes ∫x·cos(a+b·x)', () =>
    expect(closes('x \\cos(a+b x)')).toBe(true));
  test('closes ∫x²·cos(a+b·x)', () =>
    expect(closes('x^2 \\cos(a+b x)')).toBe(true));
  test('closes ∫x²·sin(a+b·x) (recurses through the cos sub-integral)', () =>
    expect(closes('x^2 \\sin(a+b x)')).toBe(true));
  test('closes ∫x·sin(a+b/x) (R18: reciprocal argument → complex-Ei)', () =>
    expect(closes('x \\sin(a+b/x)')).toBe(true));
});

// R15: rational(x)·sin(linear) → partial-fraction → Si/Ci driver fallback.
// The expansion helper splits a rational with all-LINEAR denominators into
// single-piece terms and declines the irreducible-quadratic (complex-root)
// families.
describe('expandRationalOverLinears (R15 expansion gate)', () => {
  const pieces = (latex: string): Expression[] | null =>
    expandRationalOverLinears(ce, ce.parse(latex), 'x');

  test('splits x⁴/(a+bx) (poly-over-linear, ≥2 pieces)', () => {
    const p = pieces('\\frac{x^4}{a+b x}');
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThanOrEqual(2);
  });
  test('splits 1/(x(a+bx)) into 2 partial-fraction pieces', () => {
    const p = pieces('\\frac{1}{x(a+b x)}');
    expect(p).not.toBeNull();
    expect(p!.length).toBe(2);
  });
  test('splits (a+bx³)²/x (numerator over linear)', () => {
    const p = pieces('\\frac{(a+b x^3)^2}{x}');
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThanOrEqual(2);
  });
  test('declines 1/(a+bx²) — irreducible-quadratic denominator', () =>
    expect(pieces('\\frac{1}{a+b x^2}')).toBeNull());
  test('declines x³/(a+bx²)³ — quadratic denominator', () =>
    expect(pieces('\\frac{x^3}{(a+b x^2)^3}')).toBeNull());
  test('declines a bare polynomial (no denominator)', () =>
    expect(pieces('x^2 + x')).toBeNull());
  test('declines a single-piece 1/(a+bx) (no split → no re-entry)', () =>
    expect(pieces('\\frac{1}{a+b x}')).toBeNull());
});

// R18: `expandRationalOverComplexLinears` splits irreducible/reducible QUADRATIC
// x-denominators over their complex-conjugate linear roots (x−r)(x−r̄) before
// the linear partial-fraction machinery — the additional capability that lets
// the Si/Ci fallback close the complex-Si families (4.1.11 #61/#71/#72).
describe('expandRationalOverComplexLinears (R18 quadratic split)', () => {
  const pieces = (latex: string): Expression[] | null =>
    expandRationalOverComplexLinears(ce, ce.parse(latex), 'x');

  test('accepts 1/(a+bx²) — splits into 2 complex-linear pieces', () => {
    const p = pieces('\\frac{1}{a+b x^2}');
    expect(p).not.toBeNull();
    expect(p!.length).toBe(2);
  });
  test('accepts 1/(x²(a+bx²)²) — mixed linear + quadratic (≥2 pieces)', () => {
    const p = pieces('\\frac{1}{x^2 (a+b x^2)^2}');
    expect(p).not.toBeNull();
    expect(p!.length).toBeGreaterThanOrEqual(2);
  });
  test('conjugate-pair pieces recombine to the original rational (numeric)', () => {
    const p = pieces('\\frac{1}{a+b x^2}')!;
    const sum = ce.function('Add', p);
    const orig = ce.parse('\\frac{1}{a+b x^2}');
    const sub = { a: 0.41, b: 0.94 };
    for (const xv of [0.37, 1.29, 2.13]) {
      const s = sum.subs({ ...sub, x: xv }).N();
      const o = orig.subs({ ...sub, x: xv }).N();
      expect(Math.abs((s.re as number) - (o.re as number))).toBeLessThan(1e-9);
      expect(Math.abs((s.im ?? 0) - (o.im ?? 0))).toBeLessThan(1e-9);
    }
  });
  test('declines when there is NO quadratic denominator (leaves to linear path)', () =>
    expect(pieces('\\frac{1}{x(a+b x)}')).toBeNull());
  test('declines a cubic (degree-3) x-denominator', () =>
    expect(pieces('\\frac{1}{a+b x^3}')).toBeNull());
  test('declines a bare polynomial (no denominator)', () =>
    expect(pieces('x^2 + x')).toBeNull());
});

// R15 end-to-end: the shipped bundle closes rational·sin(linear) families whose
// denominators split over real linear factors. Concrete small-integer
// parameters (avoiding the reserved symbols `e`/`i`).
describe('R15 end-to-end Si/Ci partial-fraction routing (shipped bundle)', () => {
  let eng: ComputeEngine;
  beforeAll(() => {
    eng = new ComputeEngine();
    loadIntegrationRules(eng);
  });
  const closesLatex = (latex: string): boolean => {
    const integ = eng.parse(latex);
    const F = eng.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate') return false;
    let ok = 0;
    for (const xv of [0.4, 0.9, 1.3, 1.7]) {
      const h = 1e-4;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
      ok++;
    }
    return ok >= 3;
  };

  test('closes ∫x²·sin(1+2x)/(3+2x) (#18-shape, poly-over-linear)', () =>
    expect(closesLatex('\\frac{x^2 \\sin(1+2 x)}{3+2 x}')).toBe(true));
  test('closes ∫sin(1+2x)/(x(3+2x)) (#23-shape, partial fractions)', () =>
    expect(closesLatex('\\frac{\\sin(1+2 x)}{x(3+2 x)}')).toBe(true));
});

// R18 end-to-end: the shipped bundle now closes the complex-Si families the R15
// rung declined — irreducible-quadratic denominators (`∫sin/(a+bx²)`, 4.1.11
// #61/#71/#72) split over complex-conjugate linear roots, and the reciprocal-
// argument `∫xᵐ·sin(a+b/x)` family (4.1.12) via the R9 exp route. Each result is
// D-verified over the real axis; the conjugate/complex-Ei parts recombine to a
// real antiderivative. These FAIL the #61/#71/#72 case under
// RUBI_NO_SICI_COMPLEX=1 (they exercise the R18 quadratic extension).
describe('R18 end-to-end complex-Si / reciprocal-arg closure (shipped bundle)', () => {
  let eng: ComputeEngine;
  beforeAll(() => {
    eng = new ComputeEngine();
    loadIntegrationRules(eng);
    eng.timeLimit = 30_000; // complex Si/Ci/Ei kernels are slow under ts-jest
  });
  const closesLatex = (latex: string): boolean => {
    const integ = eng.parse(latex);
    const F = eng.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate' || F.has('Integrate')) return false;
    let ok = 0;
    for (const xv of [0.6, 1.1, 1.7, 2.3]) {
      const h = 1e-4;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-3 * Math.max(1, Math.abs(f))) return false;
      ok++;
    }
    return ok >= 3;
  };

  test('closes ∫sin(1+2x)/(2+3x²) (#61-shape, complex-Si)', () =>
    expect(closesLatex('\\frac{\\sin(1+2 x)}{2+3 x^2}')).toBe(true));
  test('closes ∫sin(1+2x)/(x²(2+3x²)²) (#71-shape, quadratic power)', () =>
    expect(closesLatex('\\frac{\\sin(1+2 x)}{x^2 (2+3 x^2)^2}')).toBe(true));
  test('closes ∫x·sin(1+2/x) (reciprocal-argument, R9 exp route)', () =>
    expect(closesLatex('x \\sin(1+2/x)')).toBe(true));
  test('closes ∫sin(1+2/x)/x (reciprocal-argument Si/Ci)', () =>
    expect(closesLatex('\\frac{\\sin(1+2/x)}{x}')).toBe(true));
});

// R16: poly×csc(u)²/sec(u)² → integration-by-parts fallback. The structural
// matcher recognizes the reciprocal-square trig factor (both the reciprocal-head
// power `csc²` and the negative sine power `sin^-2` forms) of a LINEAR argument.
describe('inverseSquareTrigFactor (R16 structural matcher)', () => {
  const arg = ['Add', 'a', ['Multiply', 'b', 'x']] as any;
  const inert = (mj: any) => deactivateTrig(ce, ce.box(mj));

  test('matches csc(a+bx)² as kind sin', () => {
    const m = inverseSquareTrigFactor(inert(['Power', ['Csc', arg], 2]), 'x');
    expect(m?.kind).toBe('sin');
  });
  test('matches sin(a+bx)^-2 as kind sin', () => {
    const m = inverseSquareTrigFactor(inert(['Power', ['Sin', arg], -2]), 'x');
    expect(m?.kind).toBe('sin');
  });
  test('matches sec(a+bx)² as kind cos', () => {
    const m = inverseSquareTrigFactor(inert(['Power', ['Sec', arg], 2]), 'x');
    expect(m?.kind).toBe('cos');
  });
  test('matches cos(a+bx)^-2 as kind cos', () => {
    const m = inverseSquareTrigFactor(inert(['Power', ['Cos', arg], -2]), 'x');
    expect(m?.kind).toBe('cos');
  });
  test('declines csc(a+bx) (power 1, not squared)', () =>
    expect(inverseSquareTrigFactor(inert(['Csc', arg]), 'x')).toBeNull());
  test('declines csc(a+bx²)² (nonlinear argument)', () =>
    expect(
      inverseSquareTrigFactor(
        inert(['Power', ['Csc', ['Add', 'a', ['Multiply', 'b', ['Power', 'x', 2]]]], 2]),
        'x'
      )
    ).toBeNull());
  test('declines csc(a+bx)³ (wrong power)', () =>
    expect(inverseSquareTrigFactor(inert(['Power', ['Csc', arg], 3]), 'x')).toBeNull());
  test('containsInertTrig sees cot/csc, not a bare polynomial', () => {
    expect(containsInertTrig(inert(['Cot', arg]))).toBe(true);
    expect(containsInertTrig(ce.box(['Add', 'c', ['Multiply', 'd', 'x']]))).toBe(false);
  });
});

// R16 end-to-end: the shipped bundle now closes `∫P(x)·csc(linear)²` /
// `∫P(x)·sec(linear)²` (the `(c+d·x)·csc²` #30-shape) via the by-parts reduction,
// D-verified with concrete integer parameters (avoiding the reserved `e`/`i`).
// These two close tests FAIL under `RUBI_NO_TRIGSQ=1` — they exercise the R16
// rung, not a bundled rule.
describe('R16 end-to-end poly×csc²/sec² by-parts (shipped bundle)', () => {
  let eng: ComputeEngine;
  beforeAll(() => {
    eng = new ComputeEngine();
    loadIntegrationRules(eng);
  });
  const closesLatex = (latex: string): boolean => {
    const integ = eng.parse(latex);
    const F = eng.box(['Integrate', integ, 'x']).evaluate();
    if (F.operator === 'Integrate' || F.has('Integrate')) return false;
    let ok = 0;
    for (const xv of [0.4, 0.9, 1.3, 1.7]) {
      const h = 1e-4;
      const fp = (v: number) => F.subs({ x: v }).N().re as number;
      const d = (fp(xv + h) - fp(xv - h)) / (2 * h);
      const f = integ.subs({ x: xv }).N().re as number;
      if (typeof d !== 'number' || typeof f !== 'number') return false;
      if (Math.abs(d - f) > 1e-4 * Math.max(1, Math.abs(f))) return false;
      ok++;
    }
    return ok >= 3;
  };
  const stayInert = (latex: string): boolean => {
    const F = eng.box(['Integrate', eng.parse(latex), 'x']).evaluate();
    return F.operator === 'Integrate' || F.has('Integrate');
  };

  // Both close tests are gated on the R16 rung: `∫x·csc(linear)²` stays inert
  // without the fallback (unlike sec², which the existing cofunction/reciprocal
  // route already closes) — so these two FAIL under `RUBI_NO_TRIGSQ=1`.
  test('closes ∫(3+2x)·csc(1+2x)² (#30-shape)', () =>
    expect(closesLatex('(3+2 x) \\csc(1+2 x)^2')).toBe(true));
  test('closes ∫x·csc(2+x)² (bare monomial)', () =>
    expect(closesLatex('x \\csc(2+x)^2')).toBe(true));
  test('leaves ∫x³·csc(1+2x) (power-1, needs PolyLog) cleanly unsolved', () =>
    expect(stayInert('x^3 \\csc(1+2 x)')).toBe(true));
});

// R17: single-angle trig-rational → single-exponential normalization gate. The
// gate `singleAngleTrigRationalQ` accepts `∫P(x)·R(trig(w))` with a nontrivial
// polynomial P, all trig heads sharing ONE linear argument w, and an additive
// `(a+b·trig)`-type denominator (the #197/#294 shapes). It declines the pure
// reciprocal-square (`poly·csc²`, R16 territory), nonlinear trig arguments, and
// mixed-angle trig. `singleAngleExponentialPieces` returns the linear-factor
// pieces that reconstruct the integrand at y = E^{i·w}.
describe('singleAngleTrigRationalQ (R17 gate)', () => {
  const q = (latex: string): boolean =>
    singleAngleTrigRationalQ(ce, ce.parse(latex), 'x');

  test('accepts #197-shape csc(w)/(a+a·sin(w)) with poly factor', () =>
    expect(q('x^3 \\csc(c+d x) / (a + a \\sin(c+d x))')).toBe(true));
  test('accepts #294-shape cos(w)/(a+b·sin(w)) with poly factor', () =>
    expect(q('(3+2 x)^3 \\cos(c+d x) / (a + b \\sin(c+d x))')).toBe(true));
  test('accepts a bare (a+b·cos(w)) denominator with poly factor', () =>
    expect(q('x^2 / (2 + 3\\cos(1+2 x))')).toBe(true));

  test('declines #30-shape poly·csc² (no additive denominator → R16)', () =>
    expect(q('(1+x) \\csc(c+d x)^2')).toBe(false));
  test('declines bare poly·csc(w) (reciprocal, no additive denominator)', () =>
    expect(q('x^3 \\csc(1+2 x)')).toBe(false));
  test('declines a nonlinear trig argument sin(x²)', () =>
    expect(q('x^2 \\cos(x^2) / (1 + \\sin(x^2))')).toBe(false));
  test('declines mixed-angle trig (sin(2x) vs cos(x))', () =>
    expect(q('x^2 \\cos(x) / (1 + \\sin(2 x))')).toBe(false));
  test('declines a constant (no nontrivial polynomial factor)', () =>
    expect(q('\\cos(x) / (2 + \\sin(x))')).toBe(false));

  test('hasSingleAngleTrigRationalCandidate pre-filter matches the shape', () => {
    expect(
      hasSingleAngleTrigRationalCandidate(
        ce.parse('x^3 \\cos(x) / (2 + \\sin(x))')
      )
    ).toBe(true);
    // pure csc² (no additive-trig denominator) is not a candidate
    expect(
      hasSingleAngleTrigRationalCandidate(ce.parse('(1+x) \\csc(x)^2'))
    ).toBe(false);
  });

  test('singleAngleExponentialPieces reconstructs the integrand at y=E^{i·w}', () => {
    const integrand = ce.parse('x^3 \\cos(x) / (2 + \\sin(x))');
    const pieces = singleAngleExponentialPieces(ce, integrand, 'x');
    expect(pieces).not.toBeNull();
    for (const xv of [0.5, 1.1]) {
      let sum = ce.number(0);
      for (const p of pieces!) sum = sum.add(p.subs({ x: xv }));
      const s = sum.N();
      const t = integrand.subs({ x: xv }).N();
      expect((s.re as number)).toBeCloseTo(t.re as number, 6);
    }
  });
  test('singleAngleExponentialPieces declines the #30 reciprocal-square shape', () =>
    expect(
      singleAngleExponentialPieces(ce, ce.parse('(1+x) \\csc(x)^2'), 'x')
    ).toBeNull());
});

describe('Chapter-5 inverse-trig utilities', () => {
  beforeAll(() => {
    // v = 1 + 3x + 2x²  → discriminant 3² − 4·1·2 = 1
    bind('quadPos', ['Add', 1, ['Multiply', 3, 'x'], ['Multiply', 2, ['Power', 'x', 2]]]);
    // v = 1 + x + x²  → discriminant 1 − 4 = −3
    bind('quadNeg', ['Add', 1, 'x', ['Power', 'x', 2]]);
  });

  test('HalfIntegerQ: every arg is an odd multiple of 1/2', () => {
    expect(cond(['HalfIntegerQ', ['Rational', 3, 2]])).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', -1, 2]])).toBe(true);
    expect(cond(['HalfIntegerQ', ['Rational', 3, 2], ['Rational', 5, 2]])).toBe(true);
    // integers, thirds, and mixed lists are not half-integers
    expect(cond(['HalfIntegerQ', 2])).toBe(false);
    expect(cond(['HalfIntegerQ', ['Rational', 1, 3]])).toBe(false);
    expect(cond(['HalfIntegerQ', ['Rational', 3, 2], 2])).toBe(false);
  });

  test('Discriminant: b²−4ac of a quadratic in x', () => {
    expect(build(['Discriminant', 'quadPos', 'x'], ctx).evaluate().isSame(1)).toBe(true);
    expect(build(['Discriminant', 'quadNeg', 'x'], ctx).evaluate().isSame(-3)).toBe(true);
  });

  test('Head returns the CE operator name as a symbol', () => {
    expect(build(['Head', ['Arctan', 'x']], ctx).symbol).toBe('Arctan');
    expect(build(['Head', ['Multiply', 'a', 'x']], ctx).symbol).toBe('Multiply');
  });

  test('fail-open / fail-closed guards return the False sentinel', () => {
    // These four are stubs (see rubi-utils.ts): each returns Rubi False, so the
    // FalseQ-guarded #71–#74 by-parts rules fire and #27/#28 decline cleanly.
    for (const head of [
      'FunctionOfLinear',
      'PowerVariableExpn',
      'InverseFunctionOfLinear',
      'SubstForInverseFunction',
    ]) {
      expect(build([head, 'quadNeg', 'x'], ctx).symbol).toBe('False');
      expect(cond(['FalseQ', [head, 'quadNeg', 'x']])).toBe(true);
    }
  });
});

// circularTrigReduce — the ExpandTrigReduce circular product-to-sum (RUBI.md §5,
// Phase R23). Reduces products/powers of Sin[u]/Cos[u] to a REAL multiple-angle
// sum, so the arcsin substitution rules' ∫θⁿ·Sin^m·Cos^k inner integrals reach
// the ∫Cos[k·u]/θ → CosIntegral closure. The reduction is an exact identity:
// reduce(u) ≡ u, verified numerically. It must emit only single-angle Cos/Sin
// (no residual powers) or the θⁿ·Cos[k·u] rules never match.
describe('circularTrigReduce (ExpandTrigReduce circular product-to-sum, R23)', () => {
  const engine = new ComputeEngine();
  // reduce(u) ≡ u at a spread of points (u, x, a free), and the reduced form
  // contains no Power-of-Sin/Cos (single-angle real trig only).
  const identityCases: [Expression, string][] = [
    [['Power', ['Sin', 'u'], 2] as Expression, 'Sin²'],
    [['Power', ['Sin', 'u'], 3] as Expression, 'Sin³'],
    [['Power', ['Cos', 'u'], 4] as Expression, 'Cos⁴'],
    [['Power', ['Cos', 'u'], 5] as Expression, 'Cos⁵'],
    [
      ['Multiply', ['Power', ['Sin', 'u'], 4], ['Cos', 'u']] as Expression,
      'Sin⁴·Cos',
    ],
    [
      [
        'Multiply',
        ['Power', ['Sin', 'u'], 3],
        ['Power', ['Cos', 'u'], 6],
      ] as Expression,
      'Sin³·Cos⁶',
    ],
    // rule 5.1.2#7 shape: a scalar Add distributed over a Sin power
    [
      [
        'Multiply',
        ['Sin', 'u'],
        ['Subtract', 2, ['Multiply', 3, ['Power', ['Sin', 'u'], 2]]],
      ] as Expression,
      'Sin·(2−3Sin²)',
    ],
    // symbolic linear argument (as produced by the arcsin substitution)
    [
      [
        'Power',
        ['Sin', ['Add', ['Multiply', -1, 'a'], ['Multiply', 2, 'x']]],
        2,
      ] as Expression,
      'Sin(−a+2x)²',
    ],
  ];

  test.each(identityCases)('reduce(%s) ≡ %s numerically', (input) => {
    const u = engine.box(input as any);
    const reduced = circularTrigReduce(engine, u);
    let maxErr = 0;
    for (let i = 0; i < 10; i++) {
      const sub = { u: 0.4 * i - 1.7, x: 0.3 * i - 1.1, a: 0.7 };
      const A = u.subs(sub).N();
      const B = reduced.subs(sub).N();
      maxErr = Math.max(
        maxErr,
        Math.hypot(
          ((A.re as number) ?? NaN) - ((B.re as number) ?? NaN),
          ((A.im as number) ?? 0) - ((B.im as number) ?? 0)
        )
      );
    }
    expect(maxErr).toBeLessThan(1e-10);
    // no residual Sin/Cos POWER survives — output is a sum of single angles
    const json = JSON.stringify(reduced.json);
    expect(/\["Power",\["Sin"/.test(json)).toBe(false);
    expect(/\["Power",\["Cos"/.test(json)).toBe(false);
  });

  test('the closure requires the reduction (Sin² is the load-bearing step)', () => {
    // Without the reduction ∫Sin[x]²/x stays inert; with it, Sin²→½−½Cos[2x]
    // and the CosIntegral fallback closes it. Assert the reduced integrand is
    // the multiple-angle form the ∫Cos[2x]/x rule needs.
    const reduced = circularTrigReduce(
      engine,
      engine.box(['Power', ['Sin', 'x'], 2] as any)
    );
    expect(reduced.toString()).toContain('cos(2x)');
  });
});

// R26B rational normal form: flatten a nested rational function of x into a
// single N/D of expanded x-polynomials (the shape the `t=eˣ` hyperbolic
// substitution lands and no bundled rule matches).
describe('rationalNormalFormX (R26B)', () => {
  // Numerically identical to the input at several (a,b,x) samples — the
  // transform must preserve the rational function exactly.
  const sameRationalFn = (e: Expression, x: string) => {
    const nf = rationalNormalFormX(e, x);
    expect(nf).not.toBeNull();
    for (const [a, b, xv] of [
      [3, 5, 0.7],
      [2, 7, 1.3],
      [1, 4, 2.1],
    ]) {
      const orig = e.subs({ a, b, [x]: xv }).N().re;
      const got = nf!.subs({ a, b, [x]: xv }).N().re;
      expect(typeof got).toBe('number');
      expect(got as number).toBeCloseTo(orig as number, 8);
    }
    return nf!;
  };

  test('flattens the sinh substitution shape 1/(x·(a+b/2·(x−1/x)))', () => {
    // ≡ 1/((b/2)x²+a·x−b/2) — a single flat quadratic denominator.
    const e = ce.parse('\\frac{1}{x\\left(a+\\frac{b}{2}\\left(x-\\frac1x\\right)\\right)}');
    const nf = sameRationalFn(e, 'x');
    // no nested reciprocal-of-x survives: the denominator is a polynomial in x
    const den = nf.numeratorDenominator[1];
    expect(polyDegreeX(den, 'x')).toBeGreaterThanOrEqual(1);
  });

  test('flattens the tanh substitution shape, keeping the x monomial factored', () => {
    // 1/(x·(a+b·(x−1/x)/(x+1/x))) ≡ (x²+1)/(x·((a+b)x²+(a−b)))
    const e = ce.parse(
      '\\frac{1}{x\\left(a+b\\frac{x-\\frac1x}{x+\\frac1x}\\right)}'
    );
    sameRationalFn(e, 'x');
  });

  test('returns null for a non-rational (irrational) integrand', () => {
    // √x is not a rational function of x → the normal form declines.
    const e = ce.parse('\\frac{1}{a+\\sqrt{x}}');
    expect(rationalNormalFormX(e, 'x')).toBeNull();
  });
});
