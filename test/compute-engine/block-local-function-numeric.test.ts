import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// A function literal assigned to a local of a `Block` can be held by an
// OPERATOR definition (`_lambdaLiteral`), not by a value definition. Under
// `.N()`, an application of that local must read an exact argument as it
// was written, as the application of a global function does: the float of
// `(25! − 1)/24!` is the integer 25, and the float of `3/7` has no
// numerator of 3.

const ce = new ComputeEngine();

const FLOOR_ARG = [
  'Divide',
  ['Subtract', ['Factorial', 25], 1],
  ['Factorial', 24],
];

describe('A FUNCTION LOCAL TO A BLOCK UNDER .N() (BOX ROUTE)', () => {
  test('Floor reads the exact argument', () => {
    const expr = ce.box([
      'Block',
      ['Assign', 'hF', ['Function', ['Floor', 'x'], 'x']],
      ['hF', FLOOR_ARG],
    ]);
    expect(expr.N().toString()).toBe('24');
    expect(expr.evaluate().toString()).toBe('24');
  });

  test('Numerator reads the exact argument', () => {
    const expr = ce.box([
      'Block',
      [
        'Assign',
        'hLoc',
        ['Function', ['Multiply', 2, ['Numerator', 'x']], 'x'],
      ],
      ['hLoc', ['Rational', 3, 7]],
    ]);
    expect(expr.N().toString()).toBe('6');
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('Map with the name of the local as its callback', () => {
    const expr = ce.box([
      'Block',
      [
        'Assign',
        'hLoc2',
        ['Function', ['Multiply', 2, ['Numerator', 'x']], 'x'],
      ],
      ['Map', 'hLoc2', ['List', ['Rational', 3, 7], ['Rational', 5, 9]]],
    ]);
    expect(expr.N().toString()).toBe('[6,10]');
    expect(expr.evaluate().toString()).toBe('[6,10]');
  });

  test('the asynchronous route reads the exact argument', async () => {
    const expr = ce.box([
      'Block',
      ['Assign', 'hA', ['Function', ['Floor', 'x'], 'x']],
      ['hA', FLOOR_ARG],
    ]);
    const result = await expr.evaluateAsync({ numericApproximation: true });
    expect(result.toString()).toBe('24');
  });

  test('an argument with an effect is evaluated once', () => {
    // The operator definition evaluates the written operands itself, so the
    // application must not evaluate them before it hands them over.
    const expr = ce.box([
      'Block',
      ['Assign', 'cnt', 0],
      ['Assign', 'hE', ['Function', ['Multiply', 2, 'x'], 'x']],
      ['hE', ['Assign', 'cnt', ['Add', 'cnt', 1]]],
      'cnt',
    ]);
    expect(expr.N().toString()).toBe('1');
    expect(expr.evaluate().toString()).toBe('1');
  });
});

describe('A FUNCTION LOCAL TO A BLOCK UNDER .N() (PARSE ROUTE)', () => {
  test('Floor reads the exact argument', () => {
    const expr = ce.parse(
      '\\operatorname{Block}(h \\coloneq x \\mapsto \\lfloor x \\rfloor, h(\\frac{25!-1}{24!}))'
    );
    expect(expr.N().toString()).toBe('24');
    expect(expr.evaluate().toString()).toBe('24');
  });

  test('Numerator reads the exact argument', () => {
    const expr = ce.parse(
      '\\operatorname{Block}(g \\coloneq x \\mapsto 2\\cdot\\operatorname{Numerator}(x), g(\\frac{3}{7}))'
    );
    expect(expr.N().toString()).toBe('6');
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('Map with the name of the local as its callback', () => {
    const expr = ce.parse(
      '\\operatorname{Block}(k \\coloneq x \\mapsto 2\\cdot\\operatorname{Numerator}(x), \\operatorname{Map}(k, [\\frac{3}{7}]))'
    );
    expect(expr.N().toString()).toBe('[6]');
    expect(expr.evaluate().toString()).toBe('[6]');
  });
});

// Under `.N()`, the application of a function to an exact argument that
// differs from its approximation puts the written argument in the body
// (`applyWrittenArguments`, `function-utils.ts`). That application uses the
// application memo too, under a key of its own.
describe('THE APPLICATION MEMO OF A DIRECT APPLICATION UNDER .N()', () => {
  const memoKeys = (engine: ComputeEngine, name: string): string[] => {
    const def = engine.lookupDefinition(name) as
      { operator?: { _lambdaLiteral?: Expression } } | undefined;
    const literal = def?.operator?._lambdaLiteral;
    if (literal === undefined) return [];
    const memo = engine._applicationMemo?.get(literal);
    return memo === undefined ? [] : [...memo.results.keys()];
  };

  test('a repeated call with the same rational argument is memoized', () => {
    const engine = new ComputeEngine();
    engine
      .box([
        'Assign',
        'f',
        [
          'Function',
          ['Add', ['Floor', ['Multiply', 1000, 'x']], ['Sin', 'x']],
          'x',
        ],
      ])
      .evaluate();
    const call = engine.box(['f', ['Rational', 3, 7]]);
    const first = call.N();
    expect(memoKeys(engine, 'f').filter((k) => k.startsWith('W'))).toHaveLength(
      1
    );
    const again = call.N();
    expect(again.toString()).toBe(first.toString());
    // 428 + sin(3/7), computed independently.
    expect(first.re).toBeCloseTo(428 + Math.sin(3 / 7), 12);
  });

  test('a sum of many calls has the value of one call times the count', () => {
    const engine = new ComputeEngine();
    engine
      .box([
        'Assign',
        'f',
        [
          'Function',
          ['Add', ['Floor', ['Multiply', 1000, 'x']], ['Sin', 'x']],
          'x',
        ],
      ])
      .evaluate();
    const sum = engine
      .box([
        'Sum',
        ['f', ['Rational', 3, 7]],
        ['Element', 'k', ['Range', 1, 200]],
      ])
      .N();
    expect(sum.re).toBeCloseTo(200 * (428 + Math.sin(3 / 7)), 8);
  });

  test('an exact request and a numeric request do not share an entry', () => {
    const engine = new ComputeEngine();
    engine
      .box([
        'Assign',
        'g',
        ['Function', ['Add', ['Numerator', 'x'], ['Sin', 'x']], 'x'],
      ])
      .evaluate();
    const call = engine.box(['g', ['Rational', 3, 7]]);
    const numeric = call.N();
    expect(numeric.re).toBeCloseTo(3 + Math.sin(3 / 7), 12);
    // The exact value stays symbolic: `sin(3/7)` of an exact argument is an
    // exact constant.
    expect(call.evaluate().toString()).toBe('3 + sin(3/7)');
    expect(call.N().re).toBeCloseTo(3 + Math.sin(3 / 7), 12);
  });

  test('a change of precision is not answered from the memo', () => {
    const engine = new ComputeEngine();
    engine
      .box([
        'Assign',
        'p',
        ['Function', ['Add', ['Numerator', 'x'], ['Sin', 'x']], 'x'],
      ])
      .evaluate();
    const call = engine.box(['p', ['Rational', 3, 7]]);
    const low = call.N().toString();
    engine.precision = 50;
    const high = call.N().toString();
    expect(high.length).toBeGreaterThan(low.length + 20);
    expect(high.startsWith(low.slice(0, 15))).toBe(true);
  });

  test('a reassignment of the function is not answered from the memo', () => {
    const engine = new ComputeEngine();
    engine
      .box([
        'Assign',
        'q',
        ['Function', ['Multiply', 2, ['Numerator', 'x']], 'x'],
      ])
      .evaluate();
    expect(
      engine
        .box(['q', ['Rational', 3, 7]])
        .N()
        .toString()
    ).toBe('6');
    engine
      .box([
        'Assign',
        'q',
        ['Function', ['Multiply', 3, ['Numerator', 'x']], 'x'],
      ])
      .evaluate();
    expect(
      engine
        .box(['q', ['Rational', 3, 7]])
        .N()
        .toString()
    ).toBe('9');
  });

  test('a change of a value the body reads is not answered from the memo', () => {
    const engine = new ComputeEngine();
    engine.box(['Assign', 'c', 2]).evaluate();
    engine
      .box([
        'Assign',
        'r',
        ['Function', ['Multiply', 'c', ['Numerator', 'x']], 'x'],
      ])
      .evaluate();
    expect(
      engine
        .box(['r', ['Rational', 3, 7]])
        .N()
        .toString()
    ).toBe('6');
    engine.box(['Assign', 'c', 5]).evaluate();
    expect(
      engine
        .box(['r', ['Rational', 3, 7]])
        .N()
        .toString()
    ).toBe('15');
  });
});
