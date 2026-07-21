import { ComputeEngine } from '../../src/compute-engine';

/**
 * Desmos list filtering `L[condition]` — see
 * docs/plans/2026-07-07-desmos-list-filtering.md.
 *
 * The mechanism: relational operators broadcast element-wise over a list
 * operand (T1) producing a `list<boolean>` mask, which `At`'s boolean-mask
 * mode (Case B) then applies positionally (T2). LaTeX round-trips through the
 * subscript `At` serializer (T3).
 */

// §D6.1 shape-aware lift: shape-known operands now yield dimensioned static types.
describe('T1 — relational operators broadcast over lists', () => {
  const ce = new ComputeEngine();

  test('literal list > scalar (box form) broadcasts to a boolean list', () => {
    const expr = ce.box(['Greater', ['List', -1, 2, -3], 0]);
    expect(expr.type.toString()).toBe('list<boolean^3>');
    expect(expr.evaluate().toString()).toBe('["False","True","False"]');
  });

  test('parsed list > scalar (tensor-boxed) broadcasts to a boolean list', () => {
    const expr = ce.parse('[-1,2,-3]>0');
    expect(expr.type.toString()).toBe('list<boolean^3>');
    expect(expr.evaluate().toString()).toBe('["False","True","False"]');
  });

  test('Less/LessEqual/GreaterEqual broadcast', () => {
    expect(ce.box(['Less', ['List', -1, 2, -3], 0]).evaluate().toString()).toBe(
      '["True","False","True"]'
    );
    expect(
      ce.box(['LessEqual', ['List', -1, 0, 2], 0]).evaluate().toString()
    ).toBe('["True","True","False"]');
    expect(
      ce.box(['GreaterEqual', ['List', -1, 0, 2], 0]).evaluate().toString()
    ).toBe('["False","True","True"]');
  });

  test('broadcast over a broadcast-expression operand (|[1...5]-2|>0)', () => {
    // The operand `Abs(Range - 2)` only becomes a collection at evaluate; the
    // lazy comparison handler re-broadcasts once its operands are evaluated.
    expect(ce.parse('|[1...5]-2|>0').evaluate().toString()).toBe(
      '["True","False","True","True","True"]'
    );
  });

  test('list-vs-list comparison broadcasts element-wise', () => {
    expect(
      ce
        .box(['Greater', ['List', 3, 1, 4], ['List', 2, 2, 2]])
        .evaluate()
        .toString()
    ).toBe('["True","False","True"]');
  });

  test('scalar comparisons are unchanged', () => {
    expect(ce.parse('1>2').evaluate().toString()).toBe('"False"');
    expect(ce.parse('2>1').evaluate().toString()).toBe('"True"');
    expect(ce.box(['Less', 1, 2, 3]).evaluate().toString()).toBe('"True"');
    expect(ce.box(['Less', 3, 2, 1]).evaluate().toString()).toBe('"False"');
  });

  test('symbolic comparisons stay symbolic', () => {
    const expr = ce.parse('x>0');
    expect(expr.type.toString()).toBe('boolean');
    expect(expr.evaluate().toString()).toBe('0 < x');
  });
});

// §D6.1 shape-aware lift: shape-known operands now yield dimensioned static types.
describe('T1 — Equal/NotEqual: list-vs-scalar broadcasts, list-vs-list stays scalar', () => {
  const ce = new ComputeEngine();

  test('Equal(list, scalar) broadcasts (Desmos d=4)', () => {
    const expr = ce.box(['Equal', ['List', 1, 4, 4], 4]);
    expect(expr.type.toString()).toBe('list<boolean^3>');
    expect(expr.evaluate().toString()).toBe('["False","True","True"]');
  });

  test('NotEqual(list, scalar) broadcasts', () => {
    expect(
      ce.box(['NotEqual', ['List', 1, 4, 4], 4]).evaluate().toString()
    ).toBe('["True","False","False"]');
  });

  test('whole-list Equal stays a scalar boolean', () => {
    expect(
      ce.box(['Equal', ['List', 1, 2, 3], ['List', 1, 2, 3]]).evaluate().toString()
    ).toBe('"True"');
    expect(
      ce.box(['Equal', ['List', 1, 2, 3], ['List', 1, 2, 4]]).evaluate().toString()
    ).toBe('"False"');
  });

  test('tuple/point equality is unaffected', () => {
    expect(
      ce.box(['Equal', ['Tuple', 1, 2], ['Tuple', 1, 2]]).evaluate().toString()
    ).toBe('"True"');
    expect(
      ce.box(['Equal', ['Tuple', 1, 2], ['Tuple', 1, 3]]).evaluate().toString()
    ).toBe('"False"');
  });
});

describe('T2 — L[condition] end-to-end filtering', () => {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', -1, 2, -3, 4]));

  test('L[L>0] validates and evaluates', () => {
    const expr = ce.parse('L[L>0]');
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('[2,4]');
  });

  test('L[d=4] with d a list', () => {
    ce.assign('d', ce.box(['List', 3, 4, 4, 5]));
    const expr = ce.parse('L[d=4]');
    expect(expr.isValid).toBe(true);
    // d=4 masks positions where d equals 4 → L positions 2 and 3.
    expect(expr.evaluate().toString()).toBe('[2,-3]');
  });

  test('literal list filter [-1,2,-3,4][[-1,2,-3,4]>0]', () => {
    expect(ce.parse('[-1,2,-3,4][[-1,2,-3,4]>0]').evaluate().toString()).toBe(
      '[2,4]'
    );
  });

  test('positional Range mask (remove pattern) with concrete length', () => {
    // remove(L, i) = L[|[1...length(L)]-i|>0] — the i-th element removed.
    // Case B (boolean mask) fires; the mask is computed from a Range, not from L.
    expect(ce.parse('[10,20,30][|[1...3]-2|>0]').evaluate().toString()).toBe(
      '[10,30]'
    );
    expect(
      ce.parse('[10,20,30,40][|[1...4]-3|>0]').evaluate().toString()
    ).toBe('[10,20,40]');
  });

  test('At boolean-mask mode is reached for the broadcast condition', () => {
    const expr = ce.box([
      'At',
      ['List', 10, 20, 30],
      ['Greater', ['List', -1, 2, -3], 0],
    ]);
    expect(expr.evaluate().toString()).toBe('[20]');
  });

  test('mask alignment: CE truncates to the shorter of list/mask', () => {
    // Mask longer than the list: extra entries past the end contribute nothing.
    expect(
      ce.box(['At', ['List', 10, 20], ['List', 'True', 'True', 'True']]).evaluate().toString()
    ).toBe('[10,20]');
    // Mask shorter than the list: the uncovered tail is dropped.
    expect(
      ce.box(['At', ['List', 10, 20, 30], ['List', 'True', 'False']]).evaluate().toString()
    ).toBe('[10]');
  });
});

describe('T2 — exactness contract', () => {
  const ce = new ComputeEngine();
  ce.assign('R', ce.box(['List', ['Rational', 1, 2], ['Rational', -3, 2], ['Rational', 5, 2]]));

  test('filtering preserves exact rational elements under evaluate', () => {
    const expr = ce.parse('R[R>0]');
    const v = expr.evaluate();
    expect(v.toString()).toBe('[1/2,5/2]');
    expect(v.ops![0].type.toString()).toBe('finite_rational');
  });

  test('a filtered exact element numericizes under .N()', () => {
    // A plain List does not propagate .N() to its elements (uniform CE
    // behavior), but each element is a genuine exact number that numericizes
    // when taken individually.
    const elt = ce.parse('R[R>0]').evaluate().ops![0];
    expect(elt.toString()).toBe('1/2');
    expect(elt.N().toString()).toBe('0.5');
  });
});

describe('T3 — LaTeX round-trip for filter shapes', () => {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', -1, 2, -3, 4]));

  test('L[L>0] round-trips through the At subscript serializer', () => {
    const expr = ce.parse('L[L>0]');
    const latex = expr.toLatex();
    expect(ce.parse(latex).isSame(expr)).toBe(true);
  });

  test('L[d=4] round-trips (= stays Equal, not Assign)', () => {
    const expr = ce.parse('L[d=4]');
    expect(expr.operator).toBe('At');
    expect(expr.op2.operator).toBe('Equal');
    const latex = expr.toLatex();
    expect(ce.parse(latex).isSame(expr)).toBe(true);
  });

  test('literal-list filter round-trips', () => {
    const expr = ce.parse('[-1,2,-3][[-1,2,-3]>0]');
    const latex = expr.toLatex();
    expect(ce.parse(latex).isSame(expr)).toBe(true);
  });

  test('integer index still round-trips', () => {
    const expr = ce.parse('L[1]');
    expect(ce.parse(expr.toLatex()).isSame(expr)).toBe(true);
  });
});
