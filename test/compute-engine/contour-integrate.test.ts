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

describe('Contour integrals read the definitions and values of the caller', () => {
  // The residue method selects a function by its name, and takes `Sin` to be
  // entire. A user definition `Sin := z ↦ 1/z` has a pole at 0: the contour
  // integral is the integral of the body of the user function.
  test('a user function with the name of a library function is integrated through its body', () => {
    const engine = new ComputeEngine();
    engine.declare('Sin', 'function');
    engine.assign('Sin', engine.parse('z \\mapsto 1/z'));
    const circular = engine.expr([
      'CircularIntegrate',
      ['Sin', 'z'],
      ['Limits', 'z', ['CircleContour', 0, 1], 'Nothing'],
    ]);
    expect(circular.evaluate().toString()).toBe('2i * pi');
    expect(circular.N().im).toBeCloseTo(2 * Math.PI, 12);
    expect(
      engine
        .expr(['ContourIntegrate', ['Sin', 'z'], 'z', ['CircleContour', 0, 1]])
        .evaluate()
        .toString()
    ).toBe('2i * pi');
    expect(
      engine.parse('\\oint_{|z|=1} \\sin(z)\\,dz').evaluate().toString()
    ).toBe('2i * pi');
  });

  test('a user function that cannot be inlined stays unevaluated', () => {
    // A user function with an `evaluate` handler has no body to inline.
    const engine = new ComputeEngine();
    engine.declare('Sin', {
      signature: '(number) -> number',
      evaluate: ([t], { engine }) => engine.One.div(t),
    });
    expect(
      engine
        .expr(['ContourIntegrate', ['Sin', 'z'], 'z', ['CircleContour', 0, 1]])
        .evaluate().operator
    ).toBe('ContourIntegrate');
  });

  // A pole on the contour: the integral has no value. It is `NaN` when an
  // operand is a float, also when a symbol holds this float.
  test('an assigned float gives NaN, an assigned exact value Indeterminate', () => {
    const engine = new ComputeEngine();
    const pole: MathJsonExpression = [
      'ContourIntegrate',
      ['Divide', 'a', ['Subtract', 'z', 1]],
      'z',
      ['CircleContour', 0, 1],
    ];
    const circular: MathJsonExpression = [
      'CircularIntegrate',
      ['Divide', 'a', ['Subtract', 'z', 1]],
      ['Limits', 'z', ['CircleContour', 0, 1], 'Nothing'],
    ];
    engine.assign('a', 1.5);
    expect(engine.expr(pole).evaluate().isNaN).toBe(true);
    expect(engine.expr(circular).evaluate().isNaN).toBe(true);
    engine.assign('a', engine.parse('3/2'));
    expect(engine.expr(pole).evaluate().toString()).toBe('Indeterminate');
    expect(engine.expr(circular).evaluate().toString()).toBe('Indeterminate');
  });
});

describe('Contour coordinates and exponents read exactly', () => {
  test('an exact rational exponent whose double is 2 is not an integer', () => {
    // (10^20 + 1)/10^20 is not an integer, but its nearest double is 2. A
    // non-integer power has a branch point at 0: the residue theorem does not
    // apply, and the value is not 0.
    const q: MathJsonExpression = [
      'Rational',
      '200000000000000000001',
      '100000000000000000000',
    ];
    const r = result(['Divide', ['Power', 'z', q], ['Subtract', 'z', 5]]);
    expect(r.status).not.toBe('success');
    expect(r.value).toBeUndefined();
    expect(
      ce
        .box([
          'ContourIntegrate',
          ['Power', 'z', q],
          'z',
          ['CircleContour', 0, 2],
        ])
        .evaluate().operator
    ).toBe('ContourIntegrate');
  });

  test('a float radius is read as the exact rational that it holds', () => {
    // The pole 0 is inside |z| = 1.5 and the pole 2 is outside.
    const r = ce.contourIntegrate(
      ce.parse('\\frac{1}{z}+\\frac{1}{z-2}'),
      'z',
      ce.parse('|z|=1.5')
    );
    expect(r.status).toBe('success');
    expect(r.value?.N().re).toBeCloseTo(0, 12);
    expect(r.value?.N().im).toBeCloseTo(2 * Math.PI, 12);
    // A pole on a float contour gives NaN, as for a float in the integrand.
    expect(
      ce.parse('\\oint_{|z|=1.5} \\frac{1}{z-3/2}\\,dz').evaluate().isNaN
    ).toBe(true);
  });

  test('a float contour coordinate gives a float value', () => {
    for (const v of [
      ce.parse('\\oint_{|z|=1.5} \\frac{1}{z}\\,dz').evaluate(),
      ce.parse('\\oint_{|z|=1.5} \\frac{1}{z}\\,dz').N(),
    ]) {
      expect(v.isNumberLiteral && v.isExact).toBe(false);
      expect(v.re).toBe(0);
      expect(v.im).toBeCloseTo(2 * Math.PI, 12);
    }
  });

  test('a pole nearer to a float contour than its rounding is undetermined', () => {
    // The corner Math.PI + i/2 is about 1.2e-16 from the side x = π. The
    // poles π and π + i/2 can be on the contour that the floats stand for.
    const rectangle: ContourInput = {
      kind: 'rectangle',
      lowerLeft: ['Complex', -0.5, -0.5],
      upperRight: ['Complex', Math.PI, 0.5],
    };
    for (const f of ['\\frac{1}{z-\\pi}', '\\frac{1}{z-\\pi-i/2}']) {
      const r = ce.contourIntegrate(ce.parse(f), 'z', rectangle);
      expect(r.status).toBe('undetermined');
      expect(r.poles[0].location).toBe('undetermined');
    }
    // The pole 3/2 is far from every side, and the pole 4 + i/2 is far from
    // the rectangle although it is on the line of its top side.
    const inside = ce.contourIntegrate(
      ce.parse('\\frac{1}{z-3/2}'),
      'z',
      rectangle
    );
    expect(inside.status).toBe('success');
    expect(inside.value?.im).toBeCloseTo(2 * Math.PI, 12);
    const outside = ce.contourIntegrate(
      ce.parse('\\frac{1}{z-4-i/2}'),
      'z',
      rectangle
    );
    expect(outside.status).toBe('success');
    expect(outside.poles[0].location).toBe('outside');
  });

  test('|a z + b| = r is the circle of center -b/a and radius r/|a|', () => {
    const value = (f: MathJsonExpression, condition: MathJsonExpression) =>
      ce.box(['ContourIntegrate', f, 'z', condition]).evaluate();
    const minus = (r: number): MathJsonExpression => [
      'Equal',
      ['Abs', ['Subtract', 3, 'z']],
      r,
    ];
    // 0 is inside the circle of center 3 and radius 4.
    expect(
      value(inverse, minus(4)).isSame(
        ce.expr(['Multiply', 2, 'Pi', 'ImaginaryUnit'])
      )
    ).toBe(true);
    // 0 is outside the circle of center 3 and radius 2.
    expect(value(inverse, minus(2)).isSame(0)).toBe(true);
    // |2iz − 1| = 2 is the circle of center −i/2 and radius 1, which
    // encloses 0; |2iz − 1| = 1/2 has radius 1/4 and does not.
    const scaled = (r: MathJsonExpression): MathJsonExpression => [
      'Equal',
      ['Abs', ['Subtract', ['Multiply', 2, 'ImaginaryUnit', 'z'], 1]],
      r,
    ];
    expect(value(inverse, scaled(2)).N().im).toBeCloseTo(2 * Math.PI, 12);
    expect(value(inverse, scaled(['Rational', 1, 2])).isSame(0)).toBe(true);
    // The LaTeX spelling gives the same circle.
    expect(
      ce.parse('\\oint_{|3-z|=4} \\frac{1}{z}\\,dz').evaluate().N().im
    ).toBeCloseTo(2 * Math.PI, 12);
  });
});

// The roots of these denominators are square roots of non-real numbers, for
// example the roots of z⁴ + 2z² + 2 are ±√(−1 ± i). Each expected value is
// computed with native floating-point arithmetic, independently of the engine.
describe('Poles at square roots of non-real numbers', () => {
  // The principal square root of 1 + i is a + bi.
  const a = Math.sqrt((Math.SQRT2 + 1) / 2);
  const b = Math.sqrt((Math.SQRT2 - 1) / 2);

  test('the real-line integral of 1/(x⁴+2x²+2) is exact', () => {
    const value = ce
      .parse('\\int_{-\\infty}^{\\infty}\\frac{1}{x^4+2x^2+2}dx')
      .evaluate();
    // The value must stay exact: a number literal here is a float.
    expect(value.isNumberLiteral).toBe(false);
    expect(value.has('Pi')).toBe(true);
    // ∫ dx/(x⁴+2x²+2) = (π/2)·√(√2 − 1). Check the closed form against a
    // trapezoid rule after the substitution x = tan(t).
    const n = 4000;
    let sum = 0;
    for (let k = 1; k < n; k++) {
      const t = -Math.PI / 2 + (k * Math.PI) / n;
      const x = Math.tan(t);
      sum += (1 + x * x) / (x ** 4 + 2 * x * x + 2);
    }
    const quadrature = (sum * Math.PI) / n;
    expect((Math.PI / 2) * Math.sqrt(Math.SQRT2 - 1)).toBeCloseTo(
      quadrature,
      9
    );
    expect(value.N().re).toBeCloseTo(quadrature, 9);
    expect(value.N().re).toBeCloseTo(1.0109554884, 9);
  }, 60_000);

  test('the circle |z| = 2 encloses the four poles of 1/(z⁴+2z²+2)', () => {
    // |z|⁴ = |−1 ± i| = √2, so every pole is inside. The degree of the
    // denominator exceeds the degree of the numerator by 4, so the sum of
    // all the residues is 0.
    const r = result([
      'Divide',
      1,
      ['Add', ['Power', 'z', 4], ['Multiply', 2, ['Power', 'z', 2]], 2],
    ]);
    expect(r.status).toBe('success');
    expect(r.polesComplete).toBe(true);
    expect(r.poles).toHaveLength(4);
    expect(r.poles.every((p) => p.location === 'inside')).toBe(true);
    expect(r.value?.isSame(0)).toBe(true);
  }, 60_000);

  test('a quadratic denominator with a non-real discriminant', () => {
    const f: MathJsonExpression = [
      'Divide',
      1,
      ['Subtract', ['Power', 'z', 2], ['Add', 1, 'ImaginaryUnit']],
    ];
    // Both roots ±(a + bi) are inside |z| = 2, and the degree difference
    // is 2, so the residues cancel.
    const both = result(f);
    expect(both.status).toBe('success');
    expect(both.poles).toHaveLength(2);
    expect(both.value?.isSame(0)).toBe(true);
    // The circle of center 1 and radius 1 encloses only a + bi. The residue
    // there is 1/(2(a + bi)), so the integral is 2πi/(2(a + bi)) =
    // π(b + ai)/√2, because a² + b² = √2.
    const one = result(f, { kind: 'circle', center: 1, radius: 1 });
    expect(one.status).toBe('success');
    expect(one.poles.map((p) => p.location).sort()).toEqual([
      'inside',
      'outside',
    ]);
    const v = one.value!.N();
    expect(v.re).toBeCloseTo((Math.PI * b) / Math.SQRT2, 12);
    expect(v.im).toBeCloseTo((Math.PI * a) / Math.SQRT2, 12);
  }, 30_000);
});

describe('A float in the integrand is read as the exact rational that it holds', () => {
  const value = (latex: string) => ce.parse(latex).evaluate();

  test('a float pole location is classified, and the value is a float', () => {
    // The pole 1.5 is inside |z| = 2: the value is 2πi.
    for (const v of [
      value('\\oint_{|z|=2} \\frac{dz}{z-1.5}'),
      value('\\oint_{|z|=2} \\frac{1}{z-1.5}\\,dz'),
      ce.parse('\\oint_{|z|=2} \\frac{dz}{z-1.5}').N(),
    ]) {
      expect(v.isNumberLiteral && v.isExact).toBe(false);
      expect(v.re).toBe(0);
      expect(v.im).toBeCloseTo(2 * Math.PI, 12);
    }
    // The pole 0.1 is inside |z| = 1.
    const small = value('\\oint_{|z|=1} \\frac{dz}{z-0.1}');
    expect(small.isNumberLiteral && small.isExact).toBe(false);
    expect(small.im).toBeCloseTo(2 * Math.PI, 12);
    // The residue at the pole 0.4 of 1/(2.5z − 1) is 1/2.5.
    expect(value('\\oint_{|z|=2} \\frac{dz}{2.5z-1}').im).toBeCloseTo(
      (2 * Math.PI) / 2.5,
      12
    );
    // A float in the numerator only: the residue at 0 is 0.5.
    const half = value('\\oint_{|z|=2} \\frac{0.5}{z}dz');
    expect(half.isNumberLiteral && half.isExact).toBe(false);
    expect(half.im).toBeCloseTo(Math.PI, 12);
  });

  test('a float pole outside the contour gives 0', () => {
    // The value 0 is the same exact 0 for an exact and a float operand.
    expect(value('\\oint_{|z|=1} \\frac{dz}{z-1.5}').isSame(0)).toBe(true);
    // The poles ±1.5i of 1/(z² + 2.25) are inside |z| = 2, and the sum of
    // their residues is 0.
    expect(value('\\oint_{|z|=2} \\frac{dz}{z^2+2.25}').isSame(0)).toBe(true);
  });

  test('a float pole on the contour gives NaN', () => {
    expect(value('\\oint_{|z|=1.5} \\frac{dz}{z-1.5}').isNaN).toBe(true);
    expect(value('\\oint_{|z|=3/2} \\frac{dz}{z-1.5}').isNaN).toBe(true);
    expect(value('\\oint_{|z|=1.5} \\frac{dz}{z^2+2.25}').isNaN).toBe(true);
  });

  test('a float pole nearer to the contour than its rounding is undetermined', () => {
    // The double 1.0000000000000002 is 1 + 2^-52. Its distance to |z| = 1 is
    // not larger than its rounding.
    const near = ce.contourIntegrate(
      ce.parse('\\frac{1}{z-1.0000000000000002}'),
      'z',
      ce.parse('|z|=1')
    );
    expect(near.status).toBe('undetermined');
    expect(near.poles[0].location).toBe('undetermined');
    expect(
      value('\\oint_{|z|=1} \\frac{dz}{z-1.0000000000000002}').operator
    ).toBe('CircularIntegrate');
    // The pole 1.000001 is far from the contour, compared to its rounding.
    const far = ce.contourIntegrate(
      ce.parse('\\frac{1}{z-1.000001}'),
      'z',
      ce.parse('|z|=1')
    );
    expect(far.status).toBe('success');
    expect(far.poles[0].location).toBe('outside');
  });

  test('the real-line integral of 1/(x² + 2.25) is the float π/1.5', () => {
    const v = value('\\int_{-\\infty}^{\\infty} \\frac{dx}{x^2+2.25}');
    expect(v.isNumberLiteral && v.isExact).toBe(false);
    expect(v.re).toBeCloseTo(Math.PI / 1.5, 12);
  });
});
