/**
 * The interpreter value of a mutable array, `BoxedArray`
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, sections 3, 5 to 8).
 *
 * The arrays are built with the internal factory `ce._array()`: the
 * operators that make, read and write an array are later work items.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { ArrayInterface } from '../../src/compute-engine/types-expression';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';
import { cachedValue } from '../../src/compute-engine/boxed-expression/cache';
import { containsObject } from '../../src/compute-engine/boxed-expression/object-walk';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
  ce.declareType(
    'Pixel',
    'tuple<r: integer<0..255>, g: integer<0..255>, b: integer<0..255>, a: integer<0..255>>'
  );
});

type Arr = Expression & ArrayInterface;

function array(
  cellType: string,
  values: ReadonlyArray<number | Expression>
): Arr {
  const a = ce._array(cellType, {
    elements: values.map((v) => (typeof v === 'number' ? ce.number(v) : v)),
  });
  if (!isMutableArray(a)) throw new Error(`no array: ${a.toString()}`);
  return a;
}

/** The error code of an error expression, or `undefined`. */
function errorCode(x: Expression | undefined): string | undefined {
  if (x === undefined || x.operator !== 'Error') return undefined;
  return x.json?.[1]?.[1]?.replace(/'/g, '');
}

const tuple = (...xs: number[]) =>
  ce._fn(
    'Tuple',
    xs.map((x) => ce.number(x))
  );

describe('STORAGE', () => {
  test.each([
    ['integer<0..255>', Uint8Array, 255, 256],
    ['integer<-128..127>', Int8Array, -128, 128],
    ['integer<0..65535>', Uint16Array, 65535, -1],
    ['integer<-32768..32767>', Int16Array, -32768, 32768],
    ['integer<0..4294967295>', Uint32Array, 4294967295, -1],
    ['integer<-2147483648..2147483647>', Int32Array, -2147483648, 2147483648],
  ])('%s', (cellType, Storage, inRange, outOfRange) => {
    const a = array(cellType, [0, 1]);
    expect(a.cells).toBeInstanceOf(Storage);
    expect(a._store(1, ce.number(inRange))).toBeUndefined();
    expect(a._read(1).re).toBe(inRange);
    expect(errorCode(a._store(2, ce.number(outOfRange)))).toBe(
      'incompatible-type'
    );
    expect(errorCode(a._store(2, ce.number(1.5)))).toBe('incompatible-type');
    expect(a._read(2).re).toBe(1);
  });

  test('the check is against the cell type, not the storage', () => {
    const a = array('integer<0..100>', [0]);
    expect(a.cells).toBeInstanceOf(Uint8Array);
    expect(a._store(1, ce.number(200))?.json).toEqual([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'integer<0..100>'", "'200'"],
      200,
    ]);
    expect(a._read(1).re).toBe(0);
    // The construction checks each element the same way.
    expect(
      errorCode(ce._array('integer<0..100>', { elements: [ce.number(200)] }))
    ).toBe('incompatible-type');
  });

  test('an integer with no bound has expression cells', () => {
    const a = array('integer', [1, 2]);
    expect(Array.isArray(a.cells)).toBe(true);
  });
});

describe('REAL CELLS', () => {
  test('a real cell holds the machine number of the value', () => {
    const a = array('real', [0]);
    expect(a.cells).toBeInstanceOf(Float64Array);
    expect(a._store(1, ce.box(['Rational', 1, 3]).evaluate())).toBeUndefined();
    expect(a._read(1).re).toBe(0.3333333333333333);
    expect(a._store(1, ce.box('Pi').evaluate())).toBeUndefined();
    expect(a._read(1).re).toBe(Math.PI);
    expect(a._store(1, ce.number(2))).toBeUndefined();
    expect(a._read(1).re).toBe(2);
  });

  test.each([
    ['NaN', () => ce.NaN],
    ['an infinity', () => ce.PositiveInfinity],
    ['a complex number', () => ce.box(['Complex', 1, 2]).evaluate()],
    ['a free symbol', () => ce.box('x').evaluate()],
  ])('%s is refused', (_, value) => {
    const a = array('real', [5]);
    expect(errorCode(a._store(1, value()))).toBe('incompatible-type');
    expect(a._read(1).re).toBe(5);
  });
});

describe('EXPRESSION CELLS', () => {
  test('a rational cell keeps the exact value', () => {
    const a = array('rational', [0]);
    expect(a._store(1, ce.box(['Rational', 1, 3]).evaluate())).toBeUndefined();
    expect(a._read(1).json).toEqual(['Rational', 1, 3]);
  });

  test('string cells', () => {
    const a = ce._array('string', { fill: ce.string('a'), count: 2 });
    if (!isMutableArray(a)) throw new Error('no array');
    expect(a._store(2, ce.string('b'))).toBeUndefined();
    expect(a._read(2).string).toBe('b');
    expect(errorCode(a._store(1, ce.number(1)))).toBe('incompatible-type');
  });

  test('a cell holds an object by reference', () => {
    const o = ce._object('P', { n: ce.number(1) });
    const a = array('any', [o]);
    expect(a._read(1)).toBe(o);
    if (o.operator !== 'Object') throw new Error('no object');
    (o as any)._store('n', ce.number(2));
    expect((a._read(1) as any)._field('n').re).toBe(2);
  });
});

describe('THE VALUES OF THE CONSTRUCTION', () => {
  test('each element and the fill are evaluated once', () => {
    ce.assign('x', 1);
    const e = ce._array('integer', { elements: [ce.symbol('x')] });
    const f = ce._array('integer', { fill: ce.symbol('x'), count: 2 });
    if (!isMutableArray(e) || !isMutableArray(f)) throw new Error('no array');
    expect(e.cells[0]).toBe(ce.number(1));
    expect(f.cells[1]).toBe(ce.number(1));
    ce.assign('x', 2);
    expect(e._read(1).re).toBe(1);
    expect(f._read(2).re).toBe(1);
  });

  test('a machine cell takes a symbol whose value is in range', () => {
    ce.assign('x', 7);
    const a = ce._array('integer<0..255>', { elements: [ce.symbol('x')] });
    if (!isMutableArray(a)) throw new Error(`no array: ${a.toString()}`);
    expect(Array.from(a.cells as Uint8Array)).toEqual([7]);
  });
});

describe('ALIASES AND DECLARED TYPES', () => {
  test('a new declaration of an alias does not change an existing array', () => {
    executeEpsil(ce, 'type alias Byte = integer<0..255>');
    const a = array('Byte', [1]);
    expect(a.cells).toBeInstanceOf(Uint8Array);
    executeEpsil(ce, 'type alias Byte = integer<0..65535>');
    expect(ce.number(300).type.matches(ce.type('Byte'))).toBe(true);
    expect(errorCode(a._store(1, ce.number(300)))).toBe('incompatible-type');
    expect(a.cells).toBeInstanceOf(Uint8Array);
    expect(a._read(1).re).toBe(1);
    expect(a.cellType.toString()).toBe('integer<0..255>');
    expect(a.type.toString()).toBe('array<integer<0..255>>');
    // A new array reads the new declaration.
    expect(array('Byte', [300]).cells).toBeInstanceOf(Uint16Array);
  });

  test('a nominal scalar cell type has expression cells', () => {
    ce.declareType('Byte', 'integer<0..255>');
    const b = ce.box(['Byte', 1]).evaluate();
    const a = array('Byte', [b]);
    expect(Array.isArray(a.cells)).toBe(true);
    expect(a._read(1).json).toEqual(['Byte', 1]);
    expect(errorCode(a._store(1, ce.number(1)))).toBe('incompatible-type');
    expect(
      errorCode(ce._array('Byte', { elements: [ce.number(1)] }))
    ).toBe('incompatible-type');
  });
});

describe('TUPLE CELLS', () => {
  test('four bytes for each cell, at 4(i - 1)', () => {
    const a = array('tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>', [
      tuple(1, 2, 3, 4),
      tuple(5, 6, 7, 8),
    ]);
    expect(a.cells).toBeInstanceOf(Uint8Array);
    expect(a.cells.length).toBe(4 * a.count);
    expect(Array.from(a.cells as Uint8Array)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(a._store(2, tuple(9, 10, 11, 12))).toBeUndefined();
    expect(Array.from(a.cells as Uint8Array)).toEqual([
      1, 2, 3, 4, 9, 10, 11, 12,
    ]);
    expect(a._read(-1).json).toEqual(['Tuple', 9, 10, 11, 12]);
    expect(errorCode(a._store(1, tuple(1, 2, 300, 4)))).toBe(
      'incompatible-type'
    );
    expect(errorCode(a._store(1, tuple(1, 2, 3)))).toBe('incompatible-type');
    expect(a._read(0).json).toEqual(['Tuple', 'NaN', 'NaN', 'NaN', 'NaN']);
  });

  test('a cell of a nominal tuple type reads a value of that type', () => {
    const pixel = ce.box(['Pixel', 1, 2, 3, 4]).evaluate();
    const a = array('Pixel', [pixel]);
    expect(a.cells).toBeInstanceOf(Uint8Array);
    const p = a._read(1);
    expect(p.json).toEqual(['Pixel', 1, 2, 3, 4]);
    expect(p.type.toString()).toBe('Pixel');
    // A plain tuple is not a `Pixel`.
    expect(errorCode(a._store(1, tuple(1, 2, 3, 4)))).toBe('incompatible-type');
    expect(a._read(5).json).toEqual(['Tuple', 'NaN', 'NaN', 'NaN', 'NaN']);
  });

  test('a non-empty array of tuple cells has the head of its cells', () => {
    const pixel = ce.box(['Pixel', 1, 2, 3, 4]).evaluate();
    expect(array('Pixel', [pixel]).has('Pixel')).toBe(true);
    expect(array('Pixel', []).has('Pixel')).toBe(false);
    const t4 =
      'tuple<integer<0..255>, integer<0..255>, integer<0..255>, integer<0..255>>';
    expect(array(t4, [tuple(1, 2, 3, 4)]).has('Tuple')).toBe(true);
    expect(array(t4, [tuple(1, 2, 3, 4)]).has('Pixel')).toBe(false);
  });
});

describe('THE INDEX', () => {
  test('a negative index counts from the end', () => {
    const a = array('integer<0..255>', [10, 20, 30]);
    expect(a._read(-1).re).toBe(30);
    expect(a._read(-3).re).toBe(10);
    expect(a._store(-1, ce.number(31))).toBeUndefined();
    expect(a._read(3).re).toBe(31);
  });

  test.each([0, 4, -4, 1.5])('%s reads the absence value', (i) => {
    expect(array('integer<0..255>', [10, 20, 30])._read(i).isNaN).toBe(true);
    expect(array('real', [1, 2, 3])._read(i).isNaN).toBe(true);
    expect(array('integer', [1, 2, 3])._read(i).isNaN).toBe(true);
    expect(
      array('string', [ce.string('a'), ce.string('b'), ce.string('c')])._read(i)
        .symbol
    ).toBe('Missing');
    expect(array('boolean', [ce.True, ce.False, ce.True])._read(i).symbol).toBe(
      'Missing'
    );
  });

  test.each([0, 4, 1.5])('a store at %s is out of range', (i) => {
    const a = array('integer<0..255>', [10, 20, 30]);
    const v = a.version;
    expect(a._store(i, ce.number(1))?.json).toEqual([
      'Error',
      [
        'ErrorCode',
        "'out-of-range'",
        "'an index in 1..3 or -3..-1'",
        `'${i}'`,
      ],
    ]);
    expect(a.version).toBe(v);
  });
});

describe('IDENTITY', () => {
  test('two arrays with the same cells are not the same, nor equal', () => {
    const a = array('integer<0..255>', [1, 2]);
    const b = array('integer<0..255>', [1, 2]);
    expect(a.isSame(a)).toBe(true);
    expect(a.isSame(b)).toBe(false);
    expect(a.isEqual(a)).toBe(true);
    expect(a.isEqual(b)).toBe(false);
    expect(a.isEqual(ce.number(1))).toBe(false);
    expect(ce._fn('Tuple', [a]).isSame(ce._fn('Tuple', [b]))).toBe(false);
    expect(ce._fn('Tuple', [a]).isSame(ce._fn('Tuple', [a]))).toBe(true);
  });

  test('the hash does not change at a store', () => {
    const a = array('integer<0..255>', [1, 2]);
    const h = a.hash;
    a._store(1, ce.number(9));
    expect(a.hash).toBe(h);
    expect(array('integer<0..255>', [1, 2]).hash).not.toBe(h);
  });

  test('every path returns the same instance', () => {
    const a = array('integer<0..255>', [1, 2]);
    expect(a.evaluate()).toBe(a);
    expect(a.N()).toBe(a);
    expect(a.simplify()).toBe(a);
    expect(a.canonical).toBe(a);
    expect(a.subs({ x: 1 })).toBe(a);
    expect(a.operator).toBe('Array');
    expect(a.type.toString()).toBe('array<integer<0..255>>');
    expect(a.cellType.toString()).toBe('integer<0..255>');
    expect(a.isCollection).toBe(false);
  });

  test('a value of another engine is refused', () => {
    const other = new ComputeEngine();
    const o = other._object('P', {});
    const a = array('any', [1]);
    expect(() => a._store(1, o)).toThrow('object-foreign-engine');
  });
});

describe('THE VERSION', () => {
  test('a store that changes a cell increments it; a redundant one does not', () => {
    const a = array('integer<0..255>', [1, 2]);
    const e = array('any', [ce.number(1)]);
    expect(a.version).toBe(0);
    const epoch = ce._objectStoreEpoch;
    a._store(1, ce.number(5));
    expect(a.version).toBe(1);
    expect(ce._objectStoreEpoch).toBe(epoch + 1);
    a._store(1, ce.number(5));
    expect(a.version).toBe(1);
    e._store(1, ce.number(1));
    expect(e.version).toBe(0);
    e._store(1, ce.number(2));
    expect(e.version).toBe(1);
    expect(ce._objectStoreEpoch).toBe(epoch + 2);
  });

  test('-0 over 0 in an integer cell changes nothing', () => {
    const a = array('integer<-128..127>', [0]);
    // `ce.number(-0)` boxes `0`: a number whose `re` is `-0` is made here.
    const zero = ce.number(0);
    const negativeZero = new Proxy(zero, {
      get: (t, k) => (k === 're' ? -0 : Reflect.get(t, k, t)),
    });
    expect(Object.is(negativeZero.re, -0)).toBe(true);
    expect(a._store(1, negativeZero)).toBeUndefined();
    expect(a.version).toBe(0);
    expect(Object.is(a.cells[0], 0)).toBe(true);
  });

  test('a cached value that read a cell is not served after a store', () => {
    const a = array('integer<0..255>', [1, 2]);
    const slot: { value: number | null; generation: number | undefined } = {
      value: null,
      generation: undefined,
    };
    let runs = 0;
    const compute = () =>
      cachedValue(
        slot,
        1,
        () => {
          runs += 1;
          return a._read(1).re * 10;
        },
        undefined,
        ce
      );
    expect(compute()).toBe(10);
    expect(compute()).toBe(10);
    expect(runs).toBe(1);
    a._store(1, ce.number(3));
    expect(compute()).toBe(30);
    expect(runs).toBe(2);
  });
});

describe('THE EXCHANGE', () => {
  test('exchanges the cells and the counts, and keeps the identities', () => {
    const a = array('integer<0..255>', [1, 2]);
    const b = array('integer<0..255>', [7, 8, 9]);
    const [ca, cb] = [a.cells, b.cells];
    const epoch = ce._objectStoreEpoch;
    expect(a._swapWith(b as any)).toBe(true);
    expect(a.cells).toBe(cb);
    expect(b.cells).toBe(ca);
    expect(a.count).toBe(3);
    expect(b.count).toBe(2);
    expect(a._read(3).re).toBe(9);
    expect(a.version).toBe(1);
    expect(b.version).toBe(1);
    expect(ce._objectStoreEpoch).toBe(epoch + 1);
  });

  test('two cell types are refused; the same array is a no-op', () => {
    const a = array('integer<0..255>', [1]);
    const b = array('integer<0..100>', [1]);
    expect(a._swapWith(b as any)).toBe(false);
    expect(a.version).toBe(0);
    expect(a._swapWith(a as any)).toBe(true);
    expect(a.version).toBe(0);
  });
});

describe('SERIALIZATION AND DISPLAY', () => {
  test('.json is the Object form', () => {
    const a = array('integer<0..255>', [1, 2, 3]);
    expect(a.json).toEqual([
      'Object',
      ['List', 1, 2, 3],
      "'array<integer<0..255>>'",
    ]);
    expect(ce._fn('List', [a]).json).toEqual([
      'List',
      ['Object', ['List', 1, 2, 3], "'array<integer<0..255>>'"],
    ]);
  });

  test('an array that holds itself gives a cycle marker', () => {
    const a = array('any', [1, 2]);
    a._store(2, a);
    expect(a.json).toEqual([
      'Object',
      ['List', 1, ['CircularReference', 1, "'array<any>'"]],
      "'array<any>'",
    ]);
    expect(a.toString()).toBe('arrayFrom([1, array<any> of 2], "any")');
  });

  test('a short array displays as its constructor', () => {
    expect(array('integer<0..255>', [1, 2, 3]).toString()).toBe(
      'arrayFrom([1, 2, 3], "integer<0..255>")'
    );
    const pixel = ce.box(['Pixel', 1, 2, 3, 4]).evaluate();
    expect(array('Pixel', [pixel]).toString()).toBe(
      'arrayFrom([Pixel(1, 2, 3, 4)], "Pixel")'
    );
  });

  test('a long array displays as its type and count, and reads no cell', () => {
    const a = ce._array('integer<0..255>', {
      fill: ce.number(7),
      count: 64000,
    });
    if (!isMutableArray(a)) throw new Error('no array');
    let peeks = 0;
    const peek = a._peek.bind(a);
    (a as any)._peek = (i: number) => {
      peeks += 1;
      return peek(i);
    };
    const s = a.toString();
    expect(s).toBe('array<integer<0..255>> of 64000');
    expect(peeks).toBe(0);
    void a.hash;
    a.isSame(array('integer<0..255>', [1]));
    expect(peeks).toBe(0);
  });

  test('.latex of a long array is its type and count, also nested', () => {
    const a = ce._array('integer<0..255>', {
      fill: ce.number(7),
      count: 64000,
    });
    if (!isMutableArray(a)) throw new Error('no array');
    let peeks = 0;
    const peek = a._peek.bind(a);
    (a as any)._peek = (i: number) => {
      peeks += 1;
      return peek(i);
    };
    const latex = a.latex;
    expect(latex).toContain('64000');
    expect(latex).toContain('integer');
    expect(latex.length).toBeLessThan(200);
    const nested = ce._fn('Tuple', [ce.number(1), a]);
    expect(nested.latex.length).toBeLessThan(200);
    expect(nested.toLatex().length).toBeLessThan(200);
    expect(ce._fn('List', [a]).latex.length).toBeLessThan(200);
    expect(peeks).toBe(0);
    // `.json` still writes the cells.
    expect((a.json as any)[1].length).toBe(64001);
  });

  test('.latex of a canonical tuple that holds a long array takes no JSON of the array', () => {
    const a = ce._array('integer<0..255>', {
      fill: ce.number(7),
      count: 64000,
    });
    if (!isMutableArray(a)) throw new Error('no array');
    // The `.json` of an array writes every cell. The options of the LaTeX
    // serializer key each operand of a `Tuple` by its JSON: they must not
    // take the one of an array.
    let jsonReads = 0;
    Object.defineProperty(a, 'json', {
      get() {
        jsonReads += 1;
        return ['Object', ['List'], "'array<integer<0..255>>'"];
      },
    });
    const pair = ce.function('Tuple', [ce.number(1), a]);
    expect(pair.isCanonical).toBe(true);
    const latex = pair.latex;
    expect(latex).toContain('64000');
    expect(latex.length).toBeLessThan(200);
    expect(pair.toLatex().length).toBeLessThan(200);
    expect(jsonReads).toBe(0);
  });

  test('.latex of a short array lists its cells', () => {
    const latex = array('integer<0..255>', [11, 22, 33]).latex;
    expect(latex).toContain('11');
    expect(latex).toContain('22');
    expect(latex).toContain('33');
  });

  test('the digest reads the content', () => {
    const a = array('integer<0..255>', [1]);
    const d = a.digest;
    a._store(1, ce.number(2));
    expect(a.digest).not.toBe(d);
  });
});

describe('CONTAINMENT', () => {
  test('an array, and a list or a tuple that holds one, contain an object', () => {
    const a = array('integer<0..255>', [1]);
    expect(containsObject(a)).toBe(true);
    expect(containsObject(ce._fn('List', [a]))).toBe(true);
    expect(containsObject(ce._fn('Tuple', [ce.number(1), a]))).toBe(true);
    expect(containsObject(ce._fn('List', [ce.number(1)]))).toBe(false);
  });
});

describe('THE EMPTY ARRAY', () => {
  test('an array of no cell', () => {
    const a = array('integer<0..255>', []);
    expect(a.count).toBe(0);
    expect(a.cells.length).toBe(0);
    expect(a._read(1).isNaN).toBe(true);
    expect(errorCode(a._store(1, ce.number(1)))).toBe('out-of-range');
    expect(a.json).toEqual(['Object', ['List'], "'array<integer<0..255>>'"]);
    expect(a.toString()).toBe('arrayFrom([], "integer<0..255>")');
    const t = ce._array('Pixel', { fill: ce.box(['Pixel', 1, 2, 3, 4]).evaluate(), count: 0 });
    if (!isMutableArray(t)) throw new Error('no array');
    expect(t.cells.length).toBe(0);
  });
});
