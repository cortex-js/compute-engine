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

  // The interpreter does not add three numbers from left to right (it adds
  // the exact operands apart from the floats), so the rounding of a sum of
  // three depends on an order this route does not reproduce. The reference is
  // the element function of the lazy form, applied to each pair.
  test('three operands: the rounding depends on the order of the sum', () => {
    const result = ce.box(['Add', 'L', 'M', 0.1]).evaluate();
    expect(isUnboxedList(result)).toBe(false);
    const f = ['Function', ['Add', 'a', 'b', 0.1], 'a', 'b'];
    expect(elements(result)).toEqual(
      FLOATS.map((x, i) => scalar(['Apply', f, x, FLOATS2[i]]))
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

  test('the reduction of coordinate arithmetic', () => {
    const expected = Math.min(1, ...FLOATS2.map((z) => 2 - 2 * z));
    expect(
      ce
        .box(['Min', 1, ['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]]])
        .evaluate().re
    ).toBe(expected);
  });
});
