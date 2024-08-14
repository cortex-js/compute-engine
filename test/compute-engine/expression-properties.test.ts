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

describe('IS_ZERO', () => {
  it('should return true for number literals equal to 0', () => {
    const expression = engine.parse('0');
    expect(expression.isZero).toBe(true);
  });

  it('should return false for number literals not equal to 0', () => {
    const expression = engine.parse('5');
    expect(expression.isZero).toBe(false);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isZero).toBe(false);
  });

  it('should return false for constant expressions not equal to 0', () => {
    const expression = engine.parse('5 + 3');
    expect(expression.isZero).toBe(false);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isZero).toBe(false);
  });

  it('should return undefined for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isZero).toBeUndefined();
  });

  it('should return undefined for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isZero).toBeUndefined();
  });

  it('should return false for constant expressions with function calls', () => {
    const expression = engine.parse('\\cos{\\pi}');
    expect(expression.isZero).toBe(false);
  });

  it('should return true for cos pi/2', () => {
    const expression = engine.parse('\\cos{\\pi/2}');
    expect(expression.isZero).toBe(true);
  });

  it('should return false for non-constant expressions with non-pure function calls not equal to 0', () => {
    const expression = engine.box(['Random', 1, 10]);
    expect(expression.isZero).toBeUndefined();
  });

  it('should return false for non-constant expressions with non-pure function calls not equal to 0', () => {
    const expression = engine.box(['Add', ['Random', 1, 10], 1]);
    expect(expression.isZero).toBeUndefined();
  });
});

describe('IS_NOT_ZERO', () => {
  it('should return true for number literals equal to 0', () => {
    const expression = engine.parse('0');
    expect(expression.isNotZero).toBe(false);
  });

  it('should return true for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isNotZero).toBe(true);
  });

  it('should return true for number literals not equal to 0', () => {
    const expression = engine.parse('5');
    expect(expression.isNotZero).toBe(true);
  });

  it('should return undefined for constant expressions not equal to 0', () => {
    const expression = engine.parse('5 + 3');
    expect(expression.isNotZero).toBe(true);
  });

  it('should return true for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isNotZero).toBe(true);
  });

  it('should return undefined for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isNotZero).toBeUndefined();
  });

  it('should return undefined for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isNotZero).toBeUndefined();
  });

  it('should return true for constant expressions with function calls', () => {
    const expression = engine.parse('\\cos{\\pi}');
    expect(expression.isNotZero).toBe(true);
  });

  it('should return undefined for non-constant expressions with non-pure function calls not equal to 0', () => {
    const expression = engine.box(['Random', 1, 10]);
    expect(expression.isNotZero).toBeUndefined();
  });

  it('should return undefined for non-constant expressions with non-pure function calls not equal to 0', () => {
    const expression = engine.box(['Add', ['Random', 1, 10], 1]);
    expect(expression.isNotZero).toBeUndefined();
  });
});

describe('IS_POSITIVE', () => {
  it('should return true for number literals greater than 0', () => {
    const expression = engine.parse('5');
    expect(expression.isPositive).toBe(true);
  });

  it('should return false for number literals less than 0', () => {
    const expression = engine.parse('-5');
    expect(expression.isPositive).toBe(false);
  });

  it('should return false for number literals equal to 0', () => {
    const expression = engine.parse('0');
    expect(expression.isPositive).toBe(false);
  });

  it('should return true for constant symbols greater than 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isPositive).toBe(true);
  });

  it('should return false for constant symbols less than 0', () => {
    const expression = engine.parse('-\\pi');
    expect(expression.isPositive).toBe(false);
  });

  it('should return undefined for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return true for positive constant expressions', () => {
    const expression = engine.parse('\\pi + 3');
    expect(expression.isPositive).toBe(true);
  });

  it('should return undefined for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return undefined for constant expressions with function calls', () => {
    const expression = engine.parse('\\cos{\\pi}');
    expect(expression.isPositive).toBe(true);
  });

  it('should return undefined for non-constant expressions with non-pure function calls', () => {
    const expression = engine.box(['Random', 1, 10]);
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return undefined for non-constant expressions with non-pure function calls', () => {
    const expression = engine.box(['Add', ['Random', 1, 10], 1]);
    expect(expression.isPositive).toBeUndefined();
  });
});
