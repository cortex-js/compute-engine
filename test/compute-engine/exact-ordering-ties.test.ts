import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { exactOrder } from '../../src/compute-engine/boxed-expression/compare';
import { BigDecimal } from '../../src/big-decimal';

// When the working precision does not decide the order of two constants,
// `exactOrder` tries, in this order: (1) the same comparison at 50 digits,
// (2) a symbolic proof that they are equal (`a − b` or `b − a` simplifies to
// 0), (3) for `Max`, `Min`, `Clamp` and `Sort` only, a tie when the two values
// agree within the engine tolerance. Step 3 gives a tie (`0`), never an
// order. Every true value below is checked at a higher precision.

const ce = new ComputeEngine();

function evaluate(expr: MathJsonExpression | string): Expression {
  return (typeof expr === 'string' ? ce.parse(expr) : ce.box(expr)).evaluate();
}

/** The value of `expr` at `precision` digits, as a string. */
function valueAt(precision: number, expr: MathJsonExpression): string {
  const e = new ComputeEngine({ precision });
  try {
    return e.box(expr).N().toString();
  } finally {
    // Constructing an engine sets the global precision of big decimals.
    // Setting the precision of the shared engine to its current value does
    // not reset it, so it is set to another value first.
    ce.precision = 30;
    ce.precision = 'auto';
  }
}

const LN6: MathJsonExpression = ['Ln', 6];
const LN2_LN3: MathJsonExpression = ['Add', ['Ln', 2], ['Ln', 3]];
const PYTHAGORAS: MathJsonExpression = [
  'Add',
  ['Power', ['Sin', 1], 2],
  ['Power', ['Cos', 1], 2],
];
const ZERO_SUM: MathJsonExpression = ['Subtract', LN2_LN3, ['Ln', 6]];
const SQRT2_PLUS: MathJsonExpression = ['Sqrt', ['Add', 2, ['Power', 10, -30]]];
// cos(10⁻²⁰) − 1 = −5·10⁻⁴¹
const COS_20: MathJsonExpression = ['Subtract', ['Cos', ['Power', 10, -20]], 1];
// cos(10⁻³⁰) − 1 = −5·10⁻⁶¹: not decided at 50 digits.
const COS_30: MathJsonExpression = ['Subtract', ['Cos', ['Power', 10, -30]], 1];

describe('STEP 2: EQUAL CONSTANTS ARE A PROVED TIE', () => {
  test('the order is 0', () => {
    expect(exactOrder(evaluate(LN6), evaluate(LN2_LN3))).toBe(0);
    expect(exactOrder(evaluate(LN2_LN3), evaluate(LN6))).toBe(0);
    expect(exactOrder(evaluate(PYTHAGORAS), ce.One)).toBe(0);
    expect(exactOrder(evaluate(ZERO_SUM), ce.Zero)).toBe(0);
  });

  test('Sort is stable: a tie keeps the order of the input', () => {
    for (const [a, b] of [
      [LN6, LN2_LN3],
      [LN2_LN3, LN6],
    ]) {
      const sorted = evaluate(['Sort', ['List', a, b]]);
      expect(sorted.operator).toBe('List');
      expect(sorted.ops![0].isSame(evaluate(a))).toBe(true);
      expect(sorted.ops![1].isSame(evaluate(b))).toBe(true);
    }
    expect(
      evaluate('\\operatorname{Sort}([\\ln 6, \\ln 2 + \\ln 3])').toString()
    ).toBe('[ln(6),ln(2) + ln(3)]');
  });

  test('Max and Min: of two equal values, the number literal', () => {
    expect(evaluate(['Max', PYTHAGORAS, 1]).toString()).toBe('1');
    expect(evaluate(['Max', 1, PYTHAGORAS]).toString()).toBe('1');
    expect(evaluate(['Min', PYTHAGORAS, 1]).toString()).toBe('1');
    expect(evaluate('\\max(\\sin^2 1 + \\cos^2 1, 1)').toString()).toBe('1');
    expect(evaluate(['Max', ZERO_SUM, 0]).toString()).toBe('0');
    expect(evaluate(['Max', 0, ZERO_SUM]).toString()).toBe('0');
    expect(evaluate('\\max(\\ln 2 + \\ln 3 - \\ln 6, 0)').toString()).toBe('0');
  });

  test('Max and Min: of two equal non-literals, the first', () => {
    expect(evaluate(['Min', LN6, LN2_LN3]).isSame(evaluate(LN6))).toBe(true);
    expect(evaluate(['Max', LN2_LN3, LN6]).isSame(evaluate(LN2_LN3))).toBe(
      true
    );
    expect(evaluate('\\min(\\ln 6, \\ln 2 + \\ln 3)').toString()).toBe('ln(6)');
  });

  test('inside a simplification, no endless recursion', () => {
    const s = ce
      .parse('\\max(\\ln 6, \\ln 2 + \\ln 3) + \\min(\\sin^2 1 + \\cos^2 1, 1)')
      .simplify();
    expect(s.N().re).toBeCloseTo(Math.log(6) + 1, 12);
    const abs = ce.parse('|\\ln 2 + \\ln 3 - \\ln 6| + x').simplify();
    expect(abs.toString()).toBe('x');
  });
});

describe('STEP 1: A HIGHER PRECISION DECIDES CLOSE CONSTANTS', () => {
  test('√(2 + 10⁻³⁰) is larger than √2', () => {
    // An independent check: the difference at 60 digits is 3.5·10⁻³¹.
    const d = valueAt(60, ['Subtract', SQRT2_PLUS, ['Sqrt', 2]]);
    expect(d.startsWith('3.5355339059327376')).toBe(true);
    expect(d.endsWith('e-31')).toBe(true);
    expect(exactOrder(evaluate(SQRT2_PLUS), evaluate(['Sqrt', 2]))).toBe(1);
    expect(
      evaluate(['Max', SQRT2_PLUS, ['Sqrt', 2]]).isSame(evaluate(SQRT2_PLUS))
    ).toBe(true);
    expect(
      evaluate(['Max', ['Sqrt', 2], SQRT2_PLUS]).isSame(evaluate(SQRT2_PLUS))
    ).toBe(true);
    expect(evaluate(['Min', SQRT2_PLUS, ['Sqrt', 2]]).toString()).toBe(
      'sqrt(2)'
    );
  });

  test('cos(10⁻²⁰) − 1 is negative', () => {
    expect(valueAt(60, COS_20)).toBe('-5e-41');
    expect(exactOrder(evaluate(COS_20), ce.Zero)).toBe(-1);
    expect(evaluate(['Max', COS_20, 0]).toString()).toBe('0');
    expect(evaluate(['Max', 0, COS_20]).toString()).toBe('0');
    expect(evaluate(['Min', COS_20, 0]).isSame(evaluate(COS_20))).toBe(true);
  });

  // A number literal made at machine precision keeps a machine value at a
  // higher precision, so step 1 is not done at machine precision: the order
  // would be read from doubles with the error bound of 50 digits. The two
  // square roots are then a tie within the tolerance (step 3), and `Max`
  // prefers the number literal `√2` to the function `√(2 + 10⁻³⁰)`. This is
  // a tie, not the true maximum: the documented cost of step 3.
  test('not at machine precision', () => {
    const e = new ComputeEngine({ precision: 'machine' });
    try {
      const a = e.box(SQRT2_PLUS).evaluate();
      const b = e.box(['Sqrt', 2]).evaluate();
      expect(exactOrder(a, b)).toBeUndefined();
      expect(exactOrder(a, b, { tieWithinTolerance: true })).toBe(0);
      expect(exactOrder(b, a, { tieWithinTolerance: true })).toBe(0);
      expect(
        e
          .box(['Max', SQRT2_PLUS, ['Sqrt', 2]])
          .evaluate()
          .isSame(b)
      ).toBe(true);
      // Step 2 is done at machine precision.
      expect(e.box(['Max', ZERO_SUM, 0]).evaluate().toString()).toBe('0');
    } finally {
      ce.precision = 30;
      ce.precision = 'auto';
    }
  });

  test('the precision and the tolerance are restored', () => {
    const e = new ComputeEngine();
    e.tolerance = 1e-8;
    const precision = e.precision;
    const bigDecimalPrecision = BigDecimal.precision;
    expect(
      exactOrder(e.box(SQRT2_PLUS).evaluate(), e.box(['Sqrt', 2]).evaluate())
    ).toBe(1);
    expect(e.precision).toBe(precision);
    expect(e.tolerance).toBe(1e-8);
    expect(BigDecimal.precision).toBe(bigDecimalPrecision);
    // The value of π is computed at the working precision again.
    expect(e.box('Pi').N().toString()).toBe(
      new ComputeEngine().box('Pi').N().toString()
    );
  });
});

// Step 1 raises the precision without the `precision` setter of the engine,
// which resets the engine (every cached value is discarded and the cache
// axes advance). Before, each pair that reached step 1 reset the engine
// twice.
describe('STEP 1 DOES NOT RESET THE ENGINE', () => {
  test('no advance of the cache axis', () => {
    const e = new ComputeEngine();
    const max = e.box(['Max', SQRT2_PLUS, ['Sqrt', 2]]);
    const before = e._anyVersion;
    const result = max.evaluate();
    // The maximum is decided by step 1
    expect(result.isSame(e.box(SQRT2_PLUS).evaluate())).toBe(true);
    expect(e._anyVersion - before).toBe(0);
  });

  test('the value of π is read at the raised precision', () => {
    // π − 314159265358979323846264338327/10²⁹ = 9.5·10⁻³⁰: not decided at
    // 21 digits, and decided at 50 digits. The engine keeps π with the
    // digits of the working precision (and a few more), which are fewer
    // than 30: read from the engine, π would be smaller than the fraction.
    const r: MathJsonExpression = [
      'Divide',
      { num: '314159265358979323846264338327' },
      ['Power', 10, 29],
    ];
    expect(valueAt(60, ['Subtract', 'Pi', r]).startsWith('9.502884')).toBe(
      true
    );
    const e = new ComputeEngine();
    const fraction = e.box(r).evaluate();
    expect(exactOrder(e.box('Pi'), fraction)).toBe(1);
    expect(exactOrder(fraction, e.box('Pi'))).toBe(-1);
    expect(e.box(['Max', 'Pi', r]).evaluate().toString()).toBe('pi');
    expect(e.box(['Max', r, 'Pi']).evaluate().toString()).toBe('pi');
  });

  test('the precision of the engine is raised, not only of the big decimals', () => {
    // sin(314159265358979323846264338327950289/10³⁵) = −5.8·10⁻³⁶. The
    // evaluation of `sin` rounds a value smaller than its rounding error at
    // the precision of the ENGINE to 0: with only the precision of the big
    // decimals raised, the order is not decided.
    const sin: MathJsonExpression = [
      'Sin',
      [
        'Divide',
        { num: '314159265358979323846264338327950289' },
        ['Power', 10, 35],
      ],
    ];
    expect(valueAt(60, sin).startsWith('-5.8028306')).toBe(true);
    const e = new ComputeEngine();
    const a = e.box(sin).evaluate();
    const b = e.box(['Negate', ['Power', 10, -40]]).evaluate();
    expect(exactOrder(a, b)).toBe(-1);
    expect(exactOrder(b, a)).toBe(1);
  });

  test('the precision and the tolerance are restored after a throw', () => {
    const e = new ComputeEngine();
    e.tolerance = 1e-8;
    const precision = e.precision;
    const bigDecimalPrecision = BigDecimal.precision;
    // A constant whose value is computed by a host function, which throws
    // at a precision higher than 30 digits: step 1 computes the values of
    // the constants again at 50 digits.
    e.declare('Boom', {
      isConstant: true,
      holdUntil: 'N',
      type: 'real',
      value: (engine) => {
        if (engine.precision > 30) throw new Error('boom');
        return engine.number(engine.bignum(2));
      },
    });
    const a = e.box(['Sqrt', ['Add', 'Boom', ['Power', 10, -30]]]).evaluate();
    const b = e.box(['Sqrt', 2]).evaluate();
    expect(() => exactOrder(a, b)).toThrow('boom');
    expect(e.precision).toBe(precision);
    expect(e.tolerance).toBe(1e-8);
    expect(BigDecimal.precision).toBe(bigDecimalPrecision);
    // The value of the constant is still the one at the working precision.
    expect(e.box('Boom').N().toString()).toBe('2');
    // Step 1 is done again after the throw.
    expect(
      exactOrder(e.box(SQRT2_PLUS).evaluate(), e.box(['Sqrt', 2]).evaluate())
    ).toBe(1);
  });

  test('a value of a constant read at the raised precision is not stored', () => {
    // The engine stores the value of a constant when it is built, and again
    // on the first read after a reset (here, a change of the angular unit).
    // A first read inside `_withTransientPrecision` must not store the value
    // at the raised precision: it would then be read at the working
    // precision.
    const expected = new ComputeEngine().box('Pi').N().json;
    const e = new ComputeEngine();
    e.angularUnit = 'deg';
    e.angularUnit = 'rad';
    const raised = e._withTransientPrecision(50, () => e.box('Pi').N().json);
    expect(raised).not.toEqual(expected);
    expect(e.box('Pi').N().json).toEqual(expected);
  });

  test('a symbol whose value is a symbol whose value is π', () => {
    // The chain is kept: the value of `x` is the symbol `y`, and the value
    // of `y` is `Pi`. The value of `x` is read at the raised precision.
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('y', 'real');
    e.assign('y', e.symbol('Pi'));
    e.assign('x', e.symbol('y'));
    expect(e.symbol('x').value?.json).toBe('y');
    const r: MathJsonExpression = [
      'Divide',
      { num: '314159265358979323846264338327' },
      ['Power', 10, 29],
    ];
    const fraction = e.box(r).evaluate();
    expect(exactOrder(e.symbol('x'), fraction)).toBe(1);
    expect(exactOrder(fraction, e.symbol('x'))).toBe(-1);
  });

  test('also during a computation that holds a scratch scope', () => {
    // A computation registers the scopes it will pop in
    // `_scratchDeclarationScopes`. Step 1 was skipped while the list was
    // not empty when it reset the engine, because the reset clears the
    // list. Without a reset, the list does not change.
    const e = new ComputeEngine();
    const scope = {};
    e._scratchDeclarationScopes.push(scope);
    try {
      expect(
        exactOrder(e.box(SQRT2_PLUS).evaluate(), e.box(['Sqrt', 2]).evaluate())
      ).toBe(1);
      expect(e._scratchDeclarationScopes).toEqual([scope]);
    } finally {
      e._scratchDeclarationScopes.pop();
    }
  });
});

describe('STEP 3: A TIE WITHIN THE TOLERANCE, NEVER AN ORDER', () => {
  test('cos(10⁻³⁰) − 1 and 0', () => {
    expect(valueAt(90, COS_30)).toBe('-5e-61');
    const x = evaluate(COS_30);
    // Not decided at 50 digits, and not proved equal
    expect(exactOrder(x, ce.Zero)).toBeUndefined();
    expect(exactOrder(ce.Zero, x)).toBeUndefined();
    // A tie, not an order
    expect(exactOrder(x, ce.Zero, { tieWithinTolerance: true })).toBe(0);
    expect(exactOrder(ce.Zero, x, { tieWithinTolerance: true })).toBe(0);
    // `Max` and `Min` prefer the literal of a tie
    expect(evaluate(['Max', COS_30, 0]).toString()).toBe('0');
    expect(evaluate(['Min', 0, COS_30]).toString()).toBe('0');
    // `Abs` reads a sign, and does not accept a tie within the tolerance
    expect(evaluate(['Abs', COS_30]).operator).toBe('Abs');
  });

  test('two values farther apart than the tolerance are not a tie', () => {
    // Γ has no error bound: the order of Γ(1/3) ≈ 2.679 against 3 is not
    // known, and the two values are not within the tolerance.
    const g = evaluate(['Gamma', ['Rational', 1, 3]]);
    expect(exactOrder(g, ce.number(3), { tieWithinTolerance: true })).toBe(
      undefined
    );
  });

  test('a complex value is never a tie', () => {
    expect(
      exactOrder(
        ce.parse('i\\pi'),
        ce.parse('i\\cdot 3.14159265358979323846264338327950288'),
        { tieWithinTolerance: true }
      )
    ).toBeUndefined();
  });
});

describe('A SYMBOL VALUE READ INSIDE THE TRANSIENT WINDOW IS NOT STORED', () => {
  // The memo of a symbol's value is keyed on the world version, which the
  // transient precision window does not advance: a value computed at the
  // raised precision must not be served at the working precision afterwards.
  test('x := 2π read inside the window keeps its working-precision value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', ce.parse('2\\pi'));
    (ce as any)._withTransientPrecision(50, () => ce.box('x').N());
    const clean = new ComputeEngine();
    clean.assign('x', clean.parse('2\\pi'));
    expect(ce.box('x').N().json).toEqual(clean.box('x').N().json);
  });
});

describe('THE EQUALITY PROOF IS SYMMETRIC', () => {
  // `simplify()` reduces `(sin²1 + cos²1) − 1` to 0 but not `1 − sin²1 −
  // cos²1`, and `ln 8 − 3 ln 2` but not `3 ln 2 − ln 8`: the proof tries both
  // differences, so the order of the operands does not decide the answer.
  for (const [a, b] of [
    ['\\sin^2 1+\\cos^2 1', '1'],
    ['\\ln 8', '3\\ln 2'],
  ])
    test(`${a} and ${b} are a tie in both orders`, () => {
      const x = ce.parse(a);
      const y = ce.parse(b);
      expect(exactOrder(x, y)).toBe(0);
      expect(exactOrder(y, x)).toBe(0);
    });
});
