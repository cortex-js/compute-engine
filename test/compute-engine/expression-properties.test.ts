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
    const expression = engine.box(['Hold', ['Random', 1, 10]]);
    expect(expression.isConstant).toBe(false);
  });

  it('should return false for non-constant expressions with non-pure  function calls', () => {
    const expression = engine.box(['Hold', ['Add', ['Random', 1, 10], 1]]);
    expect(expression.isConstant).toBe(false);
  });
});

describe('IS_ZERO', () => {
  it('should return true for number literals equal to 0', () => {
    const expression = engine.parse('0');
    expect(expression.is(0)).toBe(true);
  });

  it('should return false for number literals not equal to 0', () => {
    const expression = engine.parse('5');
    expect(expression.is(0)).toBe(false);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.is(0)).toBe(false);
  });

  it('should return false for constant expressions not equal to 0', () => {
    const expression = engine.parse('5 + 3');
    expect(expression.is(0)).toBe(false);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.is(0)).toBe(false);
  });

  it('should return undefined for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isEqual(0)).toBeUndefined();
  });

  it('should return undefined for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isEqual(0)).toBeUndefined();
  });

  it('should return false for constant expressions with function calls', () => {
    const expression = engine.parse('\\cos{\\pi}');
    expect(expression.isEqual(0)).toBe(false);
  });

  it('should return true for cos(pi/2)', () => {
    const expression = engine.parse('\\cos{\\pi/2}');
    expect(expression.isEqual(0)).toBe(true);
  });

  it('should return false for held expressions that are not structurally equal', () => {
    const expression = engine.box(['Hold', ['Add', 2, 3]]);
    expect(expression.isEqual(5)).toBe(false);
  });

  it('should return true for held expressions that are structurally equal', () => {
    const expression = engine.box(['Hold', ['Add', 2, 3]]);
    expect(expression.isEqual(engine.box(['Hold', ['Add', 2, 3]]))).toBe(true);
  });
});

describe('IS_NOT_ZERO', () => {
  it('should return true for number literals equal to 0', () => {
    const expression = engine.parse('0');
    expect(expression.isEqual(0)).toBe(true);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isEqual(0)).toBe(false);
  });

  it('should return false for number literals not equal to 0', () => {
    const expression = engine.parse('5');
    expect(expression.isEqual(0)).toBe(false);
  });

  it('should return false for constant expressions not equal to 0', () => {
    const expression = engine.parse('5 + 3');
    expect(expression.isEqual(0)).toBe(false);
  });

  it('should return false for constant symbols not equal to 0', () => {
    const expression = engine.parse('\\pi');
    expect(expression.isEqual(0)).toBe(false);
  });

  it('should return undefined for non-constant symbols', () => {
    const expression = engine.parse('x');
    expect(expression.isEqual(0)).toBeUndefined();
  });

  it('should return false for non-constant expressions', () => {
    const expression = engine.parse('x + 3');
    expect(expression.isEqual(0)).toBeUndefined();
  });

  it('should return true for constant expressions with function calls', () => {
    const expression = engine.parse('\\cos{\\pi}');
    expect(expression.isEqual(0)).toBe(false);
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

  it('should return undefined for constant expressions with trig functions', () => {
    const expression = engine.parse('\\cos{\\pi/3}');
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return undefined for non-constant expressions with non-pure function calls', () => {
    const expression = engine.box(['Hold', ['Random', 1, 10]]);
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return undefined for non-constant expressions with non-pure function calls that only returns positive values', () => {
    const expression = engine.box(['Hold', ['Add', ['Random', 1, 10], 1]]);
    expect(expression.isPositive).toBeUndefined();
  });
});

describe('UNKNOWNS', () => {
  it('should return free variables for simple expressions', () => {
    expect(engine.parse('x + y').unknowns).toEqual(['x', 'y']);
  });

  it('should not include constants', () => {
    expect(engine.parse('\\pi + x').unknowns).toEqual(['x']);
  });

  it('should not include summation index variable', () => {
    // Sum_{k=0}^{10} k*x  — k is bound, x is free
    const expr = engine.parse('\\sum_{k=0}^{10} k \\cdot x');
    const unknowns = expr.unknowns;
    expect(unknowns).not.toContain('k');
    expect(unknowns).toContain('x');
  });

  it('should not include product index variable', () => {
    // Product_{i=1}^{5} (x + i)  — i is bound, x is free
    const expr = engine.parse('\\prod_{i=1}^{5} (x + i)');
    const unknowns = expr.unknowns;
    expect(unknowns).not.toContain('i');
    expect(unknowns).toContain('x');
  });

  it('should handle nested scoped functions', () => {
    // Sum_{k=0}^{5} Sum_{j=0}^{k} (x + j)
    const expr = engine.parse('\\sum_{k=0}^{5} \\sum_{j=0}^{k} (x + j)');
    const unknowns = expr.unknowns;
    expect(unknowns).not.toContain('k');
    expect(unknowns).not.toContain('j');
    expect(unknowns).toContain('x');
  });

  it('should return empty for fully constant sum', () => {
    const expr = engine.parse('\\sum_{k=1}^{10} k^2');
    expect(expr.unknowns).toEqual([]);
  });
});
