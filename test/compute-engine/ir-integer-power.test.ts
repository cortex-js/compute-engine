/**
 * A power of an integer base by a literal integer exponent `>= 1` is an
 * integer, on the integer lane, as the interpreter types it (CE-1484):
 * `n^2` of an integer `n` is `integer<0..>`. README of
 * `src/compute-engine/compilation/ir/`, "The contracts" (`Power`). The
 * witness is the function `seedState()` of Tycho's showcase prelude
 * turing-patterns.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Result = {
  success: boolean;
  code: string;
  run: (inputs: object) => unknown;
};

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

/** The interpreter's value: a list is an array. */
function read(e: Expression): unknown {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List')) return e.ops.map(read);
  if (e.isCollection)
    return [...(e as never as { each(): Generator<Expression> }).each()].map(
      read
    );
  throw new Error(`no value: ${e.toString()}`);
}

/** The engine after the Epsil program `source`, with the input `n` an
 *  integer. */
function engine(source: string): ComputeEngine {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  ce.declare('n', 'integer');
  return ce;
}

const compiled = (e: Expression, to = 'javascript') =>
  compile(e, { to, fallback: false } as never) as unknown as Result;

/** The compiled value of `call` at each `n` equals the interpreter's. */
function agrees(source: string, call: unknown, ns: number[]) {
  const ce = engine(source);
  const e = ce.box(call as never);
  const code = compiled(e);
  expect(code.success).toBe(true);
  for (const n of ns)
    expect(code.run({ n })).toEqual(
      read(
        e
          .subs({ n: ce.number(n) })
          .evaluate()
          .N()
      )
    );
}

const SEED = `const N = 8
function inSeedSquare(c: integer, r: integer) -> boolean { abs(c - 4) <= 1 && abs(r - 4) <= 1 }
function seedState() -> list<real> {
  let CellCount = N^2
  [if k <= CellCount {
     if inSeedSquare((k - 1) % N, floor((k - 1)/N)) { 0.5 } else { 1.0 }
   } else {
     if inSeedSquare((k - CellCount - 1) % N, floor((k - CellCount - 1)/N)) { 0.25 } else { 0.0 }
   } for k in 1..2*CellCount]
}`;

describe('An integer power is an integer (CE-1484)', () => {
  test('the witness: a count computed as a square', () => {
    const ce = engine(SEED);
    const e = ce.box(['seedState'] as never);
    const code = compiled(e);
    expect(code.success).toBe(true);
    const want = read(e.evaluate().N()) as number[];
    expect(want.length).toBe(128);
    expect(code.run({})).toEqual(want);
  });

  test('the witness with the size an input', () => {
    agrees(
      `function inSeedSquare(c: integer, r: integer) -> boolean { abs(c - 4) <= 1 && abs(r - 4) <= 1 }
function seedState(N: integer) -> list<real> {
  let CellCount = N^2
  [if k <= CellCount {
     if inSeedSquare((k - 1) % N, floor((k - 1)/N)) { 0.5 } else { 1.0 }
   } else {
     if inSeedSquare((k - CellCount - 1) % N, floor((k - CellCount - 1)/N)) { 0.25 } else { 0.0 }
   } for k in 1..2*CellCount]
}`,
      ['seedState', 'n'],
      [1, 3, 8, 10]
    );
  });

  test('a power of an input at an integer parameter', () => {
    const source = 'function g(c: integer) -> integer { c % 7 }';
    agrees(source, ['g', ['Power', 'n', 2]], [-5, -1, 0, 1, 6, 1000]);
    agrees(
      source,
      ['g', ['Power', ['Subtract', 'n', 3], 3]],
      [-5, -1, 0, 3, 6, 1000]
    );
    agrees(source, ['g', ['Power', 'n', 5]], [-9, -2, 0, 2, 9, 1000]);
    agrees(source, ['g', ['Power', 'n', 17]], [-3, -2, 0, 1, 2, 7]);
    agrees(
      'function f(n: integer) -> integer { let s = n^2; s = s + n^3; s % 1000 }',
      ['f', 'n'],
      [-7, 0, 1, 5, 40]
    );
    // A local that holds an integer power, the base of another one.
    agrees(
      'function g(c: integer) -> integer { c % 7 }\nfunction h2(n: integer) -> integer { let c = n^2\n let d = c^2\n g(d) }',
      ['h2', 'n'],
      [-4, 0, 1, 6, 100]
    );
  });

  test('past 2^53 the power is the product of the same factors', () => {
    // An integer of 2^53 or more is a double, its low digits unspecified
    // (README, "The contracts"): `Mod(n^34, 7)` at n = 3 is the value of
    // the 34-fold product, where the interpreter's exact value is 4.
    const ce = engine('');
    const power = compiled(ce.box(['Mod', ['Power', 'n', 34], 7] as never));
    const product = compiled(
      ce.box(['Mod', ['Multiply', ...Array(34).fill('n')], 7] as never)
    );
    expect(power.run({ n: 3 })).toBe(product.run({ n: 3 }));
  });

  test('the code is the exact product', () => {
    const ce = engine('');
    const square = ce.box(['Power', 'n', 2] as never);
    expect(compiled(square).code).toMatch(/\(_\.n \* _\.n\)/);
    expect(compiled(square, 'glsl').code).toMatch(/\(n \* n\)/);
    // By squaring: `n^5` is `(n^2)^2 · n`.
    const fifth = compiled(ce.box(['Power', 'n', 5] as never)).code;
    expect(fifth).toMatch(/const (v\d+) = \(_\.n \* _\.n\);/);
    expect(fifth).not.toMatch(/_SYS\.ir\.pow/);
  });

  test('a power that the interpreter does not type integer stays real', () => {
    // `n^k` is a rational at `k < 0`: `real` for the interpreter, and a
    // real argument at an integer parameter declines.
    const ce = engine('function g(c: integer) -> integer { c % 7 }');
    ce.declare('k', 'integer');
    expect(
      failure(() => compiled(ce.box(['g', ['Power', 'n', 'k']] as never)))
    ).toMatch(/an argument of g that is not integer/);
    const x = compiled(ce.box(['Power', 'n', 'k'] as never));
    expect(x.run({ n: 2, k: -2 })).toBe(0.25);
  });
});
