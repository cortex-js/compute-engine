/**
 * DirichletEta η(s) = (1 − 2^{1−s}) ζ(s) and DirichletBeta
 * β(s) = 4^{−s} (ζ(s, 1/4) − ζ(s, 3/4)): closed forms at the integers,
 * `ce.precision` digits at real s (also next to the pole of ζ at s = 1),
 * doubles at complex s.
 *
 * Reference values are mpmath's: `mp.dps = 40; altzeta(s)` and
 * `dirichlet(s, [0, 1, 0, -1])`.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** The digits of a numeric result, as a string. */
function digits(expr: any): string {
  return String(expr.bignumRe ?? expr.re);
}

const exactCases: [string, any, any][] = [
  ['DirichletEta(1) = ln 2', ['DirichletEta', 1], ['Ln', 2]],
  [
    'DirichletEta(2) = π²/12',
    ['DirichletEta', 2],
    ['Multiply', ['Rational', 1, 12], ['Power', 'Pi', 2]],
  ],
  [
    'DirichletEta(4) = 7π⁴/720',
    ['DirichletEta', 4],
    ['Multiply', ['Rational', 7, 720], ['Power', 'Pi', 4]],
  ],
  ['DirichletEta(0) = 1/2', ['DirichletEta', 0], ['Rational', 1, 2]],
  ['DirichletEta(-1) = 1/4', ['DirichletEta', -1], ['Rational', 1, 4]],
  ['DirichletEta(-2) = 0', ['DirichletEta', -2], 0],
  ['DirichletEta(-3) = -1/8', ['DirichletEta', -3], ['Rational', -1, 8]],
  [
    'DirichletEta(3) = 3/4 ζ(3)',
    ['DirichletEta', 3],
    ['Multiply', ['Rational', 3, 4], ['Zeta', 3]],
  ],
  [
    'DirichletBeta(1) = π/4',
    ['DirichletBeta', 1],
    ['Multiply', ['Rational', 1, 4], 'Pi'],
  ],
  ['DirichletBeta(2) = G', ['DirichletBeta', 2], 'CatalanConstant'],
  [
    'DirichletBeta(3) = π³/32',
    ['DirichletBeta', 3],
    ['Multiply', ['Rational', 1, 32], ['Power', 'Pi', 3]],
  ],
  [
    'DirichletBeta(5) = 5π⁵/1536',
    ['DirichletBeta', 5],
    ['Multiply', ['Rational', 5, 1536], ['Power', 'Pi', 5]],
  ],
  [
    'DirichletBeta(7) = 61π⁷/184320',
    ['DirichletBeta', 7],
    ['Multiply', ['Rational', 61, 184320], ['Power', 'Pi', 7]],
  ],
  ['DirichletBeta(0) = 1/2', ['DirichletBeta', 0], ['Rational', 1, 2]],
  ['DirichletBeta(-1) = 0', ['DirichletBeta', -1], 0],
  ['DirichletBeta(-2) = -1/2', ['DirichletBeta', -2], ['Rational', -1, 2]],
  ['DirichletBeta(-3) = 0', ['DirichletBeta', -3], 0],
  ['DirichletBeta(-4) = 5/2', ['DirichletBeta', -4], ['Rational', 5, 2]],
  ['DirichletBeta(-6) = -61/2', ['DirichletBeta', -6], ['Rational', -61, 2]],
];

describe('DirichletEta and DirichletBeta: exact values (evaluate)', () => {
  for (const [name, input, expected] of exactCases)
    test(`${name}`, () => {
      expect(ce.box(input).evaluate().isSame(ce.box(expected).evaluate())).toBe(
        true
      );
    });
});

test('Exact non-integer and symbolic arguments stay symbolic', () => {
  expect(
    ce
      .box(['DirichletEta', ['Rational', 1, 2]])
      .evaluate()
      .toString()
  ).toBe('DirichletEta(1/2)');
  expect(ce.box(['DirichletBeta', 's']).evaluate().toString()).toBe(
    'DirichletBeta(s)'
  );
  expect(ce.box(['DirichletBeta', 4]).evaluate().toString()).toBe(
    'DirichletBeta(4)'
  );
});

// [head, s, mpmath value to 19 significant digits]
const realCases: [string, any, string][] = [
  ['DirichletEta', 0.5, '0.6048986434216303702'],
  ['DirichletEta', 1.5, '0.7651470246254079453'],
  ['DirichletEta', 3.5, '0.9275535777739480351'],
  ['DirichletEta', 1.01, '0.6947426025442116979'],
  ['DirichletEta', 0.9, '0.6768319352845405097'],
  ['DirichletEta', 1.000001, '0.6931473404288163655'],
  ['DirichletEta', -7.5, '-1.180249705900827552'],
  ['DirichletEta', -0.25, '0.4417145826359048377'],
  ['DirichletBeta', 0.5, '0.6676914571896091766'],
  ['DirichletBeta', 1.5, '0.8645026534612020403'],
  ['DirichletBeta', 2.5, '0.9486221740370547074'],
  ['DirichletBeta', 3.5, '0.9814025112714405620'],
  ['DirichletBeta', 1.01, '0.7873194852869739501'],
  ['DirichletBeta', 0.9, '0.7653214567558726156'],
  ['DirichletBeta', 1.000001, '0.7853983562986880356'],
  ['DirichletBeta', -7.5, '213.6103918509395690'],
  ['DirichletBeta', -0.25, '0.3947913972561681456'],
];

describe('DirichletEta and DirichletBeta: real s at ce.precision (N)', () => {
  for (const [head, s, expected] of realCases) {
    test(`${head}(${s}) = ${expected}… (21 digits)`, () => {
      const got = digits(ce.box([head, s]).evaluate());
      expect(got.startsWith(expected)).toBe(true);
      const viaN = digits(ce.box([head, s]).N());
      expect(viaN.startsWith(expected)).toBe(true);
    });
  }

  test('the answer follows ce.precision (η(1/2), 40 digits)', () => {
    ce.precision = 40;
    try {
      expect(
        digits(ce.box(['DirichletEta', ['Rational', 1, 2]]).N()).startsWith(
          '0.60489864342163037024726591423595549975'
        )
      ).toBe(true);
      expect(
        digits(ce.box(['DirichletBeta', ['Rational', 1, 2]]).N()).startsWith(
          '0.66769145718960917665869092930024848225'
        )
      ).toBe(true);
    } finally {
      ce.precision = 21;
    }
  });

  test('next to the pole of ζ, η(1 + 1e-30) and β(1 + 1e-12) keep every digit', () => {
    ce.precision = 40;
    try {
      const s = ce.box(['Add', 1, ['Power', 10, -30]]);
      expect(digits(ce.function('DirichletEta', [s]).N()).slice(0, 38)).toBe(
        '0.693147180559945309417232121458336436979'.slice(0, 38)
      );
      // The Hurwitz kernel behind β reaches about 1e-15 from the pole.
      const near = ce.box(['Add', 1, ['Power', 10, -12]]);
      expect(
        digits(ce.function('DirichletBeta', [near]).N()).slice(0, 36)
      ).toBe('0.785398163397641210932457681178376696'.slice(0, 36));
    } finally {
      ce.precision = 21;
    }
  });

  test('a float integer argument gives a float: N(η(2)) and β(2.0)', () => {
    expect(
      digits(ce.box(['DirichletEta', 2]).N()).startsWith('0.82246703342411321')
    ).toBe(true);
    const beta = ce.box(['DirichletBeta', 2.0]).evaluate();
    expect(digits(beta).startsWith('0.9159655941772190')).toBe(true);
  });
});

// [head, re, im, mpmath re, mpmath im]
const complexCases: [string, number, number, number, number][] = [
  ['DirichletEta', 3.5, 2.5, 1.0001097278046977, 0.07812891204148317],
  ['DirichletEta', 0.5, 14, 0.012220891770754763, -0.2522997666528998],
  ['DirichletEta', 1.1, 0.1, 0.7091306411732487, 0.015336310418436755],
  ['DirichletEta', 1, 0.2, 0.6944558307227737, 0.03196116344391456],
  ['DirichletEta', -2.5, 3, -0.8762877358103718, 1.5516580710969513],
  ['DirichletBeta', 3.5, 2.5, 1.0174803365003783, 0.010163562117824784],
  ['DirichletBeta', 0.5, 14, 1.5371154384403174, 1.3434514268677572],
  ['DirichletBeta', 1.1, 0.1, 0.8046569333808612, 0.01778036753269065],
  ['DirichletBeta', 1, 0.2, 0.7884800279101568, 0.03845353414868641],
  ['DirichletBeta', -2.5, 3, -0.13038752346393924, 10.492039743468252],
];

describe('DirichletEta and DirichletBeta: complex s (doubles)', () => {
  for (const [head, re, im, er, ei] of complexCases)
    test(`${head}(${re} + ${im}i) = ${er} + ${ei}i`, () => {
      const v: any = ce.box([head, ['Complex', re, im]]).N();
      expect(Math.abs(v.re - er)).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(er))
      );
      expect(Math.abs(v.im - ei)).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(ei))
      );
    });
});

test('Threads over a list', () => {
  const quarterPi = ce.box(['Multiply', ['Rational', 1, 4], 'Pi']).toString();
  expect(
    ce
      .box(['DirichletBeta', ['List', 1, -1]])
      .evaluate()
      .toString()
  ).toBe(`[${quarterPi},0]`);
});
