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
    ce.assign('lc_c', 99);
    expect(ce.box(['lc_f0']).evaluate().valueOf()).toEqual(99);
    ce.assign('lc_c', 5); // restore for subsequent tests
  });

  test('free var when outer var is assigned (not re-declared) from inner scope', () => {
    // ce.assign from inner scope without a local declaration walks the scope
    // chain and mutates the outer definition's value. The function then sees
    // the mutated value — this is by-reference, not a scoping bug.
    ce.pushScope();
    ce.assign('lc_c', 10);
    const result = ce.box(['lc_f0']).evaluate().valueOf();
    ce.popScope();
    // Restore: the assign mutated the outer definition, so fix it
    ce.assign('lc_c', 5);
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
