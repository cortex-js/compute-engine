import { ComputeEngine } from '../../src/compute-engine';

describe('A6 polish — lowercase count alias', () => {
  test('\\operatorname{count}(L) parses to Length', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{count}([1,2,3])');
    expect(expr.json).toEqual(['Length', ['List', 1, 2, 3]]);
  });
});

describe('A6 polish — 2-arg arctan → Arctan2', () => {
  test('single-arg \\arctan stays Arctan', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(0.5)');
    expect(expr.operator).toEqual('Arctan');
    expect(expr.ops?.length).toEqual(1);
  });

  test('two-arg \\arctan(y, x) lowers to Arctan2', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\arctan(y, x)');
    expect(expr.operator).toEqual('Arctan2');
    expect(expr.ops?.length).toEqual(2);
  });

  test('two-arg \\arctan in expression context', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\frac{180\\arctan(y, x)}{\\pi}');
    expect(expr.isValid).toBe(true);
  });
});

describe('A6 polish — Repeat arity', () => {
  test('1-arg Repeat keeps infinite-list semantics', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5)');
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(1);
    expect(expr.isValid).toBe(true);
  });

  test('2-arg Repeat(value, count) returns a finite list', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 3)').evaluate();
    expect(expr.json).toEqual(['List', 5, 5, 5]);
  });

  test('2-arg Repeat parses without error', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 3)');
    expect(expr.isValid).toBe(true);
  });

  test('Repeat(value, 0) evaluates to empty list', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, 0)').evaluate();
    expect(expr.json).toEqual(['List']);
  });

  test('Repeat with negative count clamps to empty', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{repeat}(5, -2)').evaluate();
    expect(expr.json).toEqual(['List']);
  });

  test('Repeat with symbolic count remains unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.parse('\\operatorname{repeat}(5, n)').evaluate();
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(2);
  });

  test('Repeat with large count stays unevaluated (lazy access still works)', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Repeat', 5, 100000]).evaluate();
    // Did not materialize a huge list.
    expect(expr.operator).toEqual('Repeat');
    expect(expr.ops?.length).toEqual(2);
  });

  test('Repeat with count at the cap still materializes', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Repeat', 5, 10000]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.ops?.length).toEqual(10000);
  });
});

describe('A6 polish — operatorInfo gaps', () => {
  test('operatorInfo returns entries for Length, Complex, Colon, Prime', () => {
    const ce = new ComputeEngine();
    expect(ce.operatorInfo('Length')).toBeDefined();
    expect(ce.operatorInfo('Complex')).toBeDefined();
    expect(ce.operatorInfo('Colon')).toBeDefined();
    expect(ce.operatorInfo('Prime')).toBeDefined();
  });

  test('L.count still parses to Length and resolves via operatorInfo', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('[1, 2, 3].\\operatorname{count}');
    expect(expr.operator).toEqual('Length');
    expect(ce.operatorInfo('Length')?.kind).toEqual('function');
  });

  test('Length on a non-collection returns unevaluated', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Length', 5]).evaluate();
    // Either stays unevaluated as ['Length', 5], or is an error expression.
    // Critical: it must NOT be a finite integer result like 0 or NaN.
    expect(expr.operator === 'Length' || expr.operator === 'Error').toBe(true);
  });

  test('Length on an infinite collection returns unevaluated', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\operatorname{count}(\\operatorname{repeat}(5))').evaluate();
    expect(expr.operator).toEqual('Length'); // still unevaluated
  });

  test('Length on a value-bound symbol resolves through the binding', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.assign('L', ['List', 1, 2, 3]);
    const expr = ce.box(['Length', 'L']).evaluate();
    expect(expr.json).toEqual(3);
  });
});

describe('A6 polish — symbolInfo API', () => {
  test('symbolInfo returns entries for transcendental constants', () => {
    const ce = new ComputeEngine();
    for (const name of [
      'Pi', 'ExponentialE', 'EulerGamma', 'CatalanConstant', 'GoldenRatio',
    ]) {
      const info = ce.symbolInfo(name);
      expect(info).toBeDefined();
      expect(info?.kind).toEqual('constant');
      expect(info?.type.toString()).toMatch(/real|number/);
    }
  });

  test('symbolInfo returns entries for boolean / special-value constants', () => {
    const ce = new ComputeEngine();
    expect(ce.symbolInfo('True')?.kind).toEqual('constant');
    expect(ce.symbolInfo('False')?.kind).toEqual('constant');
    // Infinity canonicalizes to PositiveInfinity; NaN and ImaginaryUnit are
    // registered as value definitions directly.
    expect(ce.symbolInfo('PositiveInfinity')).toBeDefined();
    expect(ce.symbolInfo('NaN')).toBeDefined();
    expect(ce.symbolInfo('ImaginaryUnit')).toBeDefined();
  });

  test('symbolInfo returns undefined for unknown symbols', () => {
    const ce = new ComputeEngine();
    expect(ce.symbolInfo('NotARealConstant')).toBeUndefined();
  });

  test('symbolInfo returns undefined for operator heads', () => {
    const ce = new ComputeEngine();
    // Operator heads should be queried via operatorInfo, not symbolInfo.
    expect(ce.symbolInfo('Add')).toBeUndefined();
  });

  test('symbolInfo returns kind: "variable" for user-declared variables', () => {
    const ce = new ComputeEngine();
    ce.declare('myVar', 'real');
    const info = ce.symbolInfo('myVar');
    expect(info).toBeDefined();
    expect(info?.kind).toEqual('variable');
    expect(info?.type.toString()).toMatch(/real/);
  });
});

describe('A6 polish — normalizeIdentifier', () => {
  test('strips LaTeX braces from subscripted names', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('R_{3}')).toEqual('R_3');
    expect(ce.normalizeIdentifier('f_{Bm}')).toEqual('f_Bm');
    expect(ce.normalizeIdentifier('C_{ustomizablecolor}')).toEqual('C_ustomizablecolor');
    expect(ce.normalizeIdentifier('S_{orry}')).toEqual('S_orry');
  });

  test('converts Greek command names', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('\\theta_x')).toEqual('theta_x');
    expect(ce.normalizeIdentifier('\\alpha')).toEqual('alpha');
  });

  test('leaves already-canonical names unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('R_3')).toEqual('R_3');
    expect(ce.normalizeIdentifier('c_1')).toEqual('c_1');
    expect(ce.normalizeIdentifier('theta_x')).toEqual('theta_x');
  });

  test('does NOT auto-declare the name', () => {
    const ce = new ComputeEngine();
    ce.normalizeIdentifier('R_{3}');
    // After normalize, declare should succeed without "already declared".
    expect(() =>
      ce.declare('R_3', '(number, number) -> number'),
    ).not.toThrow();
  });

  test('returns empty string for unparseable input', () => {
    const ce = new ComputeEngine();
    expect(ce.normalizeIdentifier('')).toEqual('');
    expect(ce.normalizeIdentifier('1 + 2')).toEqual(''); // not an identifier
  });
});
