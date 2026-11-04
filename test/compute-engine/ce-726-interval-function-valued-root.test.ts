/**
 * CE-726: a root whose value is a function, compiled for `interval-js`.
 *
 * The compiled code of such a root is an expression whose value is a
 * JavaScript function over enclosures. Before, `run()` gave that function
 * (`compile(x ↦ 2x).run(3)`), which a caller cannot call with numbers and
 * which is not an `IntervalValue`. Now the result is called with the
 * arguments of the function (`calling: 'lambda'`), as the JavaScript target
 * calls a root `Function` literal: each argument is a number, an `Interval`
 * or a boolean, and the value is an `IntervalValue`. A function-valued root
 * that reads a free symbol declines: there is no vars object to read it from.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { createIntervalRuntime } from '../../src/interval';

const ce = new ComputeEngine();
ce.declare('f726', '(real) -> real');
ce.assign('f726', ce.box(['Function', ['Multiply', 3, 't'], 't']));

const DOUBLE: MathJsonExpression = ['Function', ['Multiply', 2, 'x'], 'x'];

function intervalCompile(json: MathJsonExpression) {
  return compile(ce.box(json), { to: 'interval-js', fallback: false });
}

/** The value of `json` applied to the numbers `args`, by the interpreter. */
function interpreted(json: MathJsonExpression, args: number[]): unknown {
  return ce
    .function('Apply', [ce.box(json), ...args.map((a) => ce.number(a))])
    .evaluate().json;
}

describe('CE-726: FUNCTION-VALUED ROOT ON INTERVAL-JS', () => {
  test.each<[string, MathJsonExpression, number[]]>([
    ['a function literal', DOUBLE, [3]],
    ['two parameters', ['Function', ['Add', 'x', 'y'], 'x', 'y'], [3, 4]],
    [
      'an annotated parameter',
      ['Function', ['Multiply', 2, 'x'], ['Typed', 'x', 'real']],
      [3],
    ],
    [
      'a default value, left out',
      ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 5]],
      [3],
    ],
    [
      'a default value, supplied',
      ['Function', ['Multiply', 'x', 'k'], 'x', ['Optional', 'k', 5]],
      [3, 2],
    ],
    [
      'a block whose value is a function literal',
      ['Block', ['Assign', 'k', 2], ['Function', ['Multiply', 'k', 'x'], 'x']],
      [3],
    ],
    ['a symbol whose value is a function', 'f726', [3]],
  ])('%s is called with its arguments', (_, json, args) => {
    const r = intervalCompile(json);
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    // There is no vars object, so there is no batch evaluator.
    expect(r.broadcast).toBeUndefined();
    const expected = interpreted(json, args);
    expect(typeof expected).toBe('number');
    expect((r.run as (...a: number[]) => unknown)(...args)).toEqual({
      kind: 'interval',
      value: { lo: expected, hi: expected },
    });
  });

  // Compiled code does not build a partial application
  // (`docs/COMPILATION-MODEL.md`, "Function values"): the root declines, and
  // the interpreter keeps the value.
  test('a partial application declines', () => {
    const json: MathJsonExpression = [
      'Apply',
      ['Function', ['Add', 'x', 'y'], 'x', 'y'],
      1,
    ];
    const r = intervalCompile(json);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/a partial application or a curried call/);
    expect(interpreted(json, [2])).toBe(3);
  });

  test('the reproduction of CE-726: run(3) is the interval of 6', () => {
    const r = intervalCompile(DOUBLE);
    expect(r.code).toBe('((x) => _IA.scale(_k1, x))');
    expect(r.run(3)).toEqual({ kind: 'interval', value: { lo: 6, hi: 6 } });
  });

  test('an interval argument gives an enclosure of the values over it', () => {
    const r = intervalCompile(DOUBLE);
    expect(r.run({ lo: 1, hi: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 2, hi: 4 },
    });
  });

  test('a relation gives the tri-state verdict, a list an array', () => {
    expect(intervalCompile(['Function', ['Greater', 'x', 0], 'x']).run(3)).toBe(
      'true'
    );
    expect(
      intervalCompile([
        'Function',
        ['List', 'x', ['Multiply', 2, 'x']],
        'x',
      ]).run(3)
    ).toEqual([
      { kind: 'interval', value: { lo: 3, hi: 3 } },
      { kind: 'interval', value: { lo: 6, hi: 6 } },
    ]);
  });

  test('a free symbol declines with the reason', () => {
    const r = intervalCompile(['Function', ['Multiply', 'a', 'x'], 'x']);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(
      /function-valued expression that reads the free symbol "a"/
    );
  });

  // The interval lowering of an `If` takes the hull of its arms, and the
  // hull of two functions is not a function. `c726` is declared, so that the
  // decline is not the one for an input with no type.
  test('a function-valued `If` declines with the reason', () => {
    ce.declare('c726', 'real');
    const r = intervalCompile([
      'If',
      ['Greater', 'c726', 0],
      ['Function', 'x', 'x'],
      ['Function', ['Negate', 'x'], 'x'],
    ]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/function-valued `If`/);
  });

  // The function that a curried literal gives takes enclosures, and the
  // runner converts only the arguments of the outer function.
  test.each<[string, MathJsonExpression]>([
    [
      'a curried function literal',
      ['Function', ['Function', ['Add', 'x', 'y'], 'y'], 'x'],
    ],
    [
      'a literal with no parameter whose value is a function',
      ['Function', ['Function', ['Multiply', 2, 'x'], 'x']],
    ],
  ])('%s declines with the reason', (_, json) => {
    const r = intervalCompile(json);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/a function whose value is a function/);
  });

  // The interval lowering of `If` and of a restriction does not give a function, so a
  // condition decided at compile time selects the function that is the root.
  test.each<[string, MathJsonExpression, number]>([
    [
      'an `If` with a true condition',
      [
        'If',
        ['Greater', 1, 0],
        DOUBLE,
        ['Function', ['Multiply', 3, 'x'], 'x'],
      ],
      6,
    ],
    [
      'an `If` with a false condition',
      ['If', ['Less', 1, 0], DOUBLE, ['Function', ['Multiply', 3, 'x'], 'x']],
      9,
    ],
    [
      'a nested `If`',
      [
        'If',
        ['Less', 1, 0],
        DOUBLE,
        [
          'If',
          ['Greater', ['Sqrt', 2], ['Divide', 7, 5]],
          ['Function', ['Multiply', 3, 'x'], 'x'],
          DOUBLE,
        ],
      ],
      9,
    ],
    ['a `When` with a true condition', ['If', 'True', DOUBLE], 6],
  ])('%s selects its function', (_, json, expected) => {
    const r = intervalCompile(json);
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    expect(interpreted(json, [3])).toBe(expected);
    expect(r.run(3)).toEqual({
      kind: 'interval',
      value: { lo: expected, hi: expected },
    });
  });

  // A random draw is not decided at compile time: the interpreter draws on
  // each call.
  test('an `If` whose condition is not decided declines', () => {
    const r = intervalCompile([
      'If',
      ['Greater', ['Random'], 2],
      DOUBLE,
      ['Function', ['Multiply', 3, 'x'], 'x'],
    ]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/function-valued `If`/);
  });

  // The caller's code runs on the compiled route, and the interpreter does
  // not run it, so the condition is not decided at compile time: the root is
  // kept, and declines as a function-valued `If`.
  test.each<[string, MathJsonExpression, Record<string, unknown>]>([
    [
      'the `If` head',
      [
        'If',
        ['Greater', 1, 0],
        DOUBLE,
        ['Function', ['Multiply', 3, 'x'], 'x'],
      ],
      { If: (_c: unknown, _a: unknown, b: unknown) => b },
    ],
    [
      'a head in the condition',
      [
        'If',
        ['Greater', ['Sin', 1], 0],
        DOUBLE,
        ['Function', ['Multiply', 3, 'x'], 'x'],
      ],
      { Sin: () => -1 },
    ],
  ])('a selection is not made when %s is overridden', (_, json, functions) => {
    const r = compile(ce.box(json), {
      to: 'interval-js',
      fallback: false,
      functions: functions as never,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/function-valued `If`/);
  });

  // The override reaches the condition through the body of the user function
  // `g726` that it calls: the compiled condition is false, while the
  // interpreter's is true, so no selection is made.
  test('a selection is not made when a called function reaches an override', () => {
    ce.declare('g726', '(real) -> boolean');
    ce.assign('g726', ce.box(['Function', ['Greater', ['Sin', 'y'], 0], 'y']));
    const json: MathJsonExpression = [
      'If',
      ['g726', 1],
      DOUBLE,
      ['Function', ['Multiply', 3, 'x'], 'x'],
    ];
    const r = compile(ce.box(json), {
      to: 'interval-js',
      fallback: false,
      functions: { Sin: () => '(-1)' } as never,
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/function-valued `If`/);
    // Without the override the condition is decided.
    expect(intervalCompile(json).run(3)).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  // The branch that is not selected is not compiled, but its static type
  // `error` still declines the root, as on every other root.
  test('a branch of static type `error` declines, selected or not', () => {
    const lit: MathJsonExpression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
    const r = intervalCompile([
      'If',
      ['Greater', 1, 0],
      DOUBLE,
      ['Function', ['Apply', lit, "'ab'", 'z'], ['Typed', 'z', 'real']],
    ]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/sub-expression of type 'error'/);
  });

  test('a scalar root keeps the vars-object convention', () => {
    const r = intervalCompile(['Multiply', 2, 'x']);
    expect(r.calling).toBe('expression');
    expect(r.run({ x: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });
});

describe('CE-726: STORED FUNCTION-VALUED RESULT', () => {
  const runtime = createIntervalRuntime();

  test('load() gives a function of the arguments', () => {
    const r = intervalCompile(['Function', ['Add', 'x', 'y'], 'x', 'y']);
    const stored = JSON.parse(JSON.stringify(r));
    expect(stored.calling).toBe('lambda');
    expect(runtime.load(stored)(3, { lo: 1, hi: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 4, hi: 5 },
    });
  });

  test('the constant table is evaluated once, the result is a copy', () => {
    const r = intervalCompile(['Function', 5]);
    const run = runtime.load(JSON.parse(JSON.stringify(r)));
    const first = run() as { kind: string; value: { lo: number } };
    first.value.lo = 0;
    expect(run()).toEqual({ kind: 'interval', value: { lo: 5, hi: 5 } });
  });

  // The compilation declines such code; stored code is data that a host can
  // change, so the runner checks that the code gives a function, and that
  // the function does not give a function.
  test('code that gives no function, or a function, answers `entire`', () => {
    const { runtimeVersion } = intervalCompile(DOUBLE);
    for (const code of ['_IA.point(5)', '((x) => (y) => _IA.add(x, y))'])
      expect(
        runtime.load({ runtimeVersion, code, calling: 'lambda' })(1)
      ).toEqual({ kind: 'entire' });
  });

  test('a batch evaluator is refused', () => {
    const stored = JSON.parse(JSON.stringify(intervalCompile(DOUBLE)));
    expect(() => runtime.loadBroadcast(stored)).toThrow(/calling: 'lambda'/);
    expect(() => runtime.loadBroadcastSlice(stored)).toThrow(
      /calling: 'lambda'/
    );
  });
});

describe('CE-726: INTERPRETER FALLBACK OF A FUNCTION-VALUED ROOT', () => {
  const engine = new ComputeEngine();
  engine.declare('a', 'real');
  const fallbackCompile = (json: MathJsonExpression) => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return compile(engine.box(json), { to: 'interval-js' });
    } finally {
      warn.mockRestore();
    }
  };

  // The block declines because its function reads the free symbol `a`. The
  // fallback is called with the arguments of the function, as the compiled
  // result would be, not with a vars object.
  test('a block root that reads a free symbol is called with its arguments', () => {
    const r = fallbackCompile([
      'Block',
      ['Function', ['If', ['Greater', 'x', 0], 'x', 'a'], 'x'],
    ]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/free symbol "a"/);
    expect(r.calling).toBe('lambda');
    expect(r.run(3)).toEqual({ kind: 'interval', value: { lo: 3, hi: 3 } });
  });

  test('a block root with an operator the target cannot lower', () => {
    const r = fallbackCompile(['Block', ['Function', ['Fibonacci', 'x'], 'x']]);
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run(5)).toEqual({ kind: 'interval', value: { lo: 5, hi: 5 } });
    // Over an argument wider than a point, the value at the midpoint does
    // not bound the values: `entire`.
    expect(r.run({ lo: 4, hi: 6 })).toEqual({ kind: 'entire' });
  });

  // `Random()` is less than 1, so the interpreter selects `x ↦ 3x`.
  test('an `If` with an undecided condition is applied by the interpreter', () => {
    const r = fallbackCompile([
      'If',
      ['Greater', ['Random'], 2],
      DOUBLE,
      ['Function', ['Multiply', 3, 'x'], 'x'],
    ]);
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run(3)).toEqual({ kind: 'interval', value: { lo: 9, hi: 9 } });
  });

  // The argument is boxed with the type of its parameter: an array for a
  // `tuple` parameter is a point, as for a bare function literal.
  test('an array argument of a tuple parameter is a tuple', () => {
    const r = fallbackCompile([
      'Block',
      [
        'Function',
        ['Fibonacci', ['At', 'p', 1]],
        ['Typed', 'p', 'tuple<integer, integer>'],
      ],
    ]);
    expect(r.calling).toBe('lambda');
    expect((r.run as (...a: unknown[]) => unknown)([5, 1])).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
  });

  // `'true'` is a boolean for a boolean parameter only; a string parameter
  // keeps the text.
  test('the strings of the boolean answers are converted for a boolean parameter only', () => {
    const asBoolean = fallbackCompile([
      'Block',
      ['Function', ['If', 'b', ['Fibonacci', 5], 0], ['Typed', 'b', 'boolean']],
    ]);
    expect((asBoolean.run as (...a: unknown[]) => unknown)('true')).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
    const asText = fallbackCompile([
      'Block',
      [
        'Function',
        ['If', ['Equal', 's', "'true'"], ['Fibonacci', 5], 0],
        ['Typed', 's', 'string'],
      ],
    ]);
    expect((asText.run as (...a: unknown[]) => unknown)('true')).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
    // The fallback declares no symbol of its own in the engine.
    expect(engine.lookupDefinition('_arg0')).toBeUndefined();
  });

  // The value of a curried function is a function, which has no interval
  // reading: `entire`, as from the runner of a compiled function.
  test.each<[string, MathJsonExpression]>([
    [
      'a curried literal',
      ['Function', ['Function', ['Add', 'x', 'y'], 'y'], 'x'],
    ],
    [
      'a block whose value is a curried literal',
      ['Block', ['Function', ['Function', ['Add', 'x', 'y'], 'y'], 'x']],
    ],
  ])('%s gives `entire` under the default fallback', (_, json) => {
    const r = fallbackCompile(json);
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run(3)).toEqual({ kind: 'entire' });
  });

  // A parameter whose type is an alias of a tuple type boxes an array as a
  // tuple, as the alias names.
  test('an array argument of a parameter typed by a tuple alias is a tuple', () => {
    engine.declareType('pt726', 'tuple<integer, integer>', { alias: true });
    const r = fallbackCompile([
      'Block',
      ['Function', ['Fibonacci', ['At', 'p', 1]], ['Typed', 'p', 'pt726']],
    ]);
    expect(r.calling).toBe('lambda');
    expect((r.run as (...a: unknown[]) => unknown)([5, 1])).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
  });

  // A character and a complex value have no interval reading: `entire`, as
  // from the generic fallback, not `empty` (no value).
  test.each<[string, MathJsonExpression, number]>([
    ['a character', ['Block', ['Function', ['CharacterFrom', "'a'"], 'x']], 3],
    [
      'a complex value',
      ['Block', ['Function', ['Sqrt', ['Negate', ['Fibonacci', 'x']]], 'x']],
      5,
    ],
  ])('a result that is %s gives `entire`', (_, json, arg) => {
    const r = fallbackCompile(json);
    expect(r.success).toBe(false);
    expect(r.calling).toBe('lambda');
    expect(r.run(arg)).toEqual({ kind: 'entire' });
  });
});
