import type { MathJsonExpression } from '../../src/math-json/types';
import type { Expression } from '../../src/compute-engine/global-types';
import { ComputeEngine } from '../../src/compute-engine';
import { exactOrder } from '../../src/compute-engine/boxed-expression/compare';
import { BigDecimal } from '../../src/big-decimal';

// When the working precision does not decide the order of two constants,
// `exactOrder` tries, in this order: (1) a symbolic proof that they are
// equal (`a − b` simplifies to 0), (2) the same comparison at 50 digits,
// (3) for `Max`, `Min`, `Clamp` and `Sort` only, a tie when the two values
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

describe('STEP 1: EQUAL CONSTANTS ARE A PROVED TIE', () => {
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

describe('STEP 2: A HIGHER PRECISION DECIDES CLOSE CONSTANTS', () => {
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
  // higher precision, so step 2 is not done at machine precision: the order
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
      // Step 1 is done at machine precision.
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
