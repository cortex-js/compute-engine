/**
 * A list local written in place that the interpreter widens (CE-1480), one
 * copied from a constant (CE-1481), and a list argument of `Apply` bound
 * whole (CE-1483), on JavaScript. README of
 * `src/compute-engine/compilation/ir/`, "Lists"; `docs/COMPILATION-MODEL.md`,
 * "List updates". The witnesses are functions of Tycho's showcase preludes
 * (barnsley-fern, galton-board, koch-snowflake, turing-patterns).
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
  // A list of numbers held as a tensor.
  if (e.isCollection)
    return [...(e as never as { each(): Generator<Expression> }).each()].map(
      read
    );
  throw new Error(`no value: ${e.toString()}`);
}

/** The call `call` (MathJSON) after the Epsil program `source`: its
 *  compiled code (`fallback: false`) and the interpreter's value. */
function program(source: string, call: unknown[]) {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const expr = ce.box(call as never);
  return {
    compiled: () =>
      compile(expr, {
        to: 'javascript',
        fallback: false,
      } as never) as unknown as Result,
    interpreted: () => read(expr.evaluate().N()),
  };
}

/** The compiled value of `call` equals the interpreter's value, within
 *  `digits` decimal digits (the interpreter can keep a product exact). */
function agrees(source: string, call: unknown[], digits?: number) {
  const p = program(source, call);
  const code = p.compiled();
  expect(code.success).toBe(true);
  const got = code.run({});
  const want = p.interpreted();
  if (digits === undefined) return expect(got).toEqual(want);
  expect(Array.isArray(got) && Array.isArray(want)).toBe(true);
  const [g, w] = [got as number[], want as number[]];
  expect(g.length).toBe(w.length);
  g.forEach((x, i) => expect(x).toBeCloseTo(w[i], digits));
}

const declines = (source: string, call: unknown[]) =>
  failure(() => program(source, call).compiled());

describe('A real written to a list local of integers (CE-1480)', () => {
  test('the list is on the real lane from its declaration', () => {
    agrees(
      'function f(n: integer) { let L = [0 for k in 1..n]; for k in 1..n { L = replaceAt(L, k, k / 2 + 0.25) }; L }',
      ['f', 4]
    );
    // `0.0` is the integer 0 for the interpreter.
    agrees(
      'function f(n: integer) { let L = [0.0 for k in 1..2*n]; for k in 1..n { L[2*k - 1] = k / 4; L[2*k] = -k }; L }',
      ['f', 3]
    );
    agrees('function f(n: integer) { let L = [0, 0, n]; L[1] += 0.5; L }', [
      'f',
      3,
    ]);
  });

  test('the elements read before the write are the same numbers', () => {
    agrees(
      'function f(n: integer) { let L = [1, 2, n]; let a = L[1]; L[1] = 0.5; [a, L[1], L[3]] }',
      ['f', 3]
    );
    // An element read as an index, a loop bound, a remainder, a binomial.
    agrees(
      'function f(n: integer) { let L = [1, 2, n]; L[2] = 0.5; let s = 0; for k in 1..L[3] { s = s + k }; [L[L[1]], s, L[3] % 2, binomial(L[3], 2)] }',
      ['f', 3]
    );
    // A write that does not run: the interpreter keeps integers, the same
    // numbers.
    agrees(
      'function f(n: integer) { let L = [0, 0, n]; if n > 5 { L[1] = 0.5 }; L }',
      ['f', 3]
    );
  });

  test('two list locals, and a function called twice', () => {
    agrees(
      'function f(n: integer) { let L = [0, 0, n]; let M = [1, 1]; L[1] = 0.5; M[2] = 1.5; [L[1], M[2], M[1]] }',
      ['f', 3]
    );
    agrees(
      'function g(n: integer) { let L = [0 for k in 1..n]; for k in 1..n { L[k] = k / 4 }; L }\nfunction f(n: integer) { let A = g(n); let B = g(n + 1); [A[1], B[n + 1]] }',
      ['f', 3]
    );
  });

  test('a declared list<integer>, a complex and a boolean value decline', () => {
    // The interpreter gives an `incompatible-type` error.
    expect(
      declines(
        'function f(n: integer) { let L: list<integer> = [0 for k in 1..n]; L[1] = 0.5; L }',
        ['f', 3]
      )
    ).toMatch(/a real value written to a list of integer elements/);
    expect(
      declines('function f(n: integer) { let L = [0, 0, n]; L[1] = 2i; L }', [
        'f',
        3,
      ])
    ).toMatch(/a complex value written to a list of integer elements/);
    expect(
      declines(
        'function f(n: integer) { let L = [0, 0, n]; L[1] = n > 2; L }',
        ['f', 3]
      )
    ).toMatch(/a boolean value written to a list of integer elements/);
  });

  test('the barnsley-fern and galton-board preludes', () => {
    const fern = `function fern(n: integer) -> list<real> {
      let points = [0.0 for j in 1..2*n]
      let x = 0.0
      let y = 0.0
      let seed = 1
      for k in 1..n {
        seed = (16807 * seed) % 2147483647
        let choice = seed / 2147483647
        let oldX = x
        if choice < 0.01 {
          x = 0
          y = 0.16*y
        } else if choice < 0.86 {
          x = 0.85*oldX + 0.04*y
          y = -0.04*oldX + 0.85*y + 1.6
        } else if choice < 0.93 {
          x = 0.2*oldX - 0.26*y
          y = 0.23*oldX + 0.22*y + 1.6
        } else {
          x = -0.15*oldX + 0.28*y
          y = 0.26*oldX + 0.24*y + 0.44
        }
        points[2*k - 1] = x
        points[2*k] = y
      }
      points
    }`;
    agrees(fern, ['fern', 40], 12);
    const galton = `const BallCount = 20
    const RowCount = 12
    function dropBalls() -> list<real> {
      let L = [0.0 for j in 1..BallCount*(RowCount + 1)]
      let s = 1
      for b in 1..BallCount {
        let x = 0.0
        for r in 1..RowCount {
          s = (16807 * s) % 2147483647
          if s > 1073741823 { x = x + 0.5 } else { x = x - 0.5 }
          L[(b - 1)*(RowCount + 1) + r + 1] = x
        }
      }
      L
    }`;
    agrees(galton, ['dropBalls']);
  });
});

describe('A list local copied from a constant (CE-1481)', () => {
  test('the declaration copies the constant, which no write changes', () => {
    agrees(
      'const C = [1, 2, 3]\nfunction f(n: integer) { let L = C; L[1] = n; L[2] += 0.5; [L[1], L[2], C[1], C[2]] }',
      ['f', 7]
    );
    agrees(
      'const C = [1, 2, 3]\nfunction f(n: integer) { let L = C; L[1] = n; let M = C; M[2] = 9; [L[1], M[2], C[1], C[2], M[1]] }',
      ['f', 7]
    );
    agrees(
      'const C = [0.5, 2, 3]\nfunction f(n: integer) { let L = C; for k in 1..3 { L[k] = L[k] * n }; L }',
      ['f', 7]
    );
  });

  test('a list of tuples written in place, or rebuilt whole, declines', () => {
    expect(
      declines(
        'function f(n: integer) { let L = [(1.5, 2.0), (3.0, 4.5)]; L = replaceAt(L, 1, (n, 0.5)); L }',
        ['f', 7]
      )
    ).toMatch(/not a list of reals, integers or booleans/);
    expect(
      declines(
        'function f(n: integer) { let L = [1.5, 2.5]; for k in 1..n { L = [...L, k] }; L }',
        ['f', 2]
      )
    ).toMatch(/or to a list local other than ReplaceAt or AddTo/);
  });
});

describe('A list argument of Apply bound whole (CE-1483)', () => {
  const ce = new ComputeEngine();
  const literal = (t: string, body: unknown) => [
    'Function',
    body,
    ['Typed', 'H', `'${t}'`],
  ];
  ce.declare('L', 'list<real>');
  const L = [2.5, 1];
  // The list is the input `L`, so the compilation lowers the `Apply` (a
  // literal list would fold the whole expression to a constant).
  const both = (expr: unknown) => {
    const e = ce.box(expr as never);
    const code = compile(e, {
      fallback: false,
    } as never) as unknown as Result & {
      code: string;
    };
    expect(code.code).toMatch(/\bL\b/);
    const want = read(e.subs({ L: ce.box(['List', ...L]) }).evaluate());
    return [code.run({ L }), want];
  };

  test('a list of reals at a list<integer> or list<real<0..1>> parameter', () => {
    // The interpreter checks no element: 2.5, 0.5, 3.5.
    for (const [t, body] of [
      ['list<integer>', ['At', 'H', 1]],
      ['list<integer>', ['Mod', ['At', 'H', 1], 2]],
      ['list<real<0..1>>', ['At', 'H', 1]],
      [
        'list<integer>',
        [
          'Block',
          [
            'Declare',
            'L',
            ['Dictionary', ['KeyValuePair', { str: 'value' }, 'H']],
          ],
          ['AddTo', ['At', 'L', 1], 1],
          ['At', 'L', 1],
        ],
      ],
    ] as const) {
      const [got, want] = both(['Apply', literal(t, body), 'L']);
      expect(got).toBe(want);
    }
  });

  test('a tuple argument and a scalar of another type decline', () => {
    // The interpreter gives an `incompatible-type` error for both; the
    // canonical form already has it for the tuple of a stated type.
    expect(
      failure(() =>
        compile(
          ce.box([
            'Apply',
            literal('tuple<integer, integer>', ['At', 'H', 1]),
            ['Tuple', 2.5, 1],
          ] as never),
          { fallback: false } as never
        )
      )
    ).toMatch(/an error of the canonical form/);
    // An input whose type does not prove the parameter's.
    ce.declare('T', 'tuple<real, real>');
    expect(
      failure(() =>
        compile(
          ce.box([
            'Apply',
            literal('tuple<integer, integer>', ['At', 'H', 1]),
            'T',
          ] as never),
          { fallback: false } as never
        )
      )
    ).toMatch(/an argument of Apply that is not/);
    ce.declare('x', 'real');
    expect(
      failure(() =>
        compile(ce.box(['Apply', literal('integer', 'H'), 'x'] as never), {
          fallback: false,
        } as never)
      )
    ).toMatch(/an argument of Apply that is not integer/);
  });
});
