/**
 * A destructuring `let` inside a loop body compiles to JavaScript.
 *
 * The statement list of a loop body is lowered by its own routine, not by the
 * block lowering. That routine desugared a destructuring ASSIGNMENT into
 * per-leaf writes, but not a destructuring DECLARATION
 * (`let (a, x) = (2, 3)`). The declaration then reached the value-position
 * `Declare` lowering, which fails closed, and the whole program declined with
 * "Could not compile a destructuring declaration in value position". Every
 * statement of a loop body is in statement position (the body has no value),
 * so the declaration is now desugared into per-leaf declarations there, as the
 * block lowering does for a block's statements.
 *
 * Every program is checked for parity between `evaluate()` and the compiled
 * `run()`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { parseEpsil } from '../../src/epsil/parse-epsil';

/** The interpreted and the compiled value of an Epsil program. */
function parity(source: string): { evaluated: number; compiled: number } {
  const ce = new ComputeEngine();
  const [program] = parseEpsil(source);
  const expr = ce.box(program);
  const result = compile(expr, { to: 'javascript' });
  if (!result.success)
    throw new Error(`did not compile: ${source}\n${JSON.stringify(result)}`);
  return {
    evaluated: expr.evaluate().N().re,
    compiled: result.run!({}) as number,
  };
}

function expectParity(source: string, expected: number): void {
  const { evaluated, compiled } = parity(source);
  expect(evaluated).toBe(expected);
  expect(compiled).toBe(expected);
}

describe('Destructuring let in a compiled loop body', () => {
  test('while loop, destructuring let as the first statement', () => {
    expectParity(
      `let n = 0
while n < 4 { let (a, x) = (2, 3); n = n + a }
n`,
      4
    );
  });

  test('while loop, destructuring let as the last statement', () => {
    expectParity(
      `let n = 0
while n < 4 { n = n + 1; let (a, x) = (2, 3) }
n`,
      4
    );
  });

  test('while loop, two destructuring lets and a nested pattern', () => {
    expectParity(
      `let s = 0
let i = 0
while i < 3 { i = i + 1; let (a, (b, c)) = (i, (2, 3)); let (d, e) = (a, 1); s = s + a + b + c + d + e }
s`,
      // Each turn adds 2i + 6 for i = 1, 2, 3.
      30
    );
  });

  test('for loop, destructuring let as a middle statement', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { let (a, b) = (k, 2 * k); s = s + a + b }
s`,
      18
    );
  });

  test('for loop, destructuring let as the last statement', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { s = s + k; let (a, b) = (k, 2 * k) }
s`,
      6
    );
  });

  test('for loop, destructuring let of a tuple-valued call', () => {
    expectParity(
      `function f(k) { (k, k + 1) }
let s = 0
for k in [1, 2, 3] { let (a, b) = f(k); s = s + a * b }
s`,
      20
    );
  });

  test('for loop, destructuring let inside an if branch', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { if k > 1 { let (a, b) = (k, 10); s = s + a * b } }
s`,
      50
    );
  });

  test('a leaf that shadows an outer local does not write it', () => {
    expectParity(
      `let a = 100
let s = 0
for k in [1, 2] { let (a, b) = (k, 1); s = s + a + b }
s + a`,
      105
    );
  });

  test('a bare destructuring declare as the whole loop body (MathJSON)', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', 'integer', 0],
      [
        'Loop',
        ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 1]],
        ['Element', 'k', ['List', 1, 2, 3]],
      ],
      's',
    ]);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(0);
    expect(expr.evaluate().re).toBe(0);
  });
});
