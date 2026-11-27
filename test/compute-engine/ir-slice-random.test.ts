/**
 * The slice compiler against the interpreter on random programs: a seeded
 * generator over the operator table and the constructs of the slice, plus
 * programs that must decline. Each program is compiled with and without
 * the passes and compared with the interpreter at three ordinary input
 * points and at edge points (NaN, -0, large magnitudes, 2^53 - 1). A
 * random frame with more than one draw site has a warning and is compared
 * only with itself (passes on and off); a frame with one site is compared
 * bit for bit with the interpreter at machine precision. A list result is
 * changed after the run, and the inputs must not change. The summary
 * (compiled, declined, disagreements by kind) is printed.
 */

import {
  compileSlice,
  Decline,
  OPERATORS,
  sliceProgram,
} from '../../src/compute-engine/compilation/ir';
import { compile } from '../../src/compile';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import {
  JS,
  runtimeOf,
} from '../../src/compute-engine/compilation/ir/print-js';
import {
  printProgram,
  type Syntax,
} from '../../src/compute-engine/compilation/ir/print';
import {
  agrees,
  DECLINES,
  EDGE_POINTS,
  generator,
  hasLoop,
  interpret,
  lastEngineError,
  makeEngine,
  makeMachineEngine,
  pointsFor,
  POINTS,
  runSlice,
  sameBits,
  type Point,
} from './ir-slice-oracle';

// The full breadth (5,000 programs) runs nightly (CE_NIGHTLY); every run
// compares 1,000.
const NIGHTLY = process.env.CE_NIGHTLY === '1';
const COUNT = NIGHTLY ? 5000 : 1000;

/**
 * The kind of a disagreement, each a case of the caveats of compiled code
 * (docs/COMPILATION-MODEL.md, "Caveats of compiled code"), or
 * `unclassified`, a defect of the slice:
 *
 * - `outside-type`: an input is NaN, which is not a value of the type
 *   `real` or `integer` (its type is `nan`): an input outside its declared
 *   type gives an unspecified result.
 * - `tolerance`: the interpreter with `ce.tolerance` 0 agrees: it compares
 *   numbers within its tolerance (`-1e-300 < 0` is false), the compiled
 *   comparison is exact (the compiled-equality ruling of
 *   docs/COMPILATION-MODEL.md).
 * - `precision`: the interpreter at machine precision, with `Pi` and
 *   `ExponentialE` written as their doubles, agrees. The precision of the
 *   target: the interpreter computes with the exact constants (`Sin(Pi)` is
 *   0, `Tan(Pi/2)` is a pole), with exact rationals (`0.5/-9` is `-1/18`,
 *   and `Mod(2, -1/18)` is 0 where the double gives -1/18), and at more
 *   digits where an operation is ill-conditioned (a cosine of a large
 *   argument). At its own precision the interpreter reads
 *   `3.141592653589793` as a decimal, not as the double, so only machine
 *   precision gives the doubles. Also a tangent above 1e15 of a program
 *   that reads `Pi` (the double of a pole of `Tan`, where machine precision
 *   still finds the pole), when that tangent reaches the result. Also a
 *   `Mod` whose double value is rounded to its divisor (`Mod(-1e-300, 1)`
 *   is 1, outside `[0, 1)`), or within 1e-12 of it, at the jump
 *   (`Mod(-2, 2/3)` is 0, and 0.666… in doubles).
 * - `nan-from-complex`: an operation of the compiled code (`Sqrt`, `Ln`,
 *   `Power`) gave NaN for operands that are not NaN, where the interpreter
 *   has a complex value that it carries on to a real result (`0 · √-3` is
 *   0); and that NaN reaches the result. The `strict` mode: a complex
 *   value on the real lane is NaN.
 * - `pole`: the compiled code divided by zero, or raised zero to a
 *   negative power (`0^-1.25`), and that value reaches
 *   the result: the interpreter's `ComplexInfinity` has no sign, the
 *   compiled infinity has one, and a comparison or a sum on it can take
 *   another value.
 * - `conditioning`: a relative change of 1e-14 in every input (not a seed)
 *   and in the
 *   value of every operation changes the compiled result by at least a tenth of the
 *   difference with the interpreter (or flips it, for a boolean): the
 *   rounding of the doubles is amplified (a modulo or a cosine of 1e300, a
 *   value of 2^53 and more). The precision of the target. Also a remainder
 *   within 1e-14 of the largest dividend of a `Mod`, where the perturbation
 *   gives NaN (a negative base to a perturbed exponent).
 * - `local-outside-its-type`: the interpreter has no value because a
 *   `real` local was given a value outside its type (NaN, a complex
 *   number), which the compiled code then overwrote or did not read: not in
 *   the written contract (README, "Limits").
 * - `computed-from-a-caveat-value`: the interpreter has no value (an
 *   error, an unevaluated form), and an operation or a constant of the
 *   compiled code gave NaN or an infinity that reaches the result (or the
 *   result is a boolean or a list, which a comparison of it can decide):
 *   the caveat value where the interpreter has none, and everything
 *   computed from it, is unspecified. Also a comparison of such a value
 *   (the branch it picks), and a list that differs from the interpreter's
 *   only at the elements where the interpreter has no value.
 * - `range`: an operation gave a value of 2^53 or more, or a `Mod` had a
 *   quotient of 2^53 or more (`Mod(e, -1e-300)`), or an `Exp` or a `Power`
 *   of finite operands overflowed (`Ln(Exp(n))` at n = 2^53 - 1), where an integer
 *   is no longer exact and a real has no fractional digit (`2n + 0.5` at
 *   n = 2^53 - 1 rounds to an integer): the limit of the numeric model.
 *
 * A flagged value reaches the result when the compiled result changes
 * when that value is replaced by 12345.678 or by -12345.678.
 */
function classify(
  ce: ComputeEngine,
  json: unknown,
  expr: Expression,
  point: Point,
  value: unknown
): string {
  const replaced = JSON.parse(
    JSON.stringify(json)
      .replace(/"Pi"/g, String(Math.PI))
      .replace(/"ExponentialE"/g, String(Math.E))
  );
  const hasNaN = (v: unknown): boolean =>
    Array.isArray(v) ? v.some(hasNaN) : Number.isNaN(v);
  if (Object.values(point).some(hasNaN)) return 'outside-type';
  const exact = interpret(
    EXACT_COMPARISONS,
    EXACT_COMPARISONS.box(json as never),
    point
  );
  if (exact !== 'engine-error' && agrees(value, exact)) return 'tolerance';
  const inDoubles = interpret(MACHINE, MACHINE.box(replaced), point);
  if (inDoubles !== 'engine-error' && agrees(value, inDoubles))
    return 'precision';
  const flags = instrumented(expr, point, undefined);
  const reaches = () =>
    [12345.678, -12345.678].some(
      (r) => !sameBits(instrumented(expr, point, r).value, flags.value)
    );
  const interpreted = interpret(ce, expr, point);
  // A list that differs only where the interpreter has no value: the
  // element is computed from a caveat value (a `Map` of `z ↦ 2` over an
  // element that a complex `Sqrt` made absent).
  if (
    flags.caveat &&
    Array.isArray(value) &&
    Array.isArray(interpreted) &&
    value.length === interpreted.length &&
    interpreted.some((x) => x === 'none') &&
    interpreted.every((x, i) => x === 'none' || agrees(value[i], x))
  )
    return 'computed-from-a-caveat-value';
  if (flags.caveat && interpreted === 'none') {
    if (flags.caveatComparison) return 'computed-from-a-caveat-value';
    // A comparison of NaN is computed from it, though no replacement of
    // the NaN need change the boolean; so is a list whose elements such a
    // comparison keeps or drops (a `Filter` of an `At` at the index 0).
    if (reaches() || typeof value === 'boolean' || Array.isArray(value))
      return 'computed-from-a-caveat-value';
    if (/"(Assign|Declare)"/.test(JSON.stringify(json)))
      return 'local-outside-its-type';
  }
  if (flags.tanPole && JSON.stringify(json).includes('"Pi"') && reaches())
    return 'precision';
  if (flags.complex && reaches()) return 'nan-from-complex';
  if (flags.pole && reaches()) return 'pole';
  if (flags.modRounded && reaches()) return 'precision';
  if (flags.overflow && reaches()) return 'range';
  const perturbed = instrumented(expr, point, undefined, true).value;
  const expected = interpret(ce, expr, point);
  if (typeof value === 'boolean' && perturbed !== value) return 'conditioning';
  const isComplex = (v: unknown): v is { re: number; im: number } =>
    typeof v === 'object' && v !== null && 're' in v && 'im' in v;
  const gap = (a: unknown, b: unknown): number =>
    Array.isArray(a) && Array.isArray(b)
      ? Math.max(0, ...a.map((x, i) => gap(x, b[i])))
      : typeof a === 'number' && typeof b === 'number'
        ? Math.abs(a - b)
        : isComplex(a) && isComplex(b)
          ? Math.max(Math.abs(a.re - b.re), Math.abs(a.im - b.im))
          : NaN;
  const moved = gap(perturbed, value);
  const error = gap(value, expected);
  // Also a compiled value with no significant digit: a change of 1e-14
  // moves it by a thousandth of itself.
  const unstable = moved >= 1e-3 * Math.max(1, Math.abs(Number(value)));
  if (moved > 0 && (moved >= error / 10 || unstable || Number.isNaN(error)))
    return 'conditioning';
  if (flags.range) return 'range';
  if (flags.modRange && reaches()) return 'range';
  // A remainder within the rounding of a large dividend.
  if (
    flags.modLarge &&
    flags.modScale !== undefined &&
    reaches() &&
    typeof value === 'number' &&
    typeof expected === 'number' &&
    error <= flags.modScale * 1e-14
  )
    return 'conditioning';
  return 'unclassified';
}

const MACHINE = makeEngine();
MACHINE.precision = 'machine';
MACHINE.tolerance = 0;
const EXACT_COMPARISONS = makeEngine();
EXACT_COMPARISONS.tolerance = 0;

/** Run the program with a JavaScript syntax whose `sqrt`, `ln`, `pow`,
 *  `div` and `tan` record a NaN made from operands that are not NaN, a
 *  division by zero, and a tangent at the double of a pole (`tan(π/2)` is
 *  1.6e16). With `replace`, each flagged value is that number instead. With
 *  `perturb`, the value of every operation is multiplied by 1 + 1e-14. */
type Flags = {
  complex?: boolean;
  pole?: boolean;
  tanPole?: boolean;
  range?: boolean;
  caveat?: boolean;
  /** A `Mod` whose value is rounded to its divisor (`Mod(-1e-300, 1)`),
   *  or within 1e-12 of it: a value at the jump of the modulo. */
  modRounded?: boolean;
  /** A `Mod` whose quotient is 2^53 or more (`Mod(e, -1e-300)`). */
  modRange?: boolean;
  /** A `Mod` whose quotient is 1000 or more, and the largest such
   *  dividend: the error of the remainder is that of the dividend. */
  modLarge?: boolean;
  modScale?: number;
  /** An `Exp` or a `Power` of finite operands that overflowed. */
  overflow?: boolean;
  /** A comparison of a value that is not finite: the branch it picks is
   *  computed from that value. */
  caveatComparison?: boolean;
  value?: unknown;
};

function instrumented(
  expr: Expression,
  point: Point,
  replace: number | undefined,
  perturb = false
): Flags {
  const flags: Flags = {};
  const flag = (name: string, test: string) =>
    `if (${test}) { _flags.${name} = true; if (_replace !== undefined) return _replace; } return r;`;
  const flagged: Syntax['ops'] = {
    ...JS.ops,
    sqrt: { text: '_cx(Math.sqrt($0), $0)', helpers: ['_cx'] },
    ln: { text: '_cx(Math.log($0), $0)', helpers: ['_cx'] },
    pow: { text: '_pw($0, $1)', helpers: ['_pw', '_cx'] },
    mod: { text: '_md($0, $1)', helpers: ['_md'] },
    exp: { text: '_ex($0)', helpers: ['_ex'] },
    ...Object.fromEntries(
      ['lt', 'le', 'gt', 'ge'].map((op) => [
        op,
        { text: `_cc(${String(JS.ops[op])}, $0, $1)`, helpers: ['_cc'] },
      ])
    ),
    div: { text: '_dz($0, $1)', helpers: ['_dz'] },
    tan: { text: '_tp(Math.tan($0))', helpers: ['_tp'] },
  };
  // Every operation through `_q`, which records a value of 2^53 or more
  // and perturbs.
  const ops = Object.fromEntries(
    Object.entries(flagged).map(([op, spelling]) => {
      const { text, helpers } =
        typeof spelling === 'string'
          ? { text: spelling, helpers: [] }
          : spelling;
      return [op, { text: `_q(${text})`, helpers: [...helpers, '_q'] }];
    })
  );
  const syntax: Syntax = {
    ...JS,
    constant: (c) => (Number.isNaN(c.value) ? '_q(NaN)' : JS.constant(c)),
    ops,
    helpers: {
      ...JS.helpers,
      _cx: `const _cx = (r, ...a) => { ${flag('complex', 'Number.isNaN(r) && !a.some(Number.isNaN)')} };`,
      _dz: `const _dz = (a, b) => { const r = a / b; ${flag('pole', 'b === 0')} };`,
      // A pole of a power (a zero base, a negative exponent), else the
      // NaN of a complex value.
      _pw: `const _pw = (a, b) => { const r = _SYS.ir.pow(a, b); if (a === 0 && b < 0) { ${flag('pole', 'true')} } if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(r) === Infinity) { ${flag('overflow', 'true')} } return _cx(r, a, b); };`,
      _ex: `const _ex = (a) => { const r = Math.exp(a); ${flag('overflow', 'Number.isFinite(a) && r === Infinity')} };`,
      // A quotient of 2^53 or more (`Mod(e, -1e-300)`), whose value the
      // doubles do not determine, and a value rounded to the divisor.
      // Each flag is replaced, so that `reaches()` tells whether the value
      // that it explains reaches the result.
      _md: [
        'const _md = (a, b) => {',
        '  const r = _SYS.ir.mod(a, b);',
        '  const q = Math.abs(a / b);',
        '  let k;',
        '  if (Number.isFinite(q) && q >= 2 ** 53) k = "modRange";',
        '  else if (b !== 0 && Math.abs(r) >= Math.abs(b) * (1 - 1e-12)) k = "modRounded";',
        '  else if (Number.isFinite(q) && q >= 1e3) { k = "modLarge"; _flags.modScale = Math.max(_flags.modScale ?? 0, Math.abs(a)); }',
        '  if (k === undefined) return r;',
        '  _flags[k] = true;',
        '  return _replace !== undefined ? _replace : r;',
        '};',
      ].join('\n'),
      _cc: `const _cc = (r, a, b) => { if (typeof a === 'number' && typeof b === 'number' && !(Number.isFinite(a) && Number.isFinite(b))) _flags.caveatComparison = true; return r; };`,
      _tp: `const _tp = (r) => { ${flag('tanPole', 'Math.abs(r) > 1e15')} };`,
      _q: [
        'const _q = (r) => {',
        '  if (typeof r !== "number") return r;',
        '  if (Number.isFinite(r) && Math.abs(r) >= 2 ** 53) _flags.range = true;',
        '  if (!Number.isFinite(r)) _flags.caveat = true;',
        '  return _perturb ? r * (1 + 1e-14) : r;',
        '};',
      ].join('\n'),
    },
  };
  const printed = printProgram(
    sliceProgram(expr, { target: 'javascript', passes: false }),
    syntax,
    OPERATORS
  );
  flags.value = new Function(
    '_SYS',
    '_flags',
    '_replace',
    '_perturb',
    '_',
    [...printed.helpers, ...printed.functions, ...printed.body].join('\n')
  )(
    runtimeOf(expr.engine as never),
    flags,
    replace,
    perturb,
    perturb ? perturbed(point, expr) : point
  );
  return flags;
}

/** `point` with each number multiplied by 1 + 1e-14, except the seed of
 *  a random frame of `expr` (another seed gives other draws). */
function perturbed(point: Point, expr: Expression): Point {
  const seeds = [
    ...JSON.stringify(expr.json).matchAll(/"WithRandomSeed","(\w+)"/g),
  ].map((m) => m[1]);
  const q = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(q) : typeof v === 'number' ? v * (1 + 1e-14) : v;
  return Object.fromEntries(
    Object.entries(point).map(([k, v]) => [k, seeds.includes(k) ? v : q(v)])
  ) as Point;
}

describe('IR slice: random programs against the interpreter', () => {
  test(`${COUNT} programs`, () => {
    const ce = makeEngine();
    // `CE_RANDOM_SEED` runs the generator on another seed.
    const next = generator(Number(process.env.CE_RANDOM_SEED ?? 20261112));
    let compiled = 0;
    let compared = 0;
    const declines = new Map<string, number>();
    const expectedDeclines = new Map<string, number>();
    const kinds = new Map<string, number>();
    const samples = new Map<string, object[]>();
    const unclassified: object[] = [];
    const boxErrors: string[] = [];
    const interpreterErrors: string[] = [];
    const errorClasses = new Map<string, number>();
    const errorSamples: string[] = [];
    const bitDifferences: string[] = [];
    const compiledDeclines: string[] = [];
    const changedInputs: string[] = [];
    let warned = 0;
    // The compiled programs that reach each construct of round 3.
    const CONSTRUCTS = [
      'Map',
      'Filter',
      'Range',
      'Length',
      'Product',
      'Max',
      'WithRandomSeed',
      'Random',
      'f',
      'g',
      'h2',
      'fact',
      'rnd',
      'ev',
      '"D"',
      '"J"',
      '"Q"',
      '"E"',
    ];
    const reached = new Map(CONSTRUCTS.map((c) => [c, 0]));
    for (let i = 0; i < COUNT; i++) {
      const { json, decline } = next();
      // An exception of the engine while it boxes the program is not a
      // result of the slice: it is counted and its program printed.
      let expr;
      try {
        expr = ce.box(json as never);
      } catch (e) {
        boxErrors.push(`${JSON.stringify(json)}: ${String(e).slice(0, 160)}`);
        continue;
      }
      let warnings;
      try {
        warnings = sliceProgram(expr, { target: 'javascript' }).warnings;
      } catch (e) {
        // An engine error during the compilation names its program.
        if (!(e instanceof Decline))
          throw new Error(`${String(e)}\nin ${JSON.stringify(json)}`);
        declines.set(e.cause, (declines.get(e.cause) ?? 0) + 1);
        if (decline !== undefined && e.message.includes(decline))
          expectedDeclines.set(
            decline,
            (expectedDeclines.get(decline) ?? 0) + 1
          );
        continue;
      }
      if (decline !== undefined) compiledDeclines.push(JSON.stringify(json));
      compiled += 1;
      const text = JSON.stringify(json);
      // The warning of a frame with two draw sites or more is checked on
      // focused programs (`ir-list-operators.test.ts`, `ir-profile.test.ts`):
      // a count of `Random` in the text also counts a draw in a branch that
      // the compiler removes, which has no warning.
      if (warnings.length > 0) warned += 1;
      for (const c of CONSTRUCTS)
        if (text.includes(c.startsWith('"') ? c : `"${c}"`))
          reached.set(c, reached.get(c)! + 1);
      const edges = hasLoop(json) ? EDGE_POINTS.slice(0, 1) : EDGE_POINTS;
      for (const point of pointsFor(expr, [...POINTS.slice(0, 3), ...edges])) {
        const expected = interpret(ce, expr, point);
        // A throw (a loop or a list too long) agrees only with an
        // interpreter that has no value.
        const run = (passes: boolean) => {
          try {
            return runSlice(expr, point, passes);
          } catch (e) {
            if (expected !== 'none' && expected !== 'engine-error')
              unclassified.push({
                program: JSON.stringify(json),
                point: JSON.stringify(point),
                thrown: String(e),
              });
            return 'thrown';
          }
        };
        const before = JSON.stringify(point);
        const on = run(true);
        const off = run(false);
        if (on === 'thrown') continue;
        if (!sameBits(on, off)) bitDifferences.push(JSON.stringify(json));
        // The code writes to no input (a result is read-only, and can be
        // an input or hold one).
        if (JSON.stringify(point) !== before) changedInputs.push(text);
        compared += 1;
        if (warnings.length > 0) continue;
        if (expected === 'engine-error') {
          // An input outside its type (NaN for a `real`), or another error
          // of the engine, which is looked at.
          const nan = Object.values(point).some((v) =>
            JSON.stringify(v).includes('null')
          );
          const key = nan
            ? 'an input outside its type'
            : lastEngineError.replace(/\d+(\.\d+)?/g, '#').slice(0, 90);
          errorClasses.set(key, (errorClasses.get(key) ?? 0) + 1);
          if (!nan && errorSamples.length < 6)
            errorSamples.push(
              `${JSON.stringify(json).slice(0, 200)} at ${JSON.stringify(point)}: ${lastEngineError}`
            );
          interpreterErrors.push(JSON.stringify(json));
        } else if (!agrees(on, expected)) {
          const kind = classify(ce, json, expr, point, on);
          kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
          const record = {
            kind,
            program: JSON.stringify(json),
            point: JSON.stringify(point),
            value: String(on),
            expected: JSON.stringify(expected),
          };
          if (kind === 'unclassified') unclassified.push(record);
          else if ((samples.get(kind)?.length ?? 0) < 3)
            samples.set(kind, [...(samples.get(kind) ?? []), record]);
        }
      }
    }
    // Statistics for a reader of the run, printed on request only.
    if (process.env.CE_TEST_REPORT)
      console.log(
        JSON.stringify(
          {
            generated: COUNT,
            boxErrors: boxErrors.length,
            boxErrorSample: boxErrors.slice(0, 5),
            compiled,
            warned,
            declined: COUNT - compiled - boxErrors.length,
            compared,
            reached: Object.fromEntries(reached),
            interpreterErrors: interpreterErrors.length,
            interpreterErrorClasses: Object.fromEntries(
              [...errorClasses].sort((a, b) => b[1] - a[1])
            ),
            interpreterErrorSamples: errorSamples,
            bitDifferences: bitDifferences.length,
            bitDifferenceSample: bitDifferences.slice(0, 5),
            declines: Object.fromEntries(
              [...declines].sort((a, b) => b[1] - a[1])
            ),
            expectedDeclines: Object.fromEntries(expectedDeclines),
            disagreements: Object.fromEntries(kinds),
            samples: Object.fromEntries(samples),
            unclassified,
          },
          null,
          1
        )
      );
    expect(compiled).toBeGreaterThan(COUNT / 2);
    // Each construct is reached by more than 10 programs in 5,000.
    for (const [c, n] of reached)
      expect([c, n > (10 * COUNT) / 5000]).toEqual([c, true]);
    expect(compiledDeclines).toEqual([]);
    expect(changedInputs).toEqual([]);
    expect(warned).toBeGreaterThan((10 * COUNT) / 5000);
    // A smaller sample need not embed each program of `DECLINES`: the next
    // test checks each one.
    if (NIGHTLY)
      for (const name of Object.keys(DECLINES))
        expect([name, expectedDeclines.has(name)]).toEqual([name, true]);
    expect(bitDifferences).toEqual([]);
    expect(unclassified).toEqual([]);
  });

  test('each program of DECLINES declines, added to a program', () => {
    const ce = makeEngine();
    const compiled: string[] = [];
    for (const [name, program] of Object.entries(DECLINES)) {
      // As the generator embeds it: added to a real program.
      const expr = ce.box(['Add', 'x', program] as never);
      try {
        sliceProgram(expr, { target: 'javascript' });
        compiled.push(name);
      } catch (e) {
        if (!(e instanceof Decline)) throw e;
        expect([name, e.message.includes(name)]).toEqual([name, true]);
      }
    }
    expect(compiled).toEqual([]);
  });
});

describe('IR slice: random frames of one draw site', () => {
  test('two reads share a literal-seeded choice of input-dependent length', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    ce.declare('n', 'real');
    ce.assign(
      'L',
      ce.box(['WithRandomSeed', 7, ['RandomChoice', ['Interval', 0, ['Open', 1]], ['Multiply', 4, 'n']]])
    );
    const e = ce.box(['Add', ['At', 'L', 1], ['At', 'L', 2]]);
    const result = compile(e, { to: 'javascript', fallback: false });
    expect(result.code?.match(/_SYS\.randomChoice\(/g)).toHaveLength(1);
    for (const n of [1, 3, 8]) {
      ce.assign('n', n);
      expect(result.run!({ n })).toBe(e.N().re);
    }
  });

  test('300 programs give the interpreter bits at machine precision', () => {
    const ce = makeEngine();
    const machine = makeMachineEngine();
    let s = 3;
    const pick = <T>(xs: readonly T[]): T =>
      xs[(s = (s * 48271) % 2147483647) % xs.length];
    const differ: string[] = [];
    for (let i = 0; i < 300; i++) {
      // A draw in a scalar context, once, among draw-free operands of
      // double arithmetic (no exact constant, which the interpreter keeps
      // exact: the draw bits are compared, not the precision).
      const free = (): unknown =>
        pick([
          'x',
          ['Multiply', 'x', 'y'],
          ['Sin', 'x'],
          'n',
          ['Max', 'n', 'y'],
        ]);
      const site = pick([
        ['Random'],
        ['Multiply', 'x', ['Random']],
        ['Floor', ['Multiply', 10, ['Random']]],
      ]);
      const json = [
        'WithRandomSeed',
        pick([1, 42, 7, 'n']),
        pick([
          ['Add', free(), site],
          ['If', 'p', site, 0.5],
          ['Max', site, 'x'],
          [
            'Sum',
            ['Multiply', 'k', 0.5],
            ['Limits', 'k', 1, ['Floor', ['Multiply', 3, site]]],
          ],
        ]),
      ];
      let compiled;
      try {
        compiled = compileSlice(ce.box(json as never), {
          target: 'javascript',
        });
      } catch (e) {
        if (e instanceof Decline) continue;
        throw e;
      }
      expect([json, compiled.warnings]).toEqual([json, []]);
      const expr = machine.box(json as never);
      for (const point of pointsFor(expr, POINTS.slice(0, 3))) {
        const expected = interpret(machine, expr, point);
        if (typeof expected !== 'number' || !Number.isFinite(expected))
          continue;
        const v = compiled.run(point);
        if (!sameBits(v, expected))
          differ.push(
            `${JSON.stringify(json)} at ${JSON.stringify(point)}: ${String(v)} vs ${expected}`
          );
      }
    }
    expect(differ).toEqual([]);
  });
});

describe('IR slice: a random constant is a literal', () => {
  // `WithRandomSeed(537911, Random())` (a number as the seed, one draw)
  // gives one value at every call: the lowering takes the interpreter's.
  // (The frame ran at each call: `neyret/kthjqzwc4g` #0, 3.6 times the
  // existing compiler, which folds it too.)
  const ce = makeEngine();
  const ir = (json: unknown, options: object = {}) =>
    compile(ce.box(json as never), {
      profile: 'ir',
      fallback: false,
      ...options,
    });
  const text = (r: ReturnType<typeof ir>) => `${r.preamble ?? ''}${r.code}`;
  const frame = /withRandomSeed/;

  // prettier-ignore
  test.each([
    ['one draw', ['WithRandomSeed', 537911, ['Random']]],
    ['a seed that is not an integer', ['WithRandomSeed', 2.5, ['Random']]],
    ['a negative seed', ['WithRandomSeed', -3, ['Random']]],
    ['added to an input', ['Add', 'x', ['WithRandomSeed', 537911, ['Random']]]],
    ['in a frame that reads an input', ['WithRandomSeed', 3, ['Add', ['Multiply', 'x', ['Random']], ['WithRandomSeed', 7, ['Random']], ['Random']]]],
    ['in the body of a Sum', ['Sum', ['Multiply', 'k', ['WithRandomSeed', 7, ['Random']]], ['Limits', 'k', 1, 3]]],
  ])('%s: the interpreter value', (_, json) => {
    const r = ir(json);
    expect(text(r)).not.toMatch(/withRandomSeed\(7|withRandomSeed\(537911|withRandomSeed\(2\.5|withRandomSeed\(-3/);
    const expr = ce.box(json as never);
    for (const point of pointsFor(expr, POINTS.slice(0, 2))) {
      const want = interpret(ce, expr, point) as number;
      expect(r.run!(point as never)).toBeCloseTo(want, 13);
      // The same value at each call.
      expect(r.run!(point as never)).toBe(r.run!(point as never));
    }
  });

  // prettier-ignore
  test.each([
    ['a body that reads an input', ['WithRandomSeed', 7, ['Add', ['Random'], 'x']]],
    ['a seed that is an input', ['WithRandomSeed', 'n', ['Random']]],
    ['two draws', ['WithRandomSeed', 7, ['Add', ['Random'], ['Random']]]],
    ['a list', ['WithRandomSeed', 7, ['List', ['Random'], ['Random']]]],
    ['a loop', ['WithRandomSeed', 7, ['Sum', ['Random'], ['Limits', 'k', 1, 5]]]],
    ['a seed that is a draw', ['WithRandomSeed', ['Random'], ['Random']]],
    ['a seed computed from a draw', ['WithRandomSeed', ['Floor', ['Multiply', 1000, ['Random']]], ['Random']]],
  ])('%s keeps its frame', (_, json) => {
    expect(text(ir(json))).toMatch(frame);
  });

  test('a seed drawn in a frame: the interpreter value at each call', () => {
    // The inner seed is a draw of the outer frame: the value is the same at
    // every call, and it is not the value of a seed drawn at compile time.
    // prettier-ignore
    const json = ['WithRandomSeed', 3, ['Add', ['Multiply', 'x', ['Random']], ['WithRandomSeed', ['Random'], ['Random']], ['Random']]];
    const r = ir(json);
    const expr = ce.box(json as never);
    for (const point of pointsFor(expr, POINTS.slice(0, 2))) {
      const want = interpret(ce, expr, point) as number;
      expect(r.run!(point as never)).toBeCloseTo(want, 13);
    }
    // Compiling it draws nothing from a frame around the compilation.
    const draws = (compileInside: boolean) =>
      ce
        .box([
          'WithRandomSeed',
          11,
          ['List', ['Random'], ['Random'], ['Random']],
        ])
        .evaluate().json;
    const before = draws(false);
    ir(['WithRandomSeed', ['Random'], ['Random']]);
    expect(draws(true)).toEqual(before);
  });

  test('constantFold: false keeps the frame, with the same value', () => {
    const json = ['WithRandomSeed', 537911, ['Random']];
    const r = ir(json, { constantFold: false });
    expect(text(r)).toMatch(frame);
    expect(r.run!({} as never)).toBe(ir(json).run!({} as never));
  });

  test('a draw outside the frame is not the frame value', () => {
    const r = ir(['Add', ['WithRandomSeed', 7, ['Random']], ['Random']]);
    const a = r.run!({} as never) as number;
    const b = r.run!({} as never) as number;
    expect(a).not.toBe(b);
  });

  test('GLSL: the literal', () => {
    const r = compile(
      ce.box(['Multiply', 'x', ['WithRandomSeed', 537911, ['Random']]]),
      { to: 'glsl', profile: 'ir', fallback: false }
    );
    expect(r.code).toBe('(x * 0.2510949)');
  });
});

describe('IR slice: random programs with shared nodes', () => {
  test('300 compositions that reuse subtrees as the same node objects', () => {
    const ce = makeEngine();
    const next = generator(99);
    const f = (h: string, ...ops: Expression[]) => ce.function(h, ops);
    const n = (x: number) => ce.number(x);
    const t = ce.box('t');
    const k = ce.box('k');
    // Each template reads the generated subtree `a` at least twice: the
    // memo, the write tracking and an `Assign` shared by two statements.
    const templates: ((a: Expression) => Expression)[] = [
      (a) => f('Add', f('Sin', a), f('Cos', a)),
      (a) => f('If', ce.box('p'), a, f('Add', a, n(1))),
      (a) => {
        const s = f('Assign', t, f('Add', t, a));
        return f(
          'Block',
          f('Declare', t, ce.box('real'), ce.box('x')),
          s,
          s,
          t
        );
      },
      (a) => {
        const s = f('Sum', f('Multiply', k, a), f('Limits', k, n(1), n(3)));
        return f('Add', s, f('Multiply', s, n(2)));
      },
      (a) => f('If', f('And', f('Less', a, n(0)), f('Less', a, n(1))), a, n(0)),
    ];
    let compared = 0;
    const unclassified: string[] = [];
    for (let i = 0; i < 300; i++) {
      const { json } = next();
      if (/Random|rnd|WithRandomSeed|"t"|"k"/.test(JSON.stringify(json)))
        continue;
      let a: Expression;
      try {
        a = ce.box(json as never);
      } catch {
        continue;
      }
      if (!a.type.matches('real')) continue;
      const expr = templates[i % templates.length](a);
      let run;
      try {
        run = compileSlice(expr, { target: 'javascript' }).run;
      } catch (e) {
        if (e instanceof Decline) continue;
        throw e;
      }
      for (const point of pointsFor(expr, POINTS.slice(0, 3))) {
        const expected = interpret(ce, expr, point);
        if (expected === 'engine-error') continue;
        let v: unknown;
        try {
          v = run(point);
        } catch {
          continue;
        }
        compared += 1;
        if (!agrees(v, expected)) {
          const kind = classify(ce, expr.json, expr, point, v);
          if (kind === 'unclassified')
            unclassified.push(
              `${JSON.stringify(expr.json).slice(0, 300)} at ${JSON.stringify(point)}: ${String(v)} vs ${JSON.stringify(expected)}`
            );
        }
      }
    }
    // Statistics for a reader of the run, printed on request only.
    if (process.env.CE_TEST_REPORT)
      console.log(`shared nodes: ${compared} comparisons`);
    expect(compared).toBeGreaterThan(200);
    expect(unclassified).toEqual([]);
  });
});

// Two programs that a change of the generator's sequence produced and that
// the run left unclassified (CE-1323), each a caveat of compiled code: they
// are classified whichever programs the seeds of the runs above draw.
describe('IR slice: the classification of disagreements', () => {
  // prettier-ignore
  const FILTER = ["Filter",["Add","J",["Map",["Function",["At",["Add","D",["Map",["Function","n","z404"],"D"]],["ev",["Mod",1,9]]],"z403"],"J"]],["Function",["Less",["If",["Or","p","p"],["Which","p",0.5,"p","n","True","z405"],["Abs",-1.25]],["Min","ExponentialE",["Min","Pi","Pi"]],["Subtract",["Round","n"],["Max",-1.25,0.5]]],"z405"]];
  // prettier-ignore
  const COSINE = ["Mod",["Cos",["Power",["If","p","Pi","ExponentialE"],["h2",2]]],["f",2,["At",["Floor","D"],["Subtract","n",0]]]];
  // prettier-ignore
  test.each([
    ['an At at the index 0 in a Filter, no element kept', FILTER, { D: [1.5, -2, 3, 0.25], J: [4, -5, 6], n: 3, p: true }, 'computed-from-a-caveat-value'],
    ['an At at the index 0 in a Filter, one element kept', FILTER, { D: [-0.5], J: [7], n: 5, p: true }, 'computed-from-a-caveat-value'],
    ['the cosine of π^4 in a Mod', COSINE, { D: [1.5, -2, 3, 0.25], n: 3, p: true }, 'precision'],
  ])('%s', (_, json, point, kind) => {
    const ce = makeEngine();
    const expr = ce.box(json as never);
    const value = runSlice(expr, point as Point, true);
    expect(agrees(value, interpret(ce, expr, point as Point))).toBe(false);
    expect(classify(ce, json, expr, point as Point, value)).toBe(kind);
  });
});
