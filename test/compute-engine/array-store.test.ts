/**
 * The store of a cell of a mutable array: `Assign(At(base, i…), v)`, the
 * element-write form `Assign(a, ReplaceAt(a, i…, v))` of a name that can
 * hold an array, and `AddTo(At(base, i…), e)`
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 6, and acceptance
 * cases 2, 5, 6, 7 and 8, the interpreter halves).
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

/** The error code of an error expression, or `undefined`. */
function errorCode(x: Expression | undefined): string | undefined {
  if (x === undefined || x.operator !== 'Error') return undefined;
  return x.json?.[1]?.[1]?.replace(/'/g, '');
}

function asArray(x: Expression): Arr {
  if (!isMutableArray(x)) throw new Error(`no array: ${x.toString()}`);
  return x;
}

/** Assign a new array of `values` to `name` at the top level. */
function assignArray(name: string, values: number[], cellType?: string): Arr {
  const a = asArray(
    ce
      .box([
        'ArrayFrom',
        ['List', ...values],
        ...(cellType === undefined ? [] : [{ str: cellType }]),
      ])
      .evaluate()
  );
  ce.assign(name, a);
  return a;
}

const cells = (a: Arr): unknown[] =>
  Array.from({ length: a.count }, (_, k) => a._read(k + 1).json);

describe('THE STORE', () => {
  test('stores the value in the cell; the value of the store is the value', () => {
    const a = assignArray('a', [1, 2, 3]);
    const result = ce.box(['Assign', ['At', 'a', 2], 9]).evaluate();
    expect(result.json).toBe(9);
    expect(cells(a)).toEqual([1, 9, 3]);
    expect(ce.box('a').evaluate()).toBe(a);
  });

  test('a negative index stores from the end', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
a[-1] = 7
listFrom(a)`).json
    ).toEqual(['List', 1, 2, 7]);
  });

  test.each([['0'], ['4'], ['1.5']])(
    'a store at %s is out-of-range, and changes nothing',
    (i) => {
      const v = run(`let a = arrayFrom([1, 2, 3])
a[${i}] = 9`);
      expect(errorCode(v)).toBe('out-of-range');
      expect(run('listFrom(a)').json).toEqual(['List', 1, 2, 3]);
    }
  );

  test('a value outside the cell type is incompatible-type', () => {
    expect(
      errorCode(
        run(`let a = arrayFrom(repeat(0, 3), "integer<0..255>")
a[1] = 300`)
      )
    ).toBe('incompatible-type');
  });

  test('a store to a range is incompatible-type, as for a list', () => {
    const v = run(`let a = arrayFrom([10, 20, 30, 40, 50])
a[2..3] = [7, 8]`);
    expect(JSON.stringify(v.json)).toContain('incompatible-type');
  });

  test('the base, the index and the value are evaluated once, in that order', () => {
    const log: string[] = [];
    const a = assignArray('a', [1, 2, 3]);
    const host = (name: string, value: () => Expression) =>
      ce.declare(name, {
        signature: '() -> any',
        pure: false,
        evaluate: () => {
          log.push(name);
          return value();
        },
      } as any);
    host('base', () => a);
    host('idx', () => ce.number(2));
    host('val', () => ce.number(9));
    ce.box(['Assign', ['At', ['base'], ['idx']], ['val']]).evaluate();
    expect(log).toEqual(['base', 'idx', 'val']);
    expect(cells(a)).toEqual([1, 9, 3]);
  });

  test('a store through a field of an object', () => {
    expect(
      run(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))
p.pixels[2] = 9
listFrom(p.pixels)`).json
    ).toEqual(['List', 1, 9, 3]);
  });

  test('m[i][j] = v with m a list of arrays stores to m[i]', () => {
    expect(
      run(`let m = [arrayFrom([1, 2]), arrayFrom([3, 4])]
let row = m[2]
m[2][1] = 9
[listFrom(row), row == m[2], listFrom(m[1])]`).json
    ).toEqual(['List', ['List', 9, 4], 'True', ['List', 1, 2]]);
  });

  test('a store of the value a cell holds changes no version', () => {
    const a = assignArray('a', [1, 2, 3]);
    const v0 = a.version;
    ce.box(['Assign', ['At', 'a', 1], 5]).evaluate();
    expect(a.version).toBe(v0 + 1);
    ce.box(['Assign', ['At', 'a', 1], 5]).evaluate();
    expect(a.version).toBe(v0 + 1);
  });

  test('a store changes no field and no version of an object that holds the array', () => {
    const v = run(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))
p`);
    const before = (v as any)._version;
    run('p.pixels[1] = 9');
    expect((v as any)._version).toBe(before);
  });

  test('a pure user function that reads a cell gives the new cell', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
function f(x) pure { x[1] }
let before = f(a)
a[1] = 7
[before, f(a)]`).json
    ).toEqual(['List', 1, 7]);
  });

  // Acceptance case 7: a loop of 100,000 interpreted stores to one array
  // ends (no stack overflow). It measures that the loop ends, not its time:
  // the time of a store is the instrument
  // `scripts/repros/2026-11-25-array-store-cost.mts`.
  test('a loop of 100,000 stores ends', () => {
    expect(
      run(`let a = arrayFrom(repeat(0, 10), "integer<0..255>")
for k in 1..100000 { a[(k % 10) + 1] = k % 256 }
a[1]`).json
    ).toBe(160);
  });
});

describe('THE CANONICAL FORMS', () => {
  test('an element write of a name declared an array is Assign(At(a, i), v), state', () => {
    ce.declare('a', 'array<integer>');
    const expr = ce.box(['Assign', 'a', ['ReplaceAt', 'a', 'n', 5]]);
    expect(expr.json).toEqual(['Assign', ['At', 'a', 'n'], 5]);
    expect(expr.effects).toEqual(['state']);
  });

  test('the epsil spelling a[i] = v of an array gives the same form', () => {
    run('let a = arrayFrom([1, 2, 3])');
    expect(ce.parse('a[2] \\coloneq 5').json).toEqual([
      'Assign',
      ['At', 'a', 2],
      5,
    ]);
  });

  test('an element write of a list keeps its form, with the effect scope', () => {
    ce.declare('L', 'list<integer>');
    const expr = ce.box(['Assign', 'L', ['ReplaceAt', 'L', 1, 5]]);
    expect(expr.json).toEqual(['Assign', 'L', ['ReplaceAt', 'L', 1, 5]]);
    expect(expr.effects).toEqual(['scope']);
    // `Assign(At(L, i), v)` of a list is the element-write form.
    expect(ce.box(['Assign', ['At', 'L', 1], 5]).json).toEqual([
      'Assign',
      'L',
      ['ReplaceAt', 'L', 1, 5],
    ]);
  });

  test('an element write whose types do not decide has scope and state', () => {
    ce.declare('u', 'any');
    const expr = ce.box(['Assign', 'u', ['ReplaceAt', 'u', 1, 5]]);
    expect(expr.json).toEqual(['Assign', ['At', 'u', 1], 5]);
    expect(expr.effects).toEqual(['scope', 'state']);
  });

  test('the nested ReplaceAt is not an element write of an array', () => {
    ce.declare('u', 'any');
    const expr = ce.box([
      'Assign',
      'u',
      ['ReplaceAt', ['ReplaceAt', 'u', 1, 'x'], 2, 'y'],
    ]);
    expect(expr.json).toEqual([
      'Assign',
      'u',
      ['ReplaceAt', ['ReplaceAt', 'u', 1, 'x'], 2, 'y'],
    ]);
  });

  test('a name that holds a list, typed any, keeps the element write of a list', () => {
    expect(
      run(`let s: any = [1, 2, 3]
s[2] = 9
s`).json
    ).toEqual(['List', 1, 9, 3]);
    expect(
      errorCode(
        run(`let t: any = [1, 2, 3]
t[5] = 9`)
      )
    ).toBe('out-of-range');
  });

  test('an untyped parameter stores to an array argument; scope is confined', () => {
    expect(
      run(`function f(a) { a[1] = 7; 0 }
let b = arrayFrom([5, 6])
f(b)
listFrom(b)`).json
    ).toEqual(['List', 7, 6]);
    expect(ce.box('f').type.toString()).toBe('(a: unknown) state -> integer');
  });

  test('a parameter declared an array, and one declared a list', () => {
    run(`function g(a: array<integer>) { a[1] = 7; 0 }
function h(a: list<integer>) { a[1] = 7; a }`);
    expect(ce.box('g').type.toString()).toBe(
      '(a: array<integer>) state -> integer'
    );
    expect(ce.box('h').type.toString()).toBe(
      '(a: list<integer>) -> list<integer>'
    );
    expect(run('h([1, 2])').json).toEqual(['List', 7, 2]);
  });

  test('the element-write form of a name that holds an array stores, at run time', () => {
    const a = assignArray('a', [1, 2, 3]);
    // A structural assignment keeps the element-write form.
    const expr = ce._fn('Assign', [
      ce.symbol('a'),
      ce._fn('ReplaceAt', [ce.symbol('a'), ce.number(1), ce.number(8)]),
    ]);
    expect(expr.evaluate().json).toBe(8);
    expect(ce.box('a').evaluate()).toBe(a);
    expect(cells(a)).toEqual([8, 2, 3]);
  });
});

describe('IMMUTABLE BASES', () => {
  test('s.px[2] = 9 with px a list field is immutable-value-assignment (CE-1797)', () => {
    const v = run(`type Screen = object{w: integer, px: list<integer>}
const s = Screen(w: 2, px: [0, 0, 0, 0])
s.px[2] = 9`);
    expect(errorCode(v)).toBe('immutable-value-assignment');
    const message = JSON.stringify(v.json);
    expect(message).toContain('ReplaceAt');
    expect(message).toContain('array<integer>');
    expect(run('s.px').json).toEqual(['List', 0, 0, 0, 0]);
  });

  test('a[i][j] = v with a an array<list<integer>> is immutable-value-assignment', () => {
    expect(
      errorCode(
        run(`let a: array<list<integer>> = arrayFrom([[1, 2]], "list<integer>")
a[1][2] = 5`)
      )
    ).toBe('immutable-value-assignment');
  });
});

describe('CONSTANTS', () => {
  test('a constant that holds an array accepts a store', () => {
    const a = asArray(ce.box(['ArrayFrom', ['List', 1, 2]]).evaluate());
    ce.declare('k', { type: 'array<number>', value: a, constant: true } as any);
    expect(ce.box(['Assign', ['At', 'k', 1], 5]).evaluate().json).toBe(5);
    expect(cells(a)).toEqual([5, 2]);
  });

  test('an element write of a constant that holds a list is a run error', () => {
    expect(
      errorCode(
        run(`const L = [1, 2]
L[1] = 5`)
      )
    ).toBe('constant-assignment');
  });
});

describe('ADD TO', () => {
  test('a[i] += v reads the cell, adds and stores', () => {
    expect(
      run(`let a = arrayFrom([1, 2, 3])
a[2] += 10
listFrom(a)`).json
    ).toEqual(['List', 1, 12, 3]);
  });

  test('AddTo through a field of an object', () => {
    run(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))`);
    const expr = ce.box([
      'AddTo',
      ['At', ['Field', 'p', { str: 'pixels' }], 2],
      5,
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.effects).toEqual(['state']);
    expect(expr.evaluate().json).toBe(7);
    expect(run('listFrom(p.pixels)').json).toEqual(['List', 1, 7, 3]);
  });

  test('AddTo through a list field is immutable-value-assignment', () => {
    run(`type S = object{px: list<integer>}
let s = S(px: [1, 2])`);
    const v = ce
      .box(['AddTo', ['At', ['Field', 's', { str: 'px' }], 1], 5])
      .evaluate();
    expect(errorCode(v)).toBe('immutable-value-assignment');
  });

  test('m[i][j] += v with m a list of arrays, and on a list of lists', () => {
    expect(
      run(`let m = [arrayFrom([1, 2]), arrayFrom([3, 4])]
m[2][1] += 9
let L = [[1, 2], [3, 4]]
L[2][1] += 9
[listFrom(m[2]), L]`).json
    ).toEqual(['List', ['List', 12, 4], ['List', ['List', 1, 2], ['List', 12, 4]]]);
  });

  test('the effect of AddTo of a cell of an array is state', () => {
    assignArray('a', [1, 2]);
    expect(ce.box(['AddTo', ['At', 'a', 1], 5]).effects).toEqual(['state']);
  });
});

describe('THE BASE OF A CELL IS RESOLVED ONCE', () => {
  test('an increment that replaces the base does not move the store', () => {
    expect(
      run(`let a = arrayFrom([arrayFrom([1, 2]), arrayFrom([5, 6])], "array<number>")
let original = a[1]
let b = arrayFrom([10, 20])
a[1, 1] += do { a[1] = b; 2 }
[listFrom(original), listFrom(b), a[1] == b]`).json
    ).toEqual(['List', ['List', 3, 2], ['List', 10, 20], 'True']);
  });

  test('a[i][j] += v with a an array<list<integer>> is immutable-value-assignment', () => {
    expect(
      errorCode(
        run(`let a: array<list<integer>> = arrayFrom([[1, 2]], "list<integer>")
a[1][2] += 5`)
      )
    ).toBe('immutable-value-assignment');
  });
});

describe('THE EFFECTS OF A STORE TO A LOCAL', () => {
  test('a local list keeps the effects it had before arrays', () => {
    run(`function f1() {
  let L = [1, 2]
  L[1] += 1
  L
}
function f2() {
  let L = [1, 2]
  L[1] = 5
  L
}`);
    expect(ce.box('f1').type.toString()).toBe('() -> list<number>');
    expect(ce.box('f2').type.toString()).toBe('() -> list<number>');
    expect(run('[f1(), f2()]').json).toEqual([
      'List',
      ['List', 2, 2],
      ['List', 5, 2],
    ]);
    for (const write of [
      ['AddTo', ['At', 'L', 1], 1],
      ['Assign', 'L', ['ReplaceAt', 'L', 1, 5]],
    ])
      expect(
        ce.box([
          'Block',
          ['Declare', 'L', "'unknown'", ['List', 1, 2]],
          write,
          'L',
        ] as any).effects
      ).toEqual(['scope']);
  });

  test('a local declared an array gives state', () => {
    run(`function f3() {
  let L: array<integer> = arrayFrom([1, 2], "integer")
  L[1] += 5
  0
}`);
    expect(ce.box('f3').type.toString()).toBe('() state -> integer');
    expect(
      ce.box([
        'Block',
        ['Declare', 'L', "'array<integer>'"],
        ['AddTo', ['At', 'L', 1], 5],
        0,
      ]).effects
    ).toContain('state');
  });

  test('an untyped name gives state and scope', () => {
    run('function g(a) { a[1] += 7; 0 }');
    // The `scope` write of the parameter is confined to the call.
    expect(ce.box('g').type.toString()).toBe('(a: unknown) state -> integer');
    ce.declare('u', 'any');
    expect(ce.box(['AddTo', ['At', 'u', 1], 5]).effects).toEqual([
      'scope',
      'state',
    ]);
  });
});

describe('A NAME WHOSE TYPE CANNOT BE AN ARRAY', () => {
  // The element write `d["x"] = 5` of a dictionary, a record or a number
  // keeps the form `Assign(d, ReplaceAt(d, …))` and its static error.
  test.each([
    ['dictionary<integer>', 'indexed_collection<integer>'],
    ['record{x: integer}', 'indexed_collection<integer>'],
    ['integer', 'indexed_collection<integer>'],
  ])('%s', (type, expected) => {
    ce.declare('d', type);
    const expr = ce.box(['Assign', 'd', ['ReplaceAt', 'd', { str: 'x' }, 5]]);
    expect(expr.isValid).toBe(false);
    expect(expr.json).toEqual([
      'Assign',
      'd',
      [
        'ReplaceAt',
        ['Error', ['ErrorCode', "'incompatible-type'", `'${expected}'`, `'${type}'`], 'd'],
        ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'string'"], "'x'"],
        5,
      ],
    ]);
  });
});

describe('THE ELEMENT-WRITE FORM OF A NAME THAT HOLDS AN ARRAY', () => {
  test('stores through several positions, and keeps the error of a list base', () => {
    const m = asArray(
      ce
        .box([
          'ArrayFrom',
          ['List', ['ArrayFrom', ['List', 1, 2]]],
          { str: 'array<number>' },
        ])
        .evaluate()
    );
    ce.assign('m', m);
    const inner = asArray(m._read(1));
    const expr = ce._fn('Assign', [
      ce.symbol('m'),
      ce._fn('ReplaceAt', [
        ce.symbol('m'),
        ce.number(1),
        ce.number(2),
        ce.number(9),
      ]),
    ]);
    expect(expr.evaluate().json).toBe(9);
    expect(cells(inner)).toEqual([1, 9]);
    expect(ce.box('m').evaluate()).toBe(m);
  });
});

describe('THE ELEMENT-WRITE FORM STORES TO THE ARRAY READ FIRST', () => {
  /** The structural `Assign(name, ReplaceAt(name, ...ops))`. */
  const elementWrite = (name: string, ...ops: Expression[]): Expression =>
    ce._fn('Assign', [
      ce.symbol(name),
      ce._fn('ReplaceAt', [ce.symbol(name), ...ops]),
    ]);

  test('a value that rebinds the name does not move the store', () => {
    const a = assignArray('a', [1, 2, 3]);
    const b = assignArray('b', [4, 5, 6]);
    const value = ce.box(['Block', ['Assign', 'a', 'b'], 8]);
    expect(elementWrite('a', ce.number(1), value).evaluate().json).toBe(8);
    expect(cells(a)).toEqual([8, 2, 3]);
    expect(cells(b)).toEqual([4, 5, 6]);
    expect(ce.box('a').evaluate()).toBe(b);
  });

  test('a value that replaces the intermediate cell does not move the store', () => {
    const m = asArray(
      ce
        .box([
          'ArrayFrom',
          ['List', ['ArrayFrom', ['List', 1, 2]]],
          { str: 'array<number>' },
        ])
        .evaluate()
    );
    ce.assign('m', m);
    const inner = asArray(m._read(1));
    const other = assignArray('other', [5, 6]);
    const value = ce.box(['Block', ['Assign', ['At', 'm', 1], 'other'], 9]);
    expect(
      elementWrite('m', ce.number(1), ce.number(2), value).evaluate().json
    ).toBe(9);
    expect(cells(inner)).toEqual([1, 9]);
    expect(cells(other)).toEqual([5, 6]);
    expect(m._read(1)).toBe(other);
  });

  test('a position with an effect is evaluated once', () => {
    const a = assignArray('a', [1, 2, 3]);
    ce.declare('k', 'integer');
    ce.assign('k', 0);
    const position = ce.box(['Block', ['Assign', 'k', ['Add', 'k', 1]], 'k']);
    expect(elementWrite('a', position, ce.number(8)).evaluate().json).toBe(8);
    expect(ce.box('k').evaluate().json).toBe(1);
    expect(cells(a)).toEqual([8, 2, 3]);
  });
});

describe('ADD TO THROUGH AN INTERMEDIATE READ', () => {
  test('a[i][j] += v and a[i][j] = v give the error of the read', () => {
    ce.assign(
      'a',
      ce.box(['ArrayFrom', ['List', 7, 8], { str: 'any' }]).evaluate()
    );
    const target = ['At', 'a', 1, 1, 1];
    const assign = ce.box(['Assign', target, 9]).evaluate();
    const addTo = ce.box(['AddTo', target, 9]).evaluate();
    expect(errorCode(assign)).toBe('incompatible-type');
    expect(addTo.json).toEqual(assign.json);
  });
});

describe('A POSITION THAT REBINDS THE NAME', () => {
  test.each(['Assign', 'AddTo'])('%s stores to the array read first', (op) => {
    const a = assignArray('a', [1, 2, 3]);
    const b = assignArray('b', [4, 5, 6]);
    const v = ce
      .box([op, ['At', 'a', ['Block', ['Assign', 'a', 'b'], 1]], 10])
      .evaluate();
    expect(errorCode(v)).toBeUndefined();
    expect(cells(a)[0]).toBe(op === 'Assign' ? 10 : 11);
    expect(cells(b)).toEqual([4, 5, 6]);
  });
});

describe('ADD TO A COMPUTED BASE', () => {
  test('the canonical target is the At form, not canonicalized again', () => {
    run(`type P = object{pixels: array<integer>}
let p = P(pixels: arrayFrom([1, 2, 3], "integer"))`);
    expect(
      ce.box(['AddTo', ['At', ['Field', 'p', { str: 'pixels' }], 2], 5]).json
    ).toEqual(['AddTo', ['At', ['Field', 'p', "'pixels'"], 2], 5]);
  });
});

describe('A NAME THAT HOLDS AN EXPRESSION WHOSE VALUE IS AN ARRAY', () => {
  test('a compound assignment stores to the array that the name evaluates to', () => {
    // A host can assign a name an expression, not a value: `a` holds the
    // symbol `b`, and `b` holds the array.
    const b = assignArray('b', [1, 2, 3], 'integer');
    ce.assign('a', ce.symbol('b'));
    const r = ce.box(['AddTo', ['At', 'a', 1], 2]).evaluate();
    expect(errorCode(r)).toBeUndefined();
    expect(cells(b)).toEqual([3, 2, 3]);
    ce.box(['Assign', ['At', 'a', 2], 9]).evaluate();
    expect(cells(b)).toEqual([3, 9, 3]);
  });
});

describe('ADD TO ON A PATH OF LISTS OF NO STATED ELEMENT TYPE', () => {
  test('a read that fails on a list path is reported by the element write, as before', () => {
    // `L` is a list whose element type does not rule out an array, so the
    // bases are read; none is an array, and the element write of the list
    // gives its own error, with the increment evaluated.
    run(`let L: list = [[1, 2], 3]
let calls = 0
function bump() scope { calls = calls + 1; 1 }`);
    const r = ce.box(['AddTo', ['At', 'L', 1, 1], ['bump']]).evaluate();
    expect(errorCode(r)).toBeUndefined();
    expect(ce.box('calls').evaluate().re).toBe(1);
    expect(ce.box(['At', 'L', 1, 1]).evaluate().re).toBe(2);
  });
});
