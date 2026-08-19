import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

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

describe('typed patterns (phase 2): compound types and the protocol arm of `is`', () => {
  test('compound types on the `is` surface', () => {
    const ce = new ComputeEngine();
    expect(run(ce, '[1,2] is list<integer>')).toBe('"True"');
    expect(run(ce, '["a"] is list<integer>')).toBe('"False"');
    expect(run(ce, '3 is number | string')).toBe('"True"');
    expect(run(ce, '3 is !error')).toBe('"True"');
  });

  test('an Error value is inspectable on the `is` surface', () => {
    const ce = new ComputeEngine();
    expect(run(ce, '("a" + 1) is error')).toBe('"True"');
    expect(run(ce, '("a" + 1) is !error')).toBe('"False"');
  });

  test('`&&` stays a conjunction of two tests, never an intersection type', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'let x = 3\nlet y = "a"\nx is integer && y is string')).toBe(
      '"True"'
    );
  });

  test('protocol names and protocol conjunctions on `is`', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Marker { }\nprotocol Marker2 { }\n' +
        'type pt = tuple<x: integer, y: integer>\n' +
        'type pt is Marker\ntype pt is Marker2'
    );
    expect(run(ce, 'let p = pt(1,2)\np is Marker')).toBe('"True"');
    expect(run(ce, 'p is Marker & Marker2')).toBe('"True"');
    expect(run(ce, '3 is Marker')).toBe('"False"');
  });

  test('a mixed protocol/type `&` tail is a diagnostic, not a test', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'protocol Marker { }');
    const r = executeEpsil(ce, 'let q = 3\nq is Marker & integer');
    const codes = (r.diagnostics ?? []).map((d: any) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );
    expect(codes).toContain('type-annotation-error');
  });

  test('a type continuation after a protocol name is a diagnostic, not a test', () => {
    const protocols = 'protocol Marker { }\nprotocol Marker2 { }';
    // `|`, `<` and `->` continue a TYPE; none of them can extend a
    // conformance test, so each is diagnosed at the operator rather than
    // returning `Conforms(q, "Marker")` and stranding the rest of the tail
    // for the expression grammar.
    for (const tail of [
      'q is Marker | integer',
      'q is Marker < 3',
      'q is Marker -> integer',
      'q is Marker & Marker2 | integer',
    ]) {
      const ce = new ComputeEngine();
      executeEpsil(ce, protocols);
      const r = executeEpsil(ce, `let q = 3\n${tail}`);
      const codes = (r.diagnostics ?? []).map((d: any) =>
        Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
      );
      expect(codes).toContain('type-annotation-error');
    }
    // `||`/`&&` are single tokens, so a boolean use of the conformance
    // result is untouched by the check above.
    const ce = new ComputeEngine();
    executeEpsil(ce, protocols);
    expect(run(ce, 'let q = 3\nq is Marker || 1 == 1')).toBe('"True"');
  });

  test('a layout-record type is spelled parenthesized on the `is` surface', () => {
    const ce = new ComputeEngine();
    // A brace after the type name stays a BLOCK opener, so the layout-record
    // type goes in parentheses, reaching the compound-type fallthrough.
    expect(run(ce, '{"a" -> 1} is (record{a: integer})')).toBe('"True"');
    expect(run(ce, '{"a" -> 1} is record')).toBe('"True"');
    expect(run(ce, '3 is (record{a: integer})')).toBe('"False"');
    // A dictionary VALUE is a value form, so a shape mismatch is a definitive
    // False — wrong key and wrong value type alike (this depended on
    // dictionaries being reachable in `isValueForm`; both stayed symbolic
    // before that fix).
    expect(run(ce, '{"a" -> 1} is (record{b: integer})')).toBe('"False"');
    expect(run(ce, '{"a" -> "s"} is (record{a: integer})')).toBe('"False"');
  });

  test('`if x is record { … }` keeps its block reading', () => {
    // The unparenthesized `x is record` followed by `{` is deliberately a
    // bare-`record` test plus a block, not a layout-record type.
    const [, diags] = parseEpsil('let x = 3\nif x is record { 1 } else { 2 }');
    expect(diags).toHaveLength(0);
    const ce = new ComputeEngine();
    expect(run(ce, 'let x = 3\nif x is record { 1 } else { 2 }')).toBe('2');
    expect(
      run(ce, 'let x = {"a" -> 1}\nif x is record { 1 } else { 2 }')
    ).toBe('1');
  });

  test('match patterns take full type expressions with the same lowering', () => {
    const ce = new ComputeEngine();
    expect(
      run(ce, 'match [1,2] {\n  n: list<integer> => "ints"\n  _ => "other"\n}')
    ).toBe('"ints"');
    expect(
      run(ce, 'match ["a"] {\n  n: list<integer> => "ints"\n  _ => "other"\n}')
    ).toBe('"other"');
    expect(
      run(ce, 'match 3 {\n  n: number | string => "scalar"\n  _ => "other"\n}')
    ).toBe('"scalar"');
  });

  test('protocol names stay OUT of match patterns (ruling R5)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'protocol Marker { }');
    const r = executeEpsil(
      ce,
      'match 3 {\n  n: Marker => "m"\n  _ => "o"\n}'
    );
    const codes = (r.diagnostics ?? []).map((d: any) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );
    expect(codes).toContain('protocol-in-type-position');
  });

  test('a typo on the `is` surface is a parse-time diagnostic', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, '3 is intger');
    const codes = (r.diagnostics ?? []).map((d: any) =>
      Array.isArray(d.message) ? String(d.message[0]) : String(d.message)
    );
    expect(codes).toContain('type-annotation-error');
  });

  test('the trio completes: `is type` is now spellable', () => {
    const ce = new ComputeEngine();
    expect(run(ce, 'TypeFrom("integer") is type')).toBe('"True"');
    expect(run(ce, 'TypeFrom("integer") is number')).toBe('"False"');
  });
});
