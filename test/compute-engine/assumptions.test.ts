import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

export const ce = new ComputeEngine();

ce.assume(ce.expr(['Equal', 'one', 1]));
ce.assume(ce.expr(['Greater', 'x', 4]));
// ce.assume(['Element', 'm', ['Range', -Infinity, Infinity]]);   @fixme
// ce.assume(['Element', 'n', ['Range', 0, Infinity]]);   @fixme
ce.assume(ce.expr(['Equal', 'o', 1]));
ce.assume(ce.expr(['Equal', 'p', 11]));
// ce.assume(['Element', 'q', ['Range', -Infinity, 0]]);  @fixme
// ce.assume(['Element', 'r', ['Interval', ['Open', 0], +Infinity]]); @fixme

ce.assume(ce.expr(['Greater', 's', 5]));
ce.assume(ce.expr(['Greater', 't', 0]));

// console.info([...ce.context!.dictionary!.symbols.keys()]);

// #18: Value Resolution from Equality Assumptions
// When `ce.assume(['Equal', 'one', 1])` is made, `ce.expr('one').evaluate()` should return `1`
describe('VALUE RESOLUTION FROM EQUALITY ASSUMPTIONS', () => {
  test(`one.value should be 1`, () => {
    expect(ce.expr('one').evaluate().json).toEqual(1);
  });

  test(`one.domain should be integer`, () => {
    // The type might be 'finite_integer' (subtype of integer)
    expect(ce.expr('one').type.matches('integer')).toBe(true);
  });

  test(`Equal(one, 1) should evaluate to True`, () => {
    expect(ce.expr(['Equal', 'one', 1]).evaluate().json).toEqual('True');
  });

  test(`Equal(o, 1) should evaluate to True`, () => {
    expect(ce.expr(['Equal', 'o', 1]).evaluate().json).toEqual('True');
  });

  test(`NotEqual(one, 1) should evaluate to False`, () => {
    expect(ce.expr(['NotEqual', 'one', 1]).evaluate().json).toEqual('False');
  });

  test(`Equal(one, 0) should evaluate to False`, () => {
    expect(ce.expr(['Equal', 'one', 0]).evaluate().json).toEqual('False');
  });
});

// #19: Inequality Evaluation Using Assumptions
// When `x > 4` is assumed, `['Greater', 'x', 0]` should evaluate to True
describe('INEQUALITY EVALUATION USING ASSUMPTIONS', () => {
  test(`Greater(x, 0) should be True (x > 4 assumed)`, () => {
    expect(ce.expr(['Greater', 'x', 0]).evaluate().json).toEqual('True');
  });

  test(`Less(x, 0) should be False (x > 4 assumed)`, () => {
    expect(ce.expr(['Less', 'x', 0]).evaluate().json).toEqual('False');
  });

  test(`Greater(t, 0) should be True (t > 0 assumed)`, () => {
    expect(ce.expr(['Greater', 't', 0]).evaluate().json).toEqual('True');
  });

  test(`Greater(one, 0) should be True (one = 1 assumed)`, () => {
    expect(ce.expr(['Greater', 'one', 0]).evaluate().json).toEqual('True');
  });

  test(`Less(one, 0) should be False (one = 1 assumed)`, () => {
    expect(ce.expr(['Less', 'one', 0]).evaluate().json).toEqual('False');
  });

  test(`GreaterEqual(one, 1) should be True`, () => {
    expect(ce.expr(['GreaterEqual', 'one', 1]).evaluate().json).toEqual('True');
  });
});

// #20: Tautology and Contradiction Detection
// ce.assume() should return 'tautology' for redundant assumptions and 'contradiction' for conflicting ones
describe('TAUTOLOGY AND CONTRADICTION DETECTION', () => {
  test(`assuming one = 1 again should return tautology`, () => {
    expect(ce.assume(ce.expr(['Equal', 'one', 1]))).toEqual('tautology');
  });

  test(`assuming one < 0 should return contradiction (one = 1)`, () => {
    expect(ce.assume(ce.expr(['Less', 'one', 0]))).toEqual('contradiction');
  });

  test(`assuming x < 0 should return contradiction (x > 4)`, () => {
    expect(ce.assume(ce.expr(['Less', 'x', 0]))).toEqual('contradiction');
  });

  test(`assuming x > 0 should return tautology (x > 4 implies x > 0)`, () => {
    expect(ce.assume(ce.expr(['Greater', 'x', 0]))).toEqual('tautology');
  });
});

// #21: Type Inference from Assumptions - IMPLEMENTED
// When assumptions are made, symbol types should be inferred
describe('TYPE INFERENCE FROM ASSUMPTIONS', () => {
  test(`x should have type real (x > 4 assumed)`, () => {
    expect(ce.expr('x').type.toString()).toBe('real');
  });

  test(`s should have type real (s > 5 assumed)`, () => {
    expect(ce.expr('s').type.toString()).toBe('real');
  });

  test(`t should have type real (t > 0 assumed)`, () => {
    expect(ce.expr('t').type.toString()).toBe('real');
  });

  test(`one should have type integer (one = 1 assumed)`, () => {
    expect(ce.expr('one').type.toString()).toBe('integer');
  });

  test(`o should have type integer (o = 1 assumed)`, () => {
    expect(ce.expr('o').type.toString()).toBe('integer');
  });

  test(`p should have type integer (p = 11 assumed)`, () => {
    expect(ce.expr('p').type.toString()).toBe('integer');
  });
});

// Tests for assumption-based simplification (Issue #8 from TODO.md) - IMPLEMENTED
describe('ASSUMPTION-BASED SIMPLIFICATION', () => {
  test('sqrt(x^2) simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) simplifies to x when x >= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('x');
  });

  test('sqrt(x^2) simplifies to -x when x < 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('-x');
  });

  test('sqrt(x^2) simplifies to -x when x <= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('-x');
  });

  test('sqrt(x^2) returns |x| without assumptions', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\sqrt{x^2}').simplify().latex).toBe('\\vert x\\vert');
  });

  test('|x| simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('x');
  });

  test('|x| simplifies to x when x >= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('x');
  });

  test('|x| simplifies to -x when x < 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('-x');
  });

  test('|x| simplifies to -x when x <= 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.parse('|x|').simplify().latex).toBe('-x');
  });

  test('fourth root of x^4 simplifies to x when x > 0', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.parse('\\sqrt[4]{x^4}').simplify().latex).toBe('x');
  });

  test('isPositive returns true when x > 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.expr('x').isPositive).toBe(true);
    expect(ce.expr('x').isNonNegative).toBe(true);
    expect(ce.expr('x').isNegative).toBe(false);
  });

  test('isNegative returns true when x < 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x < 0'));
    expect(ce.expr('x').isNegative).toBe(true);
    expect(ce.expr('x').isNonPositive).toBe(true);
    expect(ce.expr('x').isPositive).toBe(false);
  });

  test('isNonNegative returns true when x >= 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\ge 0'));
    expect(ce.expr('x').isNonNegative).toBe(true);
    // Could be zero, so not strictly positive
    expect(ce.expr('x').isPositive).toBe(undefined);
  });

  test('isNonPositive returns true when x <= 0 is assumed', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\le 0'));
    expect(ce.expr('x').isNonPositive).toBe(true);
    // Could be zero, so not strictly negative
    expect(ce.expr('x').isNegative).toBe(undefined);
  });

  test('assumptions do not leak between engine instances', () => {
    const ce1 = new ComputeEngine();
    ce1.assume(ce1.parse('x > 0'));

    const ce2 = new ComputeEngine();
    // x should have unknown sign in ce2
    expect(ce2.parse('\\sqrt{x^2}').simplify().latex).toBe('\\vert x\\vert');
    expect(ce2.expr('x').isPositive).toBe(undefined);
  });
});

describe('CHAINED INEQUALITY ASSUMPTIONS (P1-2)', () => {
  test('assume(0 < x < 1) establishes BOTH bounds', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('0 < x < 1'))).toBe('ok');
    // Both links of the chain must be established, not just the first pair.
    expect(ce.verify(ce.expr(['Greater', 'x', 0]))).toBe(true);
    expect(ce.verify(ce.expr(['Less', 'x', 1]))).toBe(true);
  });

  test('assume(1 <= y <= 3) establishes both (non-strict) bounds', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('1 \\le y \\le 3'))).toBe('ok');
    expect(ce.verify(ce.expr(['GreaterEqual', 'y', 1]))).toBe(true);
    expect(ce.verify(ce.expr(['LessEqual', 'y', 3]))).toBe(true);
  });

  test('a self-contradictory chain reports a contradiction', () => {
    const ce = new ComputeEngine();
    // 5 < z < 1 has no solution: the second link contradicts the first.
    expect(ce.assume(ce.parse('5 < z < 1'))).toBe('contradiction');
  });
});

describe('MULTI-ROOT EQUALITY ASSUMPTIONS (P1-3)', () => {
  test('assume(x^2 = 4) is ok (not a contradiction)', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('x^2 = 4'))).toBe('ok');
  });

  test('a multi-root equation does not bind the symbol to a List value', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x^2 = 4'));
    // x is not uniquely determined by x^2 = 4, so it stays symbolic rather
    // than evaluating to the list of roots List(2, -2).
    expect(ce.expr('x').evaluate().json).toBe('x');
    expect(ce.expr(['Add', 'x', 1]).evaluate().json).toEqual(['Add', 'x', 1]);
    // The equation is recorded, so verifying it succeeds.
    expect(ce.verify(ce.parse('x^2 = 4'))).toBe(true);
  });

  test('a single-root equation still binds the symbol to its value', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.parse('2x = 6'))).toBe('ok');
    expect(ce.expr('x').evaluate().json).toBe(3);
  });

  test('a root incompatible with an explicit type is a contradiction', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'imaginary');
    // Roots of x^2 = 4 are ±2 (real), incompatible with an imaginary x.
    expect(ce.assume(ce.parse('x^2 = 4'))).toBe('contradiction');
  });
});

describe('SCOPED INEQUALITY TYPE REFINEMENT DOES NOT LEAK (P1-6)', () => {
  test('assume(x>0) in a pushed scope does not refine x in the outer scope', () => {
    const ce = new ComputeEngine();
    // Reference x in the outer scope so it is auto-declared there (inferred,
    // unknown type). Historically this was the def that leaked.
    expect(ce.expr('x').type.toString()).toBe('unknown');

    ce.pushScope();
    ce.assume(ce.parse('x > 0'));
    expect(ce.expr('x').type.toString()).toBe('real');
    ce.popScope();

    // After popping, the outer-scope type refinement must be gone.
    expect(ce.expr('x').type.toString()).toBe('unknown');
    expect(ce.expr('x').isReal).toBe(undefined);
  });

  test('membership refinement in a pushed scope does not leak either', () => {
    const ce = new ComputeEngine();
    expect(ce.expr('w').type.toString()).toBe('unknown');

    ce.pushScope();
    ce.assume(ce.expr(['Element', 'w', 'Integers']));
    expect(ce.expr('w').type.matches('integer')).toBe(true);
    ce.popScope();

    expect(ce.expr('w').type.toString()).toBe('unknown');
  });
});

describe('SIGN PATH CONVERGES ON FACT INDEX (Perf P2-3 / SYM P2-7)', () => {
  test('n ∈ Range(1, 10): isPositive agrees with verify(n > 0)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'n', ['Range', 1, 10]]));
    // Historically verify said `true` but the symbol sign said `undefined`.
    expect(ce.verify(ce.box(['Greater', 'n', 0]))).toBe(true);
    expect(ce.box('n').isPositive).toBe(true);
  });

  test('bounds are sharper than the legacy scan (lower bound 1 ⇒ positive)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('n \\geq 1'));
    expect(ce.box('n').isPositive).toBe(true);
  });

  test('legacy symbolic multi-term inference is preserved (superset)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('y \\geq 0'));
    ce.assume(ce.box(['Less', ['Add', 'x', 'y'], 0])); // x + y < 0, y ≥ 0
    expect(ce.box('x').isNegative).toBe(true);
  });

  test('x ≥ 0 together with x ≠ 0 sharpens to positive', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x \\geq 0'));
    ce.assume(ce.box(['NotEqual', 'x', 0]));
    expect(ce.box('x').isPositive).toBe(true);
  });

  test('unconstrained sign stays undefined (fail closed)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 4'));
    expect(ce.box('unrelated').isPositive).toBe(undefined);
  });

  // Non-timing perf guard: many assumptions must not make a bounded-symbol
  // sign query slow (the FactIndex is O(1) after building, vs. the O(N) scan).
  test('sign queries stay fast under many assumptions', () => {
    const ce = new ComputeEngine();
    for (let i = 0; i < 200; i++) ce.assume(ce.box(['Greater', `v${i}`, 0]));
    const sym = ce.box('v100');
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) expect(sym.isPositive).toBe(true);
    const elapsed = performance.now() - t0;
    // Extremely generous threshold: the linear scan took ~30ms+ here; the
    // indexed path is several times faster. Guards against a regression to a
    // per-query full scan without being flaky on slow CI.
    expect(elapsed).toBeLessThan(500);
  });
});

describe('BOUNDS REACH eq()/cmp() (SYM P2-8 / CORRECTNESS P2-14)', () => {
  test('assume(x > 0) discharges x ≠ 0 in verify()', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x > 0'));
    expect(ce.verify(ce.box(['NotEqual', 'x', 0]))).toBe(true);
    expect(ce.box('x').isEqual(0)).toBe(false);
  });

  test('assume(w > 4) refutes w = 2', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('w > 4'));
    expect(ce.box('w').isEqual(2)).toBe(false);
  });

  test('bounded-symbol vs bounded-symbol ordering', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('s > 4'));
    ce.assume(ce.parse('t < 1'));
    expect(ce.box('s').isGreater(ce.box('t'))).toBe(true);
    expect(ce.box('t').isLess(ce.box('s'))).toBe(true);
    expect(ce.box(['Greater', 's', 't']).evaluate().symbol).toBe('True');
  });

  test('overlapping symbol bounds stay undefined (fail closed)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('s > 0'));
    ce.assume(ce.parse('t > 0'));
    expect(ce.box('s').isGreater(ce.box('t'))).toBe(undefined);
    expect(ce.box('s').isEqual(ce.box('t'))).toBe(undefined);
  });
});

describe('CONJUNCTION ATOMICITY (SYM P2-9)', () => {
  test('a contradictory And leaves no residue', () => {
    const ce = new ComputeEngine();
    const r = ce.assume(ce.box(['And', ['Greater', 'p', 0], ['Less', 'p', -5]]));
    expect(r).toBe('contradiction');
    // The first conjunct must NOT have been applied.
    expect(ce.box('p').isPositive).toBe(undefined);
    expect(ce.box('p').sgn).toBe(undefined);
  });

  test('a consistent And still applies every conjunct', () => {
    const ce = new ComputeEngine();
    const r = ce.assume(ce.box(['And', ['Greater', 'a', 0], ['Less', 'b', 10]]));
    expect(r).toBe('ok');
    expect(ce.box('a').isPositive).toBe(true);
    expect(ce.box('b').isLess(10)).toBe(true);
  });
});

describe('NO-ARG forget() UNDOES ASSUMED VALUES (SYM P2-10)', () => {
  test('assume(x = 5) is undone by a no-arg forget()', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('x = 5'));
    expect(ce.box('x').evaluate().json).toBe(5);
    ce.forget();
    expect(ce.box('x').evaluate().json).toBe('x');
  });

  test('a user assign() survives a no-arg forget()', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 7);
    ce.forget();
    expect(ce.box('y').evaluate().json).toBe(7);
  });

  test('a user declared type survives; only the assumed value is cleared', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'real');
    ce.assume(ce.parse('z = 3'));
    ce.forget();
    expect(ce.box('z').evaluate().json).toBe('z');
    expect(ce.box('z').type.toString()).toBe('real');
  });
});

describe('domainToType SIGNED-SET COVERAGE (SYM P2-11)', () => {
  test('PositiveIntegers ⇒ integer and positive', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'k', 'PositiveIntegers']));
    expect(ce.box('k').isInteger).toBe(true);
    expect(ce.box('k').isPositive).toBe(true);
  });

  test('NegativeIntegers ⇒ integer and negative', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'g', 'NegativeIntegers']));
    expect(ce.box('g').isInteger).toBe(true);
    expect(ce.box('g').isNegative).toBe(true);
  });

  test('NonNegativeIntegers ⇒ integer and non-negative', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'h', 'NonNegativeIntegers']));
    expect(ce.box('h').isInteger).toBe(true);
    expect(ce.box('h').isNonNegative).toBe(true);
  });

  test('PositiveNumbers ⇒ real and positive', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'u', 'PositiveNumbers']));
    expect(ce.box('u').type.matches('real')).toBe(true);
    expect(ce.box('u').isPositive).toBe(true);
  });

  test('NonPositiveNumbers ⇒ real and non-positive', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.box(['Element', 'v', 'NonPositiveNumbers']));
    expect(ce.box('v').type.matches('real')).toBe(true);
    expect(ce.box('v').isNonPositive).toBe(true);
  });

  test('a signed-set membership can still be contradicted', () => {
    const ce = new ComputeEngine();
    expect(ce.assume(ce.box(['Element', 'm', 'PositiveIntegers']))).toBe('ok');
    expect(ce.assume(ce.parse('m < 0'))).toBe('contradiction');
  });
});
