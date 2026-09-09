import { ComputeEngine } from '../../src/compute-engine';

/**
 * A piecewise expression with no default arm — a `Which` with no literal-`True`
 * clause, or an `If` with no else branch — keeps the type `missing | T` and the
 * value `Missing` (ruled 2026-09-09). The typing is not changed; the numeric
 * consumers that used to reject it are.
 *
 * Two families are pinned here:
 *
 * 1. Juxtaposition. `2g(0)` must read as multiplication. The operand gate in
 *    `invisible-operator.ts` asked `type.matches('number')`, which is `false`
 *    for `missing | real` because the `missing` member is not a number, so the
 *    juxtaposition silently became a `Tuple`. The gate must stay tight enough
 *    that a genuinely non-numeric operand — a string, a heterogeneous tuple —
 *    is still a `Tuple`.
 *
 * 2. Absence absorption in `Add`/`Multiply`. In a numeric slot `Missing` is
 *    normalized to `NaN` at the boundary (`docs/ERROR-MODEL.md` §3). Both
 *    operators are `lazy`, so the driver's missing-value gate saw their
 *    operands UNEVALUATED and absorbed only a `Missing` written in the source;
 *    an absence produced BY the operand evaluation survived as
 *    `Add(Missing, 1)`.
 *
 * Every case is pinned on the parse route and on the box route: a raw-MathJSON
 * `ce.box(...)` reaches the same handlers by a different path.
 */

/** An engine with `g`, a default-less piecewise: `g(t) = 0.5` when `t < 1`,
 * absent otherwise. `g(0)` is present (`0.5`), `g(3)` is absent (`Missing`). */
function engineWithPiecewise(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.parse('g(t) := \\begin{cases} 0.5 & t < 1 \\end{cases}').evaluate();
  return ce;
}

describe('default-less piecewise: the `missing | T` type', () => {
  test('types `missing | real` and evaluates to `Missing` when absent', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('g(0)').type.toString()).toBe('missing | real');
    expect(ce.parse('g(0)').evaluate().toString()).toBe('0.5');
    expect(ce.parse('g(3)').evaluate().symbol).toBe('Missing');
  });
});

describe('juxtaposition with a `missing | T` operand is a product', () => {
  test('parse route: `2g(0)`', () => {
    const ce = engineWithPiecewise();
    const expr = ce.parse('2g(0)');
    expect(expr.operator).toBe('Multiply');
    expect(expr.evaluate().toString()).toBe('1');
  });

  test('parse route: a numeric left operand — `\\sin(0)g(0)`', () => {
    const ce = engineWithPiecewise();
    const expr = ce.parse('\\sin(0)g(0)');
    expect(expr.operator).toBe('Multiply');
    expect(expr.evaluate().toString()).toBe('0');
  });

  test('box route: `InvisibleOperator(2, g(0))`', () => {
    const ce = engineWithPiecewise();
    const expr = ce.box(['InvisibleOperator', 2, ['g', 0]]);
    expect(expr.operator).toBe('Multiply');
    expect(expr.evaluate().toString()).toBe('1');
  });

  test('an explicit multiplication is unchanged', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('2\\cdot g(0)').evaluate().toString()).toBe('1');
  });

  test('an absent operand multiplies to `NaN`, not to a `Tuple`', () => {
    const ce = engineWithPiecewise();
    const expr = ce.parse('2g(3)');
    expect(expr.operator).toBe('Multiply');
    expect(expr.evaluate().toString()).toBe('NaN');
  });
});

describe('juxtaposition with a non-numeric operand stays a `Tuple`', () => {
  test('a heterogeneous (non-numeric) tuple operand', () => {
    const ce = new ComputeEngine();
    ce.declare('PT', 'tuple<number,string>');
    expect(ce.box(['InvisibleOperator', 2, 'PT']).operator).toBe('Tuple');
  });

  test('a string operand', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['InvisibleOperator', 2, ['String', 'ab']]).operator
    ).toBe('Tuple');
  });

  test('a `missing | string` operand — the gate is not merely `couldMatch`', () => {
    // A default-less piecewise over strings types `missing | string`. Setting
    // the `missing` arm aside leaves `string`, which is not a number, so the
    // juxtaposition stays a `Tuple`.
    const ce = new ComputeEngine();
    ce.parse('h(t) := \\begin{cases} "a" & t < 1 \\end{cases}').evaluate();
    expect(ce.parse('h(0)').type.toString()).toBe('missing | string');
    expect(ce.parse('2h(0)').operator).toBe('Tuple');
  });
});

describe('`Add`/`Multiply` absorb an EVALUATED `Missing` operand', () => {
  test('parse route: `g(3) + 1`', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('g(3)+1').evaluate().toString()).toBe('NaN');
  });

  test('parse route: `2 \\cdot g(3)`', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('2\\cdot g(3)').evaluate().toString()).toBe('NaN');
  });

  test('parse route: an else-less `If`', () => {
    const ce = engineWithPiecewise();
    expect(
      ce.parse('\\operatorname{If}(3 < 1, 0.5) + 1').evaluate().toString()
    ).toBe('NaN');
  });

  test('box route: `Add(g(3), 1)` and `Multiply(2, g(3))`', () => {
    const ce = engineWithPiecewise();
    expect(ce.box(['Add', ['g', 3], 1]).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Multiply', 2, ['g', 3]]).evaluate().toString()).toBe('NaN');
  });

  test('`.N()` agrees with `evaluate()`', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('g(3)+1').N().toString()).toBe('NaN');
    expect(ce.parse('2\\cdot g(3)').N().toString()).toBe('NaN');
  });

  test('a literal `Missing` operand is still absorbed', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Add', 'Missing', 1]).evaluate().toString()).toBe('NaN');
    expect(ce.box(['Multiply', 2, 'Missing']).evaluate().toString()).toBe(
      'NaN'
    );
  });

  test('Subtract, Divide, Negate and Power absorb it too', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('g(3)-1').evaluate().toString()).toBe('NaN');
    expect(ce.parse('1-g(3)').evaluate().toString()).toBe('NaN');
    expect(ce.parse('\\frac{g(3)}{2}').evaluate().toString()).toBe('NaN');
    expect(ce.parse('\\frac{2}{g(3)}').evaluate().toString()).toBe('NaN');
    expect(ce.parse('-g(3)').evaluate().toString()).toBe('NaN');
    expect(ce.parse('g(3)^2').evaluate().toString()).toBe('NaN');
  });

  test('a collection operand still broadcasts the absence per cell', () => {
    // The scalar gate stands down when an operand is collection-shaped: the
    // absence is carried through the operator's own kernel, one cell at a time.
    const ce = new ComputeEngine();
    expect(
      ce.box(['Add', 'Missing', ['List', 3, 4]]).evaluate().toString()
    ).toBe('[NaN,NaN]');
    // A `list<number>` symbol with no value yet is destined to broadcast but
    // cannot be enumerated now: the application stays symbolic.
    ce.declare('L', 'list<number>');
    expect(ce.box(['Add', 'Missing', 'L']).evaluate().operator).toBe('Add');
  });
});

describe('a `missing | T` big-operator bound is accepted', () => {
  test('parse route and box route', () => {
    const ce = engineWithPiecewise();
    const parsed = ce.parse('\\sum_{x=g(0)}^{3} x');
    expect(parsed.isValid).toBe(true);
    const boxed = ce.box(['Sum', 'x', ['Tuple', 'x', ['g', 0], 3]]);
    expect(boxed.isValid).toBe(true);
  });

  test('a provably non-numeric bound is still rejected', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box(['Sum', 'x', ['Tuple', 'x', { str: 'lo' }, 3]]);
    expect(boxed.isValid).toBe(false);
  });

  // A bound WRITTEN as an absence is a program defect and is rejected at
  // boxing, on both spellings; only a bound that EVALUATES to an absence
  // (the `g(3)` cases below) is a run-time value that answers `NaN`.
  test('a bound written as the literal NaN or the symbol Missing is rejected', () => {
    const ce = new ComputeEngine();
    for (const bound of ['NaN', 'Missing']) {
      const lower = ce.box(['Sum', 'x', ['Tuple', 'x', bound, 3]]);
      expect(lower.isValid).toBe(false);
      const upper = ce.box(['Product', 'x', ['Tuple', 'x', 1, bound]]);
      expect(upper.isValid).toBe(false);
    }
    expect(ce.parse('\\sum_{x=\\mathrm{NaN}}^{3} x').isValid).toBe(false);
  });

  // A bound that EVALUATES to `Missing` is a numeric slot holding an absence:
  // the operator answers `NaN` instead of staying unevaluated as it does for a
  // free symbol. Both bounds, both operators, exact and numeric evaluation.
  test('an absent lower bound makes the sum NaN (parse route)', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('\\sum_{x=g(3)}^{3} x').evaluate().toString()).toBe('NaN');
    expect(ce.parse('\\sum_{x=g(3)}^{3} x').N().toString()).toBe('NaN');
  });

  test('an absent upper bound makes the product NaN (box route)', () => {
    const ce = engineWithPiecewise();
    const sum = ce.box(['Product', 'x', ['Tuple', 'x', 1, ['g', 3]]]);
    expect(sum.evaluate().toString()).toBe('NaN');
    expect(sum.N().toString()).toBe('NaN');
  });

  test('a present bound from the same piecewise still enumerates', () => {
    const ce = engineWithPiecewise();
    // g(0) = 0.5, and a big operator walks the integer grid from its lower
    // bound: x = 1, 2, 3, the same as the literal bound 0.5.
    expect(ce.parse('\\sum_{x=g(0)}^{3} x').evaluate().toString()).toBe('6');
    expect(ce.parse('\\sum_{x=0.5}^{3} x').evaluate().toString()).toBe('6');
  });

  test('a free symbolic bound still stays unevaluated', () => {
    const ce = engineWithPiecewise();
    expect(ce.parse('\\sum_{x=n}^{3} x').evaluate().operator).toBe('Sum');
  });
});

describe('an absence does not outrank an error or a non-numeric operand', () => {
  test('a string operand next to an absent one is still a type error', () => {
    const ce = engineWithPiecewise();
    ce.declare('S', 'unknown');
    ce.assign('S', ce.string('abc'));
    for (const expr of [
      ce.box(['Add', ['g', 3], 'S']),
      ce.box(['Multiply', 'S', ['g', 3]]),
    ]) {
      const r = expr.evaluate();
      expect(r.operator).toBe('Error');
      expect(r.toString()).not.toBe('NaN');
    }
  });
});
