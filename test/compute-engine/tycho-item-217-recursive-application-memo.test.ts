import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Tycho item 217 — a recursive document function that applies itself twice
 * per level, `R(i,x,y) = R(i-1,x,y) + 0.5·S(x,y,R(i-1,x,y))`, cost the
 * INTERPRETER 2^i body evaluations at depth `i`: every application of a pure
 * literal re-ran the body even when the same application — same literal,
 * same number-literal arguments — had just been computed in the same
 * evaluation. Depth 20 took minutes; the compiled artifact, whose CSE pass
 * binds the repeated self-call, took microseconds.
 *
 * Applications of a PURE user-function literal to number-literal arguments
 * are now memoized (`makeLambda`, `function-utils.ts`), keyed by the literal
 * and the arguments and stamped with `IComputeEngine._applicationEpoch`,
 * which every write to a symbol binding or definition advances — so a pure
 * body that reads an assigned free symbol is never answered from a stale
 * memo.
 */

function setup(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const d of [
    String.raw`L(x,y,z) := \sqrt{x^{2}+y^{2}+z^{2}}`,
    String.raw`G(x,y,z) := \operatorname{abs}(\sin(x)\cos(y)+\sin(y)\cos(z)+\sin(z)\cos(x))`,
    String.raw`C(x,y,z) := \max(\operatorname{abs}(x),\operatorname{abs}(y),\operatorname{abs}(z-6))-3`,
    String.raw`S(x,y,l) := \max(G(2lx,2ly,2l),C(lx,ly,l))`,
  ])
    ce.parse(d).evaluate();
  // The shape Tycho's document manager binds: a declared name assigned a
  // merged clause-dispatch literal, `i` renamed away from the imaginary unit.
  ce.declare('R', '(number, number, number) -> number');
  const P = 'i_recparam0';
  ce.pushScope();
  ce.declare(P, { type: 'unknown' });
  ce.declare('x', { type: 'unknown' });
  ce.declare('y', { type: 'unknown' });
  const general = ce.box(
    [
      'Add',
      ['R', ['Subtract', P, 1], 'x', 'y'],
      ['Multiply', 0.5, ['S', 'x', 'y', ['R', ['Subtract', P, 1], 'x', 'y']]],
    ],
    { form: 'structural' }
  ).canonical.json;
  ce.popScope();
  ce.assign(
    'R',
    ce.box([
      'Function',
      ['Which', ['Equal', P, 0], 0, 'True', general],
      P,
      'x',
      'y',
    ])
  );
  return ce;
}

describe('Tycho item 217: a pure recursive application is memoized within an evaluation', () => {
  test('depth 20 evaluates in linear time and agrees with the compiled artifact', () => {
    const ce = setup();
    const compiled = compile(ce.parse('R(n,x,y)'), { to: 'javascript' });
    expect(compiled.success).not.toBe(false);
    if (compiled.success === false) return;
    const t0 = performance.now();
    const v = ce.parse('R(20,0.3,0.7)').N();
    const elapsed = performance.now() - t0;
    expect(v.re).toBeCloseTo(
      compiled.run({ n: 20, x: 0.3, y: 0.7 }) as number,
      12
    );
    // 2^20 body evaluations took minutes; 20 take milliseconds. The bound is
    // generous so a loaded machine cannot fail it, yet two orders of
    // magnitude under the exponential cost.
    expect(elapsed).toBeLessThan(5000);
  });

  test('the exact route is memoized separately from the numeric one', () => {
    const ce = setup();
    expect(ce.parse('R(3,1,1)').evaluate().toString()).toBe(
      ce.parse('R(3,1,1)').evaluate().toString()
    );
    expect(ce.parse('R(3,1,1)').N().re).toBeCloseTo(
      ce.parse('R(3,1,1)').evaluate().N().re,
      12
    );
  });

  test('an assignment between two applications invalidates the memo', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'real');
    ce.assign('c', 1);
    ce.parse(String.raw`T(k) := k + c`).evaluate();
    expect(ce.parse('T(2)').evaluate().toString()).toBe('3');
    ce.assign('c', 10);
    expect(ce.parse('T(2)').evaluate().toString()).toBe('12');
    // A redefinition of the function itself too.
    ce.parse(String.raw`T(k) := 2k + c`).evaluate();
    expect(ce.parse('T(2)').evaluate().toString()).toBe('14');
  });

  test('a field store on a mutable object invalidates the memo (no engine-wide axis moves for it)', () => {
    const ce = new ComputeEngine();
    const run = (source: string): string => {
      const { value, diagnostics } = executeEpsil(ce, source);
      expect(diagnostics).toEqual([]);
      return String(value);
    };
    expect(
      run(`type Person = object{name: string, age: integer}
let p = Person(name: "Alan", age: 42)
f(t) = t + p.age
f(1)`)
    ).toBe('43');
    expect(
      run(`p.age = 10
f(1)`)
    ).toBe('11');
  });

  test('an impure body is never memoized', () => {
    const ce = new ComputeEngine();
    ce.parse(String.raw`D(k) := k + \operatorname{Random}()`).evaluate();
    const a = ce.parse('D(1)').N().re;
    const b = ce.parse('D(1)').N().re;
    expect(a).not.toBe(b);
  });

  test('a symbolic argument is never memoized (the result depends on the symbol, not the engine state)', () => {
    const ce = new ComputeEngine();
    ce.parse(String.raw`U(k) := k^2`).evaluate();
    expect(ce.parse('U(x)').evaluate().toString()).toBe('x^2');
    ce.assign('x', 3);
    expect(ce.parse('U(x)').evaluate().toString()).toBe('9');
  });
});
