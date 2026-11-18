/**
 * The interval mode of the IR pipeline (`compile(expr, { to: 'interval-js',
 * profile: 'ir' })`), batch 6: integrals.
 *
 * An integral is `_IA.integrate(f, a, b, n)`, the enclosure of the interval
 * library, with its count of pieces `n` (`intervalQuadratureSize()`), or
 * with a closed form `_IA.integrateClosed(() => closed, f, a, b, n)`.
 *
 * Containment, as in `ir-interval-lists.test.ts`: at seeded random boxes,
 * the interpreter's value at points of the box is inside the result; an
 * end may miss by at most 2 ulps.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { intervalQuadratureSize } from '../../src/compute-engine/compilation/interval-quadrature';
import { compile } from '../../src/compile';
import { createIntervalRuntime } from '../../src/compute-engine/compilation/interval-runtime';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import type { Expression } from '../../src/compute-engine/global-types';

type Json = unknown;
const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('g', '(real) -> real');
ce.assign('g', ce.box(['Function', ['Add', ['Power', 'u', 2], 1], 'u'] as never));
/** An integral inside a user function. */
const I = (body: Json, v: string, lo: Json, hi: Json): Json => [
  'Integrate',
  ['Function', body, v],
  ['Limits', v, lo, hi],
];
ce.declare('G', '(real) -> real');
ce.assign('G', ce.box(['Function', I(['Sin', 's'], 's', 0, 'u'), 'u'] as never));

type Case = { json: Json; centres?: number[] };
const C = (json: Json, centres?: number[]): Case => ({ json, centres });
const x = 'x';
const y = 'y';

// prettier-ignore
const CASES: Case[] = [
  C(I(['Sin', 't'], 't', 0, x)),
  C(I(['Exp', ['Negate', ['Multiply', x, ['Power', 't', 2]]]], 't', 0, 1)),
  C(I(['Sin', ['Sin', ['Multiply', 't', x]]], 't', 0, 1)),
  C(I(['Multiply', ['Cos', ['Multiply', 't', x]], ['Exp', 't']], 't', -1, 1)),
  // A double integral, the inner bound the outer variable.
  C(I(I(['Multiply', 's', 't'], 's', 0, 't'), 't', 0, x)),
  // Bounds of the inputs, reversed bounds, an empty range.
  C(I(['Sqrt', ['Add', ['Power', 't', 2], 1]], 't', x, ['Add', x, y])),
  C(I(['Sin', 't'], 't', x, 0)),
  C(I(['Sin', 't'], 't', x, x)),
  // An infinite bound: a closed form.
  C(I(['Exp', ['Multiply', ['Rational', -1, 2], ['Power', 't', 2]]], 't', 'NegativeInfinity', x)),
  // A user function in the integrand, an integral in a user function.
  C(I(['g', 't'], 't', 0, x)),
  C(I(['G', 't'], 't', 0, x)),
  // A Sum in the integrand.
  C(I(['Sum', ['Divide', ['Power', 't', 'k'], ['Factorial', 'k']], ['Limits', 'k', 0, 4]], 't', 0, x)),
  // A pole inside the range.
  C(I(['Divide', 1, 't'], 't', -1, x), [0, 1]),
  // A constant integrand, and an integrand that is invariant.
  C(I(3, 't', 0, x)),
  C(I(['Cos', y], 't', ['Negate', x], x)),
  C(I(['Multiply', ['Gamma', ['Add', ['Power', y, 2], 1]], ['Sin', 't']], 't', 0, x)),
  // An undecided condition on the integration variable, and a jump.
  C(I(['If', ['Greater', 't', 0.5], 1, 't'], 't', 0, x), [0.5, 1]),
  C(I(['Which', ['Less', 't', y], ['Sqrt', 't'], 'True', 0], 't', 0, x), [0, 1]),
  C(I(['Floor', 't'], 't', 0, x), [1, 2]),
  // A domain that the range leaves.
  C(I(['Ln', 't'], 't', 1, x), [0, 1]),
  // The three closed forms of Tycho's corpus.
  C(I(['Multiply', 0.1, ['Sqrt', ['Add', ['Power', 't', 2], 1]]], 't', 0, x)),
  C(['Add', y, ['Negate', I(['Cos', x], 'n', ['Negate', x], x)]]),
  C(['Multiply', ['Divide', 1, ['Multiply', y, ['Sqrt', ['Multiply', 2, 'Pi']]]],
    I(['Power', 'ExponentialE', ['Multiply', ['Rational', -1, 2], ['Divide', ['Power', 'Z', 2], ['Power', y, 2]]]], 'Z', 'NegativeInfinity', x)], [0, 1]),
  // A closed form that is a conditional, one that the mode does not lower
  // (`SinIntegral`), and an integrand with none.
  C(I(['Power', 't', x], 't', 0, 1), [-1, 0]),
  C(I(['Divide', ['Sin', 't'], 't'], 't', 0, x)),
  C(I(['Sin', ['Sin', 't']], 't', 0, x)),
  // A closed form of `FresnelS`, which has no row in the IR.
  C(I(['Sin', ['Multiply', 't', 't']], 't', 0, 1)),
];

/** The programs whose result does not contain the interpreter's value at
 *  some box: none since CE-1347 (an integral whose bounds reach a piece where
 *  the integrand has no value only for some choices is `entire`, not
 *  `empty`). */
// prettier-ignore
const NOT_CONTAINED: string[] = [];

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

type Iv = { lo: number; hi: number };
type Box = Record<string, Iv>;
const WIDTHS = [0, 1e-6, 0.3, 2];

function boxes(expr: Expression, centres: number[], rnd: () => number): Box[] {
  const names = expr.unknowns.filter((v) => v === x || v === y);
  return Array.from({ length: 24 }, () => {
    const b: Box = {};
    for (const v of names) {
      const c =
        rnd() < 0.6
          ? [...centres, 0, 1, -1][Math.floor(rnd() * (centres.length + 3))]
          : (rnd() - 0.5) * 6;
      const w = WIDTHS[Math.floor(rnd() * WIDTHS.length)];
      const s = rnd();
      const lo = s < 0.33 ? c : s < 0.66 ? c - w : c - w / 2;
      b[v] = { lo, hi: lo + w };
    }
    return b;
  });
}

function pointsOf(b: Box, rnd: () => number): Record<string, number>[] {
  return Array.from({ length: 3 }, (_, k) =>
    Object.fromEntries(
      Object.entries(b).map(([v, { lo, hi }]) => [
        v,
        k === 0 ? lo : k === 1 ? hi : lo + rnd() * (hi - lo),
      ])
    )
  );
}

/** The double `v` as the exact rational the interpreter reads. */
function exact(v: number): Json {
  if (Number.isInteger(v)) return v;
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ['Rational', Number(BigInt(v * 2 ** k)), 2 ** k];
}

/** The reference of `expr`: its exact closed form when the interpreter
 *  has one (`evaluate()` leaves no integral), else `expr`, which `N()`
 *  computes by quadrature. */
const reference = (expr: Expression): Expression => {
  const closed = expr.evaluate();
  return closed.has('Integrate') || closed.has('NIntegrate') ? expr : closed;
};
const EXACT = new Set<string>();

/** The interpreter's value at `point` and the error of its quadrature
 *  (a `Measurement`), or `undefined`: no real value, or an error above
 *  1e-8 of the value (counted as skipped). */
function interpret(
  expr: Expression,
  point: Record<string, number>,
  engine: ComputeEngine = ce
): { v: number; err: number } | undefined {
  const sub = Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, engine.box(exact(v) as never)])
  );
  const n = expr.subs(sub).N();
  const err = n.operator === 'Measurement' ? Math.abs(n.ops![1].re) : 0;
  if (!(n.im === 0 && Number.isFinite(n.re) && Number.isFinite(err)))
    return undefined;
  if (err > 1e-8 * Math.max(1, Math.abs(n.re))) {
    skipped += 1;
    return undefined;
  }
  return { v: n.re, err };
}

type Kinded = { kind: string; value?: Iv };
const step = (x: number, n: number, f: (x: number) => number) => {
  for (let k = 0; k < n; k++) x = f(x);
  return x;
};

let checks = 0;
let slack = 0;
let skipped = 0;
/** The checks that pass only within the error of the quadrature, and the
 *  largest relative error that one of them used. */
let byError = 0;
let largestError = 0;

/** A value of the interpreter with an error (at most 1e-8 of it) is
 *  contained when the result meets the range of the error. */
function contains(
  got: unknown,
  value: { v: number; err: number } | undefined,
  at: string
): string[] {
  if (value === undefined) return [];
  const { v, err } = value;
  checks += 1;
  const k = got as Kinded;
  if (typeof k?.kind !== 'string') return [`${at}: not kinded ${JSON.stringify(got)}`];
  if (k.kind === 'empty') return [`${at}: empty, interpreter ${v}`];
  if (k.value === undefined) return [];
  const { lo, hi } = k.value;
  if (v >= lo && v <= hi) return [];
  if (v + err >= lo && v - err <= hi) {
    byError += 1;
    largestError = Math.max(largestError, err / Math.max(1, Math.abs(v)));
    return [];
  }
  if (v >= step(lo, 2, nextDown) && v <= step(hi, 2, nextUp)) {
    slack += 1;
    return [];
  }
  return [`${at}: ${JSON.stringify(got)}, interpreter ${v}`];
}

type Compiled = {
  success: boolean;
  code: string;
  preambleOnce?: string;
  run: (b: unknown) => unknown;
  broadcast?: (cells: unknown, o?: unknown) => Float64Array;
};
const mode = (json: Json, options: object = {}) =>
  compile(ce.box(json as never), {
    to: 'interval-js',
    profile: 'ir',
    fallback: false,
    ...options,
  } as never) as unknown as Compiled;

describe('the interval mode, integrals: containment', () => {
  test.each(CASES.map((c) => [JSON.stringify(c.json), c]))('%s', (label, c) => {
    const expr = ce.box(c.json as never);
    const ref = reference(expr);
    if (ref !== expr) EXACT.add(label);
    const r = mode(c.json);
    const rnd = random(label.length * 7919 + 17);
    const failures: string[] = [];
    for (const b of boxes(expr, c.centres ?? [], rnd)) {
      const got = r.run(b);
      for (const point of pointsOf(b, rnd)) {
        failures.push(...contains(got, interpret(ref, point), JSON.stringify(point)));
        // The exact reference is the engine's antiderivative, and so is the
        // closed form of the mode: the quadrature of the interpreter is the
        // check that does not depend on it.
        if (ref !== expr)
          failures.push(
            ...contains(got, interpret(expr, point), `${JSON.stringify(point)} (quadrature)`)
          );
      }
    }
    if (NOT_CONTAINED.includes(label)) {
      // Only the documented failure, and at least one until CE-1347 is
      // fixed.
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.filter((f) => !/: empty, interpreter /.test(f))).toEqual([]);
    } else expect(failures.slice(0, 5)).toEqual([]);
  });

  test('the count of checks, and of those that used the slack', () => {
    console.log(
      `${checks} containment checks, ${skipped} skipped (an error of the quadrature above 1e-8), ` +
        `${byError} within the error of the quadrature (largest ${largestError}), ` +
        `${slack} within the 2-ulp slack; exact references: ${EXACT.size}\n${[...EXACT].join('\n')}`
    );
    expect(checks).toBeGreaterThan(1_000);
  });
});

/** The code of `r` with each constant of `preambleOnce` written where it is
 *  read. */
const inlined = (r: { code: string; preambleOnce?: string }): string =>
  [...(r.preambleOnce ?? '').matchAll(/^const (v\d+) = (.*);$/gm)].reduce(
    (code, [, name, text]) =>
      code.replace(new RegExp(`\\b${name}\\b`, 'g'), text),
    r.code
  );

describe('the interval mode, integrals: the code', () => {
  test('a single integral with no closed form: the enclosure of 256 pieces', () => {
    expect(inlined(mode(I(['Sin', ['Sin', 't']], 't', 0, x)))).toBe(
      [
        '(() => {',
        '  const v5 = _IA.integrate((v2) => {',
        '    return _IA.sin(_IA.sin(v2));',
        '  }, { lo: 0, hi: 0 }, _.x, 256);',
        '  return v5;',
        '})()',
      ].join('\n')
    );
  });

  test('a definite closed form: integrateClosed, with the enclosure of 256 pieces', () => {
    expect(inlined(mode(I(['Sin', 't'], 't', 0, x)))).toBe(
      [
        '(() => {',
        '  const v8_f = (v6) => {',
        '    return _IA.sin(v6);',
        '  };',
        '  const v8 = _IA.integrateClosed(() => {',
        '    return _IA.sub({ lo: 1, hi: 1 }, _IA.cos(_.x));',
        '  }, v8_f, { lo: 0, hi: 0 }, _.x, 256);',
        '  return v8;',
        '})()',
      ].join('\n')
    );
  });

  test('a closed form that the mode does not lower leaves the enclosure, of the same count', () => {
    // The closed form is `SinIntegral(x)`.
    const json = I(['Divide', ['Sin', 't'], 't'], 't', 0, x);
    const r = mode(json);
    expect(r.code).not.toMatch(/integrateClosed/);
    expect(r.code).toMatch(/_IA\.integrate\([^]*, 256\);/);
    const got = r.run({ x: { lo: 0.5, hi: 2 } });
    for (const x of [0.5, 1.25, 2]) {
      const want = interpret(ce.box(json as never), { x });
      expect(want).toBeDefined();
      expect(contains(got, want, `x = ${x}`)).toEqual([]);
    }
  });

  test('a closed form that the mode cannot print is dropped and the enclosure stands alone', () => {
    // The first test that reaches `dropClosedForms()`: at machine precision
    // the closed form `2 Zeta(3)` is lowered as written, and `zeta` has no
    // kernel of the mode.
    // The engine writes the process-global precision of the big decimals.
    const saved = BigDecimal.precision;
    try {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const json = I(
        ['Divide', ['Power', 't', 2], ['Subtract', ['Exp', 't'], 1]],
        't',
        0,
        'PositiveInfinity'
      );
      const expr = machine.box(json as never);
      const options = { to: 'interval-js', fallback: false };
      const r = compile(expr, { ...options, profile: 'ir' } as never) as unknown as Compiled;
      expect(r.success).toBe(true);
      expect(`${r.preambleOnce}\n${r.code}`).not.toMatch(/integrateClosed|zeta/i);
      expect(r.code).toMatch(/_IA\.integrate\(/);
      // The enclosure over an infinite range is `entire`: it contains
      // 2ζ(3) = 2.4041138063191885.
      const got = r.run({});
      expect(got).toEqual({ kind: 'entire' });
      const v = Number(machine.box(['Multiply', 2, ['Zeta', 3]] as never).N().re);
      expect(contains(got, { v, err: 0 }, '2ζ(3)')).toEqual([]);
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test('a closed form with a vars name reads the inputs object', () => {
    const json = I('t', 't', 0, 'a');
    const vars = { vars: { a: '_.a' } };
    const r = mode(json, vars);
    expect(r.code).toMatch(/integrateClosed/);
    expect(r.code).toMatch(/_\.a/);
    for (const [a, points] of [
      [2, [2]],
      [{ lo: 1, hi: 3 }, [1, 2, 3]],
    ] as const) {
      const got = r.run({ a });
      for (const v of points) {
        const want = interpret(ce.box(json as never), { a: v });
        expect(want).toBeDefined();
        expect(contains(got, want, `a = ${v}`)).toEqual([]);
      }
    }
  });

  test('an indefinite integral is its closed form, or declines', () => {
    const r = mode(['Integrate', ['Function', ['Power', 't', 2], 't'], ['Limits', 't', 'Nothing', 'Nothing']]);
    expect(r.code).not.toMatch(/_IA\.integrate/);
    expect(r.run({ t: 3 })).toEqual({ kind: 'interval', value: { lo: 9, hi: 9 } });
    expect(() =>
      mode(['Integrate', ['Function', ['Sin', ['Sin', 't']], 't'], ['Limits', 't', 'Nothing', 'Nothing']])
    ).toThrow(/an indefinite integral with no closed form/);
  });

  test('an indefinite integral over an undeclared name is its closed form, as that form written directly', () => {
    // The engine infers the type `number` for a name used in arithmetic,
    // so `w^3/3` of an undeclared `w` compiles; the closed form of the
    // integral of `w^2` is that expression, and `w` is its input.
    const options = { to: 'interval-js', profile: 'ir', fallback: false };
    const integral = ['Integrate', ['Power', 'w', 2], ['Limits', 'w', 'Nothing', 'Nothing']];
    const direct = compile(
      new ComputeEngine().box(['Divide', ['Power', 'w', 3], 3] as never),
      options as never
    ) as unknown as Compiled;
    const r = compile(
      new ComputeEngine().box(integral as never),
      options as never
    ) as unknown as Compiled;
    expect(r.code).not.toMatch(/_IA\.integrate/);
    const [got, same] = [r.run({ w: 2 }), direct.run({ w: 2 })] as Kinded[];
    for (const v of [got, same]) {
      expect(v.value!.lo).toBeLessThanOrEqual(8 / 3);
      expect(v.value!.hi).toBeGreaterThanOrEqual(8 / 3);
    }
  });

  test('the closed form -2 of a divergent integral is refused by the scan', () => {
    const json = I(['Power', 't', -2], 't', -1, 1);
    expect(mode(json).code).toMatch(/integrateClosed/);
    expect(mode(json).run({})).toEqual({ kind: 'singular' });
  });

  test('a double integral: both of the count of the outermost, 181', () => {
    const code = mode(I(I(['Sin', ['Sin', ['Multiply', 's', 't']]], 's', 0, 't'), 't', 0, x)).code;
    expect(code.match(/_IA\.integrate\(/g)?.length).toBe(2);
    expect(code.match(/, 181\);/g)?.length).toBe(2);
  });

  test('the count through a function call', () => {
    // An integral in a user function has the count of its own subtree.
    const r = mode(I(['G', 't'], 't', 0, x));
    expect(r.code).toMatch(/, 256\);/);
    expect(r.preambleOnce).toMatch(/_IA\.integrateClosed\([^]*, 256\);/);
  });

  test('an invariant of the integrand is computed once, before the integral', () => {
    const code = mode(I(['Multiply', ['Gamma', y], ['Sin', ['Sin', 't']]], 't', 0, x)).code;
    expect(code.indexOf('_IA.gamma(')).toBeGreaterThan(-1);
    expect(code.indexOf('_IA.gamma(')).toBeLessThan(code.indexOf('_IA.integrate('));
  });

  test('NIntegrate compiles to the same enclosure', () => {
    const r = mode(['NIntegrate', ['Function', ['Sin', ['Sin', 't']], 't'], 0, x]);
    const box = { x: { lo: 1.5, hi: 2 } };
    expect(r.run(box)).toEqual(mode(I(['Sin', ['Sin', 't']], 't', 0, x)).run(box));
  });

  test('the stored result, loaded with createIntervalRuntime(), and broadcast()', () => {
    const r = mode(I(['Sin', ['Multiply', 't', y]], 't', 0, x));
    const stored = JSON.parse(JSON.stringify(r));
    const box = { x: { lo: 0.5, hi: 1.5 }, y: 2 };
    expect(createIntervalRuntime().load(stored)(box)).toEqual(r.run(box));
    const cells = { x: new Float64Array([0, 0.5, 1, 2]), y: new Float64Array([2, 2, 3, 3]) };
    const out = r.broadcast!(cells);
    const one = r.run({ x: { lo: 1, hi: 2 }, y: 3 }) as Kinded;
    expect([out[3], out[4]]).toEqual([one.value!.lo, one.value!.hi]);
  });
});

describe('the interval mode, integrals: review round 1', () => {
  test('in degrees there is no closed form: the enclosure contains the value', () => {
    const deg = new ComputeEngine();
    deg.declare('x', 'real');
    deg.angularUnit = 'deg';
    const json = I(['Sin', 't'], 't', 0, x);
    const expr = deg.box(json as never);
    const r = compile(expr, { to: 'interval-js', profile: 'ir', fallback: false } as never) as unknown as Compiled;
    expect(r.code).not.toMatch(/integrateClosed/);
    for (const [lo, hi] of [[90, 90], [89, 91], [80, 100]]) {
      const got = r.run({ x: { lo, hi } }) as Kinded;
      for (const v of [lo, hi, (lo + hi) / 2]) {
        // ∫ sin(t°) dt from 0 to v is (180/π)(1 − cos(v°)).
        const value = (180 / Math.PI) * (1 - Math.cos((v * Math.PI) / 180));
        expect(got.value!.lo).toBeLessThanOrEqual(value + 1e-12);
        expect(got.value!.hi).toBeGreaterThanOrEqual(value - 1e-12);
      }
    }
    // With no closed form, the integrand is scaled once.
    const none = deg.box(I(['Sin', ['Sin', 't']], 't', 0, x) as never);
    const a = compile(none, { to: 'interval-js', profile: 'ir', fallback: false } as never) as unknown as Compiled;
    const got = a.run({ x: { lo: 89, hi: 91 } });
    for (const v of [89, 90, 91]) {
      const want = interpret(none, { x: v }, deg);
      expect(want).toBeDefined();
      expect(contains(got, want, `x = ${v}`)).toEqual([]);
    }
  });

  test('in degrees an indefinite integral declines, with its own reason', () => {
    const deg = new ComputeEngine();
    deg.declare('x', 'real');
    deg.angularUnit = 'deg';
    // The antiderivative of sin, at x: no bounds.
    const expr = deg.box(['Integrate', ['Sin', 'x'], 'x'] as never);
    expect(() =>
      compile(expr, { to: 'interval-js', profile: 'ir', fallback: false } as never)
    ).toThrow(/an angular unit other than radians/);
  });

  test('NIntegrate is a level in the mode only: the existing target keeps its count', () => {
    const inner = ['NIntegrate', ['Function', ['Sin', ['Sin', 's']], 's'], 0, 1];
    const args = (ce.box(I(['Multiply', 't', inner], 't', 0, x) as never) as never as { ops: Expression[] }).ops;
    // The existing target sizes with `Integrate` nodes only.
    expect(intervalQuadratureSize(args, 1).n).toBe(256);
    expect(intervalQuadratureSize(args, 1, true).n).toBe(181);
    const r = mode(I(['Multiply', 't', inner], 't', 0, x));
    expect(r.code.match(/, 181\);/g)).toHaveLength(2);
    // No closed form over an `NIntegrate`: the engine would give
    // `x^2/2` times the number that its quadrature finds, as a point.
    expect(r.code).not.toMatch(/integrateClosed/);
    const got = r.run({ x: 1 }) as Kinded;
    const v = ce.box(inner as never).N().re / 2;
    expect(got.value!.lo).toBeLessThan(v);
    expect(got.value!.hi).toBeGreaterThan(v);
    // The same through a user function: the engine's `evaluate()` reads
    // its body, so the closed form would hold the number with no call.
    const fn = new ComputeEngine();
    fn.declare('x', 'real');
    fn.declare('g', '(real) -> real');
    fn.assign('g', fn.box(['Function', ['Multiply', 'u', inner], 'u'] as never));
    const s = compile(fn.box(I(['g', 't'], 't', 0, x) as never), {
      to: 'interval-js',
      profile: 'ir',
      fallback: false,
    } as never) as unknown as Compiled;
    expect(s.code).not.toMatch(/integrateClosed/);
    const through = s.run({ x: 1 }) as Kinded;
    expect(through.value!.lo).toBeLessThan(v);
    expect(through.value!.hi).toBeGreaterThan(v);
  });

  test('a part of the integrand that can throw is not computed before an empty range', () => {
    ce.declare('L', 'list<real>');
    const r = mode(['NIntegrate', ['Function', ['Sum', 'L'], 't'], 0, x], { iterationBudget: 1 });
    expect(r.run({ L: [1, 2], x: 0 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
  });

  test('an integral in an integrand is not hoisted: its node keeps its own count elsewhere', () => {
    const inner = I(['Sin', ['Sin', 's']], 's', 0, 1);
    const code = mode(['Add', I(['Multiply', inner, ['Sin', ['Sin', 't']]], 't', 0, x), inner]).code;
    // The nest: two integrals of 181 pieces; the node after it: 256.
    expect(code.match(/, 181\);/g)?.length).toBe(2);
    expect(code.match(/, 256\);/g)?.length).toBe(1);
  });

  test('a nest of NIntegrate is sized as a nest of Integrate', () => {
    const json = ['NIntegrate', ['Function', ['NIntegrate', ['Function', ['Sin', ['Sin', ['Multiply', 's', 't']]], 's'], 0, 't'], 't'], 0, x];
    expect(mode(json).code.match(/, 181\);/g)?.length).toBe(2);
  });
});

describe('the interval mode, integrals: results', () => {
  test('a pole inside the range is singular', () => {
    expect(mode(I(['Divide', 1, 't'], 't', -1, x)).run({ x: 1 })).toEqual({ kind: 'singular' });
  });

  test('an empty range is 0; reversed bounds are the opposite', () => {
    const f = ['Sin', ['Sin', 't']];
    expect(mode(I(f, 't', x, 1)).run({ x: 1 })).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
    const a = mode(I(f, 't', 0, x)).run({ x: 1 }) as Kinded;
    const b = mode(I(f, 't', x, 0)).run({ x: 1 }) as Kinded;
    expect(b.value).toEqual({ lo: -a.value!.hi, hi: -a.value!.lo });
  });

  test('a constant integrand encloses its exact value', () => {
    const v = (mode(I(3, 't', 0, x)).run({ x: 2 }) as Kinded).value!;
    expect(v.lo).toBeLessThanOrEqual(6);
    expect(v.hi).toBeGreaterThanOrEqual(6);
    expect(v.hi - v.lo).toBeLessThan(1e-11);
  });

  test('an undecided integrand is the hull of its arms on the pieces', () => {
    const r = mode(I(['If', ['Greater', 't', 0.5], 1, 't'], 't', 0, x)).run({ x: 1 }) as Kinded;
    // The exact value is 0.125 + 0.5.
    expect(r.kind).toBe('interval');
    expect(r.value!.lo).toBeLessThanOrEqual(0.625);
    expect(r.value!.hi).toBeGreaterThanOrEqual(0.625);
  });

  test('an infinite or NaN bound at run time is entire, not a throw', () => {
    const r = mode(I(['Sin', ['Sin', 't']], 't', 0, x));
    for (const v of [Infinity, -Infinity, NaN, { lo: NaN, hi: 1 }, { lo: 0, hi: Infinity }])
      expect(r.run({ x: v })).toEqual({ kind: 'entire' });
    // A closed form with an infinite bound is the closed form: the scan has
    // no range to read.
    const json = I(['Exp', ['Negate', ['Power', 't', 2]]], 't', 'NegativeInfinity', x);
    const g = mode(json).run({ x: 0 }) as Kinded;
    expect(g.value!.lo).toBeLessThanOrEqual(Math.sqrt(Math.PI) / 2);
    expect(g.value!.hi).toBeGreaterThanOrEqual(Math.sqrt(Math.PI) / 2);
  });
});

describe('the interval mode, integrals: declines', () => {
  /** A chain of `depth` integrals, each in the integrand of the next. */
  const chain = (depth: number): Json => {
    let json: Json = ['Sin', ['Add', 'z0', x]];
    for (let k = 1; k <= depth; k++)
      json = I(['Sin', ['Add', `z${k}`, json]], `z${k - 1}`, 0, 1);
    return json;
  };

  test('an integral of fewer than 4 pieces declines, with its reason', () => {
    const reason = /an honest interval enclosure — this integral's subtree reaches 9 integral runs nested 9 levels deep/;
    expect(() => mode(chain(9))).toThrow(reason);
    // Six levels have 4 pieces each.
    expect(mode(chain(6)).code.match(/, 4\);/g)?.length).toBe(6);
  });

  test.each([
    [
      ['Integrate', ['Function', ['Multiply', x, 'q'], x, 'q'], ['Limits', x, 0, 1], ['Limits', 'q', 0, 1]],
      /an integral that is not of one variable and two bounds/,
    ],
    [['Integrate', ['Function', ['Add', 'q', 't'], 't', 'q'], ['Limits', 't', 0, 1]], /an integrand that is not a function of one variable/],
  ])('%j', (json, cause) => {
    expect(() => mode(json)).toThrow(cause);
  });

  test('an integrand that reads a vars entry declines (a read of the host is an effect)', () => {
    expect(() => mode(I(['Multiply', 'a', 't'], 't', 0, 1), { vars: { a: '_.a' } })).toThrow(
      /an integrand with an effect/
    );
  });
});

describe('the interval mode, integrals: robustness', () => {
  test('a triple integral: 27 pieces at each level', () => {
    const json = I(I(I(['Multiply', 'r', 's', 't'], 'r', 0, 's'), 's', 0, 't'), 't', 0, x);
    const r = mode(json);
    expect(r.code.match(/, 27\);/g)?.length).toBe(3);
    // 1/48 at x = 1.
    const v = (r.run({ x: 1 }) as Kinded).value!;
    expect(v.lo).toBeLessThanOrEqual(1 / 48);
    expect(v.hi).toBeGreaterThanOrEqual(1 / 48);
  });

  test(
    'a chain of 4 functions, each integrating the previous one, ends within the run-time cap',
    () => {
      const c = new ComputeEngine();
      c.declare('x', 'real');
      const names = ['h1', 'h2', 'h3', 'h4'];
      names.forEach((h, k) => {
        c.declare(h, '(real) -> real');
        c.assign(
          h,
          c.box(['Function', I(k === 0 ? ['Sin', ['Sin', 's']] : [names[k - 1], 's'], 's', 0, 'u'), 'u'] as never)
        );
      });
      const r = compile(c.box(I(['h4', 't'], 't', 0, x) as never), {
        to: 'interval-js',
        profile: 'ir',
        fallback: false,
      } as never) as unknown as Compiled;
      // Each function has its own count; the cap of the library bounds the
      // product (`INTERVAL_NESTED_QUADRATURE_BUDGET`).
      expect(r.preambleOnce?.match(/, 256\);/g)?.length).toBe(4);
      expect(r.run({ x: { lo: 0.5, hi: 0.6 } })).toEqual({ kind: 'entire' });
    },
    // A guard against a hang only: the run takes well under a second.
    60_000
  );
});

describe('the interval mode, integrals: batch 19', () => {
  ce.assign('gr', ce.box(['Function', ['Add', 'u', ['Random']], 'u'] as never));

  test.each([
    I('t', 't', 0, ['Random']),
    I('t', 't', ['Random'], 1),
    I(['Multiply', 't', x], 't', 0, ['Add', x, ['Random']]),
    I('t', 't', 0, ['gr', x]),
  ].map((json) => [json]))('a draw in a bound: no closed form, the draw once: %j', (json) => {
    // The engine's closed form would hold one draw, made at compile time,
    // where the bound encloses every draw.
    const r = mode(json);
    expect(r.code).not.toMatch(/integrateClosed/);
    expect(`${r.preambleOnce ?? ''}\n${r.code}`.match(/\{ lo: 0, hi: 1 \}/g)).toHaveLength(1);
    const got = r.run({ x: { lo: 0.5, hi: 0.5 } });
    const expr = ce.box(json as never).subs({ x: ce.box(['Rational', 1, 2] as never) });
    for (let k = 0; k < 8; k++)
      expect(contains(got, { v: expr.N().re, err: 1e-9 }, `draw ${k}`)).toEqual([]);
    // A pure integral keeps its closed form.
    expect(mode(I('t', 't', 0, x)).code).toMatch(/integrateClosed/);
  });

  test('an indefinite integral of an integrand with a draw declines', () => {
    expect(() => mode(['Integrate', ['Add', 't', ['Random']], 't'])).toThrow(
      /an integrand with an effect/
    );
  });

  test('with an infinite bound no invariant is computed before the integral', () => {
    // `_IA.integrate` answers `entire` with no call of the integrand.
    const json = I(['Multiply', ['Gamma', y], ['Sin', ['Sin', 't']]], 't', x, 'PositiveInfinity');
    const r = mode(json);
    expect(r.code.indexOf('_IA.gamma(')).toBeGreaterThan(r.code.indexOf('_IA.integrate('));
    const box = { x: { lo: 0, hi: 1 }, y: { lo: 1, hi: 2 } };
    expect(r.run(box)).toEqual({ kind: 'entire' });
  });
});
