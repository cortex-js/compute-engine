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

  test("f'(x, y) - multi-argument prime is a first-argument partial", () =>
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

  // Item 70: an arity-1 `["D", w]` application (e.g. a user function named
  // `D`) must not silently drop its operand on serialization.
  test('arity-1 D application round-trip (does not drop operand)', () => {
    const latex = ce.box(['D', 'w'], { canonical: false }).toLatex();
    expect(latex).toBe('\\operatorname{D}(w)');
    const reparsed = ce.parse(latex, { canonical: false });
    expect(reparsed.json).toEqual(['D', 'w']);
  });

  test('arity-1 D inside Multiply round-trip (does not drop operand)', () => {
    const latex = ce
      .box(['Multiply', 'u', ['D', 'w']], { canonical: false })
      .toLatex();
    expect(latex).toBe('u\\operatorname{D}(w)');
    // The `w` operand survives the round-trip.
    expect(ce.parse(latex, { canonical: false }).json).toEqual([
      'InvisibleOperator',
      'u',
      ['D', 'w'],
    ]);
  });

  test('recognized D(f, x) serialization is unchanged', () => {
    expect(ce.box(['D', 'f', 'x'], { canonical: false }).toLatex()).toBe(
      '\\frac{\\mathrm{d}}{\\mathrm{d}x}f'
    );
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

  test('D of square-bracketed sin(x) evaluates to cos(x)', () => {
    const expr = ce.parse('\\frac{d}{\\,\\mathrm{d}x}[\\sin x]');
    expect(expr.json).toEqual(['D', ['Sin', 'x'], 'x']);
    expect(expr.evaluate().toString()).toBe('cos(x)');
  });

  test('compact d/dx notation applies chain rule to unknown functions', () => {
    const expr = ce.parse('d/dx(f(g(x)))');
    expect(expr.json).toEqual(['D', ['f', ['g', 'x']], 'x']);
    expect(expr.evaluate().json).toEqual([
      'Multiply',
      ['Apply', ['Derivative', 'g', 1], 'x'],
      ['Apply', ['Derivative', 'f', 1], ['g', 'x']],
    ]);
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

// RT-P0-6: the higher-order Leibniz notation the `D` serializer emits
// (`\frac{d^n}{dx^n} f`) must parse back to the same nested `D`. Previously the
// `d`-branch only accepted a bare `d` numerator, so a `d^n` numerator fell
// through to a `Divide` of symbols — a silent meaning change.
describe('HIGHER-ORDER LEIBNIZ ROUND-TRIP', () => {
  test("f''(x) round-trips through LaTeX", () => {
    const d2 = ce.parse("f''(x)");
    expect(ce.parse(d2.latex).isSame(d2)).toBe(true);
  });

  test("f'''(x) round-trips through LaTeX", () => {
    const d3 = ce.parse("f'''(x)");
    expect(ce.parse(d3.latex).isSame(d3)).toBe(true);
  });

  test('second-order Leibniz of sin round-trips', () => {
    const d2 = ce.parse('\\frac{d^2}{dx^2}\\sin(x)');
    expect(d2.json).toEqual(['D', ['D', ['Sin', 'x'], 'x'], 'x']);
    expect(d2.evaluate().isSame(ce.parse('-\\sin(x)'))).toBe(true);
  });

  test('single-fraction second-derivative form parses', () => {
    // `\frac{d^2 <fn>}{dx^2}` folds the degree and the function into the
    // numerator; it must parse to the same nested `D` as the split form.
    const d2 = ce.parse('\\frac{d^2 \\sin(x)}{dx^2}');
    expect(d2.json).toEqual(['D', ['D', ['Sin', 'x'], 'x'], 'x']);
    expect(d2.isSame(ce.parse('\\frac{d^2}{dx^2}\\sin(x)'))).toBe(true);
    expect(d2.evaluate().isSame(ce.parse('-\\sin(x)'))).toBe(true);
  });

  test('first-order Leibniz and prime notation agree after evaluation', () => {
    // Leibniz `d/dx f(x)` parses to D(f(x), x) — the derivative of an applied
    // expression — while prime `f'(x)` parses to Apply(Derivative(f, 1), x):
    // the derivative *function* evaluated at x. Distinct trees (so not
    // isSame at parse time), but both evaluate to the same symbolic
    // derivative.
    const leibniz = ce.parse('\\frac{d}{dx}f(x)').evaluate();
    const prime = ce.parse("f'(x)").evaluate();
    expect(leibniz.isSame(prime)).toBe(true);
  });
});

describe('PARTIAL DERIVATIVE NOTATION (∂)', () => {
  test('Euler ∂_x f(x, y) parses to a first-argument partial', () => {
    const expr = ce.parse('\\partial_x f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 1, 0],
      'x',
      'y',
    ]);
  });

  test('Leibniz ∂/∂x f(x, y) parses to the D operator', () => {
    const expr = ce.parse('\\frac{\\partial}{\\partial x} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x']);
  });

  test('Leibniz ∂/∂y f(x, y) selects the second argument', () => {
    const expr = ce.parse('\\frac{\\partial}{\\partial y} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'y']);
  });

  test('mixed Leibniz ∂²/∂x∂y f(x, y) collects both variables', () => {
    const expr = ce.parse(
      '\\frac{\\partial^2}{\\partial x \\partial y} f(x, y)'
    );
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x', 'y']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 1, 1],
      'x',
      'y',
    ]);
  });

  test('repeated Leibniz ∂²/∂x² f(x, y) repeats the variable', () => {
    const expr = ce.parse('\\frac{\\partial^2}{\\partial x^2} f(x, y)');
    expect(expr.json).toEqual(['D', ['f', 'x', 'y'], 'x', 'x']);
    expect(expr.evaluate().json).toEqual([
      'Apply',
      ['Derivative', 'f', 2, 0],
      'x',
      'y',
    ]);
  });

  test('a first-order partial serializes to Leibniz ∂ notation', () => {
    const expr = ce.box(['D', ['f', 'x', 'y'], 'x']).evaluate();
    expect(expr.latex).toBe('\\frac{\\partial}{\\partial x} f(x, y)');
  });

  test('a mixed partial serializes to Leibniz ∂ notation', () => {
    const expr = ce
      .box(['D', ['D', ['f', 'x', 'y'], 'x'], 'y'])
      .evaluate();
    expect(expr.latex).toBe(
      '\\frac{\\partial^{2}}{\\partial x \\partial y} f(x, y)'
    );
  });

  test('partial derivative notation round-trips through LaTeX', () => {
    for (const j of [
      ['D', ['f', 'x', 'y'], 'x'],
      ['D', ['f', 'x', 'y'], 'y'],
      ['D', ['D', ['f', 'x', 'y'], 'x'], 'y'],
      ['D', ['D', ['f', 'x', 'y'], 'x'], 'x'],
    ] as const) {
      const evaluated = ce.box(j).evaluate();
      const reparsed = ce.parse(evaluated.latex).evaluate();
      expect(reparsed.isSame(evaluated)).toBe(true);
    }
  });

  test('the multi-index Derivative operator serializes as f^{(1,0)}', () => {
    expect(ce.box(['Derivative', 'f', 1, 0]).latex).toBe('f^{(1, 0)}');
    expect(ce.box(['Derivative', 'f', 2, 1]).latex).toBe('f^{(2, 1)}');
  });
});
