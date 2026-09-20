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

  test('is not repeated when the same declarations are made again in a new scope', () => {
    // A host that declares the symbols of a row in a scope of its own for
    // every compilation makes new definition objects each time. The record
    // reads what a definition says, not which object it is.
    const ce = new ComputeEngine();
    const inScope = (type: string) => {
      ce.pushScope();
      try {
        ce.declare('k', type);
        ce.declare('x', 'real');
        return compiled(ce, TAIL).searches;
      } finally {
        ce.popScope();
      }
    };
    expect(inScope('real<0..>')).toBe(1);
    expect(inScope('real<0..>')).toBe(0);
    // A declared type that does not include the recorded one is another
    // question.
    expect(inScope('integer')).toBe(1);
  });

  test('is not repeated under WIDER declared types, and is under narrower ones', () => {
    // A host declares other types for another target: `k: real<0..>, x: real`
    // for JavaScript, `k: real, x: number` for the interval target. A search
    // that timed out knowing more about its symbols is not repeated knowing
    // less. A narrower type can be what lets a search finish, so that
    // direction searches again.
    const ce = new ComputeEngine();
    const inScope = (
      k: string,
      x: string,
      to: 'javascript' | 'interval-js'
    ) => {
      ce.pushScope();
      try {
        ce.declare('k', k);
        ce.declare('x', x);
        return compiled(ce, TAIL, to).searches;
      } finally {
        ce.popScope();
      }
    };
    expect(inScope('real<0..>', 'real', 'javascript')).toBe(1);
    expect(inScope('real', 'number', 'interval-js')).toBe(0);
    // Wider in one symbol, narrower in the other: not included.
    expect(inScope('number', 'integer', 'javascript')).toBe(1);
    // Narrower than everything recorded so far.
    expect(inScope('integer<1..>', 'integer', 'javascript')).toBe(1);
    // …and now that record answers the wider declarations too.
    expect(inScope('integer', 'real', 'javascript')).toBe(0);
  });

  describe('with a symbol declared WITH a value in a new scope', () => {
    // `c` is a coefficient of the integrand, declared with a value by the
    // host. A declaration does not advance the `semantic` version, so the
    // key has to tell these definitions apart.
    const SCALED = TAIL.replace(String.raw`\exp(`, String.raw`c\exp(`);
    const searches = (
      ce: ComputeEngine,
      def: Parameters<ComputeEngine['declare']>[1]
    ) => {
      ce.pushScope();
      try {
        ce.declare('c', def);
        return compiled(ce, SCALED).searches;
      } finally {
        ce.popScope();
      }
    };

    test('an equal value is not searched again, another value is', () => {
      const ce = new ComputeEngine();
      const held = { type: 'real', value: 2.5, holdUntil: 'N' } as const;
      expect(searches(ce, held)).toBe(1);
      expect(searches(ce, held)).toBe(0);
      expect(searches(ce, { ...held, value: 3.5 })).toBe(1);
    });

    test('another substitution policy is searched again', () => {
      // Held until `N`, the search sees the symbol `c`; held until
      // `evaluate`, it sees the number.
      const ce = new ComputeEngine();
      const held = { type: 'real', value: 2.5, holdUntil: 'N' } as const;
      expect(searches(ce, held)).toBe(1);
      expect(searches(ce, { ...held, holdUntil: 'evaluate' })).toBe(1);
    });

    test('a value that mentions a symbol is searched again', () => {
      // Its digest names `m` whatever `m` is bound to, so the definition is
      // told apart by which object it is.
      const ce = new ComputeEngine();
      ce.declare('m', 'real');
      const held = { type: 'real', value: ce.parse('m+1'), holdUntil: 'N' } as const;
      expect(searches(ce, held)).toBe(1);
      expect(searches(ce, held)).toBe(1);
    });
  });

  test('keeps the type it timed out under when the host changes its type object', () => {
    // A host can declare with a type OBJECT of its own, change it, and
    // declare with it again. The record must not change with it.
    const ce = new ComputeEngine();
    const kType = { kind: 'numeric', type: 'real', lower: 0 } as {
      kind: 'numeric';
      type: 'real';
      lower: number;
    };
    const inScope = () => {
      ce.pushScope();
      try {
        ce.declare('k', { type: kType as never });
        ce.declare('x', 'real');
        return compiled(ce, TAIL).searches;
      } finally {
        ce.popScope();
      }
    };
    expect(inScope()).toBe(1);
    expect(inScope()).toBe(0);
    // Narrower now: `real<1..>` does not include the recorded `real<0..>`.
    kType.lower = 1;
    expect(inScope()).toBe(1);
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
