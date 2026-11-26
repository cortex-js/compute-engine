/**
 * The host interface of a mutable array
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 9, and the
 * interpreter halves of acceptance cases 8, 10 and 11): `ce.array()`, the
 * public members of an array, `ce.arrayAllocation`, `ce.arrayCreated` and the
 * option `objects` of `toMathJson()`.
 *
 * The tests use the public API only, as a host does.
 */
import {
  ComputeEngine,
  isFunction,
  isMutableArray,
} from '../../src/compute-engine';
import type {
  ArrayCells,
  ArrayInterface,
  BoxedArray,
  Expression,
  MathJsonExpression,
} from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** The value of the Epsil program `source`. */
function run(source: string): Expression {
  return executeEpsil(ce, source).value!;
}

/** The error code of an error expression, or `undefined`. */
function errorCode(x: Expression | undefined): string | undefined {
  if (x === undefined || x.operator !== 'Error') return undefined;
  const code = (x.json as any)?.[1];
  return (typeof code === 'string' ? code : code?.[1])?.replace(/'/g, '');
}

function asArray(x: Expression): Expression & ArrayInterface {
  if (!isMutableArray(x)) throw new Error(`no array: ${x.toString()}`);
  return x;
}

function declarePixel(): void {
  run(`type alias Byte = integer<0..255>
type Pixel = tuple<r: Byte, g: Byte, b: Byte, a: Byte>`);
}

describe('ce.array()', () => {
  // Acceptance case 10.
  test('adopts the storage: the reference is the same', () => {
    const storage = new Uint32Array(1000);
    const a = ce.array(storage);
    expect(a.cells).toBe(storage);
    expect(a.count).toBe(1000);
    expect(a.cellType.toString()).toBe('integer<0..4294967295>');
    expect(a.type.toString()).toBe('array<integer<0..4294967295>>');
  });

  test.each([
    [new Uint8Array(3), 'integer<0..255>'],
    [new Int8Array(3), 'integer<-128..127>'],
    [new Uint16Array(3), 'integer<0..65535>'],
    [new Int16Array(3), 'integer<-32768..32767>'],
    [new Uint32Array(3), 'integer<0..4294967295>'],
    [new Int32Array(3), 'integer<-2147483648..2147483647>'],
    [new Float64Array(3), 'real'],
  ])('the default cell type of a %p is %s', (storage, cellType) => {
    const a = ce.array(storage);
    expect(a.cellType.toString()).toBe(cellType);
    expect(a.cells).toBe(storage);
    expect(a.count).toBe(3);
  });

  test('a cell type of the storage kind', () => {
    const a = ce.array(new Uint8Array([1, 2, 3]), 'integer<0..100>');
    expect(a.cellType.toString()).toBe('integer<0..100>');
    expect(ce.array(new Float64Array(2), 'real<0..1>').count).toBe(2);
  });

  test('a read gives the cells of the storage', () => {
    ce.assign('a', ce.array(new Int16Array([-5, 7, 300])));
    expect(run('[a[1], a[2], a[3]]').json).toEqual(['List', -5, 7, 300]);
  });

  test('a tuple cell type: four bytes for each cell', () => {
    declarePixel();
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = ce.array(bytes, 'Pixel');
    expect(a.count).toBe(2);
    expect(a.cells).toBe(bytes);
    expect(a.cells.length).toBe(4 * a.count);
    ce.assign('img', a);
    expect(run('img[2]').json).toEqual(['Pixel', 5, 6, 7, 8]);
    expect(run('img[1].g').json).toBe(2);
    expect(() => ce.array(new Uint8Array(5), 'Pixel')).toThrow(
      /holds 4 bytes for each cell: its length, 5, is not a multiple of 4/
    );
  });

  test('a tuple cell type declared with the type API', () => {
    ce.declareType(
      'Rgba',
      'tuple<r: integer<0..255>, g: integer<0..255>, b: integer<0..255>, a: integer<0..255>>'
    );
    const a = ce.array(new Uint8Array(12), 'Rgba');
    expect(a.count).toBe(3);
  });

  test('throws a TypeError for a Uint8ClampedArray, with the remedy', () => {
    const data = new Uint8ClampedArray(8);
    expect(() => ce.array(data as any)).toThrow(TypeError);
    expect(() => ce.array(data as any)).toThrow(
      'pass new Uint8Array(data.buffer, data.byteOffset, data.byteLength)'
    );
    // The remedy shares the bytes.
    const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    expect(ce.array(view).cells).toBe(view);
  });

  test.each([
    ['Float32Array', new Float32Array(2)],
    ['BigInt64Array', new BigInt64Array(2)],
    ['BigUint64Array', new BigUint64Array(2)],
  ])('throws a TypeError for a %s', (name, storage) => {
    expect(() => ce.array(storage as any)).toThrow(TypeError);
    expect(() => ce.array(storage as any)).toThrow(
      `a ${name} is not a storage of an array`
    );
  });

  test('throws a TypeError for a value that is not a typed array', () => {
    for (const x of [[1, 2, 3], 42, null, new DataView(new ArrayBuffer(4))]) {
      expect(() => ce.array(x as any)).toThrow(TypeError);
      expect(() => ce.array(x as any)).toThrow(/the storage must be a Uint8Array/);
    }
  });

  test('throws a TypeError for a view of a SharedArrayBuffer', () => {
    const shared = new Uint8Array(new SharedArrayBuffer(4));
    expect(() => ce.array(shared)).toThrow(TypeError);
    expect(() => ce.array(shared)).toThrow(/view of a SharedArrayBuffer/);
  });

  test('throws a TypeError for a cell type of another storage kind', () => {
    expect(() => ce.array(new Uint8Array(4), 'integer<0..65535>')).toThrow(
      'the storage of an array<integer<0..65535>> must be a Uint16Array, not a Uint8Array'
    );
    expect(() => ce.array(new Float64Array(4), 'integer<0..255>')).toThrow(
      TypeError
    );
    declarePixel();
    expect(() => ce.array(new Uint32Array(4), 'Pixel')).toThrow(TypeError);
  });

  test('throws a TypeError for a cell type with expression cells', () => {
    for (const t of ['integer', 'number', 'string', 'any']) {
      expect(() => ce.array(new Float64Array(2), t)).toThrow(TypeError);
      expect(() => ce.array(new Float64Array(2), t)).toThrow(
        `the cell type ${t} has expression cells`
      );
    }
  });

  test('calls neither the allocation function nor arrayCreated', () => {
    const allocation = jest.fn(() => true);
    const created = jest.fn();
    ce.arrayAllocation = allocation;
    ce.arrayCreated = created;
    ce.array(new Uint8Array(10));
    expect(allocation).not.toHaveBeenCalled();
    expect(created).not.toHaveBeenCalled();
  });
});

describe('A HOST WRITE AND noteStore()', () => {
  // Acceptance case 8, the host part.
  test('the version increases and a pure function reads the new cell', () => {
    run('function f(x) pure { x[1] }');
    const a = ce.array(new Uint8Array([1, 2, 3]));
    ce.assign('a', a);
    const call = ce.box(['f', 'a']);
    expect(call.evaluate().json).toBe(1);
    expect(call.evaluate().json).toBe(1);
    const v0 = a.version;
    (a.cells as Uint8Array)[0] = 42;
    a.noteStore();
    expect(a.version).toBe(v0 + 1);
    expect(call.evaluate().json).toBe(42);
    expect(run('f(a)').json).toBe(42);
  });

  test('an expression of the array gives the new cell', () => {
    const a = ce.array(new Float64Array(2));
    ce.assign('a', a);
    const r1 = run('a[2] + 1');
    expect(r1.json).toBe(1);
    (a.cells as Float64Array)[1] = 0.5;
    a.noteStore();
    expect(run('a[2] + 1').json).toBe(1.5);
  });
});

describe('swapCells()', () => {
  test('exchanges the storages, returns the old one, and is a store', () => {
    const front = new Uint8Array([1, 2, 3]);
    const back = new Uint8Array([7, 8, 9]);
    const a = ce.array(front);
    ce.assign('a', a);
    run('function f(x) pure { x[1] }');
    expect(run('f(a)').json).toBe(1);
    const v0 = a.version;
    const old = a.swapCells(back);
    expect(old).toBe(front);
    expect(a.cells).toBe(back);
    expect(a.version).toBe(v0 + 1);
    expect(a.count).toBe(3);
    expect(run('f(a)').json).toBe(7);
    expect(a.swapCells(old)).toBe(back);
    expect(run('f(a)').json).toBe(1);
  });

  test('a tuple cell takes a storage of the same length in bytes', () => {
    declarePixel();
    const a = ce.array(new Uint8Array(8), 'Pixel');
    const next = new Uint8Array([9, 9, 9, 9, 1, 2, 3, 4]);
    a.swapCells(next);
    ce.assign('img', a);
    expect(run('img[2]').json).toEqual(['Pixel', 1, 2, 3, 4]);
  });

  test('refuses another kind, another length, a shared view', () => {
    const a = ce.array(new Uint8Array(4));
    expect(() => a.swapCells(new Uint16Array(4) as any)).toThrow(TypeError);
    expect(() => a.swapCells(new Uint16Array(4) as any)).toThrow(
      'must be a Uint8Array, not a Uint16Array'
    );
    expect(() => a.swapCells(new Uint8Array(5))).toThrow(TypeError);
    expect(() => a.swapCells(new Uint8Array(5))).toThrow(
      'the length of the cells, 4, not 5'
    );
    expect(() =>
      a.swapCells(new Uint8Array(new SharedArrayBuffer(4)))
    ).toThrow(/SharedArrayBuffer/);
    expect(a.version).toBe(0);
  });

  test('refuses an array of expression cells', () => {
    const a = asArray(ce.box(['ArrayFrom', ['List', 1, 2]]).evaluate());
    expect(() => a.swapCells(new Float64Array(2))).toThrow(TypeError);
    expect(() => a.swapCells(new Float64Array(2))).toThrow(
      /has expression cells/
    );
  });
});

describe('ce.arrayAllocation', () => {
  // Acceptance case 10.
  test('receives the count and the bytes of a cell', () => {
    const calls: [number, number][] = [];
    ce.arrayAllocation = (count, bytes) => {
      calls.push([count, bytes]);
      return true;
    };
    const n = 1000;
    run(`arrayFrom(repeat(0, ${n}), "integer<0..4294967295>")`);
    declarePixel();
    run(`arrayFrom(repeat(Pixel(1, 2, 3, 4), ${n}), "Pixel")`);
    run(`arrayFrom(repeat(0, ${n}), "integer")`);
    expect(calls).toEqual([
      [n, 4],
      [n, 4],
      [n, 8],
    ]);
  });

  test('its refusal is array-allocation-refused', () => {
    ce.arrayAllocation = () => false;
    expect(errorCode(run('arrayFrom(repeat(0, 10), "integer<0..255>")'))).toBe(
      'array-allocation-refused'
    );
  });
});

describe('ce.arrayCreated', () => {
  test('receives the array that arrayFrom made', () => {
    const created: (Expression & ArrayInterface)[] = [];
    ce.arrayCreated = (a) => created.push(a);
    const a = run('arrayFrom([1, 2, 3], "integer<0..255>")');
    expect(created.length).toBe(1);
    expect(created[0]).toBe(a);
  });

  test('is not called for a construction that failed', () => {
    const created = jest.fn();
    ce.arrayCreated = created;
    expect(errorCode(run('arrayFrom([1, 300], "integer<0..255>")'))).toBe(
      'incompatible-type'
    );
    ce.arrayAllocation = () => false;
    run('arrayFrom([1, 2], "integer<0..255>")');
    expect(created).not.toHaveBeenCalled();
  });

  test('an exception that it throws propagates', () => {
    ce.arrayCreated = () => {
      throw new Error('too many bytes alive');
    };
    expect(() =>
      ce.box(['ArrayFrom', ['List', 1, 2], { str: 'integer<0..255>' }]).evaluate()
    ).toThrow('too many bytes alive');
  });
});

describe('toMathJson({ objects })', () => {
  /** A host function that replaces each array with a reference of its own,
   * and counts the arrays it met. */
  function replacer(): {
    objects: (value: Expression) => MathJsonExpression | undefined;
    met: Expression[];
  } {
    const met: Expression[] = [];
    return {
      met,
      objects: (value) => {
        if (!isMutableArray(value)) return undefined;
        met.push(value);
        return ['HostRaster', met.length - 1];
      },
    };
  }

  // Acceptance case 11.
  test('writes the replacement at the top level, in a tuple, a list, a field', () => {
    const a = ce.array(new Uint8Array([1, 2, 3]));
    let r = replacer();
    expect(a.toMathJson({ objects: r.objects })).toEqual(['HostRaster', 0]);
    expect(r.met).toEqual([a]);

    r = replacer();
    expect(ce.box(['Tuple', a, 5]).toMathJson({ objects: r.objects })).toEqual([
      'Pair',
      ['HostRaster', 0],
      5,
    ]);

    r = replacer();
    expect(ce.box(['List', a, a]).toMathJson({ objects: r.objects })).toEqual([
      'List',
      ['HostRaster', 0],
      ['HostRaster', 1],
    ]);

    ce.assign('r', a);
    const figure = run(`type Figure = object{w: integer, raster: array<integer<0..255>>}
Figure(w: 3, raster: r)`);
    r = replacer();
    expect(figure.toMathJson({ objects: r.objects })).toEqual([
      'Object',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'w' }, 3],
        ['KeyValuePair', { str: 'raster' }, ['HostRaster', 0]],
      ],
      "'Figure'",
    ]);
    expect(r.met).toEqual([a]);
  });

  test('a string reference', () => {
    const a = ce.array(new Uint8Array(4));
    expect(
      ce
        .box(['List', a])
        .toMathJson({ objects: () => ({ str: 'raster:42' }) })
    ).toEqual(['List', { str: 'raster:42' }]);
  });

  test('a nested array in a cell and in a dictionary', () => {
    const inner = ce.array(new Uint8Array(2));
    ce.assign('inner', inner);
    const outer = run('arrayFrom([inner], "any")');
    const r = replacer();
    expect(outer.toMathJson({ objects: (v) => (v === inner ? 'INNER' : undefined) })).toEqual([
      'Object',
      ['List', 'INNER'],
      "'array<any>'",
    ]);
    const dict = ce.box(['Dictionary', ['KeyValuePair', { str: 'k' }, inner]]);
    expect(JSON.stringify(dict.toMathJson({ objects: r.objects }))).toContain(
      '["HostRaster",0]'
    );
  });

  test('reads no cell of the array', () => {
    const storage = new Uint8Array(5_000_000);
    const a = ce.array(storage);
    const cells = jest.spyOn(a, 'cells', 'get');
    const start = Date.now();
    const json = ce.box(['Tuple', a, 1]).toMathJson({
      objects: () => ['HostRaster', 1],
    });
    expect(Date.now() - start).toBeLessThan(200);
    expect(json).toEqual(['Pair', ['HostRaster', 1], 1]);
    expect(cells).not.toHaveBeenCalled();
    // The spy sees the read of the default form.
    void a.toMathJson({ objects: () => undefined });
    expect(cells).toHaveBeenCalled();
  });

  test('with undefined, writes the default form', () => {
    const a = ce.array(new Uint8Array([1, 2, 3]));
    expect(a.toMathJson({ objects: () => undefined })).toEqual([
      'Object',
      ['List', 1, 2, 3],
      "'array<integer<0..255>>'",
    ]);
    expect(a.json).toEqual(a.toMathJson({ objects: () => undefined }));
  });

  test('the display of a long array is unchanged', () => {
    const a = ce.array(new Uint8Array(64000));
    expect(a.latex).toContain('64000');
  });
});

describe('HOST FUNCTIONS', () => {
  test('a host function receives the array itself', () => {
    const received: Expression[] = [];
    ce.declare('draw', {
      signature: '(array<integer<0..255>>) -> nothing',
      evaluate: (ops) => {
        received.push(ops[0]);
        return ce.Nothing;
      },
    });
    const a = ce.array(new Uint8Array([1, 2, 3]));
    ce.assign('a', a);
    run('draw(a)');
    expect(received.length).toBe(1);
    expect(received[0]).toBe(a);
  });

  test('a host function of a bare array receives the array', () => {
    ce.declare('cellCount', {
      signature: '(array) -> integer',
      evaluate: (ops) => {
        const x = ops[0];
        return ce.number(isMutableArray(x) ? x.count : -1);
      },
    });
    const a = ce.array(new Float64Array(7));
    ce.assign('a', a);
    expect(run('cellCount(a)').json).toBe(7);
  });

  test('an array inside a tuple or a list arrives by reference', () => {
    const received: Expression[] = [];
    ce.declare('take', {
      signature: '(any) -> nothing',
      evaluate: (ops) => {
        received.push(ops[0]);
        return ce.Nothing;
      },
    });
    const a = ce.array(new Uint8Array([1, 2]));
    ce.assign('a', a);
    run('take((a, 1))');
    run('take([a, a])');
    const ops = (x: Expression) => (isFunction(x) ? x.ops : []);
    expect(ops(received[0])[0]).toBe(a);
    expect(ops(received[1])[0]).toBe(a);
    expect(ops(received[1])[1]).toBe(a);
  });

  test('a host function returns an array made with ce.array()', () => {
    const storage = new Uint8Array([4, 5, 6]);
    ce.declare('makeRaster', {
      signature: '() -> array<integer<0..255>>',
      evaluate: () => ce.array(storage),
    });
    const v = run('let r = makeRaster()\nr[2] = 9\nr');
    expect(isMutableArray(v)).toBe(true);
    expect(asArray(v).cells).toBe(storage);
    expect(storage[1]).toBe(9);
  });
});

describe('ARRAYS OF ANOTHER ENGINE', () => {
  test('are refused by box, assign and a host call', () => {
    const other = new ComputeEngine();
    const foreign = other.array(new Uint8Array(3));
    expect(errorCode(ce.box(foreign))).toBe('object-foreign-engine');
    expect(errorCode(ce.box(['Tuple', foreign, 1]))).toBe(
      'object-foreign-engine'
    );
    expect(() => ce.assign('a', foreign)).toThrow(/object-foreign-engine/);
    const draw = jest.fn(() => ce.Nothing);
    ce.declare('draw', {
      signature: '(array<integer<0..255>>) -> nothing',
      evaluate: draw,
    });
    expect(errorCode(ce.box(['draw', foreign]).evaluate())).toBe(
      'object-foreign-engine'
    );
    expect(errorCode(ce.function('draw', [foreign]).evaluate())).toBe(
      'object-foreign-engine'
    );
    expect(draw).not.toHaveBeenCalled();
  });
});

describe('THE PUBLIC TYPES', () => {
  test('isMutableArray narrows to the array interface', () => {
    const x: Expression = ce.array(new Float64Array(2));
    if (isMutableArray(x)) {
      // Compile-time uses: these lines type-check only on the narrowed type.
      const cells: ArrayInterface['cells'] = x.cells;
      const n: number = x.count;
      const version: number = x.version;
      const back: Float64Array = x.swapCells(new Float64Array(2));
      x.noteStore();
      expect(cells.length + n + version).toBeGreaterThan(0);
      expect(back).toBeInstanceOf(Float64Array);
    } else throw new Error('expected an array');
    const typed: BoxedArray | undefined = undefined;
    const storage: ArrayCells = new Uint8Array(1);
    expect(typed).toBeUndefined();
    expect(storage.length).toBe(1);
  });
});

describe('THE STORAGE CHECKS', () => {
  test('the exchange loop of the documentation type-checks and exchanges', () => {
    const a = ce.array(new Uint8Array([1, 2, 3, 4]));
    let back = new Uint8Array(a.cells.length);
    back[0] = 9;
    // The result has the type of the argument: no cast in the loop.
    back = a.swapCells(back);
    expect(Array.from(back)).toEqual([1, 2, 3, 4]);
    expect(a.cells[0]).toBe(9);
  });

  test('swapCells() takes a storage typed as the union of the kinds', () => {
    const exchange = (
      x: ReturnType<typeof ce.array>,
      storage: Parameters<typeof ce.array>[0]
    ) => x.swapCells(storage);
    const a = ce.array(new Uint16Array(2));
    const next = new Uint16Array([5, 6]);
    expect(exchange(a, next)).toBeInstanceOf(Uint16Array);
    expect(a.cells).toBe(next);
  });

  test('the cells returned for a subclass instance are a plain typed array', () => {
    const a = ce.array(new Uint8Array(4));
    const old = a.swapCells(Buffer.alloc(4));
    expect(Buffer.isBuffer(old)).toBe(false);
    expect(old).toBeInstanceOf(Uint8Array);
  });

  test('a typed array of another realm is adopted and swapped', () => {
    const vm = require('node:vm');
    const foreign = vm.runInNewContext('new Uint8Array([1, 2, 3])');
    expect(foreign instanceof Uint8Array).toBe(false);
    const a = ce.array(foreign);
    expect(a.cells).toBe(foreign);
    expect(a.cellType.toString()).toBe('integer<0..255>');
    ce.assign('a', a);
    expect(run('a[2]').json).toBe(2);
    const next = vm.runInNewContext('new Uint8Array([7, 8, 9])');
    expect(a.swapCells(next)).toBe(foreign);
    expect(run('a[2]').json).toBe(8);
    const reals = ce.array(
      vm.runInNewContext('new Float64Array([0.5, 1.5])'),
      'real'
    );
    expect(reals.count).toBe(2);
  });

  test('the refusals hold for values of another realm', () => {
    const vm = require('node:vm');
    const clamped = vm.runInNewContext('new Uint8ClampedArray(8)');
    expect(() => ce.array(clamped)).toThrow(TypeError);
    expect(() => ce.array(clamped)).toThrow('pass new Uint8Array(data.buffer');
    for (const source of [
      'new Float32Array(2)',
      'new BigInt64Array(2)',
      'new BigUint64Array(2)',
    ]) {
      const x = vm.runInNewContext(source);
      expect(() => ce.array(x)).toThrow(TypeError);
      expect(() => ce.array(x)).toThrow('is not a storage of an array');
    }
    for (const source of ['new DataView(new ArrayBuffer(4))', '[1, 2, 3]']) {
      const x = vm.runInNewContext(source);
      expect(() => ce.array(x)).toThrow(TypeError);
      expect(() => ce.array(x)).toThrow(/the storage must be a Uint8Array/);
    }
    const a = ce.array(new Uint8Array(4));
    const wide = vm.runInNewContext('new Uint16Array(4)');
    expect(() => a.swapCells(wide)).toThrow(
      'must be a Uint8Array, not a Uint16Array'
    );
  });

  // `new ArrayBuffer(length, { maxByteLength })` is ES2024 (Node 20).
  const resizable = (() => {
    try {
      const buffer = new (ArrayBuffer as any)(8, { maxByteLength: 16 });
      return buffer.resizable === true ? buffer : undefined;
    } catch {
      return undefined;
    }
  })();
  (resizable === undefined ? test.skip : test)(
    'refuses a view of a resizable ArrayBuffer',
    () => {
      const view = new Uint8Array(resizable);
      expect(() => ce.array(view)).toThrow(TypeError);
      expect(() => ce.array(view)).toThrow(/resizable ArrayBuffer/);
      const a = ce.array(new Uint8Array(8));
      expect(() => a.swapCells(view)).toThrow(TypeError);
      expect(() => a.swapCells(view)).toThrow(/resizable ArrayBuffer/);
      expect(a.version).toBe(0);
    }
  );

  test('swapCells() throws a TypeError for a value that is not a typed array', () => {
    const a = ce.array(new Uint8Array(4));
    for (const x of [null, undefined, 42, [1, 2, 3, 4]]) {
      expect(() => a.swapCells(x as any)).toThrow(TypeError);
      expect(() => a.swapCells(x as any)).toThrow(/must be a Uint8Array, not/);
    }
    expect(a.version).toBe(0);
  });
});
