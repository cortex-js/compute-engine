// Regression tests for the Rubi predicate/utility layer
// (scripts/rubi/rubi-utils.ts): the BinomialParts/TrinomialParts predicate
// families, the IntBinomialQ/IntQuadraticQ gates, PolyQ[u, x^k] semantics,
// and the RtAux principal-branch root rendering. See docs/rubi/RUBI.md.

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { evalCondition, build } from '../../src/compute-engine/rubi/rubi-utils';
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
  ctx.env.set(name, ce.box(expr as any));
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
