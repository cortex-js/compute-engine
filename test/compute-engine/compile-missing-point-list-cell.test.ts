import { execFileSync } from 'node:child_process';
import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

// A `When` or a `Which` over a list that selects no clause at a position
// gives `Missing` in that cell in the interpreter. In compiled JavaScript, a
// missing POINT cell is `undefined`, as a single missing point is; a missing
// number cell stays `NaN`.

const ce = new ComputeEngine();
ce.declare('v', 'list<real>');

const V = [1, -1];

function interpreted(json: any): string {
  return ce
    .box(json)
    .subs({ v: ce.box(['List', ...V]) })
    .evaluate()
    .toString();
}

function compiled(json: any): unknown {
  const result = compile(ce.box(json), { fallback: false }) as any;
  expect(result.success).toBe(true);
  return result.run({ v: V });
}

describe('COMPILED LIST CELL OF A MISSING POINT', () => {
  test.each([
    ['Which', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]]],
    [
      'Which with two clauses',
      [
        'Which',
        ['Greater', 'v', 0],
        ['Tuple', 1, 2],
        ['Less', 'v', -5],
        ['Tuple', 3, 4],
      ],
    ],
    ['If with no else', ['If', ['Greater', 'v', 0], ['Tuple', 1, 2]]],
    [
      'Which with a list of points',
      [
        'Which',
        ['Greater', 'v', 0],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ],
    ['When', ['When', ['Tuple', 1, 2], ['Greater', 'v', 0]]],
  ])('%s: the cell is undefined', (_name, json) => {
    expect(interpreted(json)).toBe('[(1, 2),"Missing"]');
    expect(compiled(json)).toEqual([[1, 2], undefined]);
  });

  test('a read at one index of the same selection is undefined too', () => {
    const json = ['At', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]], 2];
    expect(interpreted(json)).toBe('"Missing"');
    expect(compiled(json)).toBeUndefined();
  });

  test.each([
    ['Which', ['Which', ['Greater', 'v', 0], 7]],
    ['When', ['When', 7, ['Greater', 'v', 0]]],
  ])('%s: a number cell stays NaN', (_name, json) => {
    const out = compiled(json) as unknown[];
    expect(out[0]).toBe(7);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  test('a string cell is undefined in both forms', () => {
    // The list form of `When` gave the object null for a missing string, and
    // the element-wise `Which` gave `NaN`: both give `undefined` now.
    for (const json of [
      ['Which', ['Greater', 'v', 0], { str: 'a' }],
      ['When', { str: 'a' }, ['Greater', 'v', 0]],
    ]) {
      expect(interpreted(json)).toBe('["a","Missing"]');
      expect(compiled(json)).toEqual(['a', undefined]);
    }
  });

  test('a position whose condition is absent stays NaN', () => {
    // An absent condition cell (NaN) is the interpreter's error cell, which
    // compiles to NaN; it is not a position that no clause matched.
    ce.declare('c', 'list<boolean>');
    const result = compile(ce.box(['Which', 'c', ['Tuple', 1, 2]]), {
      fallback: false,
    }) as any;
    expect(result.success).toBe(true);
    const out = result.run({ c: [true, NaN, false] });
    expect(out[0]).toEqual([1, 2]);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBeUndefined();
  });
});

// A discharge (`IsMissing`, `Coalesce`) reads an absent operand whatever its
// spelling (R3 of `docs/plans/2026-11-01-absent-value-contract.md`): the
// compiled `undefined` of a missing point or string cell, and the `NaN` of
// a missing number cell. Each program computes the interpreter's value.
describe('A DISCHARGE READS EVERY SPELLING OF AN ABSENT CELL', () => {
  const engine = new ComputeEngine();
  engine.declare('v', 'list<real>');
  engine.declare('P', 'list<tuple<real, real>>');
  engine.declare('z', 'complex');
  const inputs = { v: [1, -1], P: [[1, 2], [3, 4]], z: { re: 1, im: 2 } };

  function both(json: any): [string, unknown] {
    const expr = engine.box(json);
    const value = expr
      .subs({
        v: engine.box(['List', ...inputs.v]),
        P: engine.box(['List', ...inputs.P.map((p) => ['Tuple', ...p])]),
        z: engine.box(['Complex', 1, 2]),
      })
      .evaluate()
      .toString();
    const result = compile(expr, { fallback: false }) as any;
    expect(result.success).toBe(true);
    return [value, result.run(inputs)];
  }

  test.each([
    [
      'IsMissing of the last cell of a selection of points',
      [
        'Boole',
        [
          'IsMissing',
          ['Last', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]]],
        ],
      ],
      '1',
      1,
    ],
    [
      'Coalesce of the first cell of the rest',
      [
        'Coalesce',
        ['First', ['Rest', ['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]]]],
        ['Tuple', 9, 9],
      ],
      '(9, 9)',
      [9, 9],
    ],
    [
      'Coalesce of a read past the end of a list of points',
      ['Coalesce', ['At', 'P', 5], ['Tuple', 0, 0]],
      '(0, 0)',
      [0, 0],
    ],
    [
      'IsMissing of an unmatched string cell',
      ['IsMissing', ['At', ['Which', ['Greater', 'v', 0], { str: 'a' }], 2]],
      '"True"',
      true,
    ],
    // A missing complex cell of `When` over a list of conditions is plain
    // `NaN`, as the element-wise `Which` gives it: the complex value
    // `{ re: NaN, im: NaN }` was read as present.
    [
      'IsMissing of a missing complex cell of When',
      ['IsMissing', ['At', ['When', 'z', ['Greater', 'v', 0]], 2]],
      '"True"',
      true,
    ],
    [
      'Coalesce of a missing complex cell of When',
      ['Coalesce', ['At', ['When', 'z', ['Greater', 'v', 0]], 2], 0],
      '0',
      0,
    ],
  ])('%s', (_name, json, interpreterValue, compiledValue) => {
    const [value, run] = both(json);
    expect(value).toBe(interpreterValue);
    expect(run).toEqual(compiledValue);
  });

  test('the cell of a selection of points stays undefined', () => {
    const [value, run] = both(['Which', ['Greater', 'v', 0], ['Tuple', 1, 2]]);
    expect(value).toBe('[(1, 2),"Missing"]');
    expect(run).toEqual([[1, 2], undefined]);
  });

  test('IsMissing of the last cell of a complex When', () => {
    const c = new ComputeEngine();
    c.declare('u', 'real');
    c.declare('w', 'real');
    const expr = c.box([
      'IsMissing',
      [
        'Last',
        [
          'When',
          ['Add', 'u', ['Multiply', 'ImaginaryUnit', 'w']],
          ['Less', ['Multiply', 'w', ['List', 1, 2]], 2],
        ],
      ],
    ]);
    expect(expr.subs({ u: 5, w: 1 }).evaluate().toString()).toBe('"True"');
    const result = compile(expr, { fallback: false }) as any;
    expect(result.success).toBe(true);
    expect(result.run({ u: 5, w: 1 })).toBe(true);
  });
});

// The Python target spells an absent value `None` or `NaN` (a written
// `Missing` is `math.nan` there). Its discharge reads both, for a value of
// any type, and reads every other value as present without raising.
const describePython = TEST_PYTHON === undefined ? describe.skip : describe;
describePython('Python: a discharge reads None and NaN', () => {
  function runPython(
    engine: ComputeEngine,
    json: unknown,
    param: string,
    arg: string
  ): string {
    const fn = new PythonTarget().compileFunction(
      engine.box(json as any),
      'f',
      [param]
    );
    return execFileSync(
      TEST_PYTHON!,
      [
        '-c',
        `import math\nimport cmath\nimport numpy as np\n${fn}\nprint(repr(f(${arg})))`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .toString()
      .trim();
  }

  const engine = new ComputeEngine();
  engine.declare('P', 'list<tuple<real, real>>');
  engine.declare('u', 'real | string | missing');
  engine.declare('z', 'complex | missing');

  test.each([
    [
      'Coalesce of a read past the end of a list of points',
      ['Coalesce', ['At', 'P', 5], ['Tuple', 0, 0]],
      'P',
      '[(1, 2), (3, 4)]',
      '(0, 0)',
    ],
    [
      'IsMissing of a written Missing in a list of strings',
      ['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 2]],
      'P',
      'None',
      'True',
    ],
    [
      'Coalesce of a written Missing in a list of strings',
      ['Coalesce', ['At', ['List', { str: 'a' }, 'Missing'], 2], { str: 'z' }],
      'P',
      'None',
      "'z'",
    ],
    [
      'IsMissing of a present string in a list of strings',
      ['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 1]],
      'P',
      'None',
      'False',
    ],
    // `math.isnan("ab")` raised a `TypeError` here.
    ['IsMissing of a string', ['IsMissing', 'u'], 'u', '"ab"', 'False'],
    ['IsMissing of an absent value', ['IsMissing', 'u'], 'u', 'None', 'True'],
    // `math.isnan(1+2j)` raised a `TypeError` here.
    ['IsMissing of a complex number', ['IsMissing', 'z'], 'z', '1+2j', 'False'],
    [
      'IsMissing of a complex NaN',
      ['IsMissing', 'z'],
      'z',
      'complex(math.nan, 0)',
      'True',
    ],
  ])('%s', (_name, json, param, arg, pythonValue) => {
    expect(runPython(engine, json, param, arg)).toBe(pythonValue);
  });

  test('the interpreter agrees', () => {
    const at = (j: unknown) => engine.box(j as any).evaluate().toString();
    expect(at(['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 2]])).toBe(
      '"True"'
    );
    expect(
      at(['Coalesce', ['At', ['List', { str: 'a' }, 'Missing'], 2], { str: 'z' }])
    ).toBe('"z"');
    expect(at(['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 1]])).toBe(
      '"False"'
    );
    expect(
      engine.box(['IsMissing', 'u']).subs({ u: engine.string('ab') }).evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      engine
        .box(['IsMissing', 'z'])
        .subs({ z: engine.box(['Complex', 1, 2]) })
        .evaluate()
        .toString()
    ).toBe('"False"');
  });
});
