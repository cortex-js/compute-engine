import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('Approximate equality operators', () => {
  describe('Approx (≈)', () => {
    test('Equal numbers are approximately equal', () => {
      expect(ce.expr(['Approx', 3, 3]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance are approximately equal', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance are not approximately equal', () => {
      expect(ce.expr(['Approx', 1, 2]).evaluate().json).toBe('False');
    });

    test('Pi ≈ 3.14159265 within tolerance', () => {
      expect(
        ce.expr(['Approx', 'Pi', 3.141592653589793]).evaluate().json
      ).toBe('True');
    });

    test('Pi is not approximately 3', () => {
      expect(ce.expr(['Approx', 'Pi', 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: all close', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 3, 1 + tol / 4]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: one pair not close', () => {
      expect(
        ce.expr(['Approx', 1, 1.0000001, 5]).evaluate().json
      ).toBe('False');
    });

    test('Single argument returns True', () => {
      expect(ce.expr(['Approx', 3]).evaluate().json).toBe('True');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Approx', 'x', 'y']).evaluate();
      // When evaluate can't determine a result, it returns the expression
      expect(result.operator).toBe('Approx');
    });
  });

  describe('TildeFullEqual (≅)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeFullEqual', 5, 5]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['TildeFullEqual', 2, 2 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeFullEqual', 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('TildeEqual (≃)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeEqual', 7, 7]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeEqual', 1, 100]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxEqual (≊)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['ApproxEqual', 10, 10]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['ApproxEqual', 0, 1]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxNotEqual', () => {
    test('Different numbers are approximately not equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 1, 2]).evaluate().json
      ).toBe('True');
    });

    test('Close numbers are not approximately-not-equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Negated approximate equality operators', () => {
  describe('NotApprox', () => {
    test('Different numbers', () => {
      expect(ce.expr(['NotApprox', 1, 2]).evaluate().json).toBe('True');
    });

    test('Same numbers', () => {
      expect(ce.expr(['NotApprox', 3, 3]).evaluate().json).toBe('False');
    });
  });

  describe('NotTildeFullEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 1, 100]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotTildeEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 1, 50]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 7, 7]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotApproxEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 0, 1]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 10, 10]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Ordering operators', () => {
  describe('Precedes (≺)', () => {
    test('2 ≺ 5', () => {
      expect(ce.expr(['Precedes', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 ≺ 2 is false', () => {
      expect(ce.expr(['Precedes', 5, 2]).evaluate().json).toBe('False');
    });

    test('3 ≺ 3 is false', () => {
      expect(ce.expr(['Precedes', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 1 ≺ 2 ≺ 3', () => {
      expect(
        ce.expr(['Precedes', 1, 2, 3]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 1 ≺ 3 ≺ 2 is false', () => {
      expect(
        ce.expr(['Precedes', 1, 3, 2]).evaluate().json
      ).toBe('False');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Precedes', 'x', 'y']).evaluate();
      expect(result.operator).toBe('Precedes');
    });
  });

  describe('Succeeds (≻)', () => {
    test('5 ≻ 2', () => {
      expect(ce.expr(['Succeeds', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 ≻ 5 is false', () => {
      expect(ce.expr(['Succeeds', 2, 5]).evaluate().json).toBe('False');
    });

    test('3 ≻ 3 is false', () => {
      expect(ce.expr(['Succeeds', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 3 ≻ 2 ≻ 1', () => {
      expect(
        ce.expr(['Succeeds', 3, 2, 1]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 3 ≻ 1 ≻ 2 is false', () => {
      expect(
        ce.expr(['Succeeds', 3, 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotPrecedes', () => {
    test('5 does not precede 2', () => {
      expect(ce.expr(['NotPrecedes', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 does not precede 5 is false', () => {
      expect(ce.expr(['NotPrecedes', 2, 5]).evaluate().json).toBe('False');
    });
  });

  describe('NotSucceeds', () => {
    test('2 does not succeed 5', () => {
      expect(ce.expr(['NotSucceeds', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 does not succeed 2 is false', () => {
      expect(ce.expr(['NotSucceeds', 5, 2]).evaluate().json).toBe('False');
    });
  });
});

describe('LaTeX round-trip', () => {
  test('\\approx parses and evaluates', () => {
    const expr = ce.parse('3.14 \\approx 3.14');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\cong parses and evaluates', () => {
    const expr = ce.parse('5 \\cong 5');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\prec parses and evaluates', () => {
    const expr = ce.parse('1 \\prec 2');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\succ parses and evaluates', () => {
    const expr = ce.parse('5 \\succ 3');
    expect(expr.evaluate().json).toBe('True');
  });
});

// REVIEW.md B14: Congruent used JS `%` (wrong for negatives) and read `.value`
// as a JS number, so it bailed under the bignum-preferred default precision.
describe('Congruent modular arithmetic (REVIEW.md B14)', () => {
  it('evaluates under the default (bignum) precision', () => {
    expect(ce.expr(['Congruent', 8, 1, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', 2, 3, 7]).evaluate().json).toBe('False');
  });
  it('handles negative operands with a floored modulo', () => {
    // -1 ≡ 6 (mod 7); -8 ≡ 6 (mod 7)
    expect(ce.expr(['Congruent', -1, 6, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', -8, 6, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', -1, 13, 7]).evaluate().json).toBe('True');
  });
});

// A mixed chained inequality (different operators, e.g. `5 ≤ b < 7`) must keep
// the middle term in both links. The canonicalizer used to splice the wrong
// operand of the nested relation, dropping it: `5 ≤ b < 7` became
// `And(5 ≤ 7, b < 7)`, which is true for any `b` (e.g. `3 ≤ 2 < 7` wrongly
// evaluated to True).
describe('Mixed chained inequalities (playground 5≤b<7)', () => {
  it('keeps the middle term: a ≤ b < c', () => {
    expect(ce.parse('5 \\le b \\lt 7').json).toEqual([
      'And',
      ['LessEqual', 5, 'b'],
      ['Less', 'b', 7],
    ]);
  });

  it('keeps the middle term: a < b ≤ c', () => {
    expect(ce.parse('5 \\lt b \\le 7').json).toEqual([
      'And',
      ['Less', 5, 'b'],
      ['LessEqual', 'b', 7],
    ]);
  });

  it('handles a longer mixed chain: a ≤ b ≤ c < d', () => {
    expect(ce.parse('a \\le b \\le c \\lt d').json).toEqual([
      'And',
      ['LessEqual', 'a', 'b', 'c'],
      ['Less', 'c', 'd'],
    ]);
  });

  it('evaluates to the correct truth value', () => {
    expect(ce.parse('5 \\le 6 \\lt 7').evaluate().json).toBe('True');
    expect(ce.parse('5 \\le 8 \\lt 7').evaluate().json).toBe('False');
    // Regression: 3 ≤ 2 < 7 must be False (the first link 3 ≤ 2 is false)
    expect(ce.parse('3 \\le 2 \\lt 7').evaluate().json).toBe('False');
  });
});

// A chain that *flips direction* (e.g. `a ≤ b > c`) must decompose into the
// pairwise `And` that shares the middle term `b` in each link. Previously the
// Greater→Less normalization reversed the nested chain's operands, and the
// canonicalizer spliced the wrong boundary term, producing wrong truth values
// (e.g. `1 ≤ 2 > 0` — a true statement — evaluated to False).
describe('Mixed-DIRECTION chained inequalities', () => {
  it('a ≤ b > c → And(a ≤ b, b > c)', () => {
    expect(ce.parse('a \\le b > c').json).toEqual([
      'And',
      ['LessEqual', 'a', 'b'],
      ['Less', 'c', 'b'],
    ]);
  });

  it('a > b < c → And(a > b, b < c)', () => {
    expect(ce.parse('a > b < c').json).toEqual([
      'And',
      ['Less', 'b', 'a'],
      ['Less', 'b', 'c'],
    ]);
  });

  it('1 = 2 > 0 → And(1 = 2, 2 > 0)', () => {
    expect(ce.parse('1 = 2 > 0').json).toEqual([
      'And',
      ['Equal', 1, 2],
      ['Less', 0, 2],
    ]);
  });

  it('evaluates flipped chains with the correct truth value', () => {
    // 1 ≤ 2 > 0 is True (1 ≤ 2 and 2 > 0)
    expect(ce.parse('1 \\le 2 > 0').evaluate().json).toBe('True');
    // 3 ≥ 2 < 4 is True (3 ≥ 2 and 2 < 4)
    expect(ce.parse('3 \\ge 2 < 4').evaluate().json).toBe('True');
    // 5 > 4 < 2 is False (5 > 4 but not 4 < 2)
    expect(ce.parse('5 > 4 < 2').evaluate().json).toBe('False');
    // 1 = 2 > 0 is False (1 ≠ 2)
    expect(ce.parse('1 = 2 > 0').evaluate().json).toBe('False');
  });

  it('same-direction chains keep their n-ary form', () => {
    expect(ce.parse('1 < 2 < 3').json).toEqual(['Less', 1, 2, 3]);
    expect(ce.parse('1 < 2 < 3').evaluate().json).toBe('True');
    expect(ce.parse('3 < 2 < 1').evaluate().json).toBe('False');
    expect(ce.parse('a > b > c').json).toEqual(['Less', 'c', 'b', 'a']);
  });
});

// `NotEqual` is not transitive, so a chained `a ≠ b ≠ c` means the pairwise
// `a ≠ b ∧ b ≠ c` (NOT the n-ary "all distinct", which mis-evaluated `1 ≠ 2 ≠ 2`
// to True). It participates in the same chain machinery as the other
// relationals: `NotEqual` decomposes into an `And` of adjacent pairs.
describe('Chained NotEqual (pairwise, not all-distinct)', () => {
  it('a ≠ b ≠ c → And(a ≠ b, b ≠ c)', () => {
    expect(ce.parse('a \\ne b \\ne c').json).toEqual([
      'And',
      ['NotEqual', 'a', 'b'],
      ['NotEqual', 'b', 'c'],
    ]);
  });

  it('a ≠ b (2-arg) stays a plain NotEqual', () => {
    expect(ce.parse('a \\ne b').json).toEqual(['NotEqual', 'a', 'b']);
  });

  it('evaluates chained ≠ with pairwise semantics', () => {
    // 1 ≠ 2 ≠ 2 is False (2 ≠ 2 fails), under pairwise semantics
    expect(ce.parse('1 \\ne 2 \\ne 2').evaluate().json).toBe('False');
    // 1 ≠ 2 ≠ 1 is True (1 ≠ 2 and 2 ≠ 1), even though 1 repeats
    expect(ce.parse('1 \\ne 2 \\ne 1').evaluate().json).toBe('True');
  });

  it('mixes with directional links: a < b ≠ c → And(a < b, b ≠ c)', () => {
    expect(ce.parse('a < b \\ne c').json).toEqual([
      'And',
      ['Less', 'a', 'b'],
      ['NotEqual', 'b', 'c'],
    ]);
  });
});

describe('Equal / NotEqual broadcast over a named list operand (Tycho)', () => {
  // A symbol bound to a list must broadcast the same whether it appears bare
  // (`R`) or inside a function (`R^2`, which evaluates to a list). `Equal` and
  // `NotEqual` are `lazy`, so before the fix their evaluate handlers saw the
  // unevaluated `Power(R, 2)` — not a collection — and collapsed the whole
  // relation to a scalar `False`/`True` instead of broadcasting like `<`.
  const bce = new ComputeEngine();
  bce.assign('R', bce.parse('[1,2,3]'));

  it('Equal broadcasts over a named list raised to a power', () => {
    expect(bce.parse('x^2+y^2 = R^2').evaluate().json).toEqual([
      'List',
      ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 1],
      ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 4],
      ['Equal', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 9],
    ]);
  });

  it('NotEqual broadcasts over a named list raised to a power', () => {
    expect(bce.parse('x^2+y^2 \\ne R^2').evaluate().json).toEqual([
      'List',
      ['NotEqual', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 1],
      ['NotEqual', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 4],
      ['NotEqual', ['Add', ['Power', 'x', 2], ['Power', 'y', 2]], 9],
    ]);
  });

  it('whole-list equality stays a scalar boolean (no runaway broadcast)', () => {
    expect(bce.parse('[1,2] = [1,2]').evaluate().json).toBe('True');
    expect(bce.parse('[1,2] = [1,3]').evaluate().json).toBe('False');
    // Set vs list: representation-independent, still a single boolean.
    expect(bce.parse('\\lbrace1,2\\rbrace = [1,2]').evaluate().json).toBe(
      'False'
    );
  });

  it('undecidable scalar equality still stays inert', () => {
    expect(bce.parse('x^2 = 4').evaluate().json).toEqual([
      'Equal',
      ['Power', 'x', 2],
      4,
    ]);
  });
});

describe('Equal over an operand that only becomes a collection at evaluation (Tycho item 41)', () => {
  // A type-opaque application (`(number) -> unknown`) that returns a list at
  // run time must follow the same documented rules as a literal/symbol-bound
  // list: whole-collection equality against another collection (a single
  // boolean), element-wise against a scalar. Previously the pre-evaluation
  // broadcast fanned the literal out while the opaque operand was still raw,
  // compounding two broadcasts into a cartesian nest of lists of booleans.
  const oce = new ComputeEngine();
  oce.declare('L', '(number) -> unknown');
  oce.assign('L', oce.parse('v \\mapsto [v, 2]'));
  oce.declare('q', '(number) -> unknown');
  oce.assign('q', oce.parse('v \\mapsto v^2+5'));

  it('runtime list = literal list is a single boolean (was a 2×2 cartesian nest)', () => {
    expect(oce.parse('L(1) = [1,2]').evaluate().json).toBe('True');
    expect(oce.parse('L(1) = [1,3]').evaluate().json).toBe('False');
    expect(oce.parse('L(1) = [1,2,3]').evaluate().json).toBe('False');
    expect(oce.parse('L(1) \\ne [1,3]').evaluate().json).toBe('True');
  });

  it('runtime scalar = literal list still broadcasts element-wise', () => {
    expect(oce.parse('q(2) = [9, 10]').evaluate().json).toEqual([
      'List',
      'True',
      'False',
    ]);
  });

  it('runtime scalar = scalar is unchanged', () => {
    expect(oce.parse('q(2) = 9').evaluate().json).toBe('True');
    expect(oce.parse('q(2) \\ne 9').evaluate().json).toBe('False');
  });
});

describe('Absence in comparisons: IEEE over NaN, Kleene over Missing (§3.D)', () => {
  // Amended 2026-07-24 (Julia model): NaN follows IEEE 754 (`NaN == NaN` is
  // false, and NaN is unordered so orderings are false), while the `Missing`
  // symbol is Kleene (`Missing == x` is `Missing`). Discharge/aggregates are
  // unaffected (see missing-value.test.ts).
  test('NaN is IEEE', () => {
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
    expect(ce.box(['NotEqual', 'NaN', 'NaN']).evaluate().symbol).toBe('True');
    expect(ce.box(['Less', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['Greater', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['LessEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
    expect(ce.box(['GreaterEqual', 'NaN', 1]).evaluate().symbol).toBe('False');
  });

  test('the Missing symbol is Kleene', () => {
    expect(ce.box(['Equal', 2, 'Missing']).evaluate().symbol).toBe('Missing');
    expect(ce.box(['NotEqual', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['Less', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    expect(ce.box(['GreaterEqual', 'Missing', 1]).evaluate().symbol).toBe(
      'Missing'
    );
  });
});

describe('An undecidable comparison keeps its evaluated operands', () => {
  // `Equal`/`NotEqual`/`Less`/`LessEqual` are `lazy`, so they evaluate their own
  // operands and used to discard that work by returning `undefined` ("unchanged")
  // when the comparison itself could not be decided: `d/dx x^2 > 0` reported
  // `0 < D(x^2, x)` instead of `0 < 2x`. The comparison still stays inert — only
  // the operands are now the evaluated ones. See `inertRelation`.
  const u = new ComputeEngine();

  test('Less', () => {
    expect(u.parse('x^2+x^2>0').evaluate().json).toEqual([
      'Less',
      0,
      ['Multiply', 2, ['Power', 'x', 2]],
    ]);
  });

  test('LessEqual', () => {
    expect(u.parse('x^2+x^2 \\le 0').evaluate().json).toEqual([
      'LessEqual',
      ['Multiply', 2, ['Power', 'x', 2]],
      0,
    ]);
  });

  test('Equal', () => {
    expect(u.parse('x^2 = 2+2').evaluate().json).toEqual([
      'Equal',
      ['Power', 'x', 2],
      4,
    ]);
  });

  test('NotEqual', () => {
    expect(u.parse('x \\ne 3\\cdot 3').evaluate().json).toEqual([
      'NotEqual',
      'x',
      9,
    ]);
  });

  test('a Leibniz derivative operand is evaluated', () => {
    expect(u.parse('\\frac{d}{dx}x^{2}>0').evaluate().toString()).toBe(
      '0 < 2x'
    );
  });

  test('a chained relation keeps its shape', () => {
    expect(u.parse('1 < x < 2+2').evaluate().json).toEqual(['Less', 1, 'x', 4]);
  });

  test('evaluation is a fixpoint (no rebuild when nothing changed)', () => {
    const once = u.parse('x^2+x^2>0').evaluate();
    expect(once.evaluate().isSame(once)).toBe(true);
    // An already-evaluated undecidable comparison is returned unchanged.
    const stable = u.parse('x > 0');
    expect(stable.evaluate().isSame(stable)).toBe(true);
  });

  test('the comparison itself still stays inert, not collapsed', () => {
    // `x^2 = 4` is a *condition*, not a falsity (Tycho 0.72.0 item 8).
    expect(u.parse('x^2 = 4').evaluate().operator).toBe('Equal');
    expect(u.parse('x > 0').evaluate().operator).toBe('Less');
  });

  test('decidable comparisons are unaffected', () => {
    expect(u.parse('2+2 = 4').evaluate().symbol).toBe('True');
    expect(u.parse('x \\ne x').evaluate().symbol).toBe('False');
    expect(u.parse('1 < 2 < 3').evaluate().symbol).toBe('True');
  });

  test('matches the non-lazy relations, which already did this', () => {
    // `Approx`/`Tilde`/`Precedes` are not `lazy`: the framework substitutes
    // their evaluated operands on an `undefined` return. The four lazy
    // comparisons now agree.
    expect(u.parse('x^2+x^2 \\approx 0').evaluate().json).toEqual([
      'Approx',
      ['Multiply', 2, ['Power', 'x', 2]],
      0,
    ]);
  });
});

describe('Same (Epsil `===`) — total structural identity', () => {
  const s = (...ops: any[]) =>
    ce.box(['Same', ...ops] as any).evaluate().symbol;

  test('number leaves compare by exact value, not by notation', () => {
    // `{num: "1.0"}` and the integer `1` are the same number leaf.
    expect(s(1, { num: '1.0' })).toBe('True');
    // `0.5` IS exactly `1/2` — a machine float and a rational naming the same
    // value are structurally the same number leaf.
    expect(s(0.5, ['Divide', 1, 2])).toBe('True');
  });

  test('structural, with no tolerance and no numeric evaluation', () => {
    expect(s(['Sqrt', 2], ['Sqrt', 2])).toBe('True');
    // The radical is NOT evaluated to a float, and no tolerance is applied.
    expect(s(['Sqrt', 2], 1.4142135623730951)).toBe('False');
    // ... whereas the tolerant, semantic `Equal` says these ARE equal. This
    // contrast is the whole point of having both operators.
    expect(
      ce.box(['Equal', ['Sqrt', 2], 1.4142135623730951]).evaluate().symbol
    ).toBe('True');
  });

  test('TOTAL: two distinct free symbols are False, never inert', () => {
    // `Equal(x, y)` stays inert (it is a *condition*); `Same` always decides.
    expect(s('x', 'x')).toBe('True');
    expect(s('x', 'y')).toBe('False');
    expect(ce.box(['Equal', 'x', 'y']).evaluate().operator).toBe('Equal');
  });

  test('operands are CANONICALIZED, not evaluated (and not held like `IsSame`)', () => {
    // Canonicalization folds exact arithmetic, so `1 + 1` is the number `2`.
    expect(s(['Add', 1, 1], 2)).toBe('True');
    // `IsSame` is the raw/uncanonicalized counterpart.
    expect(ce.box(['IsSame', ['Add', 1, 1], 2]).evaluate().symbol).toBe(
      'False'
    );
    // But nothing is EVALUATED: `sin(0)` and `3!` canonicalize to themselves,
    // so they are structurally distinct from their values. (`Equal` — the
    // arithmetic tier — answers `True` for both.)
    expect(s(['Sin', 0], 0)).toBe('False');
    expect(ce.box(['Equal', ['Sin', 0], 0]).evaluate().symbol).toBe('True');
    expect(s(['Factorial', 3], 6)).toBe('False');
  });

  test('a symbol value is never dereferenced through a compound operand', () => {
    // `Same` is strictly syntactic: with `x := 5`, the canonical form of
    // `x + 1` is `x + 1`, not `6`.
    const e = new ComputeEngine();
    e.assign('x', 5);
    expect(e.box(['Same', ['Add', 'x', 1], 6]).evaluate().symbol).toBe('False');
    expect(e.box(['Equal', ['Add', 'x', 1], 6]).evaluate().symbol).toBe('True');
  });

  test('a symbol value is never dereferenced at the TOP level either', () => {
    // The headline example of the equality tiers: `isSame` sheds its
    // value-following shortcut, so a symbol is never the same as its value —
    // at any depth, in either direction, boxed or primitive.
    const e = new ComputeEngine();
    e.assign('x', 5);
    expect(e.box(['Same', 'x', 5]).evaluate().symbol).toBe('False');
    expect(e.box(['Equal', 'x', 5]).evaluate().symbol).toBe('True');

    const x = e.symbol('x');
    expect(x.isSame(e.box(5))).toBe(false);
    expect(x.isSame(5)).toBe(false); // primitive overload
    // ...and the other direction of the same comparison.
    expect(e.box(5).isSame(x)).toBe(false);
    // The value questions still answer:
    expect(x.isEqual(5)).toBe(true);
    expect(x.is(5)).toBe(true); // numeric fallback, unchanged
  });

  test('two symbols holding the same value are still different symbols', () => {
    const e = new ComputeEngine();
    e.assign('a', 5);
    e.assign('b', 5);
    expect(e.symbol('a').isSame(e.symbol('b'))).toBe(false);
    expect(e.box(['Same', 'a', 'b']).evaluate().symbol).toBe('False');
    // ...and a symbol is always the same as itself (reflexivity).
    const a = e.symbol('a');
    expect(a.isSame(a)).toBe(true);
    expect(e.symbol('a').isSame(e.symbol('a'))).toBe(true);
    expect(e.box(['Same', 'a', 'a']).evaluate().symbol).toBe('True');
  });

  test('strings', () => {
    expect(s({ str: 'a' }, { str: 'a' })).toBe('True');
    expect(s({ str: 'a' }, { str: 'b' })).toBe('False');
  });

  test('n-ary chain: every ADJACENT pair must match', () => {
    expect(s(1, 1, 1)).toBe('True');
    expect(s(1, 1, 2)).toBe('False');
  });

  test('collections compare as a whole (no broadcast), order-sensitively', () => {
    expect(s(['List', 1, 2], ['List', 1, 2])).toBe('True');
    expect(s(['List', 1, 2], ['List', 2, 1])).toBe('False');
    expect(
      s(
        ['Dictionary', ['Tuple', { str: 'a' }, 1]],
        ['Dictionary', ['Tuple', { str: 'a' }, 1]]
      )
    ).toBe('True');
  });

  test('absence is just another structure (no Kleene, no IEEE)', () => {
    // `Equal` is Kleene over `Missing` and IEEE over `NaN`; `Same` is neither
    // — it is total and structural.
    expect(s('Missing', 'Missing')).toBe('True');
    expect(s('Missing', 1)).toBe('False');
    expect(s('NaN', 'NaN')).toBe('True');
    expect(ce.box(['Equal', 'NaN', 'NaN']).evaluate().symbol).toBe('False');
  });

  test('NaN identity does not depend on interning', () => {
    // `"NaN"` and a bare `{num:"NaN"}` box to the interned `ce.NaN`, so
    // `isSame` used to succeed by object identity alone. Attaching metadata
    // (`sourceOffsets`, as the Epsil parser does) defeats interning and
    // produced a *fresh* number literal — and `Same` then answered `False`,
    // making the answer depend on provenance rather than on the value.
    const nan = (offsets: [number, number]) =>
      ({ num: 'NaN', sourceOffsets: offsets }) as any;
    expect(s(nan([0, 3]), nan([8, 11]))).toBe('True');
    expect(ce.box(nan([0, 3])).isSame(ce.box(nan([8, 11])))).toBe(true);
    // ...and `Equal` still says `False` (IEEE, unchanged).
    expect(
      ce.box(['Equal', nan([0, 3]), nan([8, 11])]).evaluate().symbol
    ).toBe('False');
    // NaN is not the same as any other number leaf.
    expect(s(nan([0, 3]), 1)).toBe('False');
    expect(s(nan([0, 3]), 'PositiveInfinity')).toBe('False');
  });
});

describe('Chains SHORT-CIRCUIT: a chain is a conjunction of its adjacent pairs (ruled 2026-08-15)', () => {
  // `a < b < c` stops at the first adjacent pair that is `False`, so `c` is
  // never evaluated — the same rule as `And` (see `evaluateChainOperands` in
  // `library/relational-operator.ts`). Each `N(k)` logs when it runs and
  // returns `k`, so `calls` spells out which operands ran.
  const { ComputeEngine } = require('../../src/compute-engine');
  const sc = new ComputeEngine();
  let calls: number[] = [];
  sc.declare('chN', {
    signature: '(number) -> number',
    evaluate: ([x]: any[]) => {
      calls.push(x.re);
      return x;
    },
  });
  const run = (json: any): any => {
    calls = [];
    return sc.expr(json).evaluate().json;
  };
  const N = (k: number) => ['chN', k];

  it('Less / LessEqual stop at the first failing pair', () => {
    expect(run(['Less', N(5), N(1), N(3)])).toBe('False');
    expect(calls).toEqual([5, 1]);
    expect(run(['Less', N(1), N(3), N(2)])).toBe('False');
    expect(calls).toEqual([1, 3, 2]);
    expect(run(['Less', N(1), N(2), N(3)])).toBe('True');
    expect(calls).toEqual([1, 2, 3]);
    expect(run(['LessEqual', N(5), N(1), N(3)])).toBe('False');
    expect(calls).toEqual([5, 1]);
  });

  it('Equal stops at the first unequal pair', () => {
    expect(run(['Equal', N(5), N(1), N(3)])).toBe('False');
    expect(calls).toEqual([5, 1]);
    expect(run(['Equal', N(1), N(1), N(1)])).toBe('True');
    expect(calls).toEqual([1, 1, 1]);
  });

  it('a decided False wins over a later Missing or an undecided pair (Kleene)', () => {
    expect(run(['Less', 5, 1, 'Missing'])).toBe('False');
    expect(run(['Less', 5, 'Missing', 3])).toBe('Missing');
    expect(run(['Less', 'x', 1, 0])).toBe('False');
  });

  it('a collection-shaped operand makes the chain element-wise (no short-circuit)', () => {
    expect(run(['Less', 1, ['List', 2, 0], 3])).toEqual([
      'List',
      'True',
      'False',
    ]);
  });
});

describe('Exact ordering of number literals', () => {
  // `ExactNumericValue.lt/lte/gt/gte` used to compare the machine
  // projections (`this.re < other.re`). A magnitude outside the double
  // range has no double to compare — `10^400` and `10^500` both project to
  // `Infinity` — so `Less(10^400, 10^500)` and `Greater(10^500, 10^400)`
  // were BOTH `False`, and `a.isLess(b)` disagreed with `b.isGreater(a)`.
  test('two exact integers beyond the double range are ordered', () => {
    const a = ce.number(10n ** 400n);
    const b = ce.number(10n ** 500n);
    expect(ce.box(['Less', a, b]).evaluate().symbol).toBe('True');
    expect(ce.box(['Greater', b, a]).evaluate().symbol).toBe('True');
    expect(ce.box(['Less', b, a]).evaluate().symbol).toBe('False');
    expect(a.isLess(b)).toBe(true);
    expect(b.isGreater(a)).toBe(true);
    expect(a.isGreater(b)).toBe(false);
    expect(b.isLess(a)).toBe(false);
    expect(a.isLessEqual(b)).toBe(true);
    expect(b.isGreaterEqual(a)).toBe(true);
    // Negative magnitudes reverse the order.
    expect(a.neg().isGreater(b.neg())).toBe(true);
    expect(b.neg().isLess(a.neg())).toBe(true);
  });

  test('two exact rationals within an ulp of each other are ordered', () => {
    // `1 + 10^(-20)` and `1` round to the SAME double.
    const above = ce.parse('1+\\frac{1}{10^{20}}').evaluate();
    expect(above.isGreater(ce.One)).toBe(true);
    expect(ce.One.isLess(above)).toBe(true);
    expect(above.isLess(ce.One)).toBe(false);
    // Tiny magnitudes that both project to the double `0`.
    const tiny = ce.box(['Power', 10, -400]).evaluate();
    const tinier = ce.box(['Power', 10, -500]).evaluate();
    expect(tiny.isGreater(tinier)).toBe(true);
    expect(tinier.isLess(tiny)).toBe(true);
    expect(tiny.isGreater(ce.Zero)).toBe(true);
  });

  test('radicals are ordered exactly', () => {
    expect(ce.parse('\\sqrt{2}').isLess(ce.parse('\\sqrt{3}'))).toBe(true);
    expect(ce.parse('-\\sqrt{2}').isGreater(ce.parse('-\\sqrt{3}'))).toBe(
      true
    );
    // 7/5 = 1.4 < √2 < 3/2
    expect(ce.parse('\\frac{7}{5}').isLess(ce.parse('\\sqrt{2}'))).toBe(true);
    expect(ce.parse('\\frac{3}{2}').isGreater(ce.parse('\\sqrt{2}'))).toBe(
      true
    );
    // (a/b)√c against the same value spelled differently: 2√3 = √12.
    const x = ce.parse('2\\sqrt{3}');
    const y = ce.parse('\\sqrt{12}');
    expect(x.isLess(y)).toBe(false);
    expect(x.isGreater(y)).toBe(false);
  });

  test('a machine float and an exact value order the same way from both sides', () => {
    const big = ce.number(10n ** 400n);
    const half = ce.number(0.5);
    expect(half.isLess(big)).toBe(true);
    expect(big.isGreater(half)).toBe(true);
    expect(big.isLess(half)).toBe(false);
    const third = ce.parse('\\frac{1}{3}');
    expect(half.isLess(third)).toBe(false);
    expect(third.isLess(half)).toBe(true);
    expect(half.isGreater(third)).toBe(true);
  });

  test('the infinities and NaN keep their order', () => {
    const big = ce.number(10n ** 400n);
    expect(big.isLess(ce.PositiveInfinity)).toBe(true);
    expect(ce.PositiveInfinity.isGreater(big)).toBe(true);
    expect(big.isGreater(ce.NegativeInfinity)).toBe(true);
    expect(ce.NegativeInfinity.isLess(big)).toBe(true);
    expect(ce.box(['Less', big, 'NaN']).evaluate().symbol).not.toBe('True');
    expect(ce.box(['Greater', big, 'NaN']).evaluate().symbol).not.toBe('True');
  });
});

describe('Exact ordering against the other lanes (review pins)', () => {
  test('a finite bignum beyond the double range is not read as an infinity', () => {
    // `1.5·10^400` in the bignum lane projects `.re` to `Infinity` while its
    // bignum keeps the value; the exact lane must read its infinity FLAGS.
    const bn = ce.number(ce.bignum('1.5e400'));
    expect(ce.number(10n ** 500n).isGreater(bn)).toBe(true);
    expect(ce.number(10n ** 500n).isLess(bn)).toBe(false);
    expect(ce.number(10n ** 300n).isLess(bn)).toBe(true);
    expect(bn.isGreater(ce.number(10n ** 300n))).toBe(true);
    expect(bn.isLess(ce.number(10n ** 500n))).toBe(true);
  });

  test('an exact NaN operand is unordered from either side', () => {
    const half = ce.parse('\\frac{1}{2}');
    expect(half.isLess(ce.NaN)).not.toBe(true);
    expect(half.isGreater(ce.NaN)).not.toBe(true);
    expect(ce.NaN.isLess(half)).not.toBe(true);
    expect(ce.Zero.isLessEqual(ce.NaN)).not.toBe(true);
  });

  test('an exact value against a small integer literal', () => {
    expect(ce.parse('\\frac{1}{2}').isLess(1)).toBe(true);
    expect(ce.parse('\\frac{-3}{2}').isLess(-1)).toBe(true);
    expect(ce.parse('-\\sqrt{2}').isLess(-1)).toBe(true);
    expect(ce.parse('\\sqrt{2}').isGreater(1)).toBe(true);
    expect(ce.parse('\\sqrt{2}').isLess(2)).toBe(true);
    expect(ce.parse('\\frac{1}{2}').isLessEqual(0.5)).toBe(true);
    expect(ce.parse('\\frac{1}{2}').isLess(0.5)).toBe(false);
  });
});
