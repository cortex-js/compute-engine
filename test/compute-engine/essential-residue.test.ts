import { ComputeEngine } from '../../src/compute-engine';
import { laurentData } from '../../src/compute-engine/symbolic/series';

const ce = new ComputeEngine();
const residue = (f: string, point = '0') =>
  ce.expr(['Residue', ce.parse(f), 'z', ce.parse(point)]).evaluate();

describe('Essential residues through the shared Residue operator', () => {
  test.each([
    ['e^{2/z}', '0', '2'],
    ['z^2 e^{1/z}', '0', '1/6'],
    ['(3z^2+2z+1)e^{2/z}', '0', '10'],
    ['(z-2)^2 e^{3/(z-2)}', '2', '9/2'],
    ['z^2 e^{1/(z-2)}', '2', '37/6'],
    ['e^{1/(2z-4)}', '2', '1/2'],
    ['(1-z)e^{2/z}', '0', '0'],
    ['z^2 e^{i/z}', '0', '-i/6'],
    ['e^{1/(z-i)}', 'i', '1'],
    ['e^{1/(z-\\pi)}', '\\pi', '1'],
    ['e^{2/z}/3', '0', '2/3'],
    ['e^{-2/z}', '0', '-2'],
    ['-e^{1/z}', '0', '-1'],
  ])('%s at %s has coefficient %s', (f, point, expected) => {
    const value = residue(f, point);
    expect(value.has('Residue')).toBe(false);
    expect(value.sub(ce.parse(expected)).simplify().isSame(0)).toBe(true);
  });

  test('Exp and exact numerical evaluation share the same extraction', () => {
    const expr = ce.expr(['Residue', ['Exp', ['Divide', 2, 'z']], 'z', 0]);
    expect(expr.evaluate().isSame(2)).toBe(true);
    expect(expr.N().re).toBe(2);
  });

  test('the recognized family is analytic away from its centre', () => {
    expect(residue('z^2 e^{1/z}', '2').isSame(0)).toBe(true);
  });

  test('zero exponential coefficient and zero prefactor are not essential', () => {
    expect(residue('z^2 e^{0/z}').isSame(0)).toBe(true);
    expect(residue('0 e^{1/z}').isSame(0)).toBe(true);
  });

  test.each([
    'e^{1/z^2}',
    'e^{-1/z^2}',
    '\\sin(z)e^{1/z}',
    'e^{1/z}/(1-z)',
    'e^{z+1/z}',
    'z^{65}e^{1/z}',
    'e^{1/z}+e^{-1/z}',
  ])('unsupported coefficient problems stay symbolic: %s', (f) => {
    expect(residue(f).has('Residue')).toBe(true);
  });

  test('essential data does not pretend to have a finite Laurent valuation', () => {
    expect(laurentData(ce.parse('e^{2/z}'), 'z', ce.Zero, ce, 4)).toBeNull();
  });

  test('unsupported real-axis decay at an algebraic centre stays unresolved', () => {
    expect(
      residue('e^{-1/(z-\\sqrt{2}-\\sqrt{3})^2}', '\\sqrt{2}+\\sqrt{3}').has(
        'Residue'
      )
    ).toBe(true);
  });
});

describe('Essential singularities in contour integration', () => {
  test('the zero prefactor removes even a boundary singularity', () => {
    const report = ce.contourIntegrate(ce.parse('0 e^{1/z}'), 'z', {
      kind: 'circle',
      center: 1,
      radius: 1,
    });
    expect(report.status).toBe('success');
    expect(report.poles.every((p) => p.kind === 'removable')).toBe(true);
    expect(report.value?.isSame(0)).toBe(true);
  });

  test('native contour quadrature independently checks the essential contribution', () => {
    const panels = 2048;
    let re = 0;
    let im = 0;
    for (let k = 0; k < panels; k++) {
      const t = ((k + 0.5) * 2 * Math.PI) / panels;
      const amplitude = Math.exp(2 * Math.cos(t));
      const phase = -2 * Math.sin(t);
      re +=
        amplitude *
        (-Math.cos(phase) * Math.sin(t) - Math.sin(phase) * Math.cos(t));
      im +=
        amplitude *
        (Math.cos(phase) * Math.cos(t) - Math.sin(phase) * Math.sin(t));
    }
    const value = ce
      .contourIntegrate(ce.parse('e^{2/z}'), 'z', {
        kind: 'circle',
        center: 0,
        radius: 1,
      })
      .value?.N();
    expect(value?.re).toBeCloseTo((re * 2 * Math.PI) / panels, 10);
    expect(value?.im).toBeCloseTo((im * 2 * Math.PI) / panels, 10);
  });

  test('an enclosed essential singularity exposes its residue without pole order', () => {
    const report = ce.contourIntegrate(ce.parse('z^2 e^{1/z}'), 'z', {
      kind: 'circle',
      center: 0,
      radius: 1,
    });
    expect(report.status).toBe('success');
    expect(report.polesComplete).toBe(true);
    expect(report.poleScope).toBe('global');
    expect(report.poles).toHaveLength(1);
    expect(report.poles[0]).toMatchObject({
      kind: 'essential',
      location: 'inside',
      enclosed: true,
    });
    expect(report.poles[0].order).toBeUndefined();
    expect(report.residueSum?.isSame(ce.number([1, 6]))).toBe(true);
    expect(report.value?.N().im).toBeCloseTo(Math.PI / 3, 11);
  });

  test('an excluded essential singularity contributes nothing', () => {
    const report = ce.contourIntegrate(ce.parse('e^{2/z}'), 'z', {
      kind: 'circle',
      center: 3,
      radius: 1,
    });
    expect(report.status).toBe('success');
    expect(report.poles[0].location).toBe('outside');
    expect(report.poles[0].kind).toBe('essential');
    expect(report.value?.isSame(0)).toBe(true);
  });

  test.each(['e^{2/z}', '(1-z)e^{2/z}'])(
    'a boundary essential singularity blocks %s',
    (f) => {
      const report = ce.contourIntegrate(ce.parse(f), 'z', {
        kind: 'circle',
        center: 1,
        radius: 1,
      });
      expect(report.status).toBe('pole-on-contour');
      expect(report.poles[0].kind).toBe('essential');
      expect(report.poles[0].location).toBe('boundary');
      expect(report.poles[0].order).toBeUndefined();
      expect(report.value).toBeUndefined();
      expect(report.residueSum).toBeUndefined();
      // On |z − 1| = 1 the real part of 1/z is 1/2, so the integrand stays
      // bounded next to 0 and the integral can exist: the operator stays
      // unevaluated instead of reporting that the integral has no value.
      expect(
        ce
          .expr(['ContourIntegrate', ce.parse(f), 'z', ['CircleContour', 1, 1]])
          .evaluate().operator
      ).toBe('ContourIntegrate');
    }
  );

  test('clockwise traversal reverses the essential contribution', () => {
    const report = ce.contourIntegrate(ce.parse('e^{2/z}'), 'z', {
      kind: 'rectangle',
      lowerLeft: ce.parse('-1-i'),
      upperRight: ce.parse('1+i'),
      orientation: 'clockwise',
    });
    expect(report.status).toBe('success');
    expect(report.value?.N().im).toBeCloseTo(-4 * Math.PI, 11);
  });

  test.each(['e^{-1/z^2}', '\\sin(z)e^{1/z}', 'e^{1/z}/(1-z)', 'e^{c/z}'])(
    'unsupported families do not produce partial contour sums: %s',
    (f) => {
      const report = ce.contourIntegrate(ce.parse(f), 'z', {
        kind: 'circle',
        center: 0,
        radius: 2,
      });
      expect(report.status).toBe('unsupported');
      expect(report.polesComplete).toBe(false);
      expect(report.value).toBeUndefined();
      expect(report.residueSum).toBeUndefined();
    }
  );
});
