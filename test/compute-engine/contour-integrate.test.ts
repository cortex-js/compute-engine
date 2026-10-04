import { ComputeEngine } from '../../src/compute-engine';
import type {
  ContourInput,
  MathJsonExpression,
} from '../../src/compute-engine';

const ce = new ComputeEngine();
const circle = (radius = 2): ContourInput => ({
  kind: 'circle',
  center: 0,
  radius,
});
const inverse: MathJsonExpression = ['Divide', 1, 'z'];
const result = (f: MathJsonExpression, contour: ContourInput = circle()) =>
  ce.contourIntegrate(f, 'z', contour);

describe('Symbolic contour integration', () => {
  test('LaTeX circle conditions and the named ContourIntegrate spelling', () => {
    expect(
      ce.parse('\\oint_{|z|=2} \\frac{1}{z}\\,dz').evaluate().N().im
    ).toBeCloseTo(2 * Math.PI, 11);
    expect(
      ce
        .parse(
          '\\operatorname{ContourIntegrate}(1/z,z,\\operatorname{CircleContour}(0,2))'
        )
        .evaluate()
        .N().im
    ).toBeCloseTo(2 * Math.PI, 11);
  });

  test('a concave polygon uses its interior, not its bounding box', () => {
    const contour: ContourInput = {
      kind: 'polygon',
      vertices: [
        0,
        3,
        ['Complex', 3, 1],
        ['Complex', 1, 1],
        ['Complex', 1, 3],
        ['Complex', 0, 3],
      ],
    };
    const r = result(
      ['Divide', 1, ['Subtract', 'z', ['Complex', 2, 2]]],
      contour
    );
    expect(r.status).toBe('success');
    expect(r.poles[0].location).toBe('outside');
    expect(r.value?.isSame(0)).toBe(true);
  });

  test('a removable singularity on the boundary does not obstruct integration', () => {
    const r = result(
      ['Divide', ['Subtract', ['Power', 'z', 2], 1], ['Subtract', 'z', 1]],
      circle(1)
    );
    expect(r.status).toBe('success');
    expect(r.value?.isSame(0)).toBe(true);
    expect(r.poles.every((p) => p.kind === 'removable')).toBe(true);
  });

  test('a cubic denominator includes all three complex poles', () => {
    const r = result(['Divide', 1, ['Add', ['Power', 'z', 3], 1]]);
    expect(r.status).toBe('success');
    expect(r.poles).toHaveLength(3);
    expect(r.value?.N().re).toBeCloseTo(0, 11);
    expect(r.value?.N().im).toBeCloseTo(0, 11);
  });

  test('unresolved parameters and nonexact contour coordinates remain explicit', () => {
    expect(result(['Divide', 1, ['Subtract', 'z', 'a']]).status).toBe(
      'unsupported'
    );
    expect(
      result(inverse, { kind: 'circle', center: 0, radius: 'r' }).status
    ).toBe('unsupported');
  });
  test('an entire integrand has no poles and integral zero', () => {
    const r = result(['Exp', 'z']);
    expect(r.status).toBe('success');
    expect(r.poles).toHaveLength(0);
    expect(r.residueSum?.isSame(0)).toBe(true);
    expect(r.value?.isSame(0)).toBe(true);
  });

  test('one enclosed pole exposes the complete residue calculation', () => {
    const r = result(inverse);
    expect(r.status).toBe('success');
    expect(r.polesComplete).toBe(true);
    expect(r.poles).toHaveLength(1);
    expect(r.poles[0]).toMatchObject({
      kind: 'pole',
      location: 'inside',
      enclosed: true,
      order: 1,
    });
    expect(r.poles[0].point.isSame(0)).toBe(true);
    expect(r.poles[0].residue?.isSame(1)).toBe(true);
    expect(r.residueSum?.isSame(1)).toBe(true);
    expect(
      r.value?.isSame(ce.expr(['Multiply', 2, 'Pi', 'ImaginaryUnit']))
    ).toBe(true);
  });

  test('multiple residues are summed while outside poles are excluded', () => {
    const r = result([
      'Add',
      inverse,
      ['Divide', 2, ['Subtract', 'z', 1]],
      ['Divide', 7, ['Subtract', 'z', 5]],
    ]);
    expect(r.status).toBe('success');
    expect(r.poles.filter((p) => p.enclosed)).toHaveLength(2);
    expect(r.poles.filter((p) => p.location === 'outside')).toHaveLength(1);
    expect(r.residueSum?.isSame(3)).toBe(true);
    expect(r.value?.N().im).toBeCloseTo(6 * Math.PI, 12);
  });

  test('all poles outside gives zero', () => {
    const r = result(['Divide', 1, ['Subtract', 'z', 3]]);
    expect(r.status).toBe('success');
    expect(r.poles[0].enclosed).toBe(false);
    expect(r.value?.isSame(0)).toBe(true);
  });

  test('clockwise orientation negates the result, not the residue sum', () => {
    const r = result(inverse, {
      kind: 'circle',
      center: 0,
      radius: 2,
      orientation: 'clockwise',
    });
    expect(r.status).toBe('success');
    expect(r.residueSum?.isSame(1)).toBe(true);
    expect(r.value?.N().im).toBeCloseTo(-2 * Math.PI, 12);
  });

  test('a boundary pole is undefined even if its residue is zero', () => {
    const r = result(['Power', ['Subtract', 'z', 2], -2]);
    expect(r.status).toBe('pole-on-contour');
    expect(r.poles[0].location).toBe('boundary');
    expect(r.poles[0].order).toBe(2);
    expect(r.poles[0].residue?.isSame(0)).toBe(true);
    expect(r.value).toBeUndefined();
    expect(r.residueSum).toBeUndefined();
  });

  test('higher-order poles can have zero residue inside', () => {
    const r = result(['Power', 'z', -2]);
    expect(r.status).toBe('success');
    expect(r.poles[0].order).toBe(2);
    expect(r.value?.isSame(0)).toBe(true);
  });

  test('complex poles are found regardless of real declarations', () => {
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const r = engine.contourIntegrate(
      ['Divide', 1, ['Add', ['Power', 'x', 2], 1]],
      'x',
      { kind: 'circle', center: 'ImaginaryUnit', radius: 1 }
    );
    expect(r.status).toBe('success');
    expect(r.poles).toHaveLength(2);
    expect(r.poles.filter((p) => p.enclosed)).toHaveLength(1);
    expect(r.value?.N().re).toBeCloseTo(Math.PI, 12);
  });

  test('assigned integration variables remain bound', () => {
    const engine = new ComputeEngine();
    engine.assign('z', 10);
    expect(
      engine.contourIntegrate(inverse, 'z', circle()).value?.N().im
    ).toBeCloseTo(2 * Math.PI, 12);
    expect(engine.expr('z').evaluate().re).toBe(10);
  });

  test('an exact pole arbitrarily close to the boundary is not rounded onto it', () => {
    const inside: MathJsonExpression = [
      'Rational',
      '99999999999999999999',
      '100000000000000000000',
    ];
    const r = result(['Divide', 1, ['Subtract', 'z', inside]], circle(1));
    expect(r.status).toBe('success');
    expect(r.poles[0].location).toBe('inside');
  });

  test('rectangle contour and polygon traversal orientation', () => {
    const corners: MathJsonExpression[] = [
      ['Complex', -1, -1],
      ['Complex', 1, -1],
      ['Complex', 1, 1],
      ['Complex', -1, 1],
    ];
    expect(
      result(inverse, {
        kind: 'rectangle',
        lowerLeft: corners[0],
        upperRight: corners[2],
      }).value?.N().im
    ).toBeCloseTo(2 * Math.PI, 12);
    expect(
      result(inverse, { kind: 'polygon', vertices: corners }).value?.N().im
    ).toBeCloseTo(2 * Math.PI, 12);
    expect(
      result(inverse, {
        kind: 'polygon',
        vertices: [...corners].reverse(),
      }).value?.N().im
    ).toBeCloseTo(-2 * Math.PI, 12);
  });

  test('polygon edges and vertices detect boundary poles', () => {
    const contour: ContourInput = {
      kind: 'polygon',
      vertices: [0, 2, ['Complex', 0, 2]],
    };
    expect(result(inverse, contour).status).toBe('pole-on-contour');
    expect(result(['Divide', 1, ['Subtract', 'z', 1]], contour).status).toBe(
      'pole-on-contour'
    );
  });

  test('self-crossing polygons and degenerate circles are rejected', () => {
    expect(
      result(inverse, {
        kind: 'polygon',
        vertices: [0, ['Complex', 2, 2], 2, ['Complex', 0, 2]],
      }).status
    ).toBe('invalid-contour');
    expect(result(inverse, circle(0)).status).toBe('invalid-contour');
    expect(result(inverse, circle(-1)).status).toBe('invalid-contour');
  });

  test.each<MathJsonExpression>([
    ['Ln', 'z'],
    ['Conjugate', 'z'],
    ['Exp', ['Divide', 1, ['Power', 'z', 2]]],
    ['Gamma', 'z'],
    ['Divide', 1, ['Add', ['Power', 'z', 5], 'z', 1]],
  ])('unsupported or incomplete analysis does not report zero: %j', (f) => {
    const r = result(f);
    expect(r.status).not.toBe('success');
    expect(r.value).toBeUndefined();
  });

  test('MathJSON contour forms evaluate through the public operator', () => {
    const expr = ce.expr([
      'ContourIntegrate',
      inverse,
      'z',
      ['CircleContour', 0, 2],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().N().im).toBeCloseTo(2 * Math.PI, 12);
    expect(
      ce
        .expr(['ContourIntegrate', inverse, 'z', ['CircleContour', 0, 2, -1]])
        .N().im
    ).toBeCloseTo(-2 * Math.PI, 12);
    expect(
      ce
        .expr([
          'ContourIntegrate',
          ['Divide', 1, ['Subtract', 'z', 2]],
          'z',
          ['CircleContour', 0, 2],
        ])
        .evaluate().isNaN
    ).toBe(true);
  });
});

describe('Real integrals evaluated by residues', () => {
  test.each([
    ['1/x', 0, 0, 1],
    ['1/(x-3)', 0, 0, 1],
    ['x/(x^2+1)', 0, 0, 1],
    ['1/(x-i)', 0, Math.PI, 1],
    ['1/(x+i)', 0, -Math.PI, 1],
    ['3x/(x^2+1)', 0, 0, 3],
  ])('PV large arc is subtracted for %s', (latex, re, im, coefficient) => {
    const f = ce.parse(latex);
    const pv = ce.contourIntegrate(f, 'x', {
      kind: 'real-line',
      principalValue: true,
    });
    expect(pv.status).toBe('success');
    expect(pv.value?.N().re).toBeCloseTo(re, 11);
    expect(pv.value?.N().im).toBeCloseTo(im, 11);
    expect(pv.realIntegral?.largeArcContribution?.N().im).toBeCloseTo(
      coefficient * Math.PI,
      11
    );
    expect(pv.residueSum?.N().re).toBeCloseTo(
      (im + coefficient * Math.PI) / (2 * Math.PI),
      11
    );
    expect(ce.contourIntegrate(f, 'x', { kind: 'real-line' }).status).not.toBe(
      'success'
    );
  });

  test('all six roots are certified before a real-line integral is evaluated', () => {
    const f = ce.parse('1/(x^6+1)');
    const r = ce.contourIntegrate(f, 'x', { kind: 'real-line' });
    expect(r.status).toBe('success');
    expect(r.polesComplete).toBe(true);
    expect(r.poles).toHaveLength(6);
    expect(r.value?.N().re).toBeCloseTo((2 * Math.PI) / 3, 11);
    expect(ce.contourIntegrate(f, 'x', circle(1)).status).toBe(
      'pole-on-contour'
    );
    const clockwise = ce.contourIntegrate(f, 'x', {
      kind: 'circle',
      center: 'ImaginaryUnit',
      radius: ['Rational', 1, 2],
      orientation: 'clockwise',
    });
    expect(clockwise.value?.N().re).toBeCloseTo(-Math.PI / 3, 11);
  });

  test.each([2, 3])('periodic repeated algebraic poles with offset %i', (c) => {
    const f = ce.parse(`1/(${c}+\\cos x)^2`);
    const value = ce
      .expr(['Integrate', f, ['Tuple', 'x', 0, ['Multiply', 2, 'Pi']]])
      .evaluate();
    expect(value.has('Integrate')).toBe(false);
    expect(value.N().re).toBeCloseTo(
      (2 * Math.PI * c) / (c * c - 1) ** 1.5,
      10
    );
  });

  test.each([
    ['1/(z^2-2)^2', 2, -Math.sqrt(2) / 16],
    ['1/(z^2-2)^3', 3, (3 * Math.sqrt(2)) / 128],
    ['(z^2-2)/(z^2-2)^3', 2, -Math.sqrt(2) / 16],
    ['1/(z-\\sqrt{2})^2', 2, 0],
  ])(
    'local Taylor division preserves pole order and residue: %s',
    (f, order, residue) => {
      const r = ce.contourIntegrate(ce.parse(f), 'z', {
        kind: 'circle',
        center: 1,
        radius: 1,
      });
      expect(r.status).toBe('success');
      const inside = r.poles.filter((p) => p.location === 'inside');
      expect(inside).toHaveLength(1);
      expect(inside[0].kind).toBe('pole');
      expect(inside[0].order).toBe(order);
      expect(inside[0].residue?.N().re).toBeCloseTo(residue, 11);
      expect(r.value?.N().im).toBeCloseTo(2 * Math.PI * residue, 11);
    }
  );

  test('a removable sine singularity does not require principal value', () => {
    const r = ce.contourIntegrate(['Divide', ['Sin', 'x'], 'x'], 'x', {
      kind: 'real-line',
    });
    expect(r.status).toBe('success');
    expect(r.value?.N().re).toBeCloseTo(Math.PI, 11);
  });

  test('an ordinary even-pole integral is not mistaken for a zero residue sum', () => {
    // 1/x² > 0 next to its double pole at 0: the integral is +∞.
    expect(
      ce
        .expr([
          'Integrate',
          ['Power', 'x', -2],
          ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity'],
        ])
        .evaluate()
        .toString()
    ).toBe('+oo');
  });
  const realLine = (f: MathJsonExpression, principalValue = false) =>
    ce.contourIntegrate(f, 'x', { kind: 'real-line', principalValue });
  const lorentz: MathJsonExpression = ['Add', ['Power', 'x', 2], 1];

  test('the rational integral of 1/(x²+1) is pi', () => {
    const r = realLine(['Divide', 1, lorentz]);
    expect(r.status).toBe('success');
    expect(r.value?.isSame(ce.Pi)).toBe(true);
  });

  test('cos(x)/(x²+1) uses a decaying exponential kernel', () => {
    const f: MathJsonExpression = ['Divide', ['Cos', 'x'], lorentz];
    const r = realLine(f);
    expect(r.status).toBe('success');
    expect(r.realIntegral).toMatchObject({
      closure: 'upper',
      projection: 'real',
      principalValue: false,
    });
    expect(r.value?.N().re).toBeCloseTo(Math.PI / Math.E, 11);
    expect(
      ce
        .expr([
          'Integrate',
          f,
          ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity'],
        ])
        .evaluate()
        .N().re
    ).toBeCloseTo(Math.PI / Math.E, 11);
    expect(
      ce
        .expr([
          'Integrate',
          f,
          ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity'],
        ])
        .N().re
    ).toBeCloseTo(Math.PI / Math.E, 11);
    expect(
      ce
        .expr([
          'Integrate',
          f,
          ['Tuple', 'x', 'PositiveInfinity', 'NegativeInfinity'],
        ])
        .evaluate()
        .N().re
    ).toBeCloseTo(-Math.PI / Math.E, 11);
  });

  test('negative Fourier frequency closes clockwise in the lower half-plane', () => {
    const r = realLine([
      'Divide',
      ['Exp', ['Multiply', -2, 'ImaginaryUnit', 'x']],
      lorentz,
    ]);
    expect(r.status).toBe('success');
    expect(r.realIntegral?.closure).toBe('lower');
    expect(r.value?.N().re).toBeCloseTo(Math.PI * Math.exp(-2), 11);
    expect(r.value?.N().im).toBeCloseTo(0, 11);
  });

  test('the requested cubic cosine integral has a real-axis pole', () => {
    const f: MathJsonExpression = [
      'Divide',
      ['Cos', 'x'],
      ['Add', ['Power', 'x', 3], 1],
    ];
    const r = realLine(f);
    expect(r.status).toBe('pole-on-contour');
    expect(r.poles).toHaveLength(3);
    expect(r.value).toBeUndefined();
    expect(
      ce
        .expr([
          'Integrate',
          f,
          ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity'],
        ])
        .evaluate().isNaN
    ).toBe(true);
    const pv = realLine(f, true);
    expect(pv.status).toBe('success');
    // The upper pole is exp(i*pi/3); the indentation at -1 contributes
    // i*pi*exp(-i)/3 before the real projection.
    const expected =
      (Math.PI / 3) *
      (Math.sin(1) +
        Math.exp(-Math.sqrt(3) / 2) *
          (Math.sin(0.5) + Math.sqrt(3) * Math.cos(0.5)));
    expect(pv.value?.N().re).toBeCloseTo(expected, 10);
  });

  test('a simple real-axis pole requires explicit principal value', () => {
    const f: MathJsonExpression = [
      'Divide',
      ['Cos', 'x'],
      ['Subtract', ['Power', 'x', 2], 1],
    ];
    expect(realLine(f).status).toBe('pole-on-contour');
    expect(realLine(f, true).value?.N().re).toBeCloseTo(
      -Math.PI * Math.sin(1),
      11
    );
    expect(
      ce.expr(['ContourIntegrate', f, 'x', ['RealLineContour', 'True']]).N().re
    ).toBeCloseTo(-Math.PI * Math.sin(1), 11);
  });

  test('insufficient decay and higher-order principal-value poles stay unsupported', () => {
    expect(realLine(['Divide', 'x', lorentz]).status).toBe('unsupported');
    expect(realLine(['Power', 'x', -2], true).status).toBe('unsupported');
  });
});

// Each expected value below was checked against an independent quadrature:
// the trapezoid rule on the circle, or Gauss–Legendre on the real line after
// the substitution x = tan(t).
describe('Inputs that must not give a wrong value', () => {
  const w = ce.parse('e^{i\\pi/4}');
  const nearW: ContourInput = {
    kind: 'circle',
    center: w,
    radius: ['Rational', 1, 2],
  };
  const real = (latex: string, principalValue = false) =>
    ce.contourIntegrate(ce.parse(latex), 'x', {
      kind: 'real-line',
      principalValue,
    });

  test('a complex exponent is not read as an integer exponent', () => {
    // 2^i is 0.769 + 0.639i, not 1: the pole at 1 is outside the circle.
    expect(
      ce.contourIntegrate(ce.parse('\\frac{1}{z-1}'), 'z', {
        kind: 'circle',
        center: ce.parse('2^{i}'),
        radius: ['Rational', 1, 2],
      }).status
    ).not.toBe('success');
    // z^i and z^{2i} have a branch point at 0: the residue theorem does not
    // apply.
    expect(result(ce.parse('z^{2i}').json).status).toBe('unsupported');
    expect(result(ce.parse('\\frac{z^{i}}{z-1}').json).status).toBe(
      'unsupported'
    );
  });

  test('one pole written in two forms is counted once', () => {
    const a = ce
      .contourIntegrate(
        ce.parse('\\frac{1}{(z^4+1)(z-e^{i\\pi/4})}'),
        'z',
        nearW
      )
      .value!.N();
    expect(a.re).toBeCloseTo(0, 12);
    expect(a.im).toBeCloseTo((3 * Math.PI) / 4, 12);
    const b = ce
      .contourIntegrate(
        ce.parse('\\frac{1}{(z^4+1)(z-e^{i\\pi/4})^2}'),
        'z',
        nearW
      )
      .value!.N();
    expect(b.re).toBeCloseTo((-5 * Math.SQRT2 * Math.PI) / 16, 12);
    expect(b.im).toBeCloseTo((-5 * Math.SQRT2 * Math.PI) / 16, 12);
    const c = ce
      .contourIntegrate(ce.parse('\\frac{1}{(z^4+1)(z^2-i)}'), 'z', nearW)
      .value!.N();
    expect(c.re).toBeCloseTo((Math.SQRT2 * Math.PI) / 4, 12);
    expect(c.im).toBeCloseTo((Math.SQRT2 * Math.PI) / 4, 12);
    const d = real('\\frac{1}{(x^4+1)(x-e^{i\\pi/4})}').value!.N();
    expect(d.re).toBeCloseTo(-Math.PI / 4, 12);
    expect(d.im).toBeCloseTo(Math.PI / 2, 12);
  });

  test('the decay test uses the true degree of the denominator', () => {
    // (x+1)³ − x³ = 3x² + 3x + 1: x/(3x² + 3x + 1) is not integrable.
    expect(real('\\frac{x}{(x+1)^3-x^3}').status).toBe('unsupported');
    expect(real('\\frac{1}{(x+1)^3-x^3}').value!.N().re).toBeCloseTo(
      (2 * Math.PI) / Math.sqrt(3),
      12
    );
  });

  test('a real integral has a real value in a simple form', () => {
    expect(
      ce
        .parse('\\int_{-\\infty}^{\\infty}\\frac{\\sin x}{x}dx')
        .evaluate()
        .toString()
    ).toBe('pi');
    expect(
      ce
        .parse('\\int_{0}^{\\infty}\\frac{\\sin x}{x}dx')
        .evaluate()
        .isSame(ce.Pi.div(2))
    ).toBe(true);
    const v = ce
      .parse('\\int_{-\\infty}^{\\infty}\\frac{x^2-1}{(x-1)(x^4+1)}dx')
      .N();
    expect(v.im).toBe(0);
    expect(v.re).toBeCloseTo(Math.PI / Math.SQRT2, 12);
    expect(
      result(['Divide', 1, ['Add', ['Power', 'z', 6], 1]]).value.toString()
    ).toBe('0');
  });

  test('a pole on the real path gives +∞, −∞ or no value', () => {
    const value = (latex: string) => ce.parse(latex).evaluate();
    expect(value('\\int_{-\\infty}^{\\infty}\\frac{1}{x^2}dx').toString()).toBe(
      '+oo'
    );
    expect(
      value('\\int_{-\\infty}^{\\infty}\\frac{-1}{(x-1)^2}dx').toString()
    ).toBe('-oo');
    expect(value('\\int_{\\infty}^{-\\infty}\\frac{1}{x^2}dx').toString()).toBe(
      '-oo'
    );
    expect(value('\\int_{0}^{\\infty}\\frac{1}{x^2}dx').toString()).toBe('+oo');
    expect(
      value('\\int_{-\\infty}^{\\infty}\\frac{\\cos x}{x^2}dx').toString()
    ).toBe('+oo');
    // +∞ next to 0 and −∞ next to 1: no value.
    expect(
      value(
        '\\int_{-\\infty}^{\\infty}\\left(\\frac{1}{x^2}-\\frac{1}{(x-1)^2}\\right)dx'
      ).toString()
    ).toBe('Indeterminate');
    // 1 + cos x has a double zero at π, and 1 + cos x ≥ 0.
    expect(value('\\int_0^{2\\pi}\\frac{1}{1+\\cos x}dx').toString()).toBe(
      '+oo'
    );
    expect(value('\\int_0^{2\\pi}\\frac{1}{\\cos x-1}dx').toString()).toBe(
      '-oo'
    );
    // cos x has simple zeros: the integrand changes sign at each of them.
    expect(value('\\int_0^{2\\pi}\\frac{1}{\\cos x}dx').toString()).toBe(
      'Indeterminate'
    );
    expect(ce.parse('\\int_0^{2\\pi}\\frac{1}{\\cos x}dx').N().isNaN).toBe(
      true
    );
  });

  test('Residue of an essential family at a non-real regular point is 0', () => {
    expect(
      ce
        .box([
          'Residue',
          ['Exp', ['Divide', 1, 'z']],
          'z',
          ['Exp', ['Multiply', ['Complex', 0, 1], ['Divide', 'Pi', 4]]],
        ])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('a vertex in the middle of a straight edge is accepted', () => {
    const square = (middle: MathJsonExpression): ContourInput => ({
      kind: 'polygon',
      vertices: [
        ['Complex', -1, -1],
        middle,
        ['Complex', 1, -1],
        ['Complex', 1, 1],
        ['Complex', -1, 1],
      ],
    });
    const r = result(inverse, square(['Complex', 0, -1]));
    expect(r.status).toBe('success');
    expect(r.value?.N().im).toBeCloseTo(2 * Math.PI, 12);
    // An edge that turns back on itself is still rejected.
    expect(result(inverse, square(['Complex', 2, -1])).status).toBe(
      'invalid-contour'
    );
  });

  test('a singularity on the path: no value, +∞, or unevaluated', () => {
    // exp(1/z) stays bounded on |z − 1| = 1, which goes through 0: the
    // integral can exist, so it is not reported as having no value.
    expect(
      ce
        .box([
          'ContourIntegrate',
          ['Exp', ['Divide', 1, 'z']],
          'z',
          ['CircleContour', 1, 1],
        ])
        .evaluate().operator
    ).toBe('ContourIntegrate');
    expect(
      ce
        .box(['ContourIntegrate', ['Power', 'x', -2], 'x', ['RealLineContour']])
        .evaluate()
        .toString()
    ).toBe('+oo');
    // A complex integrand that diverges has no complex value.
    expect(
      ce
        .parse('\\int_{-\\infty}^{\\infty}\\frac{i}{x^2}dx')
        .evaluate()
        .toString()
    ).toBe('Indeterminate');
    // A float in the integrand gives NaN, not Indeterminate.
    const pole = (c: number): MathJsonExpression => [
      'ContourIntegrate',
      ['Divide', c, ['Subtract', 'z', 1]],
      'z',
      ['CircleContour', 0, 1],
    ];
    expect(ce.box(pole(1)).evaluate().toString()).toBe('Indeterminate');
    expect(ce.box(pole(1.5)).evaluate().isNaN).toBe(true);
  });

  test('e^(a+ib) has exact Cartesian parts', () => {
    // e^(1+i) ≈ 1.469 + 2.287i: inside |z − (3/2 + 2i)| = 1/2.
    const r = ce.contourIntegrate(ce.parse('\\frac{1}{z-e^{1+i}}'), 'z', {
      kind: 'circle',
      center: ce.parse('3/2+2i'),
      radius: ['Rational', 1, 2],
    });
    expect(r.value?.N().im).toBeCloseTo(2 * Math.PI, 12);
    // ∫ cos(2x + 1)/(x² + 1) dx = π e^(−2) cos 1, in closed form.
    const v = ce
      .parse('\\int_{-\\infty}^{\\infty}\\frac{\\cos(2x+1)}{x^2+1}dx')
      .evaluate();
    expect(v.has('Real')).toBe(false);
    expect(v.N().re).toBeCloseTo(Math.PI * Math.exp(-2) * Math.cos(1), 12);
  });

  test('the variable of CircularIntegrate is not declared in the caller scope', () => {
    const engine = new ComputeEngine();
    engine.parse('\\oint_{|z|=2} \\frac{1}{z} dz').evaluate();
    expect(engine.lookupDefinition('z')).toBeUndefined();
  });

  test('CircularIntegrate reads a Function integrand; a pole on it is NaN under N()', () => {
    expect(
      ce
        .box([
          'CircularIntegrate',
          ['Function', ['Divide', 1, 'z'], 'z'],
          ['Limits', 'z', ['CircleContour', 0, 2], 'Nothing'],
        ])
        .evaluate()
        .N().im
    ).toBeCloseTo(2 * Math.PI, 12);
    expect(
      ce
        .box([
          'ContourIntegrate',
          ['Divide', 1, ['Subtract', 'z', 1]],
          'z',
          ['CircleContour', 0, 1],
        ])
        .N().isNaN
    ).toBe(true);
  });
});
