import { isKnownImmutableType } from '../../../src/common/type/immutable';
import { makeNumericRangeType } from '../../../src/common/type/numeric-range';
import { factsOf, isStableType } from '../../../src/common/type/facts';
import { parseType } from '../../../src/common/type/parse';
import {
  PRIMITIVE_TYPES,
  COLLECTION_SHAPE_TYPE,
  INDEXED_COLLECTION_SHAPE_TYPE,
  EXTENDED_REAL_TYPE,
} from '../../../src/common/type/primitive';
import * as subtype from '../../../src/common/type/subtype';
import {
  couldBeNonRealNumber,
  nonNegativeRangeType,
  nonPositiveRangeType,
  positiveRangeType,
  negativeRangeType,
  isNumericScalarType,
  resolveTypeAlias,
  typeContainsMissing,
} from '../../../src/common/type/utils';
import { applyTypeReference } from '../../../src/common/type/reference';
import type { Type, TypeReference } from '../../../src/common/type/types';

const examples: Type[] = [
  ...PRIMITIVE_TYPES,
  ...[
    'real<0<..3>',
    'integer<-3..4>',
    '0',
    '1',
    '+oo',
    '-oo',
    '~oo',
    'real | nan',
    'real | +oo | -oo',
    'integer | missing',
    'list<integer | missing>',
    'collection<any>',
    'indexed_collection<any>',
    'broadcastable<number>',
    'tuple<integer, missing>',
    'tuple',
    'matrix<integer^(2x3)>',
    'vector<real^3>',
    'list<real^?>',
    'record{x: integer}',
    'dictionary<missing>',
    '!number',
  ].map((s) => parseType(s)),
];

function membership(t: Type, target: Type): boolean | undefined {
  if (t === 'unknown' || t === 'any') return undefined;
  return subtype.isSubtype(t, target)
    ? true
    : subtype.provablyDisjoint(t, target)
      ? false
      : undefined;
}

function checkFacts(t: Type): void {
  const f = factsOf(t);
  for (const tier of [
    'integer',
    'rational',
    'real',
    'imaginary',
    'complex',
    'nan',
    'infinity',
  ] as const)
    expect(f[tier]).toBe(subtype.isSubtype(t, tier));
  expect(f.belowNumber).toBe(subtype.isSubtype(t, 'number'));
  expect(f.couldBeNumber).toBe(!subtype.provablyDisjoint(t, 'number'));
  expect(f.numberMembership).toBe(membership(t, 'number'));
  expect(f.infinityMembership).toBe(membership(t, 'infinity'));
  expect(f.numericScalar).toBe(isNumericScalarType(t));
  expect(f.couldBeNonReal).toBe(couldBeNonRealNumber(t));
  expect(f.containsMissing).toBe(typeContainsMissing(t));
  expect(f.extendedReal).toBe(
    subtype.isSubtype(t, 'real') || subtype.isSubtype(t, EXTENDED_REAL_TYPE)
  );
  expect(f.finite).toBe(
    subtype.isSubtype(t, 'complex')
      ? true
      : subtype.isSubtype(t, 'infinity') || subtype.isSubtype(t, 'nan')
        ? false
        : undefined
  );
  for (const [key, target] of [
    ['collection', COLLECTION_SHAPE_TYPE],
    ['indexed', INDEXED_COLLECTION_SHAPE_TYPE],
  ] as const)
    expect(f[key]).toBe(
      subtype.isSubtype(t, target)
        ? true
        : subtype.provablyDisjoint(t, target)
          ? false
          : undefined
    );
  const resolved = resolveTypeAlias(t);
  expect(f.tupleShaped).toBe(
    resolved === 'tuple' ||
      (typeof resolved === 'object' && resolved.kind === 'tuple')
  );
  expect(f.matrix).toBe(subtype.isSubtype(t, parseType('matrix')));
  expect(f.vector).toBe(subtype.isSubtype(t, parseType('vector')));
  expect(f.unknownOrAny).toBe(t === 'unknown' || t === 'any');
}

describe('Lazy type facts', () => {
  test.each(examples.map((t, i) => [i, t] as const))(
    'preserves predicates for type %s',
    (_, t) => {
      checkFacts(t);
      checkFacts(t);
      expect(factsOf(t)).toBe(factsOf(t));
    }
  );

  test('keeps bottom membership and disjointness separate', () => {
    expect(factsOf('never').belowNumber).toBe(true);
    expect(factsOf('never').couldBeNumber).toBe(false);
    expect(factsOf('never').numberMembership).toBe(true);
    expect(factsOf('never').finite).toBe(true);
    expect(factsOf('unknown').numberMembership).toBeUndefined();
    expect(factsOf('any').numberMembership).toBeUndefined();
  });

  test('computes only requested facts, and caches unknown answers', () => {
    const t = Object.freeze({
      kind: 'union' as const,
      types: Object.freeze(['number', 'string']) as unknown as Type[],
    });
    const spy = jest.spyOn(subtype, 'isSubtype');
    try {
      const f = factsOf(t);
      expect(spy).not.toHaveBeenCalled();
      expect(f.finite).toBeUndefined();
      const count = spy.mock.calls.length;
      expect(count).toBeGreaterThan(0);
      expect(f.finite).toBeUndefined();
      if (process.env.CE_TYPE_FACTS_ASSERT !== '1')
        expect(spy).toHaveBeenCalledTimes(count);
      expect(f.collection).toBeUndefined();
      expect(spy.mock.calls.length).toBeGreaterThan(count);
    } finally {
      spy.mockRestore();
    }
  });

  test('finiteness reuses the finite-complex proof in either read order', () => {
    for (const first of ['finite', 'complex'] as const) {
      const t = Object.freeze({
        kind: 'union' as const,
        types: Object.freeze(['integer', 'real']) as unknown as Type[],
      });
      const f = factsOf(t);
      const spy = jest.spyOn(subtype, 'isSubtype');
      try {
        expect(f[first]).toBe(true);
        expect(f.finite).toBe(true);
        expect(f.complex).toBe(true);
        if (process.env.CE_TYPE_FACTS_ASSERT !== '1') {
          const queries = spy.mock.calls.filter(
            ([lhs, rhs]) => lhs === t && rhs === 'complex'
          );
          expect(queries).toHaveLength(1);
        }
      } finally {
        spy.mockRestore();
      }
    }
  });

  test('range tier facts preserve singleton and empty-range primitive answers', () => {
    for (const t of [
      Object.freeze({
        kind: 'numeric' as const,
        type: 'real' as const,
        lower: 2,
        upper: 2,
      }),
      Object.freeze({
        kind: 'numeric' as const,
        type: 'real' as const,
        lower: 3,
        upper: 2,
      }),
      Object.freeze({
        kind: 'numeric' as const,
        type: 'integer' as const,
        lower: 2,
        upper: 2,
        lowerOpen: true,
      }),
    ])
      checkFacts(t);
  });

  test('does not cache a mutable host range', () => {
    const t: Type = { kind: 'numeric', type: 'real', lower: 0 };
    const f = factsOf(t);
    expect(f.integer).toBe(false);
    t.type = 'integer';
    expect(f.integer).toBe(true);
    checkFacts(t);
  });

  test('a shallow freeze does not hide mutable children or dimensions', () => {
    const elements: Type[] = ['integer'];
    const t = Object.freeze({ kind: 'union' as const, types: elements });
    const f = factsOf(t);
    expect(f.real).toBe(true);
    elements.push('string');
    expect(f.real).toBe(false);
    const dimensions = [2, 3];
    const shape = factsOf(
      Object.freeze({ kind: 'list', elements: 'integer', dimensions })
    );
    expect(shape.shape).toEqual([2, 3]);
    dimensions[0] = -1;
    expect(shape.shape).toBeUndefined();
    expect(shape.finiteCollection).toBeUndefined();
  });

  test('frozen host objects cannot hide mutable fields in custom prototypes', () => {
    const prototype = { type: 'real' };
    const t: Type = Object.freeze(
      Object.assign(Object.create(prototype), { kind: 'numeric', lower: 0 })
    );
    expect(isStableType(t)).toBe(false);
    const f = factsOf(t);
    expect(f.integer).toBe(false);
    prototype.type = 'integer';
    expect(f.integer).toBe(true);

    let tier = 'real';
    const inheritedAccessor = {
      get type() {
        return tier;
      },
    };
    const accessorType: Type = Object.freeze(
      Object.assign(Object.create(inheritedAccessor), { kind: 'numeric' })
    );
    expect(isStableType(accessorType)).toBe(false);
    const accessorFacts = factsOf(accessorType);
    expect(accessorFacts.integer).toBe(false);
    tier = 'integer';
    expect(accessorFacts.integer).toBe(true);
    expect(
      isStableType(Object.freeze({ kind: 'list', elements: accessorType }))
    ).toBe(false);

    const plain: Type = Object.freeze(
      Object.assign(Object.create(null), { kind: 'numeric', type: 'real' })
    );
    expect(isStableType(plain)).toBe(true);
    expect(isStableType(parseType('tuple<real, integer>'))).toBe(true);
    const customArray = Object.setPrototypeOf(
      ['real'],
      Object.create(Array.prototype)
    );
    expect(
      isStableType(
        Object.freeze({
          kind: 'union',
          types: Object.freeze(customArray) as unknown as Type[],
        })
      )
    ).toBe(false);
  });

  test('reference fulfilment remains visible through frozen applications and containers', () => {
    const declaration: TypeReference = {
      kind: 'reference',
      name: 'Future',
      alias: true,
      def: undefined,
    };
    const applied = Object.freeze(applyTypeReference(declaration, []));
    const t = Object.freeze({
      kind: 'union' as const,
      types: Object.freeze([applied, 'integer']) as unknown as Type[],
    });
    const direct = factsOf(applied);
    const nested = factsOf(t);
    expect(direct.real).toBe(false);
    expect(nested.real).toBe(false);
    declaration.def = 'real';
    expect(direct.real).toBe(true);
    expect(nested.real).toBe(true);
    declaration.def = parseType('tuple<integer, missing>');
    expect(direct.tupleShaped).toBe(true);
    expect(nested.real).toBe(false);
    declaration.def = 'string';
    expect(direct.tupleShaped).toBe(false);
    checkFacts(applied);
    checkFacts(t);
  });

  test('open types are excluded even when deeply frozen', () => {
    const variable = Object.freeze({ kind: 'variable' as const, name: 'T' });
    expect(isStableType(variable)).toBe(false);
    expect(
      isStableType(Object.freeze({ kind: 'list', elements: variable }))
    ).toBe(false);
    expect(isStableType(parseType('(T) -> T where T'))).toBe(false);
    expect(isStableType(parseType('real<0..1>'))).toBe(true);
  });

  test('owned range constructors register only frozen scalar leaves', () => {
    const ranges = [
      makeNumericRangeType('real', -1, 3, true),
      nonNegativeRangeType('real'),
      nonPositiveRangeType('real'),
      positiveRangeType('integer'),
      negativeRangeType('integer'),
    ];
    for (const t of ranges) {
      expect(typeof t).toBe('object');
      if (typeof t === 'string') continue;
      expect(isKnownImmutableType(t)).toBe(true);
      expect(Object.isFrozen(t)).toBe(true);
      expect(isStableType(t)).toBe(true);
      expect(Reflect.set(t, 'type', 'string')).toBe(false);
      checkFacts(t);
      // Copying the shape cannot copy the identity brand or its safety proof.
      const copy = { ...t };
      expect(isKnownImmutableType(copy)).toBe(false);
      expect(isStableType(copy)).toBe(false);
    }
    const callerRange = Object.freeze({
      kind: 'numeric',
      type: 'real',
      lower: 0,
    });
    expect(isKnownImmutableType(callerRange)).toBe(false);
    expect(isStableType(callerRange)).toBe(true);
  });

  test('accessor-backed frozen nodes remain live', () => {
    let tier: 'integer' | 'real' = 'real';
    const t = Object.freeze({
      kind: 'numeric' as const,
      get type() {
        return tier;
      },
    });
    const f = factsOf(t);
    expect(f.integer).toBe(false);
    tier = 'integer';
    expect(f.integer).toBe(true);
  });

  test('shape and finite collection preserve concrete dimension semantics', () => {
    for (const dimensions of [[], [-1], [Infinity], [NaN]]) {
      const f = factsOf({ kind: 'list', elements: 'real', dimensions });
      expect(f.shape).toBeUndefined();
      expect(f.finiteCollection).toBeUndefined();
    }
    const t = parseType('matrix<real^(2x3)>');
    expect(factsOf(t).shape).toEqual([2, 3]);
    expect(factsOf(t).finiteCollection).toBe(true);
  });
});
