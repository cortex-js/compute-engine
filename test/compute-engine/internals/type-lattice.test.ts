/**
 * REVIEW.md G15 — intersection (meet) of numeric primitives in the type
 * lattice.
 *
 * The lattice used to reduce incomparable-but-overlapping numeric primitives
 * to `nothing` (e.g. `integer ∩ real` → `nothing`), making type-based
 * membership refutation unsound. The intersection reduction now computes the
 * principled pairwise meet derived from the PRIMITIVE_SUBTYPES table.
 */

import { reduceType } from '../../../src/common/type/reduce';
import {
  isSubtype,
  isPrimitiveSubtype,
  meetPrimitiveTypes,
} from '../../../src/common/type/subtype';
import { typeToString } from '../../../src/common/type/serialize';
import { parseType } from '../../../src/common/type/parse';
import {
  NUMERIC_TYPES,
  PRIMITIVE_TYPES,
} from '../../../src/common/type/primitive';
import type { PrimitiveType, Type } from '../../../src/common/type/types';

function intersect(a: Type, b: Type): Type {
  return reduceType({ kind: 'intersection', types: [a, b] });
}

function intersectStr(a: Type, b: Type): string {
  const t = intersect(a, b);
  return typeof t === 'string' ? t : typeToString(t);
}

describe('Numeric primitive meets (G15)', () => {
  test('integer ∩ real = integer', () =>
    expect(intersectStr('integer', 'real')).toBe('integer'));

  // The bare numeric names form a chain, so every meet inside the tower is
  // simply the narrower operand. `number` is the top of the whole numeric
  // tree, so a meet against it is the other operand.
  test('number ∩ real = real', () =>
    expect(intersectStr('number', 'real')).toBe('real'));

  test('rational ∩ real = rational', () =>
    expect(intersectStr('rational', 'real')).toBe('rational'));

  test('complex ∩ real = real', () =>
    expect(intersectStr('complex', 'real')).toBe('real'));

  test('integer ∩ rational = integer', () =>
    expect(intersectStr('integer', 'rational')).toBe('integer'));

  test('number ∩ rational = rational', () =>
    expect(intersectStr('number', 'rational')).toBe('rational'));

  test('number ∩ integer = integer', () =>
    expect(intersectStr('number', 'integer')).toBe('integer'));

  test('imaginary ∩ complex = imaginary (transitivity repair)', () =>
    expect(intersectStr('imaginary', 'complex')).toBe('imaginary'));

  test('real ∩ complex = real (D10: real ⊂ complex)', () => {
    // D10 (2026-07-02): `real ⊂ complex`, properly. Since `real` is below
    // `complex`, the meet is simply `real`.
    expect(intersectStr('real', 'complex')).toBe('real');
  });

  test('integer ∩ complex = integer (D10: integer ⊂ real ⊂ complex)', () => {
    // D10: the numeric tower is a chain, so the meet is the narrower operand.
    expect(intersectStr('integer', 'complex')).toBe('integer');
  });

  test('subtype-related pairs reduce to the narrower type', () => {
    expect(intersectStr('integer', 'rational')).toBe('integer');
    expect(intersectStr('integer', 'number')).toBe('integer');
    expect(intersectStr('non_finite_number', 'infinity')).toBe(
      'non_finite_number'
    );
  });

  test('an infinity meets no finite numeric name', () => {
    // `integer` is finite now, so it shares no value with the signed pair.
    // (Before the finite-by-default flip this meet was `non_finite_number`.)
    expect(intersectStr('non_finite_number', 'integer')).toBe('never');
    expect(intersectStr('infinity', 'real')).toBe('never');
    expect(intersectStr('nan', 'complex')).toBe('never');
  });

  test('genuinely disjoint pairs still reduce to the empty type', () => {
    // `never`, the type no value inhabits — not `nothing`, the unit type whose
    // one member is the symbol `Nothing`. A refuted meet must not leave a
    // value behind.
    expect(intersectStr('imaginary', 'real')).toBe('never');
    expect(intersectStr('imaginary', 'rational')).toBe('never');
    expect(intersectStr('number', 'boolean')).toBe('never');
    expect(intersectStr('integer', 'string')).toBe('never');
  });

  test('non-numeric overlapping primitives still meet correctly', () => {
    expect(intersectStr('scalar', 'value')).toBe('scalar');
    expect(intersectStr('collection', 'indexed_collection')).toBe(
      'indexed_collection'
    );
  });

  test('composite/primitive disjoint intersections remain empty', () => {
    expect(intersectStr({ kind: 'list', elements: 'integer' }, 'integer')).toBe(
      'never'
    );
  });
});

describe('Meet property: greatest lower bound over the numeric chain', () => {
  // For every pair of numeric primitives, the intersection must:
  //  (1) be a subtype of both operands (soundness), and
  //  (2) be maximal: every numeric primitive that is a common subtype of
  //      both operands must be a subtype of the meet.
  // When the meet is `nothing`, there must be no common numeric subtype.
  for (const a of NUMERIC_TYPES) {
    for (const b of NUMERIC_TYPES) {
      test(`meet(${a}, ${b})`, () => {
        const m = intersect(a, b);
        const commonSubtypes = NUMERIC_TYPES.filter(
          (c) => isPrimitiveSubtype(c, a) && isPrimitiveSubtype(c, b)
        );
        if (m === 'nothing') {
          expect(commonSubtypes).toEqual([]);
        } else {
          // Soundness: m ⊑ a and m ⊑ b
          expect(isSubtype(m, a)).toBe(true);
          expect(isSubtype(m, b)).toBe(true);
          // Maximality: every common subtype is below the meet
          for (const c of commonSubtypes) expect(isSubtype(c, m)).toBe(true);
        }
      });

      test(`meet(${a}, ${b}) is symmetric`, () => {
        expect(intersectStr(a, b)).toBe(intersectStr(b, a));
      });
    }
  }

  test('meetPrimitiveTypes returns maximal, mutually incomparable types', () => {
    for (const a of NUMERIC_TYPES) {
      for (const b of NUMERIC_TYPES) {
        const maximals = meetPrimitiveTypes(a, b);
        for (const t of maximals) {
          expect(isPrimitiveSubtype(t, a)).toBe(true);
          expect(isPrimitiveSubtype(t, b)).toBe(true);
          for (const u of maximals)
            if (u !== t) expect(isPrimitiveSubtype(t, u)).toBe(false);
        }
      }
    }
  });
});

describe('isPrimitiveSubtype and isSubtype agree (SYM P2-22)', () => {
  // Both functions are exported and used for subtype checks; they must agree
  // on the entire primitive lattice. They previously disagreed on `unknown`:
  // `isSubtype(X, unknown)` was `true` (unknown is a top type) while
  // `isPrimitiveSubtype(X, unknown)` was `false`. `unknown` is now a top type
  // in both (`X <: unknown` for all X, reflexively; `unknown <: X` only for
  // `any`/`unknown`).
  for (const a of PRIMITIVE_TYPES) {
    for (const b of PRIMITIVE_TYPES) {
      test(`isPrimitiveSubtype(${a}, ${b}) === isSubtype(${a}, ${b})`, () => {
        expect(isPrimitiveSubtype(a, b)).toBe(isSubtype(a, b));
      });
    }
  }

  test('the unknown cells (the P2-22 disagreement) now agree in both directions', () => {
    for (const t of PRIMITIVE_TYPES) {
      // `X <: unknown`: unknown is the top of the VALUE types — every
      // primitive except the unit types `nothing` and `missing` (each a
      // subtype only of `any` and itself) and `any` itself, which
      // additionally admits the absence markers and therefore sits STRICTLY
      // above `unknown` (lattice repair, 2026-08-17).
      expect(isPrimitiveSubtype(t, 'unknown')).toBe(isSubtype(t, 'unknown'));
      expect(isPrimitiveSubtype(t, 'unknown')).toBe(
        t !== 'nothing' && t !== 'missing' && t !== 'any' && t !== 'error'
      );
      // `unknown <: X`: only `any`/`unknown`.
      expect(isPrimitiveSubtype('unknown', t)).toBe(isSubtype('unknown', t));
      expect(isPrimitiveSubtype('unknown', t)).toBe(
        t === 'any' || t === 'unknown'
      );
    }
  });
});

describe('Subtype closure repair', () => {
  test('imaginary ⊑ complex ⊑ number implies imaginary ⊑ number', () => {
    expect(isPrimitiveSubtype('imaginary', 'complex')).toBe(true);
    expect(isPrimitiveSubtype('complex', 'number')).toBe(true);
    expect(isPrimitiveSubtype('imaginary', 'number')).toBe(true);
  });

  test('subtype relation is transitive over all numeric primitives', () => {
    for (const a of NUMERIC_TYPES)
      for (const b of NUMERIC_TYPES)
        for (const c of NUMERIC_TYPES)
          if (isPrimitiveSubtype(a, b) && isPrimitiveSubtype(b, c))
            expect(isPrimitiveSubtype(a, c)).toBe(true);
  });
});

describe('Union reduction is unchanged (F10)', () => {
  test('integer | number reduces to number', () => {
    expect(
      typeToString(reduceType({ kind: 'union', types: ['integer', 'number'] }))
    ).toBe('number');
    expect(
      typeToString(reduceType({ kind: 'union', types: ['number', 'integer'] }))
    ).toBe('number');
  });
});

describe('Type-based membership refutation is sound (G15 ↔ G3)', () => {
  // typeMembership refutes membership when the intersection of the value's
  // static type with the target type is `nothing`. With the lattice fix,
  // a symbol of type `real` is no longer "refuted" as an integer.
  const { ComputeEngine } = require('../../../src/compute-engine');
  const ce = new ComputeEngine();

  test('Element(x: real, Integers) stays unevaluated', () => {
    ce.pushScope();
    ce.declare('x', 'real');
    const result = ce.expr(['Element', 'x', 'Integers']).evaluate();
    // Indeterminate: a finite real may or may not be an integer
    expect(result.symbol).not.toBe('True');
    expect(result.symbol).not.toBe('False');
    ce.popScope();
  });

  test('Element(s: string, Integers) is definitively False', () => {
    ce.pushScope();
    ce.declare('s', 'string');
    const result = ce.expr(['Element', 's', 'Integers']).evaluate();
    expect(result.symbol).toBe('False');
    ce.popScope();
  });

  test('Element(n: integer, RealNumbers) is definitively True', () => {
    ce.pushScope();
    ce.declare('n', 'integer');
    const result = ce.expr(['Element', 'n', 'RealNumbers']).evaluate();
    expect(result.symbol).toBe('True');
    ce.popScope();
  });
});

const reduceStr = (s: string): string => {
  const t = reduceType(parseType(s));
  return typeof t === 'string' ? t : typeToString(t);
};

describe('The doubled tower is gone (finite-by-default flip)', () => {
  // Before the flip the numeric names were doubled: `real` admitted ±∞ while
  // its `finite_real` twin did not, so the union `finite_X | non_finite_number`
  // covered exactly the same values as `X` and had to collapse to it. The bare
  // names are finite now, so the union is STRICTLY WIDER than `X` — it adds
  // the infinities — and nothing collapses it. The machinery that recognized
  // the old equivalence (`COVERING_UNION_MAP`, `unionCoveringMembers`, the
  // collapse in `reduce.ts`) is deleted, and these pins record its absence.
  //
  // The reduced spelling lists the members in dedup-key order, which puts
  // `non_finite_number` first.
  const PAIRS: [string, string][] = [
    ['non_finite_number | real', 'real'],
    ['non_finite_number | rational', 'rational'],
    ['integer | non_finite_number', 'integer'],
    ['complex | non_finite_number', 'complex'],
  ];

  for (const [union, single] of PAIRS) {
    test(`"${union}" no longer collapses to "${single}"`, () =>
      expect(reduceStr(union)).toBe(union));

    test(`${union} ⊄ ${single} (the infinities are outside it)`, () =>
      expect(isSubtype(union, single)).toBe(false));

    test(`${single} ⊑ ${union} (it IS one of the members)`, () =>
      expect(isSubtype(single, union)).toBe(true));
  }

  test('the finite tower sits under `complex`, and `number` sits above it', () => {
    // Every bare name under `number` denotes finite values alone, so `complex`
    // is the widest FINITE numeric type and the tower's top. `number` is
    // ABOVE `complex`, not inside it — which is what keeps
    // `isNonRealNumber('number')` false and the compiler on its real
    // lowering lane for the generic numeric expressions that carry it.
    expect(isSubtype('real', 'complex')).toBe(true);
    expect(isSubtype('integer', 'complex')).toBe(true);
    expect(isSubtype('imaginary', 'complex')).toBe(true);
    expect(isSubtype('complex', 'number')).toBe(true);
    expect(isSubtype('number', 'complex')).toBe(false);
  });

  test('"complex | non_finite_number" is not the top numeric type', () => {
    // It misses `nan` and the unsigned `~oo`, so it cannot cover `number`.
    expect(isSubtype('number', 'complex | non_finite_number')).toBe(false);
  });

  test('a redundant subtype member is still folded', () => {
    // Union reduction keeps dropping members subsumed by another member; only
    // the covering-union step is gone.
    expect(reduceStr('integer | real | non_finite_number')).toBe(
      'non_finite_number | real'
    );
  });

  test('non_finite_number alone is not spuriously widened', () => {
    const t = reduceType(parseType('non_finite_number | boolean'));
    expect((t as any).kind).toBe('union');
    expect([...(t as any).types].sort()).toEqual([
      'boolean',
      'non_finite_number',
    ]);
  });

  test('a non-covering union is left intact (no spurious collapse)', () => {
    const t = reduceType(parseType('real | imaginary'));
    expect(typeof t).toBe('object');
    expect((t as any).kind).toBe('union');
  });
});

describe('Symbol vs expression<Op> (SYM P1-17)', () => {
  test('symbol <: expression<Symbol>', () =>
    expect(isSubtype('symbol', 'expression<Symbol>')).toBe(true));

  test('symbol ⊄ expression<Add>', () =>
    expect(isSubtype('symbol', 'expression<Add>')).toBe(false));

  test('symbol ⊄ expression<Limits>', () =>
    expect(isSubtype('symbol', 'expression<Limits>')).toBe(false));

  test('symbol ⊄ expression<ErrorCode>', () =>
    expect(isSubtype('symbol', 'expression<ErrorCode>')).toBe(false));

  test('symbol<True> <: expression<Symbol>', () =>
    expect(isSubtype('symbol<True>', 'expression<Symbol>')).toBe(true));

  test('symbol<True> ⊄ expression<Add>', () =>
    expect(isSubtype('symbol<True>', 'expression<Add>')).toBe(false));

  test('bare symbol <: bare expression is unchanged', () =>
    expect(isSubtype('symbol', 'expression')).toBe(true));

  test('expression<Symbol> <: expression<Symbol>', () =>
    expect(isSubtype('expression<Symbol>', 'expression<Symbol>')).toBe(true));

  test('expression<Add> ⊄ expression<Symbol>', () =>
    expect(isSubtype('expression<Add>', 'expression<Symbol>')).toBe(false));
});

describe('Value literal vs bounded numeric (SYM P1-18a)', () => {
  test('7 <: integer<5..10>', () =>
    expect(isSubtype('7', 'integer<5..10>')).toBe(true));

  test('5 <: integer<5..10> (inclusive lower)', () =>
    expect(isSubtype('5', 'integer<5..10>')).toBe(true));

  test('10 <: integer<5..10> (inclusive upper)', () =>
    expect(isSubtype('10', 'integer<5..10>')).toBe(true));

  test('3 ⊄ integer<5..10> (below range)', () =>
    expect(isSubtype('3', 'integer<5..10>')).toBe(false));

  test('12 ⊄ integer<5..10> (above range)', () =>
    expect(isSubtype('12', 'integer<5..10>')).toBe(false));

  test('7.5 ⊄ integer<5..10> (not an integer)', () =>
    expect(isSubtype('7.5', 'integer<5..10>')).toBe(false));

  test('7.5 <: real<5..10>', () =>
    expect(isSubtype('7.5', 'real<5..10>')).toBe(true));

  test('7 <: real<5..10> (an integer value is real)', () =>
    expect(isSubtype('7', 'real<5..10>')).toBe(true));

  test('half-open: 7 <: integer<5..>', () =>
    expect(isSubtype('7', 'integer<5..>')).toBe(true));

  test('half-open: 3 ⊄ integer<5..>', () =>
    expect(isSubtype('3', 'integer<5..>')).toBe(false));

  test('half-open: 3 <: integer<..10>', () =>
    expect(isSubtype('3', 'integer<..10>')).toBe(true));
});

describe('Bounded numeric meets (SYM P1-18b)', () => {
  const isect = (a: string, b: string): string => {
    const t = reduceType({
      kind: 'intersection',
      types: [parseType(a), parseType(b)],
    });
    return typeof t === 'string' ? t : typeToString(t);
  };

  test('overlapping same-base ranges intersect', () =>
    expect(isect('integer<0..10>', 'integer<5..20>')).toBe('integer<5..10>'));

  test('nested ranges intersect to the inner range', () =>
    expect(isect('integer<0..100>', 'integer<5..10>')).toBe('integer<5..10>'));

  test('disjoint ranges meet to the empty type', () =>
    expect(isect('integer<0..3>', 'integer<5..10>')).toBe('never'));

  test('ranges touching at a point meet to that point', () =>
    expect(isect('integer<0..5>', 'integer<5..10>')).toBe('integer<5..5>'));

  test('real range ∩ integer range narrows base kind to integer', () =>
    expect(isect('real<0..100>', 'integer<5..10>')).toBe('integer<5..10>'));

  test('range ∩ overlapping bare numeric primitive', () =>
    expect(isect('real<0..10>', 'integer')).toBe('integer<0..10>'));

  test('range ∩ disjoint primitive = the empty type', () =>
    expect(isect('integer<0..10>', 'boolean')).toBe('never'));

  test('range ∩ non_finite_number (disjoint) = the empty type', () =>
    expect(isect('integer<0..10>', 'non_finite_number')).toBe('never'));

  test('half-open intersection is bounded from both', () =>
    expect(isect('integer<0..>', 'integer<..10>')).toBe('integer<0..10>'));

  test('meet is symmetric', () => {
    expect(isect('integer<0..10>', 'integer<5..20>')).toBe(
      isect('integer<5..20>', 'integer<0..10>')
    );
    expect(isect('real<0..10>', 'integer')).toBe(
      isect('integer', 'real<0..10>')
    );
  });
});

describe('Lattice property sanity: meet ⊑ operands, operand ⊑ union', () => {
  const TYPES = [
    'integer',
    'real',
    'rational',
    'complex',
    'number',
    'integer',
    'real',
    'non_finite_number',
    'boolean',
    'string',
    'integer<0..10>',
    'integer<5..20>',
    'real<0..1>',
  ];

  const meet = (a: string, b: string): Type =>
    reduceType({ kind: 'intersection', types: [parseType(a), parseType(b)] });
  const union = (a: string, b: string): Type =>
    reduceType({ kind: 'union', types: [parseType(a), parseType(b)] });

  for (const a of TYPES) {
    for (const b of TYPES) {
      test(`meet(${a}, ${b}) ⊑ both operands`, () => {
        const m = meet(a, b);
        // The empty type is modeled as `nothing`/`never` here; skip the
        // soundness assertion for it (isSubtype('nothing', X) is false by
        // design). A non-empty meet must be a subtype of both operands.
        if (m !== 'nothing' && m !== 'never') {
          expect(isSubtype(m, parseType(a))).toBe(true);
          expect(isSubtype(m, parseType(b))).toBe(true);
        }
      });

      test(`${a} ⊑ (${a} | ${b}) and ${b} ⊑ (${a} | ${b})`, () => {
        const u = union(a, b);
        expect(isSubtype(parseType(a), u)).toBe(true);
        expect(isSubtype(parseType(b), u)).toBe(true);
      });
    }
  }
});
