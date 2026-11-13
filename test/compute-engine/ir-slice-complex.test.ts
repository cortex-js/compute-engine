/**
 * The slice compiler (`src/compute-engine/compilation/ir/`): the complex
 * lane and the names with a value, against the interpreter. The complex
 * rows at points on and off their branch cuts and at their poles, in the
 * `strict` and the `complex` mode; real operands that leave the reals in
 * the `complex` mode, and those that stay real; complex literals, inputs
 * and lists; the public `compile()` with `entryChecks` and `symbolDeps`.
 */

import { compile } from '../../src/compile';
import {
  compileSlice,
  Decline,
  sliceProgram,
} from '../../src/compute-engine/compilation/ir';
import { javascriptRuntime } from '../../src/compute-engine/compilation/ir/print-js';
import { COMPLEX_FUNCTIONS } from '../../src/compute-engine/compilation/ir/operators';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  agrees,
  interpret,
  TOLERANCE,
  makeEngine,
  sameBits,
  type Complex,
  type Point,
} from './ir-slice-oracle';

const ce = makeEngine();

type Json = unknown;
type Mode = 'strict' | 'complex';

const box = (json: Json): Expression => ce.box(json as never);

const run = (json: Json, point: Point, mode: Mode = 'strict', passes = true) =>
  compileSlice(box(json), {
    target: 'javascript',
    mode,
    passes: passes ? undefined : false,
  }).run(point);

function declineOf(f: () => unknown): Decline {
  try {
    f();
  } catch (e) {
    if (e instanceof Decline) return e;
    throw e;
  }
  throw new Error('no decline');
}

const isComplex = (v: unknown): v is Complex =>
  typeof v === 'object' && v !== null && 're' in v;

// The points: complex values off the axes, on the negative real axis (the
// cut of `Sqrt` and `Ln`), on the real axis past 1 (the cut of `Arcsin`,
// `Arccos`, `Artanh`), on the imaginary axis past `i` (the cut of
// `Arctan`), at 0, `±1` and `±i` (poles), and real values that leave the
// reals. (A large part overflows in `Exp` and `Coth`, where the
// interpreter has its own defects, CE-1211.)
// prettier-ignore
const Z_VALUES: Complex[] = [
  { re: 1.5, im: -0.5 }, { re: -2, im: 3 }, { re: -4, im: 0 }, { re: 2, im: 0 },
  { re: 0, im: -3 }, { re: 0, im: 2 }, { re: 0, im: 0 }, { re: 1, im: 0 },
  { re: -1, im: 0 }, { re: 0, im: 1 }, { re: 0.25, im: 0.75 }, { re: -0.5, im: 1e-3 },
  { re: 3, im: -2 },
];
const X_VALUES = [-4, -1.25, -1, -0.5, 0, 0.5, 1, 2, 3.7];

function points(expr: Expression): Point[] {
  const names = expr.unknowns;
  const out: Point[] = [];
  for (let i = 0; i < Z_VALUES.length; i++) {
    const p: Point = {};
    if (names.includes('Z')) p.Z = Z_VALUES[i];
    if (names.includes('W')) p.W = Z_VALUES[(i + 5) % Z_VALUES.length];
    if (names.includes('x')) p.x = X_VALUES[i % X_VALUES.length];
    if (names.includes('y')) p.y = X_VALUES[(i + 4) % X_VALUES.length];
    if (names.includes('n')) p.n = (i % 5) - 2;
    if (names.includes('C'))
      p.C = [Z_VALUES[i], Z_VALUES[(i + 1) % Z_VALUES.length]];
    out.push(p);
  }
  return out;
}

const hasNaN = (v: unknown) =>
  isComplex(v) ? Number.isNaN(v.re) || Number.isNaN(v.im) : Number.isNaN(v);
const finite = (v: unknown) =>
  isComplex(v)
    ? Number.isFinite(v.re) && Number.isFinite(v.im)
    : Number.isFinite(v);

/** Whether `json` or a sub-expression of it has a value at `point` that
 *  `test` holds of. */
function some(json: Json, point: Point, test: (v: unknown) => boolean) {
  if (!Array.isArray(json)) return false;
  if (test(interpret(ce, box(json), point))) return true;
  return json.slice(1).some((op) => some(op, point, test));
}

/** A value that is not a finite number: an infinity, `ComplexInfinity`,
 *  no number, or a complex with an infinite part. */
const infinite = (v: unknown) =>
  v === 'none' ||
  v === 'complex-infinity' ||
  (typeof v === 'number' && !Number.isFinite(v) && !Number.isNaN(v)) ||
  (isComplex(v) && !finite(v));

/** `point` with its number `slot` (each part of a complex is one; every
 *  number when `slot` is -1) moved by `k` ulps, a zero to `k` times the
 *  least double, which flips the side of a cut; and the count of numbers. */
function nudged(point: Point, k: number, slot = -1): [Point, number] {
  let n = 0;
  const x = (v: number) =>
    slot !== -1 && n++ !== slot
      ? v
      : v === 0
        ? k * Number.MIN_VALUE
        : v + k * Math.abs(v) * Number.EPSILON;
  const move = (v: unknown): unknown =>
    typeof v === 'number'
      ? x(v)
      : Array.isArray(v)
        ? v.map(move)
        : isComplex(v)
          ? { re: x(v.re), im: x(v.im) }
          : v;
  const p = Object.fromEntries(
    Object.entries(point).map(([name, v]) => [name, move(v)])
  ) as Point;
  return [p, n];
}

/** The parts of a value: a number, or the two parts of a complex. */
const parts = (v: unknown): number[] | undefined =>
  typeof v === 'number' ? [v, 0] : isComplex(v) ? [v.re, v.im] : undefined;

/** The interpreter's value of `expr` changes beyond the tolerance when the
 *  inputs move by ±4 ulps, all together or one number at a time (an
 *  ill-conditioned point: a branch point, a
 *  pole, a cut, a cancellation), and the compiled value `v` lies, per
 *  part, in the interval of the interpreter's values at the point and the
 *  moved points, widened by the tolerance: the function's value at an
 *  argument within a few ulps
 *  (docs/plans/2026-11-12-js-route-course-correction.md, rule 1). */
function illConditioned(
  expr: Expression,
  point: Point,
  expected: unknown,
  v: unknown
): boolean {
  const slots = nudged(point, 4, Infinity)[1];
  const moved = [4, -4].flatMap((k) =>
    [-1, ...Array.from({ length: slots }, (_, i) => i)].map((slot) =>
      interpret(ce, expr, nudged(point, k, slot)[0])
    )
  );
  if (!moved.some((m) => m !== 'engine-error' && !agrees(m, expected as never)))
    return false;
  const all = [expected, ...moved].map(parts);
  const p = parts(v);
  if (p === undefined || all.some((x) => x === undefined)) return false;
  return p.every((x, k) => {
    const ends = all.map((a) => a![k]);
    const [lo, hi] = [Math.min(...ends), Math.max(...ends)];
    const t = TOLERANCE * Math.max(1, Math.abs(lo), Math.abs(hi));
    return x >= lo - t && x <= hi + t;
  });
}

/** The points that the moved-point test cannot classify: a complex kernel
 *  of a NaN operand gives a finite value (`_SYS.cacsc` of NaN is 0, the
 *  known limitation proposed in the cov2 issue texts), reached from
 *  `Arcsec(0)`, which is NaN. */
const KNOWN = new Set([
  '["Power",["Arccsc",["Arcsec","Z"]],["Divide",["Power",["Complex",0,1],-0.5],["Multiply","x",2]]] {"Z":{"re":0,"im":0},"x":1}',
]);

/**
 * The agreement of a compiled value with the interpreter in `mode`. In the
 * `complex` mode a complex value of the interpreter is not a scalar NaN. In
 * the `strict` mode a NaN agrees when a sub-expression has a complex value
 * at that point: an operation of the real lane outside its real domain is
 * NaN (the caveat of the `strict` mode), and the NaN reaches the result
 * (`Ln(x)·y` at `x = -4`, `y = 0`, where the interpreter gives 0). A value
 * that is not finite agrees where a sub-expression's interpreter value is
 * not finite, and any value agrees at an ill-conditioned point.
 */
function check(json: Json, mode: Mode): string[] {
  const expr = box(json);
  const failures: string[] = [];
  for (const point of points(expr)) {
    const expected = interpret(ce, expr, point);
    if (expected === 'engine-error') continue;
    const on = run(json, point, mode, true);
    const off = run(json, point, mode, false);
    if (!sameBits(on, off))
      failures.push(`${JSON.stringify(json)}: passes on and off differ`);
    const nan = mode === 'complex' && isComplex(expected) && !isComplex(on);
    if (!nan && agrees(on, expected)) continue;
    if (mode === 'strict' && hasNaN(on) && some(json, point, isComplex))
      continue;
    if (!finite(on) && some(json, point, (v) => infinite(v) || hasNaN(v)))
      continue;
    if (illConditioned(expr, point, expected, on)) continue;
    if (KNOWN.has(`${JSON.stringify(json)} ${JSON.stringify(point)}`)) continue;
    failures.push(
      `${JSON.stringify(json)} ${mode} at ${JSON.stringify(point)}: ${JSON.stringify(on)}, interpreter ${JSON.stringify(expected)}`
    );
  }
  return failures;
}

// The interpreter's `Log` of a complex number of a real part that is a
// perfect square is the logarithm of the real part (CE-1208's family):
// `Log` of a complex input is tested by value below.
// prettier-ignore
const UNARY = ['Negate', 'Sqrt', 'Exp', 'Ln', 'Sin', 'Cos', 'Tan', 'Arctan', 'Arcsin',
  'Arccos', 'Arccot', 'Arcsec', 'Arccsc', 'Coth', 'Arsinh', 'Arcosh', 'Artanh', 'Arcoth',
  'Arsech', 'Arcsch', 'Abs', 'Real', 'Imaginary', 'Conjugate', 'Argument'];
const BINARY = ['Add', 'Subtract', 'Multiply', 'Divide', 'Power', 'Root'];

describe('IR slice: the complex rows against the interpreter', () => {
  test.each(UNARY)('%s of a complex input', (h) =>
    expect(check([h, 'Z'], 'strict')).toEqual([])
  );
  test.each([...UNARY, 'Log'])('%s of a real input in the complex mode', (h) =>
    expect(check([h, 'x'], 'complex')).toEqual([])
  );
  test('Log of a complex input is the base-10 logarithm', () => {
    const v = run(['Log', 'Z'], { Z: { re: 4, im: 1 } }) as Complex;
    expect(v.re).toBeCloseTo(Math.log10(Math.hypot(4, 1)), 15);
    expect(v.im).toBeCloseTo(Math.atan2(1, 4) / Math.LN10, 15);
  });
  test.each(BINARY)('%s of complex, mixed and real operands', (h) => {
    for (const json of [
      [h, 'Z', 'W'],
      [h, 'Z', 'x'],
      [h, 'x', 'Z'],
    ])
      expect(check(json, 'strict')).toEqual([]);
    expect(check([h, 'x', 'y'], 'complex')).toEqual([]);
  });
  // prettier-ignore
  const PROGRAMS: Json[] = [
    ['Add', 'Z', 'W', 'x'], ['Multiply', 2, 'Z', 'x'], ['Add', ['Multiply', 'ImaginaryUnit', 'x'], 1],
    ['Add', ['Complex', 1, 2], 'x'], ['Multiply', ['Complex', 0, -1.5], 'Z'],
    ['Power', 'Z', 2], ['Power', 'Z', 0.5], ['Power', 'ExponentialE', 'Z'], ['Power', 2, 'Z'],
    ['Divide', 1, 'Z'], ['Divide', 'Z', 0], ['Exp', ['Multiply', 'ImaginaryUnit', 'x']],
    ['Abs', ['Subtract', 'Z', 'W']], ['Argument', ['Negate', 'Z']], ['Real', ['Multiply', 'Z', 'W']],
    ['If', ['Less', 'x', 0], 'Z', 'x'], ['If', ['Less', 'x', 0], 1, ['Sqrt', 'Z']],
    ['Which', ['Less', 'x', 0], 'Z', ['Less', 'x', 1], 'W', 'True', 'x'],
    ['Sum', ['Power', 'Z', 'k'], ['Limits', 'k', 0, 5]],
    ['Product', ['Add', 'Z', 'k'], ['Limits', 'k', 1, 3]],
    ['Sum', ['Divide', 'x', ['Add', 'Z', 'k']], ['Limits', 'k', 1, 'n']],
    ['Equal', 'Z', 'W'], ['NotEqual', 'Z', 1], ['Equal', ['Conjugate', ['Conjugate', 'Z']], 'Z'],
    ['Sum', ['List', 'Z', 'W']], ['Product', ['List', 'Z', 'x', 'W']],
    ['Multiply', ['List', 'Z', 'W'], 'Z'], ['Abs', ['List', 'Z', 'W']], ['Add', ['List', 'Z', 1], 'x'],
    ['At', ['List', 'Z', 'W'], 2], ['List', 'Z', 'x', 1],
    ['Map', ['Function', ['Multiply', 'q', 'q'], 'q'], ['List', 'Z', 'W', 'x']],
    ['Reduce', ['List', 'Z', 'W'], 'Add', 0],
    ['Block', ['Declare', 't', 'complex', 'Z'], ['Assign', 't', ['Multiply', 't', 't']], 't'],
    ['Block', ['Declare', 't', 'complex', 'x'], ['Assign', 't', ['Add', 't', 'Z']], 't'],
    ['Sqrt', ['Multiply', 'Z', 'Z']], ['Ln', ['Exp', 'Z']], ['Sin', ['Arcsin', 'Z']],
  ];
  test.each(PROGRAMS.map((j) => [JSON.stringify(j), j]))('%s', (_, json) => {
    expect(check(json, 'strict')).toEqual([]);
    expect(check(json, 'complex')).toEqual([]);
  });
  // prettier-ignore
  const REAL_LEAVING: Json[] = [
    ['Sqrt', 'x'], ['Ln', 'x'], ['Power', 'x', 0.5], ['Power', 'x', 'y'], ['Root', 'x', 2],
    ['Arcsin', 'x'], ['Arccos', ['Multiply', 2, 'x']], ['Artanh', 'x'], ['Arcosh', 'x'],
    ['Add', ['Sqrt', 'x'], ['Sqrt', 'y']], ['Multiply', ['Ln', 'x'], 'y'],
    ['Sum', ['Sqrt', ['Subtract', 'k', 2]], ['Limits', 'k', 0, 4]],
    ['If', ['Less', 'x', 0], ['Sqrt', 'x'], 'x'],
  ];
  test.each(REAL_LEAVING.map((j) => [JSON.stringify(j), j]))(
    '%s in both modes',
    (_, json) => {
      expect(check(json, 'strict')).toEqual([]);
      expect(check(json, 'complex')).toEqual([]);
    }
  );
});

describe('IR slice: the complex mode', () => {
  test('a real input that leaves the reals is complex: Sqrt(x) at -4 is 2i', () => {
    expect(run(['Sqrt', 'x'], { x: -4 }, 'complex')).toEqual({ re: 0, im: 2 });
    expect(run(['Sqrt', 'x'], { x: 4 }, 'complex')).toEqual({ re: 2, im: 0 });
    // The default mode: NaN outside the real domain, as before.
    expect(run(['Sqrt', 'x'], { x: -4 })).toBeNaN();
    expect(run(['Arcsin', 'x'], { x: 2 }, 'complex')).toEqual({
      re: Math.PI / 2,
      im: -1.3169578969248166,
    });
  });
  test('an operand that the type proves in the real domain stays real', () => {
    for (const [json, point, value] of [
      [['Sqrt', ['Abs', 'x']], { x: -4 }, 2],
      [['Power', 'x', 2], { x: -3 }, 9],
      [['Power', 'x', 'n'], { x: -2, n: 3 }, -8],
      [['Ln', ['Add', ['Power', 'x', 2], 1]], { x: 0 }, 0],
      [['Sqrt', 4], {}, 2],
      [['Add', 'x', 1], { x: 1 }, 2],
    ] as [Json, Point, number][])
      expect([json, run(json, point, 'complex')]).toEqual([json, value]);
  });
  test('the sign of a name bound by the walk is not the engine symbol of that name', () => {
    // The engine's `t` would be nonnegative; the local is -4.
    const engine = makeEngine();
    engine.assign('t', 5);
    const json = ['Block', ['Declare', 't', 'real', -4], ['Sqrt', 't']];
    expect(
      compileSlice(engine.box(json as never), {
        target: 'javascript',
        mode: 'complex',
      }).run({})
    ).toEqual({ re: 0, im: 2 });
  });
  test('a comparison of complex values declines; equality does not', () => {
    for (const json of [
      ['Less', 'Z', 1],
      ['Max', 'Z', 'W'],
      ['Floor', 'Z'],
      ['Mod', 'Z', 2],
    ])
      expect(
        declineOf(() => sliceProgram(box(json), { target: 'javascript' }))
      ).toBeInstanceOf(Decline);
    expect(
      declineOf(() =>
        sliceProgram(box(['Less', ['Sqrt', 'x'], 1]), {
          target: 'javascript',
          mode: 'complex',
        })
      ).cause
    ).toMatch(/Less of complex/);
    expect(
      run(['Equal', 'Z', 'W'], { Z: { re: 1, im: 2 }, W: { re: 1, im: 2 } })
    ).toBe(true);
  });
  test('a complex seed and an index of a complex list that can be out of range decline', () => {
    for (const [json, cause] of [
      [['WithRandomSeed', 'Z', ['Random']], /a seed that is not a number/],
      [['At', ['List', 'Z', 'W'], 'n'], /of complex numbers/],
    ] as [Json, RegExp][])
      expect(
        declineOf(() => sliceProgram(box(json), { target: 'javascript' })).cause
      ).toMatch(cause);
  });
  test('GLSL declines the complex lane', () => {
    const d = declineOf(() =>
      compileSlice(box(['Add', 'Z', 1]), { target: 'glsl' })
    );
    expect(d.cause).toMatch(/the lane complex on glsl/);
  });
  test('the runtime members of COMPLEX_FUNCTIONS are not replaced by another member', () => {
    const rt = javascriptRuntime(undefined) as Record<string, unknown>;
    for (const [k, f] of Object.entries(COMPLEX_FUNCTIONS))
      expect([k, rt[k] === f]).toEqual([k, true]);
  });
  test('random programs of the complex lane agree with the interpreter', () => {
    let s = 20261113;
    const random = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(xs: readonly T[]): T =>
      xs[Math.floor(random() * xs.length)];
    const term = (d: number): Json =>
      d <= 0 || random() < 0.25
        ? pick(['Z', 'W', 'x', 2, -0.5, ['Complex', 0, 1]])
        : random() < 0.5
          ? [pick(UNARY), term(d - 1)]
          : [pick(BINARY.slice(0, 5)), term(d - 1), term(d - 1)];
    const failures: string[] = [];
    for (let i = 0; i < 300; i++) {
      const json = term(3);
      try {
        failures.push(...check(json, pick(['strict', 'complex'] as const)));
      } catch (e) {
        if (!(e instanceof Decline)) throw e;
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('IR slice: names with a value', () => {
  test('a number, a list and a complex number are literals; a closed expression declines', () => {
    const engine = makeEngine();
    engine.assign('v', 10);
    engine.assign('lst', engine.box(['List', 1, 2, 3] as never));
    // `Sqrt(2)` is a number of the engine (an exact radical); `Pi + 1` is not.
    engine.assign('r2', engine.box(['Sqrt', 2] as never));
    engine.assign('s2', engine.box(['Add', 'Pi', 1] as never));
    engine.assign('zc', engine.box(['Complex', 1, 2] as never));
    const js = (json: Json) =>
      compileSlice(engine.box(json as never), { target: 'javascript' });
    expect(js(['Add', 'v', 'x']).run({ x: 1 })).toBe(11);
    expect(js(['Add', 'lst', 'x']).run({ x: 1 })).toEqual([2, 3, 4]);
    expect(js(['Multiply', 'r2', 'x']).run({ x: 2 })).toBeCloseTo(
      2 * Math.SQRT2,
      15
    );
    expect(declineOf(() => js(['Multiply', 's2', 'x'])).cause).toMatch(
      /not a number or a list of numbers/
    );
    expect(js(['Add', 'zc', 'x']).run({ x: 1 })).toEqual({ re: 2, im: 2 });
    expect(js(['Add', 'v', 'x']).program.captures).toEqual(['v']);
  });
  test('a reassignment after the compilation leaves the code unchanged; the name is a dependency', () => {
    const engine = makeEngine();
    engine.assign('v', 10);
    const deps = new Set<string>();
    const refs = new Set<string>();
    const r = compile(engine.box(['Add', 'v', 'x'] as never), {
      profile: 'ir',
      fallback: false,
      symbolDeps: deps,
      varsObjectRefs: refs,
    } as never) as { run: (v: object) => unknown; freeSymbols: string[] };
    engine.assign('v', 20);
    expect(r.run({ x: 1 })).toBe(11);
    expect([...deps]).toEqual(['v']);
    expect([...refs]).toEqual(['x']);
    expect(r.freeSymbols).toEqual(['x']);
    // The inputs object is not read for a name with a value: the value
    // fixed at compile time is used (the existing compiler emits `10 + _.x`).
    expect(r.run({ x: 1, v: 99 })).toBe(11);
  });
  test('a value that is a draw, an expression with a free name, a tuple or a function declines', () => {
    const engine = makeEngine();
    engine.assign('r', engine.box(['Random'] as never));
    engine.assign('tp', engine.box(['Tuple', 1, 2] as never));
    for (const json of [
      ['Add', 'r', 1],
      ['Add', 'hx', 1],
      ['Add', ['At', 'tp', 1], 1],
    ])
      expect(
        declineOf(() =>
          compileSlice(engine.box(json as never), { target: 'javascript' })
        ).cause
      ).toMatch(/a symbol with a value that is not/);
  });
  test('the value is that of the innermost binding of the name', () => {
    // As the interpreter reads a symbol that is not a call: a scope pushed
    // after the expression was boxed, that declares its name, is read.
    const engine = makeEngine();
    engine.assign('v', 2);
    const expr = engine.box(['Multiply', 'v', 'x'] as never);
    engine.pushScope();
    engine.declare('v', 'real');
    engine.assign('v', 10);
    expect(compileSlice(expr, { target: 'javascript' }).run({ x: 1 })).toBe(10);
    engine.popScope();
  });
  test('a name with a value read in a user function body declines', () => {
    // The interpreter reads the binding of the body (6 below), not the one
    // of the name where the call is compiled (100).
    const engine = makeEngine();
    engine.assign('v', 3);
    engine.assign(
      'gv',
      engine.box(['Function', ['Multiply', 'a', 'v'], 'a'] as never)
    );
    const call = engine.box(['gv', 'x'] as never);
    engine.pushScope();
    engine.declare('v', 'real');
    engine.assign('v', 100);
    expect(interpret(engine, call, { x: 2 })).toBe(6);
    for (const json of [
      ['gv', 'x'],
      ['Block', ['Declare', 'v', 'real', 50], ['gv', 'x']],
    ])
      expect(
        declineOf(() =>
          compileSlice(engine.box(json as never), { target: 'javascript' })
        ).cause
      ).toMatch(/reads v, which is not a parameter/);
    engine.popScope();
  });
  test('a value that is not a number or a list of numbers declines; the name is the dependency', () => {
    const engine = makeEngine();
    engine.assign('r', engine.box(['Random'] as never));
    engine.assign('vr', engine.box(['Add', 'r', 1] as never));
    expect(
      declineOf(() =>
        compileSlice(
          engine.box(['WithRandomSeed', 1, ['Add', 'vr', 'x']] as never),
          { target: 'javascript' }
        )
      ).cause
    ).toMatch(/a symbol with a value that is not/);
    // A value with a name: the name has a binding of its own, which the
    // interpreter reads (an outer `a2` = 2 gives 3 below, where the
    // innermost `a2` = 10 would give 11).
    engine.assign('a2', 2);
    engine.assign('v2', engine.box(['Add', 'a2', 1] as never));
    engine.pushScope();
    engine.declare('a2', 'real');
    engine.assign('a2', 10);
    for (const json of [
      ['Add', 'v2', 'x'],
      ['Add', 'GoldenRatio', 'x'],
    ])
      expect(
        declineOf(() =>
          compileSlice(engine.box(json as never), { target: 'javascript' })
        ).cause
      ).toMatch(/a symbol with a value that is not/);
    engine.popScope();
    engine.assign('w2', engine.box(['List', 1, ['Rational', 1, 2]] as never));
    const deps = new Set<string>();
    const r = compile(engine.box(['Add', 'w2', 'x'] as never), {
      profile: 'ir',
      fallback: false,
      symbolDeps: deps,
    } as never) as { run: (v: object) => unknown };
    expect(r.run({ x: 1 })).toEqual([2, 1.5]);
    expect([...deps]).toEqual(['w2']);
  });
});

describe('IR slice: complex inputs through compile()', () => {
  const IR = { profile: 'ir', fallback: false } as const;
  test('a number for a complex input is lifted; a complex value for a real input throws', () => {
    const r = compile(box(['Multiply', 'Z', 'x']), IR as never) as {
      run: (v: object) => unknown;
      mode: string;
    };
    expect(r.run({ Z: 3, x: 2 })).toEqual({ re: 6, im: 0 });
    expect(r.run({ Z: { re: 1, im: 1 }, x: 2 })).toEqual({ re: 2, im: 2 });
    expect(() => r.run({ Z: 1, x: { re: 1, im: 1 } })).toThrow(
      /`x` is not a real number/
    );
    expect(r.mode).toBe('strict');
  });
  test('the complex mode is reported, and its value is the interpreter value', () => {
    const r = compile(box(['Sqrt', 'x']), {
      ...IR,
      mode: 'complex',
    } as never) as { run: (v: object) => unknown; mode: string };
    expect(r.mode).toBe('complex');
    expect(r.run({ x: -9 })).toEqual({ re: 0, im: 3 });
  });
  test('a number for a complex input is lifted also with entryChecks: false', () => {
    const r = compile(box(['Multiply', 'Z', 2]), {
      ...IR,
      entryChecks: false,
    } as never) as { run: (v: object) => unknown };
    expect(r.run({ Z: 1.5 })).toEqual({ re: 3, im: 0 });
  });
  test('a list input of complex elements declines', () => {
    expect(
      declineOf(() => sliceProgram(box(['Sum', 'C']), { target: 'javascript' }))
        .cause
    ).toMatch(/the input C of type (list|vector)<complex/);
  });
  test('a positional complex parameter is lifted', () => {
    const r = compile(
      box(['Function', ['Multiply', 'q', 2], ['Typed', 'q', "'complex'"]]),
      IR as never
    ) as { run: (...a: unknown[]) => unknown };
    expect(r.run(1.5)).toEqual({ re: 3, im: 0 });
    expect(r.run({ re: 0, im: 1 })).toEqual({ re: 0, im: 2 });
  });
});

describe('IR slice: the acceptance of an ill-conditioned point', () => {
  test('a value outside the interval of the moved points is rejected', () => {
    const sin = box(['Sin', ['Multiply', 10000, 'x']]);
    const p = { x: 2 };
    const at = interpret(ce, sin, p) as number;
    expect(illConditioned(sin, p, at, 42)).toBe(false);
    expect(illConditioned(sin, p, at, at)).toBe(true);
    // Near the pole of `Tan`: no sub-expression is infinite, and a value
    // outside the interval is rejected.
    const tan = box(['Tan', 'x']);
    const q = { x: 1.5707963 };
    const t = interpret(ce, tan, q) as number;
    expect(Number.isFinite(t)).toBe(true);
    expect(illConditioned(tan, q, t, -5)).toBe(false);
    expect(some(['Tan', 'x'], q, (v) => infinite(v) || hasNaN(v))).toBe(false);
  });
});

describe('IR slice: the fixes of the review of cov2', () => {
  const IR = { profile: 'ir', fallback: false } as const;
  const pub = (json: Json, options: object = {}) =>
    compile(box(json), { ...IR, ...options } as never) as {
      run: (...a: unknown[]) => unknown;
      mode: string;
    };
  test('a -0 part of a complex input is +0, as the interpreter has no -0', () => {
    for (const json of [
      ['Ln', 'Z'],
      ['Log', 'Z'],
      ['Argument', 'Z'],
      ['Power', 'Z', ['Complex', 0, 1]],
      ['Root', 'Z', ['Complex', 0, 1]],
      ['Sqrt', 'Z'],
    ]) {
      const r = pub(json);
      const plus = r.run({ Z: { re: -4, im: 0 } });
      expect([json, r.run({ Z: { re: -4, im: -0 } })]).toEqual([json, plus]);
      expect([json, r.run({ Z: -4 })]).toEqual([json, plus]);
      const v = interpret(ce, box(json), { Z: { re: -4, im: 0 } });
      expect([json, agrees(plus, v)]).toEqual([json, true]);
    }
    expect(pub(['Argument', 'Z']).run({ Z: { re: -4, im: -0 } })).toBe(Math.PI);
    const literal = pub(['Function', ['Ln', 'q'], ['Typed', 'q', "'complex'"]]);
    expect(literal.run({ re: -4, im: -0 })).toEqual(
      literal.run({ re: -4, im: 0 })
    );
  });
  test('in the complex mode a wide input is complex, a declared real input is real', () => {
    const r = pub(['Sqrt', 'u'], { mode: 'complex' });
    expect(r.run({ u: -9 })).toEqual({ re: 0, im: 3 });
    expect(r.run({ u: { re: -9, im: 0 } })).toEqual({ re: 0, im: 3 });
    expect(
      pub(['Multiply', 'u', 'u'], { mode: 'complex' }).run({
        u: { re: 0, im: 1 },
      })
    ).toBe(-1);
    // A comparison of a wide input declines in the complex mode.
    expect(() =>
      pub(['If', ['Less', 'u', 0], 1, 2], { mode: 'complex' })
    ).toThrow(/Less of complex/);
    expect(pub(['If', ['Less', 'u', 0], 1, 2]).run({ u: -1 })).toBe(1);
    expect(pub(['Add', 'x', 1], { mode: 'complex' }).run({ x: 1 })).toBe(2);
  });
  test('in the complex mode a complex root of imaginary part 0 is a number', () => {
    expect(pub(['Sqrt', 'x'], { mode: 'complex' }).run({ x: 4 })).toBe(2);
    expect(pub(['Sqrt', 'x'], { mode: 'complex' }).run({ x: -4 })).toEqual({
      re: 0,
      im: 2,
    });
    // The strict mode returns the lane of the root.
    expect(pub(['Multiply', 'Z', 2]).run({ Z: 1.5 })).toEqual({ re: 3, im: 0 });
  });
  test('a radical or a logarithm of a negative constant is complex in the strict mode, with and without folding', () => {
    for (const json of [
      ['Multiply', ['Ln', -2], 'x'],
      ['Multiply', ['Sqrt', -4], 'x'],
      ['Add', ['Arcsin', 2], 'x'],
    ]) {
      const expected = interpret(ce, box(json), { x: 1.5 });
      for (const constantFold of [true, false]) {
        const v = pub(json, { constantFold }).run({ x: 1.5 });
        expect([json, constantFold, isComplex(v), agrees(v, expected)]).toEqual(
          [json, constantFold, true, true]
        );
      }
    }
  });
  test('an assumption does not prove an operand nonnegative; an even power does', () => {
    const engine = makeEngine();
    engine.declare('s', 'real');
    engine.assume(engine.box(['GreaterEqual', 's', 0] as never));
    const js = (json: Json) =>
      compileSlice(engine.box(json as never), {
        target: 'javascript',
        mode: 'complex',
      });
    const r = js(['Sqrt', 's']);
    engine.forget('s');
    expect(r.run({ s: -9 })).toEqual({ re: 0, im: 3 });
    expect(js(['Sqrt', ['Add', ['Power', 'x', 2], 1]]).run({ x: 0 })).toBe(1);
  });
});
