import { ComputeEngine } from '../../src/compute-engine';

/**
 * User ruling 2026-08-16 (`ROADMAP.md`, "An `unknown`-typed symbol compared
 * to a SCALAR types the relation scalar"): "inference doesn't have to be
 * broadest, it has to be more likely, and is subject to revision."
 *
 * Two halves. (1) A comparison over an undeclared symbol keeps the SCALAR
 * presumption — `C = U[1]` types `boolean`, as arithmetic already presumes an
 * undeclared symbol scalar — rather than the broadest `broadcastable<boolean>`
 * (measured 2026-08-16: that widening broke every `-> boolean` predicate
 * contract; 8 tests / 6 suites). (2) The INFERRED type an assignment commits
 * from such a value is a likely guess and is REVISED when the value's own
 * live type refutes it (`_reviseInferredType`,
 * `boxed-expression/boxed-value-definition.ts`): with `C` unknown,
 * `C_0 := Σ_k Which(C = U_k, k, True, 0)` types `number`; once `C := [10, 30]`
 * the value is `[1, 3]`, and the recorded type moves to `vector<integer^2>`
 * instead of staying a `number` its value does not satisfy. A DECLARED type
 * is a contract and never moves; a guess the value still fits is kept.
 */
describe('an inferred type is revised when its value refutes it', () => {
  function chain() {
    const ce = new ComputeEngine();
    ce.assign('U', ce.box(['List', 10, 20, 30]));
    ce.declare('C', 'unknown');
    ce.assign(
      'C_0',
      ce.box([
        'Sum',
        ['Which', ['Equal', 'C', ['At', 'U', 'k']], 'k', 'True', 0],
        ['Limits', 'k', 1, ['Length', 'U']],
      ])
    );
    return ce;
  }

  test('the relation over an unknown symbol keeps the scalar presumption (ruled)', () => {
    const ce = new ComputeEngine();
    ce.assign('U', ce.box(['List', 10, 20, 30]));
    expect(ce.box(['Equal', 'C', ['At', 'U', 1]]).type.toString()).toBe(
      'boolean'
    );
    // …and `C` is not refined by the comparison (a comparison accepts any
    // type on either side): it is the assignment below that supplies evidence.
    expect(ce.box('C').type.toString()).toBe('unknown');
  });

  test('the committed likely type moves once the value dependency refines', () => {
    const ce = chain();
    expect(ce.box('C_0').type.toString()).toBe('number');
    expect(ce.lookupDefinition('C_0')?.value?.inferredType).toBe(true);
    ce.assign('C', ce.box(['List', 10, 30]));
    const t = ce.box('C_0').type;
    expect(t.toString()).toBe('vector<integer^2>');
    // The invariant that was violated: the recorded type contains the value.
    const value = ce.box('C_0').evaluate();
    expect(value.json).toEqual(['List', 1, 3]);
    expect(value.type.matches(t)).toBe(true);
    // …and a reader through the symbol works.
    expect(ce.parse('C_0[2]').evaluate().re).toBe(3);
  });

  test('a declared type is a contract and is not revised', () => {
    const ce = new ComputeEngine();
    ce.assign('U', ce.box(['List', 10, 20, 30]));
    ce.declare('C', 'unknown');
    ce.declare('D_0', 'number');
    ce.assign(
      'D_0',
      ce.box([
        'Sum',
        ['Which', ['Equal', 'C', ['At', 'U', 'k']], 'k', 'True', 0],
        ['Limits', 'k', 1, ['Length', 'U']],
      ])
    );
    ce.assign('C', ce.box(['List', 10, 30]));
    expect(ce.box('D_0').type.toString()).toBe('number');
    expect(ce.lookupDefinition('D_0')?.value?.inferredType).toBe(false);
  });

  test('an explicit retype through the public setter becomes a contract (not revised)', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box(['Add', 'x', 1])); // inferred `number`
    expect(ce.lookupDefinition('y')?.value?.inferredType).toBe(true);
    ce.box('y').type = 'number'; // explicit retype = declaration
    expect(ce.lookupDefinition('y')?.value?.inferredType).toBe(false);
    ce.assign('x', ce.box(['List', 1, 2]));
    // The declared type stands even though the value is now a list.
    expect(ce.box('y').type.toString()).toBe('number');
  });

  test('a guess the live value still fits is kept; a literal never moves', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box(['Add', 'x', 1]));
    expect(ce.box('y').type.toString()).toBe('number');
    ce.assign('x', 2);
    expect(ce.box('y').type.toString()).toBe('number'); // integer <: number
    ce.assign('x', 2.5);
    expect(ce.box('y').type.toString()).toBe('number');
    ce.assign('z', 5);
    ce.assign('x', ce.box(['List', 1, 2]));
    expect(ce.box('z').type.toString()).toBe('integer');
    // …but a value that has become a collection is no longer a `number`.
    expect(ce.box('y').type.matches('collection')).toBe(true);
  });
});
