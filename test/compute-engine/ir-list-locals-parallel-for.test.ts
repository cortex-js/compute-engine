/**
 * A list local written in place, `AddTo`, the parallel assignment and
 * `ParallelLoop` run in order, on JavaScript (CE-1462; design note
 * `docs/plans/2026-11-18-ir-parallel-for-and-list-locals.md`, sections 4.1
 * to 4.4; README of `src/compute-engine/compilation/ir/`, "Lists" and "Loops
 * and the runtime"). The witness is the `step` function of Tycho's
 * `buddhabrot` showcase, whose compiled value equals the same step written
 * by hand in f64 JavaScript (the interpreter keeps `0.7548776662·(r + k)`
 * exact, and the orbits are chaotic: section 2 of the note).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Inputs = Record<string, number | number[]>;
type Result = { success: boolean; run: (inputs: object) => unknown };

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a list is an array, an error `'error'`. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isSymbol(e, 'True')) return true;
  if (isSymbol(e, 'False')) return false;
  if (isFunction(e, 'Error')) return 'error';
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  throw new Error(`no value: ${e.toString()}`);
}

/**
 * The Epsil function `f` of `source` on an engine of its own, called with
 * `inputs` (an integer, a real or a list of integers each, by the type of the
 * value given): its compiled code, and its value in the interpreter and in
 * the code at `values`.
 */
function program(
  source: string,
  inputs: Inputs,
  to = 'javascript',
  diagnostics: string[] = []
) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(
    r.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => (d.message as string[])[0])
  ).toEqual(diagnostics);
  const names = Object.keys(inputs);
  for (const name of names) {
    const v = inputs[name];
    ce.declare(
      name,
      Array.isArray(v)
        ? 'list<integer>'
        : Number.isInteger(v)
          ? 'integer'
          : 'real'
    );
  }
  const call = ce.box(['f', ...names] as never);
  const compiled = () =>
    compile(call, { to, fallback: false } as never) as unknown as Result;
  const interpreted = (values: Inputs) =>
    read(
      executeEpsil(
        ce,
        `f(${names.map((n) => JSON.stringify(values[n])).join(', ')})`
      ).value.N()
    );
  return { compiled, interpreted };
}

/** The compiled and the interpreter's value of `f` of `source` at each of
 *  `points` are equal. `diagnostics`: the codes of the static check. */
function agrees(source: string, points: Inputs[], diagnostics: string[] = []) {
  const p = program(source, points[0], 'javascript', diagnostics);
  const code = p.compiled();
  expect(code.success).toBe(true);
  for (const point of points) {
    const copy = structuredClone(point);
    expect([point, code.run(copy)]).toEqual([point, p.interpreted(point)]);
    // No input is changed.
    expect(copy).toEqual(point);
  }
}

/** The compiled code of `f` of `source` throws at `point`, where the
 *  interpreter's value is an error. */
function throwsAt(source: string, point: Inputs) {
  const p = program(source, point);
  expect(p.interpreted(point)).toBe('error');
  expect(() => p.compiled().run(point)).toThrow(/out-of-range/);
}

const declines = (source: string, inputs: Inputs, to = 'javascript') =>
  failure(() => program(source, inputs, to).compiled());

describe('A list local written in place (4.1)', () => {
  const replace = (index: string, value = '7') =>
    `function f(n: integer) -> list<integer> { let L = [0, 0, 0]; L = replaceAt(L, ${index}, ${value}); L }`;

  test('ReplaceAt from the start and from the end', () =>
    agrees(replace('n'), [{ n: 1 }, { n: 3 }, { n: -1 }, { n: -3 }]));

  test('an index out of range, 0 or not an integer throws', () => {
    throwsAt(replace('n'), { n: 5 });
    throwsAt(replace('n'), { n: 0 });
    throwsAt(replace('n'), { n: -4 });
    throwsAt(
      'function f(x: real) -> list<integer> { let L = [0, 0, 0]; L = replaceAt(L, x, 7); L }',
      { x: 1.5 }
    );
  });

  test('a constant index out of a stated length declines', () => {
    expect(declines(replace('5', 'n'), { n: 1 })).toMatch(
      /the index 5 of a write to a list of 3 elements/
    );
    expect(declines(replace('0', 'n'), { n: 1 })).toMatch(/the index 0/);
  });

  test('AddTo of an element, from the end; out of range it throws', () => {
    const add =
      'function f(n: integer) -> list<integer> { let L = [0, 0, 0]; L[n] += 1; L[n] += n; L }';
    agrees(add, [{ n: 1 }, { n: -1 }, { n: 2 }]);
    throwsAt(add, { n: 4 });
  });

  test('a real written to a list declared list<integer> declines', () =>
    // The interpreter gives an `incompatible-type` error. A list of no
    // declared type is widened (CE-1480, `ir-list-local-widening.test.ts`).
    expect(
      declines(
        'function f(n: integer) { let L: list<integer> = [0, 0, n]; L[1] += 0.5; L }',
        { n: 1 }
      )
    ).toMatch(/a real value written to a list of integer elements/));

  test('a widened list at a declared integer result declines', () => {
    // The interpreter does not check the declared result and gives the
    // reals ([0.5, 0, 3] and 0.5); the compiled body is real, which the
    // declared result refuses.
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = [0, 0, n]; L[1] += 0.5; L }',
        { n: 3 }
      )
    ).toMatch(/a body of f that is not list<integer>/);
    expect(
      declines(
        'function f(n: integer) -> integer { let L = [0, 0, n]; L[1] += 0.5; L[1] }',
        { n: 3 }
      )
    ).toMatch(/a body of f that is not integer/);
  });

  test('a list local declared list<real> takes a real', () =>
    agrees(
      'function f(n: integer) -> list<real> { let L: list<real> = [0, 0, n]; L[1] += 0.5; L = replaceAt(L, -1, L[3] / 4); L }',
      [{ n: 2 }]
    ));

  test('the declaration copies an input, which the code does not change', () =>
    agrees(
      'function f(H: list<integer>) -> list<integer> { let L = H; L[1] += 1; L = replaceAt(L, -1, L[1] + length(L)); L }',
      [{ H: [1, 2] }, { H: [5, 0, 3, 9] }]
    ));

  test('a read of an element is in order with the writes', () =>
    agrees(
      'function f(n: integer) -> real { let L = [1, 2, n]; let x = L[1]; L[1] += 10; let y = L[1]; L[1] += 100; x + y + L[1] + L[n] }',
      [{ n: 1 }, { n: 3 }]
    ));

  test('a list of booleans', () =>
    agrees(
      'function f(n: integer) -> list<boolean> { let L = [false, false, false]; L = replaceAt(L, n, true); L }',
      [{ n: 2 }, { n: -1 }]
    ));

  test('a write in a loop to a list local declared outside it', () =>
    agrees(
      'function f(n: integer) -> list<integer> { let L = [0, 0, 0, 0]; for k in 1..n { L[1 + (k - 4 * floor(k / 4))] += k }; L }',
      [{ n: 0 }, { n: 9 }]
    ));

  test('another read of the list declines (an alias): value semantics', () => {
    // The interpreter gives [[5, 0], [0, 0]]: `M` keeps the old value.
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = [0, n]; let M = L; L[1] += 5; M }',
        { n: 0 }
      )
    ).toMatch(/the list local L, written in place, read other than by At/);
    // A capture in a function literal.
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = [0, n]; L[1] += 1; map(x => L[x], [1, 2]) }',
        { n: 0 }
      )
    ).toMatch(/the list local L, written in place, read other than by At/);
  });

  test('a constant, a local of a range and a write inside ReplaceAt decline', () => {
    // The interpreter refuses a write to a constant.
    expect(
      declines(
        'function f(n: integer) -> integer { const L = [0, n]; L[1] += 1; L[1] }',
        { n: 0 }
      )
    ).toMatch(/a write to a constant list local/);
    // `let L = 1..3` is a `range` for the interpreter, which refuses the
    // write (`incompatible-type`).
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = 1..3; L[1] += n; L }',
        { n: 2 }
      )
    ).toMatch(/a list local written in place whose value is of type/);
    // The interpreter reads `L` before the value of `replaceAt`, so the
    // inner write is lost: [0, 1, 1] at n = 1.
    expect(
      declines(
        'function f(n: integer) -> list<integer> { let L = [0, 0, n]; L = replaceAt(L, 2, do { L[1] += 5; 1 }); L }',
        { n: 1 }
      )
    ).toMatch(
      /a write to a constant \(the interpreter refuses it\) or to a list local other than ReplaceAt/
    );
    // The same for `L[i] += e`, and for a write in a `let` value.
    for (const body of [
      'L[2] += do { L[1] += 5; 1 }',
      'L[2] += do { L = replaceAt(L, 1, 9); 1 }',
      'L = replaceAt(L, 2, do { let t = do { L[1] += 5; 1 }; t })',
      // A read whose index writes the list.
      'L = replaceAt(L, 3, L[do { L[1] += 1; 1 }])',
    ])
      expect(
        declines(
          `function f(n: integer) -> list<integer> { let L = [0, 0, n]; ${body}; L }`,
          { n: 2 }
        )
      ).toMatch(
        /a write to a constant \(the interpreter refuses it\) or to a list local other than ReplaceAt/
      );
  });

  test('a write in a random frame is no draw site: the one draw is the interpreter’s', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const seeded = ce.box([
      'WithRandomSeed',
      5,
      [
        'Block',
        [
          'Declare',
          'L',
          ['Dictionary', ['KeyValuePair', { str: 'value' }, ['List', 0, 'x']]],
        ],
        ['AddTo', ['At', 'L', 1], ['Random']],
        'L',
      ],
    ] as never);
    const code = compile(seeded, { fallback: false });
    expect(code.warnings ?? []).toEqual([]);
    const want = ce.withValues({ x: ce.number(1) } as never, () =>
      read(seeded.evaluate().N())
    );
    expect(code.run!({ x: 1 } as never)).toEqual(want);
  });

  test('GLSL and the interval mode decline a written list local', () => {
    const source =
      'function f(n: integer) -> list<real> { let L = [0, 0, 0]; L[1] += n; L }';
    expect(declines(source, { n: 1 }, 'glsl')).toMatch(
      /a list local that its block writes \(JavaScript only\)/
    );
    expect(declines(source, { n: 1 }, 'interval-js')).toMatch(
      /a list local that its block writes \(JavaScript only\)/
    );
  });
});

describe('AddTo of a scalar local (4.2)', () => {
  test('AddTo(s, e) is Assign(s, Add(s, e))', () =>
    agrees(
      'function f(n: integer, x: real) -> real { let s = 0.5; for k in 1..n { s += k * x }; s += 1; s }',
      [
        { n: 5, x: 0.25 },
        { n: 0, x: -1.5 },
      ]
    ));

  test('a real added to an integer local declines', () =>
    expect(
      declines(
        'function f(n: integer, x: real) -> real { let s: integer = n; s += x; s }',
        { n: 1, x: 0.5 }
      )
    ).toMatch(/a value that is not integer/));

  test('GLSL compiles it', () => {
    const p = program(
      'function f(x: real) -> real { let s = 0.0; for k in 1..4 { s += k * x }; s }',
      { x: 0.5 },
      'glsl'
    );
    expect(p.compiled().success).toBe(true);
  });
});

describe('The parallel assignment (4.3)', () => {
  test('every value is computed before any name is written', () =>
    agrees(
      'function f(x: real, y: real) -> list<real> { let a = x; let b = y; for k in 1..3 { (a, b) := (b + k, a * 2) }; [a, b] }',
      [
        { x: 1.5, y: -2 },
        { x: 0, y: 0.125 },
      ]
    ));

  test('a name written twice, and a lane change, decline', () => {
    expect(
      declines(
        'function f(x: real) -> real { let a = x; (a, a) := (1, 2); a }',
        { x: 1 }
      )
    ).toMatch(/a parallel assignment that writes a name twice/);
    expect(
      declines(
        'function f(x: real) -> real { let a: integer = 1; let b = x; (a, b) := (b, a); b }',
        { x: 0.5 }
      )
    ).toMatch(/a value that is not integer/);
  });
});

describe('ParallelLoop runs in order (4.4)', () => {
  test('the passes in order: the read of an accumulator is the interpreter’s', () =>
    // With the error `parallel-accumulator-read` of the static check.
    agrees(
      'function f(n: integer) -> list<real> { let s = 0; let t = 0; parallel for k in 1..n { s += k; t += s }; [s, t] }',
      [{ n: 3 }, { n: 0 }],
      ['parallel-accumulator-read']
    ));

  test('a Break of an inner Loop is allowed', () =>
    agrees(
      'function f(n: integer) -> real { let s = 0; parallel for k in 1..n { for m in 1..10 { if m > k { break }; s += m } }; s }',
      [{ n: 4 }]
    ));

  test('an outer write other than AddTo, and a Break, decline', () => {
    // The interpreter gives 6 and 3, with the diagnostics
    // `parallel-outer-write` and `parallel-exit`.
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const loop = (body: Json) =>
      ce.box([
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        ['ParallelLoop', body, ['Element', 'k', ['Range', 1, 'n']]],
        's',
      ] as never);
    expect(
      failure(() =>
        compile(loop(['Block', ['Assign', 's', ['Add', 's', 'k']]]), {
          fallback: false,
        })
      )
    ).toMatch(/assigns s, declared outside it \(parallel-outer-write\)/);
    expect(
      failure(() =>
        compile(
          loop([
            'Block',
            ['AddTo', 's', 'k'],
            ['If', ['Equal', 'k', 2], ['Block', ['Break']]],
          ]),
          { fallback: false }
        )
      )
    ).toMatch(/a Break or a Continue of a parallel for \(parallel-exit\)/);
  });

  test('a program with a draw or a random frame declines', () => {
    expect(
      declines(
        'function f(n: integer) -> real { let s = 0.0; parallel for k in 1..n { s += random() }; s }',
        { n: 3 }
      )
    ).toMatch(/a parallel for in a program that draws or has a random frame/);
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const seeded = ce.box([
      'WithRandomSeed',
      5,
      [
        'Block',
        ['Declare', 's', { dict: { value: 0 } }],
        [
          'ParallelLoop',
          ['Block', ['AddTo', 's', 'k']],
          ['Element', 'k', ['Range', 1, 'n']],
        ],
        ['Add', 's', ['Random']],
      ],
    ] as never);
    expect(failure(() => compile(seeded, { fallback: false }))).toMatch(
      /a parallel for in a program that draws or has a random frame/
    );
  });

  test('GLSL declines it', () =>
    expect(
      declines(
        'function f(x: real) -> real { let s = 0.0; parallel for k in 1..4 { s += k * x }; s }',
        { x: 0.5 },
        'glsl'
      )
    ).toMatch(/a parallel for \(JavaScript only\)/));
});

// The `step` of Tycho's `buddhabrot` prelude, without its comments.
const STEP = `function step(H: list<integer>, n: integer) -> list<integer> {
  let L = H
  const r = H[90001]
  parallel for k in 1..n {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2
    const q = 3 * fract(0.5698402910 * (r + k)) - 1.5
    const x = p - 0.25
    const t = x^2 + q^2
    if t * (t + x) > q^2 / 4 && (p + 1)^2 + q^2 > 1/16 {
      let a = 0.0
      let b = 0.0
      let e = 0
      let sa = 0.0
      let sb = 0.0
      let s = 2
      for m in 1..5000 {
        (a, b) := (a^2 - b^2 + p, 2*a*b + q)
        if a^2 + b^2 > 4 { e = m; break }
        if abs(a - sa) < 1e-12 && abs(b - sb) < 1e-12 { break }
        if m == s { sa = a; sb = b; s = 2*s }
      }
      if e > 0 {
        a = 0.0
        b = 0.0
        for m in 1..e {
          (a, b) := (a^2 - b^2 + p, 2*a*b + q)
          if a^2 + b^2 > 4 { break }
          const i = floor((b + 1.125) / 2.25 * 150)
          const j = floor((1 - a) / 3 * 200)
          if i >= 0 && i < 150 && j >= 0 && j < 200 {
            const c = 1 + i + 150*j
            const d = 150 - i + 150*j
            L[c] += 1
            L[d] += 1
            if e <= 500 {
              L[c + 30000] += 1
              L[d + 30000] += 1
            }
            if e <= 50 {
              L[c + 60000] += 1
              L[d + 60000] += 1
            }
          }
        }
      }
    }
  }
  L = replaceAt(L, 90001, r + n)
  L
}`;

/** The same step written by hand in f64 JavaScript. */
function handStep(H: number[], n: number): number[] {
  const fract = (v: number) => v - Math.floor(v);
  const L = H.slice();
  const r = H[90000];
  for (let k = 1; k <= n; k++) {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2;
    const q = 3 * fract(0.569840291 * (r + k)) - 1.5;
    const x = p - 0.25;
    const t = x * x + q * q;
    if (!(t * (t + x) > (q * q) / 4 && (p + 1) ** 2 + q * q > 1 / 16)) continue;
    let [a, b, e, sa, sb, s] = [0, 0, 0, 0, 0, 2];
    for (let m = 1; m <= 5000; m++) {
      [a, b] = [a * a - b * b + p, 2 * a * b + q];
      if (a * a + b * b > 4) {
        e = m;
        break;
      }
      if (Math.abs(a - sa) < 1e-12 && Math.abs(b - sb) < 1e-12) break;
      if (m === s) [sa, sb, s] = [a, b, 2 * s];
    }
    if (e === 0) continue;
    [a, b] = [0, 0];
    for (let m = 1; m <= e; m++) {
      [a, b] = [a * a - b * b + p, 2 * a * b + q];
      if (a * a + b * b > 4) break;
      const i = Math.floor(((b + 1.125) / 2.25) * 150);
      const j = Math.floor(((1 - a) / 3) * 200);
      if (!(i >= 0 && i < 150 && j >= 0 && j < 200)) continue;
      const c = 1 + i + 150 * j;
      const d = 150 - i + 150 * j;
      for (const plane of [
        0,
        ...(e <= 500 ? [30000] : []),
        ...(e <= 50 ? [60000] : []),
      ]) {
        L[c + plane - 1] += 1;
        L[d + plane - 1] += 1;
      }
    }
  }
  L[90000] = r + n;
  return L;
}

describe('The buddhabrot step (CE-1462)', () => {
  test('compiles on JavaScript and gives the value of the step written by hand', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, STEP).diagnostics.filter((d) => d.severity === 'error')
    ).toEqual([]);
    ce.declare('H', 'list<integer>');
    ce.declare('n', 'integer');
    const code = compile(ce.box(['step', 'H', 'n'] as never), {
      fallback: false,
    }) as unknown as Result;
    expect(code.success).toBe(true);
    const H = new Array(90001).fill(0);
    const once = code.run({ H, n: 2000 }) as number[];
    expect(once).toEqual(handStep(H, 2000));
    expect(H.every((x) => x === 0)).toBe(true);
    // The samples continue where the grid stopped.
    expect(code.run({ H: once, n: 500 })).toEqual(handStep(once, 500));
    expect(once[90000]).toBe(2000);
  });

  test('the action body: the step literal applied to a row of reals (CE-1483)', () => {
    // Tycho's action `H → step(H, 5000)`: `Apply` of the literal of `step`
    // to the row `H`, of a Desmos-style type. The interpreter binds the list
    // whole, with no check of its elements against `list<integer>`.
    // The canonical literal of `step` (the names of the Epsil library mapped
    // to operators, as in the MathJSON that Tycho passes).
    const defining = new ComputeEngine();
    executeEpsil(defining, STEP);
    const literal = (
      defining.box(['step', 'H', 1] as never).operatorDefinition as unknown as {
        _lambdaLiteral: Expression;
      }
    )._lambdaLiteral.json;
    const ce = new ComputeEngine();
    ce.declare('H', 'list<nan | real | signed_infinity>');
    const code = compile(ce.box(['Apply', literal, 'H', 5000] as never), {
      to: 'javascript',
      symbolic: ['H'],
      fallback: false,
    } as never) as unknown as Result;
    expect(code.success).toBe(true);
    const H = new Array(90001).fill(0);
    const out = code.run({ H }) as number[];
    expect(out).toEqual(handStep(H, 5000));
    expect([out.length, out[90000]]).toEqual([90001, 5000]);
  });

  test('a variant whose cells do not depend on an orbit gives the interpreter’s value', () =>
    agrees(
      `function f(H: list<integer>, n: integer) -> list<integer> {
        let L = H
        const r = H[-1]
        parallel for k in 1..n {
          const c = 1 + (k * k - 7 * floor(k * k / 7))
          L[c] += 1
          if c > 3 { L[c + 7] += k }
        }
        L = replaceAt(L, -1, r + n)
        L
      }`,
      [{ H: new Array(15).fill(0), n: 20 }]
    ));
});
