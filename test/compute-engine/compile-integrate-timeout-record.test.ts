/**
 * A symbolic integration attempt that TIMED OUT is not repeated while the
 * engine state it read is unchanged.
 *
 * Compiling an `Integrate` first searches for a closed form, under a
 * wall-clock budget, and emits numeric integration when the search fails. A
 * document compiles the same integral several times — once per target, and
 * again inside each helper that holds it — and every compilation repeated the
 * search to its limit (the Tycho corpus document `thpezd39zq`: five
 * compilations of about two seconds over two integrands). The compiler now
 * records an integral whose search used its whole budget, and goes to the
 * numeric emitter at once the next time, until an assignment, an assumption, a
 * configuration change, or a new type for one of the integral's symbols.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';

// The upper tail of a chi-squared density with a symbolic number of degrees
// of freedom: the search does not close it.
const TAIL = String.raw`\int_{x}^{\infty}\!\frac{\exp(-(y/2))y^{k/2-1}}{\Gamma(\frac{k}{2})\sqrt{2}^{k}}\, \mathrm{d}y`;

/** Compile, and report how many searches RAN and the emitted code. */
function compiled(
  ce: ComputeEngine,
  latex: string,
  to: 'javascript' | 'interval-js' = 'javascript'
) {
  const before = BaseCompiler.antiderivativeAttemptCount;
  const r = compile(ce.parse(latex), { to });
  expect(r.success).toBe(true);
  return {
    searches: BaseCompiler.antiderivativeAttemptCount - before,
    code: r.code,
  };
}

describe('A symbolic integration attempt that timed out', () => {
  // A short budget makes the search time out on every machine.
  beforeAll(() => BaseCompiler.setAntiderivativeAttemptBudgetForTesting(50));
  afterAll(() => BaseCompiler.setAntiderivativeAttemptBudgetForTesting());

  test('is not repeated for another target, or for the same one', () => {
    const ce = new ComputeEngine();
    const first = compiled(ce, TAIL);
    expect(first.searches).toBe(1);
    expect(first.code).toContain('_SYS.integrate');
    expect(compiled(ce, TAIL, 'interval-js').searches).toBe(0);
    const again = compiled(ce, TAIL);
    expect(again.searches).toBe(0);
    expect(again.code).toBe(first.code);
  });

  test('is not repeated inside a helper that holds the integral', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    expect(compiled(ce, `1-${TAIL}`).searches).toBe(0);
  });

  test('is repeated after an assignment', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.assign('k', 4);
    expect(compiled(ce, TAIL).searches).toBe(1);
  });

  test('is repeated after an assumption', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.assume(ce.parse('k > 2'));
    expect(compiled(ce, TAIL).searches).toBe(1);
  });

  test('is repeated after a change of precision', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.precision = 30;
    expect(compiled(ce, TAIL).searches).toBe(1);
  });

  test('is repeated when a symbol of the integral gets another type', () => {
    // `k` has an inferred type until it is declared. A declaration is not
    // an event the engine's `semantic` version counts, so the record's key
    // carries the types.
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    expect(compiled(ce, TAIL).searches).toBe(0);
    ce.declare('k', 'integer');
    expect(compiled(ce, TAIL).searches).toBe(1);
  });

  test('is not repeated after an unrelated declaration or parse', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.declare('m', 'integer');
    ce.parse('q + m').evaluate();
    expect(compiled(ce, TAIL).searches).toBe(0);
  });

  test('is repeated when a name of the integral resolves to another definition', () => {
    // A declaration in a nested scope shadows `k`. It is not an event the
    // `semantic` version counts, so the key says which definition a name
    // resolved to.
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.pushScope();
    ce.declare('k', 'integer');
    expect(compiled(ce, TAIL).searches).toBe(1);
    ce.popScope();
    expect(compiled(ce, TAIL).searches).toBe(0);
  });

  test('is repeated after the integration provider is replaced', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    const provider = ce._integrationProvider;
    ce._integrationProvider = (...args: unknown[]) =>
      (provider as ((...a: unknown[]) => unknown) | undefined)?.(...args);
    expect(compiled(ce, TAIL).searches).toBe(1);
  });

  test('is its own record in another engine', () => {
    const ce = new ComputeEngine();
    expect(compiled(ce, TAIL).searches).toBe(1);
    expect(compiled(new ComputeEngine(), TAIL).searches).toBe(1);
  });
});

describe('A symbolic integration attempt that completed', () => {
  test('a closed form is found again, and no record stops it', () => {
    const ce = new ComputeEngine();
    const latex = String.raw`\int_{0}^{x}\! t^2\, \mathrm{d}t`;
    const first = compiled(ce, latex);
    expect(first.searches).toBe(1);
    expect(first.code).not.toContain('_SYS.integrate');
    const again = compiled(ce, latex);
    expect(again.searches).toBe(1);
    expect(again.code).toBe(first.code);
  });
});
