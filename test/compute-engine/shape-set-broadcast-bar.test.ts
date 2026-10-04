/**
 * Three related corrections.
 *
 * 1. `Shape` and `Rank` of a lazy collection. The `shape` of an expression is
 *    read from its type, and the type of a lazy collection (`Range(1, 3)` is
 *    `range`) has no dimensions, so `Shape(Range(1, 3))` was `()` and
 *    `Rank(Range(1, 3))` was 0, the rank of a scalar. A finite indexed lazy
 *    collection now has the shape of the eager list with the same elements.
 *    A collection that is infinite, has an unknown count, or is not indexed
 *    (a set has no positions) stays unevaluated.
 *
 * 2. A set in an element-wise broadcast. `Power([1, 2, 3], Set(1, 2))` paired
 *    the set with the list by position and gave `[1, 4]`. A set has no
 *    positions, so it now gives the `incompatible-type` error it gives beside
 *    a scalar (`Power(Set(1, 2), 2)`).
 *
 * 3. `\bar` over a number. `\bar{7}` was an `unexpected-command` error. It
 *    now parses as `Conjugate(7)`, as `\overline{7}` does. `\bar` over a
 *    symbol is still the mean (`\bar{x}` is `Mean(x)`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

type Json = Parameters<ComputeEngine['box']>[0];

const ce = new ComputeEngine();

function evalString(json: Json): string {
  return ce.box(json).evaluate().toString();
}

describe('Shape and Rank of a lazy collection or a set', () => {
  test.each<[Json, string]>([
    [['Shape', ['Range', 1, 3]], '(3)'],
    [['Rank', ['Range', 1, 3]], '1'],
    [['Shape', ['Linspace', 0, 1, 3]], '(3)'],
    [['Rank', ['Linspace', 0, 1, 3]], '1'],
    // The count is known but the elements cannot be computed: the element
    // type is a scalar number type, so the shape is the count.
    [['Shape', ['Linspace', 'a', 1, 3]], '(3)'],
    // Lazy collection whose elements are lists: the shape of the eager list
    // with the same elements, `[[1, 1], [2, 2], [3, 3]]`.
    [
      [
        'Shape',
        ['Map', ['Function', ['List', 'x', 'x'], 'x'], ['Range', 1, 3]],
      ],
      '(3, 2)',
    ],
    [['Shape', ['Reverse', ['Range', 1, 3]]], '(3)'],
  ])('%j evaluates to %s', (json, expected) => {
    expect(evalString(json)).toBe(expected);
  });

  test.each<[Json, string]>([
    // An unknown length: no shape.
    [['Shape', ['Range', 1, 'n']], 'Shape(Range(1, n))'],
    [['Rank', ['Range', 1, 'n']], 'Rank(Range(1, n))'],
    // An infinite collection: no shape.
    [['Shape', ['Range', 1, 'PositiveInfinity']], 'Shape(Range(1, +oo))'],
    [['Rank', ['Range', 1, 'PositiveInfinity']], 'Rank(Range(1, +oo))'],
    // A set has no positions: no shape.
    [['Shape', ['Set', 1, 2]], 'Shape(Set(1, 2))'],
    [['Rank', ['Set', 1, 2]], 'Rank(Set(1, 2))'],
  ])('%j stays unevaluated', (json, expected) => {
    expect(evalString(json)).toBe(expected);
  });

  test.each<[Json, string]>([
    [['Shape', ['List', 1, 2, 3]], '(3)'],
    [['Rank', ['List', 1, 2, 3]], '1'],
    [['Shape', ['List', ['List', 1, 2], ['List', 3, 4]]], '(2, 2)'],
    [['Rank', ['List', ['List', 1, 2], ['List', 3, 4]]], '2'],
    [['Shape', 5], '()'],
    [['Rank', 5], '0'],
    [['Shape', ['Tuple', 1, 2]], '()'],
  ])('positive control: %j evaluates to %s', (json, expected) => {
    expect(evalString(json)).toBe(expected);
  });
});

/**
 * An operand whose type is a collection but that has no value has no known
 * shape. `Rank(L)` with a valueless `L: list<number>` was 0, the rank of a
 * scalar. It now stays unevaluated, unless the type has the dimensions
 * (`vector<3>`) or is a tuple type (a tuple always has the shape `()`).
 */
describe('Shape and Rank of a collection-typed operand with no value', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('L', 'list<number>');
  ce2.declare('S', 'set<integer>');
  ce2.declare('W', 'list<list<number>>');
  ce2.declare('D', 'dictionary');
  ce2.declare('Str', 'string');
  ce2.declare('V', 'vector<3>');
  ce2.declare('M', 'matrix<2x2>');
  ce2.declare('T', 'tuple<number, number>');
  ce2.declare('r', 'real');
  ce2.declare('f', '(integer) -> list<number>');
  ce2.declare('L2', 'list<number>');
  ce2.assign('L2', ce2.box(['List', 1, 2]));
  const ev = (json: Json) => ce2.box(json).evaluate().toString();

  test.each<string>(['L', 'S', 'W', 'D', 'Str'])(
    '%s stays unevaluated',
    (name) => {
      expect(ce2.box(['Shape', name]).evaluate().operator).toBe('Shape');
      expect(ce2.box(['Rank', name]).evaluate().operator).toBe('Rank');
    }
  );

  test('an application with a list type and no value stays unevaluated', () => {
    expect(ev(['Rank', ['f', 1]])).toBe('Rank(f(1))');
    expect(ev(['Shape', ['f', 1]])).toBe('Shape(f(1))');
  });

  test('positive controls', () => {
    expect(ev(['Shape', 'V'])).toBe('(3)');
    expect(ev(['Rank', 'M'])).toBe('2');
    expect(ev(['Shape', 'T'])).toBe('()');
    expect(ev(['Rank', 'T'])).toBe('0');
    expect(ev(['Shape', 'r'])).toBe('()');
    expect(ev(['Rank', 'r'])).toBe('0');
    expect(ev(['Shape', 'L2'])).toBe('(2)');
    expect(ev(['Rank', 'L2'])).toBe('1');
    expect(ev(['Rank', ['List', 1, 2]])).toBe('1');
  });

  test('the compiled Rank of a list parameter reads the run-time value', () => {
    const run = compile(ce2.box(['Rank', 'L']), { fallback: false }).run!;
    expect(run({ L: [1, 2, 3] } as never)).toBe(1);
    const shape = compile(ce2.box(['Shape', 'W']), { fallback: false }).run!;
    expect(
      shape({
        W: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      } as never)
    ).toEqual([3, 2]);
  });
});

/**
 * The compiled `Shape` and `Rank` give the value of the interpreter, or the
 * compilation declines. The compiled code measures the nested arrays of the
 * run-time value. A set, a tuple and a string do not have the shape of their
 * run-time array in the interpreter, so an operand whose type can be one of
 * them declines.
 */
describe('compiled Shape and Rank', () => {
  const python = new PythonTarget();

  test.each<[string, string]>([
    ['S', 'set<integer>'],
    ['U', 'number | set<integer>'],
    ['D', 'dictionary'],
    ['T', 'tuple<number, number>'],
    ['P', 'list<tuple<number, number>>'],
    ['W', 'string'],
  ])('%s: %s declines', (name, type) => {
    const ce2 = new ComputeEngine();
    ce2.declare(name, type);
    for (const op of ['Rank', 'Shape']) {
      const expr = ce2.box([op, name]);
      expect(() => compile(expr, { fallback: false })).toThrow(
        new RegExp(`Could not compile \`${op}\``)
      );
      expect(() => python.compile(expr, { fallback: false })).toThrow(
        new RegExp(`Could not compile \`${op}\``)
      );
    }
  });

  test('an interpreted set gives no shape', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.box(['Set', 1, 2]));
    expect(ce2.box(['Rank', 'S']).evaluate().operator).toBe('Rank');
  });

  test('positive controls compile to the value of the interpreter', () => {
    const run = (json: Json, args: Record<string, unknown> = {}) =>
      compile(ce.box(json), { fallback: false }).run!(args as never);
    expect(run(['Rank', ['List', 1, 2]])).toBe(1);
    expect(evalString(['Rank', ['List', 1, 2]])).toBe('1');
    expect(run(['Shape', ['Range', 1, 3]])).toEqual([3]);
    expect(evalString(['Shape', ['Range', 1, 3]])).toBe('(3)');
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<number>');
    ce2.declare('M', 'matrix<number>');
    expect(
      compile(ce2.box(['Rank', 'L']), { fallback: false }).run!({
        L: [1, 2, 3],
      } as never)
    ).toBe(1);
    expect(
      compile(ce2.box(['Shape', 'M']), { fallback: false }).run!({
        M: [
          [1, 2],
          [3, 4],
        ],
      } as never)
    ).toEqual([2, 2]);
    expect(
      python.compile(ce2.box(['Rank', 'L']), { fallback: false }).code
    ).toBe('np.ndim(L)');
  });
});

describe('a set in an element-wise broadcast', () => {
  const SET_ERROR =
    'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(1, 2))';

  test('Power([1, 2, 3], Set(1, 2)) is an incompatible-type error', () => {
    expect(evalString(['Power', ['List', 1, 2, 3], ['Set', 1, 2]])).toBe(
      SET_ERROR
    );
  });

  test('Power(Set(1, 2), [1, 2]) is an incompatible-type error', () => {
    expect(evalString(['Power', ['Set', 1, 2], ['List', 1, 2]])).toBe(
      SET_ERROR
    );
  });

  test('Power(Range(1, 3), Set(1, 2)) is an incompatible-type error', () => {
    expect(evalString(['Power', ['Range', 1, 3], ['Set', 1, 2]])).toBe(
      SET_ERROR
    );
  });

  test('a symbol whose value is a set is not paired by position', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.box(['Set', 1, 2]));
    expect(
      ce2
        .box(['Power', ['List', 1, 2, 3], 'S'])
        .evaluate()
        .toString()
    ).toBe(SET_ERROR);
  });

  test('N() gives the same error', () => {
    expect(
      ce
        .box(['Power', ['List', 1, 2, 3], ['Set', 1, 2]])
        .N()
        .toString()
    ).toBe(SET_ERROR);
  });

  test('evaluateAsync() gives the same error', async () => {
    const result = await ce
      .box(['Power', ['List', 1, 2, 3], ['Set', 1, 2]])
      .evaluateAsync();
    expect(result.toString()).toBe(SET_ERROR);
  });

  // The parameters of `Less` are `any`, so the set is used whole in every
  // cell, as a symbol is (`[1, 2, 3] < x` is `[1 < x, 2 < x, 3 < x]`). Each
  // cell stays inert, as `1 < Set(1, 2)` does. `Less` also re-enters evaluate
  // to broadcast (`broadcastComparison`), and the two arms must not call each
  // other until the stack is exhausted.
  test('Less([1, 2, 3], Set(1, 2)) uses the set whole in every cell', () => {
    expect(evalString(['Less', ['List', 1, 2, 3], ['Set', 1, 2]])).toBe(
      '[1 < Set(1, 2),2 < Set(1, 2),3 < Set(1, 2)]'
    );
    expect(evalString(['Less', 1, ['Set', 1, 2]])).toBe('1 < Set(1, 2)');
  });

  // An operand can be a set only when it is evaluated: the type of
  // `At([Set(1, 2), 3], 1)` is `integer | set<integer>`. Before, the
  // evaluated set was paired with the list by position and the answer was
  // `[5, 36]`.
  const AT_SET = ['At', ['List', ['Set', 1, 2], 3], 1];

  test('an operand that evaluates to a set is not paired by position', () => {
    expect(evalString(['Power', ['List', 5, 6, 7], AT_SET])).toBe(SET_ERROR);
    expect(evalString(['Mod', ['List', 5, 6, 7], AT_SET])).toBe(SET_ERROR);
  });

  test('an operand that evaluates to a set: evaluateAsync()', async () => {
    const result = await ce
      .box(['Power', ['List', 5, 6, 7], AT_SET])
      .evaluateAsync();
    expect(result.toString()).toBe(SET_ERROR);
  });

  test('positive control: Power(Set(1, 2), 2) is the same error', () => {
    expect(evalString(['Power', ['Set', 1, 2], 2])).toBe(SET_ERROR);
  });

  test('positive control: Add([1, 2], [3, 4]) is [4,6]', () => {
    expect(evalString(['Add', ['List', 1, 2], ['List', 3, 4]])).toBe('[4,6]');
  });

  test('positive control: Power of two lists is element-wise', () => {
    expect(evalString(['Power', ['List', 1, 2, 3], ['Range', 1, 3]])).toBe(
      '[1,4,27]'
    );
  });

  test('positive control: an eager producer still broadcasts', () => {
    expect(
      evalString(['Power', ['Unique', ['List', 1, 2]], ['List', 1, 2]])
    ).toBe('[1,4]');
  });

  test('operators that take a set are not affected', () => {
    expect(evalString(['Union', ['Set', 1, 2], ['Set', 3]])).toBe(
      'Set(1, 2, 3)'
    );
    expect(ce.box(['Element', 1, ['Set', 1, 2]]).evaluate().symbol).toBe(
      'True'
    );
    expect(evalString(['Count', ['Set', 1, 2]])).toBe('2');
    expect(
      evalString([
        'Map',
        ['Function', ['Multiply', 'x', 2], 'x'],
        ['Set', 1, 2],
      ])
    ).toBe('Set(2, 4)');
  });
});

/**
 * A set at a numeric parameter of a broadcastable operator. `Power` and `Sin`
 * gave the `incompatible-type` error, but the operators below stayed
 * unevaluated (`Floor(Set(1.5, 2.5))`, `Mod(5, Set(2, 3))`). They now give the
 * same error. The list comes from a sweep of every library operator whose
 * parameters are all number types, with `Set(1, 2)` in each position.
 */
describe('a set at a numeric parameter is an incompatible-type error', () => {
  const SET_ERROR =
    'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(1, 2))';

  // Each operator and the number of required parameters that were checked.
  // `Arg`, `Re` and `Im` are other names of `Argument`, `Real` and
  // `Imaginary`.
  const OPERATORS: [string, number][] = [
    ['AGM', 1],
    ['Abs', 1],
    ['AbsArg', 1],
    ['AiryAi', 1],
    ['AiryAiPrime', 1],
    ['AiryBi', 1],
    ['AiryBiPrime', 1],
    ['AppellF1', 6],
    ['Arctan2', 2],
    ['Arg', 1],
    ['Argument', 1],
    ['BarnesG', 1],
    ['BesselI', 2],
    ['BesselJ', 2],
    ['BesselK', 2],
    ['BesselY', 2],
    ['Beta', 2],
    ['Ceil', 1],
    ['Clamp', 3],
    ['ClausenCl', 2],
    ['ComplexRoots', 2],
    ['CosIntegral', 1],
    ['CoshIntegral', 1],
    ['DedekindEta', 1],
    ['Digamma', 1],
    ['DirichletBeta', 1],
    ['DirichletCharacter', 3],
    ['DirichletEta', 1],
    ['DirichletL', 3],
    ['EisensteinE', 2],
    ['EllipticE', 1],
    ['EllipticF', 2],
    ['EllipticK', 1],
    ['EllipticPi', 2],
    ['Erf', 1],
    ['ErfInv', 1],
    ['Erfc', 1],
    ['Erfi', 1],
    ['ExpIntegralEi', 1],
    ['Factorial', 1],
    ['Factorial2', 1],
    ['Floor', 1],
    ['Fract', 1],
    ['FresnelC', 1],
    ['FresnelS', 1],
    ['Gamma', 1],
    ['GammaLn', 1],
    ['Heaviside', 1],
    ['Hsl', 3],
    ['Hsv', 3],
    ['HurwitzZeta', 2],
    ['Hypergeometric1F1', 3],
    ['Hypergeometric2F1', 4],
    ['Im', 1],
    ['Imaginary', 1],
    ['IsComposite', 1],
    ['IsEven', 1],
    ['IsOdd', 1],
    ['IsPrime', 1],
    ['JacobiTheta', 3],
    ['LambertW', 1],
    ['LerchPhi', 3],
    ['LogBarnesG', 1],
    ['LogGamma', 1],
    ['LogIntegral', 1],
    ['Mod', 2],
    ['Oklab', 3],
    ['Oklch', 3],
    ['PolyGamma', 2],
    ['PolyLog', 2],
    ['Re', 1],
    ['Real', 1],
    ['Rgb', 3],
    ['Round', 1],
    ['Sign', 1],
    ['SinIntegral', 1],
    ['Sinc', 1],
    ['SinhIntegral', 1],
    ['StieltjesGamma', 1],
    ['Trigamma', 1],
    ['Truncate', 1],
    ['Zeta', 1],
  ];

  const cases: [string, Json][] = [];
  for (const [name, arity] of OPERATORS) {
    for (let i = 0; i < arity; i++) {
      // The other operands are numbers that fit every parameter: 3 is an
      // integer, as the integer parameters (`DirichletL`, `PolyGamma`)
      // require.
      const ops: Json[] = Array.from({ length: arity }, (_, j) =>
        j === i ? ['Set', 1, 2] : 3
      );
      cases.push([`${name} operand ${i + 1} of ${arity}`, [name, ...ops]]);
    }
  }

  test.each(cases)('%s', (_label, json) => {
    expect(evalString(json)).toBe(SET_ERROR);
  });

  test('the three reported cases', () => {
    expect(evalString(['Floor', ['Set', 1.5, 2.5]])).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<real>"), Set(1.5, 2.5))'
    );
    expect(evalString(['Mod', 5, ['Set', 2, 3]])).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<integer>"), Set(2, 3))'
    );
    expect(evalString(['Arctan2', 1, ['Set', 1, 2]])).toBe(SET_ERROR);
  });

  test('beside a list, a symbol value, N() and evaluateAsync()', async () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.box(['Set', 1, 2]));
    expect(ce2.box(['Floor', 'S']).evaluate().toString()).toBe(SET_ERROR);
    expect(evalString(['Mod', ['List', 5, 6], ['Set', 1, 2]])).toBe(SET_ERROR);
    expect(
      ce
        .box(['Floor', ['Set', 1, 2]])
        .N()
        .toString()
    ).toBe(SET_ERROR);
    const result = await ce.box(['Floor', ['Set', 1, 2]]).evaluateAsync();
    expect(result.toString()).toBe(SET_ERROR);
  });

  test('an interval is refused too', () => {
    expect(evalString(['Floor', ['Interval', 0, 1]])).toBe(
      'Error(ErrorCode("incompatible-type", "number", "set<real>"), Interval(0, 1))'
    );
  });

  test('positive controls: lists and scalars still evaluate', () => {
    expect(evalString(['Floor', ['List', 1.5, 2.5]])).toBe('[1,2]');
    expect(evalString(['Mod', ['List', 5, 6], 2])).toBe('[1,0]');
    expect(evalString(['Floor', 2.5])).toBe('2');
    expect(evalString(['Floor', 'x'])).toBe('floor(x)');
    expect(evalString(['Rgb', ['List', 0.1, 0.2], 0.2, 0.2])).toBe(
      '[Rgb(0.1, 0.2, 0.2),Rgb(0.2, 0.2, 0.2)]'
    );
  });
});

/**
 * A set at a parameter that is not a number type. The set does not supply
 * cells, and the broadcast is not refused: the set is used whole in every
 * cell. `String([1, 2], Set(3, 4))` was `"[1,2]Set(3, 4)"`, while
 * `String([1, 2], "x")` is `["1x", "2x"]`.
 */
describe('a set at a parameter that is not a number type', () => {
  test('String([1, 2], Set(3, 4)) is a list of two strings', () => {
    expect(evalString(['String', ['List', 1, 2], ['Set', 3, 4]])).toBe(
      '["1Set(3, 4)","2Set(3, 4)"]'
    );
  });

  test('the same for a symbol value and evaluateAsync()', async () => {
    const ce2 = new ComputeEngine();
    ce2.assign('S', ce2.box(['Set', 3, 4]));
    expect(
      ce2
        .box(['String', ['List', 1, 2], 'S'])
        .evaluate()
        .toString()
    ).toBe('["1Set(3, 4)","2Set(3, 4)"]');
    const result = await ce
      .box(['String', ['List', 1, 2], ['Set', 3, 4]])
      .evaluateAsync();
    expect(result.toString()).toBe('["1Set(3, 4)","2Set(3, 4)"]');
  });

  test('the same for an operand that evaluates to a set', () => {
    expect(
      evalString([
        'String',
        ['List', 1, 2],
        ['At', ['List', ['Set', 3, 4], 5], 1],
      ])
    ).toBe('["1Set(3, 4)","2Set(3, 4)"]');
  });

  test('positive controls', () => {
    expect(evalString(['String', ['List', 1, 2], "'x'"])).toBe('["1x","2x"]');
    expect(evalString(['String', ['Set', 3, 4]])).toBe('"34"');
  });
});

describe('\\bar over a number is the conjugate', () => {
  test.each<[string, Json]>([
    ['\\bar{7}', ['Conjugate', 7]],
    ['\\bar{2.5}', ['Conjugate', 2.5]],
    ['\\bar 7', ['Conjugate', 7]],
    // These were also an `unexpected-command` error.
    ['\\bar{-1}', ['Conjugate', -1]],
    ['\\bar{x+1}', ['Conjugate', ['Add', 'x', 1]]],
    // A repeating decimal, as with `\overline`.
    ['0.\\bar{3}', ['Rational', 1, 3]],
    ['0.5\\bar{3}', ['Rational', 8, 15]],
  ])('%s parses as %j', (latex, expected) => {
    expect(ce.parse(latex).json).toEqual(expected);
  });

  test.each<[string, Json]>([
    ['\\bar{x}', ['Mean', 'x']],
    ['\\bar{z}', ['Mean', 'z']],
    ['\\bar z', ['Mean', 'z']],
  ])('positive control: %s over a symbol is still %j', (latex, expected) => {
    expect(ce.parse(latex).json).toEqual(expected);
  });

  test('positive control: \\overline{7} parses as Conjugate(7)', () => {
    expect(ce.parse('\\overline{7}').json).toEqual(['Conjugate', 7]);
  });

  test('\\bar{7} round-trips through LaTeX', () => {
    const expr = ce.parse('\\bar{7}');
    expect(expr.latex).toBe('\\overline{7}');
    expect(ce.parse(expr.latex).json).toEqual(['Conjugate', 7]);
  });

  test('Conjugate(7) serializes as \\overline{7}', () => {
    expect(ce.box(['Conjugate', 7]).latex).toBe('\\overline{7}');
  });
});
