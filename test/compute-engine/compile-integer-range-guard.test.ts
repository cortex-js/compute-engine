import { existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { main, type CliIo } from '../../src/cli/main';
import { TEST_PYTHON } from './test-python';

// Compiled arithmetic is machine arithmetic: a float where the interpreter
// gives an exact number is expected. An operation that reads every digit of
// its operand is different. The remainders (`Mod`, `Remainder`) and the
// common divisor and multiple (`GCD`, `LCM`) of a double beyond 2^53 - 1 are
// computed on the rounding of the value, not on the value, so they give a
// different number: compiled `Mod(2^60 + 1, 10)` answered `6`, the
// interpreter `7`. A sum that overflowed to `Infinity` made `Mod` answer
// `NaN`. The compiled code now throws a `RangeError` that names the operation
// and the value (`integerOperand` in `compilation/javascript-runtime.ts`).
//
// The constant fold had the same defect by another route: it folds a
// constant subtree with the interpreter's `.N()`, which rounds each operand to
// the working precision first. `DigitSum(2^1000)` folded to `84` (the digit
// sum of a 21-digit decimal), where `evaluate()` answers `1366`. Such a
// subtree now folds to the value of `evaluate()` when it is exact, and
// declines otherwise (`unsafeIntegerOperands` and `exactFoldValue` in
// `base-compiler.ts`).

const ce = new ComputeEngine();

const MAX = Number.MAX_SAFE_INTEGER;

function compiled(json: unknown) {
  const r = compile(ce.box(json as never), { fallback: false });
  expect(r.success).toBe(true);
  return r;
}

function runWith(json: unknown, vars: Record<string, number>): unknown {
  return compiled(json).run!(vars as never);
}

const rangeError = (op: string) =>
  new RegExp(`^${op}: .* is beyond the safe integer range of compiled code`);

describe('run-time guard: an operand beyond the safe integer range throws', () => {
  it.each([
    ['Mod', ['Mod', 'x', 10]],
    ['Remainder', ['Remainder', 'x', 7]],
    ['GCD', ['GCD', 'x', 6]],
    ['LCM', ['LCM', 'x', 4]],
  ])('%s with a dividend of 2^60', (op, json) => {
    expect(() => runWith(json, { x: 2 ** 60 })).toThrow(RangeError);
    expect(() => runWith(json, { x: 2 ** 60 })).toThrow(rangeError(op));
  });

  it.each([
    ['Mod', ['Mod', 'x', 10]],
    ['Remainder', ['Remainder', 'x', 7]],
    ['GCD', ['GCD', 'x', 6]],
    ['LCM', ['LCM', 'x', 4]],
  ])('%s with an infinite operand', (op, json) => {
    expect(() => runWith(json, { x: Infinity })).toThrow(rangeError(op));
    expect(() => runWith(json, { x: -Infinity })).toThrow(rangeError(op));
  });

  it('the divisor is checked too', () => {
    expect(() => runWith(['Mod', 5, 'x'], { x: 2 ** 60 })).toThrow(
      rangeError('Mod')
    );
    expect(() => runWith(['Remainder', 5, 'x'], { x: Infinity })).toThrow(
      rangeError('Remainder')
    );
  });

  it('the message names the operation and the value', () => {
    expect(() => runWith(['Mod', 'x', 10], { x: 2 ** 60 })).toThrow(
      'Mod: 1152921504606847000 is beyond the safe integer range of compiled code'
    );
  });

  it('an integer-typed non-negative dividend takes the same guard', () => {
    // A proven non-negative integer pair used to compile to a plain `%`,
    // which answered the remainder of the rounded double.
    const e = new ComputeEngine();
    e.declare('n', 'integer');
    e.assume(e.parse('n \\ge 0'));
    const r = compile(e.box(['Mod', 'n', 10]), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ n: 17 } as never)).toBe(7);
    expect(() => r.run!({ n: 2 ** 60 + 1 } as never)).toThrow(
      rangeError('Mod')
    );
  });

  it('an overflowed sum feeding Mod throws instead of answering NaN', () => {
    // The sum of n^n for n = 1..k overflows the double range at k = 144,
    // and `Mod(Infinity, 10^10)` was `NaN`.
    const json = [
      'Mod',
      ['Sum', ['Power', 'n', 'n'], ['Limits', 'n', 1, 'k']],
      ['Power', 10, 10],
    ];
    expect(runWith(json, { k: 10 })).toBe(
      ce.box(['Mod', 10405071317, 10 ** 10]).evaluate().re
    );
    expect(() => runWith(json, { k: 1000 })).toThrow(
      'Mod: Infinity is beyond the safe integer range'
    );
  });

  it('a NaN operand propagates', () => {
    for (const json of [
      ['Mod', 'x', 10],
      ['Remainder', 'x', 7],
      ['GCD', 'x', 6],
    ])
      expect(runWith(json, { x: NaN })).toBeNaN();
  });

  it('Mod by 1 is not checked: its value does not depend on the lost digits', () => {
    // The remainder by 1 of every double beyond 2^53 is 0, which is also the
    // exact answer for the integer the double rounds.
    expect(runWith(['Mod', 'x', 1], { x: 2 ** 60 })).toBe(0);
  });

  it('the largest safe integer is still accepted', () => {
    expect(runWith(['Mod', 'x', 10], { x: MAX })).toBe(1);
    expect(runWith(['Mod', 'x', 10], { x: -MAX })).toBe(9);
    expect(runWith(['GCD', 'x', 3], { x: MAX })).toBe(1);
  });
});

describe('safe integers agree with the interpreter', () => {
  const values = [-1000003, -17, -7, -1, 0, 1, 7, 17, 360, 1000003, 2 ** 52];
  const divisors = [-7, -3, 3, 7, 10, 97];

  it.each([['Mod'], ['Remainder']])('%s', (op) => {
    const r = compiled([op, 'x', 'm']);
    for (const x of values)
      for (const m of divisors)
        expect(r.run!({ x, m } as never)).toBe(
          ce.box([op, x, m]).evaluate().re
        );
  });

  it.each([['GCD'], ['LCM']])('%s', (op) => {
    const r = compiled([op, 'x', 'm']);
    for (const x of [1, 6, 12, 35, 360, 1000003])
      for (const m of [1, 4, 9, 10, 97])
        expect(r.run!({ x, m } as never)).toBe(
          ce.box([op, x, m]).evaluate().re
        );
  });
});

describe('constant fold of an operand beyond the safe integer range', () => {
  const folded = (json: unknown) => {
    const r = compiled(json);
    return { code: r.code, value: r.run!({} as never) };
  };

  it('DigitSum(2^1000) folds to the exact value, not to 84', () => {
    expect(ce.box(['DigitSum', ['Power', 2, 1000]]).evaluate().re).toBe(1366);
    expect(folded(['DigitSum', ['Power', 2, 1000]])).toEqual({
      code: '1366',
      value: 1366,
    });
  });

  it('IntegerDigits(2^60) folds to the exact digits', () => {
    const digits = [...(2n ** 60n).toString()].map(Number);
    expect(folded(['IntegerDigits', ['Power', 2, 60]]).value).toEqual(digits);
  });

  it('Mod of an overflowing constant sum folds to the exact value', () => {
    // Project Euler 48 with a `Sum` over literal limits: `.N()` answered
    // 2683211021.
    expect(
      folded([
        'Mod',
        ['Sum', ['Power', 'n', 'n'], ['Limits', 'n', 1, 1000]],
        ['Power', 10, 10],
      ]).value
    ).toBe(9110846700);
  });

  it.each([
    [['Mod', ['Power', 2, 100], 7], 2],
    [['Mod', ['Add', ['Power', 2, 60], 1], 10], 7],
    [['Remainder', ['Power', 2, 60], 7], 1],
    [['GCD', ['Power', 2, 100], 6], 2],
  ])('%j folds to %p', (json, expected) => {
    expect(ce.box(json as never).evaluate().re).toBe(expected);
    expect(folded(json).value).toBe(expected);
  });

  it('an operand with no exact value declines and the guard throws', () => {
    // `√2 · 10^30` has no exact literal, so the integer operation cannot be
    // computed exactly (`evaluate()` answers `5`, the value is `0.698…`):
    // the fold declines, the operand folds alone to a double beyond the
    // range, and the run throws.
    const r = compiled([
      'Mod',
      ['Multiply', ['Sqrt', 2], ['Power', 10, 30]],
      7,
    ]);
    expect(r.code).toContain('_SYS.floorMod(');
    expect(() => r.run!({} as never)).toThrow(rangeError('Mod'));
  });

  it('a digit operator with no JavaScript lowering declines', () => {
    expect(() =>
      compile(ce.box(['DigitSum', ['Power', 'x', 1000]]), { fallback: false })
    ).toThrow(/DigitSum/);
  });

  it('a nesting of digit operators is scanned once per node', () => {
    // Each level of `DigitSum(DigitSum(…(2^60 + 2)))` used to scan every
    // level below it again, an exponential number of scans in all.
    let json: unknown = ['Add', ['Power', 2, 60], 2];
    for (let i = 0; i < 20; i++) json = ['DigitSum', json];
    const start = Date.now();
    expect(folded(json)).toEqual({ code: '3', value: 3 });
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(1000);
  });

  it('an operand of too many digits declines the exact fold', () => {
    // `2^20000` has 6,021 digits, more than the cap of the exact fold
    // (`EXACT_FOLD_MAX_DIGITS`). The operand folds alone, to a double that
    // overflows to `Infinity`, and the run-time guard refuses it.
    const r = compiled(['Mod', ['Power', 2, 20000], 7]);
    expect(r.code).toBe('_SYS.floorMod(Infinity, 7)');
    expect(() => r.run!({} as never)).toThrow(
      'Mod: Infinity is beyond the safe integer range'
    );
  });

  it('a sum with too many exact iterations declines the exact fold', () => {
    // The sum of n^n for n = 1..1300 has 4,048 digits, under the cap, but
    // 1300 iterations on values of 214 machine words exceed the fold
    // ceiling. As above, the operand folds alone to `Infinity` and the
    // run-time guard refuses it.
    const r = compiled([
      'Mod',
      ['Sum', ['Power', 'n', 'n'], ['Limits', 'n', 1, 1300]],
      ['Power', 10, 10],
    ]);
    expect(r.code).toBe('_SYS.floorMod(Infinity, 10000000000)');
    expect(() => r.run!({} as never)).toThrow(
      'Mod: Infinity is beyond the safe integer range'
    );
  });

  it('an operand inside a Sum is replaced by its exact value', () => {
    // The exact fold evaluates `2^100` once and evaluates the `Sum` with
    // the value in its place.
    const json = [
      'Sum',
      ['Mod', ['Power', 2, 100], 'n'],
      ['Limits', 'n', 1, 10],
    ];
    expect(ce.box(json as never).evaluate().re).toBe(21);
    expect(folded(json)).toEqual({ code: '21', value: 21 });
  });

  it('an operand that uses the index of a Sum folds to the exact value', () => {
    // `2^n` has no value of its own, so its digits cannot be checked before
    // the evaluation. The fold takes the value of `evaluate()`: `.N()`
    // answered `84`, the digit sum of a 21-digit decimal.
    const json = [
      'Sum',
      ['DigitSum', ['Power', 2, 'n']],
      ['Limits', 'n', 1000, 1000],
    ];
    expect(ce.box(json as never).evaluate().re).toBe(1366);
    expect(folded(json)).toEqual({ code: '1366', value: 1366 });
  });

  it('an unchecked operand in too many iterations does not fold to a wrong value', () => {
    // `n^n` has no value of its own, so the exact fold prices it at the
    // largest operand it accepts. 1000 iterations of that size exceed the
    // fold ceiling, so the fold declines and the compiled loop refuses the
    // first operand beyond the range. `.N()` answered 646802592660, where
    // `evaluate()` answers 4629110846700.
    const json = [
      'Sum',
      ['Mod', ['Power', 'n', 'n'], ['Power', 10, 10]],
      ['Limits', 'n', 1, 1000],
    ];
    expect(ce.box(json as never).evaluate().re).toBe(4629110846700);
    const r = compiled(json);
    expect(r.code).not.toContain('646802592660');
    let value: unknown;
    let error: unknown;
    try {
      value = r.run!({} as never);
    } catch (e) {
      error = e;
    }
    expect(value).not.toBe(646802592660);
    expect(error).toBeInstanceOf(RangeError);
    expect((error as Error).message).toMatch(rangeError('Mod'));
  });

  it('an unchecked operand that is not rational declines', () => {
    // `evaluate()` reads a rounding of `√2 · 10^30` and answers the exact
    // `5`, where the value is `0.698…`. The operand has no value before the
    // evaluation, and its type is not rational, so the fold declines and the
    // run-time guard refuses the operand.
    const r = compiled([
      'Sum',
      ['Mod', ['Multiply', ['Sqrt', 2], ['Power', 10, 30], 'n'], 7],
      ['Limits', 'n', 1, 1],
    ]);
    expect(() => r.run!({} as never)).toThrow(rangeError('Mod'));
  });

  it('a small Sum with an unchecked operand still folds', () => {
    // The type of `n^n` is a bare `integer`, so the operand stays unchecked,
    // and the fold takes the exact value of `evaluate()`.
    const json = [
      'Sum',
      ['Mod', ['Power', 'n', 'n'], 7],
      ['Limits', 'n', 1, 10],
    ];
    expect(ce.box(json as never).evaluate().re).toBe(25);
    expect(folded(json)).toEqual({ code: '25', value: 25 });
  });

  it('an unchecked operand with a safe integer range type keeps the ordinary fold', () => {
    // The type of `n` is `integer<1..1000>`, inside the safe integer range,
    // so the operand is known to be safe without a value.
    const json = ['Sum', ['Mod', 'n', 7], ['Limits', 'n', 1, 1000]];
    expect(ce.box(json as never).evaluate().re).toBe(3003);
    expect(folded(json)).toEqual({ code: '3003', value: 3003 });
  });

  it('safe constant operands keep the ordinary fold', () => {
    expect(folded(['DigitSum', 1234]).value).toBe(10);
    expect(folded(['IntegerDigits', 255, 16]).value).toEqual([15, 15]);
    expect(folded(['Mod', ['Power', 2, 40], 7]).value).toBe(2);
    expect(folded(['GCD', 12, 18]).value).toBe(6);
  });
});

describe('Python target', () => {
  const py = new PythonTarget();

  it('Mod and Remainder check a non-literal operand', () => {
    const mod = py.compile(ce.box(['Mod', 'x', 10])).code;
    expect(mod).toContain("np.mod(*_ce_int_operands('Mod', False, x, 10))");
    expect(mod).toContain('def _ce_int_operands(_op, _all, _a, _b):');
    const rem = py.compile(ce.box(['Remainder', 'x', 7])).code;
    expect(rem).toContain('_ce_remainder(x, 7)');
    expect(rem).toContain("_ce_int_operands('Remainder', True, _a, _b)");
    // A bare lambda has no module helper: the check is inline.
    const lambda = py.compileLambda(ce.box(['Mod', 'x', 10]), ['x']);
    expect(lambda).not.toContain('_ce_int_operand');
    expect(lambda).toContain('ValueError(');
  });

  it('Mod by the literal 1 is not checked', () => {
    expect(py.compile(ce.box(['Mod', 'x', 1])).code).toBe('np.mod(x, 1)');
  });

  const hasNumpy = (() => {
    if (TEST_PYTHON === undefined) return false;
    try {
      execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  const itPy = hasNumpy ? it : it.skip;

  itPy('the emitted code raises for a float beyond the range', () => {
    const helperCode = py.compile(ce.box(['Mod', 'x', 10])).code;
    const lambda = py.compileLambda(ce.box(['Remainder', 'x', 7]), ['x']);
    const program = [
      'import numpy as np',
      `def f(x):\n    return ${helperCode.split('\n').pop()}`,
      helperCode.split('\n').slice(0, -1).join('\n'),
      `g = ${lambda}`,
      'for fn in (f, g):',
      "    for x in (17.0, 2.0**60, float('inf'), 2**60 + 1):",
      '        try:',
      '            print(repr(float(fn(x))))',
      '        except ValueError as e:',
      "            print('ValueError ' + str(e).split(':')[0])",
    ].join('\n');
    const out = execFileSync(TEST_PYTHON!, ['-c', program])
      .toString()
      .trim()
      .split('\n');
    expect(out).toEqual([
      '7.0',
      'ValueError Mod',
      'ValueError Mod',
      // A Python integer is exact: `np.mod` computes on it exactly.
      '7.0',
      '3.0',
      'ValueError Remainder',
      'ValueError Remainder',
      // The `Remainder` formula divides, so an integer beyond the range
      // raises too.
      'ValueError Remainder',
    ]);
  });
});

describe('Epsil CLI compile mode', () => {
  function makeIo(): { io: CliIo; stdout: () => string } {
    let out = '';
    const io: CliIo = {
      stdin: {
        isTTY: false,
        setEncoding() {},
        async *[Symbol.asyncIterator]() {},
      } as unknown as NodeJS.ReadStream,
      stdout: {
        isTTY: false,
        write: (s: string) => ((out += s), true),
      } as unknown as NodeJS.WriteStream,
      stderr: {
        isTTY: false,
        write: () => true,
      } as unknown as NodeJS.WriteStream,
      env: {},
    };
    return { io, stdout: () => out };
  }

  const corpus = join(__dirname, '..', 'epsil', 'corpus', 'euler');

  it('Project Euler 16 gives the exact digit sums', async () => {
    const file = join(corpus, '016-power-digit-sum.epsil');
    expect(existsSync(file)).toBe(true);
    const { io, stdout } = makeIo();
    expect(await main(['--compile', '--json', file], io)).toBe(0);
    // A compiled number is a float, so the JSON spells each one as an
    // inexact number.
    expect(JSON.parse(stdout())).toEqual([
      'Triple',
      { num: '1366.0' },
      { num: '1366.0' },
      { num: '302.0' },
    ]);
  });

  it('Project Euler 48 is an error value, not NaN', async () => {
    // `sum(map(n => n^n, 1..1000))` is computed at run time and overflows
    // to `Infinity`; `Mod` refuses it.
    const file = join(corpus, '048-self-powers.epsil');
    expect(existsSync(file)).toBe(true);
    const { io, stdout } = makeIo();
    await main(['--compile', '--json', file], io);
    expect(JSON.parse(stdout())).toEqual([
      'Error',
      'Mod: Infinity is beyond the safe integer range of compiled code (±9007199254740991); evaluate with the interpreter for the exact result',
    ]);
  });
});

describe('Python target: the effective dtype of the Mod and Remainder operands', () => {
  const py = new PythonTarget();

  const hasNumpy = (() => {
    if (TEST_PYTHON === undefined) return false;
    try {
      execFileSync(TEST_PYTHON, ['-c', 'import numpy'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
  const itPy = hasNumpy ? it : it.skip;

  /** Run `calls` (Python expressions of `f`, the compiled function, and
   * `g`, the compiled lambda) and print the value or the `ValueError`. */
  function runPython(json: unknown, calls: string[]): string[] {
    const helperCode = py.compile(ce.box(json as never)).code;
    const lambda = py.compileLambda(ce.box(json as never), ['x', 'm']);
    const program = [
      'import numpy as np',
      `def f(x, m):\n    return ${helperCode.split('\n').pop()}`,
      helperCode.split('\n').slice(0, -1).join('\n'),
      `g = ${lambda}`,
      'for call in (' + calls.map((c) => JSON.stringify(c)).join(', ') + ',):',
      '    try:',
      '        print(repr(float(eval(call))))',
      '    except ValueError as e:',
      "        print('ValueError ' + str(e).split(':')[0])",
    ].join('\n');
    return execFileSync(TEST_PYTHON!, ['-c', program])
      .toString()
      .trim()
      .split('\n');
  }

  // `np.mod` converts an integer to a float when the other operand is a
  // float: `np.mod(2**60 + 1, 10.0)` is `6.0`, the exact answer is `7`.
  itPy('Mod of an integer beyond the range by a float raises', () => {
    expect(
      runPython(
        ['Mod', 'x', 'm'],
        [
          'f(2**60 + 1, 10.0)',
          'g(2**60 + 1, 10.0)',
          'f(10.0, 2**60 + 1)',
          'g(10.0, 2**60 + 1)',
          // Two integers: `np.mod` is exact.
          'f(2**60 + 1, 10)',
          'g(2**60 + 1, 10)',
        ]
      )
    ).toEqual([
      'ValueError Mod',
      'ValueError Mod',
      'ValueError Mod',
      'ValueError Mod',
      '7.0',
      '7.0',
    ]);
  });

  // `np.abs(np.int64(-2**63))` overflows and stays negative, so a test of
  // the absolute value accepted the minimum int64.
  itPy('the minimum int64 is beyond the range', () => {
    expect(
      runPython(
        ['Mod', 'x', 'm'],
        [
          'f(np.int64(-2**63), 10.0)',
          'g(np.int64(-2**63), 10.0)',
          // Two integers: `np.mod` is exact.
          'f(np.int64(-2**63), np.int64(10))',
        ]
      )
    ).toEqual(['ValueError Mod', 'ValueError Mod', '2.0']);
    expect(
      runPython(
        ['Remainder', 'x', 'm'],
        [
          'f(np.int64(-2**63), 10)',
          'g(np.int64(-2**63), 10)',
          'f(-2**63, 10)',
          'g(-2**63, 10)',
        ]
      )
    ).toEqual([
      'ValueError Remainder',
      'ValueError Remainder',
      'ValueError Remainder',
      'ValueError Remainder',
    ]);
  });

  itPy('Remainder computes each operand once', () => {
    const helperCode = py.compile(ce.box(['Remainder', 'x', 'y']), {
      vars: { x: 'ca()', y: 'cb()' },
    }).code;
    const program = [
      'import numpy as np',
      'calls = []',
      'def ca():\n    calls.append("a")\n    return 5',
      'def cb():\n    calls.append("b")\n    return 2',
      helperCode.split('\n').slice(0, -1).join('\n'),
      `print(repr(float(${helperCode.split('\n').pop()})))`,
      'print("".join(calls))',
    ].join('\n');
    // The quotient 5/2 is a tie, rounded toward +∞: 5 - 2·3 = -1.
    expect(
      execFileSync(TEST_PYTHON!, ['-c', program]).toString().trim().split('\n')
    ).toEqual(['-1.0', 'ab']);
  });

  it('the Remainder lambda writes each operand once', () => {
    const lambda = py.compileLambda(
      ce.box(['Remainder', ['Add', 'x', 29], ['Add', 'm', 3]]),
      ['x', 'm']
    );
    // Once as a parameter of the lambda, once as an operand.
    expect(lambda.match(/\bx\b/g)?.length).toBe(2);
    expect(lambda.match(/\bm\b/g)?.length).toBe(2);
  });
});
