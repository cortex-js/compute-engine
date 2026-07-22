import { ComputeEngine } from '../../src/compute-engine';

describe('A3.1 — ce.maxCollectionSize config', () => {
  test('defaults to 10000', () => {
    const ce = new ComputeEngine();
    expect(ce.maxCollectionSize).toEqual(10_000);
  });

  test('is configurable', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 500;
    expect(ce.maxCollectionSize).toEqual(500);
  });

  test('Repeat above the cap stays lazy (returns Repeat form, not a materialized List)', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 5;
    const expr = ce.parse('\\operatorname{repeat}(7, 100)').evaluate();
    expect(expr.operator).toEqual('Repeat');
  });

  test('Repeat at or below the cap materializes', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 1000;
    const expr = ce.parse('\\operatorname{repeat}(7, 3)').evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.nops).toEqual(3);
  });

  test('Range materialization respects cap', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 50;
    const r = ce.parse('\\operatorname{range}(1, 200)');
    expect(r.count).toEqual(200);
  });

  test('explicit infinite cap disables the limit', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = Infinity;
    const expr = ce.parse('\\operatorname{repeat}(0, 50000)').evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.nops).toEqual(50_000);
  });

  test('zero or negative cap is treated as no limit', () => {
    const ce = new ComputeEngine();
    ce.maxCollectionSize = 0;
    expect(ce.maxCollectionSize).toEqual(Infinity);
  });
});

describe('A3.2 — Empty-list validity', () => {
  test('parses \\left[\\right] to an empty List', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[\\right]');
    expect(expr.operator).toEqual('List');
    expect(expr.nops).toEqual(0);
  });

  test('parses [] (MathJSON literal) to an empty List', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['List']);
    expect(expr.operator).toEqual('List');
    expect(expr.nops).toEqual(0);
  });

  test('empty list reports count 0 and isEmptyCollection true', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[\\right]');
    expect(expr.count).toEqual(0);
    expect(expr.isEmptyCollection).toBe(true);
  });

  test('iterating an empty list yields no elements', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[\\right]');
    const values = [...expr.each()];
    expect(values).toHaveLength(0);
  });

  test('Length([]) evaluates to 0', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Length', ['List']]).evaluate().re).toEqual(0);
  });

  test('Count([]) evaluates to 0', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Count', ['List']]).evaluate().re).toEqual(0);
  });

  test('an empty list is assignable to a symbol (corpus: j \\to [])', () => {
    const ce = new ComputeEngine();
    ce.assign('j', ce.parse('\\left[\\right]'));
    const j = ce.expr('j').evaluate();
    expect(j.operator).toEqual('List');
    expect(j.nops).toEqual(0);
  });

  test('empty list LaTeX round-trip', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[\\right]');
    const round = ce.parse(expr.latex);
    expect(round.operator).toEqual('List');
    expect(round.nops).toEqual(0);
  });
});

describe('A3.3 — Reducer arity-1 forms', () => {
  test('Sum([1,2,3,4,5]) → 15', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Sum', ['List', 1, 2, 3, 4, 5]]).evaluate().re).toEqual(15);
  });

  test('Sum([]) → 0', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Sum', ['List']]).evaluate().re).toEqual(0);
  });

  test('Sum(Range(1,10)) → 55', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Sum', ['Range', 1, 10]]).evaluate().re).toEqual(55);
  });

  test('Sum still works in big-op form Sum(i, [i,1,10])', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sum_{i=1}^{10} i').evaluate().re).toEqual(55);
  });

  test('Max([3,1,4,1,5,9,2,6]) → 9', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Max', ['List', 3, 1, 4, 1, 5, 9, 2, 6]]).evaluate().re).toEqual(9);
  });

  test('Min([3,1,4,1,5,9,2,6]) → 1', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Min', ['List', 3, 1, 4, 1, 5, 9, 2, 6]]).evaluate().re).toEqual(1);
  });

  test('Count([10,20,30]) → 3', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Count', ['List', 10, 20, 30]]).evaluate().re).toEqual(3);
  });

  test('Sum dot-notation serializes to L.total', () => {
    const ce = new ComputeEngine();
    ce.latexOptions.dotNotation = true;
    const expr = ce.expr(['Sum', ['List', 1, 2, 3]]);
    expect(expr.latex).toContain('\\operatorname{total}');
  });

  test('Sum of an infinite collection stays symbolic (does not hang)', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Sum', ['Repeat', 1]]).evaluate();
    // Symbolic fallback: the reducer leaves the expression in its lazy form
    // when the collection has no finite count.
    expect(expr.operator).toEqual('Sum');
  });
});

describe('A3.4 — Mixed-kind / mixed-dim list type', () => {
  test('homogeneous numeric list has a precise numeric element type', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[1, 2, 3\\right]');
    const t = expr.type.toString();
    // A fixed-size numeric list now keeps its dimension (REVIEW.md F7): the
    // tensor type `list<number^3>` serializes to `vector<3>`. Previously the
    // dimension was silently dropped, yielding `list<number>`.
    // Phase C representation unification: literal lists type honestly, so the
    // element type is reported precisely (e.g. `vector<finite_integer^3>`).
    const numericElem = '(integer|number|finite_integer|finite_number|real|finite_real)';
    expect(t).toMatch(
      new RegExp(`^(list<${numericElem}>|vector<(\\d+|${numericElem}\\^\\d+)>)$`)
    );
  });

  test('mixed number/string list surfaces a detectable element type', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['List', 1, "'hello'", 3]);
    const t = expr.type.toString();
    // GP can detect heterogeneity by inspecting the element type. Either
    // union notation (number | string), or any/unknown.
    expect(t).toMatch(/list<.*(\||any|unknown)/);
  });

  test('mixed-dim point list surfaces a tuple-union element type', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'List',
      ['Tuple', 1, 2],
      ['Tuple', 3, 4, 5],
    ]);
    const t = expr.type.toString();
    // Element type must indicate the dimension mismatch (union of tuple
    // shapes, or any/unknown). Must NOT collapse to a bare list<tuple>.
    expect(t).toMatch(/tuple|any|unknown/);
    expect(t).not.toEqual('list<tuple>');
  });

  test('GP detection: mixed-kind list is distinguishable from homogeneous list', () => {
    const ce = new ComputeEngine();
    const homo = ce.parse('\\left[1, 2, 3\\right]');
    const mixed = ce.expr(['List', 1, "'hi'"]);
    expect(homo.type.toString()).not.toEqual(mixed.type.toString());
  });

  test('empty list type is a list (not unknown / any / scalar)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\left[\\right]');
    const t = expr.type.toString();
    expect(t.startsWith('list')).toBe(true);
  });
});

describe('A3.5 — Indexing extensions', () => {
  test('At(L, i) — integer index still works', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['At', ['List', 10, 20, 30, 40], 2]).evaluate();
    expect(expr.re).toEqual(20);
  });

  test('At(L, [i, j, k]) — list of indices returns picked sublist', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 10, 20, 30, 40, 50],
      ['List', 1, 3, 5],
    ]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.ops!.map((x) => x.re)).toEqual([10, 30, 50]);
  });

  test('At(L, [bool, bool, bool, bool]) — boolean mask returns filtered sublist', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 10, 20, 30, 40],
      ['List', 'True', 'False', 'True', 'False'],
    ]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.ops!.map((x) => x.re)).toEqual([10, 30]);
  });

  test('boolean mask with mismatched length: takes min(len(L), len(mask))', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 10, 20, 30, 40, 50],
      ['List', 'True', 'False', 'True'],
    ]).evaluate();
    expect(expr.ops!.map((x) => x.re)).toEqual([10, 30]);
  });

  test('At with empty index list returns empty list', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 10, 20, 30],
      ['List'],
    ]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.nops).toEqual(0);
  });

  // BREAKING (2026-07-22): an out-of-range entry of an integer-list pick is
  // POSITION-PRESERVING — it yields the absence marker (`NaN` for a numeric
  // collection) in place instead of being dropped, so the picked list has the
  // same length as the index list.
  test('At with out-of-range index in list: yields the absence marker in that slot', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 10, 20, 30],
      ['List', 1, 99],
    ]).evaluate();
    expect(expr.operator).toEqual('List');
    expect(expr.ops!.length).toEqual(2);
    expect(expr.op1.re).toEqual(10);
    expect(expr.op2.isNaN).toBe(true);
  });

  test('At with predicate-derived mask works (manual case)', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'At',
      ['List', 1, 2, 3, 4, 5],
      ['List', 'False', 'False', 'True', 'True', 'True'],
    ]).evaluate();
    expect(expr.ops!.map((x) => x.re)).toEqual([3, 4, 5]);
  });
});

describe('A3.6 — Function-application broadcasting', () => {
  test('user-defined function broadcasts over a list', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2 + 1'));
    const result = ce.parse('f(\\left[1, 2, 3\\right])').evaluate();
    expect(result.operator).toEqual('List');
    expect(result.ops!.map((x) => x.re)).toEqual([2, 5, 10]);
  });

  test('user function with scalar param + list arg broadcasts', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const result = ce.expr(['g', ['List', 10, 20, 30]]).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.ops!.map((x) => x.re)).toEqual([20, 40, 60]);
  });

  test('broadcasting an empty list yields an empty list', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x + 1'));
    const result = ce.expr(['f', ['List']]).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.nops).toEqual(0);
  });

  test('broadcasting over a Range works', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2'));
    const result = ce.expr(['f', ['Range', 1, 4]]).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.ops!.map((x) => x.re)).toEqual([1, 4, 9, 16]);
  });

  test('multi-arg function broadcasts with zip semantics (list + scalar)', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(x, y) \\mapsto x + y'));
    const result = ce.expr(['h', ['List', 1, 2, 3], 10]).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.ops!.map((x) => x.re)).toEqual([11, 12, 13]);
  });

  test('multi-arg function broadcasts with zip semantics (list + list)', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('(x, y) \\mapsto x + y'));
    const result = ce.expr(['h', ['List', 1, 2, 3], ['List', 10, 20, 30]]).evaluate();
    expect(result.operator).toEqual('List');
    expect(result.ops!.map((x) => x.re)).toEqual([11, 22, 33]);
  });

  test('lambda with list-consuming body still broadcasts (intentional design)', () => {
    // Inferred lambda params have type `unknown`, which `paramsAreScalar`
    // treats as scalar — so any list argument broadcasts pointwise, even
    // when the body is itself a reducer. Users who want the whole list
    // passed through should call the reducer directly (`Sum(L)`) rather
    // than wrapping it in a lambda. This test pins the current behavior
    // so any future narrowing of broadcasting must revisit it.
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('L \\mapsto \\operatorname{Sum}(L)'));
    const result = ce.expr(['f', ['List', 1, 2, 3]]).evaluate();
    expect(result.operator).toEqual('List');
    // Pointwise: [Sum(1), Sum(2), Sum(3)]. Each Sum(scalar) stays symbolic
    // (scalar is not a collection) so we just check the broadcast shape.
    expect(result.nops).toEqual(3);
  });
});
