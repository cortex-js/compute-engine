import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

describe('NUMERIC TYPES', () => {
  it('should recognize the type of a number', () => {
    const expr = ce.parse('3');
    expect(expr.type.toString()).toBe('3');
  });
  it('should recognize the type of a complex number', () => {
    const expr = ce.parse('3 + 4i');
    expect(expr.type.toString()).toBe('finite_complex');
  });
  it('should recognize the type of a rational number', () => {
    const expr = ce.parse('3/4');
    expect(expr.type.toString()).toBe('finite_rational<0.75..0.75>');
  });
  it('should recognize the type of a real number', () => {
    const expr = ce.parse('3.4');
    expect(expr.type.toString()).toBe('3.4');
  });
  it('should recognize the type of an imaginary number', () => {
    const expr = ce.parse('4i');
    expect(expr.type.toString()).toBe('imaginary');
  });
  it('should recognize the type of a non-finite number', () => {
    // A literal's public type is the singleton that names it (ruling O9), and
    // `+∞` is a literal like any other. The serializer spells a numeric
    // value type with the JavaScript number it carries.
    const expr = ce.parse('\\infty');
    expect(expr.type.toString()).toBe('Infinity');
    expect(expr.type.matches('infinity')).toBe(true);
  });
  it('should recognize the type of complex infinity', () => {
    // The unsigned infinity has its own singleton spelling, `~oo`, and widens
    // to `infinity` — never to `complex`, which is finite.
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.toString()).toBe('~oo');
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('complex')).toBe(false);
  });
});

describe('NUMERIC SUBTYPES', () => {
  it('should recognize the type of an integer', () => {
    const expr = ce.parse('3');
    expect(expr.type.matches('integer')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('rational')).toBe(true);
    expect(expr.type.matches('imaginary')).toBe(false);
  });
  it('should recognize the type of a complex number', () => {
    const expr = ce.parse('3 + 4i');
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('imaginary')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('number')).toBe(true);
  });
  it('should recognize the type of an imaginary number', () => {
    const expr = ce.parse('4i');
    expect(expr.type.matches('imaginary')).toBe(true);
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
  });
  it('should recognize the type of a rational number', () => {
    const expr = ce.parse('3/4');
    expect(expr.type.matches('rational')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('integer')).toBe(false);
  });
  it('should recognize the type of a real number', () => {
    const expr = ce.parse('3.4');
    expect(expr.type.matches('real')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('integer')).toBe(false);
  });
  it('should recognize the type of a non-finite number', () => {
    // The finite-by-default flip: the bare numeric names contain only finite
    // values, so an infinity matches `infinity` (and the signed-pair atom
    // `non_finite_number`) and nothing in the `complex` subtree.
    const expr = ce.parse('\\infty');
    expect(expr.type.matches('non_finite_number')).toBe(true);
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('integer')).toBe(false);
    expect(expr.type.matches('rational')).toBe(false);
    expect(expr.type.matches('finite_integer')).toBe(false);
    expect(expr.type.matches('finite_real')).toBe(false);
    expect(expr.type.matches('complex')).toBe(false);
    // The extended real line is spelled out as a union.
    expect(expr.type.matches('real | infinity')).toBe(true);
  });
  it('should recognize the type of a complex infinity', () => {
    // Admitted by `infinity` (and thence `number`) — `complex` refuses it,
    // exactly as it refuses NaN (see the NaN case below). It is unsigned, so
    // the signed-pair atom refuses it too.
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('finite_complex')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('non_finite_number')).toBe(false);
    expect(expr.type.matches('number')).toBe(true);
  });
  it('should recognize the type of NaN', () => {
    const expr = ce.parse('\\mathrm{NaN}');
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('nan')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('infinity')).toBe(false);
    expect(expr.type.matches('finite_number')).toBe(false);
    expect(expr.type.matches('non_finite_number')).toBe(false);
  });
});

// https://github.com/cortex-js/compute-engine/issues/235
describe('BROADCASTABLE FUNCTIONS WITH UNION TYPES', () => {
  it('should accept number | list arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should accept number | list arguments for Add', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    const expr = ce.expr(['Add', 'a', 'b']);
    expect(expr.json).toEqual(['Add', 'a', 'b']);
  });

  it('should accept any-typed arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'any');
    ce.declare('b', 'any');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should accept unknown-typed arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'unknown');
    ce.declare('b', 'unknown');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should evaluate Multiply with list-valued symbols', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    ce.assign('a', ['List', 1, 2, 3]);
    ce.assign('b', ['List', 4, 5, 6]);
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.evaluate().json).toEqual(['List', 4, 10, 18]);
  });
});
