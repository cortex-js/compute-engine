import { engine as ce, exprToString } from '../../utils';

function parse(s: string) {
  const expr = ce.parse(s);
  return expr.toLatex() + '\n' + expr.toString() + '\n' + exprToString(expr);
}

/** Integrals with no limits specified */
describe('INDEFINITE INTEGRAL', () => {
  test('No index', () => {
    expect(parse('\\int\\sin x + 1 = 2')).toMatchSnapshot();
  });

  test('Index with d', () => {
    expect(parse('\\int\\sin x \\operatorname{d} x+1 = 2')).toMatchSnapshot();
  });

  test('Index with mathrm', () => {
    expect(parse('\\int\\sin x \\mathrm{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index with operatorname', () => {
    expect(parse('\\int\\sin x \\operatorname{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index \\alpha', () => {
    expect(parse('\\int\\alpha d\\alpha+1 = 2')).toMatchSnapshot();
  });

  test('Spacing commands', () => {
    expect(parse('\\int\\!\\sin x \\,\\mathrm{d}x+1 = 2')).toMatchSnapshot();
  });

  test('Index in addition', () =>
    expect(parse('\\int3x+kxdx = 2')).toMatchSnapshot());

  test('Index in negate', () =>
    expect(parse('\\int-xdx = 2')).toMatchSnapshot());

  test('Index inside delimiter', () =>
    expect(parse('\\int(3x+x^2dx) = 2')).toMatchSnapshot());

  test('Index after delimiter', () =>
    expect(parse('\\int(3x+x^2)dx = 2')).toMatchSnapshot());

  test('Index after implicit trig argument', () =>
    expect(parse('\\int\\sin x dx = 2')).toMatchSnapshot());

  test('Index in numerator', () =>
    expect(parse('\\int\\frac{3xdx}{5} = 2')).toMatchSnapshot());

  test('Index in numerator with mathrm', () =>
    expect(parse('\\int\\frac{3x\\mathrm{d}x}{5} = 2')).toMatchSnapshot());

  test('Index with \\differentialD', () =>
    expect(parse('\\int\\sin x \\differentialD x + 1 = 2')).toMatchSnapshot());

  test('Non-standard typesetting (\\cdot)', () =>
    expect(parse('\\int f(t) \\cdot dt')).toMatchSnapshot());

  test('INVALID index in denominator', () =>
    expect(parse('\\int\\frac{3x}{5dx} = 2')).toMatchSnapshot()); // @fixme, should error
});

/** Integral with limits */
describe('DEFINITE INTEGRAL', () => {
  test('Lower and upper bounds', () => {
    expect(parse('\\int_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('Lower and upper bounds with \\limits', () => {
    expect(parse('\\int\\limits_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('Lower bound only (malformed)', () => {
    expect(parse('\\int_0\\sin x dx')).toMatchSnapshot();
  });

  test('Upper bound only (malformed)', () => {
    expect(parse('\\int^1\\sin x dx')).toMatchSnapshot();
  });

  test('Symbolic lower bound (regions)', () => {
    expect(parse('\\int_G\\sin x dx')).toMatchSnapshot();
  });

  test('Lower and upper bounds with no index', () => {
    expect(parse('\\int_0^1\\sin x')).toMatchSnapshot();
  });
});

describe('MULTIPLE INTEGRALS', () => {
  test('Double integral', () => {
    expect(parse('\\int_1^2\\int_0^1 x^2+y^2 dx dy')).toMatchSnapshot();
  });

  test('Double integral with repeated index', () => {
    expect(parse('\\int_1^2\\int_0^1 x^2 dx dx')).toMatchSnapshot();
  });

  test('Triple integral', () => {
    expect(
      parse('\\int_1^2\\int_0^1\\int_3^4 x^2+y^2+z^2 dx dy dz')
    ).toMatchSnapshot();
  });

  test('Triple integral with \\limits and spacing', () => {
    expect(
      parse(
        '\\int\\limits_1^2\\int\\limits_0^1\\int\\limits_3^4 \\!x^2+y^2+z^2 \\,\\mathrm{d}x \\mathrm{d}y \\mathrm{d}z'
      )
    ).toMatchSnapshot();
  });
});

describe('EXOTIC INTEGRALS', () => {
  test('\\oint - contour integral', () => {
    expect(parse('\\oint_V f(s) ds')).toMatchSnapshot();
  });

  test('\\oint - contour integral, no index', () => {
    expect(parse('\\oint_C f')).toMatchSnapshot();
  });

  test('\\intop', () => {
    expect(parse('\\intop_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('\\smallint', () => {
    expect(parse('\\smallint_0^1\\sin x dx')).toMatchSnapshot();
  });

  test('\\iint', () => {
    expect(parse('\\iint_D f(x,y) dx dy')).toMatchSnapshot();
  });
  test('\\iiint', () => {
    expect(parse('\\iiint_V f(x,y,z) dx dy dz')).toMatchSnapshot();
  });
});

describe('REAL WORLD INTEGRALS', () => {
  test('Integral with non standard typesetting', () =>
    expect(
      parse('S_t=S_0+\\int_{t_i}^{t_e}\\left(G-F\\right)\\cdot dt')
    ).toMatchSnapshot());
});

describe('LIMIT', () => {
  expect(parse('\\lim_{x\\to\\infty} f(x)')).toMatchSnapshot(
    `["Limit", ["Function", ["f", "x"], "x"], "PositiveInfinity"]`
  );

  expect(ce.parse('\\lim_{x \\to 0} \\frac{\\sin(x)}{x}')).toMatchSnapshot(
    `["Limit", ["Function", ["Divide", ["Sin", "x"], "x"], "x"], 0]`
  );
  expect(parse('\\lim_{x\\to\\infty} f(x)')).toMatchSnapshot(`
  lim_(+oo) {f(x)}
  \\lim_{x\\to\\infty}f(x)
  Limit,Function,f,x,x,PositiveInfinity
`);
});

describe('NEWTON DOT NOTATION', () => {
  test('First derivative \\dot{x}', () =>
    expect(parse('\\dot{x}')).toMatchSnapshot());

  test('Second derivative \\ddot{x}', () =>
    expect(parse('\\ddot{x}')).toMatchSnapshot());

  test('Third derivative \\dddot{y}', () =>
    expect(parse('\\dddot{y}')).toMatchSnapshot());

  test('Fourth derivative \\ddddot{z}', () =>
    expect(parse('\\ddddot{z}')).toMatchSnapshot());

  test('Dot notation with expression', () =>
    expect(parse('\\dot{x} + \\ddot{x}')).toMatchSnapshot());
});

describe('LAGRANGE PRIME NOTATION WITH ARGUMENTS', () => {
  test("f'(x) - single prime with argument", () =>
    expect(parse("f'(x)")).toMatchSnapshot());

  test("f''(x) - double prime with argument", () =>
    expect(parse("f''(x)")).toMatchSnapshot());

  test("f'''(x) - triple prime with argument", () =>
    expect(parse("f'''(x)")).toMatchSnapshot());

  test("g'(t) - different variable", () =>
    expect(parse("g'(t)")).toMatchSnapshot());

  test("f'(x, y) - multiple arguments uses first as variable", () =>
    expect(parse("f'(x, y)")).toMatchSnapshot());

  test("f' without arguments - returns Derivative", () =>
    expect(parse("f'")).toMatchSnapshot());

  test("\\sin'(x) - known function with prime", () =>
    expect(parse("\\sin'(x)")).toMatchSnapshot());
});

describe('EULER DERIVATIVE NOTATION', () => {
  test('D_x f - first derivative', () =>
    expect(parse('D_x f')).toMatchSnapshot());

  test('D_t x - different variable', () =>
    expect(parse('D_t x')).toMatchSnapshot());

  test('D^2_x f - second derivative', () =>
    expect(parse('D^2_x f')).toMatchSnapshot());

  test('D_x (x^2 + 1) - derivative of expression', () =>
    expect(parse('D_x (x^2 + 1)')).toMatchSnapshot());

  test('D without subscript - should parse as symbol', () =>
    expect(parse('D')).toMatchSnapshot());
});

describe('DERIVATIVE ROUND-TRIP', () => {
  // Verify that parsing and re-serializing produces valid output
  test('Newton dot notation round-trip', () => {
    const expr = ce.parse('\\dot{x}');
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    // The MathJSON should be equivalent (both represent d/dt of x)
    expect(reparsed.json).toEqual(expr.json);
  });

  test('Lagrange prime notation round-trip', () => {
    const expr = ce.parse("f'(x)");
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(expr.json);
  });

  test('Euler notation round-trip', () => {
    const expr = ce.parse('D_x f');
    const latex = expr.toLatex();
    const reparsed = ce.parse(latex);
    expect(reparsed.json).toEqual(expr.json);
  });
});

describe('DERIVATIVE EVALUATION', () => {
  test('D of x^2 evaluates to 2x', () => {
    const expr = ce.parse('\\frac{d}{dx} x^2');
    const result = expr.evaluate();
    expect(result.toString()).toBe('2x');
  });

  test('D of sin(x) evaluates to cos(x)', () => {
    const expr = ce.parse('\\frac{d}{dx} \\sin(x)');
    const result = expr.evaluate();
    expect(result.toString()).toBe('cos(x)');
  });

  test('Newton notation evaluates correctly', () => {
    // \dot{t^2} with respect to t should be 2t
    const expr = ce.parse('\\dot{t^2}');
    const result = expr.evaluate();
    expect(result.toString()).toBe('2t');
  });

  test('Euler notation evaluates correctly', () => {
    const expr = ce.parse('D_x x^3');
    const result = expr.evaluate();
    expect(result.toString()).toBe('3x^2');
  });
});
