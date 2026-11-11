import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// Complex arithmetic on the structured route of the internal JavaScript
// fragment target (docs/plans/2026-11-10-structured-complex-arithmetic.md):
// products and quotients with a complex operand, functions of a complex
// operand, and powers of a complex base.
//
// Each program is compiled on the structured route and compared with the
// ordinary JavaScript compiler with `cse: false, constantFold: false`, the
// same doubles (`Object.is` on both parts), on every input of its domain,
// and with the interpreter, within 1e-12 relative or by the caveats of
// compiled code (docs/COMPILATION-MODEL.md, "Caveats of compiled code"), on
// the inputs that the interpreter holds as they are given. The interpreter
// does not hold a complex number with an infinite or a `NaN` part
// (`Complex(Infinity, 1)` is boxed as `+∞`, `Complex(1, Infinity)` as
// `ComplexInfinity`) or with a `-0` part, and it reads `5e-324` as the
// decimal, not as the double 4.94e-324.
//
// A name that the engine does not declare (`t`, `u`, `a`, `b`) has no
// declared type: the structured route reads it as a real number in the
// `strict` mode and as a complex number in the `complex` mode, where the
// host can give it as a number or as `{re, im}`.

const OPTIONS = { cse: false, constantFold: false } as const;
type Mode = 'strict' | 'complex';

/** An engine with the inputs of the programs. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of [
    ['x', 'real'],
    ['y', 'real'],
    ['z', 'complex'],
    ['w', 'complex'],
    ['k', 'integer'],
  ])
    ce.declare(name, type);
  return ce;
}

const structured = () =>
  new ScalarFragmentJavaScriptTarget('structured', new Map(), {});

type Complex = { re: number; im: number };
type Value = number | Complex;
type Inputs = Record<string, Value>;

/** The real inputs of the design note. */
const REALS = [0, -0, 1, -2.5, Infinity, -Infinity, NaN, 1e300, -1e-300, 5e-324];
/** The complex inputs with parts from `REALS`, the purely real `{x, 0}` and
 *  the purely imaginary `{0, y}` among them. */
const COMPLEXES: Complex[] = REALS.flatMap((re) =>
  REALS.map((im) => ({ re, im }))
);
/** The complex inputs of a program with two complex inputs or more. */
const FEW = [0, -0, 1, -2.5, Infinity, -Infinity, NaN, 1e-300];
const FEW_COMPLEXES: Complex[] = FEW.flatMap((re) =>
  FEW.map((im) => ({ re, im }))
);
const INTEGERS = [0, 1, -3, 7];

const DECLARED_REAL = new Set(['x', 'y']);
const DECLARED_COMPLEX = new Set(['z', 'w']);

/** The values of the input `name` in the mode `mode`, for a program of
 *  `complexInputs` complex inputs. */
function domain(name: string, mode: Mode, complexInputs: number): Value[] {
  const complexes = complexInputs > 1 ? FEW_COMPLEXES : COMPLEXES;
  if (name === 'k') return INTEGERS;
  if (DECLARED_REAL.has(name)) return REALS;
  if (DECLARED_COMPLEX.has(name)) return complexes;
  // A name with no declared type: real in the `strict` mode, and in the
  // `complex` mode a number or `{re, im}`.
  return mode === 'strict' ? REALS : [...REALS, ...complexes];
}

const isComplexInput = (name: string, mode: Mode) =>
  DECLARED_COMPLEX.has(name) ||
  (mode === 'complex' && !DECLARED_REAL.has(name) && name !== 'k');

/** Every assignment of the domains of `names`. */
function grid(names: readonly string[], mode: Mode): Inputs[] {
  const complexInputs = names.filter((n) => isComplexInput(n, mode)).length;
  let result: Inputs[] = [{}];
  for (const name of names)
    result = result.flatMap((inputs) =>
      domain(name, mode, complexInputs).map((v) => ({ ...inputs, [name]: v }))
    );
  return result;
}

/** Whether the interpreter holds the value `v` as it is given. */
const interpreterHolds = (v: Value): boolean =>
  typeof v === 'number'
    ? !Object.is(v, 5e-324)
    : [v.re, v.im].every(
        (p) => Number.isFinite(p) && !Object.is(p, -0) && !Object.is(p, 5e-324)
      );

function boxValue(ce: ComputeEngine, v: Value): Expression {
  if (typeof v === 'number') return ce.number(v);
  return ce.expr(['Complex', v.re, v.im]);
}

/** The value of `expr` on `inputs` by the interpreter. */
function interpret(ce: ComputeEngine, expr: Expression, inputs: Inputs): Value {
  const value = expr
    .subs(
      Object.fromEntries(
        Object.entries(inputs).map(([k, v]) => [k, boxValue(ce, v)])
      )
    )
    .evaluate()
    .N();
  if (value.im === 0) return value.re;
  return { re: value.re, im: value.im };
}

const pair = (v: unknown): Complex =>
  typeof v === 'number' ? { re: v, im: 0 } : (v as Complex);

/** The same value within 1e-12 relative; a complex value with an imaginary
 *  part of 0 equals the number of its real part. */
function close(a: unknown, b: unknown): boolean {
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

/** The same value, exactly: the same kind, and `Object.is` per part. */
function exact(a: unknown, b: unknown): boolean {
  if (typeof a !== typeof b) return false;
  const p = pair(a);
  const q = pair(b);
  return Object.is(p.re, q.re) && Object.is(p.im, q.im);
}

const notANumber = (v: unknown) =>
  Number.isNaN(pair(v).re) || Number.isNaN(pair(v).im);
const infinite = (v: unknown) =>
  Math.abs(pair(v).re) === Infinity || Math.abs(pair(v).im) === Infinity;

test('control: the comparators', () => {
  expect(exact(0, -0)).toBe(false);
  expect(exact(NaN, NaN)).toBe(true);
  expect(exact({ re: 1, im: -0 }, { re: 1, im: 0 })).toBe(false);
  expect(exact(1, { re: 1, im: 0 })).toBe(false);
  expect(close(1, 1 + 1e-14)).toBe(true);
  expect(close({ re: 2, im: 0 }, 2)).toBe(true);
  expect(close({ re: 0, im: 2 }, 0)).toBe(false);
  expect(interpreterHolds({ re: Infinity, im: 1 })).toBe(false);
  expect(interpreterHolds({ re: 1, im: -0 })).toBe(false);
  expect(interpreterHolds(-0)).toBe(true);
});

/**
 * Whether the value `value` of compiled code agrees with the value
 * `expected` of the interpreter on `inputs`: the same value within 1e-12
 * relative; not a number on both; the pole of the interpreter
 * (`ComplexInfinity`, two infinite parts), which compiled code gives with
 * an infinite or a `NaN` part. `known` lists the differences of the
 * existing compiler that the structured route keeps (`KNOWN`).
 */
function agrees(value: Value, expected: Value, known: boolean): boolean {
  if (close(value, expected)) return true;
  if (notANumber(value) && notANumber(expected)) return true;
  const e = pair(expected);
  if (
    Math.abs(e.re) === Infinity &&
    Math.abs(e.im) === Infinity &&
    (infinite(value) || notANumber(value))
  )
    return true;
  return known;
}

type Program = {
  readonly name: string;
  readonly json: MathJsonExpression;
  /** The inputs, in the order of the grid. */
  readonly names: readonly string[];
  /** Inputs of their own, added to the grid. */
  readonly inputs?: readonly Inputs[];
  /** The differences of `KNOWN` that the program can have, when they are
   *  not listed in `KNOWN_OF`. */
  readonly known?: readonly string[];
  /** The modes; both when absent. */
  readonly modes?: readonly Mode[];
};

/**
 * The differences between the existing compiler and the interpreter, on
 * inputs that the interpreter holds, which the structured route keeps (it
 * gives the doubles of the existing compiler). Each is a predicate of the
 * inputs, the value of compiled code and the value of the interpreter.
 *
 * - `overflow`: an infinite input, or a part of an input of at least 1e300,
 *   and compiled code has an infinite or a `NaN` part. An infinite real
 *   factor of a part that is zero gives `NaN`: the product `x·z` is
 *   `{ re: x * z.re, im: x * z.im }`, so `∞·(1 + 0i)` is `∞ + NaN·i`, where
 *   the interpreter gives `∞`; and a product of doubles overflows where the
 *   interpreter has more range (`1e300·1e300·(0 - 2.5i)` is `NaN - ∞i`, the
 *   interpreter `-∞i`; `1e300·(1e300i)·0` is `0 + NaN·i`, the interpreter
 *   `0`). A sum `x + i·y` with an infinite `x` keeps the imaginary part,
 *   where the interpreter, which has no complex number with an infinite
 *   part, gives `∞`.
 * - `underflow`: a part of an input that is not zero and at most 1e-300 in
 *   magnitude: a product of parts underflows to 0 where the interpreter has
 *   more range (`-1/(t·ln t)` at `t = 1 - 1e-300i` has the real part `-0`,
 *   the interpreter `1`).
 * - `large`: a part of an input of at least 1e300 in magnitude, finite.
 *   The precision of the target: `1e300 + 1` is `1e300`, where the
 *   interpreter computes `sin(1e300 + 1)` at the exact value; a function of
 *   such an argument loses its digits (the argument reduction of `sin`) or
 *   overflows (`cosh(1e300)` is `∞`, and `sinh(z)/cosh(z)` then `NaN`).
 * - `infinite-log`: an infinite real input, where compiled code is `NaN`
 *   and the interpreter gives `0`: `-1/(t·ln t)`, `1/(t·ln(t)^2)` and
 *   `sin(ln t)/t` at `t = ±∞`. The lifted `{±∞, 0}` gives a `NaN` part
 *   (`∞·0`), so the quotient is `NaN`. A difference of the existing
 *   compiler that the caveats of compiled code do not list (a `NaN` for a
 *   value that is a number).
 * - `infinite-base`: `Ln(t)^1.6` at `t = 0`: `ln 0` is `-∞`, and
 *   `_SYS.cpow` of the infinite base `{-∞, 0}` is `NaN`, where the
 *   interpreter gives `∞`. A difference of the existing compiler, as
 *   `infinite-log`.
 * - `strict-nan`: in the `strict` mode a real function of a value that is
 *   not real is `NaN` (`ln t` of a negative `t`), where the interpreter
 *   gives the complex value: `i/(t·(-ln t)^1.1)` at `t = -2.5`.
 */
const KNOWN: Readonly<
  Record<string, (inputs: Inputs, value: Value, expected: Value) => boolean>
> = {
  overflow: (inputs, value) =>
    Object.values(inputs).some(
      (v) => infinite(v) || Math.max(Math.abs(pair(v).re), Math.abs(pair(v).im)) >= 1e300
    ) &&
    (infinite(value) || notANumber(value)),
  underflow: (inputs) =>
    Object.values(inputs).some((v) =>
      [pair(v).re, pair(v).im].some((p) => p !== 0 && Math.abs(p) <= 1e-300)
    ),
  large: (inputs) =>
    Object.values(inputs).some((v) =>
      [pair(v).re, pair(v).im].some(
        (p) => Number.isFinite(p) && Math.abs(p) >= 1e300
      )
    ),
  'infinite-base': (_inputs, value, expected) =>
    notANumber(value) && infinite(expected),
  'strict-nan': (_inputs, value, expected) =>
    notANumber(value) && pair(expected).im !== 0,
  'infinite-log': (inputs, value, expected) =>
    Object.values(inputs).some((v) => typeof v === 'number' && !Number.isFinite(v)) &&
    notANumber(value) &&
    expected === 0,
};

/** The programs and the differences of `KNOWN` that each can have. */
const KNOWN_OF: ReadonlyMap<string, readonly string[]> = new Map([
  ['x·z', ['overflow']],
  ['w·x', ['overflow']],
  ['x·y·z', ['overflow']],
  ['w·x·z', ['overflow']],
  ['w·x·y', ['overflow']],
  ['x·y·z·w', ['overflow']],
  ['1/3·x·z', ['overflow']],
  ['x + i·y', ['overflow']],
  ['a + i·b', ['overflow']],
  ['t·u/3', ['overflow']],
  ['-1/(t·ln t)', ['infinite-log', 'underflow']],
  ['1/(t·ln(t)^2)', ['infinite-log', 'underflow']],
]);

/** The interpreter comparisons of a program, at most this many. */
const INTERPRETED = 400;

function checkProgram(program: Program, mode: Mode) {
  const ce = engine();
  const expr = ce.expr(program.json);
  const result = structured().compile(expr, { ...OPTIONS, mode });
  const existing = compile(expr, { ...OPTIONS, mode, fallback: false });
  const inputs = [
    ...(program.names.length > 0 ? grid(program.names, mode) : []),
    ...(program.inputs ?? []),
  ];
  const known = program.known ?? KNOWN_OF.get(program.name) ?? [];
  const differences: unknown[] = [];
  const disagreements: unknown[] = [];
  const holds = inputs.filter((i) => Object.values(i).every(interpreterHolds));
  const step = Math.max(1, Math.ceil(holds.length / INTERPRETED));
  const interpreted = new Set(holds.filter((_, i) => i % step === 0));
  for (const input of inputs) {
    const value = result.run!(input as never) as Value;
    const other = existing.run!(input as never) as Value;
    if (!exact(value, other)) differences.push({ input, value, other });
    if (!interpreted.has(input)) continue;
    const expected = interpret(ce, expr, input);
    const isKnown = known.some((k) => KNOWN[k](input, value, expected));
    if (!agrees(value, expected, isKnown))
      disagreements.push({ input, value, expected });
  }
  expect(differences.slice(0, 5)).toEqual([]);
  expect(disagreements.slice(0, 5)).toEqual([]);
}

/** The code of `program` on the structured route. */
function codeOf(json: MathJsonExpression, mode: Mode = 'strict'): string {
  return structured().compile(engine().expr(json), { ...OPTIONS, mode }).code;
}

//
// Slice 1: products and quotients
//

const PRODUCTS: Program[] = [
  // A complex literal and a real operand: the parts of the literal.
  { name: 'i·x', json: ['Multiply', ['Complex', 0, 1], 'x'], names: ['x'] },
  { name: '-i·x', json: ['Multiply', ['Complex', 0, -1], 'x'], names: ['x'] },
  { name: '(1+2i)·x', json: ['Multiply', ['Complex', 1, 2], 'x'], names: ['x'] },
  {
    name: '(-2.5-i)·x',
    json: ['Multiply', ['Complex', -2.5, -1], 'x'],
    names: ['x'],
  },
  { name: 'i·k', json: ['Multiply', ['Complex', 0, 1], 'k'], names: ['k'] },
  // A real and a complex operand, in both orders: the canonical form puts
  // `w` before `x`.
  { name: 'x·z', json: ['Multiply', 'x', 'z'], names: ['x', 'z'] },
  { name: 'w·x', json: ['Multiply', 'w', 'x'], names: ['w', 'x'] },
  { name: 'z·w', json: ['Multiply', 'z', 'w'], names: ['z', 'w'] },
  // A complex literal and a complex operand: the parts of the literal are
  // its constants.
  {
    name: '(1+2i)·z',
    json: ['Multiply', ['Complex', 1, 2], 'z'],
    names: ['z'],
  },
  // Three operands or more: real first, complex first, a complex literal.
  { name: 'x·y·z', json: ['Multiply', 'x', 'y', 'z'], names: ['x', 'y', 'z'] },
  { name: 'w·x·z', json: ['Multiply', 'w', 'x', 'z'], names: ['w', 'x', 'z'] },
  { name: 'w·x·y', json: ['Multiply', 'w', 'x', 'y'], names: ['w', 'x', 'y'] },
  {
    name: '2i·x·y',
    json: ['Multiply', ['Complex', 0, 2], 'x', 'y'],
    names: ['x', 'y'],
  },
  {
    name: 'x·y·z·w',
    json: ['Multiply', 'x', 'y', 'z', 'w'],
    names: ['x', 'y', 'z', 'w'],
    modes: ['strict'],
  },
  // A rational factor is its double.
  { name: '1/3·z', json: ['Multiply', ['Rational', 1, 3], 'z'], names: ['z'] },
  { name: '-1/2·z', json: ['Multiply', ['Rational', -1, 2], 'z'], names: ['z'] },
  {
    name: '1/3·x·z',
    json: ['Multiply', ['Rational', 1, 3], 'x', 'z'],
    names: ['x', 'z'],
  },
  { name: 'NaN·z', json: ['Multiply', NaN, 'z'], names: ['z'] },
  // A sum of a real and an imaginary part.
  {
    name: 'x + i·y',
    json: ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']],
    names: ['x', 'y'],
  },
  // The names of the engine's own compilations: in the `strict` mode the
  // stochastic equality of the Fungrim sums passes `w1 + i·w2`.
  {
    name: 'a + i·b',
    json: ['Add', 'a', ['Multiply', ['Complex', 0, 1], 'b']],
    names: ['a', 'b'],
    modes: ['strict'],
  },
  {
    name: '-t/2',
    json: ['Multiply', ['Rational', -1, 2], 't'],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 't·u/3',
    json: ['Multiply', ['Rational', 1, 3], 't', 'u'],
    names: ['t', 'u'],
    modes: ['complex'],
  },
  { name: 'NaN·t', json: ['Multiply', NaN, 't'], names: ['t'], modes: ['complex'] },
];

/** The inputs of a complex quotient for both branches of its guard: a zero
 *  divisor, an infinite part, a divisor whose modulus underflows, a
 *  numerator that overflows, a product of parts that underflows to a
 *  subnormal number, and ordinary values. */
const QUOTIENT_DIVISORS: Complex[] = [
  { re: 0, im: 0 },
  { re: -0, im: 0 },
  { re: 0, im: -0 },
  { re: Infinity, im: 1 },
  { re: 1, im: -Infinity },
  { re: 1e-160, im: 1e-160 },
  { re: 1e-160, im: -1e-160 },
  { re: 1, im: 1 },
  { re: 2, im: -3 },
  { re: 1e300, im: 1e300 },
];
const QUOTIENT_DIVIDENDS: Complex[] = [
  { re: 1e308, im: 1e308 },
  { re: 1e-160, im: 1 },
  { re: 1, im: 2 },
  { re: 0, im: 0 },
  { re: -2.5, im: 1e-300 },
];

const QUOTIENTS: Program[] = [
  { name: 'z/x', json: ['Divide', 'z', 'x'], names: ['z', 'x'] },
  { name: 'x/z', json: ['Divide', 'x', 'z'], names: ['x', 'z'] },
  {
    name: 'z/w',
    json: ['Divide', 'z', 'w'],
    names: ['z', 'w'],
    inputs: QUOTIENT_DIVIDENDS.flatMap((z) =>
      QUOTIENT_DIVISORS.map((w) => ({ z, w }))
    ),
  },
  {
    name: 'x/w',
    json: ['Divide', 'x', 'w'],
    names: [],
    inputs: [1, -2.5, 1e308, 1e-160, 0, NaN].flatMap((x) =>
      QUOTIENT_DIVISORS.map((w) => ({ x, w }))
    ),
  },
  { name: 'i/x', json: ['Divide', ['Complex', 0, 1], 'x'], names: ['x'] },
  {
    name: '(1+2i)/z',
    json: ['Divide', ['Complex', 1, 2], 'z'],
    names: ['z'],
    inputs: QUOTIENT_DIVISORS.map((z) => ({ z })),
  },
  {
    name: '(1+i)/Sin(x)',
    json: ['Divide', ['Complex', 1, 1], ['Sin', 'x']],
    names: ['x'],
    known: ['large'],
  },
  {
    name: '(x + 1)/z',
    json: ['Divide', ['Add', 'x', 1], 'z'],
    names: ['x', 'z'],
  },
  // The integrands of the complex retry of the engine (`complex` mode).
  {
    name: '-1/(t·ln t)',
    json: ['Divide', -1, ['Multiply', 't', ['Ln', 't']]],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: '1/(t·ln(t)^2)',
    json: ['Divide', 1, ['Multiply', 't', ['Power', ['Ln', 't'], 2]]],
    names: ['t'],
    modes: ['complex'],
  },
];

describe('slice 1: products and quotients, differential', () => {
  for (const program of [...PRODUCTS, ...QUOTIENTS])
    for (const mode of program.modes ?? (['strict', 'complex'] as const))
      test(`${program.name} (${mode})`, () => checkProgram(program, mode));
});

describe('slice 1: the code', () => {
  test('a complex literal scales the real operand: a part 0 is 0, a part 1 the operand', () => {
    expect(codeOf(['Multiply', ['Complex', 0, 1], 'x'])).toBe(
      '({ re: 0, im: _.x })'
    );
    expect(codeOf(['Multiply', ['Complex', 1, 2], 'x'])).toBe(
      '(() => { const _tv1 = _.x; return ({ re: _tv1, im: 2 * _tv1 }); })()'
    );
  });

  test('a complex literal operand of a product or a quotient is written as its parts, not as an object', () => {
    for (const json of [
      ['Divide', ['Complex', 1, 2], 'z'],
      ['Multiply', ['Complex', 1, 2], 'z'],
      ['Multiply', ['Complex', 0, 2], 'x', 'y'],
      ['Divide', ['Complex', 1, 1], ['Sin', 'x']],
    ] as MathJsonExpression[])
      expect(codeOf(json)).not.toMatch(/\(\{ re: -?\d+, im: -?\d+ \}\)/);
    expect(codeOf(['Multiply', ['Complex', 1, 2], 'z'])).toBe(
      '(() => { const _tv1 = _.z; return ({ re: 1 * _tv1.re - 2 * _tv1.im, im: 1 * _tv1.im + 2 * _tv1.re }); })()'
    );
  });

  test('a real operand of a mixed product is not converted', () => {
    expect(codeOf(['Multiply', 'x', 'z'])).toBe(
      '(() => { const _tv1 = _.x; const _tv2 = _.z; return ({ re: _tv1 * _tv2.re, im: _tv1 * _tv2.im }); })()'
    );
  });

  test('x + i·y is the sum of a real operand and the parts of a complex value', () => {
    expect(
      codeOf(['Add', 'x', ['Multiply', ['Complex', 0, 1], 'y']])
    ).toBe(
      '(() => { const _tv1 = ({ re: 0, im: _.y }); return ({ re: _.x + _tv1.re, im: _tv1.im }); })()'
    );
  });

  test('a complex quotient is the guarded text of the existing emitter', () => {
    const code = codeOf(['Divide', 'x', 'z']);
    expect(code).toContain('_SYS.cdivedge(_tv1, 0, _tv2.re, _tv2.im)');
    expect(code).toContain('const _tv5 = -_tv1 * _tv2.im;');
  });

  test('both branches of the guard of a quotient', () => {
    // The textbook formula, which the guard keeps for an ordinary divisor
    // and replaces where it is not accurate.
    const textbook = (a: Complex, b: Complex): Complex => {
      const d = b.re * b.re + b.im * b.im;
      return {
        re: (a.re * b.re + a.im * b.im) / d,
        im: (a.im * b.re - a.re * b.im) / d,
      };
    };
    const run = structured().compile(engine().expr(['Divide', 'z', 'w']), {
      ...OPTIONS,
      mode: 'strict',
    }).run!;
    const at = (z: Complex, w: Complex) => run({ z, w } as never) as Complex;
    const one = { re: 1, im: 2 };
    expect(exact(at(one, { re: 2, im: -3 }), textbook(one, { re: 2, im: -3 }))).toBe(true);
    // A zero divisor: the pole, where the formula gives `NaN`.
    expect(infinite(at(one, { re: 0, im: 0 }))).toBe(true);
    expect(notANumber(textbook(one, { re: 0, im: 0 }))).toBe(true);
    // A divisor whose squared modulus underflows: the scaled quotient.
    const small = at(one, { re: 1e-160, im: 1e-160 });
    expect(close(small, { re: 1.5e160, im: 0.5e160 })).toBe(true);
    expect(close(textbook(one, { re: 1e-160, im: 1e-160 }), small)).toBe(false);
    // A numerator that overflows: `(1e308 + 1e308i) / (1 + i)` is `1e308`.
    expect(close(at({ re: 1e308, im: 1e308 }, { re: 1, im: 1 }), 1e308)).toBe(true);
  });
});

//
// Slice 2: functions of a complex operand
//

/** The heads whose handler writes the helper of any complex operand, and
 *  those (`Sinh`, `Cosh`, `Tanh`) of a complex operand that does not read
 *  `Pi`: each of a complex operand that is not a name. */
const FUNCTION_HEADS = [
  'Sin',
  'Cos',
  'Tan',
  'Cot',
  'Sec',
  'Csc',
  'Arctan',
  'Arsinh',
  'Arcsin',
  'Arccos',
  'Sign',
  'Gamma',
  'Ln',
  'Sinh',
  'Cosh',
  'Tanh',
  'Conjugate',
];

const FUNCTIONS: Program[] = [
  ...FUNCTION_HEADS.map(
    (head): Program => ({
      name: `${head}(z + 1)`,
      json: [head, ['Add', 'z', 1]],
      names: ['z'],
    })
  ),
  { name: 'Sin(x·z)', json: ['Sin', ['Multiply', 'x', 'z']], names: ['x', 'z'] },
  { name: 'Cos(Ln(z))', json: ['Cos', ['Ln', 'z']], names: ['z'] },
  {
    name: 'Conjugate(x·z)',
    json: ['Conjugate', ['Multiply', 'x', 'z']],
    names: ['x', 'z'],
  },
  {
    name: 'Conjugate(t)',
    json: ['Conjugate', 't'],
    names: ['t'],
    modes: ['complex'],
  },
  // The exponential of a complex exponent that does not read `Pi`.
  {
    name: 'e^(i·x)',
    json: ['Exp', ['Multiply', ['Complex', 0, 1], 'x']],
    names: ['x'],
  },
  {
    name: 'y·e^(i·x)',
    json: ['Multiply', 'y', ['Exp', ['Multiply', ['Complex', 0, 1], 'x']]],
    names: ['x', 'y'],
  },
  {
    name: 'e^(i·x^2)',
    json: ['Exp', ['Multiply', ['Complex', 0, 1], ['Power', 'x', 2]]],
    names: ['x'],
  },
  { name: 'e^(z + 1)', json: ['Exp', ['Add', 'z', 1]], names: ['z'] },
  // The forms of the stochastic equality of the engine (`a: real` there).
  {
    name: '-x + Cos(Arccos(x))',
    json: ['Add', ['Negate', 'x'], ['Cos', ['Arccos', 'x']]],
    names: ['x'],
  },
  {
    name: '-x + Cos(-Arccos(x))',
    json: ['Add', ['Negate', 'x'], ['Cos', ['Negate', ['Arccos', 'x']]]],
    names: ['x'],
  },
  {
    name: 'x + Sin(Arcsin(x) + Pi)',
    json: ['Add', 'x', ['Sin', ['Add', ['Arcsin', 'x'], 'Pi']]],
    names: ['x'],
  },
  {
    name: '-x + Tan(Arctan(x))',
    json: ['Add', ['Negate', 'x'], ['Tan', ['Arctan', 'x']]],
    names: ['x'],
  },
  // The integrands of the complex retry of the engine (`complex` mode).
  {
    name: 'Sin(t)/t',
    json: ['Divide', ['Sin', 't'], 't'],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 'Sin(Ln(t))/t',
    json: ['Divide', ['Sin', ['Ln', 't']], 't'],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 'Sin(t)·Cos(3t)/t',
    json: [
      'Divide',
      ['Multiply', ['Sin', 't'], ['Cos', ['Multiply', 3, 't']]],
      't',
    ],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 'Sinh(t)/Cosh(t)^2',
    json: ['Divide', ['Sinh', 't'], ['Power', ['Cosh', 't'], 2]],
    names: ['t'],
    modes: ['complex'],
  },
];

/** The differences of `KNOWN` of the functions: a large or an infinite
 *  input, and `Sin(Ln(t))/t` at `t = ±∞`. */
const FUNCTION_KNOWN = ['large', 'overflow', 'infinite-log'];

describe('slice 2: functions of a complex operand, differential', () => {
  for (const program of FUNCTIONS.map((p) => ({ ...p, known: FUNCTION_KNOWN })))
    for (const mode of program.modes ?? (['strict', 'complex'] as const))
      test(`${program.name} (${mode})`, () => checkProgram(program, mode));
});

describe('slice 2: the code', () => {
  test('the complex mode writes the helper with no wrapper', () => {
    expect(codeOf(['Sin', 't'], 'complex')).toBe('_SYS.csin(_SYS.cplx(_.t))');
  });

  test('Conjugate of a complex operand is _SYS.cconj', () => {
    expect(codeOf(['Conjugate', 'z'])).toBe('_SYS.cconj(_.z)');
  });
});

describe('slice 2: what stays declined', () => {
  const declined: [string, MathJsonExpression, Mode, RegExp][] = [
    [
      'Sinh of i·π·x',
      ['Sinh', ['Multiply', ['Complex', 0, 1], 'Pi', 'x']],
      'strict',
      /Sinh of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    [
      'Tanh of i·π·x',
      ['Tanh', ['Multiply', ['Complex', 0, 1], 'Pi', 'x']],
      'strict',
      /Tanh of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    [
      'the exponential of x + i·π·y',
      ['Exp', ['Add', 'x', ['Multiply', ['Complex', 0, 1], 'Pi', 'y']]],
      'strict',
      /the exponential of the complex operand .*, which reads Pi, is not in the structured route/,
    ],
    [
      'Abs of x + i',
      ['Abs', ['Add', 'x', ['Complex', 0, 1]]],
      'strict',
      /Abs of the complex operand .* is in the structured route only when the operand is a name/,
    ],
    [
      'Arcosh of z + 1',
      ['Arcosh', ['Add', 'z', 1]],
      'strict',
      /Arcosh of the complex operand .* is in the structured route only when the operand is a name/,
    ],
    [
      'Erf of a complex operand',
      ['Erf', 'z'],
      'strict',
      /Erf with a complex operand is not in the structured route/,
    ],
    [
      'Cot(x) + 1 in the complex mode: a real call that the compiler wraps',
      ['Add', ['Cot', 'x'], 1],
      'complex',
      /cot\(x\) has the type number, which is not real, in the complex mode/,
    ],
  ];
  test.each(declined)('%s', (_name, json, mode, message) => {
    expect(() =>
      structured().compile(engine().expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });
});

//
// Slice 3: powers of a complex base
//

/** `-ln(t)`, the base of the integrands of the complex retry. */
const minusLn = (t: MathJsonExpression): MathJsonExpression => [
  'Negate',
  ['Ln', t],
];

const POWERS: Program[] = [
  // The chain of products for the exponents 2 to 8, `_SYS.cpow` for the
  // others. The grid of `z` holds the zero base `{0, 0}`.
  ...[2, 3, 4, 5, 6, 7, 8, 20, -2, 1.1, 0.5].map(
    (k): Program => ({
      name: `z^${k}`,
      json: ['Power', 'z', k],
      names: ['z'],
    })
  ),
  { name: 'z^(5/2)', json: ['Power', 'z', ['Rational', 5, 2]], names: ['z'] },
  {
    name: '(z + 1)^3',
    json: ['Power', ['Add', 'z', 1], 3],
    names: ['z'],
  },
  {
    name: '(x·z)^1.5',
    json: ['Power', ['Multiply', 'x', 'z'], 1.5],
    names: ['x', 'z'],
  },
  // `Ln(t)` is complex in the `complex` mode.
  {
    name: 'Ln(t)^1.6',
    json: ['Power', ['Ln', 't'], 1.6],
    names: ['t'],
    modes: ['complex'],
    known: [...FUNCTION_KNOWN, 'infinite-base'],
  },
  // The integrands of the complex retry of the engine (`complex` mode), and
  // `i / (t·(-ln t)^1.1)` in the `strict` mode.
  ...[1.1, 1.001, 1.05, 1.2].map(
    (e): Program => ({
      name: `1/(t·(-ln t)^${e})`,
      json: ['Divide', 1, ['Multiply', 't', ['Power', minusLn('t'), e]]],
      names: ['t'],
      modes: ['complex'],
    })
  ),
  {
    name: '1/((1 - t)·(-ln(1 - t))^1.1)',
    json: [
      'Divide',
      1,
      [
        'Multiply',
        ['Subtract', 1, 't'],
        ['Power', minusLn(['Subtract', 1, 't']), 1.1],
      ],
    ],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: '1/(t·(-ln t)^3)',
    json: ['Divide', 1, ['Multiply', 't', ['Power', minusLn('t'), 3]]],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 't^20·e^(-t)',
    json: ['Multiply', ['Power', 't', 20], ['Exp', ['Negate', 't']]],
    names: ['t'],
    modes: ['complex'],
  },
  {
    name: 'i/(t·(-ln t)^1.1)',
    json: [
      'Divide',
      ['Complex', 0, 1],
      ['Multiply', 't', ['Power', minusLn('t'), 1.1]],
    ],
    names: ['t'],
    modes: ['strict'],
    known: [...FUNCTION_KNOWN, 'underflow', 'strict-nan'],
  },
];

describe('slice 3: powers of a complex base, differential', () => {
  for (const program of POWERS.map((p) => ({
    ...p,
    known: p.known ?? [...FUNCTION_KNOWN, 'underflow'],
  })))
    for (const mode of program.modes ?? (['strict', 'complex'] as const))
      test(`${program.name} (${mode})`, () => checkProgram(program, mode));
});

describe('slice 3: the code', () => {
  test('z^3 is the chain of products of the base, bound once', () => {
    expect(codeOf(['Power', 'z', 3])).toBe(
      '(() => { const _tv1 = _.z; const _tv2 = ({ re: _tv1.re * _tv1.re - _tv1.im * _tv1.im, im: _tv1.re * _tv1.im + _tv1.im * _tv1.re }); return ({ re: _tv2.re * _tv1.re - _tv2.im * _tv1.im, im: _tv2.re * _tv1.im + _tv2.im * _tv1.re }); })()'
    );
  });

  test('another exponent is _SYS.cpow of the converted exponent', () => {
    expect(codeOf(['Power', 'z', 1.1])).toBe(
      '_SYS.cpow(_.z, ({ re: 1.1, im: 0 }))'
    );
  });
});

describe('slice 3: what stays declined', () => {
  const declined: [string, MathJsonExpression, Mode, RegExp][] = [
    [
      'z^x: an exponent that is not a number literal',
      ['Power', 'z', 'x'],
      'strict',
      /Power with a complex operand and an exponent that is not a number literal is not in the structured route/,
    ],
    [
      'x^z',
      ['Power', 'x', 'z'],
      'strict',
      /Power with a complex operand and an exponent that is not a number literal is not in the structured route/,
    ],
    [
      'z^w',
      ['Power', 'z', 'w'],
      'strict',
      /Power with a complex operand and an exponent that is not a number literal is not in the structured route/,
    ],
    [
      'z^(2i): a complex literal exponent',
      ['Power', 'z', ['Complex', 0, 2]],
      'strict',
      /Power with the exponent .* is not in the structured route/,
    ],
  ];
  test.each(declined)('%s', (_name, json, mode, message) => {
    expect(() =>
      structured().compile(engine().expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });
});
