import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The absence markers `Nothing`, `Missing` and `Undefined` cannot be rebound
// (user decision 2026-09-27). The engine recognizes each one by its NAME —
// `Nothing` is dropped from operand lists, and arithmetic reads a `Missing`
// or `Undefined` operand as absent whatever it is bound to — so a binding of
// one of them could never behave like the value it holds. Every other
// capitalized library name is shadowed by a user binding
// (`test/compute-engine/library-name-shadowing.test.ts`).
//
// Two tiers: the static pass reports every binding site
// (`absenceMarkerBindingDiagnostics`, `static-diagnostics.ts`), and the
// `Declare`/`Assign`/`DefineFunction` handlers evaluate to the error
// (`library/core.ts`), so the box route refuses too.
//
function codes(source: string): string[] {
  return executeEpsil(new ComputeEngine(), source).diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message.join(':') : String(d.message)
  );
}

describe('a binding of an absence marker is an error', () => {
  test.each([
    ['let Nothing = 3', 'Nothing'],
    ['let Missing = 3', 'Missing'],
    ['const Undefined = 3', 'Undefined'],
    ['Missing = 3', 'Missing'],
    ['let (a, Missing) = (1, 2)', 'Missing'],
    ['function Undefined(x) { x }', 'Undefined'],
    ['f(Nothing) = 1', 'Nothing'],
    ['(Undefined) => 1', 'Undefined'],
    ['for Missing in [1] { 1 }', 'Missing'],
    ['match 3 { Missing => 1 }', 'Missing'],
    ['sum(Missing, Missing in [1, 2])', 'Missing'],
  ])('%j', (source, name) => {
    expect(codes(source)).toEqual([`absence-marker-binding:${name}`]);
  });

  test('every assignment of a marker is reported', () => {
    expect(codes('Missing = 1\nMissing = 2\n0')).toEqual([
      'absence-marker-binding:Missing',
      'absence-marker-binding:Missing',
    ]);
  });

  test('a refused binding leaves the marker unchanged', () => {
    // The refusal happens before anything is installed: the function
    // definition installs its clause at canonicalization, and a
    // destructuring assignment writes each leaf.
    const value = (source: string) =>
      executeEpsil(new ComputeEngine(), source).value.toString();
    expect(value('function Undefined(x) { x }\nUndefined(42)')).toBe(
      'Undefined(42)'
    );
    expect(value('Undefined(x) = x\nUndefined(3)')).toBe('Undefined(3)');
    expect(value('let a = 0\n(a, Missing) := (1, Undefined)\nMissing')).toBe(
      '"Missing"'
    );
    expect(value('Missing = (x) => x + 1\nMissing')).toBe('"Missing"');
  });

  test('a sequence definition of a marker is refused on the box route', () => {
    // In Epsil `Missing_0` is an identifier of its own, not a subscript.
    const ce = new ComputeEngine();
    const value = ce.box(['Assign', ['Subscript', 'Missing', 0], 1]).evaluate();
    expect(value.toString()).toContain('absence-marker-binding');
  });

  test('one diagnostic for a statement that is not the last', () => {
    // The static diagnostic and the statement's error value are one problem:
    // no second `runtime-error` diagnostic.
    expect(codes('let Missing = 3\nlet x = 1\nx + 1')).toEqual([
      'absence-marker-binding:Missing',
    ]);
  });

  test('the statement evaluates to the error', () => {
    const r = executeEpsil(new ComputeEngine(), 'let Missing = 3');
    expect(r.value.toString()).toContain('absence-marker-binding');
  });

  test('the box route refuses too', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Declare',
        'Undefined',
        ['Dictionary', ['KeyValuePair', 'value', 3]],
      ])
      .evaluate();
    expect(value.toString()).toContain('absence-marker-binding');
  });

  test('a use of a marker is not a binding', () => {
    expect(codes('[Missing, 1]')).toEqual([]);
    expect(codes('let x = Missing\nx')).toEqual([]);
    expect(codes('match 3 {\n  == Missing => 1\n  _ => 2\n}')).toEqual([]);
  });

  test('other capitalized library names still shadow', () => {
    const r = executeEpsil(new ComputeEngine(), 'let Pi = 3\nPi');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.toString()).toBe('3');
  });
});
