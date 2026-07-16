import { ComputeEngine } from '../../src/compute-engine';

/**
 * Stress tests for long *flat* operator chains.
 *
 * Historically, infix parselets parsed their right operand at the operator's
 * own precedence (`minPrec = prec`), which made a flat chain like `1+1+…+1`
 * right-recursive: every term added a `parseExpression → infix parselet →
 * parseExpression` stack frame, overflowing at ~1300 terms.
 *
 * `any`/`both`-associative operators (and the `Add` handler) now parse the
 * right operand at `prec + 1`, leaving same-precedence continuations to the
 * caller's infix loop. The chain is folded flat by `foldAssociativeOperator`,
 * so the parsed expression is unchanged but the stack stays bounded.
 *
 * Deeply *nested* input (`1+(1+(1+…))`) is genuinely recursive and is NOT the
 * target here — it may still overflow at extreme depth.
 */
describe('long flat operator chains parse with bounded stack', () => {
  const ce = new ComputeEngine();

  test('5000-term `+` chain parses (flat) and evaluates', () => {
    const s = Array.from({ length: 5000 }, () => '1').join('+');
    // Non-canonical keeps the flat Add head (canonical folds it to a number).
    expect(ce.parse(s, { canonical: false }).operator).toBe('Add');
    expect(ce.parse(s).evaluate().re).toBe(5000);
  });

  test('5000-term `\\times` chain parses (flat) and evaluates', () => {
    const s = Array.from({ length: 5000 }, () => '1').join('\\times ');
    expect(ce.parse(s, { canonical: false }).operator).toBe('Multiply');
    expect(ce.parse(s).evaluate().re).toBe(1);
  });

  test('5000-term `<` comparison chain parses (flat)', () => {
    const s = Array.from({ length: 5000 }, (_, i) => String(i)).join('<');
    expect(ce.parse(s, { canonical: false }).operator).toBe('Less');
  });

  test('flat `+` chain structure matches the recursive form', () => {
    // A small chain to confirm the iterative parse still produces a flat,
    // left-to-right-equivalent Add (same result as the previous right-recursive
    // fold).
    expect(ce.parse('1+2+3+4', { canonical: false }).json).toEqual([
      'Add',
      1,
      2,
      3,
      4,
    ]);
    // Mixed same-precedence add/subtract keeps its established shape.
    expect(ce.parse('1+2-3', { canonical: false }).json).toEqual([
      'Add',
      1,
      ['Subtract', 2, 3],
    ]);
    expect(ce.parse('1-2+3', { canonical: false }).json).toEqual([
      'Add',
      ['Subtract', 1, 2],
      3,
    ]);
  });
});

describe('same-precedence operator grouping', () => {
  const ce = new ComputeEngine();

  it('same-operator chains fold to flat n-ary trees', () => {
    expect(ce.parse('a \\otimes b \\otimes c', { canonical: false }).json).toEqual(
      ['CircleTimes', 'a', 'b', 'c']
    );
  });

  it('MIXED same-precedence operators group left-to-right', () => {
    // Deliberate: the conventional left-to-right reading. (Before the
    // bounded-stack parser change these nested rightward as an artifact of
    // the right-recursive descent.)
    expect(ce.parse('a \\times b \\otimes c', { canonical: false }).json).toEqual(
      ['CircleTimes', ['Multiply', 'a', 'b'], 'c']
    );
    expect(ce.parse('a \\otimes b \\times c', { canonical: false }).json).toEqual(
      ['Multiply', ['CircleTimes', 'a', 'b'], 'c']
    );
  });
});
