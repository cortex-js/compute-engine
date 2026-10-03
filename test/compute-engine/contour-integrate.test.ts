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
    expect(
      ce
        .expr([
          'Integrate',
          ['Power', 'x', -2],
          ['Tuple', 'x', 'NegativeInfinity', 'PositiveInfinity'],
        ])
        .evaluate().isNaN
    ).toBe(true);
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
