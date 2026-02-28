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
    ce.assign('lc_f0', ce.expr(['Function', ['Block', 'lc_c']]));
  });
  afterAll(() => ce.popScope());

  test('baseline: free var resolves from defining scope when called in same scope', () => {
    // No inner scope — lc_c is 5 in the current scope
    expect(ce.expr(['lc_f0']).evaluate().valueOf()).toEqual(5);
  });

  test('free var when called from inner scope with re-declared variable', () => {
    // Inner scope declares its own lc_c = 10, shadowing the outer one.
    // With TRUE lexical scoping lc_f0() should still return 5 (defining scope).
    // Fixed: previously returned 10 because the calling scope's eval context was
    //        on the stack and found before the defining scope's value.
    let result: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_c', { value: 10 });
      result = ce.expr(['lc_f0']).evaluate().valueOf();
    } finally {
      ce.popScope();
    }
    expect(result).toMatchInlineSnapshot(`5`); // correct: lexical scoping — f sees defining scope's lc_c = 5
  });

  test('free var sees mutation in defining scope (by-reference capture)', () => {
    // Assigning to lc_c in the *same* scope mutates the definition object.
    // This is expected by-reference behaviour, not a bug.
    try {
      ce.assign('lc_c', 99);
      expect(ce.expr(['lc_f0']).evaluate().valueOf()).toEqual(99);
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
      result = ce.expr(['lc_f0']).evaluate().valueOf();
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
    // Function(lc_x2p + lc_c2, lc_x2p): lc_x2p is the param, lc_c2 is free (= 5)
    // Apply to 3 → 3 + 5 = 8
    const f = ce.expr(['Function', ['Add', 'lc_x2p', 'lc_c2'], 'lc_x2p']);
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
    const f = ce.expr(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    expect(
      ce
        .function('Apply', [f, ce.number(7)])
        .evaluate()
        .valueOf()
    ).toEqual(14);
  });

  test('two params, no free vars', () => {
    const f = ce.expr(['Function', ['Add', 'lc_p', 'lc_q'], 'lc_p', 'lc_q']);
    expect(
      ce
        .function('Apply', [f, ce.number(3), ce.number(4)])
        .evaluate()
        .valueOf()
    ).toEqual(7);
  });

  test('after calling a function, outer variable is unchanged', () => {
    // Calling a function that shadows lc_x2 must not affect the outer binding
    const f = ce.expr(['Function', ['Multiply', 'lc_x2', 2], 'lc_x2']);
    ce.function('Apply', [f, ce.number(7)]).evaluate();
    expect(ce.expr('lc_x2').evaluate().valueOf()).toEqual(100);
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
    // lc_outer is a shared shell overwritten by each test independently.
    // Tests are NOT independent — each assigns a different function body to lc_outer.
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
      ce.expr([
        'Function',
        ['Function', ['Add', 'lc_x3', 'lc_y3'], 'lc_x3'],
        'lc_y3',
      ])
    );
    const inner = ce
      .function('Apply', [ce.expr('lc_outer'), ce.number(4)])
      .evaluate();
    const result = ce
      .function('Apply', [inner, ce.number(3)])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`7`);
  });

  test('inner lambda captures global free variable through nesting', () => {
    // lc_c3 = 10 (global in this describe's scope)
    // outer(lc_y3) = Function(lc_x3 + lc_c3, lc_x3)  — lc_c3 is free in inner
    // Apply outer to anything → inner that computes lc_x3 + 10
    // Apply inner to 3 → 13
    ce.assign(
      'lc_outer',
      ce.expr([
        'Function',
        ['Function', ['Add', 'lc_x3', 'lc_c3'], 'lc_x3'],
        'lc_y3',
      ])
    );
    const inner = ce
      .function('Apply', [ce.expr('lc_outer'), ce.number(99)])
      .evaluate();
    const result = ce
      .function('Apply', [inner, ce.number(3)])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`13`); // correct: 3 + 10 = 13
  });

  test('three-level nested closure: innermost captures both outer params', () => {
    // outermost(a)(b)(x) = x + a + b
    // lc3_f(a) = lc3_g(b) = Function(x + a + b, x)
    // Apply(lc3_f, 1)(2)(3) = 3 + 1 + 2 = 6
    ce.pushScope();
    try {
      ce.declare('lc3_f', 'function');
      ce.assign(
        'lc3_f',
        ce.expr([
          'Function',
          ['Function',
            ['Function', ['Add', 'lc3_x', 'lc3_a', 'lc3_b'], 'lc3_x'],
            'lc3_b'],
          'lc3_a',
        ])
      );
      const g = ce.function('Apply', [ce.expr('lc3_f'), ce.number(1)]).evaluate();
      const h = ce.function('Apply', [g, ce.number(2)]).evaluate();
      const result = ce.function('Apply', [h, ce.number(3)]).evaluate().valueOf();
      expect(result).toEqual(6); // 3 + 1 + 2 = 6
    } finally {
      ce.popScope();
    }
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
      .expr(['Sum', ['Add', 'lc_k4', 'lc_c4'], ['Limits', 'lc_k4', 1, 3]])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`36`); // correct: (1+10) + (2+10) + (3+10) = 36
  });

  test('index variable does not leak into outer scope after Sum', () => {
    // After Sum(lc_k4b^2, Limits(lc_k4b, 1, 5)), lc_k4b should be an unknown
    // in the outer scope — not a variable with a stale value.
    // This documents the scope pollution described in SCOPE_POLLUTION.md.
    ce.expr([
      'Sum',
      ['Power', 'lc_k4b', 2],
      ['Limits', 'lc_k4b', 1, 5],
    ]).evaluate();
    // lc_k4b should still be an 'unknown' symbol (no assigned value) after Sum
    expect(ce.expr('lc_k4b').value?.toString()).toMatchInlineSnapshot(
      `undefined`
    ); // correct: index var leaves no stale value in outer scope after Sum
  });

  test('Sum canonicalized inside calling scope sees that scope', () => {
    // Sum is boxed INSIDE the scope where lc_c4=20. The defining scope is
    // the calling scope, so lc_c4=20 is the lexically correct value.
    // (1+20) + (2+20) + (3+20) = 66
    let result: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_c4', { value: 20 }); // shadow in calling scope
      result = ce
        .expr(['Sum', ['Add', 'lc_k4c', 'lc_c4'], ['Limits', 'lc_k4c', 1, 3]])
        .evaluate()
        .valueOf();
    } finally {
      ce.popScope();
    }
    expect(result).toMatchInlineSnapshot(`66`); // correct: Sum was defined in scope where lc_c4=20
  });

  test('Sum canonicalized before scope change uses defining scope', () => {
    // Sum is boxed in the OUTER scope (lc_c4=10), then evaluated inside a
    // scope that shadows lc_c4=20. Lexical scoping gives 36 (the defining scope).
    // (1+10) + (2+10) + (3+10) = 36
    const sumExpr = ce.expr([
      'Sum',
      ['Add', 'lc_k4d', 'lc_c4'],
      ['Limits', 'lc_k4d', 1, 3],
    ]); // boxed outside calling scope (lc_c4=10)
    let result: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_c4', { value: 20 }); // shadow in calling scope
      result = sumExpr.evaluate().valueOf();
    } finally {
      ce.popScope();
    }
    expect(result).toMatchInlineSnapshot(`36`); // correct: lexical scoping uses defining scope's lc_c4=10
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5 — MUTABLE CLOSURE
//
// A function that mutates a free variable via Assign. Tests that mutations
// accumulate correctly and that mutations from one calling scope don't
// bleed through to another.
// ─────────────────────────────────────────────────────────────────────────────

describe('MUTABLE CLOSURE', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_counter', { type: 'integer', value: 0 });
    ce.declare('lc_increment', 'function');
    // lc_increment(): increments lc_counter by 1 and returns new value
    ce.assign(
      'lc_increment',
      ce.expr([
        'Function',
        [
          'Block',
          ['Assign', 'lc_counter', ['Add', 'lc_counter', 1]],
          'lc_counter',
        ],
      ])
    );
  });
  afterAll(() => ce.popScope());

  test('counter increments on each call', () => {
    ce.assign('lc_counter', 0); // reset
    ce.expr(['lc_increment']).evaluate();
    ce.expr(['lc_increment']).evaluate();
    const result = ce.expr(['lc_increment']).evaluate().valueOf();
    expect(result).toEqual(3);
    expect(ce.expr('lc_counter').evaluate().valueOf()).toEqual(3);
  });

  test('same function called from two different calling scopes', () => {
    // Call lc_increment from two nested scopes that each re-declare lc_counter.
    // With lexical scoping the function should always mutate the outer lc_counter.
    // With dynamic scoping it mutates whichever lc_counter is on top of the stack.
    ce.assign('lc_counter', 0); // reset outer

    let fromInner: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_counter', { type: 'integer', value: 100 });
      fromInner = ce.expr(['lc_increment']).evaluate().valueOf();
    } finally {
      ce.popScope();
    }

    const outerAfter = ce.expr('lc_counter').evaluate().valueOf();

    // Fixed: with lexical scoping outerAfter is 1 and fromInner is 1.
    // Previously (dynamic scoping) fromInner mutated the inner lc_counter → fromInner = 101,
    // outerAfter = 0.
    expect(fromInner).toMatchInlineSnapshot(`1`); // correct: lexical scoping mutates outer lc_counter
    expect(outerAfter).toMatchInlineSnapshot(`1`);  // correct: outer lc_counter was mutated
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6 — CURRYING
//
// Partial application: applying a multi-param function to fewer args than
// expected returns a curried function for the remaining args.
// ─────────────────────────────────────────────────────────────────────────────

describe('CURRYING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_c6', { value: 10 });
  });
  afterAll(() => ce.popScope());

  test('full application of two-param function', () => {
    const f = ce.expr(['Function', ['Add', 'lc_p6', 'lc_q6'], 'lc_p6', 'lc_q6']);
    expect(
      ce
        .function('Apply', [f, ce.number(3), ce.number(4)])
        .evaluate()
        .valueOf()
    ).toEqual(7);
  });

  test('partial application produces curried function', () => {
    const f = ce.expr(['Function', ['Add', 'lc_p6', 'lc_q6'], 'lc_p6', 'lc_q6']);
    // Apply to one arg → curried function expecting one more arg
    const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
    // Apply curried to second arg → 3 + 4 = 7
    const result = ce
      .function('Apply', [curried, ce.number(4)])
      .evaluate()
      .valueOf();
    expect(result).toMatchInlineSnapshot(`7`); // correct: 3 + 4 = 7
  });

  test('free variable survives partial application', () => {
    // Function(lc_p6 + lc_q6 + lc_c6, lc_p6, lc_q6) — lc_c6 = 10 is free
    const f = ce.expr([
      'Function',
      ['Add', 'lc_p6', 'lc_q6', 'lc_c6'],
      'lc_p6',
      'lc_q6',
    ]);
    // Partially apply to 3 → Function(3 + lc_q6 + lc_c6, lc_q6)
    const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
    // Apply to 4 → 3 + 4 + 10 = 17
    const result = ce
      .function('Apply', [curried, ce.number(4)])
      .evaluate()
      .valueOf();
    // lc_c6 is correctly resolved from the defining scope — no scope pollution here.
    expect(result).toMatchInlineSnapshot(`17`); // correct: 3 + 4 + 10 = 17
  });

  test('free variable in curried function is not affected by re-declaration in calling scope', () => {
    const f = ce.expr([
      'Function',
      ['Add', 'lc_p6', 'lc_q6', 'lc_c6'],
      'lc_p6',
      'lc_q6',
    ]);
    let result: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_c6', { value: 99 });
      const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
      result = ce
        .function('Apply', [curried, ce.number(4)])
        .evaluate()
        .valueOf();
    } finally {
      ce.popScope();
    }
    // With lexical scoping: lc_c6 should be 10 (defining scope) → 17
    // With dynamic scoping: lc_c6 = 99 → 106
    expect(result).toMatchInlineSnapshot(`17`); // correct: lexical scoping — lc_c6 = 10 from defining scope
  });

  test('partial application stops at Return (no over-evaluation)', () => {
    // f(p, q) = Block(t = p + q, Return(t), Assign(sideEffect, 99))
    // Partially apply p=3 → curried function for q.
    // The Return must stop the body loop — the subsequent Assign must not run.
    ce.pushScope();
    try {
      ce.declare('lc_sideEffect6', { type: 'integer', value: 0 });
      const f = ce.expr([
        'Function',
        [
          'Block',
          ['Declare', 'lc_t6', 'number'],
          ['Assign', 'lc_t6', ['Add', 'lc_p6b', 'lc_q6b']],
          // Return exits here — the Assign below must NOT execute during currying
          ['Return', 'lc_t6'],
          ['Assign', 'lc_sideEffect6', 99],
        ],
        'lc_p6b',
        'lc_q6b',
      ]);
      const curried = ce.function('Apply', [f, ce.number(3)]).evaluate();
      // Side effect must not have fired during partial application
      expect(ce.expr('lc_sideEffect6').evaluate().valueOf()).toEqual(0);
      // Full application should give 3 + 4 = 7
      const result = ce
        .function('Apply', [curried, ce.number(4)])
        .evaluate()
        .valueOf();
      expect(result).toEqual(7);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 7 — RECURSIVE CLOSURE CAPTURE
//
// When a function returns a compound expression (List, Tuple, etc.) containing
// Function literals, those inner functions must also close over the outer
// call's parameters.
// ─────────────────────────────────────────────────────────────────────────────

describe('RECURSIVE CLOSURE CAPTURE', () => {
  test('function returning List of closures', () => {
    // makePair(x) = List(Function(Add(x, 1)), Function(Add(x, 10)))
    // Each closure should capture x from the call.
    ce.pushScope();
    try {
      const makePair = ce.expr([
        'Function',
        [
          'Block',
          [
            'List',
            ['Function', ['Block', ['Add', 'rc_x', 1]]],
            ['Function', ['Block', ['Add', 'rc_x', 10]]],
          ],
        ],
        'rc_x',
      ]);

      const pair = ce.function('Apply', [makePair, ce.number(5)]).evaluate();
      // pair should be List(closure1, closure2)
      expect(pair.operator).toBe('List');

      // Apply closure1() => 5 + 1 = 6
      const r1 = ce.function('Apply', [pair.op1]).evaluate().valueOf();
      expect(r1).toEqual(6);

      // Apply closure2() => 5 + 10 = 15
      const r2 = ce.function('Apply', [pair.op2]).evaluate().valueOf();
      expect(r2).toEqual(15);
    } finally {
      ce.popScope();
    }
  });

  test('function returning nested structure with closure', () => {
    // wrap(x) = Tuple(x, Function(Multiply(x, 2)))
    // The Function inside Tuple should capture x.
    ce.pushScope();
    try {
      const wrap = ce.expr([
        'Function',
        [
          'Block',
          [
            'Tuple',
            'rc_y',
            ['Function', ['Block', ['Multiply', 'rc_y', 2]]],
          ],
        ],
        'rc_y',
      ]);

      const result = ce.function('Apply', [wrap, ce.number(7)]).evaluate();
      expect(result.operator).toBe('Tuple');

      // First element is the value itself
      expect(result.op1.valueOf()).toEqual(7);

      // Second element is the closure: () => 7 * 2 = 14
      const fn = result.op2;
      const r = ce.function('Apply', [fn]).evaluate().valueOf();
      expect(r).toEqual(14);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 8 — CURRYING WITH SCOPED BODIES
//
// Partially applied functions whose bodies contain nested scoped expressions
// (Sum, Product) must correctly resolve the known args during partial
// evaluation and the remaining args on full application.
// ─────────────────────────────────────────────────────────────────────────────

describe('CURRYING WITH SCOPED BODIES', () => {
  test('curried function with Sum in body', () => {
    // f(x, y) = Sum(k, 1, x) + y
    // g = f(3) => curried, g(10) => (1+2+3) + 10 = 16
    ce.pushScope();
    try {
      const f = ce.expr([
        'Function',
        [
          'Block',
          [
            'Add',
            ['Sum', 'cur_k', ['Tuple', 'cur_k', 1, 'cur_x']],
            'cur_y',
          ],
        ],
        'cur_x',
        'cur_y',
      ]);

      // Partially apply x=3
      const g = ce.function('Apply', [f, ce.number(3)]).evaluate();

      // Full application: g(10) => Sum(k,1,3) + 10 = 6 + 10 = 16
      const result = ce.function('Apply', [g, ce.number(10)]).evaluate();
      expect(result.valueOf()).toEqual(16);
    } finally {
      ce.popScope();
    }
  });

  test('curried function with simple body', () => {
    // add(a, b) = a + b
    // inc = add(1), inc(5) => 6
    ce.pushScope();
    try {
      const add = ce.expr([
        'Function',
        ['Block', ['Add', 'cur_a', 'cur_b']],
        'cur_a',
        'cur_b',
      ]);

      const inc = ce.function('Apply', [add, ce.number(1)]).evaluate();
      const result = ce
        .function('Apply', [inc, ce.number(5)])
        .evaluate()
        .valueOf();
      expect(result).toEqual(6);
    } finally {
      ce.popScope();
    }
  });
});
