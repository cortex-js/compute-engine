import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

// A variable that a binder binds (the index of a `Sum`, the parameter of a
// `Function`) is a different symbol from an outer symbol with the same name.
// In each test below the outer `k` is declared `list<integer>`, and the bound
// `k` is a number. The type of the expression must hold its value, so it
// must not read the declaration of the outer `k`.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('k', 'list<integer>');
  return ce;
}

const SUM = ['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]] as const;
const FUNCTION_CALL = [['Function', ['Power', 'k', 2], 'k'], 3] as const;

describe('a held binder', () => {
  // `Simplify` holds its operand, and the type of a held operand is derived
  // from the types of its symbols (`heldOperandType`).
  test('Simplify of a Sum, MathJSON route', () => {
    const ce = engine();
    const expr = ce.box(['Simplify', SUM] as never);
    const value = expr.evaluate();
    expect(value.toString()).toBe('14');
    expect(expr.type.toString()).not.toMatch(/list/);
    expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  });

  test('Simplify of a Sum, LaTeX route', () => {
    const ce = engine();
    const expr = ce.parse('\\operatorname{Simplify}(\\sum_{k=1}^3 k^2)');
    const value = expr.evaluate();
    expect(value.toString()).toBe('14');
    expect(expr.type.toString()).not.toMatch(/list/);
    expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
  });

  test('an outer symbol next to the binder keeps its declared type', () => {
    // Only the operands of the binder are left untyped: the outer `k` in
    // the sum is still read as a `list<integer>`.
    const ce = engine();
    const expr = ce.box(['Simplify', ['Add', SUM, 'k']] as never);
    expect(expr.type.toString()).toMatch(/list|tensor/);
  });
});

describe('a structural binder boxed from MathJSON', () => {
  test('a Sum', () => {
    const ce = engine();
    const expr = ce.box(SUM as never, { form: 'structural' });
    const value = expr.evaluate();
    expect(value.toString()).toBe('14');
    expect(expr.type.toString()).toBe('number');
    // The bound `k` in the body is not bound to the outer definition.
    expect(expr.ops![0].ops![0].type.toString()).toBe('unknown');
  });

  test('a Function application', () => {
    const ce = engine();
    const expr = ce.box(FUNCTION_CALL as never, { form: 'structural' });
    const value = expr.evaluate();
    expect(value.toString()).toBe('9');
    expect(expr.type.toString()).toBe('number');
  });

  test('a Function literal has the type of the canonical one', () => {
    const ce = engine();
    const fn = ['Function', ['Power', 'k', 2], 'k'] as const;
    expect(ce.box(fn as never, { form: 'structural' }).type.toString()).toBe(
      ce.box(fn as never).type.toString()
    );
  });

  test('a symbol outside the binder is still bound', () => {
    const ce = engine();
    const expr = ce.box(['Add', 'k', SUM] as never, { form: 'structural' });
    expect(expr.ops![0].type.toString()).toBe('list<integer>');
  });

  test('ce.rebind() in the structural form', () => {
    const ce = new ComputeEngine();
    const raw = ce.box(SUM as never, { form: 'raw' });
    ce.declare('k', 'list<integer>');
    const expr = ce.rebind(raw, { form: 'structural' });
    expect(expr.evaluate().toString()).toBe('14');
    expect(expr.type.toString()).toBe('number');
  });
});
