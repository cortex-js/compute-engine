import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import {
  regionsOf,
  type IROperation,
  type IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// The forms of `Power` with a number literal exponent other than 2 and 1.5,
// and `Root`, on the structured route of the internal JavaScript fragment
// target: the branches of the `Power` and `Root` handlers of the existing
// emitter (`javascript-target.ts`) that the engine's own compilations reach
// (docs/plans/2026-11-09-js-pilot-emission-rewrites.md, the table of
// `Power`).
//
// - `_SYS.pow3(b)` to `_SYS.pow5(b)`: the products of the base, in the
//   order of the helpers (`product-power`).
// - `(1 / b / b)` for the exponent -2 and a base that is a name or a
//   literal (`reciprocal-square`).
// - `Math.pow(b, e)` for another constant exponent (`real-pow`): an integer,
//   a float with an even recovered denominator in the `strict` mode, an
//   exact exponent with an even denominator, 1.5 for a base of unknown sign
//   in the `strict` mode, a float for a base that the engine proves
//   non-negative.
// - `Math.cbrt(x)` for `Root(x, 3)`, `_SYS.root(x, n)` for a degree that is
//   not a literal.
//
// Each program is compiled on the structured route and compared with the
// existing compiler (`cse: false, constantFold: false`), the same double by
// `Object.is` at every input, and with the interpreter, within 1e-12
// relative or by the caveats of compiled code (docs/COMPILATION-MODEL.md,
// "Caveats of compiled code"), in the `strict` and `complex` modes. The
// branches that the route does not admit decline with a message that names
// the exponent or the degree.

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];

/** An engine with the inputs and the captured bindings of the programs. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['k', 'integer'],
    ['p', 'real<0..>'],
    ['n', 'real<..-1>'],
  ])
    ce.declare(name, type);
  ce.declare('offset', 'real');
  ce.assign('offset', 2);
  ce.declare('drop', 'real');
  ce.assign('drop', -3);
  return ce;
}

const structured = () =>
  new ScalarFragmentJavaScriptTarget('structured', new Map(), {});

type Value = number | { re: number; im: number };
type Inputs = Record<string, Value>;

/** The value of `expr` on `inputs` by the interpreter: a number, or a
 *  complex `{re, im}`. */
function interpret(
  ce: ComputeEngine,
  expr: Expression,
  inputs: Inputs
): unknown {
  const value = expr
    .subs(
      Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [
          k,
          typeof v === 'number'
            ? ce.number(v)
            : ce.expr(['Complex', v.re, v.im]),
        ])
      )
    )
    .evaluate()
    .N();
  if (value.im === 0) return value.re;
  return { re: value.re, im: value.im };
}

/** `a` and `b` are the same value within 1e-12 relative; a complex value
 *  with an imaginary part of 0 equals the number of its real part. An
 *  infinite part equals only the same infinity, and `NaN` only `NaN`. */
function close(a: unknown, b: unknown): boolean {
  const pair = (v: unknown) =>
    typeof v === 'number'
      ? { re: v, im: 0 }
      : (v as { re: number; im: number });
  const p = pair(a);
  const q = pair(b);
  const near = (u: number, v: number) =>
    (Number.isNaN(u) && Number.isNaN(v)) ||
    u === v ||
    (Number.isFinite(u) &&
      Number.isFinite(v) &&
      Math.abs(u - v) <= 1e-12 * Math.max(1, Math.abs(u), Math.abs(v)));
  return near(p.re, q.re) && near(p.im, q.im);
}

const nonReal = (v: unknown) =>
  typeof v === 'object' && v !== null && (v as { im: number }).im !== 0;

/** `v` is not a number: `NaN`, or a complex value with a `NaN` part. */
const notANumber = (v: unknown) =>
  typeof v === 'number'
    ? Number.isNaN(v)
    : typeof v === 'object' &&
      v !== null &&
      (Number.isNaN((v as { re: number }).re) ||
        Number.isNaN((v as { im: number }).im));

/** `v` is the value of `ComplexInfinity` (two infinite parts): the
 *  interpreter gives it for `0^e` with `e < 0`, where compiled code gives
 *  `±Infinity` (the caveats of compiled code). */
const complexInfinity = (v: unknown) =>
  typeof v === 'object' &&
  v !== null &&
  Math.abs((v as { re: number }).re) === Infinity &&
  Math.abs((v as { im: number }).im) === Infinity;

test('control: the comparator of values', () => {
  expect(close(1, 1 + 1e-14)).toBe(true);
  expect(close(1, 1.001)).toBe(false);
  expect(close(Infinity, 1e308)).toBe(false);
  expect(close(NaN, NaN)).toBe(true);
  expect(close({ re: 2, im: 0 }, 2)).toBe(true);
  expect(Object.is(0, -0)).toBe(false);
});

type Program = { name: string; json: MathJsonExpression; inputs: Inputs[] };

/** The bases: negative, `-0`, `0`, tiny, large, `±Infinity`, `NaN`. */
const BASES = [
  -Infinity,
  -1e300,
  -1e6,
  -8,
  -2.5,
  -1,
  -0.5,
  -1e-300,
  -0,
  0,
  1e-300,
  0.5,
  1,
  2.5,
  8,
  1e6,
  1e300,
  Infinity,
  NaN,
];
/** The bases of a trigonometric function: the interpreter does not reduce
 *  an argument of the size `1e300` exactly (`Cos(1e300)` is `-0.168` there,
 *  `-0.575` with `Math.cos` and at 400 digits). */
const TRIG_BASES = BASES.filter((v) => Math.abs(v) !== 1e300);
const INTEGERS = [-1e15, -7, -2, -1, 0, 1, 3, 1e15];
const over = (name: string, values: readonly Value[], extra: Inputs = {}) =>
  values.map((v) => ({ [name]: v, ...extra }));

/** The programs that the route admits, with the modes where it declines
 *  them (`DECLINED`). */
const PROGRAMS: Program[] = [
  // `_SYS.pow3` to `_SYS.pow5`: `x * x * x`, `s * s`, `s * s * x`.
  { name: 'x^3', json: ['Power', 'x', 3], inputs: over('x', BASES) },
  { name: 'x^4', json: ['Power', 'x', 4], inputs: over('x', BASES) },
  { name: 'x^5', json: ['Power', 'x', 5], inputs: over('x', BASES) },
  { name: 'k^3', json: ['Power', 'k', 3], inputs: over('k', INTEGERS) },
  { name: 'k^5', json: ['Power', 'k', 5], inputs: over('k', INTEGERS) },
  {
    name: '(x + 1)^3',
    json: ['Power', ['Add', 'x', 1], 3],
    inputs: over('x', BASES),
  },
  {
    name: '(x + 0.1)^4',
    json: ['Power', ['Add', 'x', 0.1], 4],
    inputs: over('x', BASES),
  },
  {
    name: 'Cos(x)^5',
    json: ['Power', ['Cos', 'x'], 5],
    inputs: over('x', TRIG_BASES),
  },
  {
    name: '(-x)^3',
    json: ['Power', ['Negate', 'x'], 3],
    inputs: over('x', BASES),
  },
  {
    name: 'offset^3 + x',
    json: ['Add', ['Power', 'offset', 3], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: 'Pi^3 + x',
    json: ['Add', ['Power', 'Pi', 3], 'x'],
    inputs: over('x', [0, 1]),
  },
  // `(1 / b / b)` for a name, `Math.pow(b, -2)` for another base.
  { name: 'x^-2', json: ['Power', 'x', -2], inputs: over('x', BASES) },
  { name: 'k^-2', json: ['Power', 'k', -2], inputs: over('k', INTEGERS) },
  {
    name: 'drop^-2 + x',
    json: ['Add', ['Power', 'drop', -2], 'x'],
    inputs: over('x', [0, 1]),
  },
  {
    name: '(x + 1)^-2',
    json: ['Power', ['Add', 'x', 1], -2],
    inputs: over('x', BASES),
  },
  // `Math.pow(b, e)`, an integer exponent.
  { name: 'x^-3', json: ['Power', 'x', -3], inputs: over('x', BASES) },
  { name: 'x^6', json: ['Power', 'x', 6], inputs: over('x', BASES) },
  { name: 'x^7', json: ['Power', 'x', 7], inputs: over('x', BASES) },
  { name: 'x^10', json: ['Power', 'x', 10], inputs: over('x', BASES) },
  { name: 'x^-12', json: ['Power', 'x', -12], inputs: over('x', BASES) },
  { name: 'x^170', json: ['Power', 'x', 170], inputs: over('x', BASES) },
  { name: 'k^7', json: ['Power', 'k', 7], inputs: over('k', INTEGERS) },
  {
    name: 'Sin(x)^-3',
    json: ['Power', ['Sin', 'x'], -3],
    inputs: over('x', TRIG_BASES),
  },
  { name: 'x^3.0', json: ['Power', 'x', 3.0], inputs: over('x', BASES) },
  // `Math.pow(b, e)`, a float exponent with an even recovered denominator
  // (`strict`), or a base that the engine proves non-negative (both modes).
  { name: 'x^1.1', json: ['Power', 'x', 1.1], inputs: over('x', BASES) },
  {
    name: '(-x)^1.1',
    json: ['Power', ['Negate', 'x'], 1.1],
    inputs: over('x', BASES),
  },
  { name: 'x^-0.95', json: ['Power', 'x', -0.95], inputs: over('x', BASES) },
  {
    name: '(x + 1)^-0.95',
    json: ['Power', ['Add', 'x', 1], -0.95],
    inputs: over('x', BASES),
  },
  { name: 'x^1.001', json: ['Power', 'x', 1.001], inputs: over('x', BASES) },
  { name: 'x^-0.9', json: ['Power', 'x', -0.9], inputs: over('x', BASES) },
  { name: 'x^-1.5', json: ['Power', 'x', -1.5], inputs: over('x', BASES) },
  { name: 'x^0.3', json: ['Power', 'x', 0.3], inputs: over('x', BASES) },
  { name: 'x^1.5', json: ['Power', 'x', 1.5], inputs: over('x', BASES) },
  {
    name: 'p^1.6',
    json: ['Power', 'p', 1.6],
    inputs: over(
      'p',
      BASES.filter((v) => !(v < 0))
    ),
  },
  {
    name: 'p^1.1',
    json: ['Power', 'p', 1.1],
    inputs: over(
      'p',
      BASES.filter((v) => !(v < 0))
    ),
  },
  {
    name: 'Abs(x)^1.4',
    json: ['Power', ['Abs', 'x'], 1.4],
    inputs: over('x', BASES),
  },
  {
    name: 'k^1.1',
    json: ['Power', 'k', 1.1],
    inputs: over('k', INTEGERS),
  },
  // `Math.pow(b, e)`, an exact exponent with an even denominator.
  {
    name: 'x^(5/2)',
    json: ['Power', 'x', ['Rational', 5, 2]],
    inputs: over('x', BASES),
  },
  {
    name: 'x^(-3/4)',
    json: ['Power', 'x', ['Rational', -3, 4]],
    inputs: over('x', BASES),
  },
  {
    name: 'x^(7/10)',
    json: ['Power', 'x', ['Rational', 7, 10]],
    inputs: over('x', BASES),
  },
  {
    name: '(x^2 + 1)^(-3/4)',
    json: ['Power', ['Add', ['Power', 'x', 2], 1], ['Rational', -3, 4]],
    inputs: over('x', BASES),
  },
  // The forms in an expression.
  {
    name: 'x^3 - 2x^-2 + x^1.1',
    json: [
      'Add',
      ['Power', 'x', 3],
      ['Multiply', -2, ['Power', 'x', -2]],
      ['Power', 'x', 1.1],
    ],
    inputs: over('x', BASES),
  },
  {
    name: '1 / (x^4 + 1)',
    json: ['Divide', 1, ['Add', ['Power', 'x', 4], 1]],
    inputs: over('x', BASES),
  },
  // `Root`: `Math.cbrt(x)`, `_SYS.root(x, n)`.
  { name: 'Root(x, 3)', json: ['Root', 'x', 3], inputs: over('x', BASES) },
  {
    name: 'Root(x + 1, 3)',
    json: ['Root', ['Add', 'x', 1], 3],
    inputs: over('x', BASES),
  },
  { name: 'Root(k, 3)', json: ['Root', 'k', 3], inputs: over('k', INTEGERS) },
  {
    name: 'Root(x, y)',
    json: ['Root', 'x', 'y'],
    inputs: [-8, -2.5, -0, 0, 0.5, 8, 1e300, Infinity, -Infinity].flatMap((x) =>
      over('y', [3, 2, 4, -3, 0.5, 2.2, 2.5, 1, -1, 7], { x })
    ),
  },
  {
    name: 'Root(x, k)',
    json: ['Root', 'x', 'k'],
    inputs: [-8, -0, 0, 0.5, 8].flatMap((x) =>
      over('k', [-3, -2, 1, 2, 3, 4, 5], { x })
    ),
  },
  // Two finite literals: the literal that the existing emitter folds them
  // to (compile-javascript-structured-literals-block.test.ts).
  {
    name: 'x + 2.5^3',
    json: ['Add', 'x', ['Power', 2.5, 3]],
    inputs: over('x', BASES),
  },
  {
    name: 'x + 10^-30',
    json: ['Add', 'x', ['Power', 10, -30]],
    inputs: over('x', BASES),
  },
  {
    name: 'x + Root(8, 3)',
    json: ['Add', 'x', ['Root', 8, 3]],
    inputs: over('x', BASES),
  },
  {
    name: 'Root(8, y)',
    json: ['Root', 8, 'y'],
    inputs: over('y', [3, 2, -3, 0.5, 1e-300, 1e300]),
  },
];

/** The programs that the route declines in a mode, with the reason. */
const DECLINED = new Map<string, RegExp>([
  // In the `complex` mode the handler writes `_SYS.cpow` for a base that is
  // not proved non-negative and an exponent that is not an integer.
  ...[
    'x^1.1',
    '(-x)^1.1',
    'x^-0.95',
    '(x + 1)^-0.95',
    'x^1.001',
    'x^-0.9',
    'x^-1.5',
    'x^0.3',
    'x^1.5',
    'k^1.1',
    'x^(5/2)',
    'x^(-3/4)',
    'x^(7/10)',
    'x^3 - 2x^-2 + x^1.1',
  ].map(
    (name) =>
      [
        `${name} (complex)`,
        /is in the structured route only for a base that it proves non-negative, and not for .* \(the complex mode\): the existing emitter writes the complex power/,
      ] as [string, RegExp]
  ),
  // `Root(x, n)` has the type `number`: in the `complex` mode the handler
  // writes `_SYS.cplx(_SYS.root(x, n))`.
  [
    'Root(x, y) (complex)',
    /the root .* has the type number, which is not real, in the complex mode/,
  ],
  [
    'Root(x, k) (complex)',
    /the root .* has the type number, which is not real, in the complex mode/,
  ],
]);

const inputsKey = (inputs: Inputs) =>
  Object.entries(inputs)
    .map(
      ([k, v]) =>
        `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`
    )
    .join(',');

/**
 * The inputs where the interpreter and compiled code give different values
 * that the caveats of compiled code admit, with the value of compiled code
 * (the structured route and the existing emitter give it).
 *
 * Each is a negative base with an exponent that is not an integer and has
 * an even recovered denominator, in the `strict` mode: the value is not
 * real, and compiled code gives `NaN` (the caveats of compiled code). Both
 * parts of the complex value underflow to 0 as doubles (`(-1e-300)^1.1` is
 * `-9.5e-331 - 3.1e-331i`), and the interpreter gives the real number of
 * its real part, `-0` or `0`, or `-Infinity` for the sum
 * `x^3 - 2x^-2 + x^1.1`.
 */
const CAVEATS: ReadonlyMap<string, unknown> = new Map<string, unknown>([
  ['x^1.1 (strict) x=-1e-300', NaN],
  ['(-x)^1.1 (strict) x=1e-300', NaN],
  ['x^-1.5 (strict) x=-1e+300', NaN],
  ['x^1.5 (strict) x=-1e-300', NaN],
  ['x^(5/2) (strict) x=-1e-300', NaN],
  ['x^3 - 2x^-2 + x^1.1 (strict) x=-1e-300', NaN],
]);

function checkProgram(program: Program, mode: Mode) {
  const ce = engine();
  const expr = ce.expr(program.json);
  const key = `${program.name} (${mode})`;
  const declined = DECLINED.get(key);
  if (declined !== undefined) {
    expect(() => structured().compile(expr, { ...OPTIONS, mode })).toThrow(
      declined
    );
    return;
  }
  const result = structured().compile(expr, { ...OPTIONS, mode });
  const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
  const disagreements: unknown[] = [];
  for (const inputs of program.inputs) {
    const value = result.run!(inputs as never);
    const other = existing.run!(inputs as never);
    // The same double as the existing compiler, `-0` and `NaN` included.
    expect([inputs, value, other, Object.is(value, other)]).toEqual([
      inputs,
      value,
      other,
      true,
    ]);
    const expected = interpret(ce, expr, inputs);
    const exception = CAVEATS.get(`${key} ${inputsKey(inputs)}`);
    const agrees =
      close(value, expected) ||
      (notANumber(value) && notANumber(expected)) ||
      (mode === 'strict' && Number.isNaN(value) && nonReal(expected)) ||
      (complexInfinity(expected) && Math.abs(value as number) === Infinity) ||
      (exception !== undefined && close(value, exception));
    if (!agrees) disagreements.push([inputsKey(inputs), value, expected]);
  }
  expect(disagreements).toEqual([]);
}

describe('Power with a number literal exponent and Root, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

describe('refusals', () => {
  const REFUSALS: [string, MathJsonExpression, Mode, RegExp][] = [
    // A complex base with an exponent that is not a number literal, and a
    // complex radicand: `_SYS.cpow`, `_SYS.croot`.
    [
      'z^k',
      ['Power', 'z', 'k'],
      'strict',
      /Power with a complex operand and an exponent that is not a number literal is not in the structured route/,
    ],
    [
      'Root(z, 3)',
      ['Root', 'z', 3],
      'strict',
      /Root with a complex operand is not in the structured route/,
    ],
    // `realRadicalPower()` reads through a square root under an integer
    // exponent of at least 2.
    [
      'Sqrt(p)^3',
      ['Power', ['Sqrt', 'p'], 3],
      'strict',
      /the power sqrt\(p\)\^3 of a square root is not in the structured route: the existing emitter reads through the square root/,
    ],
    [
      'Sqrt(x)^4',
      ['Power', ['Sqrt', 'x'], 4],
      'strict',
      /the power sqrt\(x\)\^4 of a square root/,
    ],
    // An integer beyond the safe integers.
    [
      'x^(2^60)',
      ['Power', 'x', 2 ** 60],
      'strict',
      /Power with the exponent 1152921504606847000, an integer beyond the safe integers/,
    ],
    // `realRadicalPower()`: `_SYS.pow5h(b)`, `_SYS.pow2(Math.cbrt(b))`.
    [
      'Max(0, x)^2.5',
      ['Power', ['Max', 0, 'x'], 2.5],
      'strict',
      /Power with the exponent 2\.5 of a base that is proved non-negative is not in the structured route/,
    ],
    [
      'p^(2/3 as a float)',
      ['Power', 'p', 2 / 3],
      'strict',
      /Power with the exponent 2\/3 is not in the structured route: the existing emitter writes the square of the cube root/,
    ],
    // `Math.sqrt`, `1 / Math.sqrt`, `Math.cbrt`.
    [
      'x^0.5',
      ['Power', 'x', 0.5],
      'strict',
      /Power with the exponent 0\.5 is not in the structured route: the existing emitter writes Math\.sqrt/,
    ],
    [
      'x^-0.5',
      ['Power', 'x', -0.5],
      'strict',
      /Power with the exponent -0\.5 is not in the structured route: the existing emitter writes the reciprocal of Math\.sqrt/,
    ],
    [
      'p^(1/3 as a float)',
      ['Power', 'p', 1 / 3],
      'strict',
      /Power with the exponent 0\.3333333333333333 is not in the structured route: the existing emitter writes Math\.cbrt/,
    ],
    // An exact exponent with an odd denominator: the real root of a
    // negative base (`realPowerExponent()`).
    [
      'x^(8/5)',
      ['Power', 'x', ['Rational', 8, 5]],
      'strict',
      /Power with the exact exponent 8\/5, whose denominator is odd, is not in the structured route/,
    ],
    // A power whose type is complex: `_SYS.cpow`.
    [
      'n^1.1',
      ['Power', 'n', 1.1],
      'strict',
      /the power n\^\(1\.1\) has the type complex, which is not real: the existing emitter writes the complex power/,
    ],
    // A non-finite exponent: `_SYS.pow(x, Infinity)`.
    [
      'x^Infinity',
      ['Power', 'x', 'PositiveInfinity'],
      'strict',
      /Power with the exponent \+?oo is not in the structured route, which has a finite real number literal exponent/,
    ],
    // `Root`.
    [
      'Root(x, 5)',
      ['Root', 'x', 5],
      'strict',
      /Root with the degree 5 is not in the structured route, which has the degree 3 and a degree that is not a number literal/,
    ],
    [
      'Root(x, 4)',
      ['Root', 'x', 4],
      'strict',
      /Root with the degree 4 is not in the structured route/,
    ],
    [
      'Root(z, 3)',
      ['Root', 'z', 3],
      'strict',
      /Root with a complex operand is not in the structured route: the existing emitter writes _SYS\.croot/,
    ],
    [
      'Root(x, offset)',
      ['Root', 'x', 'offset'],
      'strict',
      /the degree "?offset"? of Root has no unknown/,
    ],
  ];
  test.each(REFUSALS)('%s', (_name, json, mode, message) => {
    const ce = engine();
    expect(() =>
      structured().compile(ce.expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });
});

/** Every operation of `region` and of the regions in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...regionsOf(op).flatMap((inner) => allOperations(inner)),
  ]);
}

describe('the representation', () => {
  const operationsOf = (json: MathJsonExpression) => {
    const ce = engine();
    const program = lowerStructuredFragment(
      structured().prepareStructured(ce.expr(json), {
        ...OPTIONS,
        mode: 'strict',
      })
    );
    return allOperations(program.root).map((op) =>
      op.kind === 'unary' || op.kind === 'binary'
        ? `${op.kind} ${op.fn}`
        : op.kind
    );
  };

  test('a constant exponent: the function real-pow; Root: the functions cbrt and root', () => {
    expect(operationsOf(['Power', 'x', -3])).toEqual([
      'input',
      'literal',
      'binary real-pow',
      'yield',
    ]);
    expect(operationsOf(['Root', 'x', 3])).toEqual([
      'input',
      'unary cbrt',
      'yield',
    ]);
    expect(operationsOf(['Root', 'x', 'y'])).toEqual([
      'input',
      'input',
      'binary root',
      'yield',
    ]);
  });

  test('the exponents 3 to 5 are products of the base, and -2 two divisions', () => {
    expect(operationsOf(['Power', 'x', 3])).toEqual([
      'input',
      'multiply',
      'multiply',
      'yield',
    ]);
    expect(operationsOf(['Power', 'x', 4])).toEqual([
      'input',
      'multiply',
      'multiply',
      'yield',
    ]);
    expect(operationsOf(['Power', 'x', 5])).toEqual([
      'input',
      'multiply',
      'multiply',
      'multiply',
      'yield',
    ]);
    expect(operationsOf(['Power', 'x', -2])).toEqual([
      'input',
      'literal',
      'divide',
      'divide',
      'yield',
    ]);
  });

  test('the base is evaluated once', () => {
    const ce = engine();
    for (const json of [
      ['Power', ['Add', 'x', 1], 3],
      ['Power', ['Add', 'x', 1], 4],
      ['Power', ['Add', 'x', 1], 5],
      ['Power', ['Sin', 'x'], -2],
      ['Power', ['Add', 'x', 1], -3],
      ['Root', ['Add', 'x', 1], 3],
    ] as MathJsonExpression[]) {
      const code = structured().compile(ce.expr(json), OPTIONS).code;
      expect([json, code.match(/_\.x/g)?.length]).toEqual([json, 1]);
    }
  });
});
