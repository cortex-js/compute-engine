/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batches 1 and 2: containment and the comparison with
 * the existing interval target.
 *
 * Containment: for each program, at seeded random boxes (points, narrow and
 * wide, across 0 and across the edges of domains), the interpreter's value
 * at points of the box (`expr.subs({…}).N()`, the double read as an exact
 * rational) is inside the result when the result carries an enclosure, and
 * an `empty` result means that no sampled point has a real value. An end may
 * miss by at most 2 ulps; the checks that need that slack are counted.
 *
 * The comparison: the same kind as the result of the existing target and
 * bounds equal within 4 ulps or tighter. The programs for which some box
 * differs are pinned in `EXCEPTIONS`, so that a new one fails.
 *
 * `KERNEL_DEFECTS` are the programs whose result misses the interpreter's
 * value because of a kernel of the interval library, which the existing
 * target calls in the same way (same result): pinned, so that a fix or a
 * new miss fails.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('n', 'integer');
ce.declare('m', 'integer');
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
/** A program, and the centres of its boxes (the edges of its domain). */
type Case = { json: Json; centres?: number[] };

const C = (json: Json, centres?: number[]): Case => ({ json, centres });
const x = 'x';
const y = 'y';

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
];

/** The programs whose result differs from the existing target's at some
 *  box: an other kind, or a bound wider by more than 4 ulps. */
// prettier-ignore
const EXCEPTIONS: string[] = [
  // A float exponent that is not a multiple of 1/1024 over a negative
  // base: the symmetric hull (`_IA.powReal`), where the existing target
  // reads the float as a rational (design note, section 4).
  JSON.stringify(['Power', x, 0.2]),
  JSON.stringify(['Power', x, 0.6]),
  // `Root(x, 2)^3`: the root and the power each round outward, 5 ulps at
  // the upper end where `_IA.powRational` gives the tighter enclosure.
  JSON.stringify(['Power', x, ['Rational', 3, 2]]),
  // The existing target reads `Mod(1, 1/10)` as a jump; the mode folds it
  // to the exact 0.
  JSON.stringify(['Add', ['Mod', 1, ['Rational', 1, 10]], x]),
  // The decimal base is not its double: the mode encloses it with one ulp
  // on each side, where the existing target reads the double as a point.
  JSON.stringify(['Power', 2.718281828459045, x]),
  // A local assigned in both arms of an undecided `If`: the hull of both
  // values. The existing target keeps the second arm's value ([-1, -1]
  // over [-1.71, 0.29]), which excludes the value 2x at x > 0 (design
  // note, section 10).
  JSON.stringify(['Block', ['Declare', 't', "'real'", 0], ['If', ['Greater', x, 0], ['Assign', 't', ['Multiply', 2, x]], ['Assign', 't', -1]], 't']),
  // A sum is a loop, which adds its terms in another order than the
  // existing target's sum written out term by term: the ends differ in the
  // last digits, by more than 4 ulps of an end near 0 (design note,
  // section 9).
  JSON.stringify(['Sum', ['Sin', ['Multiply', 'k', x]], ['Limits', 'k', 1, 3]]),
  JSON.stringify(['Sum', ['Multiply', ['Power', -1, 'k'], ['Divide', ['Power', x, 'k'], 'k']], ['Limits', 'k', 1, 6]]),
];

/** The programs whose containment fails by a kernel of the interval
 *  library: `asec`, `acsc` and `acoth` take one outward step after an
 *  operation whose error their derivative amplifies near -1 (at
 *  x = -1.0000005, `_IA.asec` gives a lower end 2.2e-14 above the value);
 *  `_IA.gcd` keeps the sign of a negative operand (`GCD(0, -2)` is
 *  `[-2, -2]`, the interpreter gives 2). */
// prettier-ignore
const KERNEL_DEFECTS: string[] = [
  JSON.stringify(['Arcsec', x]), JSON.stringify(['Arccsc', x]),
  JSON.stringify(['Arcoth', x]), JSON.stringify(['GCD', 'n', 'm']),
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

function boxes(expr: Expression, centres: number[], rnd: () => number): Box[] {
  const names = expr.unknowns as string[];
  const widths = [0, 1e-6, 0.3, 2, 8];
  return Array.from({ length: 24 }, () => {
    const b: Box = {};
    for (const v of names) {
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
function exact(v: number): Expression {
  if (Number.isInteger(v)) return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

/** The interpreter's value at `point`: a finite real, a boolean, or
 *  `undefined` (no real value). */
function interpret(
  expr: Expression,
  point: Record<string, number>
): number | boolean | undefined {
  const sub = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, exact(v)])
  );
  const v = expr.subs(sub).N();
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
const differences = new Map<string, string>();
const misses = new Map<string, string[]>();

describe('the interval mode: containment', () => {
  test.each(CASES.map((c) => [JSON.stringify(c.json), c]))('%s', (label, c) => {
    const expr = ce.box(c.json as never);
    const r = compile(expr, {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { run: (b: Box) => unknown; code: string };
    const old = compile(expr, { to: 'interval-js' }) as unknown as {
      success: boolean;
      run: (b: Box) => unknown;
    };
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    for (const b of boxes(expr, c.centres ?? [], rnd)) {
      const got = r.run(b);
      if (
        typeof got === 'string'
          ? !['true', 'false', 'maybe'].includes(got)
          : typeof (got as Kinded).kind !== 'string'
      )
        failures.push(
          `${JSON.stringify(b)}: not a kinded result ${JSON.stringify(got)}`
        );
      if (label === JSON.stringify(['Power', 'x', 2]))
        expect(IA.square(b.x)).toEqual(IA.powInterval(b.x, { lo: 2, hi: 2 }));
      for (const point of pointsOf(b, rnd)) {
        const v = interpret(expr, point);
        if (v === undefined) continue;
        checks += 1;
        if (typeof v === 'boolean') {
          if (got === (v ? 'false' : 'true'))
            failures.push(
              `${JSON.stringify(b)} at ${JSON.stringify(point)}: ${got}, interpreter ${v}`
            );
          continue;
        }
        const k = got as Kinded;
        if (k.kind === 'empty') {
          failures.push(
            `${JSON.stringify(b)} at ${JSON.stringify(point)}: empty, interpreter ${v}`
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
        failures.push(
          `${JSON.stringify(b)} at ${JSON.stringify(point)}: ${JSON.stringify(got)}, interpreter ${v}`
        );
      }
      // The comparison with the existing target.
      if (!old.success || differences.has(label)) continue;
      const was = old.run(b);
      if (!sameOrTighter(got, was))
        differences.set(
          label,
          `${JSON.stringify(b)}: mode ${JSON.stringify(got)}, existing ${JSON.stringify(was)}`
        );
    }
    if (failures.length > 0) misses.set(label, failures);
    if (!KERNEL_DEFECTS.includes(label)) expect(failures).toEqual([]);
  });

  test('the count of checks, and of those that used the slack', () => {
    console.log(
      `${checks} containment checks, ${slack} within the 2-ulp slack\n${SAMPLES.join('\n')}`
    );
    expect(checks).toBeGreaterThan(10_000);
  });

  test('the programs that miss by a kernel of the library', () =>
    expect([...misses.keys()].sort()).toEqual([...KERNEL_DEFECTS].sort()));

  test('the programs that differ from the existing target', () => {
    console.log([...differences].map(([k, v]) => `${k}\n  ${v}`).join('\n'));
    expect([...differences.keys()].sort()).toEqual([...EXCEPTIONS].sort());
  });
});

/** The same verdict, or the same kind and bounds within 4 ulps of the
 *  existing result or inside it. */
function sameOrTighter(got: unknown, was: unknown): boolean {
  if (typeof got === 'string' || typeof was === 'string') return got === was;
  const [a, b] = [got as Kinded, was as Kinded];
  if (a.kind !== b.kind) return false;
  if (a.value === undefined || b.value === undefined)
    return a.value === b.value;
  return (
    a.value.lo >= step(b.value.lo, 4, nextDown) &&
    a.value.hi <= step(b.value.hi, 4, nextUp)
  );
}

describe('the interval mode: spellings', () => {
  // `ExponentialE` is `Exp`; a literal whose double is `Math.E` is not.
  test.each([
    [['Power', 'ExponentialE', x], '_IA.exp'],
    [['Power', 2.718281828459045, x], '_IA.powReal'],
    [['Power', x, 2], '_IA.square'],
    // A base that is the integer 10 or 2 is `log10` or `log2`; a decimal
    // whose double is 10 is not.
    [['Log', x, 10], '_IA.log10'],
    [['Log', x, 2], '_IA.log2'],
    [['Log', x, { num: '10.0000000000000001' }], '_IA.ln'],
  ])('%j', (json, spelling) => {
    const r = compile(ce.box(json as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as { code: string };
    expect(r.code).toContain(spelling);
  });

  test('a decimal base whose double is 10 keeps the value below 3', () => {
    // `Log(1000, 10.0000000000000001)` is just below 3: its `Floor` is 2.
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
    const value = r.run({ x: 1000 }).value!;
    expect(value.lo <= 2 && 2 <= value.hi).toBe(true);
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
    } as never) as unknown as { run: (b: Box) => Kinded; code: string };
    // Not one folded literal (`Sqrt(2)` is an exact radical, an enclosure
    // of its double).
    expect(r.code).toMatch(/^_IA\./);
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
