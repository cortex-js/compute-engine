import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { betaRegularized } from '../../src/compute-engine/numerics/special-functions';
import type { Expression } from '../../src/compute-engine/global-types';

// BetaRegularized outside [0, 1], Beta at a complex operand and Digamma at a
// complex operand against mpmath 1.3.0 (`betainc(a, b, 0, x, regularized=True)`,
// `beta`, `digamma`), with the operands read as decimal literals. Measured
// over a larger grid than the tables below:
//   BetaRegularized outside [0, 1]: within 3 digits of the precision asked
//     at 30, 50 and 100 digits
//   Beta at a complex operand: 6.8e-14 relative at worst (36 points, |Im| up
//     to 60), the error of exp(lnΓ(a) + lnΓ(b) − lnΓ(a + b)) at |lnΓ| ~ 100
//   Digamma at a complex operand: 2.0e-14 relative at worst (64 points,
//     |Im| up to 400), near a zero of ψ

type Row = [x: string, a: string, b: string, expected: Record<number, string>];

// [x, a, b, I_x(a, b) at 30, 50 and 100 digits]
const outside: Row[] = [
  ['2', '2', '3', { 30: '8.0', 50: '8.0', 100: '8.0' }],
  ['3', '2', '3', { 30: '81.0', 50: '81.0', 100: '81.0' }],
  ['-0.5', '2', '2', { 30: '1.0', 50: '1.0', 100: '1.0' }],
  ['2.5', '2', '3', { 30: '29.6875', 50: '29.6875', 100: '29.6875' }],
  [
    '-3.25',
    '3',
    '4',
    {
      30: '-30544.52197265625',
      50: '-30544.52197265625',
      100: '-30544.52197265625',
    },
  ],
  ['1.5', '1', '5', { 30: '1.03125', 50: '1.03125', 100: '1.03125' }],
  ['7', '4', '1', { 30: '2401.0', 50: '2401.0', 100: '2401.0' }],
  [
    '2',
    '2.5',
    '3',
    {
      30: '16.263455967290593061219420328411528',
      50: '16.26345596729059306121942032841152790355122656683490284',
      100: '16.2634559672905930612194203284115279035512265668349028415318169868934235023142309467794566447678780864527',
    },
  ],
  [
    '1.7',
    '0.3',
    '4',
    {
      30: '0.97823249259124000455051039931653873',
      50: '0.978232492591240004550510399316538728157502786044314084',
      100: '0.97823249259124000455051039931653872815750278604431408401123123578624925102534788043682575951604292017893',
    },
  ],
  [
    '40',
    '0.75',
    '12',
    {
      30: '-2186271730021852532.2504823944857039',
      50: '-2186271730021852532.25048239448570390758781798467514674',
      100: '-2186271730021852532.25048239448570390758781798467514674012600999672258605563941981289230876913383279964098',
    },
  ],
  [
    '1.0000001',
    '5',
    '2',
    {
      30: '0.99999999999984999995999999549999976',
      50: '0.999999999999849999959999995499999759999995',
      100: '0.999999999999849999959999995499999759999995',
    },
  ],
  ['-1.5', '3', '3', { 30: '-155.25', 50: '-155.25', 100: '-155.25' }],
  ['100', '2', '2', { 30: '-1970000.0', 50: '-1970000.0', 100: '-1970000.0' }],
];

// [a, b, Re B(a, b), Im B(a, b)] with a and b as [Re, Im]
const betaRows: [[string, string], [string, string], string, string][] = [
  [['1', '1'], ['2', '0'], '0.1', '-0.3'],
  [
    ['1', '1'],
    ['2', '-1'],
    '0.13601452749106658147511829183601878',
    '-0.13601452749106658147511829183601878',
  ],
  [
    ['0.5', '0'],
    ['0.5', '3'],
    '0.75325309255293511383580576142660235',
    '-0.6926812514544284385086496999565065',
  ],
  [
    ['2.5', '-1'],
    ['0.25', '0.75'],
    '-0.16694741221380454299039091894186773',
    '-0.53256492303683144417407588869148739',
  ],
  [
    ['-1.5', '0.5'],
    ['3.5', '-4'],
    '-1.9194368752176779099928516657030156',
    '-5.0933688113631177935453510472025073',
  ],
  [
    ['10', '40'],
    ['25', '60'],
    '0.00000000010495798206352067830175188776566043',
    '0.0000000001266569555188143279924423145075363',
  ],
  [
    ['0.01', '1e-3'],
    ['0.01', '2'],
    '97.717536599084689812339605848532062',
    '-11.691336767009613330888650426160456',
  ],
  [
    ['-2.5', '1'],
    ['-0.25', '-1'],
    '-0.044182528700028016873120257803530453',
    '-0.01828979892333504195067196656992443',
  ],
];

// [z, Re ψ(z), Im ψ(z)]
const digammaRows: [[string, string], string, string][] = [
  [
    ['1', '1'],
    '0.094650320622476977271878482721910722',
    '1.0766740474685811741340507947500005',
  ],
  [
    ['-0.5', '1e-3'],
    '0.036490388376753877369935198667579168',
    '0.0089347699658242657432117152344672163',
  ],
  [
    ['0.3', '7'],
    '1.9454668402635380621699382220120246',
    '1.5994088476567767532345011747631227',
  ],
  [
    ['-7.25', '-1.5'],
    '2.0672071087454760821748504863023196',
    '-2.95065636184202945514730027271045',
  ],
  [
    ['10', '50'],
    '3.9297398717486366036828930094077456',
    '1.3830284798521027578792782416932699',
  ],
  [
    ['60', '400'],
    '6.0024069644476035927514210262767342',
    '1.4231290225222350966900318772305727',
  ],
  [
    ['-40.5', '30'],
    '3.9279709857444371245303677970805498',
    '2.5099174054032773254446528932427009',
  ],
  [
    ['2.5', '1e-3'],
    '0.7031567587472559349245762854937628',
    '0.00049035771878259821683990651810839448',
  ],
];

const num = (x: string) => ({ num: x });
const complexOperand = ([re, im]: [string, string]) =>
  im === '0' ? num(re) : ['Complex', num(re), num(im)];

/** Digits in which `got` agrees with `expected`, relative to `expected`. */
function agreement(got: Expression, expected: string): number {
  const saved = BigDecimal.precision;
  BigDecimal.precision = 300;
  try {
    const e = new BigDecimal(expected);
    const g = new BigDecimal(got.toString());
    const diff = g.sub(e).abs();
    if (diff.isZero()) return Infinity;
    return -Math.log10(diff.div(e.abs()).toNumber());
  } finally {
    BigDecimal.precision = saved;
  }
}

const relativeError = (
  got: { re: number; im: number },
  re: string,
  im: string
) =>
  Math.hypot(got.re - Number(re), got.im - Number(im)) /
  Math.hypot(Number(re), Number(im));

describe('BetaRegularized outside [0, 1]', () => {
  // BigDecimal.precision is shared by every engine: each test gets its own
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  for (const [x, a, b, expected] of outside) {
    for (const precision of [30, 50, 100]) {
      test(`I_${x}(${a}, ${b}) = ${expected[precision].slice(0, 20)}... (N at ${precision} digits)`, () => {
        ce.precision = precision;
        const r = ce.expr(['BetaRegularized', num(x), num(a), num(b)]).N();
        expect(agreement(r, expected[precision])).toBeGreaterThan(
          precision - 3
        );
      });
    }

    test(`I_${x}(${a}, ${b}) (machine precision and compiled JavaScript)`, () => {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      const want = Number(expected[30]);
      const close = (got: number) =>
        expect(Math.abs(got - want) / Math.abs(want)).toBeLessThan(1e-13);
      close(machine.expr(['BetaRegularized', num(x), num(a), num(b)]).N().re);
      close(betaRegularized(Number(x), Number(a), Number(b)));
      const f = compile(machine.box(['BetaRegularized', 'x', 'a', 'b']));
      close(f.run!({ x: Number(x), a: Number(a), b: Number(b) }) as number);
    });
  }

  test('I_2(2, 3) = 8 and I_3(2, 3) = 81 (binomial tail polynomial, N)', () => {
    ce.precision = 21;
    expect(ce.expr(['BetaRegularized', 2, 2, 3]).N().toString()).toBe('8');
    expect(ce.expr(['BetaRegularized', 3, 2, 3]).N().toString()).toBe('81');
  });

  test('a rational x outside [0, 1] gives its exact polynomial value under N', () => {
    ce.precision = 21;
    // x = -1/2: 3·x²(1−x) + x³ = 1.125 − 0.125 at n = 3, a = b = 2
    const r = ce.expr(['BetaRegularized', ['Rational', -1, 2], 2, 2]).N();
    expect(r.toString()).toBe('1');
  });

  test('exact operands outside [0, 1] are not rounded under evaluate()', () => {
    const r = ce.expr(['BetaRegularized', 3, 2, 3]).evaluate();
    // symbolic, or the exact 81 where the closed forms reach this range
    expect(['BetaRegularized(3, 2, 3)', '81']).toContain(r.toString());
  });

  test('a float operand gives a float without N()', () => {
    ce.precision = 21;
    const call = ce.expr(['BetaRegularized', num('3.5'), 2, 3]);
    expect(call.evaluate().isExact).toBe(false);
    expect(call.evaluate().re).toBe(call.N().re);
  });

  test('the value is declined where it is not real or not a short sum', () => {
    ce.precision = 21;
    for (const call of [
      ['BetaRegularized', 2, 2, num('1.5')], // b not an integer, x > 1
      ['BetaRegularized', num('-0.5'), num('2.5'), 3], // x < 0, a not an integer
      ['BetaRegularized', 2, 0, 3], // a not positive
      ['BetaRegularized', 2, 150, 150], // past the cap on the degree
    ])
      expect(ce.expr(call as any).N().operator).toBe('BetaRegularized');
  });

  test('the machine kernel is NaN where the value is not real', () => {
    expect(betaRegularized(2, 2, 1.5)).toBeNaN();
    expect(betaRegularized(-0.5, 2.5, 3)).toBeNaN();
  });
});

describe('Beta at a complex operand', () => {
  // BigDecimal.precision is shared by every engine: each test gets its own
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  for (const [a, b, re, im] of betaRows) {
    for (const precision of [15, 21, 30]) {
      test(`B(${a.join('+')}i, ${b.join('+')}i) (N at ${precision} digits)`, () => {
        ce.precision = precision;
        const r = ce.expr(['Beta', complexOperand(a), complexOperand(b)]).N();
        expect(relativeError(r, re, im)).toBeLessThan(2e-13);
      });
    }
  }

  test('B(1+i, 2) = (1 - 3i)/10', () => {
    ce.precision = 21;
    const r = ce.expr(['Beta', ['Complex', 1, 1], 2]).N();
    expect(r.re).toBeCloseTo(0.1, 14);
    expect(r.im).toBeCloseTo(-0.3, 14);
  });

  test('B(a, b) is exactly 0 where a + b is a non-positive integer', () => {
    const r = ce.expr(['Beta', ['Complex', 1, 1], ['Complex', -3, -1]]).N();
    expect(r.toString()).toBe('0');
  });

  test('a pole is ~oo, as at a real partner', () => {
    expect(
      ce
        .expr(['Beta', -2, ['Complex', 1, 1]])
        .N()
        .toString()
    ).toBe('~oo');
    expect(ce.expr(['Beta', -2, 3.5]).N().toString()).toBe('~oo');
  });

  test('exact operands stay exact under evaluate()', () => {
    expect(ce.expr(['Beta', ['Complex', 1, 1], 2]).evaluate().operator).toBe(
      'Beta'
    );
  });

  test('a float operand gives a float without N()', () => {
    const r = ce.expr(['Beta', ['Complex', 1.5, 1], 2]).evaluate();
    expect(r.operator).not.toBe('Beta');
    expect(r.isExact).toBe(false);
  });
});

describe('Digamma at a complex operand', () => {
  // BigDecimal.precision is shared by every engine: each test gets its own
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  for (const [z, re, im] of digammaRows) {
    for (const precision of [15, 21, 30]) {
      test(`psi(${z.join('+')}i) (N at ${precision} digits)`, () => {
        ce.precision = precision;
        const r = ce.expr(['Digamma', complexOperand(z)]).N();
        expect(relativeError(r, re, im)).toBeLessThan(1e-13);
      });
    }
  }
});
