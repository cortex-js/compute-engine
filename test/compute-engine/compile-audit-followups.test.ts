import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

function derivativeEngine(body = 'f(x):=x^3') {
  const ce = new ComputeEngine();
  ce.parse(body).evaluate();
  ce.declare('z', 'complex');
  ce.declare('x', 'real');
  return ce;
}

describe('applied closed-form derivatives', () => {
  test.each([1, 2])(
    'order %i uses complex arithmetic, including its parent',
    (order) => {
      const ce = derivativeEngine();
      const expr = ce.box([
        'Add',
        1,
        ['Apply', ['Derivative', 'f', order], 'z'],
      ]);
      const result = compile(expr, { constantFold: false });
      expect(result.success).toBe(true);
      for (const [re, im] of [
        [1.16, -0.3],
        [-2, 0.7],
        [0, 1],
      ]) {
        const expected = expr.subs({ z: ce.box(['Complex', re, im]) }).N();
        const actual = result.run!({ z: { re, im } }) as {
          re: number;
          im: number;
        };
        expect(typeof actual === 'number' ? actual : actual.re).toBeCloseTo(
          expected.re,
          12
        );
        expect(typeof actual === 'number' ? 0 : actual.im).toBeCloseTo(
          expected.im,
          12
        );
      }
    }
  );

  test('built-in derivatives use the same complex result analysis', () => {
    const ce = derivativeEngine();
    const expr = ce.box(['Add', 1, ['Apply', ['Derivative', 'Sin', 1], 'z']]);
    const result = compile(expr, { constantFold: false });
    const expected = expr.subs({ z: ce.box(['Complex', 1, 2]) }).N();
    const actual = result.run!({ z: { re: 1, im: 2 } }) as {
      re: number;
      im: number;
    };
    expect(actual.re).toBeCloseTo(expected.re, 12);
    expect(actual.im).toBeCloseTo(expected.im, 12);
  });
  test('a constant derivative stays real at a complex argument', () => {
    const ce = derivativeEngine('f(x):=3x');
    const expr = ce.box(['Add', 1, ['Apply', ['Derivative', 'f', 1], 'z']]);
    const result = compile(expr, { constantFold: false });
    expect(result.success).toBe(true);
    expect(result.run!({ z: { re: 1, im: 2 } })).toBe(4);
  });

  test('the argument is evaluated once', () => {
    const ce = derivativeEngine();
    const result = compile(ce.box(['Apply', ['Derivative', 'f', 2], 'z']), {
      constantFold: false,
    });
    let reads = 0;
    result.run!({
      get z() {
        reads++;
        return { re: 1, im: 2 };
      },
    });
    // The runner validates the input once, then the kernel reads it once.
    expect(reads).toBe(2);
  });

  test('interval application encloses the derivative on the whole interval', () => {
    const ce = derivativeEngine();
    const result = compile(ce.box(['Apply', ['Derivative', 'f', 1], 'x']), {
      to: 'interval-js',
      constantFold: false,
    });
    expect(result.success).toBe(true);
    expect(result.unsupported).not.toContain('Apply');
    const actual = result.run!({ x: { lo: 1, hi: 2 } }) as any;
    expect(actual.kind).toBe('interval');
    expect(actual.value.lo).toBeLessThanOrEqual(3);
    expect(actual.value.hi).toBeGreaterThanOrEqual(12);
  });

  test('interval derivatives preserve degree mode', () => {
    const ce = new ComputeEngine({ angularUnit: 'deg' });
    ce.parse('f(x):=\\sin(x)').evaluate();
    ce.declare('x', 'real');
    const expr = ce.box(['Apply', ['Derivative', 'f', 1], 'x']);
    const result = compile(expr, { to: 'interval-js', constantFold: false });
    expect(result.success).toBe(true);
    for (const x of [0, 30, 60]) {
      const expected = expr.subs({ x: ce.number(x) }).N().re;
      const actual = result.run!({ x: { lo: x, hi: x } }) as any;
      expect(actual.kind).toBe('interval');
      expect(actual.value.lo).toBeLessThanOrEqual(expected + 1e-16);
      expect(actual.value.hi).toBeGreaterThanOrEqual(expected - 1e-16);
    }
  });

  test.each([[[]], [['x', 'x']]])(
    'interval application rejects wrong arity %j',
    (args) => {
      const ce = derivativeEngine();
      const result = compile(
        ce.box(['Apply', ['Derivative', 'f', 1], ...args]),
        { to: 'interval-js', constantFold: false }
      );
      expect(result.success).toBe(false);
    }
  );
});

describe('Dot with declared broadcastable coordinates', () => {
  function engine() {
    const ce = new ComputeEngine();
    for (const name of ['a', 'b'])
      ce.declare(name, 'tuple<broadcastable<number>, broadcastable<number>>');
    return ce;
  }
  test.each([
    [[1, 2], [3, 4], 11],
    [
      [1, [1, 2]],
      [3, 4],
      [7, 11],
    ],
    [
      [[1, 2], 3],
      [4, [5, 6]],
      [19, 26],
    ],
    [
      [
        [1, 2],
        [3, 4],
      ],
      [5, 6],
      [23, 34],
    ],
  ])('broadcasts %j and %j', (a, b, expected) => {
    const ce = engine();
    const result = compile(ce.box(['Dot', 'a', 'b']), { constantFold: false });
    expect(result.success).toBe(true);
    expect(result.run!({ a, b })).toEqual(expected);
    const tuple = (x: unknown[]): MathJsonExpression =>
      [
        'Tuple',
        ...x.map((v) => (Array.isArray(v) ? ['List', ...v] : v)),
      ] as MathJsonExpression;
    expect(
      ce.box(['Dot', tuple(a as unknown[]), tuple(b as unknown[])]).evaluate()
        .json
    ).toEqual(Array.isArray(expected) ? ['List', ...expected] : expected);
  });
  test('complex broadcast coordinates decline instead of multiplying objects as numbers', () => {
    const ce = new ComputeEngine();
    for (const name of ['a', 'b'])
      ce.declare(name, 'tuple<broadcastable<complex>, broadcastable<complex>>');
    expect(
      compile(ce.box(['Dot', 'a', 'b']), { constantFold: false }).success
    ).toBe(false);
  });
  test('each operand is evaluated once and wrong widths retain the runtime fallback', () => {
    const result = compile(engine().box(['Dot', 'a', 'b']), {
      constantFold: false,
    });
    let reads = 0;
    expect(
      result.run!({
        get a() {
          reads++;
          return [1, [1, 2]];
        },
        b: [3, 4],
      })
    ).toEqual([7, 11]);
    // The runner validates the input once, then the kernel reads it once.
    expect(reads).toBe(2);
    expect(result.run!({ a: [1, 2, 3], b: [4, 5, 6] })).toBe(32);
  });
});

describe('sharing range-gather reductions', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<number>');
    for (const name of ['a', 'b']) ce.declare(name, 'integer');
    return ce;
  }
  const reduce = (head: string): MathJsonExpression => [
    head,
    ['At', 'P', ['Range', 'a', 'b']],
  ];
  const loops = (code: string) => (code.match(/for \(/g) ?? []).length;
  test.each(['Sum', 'Product'])('%s walks the gather only once', (head) => {
    const ce = engine();
    const expr = ce.box(['Add', ['Sin', reduce(head)], ['Cos', reduce(head)]]);
    const shared = compile(expr, { constantFold: false });
    const plain = compile(expr, { constantFold: false, cse: false });
    expect(shared.success).toBe(true);
    expect(loops(shared.code!)).toBe(1);
    expect(loops(plain.code!)).toBe(2);
    for (const [a, b] of [
      [1, 3],
      [3, 1],
      [-2, -1],
      [0, 2],
    ]) {
      const vars = { P: [2, 3, 4], a, b };
      expect(shared.run!(vars)).toEqual(plain.run!(vars));
    }
  });
  test('a three-term unrolled sum shares its invariant reduction', () => {
    const ce = engine();
    const result = compile(
      ce.box(['Sum', ['Multiply', 'k', reduce('Sum')], ['Limits', 'k', 1, 3]]),
      { constantFold: false }
    );
    expect(result.success).toBe(true);
    expect(loops(result.code!)).toBe(1);
    expect(result.run!({ P: [1, 2, 3], a: 1, b: 3 })).toBe(36);
  });
  test('a skipped branch does not evaluate the gather', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const result = compile(
      ce.box([
        'If',
        ['Greater', 'x', 0],
        ['Add', ['Sin', reduce('Sum')], ['Cos', reduce('Sum')]],
        0,
      ]),
      { constantFold: false }
    );
    expect(result.success).toBe(true);
    expect(
      result.run!({
        x: -1,
        P: Object.defineProperty([1, 2, 3], '0', {
          get() {
            throw new Error('unreachable');
          },
        }),
        a: 1,
        b: 3,
      })
    ).toBe(0);
  });
});
