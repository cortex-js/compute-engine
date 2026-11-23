/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batches 1, 2 and 4: containment, on an engine at the
 * default precision and, for `MACHINE_CASES`, on an engine at machine
 * precision.
 *
 * Containment: for each program, at seeded random boxes (points, narrow and
 * wide, across 0 and across the edges of domains), the interpreter's value
 * at points of the box (`expr.subs({…}).N()`, the double read as an exact
 * rational) is inside the result when the result carries an enclosure, and
 * an `empty` result means that no sampled point has a real value. An end may
 * miss by at most 2 ulps; the checks that need that slack are counted. A
 * program of `MACHINE_CASES` is compiled on an engine at machine precision,
 * where a literal is a machine number, and its reference is computed on the
 * default engine: the interpreter at machine precision rounds each step to
 * 15 digits (`(|x − 1|^0.2 + |2x + 1|^0.2)^5` at -2 is 96.00000000000105
 * there, 96.00000000000013 with the doubles), and the literals of the
 * reference are their doubles (`doubles()`), so it computes what the
 * machine interpreter computes, without the rounding. One reading differs:
 * the default engine reads a float exponent to 17 digits and the machine
 * engine to 15, so an exponent that is a rational of odd denominator at 15
 * digits only (`0.333333333333333`) has no real reference over a negative
 * base and its points are skipped; `ir-interval-contract.test.ts` pins that
 * case ("a float exponent is read to the digits of the compiling engine").
 *
 * `KERNEL_DEFECTS` are the programs whose result misses the interpreter's
 * value because of a kernel of the interval library: pinned, so that a fix
 * or a new miss fails.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compile';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
const declare = (engine: ComputeEngine) => {
  engine.declare('x', 'real');
  engine.declare('y', 'real');
  engine.declare('n', 'integer');
  engine.declare('m', 'integer');
  engine.declare('a', 'real');
};
declare(ce);
ce.assign(
  'g',
  ce.box(['Function', ['Add', ['Power', 't', 2], 1], 't'] as never)
);
ce.assign(
  'h',
  ce.box([
    'Function',
    ['Multiply', ['Sin', 'a'], ['g', 'b']],
    'a',
    'b',
  ] as never)
);
// A user function whose body is a conditional.
ce.assign(
  'q',
  ce.box([
    'Function',
    ['If', ['Greater', 't', 0], ['Sqrt', 't'], ['Negate', 't']],
    't',
  ] as never)
);

type Json = unknown;
/** A program, and the centres of its boxes (the edges of its domain).
 *  `points`: an input whose box is a point drawn from its list, given to
 *  the interpreter as a machine number (`engine.number(v)`), so that a
 *  float exponent is read as a float and not by the terms of a rational. */
type Case = { json: Json; centres?: number[]; points?: Record<string, number[]> };

const C = (
  json: Json,
  centres?: number[],
  points?: Record<string, number[]>
): Case => ({ json, centres, points });
const x = 'x';
const y = 'y';

/** Tycho's Fourier series of a square wave, a sum of 100 terms. */
const FOURIER = C(['Add', ['Multiply', ['Divide', 2, 'Pi'], ['Sum', ['Multiply', ['Divide', 1, 'i'], ['Sin', ['Multiply', 'i', x]]], ['Limits', 'i', 1, 100]]], 3]);

// prettier-ignore
const CASES: Case[] = [
  // Arithmetic
  C(['Add', x, y]), C(['Subtract', x, y]), C(['Negate', x]), C(['Multiply', x, y]),
  C(['Divide', x, y], [0]), C(['Divide', x, 49], [49]), C(['Multiply', ['Rational', 3, 7], x]),
  C(['Add', x, 'Pi']), C(['Multiply', 'ExponentialE', x]), C(['Add', x, ['Rational', 1, 3]]),
  C(['Multiply', 0.1, x], [10, 30]), C(['Multiply', 0.5, x]), C(['Add', ['Floor', ['Multiply', 'Pi', 100]], x]),
  C(['Multiply', ['Sin', 1], x]), C(['Add', ['Mod', 1, ['Rational', 1, 10]], x]),
  // Powers
  C(['Power', x, 2]), C(['Power', x, 3]), C(['Power', x, -1], [0]), C(['Power', x, -2], [0]),
  C(['Power', x, ['Rational', 2, 3]], [0, -8]), C(['Power', x, ['Rational', -2, 3]], [0, -8]),
  C(['Power', x, ['Rational', 1, 3]], [0, -8]), C(['Power', x, ['Rational', 3, 2]], [0]),
  C(['Power', x, ['Rational', 5, 3]], [0, -2]),
  C(['Power', x, ['Rational', -3, 2]], [0]), C(['Power', x, ['Rational', 3, 4]], [0]),
  C(['Power', ['Power', x, 2], ['Rational', 3, 2]], [0]),
  C(['Power', ['Ln', ['Abs', x]], ['Rational', 9, 2]], [1, -1]),
  C(['Power', x, 0.2], [0, -8]), C(['Power', x, 2.5], [0, -8]), C(['Power', x, 1.5], [0]),
  C(['Power', x, 0.75], [0, -2]), C(['Power', x, 0.6], [0, -8]),
  C(['Power', x, y], [0, 2]), C(['Power', 2, x]), C(['Power', ['Abs', y], x], [0]),
  C(['Power', x, 'n'], [0]), C(['Power', 2.718281828459045, x], [100, 1]),
  C(['Root', x, 3], [0, -8]), C(['Root', x, 4], [0]), C(['Sqrt', x], [0]),
  // Elementary functions
  C(['Abs', x]), C(['Exp', x]), C(['Ln', x], [0, 1]), C(['Log', x, 10], [0, 1000]),
  C(['Log', x, 2], [0, 8]), C(['Log', x, 3], [0, 9]),
  C(['Sin', x]), C(['Cos', x]), C(['Tan', x], [1.5707963267948966]), C(['Cot', x], [0, 3.141592653589793]),
  C(['Sec', x], [1.5707963267948966]), C(['Csc', x], [0]),
  C(['Sinh', x]), C(['Cosh', x]), C(['Tanh', x]), C(['Sech', x]), C(['Csch', x], [0]), C(['Coth', x], [0]),
  C(['Arcsin', x], [1, -1]), C(['Arccos', x], [1, -1]), C(['Arctan', x]), C(['Arccot', x], [0]),
  C(['Arcsec', x], [1, -1, 0]), C(['Arccsc', x], [1, -1, 0]),
  C(['Arsinh', x]), C(['Arcosh', x], [1]), C(['Artanh', x], [1, -1]), C(['Arcoth', x], [1, -1]),
  C(['Arsech', x], [0, 1]), C(['Arcsch', x], [0]),
  C(['Arctan2', y, x], [0]), C(['Hypot', x, y]), C(['Degrees', x], [180]),
  // Rounding and steps
  C(['Floor', x], [1, -1]), C(['Ceil', x], [1, -1]), C(['Round', x], [0.5, -0.5, 2.5]),
  C(['Truncate', x], [1, -1]), C(['Fract', x], [1, -1]), C(['Sign', x], [0]),
  C(['Mod', x, 2], [2, -2]), C(['Mod', x, -2], [2, -2]), C(['Mod', x, y], [0, 2]),
  C(['Mod', 'n', 3]), C(['Max', x, y]), C(['Min', x, y]), C(['Max', x, y, 1]),
  // Special functions and integers
  C(['Erf', x]), C(['Erfc', x]), C(['Gamma', x], [0, -1, 1.5]), C(['GammaLn', x], [0, 1, 2]),
  C(['Factorial', x], [-1, 0, 3]), C(['Factorial', 'n']), C(['Factorial2', x], [0, 3, -1]),
  C(['Binomial', 'n', 'm']), C(['GCD', 'n', 'm']), C(['LCM', 'n', 'm']),
  C(['Add', 'n', 'm']), C(['Multiply', 'n', x]),
  // Comparisons and logic
  C(['Less', x, y]), C(['LessEqual', x, 1], [1]), C(['Greater', x, 0], [0]), C(['GreaterEqual', x, y]),
  C(['Equal', x, 1], [1]), C(['NotEqual', x, 1], [1]), C(['Less', ['Floor', x], 1], [1]),
  C(['And', ['Less', x, 1], ['Greater', y, 0]], [1, 0]), C(['Or', ['Less', x, 0], ['Greater', y, 1]], [0, 1]),
  C(['Not', ['Less', x, 0]], [0]),
  // Compositions
  C(['Add', ['Power', ['Sin', x], 2], ['Power', ['Cos', x], 2]]),
  C(['Add', ['Power', x, 3], ['Multiply', -2, x], ['Divide', y, 3]]),
  C(['Add', ['Power', x, 2], ['Power', y, 2], -1], [1, 0]),
  C(['Sqrt', ['Add', ['Power', x, 2], ['Power', y, 2]]]),
  C(['Ln', ['Add', 1, ['Power', x, 2]]]), C(['Exp', ['Negate', ['Power', x, 2]]]),
  C(['Add', ['Multiply', 2, ['Floor', x]], 1], [1]), C(['Divide', ['Tan', x], x], [0]),
  C(['Sin', ['Multiply', 'Pi', x]], [1]), C(['Multiply', ['Exp', x], ['Cos', ['Multiply', 3, y]]]),
  C(['Divide', ['Add', x, 1], ['Subtract', ['Power', x, 2], 4]], [2, -2]),
  // A user function and a Block local
  C(['Add', ['g', x], ['g', ['Negate', x]]]), C(['h', x, y]),
  C(['Block', ['Declare', 't', "'real'", ['Multiply', x, y]], ['Add', ['Sin', 't'], 't']]),
  // Batch 2: conditionals
  C(['If', ['Greater', x, 0], ['Multiply', 2, x]], [0]),
  C(['If', ['Greater', x, 0], ['Sqrt', x], ['Negate', x]], [0]),
  C(['If', ['Greater', x, 0], ['Ln', x], 0], [0]),
  C(['If', ['LessEqual', 1, x], ['Arcosh', x], x], [1]),
  C(['If', ['Less', x, 0], ['If', ['Less', y, 0], ['Add', x, y], ['Subtract', x, y]], ['Multiply', x, y]], [0]),
  C(['Which', ['Less', x, 0], -1, ['Less', x, 1], ['Power', x, 2], 'True', 2], [0, 1]),
  C(['Which', ['Less', x, 0], ['Negate', x], ['Less', x, 1], ['Sqrt', x]], [0, 1]),
  C(['Less', 0, x, 1], [0, 1]), C(['If', ['Less', 0, x, 1], ['Ln', x], 0], [0, 1]),
  C(['And', ['Greater', x, 0], ['Greater', ['Divide', 1, x], 2]], [0, 0.5]),
  C(['Or', ['Not', ['Less', x, 1]], ['Less', y, 0]], [1, 0]),
  C(['If', ['And', ['Greater', x, 0], ['Less', y, 1]], ['Add', x, y], 0], [0, 1]),
  C(['If', ['Or', ['Less', x, 0], ['Greater', ['Divide', 1, x], 2]], 1, -1], [0, 0.5]),
  C(['If', ['Not', ['Less', x, 0]], ['Sqrt', x], 0], [0]),
  C(['Block', ['Declare', 't', "'real'", 0], ['If', ['Greater', x, 0], ['Assign', 't', ['Multiply', 2, x]], ['Assign', 't', -1]], 't'], [0]),
  C(['Add', ['q', x], ['q', y]], [0]),
  C(['If', ['Greater', x, 0], ['Random'], 0], [0]),
  C(['WithRandomSeed', 42, ['Multiply', ['Random'], x]]),
  // Batch 2: loops and integers
  C(['Sum', ['Sin', ['Multiply', 'k', x]], ['Limits', 'k', 1, 3]]),
  C(['Product', ['Add', x, 'k'], ['Limits', 'k', 1, 4]]),
  C(['Sum', ['Power', x, 'k'], ['Limits', 'k', 1, 'n']]),
  C(['Sum', ['Divide', ['Sin', ['Multiply', x, ['Subtract', ['Multiply', 2, 'k'], 1]]], ['Subtract', ['Multiply', 2, 'k'], 1]], ['Limits', 'k', 1, ['Floor', y]]], [3, 5]),
  C(['Sum', ['Sum', ['Multiply', 'j', 'k', x], ['Limits', 'k', 1, 'j']], ['Limits', 'j', 1, 3]]),
  C(['If', ['Greater', x, 0], ['Sum', ['Power', x, 'k'], ['Limits', 'k', 1, 4]], ['Negate', x]], [0]),
  C(['Sum', ['Multiply', ['Power', -1, 'k'], ['Divide', ['Power', x, 'k'], 'k']], ['Limits', 'k', 1, 6]]),
  C(['Power', x, 7]), C(['Power', 'n', 3]), C(['Add', ['Floor', x], 1], [1]),
  // A sum of constant bounds of at most 100 passes is written out: the
  // parts that read only the index are constants of `preambleOnce`.
  C(['Sum', ['Multiply', ['Divide', ['Power', -1, 'i'], 'i'], ['Sin', ['Multiply', 'i', x]]], ['Limits', 'i', 1, 100]]),
  C(['Sum', ['Multiply', ['Cos', ['Divide', ['Multiply', 'Pi', 'n'], 6]], ['Sin', ['Add', ['Multiply', 'n', x], ['Sin', ['Multiply', 1000, 'n']]]]], ['Limits', 'n', 0, 12]]),
  C(['Sum', ['If', ['Equal', ['Mod', 'i', 2], 0], ['Sin', x], ['Cos', ['Multiply', 'i', x]]], ['Limits', 'i', 1, 4]]),
  C(['Sum', ['g', x], ['Limits', 'i', 1, 3]]), C(['Sum', ['Multiply', ['g', 'k'], x], ['Limits', 'k', 1, 3]]),
  C(['Sum', ['Sum', ['Multiply', 'i', 'j', x], ['Limits', 'j', 1, 3]], ['Limits', 'i', 1, 3]]),
  C(['Product', ['Add', ['Divide', x, 'k'], 1], ['Limits', 'k', 1, 8]]),
  // Batch 4: a decimal literal is its double
  C(['Add', x, 1.8]), C(['Subtract', y, 1.8]), C(['Multiply', 1.8, x, y]),
  C(['Add', ['Multiply', 0.3, x], 0.7]), C(['Less', x, 1.8], [1.8]),
  // A negation read once is the subtrahend of `sub`.
  C(['Add', ['Negate', x], y]), C(['Add', ['Negate', x], ['Negate', y]]),
  C(['Add', ['Negate', ['Abs', x]], -3]), C(['Add', ['Negate', x], ['Multiply', 2, 'Pi']]),
  C(['GreaterEqual', ['Multiply', 0.1, x], 0.3], [3]),
  C(['Divide', 1, ['Add', ['Multiply', 0.5, ['Sin', ['Multiply', 2, x]]], 0.5]], [-0.7853981633974483]),
  // Batch 4: a float exponent read as the interpreter reads it
  C(['Power', x, 2.2], [0, -2, 2]), C(['Power', x, 3.87], [0, -2, 2]),
  C(['Power', x, 0.6000000000000001], [0, -32, 2]), C(['Power', x, ['Divide', 1, 2.2]], [0, -32, 2]),
  C(['Power', x, 0.4545454545454545], [0, -32, 2]), C(['Power', x, -0.2], [0, -8, 2]),
  C(['Power', x, 0.0333], [0, -2, 2]), C(['Power', x, 'a'], [0, -8, 2]),
  C(['Add', ['Power', x, 3.87], 1.8], [0, -2]),
  C(['Power', x, 2.2], [32, 1e6, -1e6]), C(['Power', x, 0.2], [1e300, -1e300, 1e6]),
  // A run-time exponent that reads as `p/q` of odd `q`, and one that does not.
  C(['Power', x, 'a'], [0, -8, 2], { a: [0.2, 0.6000000000000001, 2.2, -0.2, 1.5, 0.37] }),
  // A base that is provably non-negative: the principal power.
  C(['Power', ['Abs', ['Subtract', x, 1]], 0.2], [1, -1.623107644263655]),
  C(['Power', ['Add', ['Power', ['Abs', ['Subtract', x, 1]], 0.2], ['Power', ['Abs', ['Add', ['Multiply', 2, x], 1]], 0.2]], { num: '5.0' }], [1, -0.5, -1.623107644263655]),
  // Batch 4: Binomial and Choose of reals, GCD and LCM with 0
  C(['Binomial', x, y], [0, 2, -1]), C(['Binomial', x, 2.5], [0, 3, -1]), C(['Choose', x, 2], [0, 1]),
  C(['Choose', 'n', 'm']), C(['GCD', 'n', 0]), C(['GCD', ['Floor', x], ['Floor', y]], [0, -1]),
  C(['LCM', 'n', 0]), C(['LCM', ['Floor', x], ['Floor', y]], [0, -1]),
  // Heaviside (1/2 at 0) and Remainder of integers (the quotient rounded to
  // the nearest integer, a tie toward +∞)
  C(['Heaviside', x], [0]), C(['Heaviside', ['Subtract', x, 1]], [1]),
  C(['Remainder', 'n', 'm']), C(['Remainder', 'n', 3]), C(['Remainder', 'n', -2]),
  C(['Remainder', ['Floor', x], 2], [1, -1, 3]), C(['Remainder', ['Floor', x], ['Floor', y]], [0, -1, 2]),
  // Remainder of reals (CE-1448: `a - b·round(a/b)` cancels)
  C(['Remainder', x, 0.7], [-19.599995613098145, 0.35, -0.35, 0]), C(['Remainder', x, y], [0, 1.5, -2]),
  C(['Remainder', ['Sin', x], 0.25], [0.5]),
  // Tycho's Fourier series, on both engines
  FOURIER,
];

/** The programs that also run on an engine at machine precision, where a
 *  literal is a machine number. */
const MACHINE_CASES: Case[] = CASES.filter((c) => {
  const text = JSON.stringify(c.json);
  return c === FOURIER || /\d\.\d|"Power"|Binomial|Choose|GCD|LCM/.test(text);
});

/** A miss of the containment: the point, the interpreter's value there and
 *  the result of the mode. */
type Miss = { point: Record<string, number>; v: number | boolean; got: unknown };

/** The programs whose reference is not the value of the doubles. At `x = -0.35` the
 *  reference of `Remainder(x, 0.7)` reads the exact rational of `x` beside
 *  the decimal of the double 0.7 at the working precision, as every float
 *  lane does (21 digits: -0.349999999999999977796), so the quotient is not
 *  the tie -1/2 of the doubles and the reference is 0.35; the mode gives
 *  the remainder of the doubles, -0.35 (CE-1449). */
const INTERPRETER_DEFECTS: Record<string, (m: Miss) => boolean> = {
  [`machine ${JSON.stringify(['Remainder', x, 0.7])}`]: (m) =>
    m.point.x === -0.35 && m.v === 0.35,
};
const EXCUSED = { ...INTERPRETER_DEFECTS };

/** The programs whose containment fails by a kernel of the interval
 *  library: `asec`, `acsc` and `acoth` take one outward step after an
 *  operation whose error their derivative amplifies near -1 (at
 *  x = -1.0000005, `_IA.asec` gives a lower end 2.2e-14 above the value). */
// prettier-ignore
const KERNEL_DEFECTS: string[] = [
  JSON.stringify(['Arcsec', x]), JSON.stringify(['Arccsc', x]),
  JSON.stringify(['Arcoth', x]),
];

// A seeded generator (mulberry32).
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Box = Record<string, { lo: number; hi: number }>;
const integer = (name: string) => name === 'n' || name === 'm';

function boxes(
  expr: Expression,
  centres: number[],
  rnd: () => number,
  points: Record<string, number[]> = {}
): Box[] {
  const names = expr.unknowns as string[];
  const widths = [0, 1e-6, 0.3, 2, 8];
  return Array.from({ length: 24 }, () => {
    const b: Box = {};
    for (const v of names) {
      if (points[v] !== undefined) {
        const p = points[v][Math.floor(rnd() * points[v].length)];
        b[v] = { lo: p, hi: p };
        continue;
      }
      if (integer(v)) {
        const lo = Math.floor(rnd() * 12) - 4;
        const hi = rnd() < 0.5 ? lo : lo + Math.floor(rnd() * 4);
        b[v] = { lo, hi };
        continue;
      }
      const c =
        rnd() < 0.6
          ? [...centres, 0, 1, -1][Math.floor(rnd() * (centres.length + 3))]
          : (rnd() - 0.5) * 12;
      const w = widths[Math.floor(rnd() * widths.length)];
      // A box on one side of the centre, or across it.
      const s = rnd();
      const lo = s < 0.33 ? c : s < 0.66 ? c - w : c - w / 2;
      b[v] = { lo, hi: lo + w };
    }
    return b;
  });
}

function pointsOf(b: Box, rnd: () => number): Record<string, number>[] {
  const names = Object.keys(b);
  const pick = (v: string, k: number) => {
    const { lo, hi } = b[v];
    if (k === 0) return lo;
    if (k === 1) return hi;
    if (integer(v)) return lo + Math.floor(rnd() * (hi - lo + 1));
    return lo + rnd() * (hi - lo);
  };
  return Array.from({ length: 6 }, (_, k) =>
    Object.fromEntries(names.map((v) => [v, pick(v, k)]))
  );
}

/** The double `v` as the exact rational the interpreter reads. */
function exact(engine: ComputeEngine, v: number): Expression {
  if (Number.isInteger(v)) return engine.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return engine.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

/** The exact decimal expansion of the double `v`. */
function decimalOf(v: number): string {
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  const digits = (BigInt(v * 2 ** k) * 5n ** BigInt(k)).toString();
  const sign = digits.startsWith('-') ? '-' : '';
  const d = digits.replace('-', '').padStart(k + 1, '0');
  return `${sign}${d.slice(0, d.length - k)}.${d.slice(d.length - k)}`;
}

/** `json` with each decimal literal replaced by its double: a decimal is
 *  its double in compiled code (the precision of the target), so the
 *  interpreter's value of this program is the reference. This encodes the
 *  caveat that the test "a decimal literal is its double: Ceil(x - 1.8)"
 *  (`ir-interval-contract.test.ts`) states with its numbers: the
 *  default-precision interpreter computes with the decimal, and its value
 *  can differ. */
function doubles(json: Json): Json {
  if (typeof json === 'number')
    return Number.isInteger(json) || !Number.isFinite(json)
      ? json
      : { num: decimalOf(json) };
  if (Array.isArray(json)) return json.map(doubles);
  if (typeof json === 'object' && json !== null && 'num' in json)
    return doubles(Number((json as { num: string }).num));
  return json;
}

/** The interpreter's value at `point`: a finite real, a boolean, or
 *  `undefined` (no real value). */
function interpret(
  expr: Expression,
  point: Record<string, number>,
  machineNames: string[] = []
): number | boolean | undefined {
  const engine = expr.engine as ComputeEngine;
  const sub = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [
      k,
      machineNames.includes(k) ? engine.number(v) : exact(engine, v),
    ])
  );
  // The global precision of the big decimals is the default engine's while
  // the reference is computed (an engine at machine precision writes 15).
  const saved = BigDecimal.precision;
  BigDecimal.precision = engine.precision;
  let v: Expression;
  try {
    v = expr.subs(sub).N();
  } finally {
    BigDecimal.precision = saved;
  }
  if (v.symbol === 'True') return true;
  if (v.symbol === 'False') return false;
  if (!v.isNumberLiteral || v.im !== 0 || !Number.isFinite(v.re))
    return undefined;
  return v.re;
}

type Kinded = {
  kind: string;
  value?: { lo: number; hi: number };
};

const step = (x: number, n: number, f: (x: number) => number) => {
  for (let k = 0; k < n; k++) x = f(x);
  return x;
};

let checks = 0;
let slack = 0;
const SAMPLES: string[] = [];
const misses = new Map<string, string[]>();

/** The containment of the program `c` compiled on `engine`, against the
 *  interpreter's value on the default engine; `label` is the key of
 *  `misses`. */
function contain(engine: ComputeEngine, label: string, c: Case): void {
  {
    const expr = engine.box(c.json as never);
    // The canonical form of the compiling engine: at machine precision
    // `1/2.2` is the machine number of the double quotient.
    const reference = ce.box(doubles(expr.json) as never);
    const r = compile(expr, {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { run: (b: Box) => unknown; code: string };
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    // The misses that the reason of `EXCUSED` does not explain.
    const unexcused: string[] = [];
    const excuse = EXCUSED[label];
    const fail = (text: string, m?: Miss) => {
      failures.push(text);
      if (excuse === undefined || m === undefined || !excuse(m))
        unexcused.push(text);
    };
    const machineNames = Object.keys(c.points ?? {});
    for (const b of boxes(expr, c.centres ?? [], rnd, c.points)) {
      const got = r.run(b);
      if (
        typeof got === 'string'
          ? !['true', 'false', 'maybe'].includes(got)
          : typeof (got as Kinded).kind !== 'string'
      )
        fail(`${JSON.stringify(b)}: not a kinded result ${JSON.stringify(got)}`);
      if (label === JSON.stringify(['Power', 'x', 2]))
        expect(IA.square(b.x)).toEqual(IA.powInterval(b.x, { lo: 2, hi: 2 }));
      for (const point of pointsOf(b, rnd)) {
        const v = interpret(reference, point, machineNames);
        if (v === undefined) continue;
        checks += 1;
        if (typeof v === 'boolean') {
          if (got === (v ? 'false' : 'true'))
            fail(
              `${JSON.stringify(b)} at ${JSON.stringify(point)}: ${got}, interpreter ${v}`,
              { point, v, got }
            );
          continue;
        }
        const k = got as Kinded;
        if (k.kind === 'empty') {
          fail(
            `${JSON.stringify(b)} at ${JSON.stringify(point)}: empty, interpreter ${v}`,
            { point, v, got }
          );
          continue;
        }
        if (k.value === undefined) continue;
        const { lo, hi } = k.value;
        if (v >= lo && v <= hi) continue;
        if (v >= step(lo, 2, nextDown) && v <= step(hi, 2, nextUp)) {
          slack += 1;
          if (SAMPLES.length < 10)
            SAMPLES.push(
              `${label} ${JSON.stringify(point)}: ${v} in ${JSON.stringify(k)}`
            );
          continue;
        }
        fail(
          `${JSON.stringify(b)} at ${JSON.stringify(point)}: ${JSON.stringify(got)}, interpreter ${v}`,
          { point, v, got }
        );
      }
    }
    if (failures.length > 0) misses.set(label, failures);
    if (!KERNEL_DEFECTS.includes(label)) expect(unexcused).toEqual([]);
  }
}

describe('the interval mode: containment', () => {
  test.each(CASES.map((c) => [JSON.stringify(c.json), c]))('%s', (label, c) =>
    contain(ce, label, c)
  );
  // An engine at machine precision, as Tycho's: made here, because an
  // engine writes the process-global precision of the big decimals, which
  // the interpreter rounds at; the default is restored after.
  describe('at machine precision', () => {
    let machine: ComputeEngine;
    beforeAll(() => {
      machine = new ComputeEngine();
      machine.precision = 'machine';
      declare(machine);
    });
    afterAll(() => {
      BigDecimal.precision = ce.precision;
    });
    test.each(
      MACHINE_CASES.map((c) => [`machine ${JSON.stringify(c.json)}`, c])
    )('%s', (label, c) => contain(machine, label, c));
  });

  test('the count of checks, and of those that used the slack', () => {
    // Statistics for a reader of the run, printed on request only.
    if (process.env.CE_TEST_REPORT)
      console.log(
        `${checks} containment checks, ${slack} within the 2-ulp slack\n${SAMPLES.join('\n')}`
      );
    expect(checks).toBeGreaterThan(10_000);
  });

  test('the programs that miss by a kernel of the library', () =>
    expect([...misses.keys()].sort()).toEqual(
      [...KERNEL_DEFECTS, ...Object.keys(EXCUSED)].sort()
    ));
});

/** The code of `r` with each constant of `preambleOnce` written where it is
 *  read. */
const inlined = (r: { code: string; preambleOnce?: string }): string =>
  [...(r.preambleOnce ?? '').matchAll(/^const (v\d+) = (.*);$/gm)].reduce(
    (code, [, name, text]) =>
      code.replace(new RegExp(`\\b${name}\\b`, 'g'), text),
    r.code
  );

describe('the interval mode: spellings', () => {
  // `ExponentialE` is `Exp`; a literal whose double is `Math.E` is not.
  test.each([
    [['Power', 'ExponentialE', x], '_IA.exp'],
    [['Power', 2.718281828459045, x], '_IA.powReal'],
    [['Power', x, 2], '_IA.square'],
    // A base that is the integer 10 or 2 is `log10` or `log2`, also a
    // decimal whose double is 10: a decimal is its double.
    [['Log', x, 10], '_IA.log10'],
    [['Log', x, 2], '_IA.log2'],
    [['Log', x, { num: '10.0000000000000001' }], '_IA.log10'],
    // A float exponent read at compile time.
    [['Power', x, 2.2], '_IA.powRealBranch(_.x, { lo: 2.2, hi: 2.2 }.lo, true)'],
    [['Power', x, 0.6000000000000001], '_IA.powRealBranch(_.x, { lo: 0.6000000000000001, hi: 0.6000000000000001 }.lo, true)'],
    [['Power', x, 0.4], '_IA.powRealBranch(_.x, { lo: 0.4, hi: 0.4 }.lo, false)'],
    [['Power', x, 3.87], '_IA.pow(_.x, { lo: 3.87, hi: 3.87 }.lo)'],
    // A base that is provably non-negative: the principal power.
    [['Power', ['Abs', ['Subtract', x, 1]], 0.2], '_IA.pow(_IA.abs(_IA.add(_.x, { lo: -1, hi: -1 })), { lo: 0.2, hi: 0.2 }.lo)'],
    // An exact rational of odd denominator: the root, then the integer
    // power; of a denominator 2, the principal power.
    [['Power', x, ['Rational', 11, 5]], '_IA.pow(_IA.nthRootInterval(_.x, { lo: 5, hi: 5 }), 11)'],
    [['Power', x, ['Rational', 3, 2]], '_IA.pow(_.x, { lo: 1.5, hi: 1.5 }.lo)'],
    [['Add', x, 1.8], '{ lo: 1.8, hi: 1.8 }'],
  ])('%j', (json, spelling) => {
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { code: string; preambleOnce?: string };
    expect(inlined(r)).toContain(spelling);
  });

  test('a decimal base whose double is 10 is the base 10', () => {
    // `Log(1000, 10.0000000000000001)` is just below 3 in the interpreter,
    // whose `Floor` is 2; the decimal is its double, the integer 10, so the
    // mode gives 3, as the JavaScript code of the profile (the precision of
    // the target).
    const expr = ce.box([
      'Floor',
      ['Log', x, { num: '10.0000000000000001' }],
    ] as never);
    const r = compile(expr, {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as {
      run: (v: unknown) => { value?: { lo: number; hi: number } };
    };
    const at = expr.subs({ x: 1000 } as never).N().re;
    expect(at).toBe(2);
    expect(r.run({ x: 1000 }).value).toEqual({ lo: 3, hi: 3 });
    const js = compile(expr, {
      to: 'javascript',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { run: (v: unknown) => number };
    expect(js.run({ x: 1000 })).toBe(3);
  });
});

describe('the interval mode at machine precision', () => {
  // A closed node is not folded with `N()` in doubles: the kernels enclose
  // it. The value is the one of an engine at the default precision.
  test.each([
    ['Add', ['Sin', 1], ['Multiply', ['Cos', 2], ['Exp', 3]]],
    ['Multiply', ['Sqrt', 2], 'Pi'],
    ['Divide', ['Ln', 3], ['Ln', 7]],
    ['Add', 'x', ['Divide', ['Ln', 3], ['Ln', 7]]],
  ])('%j', (...json) => {
    const machine = new ComputeEngine({ precision: 'machine' });
    machine.declare('x', 'real');
    const r = compile(machine.box(json as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as {
      run: (b: Box) => Kinded;
      code: string;
      preambleOnce?: string;
    };
    // Not one folded literal (`Sqrt(2)` is an exact radical, an enclosure
    // of its double): kernels, computed once when the code is loaded where
    // the node reads no input.
    expect(`${r.preambleOnce ?? ''}\n${r.code}`).toMatch(/\b_IA\./);
    const reference = new ComputeEngine();
    const v = reference
      .box(json as never)
      .subs({ x: 0.5 })
      .N().re;
    const k = r.run({ x: { lo: 0.5, hi: 0.5 } });
    expect(k.value!.lo).toBeLessThanOrEqual(v);
    expect(k.value!.hi).toBeGreaterThanOrEqual(v);
  });
});

describe('the interval mode: a known limitation', () => {
  // The known-limitations line of `docs/COMPILATION-MODEL.md` for
  // `Power(x, Rational(5, 6))` on `interval-js`: at machine precision the
  // interpreter computes the power of the double 5/6, and the mode's root
  // of degree 6 then fifth power encloses the exact power, which is not
  // that value at `x = 1e10`. A fix or a new miss fails here.
  test('x^(5/6) at machine precision misses at x = 1e10 and contains at x = 5.166137', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    try {
      machine.declare('x', 'real');
      const e = machine.box(['Power', 'x', ['Rational', 5, 6]] as never);
      const r = compile(e, {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never) as unknown as {
        run: (b: Box) => { value: { lo: number; hi: number } };
      };
      const contains = (x: number) => {
        const v = e.subs({ x: machine.number(x) } as never).N().re;
        const { lo, hi } = r.run({ x: { lo: x, hi: x } }).value;
        return lo <= v && v <= hi;
      };
      expect(contains(1e10)).toBe(false);
      expect(contains(5.166137)).toBe(true);
    } finally {
      BigDecimal.precision = ce.precision;
    }
  });
});
