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
import type { Expression } from '../../src/compute-engine/global-types';
import type { ComputeEngine } from '../../src/compute-engine';
import {
  JS,
  javascriptRuntime,
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
 *   still finds the pole), when that tangent reaches the result.
 * - `nan-from-complex`: an operation of the compiled code (`Sqrt`, `Ln`,
 *   `Power`) gave NaN for operands that are not NaN, where the interpreter
 *   has a complex value that it carries on to a real result (`0 · √-3` is
 *   0); and that NaN reaches the result. The `strict` mode: a complex
 *   value on the real lane is NaN.
 * - `pole`: the compiled code divided by zero, and that quotient reaches
 *   the result: the interpreter's `ComplexInfinity` has no sign, the
 *   compiled infinity has one, and a comparison or a sum on it can take
 *   another value.
 * - `conditioning`: a relative change of 1e-14 in every input (not a seed)
 *   and in the
 *   value of every operation changes the compiled result by at least a tenth of the
 *   difference with the interpreter (or flips it, for a boolean): the
 *   rounding of the doubles is amplified (a modulo or a cosine of 1e300, a
 *   value of 2^53 and more). The precision of the target.
 * - `local-outside-its-type`: the interpreter has no value because a
 *   `real` local was given a value outside its type (NaN, a complex
 *   number), which the compiled code then overwrote or did not read: not in
 *   the written contract (README, "Limits").
 * - `computed-from-a-caveat-value`: the interpreter has no value (an
 *   error, an unevaluated form), and an operation or a constant of the
 *   compiled code gave NaN or an infinity that reaches the result: the
 *   caveat value where the interpreter has none, and everything computed
 *   from it, is unspecified.
 * - `range`: an operation gave a value of 2^53 or more, where an integer
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
  if (flags.caveat && interpret(ce, expr, point) === 'none') {
    // A comparison of NaN is computed from it, though no replacement of
    // the NaN need change the boolean.
    if (reaches() || typeof value === 'boolean')
      return 'computed-from-a-caveat-value';
    if (/"(Assign|Declare)"/.test(JSON.stringify(json)))
      return 'local-outside-its-type';
  }
  if (flags.tanPole && JSON.stringify(json).includes('"Pi"') && reaches())
    return 'precision';
  if (flags.complex && reaches()) return 'nan-from-complex';
  if (flags.pole && reaches()) return 'pole';
  const perturbed = instrumented(expr, point, undefined, true).value;
  // The perturbation took a `Mod` operand past 2^53 - 1: at the edge of
  // the range.
  if (perturbed === 'thrown') return 'range';
  const expected = interpret(ce, expr, point);
  if (typeof value === 'boolean' && perturbed !== value) return 'conditioning';
  const gap = (a: unknown, b: unknown): number =>
    Array.isArray(a) && Array.isArray(b)
      ? Math.max(0, ...a.map((x, i) => gap(x, b[i])))
      : typeof a === 'number' && typeof b === 'number'
        ? Math.abs(a - b)
        : NaN;
  const moved = gap(perturbed, value);
  const error = gap(value, expected);
  // Also a compiled value with no significant digit: a change of 1e-14
  // moves it by a thousandth of itself.
  const unstable = moved >= 1e-3 * Math.max(1, Math.abs(Number(value)));
  if (moved > 0 && (moved >= error / 10 || unstable || Number.isNaN(error)))
    return 'conditioning';
  if (flags.range) return 'range';
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
function instrumented(
  expr: Expression,
  point: Point,
  replace: number | undefined,
  perturb = false
): {
  complex?: boolean;
  pole?: boolean;
  tanPole?: boolean;
  range?: boolean;
  caveat?: boolean;
  value?: unknown;
} {
  const flags: {
    complex?: boolean;
    pole?: boolean;
    tanPole?: boolean;
    range?: boolean;
    caveat?: boolean;
    value?: unknown;
  } = {};
  const flag = (name: string, test: string) =>
    `if (${test}) { _flags.${name} = true; if (_replace !== undefined) return _replace; } return r;`;
  const flagged: Syntax['ops'] = {
    ...JS.ops,
    sqrt: { text: '_cx(Math.sqrt($0), $0)', helpers: ['_cx'] },
    ln: { text: '_cx(Math.log($0), $0)', helpers: ['_cx'] },
    pow: { text: '_cx(_rt.pow($0, $1), $0, $1)', helpers: ['_cx'] },
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
  // A replaced or perturbed value can take a `Mod` operand past 2^53,
  // where it throws: that run has no value.
  try {
    flags.value = new Function(
      '_rt',
      '_flags',
      '_replace',
      '_perturb',
      '_',
      [...printed.helpers, ...printed.functions, ...printed.body].join('\n')
    )(
      javascriptRuntime(expr.engine as never),
      flags,
      replace,
      perturb,
      perturb ? perturbed(point, expr) : point
    );
  } catch (e) {
    if (!(e instanceof RangeError)) throw e;
    flags.value = 'thrown';
  }
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
    const next = generator(20261112);
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
    const missingWarnings: string[] = [];
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
        if (!(e instanceof Decline)) throw e;
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
      // One frame with two draw sites or more has a warning.
      const sites = (text.match(/"(Random|rnd)"/g) ?? []).length;
      if (
        text.split('WithRandomSeed').length === 2 &&
        sites >= 2 &&
        warnings.length === 0
      )
        missingWarnings.push(text);
      if (warnings.length > 0) warned += 1;
      for (const c of CONSTRUCTS)
        if (text.includes(c.startsWith('"') ? c : `"${c}"`))
          reached.set(c, reached.get(c)! + 1);
      const edges = hasLoop(json) ? EDGE_POINTS.slice(0, 1) : EDGE_POINTS;
      for (const point of pointsFor(expr, [...POINTS.slice(0, 3), ...edges])) {
        const expected = interpret(ce, expr, point);
        // A throw (a loop or a list too long) agrees only with an
        // interpreter that has no value; a `Mod` of an operand beyond the
        // safe integer range throws by contract (docs/COMPILATION-MODEL.md,
        // "Integer operations beyond the safe integer range").
        const run = (passes: boolean) => {
          try {
            return runSlice(expr, point, passes);
          } catch (e) {
            if (
              expected !== 'none' &&
              expected !== 'engine-error' &&
              !/^Mod: .* beyond the safe integer range/.test(
                (e as Error).message
              )
            )
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
        // An unused `Mod` that can throw is removed by the passes (it is
        // `may-fail`): with them off, it can throw where they on give a value.
        if (on === 'thrown' || off === 'thrown') continue;
        if (!sameBits(on, off)) bitDifferences.push(JSON.stringify(json));
        // A list result is not an input, nor holds one.
        const scribble = (v: unknown) =>
          Array.isArray(v) &&
          v.forEach((x, i) => (Array.isArray(x) ? scribble(x) : (v[i] = 999)));
        scribble(off);
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
    expect(missingWarnings).toEqual([]);
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
    console.log(`shared nodes: ${compared} comparisons`);
    expect(compared).toBeGreaterThan(200);
    expect(unclassified).toEqual([]);
  });
});
