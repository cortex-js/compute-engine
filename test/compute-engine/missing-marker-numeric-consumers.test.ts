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

describe('the arithmetic methods read an absent operand as NaN', () => {
  // User decision of 2026-09-25: arithmetic with an absent operand is `NaN`.
  // The `Add`/`Multiply` operators already answered `NaN`, but the
  // `.add()`/`.mul()`/`.div()` methods kept the symbol:
  // `Missing.add(1)` was `"Missing" + 1` and `Missing.mul(2)` was
  // `2·"Missing"`.
  const ce = new ComputeEngine();
  const box = (x: any) => ce.box(x);

  test.each(['Missing', 'Undefined'])('%s', (absent) => {
    const m = box(absent);
    const s = (e: any) => e.toString();
    expect(s(m.add(box(1)))).toBe('NaN');
    expect(s(m.add(1))).toBe('NaN');
    expect(s(m.add(0))).toBe('NaN');
    expect(s(box(1).add(m))).toBe('NaN');
    expect(s(box(0).add(m))).toBe('NaN');
    expect(s(box('x').add(m))).toBe('NaN');
    expect(s(m.sub(box(1)))).toBe('NaN');
    expect(s(box(1).sub(m))).toBe('NaN');
    expect(s(m.mul(box(2)))).toBe('NaN');
    expect(s(m.mul(2))).toBe('NaN');
    expect(s(m.mul(1))).toBe('NaN');
    expect(s(m.mul(0))).toBe('NaN');
    expect(s(m.mul(-1))).toBe('NaN');
    expect(s(box(1).mul(m))).toBe('NaN');
    expect(s(box(-1).mul(m))).toBe('NaN');
    expect(s(box('x').mul(m))).toBe('NaN');
    expect(s(box(['Add', 'x', 1]).mul(m))).toBe('NaN');
    expect(s(m.div(box(2)))).toBe('NaN');
    expect(s(box(2).div(m))).toBe('NaN');
    // The same answers as the operators.
    expect(s(box(['Add', absent, 1]).evaluate())).toBe('NaN');
    expect(s(box(['Multiply', 2, absent]).evaluate())).toBe('NaN');
  });

  test('beside a point, the whole point is absent', () => {
    // A tuple is atomic: there is no cell for the absence to land in, so the
    // result is `Missing`, as the operators answer. `Missing · (1, 2)` was the
    // half-absent point `("Missing", NaN)`.
    const p = box(['Tuple', 1, 2]);
    for (const absent of ['Missing', 'Undefined']) {
      const m = box(absent);
      expect(m.mul(p).toString()).toBe('"Missing"');
      expect(p.mul(m).toString()).toBe('"Missing"');
      expect(m.add(p).toString()).toBe('"Missing"');
      expect(p.add(m).toString()).toBe('"Missing"');
      expect(p.div(m).toString()).toBe('"Missing"');
      expect(
        box(['Multiply', absent, ['Tuple', 1, 2]])
          .evaluate()
          .toString()
      ).toBe('"Missing"');
    }
    // The `Divide` operator answers the same: it stayed unevaluated.
    expect(
      box(['Divide', ['Tuple', 1, 2], 'Missing'])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('beside a list, each cell is NaN', () => {
    const l = box(['List', 1, 2]);
    expect(box('Missing').mul(l).toString()).toBe('[NaN,NaN]');
    expect(l.add(box('Missing')).toString()).toBe('[NaN,NaN]');
    // A list symbol with no value yet keeps the sum and the product inert.
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<number>');
    expect(ce2.box('Missing').add(ce2.box('L')).operator).toBe('Add');
    expect(ce2.box('Missing').mul(ce2.box('L')).operator).toBe('Multiply');
  });
});

describe('canonicalization does not fold an absent operand out of arithmetic', () => {
  // User decision of 2026-09-25. Removing an identity element (`+ 0`, `· 1`,
  // `/ 1`) or cancelling (`a/a`, `-(-a)`) turned the arithmetic into the
  // absent value itself: `Multiply(Missing, 1)` canonicalized to `Missing`
  // while `Multiply(Missing, 2)` evaluated to `NaN`.
  const ce = new ComputeEngine();

  test.each([
    ['Multiply', 'Missing', 1],
    ['Multiply', 1, 'Undefined'],
    ['Multiply', 'Missing', -1, -1],
    ['Multiply', 0, 2, 'Missing'],
    ['Add', 'Missing', 0],
    ['Add', 'Undefined', 0],
    ['Add', 'Missing', 1, -1],
    ['Subtract', 'Missing', 0],
    ['Divide', 'Missing', 1],
    ['Divide', 'Undefined', 1],
    ['Divide', 'Missing', 'Missing'],
    ['Divide', 0, 'Missing'],
    ['Divide', 'Missing', 2],
    ['Negate', ['Negate', 'Missing']],
  ])('%j is NaN', (...json) => {
    const e = ce.box(json as any);
    expect(e.toString()).toBe('NaN');
    expect(e.evaluate().toString()).toBe('NaN');
    expect(e.N().toString()).toBe('NaN');
  });

  test.each([
    ['\\operatorname{Missing}+0'],
    ['\\operatorname{Missing}\\cdot 1'],
    ['\\frac{\\operatorname{Missing}}{1}'],
    ['\\operatorname{Missing}-0'],
  ])('parse route: %s is NaN', (latex) => {
    expect(ce.parse(latex).evaluate().toString()).toBe('NaN');
  });

  test('a product or a sum that is not folded keeps its operands', () => {
    // These are not identity folds: the node stays, and evaluation answers
    // `NaN`.
    for (const json of [
      ['Multiply', 2, 'Missing'],
      ['Add', 'Missing', 'x'],
      ['Negate', 'Missing'],
    ]) {
      const e = ce.box(json as any);
      expect(e.toString()).not.toBe('NaN');
      expect(e.evaluate().toString()).toBe('NaN');
    }
    // A list divided by an absent value keeps its shape.
    expect(
      ce
        .box(['Divide', ['List', 1, 2], 'Missing'])
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN]');
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
