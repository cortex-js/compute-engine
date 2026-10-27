import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

// Two quantities with units of the same dimension compare by their physical
// value on every route: the methods `isEqual()`, `is()`,
// `isIdenticallyEqual()`, `isLess()`, `isLessEqual()`, `isGreater()`, and
// the operators `Equal`, `NotEqual`, `Less`, `IdenticallyEqual`. All of them
// use `compareQuantities()` (`src/compute-engine/library/quantity-compare.ts`).
// Two quantities with units of different dimensions (`6 W` and `6 m`), and a
// quantity with a dimension and a number (`6 m` and `6`), are not equal: the
// equality methods answer `false`, `Equal` is `False` and `NotEqual` is
// `True`. Their order has no meaning: the order methods answer `undefined`
// and the order operators stay unevaluated (`quantityDimensionsDiffer()`).
// A quantity whose unit is dimensionless and not logarithmic (`percent`,
// `deg`, `rad`) and a number compare as two values: the number has a unit
// of scale 1, so `6 percent` is `0.06` and `180 deg` is `π`.

/** `unequal`: not equal, and not ordered (different dimensions). */
type Verdict = 'equal' | 'less' | 'greater' | 'unequal' | 'undecided';

type Row = {
  name: string;
  latex: [string, string];
  json: [MathJsonExpression, MathJsonExpression];
  verdict: Verdict;
};

const ROWS: Row[] = [
  {
    name: '1000 m vs 1 km',
    latex: ['1000\\,\\mathrm{m}', '1\\,\\mathrm{km}'],
    json: [
      ['Quantity', 1000, 'm'],
      ['Quantity', 1, 'km'],
    ],
    verdict: 'equal',
  },
  {
    name: '6 A·V vs 6 W',
    latex: ['(2\\,\\mathrm{V})(3\\,\\mathrm{A})', '6\\,\\mathrm{W}'],
    json: [
      ['Multiply', ['Quantity', 2, 'V'], ['Quantity', 3, 'A']],
      ['Quantity', 6, 'W'],
    ],
    verdict: 'equal',
  },
  {
    name: '6 N·m vs 6 J',
    latex: ['(2\\,\\mathrm{N})(3\\,\\mathrm{m})', '6\\,\\mathrm{J}'],
    json: [
      ['Multiply', ['Quantity', 2, 'N'], ['Quantity', 3, 'm']],
      ['Quantity', 6, 'J'],
    ],
    verdict: 'equal',
  },
  {
    name: '6 W vs 7 W',
    latex: ['6\\,\\mathrm{W}', '7\\,\\mathrm{W}'],
    json: [
      ['Quantity', 6, 'W'],
      ['Quantity', 7, 'W'],
    ],
    verdict: 'less',
  },
  {
    name: '6 W vs 6 m (different dimensions)',
    latex: ['6\\,\\mathrm{W}', '6\\,\\mathrm{m}'],
    json: [
      ['Quantity', 6, 'W'],
      ['Quantity', 6, 'm'],
    ],
    verdict: 'unequal',
  },
  {
    name: '0 m vs 0 s (different dimensions, zero magnitudes)',
    latex: ['0\\,\\mathrm{m}', '0\\,\\mathrm{s}'],
    json: [
      ['Quantity', 0, 'm'],
      ['Quantity', 0, 's'],
    ],
    verdict: 'unequal',
  },
  {
    name: '6 m vs 6 (a length and a number)',
    latex: ['6\\,\\mathrm{m}', '6'],
    json: [['Quantity', 6, 'm'], 6],
    verdict: 'unequal',
  },
  {
    name: '0 m vs 0 (a length and a number)',
    latex: ['0\\,\\mathrm{m}', '0'],
    json: [['Quantity', 0, 'm'], 0],
    verdict: 'unequal',
  },
  {
    name: '6 m vs π (a length and an exact constant)',
    latex: ['6\\,\\mathrm{m}', '\\pi'],
    json: [['Quantity', 6, 'm'], 'Pi'],
    verdict: 'unequal',
  },
  {
    name: '6 m vs "a" (a length and a string)',
    latex: ['6\\,\\mathrm{m}', '\\text{a}'],
    json: [['Quantity', 6, 'm'], { str: 'a' }],
    verdict: 'unequal',
  },
  {
    name: '6 m vs True (a length and a boolean)',
    latex: ['6\\,\\mathrm{m}', '\\top'],
    json: [['Quantity', 6, 'm'], 'True'],
    verdict: 'unequal',
  },
  {
    name: '6 percent vs 0.06 (a dimensionless quantity and a number)',
    latex: ['6\\,\\mathrm{percent}', '0.06'],
    json: [['Quantity', 6, 'percent'], 0.06],
    verdict: 'equal',
  },
  {
    name: '6 percent vs 0.07',
    latex: ['6\\,\\mathrm{percent}', '0.07'],
    json: [['Quantity', 6, 'percent'], 0.07],
    verdict: 'less',
  },
  {
    name: '6 percent vs 3/50 (exact)',
    latex: ['6\\,\\mathrm{percent}', '\\frac{3}{50}'],
    json: [
      ['Quantity', 6, 'percent'],
      ['Rational', 3, 50],
    ],
    verdict: 'equal',
  },
  {
    name: '1000000 ppm vs 1',
    latex: ['1000000\\,\\mathrm{ppm}', '1'],
    json: [['Quantity', 1000000, 'ppm'], 1],
    verdict: 'equal',
  },
  {
    name: '30 deg vs 1 (an angle and a number)',
    latex: ['30\\,\\mathrm{deg}', '1'],
    json: [['Quantity', 30, 'deg'], 1],
    verdict: 'less',
  },
  {
    name: '30 deg vs π/6 (exact)',
    latex: ['30\\,\\mathrm{deg}', '\\frac{\\pi}{6}'],
    json: [
      ['Quantity', 30, 'deg'],
      ['Divide', 'Pi', 6],
    ],
    verdict: 'equal',
  },
  {
    name: '180 deg vs π (exact)',
    latex: ['180\\,\\mathrm{deg}', '\\pi'],
    json: [['Quantity', 180, 'deg'], 'Pi'],
    verdict: 'equal',
  },
  {
    name: '180 deg vs 3.14159 (float)',
    latex: ['180\\,\\mathrm{deg}', '3.14159'],
    json: [['Quantity', 180, 'deg'], 3.14159],
    verdict: 'greater',
  },
  {
    name: '1 turn vs 2π (exact)',
    latex: ['1\\,\\mathrm{turn}', '2\\pi'],
    json: [
      ['Quantity', 1, 'turn'],
      ['Multiply', 2, 'Pi'],
    ],
    verdict: 'equal',
  },
  {
    name: '1 rad vs 1',
    latex: ['1\\,\\mathrm{rad}', '1'],
    json: [['Quantity', 1, 'rad'], 1],
    verdict: 'equal',
  },
  {
    name: 'π rad vs 180 deg (a constant juxtaposed with a unit)',
    latex: ['\\pi\\,\\mathrm{rad}', '180\\,\\mathrm{deg}'],
    json: [
      ['Quantity', 'Pi', 'rad'],
      ['Quantity', 180, 'deg'],
    ],
    verdict: 'equal',
  },
  {
    name: '6 dB vs 6 (a logarithmic unit and a number)',
    latex: ['6\\,\\mathrm{dB}', '6'],
    json: [['Quantity', 6, 'dB'], 6],
    verdict: 'undecided',
  },
  {
    name: '1 dB vs 1 Np (two logarithmic units)',
    latex: ['1\\,\\mathrm{dB}', '1\\,\\mathrm{Np}'],
    json: [
      ['Quantity', 1, 'dB'],
      ['Quantity', 1, 'Np'],
    ],
    verdict: 'undecided',
  },
  {
    name: '180 deg vs π rad (exact)',
    latex: ['180\\,\\mathrm{deg}', '\\pi\\cdot 1\\,\\mathrm{rad}'],
    json: [
      ['Quantity', 180, 'deg'],
      ['Quantity', 'Pi', 'rad'],
    ],
    verdict: 'equal',
  },
  {
    name: '180 deg vs 3.14159 rad (float)',
    latex: ['180\\,\\mathrm{deg}', '3.14159\\,\\mathrm{rad}'],
    json: [
      ['Quantity', 180, 'deg'],
      ['Quantity', 3.14159, 'rad'],
    ],
    verdict: 'greater',
  },
  {
    name: '180 deg vs 3.141592653589793 rad (float within the tolerance)',
    latex: ['180\\,\\mathrm{deg}', '3.141592653589793\\,\\mathrm{rad}'],
    json: [
      ['Quantity', 180, 'deg'],
      ['Quantity', 3.141592653589793, 'rad'],
    ],
    verdict: 'equal',
  },
  {
    name: '1 turn vs 400 grad',
    latex: ['1\\,\\mathrm{turn}', '400\\,\\mathrm{grad}'],
    json: [
      ['Quantity', 1, 'turn'],
      ['Quantity', 400, 'grad'],
    ],
    verdict: 'equal',
  },
  {
    name: '1 deg vs 3601 arcsec',
    latex: ['1\\,\\mathrm{deg}', '3601\\,\\mathrm{arcsec}'],
    json: [
      ['Quantity', 1, 'deg'],
      ['Quantity', 3601, 'arcsec'],
    ],
    verdict: 'less',
  },
  {
    name: '1 km vs 100000 cm (two prefixes)',
    latex: ['1\\,\\mathrm{km}', '100000\\,\\mathrm{cm}'],
    json: [
      ['Quantity', 1, 'km'],
      ['Quantity', 100000, 'cm'],
    ],
    verdict: 'equal',
  },
  {
    name: '1 km vs 999 m',
    latex: ['1\\,\\mathrm{km}', '999\\,\\mathrm{m}'],
    json: [
      ['Quantity', 1, 'km'],
      ['Quantity', 999, 'm'],
    ],
    verdict: 'greater',
  },
];

function sides(row: Row, route: 'parse' | 'box'): [Expression, Expression] {
  if (route === 'parse')
    return [
      ce.parse(row.latex[0]).evaluate(),
      ce.parse(row.latex[1]).evaluate(),
    ];
  return [ce.box(row.json[0]).evaluate(), ce.box(row.json[1]).evaluate()];
}

/** The result of the relational operator `op` over `a` and `b`: `'True'`,
 * `'False'`, or `'inert'` when the operator stays unevaluated. */
function relation(op: string, a: Expression, b: Expression): string {
  const r = ce.function(op, [a, b]).evaluate();
  if (r.symbol === 'True' || r.symbol === 'False') return r.symbol;
  return r.operator === op ? 'inert' : r.toString();
}

/** The same relation, parsed from LaTeX as one expression. */
function parsedRelation(op: string, latex: string): string {
  const r = ce.parse(latex).evaluate();
  if (r.symbol === 'True' || r.symbol === 'False') return r.symbol;
  return r.operator === op ? 'inert' : r.toString();
}

function expected(verdict: Verdict) {
  // `unequal`: the equality is decided, the order is not
  const decided = verdict !== 'undecided';
  const ordered = decided && verdict !== 'unequal';
  const eq = verdict === 'equal';
  const lt = verdict === 'less';
  const gt = verdict === 'greater';
  const bool = (x: boolean) => (decided ? x : undefined);
  const sym = (x: boolean) => (decided ? (x ? 'True' : 'False') : 'inert');
  const ord = (x: boolean) => (ordered ? x : undefined);
  const ordSym = (x: boolean) => (ordered ? (x ? 'True' : 'False') : 'inert');
  return {
    isEqual: bool(eq),
    is: eq,
    isIdenticallyEqual: bool(eq),
    isLess: ord(lt),
    isLessEqual: ord(lt || eq),
    isGreater: ord(gt),
    isGreaterEqual: ord(gt || eq),
    Equal: sym(eq),
    NotEqual: sym(!eq),
    Less: ordSym(lt),
    LessEqual: ordSym(lt || eq),
    IdenticallyEqual: sym(eq),
  };
}

describe.each(['parse', 'box'] as const)(
  'QUANTITY COMPARISON METHODS, %s route',
  (route) => {
    test.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
      const [a, b] = sides(row, route);
      const x = expected(row.verdict);
      expect(a.isEqual(b)).toBe(x.isEqual);
      expect(b.isEqual(a)).toBe(x.isEqual);
      // `.is()` is symmetric
      expect(a.is(b)).toBe(x.is);
      expect(b.is(a)).toBe(x.is);
      expect(a.isIdenticallyEqual(b)).toBe(x.isIdenticallyEqual);
      expect(a.isLess(b)).toBe(x.isLess);
      expect(a.isLessEqual(b)).toBe(x.isLessEqual);
      expect(a.isGreater(b)).toBe(x.isGreater);
      expect(a.isGreaterEqual(b)).toBe(x.isGreaterEqual);
    });
  }
);

describe.each(['parse', 'box'] as const)(
  'QUANTITY RELATIONAL OPERATORS, %s route',
  (route) => {
    test.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
      const [a, b] = sides(row, route);
      const x = expected(row.verdict);
      expect(relation('Equal', a, b)).toBe(x.Equal);
      expect(relation('NotEqual', a, b)).toBe(x.NotEqual);
      expect(relation('Less', a, b)).toBe(x.Less);
      expect(relation('LessEqual', a, b)).toBe(x.LessEqual);
      expect(relation('IdenticallyEqual', a, b)).toBe(x.IdenticallyEqual);
    });
  }
);

describe('QUANTITY RELATIONS PARSED FROM LATEX', () => {
  test.each(ROWS.map((r) => [r.name, r] as const))('%s', (_name, row) => {
    const [l, r] = row.latex;
    const x = expected(row.verdict);
    expect(parsedRelation('Equal', `${l} = ${r}`)).toBe(x.Equal);
    expect(parsedRelation('NotEqual', `${l} \\ne ${r}`)).toBe(x.NotEqual);
    // `a < b` is canonical `Less(a, b)`
    expect(parsedRelation('Less', `${l} < ${r}`)).toBe(x.Less);
  });
});

describe('EXACT AND FLOAT MAGNITUDES', () => {
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(['Quantity', mag, unit]).evaluate();

  // Two exact magnitudes compare exactly, as two exact numbers do
  test('exact magnitudes, same unit, 10⁻¹⁶ apart', () => {
    const a = q(1, 'm');
    const b = q(['Add', 1, ['Power', 10, -16]], 'm');
    expect(a.isEqual(b)).toBe(false);
    expect(a.isIdenticallyEqual(b)).toBe(false);
    expect(a.isLess(b)).toBe(true);
    expect(relation('Equal', a, b)).toBe('False');
    expect(relation('NotEqual', a, b)).toBe('True');
    expect(relation('Less', a, b)).toBe('True');
    // `.is()` keeps the tolerance
    expect(a.is(b)).toBe(true);
    expect(b.is(a)).toBe(true);
  });

  test('exact magnitudes, two units, 10⁻¹³ m apart', () => {
    const a = q(1, 'km');
    const b = q(['Add', 1000, ['Power', 10, -13]], 'm');
    expect(a.isEqual(b)).toBe(false);
    expect(a.isLess(b)).toBe(true);
    expect(relation('Equal', a, b)).toBe('False');
    expect(relation('Less', a, b)).toBe('True');
  });

  // A float magnitude compares within the engine tolerance
  test('float magnitude within the tolerance', () => {
    const a = q(1, 'km');
    const b = q(1000.00000000001, 'm');
    expect(a.isEqual(b)).toBe(true);
    expect(b.isEqual(a)).toBe(true);
    expect(a.isLess(b)).toBe(false);
    expect(relation('Equal', a, b)).toBe('True');
    expect(relation('NotEqual', a, b)).toBe('False');
    expect(relation('Less', a, b)).toBe('False');
    expect(a.is(b)).toBe(true);
  });

  test('float magnitude with a converted unit', () => {
    const a = q(1.5, 'km');
    const b = q(1500, 'm');
    expect(a.isEqual(b)).toBe(true);
    expect(relation('Equal', a, b)).toBe('True');
  });

  test('`.is()` with an explicit tolerance', () => {
    expect(q(1, 'm').is(q(1.1, 'm'), 0.2)).toBe(true);
    expect(q(1, 'm').is(q(1.1, 'm'))).toBe(false);
  });

  test('an exact constant magnitude', () => {
    const a = q('Pi', 'm');
    const b = q(['Multiply', 1000, 'Pi'], 'mm');
    expect(a.isEqual(b)).toBe(true);
    expect(relation('Equal', a, b)).toBe('True');
    expect(relation('Less', a, q(3142, 'mm'))).toBe('True');
  });
});

describe('QUANTITY COMPARISON EDGE CASES', () => {
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(['Quantity', mag, unit]).evaluate();

  // The tolerance applies in the finer unit, not in SI: `1 eV` and `2 eV`
  // differ by `1.6e-19 J`, which is less than the tolerance.
  test('small units are not all equal', () => {
    expect(q(1, 'eV').isEqual(q(2, 'eV'))).toBe(false);
    expect(relation('Equal', q(1, 'eV'), q(2, 'eV'))).toBe('False');
    expect(relation('Equal', q(1.5, 'pm'), q(2.5, 'pm'))).toBe('False');
    expect(relation('Equal', q(1, 'eV'), q(0, 'J'))).toBe('False');
  });

  // A temperature unit has an offset: `0 °C` is `273.15 K`
  test('a temperature with an offset', () => {
    expect(relation('Equal', q(0, 'degC'), q(273.15, 'K'))).toBe('True');
    expect(
      relation('Equal', q(0, 'degC'), q(['Rational', 27315, 100], 'K'))
    ).toBe('True');
    expect(relation('Less', q(0, 'degC'), q(1, 'K'))).toBe('False');
    expect(q(0, 'degC').isEqual(q(['Rational', 27315, 100], 'K'))).toBe(true);
  });

  // A magnitude with no numeric value is not decided
  test('a symbolic magnitude', () => {
    expect(relation('Equal', q('x', 'm'), q('y', 'm'))).toBe('inert');
    expect(relation('Less', q('x', 'm'), q('y', 'm'))).toBe('inert');
    expect(q('x', 'm').isEqual(q('y', 'm'))).toBe(undefined);
  });

  test('a complex magnitude', () => {
    expect(relation('Equal', q(['Complex', 1, 1], 'm'), q(1, 'm'))).not.toBe(
      'True'
    );
  });

  test('a chain of quantities', () => {
    expect(
      ce
        .box([
          'Equal',
          ['Quantity', 1, 'km'],
          ['Quantity', 1000, 'm'],
          ['Quantity', 100000, 'cm'],
        ])
        .evaluate().symbol
    ).toBe('True');
    expect(
      ce
        .box([
          'Less',
          ['Quantity', 1, 'km'],
          ['Quantity', 999, 'm'],
          ['Quantity', 2, 'km'],
        ])
        .evaluate().symbol
    ).toBe('False');
  });
});

// `Max`, `Min`, `Clamp` and `Sort` order their operands with `exactOrder()`
// (`src/compute-engine/boxed-expression/compare.ts`), which orders two
// quantities with units of the same dimension by their physical value, with
// no tolerance. Quantities that cannot be ordered against the other operands
// (units of another dimension, a number with no unit) stay in the
// unevaluated result.
describe('EXTREMUM AND SORT OF QUANTITIES', () => {
  const Q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ['Quantity', mag, unit] as MathJsonExpression;
  const evalStr = (x: MathJsonExpression) => ce.box(x).evaluate().toString();
  const evalOp = (x: MathJsonExpression) => ce.box(x).evaluate().operator;

  test.each<[string, MathJsonExpression, string]>([
    ['Max of two units', ['Max', Q(1, 'km'), Q(999, 'm')], '1 km'],
    ['Min of two units', ['Min', Q(1, 'km'), Q(999, 'm')], '999 m'],
    ['Max of a list', ['Max', ['List', Q(1, 'km'), Q(999, 'm')]], '1 km'],
    ['Min of a list', ['Min', ['List', Q(1, 'km'), Q(999, 'm')]], '999 m'],
    ['Max of equal values', ['Max', Q(1, 'km'), Q(1000, 'm')], '1 km'],
    [
      'Max of exact magnitudes',
      ['Max', Q(1, 'm'), Q(['Add', 1, ['Power', 10, -16]], 'm')],
      '10000000000000001/1e+16 m',
    ],
    ['Max of small floats', ['Max', Q(1.5, 'pm'), Q(2.5, 'pm')], '2.5 pm'],
    [
      'Max with a temperature offset',
      ['Max', Q(0, 'degC'), Q(1, 'K')],
      '0 degC',
    ],
    ['Clamp', ['Clamp', Q(5, 'km'), Q(999, 'm'), Q(2, 'km')], '2 km'],
    [
      'Sort',
      ['Sort', ['List', Q(1, 'km'), Q(999, 'm'), Q(5, 'cm')]],
      '[5 cm,999 m,1 km]',
    ],
  ])('%s', (_name, expr, result) => {
    expect(evalStr(expr)).toBe(result);
  });

  // `3 dm` and `3/10 m` are a tie: the conversion of `0.3 m` to `dm` rounds
  // to `2.9999999999999996`, so the exact magnitudes are compared exactly.
  test('a tie of exact magnitudes across units', () => {
    expect(evalStr(['Min', Q(3, 'dm'), Q(['Rational', 3, 10], 'm')])).toBe(
      '3 dm'
    );
    expect(evalStr(['Min', Q(['Rational', 3, 10], 'm'), Q(3, 'dm')])).toBe(
      '3/10 m'
    );
  });

  test('units of different dimensions are not ordered', () => {
    expect(evalOp(['Max', Q(6, 'W'), Q(6, 'm')])).toBe('Max');
    expect(evalOp(['Min', Q(6, 'W'), Q(6, 'm')])).toBe('Min');
    expect(evalStr(['Max', ['List', Q(6, 'W'), Q(6, 'm'), Q(7, 'W')]])).toBe(
      'max(7 W, 6 m)'
    );
    expect(evalOp(['Sort', ['List', Q(6, 'W'), Q(6, 'm')]])).toBe('Sort');
    expect(evalOp(['Clamp', Q(5, 'km'), Q(1, 'W'), Q(2, 'W')])).toBe('Clamp');
  });

  test('a quantity and a number are not ordered', () => {
    expect(evalOp(['Max', Q(1, 'km'), 5])).toBe('Max');
    expect(evalStr(['Max', Q(1, 'km'), Q(2, 'km'), 5])).toBe('max(2 km, 5)');
  });

  test('a magnitude with no real value is not ordered', () => {
    expect(evalOp(['Max', Q('x', 'm'), Q(1, 'km')])).toBe('Max');
    expect(evalOp(['Max', Q(['Complex', 1, 1], 'km'), Q(999, 'm')])).toBe(
      'Max'
    );
  });
});

// Review findings of 2026-10-19 on the quantity comparison
// (`src/compute-engine/library/quantity-compare.ts`).
describe('QUANTITY COMPARISON WITH NO ROUNDING', () => {
  const Q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ['Quantity', mag, unit] as MathJsonExpression;
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(Q(mag, unit)).evaluate();
  const evalStr = (x: MathJsonExpression) => {
    const r = ce.box(x).evaluate();
    return r.symbol ?? r.toString();
  };
  const nStr = (x: MathJsonExpression) => {
    const r = ce.box(x).N();
    return r.symbol ?? r.toString();
  };

  // An exact magnitude too large for a double is not read as `Infinity`
  test('exact magnitudes past the range of a double', () => {
    const a = q(['Power', 10, 400], 'm');
    const b = q(['Power', 10, 401], 'm');
    expect(a.isEqual(b)).toBe(false);
    expect(a.isLess(b)).toBe(true);
    expect(a.is(b)).toBe(false);
    expect(a.isEqual(q(['Power', 10, 397], 'km'))).toBe(true);
    expect(
      evalStr([
        'Sort',
        [
          'List',
          Q(['Multiply', 2, ['Power', 10, 400]], 'm'),
          Q(['Power', 10, 400], 'm'),
        ],
      ])
    ).toBe('[1e+400 m,2e+400 m]');
  });

  // `√(10⁶⁰ + 10⁴⁰) − 10³⁰` is `4999999999.99…`: its double cancels
  test('an exact constant magnitude whose double cancels', () => {
    const c: MathJsonExpression = [
      'Subtract',
      ['Sqrt', ['Add', ['Power', 10, 60], ['Power', 10, 40]]],
      ['Power', 10, 30],
    ];
    expect(q(c, 'm').isLess(q(1, 'm'))).toBe(false);
    expect(q(c, 'm').isLess(q(5000000000, 'm'))).toBe(true);
    expect(evalStr(['Less', Q(c, 'm'), Q(5000000000, 'm')])).toBe('True');
    expect(evalStr(['Less', c, 5000000000])).toBe('True');
  });

  // Two big decimal floats are equal within the tolerance (`isEqual`), and
  // the extrema use the same order: a tie keeps the first operand
  test('big decimal magnitudes', () => {
    const a = Q({ num: '1.00000000000000000001' }, 'm');
    const b = Q({ num: '1.00000000000000000002' }, 'm');
    expect(evalStr(['Min', b, a])).toBe(evalStr(b));
    expect(evalStr(['Max', a, b])).toBe(evalStr(a));
    expect(ce.box(a).evaluate().isEqual(ce.box(b).evaluate())).toBe(true);
  });

  // Under `.N()`, the exact magnitude decides, as for two numbers
  test('exact magnitudes under N()', () => {
    const tiny = Q(['Add', 1, ['Power', 10, -30]], 'm');
    expect(evalStr(['Less', Q(1, 'm'), tiny])).toBe('True');
    expect(nStr(['Less', Q(1, 'm'), tiny])).toBe('True');
    expect(nStr(['Less', 1, ['Add', 1, ['Power', 10, -30]]])).toBe('True');
    expect(nStr(['Equal', Q(1, 'm'), tiny])).toBe('False');
    expect(nStr(['NotEqual', Q(1, 'm'), tiny])).toBe('True');
    expect(nStr(['Less', Q(1, 'm'), tiny, Q(2, 'm')])).toBe('True');
    expect(
      nStr(['Less', Q(1, 'km'), Q(['Add', 1000, ['Power', 10, -30]], 'm')])
    ).toBe('True');
  });

  test('exact magnitudes under N(), asynchronous route', async () => {
    const r = await ce
      .box(['Less', Q(1, 'm'), Q(['Add', 1, ['Power', 10, -30]], 'm')])
      .evaluateAsync({ numericApproximation: true });
    expect(r.symbol).toBe('True');
  });

  // A unit whose scale is not exact still converts to itself exactly
  test('identical units', () => {
    const tiny: MathJsonExpression = ['Add', 1, ['Power', 10, -16]];
    expect(q(1, 'in').isEqual(q(tiny, 'in'))).toBe(false);
    expect(q(1, 'Da').isEqual(q(tiny, 'Da'))).toBe(false);
    expect(q(1, 'deg').isEqual(q(tiny, 'deg'))).toBe(false);
    const sqrtM: MathJsonExpression = ['Power', 'm', ['Rational', 1, 2]];
    expect(q(1, sqrtM).isEqual(q(tiny, sqrtM))).toBe(false);
    expect(q(1, sqrtM).isEqual(q(1, sqrtM))).toBe(true);
  });

  // The imaginary part is read on the full representation: the double of
  // `10⁻⁸⁰⁰` is `0`
  test('a complex magnitude with a tiny imaginary part', () => {
    const z: MathJsonExpression = [
      'Add',
      1,
      ['Multiply', ['Power', 10, -800], 'ImaginaryUnit'],
    ];
    expect(q(z, 'm').isEqual(q(1, 'm'))).toBe(undefined);
    expect(evalStr(['Equal', Q(z, 'm'), Q(1, 'm')])).not.toBe('True');
    const w: MathJsonExpression = [
      'Add',
      'Pi',
      ['Multiply', ['Power', 10, -800], 'ImaginaryUnit'],
    ];
    expect(q(w, 'm').isEqual(q('Pi', 'm'))).toBe(undefined);
  });

  // A float magnitude makes the extremum inexact, as a float operand does
  test('an extremum with a float quantity and Indeterminate', () => {
    expect(evalStr(['Max', Q(1.5, 'm'), 'Indeterminate'])).toBe('NaN');
    expect(evalStr(['Max', 1.5, 'Indeterminate'])).toBe('NaN');
    expect(evalStr(['Max', Q(1, 'm'), 'Indeterminate'])).toBe('Indeterminate');
  });

  // The units defined by an exact decimal number convert exactly
  test('decimal unit scales', () => {
    expect(
      q(1, 'in').isEqual(
        q(['Rational', 254000000000001, 100000000000000], 'cm')
      )
    ).toBe(false);
    expect(q(1, 'in').isEqual(q(['Rational', 254, 100], 'cm'))).toBe(true);
    expect(q(1, 'mi').isEqual(q(1609344, 'mm'))).toBe(true);
    expect(q(1, 'Ym').isEqual(q(['Power', 10, 24], 'm'))).toBe(true);
    expect(q(1, 'Ym').isEqual(q(['Add', ['Power', 10, 24], 1], 'm'))).toBe(
      false
    );
    expect(q(1, 'Yg').isEqual(q(['Power', 10, 21], 'kg'))).toBe(true);
    expect(
      q(1, 'eV').isEqual(q(['Rational', 1602176635, ['Power', 10, 28]], 'J'))
    ).toBe(false);
    expect(
      q(1, 'keV').isEqual(q(['Rational', 1602176634, ['Power', 10, 25]], 'J'))
    ).toBe(true);
  });

  // The scale of an angle unit is a rational multiple of π (`deg` is
  // `π/180 rad`): two exact magnitudes compare exactly
  test('angle units', () => {
    const tiny: MathJsonExpression = ['Power', 10, -30];
    const piOver180: MathJsonExpression = ['Divide', 'Pi', 180];
    expect(q(180, 'deg').isEqual(q('Pi', 'rad'))).toBe(true);
    expect(q(1, 'deg').isEqual(q(['Add', piOver180, tiny], 'rad'))).toBe(false);
    expect(q(1, 'deg').isLess(q(['Add', piOver180, tiny], 'rad'))).toBe(true);
    expect(q(1, 'deg').isGreater(q(['Subtract', piOver180, tiny], 'rad'))).toBe(
      true
    );
    expect(
      evalStr(['Less', Q(1, 'deg'), Q(['Add', piOver180, tiny], 'rad')])
    ).toBe('True');
    expect(
      nStr(['Less', Q(1, 'deg'), Q(['Add', piOver180, tiny], 'rad')])
    ).toBe('True');
    expect(
      nStr(['Equal', Q(1, 'deg'), Q(['Add', piOver180, tiny], 'rad')])
    ).toBe('False');
    // `.is()` keeps the tolerance
    expect(q(1, 'deg').is(q(['Add', piOver180, tiny], 'rad'))).toBe(true);
    // The parse route
    const deg = ce.parse('1\\,\\mathrm{deg}').evaluate();
    const rad = ce
      .parse('(\\frac{\\pi}{180}+10^{-30})\\cdot 1\\,\\mathrm{rad}')
      .evaluate();
    expect(deg.isEqual(rad)).toBe(false);
    expect(deg.isLess(rad)).toBe(true);
    expect(rad.isGreater(deg)).toBe(true);
    expect(
      ce
        .parse(
          '1\\,\\mathrm{deg}<(\\frac{\\pi}{180}+10^{-30})\\cdot 1\\,\\mathrm{rad}'
        )
        .evaluate().symbol
    ).toBe('True');
    expect(
      ce.parse('180\\,\\mathrm{deg}=\\pi\\cdot 1\\,\\mathrm{rad}').evaluate()
        .symbol
    ).toBe('True');
    expect(q(1, 'turn').isEqual(q(['Multiply', 2, 'Pi'], 'rad'))).toBe(true);
    expect(q(1, 'turn').isEqual(q(360, 'deg'))).toBe(true);
    expect(q(1, 'deg').isEqual(q(60, 'arcmin'))).toBe(true);
    expect(q(1, 'arcmin').isEqual(q(60, 'arcsec'))).toBe(true);
    expect(q(1, 'arcmin').isEqual(q(['Add', 60, tiny], 'arcsec'))).toBe(false);
    expect(
      q(90, ['Divide', 'deg', 's']).isEqual(
        q(['Divide', 'Pi', 2], ['Divide', 'rad', 's'])
      )
    ).toBe(true);
    expect(
      evalStr(['Max', Q(1, 'deg'), Q(['Add', piOver180, tiny], 'rad')])
    ).toBe(evalStr(Q(['Add', piOver180, tiny], 'rad')));
    expect(
      evalStr(['Sort', ['List', Q(1, 'turn'), Q(1, 'rad'), Q(1, 'deg')]])
    ).toBe('[1 deg,1 rad,1 turn]');
  });

  // The scale of `Da` is a measured value. Its decimal number in the unit
  // table is its definition: the conversion is exact
  test('the dalton', () => {
    const daInKg: MathJsonExpression = [
      'Rational',
      16605390666,
      ['Power', 10, 37],
    ];
    expect(q(1, 'Da').isEqual(q(1.6605390666e-27, 'kg'))).toBe(true);
    expect(q(1, 'Da').isEqual(q(daInKg, 'kg'))).toBe(true);
    expect(
      q(1, 'Da').isEqual(q(['Add', daInKg, ['Power', 10, -60]], 'kg'))
    ).toBe(false);
    expect(
      q(1, 'Da').isLess(q(['Add', daInKg, ['Power', 10, -60]], 'kg'))
    ).toBe(true);
  });

  // Only the comparison is exact: the conversion of a value is the same
  test('the conversion of an angle is not changed', () => {
    expect(evalStr(['UnitConvert', Q(180, 'deg'), 'rad'])).toBe(
      '3.141592653589793 rad'
    );
    expect(evalStr(['UnitConvert', Q('Pi', 'rad'), 'deg'])).toBe('180 deg');
    expect(evalStr(['UnitConvert', Q(90, 'deg'), 'turn'])).toBe('0.25 turn');
    expect(evalStr(['UnitConvert', Q(1, 'Da'), 'kg'])).toBe(
      '1.6605390666e-27 kg'
    );
  });
});

// Two values with different physical dimensions are not equal, and their
// order has no meaning (`quantityDimensionsDiffer()`,
// `src/compute-engine/library/quantity-compare.ts`).
describe('QUANTITIES OF DIFFERENT DIMENSIONS', () => {
  const Q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ['Quantity', mag, unit] as MathJsonExpression;
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(Q(mag, unit)).evaluate();
  const evalStr = (x: MathJsonExpression) => {
    const r = ce.box(x).evaluate();
    return r.symbol ?? r.operator;
  };
  const nStr = (x: MathJsonExpression) => {
    const r = ce.box(x).N();
    return r.symbol ?? r.operator;
  };

  // The dimension is part of the value: the magnitude does not change the
  // answer
  test('a symbolic magnitude', () => {
    expect(q('x', 'm').isEqual(q(6, 's'))).toBe(false);
    expect(q('x', 'm').isIdenticallyEqual(q('y', 's'))).toBe(false);
    expect(q('x', 'm').isLess(q(6, 's'))).toBe(undefined);
    expect(evalStr(['Equal', Q('x', 'm'), Q(6, 's')])).toBe('False');
    expect(evalStr(['NotEqual', Q('x', 'm'), Q(6, 's')])).toBe('True');
    expect(evalStr(['Less', Q('x', 'm'), Q(6, 's')])).toBe('Less');
    // The same dimension: the magnitude decides, and it has no value
    expect(evalStr(['Equal', Q('x', 'm'), Q(6, 'km')])).toBe('Equal');
  });

  test('under N()', () => {
    expect(nStr(['Equal', Q(6, 'W'), Q(6, 'm')])).toBe('False');
    expect(nStr(['NotEqual', Q(6, 'W'), Q(6, 'm')])).toBe('True');
    expect(nStr(['Equal', Q(6, 'm'), 6])).toBe('False');
    expect(nStr(['Less', Q(6, 'W'), Q(6, 'm')])).toBe('Less');
  });

  test('a quantity and a string', () => {
    expect(evalStr(['Equal', Q(6, 'm'), { str: 'ab' }])).toBe('False');
    expect(evalStr(['NotEqual', Q(6, 'm'), { str: 'ab' }])).toBe('True');
    expect(nStr(['Equal', Q(6, 'm'), { str: 'ab' }])).toBe('False');
    expect(q(6, 'm').isEqual(ce.string('ab'))).toBe(false);
    expect(evalStr(['Equal', Q(6, 'm'), { str: 'ab' }, Q(600, 'cm')])).toBe(
      'False'
    );
  });

  // A constant symbol is tested by its value, and the boolean constants
  // are not numbers
  test('a quantity and a constant symbol', () => {
    ce.declare('qConstLength', {
      constant: true,
      value: ce.box(['Quantity', 6, 'm']),
    });
    expect(evalStr(['Equal', Q(6, 'm'), 'qConstLength'])).toBe('True');
    expect(evalStr(['Equal', Q(600, 'cm'), 'qConstLength'])).toBe('True');
    expect(evalStr(['Equal', Q(6, 'm'), 'False'])).toBe('False');
    expect(evalStr(['NotEqual', Q(6, 'm'), 'False'])).toBe('True');
    expect(q(6, 'm').isEqual(ce.False)).toBe(false);
  });

  // A dimensionless quantity is never a string or a boolean
  test('a dimensionless quantity and a string or a boolean', () => {
    expect(evalStr(['Equal', Q(6, 'percent'), { str: 'a' }])).toBe('False');
    expect(evalStr(['NotEqual', Q(6, 'percent'), { str: 'a' }])).toBe('True');
    expect(evalStr(['Equal', Q(6, 'percent'), 'True'])).toBe('False');
    expect(evalStr(['NotEqual', Q(6, 'percent'), 'True'])).toBe('True');
    expect(evalStr(['Equal', Q(30, 'deg'), 'False'])).toBe('False');
    expect(q(6, 'percent').isEqual(ce.string('a'))).toBe(false);
    expect(q(6, 'percent').isEqual(ce.True)).toBe(false);
    expect(q(6, 'percent').isLess(ce.string('a'))).toBe(undefined);
    expect(nStr(['Equal', Q(6, 'percent'), { str: 'a' }])).toBe('False');
    const p = ce.parse('6\\,\\mathrm{percent}').evaluate();
    expect(p.isEqual(ce.parse('\\text{a}').evaluate())).toBe(false);
    expect(ce.parse('6\\,\\mathrm{percent}=\\text{a}').evaluate().symbol).toBe(
      'False'
    );
    expect(ce.parse('6\\,\\mathrm{percent}=\\top').evaluate().symbol).toBe(
      'False'
    );
    expect(
      ce.parse('6\\,\\mathrm{percent}\\ne\\text{a}').evaluate().symbol
    ).toBe('True');
  });

  test('a chain', () => {
    expect(evalStr(['Equal', Q(6, 'W'), Q(6, 'W'), Q(6, 'm')])).toBe('False');
    expect(evalStr(['NotEqual', Q(6, 'W'), Q(6, 'm'), Q(7, 'W')])).toBe('True');
  });

  // A number that is the value of an expression or of a symbol
  test('a quantity and an expression with a number value', () => {
    expect(evalStr(['Equal', Q(5, 'm'), ['Add', 2, 3]])).toBe('False');
    expect(q(6, 'm').isEqual(6)).toBe(false);
    expect(q(6, 'm').isEqual(ce.box(['Sqrt', 2]))).toBe(false);
  });

  // Not decided: a unit that is not in the unit table, a value that is not
  // known to be a number, a quantity with a logarithmic unit and a number, an
  // absent magnitude
  test('undecided cases', () => {
    expect(q(6, 'foo').isEqual(q(6, 'm'))).toBe(undefined);
    expect(evalStr(['Equal', Q(6, 'foo'), Q(6, 'm')])).toBe('Equal');
    expect(q(6, 'm').isEqual(ce.box('y'))).toBe(undefined);
    expect(evalStr(['Equal', Q(6, 'm'), 'y'])).toBe('Equal');
    expect(q(6, 'percent').isEqual(ce.box('y'))).toBe(undefined);
    expect(q(6, 'dB').isEqual(ce.box(6))).toBe(undefined);
    expect(q(6, 'Np').isEqual(ce.box(6))).toBe(undefined);
    expect(q('Missing', 'm').isEqual(q(6, 's'))).toBe(undefined);
    // A quantity is not a collection (its type is `quantity`): the
    // comparison with a list is element-wise, as for a number
    expect(
      ce
        .box(['Equal', Q(6, 'm'), ['List', Q(6, 'm'), Q(600, 'cm')]])
        .evaluate()
        .toString()
    ).toBe('["True","True"]');
    // A quantity with a logarithmic unit and a number
    expect(evalStr(['Equal', Q(6, 'dB'), 6])).toBe('Equal');
    expect(evalStr(['Equal', Q(1, 'dB'), Q(1, 'Np')])).toBe('Equal');
    expect(evalStr(['Equal', Q('Missing', 'm'), Q(6, 's')])).not.toBe('False');
    // `Undefined` is an absent magnitude too
    expect(q('Undefined', 'm').isEqual(q(6, 's'))).toBe(undefined);
    expect(q(6, 's').isEqual(q('Undefined', 'm'))).toBe(undefined);
    expect(q('Undefined', 'm').isEqual(ce.box(5))).toBe(undefined);
    expect(evalStr(['Equal', Q('Undefined', 'm'), Q(6, 's')])).not.toBe(
      'False'
    );
    expect(evalStr(['NotEqual', Q('Undefined', 'm'), Q(6, 's')])).not.toBe(
      'True'
    );
  });

  // Two dimensionless units compare by value
  test('two dimensionless units', () => {
    expect(q(50, 'percent').isEqual(q(500000, 'ppm'))).toBe(true);
    expect(evalStr(['Equal', Q(1, 'percent'), Q(1, 'rad')])).toBe('False');
    expect(q(1, 'percent').isLess(q(1, 'rad'))).toBe(true);
  });

  test('a filter over a list of mixed quantities', () => {
    expect(
      ce
        .box([
          'Filter',
          ['List', Q(6, 'W'), Q(6, 'm'), Q(600, 'cm')],
          ['Function', ['Equal', 'q', Q(6, 'm')], 'q'],
        ])
        .evaluate()
        .toString()
    ).toBe('[6 m,600 cm]');
  });
});

// A quantity whose unit is dimensionless and not logarithmic is compared
// with a number as a value: the number has a unit of scale 1
// (`compareQuantities()`, `src/compute-engine/library/quantity-compare.ts`).
describe('A DIMENSIONLESS QUANTITY AND A NUMBER', () => {
  const Q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ['Quantity', mag, unit] as MathJsonExpression;
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(Q(mag, unit)).evaluate();
  const str = (r: Expression) => r.symbol ?? r.toString();
  const evalStr = (x: MathJsonExpression) => str(ce.box(x).evaluate());
  const nStr = (x: MathJsonExpression) => str(ce.box(x).N());

  test('every dimensionless unit of the unit table', () => {
    expect(q(6, 'percent').isEqual(ce.box(0.06))).toBe(true);
    expect(q(2, 'ppm').isEqual(ce.box(['Rational', 2, 1000000]))).toBe(true);
    expect(q(2, 'rad').isEqual(ce.box(2))).toBe(true);
    expect(q(180, 'deg').isEqual(ce.Pi)).toBe(true);
    expect(q(100, 'grad').isEqual(ce.box(['Divide', 'Pi', 2]))).toBe(true);
    expect(q(1, 'turn').isEqual(ce.box(['Multiply', 2, 'Pi']))).toBe(true);
    expect(q(60, 'arcmin').isEqual(ce.box(['Divide', 'Pi', 180]))).toBe(true);
    expect(q(3600, 'arcsec').isEqual(ce.box(['Divide', 'Pi', 180]))).toBe(true);
    // A compound unit whose dimension is zero
    expect(q(1, ['Divide', 'm', 'km']).isEqual(ce.box(0.001))).toBe(true);
  });

  test('exact comparison of two exact values', () => {
    // `π/180 + 10⁻³⁰` is not `1 deg`, also at the working precision
    const tiny = ['Power', 10, -30] as MathJsonExpression;
    const piOver180 = ['Divide', 'Pi', 180] as MathJsonExpression;
    expect(q(1, 'deg').isEqual(ce.box(['Add', piOver180, tiny]))).toBe(false);
    expect(q(1, 'deg').isLess(ce.box(['Add', piOver180, tiny]))).toBe(true);
    expect(evalStr(['Less', Q(1, 'deg'), ['Add', piOver180, tiny]])).toBe(
      'True'
    );
    // Under `.N()` too
    expect(nStr(['Less', Q(1, 'deg'), ['Add', piOver180, tiny]])).toBe('True');
    expect(nStr(['Equal', Q(1, 'deg'), ['Add', piOver180, tiny]])).toBe(
      'False'
    );
    const half = ['Subtract', ['Rational', 1, 2], tiny] as MathJsonExpression;
    expect(nStr(['Less', Q(half, 'rad'), ['Rational', 1, 2]])).toBe('True');
    expect(nStr(['Less', ['Rational', 1, 2], Q(half, 'rad')])).toBe('False');
    // `.is()` keeps the tolerance
    expect(q(1, 'deg').is(ce.box(['Add', piOver180, tiny]))).toBe(true);
  });

  test('a JavaScript number', () => {
    expect(q(6, 'percent').is(0.06)).toBe(true);
    expect(q(6, 'percent').is(0.07)).toBe(false);
    expect(q(6, 'percent').is(0.0600000001, 1e-6)).toBe(true);
    expect(q(100, 'percent').is(1n)).toBe(true);
    expect(q(6, 'percent').isLess(0.07)).toBe(true);
    expect(q(6, 'percent').isGreater(0.05)).toBe(true);
    expect(q(6, 'percent').isLessEqual(0.06)).toBe(true);
    expect(q(6, 'm').is(6)).toBe(false);
  });

  test('`.is()` is symmetric', () => {
    expect(ce.box(0.06).is(q(6, 'percent'))).toBe(true);
    expect(ce.box(['Rational', 3, 50]).is(q(6, 'percent'))).toBe(true);
    expect(ce.Pi.is(q(180, 'deg'))).toBe(true);
    expect(ce.box(['Divide', 'Pi', 6]).is(q(30, 'deg'))).toBe(true);
    expect(ce.Pi.is(q(179, 'deg'))).toBe(false);
  });

  test('a number that is the value of an expression or of a symbol', () => {
    ce.assign('ratioValue', 0.06);
    const r = ce.box('ratioValue');
    expect(q(6, 'percent').isEqual(r)).toBe(true);
    expect(q(6, 'percent').is(r)).toBe(true);
    expect(r.is(q(6, 'percent'))).toBe(true);
    expect(q(6, 'percent').isLessEqual(r)).toBe(true);
    expect(evalStr(['Equal', Q(6, 'percent'), 'ratioValue'])).toBe('True');
    expect(q(6, 'percent').isEqual(ce.box(['Add', 0.05, 0.01]))).toBe(true);
    expect(q(6, 'percent').isLess(ce.box(['Add', 0.05, 0.02]))).toBe(true);
    expect(ce.box(['Add', 0.05, 0.02]).isGreater(q(6, 'percent'))).toBe(true);
  });

  test('a chain', () => {
    expect(evalStr(['Less', Q(6, 'percent'), 0.07, Q(8, 'percent')])).toBe(
      'True'
    );
    expect(evalStr(['Equal', Q(180, 'deg'), 'Pi', Q(0.5, 'turn')])).toBe(
      'True'
    );
    expect(evalStr(['Equal', Q(180, 'deg'), 'Pi', Q(1, 'turn')])).toBe('False');
  });

  test('Max, Min, Sort and Clamp', () => {
    // The operand is kept as it is written
    expect(evalStr(['Max', Q(6, 'percent'), 0.05])).toBe('6 percent');
    expect(evalStr(['Max', 0.05, Q(6, 'percent')])).toBe('6 percent');
    expect(nStr(['Max', Q(6, 'percent'), 0.05])).toBe('6 percent');
    expect(evalStr(['Min', Q(6, 'percent'), 0.05])).toBe('0.05');
    expect(evalStr(['Min', Q(6, 'percent'), 0.05, Q(4, 'percent')])).toBe(
      '4 percent'
    );
    expect(evalStr(['Max', 'Pi', Q(181, 'deg')])).toBe('181 deg');
    expect(
      evalStr([
        'Sort',
        ['List', Q(6, 'percent'), 0.05, Q(1, 'rad'), 'Pi', Q(90, 'deg')],
      ])
    ).toBe('[0.05,6 percent,1 rad,90 deg,pi]');
    expect(evalStr(['Clamp', Q(6, 'percent'), 0, 0.05])).toBe('0.05');
    expect(evalStr(['Clamp', 0.5, Q(10, 'percent'), Q(20, 'percent')])).toBe(
      '20 percent'
    );
    // A quantity with a dimension is not ordered against a number
    expect(evalStr(['Max', Q(6, 'm'), 0.05])).toBe('max(6 m, 0.05)');
  });

  test('a logarithmic unit is not compared with a number', () => {
    expect(evalStr(['Max', Q(6, 'dB'), 5])).toBe('max(6 dB, 5)');
    expect(q(1, 'dB').isEqual(q(1, 'Np'))).toBe(undefined);
    expect(q(1, 'dB').isEqual(q(1, 'dB'))).toBe(true);
    expect(q(1, 'dB').isLess(q(2, 'dB'))).toBe(true);
  });

  test('the parse route', () => {
    const parsed = (latex: string) => str(ce.parse(latex).evaluate());
    expect(parsed('6\\,\\mathrm{percent} = 0.06')).toBe('True');
    expect(parsed('6\\,\\mathrm{percent} < 0.07')).toBe('True');
    expect(parsed('180\\,\\mathrm{deg} = \\pi')).toBe('True');
    expect(parsed('30\\,\\mathrm{deg} = \\frac{\\pi}{6}')).toBe('True');
    expect(parsed('\\pi\\,\\mathrm{rad} = \\pi')).toBe('True');
    expect(parsed('\\max(6\\,\\mathrm{percent}, 0.05)')).toBe('6 percent');
  });
});

// A quantity whose magnitude is an expression with no unknowns is compared
// by its value on every route, as the `Equal` operator compares it.
describe('A QUANTITY WHOSE MAGNITUDE IS AN EXPRESSION', () => {
  const Q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ['Quantity', mag, unit] as MathJsonExpression;
  const q = (mag: MathJsonExpression, unit: MathJsonExpression) =>
    ce.box(Q(mag, unit));

  test('a sum of floats', () => {
    const a = q(2, 'm');
    const b = q(['Add', 1.5, 0.5], 'm');
    expect(a.isEqual(b)).toBe(true);
    expect(b.isEqual(a)).toBe(true);
    expect(a.is(b)).toBe(true);
    expect(a.isIdenticallyEqual(b)).toBe(true);
    expect(a.isLess(q(['Add', 1.5, 1], 'm'))).toBe(true);
    expect(q(['Add', 1.5, 1], 'm').isGreater(a)).toBe(true);
    expect(
      ce.box(['Equal', Q(2, 'm'), Q(['Add', 1.5, 0.5], 'm')]).evaluate().symbol
    ).toBe('True');
  });

  test('a symbol with a value', () => {
    ce.assign('magnitudeValue', 2);
    const c = q('magnitudeValue', 'm');
    expect(q(2, 'm').isEqual(c)).toBe(true);
    expect(c.isLessEqual(q(200, 'cm'))).toBe(true);
    expect(c.isLess(q(3, 'm'))).toBe(true);
  });

  test('a magnitude with an unknown is not decided', () => {
    expect(q(['Add', 3, 'x'], 'm').isEqual(q(2, 'm'))).toBe(undefined);
  });
});

// A quantity whose compound unit cancels is the plain number of its
// magnitude, as the quotient of two quantities with the same unit is.
describe('A QUANTITY WHOSE UNIT CANCELS', () => {
  test.each<[MathJsonExpression, MathJsonExpression]>([
    [['Quantity', 2, ['Divide', 'm', 'm']], 2],
    [['Quantity', 2, ['Multiply', 'm', ['Power', 'm', -1]]], 2],
    [['Quantity', 2, { str: 'm/m' }], 2],
    [['Quantity', 'Pi', ['Divide', 'rad', 'rad']], 'Pi'],
    [
      ['Quantity', ['Measurement', 2, 0.1], ['Divide', 's', 's']],
      ['Measurement', 2, 0.1],
    ],
  ])('%j', (json, expected) => {
    expect(ce.box(json).json).toEqual(expected);
  });

  test('the parse route', () => {
    expect(ce.parse('2\\,\\mathrm{m/m}').json).toEqual(2);
    expect(ce.parse('2\\,\\mathrm{m/m} = 2').evaluate().symbol).toBe('True');
  });

  test('a named or a compound dimensionless unit stays a unit', () => {
    expect(ce.box(['Quantity', 2, 'percent']).json).toEqual([
      'Quantity',
      2,
      'percent',
    ]);
    expect(ce.box(['Quantity', 2, 'rad']).operator).toBe('Quantity');
    expect(ce.box(['Quantity', 12, ['Divide', 'in', 'ft']]).json).toEqual([
      'Quantity',
      12,
      ['Divide', 'in', 'ft'],
    ]);
    // `rad·s/s` cancels to the named unit `rad`
    expect(
      ce.box(['Quantity', 2, ['Multiply', 'rad', ['Divide', 's', 's']]]).json
    ).toEqual(['Quantity', 2, 'rad']);
  });
});
