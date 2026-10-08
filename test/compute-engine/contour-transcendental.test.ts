import { ComputeEngine } from '../../src/compute-engine';
import type { ContourInput } from '../../src/compute-engine';
import { exactSign } from '../../src/compute-engine/symbolic/contour';

const ce = new ComputeEngine();
const circle = (radius: string, center = '0'): ContourInput => ({
  kind: 'circle',
  radius: ce.parse(radius),
  center: ce.parse(center),
});
const integrate = (f: string, contour: ContourInput) =>
  ce.contourIntegrate(ce.parse(f), 'z', contour);

describe('Resolver-backed contour geometry', () => {
  test.each([
    ['1', 'success', 'inside'],
    ['1/2', 'success', 'outside'],
    ['\\pi/4', 'pole-on-contour', 'boundary'],
  ])('the pole pi/4 relative to radius %s', (r, status, location) => {
    const report = integrate('1/(z-\\pi/4)', circle(r));
    expect(report.status).toBe(status);
    expect(report.poleScope).toBe('global');
    expect(report.poles[0].location).toBe(location);
    expect(report.poles[0].point.isSame(ce.Pi.div(4))).toBe(true);
    if (location === 'boundary') expect(report.value).toBeUndefined();
  });

  test('symbolic complex coordinates retain exact real and imaginary parts', () => {
    const report = integrate('1/(z-\\pi/4-i\\pi/4)', circle('2'));
    expect(report.status).toBe('success');
    expect(report.poles[0].location).toBe('inside');
    expect(report.value?.N().im).toBeCloseTo(2 * Math.PI, 11);
  });

  test.each(['-', '+'])(
    'distances below ordinary tolerance remain distinct: %s',
    (op) => {
      const report = integrate('1/(z-\\pi)', circle(`\\pi${op}10^{-30}`));
      expect(report.status).toBe('success');
      expect(report.poles[0].location).toBe(op === '+' ? 'inside' : 'outside');
    }
  );

  test('overlapping bounds at the precision limit never imply a boundary', () => {
    const distance = ce.parse('\\sqrt{\\pi^2+10^{-150}}-\\pi');
    expect(exactSign(distance)).toBeUndefined();
    expect(
      integrate('1/z', { kind: 'circle', center: 0, radius: distance }).status
    ).toBe('unsupported');
    const report = integrate('1/(z-\\sqrt{\\pi^2+10^{-150}})', circle('\\pi'));
    // Squaring may prove the tiny positive difference exactly. Either an
    // exact exclusion or an undecided result is safe; a boundary is not.
    expect(['outside', 'undetermined']).toContain(report.poles[0].location);
    expect(report.status).not.toBe('pole-on-contour');
  });

  test('a rectangle classifies a transcendental boundary pole exactly', () => {
    const report = integrate('1/(z-\\pi)', {
      kind: 'rectangle',
      lowerLeft: ce.parse('-i'),
      upperRight: ce.parse('\\pi+i'),
    });
    expect(report.status).toBe('pole-on-contour');
    expect(report.poles[0].location).toBe('boundary');
  });

  test('inexact coordinates are not upgraded to symbolic evidence', () => {
    // A float coordinate is read as the exact value that it holds. A pole far
    // from the contour is classified, and the value is a float.
    const far = integrate('1/z', {
      kind: 'circle',
      center: 0,
      radius: Math.PI,
    });
    expect(far.status).toBe('success');
    expect(far.value?.isNumberLiteral && far.value.isExact).toBe(false);
    expect(far.value?.im).toBeCloseTo(2 * Math.PI, 12);
    // The double Math.PI is about 1.2e-16 less than π. The float can stand
    // for π, which puts the pole π on the contour: the pole is neither
    // inside nor outside, and it is not proved to be on the contour.
    const near = integrate('1/(z-\\pi)', {
      kind: 'circle',
      center: 0,
      radius: Math.PI,
    });
    expect(near.status).not.toBe('success');
    expect(near.status).not.toBe('pole-on-contour');
    expect(near.poles[0].location).toBe('undetermined');
    expect(near.value).toBeUndefined();
  });
});

describe('Exact trigonometric pole families', () => {
  test('products merge coincident zeros without losing the pole order', () => {
    const report = integrate('1/(\\sin(z)\\sin(2z))', circle('2'));
    expect(report.status).toBe('success');
    const origin = report.poles.filter((p) => p.point.isSame(0));
    expect(origin).toHaveLength(1);
    expect(origin[0].order).toBe(2);
    expect(origin[0].residue?.isSame(0)).toBe(true);
    expect(report.poles.filter((p) => p.location === 'inside')).toHaveLength(3);
    expect(report.value?.isSame(0)).toBe(true);
  });

  test('a third-order pole at a remote symbolic point has a nonzero residue', () => {
    const report = integrate('1/\\sin^3(z-10\\pi)', circle('1', '10\\pi'));
    expect(report.status).toBe('success');
    const inside = report.poles.filter((p) => p.location === 'inside');
    expect(inside).toHaveLength(1);
    expect(inside[0].order).toBe(3);
    expect(inside[0].residue?.isSame(ce.Half)).toBe(true);
    expect(report.value?.N().im).toBeCloseTo(Math.PI, 11);
  });

  test('all relevant sine poles are enumerated, including excluded neighbours', () => {
    const report = integrate('1/\\sin(z)', circle('4'));
    expect(report.status).toBe('success');
    expect(report.poleScope).toBe('contour');
    expect(report.polesComplete).toBe(true);
    const inside = report.poles.filter((p) => p.location === 'inside');
    expect(inside).toHaveLength(3);
    expect(inside.map((p) => p.residue?.N().re)).toEqual([-1, 1, -1]);
    expect(report.poles.some((p) => p.location === 'outside')).toBe(true);
    expect(report.value?.N().im).toBeCloseTo(-2 * Math.PI, 11);
  });

  test('a remote translated family is enumerated around the contour, not zero', () => {
    const report = integrate('1/\\sin(z-10\\pi)', circle('1', '10\\pi'));
    expect(report.status).toBe('success');
    const inside = report.poles.filter((p) => p.location === 'inside');
    expect(inside).toHaveLength(1);
    expect(inside[0].point.isSame(ce.Pi.mul(10))).toBe(true);
    expect(report.value?.N().im).toBeCloseTo(2 * Math.PI, 11);
  });

  test('negative slopes and phase offsets preserve cosine residues', () => {
    const report = integrate('1/\\cos(-2z+\\pi/2)', circle('1'));
    expect(report.status).toBe('success');
    expect(report.poles.filter((p) => p.location === 'inside')).toHaveLength(1);
    expect(report.value?.N().im).toBeCloseTo(Math.PI, 11);
  });

  test('a circle off the real axis has no enclosed trig poles', () => {
    const report = integrate('1/\\sin(z)', circle('1', '2i'));
    expect(report.status).toBe('success');
    expect(report.value?.isSame(0)).toBe(true);
    expect(report.poles.every((p) => p.location === 'outside')).toBe(true);
  });

  test('clockwise polygon orientation negates the enclosed residue sum', () => {
    const report = integrate('1/\\sin(z)', {
      kind: 'polygon',
      vertices: [
        ce.parse('-4-i'),
        ce.parse('-4+i'),
        ce.parse('4+i'),
        ce.parse('4-i'),
      ],
    });
    expect(report.status).toBe('success');
    expect(report.value?.N().im).toBeCloseTo(2 * Math.PI, 11);
  });

  test('repeated trig poles with zero residues still obstruct the contour', () => {
    const report = integrate('1/\\sin^2(z)', circle('\\pi'));
    expect(report.status).toBe('pole-on-contour');
    const boundary = report.poles.filter((p) => p.location === 'boundary');
    expect(boundary).toHaveLength(2);
    expect(
      boundary.every(
        (p) => p.kind === 'pole' && p.order === 2 && p.residue?.isSame(0)
      )
    ).toBe(true);
    expect(report.value).toBeUndefined();
  });

  test('a cancelled boundary zero is removable', () => {
    const report = integrate('\\sin(z)/(z-\\pi)', circle('\\pi'));
    expect(report.status).toBe('success');
    expect(report.poles[0].kind).toBe('removable');
    expect(report.value?.isSame(0)).toBe(true);
  });

  test.each(['1/\\sin(z^2)', '1/(1+\\sin(z))', '1/\\sin(z+i)'])(
    'unsupported zero families never imply completeness: %s',
    (f) => {
      const report = integrate(f, circle('2'));
      expect(report.status).toBe('unsupported');
      expect(report.polesComplete).toBe(false);
      expect(report.value).toBeUndefined();
    }
  );

  test('exceeding the enumeration budget yields no partial integral', () => {
    const report = integrate('1/\\sin(z)', circle('1000'));
    expect(report.status).toBe('unsupported');
    expect(report.polesComplete).toBe(false);
    expect(report.residueSum).toBeUndefined();
    expect(report.value).toBeUndefined();
  });

  test('degree mode does not use radian pole lattices', () => {
    const engine = new ComputeEngine();
    engine.angularUnit = 'deg';
    const report = engine.contourIntegrate(['Divide', 1, ['Sin', 'z']], 'z', {
      kind: 'circle',
      center: 0,
      radius: 1,
    });
    expect(report.status).toBe('unsupported');
  });
});
