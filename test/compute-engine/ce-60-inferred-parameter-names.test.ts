import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// ROADMAP CE-60 (user decision 2026-10-25): an inferred signature keeps and
// prints the names of the parameters of the function literal. So a named
// call to an unannotated literal held in a binding finds each slot, and
// `(x) => x + 1` has the type `(x: unknown) -> number`. A wildcard parameter
// (`_`, `_1`) and a destructuring pattern have no name. The names do not
// change how two signatures compare.

describe('CE-60: an inferred signature keeps the parameter names', () => {
  test('a named call to an assigned unannotated literal', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Subtract', 'a', 'b'], 'a', 'b']));
    expect(ce.box('f').type.toString()).toBe(
      '(a: unknown, b: unknown) -> number'
    );
    const call = ce.box([
      'f',
      ['NamedArgument', "'b'", 2],
      ['NamedArgument', "'a'", 10],
    ]);
    const value = call.evaluate();
    expect(value.re).toBe(8);
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('the arrow of a literal prints its parameter names', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['Add', 'x', 1], 'x']);
    expect(literal.type.toString()).toBe('(x: unknown) -> number');
    expect(ce.parse('x \\mapsto x^2').type.toString()).toBe(
      '(x: unknown) -> number'
    );
  });

  test('a wildcard parameter has no name', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Function', ['Add', '_', 1], '_']).type.toString()).toBe(
      '(unknown) -> number'
    );
    expect(
      ce.box(['Function', ['Add', '_1', '_2'], '_1', '_2']).type.toString()
    ).toBe('(unknown, unknown) -> number');
    // A wildcard slot whose type the body infers has no name either, in the
    // arrow of the literal and in the signature of a binding.
    const at = ['Function', ['At', '_', 1], '_'] as const;
    expect(ce.box(at as any).type.toString()).toBe(
      '(dictionary<any> | indexed_collection<any>) -> unknown'
    );
    ce.assign('w', ce.box(at as any));
    expect(ce.box('w').type.toString()).toBe(
      '(dictionary<any> | indexed_collection<any>) -> unknown'
    );
    ce.assign('g', ce.box(['Function', ['Add', '_1', 'y'], '_1', 'y']));
    expect(ce.box('g').type.toString()).toBe('(unknown, y: unknown) -> number');
    const mixed = ce.box(['g', 1, ['NamedArgument', "'y'", 2]]);
    expect(mixed.evaluate().re).toBe(3);
  });

  test('the names do not change matching or subtyping', () => {
    const ce = new ComputeEngine();
    const named = ce.type('(x: unknown) -> number');
    const unnamed = ce.type('(unknown) -> number');
    expect(named.matches(unnamed)).toBe(true);
    expect(unnamed.matches(named)).toBe(true);
    const literal = ce.box(['Function', ['Add', 'x', 1], 'x']);
    expect(literal.type.matches(unnamed)).toBe(true);
    expect(literal.type.matches(ce.type('(y: unknown) -> number'))).toBe(true);
  });

  test('a named call to a field that holds an unannotated literal (Epsil)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'const ns = {D -> ((x, k) => x - k)}\nns.D(k: 1, x: 10)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.re).toBe(9);
  });

  test('a rest parameter keeps the names of the positional slots', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'f := (a, ...rest) => Length(rest)\nf(a: 1)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.re).toBe(0);
  });
});
