import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The value of a block is its last statement, with the values that the
// statements before it assign. `Integrate` reduces a block that only assigns
// local variables to that value. It leaves every other block to the quadrature
// of `N()`, which runs the block at each sample, and `evaluate()` keeps such an
// integral unevaluated.

type Json = MathJsonExpression;

const CX: Json = ['Multiply', 'c', 'x'];
const UNIT: Json = ['Limits', 'x', 0, 1];
const BRANCH: Json[] = [
  ['Declare', 'c', { str: 'unknown' }, 0],
  ['If', ['Greater', 'x', 0.5], ['Assign', 'c', 1], ['Assign', 'c', 2]],
];

const block = (...statements: Json[]): Json =>
  ['Block', ...statements] as unknown as Json;

const integral = (ce: ComputeEngine, ...statements: Json[]): Expression =>
  ce.box(['Integrate', block(...statements), UNIT] as Json);

const numeric = (e: Expression): number => e.re;

describe('Integrate of a block of local assignments', () => {
  test.each<[string, Json[], string, number]>([
    [
      'an assignment',
      [['Declare', 'c', { str: 'unknown' }, 0], ['Assign', 'c', 2], CX],
      '1',
      1,
    ],
    [
      'a declaration with no written type',
      [['Declare', 'c', { str: 'unknown' }, 2], CX],
      '1',
      1,
    ],
    [
      'a declaration whose value has the written type',
      [['Declare', 'c', { str: 'real' }, 2], CX],
      '1',
      1,
    ],
    [
      'a value that reads the variable',
      [
        ['Declare', 'c', { str: 'unknown' }, ['Multiply', 'x', 'x']],
        ['Add', 'c', 1],
      ],
      '4/3',
      4 / 3,
    ],
    [
      'a local that gets a new value after another local read it',
      [
        ['Declare', 'a', { str: 'unknown' }, 1],
        ['Declare', 'b', { str: 'unknown' }, ['Add', 'a', 1]],
        ['Assign', 'a', 3],
        ['Multiply', 'a', 'b', 'x'],
      ],
      '3',
      3,
    ],
    [
      'a value with an inner sum',
      [
        ['Declare', 'c', { str: 'unknown' }, 2],
        ['Sum', ['Multiply', 'c', 'k', 'x'], ['Limits', 'k', 1, 3]],
      ],
      '6',
      6,
    ],
  ])('%s: evaluate() and N() agree', (_, statements, exact, approximate) => {
    const ce = new ComputeEngine();
    expect(integral(ce, ...statements).evaluate().toString()).toBe(exact);
    expect(numeric(integral(ce, ...statements).N())).toBeCloseTo(approximate);
  });

  test('a list integrand is integrated element by element', () => {
    const ce = new ComputeEngine();
    const e = integral(
      ce,
      ['Declare', 'c', { str: 'unknown' }, 2],
      ['List', CX, 'x']
    );
    expect(e.evaluate().toString()).toBe('[1,1/2]');
  });

  test('every route gives the same value', () => {
    const ce = new ComputeEngine();
    const viaFunction = ce.function('Integrate', [
      ce.box(block(['Declare', 'c', { str: 'unknown' }, 2], CX)),
      ce.box(UNIT),
    ]);
    expect(viaFunction.evaluate().toString()).toBe('1');
    const parsed = ce.parse('\\int_0^1 (c \\coloneq 2; c x) \\, dx');
    expect(parsed.evaluate().toString()).toBe('1');
    expect(numeric(parsed.N())).toBeCloseTo(1);
  });

  test('an indefinite integral', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Integrate',
      block(['Declare', 'c', { str: 'unknown' }, 2], CX),
      ['Limits', 'x', 'Nothing', 'Nothing'],
    ] as Json);
    expect(e.evaluate().toString()).toBe('x^2');
    expect(e.N().toString()).toBe('x^2');
  });

  test('several limits', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Integrate',
      block(
        ['Declare', 'c', { str: 'unknown' }, 2],
        ['Multiply', 'c', 'x', 'y']
      ),
      UNIT,
      ['Limits', 'y', 0, 1],
    ] as Json);
    expect(e.evaluate().toString()).toBe('1/2');
  });

  test('a function literal with several statements', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Integrate',
      ['Function', block(['Declare', 'c', { str: 'unknown' }, 2], CX), 'x'],
      UNIT,
    ] as Json);
    expect(e.evaluate().toString()).toBe('1');
  });

  test('a free symbol of the value stays in the result, in the scope of the caller', () => {
    const ce = new ComputeEngine();
    const value = integral(
      ce,
      ['Declare', 'c', { str: 'unknown' }, 'a'],
      CX
    ).evaluate();
    const written = ce
      .box(['Integrate', ['Multiply', 'a', 'x'], UNIT] as Json)
      .evaluate();
    expect(value.isSame(written)).toBe(true);
  });

  test('a value reads a global, and a local hides a global', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 3);
    ce.assign('c', 5);
    expect(
      integral(ce, ['Declare', 'c', { str: 'unknown' }, 'a'], CX)
        .evaluate()
        .toString()
    ).toBe('3/2');
    expect(ce.box('c').evaluate().toString()).toBe('5');
  });

  test('the block declares nothing outside the integral', () => {
    const ce = new ComputeEngine();
    integral(ce, ['Declare', 'c', { str: 'unknown' }, 2], CX).evaluate();
    expect(ce.lookupDefinition('c')).toBeUndefined();
  });

  test('an argument of the running call is put in the value', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Integrate',
          block(['Declare', 'c', { str: 'unknown' }, 'f'], CX),
          UNIT,
        ],
        'f',
      ] as Json)
    );
    expect(ce.box(['g', 2]).evaluate().toString()).toBe('1');
    expect(ce.box(['g', ['Multiply', 'x', 'x']]).evaluate().toString()).toBe(
      '1/4'
    );
  });

  test('the residue method reads the value', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Integrate',
      block(
        ['Declare', 'c', { str: 'unknown' }, 2],
        ['Divide', 'c', ['Add', 1, ['Square', 'x']]]
      ),
      ['Limits', 'x', 'NegativeInfinity', 'PositiveInfinity'],
    ] as Json);
    expect(e.evaluate().toString()).toBe('2pi');
  });
});

describe('Integrate of any other block stays unevaluated under evaluate()', () => {
  const expectDeclined = (e: Expression, approximate: number) => {
    expect(e.evaluate().operator).toBe('Integrate');
    expect(numeric(e.N())).toBeCloseTo(approximate);
  };

  test('a statement that branches', () => {
    // c is 2 on [0, 1/2] and 1 on [1/2, 1], so the integral of c·x is 5/8.
    expectDeclined(integral(new ComputeEngine(), ...BRANCH, CX), 5 / 8);
  });

  test('a statement that branches, over the real line: no residue method', () => {
    // 2·(atan(1/2) + π/2) + (π/2 − atan(1/2))
    const expected = Math.atan(0.5) + (3 * Math.PI) / 2;
    expectDeclined(
      new ComputeEngine().box([
        'Integrate',
        block(...BRANCH, ['Divide', 'c', ['Add', 1, ['Square', 'x']]]),
        ['Limits', 'x', 'NegativeInfinity', 'PositiveInfinity'],
      ] as Json),
      expected
    );
  });

  test('an indefinite integral with a statement that branches', () => {
    const e = new ComputeEngine().box([
      'Integrate',
      block(...BRANCH, CX),
      ['Limits', 'x', 'Nothing', 'Nothing'],
    ] as Json);
    expect(e.evaluate().operator).toBe('Integrate');
    expect(e.N().operator).toBe('Integrate');
  });

  test('an assignment to a variable outside the block', () => {
    const ce = new ComputeEngine();
    ce.assign('c', 5);
    expect(integral(ce, ['Assign', 'c', 2], CX).evaluate().operator).toBe(
      'Integrate'
    );
    // `evaluate()` runs no statement of the block.
    expect(ce.box('c').evaluate().toString()).toBe('5');
  });

  test('a value that is not pure is not substituted in each use', () => {
    const e = integral(
      new ComputeEngine(),
      ['Declare', 'c', { str: 'unknown' }, ['Random']],
      ['Add', CX, 'c']
    );
    expect(e.evaluate().operator).toBe('Integrate');
  });

  test('a value that does not have the written type', () => {
    const e = integral(
      new ComputeEngine(),
      ['Declare', 'c', { str: 'integer' }, ['Rational', 1, 2]],
      CX
    );
    expect(e.evaluate().operator).toBe('Integrate');
  });

  test('an assignment to a local declared with a written type', () => {
    const e = integral(
      new ComputeEngine(),
      ['Declare', 'c', { str: 'real' }, 2],
      ['Assign', 'c', 3],
      CX
    );
    expect(e.evaluate().operator).toBe('Integrate');
  });

  test.each(['real<', 'nosuchtype', 'integer | missing'])(
    'a written type that the declaration refuses: %s',
    (type) => {
      const ce = new ComputeEngine();
      const statements: Json[] = [['Declare', 'c', { str: type }, 2], CX];
      expect(integral(ce, ...statements).evaluate().operator).toBe('Integrate');
      const derivative = ce.box(['D', block(...statements), 'x'] as Json);
      expect(derivative.evaluate().operator).toBe('D');
    }
  );

  test('a value that fails and that no statement reads', () => {
    const ce = new ComputeEngine();
    const failing: Json = ['AssertPresent', 'Missing'];
    expect(
      integral(
        ce,
        ['Declare', 'c', { str: 'unknown' }, failing],
        'x'
      ).evaluate().operator
    ).toBe('Integrate');
    expect(
      integral(
        ce,
        ['Declare', 'c', { str: 'unknown' }, failing],
        ['Assign', 'c', 2],
        CX
      ).evaluate().operator
    ).toBe('Integrate');
    const unread = ce.box([
      'D',
      block(['Declare', 'c', { str: 'unknown' }, failing], 'x'),
      'x',
    ] as Json);
    expect(unread.evaluate().operator).toBe('D');
  });

  test('a value that fails and that only a branch reads', () => {
    const ce = new ComputeEngine();
    const statements: Json[] = [
      ['Declare', 'c', { str: 'unknown' }, ['AssertPresent', 'Missing']],
      ['If', 'False', 'c', 'x'],
    ];
    expect(integral(ce, ...statements).evaluate().operator).toBe('Integrate');
    const derivative = ce.box(['D', block(...statements), 'x'] as Json);
    expect(derivative.evaluate().operator).toBe('D');
  });

  test('a literal that no statement reads is dropped', () => {
    const ce = new ComputeEngine();
    expect(
      integral(ce, ['Declare', 'c', { str: 'unknown' }, 2], 'x')
        .evaluate()
        .toString()
    ).toBe('1/2');
  });

  test('an assignment to the integration variable', () => {
    expectDeclined(integral(new ComputeEngine(), ['Assign', 'x', 2], 'x'), 2);
  });

  test('a local function', () => {
    expectDeclined(
      integral(
        new ComputeEngine(),
        [
          'Declare',
          'c',
          { str: 'unknown' },
          ['Function', ['Add', 't', 1], 't'],
        ],
        ['Apply', 'c', 'x']
      ),
      3 / 2
    );
  });

  test('a binder with the name of a local', () => {
    expectDeclined(
      integral(
        new ComputeEngine(),
        ['Declare', 'k', { str: 'unknown' }, 2],
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]]
      ),
      3
    );
  });

  test('a declaration without a value is an error, under evaluate() and N()', () => {
    const e = integral(
      new ComputeEngine(),
      ['Declare', 'c', { str: 'real' }],
      ['Assign', 'c', 2],
      CX
    );
    expect(e.evaluate().operator).toBe('Error');
    expect(e.N().operator).toBe('Error');
  });
});

describe('a block inside the integrand', () => {
  test('the antiderivative takes the value of the block', () => {
    const e = new ComputeEngine().box([
      'Integrate',
      ['Add', 1, block(['Declare', 'c', { str: 'unknown' }, 2], CX)],
      UNIT,
    ] as Json);
    expect(e.evaluate().toString()).toBe('2');
  });

  test('a free symbol of the value is in the scope of the caller', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Integrate',
        ['Add', 1, block(['Declare', 'c', { str: 'unknown' }, 'a'], CX)],
        UNIT,
      ] as Json)
      .evaluate();
    const written = ce
      .box(['Add', 1, ['Divide', 'a', 2]] as Json)
      .evaluate();
    expect(value.isSame(written)).toBe(true);
  });

  test('the antiderivative of a block it cannot reduce stays unevaluated', () => {
    const e = new ComputeEngine().box([
      'Integrate',
      ['Add', 1, block(...BRANCH, CX)],
      UNIT,
    ] as Json);
    expect(e.evaluate().has('Integrate')).toBe(true);
  });
});

describe('the text form of an integral', () => {
  test('shows every statement of a block', () => {
    const text = integral(
      new ComputeEngine(),
      ['Declare', 'c', { str: 'unknown' }, 2],
      CX
    ).toString();
    expect(text).toContain('Declare(c, "unknown", 2)');
    expect(text).toContain('c * x');
  });

  test('shows the statement of a block of one statement, with no braces', () => {
    const text = new ComputeEngine()
      .box(['Integrate', CX, UNIT] as Json)
      .toString();
    expect(text).toBe('int_(0)^(1)(c * x dx)');
  });
});

describe('derivative of a block with a written type', () => {
  test('a value with the written type is substituted', () => {
    const e = new ComputeEngine().box([
      'D',
      block(['Declare', 'c', { str: 'real' }, 2], CX),
      'x',
    ] as Json);
    expect(e.evaluate().toString()).toBe('2');
  });

  test('a value without the written type stays unevaluated', () => {
    const e = new ComputeEngine().box([
      'D',
      block(['Declare', 'c', { str: 'integer' }, ['Rational', 1, 2]], CX),
      'x',
    ] as Json);
    expect(e.evaluate().operator).toBe('D');
  });
});
