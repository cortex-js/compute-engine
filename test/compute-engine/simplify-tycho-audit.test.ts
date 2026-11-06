import { compile, ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

// These tests come from an audit of `simplify()` before compile over a corpus
// of plots: each case is a form that the audit found to change a value, a shape
// or a compile result, or to overrun a time limit.

function engineWithList(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real>');
  ce.declare('x', 'real');
  return ce;
}

describe('A zero times or over a list with no value yet is a list', () => {
  // Each case is simplified, and then evaluated with `L = [1, 2, 3]`. A scalar
  // result changes the length of a broadcast that holds the term.
  const cases: [string, MathJsonExpression, unknown][] = [
    ['0·L', ['Multiply', 0, 'L'], [0, 0, 0]],
    ['L·0·x keeps the list', ['Multiply', 'L', 0, 'x'], [0, 0, 0]],
    ['0/L', ['Divide', 0, 'L'], [0, 0, 0]],
    ['0/(L + 1)', ['Divide', 0, ['Add', 'L', 1]], [0, 0, 0]],
    ['0·L + 1', ['Add', ['Multiply', 0, 'L'], 1], [1, 1, 1]],
    ['0·L + L', ['Add', ['Multiply', 0, 'L'], 'L'], [1, 2, 3]],
    ['0·(L + 1)', ['Multiply', 0, ['Add', 'L', 1]], [0, 0, 0]],
    ['0·(L + 1) + 1', ['Add', ['Multiply', 0, ['Add', 'L', 1]], 1], [1, 1, 1]],
    ['0·2·L', ['Multiply', 0, 2, 'L'], [0, 0, 0]],
    ['2·(0·L)', ['Multiply', 2, ['Multiply', 0, 'L']], [0, 0, 0]],
    ['(0·L)/L', ['Divide', ['Multiply', 0, 'L'], 'L'], [0, 0, 0]],
    ['L - L', ['Subtract', 'L', 'L'], [0, 0, 0]],
    ['L - L + 1', ['Add', ['Subtract', 'L', 'L'], 1], [1, 1, 1]],
    [
      '2L - 2L',
      ['Subtract', ['Multiply', 2, 'L'], ['Multiply', 2, 'L']],
      [0, 0, 0],
    ],
  ];

  test.each(cases)('%s, simplified', (_, json, expected) => {
    const ce = engineWithList();
    const simplified = ce.box(json).simplify();
    expect(simplified.type.matches('list')).toBe(true);
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    expect(simplified.evaluate().json).toEqual(['List', ...(expected as [])]);
  });

  test.each(cases)('%s, boxed before the list has a value', (_, json, exp) => {
    const ce = engineWithList();
    const expr = ce.box(json);
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    expect(expr.evaluate().json).toEqual(['List', ...(exp as [])]);
  });

  test('the value-level operations keep the list', () => {
    const ce = engineWithList();
    const L = ce.box('L');
    expect(ce.Zero.mul(L).type.matches('list')).toBe(true);
    expect(L.mul(ce.Zero).type.matches('list')).toBe(true);
    expect(L.mul(0).type.matches('list')).toBe(true);
    expect(ce.box(['Add', 'L', 1]).mul(0).type.matches('list')).toBe(true);
    expect(ce.Zero.mul(L).mul(2).type.matches('list')).toBe(true);
    expect(ce.Zero.div(L).type.matches('list')).toBe(true);
  });

  test('like terms with a zero coefficient merge', () => {
    const ce = engineWithList();
    const expr = ce.box(['Add', ['Multiply', 0, 'L'], ['Multiply', 2, 'L']]);
    expect(expr.simplify().json).toEqual(['Multiply', 2, 'L']);
  });

  test('zero over a list with a value is a list', () => {
    const ce = engineWithList();
    const list = ce.box(['List', 1, 2]);
    expect(ce.Zero.div(list).evaluate().json).toEqual(['List', 0, 0]);
    ce.assign('L', list);
    expect(ce.Zero.div(ce.box('L')).evaluate().json).toEqual(['List', 0, 0]);
  });

  test('a scalar operand still folds to zero', () => {
    const ce = engineWithList();
    expect(ce.box(['Multiply', 0, 'x']).simplify().json).toBe(0);
    expect(ce.box(['Divide', 0, 'x']).json).toBe(0);
    expect(ce.box(['Multiply', 0, 'u']).simplify().json).toBe(0);
    expect(ce.box(['Divide', 0, 'u']).json).toBe(0);
  });

  // An undeclared function has a result type with a list member, and is a
  // scalar in almost every program, so a zero still folds beside it.
  describe('a type that only may hold a list folds to zero', () => {
    const cases: [string, string][] = [
      ['sin(f(x)) - sin(f(x))', '\\sin(f(x))-\\sin(f(x))'],
      ['0·sin(f(x))', '0\\sin(f(x))'],
      ['0/(f(x) + 2)', '\\frac{0}{f(x)+2}'],
      ['f(x)g(x) - f(x)g(x)', 'f(x)g(x)-f(x)g(x)'],
    ];
    test.each(cases)('%s', (_, latex) => {
      const ce = new ComputeEngine();
      expect(ce.parse(latex).simplify().json).toBe(0);
      expect(ce.parse(latex).evaluate().json).toBe(0);
    });

    test('2sin(f(x)) - 2sin(f(x)) + 1', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('2\\sin(f(x))-2\\sin(f(x))+1').simplify().json).toBe(1);
    });

    test('a derivative has no term with a zero factor', () => {
      const ce = new ComputeEngine();
      const value = ce.box(['D', ['Multiply', 2, ['Sin', ['h', 'x']]], 'x']);
      expect(JSON.stringify(value.evaluate().json)).not.toContain(
        '["Multiply",0'
      );
    });

    test('0/q after an inference of q', () => {
      const ce = new ComputeEngine();
      ce.box(['Mean', 'q']);
      expect(ce.box(['Divide', 0, 'q']).json).toBe(0);
    });
  });

  // A divisor with the cells `0` gives the cells `~oo` or `NaN`, not zeros, in
  // the simplified form as in the original.
  describe('a division by a zero times a list', () => {
    const cases: [string, MathJsonExpression][] = [
      ['1/(L - L)', ['Divide', 1, ['Subtract', 'L', 'L']]],
      [
        '(L - L)/(L - L)',
        ['Divide', ['Subtract', 'L', 'L'], ['Subtract', 'L', 'L']],
      ],
      ['(L - L)^-1', ['Power', ['Subtract', 'L', 'L'], -1]],
      ['1/(0·L)', ['Divide', 1, ['Multiply', 0, 'L']]],
      ['x/(L - L)', ['Divide', 'x', ['Subtract', 'L', 'L']]],
    ];
    test.each(cases)('%s has no finite cell', (_, json) => {
      const ce = engineWithList();
      const simplified = ce.box(json).simplify();
      ce.assign('L', ce.box(['List', 1, 2, 3]));
      ce.assign('x', 2);
      const value = simplified.evaluate();
      const cells = value.isCollection ? [...value.each()] : [value];
      for (const cell of cells) expect(cell.isFinite).not.toBe(true);
    });
  });
});

describe('The absolute value of an inverse function that is not always real', () => {
  // Each value is outside the real domain of the function, where `f(|x|)` is
  // complex and `|f(x)|` is real.
  test.each([
    ['Arcsin', 2],
    ['Arccsc', 0.5],
    ['Artanh', 2],
    ['Arcoth', 0.5],
  ] as const)('|%s(x)| keeps its real value at x = %d', (f, x) => {
    const ce = engineWithList();
    const simplified = ce.box(['Abs', [f, 'x']]).simplify();
    expect(simplified.operator).toBe('Abs');
    const value = simplified.subs({ x }).N();
    expect(value.im).toBe(0);
    expect(value.re).toBeGreaterThan(0);
  });

  test.each(['Arctan', 'Arsinh'])('|%s(x)| is still rewritten', (f) => {
    const ce = engineWithList();
    expect(ce.box(['Abs', [f, 'x']]).simplify().json).toEqual([
      f,
      ['Abs', 'x'],
    ]);
  });

  // The rewrite holds on the real axis only, and `isEligibleRealRewrite()`
  // declines a symbol declared complex.
  test.each(['Sinh', 'Arctan'])('|%s(z)| stays for a complex z', (f) => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    expect(ce.box(['Abs', [f, 'z']]).simplify().operator).toBe('Abs');
  });

  test('a comparison of the simplified form compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('theta', 'real');
    const expr = ce
      .box([
        'LessEqual',
        0,
        ['Abs', ['Arcsin', ['Sin', 'theta']]],
        ['Multiply', 2, 'Pi'],
      ])
      .simplify();
    const compiled = compile(expr, { to: 'javascript' });
    expect(compiled.success).toBe(true);
    expect(compiled.run!({ theta: 1 })).toBe(true);
  });
});

describe('A lazy operator over an operand that evaluates to itself', () => {
  // `Map` holds its operands and evaluates one that can be absent. An operand
  // that holds a read (`At`) qualifies, and with a length that is not known it
  // evaluates to itself. Replacing it with that value and evaluating the `Map`
  // again repeated this step until the stack overflowed.
  const index = (list: MathJsonExpression): MathJsonExpression => [
    'Add',
    ['Mod', ['Range', 0, ['Add', ['Length', list], -1]], 3],
    1,
  ];
  const scaled: MathJsonExpression = [
    'Multiply',
    'L',
    ['At', ['List', 2, 2, 0], index('L')],
  ];
  const conditional: MathJsonExpression = [
    'Which',
    ['Equal', ['Mod', ['Range', 1, 'N'], 3], 0],
    1,
    'True',
    0,
  ];
  const read: MathJsonExpression = ['At', ['List', 0, 1, 2], index(scaled)];
  const witness: MathJsonExpression = ['Add', conditional, read];

  function engine(): ComputeEngine {
    const ce = engineWithList();
    ce.declare('N', 'real');
    return ce;
  }

  test('evaluate() does not overflow the stack', () => {
    expect(() => engine().box(witness).evaluate()).not.toThrow();
  });

  test('simplify() reports no overflow and leaves no error', () => {
    const ce = engine();
    const messages: string[] = [];
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args) => void messages.push(args.join(' ')));
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation((...args) => void messages.push(args.join(' ')));
    try {
      const result = ce.box(witness).simplify();
      expect(JSON.stringify(result.json)).not.toContain('"Error"');
    } finally {
      spy.mockRestore();
      warn.mockRestore();
    }
    expect(messages.join('\n')).not.toContain('Maximum call stack');
  });
});

describe('simplify() under a time limit', () => {
  // Without the deadline check in the pairs of a sum of squared trigonometric
  // terms, this call ran for about 5,600 ms with a limit of 300 ms. The bound is
  // wide so that a loaded machine does not fail the test.
  test('a large expansion ends close to the limit', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Divide',
      [
        'Power',
        [
          'Add',
          ['Sin', ['Multiply', 3, 'x']],
          ['Cos', ['Multiply', 'x', ['Power', 'Pi', 2]]],
          2,
        ],
        64,
      ],
      ['Power', 'M', 64],
    ]);
    const start = Date.now();
    expect(() => ce.withTimeLimit({ ms: 300 }, () => expr.simplify())).toThrow(
      'Timeout exceeded'
    );
    expect(Date.now() - start).toBeLessThan(3000);
  });

  test('the identity of a common factor still applies', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Add',
      ['Multiply', 'g', ['Power', ['Sin', 'x'], 2]],
      ['Multiply', 'g', ['Power', ['Cos', 'x'], 2]],
    ]);
    expect(expr.simplify().json).toBe('g');
  });
});

describe('A field that is zero wherever it is defined', () => {
  // `simplify()` does not fully simplify the operands of a sum, and it keeps a
  // relation whose two sides are the same, so the public test of an identity
  // is `isIdenticallyEqual()` on the two sides (`docs/SIMPLIFY.md`).
  const quotient: MathJsonExpression = [
    'Divide',
    ['Multiply', 'x', 'x', 'y', 'y'],
    ['Multiply', 'x', 'y'],
  ];
  const product: MathJsonExpression = ['Multiply', 'x', 'y'];

  // The test samples random points, so one call does not show that the answer
  // is stable.
  test('isIdenticallyEqual() of the two sides is true at each call', () => {
    const ce = new ComputeEngine();
    const a = ce.box(quotient);
    const b = ce.box(product);
    for (let i = 0; i < 50; i++) expect(a.isIdenticallyEqual(b)).toBe(true);
  });

  test('two sides that differ are not reported as identical', () => {
    const ce = new ComputeEngine();
    const a = ce.box(quotient);
    const b = ce.box(['Add', product, 0.001]);
    for (let i = 0; i < 50; i++) expect(a.isIdenticallyEqual(b)).not.toBe(true);
  });
});

describe('A factor that reads a shadowed index in a nested scope', () => {
  // The index `i` shadows the imaginary unit, so simplify() replaces it with an
  // opaque name. An inner bound `i` is the same binding as the outer index, so
  // it gets the same name, and the factor stays in the sum.
  function check(latex: string, declare: string[] = []): void {
    const ce = new ComputeEngine();
    for (const name of declare) ce.declare(name, 'real');
    const original = ce.parse(latex);
    const simplified = original.simplify();
    expect(simplified.unknowns).toEqual(original.unknowns);
    ce.assign(original.unknowns[0], 3);
    expect(simplified.N().re).toBeCloseTo(original.N().re, 10);
  }
  const summand = '\\sin(\\sum_{k=1}^{i}\\sin(0.3k))\\exp(-i)';

  test('an inner upper bound', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(`\\sum_{i=0}^{n}${summand}`);
    expect(expr.simplify().operator).toBe('Sum');
    expect(expr.simplify().unknowns).toEqual(['n']);
    check(`\\sum_{i=0}^{n}${summand}`);
  });

  test('an outer bound that holds a declared symbol', () => {
    check(`\\sum_{i=0}^{\\lfloor t\\rfloor}${summand}`, ['t']);
  });

  test('an inner lower bound', () => {
    check('\\sum_{i=0}^{n}\\sin(\\sum_{k=i}^{3}\\sin(0.3k))\\exp(-i)');
  });

  test('an inner Product', () => {
    check('\\sum_{i=0}^{n}\\sin(\\prod_{k=1}^{i}\\sin(0.3k))\\exp(-i)');
  });

  test('an outer Product', () => {
    check('\\prod_{i=1}^{n}\\sin(\\sum_{k=1}^{i}\\sin(0.3k))\\exp(-i)');
  });

  test('two inner sums', () => {
    check(
      '\\sum_{i=0}^{n}(\\sum_{k=1}^{i}\\sin(0.3k))(\\sum_{j=1}^{i}\\sin(0.2j))\\exp(-i)'
    );
  });

  test('a factor with no index still moves out', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\sum_{i=0}^{n}\\sin(\\sum_{k=1}^{4}\\sin(0.3k))\\exp(-i)'
    );
    expect(expr.simplify().operator).toBe('Multiply');
    check('\\sum_{i=0}^{n}\\sin(\\sum_{k=1}^{4}\\sin(0.3k))\\exp(-i)');
  });

  test('an inner sum that binds the same name is a separate index', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse(
      '\\sum_{i=0}^{n}\\sin(\\sum_{i=1}^{2}\\sin(0.3i))\\exp(-i)'
    );
    expect(expr.simplify().operator).toBe('Multiply');
    check('\\sum_{i=0}^{n}\\sin(\\sum_{i=1}^{2}\\sin(0.3i))\\exp(-i)');
  });
});
