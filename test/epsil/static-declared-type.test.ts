import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';

//
// The per-statement declared-type check of the static pass
// (`declaredTypeMismatch` in `src/epsil/static-diagnostics.ts`): a `Declare`
// carrying both an annotation and an initializer is checkable without
// evaluating — report when the initializer's static type is PROVABLY
// incompatible with the annotation (disjoint types, or a closed literal that
// fails the full covariant check). Unproven means silent: unknown-typed
// values, overlapping types, and cross-statement bindings stay the run
// phase's job, so the pass is incomplete rather than unsound.
//

/** Run an Epsil program against a fresh engine and keep only the
 * static-type-error diagnostics. */
function staticErrors(source: string): string[] {
  const { diagnostics } = executeEpsil(new ComputeEngine(), source);
  return diagnostics
    .filter((d) => d.message[0] === 'static-type-error')
    .map((d) => String(d.message[1]));
}

describe('EPSIL STATIC DECLARED-TYPE CHECK — provable mismatches', () => {
  test('a disjoint literal is caught (`let s: string = 42`)', () => {
    const errors = staticErrors('let s: string = 42');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'The value "42" of type "finite_integer" is not compatible with the declared type "string"'
    );
  });

  test('the unnamed-signature near-miss is caught, with its explanation', () => {
    const errors = staticErrors('const f : (number) -> number = x^2 + 1');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('parameters bind only when they are named');
    expect(errors[0]).toContain('(x: number) -> number');
  });

  test('an overlapping-but-wrong closed literal is caught (`let n: integer = 1.5`)', () => {
    const errors = staticErrors('let n: integer = 1.5');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('not compatible with the declared type "integer"');
  });

  test('a boolean annotation against a number literal is caught', () => {
    expect(staticErrors('let b: boolean = 42')).toHaveLength(1);
  });

  test('the bare-annotation declaration form is covered too', () => {
    expect(staticErrors('s: string = 42')).toHaveLength(1);
  });

  test('the checkSource route (editor diagnostics) reports the same', () => {
    // `checkSource` never evaluates, so before this check the mistake was
    // invisible to the VSCode extension.
    const { diagnostics } = checkSource('let s: string = 42', 'probe.epsil');
    expect(
      diagnostics.filter((d) => d.message[0] === 'static-type-error')
    ).toHaveLength(1);
  });
});

describe('EPSIL STATIC DECLARED-TYPE CHECK — unproven stays silent', () => {
  test('overlapping types are the run phase’s call', () => {
    // `y + 1` types as a number; number and integer overlap, so no static
    // claim is provable (evaluation could narrow to an integer).
    expect(staticErrors('let n: integer = y + 1\n1')).toHaveLength(0);
  });

  test('an unknown-typed initializer says nothing', () => {
    expect(staticErrors('let q: integer = f(k)\n1')).toHaveLength(0);
  });

  test('a compatible declaration is clean', () => {
    const { value, diagnostics } = executeEpsil(
      new ComputeEngine(),
      'let s: string = "ok"\ns'
    );
    expect(diagnostics).toEqual([]);
    expect(value.string).toBe('ok');
  });

  test('a cross-statement function-valued initializer is not misjudged', () => {
    // `k` is bound by a PREVIOUS statement, which this pass deliberately does
    // not model: its type is unknown here, so no claim is made — and the
    // program runs fine.
    const { value, diagnostics } = executeEpsil(
      new ComputeEngine(),
      'const k = (x) => x + 1\nconst m : (number) -> number = k\nm(3)'
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('a declaration without an annotation or without a value is skipped', () => {
    expect(staticErrors('let z = 42\nz')).toHaveLength(0);
    expect(staticErrors('let z: integer\n1')).toHaveLength(0);
  });
});
