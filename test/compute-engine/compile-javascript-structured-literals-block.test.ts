import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Three forms of the structured route of the JavaScript compiler (the
// `numeric-kernel` profile) that the shadow measure found among the most
// frequent declines (docs/plans/2026-11-10-js-profile-first-consumer.md,
// "Shadow measure"):
//
// - `Power` and `Root` of two finite real number literals. The handlers of
//   the existing emitter fold them before every other branch, also with
//   `constantFold: false`, and write `String(v)`: `Math.pow(b, e)`, or for a
//   `NaN` power the principal complex value, the real root of a negative
//   base, or `NaN`. The route writes the same value as a literal, and
//   declines a `NaN` where the interpreter has a finite value.
// - A `Block` with statements as the root of the compiled expression. The
//   existing compiler writes a function that it calls at once, with the free
//   symbols read as the inputs `_.x`. The route admits it as the body of a
//   root function whose parameters are the free symbols.
// - The causes of a refused parameter, each with its own message.
// - Forms that the existing compiler writes in another shape, declined.
//
// Each admitted program is compared with the existing compiler
// (`cse: false, constantFold: false`), the same double by `Object.is` at
// every input, and with the interpreter, within 1e-12 relative or by the
// caveats of compiled code (docs/COMPILATION-MODEL.md), in the `strict` and
// `complex` modes.

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  ce.declare('k', 'integer');
  ce.declare('C', 'boolean');
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  return ce;
}

const structured = () =>
  new ScalarFragmentJavaScriptTarget('structured', new Map(), {});

type Value = number | { re: number; im: number };
type Inputs = Record<string, number>;

/** The value of `expr` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, expr: Expression, inputs: Inputs): Value {
  const value = expr
    .subs(
      Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, ce.number(v)])
      )
    )
    .evaluate()
    .N();
  if (value.im === 0) return value.re;
  return { re: value.re, im: value.im };
}

/** The same doubles, `-0` and `NaN` included. */
function same(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' || typeof b === 'number') return Object.is(a, b);
  const p = a as { re: number; im: number };
  const q = b as { re: number; im: number };
  return (
    typeof p === 'object' &&
    typeof q === 'object' &&
    Object.is(p.re, q.re) &&
    Object.is(p.im, q.im)
  );
}

const parts = (v: unknown) =>
  typeof v === 'number' ? { re: v, im: 0 } : (v as { re: number; im: number });

/** `a` and `b` are the same value within 1e-12 relative; a complex value
 *  with an imaginary part of 0 equals the number of its real part. */
function close(a: unknown, b: unknown): boolean {
  const p = parts(a);
  const q = parts(b);
  const near = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    (Number.isFinite(u) &&
      Number.isFinite(v) &&
      Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(v)));
  return near(p.re, q.re) && near(p.im, q.im);
}

const notANumber = (v: unknown) =>
  Number.isNaN(parts(v).re) || Number.isNaN(parts(v).im);

const nonReal = (v: unknown) => parts(v).im !== 0;

/** Within the caveats of compiled code: `NaN` for a value that is not a
 *  number, `NaN` for a value that is not real in the `strict` mode, and an
 *  infinity or `NaN` of compiled code where the interpreter gives a value
 *  with an infinite part (`ComplexInfinity` for `0^-2`, and `-oo +
 *  ComplexInfinity` for `x + 0^-2` at `x = -oo`, where compiled code adds
 *  two infinities of opposite signs). */
function withinCaveats(value: unknown, expected: Value, mode: Mode): boolean {
  if (close(value, expected)) return true;
  if (notANumber(value) && notANumber(expected)) return true;
  if (mode === 'strict' && notANumber(value) && nonReal(expected)) return true;
  const e = parts(expected);
  const v = parts(value);
  if (
    (Math.abs(e.re) === Infinity || Math.abs(e.im) === Infinity) &&
    (Math.abs(v.re) === Infinity ||
      Math.abs(v.im) === Infinity ||
      notANumber(value))
  )
    return true;
  return false;
}

/** Compile `json` on the route and with the existing compiler, and compare
 *  them at each of `inputs`, and with the interpreter at each input for
 *  which `interpreted` holds. */
function checkProgram(
  json: MathJsonExpression,
  mode: Mode,
  inputs: readonly Inputs[],
  ce = engine(),
  interpreted: (input: Inputs) => boolean = () => true
): string {
  const expr = ce.expr(json);
  const result = structured().compile(expr, { ...OPTIONS, mode });
  const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
  expect(existing.success).toBe(true);
  const disagreements: unknown[] = [];
  for (const input of inputs) {
    const value = result.run!(input as never);
    const other = existing.run!(input as never);
    expect([input, value, other, same(value, other)]).toEqual([
      input,
      value,
      other,
      true,
    ]);
    if (!interpreted(input)) continue;
    const expected = interpret(ce, expr, input);
    if (!withinCaveats(value, expected, mode))
      disagreements.push([input, value, expected]);
  }
  expect(disagreements).toEqual([]);
  return result.code;
}

const XS = [
  -Infinity,
  -1e300,
  -2.5,
  -1,
  -1e-300,
  -0,
  0,
  1e-300,
  0.5,
  3,
  1e300,
  Infinity,
  NaN,
];
const overX = XS.map((x) => ({ x }));
const finite = (input: Inputs) =>
  Object.values(input).every((v) => Number.isFinite(v));

describe('Power and Root of two number literals', () => {
  const BASES = [-8, -2, -1, -0.5, -1e-200, 0, 0.1, 2, 10, 1e300];
  const EXPONENTS: MathJsonExpression[] = [
    -3,
    -2,
    0.3,
    -0.7,
    0.25,
    -0.25,
    1.2,
    4.9,
    ['Rational', -1, 4],
    ['Rational', 1, 3],
    ['Rational', 2, 3],
    ['Rational', 3, 2],
    ['Rational', -5, 3],
    ['Rational', 3, 4],
    0.5,
    2,
    3,
    2.5,
    101,
    -100,
    1e-12,
  ];
  const DEGREES = [3, 4, 5, 2.2, 2.4, 2.5, 6, -4, -2.5, 0.5];
  // `x * p` can have the canonical form `Multiply(x, Divide(1, r))`
  // (`x * Root(b, -4)`, `x * 10^(-1/4)`): the product of a quotient, below.
  const contexts = (p: MathJsonExpression): [string, MathJsonExpression][] => [
    ['p', p],
    ['x + p', ['Add', 'x', p]],
    ['x * p', ['Multiply', 'x', p]],
  ];
  const programs: [string, MathJsonExpression][] = [
    ...BASES.flatMap((b) =>
      EXPONENTS.flatMap((e) =>
        contexts(['Power', b, e]).map(
          ([name, json]) =>
            [`${name}, p = ${b}^${JSON.stringify(e)}`, json] as [
              string,
              MathJsonExpression,
            ]
        )
      )
    ),
    ...BASES.flatMap((b) =>
      DEGREES.flatMap((n) =>
        contexts(['Root', b, n]).map(
          ([name, json]) =>
            [`${name}, p = Root(${b}, ${n})`, json] as [
              string,
              MathJsonExpression,
            ]
        )
      )
    ),
  ];
  /**
   * Whether the folded double of the literal power `p` of `json` is the
   * value of the interpreter. It is not when the double underflows to 0 or
   * overflows to an infinity (`(-1e-200)^3`, `(1e300)^3`): the precision of
   * the target, a caveat of compiled code. The program is then compared
   * with the existing compiler only.
   */
  const foldIsExact = (json: MathJsonExpression, mode: Mode): boolean => {
    const ce = engine();
    const literal = (
      (json as unknown[])[0] === 'Power' || (json as unknown[])[0] === 'Root'
        ? json
        : (json as unknown[])[2]
    ) as MathJsonExpression[];
    const p = ce.expr(literal as MathJsonExpression);
    const double = structured().compile(p, { ...OPTIONS, mode }).run!(
      {} as never
    );
    const { re, im } = parts(double);
    const base = literal[1] as number;
    if (
      base !== 0 &&
      ((typeof double === 'number' && double === 0) ||
        Math.abs(re) === Infinity ||
        Math.abs(im) === Infinity)
    )
      return false;
    // The existing emitter folds the real root of a negative base whose
    // magnitude overflows to `NaN` (`negativeBaseRealPow()` gives no value):
    // `(-1e-200)^(-5/3)` is `NaN`, where the interpreter gives
    // `-2.15e333`, `-Infinity` as a double. The route writes the same `NaN`.
    const exact = interpret(ce, p, {});
    if (Number.isNaN(re) && Math.abs(parts(exact).re) === Infinity)
      return false;
    expect([p.toString(), withinCaveats(double, exact, mode)]).toEqual([
      p.toString(),
      true,
    ]);
    return true;
  };
  const NAN_FOLD =
    /of number literals is folded to NaN by the existing emitter, and its value is the finite number/;
  /** Whether the literal of `json` declines as a `NaN` fold. */
  const nanFold = (json: MathJsonExpression, mode: Mode): boolean => {
    const literal = (
      (json as unknown[])[0] === 'Power' || (json as unknown[])[0] === 'Root'
        ? json
        : (json as unknown[])[2]
    ) as MathJsonExpression;
    try {
      structured().compile(engine().expr(literal), { ...OPTIONS, mode });
      return false;
    } catch (e) {
      if (NAN_FOLD.test((e as Error).message)) return true;
      throw e;
    }
  };
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      test.each(programs)('%s', (_name, json) => {
        // A literal that the existing emitter folds to `NaN` where the
        // interpreter has a finite value declines (the canonical form of
        // `b^(-1/4)` is `Root(b, -4)`: `NaN` for a negative `b`, where the
        // interpreter gives the principal complex value).
        if (nanFold(json, mode)) {
          expect(() =>
            structured().compile(engine().expr(json), { ...OPTIONS, mode })
          ).toThrow(NAN_FOLD);
          return;
        }
        const exact = foldIsExact(json, mode);
        checkProgram(json, mode, overX, engine(), () => exact);
      });
    });

  test('the code is the literal of the existing emitter', () => {
    const codeOf = (json: MathJsonExpression, mode: Mode = 'strict') =>
      structured().compile(engine().expr(json), { ...OPTIONS, mode }).code;
    // `Math.pow(10, 1.5)`, not the product `10 * Math.sqrt(10)`
    // (`31.622776601683796`).
    expect(codeOf(['Add', 'x', ['Power', 10, 1.5]])).toBe(
      '_.x + 31.622776601683793'
    );
    // The real root of a negative base: an exponent with an odd
    // denominator.
    expect(codeOf(['Add', 'x', ['Power', -8, ['Rational', 2, 3]]])).toBe(
      '_.x + 4'
    );
    expect(codeOf(['Add', 'x', ['Root', -8, 3]])).toBe('_.x + -2');
    // `-0` is written `0`, as `String(-0)` is.
    expect(codeOf(['Add', 'x', ['Power', -1e-200, 3]])).toBe('_.x + 0');
    // The principal complex value: an object, not a complex literal, so a
    // sum reads its parts (`x + 0` at `x = -0` is `0`).
    const complex = structured().compile(
      engine().expr(['Add', 'x', ['Power', -8, ['Rational', 3, 2]]]),
      { ...OPTIONS, mode: 'strict' }
    );
    expect(complex.code).toContain('({ re: 0, im: -22.627416997969526 })');
    expect(
      Object.is(
        (complex.run!({ x: -0 } as never) as Value as { re: number }).re,
        0
      )
    ).toBe(true);
    // A root of the type `number` in the `complex` mode: `_SYS.cplx(v)` on
    // the existing emitter, the object `v + 0i` on the route.
    expect(codeOf(['Root', -2, 2.2], 'complex')).toContain(
      '({ re: -1.3703509847201236, im: 0 })'
    );
  });

  test('the representation: a literal, or the complex function of two literals', () => {
    const operationsOf = (json: MathJsonExpression) => {
      const program = lowerStructuredFragment(
        structured().prepareStructured(engine().expr(json), {
          ...OPTIONS,
          mode: 'strict',
        })
      );
      return program.root.operations.map((op) =>
        op.kind === 'binary' ? `binary ${op.fn}` : op.kind
      );
    };
    expect(operationsOf(['Add', 'x', ['Power', 2.5, 3]])).toEqual([
      'input',
      'literal',
      'add',
      'yield',
    ]);
    expect(operationsOf(['Power', -8, ['Rational', 3, 2]])).toEqual([
      'literal',
      'literal',
      'binary complex',
      'yield',
    ]);
  });

  test('a fold to NaN where the interpreter has a finite value declines', () => {
    for (const mode of MODES)
      for (const json of [
        // The canonical form is `Root(-2, -4)`.
        ['Power', -2, ['Rational', -1, 4]],
        ['Root', -2, 2.4],
        ['Add', 'x', ['Power', -2, ['Rational', -1, 4]]],
      ] as MathJsonExpression[])
        expect(() =>
          structured().compile(engine().expr(json), { ...OPTIONS, mode })
        ).toThrow(NAN_FOLD);
    // `NaN` where the interpreter has no finite number is kept:
    // `(-1e-200)^(-5/3)` is `-2.15e333`.
    expect(
      structured()
        .compile(engine().expr(['Power', -1e-200, ['Rational', -5, 3]]), {
          ...OPTIONS,
          mode: 'strict',
        })
        .run!({} as never)
    ).toBeNaN();
  });

  test('a Root of the degree 0 keeps its decline', () => {
    const ce = engine();
    const expr = ce.expr(['Add', 'x', ['Root', 8, 0]]);
    if (!expr.isValid) return;
    expect(() =>
      structured().compile(expr, { ...OPTIONS, mode: 'strict' })
    ).toThrow(/Root with the degree 0 is not in the structured route/);
  });
});

describe('a product with a quotient factor', () => {
  // `compileExprOperator()` joins the codes of the factors with ` * ` and
  // writes a real quotient factor `n / d` with no parentheses, so
  // `x * (1/y)` is `x * 1 / y`, `(x * 1) / y`: at `x = 3`,
  // `y = 0.4641588833612779` it is `6.463304070095651`, where `x * (1 / y)`
  // is `6.46330407009565`. The route writes the same sequence of
  // multiplications and divisions.
  const D = (a: MathJsonExpression, b: MathJsonExpression): MathJsonExpression => [
    'Divide',
    a,
    b,
  ];
  const M = (...a: MathJsonExpression[]): MathJsonExpression => [
    'Multiply',
    ...a,
  ];
  const PRODUCTS: [string, MathJsonExpression][] = [
    ['x * (1/y)', M('x', D(1, 'y'))],
    ['x * (u/y)', M('x', D('u', 'y'))],
    ['(1/y) * x, a quotient factor first', M(D(1, 'y'), 'x')],
    ['x * u * (1/y)', M('x', 'u', D(1, 'y'))],
    ['x * (1/y) * u', M('x', D(1, 'y'), 'u')],
    ['x * (1/y) * (1/u), two quotient factors', M('x', D(1, 'y'), D(1, 'u'))],
    ['x * (u/y) * (v/u)', M('x', D('u', 'y'), D('v', 'u'))],
    ['k * (1/y), an integer factor', M('k', D(1, 'y'))],
    ['k * (m/n), integer operands', M('k', D('m', 'n'))],
    ['x * ((u/y)/v), a nested quotient', M('x', D(D('u', 'y'), 'v'))],
    ['x * (u/(y/v))', M('x', D('u', D('y', 'v')))],
    ['x * ((u·v)/y), a product numerator', M('x', D(M('u', 'v'), 'y'))],
    ['x * (1/(y·v)), a product denominator', M('x', D(1, M('y', 'v')))],
    ['x * (2/y)', M('x', D(2, 'y'))],
    ['3 * x * (1/y)', M(3, 'x', D(1, 'y'))],
    ['x * (1/Sqrt(y))', M('x', D(1, ['Sqrt', 'y']))],
    ['x * y^-1', M('x', ['Power', 'y', -1])],
    ['x * Root(y, -3)', M('x', ['Root', 'y', -3])],
    ['x * (1/3) * (1/y), a rational factor', M('x', ['Rational', 1, 3], D(1, 'y'))],
    ['(2/3) * x * (u/y)', M(['Rational', 2, 3], 'x', D('u', 'y'))],
    ['x * (Sin(y)/y)', M('x', D(['Sin', 'y'], 'y'))],
    ['x * (1/y) + 1, nested in a sum', ['Add', M('x', D(1, 'y')), 1]],
    ['Sin(x * (1/y))', ['Sin', M('x', D(1, 'y'))]],
    ['x / (y * (1/u)), a product divisor', D('x', M('y', D(1, 'u')))],
    ['c * (x/y), a complex product', M('c', D('x', 'y'))],
    ['x * c * (1/y)', M('x', 'c', D(1, 'y'))],
  ];
  const XS2 = [-2.5, -0, 0, 3, 1e-300, 1e300, -Infinity, NaN];
  const YS2 = [3, 0.4641588833612779, -0, 7e-300, 1e300];
  const inputs = XS2.flatMap((x) =>
    YS2.map((y) => ({ x, y, u: 0.1 * x + 0.3, v: 1.7, k: 3, m: 7, n: 49 }))
  );
  const productEngine = () => {
    const ce = engine();
    for (const name of ['u', 'v']) ce.declare(name, 'real');
    for (const name of ['m', 'n']) ce.declare(name, 'integer');
    ce.declare('c', 'complex');
    return ce;
  };
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      test.each(PRODUCTS)('%s', (name, json) => {
        const ce = productEngine();
        const expr = ce.expr(json);
        // `Sin(x/y)` has the type `number`: in the `complex` mode the
        // existing compiler wraps the real call in `_SYS.cplx()`.
        if (mode === 'complex' && name === 'Sin(x * (1/y))') {
          expect(() =>
            structured().compile(expr, { ...OPTIONS, mode })
          ).toThrow(/which is not real, in the complex mode/);
          return;
        }
        const result = structured().compile(expr, { ...OPTIONS, mode });
        const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
        for (const input of inputs) {
          const c = { re: input.x, im: 0.5 };
          const args = { ...input, c } as never;
          const value = result.run!(args);
          const other = existing.run!(args);
          expect([input, value, other, same(value, other)]).toEqual([
            input,
            value,
            other,
            true,
          ]);
        }
      });
    });

  test('the witness: x * (1/y) is (x * 1) / y', () => {
    const expr = productEngine().expr(M('x', D(1, 'y')));
    const result = structured().compile(expr, { ...OPTIONS, mode: 'strict' });
    expect(result.code).toBe('_.x * 1 / _.y');
    expect(result.run!({ x: 3, y: 0.4641588833612779 } as never)).toBe(
      6.463304070095651
    );
  });
});

describe('a Block as the root', () => {
  const declare = (
    name: string,
    type: string,
    value: MathJsonExpression
  ): MathJsonExpression => ['Declare', name, `'${type}'`, value];
  const overXY = XS.flatMap((x) => [-1.5, 0, 2].map((y) => ({ x, y })));
  const PROGRAMS: [string, MathJsonExpression, readonly Inputs[]][] = [
    [
      'a local and its value',
      ['Block', declare('a', 'real', ['Power', 'x', 2]), ['Add', 'a', 1]],
      overX,
    ],
    [
      'two locals and two inputs',
      [
        'Block',
        declare('a', 'real', ['Add', 'x', 'y']),
        declare('b', 'real', ['Multiply', 'a', 'y']),
        ['Assign', 'a', ['Subtract', 'b', 'x']],
        ['Add', 'a', 'b'],
      ],
      overXY,
    ],
    [
      'a let local',
      [
        'Block',
        [
          'Declare',
          'a',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, ['Sin', 'x']]],
        ],
        ['Multiply', 2, 'a'],
      ],
      // The interpreter does not reduce `Sin(1e300)` exactly.
      overX.filter(({ x }) => Math.abs(x) !== 1e300),
    ],
    [
      'a loop over a range',
      [
        'Block',
        declare('s', 'real', 0),
        [
          'Loop',
          ['Assign', 's', ['Add', 's', ['Multiply', 'k', 'x']]],
          ['Element', 'k', ['Range', 1, 4]],
        ],
        's',
      ],
      overX,
    ],
    [
      'a loop with Break',
      [
        'Block',
        declare('s', 'real', 0),
        [
          'Loop',
          [
            'Block',
            ['Assign', 's', ['Add', 's', 'j']],
            ['If', ['Less', 'x', 's'], ['Break']],
          ],
          ['Element', 'j', ['Range', 1, 5]],
        ],
        's',
      ],
      overX,
    ],
    [
      'an If statement',
      [
        'Block',
        declare('t', 'real', 'x'),
        ['If', ['Less', 'x', 0], ['Assign', 't', ['Negate', 'x']]],
        ['Add', 't', 'y'],
      ],
      overXY,
    ],
    [
      'a captured binding',
      [
        'Block',
        declare('a', 'real', ['Multiply', 'offset', 'x']),
        ['Add', 'a', 'offset'],
      ],
      overX,
    ],
    [
      'an integer input as the bound of a loop',
      [
        'Block',
        declare('s', 'real', 0),
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'x']],
          ['Element', 'j', ['Range', 1, 'k']],
        ],
        's',
      ],
      [-1, 0, 3].flatMap((k) => [-2.5, -0, 1].map((x) => ({ x, k }))),
    ],
    // The index of a `Sum`, a `Product` or a comprehension is not an input.
    [
      'a Sum over Limits as the value',
      [
        'Block',
        declare('s', 'real', 'x'),
        ['Sum', ['Multiply', 'i', 's'], ['Limits', 'i', 1, 3]],
      ],
      overX,
    ],
    [
      'a Sum over Limits in a statement',
      [
        'Block',
        declare('s', 'real', ['Sum', ['Multiply', 'i', 'x'], ['Limits', 'i', 1, 4]]),
        ['Add', 's', 1],
      ],
      overX,
    ],
    [
      'a Product with a bound that reads an input',
      [
        'Block',
        declare('s', 'real', 'x'),
        ['Product', ['Add', 's', 'j'], ['Limits', 'j', 1, 'k']],
      ],
      [-1, 0, 3].flatMap((k) => [-2.5, -0, 1].map((x) => ({ x, k }))),
    ],
    [
      'a comprehension',
      [
        'Block',
        declare('s', 'real', 'x'),
        [
          'At',
          ['Comprehension', ['Multiply', 'j', 's'], ['Element', 'j', ['Range', 1, 'k']]],
          2,
        ],
      ],
      [0, 2, 3].flatMap((k) => [-2.5, -0, 1].map((x) => ({ x, k }))),
    ],
  ];
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      // The interpreter reads a non-finite input of a block as a value
      // outside the type `real` of its local: the existing compiler is the
      // reference there.
      test.each(PROGRAMS)('%s', (_name, json, inputs) => {
        checkProgram(json, mode, inputs, engine(), finite);
      });
    });

  test('a name with no declared type is an input of the default kind', () => {
    const ce = engine();
    const json: MathJsonExpression = [
      'Block',
      declare('a', 'real', ['Multiply', 'u', 'x']),
      ['Add', 'a', 'u'],
    ];
    const result = compile(ce.expr(json), {
      ...OPTIONS,
      profile: 'numeric-kernel',
    } as never) as {
      success: boolean;
      code: string;
      defaultedSymbols?: string[];
    };
    expect(result.success).toBe(true);
    expect(result.defaultedSymbols).toEqual(['u']);
    checkProgram(
      json,
      'strict',
      [-2, -0, 3].flatMap((u) => [-1, 0.5].map((x) => ({ x, u }))),
      ce
    );
  });

  test('the code: a function called at once, with the inputs read from _', () => {
    const code = structured().compile(
      engine().expr([
        'Block',
        declare('a', 'real', ['Add', 'x', 1]),
        ['Multiply', 'a', 'a'],
      ]),
      { ...OPTIONS, mode: 'strict' }
    ).code;
    expect(code).toBe(
      '(() => { const _tv1 = _.x + 1; return _tv1 * _tv1; })()'
    );
  });

  const REFUSALS: [string, MathJsonExpression, RegExp][] = [
    [
      'a write to a name of the engine',
      ['Block', ['Assign', 'y', ['Add', 'x', 1]], ['Add', 'y', 1]],
      /admits a write in a root Block only to a local of the block, and y is not a local of the block/,
    ],
    [
      'a Block with a write as an operand',
      [
        'Add',
        ['Block', declare('a', 'real', 0), ['Assign', 'a', 'x'], ['Add', 'a', 1]],
        1,
      ],
      /the statement Assign\(a, x\) of a Block used as an operand is not a declaration with a value/,
    ],
    [
      'a local function that calls itself',
      [
        'Block',
        [
          'DefineFunction',
          'g',
          ['Function', ['If', ['Less', 'q', 1], 0, ['g', ['Subtract', 'q', 1]]], 'q'],
        ],
        ['g', 'x'],
      ],
      // In the complex mode, a local function declines at its definition.
      /the helper g calls itself|admits the local function g only in the strict mode/,
    ],
    [
      'a call of a function that a later statement defines',
      [
        'Block',
        [
          'Declare',
          'a',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, ['g', 3]]],
        ],
        ['DefineFunction', 'g', ['Function', ['Block', ['Add', 'q', 1]], 'q']],
        'a',
      ],
      /the call g\(3\) does not reach a local function g defined before it in the body/,
    ],
    [
      'an empty Block',
      ['Block'],
      /an empty Block is not in the structured route: it has no value/,
    ],
    [
      'a statement that is a number',
      ['Block', 28, ['Add', 'x', 20]],
      /admits no statement 28/,
    ],
    [
      'a local of a type that is not in the route',
      ['Block', declare('a', 'string', "'ab'"), 'x'],
      /unsupported local declaration/,
    ],
  ];
  test.each(REFUSALS)('declines %s', (_name, json, message) => {
    const ce = engine();
    for (const mode of MODES)
      expect(() =>
        structured().compile(ce.expr(json), { ...OPTIONS, mode })
      ).toThrow(message);
  });

  test('a Function whose body calls a function that a later statement defines declines', () => {
    const ce = engine();
    const expr = ce.expr([
      'Function',
      [
        'Block',
        ['Declare', 'a', ['Dictionary', ['KeyValuePair', { str: 'value' }, ['g', 3]]]],
        ['DefineFunction', 'g', ['Function', ['Block', ['Add', 'q', 1]], 'q']],
        'a',
      ],
      ['Typed', 'x', "'real'"],
    ]);
    for (const mode of MODES)
      expect(() =>
        structured().compile(expr, { ...OPTIONS, mode })
      ).toThrow(
        /the call g\(3\) does not reach a local function g defined before it in the body/
      );
    expect(() =>
      compile(expr, {
        ...OPTIONS,
        profile: 'numeric-kernel',
        fallback: false,
      } as never)
    ).toThrow(
      /^Could not compile with the profile 'numeric-kernel': the call g\(3\) does not reach a local function g/
    );
  });

  test('a decline of the profile names its cause', () => {
    expect(() =>
      compile(engine().expr(['Block', ['Assign', 'y', 'x'], 'y']), {
        ...OPTIONS,
        profile: 'numeric-kernel',
        fallback: false,
      } as never)
    ).toThrow(
      /^Could not compile with the profile 'numeric-kernel': the profile admits a write in a root Block only to a local of the block/
    );
  });
});

describe('the causes of a refused parameter', () => {
  const typed = (name: string, type: string): MathJsonExpression => [
    'Typed',
    name,
    `'${type}'`,
  ];
  const REFUSALS: [string, () => Expression, RegExp][] = [
    [
      'a parameter of a type that has no kind',
      () => engine().expr(['Function', ['Add', 'a', 1], typed('a', 'any')]),
      /the parameter a of the function has the type any, which is not in the structured route: a parameter is a number, a boolean, a list of reals or of integers, or a tuple of reals/,
    ],
    [
      'a named tuple parameter',
      () =>
        engine().expr([
          'Function',
          ['At', 'T', 1],
          typed('T', 'tuple<x: real, y: real>'),
        ]),
      /the parameter T of the function has the type tuple<x: real, y: real>, which is not in the structured route/,
    ],
    [
      'a parameter with a default value',
      () =>
        engine().expr([
          'Function',
          ['Multiply', 'a', 'b'],
          typed('a', 'real'),
          ['Optional', 'b', 2],
        ]),
      /the parameter b of the function has a default value, which is not in the structured route/,
    ],
    [
      'a helper whose signature is declared with a string parameter and whose literal has no annotation',
      () => {
        const ce = engine();
        ce.declare('g', '(real, string) -> real');
        ce.assign('g', ce.expr(['Function', ['Multiply', 't', 2], 't', 's']));
        return ce.expr(['Add', ['g', 'x', "'a'"], 1]);
      },
      /the parameter s of the helper g has no type annotation, and the type string of its signature is not in the/,
    ],
  ];
  test.each(REFUSALS)('%s', (_name, make, message) => {
    for (const mode of MODES)
      expect(() => structured().compile(make(), { ...OPTIONS, mode })).toThrow(
        message
      );
  });
});

describe('the forms that the existing compiler writes in another shape decline', () => {
  const withA = () => {
    const ce = engine();
    ce.declare('a', 'real');
    return ce;
  };
  const DECLINES: [string, MathJsonExpression, Mode, RegExp][] = [
    // `Negate(Power(0, -1))` is the literal `-oo - oo·i`: the existing
    // compiler writes every undirected infinity `Infinity`.
    [
      'x + -(0^-1)',
      ['Add', 'x', ['Negate', ['Power', 0, -1]]],
      'strict',
      /the undirected infinity ~oo with the real part -Infinity is not in the structured route/,
    ],
    // `Sin(a/y)` has the type `number`: the existing compiler wraps the
    // real call in `_SYS.cplx()` in the `complex` mode.
    [
      'x * Sin(a/y)',
      ['Multiply', 'x', ['Sin', ['Divide', 'a', 'y']]],
      'complex',
      /sin\(a \/ y\) has the type number, which is not real, in the complex mode: the existing compiler wraps the real call in _SYS.cplx/,
    ],
    [
      'x / Tanh(a/y)',
      ['Divide', 'x', ['Tanh', ['Divide', 'a', 'y']]],
      'complex',
      /has the type number, which is not real, in the complex mode/,
    ],
    // A square of the type `number` is `_SYS.cpow` in the `complex` mode.
    [
      'Ln(a^2)^2',
      ['Power', ['Ln', ['Power', 'a', 2]], 2],
      'complex',
      /has the type number, which is not real, in the complex mode: the existing emitter writes the complex power/,
    ],
    [
      'x * NaN^2',
      ['Multiply', 'x', ['Power', 'NaN', 2]],
      'complex',
      /the power NaN\^2 has the type number, which is not real, in the complex mode/,
    ],
  ];
  test.each(DECLINES)('%s', (_name, json, mode, message) => {
    expect(() =>
      structured().compile(withA().expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });

  test('the same forms in the strict mode give the doubles of the existing compiler', () => {
    for (const json of [
      ['Multiply', 'x', ['Sin', ['Divide', 'a', 'y']]],
      ['Divide', 'x', ['Tanh', ['Divide', 'a', 'y']]],
      ['Power', ['Ln', ['Power', 'a', 2]], 2],
      ['Multiply', 'x', ['Power', 'NaN', 2]],
      ['Add', 'x', ['Power', 0, -1]],
    ] as MathJsonExpression[]) {
      const expr = withA().expr(json);
      const options = { ...OPTIONS, mode: 'strict' as const };
      const route = structured().compile(expr, options);
      const existing = compile(expr, { ...options, fallback: false } as never);
      for (const x of [-2.5, -0, 3])
        for (const a of [-1, 0.5, 7])
          for (const y of [-0.5, 3]) {
            const inputs = { x, a, y } as never;
            expect(Object.is(route.run!(inputs), existing.run!(inputs))).toBe(
              true
            );
          }
    }
  });
});
