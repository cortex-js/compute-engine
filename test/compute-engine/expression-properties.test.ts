import { engine } from '../utils';

describe('IS_CONSTANT', () => {
  it('should return true for number literals', () => {
    const expression = engine.parse('5');
    expect(expression.isConstant).toBe(true);
  });

  it('should return true for string literals', () => {
    const expression = engine.parse('\\text{"hello"}');
    expect(expression.isConstant).toBe(true);
  });

  it('should return true for boolean literals', () => {
    const expression = engine.parse('\\operatorname{True}');
    expect(expression.isConstant).toBe(true);
  });

  it('should return true for constant expressions', () => {
    const expression = engine.parse('5 + 3');
    expect(expression.isConstant).toBe(true);
  });

  it('should return false for constant symbols', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isConstant).toBe(true);
  });

  it('should return false for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isConstant).toBe(false);
  });

  it('should return false for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isConstant).toBe(false);
  });

  it('should return true for constant expressions with function calls', () => {
    const expression = engine.parse('\\sqrt{17}');
    expect(expression.isConstant).toBe(true);
  });

  it('should return false for non-constant expressions with non-pure function calls', () => {
    const expression = engine.box(['Random', 1, 10]);
    expect(expression.isConstant).toBe(false);
  });

  it('should return false for non-constant expressions with non-pure  function calls', () => {
    const expression = engine.box(['Add', ['Random', 1, 10], 1]);
    expect(expression.isConstant).toBe(false);
  });
});
