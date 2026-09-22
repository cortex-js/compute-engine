import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// ELEMENT-WISE ARITHMETIC OVER LISTS OF MACHINE NUMBERS, COMPUTED ON DOUBLES
//
// Above a hundred elements a broadcast answers a lazy `Map`, whose elements
// are computed by the interpreter one function application at a time. When
// the operands are lists of machine numbers and the engine is at machine
// precision, `Add`, `Multiply` and `Negate` are computed at once on doubles
// (`machineBroadcast`, `boxed-expression/machine-broadcast.ts`) and answered
// as a list that holds its numbers unboxed. `Sum`, `Max` and `Min` fold the
// doubles of such a list.
//
// The contract these tests hold: the VALUES are the ones the interpreter
// computes element by element. Each value is compared with the same
// operation applied to the scalar elements, which never takes the new route.
// Every case where the doubles could differ from the interpreter must
// DECLINE, that is, take the route it took before.
//

const N = 300;
let seed = 987654321;
function random(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const FLOATS = Array.from({ length: N }, () => (random() - 0.5) * 200);
const FLOATS2 = Array.from({ length: N }, () => (random() - 0.5) * 0.002);
const INTEGERS = Array.from({ length: N }, () =>
  Math.floor((random() - 0.5) * 2000)
);

function machineEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('L', { value: ce.box(['List', ...FLOATS]) });
  ce.declare('M', { value: ce.box(['List', ...FLOATS2]) });
  ce.declare('K', { value: ce.box(['List', ...INTEGERS]) });
  return ce;
}

/** Does this list hold its numbers unboxed, which is how the new route
 * answers? */
function isUnboxedList(x: Expression): boolean {
  return (
    x.operator === 'List' &&
    (x as unknown as { _numericStore?: unknown })._numericStore !== undefined
  );
}

/** The elements of a finite collection, as MathJSON. */
function elements(x: Expression): unknown[] {
  return [...x.each()].map((el) => el.json);
}

describe('element-wise arithmetic on doubles: values', () => {
  const ce = machineEngine();
  const scalar = (json: unknown[]) => ce.box(json as never).evaluate().json;

  test.each([
    ['2·L', ['Multiply', 2, 'L'], (x: number) => ['Multiply', 2, x]],
    ['L·2.5', ['Multiply', 'L', 2.5], (x: number) => ['Multiply', x, 2.5]],
    ['L + 1', ['Add', 'L', 1], (x: number) => ['Add', x, 1]],
    ['L + 0.1', ['Add', 'L', 0.1], (x: number) => ['Add', x, 0.1]],
    ['-L', ['Negate', 'L'], (x: number) => ['Negate', x]],
    [
      '2 - 2·L',
      ['Subtract', 2, ['Multiply', 2, 'L']],
      (x: number) => ['Subtract', 2, ['Multiply', 2, x]],
    ],
  ])('%s is the scalar operation on every element', (_l, json, perElement) => {
    for (const route of ['evaluate', 'N'] as const) {
      const expr = ce.box(json as never);
      const result = route === 'N' ? expr.N() : expr.evaluate();
      expect(isUnboxedList(result)).toBe(true);
      expect(elements(result)).toEqual(
        FLOATS.map((x) => scalar(perElement(x)))
      );
    }
  });

  test('two lists: L + M and L·M', () => {
    const sum = ce.box(['Add', 'L', 'M']).evaluate();
    const product = ce.box(['Multiply', 'L', 'M']).evaluate();
    expect(isUnboxedList(sum)).toBe(true);
    expect(isUnboxedList(product)).toBe(true);
    expect(elements(sum)).toEqual(
      FLOATS.map((x, i) => scalar(['Add', x, FLOATS2[i]]))
    );
    expect(elements(product)).toEqual(
      FLOATS.map((x, i) => scalar(['Multiply', x, FLOATS2[i]]))
    );
  });

  test('the parse route and the box route agree', () => {
    const parsed = ce.parse('2-2L').evaluate();
    const boxed = ce.box(['Subtract', 2, ['Multiply', 2, 'L']]).evaluate();
    expect(isUnboxedList(parsed)).toBe(true);
    expect(elements(parsed)).toEqual(elements(boxed));
  });

  test('integers stay exact', () => {
    const result = ce.box(['Add', ['Multiply', 3, 'K'], 1]).evaluate();
    expect(isUnboxedList(result)).toBe(true);
    expect(elements(result)).toEqual(INTEGERS.map((k) => 3 * k + 1));
    expect([...result.each()].every((el) => el.isInteger === true)).toBe(true);
  });

  test('the answer is a value: a later assignment does not change it', () => {
    const local = machineEngine();
    const result = local.box(['Multiply', 2, 'L']).evaluate();
    const before = elements(result);
    local.assign('L', local.box(['List', ...FLOATS2]));
    expect(elements(result)).toEqual(before);
  });
});

describe('element-wise arithmetic on doubles: declined cases', () => {
  // Each case takes the route it took before. The value is pinned against the
  // scalar operation, and the answer is NOT a list of unboxed doubles.
  const ce = machineEngine();
  const scalar = (json: unknown[]) => ce.box(json as never).evaluate().json;

  test('an exact rational scalar keeps exact products of the integers', () => {
    const result = ce.box(['Multiply', ['Rational', 1, 3], 'K']).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)).toEqual(
      INTEGERS.map((k) => scalar(['Multiply', ['Rational', 1, 3], k]))
    );
  });

  test('a list with an exact rational element', () => {
    ce.declare('Q', {
      value: ce.box(['List', ...INTEGERS.map((k) => ['Rational', k, 7])]),
    });
    const result = ce.box(['Multiply', 2, 'Q']).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)).toEqual(
      INTEGERS.map((k) => scalar(['Multiply', 2, ['Rational', k, 7]]))
    );
  });

  test('a list with a symbolic element', () => {
    ce.declare('W', {
      value: ce.box(['List', ...FLOATS.map((x, i) => (i === 17 ? 'x' : x))]),
    });
    const result = ce.box(['Add', 'W', 1]).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)[17]).toEqual(['Add', 'x', 1]);
  });

  test('a NaN or an infinite element', () => {
    ce.declare('Wnan', {
      value: ce.box(['List', ...FLOATS.map((x, i) => (i === 17 ? 'NaN' : x))]),
    });
    ce.declare('Winf', {
      value: ce.box([
        'List',
        ...FLOATS.map((x, i) => (i === 17 ? 'PositiveInfinity' : x)),
      ]),
    });
    const nan = ce.box(['Multiply', 0, 'Wnan']).evaluate();
    const inf = ce.box(['Multiply', 0, 'Winf']).evaluate();
    expect(isUnboxedList(nan)).toBe(false);
    expect(isUnboxedList(inf)).toBe(false);
    expect(elements(nan)[17]).toEqual(scalar(['Multiply', 0, 'NaN']));
    expect(elements(inf)[17]).toEqual(
      scalar(['Multiply', 0, 'PositiveInfinity'])
    );
  });

  test('a product that overflows a double', () => {
    const result = ce.box(['Multiply', 1e308, 'L']).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)).toEqual(
      FLOATS.map((x) => scalar(['Multiply', 1e308, x]))
    );
  });

  // A double as large as `9e307` has an integer value, and `ce.number()` of
  // it is an exact integer of 308 digits. The interpreter holds the float.
  test('a huge float product stays a float on the tensor route', () => {
    const result = ce
      .box(['Multiply', 1e308, ['List', ...FLOATS.map((x) => x / 200)]])
      .evaluate();
    const reference = ce.box(['Multiply', 1e308, FLOATS[0] / 200]).evaluate();
    const first = [...result.each()][0];
    expect(first.json).toEqual(reference.json);
    expect(first.type.toString()).toBe(reference.type.toString());
    expect(first.type.toString().startsWith('integer')).toBe(false);
  });

  test('an integer result past the safe range', () => {
    const result = ce.box(['Multiply', 9007199254740993, 'K']).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)).toEqual(
      INTEGERS.map((k) => scalar(['Multiply', 9007199254740993, k]))
    );
  });

  // Three or more operands are folded left to right on doubles. The
  // interpreter adds the exact operands apart from the floats, so the last
  // digit of a cell can differ from the element-by-element value; that
  // change is accepted for the performance. An all-integer cell is exact on
  // both routes.
  test('three or more operands: the integers first, then the floats', () => {
    const sum = ce.box(['Add', 'L', 'M', 0.1]).evaluate();
    expect(isUnboxedList(sum)).toBe(true);
    expect(elements(sum)).toEqual(FLOATS.map((x, i) => x + FLOATS2[i] + 0.1));
    const product = ce.box(['Multiply', 2, 'L', 'M', 'L']).N();
    expect(isUnboxedList(product)).toBe(true);
    expect(elements(product)).toEqual(
      FLOATS.map((x, i) => 2 * x * FLOATS2[i] * x)
    );
    // The integers are combined first, exactly: a cancellation among them
    // does not lose the float. `1e15 + 1e-5 − 1e15` is `1e-5`, as the scalar
    // route answers, and not `0`.
    ce.declare('Big', { value: ce.box(['List', ...FLOATS.map(() => 1e15)]) });
    ce.declare('Tiny', { value: ce.box(['List', ...FLOATS.map(() => 1e-5)]) });
    ce.declare('NegBig', {
      value: ce.box(['List', ...FLOATS.map(() => -1e15)]),
    });
    const cancelled = ce.box(['Add', 'Big', 'Tiny', 'NegBig']).evaluate();
    expect(isUnboxedList(cancelled)).toBe(true);
    expect(elements(cancelled)).toEqual(FLOATS.map(() => 1e-5));
    expect(ce.box(['Add', 1e15, 1e-5, -1e15]).evaluate().re).toBe(1e-5);
    const integers = ce.box(['Add', 'K', 'K', 5]).evaluate();
    expect(isUnboxedList(integers)).toBe(true);
    expect(elements(integers)).toEqual(INTEGERS.map((k) => 2 * k + 5));
    expect([...integers.each()].every((el) => el.isInteger === true)).toBe(
      true
    );
  });

  // Above machine precision a broadcast of integers over a symbol keeps the
  // lazy `Map` whose source is the symbol: the exact compiled tier reads that
  // form (`map-exact-compile.test.ts`).
  test('integers above machine precision keep the lazy form', () => {
    const big = new ComputeEngine();
    big.declare('K', { value: big.box(['List', ...INTEGERS]) });
    const result = big.box(['Add', 'K', 1]).evaluate();
    expect(result.operator).toBe('Map');
    expect(elements(result)).toEqual(INTEGERS.map((k) => k + 1));
  });

  test('floats above machine precision', () => {
    const big = new ComputeEngine();
    big.declare('L', { value: big.box(['List', ...FLOATS]) });
    const result = big.box(['Multiply', 0.1, 'L']).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    expect(elements(result)).toEqual(
      FLOATS.map((x) => big.box(['Multiply', 0.1, x]).evaluate().json)
    );
  });

  test('a float made above machine precision keeps its decimal digits', () => {
    // `0.1` made at 30 digits is a decimal value. At machine precision the
    // interpreter still multiplies its digits: `0.1 · 3` is `0.3`, where the
    // doubles give `0.30000000000000004`.
    const local = new ComputeEngine();
    local.precision = 30;
    const tenth = local.number(0.1);
    local.declare('K', { value: local.box(['List', ...INTEGERS]) });
    local.precision = 'machine';
    const result = local.function('Multiply', [tenth, local.symbol('K')]);
    const value = result.evaluate();
    expect(isUnboxedList(value)).toBe(false);
    expect(elements(value)).toEqual(
      INTEGERS.map(
        (k) =>
          local.function('Multiply', [tenth, local.number(k)]).evaluate().json
      )
    );
  });

  test('at or below the eager threshold nothing changes', () => {
    ce.declare('S', { value: ce.box(['List', ...FLOATS.slice(0, 40)]) });
    const result = ce.box(['Add', 'S', 1]).evaluate();
    expect(result.operator).toBe('List');
    expect(elements(result)).toEqual(
      FLOATS.slice(0, 40).map((x) => scalar(['Add', x, 1]))
    );
  });
});

describe('functions of one machine number on doubles', () => {
  // Each kernel is the primitive the scalar route computes; the test is the
  // scalar route itself, element by element, under both routes.
  const ce = machineEngine();
  const POSITIVE = FLOATS.map((x) => Math.abs(x) + 0.001);
  const SMALL = FLOATS.map((x) => x / 25);
  const UNIT = FLOATS.map((x) => x / 200);
  ce.declare('P', { value: ce.box(['List', ...POSITIVE]) });
  ce.declare('S', { value: ce.box(['List', ...SMALL]) });
  ce.declare('U', { value: ce.box(['List', ...UNIT]) });

  const sameAsScalar = (
    json: unknown[],
    source: number[],
    route: 'evaluate' | 'N',
    scalarOf: (x: number) => unknown[]
  ) => {
    const expr = ce.box(json as never);
    const result = route === 'N' ? expr.N() : expr.evaluate();
    expect(isUnboxedList(result)).toBe(true);
    const expected = source.map((x) => {
      const e = ce.box(scalarOf(x) as never);
      return (route === 'N' ? e.N() : e.evaluate()).json;
    });
    expect(elements(result)).toEqual(expected);
  };

  test.each([
    ['Sin', 'L', FLOATS],
    ['Cos', 'L', FLOATS],
    ['Tan', 'L', FLOATS],
    ['Cot', 'L', FLOATS],
    ['Sec', 'L', FLOATS],
    ['Csc', 'L', FLOATS],
    ['Sinh', 'S', SMALL],
    ['Cosh', 'S', SMALL],
    ['Tanh', 'L', FLOATS],
    ['Ln', 'P', POSITIVE],
    ['Sqrt', 'P', POSITIVE],
    ['Abs', 'L', FLOATS],
    ['Floor', 'L', FLOATS],
    ['Ceil', 'L', FLOATS],
    ['Round', 'L', FLOATS],
  ] as const)('%s under both routes', (head, symbol, source) => {
    for (const route of ['evaluate', 'N'] as const)
      sameAsScalar([head, symbol], source, route, (x) => [head, x]);
  });

  // `Math.log10` and `Math.log2` are the primitives of the `N()` route and of
  // the compiled code. `evaluate()` of a scalar computes the logarithm another
  // way, one unit in the last place apart on about half of the arguments; the
  // list answers the primitive on both routes.
  test('Log and Lb compute the base-10 and base-2 primitives', () => {
    for (const route of ['evaluate', 'N'] as const) {
      // `Lb(x)` is canonically `Log(x, 2)`.
      const log = ce.box(['Log', 'P']);
      const lb = ce.box(['Lb', 'P']);
      const logResult = route === 'N' ? log.N() : log.evaluate();
      const lbResult = route === 'N' ? lb.N() : lb.evaluate();
      expect(isUnboxedList(logResult)).toBe(true);
      expect(isUnboxedList(lbResult)).toBe(true);
      expect(elements(logResult)).toEqual(POSITIVE.map(Math.log10));
      expect(elements(lbResult)).toEqual(POSITIVE.map(Math.log2));
    }
    sameAsScalar(['Log', 'P'], POSITIVE, 'N', (x) => ['Log', x]);
    sameAsScalar(['Log', 'P', 10], POSITIVE, 'N', (x) => ['Log', x, 10]);
    // Another base is a quotient of two logarithms; a negative argument has a
    // complex logarithm.
    expect(isUnboxedList(ce.box(['Log', 'P', 3]).evaluate())).toBe(false);
    expect(isUnboxedList(ce.box(['Log', 'L']).evaluate())).toBe(false);
  });

  test.each([
    ['Arctan', 'L', FLOATS],
    ['Arcsin', 'U', UNIT],
    ['Arccos', 'U', UNIT],
    ['Exp', 'S', SMALL],
  ] as const)(
    '%s under N() only: evaluate() recognizes special arguments',
    (head, symbol, source) => {
      sameAsScalar([head, symbol], source, 'N', (x) => [head, x]);
      expect(ce.box([head, symbol]).evaluate().operator).toBe('Map');
    }
  );

  test.each([2, 3, 7, -2, -5, 1.5])('a power with the exponent %s', (k) => {
    const source = k === 1.5 ? POSITIVE : FLOATS;
    const symbol = k === 1.5 ? 'P' : 'L';
    for (const route of ['evaluate', 'N'] as const)
      sameAsScalar(['Power', symbol, k], source, route, (x) => ['Power', x, k]);
  });

  // `Math.round` rounds a tie toward `+∞`: `Round(-0.5)` is `0` at machine
  // precision (above it, the big-number lane rounds a tie away from zero).
  // The kernel must answer what the scalar route answers at this precision.
  test('Round at the ties', () => {
    const ties = [-2.5, -1.5, -0.5, 0.5, 1.5, 2.5];
    ce.declare('Ties', { value: ce.box(['List', ...FLOATS, ...ties]) });
    for (const route of ['evaluate', 'N'] as const)
      sameAsScalar(['Round', 'Ties'], [...FLOATS, ...ties], route, (x) => [
        'Round',
        x,
      ]);
  });

  test('integers stay exact under evaluate(), and float under N()', () => {
    expect(ce.box(['Sin', 'K']).evaluate().operator).toBe('Map');
    expect(ce.box(['Sqrt', 'K']).evaluate().operator).toBe('Map');
    sameAsScalar(['Sin', 'K'], INTEGERS, 'N', (x) => ['Sin', x]);
    sameAsScalar(['Abs', 'K'], INTEGERS, 'evaluate', (x) => ['Abs', x]);
    sameAsScalar(['Power', 'K', 2], INTEGERS, 'evaluate', (x) => [
      'Power',
      x,
      2,
    ]);
    expect(
      [...ce.box(['Power', 'K', 2]).evaluate().each()].every(
        (el) => el.isInteger === true
      )
    ).toBe(true);
    // A negative exponent on an integer is an exact rational.
    expect(ce.box(['Power', 'K', -2]).evaluate().operator).toBe('Map');
  });

  // `evaluate()` of a trigonometric function answers an exact value for a
  // float within `1e-12` of a special angle, and `0` for a tiny argument.
  test('a special angle in the list keeps the lazy form under evaluate()', () => {
    for (const angle of [Math.PI, Math.PI / 3 + 1e-13, 1e-300]) {
      ce.declare('A', { value: ce.box(['List', ...FLOATS, angle]) });
      const lazy = ce.box(['Sin', 'A']).evaluate();
      expect(lazy.operator).toBe('Map');
      const last = [...lazy.each()].pop()!;
      expect(last.json).toEqual(ce.box(['Sin', angle]).evaluate().json);
      expect(isUnboxedList(ce.box(['Sin', 'A']).N())).toBe(true);
      ce.forget('A');
    }
  });

  test('declined arguments: out of the domain, at a pole, in degrees', () => {
    // A negative argument of `Sqrt` and `Ln` has a complex value.
    expect(ce.box(['Sqrt', 'L']).evaluate().operator).toBe('Map');
    expect(ce.box(['Ln', 'L']).N().operator).toBe('Map');
    expect(ce.box(['Arcsin', 'L']).N().operator).toBe('Map');
    // A value past a million in magnitude is the pole `~oo`.
    ce.declare('Pole', {
      value: ce.box(['List', ...FLOATS, Math.PI / 2 + 1e-9]),
    });
    expect(ce.box(['Tan', 'Pole']).N().operator).toBe('Map');
    // A zero base with a negative exponent.
    ce.declare('Zero', { value: ce.box(['List', ...FLOATS, 0]) });
    expect(ce.box(['Power', 'Zero', -2]).evaluate().operator).toBe('Map');
    // Another angular unit converts the argument first.
    const degrees = machineEngine();
    degrees.angularUnit = 'deg';
    expect(degrees.box(['Sin', 'L']).N().operator).toBe('Map');
    expect(isUnboxedList(degrees.box(['Sqrt', 'L']).N())).toBe(false);
    // A head with no kernel.
    expect(ce.box(['Gamma', 'P']).N().operator).toBe('Map');
  });

  test('a reduction over a function of a list', () => {
    let total = 0;
    for (const x of FLOATS) total += Math.sin(x);
    expect(ce.box(['Sum', ['Sin', 'L']]).evaluate().re).toBe(total);
    expect(ce.box(['Sum', ['Sin', 'L']]).N().re).toBe(total);
    let integers = 0;
    for (const k of INTEGERS) integers += Math.sin(k);
    // `Sum` evaluates its body on the route of the sum: under `N()` the
    // integers are numericized and the kernel sums the doubles.
    expect(ce.box(['Sum', ['Sin', 'K']]).N().re).toBe(integers);
    // A kernel that works under `N()` only is reached by `Sum(…).N()`.
    let exps = 0;
    for (const x of FLOATS) exps += Math.exp(x * 0.01);
    expect(ce.box(['Sum', ['Exp', ['Divide', 'L', 100]]]).N().re).toBe(exps);
    // The numeric route is used only when it gives a finite list of machine
    // numbers. `1e308 · K` overflows the doubles to infinities, and the exact
    // route answers the exact big integer; `1/X` with a zero in `X` has the
    // pole `~oo` in the exact route.
    const huge = ce.box(['Sum', ['Multiply', 1e308, 'K']]).N();
    expect(huge.isNaN).toBe(false);
    expect(huge.isInteger).toBe(true);
    ce.declare('X0', { value: ce.box(['List', ...FLOATS, 0]) });
    expect(ce.box(['Sum', ['Divide', 1, 'X0']]).N().json).toEqual(
      ce
        .box(['Sum', ['Divide', 1, 'X0']])
        .evaluate()
        .N().json
    );
    // Under `evaluate()` the sines of integers stay exact, and so does the sum.
    expect(
      JSON.stringify(ce.box(['Sum', ['Sin', 'K']]).evaluate().json)
    ).toContain('"Sin"');
    expect(ce.box(['Max', ['Sqrt', 'P']]).evaluate().re).toBe(
      Math.max(...POSITIVE.map(Math.sqrt))
    );
  });
});

describe('reductions of a list of machine numbers fold its doubles', () => {
  const ce = machineEngine();

  test('Sum adds in order', () => {
    let total = 0;
    for (const x of FLOATS) total += x;
    expect(ce.box(['Sum', 'L']).evaluate().re).toBe(total);
    expect(ce.box(['Sum', 'L']).N().re).toBe(total);
    let scaled = 0;
    for (const x of FLOATS) scaled += 2 * x;
    expect(ce.box(['Sum', ['Multiply', 2, 'L']]).evaluate().re).toBe(scaled);
  });

  test('Sum of integers is an exact integer', () => {
    const total = INTEGERS.reduce((a, b) => a + b, 0);
    const result = ce.box(['Sum', 'K']).evaluate();
    expect(result.re).toBe(total);
    expect(result.isInteger).toBe(true);
  });

  test('Sum of integers past the safe range is exact', () => {
    ce.declare('Big', {
      value: ce.box(['List', ...INTEGERS.map(() => 9007199254740991)]),
    });
    expect(ce.box(['Sum', 'Big']).evaluate().json).toEqual({
      num: (9007199254740991n * BigInt(N)).toString(),
    });
  });

  // A partial sum of floats that has an integer value is an exact integer in
  // the element-by-element fold (`0.5 + 0.5` is `1`), which then adds
  // integers exactly. A sum of doubles would lose the `1` against `2^53`.
  test('Sum keeps an integer partial sum exact past the safe range', () => {
    const big = 9007199254740992;
    expect(
      ce.box(['Sum', ['List', 0.5, 0.5, big, -big]]).evaluate().json
    ).toEqual(1);
    expect(
      ce.box(['Sum', ['List', 0.5, 0.5, big, -big, 0.25]]).evaluate().json
    ).toEqual(1.25);
  });

  test('a symbol that does not hold a list of machine numbers', () => {
    const local = machineEngine();
    local.declare('R', { value: local.box(['Range', 1, 300]) });
    expect(local.box(['Sum', 'R']).evaluate().re).toBe(45150);
    const lazy = local.box(['Add', 'R', 1]).evaluate();
    expect(lazy.operator).toBe('Map');
    expect(local.box(['Sum', ['Add', 'R', 1]]).evaluate().re).toBe(45450);
    // A symbol that holds a symbol that holds the list.
    local.declare('L2', { value: local.symbol('L') });
    expect(isUnboxedList(local.box(['Multiply', 2, 'L2']).evaluate())).toBe(
      true
    );
  });

  test('Max and Min are the extrema', () => {
    expect(ce.box(['Max', 'L']).evaluate().re).toBe(Math.max(...FLOATS));
    expect(ce.box(['Min', 'L']).evaluate().re).toBe(Math.min(...FLOATS));
    expect(ce.box(['Min', 1, ['Multiply', 2, 'L']]).evaluate().re).toBe(
      Math.min(1, ...FLOATS.map((x) => 2 * x))
    );
  });

  // The comparison of two numbers is tolerance-aware: a value replaces the
  // extremum so far only when it differs from it by more than the tolerance
  // of the engine, except against `0`, whose comparison reads the sign. The
  // scalar operands below take the element-by-element fold; the list takes
  // the scan of doubles. The two must agree.
  test.each([
    ['close values keep the first', [5, 5 + 1e-12, 5 + 2e-12]],
    ['against zero the sign decides', [0, 1e-12, -1e-12]],
    ['a value past the tolerance wins', [5, 5 + 1e-12, 5 + 1e-6]],
    ['infinities', [1, Infinity, -Infinity, 2]],
  ])('%s', (_label, values) => {
    const json = values.map((v) =>
      v === Infinity
        ? 'PositiveInfinity'
        : v === -Infinity
          ? 'NegativeInfinity'
          : v
    );
    for (const head of ['Max', 'Min']) {
      const folded = ce.box([head, ...json] as never).evaluate().json;
      const scanned = ce.box([head, ['List', ...json]] as never).evaluate();
      expect(scanned.json).toEqual(folded);
    }
  });

  // A difference EQUAL to the tolerance is a tie between two integers, and
  // is not a tie when one value is a float.
  test('a difference equal to the tolerance', () => {
    const local = new ComputeEngine();
    local.precision = 'machine';
    local.tolerance = 0.5;
    for (const values of [
      [0.5, 1],
      [1, 0.5],
      [0.25, 0.75, 1.25],
    ])
      for (const head of ['Max', 'Min']) {
        const folded = local.box([head, ...values] as never).evaluate().json;
        const scanned = local.box([head, ['List', ...values]] as never);
        expect(scanned.evaluate().json).toEqual(folded);
      }
    local.tolerance = 1;
    for (const head of ['Max', 'Min']) {
      const folded = local.box([head, 1, 2, 4] as never).evaluate().json;
      const scanned = local.box([head, ['List', 1, 2, 4]] as never);
      expect(scanned.evaluate().json).toEqual(folded);
    }
  });

  test('a NaN element absorbs', () => {
    expect(ce.box(['Max', ['List', 1, 'NaN', 3]]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Min', 0, ['List', 1, 'NaN', 3]]).evaluate().isNaN).toBe(
      true
    );
  });
});

describe('a coordinate of a large written-out list of points', () => {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  const points = FLOATS.map((x, i) => ['Tuple', x, INTEGERS[i], FLOATS2[i]]);
  ce.declare('C', { value: ce.box(['List', ...points]) });

  test('is a list of unboxed doubles, with the same coordinates', () => {
    const z = ce.box(['PointZ', 'C']).evaluate();
    expect(isUnboxedList(z)).toBe(true);
    expect(elements(z)).toEqual(FLOATS2);
    expect(elements(ce.box(['PointY', 'C']).evaluate())).toEqual(INTEGERS);
  });

  test('a coordinate that is not a machine number keeps the ordinary list', () => {
    ce.declare('D', {
      value: ce.box([
        'List',
        ...points.map((p, i) => (i === 3 ? ['Tuple', 1, 2, 'x'] : p)),
      ]),
    });
    const z = ce.box(['PointZ', 'D']).evaluate();
    expect(isUnboxedList(z)).toBe(false);
    expect(elements(z)[3]).toBe('x');
  });

  // `PointX(C)` is not a collection before it is evaluated, so `Sum` takes
  // its form with a body and no indexing set, which evaluates the body and
  // folds the value. A value that is a list of machine numbers is summed on
  // its doubles there too.
  test('Sum of a coordinate', () => {
    let total = 0;
    for (const x of FLOATS) total += x;
    expect(ce.box(['Sum', ['PointX', 'C']]).evaluate().re).toBe(total);
    expect(ce.box(['Sum', ['PointX', 'C']]).N().re).toBe(total);
    let integers = 0;
    for (const k of INTEGERS) integers += k;
    const sumY = ce.box(['Sum', ['PointY', 'C']]).evaluate();
    expect(sumY.re).toBe(integers);
    expect(sumY.isInteger).toBe(true);
  });

  test('the reduction of coordinate arithmetic', () => {
    const expected = Math.min(1, ...FLOATS2.map((z) => 2 - 2 * z));
    expect(
      ce
        .box(['Min', 1, ['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]]])
        .evaluate().re
    ).toBe(expected);
  });
});

describe('the doubles of a list (`array`)', () => {
  // A machine float holds its value as a double, which is read directly. A
  // big-number float is admitted only when a double holds the same value,
  // which is decided by boxing the double and comparing.
  test('machine floats, also those that arithmetic produced', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(ce.box(['List', 0.1, 2.5, -3]).array).toEqual([0.1, 2.5, -3]);
    const computed = ce.box(['List', ['Add', 0.1, 0.2], 1]).evaluate();
    expect(computed.array).toEqual([0.1 + 0.2, 1]);
    expect(computed.isMachineNumeric).toBe(true);
  });

  test('a big-number float with more digits than a double is not admitted', () => {
    const ce = new ComputeEngine();
    ce.precision = 30;
    const third = ce.box(['Divide', 1, 3]).N();
    const list = ce.function('List', [third, ce.number(1)]);
    expect(list.array).toBeUndefined();
    expect(list.isMachineNumeric).toBe(false);
  });
});

describe('the asynchronous Sum answers as the synchronous one', () => {
  test('a body that the numeric route computes on doubles', async () => {
    const ce = machineEngine();
    const sync = ce.box(['Sum', ['Exp', ['Divide', 'L', 100]]]).N();
    const async = await ce
      .box(['Sum', ['Exp', ['Divide', 'L', 100]]])
      .evaluateAsync({ numericApproximation: true });
    expect(async.json).toEqual(sync.json);
  });
});
