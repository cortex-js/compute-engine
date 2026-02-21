import { ComputeEngine } from '../../src/compute-engine';
import { engine } from '../utils';

const ce: ComputeEngine = engine;

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1 — FREE VARIABLE CAPTURE
//
// The core question: when a Function expression references a free variable
// (one not in its parameter list), does it use the value from the scope
// where the Function was *defined* (lexical) or the scope where it is
// *called* (dynamic)?
//
// The CE currently implements dynamic scoping via an additive eval-context
// stack. Tests below document the actual current behaviour.
// ─────────────────────────────────────────────────────────────────────────────

describe('FREE VARIABLE CAPTURE', () => {
  beforeAll(() => {
    // Outer (defining) scope: lc_c = 5, lc_f0 = Function(lc_c)
    ce.pushScope();
    ce.declare('lc_c', { value: 5 });
    ce.declare('lc_f0', 'function');
    // Zero-param function whose body is just the free variable lc_c
    ce.assign('lc_f0', ce.box(['Function', ['Block', 'lc_c']]));
  });
  afterAll(() => ce.popScope());

  test('baseline: free var resolves from defining scope when called in same scope', () => {
    // No inner scope — lc_c is 5 in the current scope
    expect(ce.box(['lc_f0']).evaluate().valueOf()).toEqual(5);
  });

  test('free var when called from inner scope with re-declared variable', () => {
    // Inner scope declares its own lc_c = 10, shadowing the outer one.
    // With TRUE lexical scoping lc_f0() should still return 5 (defining scope).
    // BUG: currently returns 10 because the calling scope's eval context is
    //      still on the stack and is found before the defining scope's value.
    ce.pushScope();
    ce.declare('lc_c', { value: 10 });
    const result = ce.box(['lc_f0']).evaluate().valueOf();
    ce.popScope();
    expect(result).toMatchInlineSnapshot(`10`); // BUG: should be 5, not 10
  });

  test('free var sees mutation in defining scope (by-reference capture)', () => {
    // Assigning to lc_c in the *same* scope mutates the definition object.
    // This is expected by-reference behaviour, not a bug.
    try {
      ce.assign('lc_c', 99);
      expect(ce.box(['lc_f0']).evaluate().valueOf()).toEqual(99);
    } finally {
      ce.assign('lc_c', 5); // restore for subsequent tests
    }
  });

  test('free var when outer var is assigned (not re-declared) from inner scope', () => {
    // ce.assign from inner scope without a local declaration walks the scope
    // chain and mutates the outer definition's value. The function then sees
    // the mutated value — this is by-reference, not a scoping bug.
    let result: unknown;
    try {
      ce.pushScope();
      ce.assign('lc_c', 10);
      result = ce.box(['lc_f0']).evaluate().valueOf();
    } finally {
      ce.popScope();
      // Restore: the assign mutated the outer definition, so fix it
      ce.assign('lc_c', 5);
    }
    expect(result).toMatchInlineSnapshot(`10`); // expected: 10 (by-reference, not a bug)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2 — PARAMETER SHADOWING
//
// When a parameter has the same name as an outer variable, the parameter
// should shadow it inside the function body.
// ─────────────────────────────────────────────────────────────────────────────

describe('PARAMETER SHADOWING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c2', { value: 5 });
    ce.declare('lc_x2', { value: 100 });
  });
  afterAll(() => ce.popScope());

  test('one param + one free var: param bound, free var from outer scope', () => {
    // Function(lc_x + lc_c2, lc_x): lc_x is the param, lc_c2 is free (= 5)
    // Apply to 3 → 3 + 5 = 8
    const f = ce.box(['Function', ['Add', 'lc_x2p', 'lc_c2'], 'lc_x2p']);
    expect(
      ce
        .function('Apply', [f, ce.number(3)])
        .evaluate()
        .valueOf()
    ).toEqual(8);
  });

  test('param name matches outer variable — param shadows outer', () => {
    // Outer scope has lc_x2 = 100.
    // Function(lc_x2 * 2, lc_x2): lc_x2 is the param.
    // Apply to 7 → 7 * 2 = 14 (the outer lc_x2 = 100 must be shadowed).
    const f = ce.box(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    expect(
      ce
        .function('Apply', [f, ce.number(7)])
        .evaluate()
        .valueOf()
    ).toEqual(14);
  });

  test('two params, no free vars', () => {
    const f = ce.box(['Function', ['Add', 'lc_p', 'lc_q'], 'lc_p', 'lc_q']);
    expect(
      ce
        .function('Apply', [f, ce.number(3), ce.number(4)])
        .evaluate()
        .valueOf()
    ).toEqual(7);
  });

  test('after calling a function, outer variable is unchanged', () => {
    // Calling a function that shadows lc_x2 must not affect the outer binding
    const f = ce.box(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    ce.function('Apply', [f, ce.number(7)]).evaluate();
    expect(ce.box('lc_x2').evaluate().valueOf()).toEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3 — NESTED LAMBDAS
//
// When a Function expression is returned as the result of another Function,
// can the inner function correctly access variables bound by the outer one?
// ─────────────────────────────────────────────────────────────────────────────

describe('NESTED LAMBDAS', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_outer', 'function');
    ce.declare('lc_c3', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('inner lambda captures outer parameter', () => {
    // lc_outer(lc_y3) = Function(lc_x3 + lc_y3, lc_x3)
    // Apply outer to 4 → get a function that adds 4 to its argument
    // Apply that to 3 → 3 + 4 = 7
    ce.assign(
      'lc_outer',
      ce.box([
        'Function',
        ['Function', ['Add', 'lc_x3', 'lc_y3'], 'lc_x3'],
        'lc_y3',
      ])
    );
    const inner = ce
      .function('Apply', [ce.box('lc_outer'), ce.number(4)])
      .evaluate();
    const result = ce
      .function('Apply', [inner, ce.number(3)])
      .evaluate()
      .valueOf();
    // Whether this works depends on whether lc_y3 = 4 survives after the outer
    // function returns (its eval context is popped).
    expect(result).toMatchInlineSnapshot(`"lc_y3" + 3`); // ideally 7
  });

  test('inner lambda captures global free variable through nesting', () => {
    // lc_c3 = 10 (global in this describe's scope)
    // outer(lc_y3) = Function(lc_x3 + lc_c3, lc_x3)  — lc_c3 is free in inner
    // Apply outer to anything → inner that computes lc_x3 + 10
    // Apply inner to 3 → 13
    ce.assign(
      'lc_outer',
      ce.box([
        'Function',
        ['Function', ['Add', 'lc_x3', 'lc_c3'], 'lc_x3'],
        'lc_y3',
      ])
    );
    const inner = ce
      .function('Apply', [ce.box('lc_outer'), ce.number(99)])
      .evaluate();
    const result = ce
      .function('Apply', [inner, ce.number(3)])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`13`); // ideally 13
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4 — LAMBDAS INSIDE BigOps
//
// Interaction between lambda capture and scope pollution (SCOPE_POLLUTION.md).
// When a Sum or Product is canonicalized, a local scope is pushed. Free
// variables in the body get auto-declared in that scope instead of the outer
// scope, which can break lambda capture.
// ─────────────────────────────────────────────────────────────────────────────

describe('LAMBDAS INSIDE BigOps', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c4', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('Sum body with free var resolves to outer scope value', () => {
    // Sum(lc_k4 + lc_c4, Limits(lc_k4, 1, 3))
    // = (1 + 10) + (2 + 10) + (3 + 10) = 11 + 12 + 13 = 36
    // The question is whether lc_c4 resolves to 10 or gets polluted into
    // Sum's scope with value 'unknown'.
    const result = ce
      .box(['Sum', ['Add', 'lc_k4', 'lc_c4'], ['Limits', 'lc_k4', 1, 3]])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`36`); // ideally 36
  });

  test('index variable does not leak into outer scope after Sum', () => {
    // After Sum(lc_k4b^2, Limits(lc_k4b, 1, 5)), lc_k4b should be an unknown
    // in the outer scope — not a variable with a stale value.
    // This documents the scope pollution described in SCOPE_POLLUTION.md.
    ce.box([
      'Sum',
      ['Power', 'lc_k4b', 2],
      ['Limits', 'lc_k4b', 1, 5],
    ]).evaluate();
    // lc_k4b should still be an 'unknown' symbol (no assigned value) after Sum
    expect(ce.box('lc_k4b').value?.toString()).toMatchInlineSnapshot(
      `undefined`
    );
  });

  test('Sum with free var in calling scope (scope pollution interaction)', () => {
    // If lc_c4 gets auto-declared in Sum's scope with type 'unknown',
    // Sum might not see the outer lc_c4 = 10.
    // BUG candidate: the result may be wrong due to scope pollution.
    ce.pushScope();
    ce.declare('lc_c4', { value: 20 }); // shadow in calling scope
    const result = ce
      .box(['Sum', ['Add', 'lc_k4c', 'lc_c4'], ['Limits', 'lc_k4c', 1, 3]])
      .evaluate()
      .valueOf();
    ce.popScope();
    // With true lexical scoping: Sum was canonicalized in outer scope → c4 = 10 → 36
    // With dynamic scoping: Sum sees calling scope's c4 = 20 → (1+20)+(2+20)+(3+20) = 66
    // With scope pollution: c4 was auto-declared in Sum's scope → NaN or 'unknown'
    expect(result).toMatchInlineSnapshot(`66`); // BUG candidate
  });
});
