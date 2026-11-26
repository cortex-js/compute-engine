import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { reduceType, typesOverlap } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import {
  couldMatch,
  isSubtype,
  isSubtypeOfBroadcastOrIndexed,
  narrow,
  provablyDisjoint,
  widen,
} from '../../src/common/type/subtype';
import { inferTypeArguments } from '../../src/common/type/instantiate';
import { analyzeVariance } from '../../src/common/type/variance';
import { conditionalTargetInstance } from '../../src/common/type/conditional-conformance';
import { boundTypeSize } from '../../src/common/type/size-cap';
import { collectionElementType } from '../../src/common/type/utils';
import {
  arrayCellType,
  arrayStorageKind,
} from '../../src/common/type/array-storage';
import type {
  FunctionSignature,
  Type,
  TypeResolver,
} from '../../src/common/type/types';

//
// The type `array<T>` of a mutable array (stage 1 of
// `docs/plans/2026-11-25-mutable-arrays-implementation-plan.md`; spec
// sections 2 and 3, acceptance case 1, type half).
//

const t = (s: string, resolver?: TypeResolver): Type => parseType(s, resolver);
const sub = (a: string, b: string): boolean => isSubtype(t(a), t(b));

describe('ARRAY TYPE — parse and print', () => {
  test.each([
    'array<integer<0..255>>',
    'array<real>',
    'array<array<string>>',
    'array<any>',
    'array',
    '(array<real>, integer) -> real',
    'array<tuple<r: integer<0..255>, g: integer<0..255>>> | missing',
    'list<array<integer>>',
  ])('%s round-trips', (s) => {
    expect(typeToString(t(s))).toBe(s);
  });

  test('bare `array` is a primitive, `array<any>` is not', () => {
    expect(t('array')).toBe('array');
    expect(t('array<any>')).toEqual({ kind: 'array', elements: 'any' });
  });

  test('`array<T>` takes exactly one type argument and no dimensions', () => {
    expect(() => t('array<integer^3>')).toThrow(/no dimensions/);
    expect(() => t('array<integer, real>')).toThrow(/one type argument/);
    expect(() => t('array<>')).toThrow();
  });

  test('an engine parses a signature with an array parameter', () => {
    const ce = new ComputeEngine();
    expect(ce.type('(array<integer<0..255>>) -> integer').toString()).toBe(
      '(array<integer<0..255>>) -> integer'
    );
  });
});

describe('ARRAY TYPE — subtyping', () => {
  test.each([
    // Invariance: only the same cell type.
    ['array<integer>', 'array<integer>', true],
    ['array<integer>', 'array<number>', false],
    ['array<number>', 'array<integer>', false],
    ['array<integer<0..10>>', 'array<integer<0..255>>', false],
    ['array<integer<0..255>>', 'array<integer<0..10>>', false],
    ['array<integer | string>', 'array<string | integer>', true],
    // Bare `array` is the top of the arrays; `array<any>` is not it.
    ['array<integer>', 'array', true],
    ['array<any>', 'array', true],
    ['array', 'array<any>', false],
    ['array<integer>', 'array<any>', false],
    ['array<any>', 'array<any>', true],
    // Disjoint from the collections and from `object`.
    ['array<integer>', 'list<integer>', false],
    ['list<integer>', 'array<integer>', false],
    ['array<integer>', 'list', false],
    ['array<integer>', 'collection<integer>', false],
    ['array<integer>', 'collection', false],
    ['array<integer>', 'indexed_collection<integer>', false],
    ['array<integer>', 'indexed_collection', false],
    ['array', 'collection', false],
    ['array<integer>', 'object', false],
    ['array', 'object', false],
    ['object', 'array', false],
    ['array<integer>', 'tuple', false],
    ['array<integer>', 'record', false],
    ['array<integer>', 'dictionary', false],
    ['array<integer>', 'string', false],
    ['array<integer>', 'number', false],
    ['array<integer>', 'broadcastable<integer>', false],
    // The tops and the bottoms.
    ['array<integer>', 'value', true],
    ['array', 'value', true],
    ['array<integer>', 'expression', true],
    ['array<integer>', 'any', true],
    ['never', 'array<integer>', true],
    ['nothing', 'array<integer>', false],
    ['array<integer>', 'nothing', false],
    ['array<integer>', 'array<integer> | missing', true],
  ])('%s <: %s is %s', (a, b, expected) => {
    expect(sub(a, b)).toBe(expected);
  });

  test('a nominal array type is an `array`, and opaque otherwise', () => {
    const ce = new ComputeEngine();
    ce.declareType('Buf', 'array<integer>');
    const r = ce._typeResolver;
    expect(isSubtype(t('Buf', r), 'array')).toBe(true);
    expect(isSubtype(t('Buf', r), t('array<integer>'))).toBe(false);
    ce.declareType('Bytes', 'array<integer>', { alias: true });
    expect(isSubtype(t('Bytes', r), t('array<integer>'))).toBe(true);
    expect(isSubtype(t('array<integer>'), t('Bytes', r))).toBe(true);
  });

  test('an `array<integer>` is refused where an `array<number>` is declared', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'array<integer>');
    ce.declare('b', 'array<number>');
    ce.declare('f', '(array<number>) -> number');
    expect(ce.box(['f', 'b']).isValid).toBe(true);
    expect(JSON.stringify(ce.box(['f', 'a']).json)).toContain(
      'incompatible-type'
    );
    // No broadcast over an array.
    expect(JSON.stringify(ce.box(['Add', 'a', 1]).json)).toContain(
      'incompatible-type'
    );
  });

  test('an array is not broadcast over and is not an indexed collection', () => {
    expect(isSubtypeOfBroadcastOrIndexed(t('array<number>'), 'number')).toBe(
      false
    );
    expect(isSubtypeOfBroadcastOrIndexed(t('array'), 'number')).toBe(false);
  });

  test('an array type has no collection element type', () => {
    expect(collectionElementType(t('array<integer>'))).toBeUndefined();
    expect(collectionElementType('array')).toBeUndefined();
  });
});

describe('ARRAY TYPE — overlap, meet and join', () => {
  test.each([
    ['array<integer>', 'array<number>', false],
    ['array<integer<0..10>>', 'array<integer<0..255>>', false],
    ['array<integer>', 'array<integer>', true],
    ['array<integer>', 'array', true],
    ['array<any>', 'array', true],
    ['array<integer>', 'array<any>', false],
    ['array<integer>', 'list<integer>', false],
    ['array<integer>', 'list', false],
    ['array<integer>', 'collection<any>', false],
    ['array<integer>', 'indexed_collection<integer>', false],
    ['array<integer>', 'object', false],
    ['array<integer>', 'value', true],
    ['array<integer>', 'any', true],
  ])('%s and %s overlap: %s', (a, b, expected) => {
    expect(typesOverlap(t(a), t(b))).toBe(expected);
    expect(couldMatch(t(a), t(b))).toBe(expected);
    expect(provablyDisjoint(t(a), t(b))).toBe(!expected);
  });

  test('the meet of two different array types is empty', () => {
    expect(narrow(t('array<integer>'), t('array<number>'))).toBe('never');
    expect(
      reduceType({
        kind: 'intersection',
        types: [t('array<integer>'), t('array<number>')],
      })
    ).toBe('never');
    expect(typeToString(narrow(t('array<integer>'), 'array'))).toBe(
      'array<integer>'
    );
    expect(narrow(t('array<integer>'), t('list<integer>'))).toBe('never');
  });

  test('the join of two different array types is bare `array`', () => {
    expect(widen(t('array<integer>'), t('array<number>'))).toBe('array');
    expect(widen(t('array<any>'), t('array<string>'))).toBe('array');
    expect(typeToString(widen(t('array<integer>'), t('array<integer>')))).toBe(
      'array<integer>'
    );
    // Beside a list, the join keeps both (`value` is a lossy supertype).
    expect(
      typeToString(widen(t('array<integer>'), t('list<integer>')))
    ).toMatch(/array<integer>.*\|.*list<integer>|list<integer>.*\|.*array<integer>/);
  });

  test('a union keeps two different array types', () => {
    expect(
      typeToString(
        reduceType({
          kind: 'union',
          types: [t('array<integer>'), t('array<number>')],
        })
      )
    ).toMatch(/array<integer> \| array<number>|array<number> \| array<integer>/);
    expect(
      reduceType({ kind: 'union', types: [t('array<integer>'), 'array'] })
    ).toBe('array');
  });
});

describe('ARRAY TYPE — type parameters', () => {
  test('a type parameter used as a cell type is an `inout` position', () => {
    const analysis = analyzeVariance(
      { kind: 'array', elements: { kind: 'variable', name: 'T' } },
      [{ name: 'T', variance: 'out' }],
      'Buf'
    );
    expect(analysis.observed.get('T')).toBe('inout');
  });

  test('a generic array type verifies only as `inout`', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce.declareType('Buf', 'array<T>', { typeParams: 'inout T' })
    ).not.toThrow();
    expect(() =>
      new ComputeEngine().declareType('Buf', 'array<T>', { typeParams: 'T' })
    ).toThrow(/variance-violation/);
    expect(() =>
      new ComputeEngine().declareType('Buf', 'array<T>', {
        typeParams: 'out T',
      })
    ).toThrow(/variance-violation/);
  });

  test('a cell type variable is solved invariantly', () => {
    const one = t('(array<T>) -> T where T') as FunctionSignature;
    expect(inferTypeArguments(one, [t('array<integer>')])).toEqual({
      T: 'integer',
    });
    const two = t('(array<T>, array<T>) -> T where T') as FunctionSignature;
    expect(
      inferTypeArguments(two, [t('array<integer>'), t('array<integer>')])
    ).toEqual({ T: 'integer' });
    expect(
      inferTypeArguments(two, [t('array<integer>'), t('array<number>')])
    ).toBeNull();
    expect(inferTypeArguments(one, [t('list<integer>')])).toBeNull();
  });
});

describe('ARRAY TYPE — cell type and storage', () => {
  test('arrayCellType', () => {
    expect(arrayCellType(t('array<integer>'))).toBe('integer');
    expect(arrayCellType(t('array<any>'))).toBe('any');
    expect(arrayCellType('array')).toBeUndefined();
    expect(arrayCellType(t('list<integer>'))).toBeUndefined();
    expect(arrayCellType('integer')).toBeUndefined();
    const ce = new ComputeEngine();
    ce.declareType('Buf', 'array<real>');
    expect(arrayCellType(t('Buf', ce._typeResolver))).toBe('real');
  });

  const storage = (s: string, resolver?: TypeResolver) =>
    arrayStorageKind(t(s, resolver));

  test.each([
    ['integer<0..255>', 'uint8'],
    ['integer<0..0>', 'uint8'],
    ['integer<0..256>', 'uint16'],
    ['integer<-128..127>', 'int8'],
    ['integer<-129..127>', 'int16'],
    ['integer<-128..128>', 'int16'],
    ['integer<0..65535>', 'uint16'],
    ['integer<0..65536>', 'uint32'],
    ['integer<-32768..32767>', 'int16'],
    ['integer<-32769..32767>', 'int32'],
    ['integer<0..4294967295>', 'uint32'],
    ['integer<0..4294967296>', 'expression'],
    ['integer<-2147483648..2147483647>', 'int32'],
    ['integer<-2147483649..2147483647>', 'expression'],
    ['integer<-2147483648..2147483648>', 'expression'],
    ['integer<-1..4294967295>', 'expression'],
    ['real', 'float64'],
    ['real<0..1>', 'float64'],
    ['real<0<..>', 'float64'],
    ['integer', 'expression'],
    ['integer<0..>', 'expression'],
    ['integer<..10>', 'expression'],
    ['rational', 'expression'],
    ['rational<0..1>', 'expression'],
    ['number', 'expression'],
    ['complex', 'expression'],
    ['boolean', 'expression'],
    ['string', 'expression'],
    ['integer<0..255> | string', 'expression'],
    ['list<integer<0..255>>', 'expression'],
    ['array<integer<0..255>>', 'expression'],
    ['object', 'expression'],
    ['any', 'expression'],
  ])('%s is stored as %s', (cell, expected) => {
    expect(storage(cell)).toEqual({ storage: expected, tuple: false });
  });

  test('a tuple of four bytes is a machine cell', () => {
    const byte4 = { storage: 'uint8', tuple: true };
    const expr = { storage: 'expression', tuple: false };
    expect(
      storage(
        'tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>'
      )
    ).toEqual(byte4);
    expect(
      storage(
        'tuple<r: integer<0..255>, g: integer<0..255>, b: integer<0..255>, a: integer<0..255>>'
      )
    ).toEqual(byte4);
    expect(
      storage(
        'tuple<integer<0..10>, integer<0..255>, integer<0..1>, integer<0..255>>'
      )
    ).toEqual(byte4);
    // Three bytes, one unbounded integer, four reals, a wider element.
    expect(
      storage('tuple<integer<0..255>, integer<0..255>, integer<0..255>>')
    ).toEqual(expr);
    expect(
      storage(
        'tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer>'
      )
    ).toEqual(expr);
    expect(storage('tuple<real, real, real, real>')).toEqual(expr);
    expect(
      storage(
        'tuple<integer<0..256>, integer<0..255>, integer<0..255>, integer<0..255>>'
      )
    ).toEqual(expr);
    expect(storage('tuple<real, real>')).toEqual(expr);
  });

  test('a cell type is read through a transparent alias', () => {
    const ce = new ComputeEngine();
    const r = ce._typeResolver;
    const byte4 = { storage: 'uint8', tuple: true };
    ce.declareType('Byte', 'integer<0..255>', { alias: true });
    ce.declareType('Short', 'integer<-32768..32767>', { alias: true });
    ce.declareType('Pixel', 'tuple<r: Byte, g: Byte, b: Byte, a: Byte>');
    ce.declareType('Rgba', 'tuple<Byte, Byte, Byte, Byte>', { alias: true });
    ce.declareType('Rgb', 'tuple<Byte, Byte, Byte>');
    expect(storage('Byte', r)).toEqual({ storage: 'uint8', tuple: false });
    expect(storage('Short', r)).toEqual({ storage: 'int16', tuple: false });
    expect(storage('Pixel', r)).toEqual(byte4);
    expect(storage('Rgba', r)).toEqual(byte4);
    expect(storage('Rgb', r)).toEqual({ storage: 'expression', tuple: false });
    // Through the cell type of an array type.
    const cell = arrayCellType(t('array<Pixel>', r));
    expect(cell && arrayStorageKind(cell)).toEqual(byte4);
  });

  test('a nominal cell type has expression cells, but for the tuple of four bytes', () => {
    const ce = new ComputeEngine();
    const r = ce._typeResolver;
    const expr = { storage: 'expression', tuple: false };
    ce.declareType('Byte', 'integer<0..255>');
    ce.declareType('Real', 'real');
    ce.declareType(
      'Pixel',
      'tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>'
    );
    ce.declareType('BytePixel', 'tuple<Byte, Byte, Byte, Byte>');
    ce.declareType('ByteTuple', 'tuple<Byte, Byte, Byte, Byte>', {
      alias: true,
    });
    expect(storage('Byte', r)).toEqual(expr);
    expect(storage('Real', r)).toEqual(expr);
    expect(storage('Pixel', r)).toEqual({ storage: 'uint8', tuple: true });
    expect(storage('BytePixel', r)).toEqual(expr);
    expect(storage('ByteTuple', r)).toEqual(expr);
    // A nominal reference to an array type is still read for its cell type.
    ce.declareType('Bytes', 'array<Byte>');
    const cell = arrayCellType(t('Bytes', r));
    expect(cell && arrayStorageKind(cell)).toEqual(expr);
  });
});

describe('ARRAY TYPE — conditional conformance head', () => {
  const T: Type = { kind: 'variable', name: 'T' };
  const head: Type = {
    kind: 'array',
    elements: { kind: 'tuple', elements: [{ type: T }, { type: 'real' }] },
  };
  const yes = () => true;

  test('the cell type is invariant below its top level', () => {
    expect(
      conditionalTargetInstance(
        head,
        [{ name: 'T' }],
        t('array<tuple<integer, integer>>'),
        yes
      )
    ).toBeNull();
  });

  test('an equal cell type matches', () => {
    const r = conditionalTargetInstance(
      head,
      [{ name: 'T' }],
      t('array<tuple<integer, real>>'),
      yes
    );
    expect(r && typeToString(r)).toBe('array<tuple<integer, real>>');
  });
});

describe('ARRAY TYPE — size limit', () => {
  test('a bounded tuple of arrays is a supertype, never array<any>', () => {
    const input = t(`tuple<${Array(128).fill('array<integer>').join(', ')}>`);
    const bounded = boundTypeSize(input);
    expect(isSubtype(input, bounded)).toBe(true);
    expect(typeToString(bounded)).not.toContain('array<any>');
  });

  test('an array of a compound cell widens to the bare array', () => {
    const cell = `tuple<${Array(128).fill('list<integer>').join(', ')}>`;
    const input = t(`tuple<array<${cell}>, integer>`);
    const bounded = boundTypeSize(input);
    expect(isSubtype(input, bounded)).toBe(true);
    expect(typeToString(bounded)).toBe('tuple<array, integer>');
    const top = t(`array<${cell}>`);
    expect(boundTypeSize(top)).toBe('array');
  });
});
