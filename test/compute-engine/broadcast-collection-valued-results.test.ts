import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';
import { Complex } from 'complex.js';
import { typeHandlerContext } from '../../src/compute-engine/boxed-expression/derive-application-type';
import {
  describeBoundSymbol,
  describeType,
} from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { infinitePoint } from '../../src/compute-engine/boxed-expression/infinite-point';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

// A broadcastable operator whose result for ONE element is a collection (or
// a tuple) maps over a list to a list of such collections. The broadcast
// type lift used to unwrap the per-element result one rank, as if the
// collection were the handler's echo of the operand: `ComplexRoots([1, 8],
// 3)` was typed `vector<2>` while its value is a 2×3 matrix.

const ce = new ComputeEngine();

function typeOf(json: unknown): string {
  return ce.box(json as any).type.toString();
}

/** The value of the application matches its static type. */
function expectValueMatchesType(json: unknown): void {
  const e = ce.box(json as any);
  const v = e.evaluate();
  expect(v.type.matches(e.type)).toBe(true);
}

describe('the broadcast lift keeps a collection-valued per-element result', () => {
  test.each<[unknown, string]>([
    [['ComplexRoots', ['List', 1, 8], 3], 'list<list<number>^2>'],
    [['ComplexRoots', ['Tuple', 1, 8], 3], 'tuple<list<number>, list<number>>'],
    [
      ['NumeratorDenominator', ['Tuple', 0.5, 0.25]],
      'tuple<nothing | tuple<number, number>, nothing | tuple<number, number>>',
    ],
    [
      ['NumeratorDenominator', ['List', ['Tuple', 0.5, 0.25]]],
      'list<tuple<nothing | tuple<number, number>, nothing | tuple<number, number>>^1>',
    ],
  ])('%j is typed %s', (json, type) => {
    expect(typeOf(json)).toBe(type);
    expectValueMatchesType(json);
  });

  // The broadcast over a nested list descends to its leaves, so each leaf
  // gives one list of roots. (The value is typed `list<complex^(1x2x3)>`,
  // and the subtype check does not read that type as a
  // `list<list<number>^(1x2)>`: it peels one outer dimension only.)
  test('a nested list operand', () => {
    expect(typeOf(['ComplexRoots', ['List', ['List', 1, 8]], 3])).toBe(
      'list<list<number>^(1x2)>'
    );
  });

  // A handler that answers the operand's own collection type (`Negate`) or
  // a scalar (`Sin`) is not affected: its answer is unwrapped as before.
  test.each<[unknown, string]>([
    [['Sin', ['List', 1, 2]], 'vector<2>'],
    [['Negate', ['List', 1, 2]], 'vector<integer^2>'],
    [['Sin', ['Tuple', 1, 2]], 'tuple<number, number>'],
  ])('%j is still typed %s', (json, type) => {
    expect(typeOf(json)).toBe(type);
  });

  test('a declared collection operand', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    ce.declare('u', 'integer | list<integer>');
    ce.declare('C', 'collection<integer>');
    expect(ce.box(['Divisors', 'L']).type.toString()).toBe(
      'list<list<integer>>'
    );
    expect(ce.box(['Divisors', 'u']).type.toString()).toBe(
      'list<integer> | list<list<integer>>'
    );
    expect(ce.box(['Divisors', 'C']).type.toString()).toBe(
      'broadcastable<list<integer>>'
    );
  });

  // The descriptor route (`context.derive`, what a type handler calls to
  // type a body over its operands) applies the same lift.
  test.each<[string, string[]]>([
    ['FactorInteger', ['list<integer^2>']],
    ['ComplexRoots', ['list<integer^2>', 'integer']],
    ['DigitCount', ['list<integer^2>']],
    ['ExtendedGCD', ['list<integer^2>', 'integer']],
  ])(
    'the descriptor route types %s over %j as the expression route',
    (op, types) => {
      const ce = new ComputeEngine();
      const ctx = typeHandlerContext(ce as any);
      const T = (s: string) => parseType(s)!;
      const descriptors = types.map((t, i) =>
        t === 'integer' && i > 0
          ? describeType(T(t))
          : describeBoundSymbol(T(t), `__${op}${i}`)
      );
      const derived = ctx.derive(op, descriptors);
      const operands = types.map((t, i) => {
        if (t === 'integer' && i > 0) return 3;
        const name = `s_${op}_${i}`;
        ce.declare(name, t);
        return name;
      });
      expect(derived === undefined ? 'undefined' : typeToString(derived)).toBe(
        ce.box([op, ...operands] as any).type.toString()
      );
    }
  );
});

describe('the integer functions with a collection result map over a list', () => {
  function listOf(xs: unknown[]): unknown {
    return ['List', ...xs];
  }

  /** `op` over lists evaluates to the list of `op` of each element. */
  function expectElementWise(op: string, columns: unknown[][]): Expression {
    const n = columns[0].length;
    const listed = ce.box([op, ...columns.map(listOf)] as any);
    expect(listed.isValid).toBe(true);
    expect(listed.count).toBe(n);
    const value = listed.evaluate();
    const expected: string[] = [];
    for (let i = 0; i < n; i++)
      expected.push(
        ce
          .box([op, ...columns.map((c) => c[i])] as any)
          .evaluate()
          .toString()
      );
    expect(value.operator).toBe('List');
    expect(value.ops!.map((x) => x.toString())).toEqual(expected);
    return listed;
  }

  test.each<[string, unknown[][], string]>([
    ['FactorInteger', [[12, 18]], 'list<list<tuple<integer, integer>>^2>'],
    ['Divisors', [[6, 8]], 'list<list<integer>^2>'],
    ['PrimeFactors', [[12, 7]], 'list<list<integer>^2>'],
    [
      'ExtendedGCD',
      [
        [12, 7],
        [18, 4],
      ],
      'list<tuple<integer, integer, integer>^2>',
    ],
    ['ContinuedFraction', [[['Rational', 3, 7], 2.5]], 'list<list<integer>^2>'],
    [
      'IntegerDigits',
      [
        [255, 16],
        [16, 2],
      ],
      'list<list<integer>^2>',
    ],
    ['DigitCount', [[122, 10]], 'list<list<integer>^2>'],
    ['PrimitiveRootList', [[7, 8]], 'list<list<integer>^2>'],
  ])('%s', (op, columns, type) => {
    const listed = expectElementWise(op, columns);
    expect(listed.type.toString()).toBe(type);
  });

  // A list of lists of different lengths is typed without its length
  // (`list<vector<integer^1> | vector<integer^2>>`), so only the lists with
  // rows of one length are checked against the static type.
  test.each<unknown>([
    ['FactorInteger', ['List', 12, 18]],
    ['Divisors', ['List', 6, 8]],
    ['ExtendedGCD', ['List', 12, 7], 18],
    ['IntegerDigits', ['List', 255, 16], 16],
    ['DigitCount', ['List', 122, 10]],
    ['DigitCount', ['List', 122, 10], 10, 2],
  ])('the value of %j matches its type', (json) => {
    expectValueMatchesType(json);
  });

  test('a scalar argument still gives one collection', () => {
    expect(typeOf(['Divisors', 12])).toBe('list<integer>');
    expect(ce.box(['Divisors', 12]).evaluate().toString()).toBe(
      '[1,2,3,4,6,12]'
    );
    // With a digit, `DigitCount` is one count per element.
    expect(typeOf(['DigitCount', ['List', 122, 10], 10, 2])).toBe(
      'vector<integer^2>'
    );
  });
});

describe('Degrees and DMS map over a list', () => {
  test('Degrees', () => {
    const e = ce.box(['Degrees', ['List', 30, 90]]);
    expect(e.isValid).toBe(true);
    expect(e.count).toBe(2);
    expect(e.type.toString()).toBe('vector<2>');
    expect(e.evaluate().toString()).toBe('[1/6 * pi,1/2 * pi]');
    expectValueMatchesType(['Degrees', ['List', 30, 90]]);
  });

  test('Degrees of a tuple', () => {
    expect(
      ce
        .box(['Degrees', ['Tuple', 30, 90]])
        .evaluate()
        .toString()
    ).toBe('(1/6 * pi, 1/2 * pi)');
  });

  test('DMS over its degrees or its minutes', () => {
    expect(
      ce
        .box(['DMS', ['List', 30, 45], 15])
        .evaluate()
        .toString()
    ).toBe(
      ce
        .box(['List', ['DMS', 30, 15], ['DMS', 45, 15]])
        .evaluate()
        .toString()
    );
    expect(
      ce
        .box(['DMS', 30, ['List', 15, 30]])
        .evaluate()
        .toString()
    ).toBe(
      ce
        .box(['List', ['DMS', 30, 15], ['DMS', 30, 30]])
        .evaluate()
        .toString()
    );
    expect(ce.box(['DMS', ['List', 30, 45], 15]).count).toBe(2);
  });

  test('parse route', () => {
    const e = ce.parse('[30, 60]^\\circ');
    expect(e.json).toEqual(['Degrees', ['List', 30, 60]]);
    expect(e.evaluate().toString()).toBe('[1/6 * pi,1/3 * pi]');
    expect(ce.parse('\\sin([30, 60]^\\circ)').evaluate().toString()).toBe(
      '[1/2,sqrt(3)/2]'
    );
  });
});

describe('the Gamma family is typed with its pole value', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('k', 'integer');
  ce.declare('p', 'real<0..>');
  ce.declare('q', 'integer<1..>');
  ce.declare('r', 'real<-0.9..-0.1>');

  // `~oo` is stored widened to `infinity`, `+oo` to `signed_infinity`.
  test.each<[string, string, string]>([
    ['Gamma', 'x', 'infinity | real'],
    ['Gamma', 'k', 'infinity | real'],
    ['Gamma', 'p', 'infinity | real'], // Gamma(0) is a pole
    ['Gamma', 'q', 'real'],
    ['Gamma', 'r', 'real'], // no integer in the range
    ['Digamma', 'x', 'infinity | real'],
    ['Digamma', 'q', 'real'],
    ['Trigamma', 'x', 'infinity | real'],
    ['GammaLn', 'x', 'real | signed_infinity'],
    ['GammaLn', 'q', 'real'],
    ['Factorial', 'x', 'infinity | real'],
    ['Factorial', 'k', 'infinity | integer'],
    ['Factorial', 'p', 'real'], // no negative integer
    ['Factorial', 'q', 'integer'],
    ['Factorial2', 'x', 'infinity | real'],
    ['Factorial2', 'k', 'infinity | rational'],
    ['Factorial2', 'q', 'integer'],
  ])('%s(%s) is typed %s', (op, arg, type) => {
    expect(ce.box([op, arg]).type.toString()).toBe(type);
  });

  test('PolyGamma', () => {
    expect(ce.box(['PolyGamma', 1, 'x']).type.toString()).toBe(
      'infinity | real'
    );
    expect(ce.box(['PolyGamma', 1, 'q']).type.toString()).toBe('real');
    // Order -1 is `LogGamma`, which is complex at a negative argument.
    expect(ce.box(['PolyGamma', -1, 'x']).type.toString()).toBe('number');
    expect(ce.box(['PolyGamma', -1, 'q']).type.toString()).toBe('real');
  });

  // The value at a sample point matches the type claimed for a symbol of
  // the same declared type.
  test.each<[string, number[]]>([
    ['Gamma', [-1, 0, -2, -0.5, 2.5]],
    ['Digamma', [-1, 0, -0.5, 3]],
    ['Trigamma', [-1, 0, 0.5]],
    ['GammaLn', [-1, 0, -0.5, 4]],
    ['Factorial', [-1, -2, -0.5, 3]],
    ['Factorial2', [-1, -2, -3, -5, 4]],
  ])('%s at real points', (op, points) => {
    const claim = ce.box([op, 'x']).type;
    for (const v of points) {
      const value = ce.box([op, v]).evaluate();
      expect([v, value.type.matches(claim)]).toEqual([v, true]);
      const numeric = ce.box([op, v]).N();
      expect([v, numeric.type.matches(claim)]).toEqual([v, true]);
    }
  });

  test('PolyGamma(-1, x) at a negative point', () => {
    const claim = ce.box(['PolyGamma', -1, 'x']).type;
    expect(ce.box(['PolyGamma', -1, -0.5]).N().type.matches(claim)).toBe(true);
  });
});

describe('Boole maps over a list of booleans', () => {
  test('Boole([True, False]) is [1, 0]', () => {
    const e = ce.box(['Boole', ['List', 'True', 'False']]);
    expect(e.isValid).toBe(true);
    expect(e.count).toBe(2);
    expect(e.type.toString()).toBe('vector<integer^2>');
    expect(e.evaluate().toString()).toBe('[1,0]');
  });

  test('a list of comparisons, on the parse route', () => {
    const e = ce.parse('\\operatorname{Boole}([1<2, 3<2])');
    expect(e.json).toEqual(['Boole', ['List', ['Less', 1, 2], ['Less', 3, 2]]]);
    expect(e.evaluate().toString()).toBe('[1,0]');
  });

  test('an element-wise comparison', () => {
    expect(
      ce
        .box(['Boole', ['Less', ['List', 1, 3], 2]])
        .evaluate()
        .toString()
    ).toBe('[1,0]');
  });

  test('a scalar is unchanged', () => {
    expect(ce.box(['Boole', 'True']).evaluate().toString()).toBe('1');
    expect(ce.box(['Boole', 'False']).evaluate().toString()).toBe('0');
  });

  test('a non-boolean element is an error in its cell', () => {
    const v = ce.box(['Boole', ['List', 'True', 1]]).evaluate();
    expect(v.ops![0].toString()).toBe('1');
    expect(v.ops![1].operator).toBe('Error');
  });
});

describe('every infinite number literal is one of the three infinities', () => {
  // The value-level `infinitePoint` has no answer for an infinity with an
  // "anonymous" direction: no boxed number is one.
  test.each<[string, () => Expression, string | undefined]>([
    ['{re: ∞, im: 1}', () => ce.number({ re: Infinity, im: 1 } as any), '+oo'],
    [
      '{re: -∞, im: 1}',
      () => ce.number({ re: -Infinity, im: 1 } as any),
      '-oo',
    ],
    ['{re: 1, im: ∞}', () => ce.number({ re: 1, im: Infinity } as any), '~oo'],
    [
      '{re: ∞, im: NaN}',
      () => ce.number({ re: Infinity, im: NaN } as any),
      undefined,
    ],
    ['Complex(∞, 1)', () => ce.number(new Complex(Infinity, 1)), '+oo'],
    ['Complex(1, ∞)', () => ce.number(new Complex(1, Infinity)), '~oo'],
    ['∞ + i', () => ce.parse('\\infty + i').evaluate(), '+oo'],
    ['i∞', () => ce.parse('i\\infty').evaluate(), '~oo'],
    ['10^{400}', () => ce.parse('10^{400}').evaluate(), undefined],
    ['10^{400} + i', () => ce.parse('10^{400} + i').evaluate(), undefined],
  ])('%s', (_label, make, point) => {
    expect(infinitePoint(make())).toBe(point);
  });
});
