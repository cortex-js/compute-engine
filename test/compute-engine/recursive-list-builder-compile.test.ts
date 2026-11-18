/**
 * A recursive Epsil program that builds a list through a local copied from
 * a parameter declared `list` compiles (row 339 of the Tycho ledger,
 * `tycho/docs/COMPUTE_ENGINE.md`, 2026-09-29). A self-call in a `function`
 * clause body types `unknown` while the clause canonicalizes and installs
 * (`_recursionKnotNames`); before, the knot's bare `function` type made
 * `out = f(n - 1, out)` a broadcast guess that widened `out` past the list
 * its spread gives.
 *
 * A copy of an UNTYPED parameter into a local is not a use of the
 * parameter (user decision 2026-11-14): `let out = acc` followed by a use of
 * `out` as a list gives `acc` no type, and a call with a list is applied to
 * each element.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';
import { CancellationError } from '../../src/common/interruptible';

function box(src: string) {
  const [program, diagnostics] = parseEpsil(src);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const ce = new ComputeEngine();
  const expr = ce.box(resolveLibraryNames(program, src, ce));
  return { ce, expr };
}

function signatureOf(expr: any, name: string): string | undefined {
  let found: string | undefined;
  const walk = (e: any) => {
    if (e.operator === 'DefineFunction' && e.op1.symbol === name)
      found = String(e.op2.type);
    for (const op of e.ops ?? []) walk(op);
  };
  walk(expr);
  return found;
}

describe('a local copied from an untyped parameter (Tycho row 339)', () => {
  test('the parameter learns nothing from the use of the local', () => {
    const { expr } = box(
      'function f(acc) { let out = acc; out = [...out, 1]; out }\nf([0])'
    );
    expect(signatureOf(expr, 'f')).toBe('(acc: unknown) -> unknown');
    expect(expr.evaluate().toString()).toBe('[[0,1]]');
    const { expr: annotated } = box(
      'function f(acc: list) { let out = acc; out = [...out, 1]; out }\nf([0])'
    );
    expect(signatureOf(annotated, 'f')).toBe('(acc: list) -> list');
    expect(annotated.evaluate().toString()).toBe('[0,1]');
  });

  test('a local reassigned from an untyped call before its use forwards nothing', () => {
    const { ce, expr } = box(
      'function f(acc) { let out = acc; out = g(acc); out + 1 }\nf(2)'
    );
    // `g` is unknown, so `out = g(acc)` records no evidence and `out` stays
    // `unknown`; the narrowing by `out + 1` must not reach `acc`.
    expect(signatureOf(expr, 'f')).toBe('(acc: unknown) any -> number');
    expect(ce._recursionKnots.size).toBe(0);
  });

  test('a captured outer local as the initializer learns nothing either', () => {
    const { expr } = box(
      'let acc = g()\nfunction f() { let out = acc; out = [...out, 1]; out }\nf()'
    );
    expect(signatureOf(expr, 'f')).toBe('() -> unknown');
  });

  test('a local assigned before its use forwards nothing', () => {
    const { expr } = box(
      'function g(acc) { let out = acc; out = 5; out + 1 }\ng(2)'
    );
    expect(signatureOf(expr, 'g')).toBe('(acc: unknown) -> number');
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('a recursive list builder compiles', () => {
    const { expr } = box(
      'function f(n, acc: list) { let out = acc; if n > 0 { out = [...out, n]; out = f(n - 1, out) }; out }\nf(3, [])'
    );
    expect(signatureOf(expr, 'f')).toBe('(n: unknown, acc: list) -> list');
    expect(expr.evaluate().toString()).toBe('[3,2,1]');
  });

  test('a self-call with a whole parameter derives the base clause result', () => {
    const { expr } = box(
      'function r(xs, n) { if n <= 0 { mean(xs) } else { r(xs, n - 1) } }\nr([1, 2, 3], 2)'
    );
    expect(signatureOf(expr, 'r')).toBe(
      '(xs: collection<number> | value, n: unknown) -> number'
    );
    expect(expr.evaluate().toString()).toBe('2');
  });
});

describe('THE RECURSION KNOT AFTER A FAILED CANONICALIZATION', () => {
  // The knot of a clause is registered before its body canonicalizes and
  // released after the clause is installed. An error in the body
  // canonicalization (here a cancellation, as a deadline throws) skipped the
  // release, and the knot stayed registered for the life of the engine.
  test('a cancellation in the body releases the knot', () => {
    const ce = new ComputeEngine();
    ce.declare('Interrupt', {
      signature: '(any) -> any',
      canonical: () => {
        throw new CancellationError({ cause: 'timeout' });
      },
    });
    expect(() =>
      ce.box(['DefineFunction', 'f', ['Function', ['Interrupt', 'x'], 'x']])
    ).toThrow(CancellationError);
    expect(ce._recursionKnots.size).toBe(0);
  });
});
