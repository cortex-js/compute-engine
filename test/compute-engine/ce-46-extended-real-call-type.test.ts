import { ComputeEngine } from '../../src/compute-engine';

/**
 * ROADMAP CE-46: the type of a call of a user function whose argument is an
 * extended real, `real | signed_infinity | nan`.
 *
 * A function declared bare `function` (or not declared) and then assigned
 * `t ↦ t^2 + 1` gets the inferred signature `(unknown) -> number`. A call
 * whose arguments fit that signature is typed by its result, `number`, and
 * the body is not typed again under the type of each argument: the call
 * `f(x)` is `number` although `x^2 + 1` is an extended real. The host that
 * constructs the function gives its type (user decision 2026-09-26): with
 * the parameter declared `real | signed_infinity | nan` and the result
 * `unknown`, the result is derived from the body under that parameter type,
 * and the call keeps the narrow type.
 */

const X = 'real | signed_infinity | nan';
const NARROW = 'nan | real | signed_infinity';

function engine(declare?: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', X);
  if (declare !== undefined) ce.declare('f', declare);
  ce.assign('f', ce.parse('t \\mapsto t^2+1'));
  return ce;
}

describe('CE-46: a call of a user function with an extended-real argument', () => {
  test('the body on its own keeps the extended-real type', () => {
    const ce = engine();
    expect(ce.parse('x^2+1').type.toString()).toBe(NARROW);
  });

  test('a parameter declared by the host keeps the type of the call', () => {
    const ce = engine(`(${X}) -> unknown`);
    expect(ce.box('f').type.toString()).toBe(`(${NARROW}) -> ${NARROW}`);
    expect(ce.parse('f(x)').type.toString()).toBe(NARROW);
    expect(ce.parse('f(x)').type.matches(X)).toBe(true);
  });

  test('a result declared by the host is the type of the call', () => {
    const ce = engine(`(${X}) -> ${X}`);
    expect(ce.parse('f(x)').type.toString()).toBe(NARROW);
  });

  test('a function declared bare `function` is typed by its inferred result', () => {
    const ce = engine('function');
    expect(ce.parse('f(x)').type.toString()).toBe('number');
    expect(ce.parse('f(x)').type.matches(X)).toBe(false);
  });
});
