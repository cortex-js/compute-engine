/**
 * A destructuring `Declare` whose pattern has the same name at two positions
 * (`Declare((a, a), "unknown", (1, 2))`) compiles, and the name gets the
 * value at its last position, as in the interpreter.
 *
 * The interpreter evaluates the whole value first, then binds the names in
 * depth-first pattern order, so the last position wins. The compiled lowering
 * desugared the pattern into one declaration per position, so it emitted
 * `let a = 1; let a = 2` in one scope. That is not valid JavaScript, and
 * `compile()` reported a `SyntaxError` from the parse of the generated code.
 * The lowering now changes each earlier position of the name into `_`: its
 * element is still evaluated, and only the last position declares the name.
 *
 * The Epsil parser rejects such a pattern, so only a MathJSON input can
 * contain it.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { MathJsonExpression } from '../../src/math-json/types';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

const T = "'unknown'";

const BLOCK: MathJsonExpression = [
  'Block',
  ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', 1, 2]],
  'a',
];

const CASES: Array<[name: string, expr: MathJsonExpression, value: number]> = [
  ['block', BLOCK, 2],
  [
    'block, the name repeats in a nested pattern',
    [
      'Block',
      [
        'Declare',
        ['Tuple', 'a', ['Tuple', 'b', 'a']],
        T,
        ['Tuple', 1, ['Tuple', 2, 3]],
      ],
      ['Add', 'a', 'b'],
    ],
    5,
  ],
  [
    'block, the first occurrence is in a nested pattern',
    [
      'Block',
      [
        'Declare',
        ['Tuple', ['Tuple', 'a', 'b'], 'a'],
        T,
        ['Tuple', ['Tuple', 1, 2], 3],
      ],
      ['Add', 'a', 'b'],
    ],
    5,
  ],
  [
    'block, the last element reads an input',
    [
      'Block',
      ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', 1, ['Add', 'x', 1]]],
      'a',
    ],
    6,
  ],
  [
    'loop body',
    [
      'Block',
      ['Declare', 's', T, 0],
      [
        'Loop',
        [
          'Block',
          ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', 'k', 2]],
          ['Assign', 's', ['Add', 's', 'a']],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ],
    6,
  ],
  [
    'Sum body',
    [
      'Sum',
      ['Block', ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', 2, 'k']], 'a'],
      ['Limits', 'k', 1, 3],
    ],
    6,
  ],
];

// `Declare((a, a), "unknown", (1, a + 1))` is not covered: in the
// interpreter, the `a` of `a + 1` is the block local, which has no value
// yet, so the result is the symbolic `a + 1`. The compilation declines it
// because a statement reads the block local before it has a value, as it
// does for a pattern with distinct names.

describe('A destructuring declaration with a repeated name compiles', () => {
  test.each(CASES)('%s', (_name, json, value) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('x', 5);
    const expr = ce.box(json);
    expect(expr.evaluate().re).toBe(value);
    const result = compile(expr, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run!({ x: 5 })).toBe(value);
  });

  test('an element at an earlier position is still evaluated', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', ['Tuple', 'a', 'a'], T, ['Tuple', ['Random'], 2]],
      'a',
    ]);
    const result = compile(expr, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/drawNextRandomNumber\(\);\s*let a = 2;/);
    expect(result.run!({})).toBe(2);
  });

  test('the Python target emits one binding of the name', () => {
    const ce = new ComputeEngine();
    const src = new PythonTarget().compileFunction(ce.box(BLOCK), 'fn', []);
    expect(src).toMatch(/\ba = 2\b/);
    expect(src).not.toMatch(/\ba = 1\b/);
  });
});

const describePython =
  TEST_PYTHON !== undefined && fs.existsSync(TEST_PYTHON)
    ? describe
    : describe.skip;

describePython('A repeated name, Python execution (venv)', () => {
  test('the emitted Python returns the interpreter value', () => {
    const ce = new ComputeEngine();
    const program = `${new PythonTarget().compileFunction(ce.box(BLOCK), 'fn', [])}\nprint(fn())\n`;
    const file = path.join(os.tmpdir(), `ce-py-repeated-${process.pid}.py`);
    fs.writeFileSync(file, program);
    let out = '';
    try {
      out = execFileSync(TEST_PYTHON!, [file], { encoding: 'utf8' });
    } finally {
      fs.unlinkSync(file);
    }
    expect(Number(out.trim())).toBe(2);
  });
});
