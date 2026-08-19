import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// The Epsil surface of first-class type values (phase 1):
// `TypeFrom("...")` construction, the `type` annotation, `Subtype`, and the
// `==` tier. Design: `docs/plans/2026-08-18-first-class-types.md`.

function run(ce: ComputeEngine, source: string): string {
  const r = executeEpsil(ce, source);
  return String(r.value ?? r);
}

describe('type values on the Epsil surface', () => {
  test('construction, and the `type` annotation', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'let t: type = TypeFrom("list<integer>")\nt')).toBe(
      'TypeFrom("list<integer>")'
    );
  });

  test('the annotation is optional — inference types the binding', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'let u = TypeFrom("integer")\nType(u)')).toBe('"type"');
  });

  test('printing round-trips: the printed form re-executes to the same value', () => {
    const ce = new ComputeEngine();
    const printed = run(ce, 'TypeFrom("integer|real")');
    // The printed form is the settled constructor call over canonical text...
    expect(printed).toBe('TypeFrom("real")');
    // ...and feeding it back is a fixed point (settling is idempotent).
    expect(run(ce, printed)).toBe(printed);
  });

  test('Subtype with string and value operands', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'Subtype("integer", "number")')).toBe('"True"');
    expect(run(ce, 'Subtype("number", "integer")')).toBe('"False"');
    expect(
      run(ce, 'let t = TypeFrom("integer")\nSubtype(t, "number")')
    ).toBe('"True"');
  });

  test('== is the mutual-subtyping tier; strings never equal a type value', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'TypeFrom("integer|real") == TypeFrom("real")')).toBe(
      '"True"'
    );
    expect(run(ce, 'TypeFrom("integer") == "integer"')).toBe('"False"');
  });

  test('a bad type text is an error value at the construction site', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'TypeFrom("intger")')).toContain('invalid-value');
    expect(run(ce, 'Subtype("intger", "number")')).toContain('invalid-value');
  });

  test('a type value is a value: `is` never unwraps it', () => {
    const ce = new ComputeEngine();
    // `TypeFrom("integer") is number` asks about the VALUE (a type value is
    // not a number); the type-level question is Subtype's. Plan §3.2,
    // "is never unwraps" — pinned as a trio with `is type` once the `type`
    // name is testable on the `is` surface (phase 2 re-lowers `is`; today's
    // Element lowering already answers the value-level question correctly).
    expect(run(ce, 'TypeFrom("integer") is number')).toBe('"False"');
  });
});
