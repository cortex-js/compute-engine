// The compiler is recursive: each level of a nested expression keeps a few
// frames on the stack, and an expression nested deeply enough overflows it.
// The compile then fails safely (`success: false`, and `run` calls the
// interpreter), but the expression is not compiled. A polynomial in Horner
// form, `a₀ + x(a₁ + x(a₂ + …))`, nests two levels per degree, so this limit
// is reached by a realistic expression. On 2026-10-24 a `Sin`/`Cos` chain
// compiled up to a depth of about 280, and Horner form up to a degree of
// about 120 to 140.
//
// Two changes raised the limits to about 420 and 205 to 228: the large
// cases of `compileExpr` and `_compileInner` moved to helper functions, so
// the frames on the stack are smaller, and two callbacks on the path of
// every operand were removed. The fold check reads `unknowns` from a memo of
// the compilation, so a deep node does not walk the rest of the tree on top
// of the compiler's stack.
//
// The depths below are above the old limits and about 20% below the new
// ones, so that the test does not depend on the exact size of the stack.
//
// ROADMAP CE-320.2.

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();

/** `a₀ + x(a₁ + x(… + x·1))` with coefficients 1 to 7. */
function horner(degree: number): Expression {
  let e: Expression = ce.number(1);
  for (let i = 0; i < degree; i++)
    e = ce.function('Add', [
      ce.number((i % 7) + 1),
      ce.function('Multiply', [ce.symbol('x'), e]),
    ]);
  return e;
}

/** `Sin(Cos(Sin(… x)))`, `depth` levels. */
function chain(depth: number): Expression {
  let e: Expression = ce.symbol('x');
  for (let i = 0; i < depth; i++) e = ce.function(i % 2 ? 'Cos' : 'Sin', [e]);
  return e;
}

describe('compiling a deeply nested expression', () => {
  test('a polynomial of degree 150 in Horner form compiles', () => {
    const e = horner(150);
    const result = compile(e);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0.5 }) as number).toBeCloseTo(
      e.subs({ x: 0.5 }).N().re,
      10
    );
  });

  test('a chain of 350 sines and cosines compiles', () => {
    const e = chain(350);
    const result = compile(e);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0.5 }) as number).toBeCloseTo(
      e.subs({ x: 0.5 }).N().re,
      10
    );
  });
});
