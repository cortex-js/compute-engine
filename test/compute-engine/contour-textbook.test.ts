import { ComputeEngine } from '../../src/compute-engine';
import { definiteIntegralByResidues } from '../../src/compute-engine/symbolic/contour-definite-integrate';
import { exactSign } from '../../src/compute-engine/symbolic/contour';
import {
  contourTextbookCases,
  contourTextbookSources,
  type TextbookIntegral,
} from './fixtures/contour-textbook';

const ce = new ComputeEngine();

function verify(entry: TextbookIntegral): void {
  const body = ce.parse(entry.integrand);
  expect(body.isValid).toBe(true);
  const expected = ce.parse(entry.expected).N();
  expect(Number.isFinite(expected.re) && Number.isFinite(expected.im)).toBe(
    true
  );
  let value;
  if (entry.contour) {
    const report = ce.contourIntegrate(body, 'z', entry.contour);
    expect({ status: report.status, reason: report.reason }).toEqual({
      status: 'success',
      reason: undefined,
    });
    expect(report.polesComplete).toBe(true);
    expect(report.residueSum).toBeDefined();
    expect(report.value?.unknowns).toEqual([]);
    expect(
      report.poles.every(
        (p) => p.kind !== 'undetermined' && p.location !== 'undetermined'
      )
    ).toBe(true);
    value = report.value?.N();
  } else {
    const [lower, upper] = entry.bounds!;
    const symbolic = ce
      .expr([
        'Integrate',
        body.json,
        ['Tuple', 'z', ce.parse(lower).json, ce.parse(upper).json],
      ])
      .evaluate();
    // A numerical quadrature fallback is not a solved symbolic textbook case.
    expect(JSON.stringify(symbolic.json)).not.toMatch(
      /"(?:Integrate|NIntegrate|ContourIntegrate)"/
    );
    value = symbolic.N();
  }
  expect(value).toBeDefined();
  const scale = Math.max(1, Math.abs(expected.re), Math.abs(expected.im));
  expect(value!.re / scale).toBeCloseTo(expected.re / scale, 9);
  expect(value!.im / scale).toBeCloseTo(expected.im / scale, 9);
}

describe('Textbook integration corpus', () => {
  test('every fixture has a unique id, provenance, valid math, and one integration domain', () => {
    expect(new Set(contourTextbookCases.map((x) => x.id)).size).toBe(
      contourTextbookCases.length
    );
    for (const entry of contourTextbookCases) {
      expect(contourTextbookSources[entry.source].url).toMatch(/^https:\/\//);
      expect(entry.locator.length).toBeGreaterThan(0);
      expect(Boolean(entry.contour) !== Boolean(entry.bounds)).toBe(true);
      expect(ce.parse(entry.integrand).isValid).toBe(true);
      expect(ce.parse(entry.expected).isValid).toBe(true);
    }
  });
  for (const entry of contourTextbookCases) {
    const run =
      entry.gap && process.env.CE_CONTOUR_TEXTBOOK_STRICT !== '1'
        ? test.skip
        : test;
    run(
      `${entry.id}: ${entry.family}${entry.gap ? ` [GAP: ${entry.gap}]` : ''}`,
      () => verify(entry)
    );
  }
});

describe('Textbook reductions: convergence and domain safeguards', () => {
  const reduce = (f: string, lo: string, hi: string, engine = ce) =>
    definiteIntegralByResidues(
      engine.parse(f),
      'z',
      engine.parse(lo),
      engine.parse(hi)
    );

  test.each([
    ['\\frac{\\sin z}{z^2+1}', '0', '\\infty'],
    ['\\frac{z}{z^2+1}', '0', '\\infty'],
    ['\\frac{\\sin z}{2+\\cos z}', '0', '\\pi'],
    ['\\frac{1}{2+\\cos z}', '0', '\\pi/2'],
    ['\\frac{1}{2+\\cos(2z)}', '0', '2\\pi'],
    ['\\sqrt{2+\\cos z}', '0', '2\\pi'],
    ['\\frac{1}{a+\\cos z}', '0', '2\\pi'],
  ])('does not apply an unproved reduction to %s on [%s, %s]', (f, lo, hi) => {
    expect(reduce(f, lo, hi)).toBeUndefined();
  });

  test.each([
    '\\frac{1}{1+\\cos z}',
    '\\frac{1}{1-\\cos z}',
    '\\frac{1}{\\cos z}',
  ])(
    'a pole on a periodic integration path is not a finite answer: %s',
    (f) => {
      expect(reduce(f, '0', '2\\pi')?.isNaN).toBe(true);
    }
  );

  test.each([
    ['0', '\\infty', 1],
    ['\\infty', '0', -1],
    ['-\\infty', '0', 1],
    ['0', '-\\infty', -1],
  ] as const)('half-line orientation [%s, %s]', (lo, hi, direction) => {
    expect(reduce('\\frac{\\cos z}{z^2+1}', lo, hi)?.N().re).toBeCloseTo(
      (direction * Math.PI) / (2 * Math.E),
      10
    );
  });

  test('reversing full and half periods negates the value', () => {
    for (const end of ['\\pi', '2\\pi']) {
      const forward = reduce('\\frac{1}{5-4\\cos z}', '0', end)!.N();
      const reverse = reduce('\\frac{1}{5-4\\cos z}', end, '0')!.N();
      expect(reverse.re).toBeCloseTo(-forward.re, 11);
    }
  });

  test('an assigned integration variable cannot alter a periodic reduction', () => {
    const engine = new ComputeEngine();
    engine.assign('z', 7);
    expect(
      reduce('\\frac{1}{5-4\\cos z}', '0', '2\\pi', engine)?.N().re
    ).toBeCloseTo((2 * Math.PI) / 3, 11);
    expect(engine.expr('z').evaluate().re).toBe(7);
  });

  test('radian formulas are not applied in degree mode', () => {
    const engine = new ComputeEngine();
    engine.angularUnit = 'deg';
    expect(
      reduce('\\frac{1}{5-4\\cos z}', '0', '2\\pi', engine)
    ).toBeUndefined();
  });

  test.each([
    ['2-\\sqrt{3}', 1],
    ['\\sqrt{3}-2', -1],
    ['1-\\sqrt{3}', -1],
    ['\\sqrt{3}-1', 1],
    ['6-4\\sqrt{3}', -1],
    ['4\\sqrt{3}-6', 1],
    ['2+\\sqrt{3}', 1],
    ['-2-\\sqrt{3}', -1],
  ] as const)('certified radical sign: %s', (expression, sign) => {
    expect(exactSign(ce.parse(expression))).toBe(sign);
  });

  test('transcendental comparisons use separating resolver bounds', () => {
    expect(exactSign(ce.parse('\\pi-3'))).toBe(1);
    expect(exactSign(ce.parse('\\pi^2/16-1'))).toBe(-1);
    expect(exactSign(ce.number(3.141592653589793))).toBeUndefined();
  });

  for (const entry of contourTextbookCases.filter((x) => x.gap && x.contour)) {
    test(`${entry.id}: an unresolved contour returns no fabricated value`, () => {
      const report = ce.contourIntegrate(
        ce.parse(entry.integrand),
        'z',
        entry.contour!
      );
      expect(['unsupported', 'undetermined']).toContain(report.status);
      expect(report.value).toBeUndefined();
      expect(report.residueSum).toBeUndefined();
    });
  }
});

describe('Independent numerical checks (native arithmetic, no engine quadrature)', () => {
  test.each([['\\frac{1}{2+\\sin z}', (2 * Math.PI) / Math.sqrt(3)]] as const)(
    'periodic substitution agrees on symbolic and direct numeric routes: %s',
    (f, expected) => {
      const expression = ce.expr([
        'Integrate',
        ce.parse(f).json,
        ['Tuple', 'z', 0, ['Multiply', 2, 'Pi']],
      ]);
      const symbolic = expression.evaluate();
      expect(JSON.stringify(symbolic.json)).not.toContain('Integrate');
      expect(symbolic.N().re).toBeCloseTo(expected, 10);
      expect(expression.N().re).toBeCloseTo(expected, 10);
    }
  );

  test.each([2, 3, 4])('Poisson-kernel period, parameter %s', (a) => {
    const panels = 4096;
    let sum = 0;
    for (let k = 0; k < panels; k++) {
      const theta = ((k + 0.5) * 2 * Math.PI) / panels;
      sum += 1 / (1 + a * a - 2 * a * Math.cos(theta));
    }
    const numeric = (sum * 2 * Math.PI) / panels;
    const symbolic = definiteIntegralByResidues(
      ce.parse(`\\frac{1}{${1 + a * a}-${2 * a}\\cos z}`),
      'z',
      ce.Zero,
      ce.expr(['Multiply', 2, 'Pi'])
    )!;
    expect(symbolic.N().re).toBeCloseTo(numeric, 10);
  });

  test.each([1, 2, 3])('full-line rational integral, scale %s', (b) => {
    // x = tan(t) maps R to (-π/2, π/2). The transformed integrand is
    // continuous with zero endpoint limits; midpoint quadrature is stable.
    const panels = 8192;
    let sum = 0;
    for (let k = 0; k < panels; k++) {
      const t = -Math.PI / 2 + ((k + 0.5) * Math.PI) / panels;
      sum += 1 / ((Math.tan(t) ** 2 + b * b) ** 2 * Math.cos(t) ** 2);
    }
    const numeric = (sum * Math.PI) / panels;
    const report = ce.contourIntegrate(
      ce.parse(`\\frac{1}{(z^2+${b * b})^2}`),
      'z',
      { kind: 'real-line' }
    );
    expect(report.value?.N().re).toBeCloseTo(numeric, 10);
  });
});
