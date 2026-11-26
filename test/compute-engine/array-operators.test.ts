/**
 * The operators that make and read a mutable array: `ArrayFrom`, `Swap`,
 * `At`, `Length` and `ListFrom` (`docs/plans/2026-11-25-mutable-arrays-spec.md`,
 * sections 2, 4, 5 and 6, and acceptance cases 1, 2, 4, 4a, 5 and 12a, the
 * interpreter halves). The store is in `array-store.test.ts`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { ArrayInterface } from '../../src/compute-engine/types-expression';
import { isMutableArray } from '../../src/compute-engine/boxed-expression/type-guards';
import { executeEpsil } from '../../src/epsil/execute-epsil';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

type Arr = Expression & ArrayInterface;

/** The value of the Epsil program `source`. */
function run(source: string): Expression {
  return executeEpsil(ce, source).value!;
}

/** The value of the MathJSON expression `json`. */
function evaluate(json: unknown): Expression {
  return ce.box(json as any).evaluate();
}

/** The error code of an error expression, or `undefined`. */
function errorCode(x: Expression | undefined): string | undefined {
  if (x === undefined || x.operator !== 'Error') return undefined;
  return x.json?.[1]?.[1]?.replace(/'/g, '');
}

function asArray(x: Expression): Arr {
  if (!isMutableArray(x)) throw new Error(`no array: ${x.toString()}`);
  return x;
}

/** Assign the array of `values` to the name `a` at the top level. */
function assignArray(values: number[], cellType?: string): Arr {
  const a = asArray(
    evaluate([
      'ArrayFrom',
      ['List', ...values],
      ...(cellType === undefined ? [] : [{ str: cellType }]),
    ])
  );
  ce.assign('a', a);
  return a;
}

describe('CONSTRUCTION', () => {
  test('an empty list gives an array<any> of no cell', () => {
    const a = asArray(run('arrayFrom([])'));
    expect(a.type.toString()).toBe('array<any>');
    expect(a.count).toBe(0);
  });

  test('a list of numbers gives an array<number> of expression cells', () => {
    const a = asArray(run('arrayFrom([0, 0])'));
    expect(a.type.toString()).toBe('array<number>');
    expect(Array.isArray(a.cells)).toBe(true);
    expect(a.count).toBe(2);
  });

  test('the type at canonicalization is array<T>', () => {
    expect(ce.box(['ArrayFrom', ['List', 1, 2]]).type.toString()).toBe(
      'array<number>'
    );
    expect(
      ce
        .box(['ArrayFrom', ['Repeat', 0, 4], { str: 'integer<0..255>' }])
        .type.toString()
    ).toBe('array<integer<0..255>>');
    expect(ce.box(['ArrayFrom', ['List']]).type.toString()).toBe('array<any>');
  });

  test('the type operand selects the storage', () => {
    const a = asArray(run('arrayFrom(repeat(7, 3), "integer<0..255>")'));
    expect(a.cells).toBeInstanceOf(Uint8Array);
    expect([...(a.cells as Uint8Array)]).toEqual([7, 7, 7]);
    const r = asArray(run('arrayFrom([1, 2], "real")'));
    expect(r.cells).toBeInstanceOf(Float64Array);
  });

  test('repeat(0, 0) with a type gives an array of no cell', () => {
    const a = asArray(run('arrayFrom(repeat(0, 0), "real")'));
    expect(a.count).toBe(0);
    expect(a.type.toString()).toBe('array<real>');
  });

  test('a type operand that is not a type is an error', () => {
    const bad = ce.box(['ArrayFrom', ['List', 1], { str: 'notatype' }]);
    expect(bad.isValid).toBe(false);
    expect(JSON.stringify(bad.json)).toContain('invalid-type-declaration');
    expect(errorCode(run('arrayFrom([1], "list<")'))).toBe(
      'invalid-type-declaration'
    );
    // A type operand that is not a string.
    expect(ce.box(['ArrayFrom', ['List', 1], 5]).isValid).toBe(false);
  });

  test('an element outside the cell type makes no array', () => {
    expect(errorCode(run('arrayFrom([1, 300], "integer<0..255>")'))).toBe(
      'incompatible-type'
    );
  });

  test('an array as the source copies its cells, with its cell type', () => {
    const a = assignArray([1, 2, 3], 'integer<0..255>');
    const b = asArray(evaluate(['ArrayFrom', 'a']));
    expect(b.cellType.toString()).toBe('integer<0..255>');
    expect(b).not.toBe(a);
    expect(b.cells).not.toBe(a.cells);
    expect([...(b.cells as Uint8Array)]).toEqual([1, 2, 3]);
  });

  test('each evaluation makes a new array, and ArrayFrom is state', () => {
    const expr = ce.box(['ArrayFrom', ['List', 1]]);
    expect(expr.effects).toEqual(['state']);
    expect(expr.evaluate()).not.toBe(expr.evaluate());
  });

  test('a source with no finite length stays unevaluated', () => {
    expect(evaluate(['ArrayFrom', ['Range', 1, 'PositiveInfinity']]).operator).toBe(
      'ArrayFrom'
    );
  });

  test('an array of objects holds the objects by reference', () => {
    const v = run(`type P = object{x: integer}
let p = P(x: 1)
let a = arrayFrom([p])
a[1].x = 5
p.x`);
    expect(v.json).toBe(5);
  });
});

describe('IDENTITY', () => {
  test('a == arrayFrom(a) is false, and a == a is true', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
[a == arrayFrom(a), a == a]`).json
    ).toEqual(['List', 'False', 'True']);
  });

  test('a second name holds the same array', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
let b = a
a[1] = 7
[b[1], a == b]`).json
    ).toEqual(['List', 7, 'True']);
  });
});

describe('READS', () => {
  test('an index from 1, and a negative index from the end', () => {
    assignArray([10, 20, 30, 40, 50]);
    expect(evaluate(['At', 'a', 2]).json).toBe(20);
    expect(evaluate(['At', 'a', -1]).json).toBe(50);
  });

  test('an index that is 0, out of range or not an integer reads NaN', () => {
    assignArray([10, 20, 30]);
    for (const i of [0, 4, 1.5])
      expect(evaluate(['At', 'a', i]).json).toBe('NaN');
  });

  test('a range, a list of indexes and a list of booleans give a list', () => {
    assignArray([10, 20, 30, 40, 50]);
    expect(evaluate(['At', 'a', ['Range', 2, 4]]).json).toEqual([
      'List',
      20,
      30,
      40,
    ]);
    expect(evaluate(['At', 'a', ['List', 1, 3, 5]]).json).toEqual([
      'List',
      10,
      30,
      50,
    ]);
    expect(evaluate(['At', 'a', ['Range', 4, 7]]).json).toEqual([
      'List',
      40,
      50,
      'NaN',
      'NaN',
    ]);
    expect(evaluate(['At', 'a', ['Range', 4, 2]]).json).toEqual([
      'List',
      40,
      30,
      20,
    ]);
    expect(evaluate(['At', 'a', ['Range', 4, 2, 1]]).json).toEqual(['List']);
    expect(
      evaluate(['At', 'a', ['List', 'True', 'False', 'True']]).json
    ).toEqual(['List', 10, 30]);
  });

  test('the epsil spellings of a range and of a list of indexes', () => {
    expect(
      run(`let a = arrayFrom([10, 20, 30, 40, 50])
[a[2..4], a[[1, 3, 5]], a[4..7], a[4..2]]`).json
    ).toEqual([
      'List',
      ['List', 20, 30, 40],
      ['List', 10, 30, 50],
      ['List', 40, 50, 'NaN', 'NaN'],
      ['List'],
    ]);
  });

  test('the list of a range is built at once', () => {
    expect(
      run(`let a = arrayFrom([10, 20, 30, 40, 50])
let s = a[2..4]
a[2] = 99
s`).json
    ).toEqual(['List', 20, 30, 40]);
  });

  test('a tuple cell out of range reads a tuple of four NaN', () => {
    ce.declareType(
      'Pixel',
      'tuple<r: integer<0..255>, g: integer<0..255>, b: integer<0..255>, a: integer<0..255>>'
    );
    const v = run(`let a = arrayFrom(repeat(Pixel(1, 2, 3, 4), 2), "Pixel")
[a[[0]], a[1].g]`);
    expect(v.json).toEqual([
      'List',
      ['List', ['Tuple', 'NaN', 'NaN', 'NaN', 'NaN']],
      2,
    ]);
  });

  test('several indexes read one step at a time', () => {
    expect(
      run(`let m = [arrayFrom([1, 2]), arrayFrom([3, 4])]
let a = arrayFrom([[5, 6], [7, 8]], "list<integer>")
[m[2][1], a[2][2]]`).json
    ).toEqual(['List', 3, 8]);
  });

  test('the static types of a read', () => {
    ce.declare('a', 'array<integer<0..255>>');
    ce.declare('b', 'array');
    expect(ce.box(['At', 'a', 'n']).type.toString()).toBe('integer<0..255>');
    expect(ce.box(['At', 'a', ['Range', 1, 3]]).type.toString()).toBe(
      'list<integer<0..255>>'
    );
    expect(ce.box(['At', 'b', 1]).type.toString()).toBe('any');
    expect(ce.box(['Length', 'a']).type.toString()).toBe('integer');
    expect(ce.box(['ListFrom', 'a']).type.toString()).toBe(
      'list<integer<0..255>>'
    );
  });

  test('length is the count, and listFrom a copy of the cells now', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
let l = listFrom(a)
a[1] = 9
[length(a), l, listFrom(a)]`).json
    ).toEqual(['List', 3, ['List', 1, 2, 3], ['List', 9, 2, 3]]);
  });

  test('listFrom of an array whose cells can hold an object is an error', () => {
    expect(
      errorCode(
        run(`type P = object{x: integer}
listFrom(arrayFrom([P(x: 1)]))`)
      )
    ).toBe('incompatible-type');
    expect(errorCode(run('listFrom(arrayFrom([1], "any"))'))).toBe(
      'incompatible-type'
    );
  });
});

describe('AN ARRAY IS NOT A COLLECTION', () => {
  test.each([
    ['sum(a)'],
    ['map(a, x => x + 1)'],
    ['a + 1'],
    ['replaceAt(a, 1, 0)'],
    ['first(a)'],
    ['filter(a, x => x > 1)'],
  ])('%s is incompatible-type', (expr) => {
    const result = executeEpsil(ce, `let a = arrayFrom([1, 2, 3])\n${expr}`);
    expect(JSON.stringify(result.value?.json)).toContain('incompatible-type');
  });

  test('replaceAt of listFrom(a) is the list with one cell replaced', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
replaceAt(listFrom(a), 2, 0)`).json
    ).toEqual(['List', 1, 0, 3]);
  });
});

describe('SWAP', () => {
  test('exchanges the cells and the counts, and keeps the identities', () => {
    expect(
      run(`let a = arrayFrom([1, 2])
let b = arrayFrom([3, 4, 5])
let x = a
let n = length(a)
swap(a, b)
[n, length(a), length(b), listFrom(x), x == a]`).json
    ).toEqual(['List', 2, 3, 2, ['List', 3, 4, 5], 'True']);
  });

  test('the value is Nothing, the effect state, and both versions increase', () => {
    const a = assignArray([1, 2]);
    const b = asArray(evaluate(['ArrayFrom', ['List', 3]]));
    ce.assign('b', b);
    const expr = ce.box(['Swap', 'a', 'b']);
    expect(expr.effects).toEqual(['state']);
    const [va, vb] = [a.version, b.version];
    expect(expr.evaluate().symbol).toBe('Nothing');
    expect(a.version).toBeGreaterThan(va);
    expect(b.version).toBeGreaterThan(vb);
  });

  test('two arrays of two cell types are incompatible-type', () => {
    expect(
      errorCode(
        run(`let a = arrayFrom([1, 2])
let b = arrayFrom([3], "integer<0..255>")
swap(a, b)`)
      )
    ).toBe('incompatible-type');
  });

  test('a pure function that reads a cell sees the cells after a swap', () => {
    expect(
      run(`let a = arrayFrom([1, 2])
let b = arrayFrom([3, 4])
function f(x) pure { x[1] }
let before = f(a)
swap(a, b)
[before, f(a)]`).json
    ).toEqual(['List', 1, 3]);
  });
});

describe('DEPENDENCIES ON THE COUNT', () => {
  test('the same node of length(a) gives the new count after a swap', () => {
    assignArray([1, 2]);
    ce.assign('b', asArray(evaluate(['ArrayFrom', ['List', 1, 2, 3]])));
    const node = ce.box(['List', ['Length', 'a']]);
    expect(node.evaluate().json).toEqual(['List', 2]);
    evaluate(['Swap', 'a', 'b']);
    expect(node.evaluate().json).toEqual(['List', 3]);
  });

  test('a pure function that returns length(x) sees the count after a swap', () => {
    expect(
      run(`function len(x) pure { length(x) }
let c = arrayFrom([1, 2])
let d = arrayFrom([1, 2, 3])
let before = len(c)
swap(c, d)
[before, len(c)]`).json
    ).toEqual(['List', 2, 3]);
  });

  test('listFrom of an empty array, and a mask that reads no cell', () => {
    const int = { str: 'integer' };
    ce.assign('p', asArray(evaluate(['ArrayFrom', ['List'], int])));
    ce.assign('q', asArray(evaluate(['ArrayFrom', ['List', 4], int])));
    const list = ce.box(['List', ['ListFrom', 'p']]);
    const mask = ce.box(['List', ['At', 'p', ['List', 'True']]]);
    expect(list.evaluate().json).toEqual(['List', ['List']]);
    expect(mask.evaluate().json).toEqual(['List', ['List']]);
    evaluate(['Swap', 'p', 'q']);
    expect(list.evaluate().json).toEqual(['List', ['List', 4]]);
    expect(mask.evaluate().json).toEqual(['List', ['List', 4]]);
  });
});

describe('A NAME TYPED AN ARRAY WITH NO VALUE', () => {
  test('arrayFrom(v) and listFrom(v) stay unevaluated', () => {
    ce.declare('v', 'array<number>');
    expect(evaluate(['ArrayFrom', 'v']).json).toEqual(['ArrayFrom', 'v']);
    expect(evaluate(['ListFrom', 'v']).json).toEqual(['ListFrom', 'v']);
  });
});

describe('THE ALLOCATION FUNCTION OF THE HOST', () => {
  test('with no function, a storage of more than 2 GiB is refused', () => {
    // 10^12 cells of 8 bytes: JavaScript would accept the allocation and
    // end the process when the cells are filled.
    const r = evaluate(['ArrayFrom', ['Repeat', 0, 1e12], { str: 'real' }]);
    expect(r.operator).toBe('Error');
    expect(JSON.stringify(r.json)).toContain('array-allocation-refused');
    // 2 GiB of bytes is the limit: one more byte is refused.
    const over = evaluate([
      'ArrayFrom',
      ['Repeat', 0, 2 ** 31 + 1],
      { str: 'integer<0..255>' },
    ]);
    expect(JSON.stringify(over.json)).toContain('array-allocation-refused');
  });

  test('with a function, the host decides, above 2 GiB too', () => {
    const calls: [number, number][] = [];
    ce.arrayAllocation = (count, bytes) => {
      calls.push([count, bytes]);
      return false;
    };
    const r = evaluate(['ArrayFrom', ['Repeat', 0, 1e12], { str: 'real' }]);
    expect(JSON.stringify(r.json)).toContain('array-allocation-refused');
    expect(calls).toEqual([[1e12, 8]]);
  });

  test('is called once with the count and the bytes of a cell', () => {
    const calls: [number, number][] = [];
    ce.arrayAllocation = (count, bytes) => {
      calls.push([count, bytes]);
      return true;
    };
    evaluate(['ArrayFrom', ['List', 1, 2]]);
    evaluate(['ArrayFrom', ['Repeat', 0, 3], { str: 'integer<0..255>' }]);
    ce.declareType(
      'Pixel',
      'tuple<r: integer<0..255>, g: integer<0..255>, b: integer<0..255>, a: integer<0..255>>'
    );
    run('arrayFrom(repeat(Pixel(1, 2, 3, 4), 2), "Pixel")');
    expect(calls).toEqual([
      [2, 8],
      [3, 1],
      [2, 4],
    ]);
  });

  test('a false result and an exception are array-allocation-refused', () => {
    ce.arrayAllocation = (count) => count < 10;
    expect(asArray(evaluate(['ArrayFrom', ['List', 1]])).count).toBe(1);
    expect(
      errorCode(evaluate(['ArrayFrom', ['Repeat', 0, 10], { str: 'integer' }]))
    ).toBe('array-allocation-refused');
    ce.arrayAllocation = () => {
      throw new Error('no memory for you');
    };
    expect(errorCode(evaluate(['ArrayFrom', ['List', 1]]))).toBe(
      'array-allocation-refused'
    );
  });

  test('a JavaScript allocation failure is array-allocation-refused', () => {
    // A real allocation failure needs a count that can take all the memory
    // of the machine: the `RangeError` that it throws is simulated.
    const make = jest.spyOn(ce, '_array').mockImplementation(() => {
      throw new RangeError('Array buffer allocation failed');
    });
    const v = evaluate(['ArrayFrom', ['Repeat', 0, 4], { str: 'integer' }]);
    make.mockRestore();
    expect(errorCode(v)).toBe('array-allocation-refused');
  });
});

describe('AN INDEX THAT IS NOT AN INTEGER', () => {
  test('an exact constant that is not an integer reads the absent cell', () => {
    assignArray([1, 2, 3]);
    expect(evaluate(['At', 'a', 'Pi']).json).toBe('NaN');
    expect(evaluate(['At', 'a', ['Add', 5, ['Sqrt', 17]]]).json).toBe('NaN');
    expect(evaluate(['At', 'a', ['List', 1, 'Pi']]).json).toEqual([
      'List',
      1,
      'NaN',
    ]);
    ce.assign('s', asArray(evaluate(['ArrayFrom', ['List', { str: 'x' }]])));
    expect(evaluate(['At', 's', 'Pi']).json).toBe('Missing');
  });
});

describe('THE CELL TYPE OF ARRAYFROM WITH NO TYPE OPERAND', () => {
  test('an untyped source that holds an array gives an array<any>', () => {
    run('function f(x) { arrayFrom(x) }');
    const value = run('f(arrayFrom([1, 2], "integer<0..255>"))');
    expect(value.type.toString()).toBe('array<any>');
    expect(
      ce.box(['f', ['ArrayFrom', ['List', 1]]]).type.toString()
    ).toBe('array<any>');
    const a = asArray(value);
    expect([a._read(1).json, a._read(2).json]).toEqual([1, 2]);
  });

  test('a source typed an array gives its cell type', () => {
    const value = run(`let t: array<integer<0..255>> = arrayFrom([1, 2], "integer<0..255>")
arrayFrom(t)`);
    expect(value.type.toString()).toBe('array<integer<0..255>>');
    ce.declare('w', 'array<integer<0..255>>');
    expect(ce.box(['ArrayFrom', 'w']).type.toString()).toBe(
      'array<integer<0..255>>'
    );
  });
});

describe('THE FILL OF REPEAT', () => {
  test('arrayFrom(repeat(v, n), type) builds no list of n elements', () => {
    ce.maxCollectionSize = 10;
    const fn = jest.spyOn(ce, '_fn');
    const a = asArray(
      evaluate(['ArrayFrom', ['Repeat', 7, 5_000_000], { str: 'integer<0..255>' }])
    );
    const longest = Math.max(
      0,
      ...fn.mock.calls.map(([, ops]) => (ops as unknown[]).length)
    );
    fn.mockRestore();
    expect(a.count).toBe(5_000_000);
    expect(a._read(5_000_000).json).toBe(7);
    expect(longest).toBeLessThan(10);
  });

  test('ce.maxCollectionSize does not limit the count', () => {
    ce.maxCollectionSize = 10;
    const a = asArray(evaluate(['ArrayFrom', ['Repeat', 7, 100]]));
    expect(a.count).toBe(100);
    expect(a._read(100).json).toBe(7);
  });

  test('the count is the count of listFrom(repeat(v, n))', () => {
    const count = (n: unknown) =>
      asArray(evaluate(['ArrayFrom', ['Repeat', 7, n], { str: 'integer' }]))
        .count;
    expect(count(0)).toBe(0);
    expect(count(-3)).toBe(0);
    expect(evaluate(['ArrayFrom', ['Repeat', 7, 'n']]).operator).toBe(
      'ArrayFrom'
    );
  });

  test('a count up to ce.maxCollectionSize gives the same array, through the list', () => {
    ce.maxCollectionSize = 10;
    const cells = (n: number) => {
      const a = asArray(
        evaluate(['ArrayFrom', ['Repeat', 7, n], { str: 'integer<0..255>' }])
      );
      return [a.type.toString(), a.count, a._read(1).json, a._read(n).json];
    };
    expect(cells(10)).toEqual(['array<integer<0..255>>', 10, 7, 7]);
    expect(cells(11)).toEqual(['array<integer<0..255>>', 11, 7, 7]);
  });

  test('a repeat of no element is an array of no cell', () => {
    for (const v of [{ str: 'x' }, 0]) {
      const a = asArray(evaluate(['ArrayFrom', ['Repeat', v, 0], { str: 'real' }]));
      expect(a.count).toBe(0);
    }
  });

  test('a source that evaluates to an error gives that error', () => {
    const source = ['At', ['List', 1], 1, 2];
    expect(ce.box(source as any).isValid).toBe(true);
    const error = evaluate(source);
    expect(error.operator).toBe('Error');
    // The error carries the frame of `ArrayFrom` in its trace.
    const v = evaluate(['ArrayFrom', source]);
    expect((v.json as unknown[]).slice(0, 3)).toEqual(error.json);
  });

  test('evaluateAsync awaits the source', async () => {
    ce.declare('AsyncOnly', {
      signature: '(number) -> list<number>',
      evaluateAsync: async ([x]) => ce.function('List', [x, x]),
    });
    const expr = ce.box(['ArrayFrom', ['AsyncOnly', 3]]);
    expect(expr.evaluate().operator).toBe('ArrayFrom');
    const a = asArray(await expr.evaluateAsync());
    expect([a.count, a._read(1).json, a._read(2).json]).toEqual([2, 3, 3]);
  });

  test('a value that is not pure is evaluated once per cell', () => {
    const a = asArray(evaluate(['ArrayFrom', ['Repeat', ['Random'], 5]]));
    expect(a.count).toBe(5);
    const cells = new Set([1, 2, 3, 4, 5].map((k) => a._read(k).re));
    expect(cells.size).toBe(5);
  });
});

describe('THE STATIC TYPE OF A READ IS THE TYPE OF A LIST READ', () => {
  test.each([
    'integer<0..255>',
    'boolean',
    'string',
    'tuple<integer, integer>',
    'any',
  ])('cells of %s', (cell) => {
    ce.declare('L', `list<${cell}>`);
    ce.declare('A', `array<${cell}>`);
    for (const index of ['k', ['List', 1, 'k'], ['Range', 1, 2]])
      expect(ce.box(['At', 'A', index]).type.toString()).toBe(
        ce.box(['At', 'L', index]).type.toString()
      );
    expect(ce.box(['At', 'A', ['List', 'True', 'False']]).type.toString()).toBe(
      `list<${cell}>`
    );
  });
});

describe('A PARAMETER READ BY LENGTH OR AT', () => {
  test('takes an array argument', () => {
    expect(
      run(`function f(x) { length(x) }
function g(x) { x[2] }
let a = arrayFrom([1, 2, 3])
[f(a), g(a)]`).json
    ).toEqual(['List', 3, 2]);
  });
});
