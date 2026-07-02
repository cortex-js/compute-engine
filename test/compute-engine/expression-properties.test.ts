import { ComputeEngine } from '../../src/compute-engine';
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
    const expression = engine.expr(['Hold', ['Random', 1, 10]]);
    expect(expression.isConstant).toBe(false);
  });

  it('should return false for non-constant expressions with non-pure  function calls', () => {
    const expression = engine.expr(['Hold', ['Add', ['Random', 1, 10], 1]]);
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

  it('is undefined for non-constant expressions not identically zero', () => {
    // `x + 3` is satisfiably zero (assume(x = -3)): under the
    // truth-under-constraints contract (D9) the answer is indeterminate,
    // consistent with the adjacent non-constant cases above.
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
    const expression = engine.expr(['Hold', ['Add', 2, 3]]);
    expect(expression.isEqual(5)).toBe(false);
  });

  it('should return true for held expressions that are structurally equal', () => {
    const expression = engine.expr(['Hold', ['Add', 2, 3]]);
    expect(expression.isEqual(engine.expr(['Hold', ['Add', 2, 3]]))).toBe(true);
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

  it('is undefined for non-constant expressions not identically zero', () => {
    // `x + 3` is satisfiably zero (assume(x = -3)): under the
    // truth-under-constraints contract (D9) the answer is indeterminate,
    // consistent with the adjacent non-constant cases above.
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
    const expression = engine.expr(['Hold', ['Random', 1, 10]]);
    expect(expression.isPositive).toBeUndefined();
  });

  it('should return undefined for non-constant expressions with non-pure function calls that only returns positive values', () => {
    const expression = engine.expr(['Hold', ['Add', ['Random', 1, 10], 1]]);
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

  it('should include symbolic upper bound as unknown', () => {
    // Sum_{k=0}^{M} k*x  — k is bound, M and x are free
    const expr = engine.parse('\\sum_{k=0}^{M} k \\cdot x');
    const unknowns = expr.unknowns;
    expect(unknowns).not.toContain('k');
    expect(unknowns).toContain('M');
    expect(unknowns).toContain('x');
  });
});

describe('FREE_VARIABLES', () => {
  it('should return same result as unknowns', () => {
    const expr = engine.parse('x + y');
    expect(expr.freeVariables).toEqual(expr.unknowns);
  });

  it('should not include constants', () => {
    expect(engine.parse('\\pi + x').freeVariables).toEqual(['x']);
  });

  it('should not include summation index variable', () => {
    const expr = engine.parse('\\sum_{k=0}^{10} k \\cdot x');
    expect(expr.freeVariables).not.toContain('k');
    expect(expr.freeVariables).toContain('x');
  });

  it('should include symbolic upper bound', () => {
    const expr = engine.parse('\\sum_{k=0}^{M} k \\cdot x');
    expect(expr.freeVariables).not.toContain('k');
    expect(expr.freeVariables).toContain('M');
    expect(expr.freeVariables).toContain('x');
  });

  it('should return empty for constant expression', () => {
    expect(engine.parse('5 + 3').freeVariables).toEqual([]);
  });
});

describe('SCOPED_UNKNOWNS', () => {
  it('Block: should exclude locally assigned variables', () => {
    // x is free, y is locally assigned
    const block = engine.expr(['Block', ['Assign', 'y', 5], ['Add', 'x', 'y']]);
    expect(block.unknowns).toContain('x');
    expect(block.unknowns).not.toContain('y');
  });

  it('Block: should exclude locally declared variables', () => {
    const block = engine.expr([
      'Block',
      ['Declare', 'z', 'integer'],
      ['Add', 'x', 'z'],
    ]);
    expect(block.unknowns).toContain('x');
    expect(block.unknowns).not.toContain('z');
  });

  it('D: differentiation variable remains free', () => {
    // In D(x^2 + a, x), both x and a are free — x is still in the result
    const d = engine.expr(['D', ['Add', ['Power', 'x', 2], 'a'], 'x']);
    expect(d.unknowns).toContain('a');
    expect(d.unknowns).toContain('x');
  });

  it('ForAll: should exclude quantified variable', () => {
    // n is free, k is bound by the quantifier
    const forall = engine.expr([
      'ForAll',
      ['Element', 'k', ['Range', 1, 'n']],
      ['Greater', 'k', 0],
    ]);
    expect(forall.unknowns).toContain('n');
    expect(forall.unknowns).not.toContain('k');
  });
});

describe('FREE_VARIABLES (lambdas & integrals)', () => {
  it('lambda: excludes its parameter', () => {
    // (x) ↦ x^2 + b  — x is bound, b is free
    const lambda = engine.parse('f(x) := x^2 + b').op2;
    expect(lambda.freeVariables).toEqual(['b']);
  });

  it('lambda: excludes multiple parameters', () => {
    const lambda = engine.box(['Function', ['Add', 'x', 'y', 'k'], 'x', 'y']);
    expect(lambda.freeVariables).toEqual(['k']);
  });

  it('definition: parameter does not leak (regression)', () => {
    // f(x) := x^2 + b  references b; the parameter x must NOT be reported
    const def = engine.parse('f(x) := x^2 + b');
    expect(def.freeVariables).not.toContain('x');
    expect(def.freeVariables).toContain('b');
  });

  it('integral: excludes the integration variable', () => {
    expect(engine.parse('\\int_0^\\pi \\sin(x) \\, dx').freeVariables).toEqual(
      []
    );
  });

  it('integral: keeps a free coefficient (regression)', () => {
    // ∫ a·sin(x) dx depends on a, not x.
    const expr = engine.parse('\\int_0^\\pi a \\sin(x) \\, dx');
    expect(expr.freeVariables).toContain('a');
    expect(expr.freeVariables).not.toContain('x');
  });

  it('integral: integrand binds only the integration variable', () => {
    // The canonical integrand Function binds only x (not the free coefficient
    // a), so introspecting the integrand directly is correct — not just the
    // whole integral.
    const integrand = engine.parse('\\int_0^\\pi a \\sin(x) \\, dx').op1;
    expect(integrand.operator).toBe('Function');
    expect(integrand.unknowns).toEqual(['a']);
  });

  it('integral: keeps free bounds', () => {
    expect(engine.parse('\\int_a^b \\sin(x) \\, dx').freeVariables).toEqual([
      'a',
      'b',
    ]);
  });

  it('limit: excludes the limit variable', () => {
    const expr = engine.parse('\\lim_{t \\to 0} (t + z)');
    expect(expr.freeVariables).toContain('z');
    expect(expr.freeVariables).not.toContain('t');
  });

  it('symbols still includes bound variables', () => {
    // freeVariables excludes bound vars; symbols does not
    expect(engine.parse('\\sum_{i=1}^{n} i').symbols).toContain('i');
  });
});

describe('DEFINES', () => {
  it('value assignment defines its target', () => {
    expect(engine.parse('a := 3').defines).toEqual(['a']);
  });

  it('function definition defines the function name', () => {
    expect(engine.parse('f(x) := x^2').defines).toEqual(['f']);
  });

  it('non-definitions define nothing', () => {
    expect(engine.parse('2 + 2').defines).toEqual([]);
    expect(engine.parse('f(1024)').defines).toEqual([]);
  });

  it('Block defines each assignment/declaration', () => {
    const block = engine.box([
      'Block',
      ['Assign', 'a', 1],
      ['Declare', 'b', 'integer'],
      ['Add', 'a', 'b'],
    ]);
    expect(block.defines).toEqual(['a', 'b']);
  });

  it('references = freeVariables minus defines (notebook composition)', () => {
    const cell = engine.parse('f(x) := x^2 + b');
    const refs = cell.freeVariables.filter((s) => !cell.defines.includes(s));
    expect(cell.defines).toEqual(['f']);
    expect(refs).toEqual(['b']);
  });
});

describe('REFERENCED_FUNCTIONS / REFERENCES', () => {
  // Fresh engine per test: `f`/`g`/`h` must be functions so calls parse as
  // applications rather than implicit multiplication.
  const fnEngine = () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.declare('g', 'function');
    ce.declare('h', 'function');
    return ce;
  };

  it('reports the applied function head (excluded from symbols/freeVariables)', () => {
    const expr = fnEngine().parse('f(1024)');
    expect(expr.symbols).toEqual([]);
    expect(expr.freeVariables).toEqual([]);
    expect(expr.referencedFunctions).toEqual(['f']);
    expect(expr.references).toEqual(['f']);
  });

  it('recovers the call edge a definition references', () => {
    const cell = fnEngine().parse('g(x) := f(x) + 1', { strict: false });
    expect(cell.defines).toEqual(['g']);
    expect(cell.referencedFunctions).toEqual(['f']);
    expect(cell.references).toEqual(['f']);
  });

  it('references unions value and function dependencies', () => {
    const cell = fnEngine().parse('g(x) := f(x) + a', { strict: false });
    expect(cell.references).toEqual(['a', 'f']);
  });

  it('excludes built-in operators', () => {
    const expr = fnEngine().parse('\\sin(x) + \\cos(x)');
    expect(expr.referencedFunctions).toEqual([]);
    expect(expr.references).toEqual(['x']);
  });

  it('reports nested call heads', () => {
    expect(fnEngine().parse('f(g(h(x)))').referencedFunctions).toEqual([
      'f',
      'g',
      'h',
    ]);
  });

  it('drops self-reference of a recursive definition', () => {
    const cell = fnEngine().parse('g(x) := g(x - 1)', { strict: false });
    expect(cell.defines).toEqual(['g']);
    expect(cell.referencedFunctions).toEqual(['g']);
    expect(cell.references).toEqual([]);
  });

  it('excludes a function-typed parameter bound by an enclosing scope', () => {
    // ["Function", ["p", "x"], "p"] — p is the bound parameter, not a free
    // function reference.
    const ce = new ComputeEngine();
    const lambda = ce.function(
      'Function',
      [ce.function('p', [ce.symbol('x')], { canonical: false }), ce.symbol('p')],
      { canonical: false }
    );
    expect(lambda.referencedFunctions).toEqual([]);
  });

  it('works on raw (non-canonical) cells', () => {
    const cell = fnEngine().parse('g(x) := f(x) + 1', {
      form: 'raw',
      strict: false,
    });
    expect(cell.referencedFunctions).toEqual(['f']);
    expect(cell.references).toEqual(['f']);
  });
});

describe('APPLIED_NON_FUNCTIONS', () => {
  it('reports an undefined function application, not a declared one', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    expect(ce.appliedNonFunctions('f(x) + g(x)')).toEqual(['g']);
  });

  it('reports nested undefined applications', () => {
    const ce = new ComputeEngine();
    expect(ce.appliedNonFunctions('g(h(x))')).toEqual(['g', 'h']);
  });

  it('does not report numeric-coefficient multiplication', () => {
    const ce = new ComputeEngine();
    expect(ce.appliedNonFunctions('2(x+1)')).toEqual([]);
  });

  it('does not report a known builtin function', () => {
    const ce = new ComputeEngine();
    expect(ce.appliedNonFunctions('\\sin(x)')).toEqual([]);
  });

  it('is scope-aware: declaring as a function suppresses the report', () => {
    const ce = new ComputeEngine();
    expect(ce.appliedNonFunctions('g(x)')).toEqual(['g']);
    ce.declare('g', 'function');
    expect(ce.appliedNonFunctions('g(x)')).toEqual([]);
  });

  it('has no side effects (does not declare symbols)', () => {
    const ce = new ComputeEngine();
    ce.appliedNonFunctions('g(x)');
    expect(ce.lookupDefinition('g')).toBeUndefined();
  });
});
