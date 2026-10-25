import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// A host function declared with a signature and a function literal,
// `ce.declare('h', { signature: '(integer) pure -> integer', evaluate: x ↦ 2x })`,
// admits only integer arguments. When an Epsil `function` statement defines
// `h` again, the existing definition becomes the first clause of `h`. That
// clause used the literal's own type, `(unknown) -> number`, as its parameter
// domain, so `function h(x: integer) -> integer { x }` did not match it: the
// statement added a second clause and `h` got the signature
// `((unknown) -> number) & ((x: integer) -> integer)`.
//
// The clause now takes the domain the host stated. A statement with the same
// domain replaces the body. The signature declared on the name stays in force
// (as for `ce.assign()` over the same declaration): the new body is checked
// against its effects.
//
// A signature declared with `ce.declare()` is a contract on the name (user
// decision 2026-10-18): a statement whose parameter domain is outside it is
// refused with the same error as after an Epsil `let h: (integer) -> integer`,
// and the definition is unchanged. A host literal assigned with `ce.assign()`
// and no declaration states no contract, so a statement with another domain
// adds a clause.

function declareHost(ce: ComputeEngine, signature: string): void {
  ce.declare('h', {
    signature,
    evaluate: ce.box(['Function', ['Multiply', 2, 'x'], 'x']),
  });
}

function run(ce: ComputeEngine, source: string): string {
  return executeEpsil(ce, source).value.toString();
}

describe('A HOST FUNCTION REDEFINED BY AN EPSIL FUNCTION STATEMENT', () => {
  test('the same parameter domain replaces the body', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) pure -> integer');
    expect(ce.box(['h', 3]).evaluate().toString()).toBe('6');
    expect(run(ce, 'function h(x: integer) -> integer { x }\nh(3)')).toBe('3');
    expect(ce.box('h').type.toString()).toBe('(integer) pure -> integer');
    expect(ce.box(['h', 4]).evaluate().toString()).toBe('4');
  });

  test('a declaration without effects', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) -> integer');
    expect(run(ce, 'function h(x: integer) -> integer { x }\nh(3)')).toBe('3');
    expect(ce.box('h').type.toString()).toBe('(integer) -> integer');
  });

  test('the same result as ce.assign() over the same declaration', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) pure -> integer');
    ce.assign('h', ce.box(['Function', 'x', 'x']));
    expect(ce.box('h').type.toString()).toBe('(integer) pure -> integer');
  });

  test('the declared effects stay a contract', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) pure -> integer');
    expect(
      run(ce, 'function h(x: integer) random -> integer { x + random() }')
    ).toMatch(/^Error/);
    expect(ce.box('h').type.toString()).toBe('(integer) pure -> integer');
    expect(ce.box(['h', 3]).evaluate().toString()).toBe('6');
  });

  test('a parameter domain outside the declaration is refused', () => {
    // The reference: the same statement after an Epsil declaration.
    const epsil = new ComputeEngine();
    const expected = executeEpsil(
      epsil,
      'let h: (integer) -> integer\nfunction h(x: string) -> string { x }'
    ).value;
    expect(expected.operator).toBe('Error');
    expect(expected.op1.string).toBe('invalid-clause-definition');

    const ce = new ComputeEngine();
    declareHost(ce, '(integer) pure -> integer');
    const result = executeEpsil(
      ce,
      'function h(x: string) -> string { x }'
    ).value;
    expect(result.operator).toBe('Error');
    expect(result.op1.string).toBe(expected.op1.string);
    expect(result.op2.string).toMatch(
      /parameter 1 of type "string" is outside the declared "integer"/
    );
    // The definition is unchanged.
    expect(ce.box('h').type.toString()).toBe('(integer) pure -> integer');
    expect(ce.box(['h', 3]).evaluate().toString()).toBe('6');
  });

  test('after a replacement, the declaration still refuses another domain', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) pure -> integer');
    expect(run(ce, 'function h(x: integer) -> integer { x }\nh(3)')).toBe('3');
    expect(run(ce, 'function h(x: string) -> string { x }')).toMatch(
      /^Error\("invalid-clause-definition"/
    );
    expect(ce.box('h').type.toString()).toBe('(integer) pure -> integer');
    expect(ce.box(['h', 3]).evaluate().toString()).toBe('3');
  });

  test('declare a type, then assign the literal: another domain is refused', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(run(ce, 'function f(x: string) -> string { x }')).toMatch(
      /^Error\("invalid-clause-definition"/
    );
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('6');
  });

  test('a host literal with no declaration accepts another domain', () => {
    const ce = new ComputeEngine();
    ce.assign('k', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(run(ce, 'function k(x: string) -> string { x }\nk("a")')).toBe(
      '"a"'
    );
    expect(ce.box('k').type.toString()).toBe(
      '((x: unknown) -> number) & ((x: string) -> string)'
    );
    expect(ce.box(['k', 3]).evaluate().toString()).toBe('6');
  });

  test('a literal-parameter clause narrows the declared domain', () => {
    const ce = new ComputeEngine();
    declareHost(ce, '(integer) -> integer');
    expect(run(ce, 'function h(0) { 100 }\nh(0) + h(3)')).toBe('106');
  });

  test('declare a type, then assign the literal (value slot)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(run(ce, 'function f(x: integer) -> integer { x }\nf(3)')).toBe('3');
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
  });

  test('a host literal with no stated signature keeps its own domain', () => {
    // `ce.assign()` of an untyped literal states no domain: the literal
    // admits any argument, so an integer clause is a second, narrower clause.
    const ce = new ComputeEngine();
    ce.assign('k', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(run(ce, 'function k(x: integer) -> integer { x }\nk(3)')).toBe('3');
    expect(ce.box('k').type.toString()).toBe(
      '((x: unknown) -> number) & ((x: integer) -> integer)'
    );
    expect(ce.box(['k', 2.5]).evaluate().toString()).toBe('5');
  });
});
