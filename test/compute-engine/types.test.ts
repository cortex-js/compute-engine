import { engine as ce } from '../utils';

describe('NUMERIC TYPES', () => {
  it('should recognize the type of a number', () => {
    const expr = ce.parse('3');
    expect(expr.type.toString()).toBe('finite_integer');
  });
  it('should recognize the type of a complex number', () => {
    const expr = ce.parse('3 + 4i');
    expect(expr.type.toString()).toBe('finite_complex');
  });
  it('should recognize the type of a rational number', () => {
    const expr = ce.parse('3/4');
    expect(expr.type.toString()).toBe('finite_rational');
  });
  it('should recognize the type of a real number', () => {
    const expr = ce.parse('3.4');
    expect(expr.type.toString()).toBe('finite_real');
  });
  it('should recognize the type of an imaginary number', () => {
    const expr = ce.parse('4i');
    expect(expr.type.toString()).toBe('imaginary');
  });
  it('should recognize the type of a non-finite number', () => {
    const expr = ce.parse('\\infty');
    expect(expr.type.toString()).toBe('non_finite_number');
  });
  it('should recognize the type of complex infinity', () => {
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.toString()).toBe('complex');
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
    const expr = ce.parse('\\infty');
    expect(expr.type.matches('non_finite_number')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('real')).toBe(true);
    expect(expr.type.matches('integer')).toBe(true);
    expect(expr.type.matches('rational')).toBe(true);
    expect(expr.type.matches('finite_integer')).toBe(false);
    expect(expr.type.matches('finite_real')).toBe(false);
    expect(expr.type.matches('complex')).toBe(true);
  });
  it('should recognize the type of a complex infinity', () => {
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('finite_complex')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('number')).toBe(true);
  });
  it('should recognize the type of NaN', () => {
    const expr = ce.parse('\\mathrm{NaN}');
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('finite_number')).toBe(false);
    expect(expr.type.matches('non_finite_number')).toBe(false);
  });
});
