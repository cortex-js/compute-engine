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
// The limit is not one number. The size of a frame depends on the tier of
// the V8 just-in-time compiler that runs the function: an interpreted frame
// is larger than an optimized one. So the limit is lowest for the first
// compile in a process, and it rises as the compiler functions get
// optimized. The lowest case that the test suite exercises is the first
// compile of this file in a Jest worker that has already run other test
// files; in that worker the limit was lower than in a Jest process that runs
// this file alone. Measured on 2026-11-01 at commit b889aeb06 (`npx jest
// -w 2 -- test/compute-engine/compile-*.test.ts`, 277 files on two
// workers): the first compile succeeded at a chain depth of 325 and failed
// at 350, and succeeded at a Horner degree of 160 and failed at 175. In a
// process that ran this file alone, the first search found 374 and 249,
// and a second search in the same process 840 and 437.
//
// The depths below are about 20% below the first-compile limits in a warm
// worker, so that the test does not depend on the exact size of the stack
// or on which test files ran before it in the same worker. A failure of this
// test means that the stack use per level of nesting grew by about a
// quarter since 2026-11-01: between 2026-10-24 (commit e181a868a) and
// 2026-11-01, the limits measured with `tsx` fell from 499 and 342 to 374
// and 249, and the test's former depths of 350 and 150 lost their margin
// (the full suite failed at the release commit b889aeb06).
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
  test('a polynomial of degree 125 in Horner form compiles', () => {
    const e = horner(125);
    const result = compile(e);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0.5 }) as number).toBeCloseTo(
      e.subs({ x: 0.5 }).N().re,
      10
    );
  });

  test('a chain of 260 sines and cosines compiles', () => {
    const e = chain(260);
    const result = compile(e);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0.5 }) as number).toBeCloseTo(
      e.subs({ x: 0.5 }).N().re,
      10
    );
  });
});
