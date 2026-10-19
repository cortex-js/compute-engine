import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const ce = new ComputeEngine();

// Two quantities with units of the same dimension compare by their physical
// value on every route: the methods `isEqual()`, `is()`,
// `isIdenticallyEqual()`, `isLess()`, `isLessEqual()`, `isGreater()`, and
// the operators `Equal`, `NotEqual`, `Less`, `IdenticallyEqual`. All of them
// use `compareQuantities()` (`src/compute-engine/library/quantity-compare.ts`).
// Two quantities with units of different dimensions (`6 W` and `6 m`) are
// not decided: the methods answer `undefined` and the operators stay
// unevaluated.

type Verdict = 'equal' | 'less' | 'greater' | 'undecided';

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
    verdict: 'undecided',
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
  const decided = verdict !== 'undecided';
  const eq = verdict === 'equal';
  const lt = verdict === 'less';
  const gt = verdict === 'greater';
  const bool = (x: boolean) => (decided ? x : undefined);
  const sym = (x: boolean) => (decided ? (x ? 'True' : 'False') : 'inert');
  return {
    isEqual: bool(eq),
    is: eq,
    isIdenticallyEqual: bool(eq),
    isLess: bool(lt),
    isLessEqual: bool(lt || eq),
    isGreater: bool(gt),
    isGreaterEqual: bool(gt || eq),
    Equal: sym(eq),
    NotEqual: sym(!eq),
    Less: sym(lt),
    LessEqual: sym(lt || eq),
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

  // Two big decimal floats are ordered by all their digits with no
  // tolerance (`Sort`), and are equal within the tolerance (`isEqual`)
  test('big decimal magnitudes', () => {
    const a = Q({ num: '1.00000000000000000001' }, 'm');
    const b = Q({ num: '1.00000000000000000002' }, 'm');
    expect(evalStr(['Min', b, a])).toBe(evalStr(a));
    expect(evalStr(['Max', a, b])).toBe(evalStr(b));
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

  // The angle units (scale `π/180`…) and `Da` (a measured scale) have no
  // exact conversion: the tolerance decides
  test('units with a scale that is not an exact decimal', () => {
    expect(q(180, 'deg').isEqual(q('Pi', 'rad'))).toBe(true);
    expect(q(1, 'Da').isEqual(q(1.6605390666e-27, 'kg'))).toBe(true);
  });
});
