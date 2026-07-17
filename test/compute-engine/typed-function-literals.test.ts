import { ComputeEngine } from '../../src/compute-engine';

/**
 * Phase 1 of the typed-function-literals design
 * (docs/plans/2026-07-12-typed-function-literals-design.md):
 * - the `Typed` ascription operator
 * - annotated `Function` parameters and return-type ascription
 * - named typed signatures from `type()`
 *
 * A fresh engine is used so that a pre-declared global `x` from another test
 * cannot affect parameter-binding inference.
 */

describe('Typed operator', () => {
  test('type-name symbol op2 is normalized to a string, not auto-declared', () => {
    const ce = new ComputeEngine();
    const t = ce.box(['Typed', 'x', 'integer']);
    // op2 normalized to a string literal
    expect(t.json).toEqual(['Typed', 'x', "'integer'"]);
    // `integer` (the type name) must NOT be auto-declared as a variable
    expect(ce.lookupDefinition('integer')).toBeUndefined();
  });

  test('ascription is transparent at evaluation', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Typed', ['Add', 2, 3], "'integer'"]).evaluate().json).toBe(
      5
    );
  });
});

describe('Annotated function literal — typing (§6.1, §6.2)', () => {
  test('acceptance: annotation reaches body inference (named integer signature)', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]]);
    // The parameter is named and typed, and the inferred result is integer —
    // i.e. the annotation reached body inference, not `unknown`.
    expect(f.type.toString()).toBe('(x: integer) -> integer');
  });

  test('type-name symbol op2 accepted for a parameter', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', 'integer']]);
    expect(f.type.toString()).toBe('(x: integer) -> integer');
    // normalized to a string in the canonical form
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Add', 'x', 1]],
      ['Typed', 'x', "'integer'"],
    ]);
  });

  test('robust against a pre-declared global of the same name', () => {
    const ce = new ComputeEngine();
    // Pollute the global scope with `x`
    ce.box(['Typed', 'x', 'integer']);
    ce.lookupDefinition('x');
    const f = ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]]);
    expect(f.type.toString()).toBe('(x: integer) -> integer');
  });

  test('nested subexpression sees the annotation', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', ['Multiply', 'x', 2], 1],
      ['Typed', 'x', "'integer'"],
    ]);
    // The inner `x * 2` is typed from the integer annotation (finite_integer),
    // not the broad `finite_number` it would be for an unknown parameter.
    const mul = f.ops[0].ops[0].ops[0];
    expect(mul.type.toString()).toBe('finite_integer');

    const untyped = ce.box([
      'Function',
      ['Add', ['Multiply', 'x', 2], 1],
      'x',
    ]);
    const mulUntyped = untyped.ops[0].ops[0].ops[0];
    expect(mulUntyped.type.toString()).toBe('finite_number');
  });

  test('return ascription is used verbatim (bypasses widening)', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Typed', ['Divide', 'x', 2], "'real'"],
      ['Typed', 'x', "'integer'"],
    ]);
    expect(f.type.toString()).toBe('(x: integer) -> real');
  });

  test('untyped literal is unchanged: widening case x + 1', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], 'x']);
    expect(f.type.toString()).toBe('(unknown) -> number');
  });

  test('untyped literal is unchanged: widening case x / 2', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Divide', 'x', 2], 'x']);
    expect(f.type.toString()).toBe('(unknown) -> number');
  });

  test('annotated param whose body is finite-numeric still widens (integer admits ∞)', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Divide', 'x', 2],
      ['Typed', 'x', "'integer'"],
    ]);
    // `integer` is not `finite_number`, so `x/2` (finite_real) widens to number
    expect(f.type.toString()).toBe('(x: integer) -> number');
  });
});

describe('Annotated function literal — canonical form (§4.2)', () => {
  test('MathJSON round-trips param annotation and return ascription', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Typed', ['Divide', 'x', 2], "'real'"],
      ['Typed', 'x', "'integer'"],
    ]);
    // The return ascription moves INSIDE the Block, wrapping the last statement;
    // the parameter annotation is preserved.
    expect(f.json).toEqual([
      'Function',
      ['Block', ['Typed', ['Multiply', ['Rational', 1, 2], 'x'], "'real'"]],
      ['Typed', 'x', "'integer'"],
    ]);
  });

  test('the body slot remains a scoped Block', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Typed', ['Add', 'x', 'y'], "'real'"],
      ['Typed', 'x', "'integer'"],
      'y',
    ]);
    const body = f.ops[0];
    expect(body.operator).toBe('Block');
    expect(body.isScoped).toBe(true);
  });
});

describe('Annotated function literal — application (values only, no enforcement)', () => {
  test('Apply of a typed lambda evaluates correctly', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box(['Apply', ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]], 5])
      .evaluate();
    expect(r.json).toBe(6);
  });

  test('Map over a typed lambda evaluates correctly', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Map',
        ['List', 1, 2, 3],
        ['Function', ['Multiply', 'x', 2], ['Typed', 'x', "'integer'"]],
      ])
      .evaluate();
    // `Map` yields a lazy collection; materialize it for comparison.
    expect(r.toString()).toBe('[2,4,6]');
  });

  test('typed lambda applied to a mismatched value is enforced in strict mode (Phase 2)', () => {
    // In strict mode (the default), a mismatched argument is now rejected —
    // see the Phase 2 describe block below. (Phase 1 used to beta-reduce this
    // to 3.5; that behavior now only holds in non-strict mode.)
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Apply',
        ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]],
        2.5,
      ])
      .evaluate();
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  });
});

describe('Phase 2 — apply-time enforcement (§6.4, §6.5)', () => {
  const typedInc = ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]];

  test('mistyped argument yields an inert Apply carrying incompatible-type', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Apply', typedInc, 2.5]).evaluate();
    // Inert application, argument replaced by an incompatible-type error marker.
    expect(r.operator).toBe('Apply');
    expect(r.json).toEqual([
      'Apply',
      ['Function', ['Block', ['Add', 'x', 1]], ['Typed', 'x', "'integer'"]],
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
  });

  test('diagnostic matches the named-Declare path', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> any');
    const named = ce.box(['g', 2.5]);
    // The named-operator path produces the same incompatible-type ErrorCode.
    expect(named.json).toEqual([
      'g',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
  });

  test('valid call is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Apply', typedInc, 5]).evaluate().json).toBe(6);
  });

  test('an unknown-typed argument passes through and beta-reduces symbolically', () => {
    const ce = new ComputeEngine();
    // `q` is an undeclared symbol (type unknown) — not provably wrong, so it
    // passes validation and the body beta-reduces.
    const r = ce.box(['Apply', typedInc, 'q']).evaluate();
    expect(r.json).toEqual(['Add', 'q', 1]);
  });

  test('an argument typed `any` passes', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'any');
    const r = ce.box(['Apply', typedInc, 'h']).evaluate();
    expect(r.json).toEqual(['Add', 'h', 1]);
  });

  test('Map over a typed lambda error-marks only the mismatched element', () => {
    const ce = new ComputeEngine();
    const m = ce.box(['Map', ['List', 1, 2.5, 3], typedInc]).evaluate();
    const els = [...m.each()].map((el) => el.json);
    expect(els[0]).toBe(2);
    expect(JSON.stringify(els[1])).toContain('incompatible-type');
    expect(els[2]).toBe(4);
  });

  test('non-strict mode: no validation, mistyped argument beta-reduces', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    // Documents current behavior: no per-argument enforcement in non-strict
    // mode, so the mismatched value flows through the beta-reduction.
    expect(ce.box(['Apply', typedInc, 2.5]).evaluate().json).toBe(3.5);
  });

  test('untyped literal: behavior byte-identical (no validation attempted)', () => {
    const ce = new ComputeEngine();
    const untyped = ['Function', ['Add', 'x', 1], 'x'];
    expect(ce.box(['Apply', untyped, 2.5]).evaluate().json).toBe(3.5);
    expect(ce.box(['Apply', untyped, 5]).evaluate().json).toBe(6);
  });
});

describe('Phase 2 — currying preserves annotations (§6.5)', () => {
  const typedAdd = [
    'Function',
    ['Add', 'x', 'y'],
    ['Typed', 'x', "'integer'"],
    ['Typed', 'y', "'real'"],
  ];

  test('curried literal keeps the remaining annotated parameter', () => {
    const ce = new ComputeEngine();
    const curried = ce.box(['Apply', typedAdd, 10]).evaluate();
    // The remaining parameter keeps its `real` annotation.
    expect(curried.type.toString()).toBe('(_1: real) -> number');
  });

  test('applying the remaining argument completes the computation', () => {
    const ce = new ComputeEngine();
    const curried = ce.box(['Apply', typedAdd, 10]).evaluate();
    expect(ce.box(['Apply', curried, 0.5]).evaluate().json).toBe(10.5);
  });

  test('a mistyped applied prefix errors during currying', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['Apply', typedAdd, 2.5]).evaluate();
    expect(r.operator).toBe('Apply');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  });

  test('a mistyped second argument on the curried literal errors', () => {
    const ce = new ComputeEngine();
    const curried = ce.box(['Apply', typedAdd, 10]).evaluate();
    const r = ce.box(['Apply', curried, ['String', 'hi']]).evaluate();
    expect(r.operator).toBe('Apply');
    expect(JSON.stringify(r.json)).toContain('incompatible-type');
  });

  test('curried literal of a return-ascribed function keeps the return type', () => {
    const ce = new ComputeEngine();
    const f = [
      'Function',
      ['Typed', ['Add', 'x', 'y'], "'real'"],
      ['Typed', 'x', "'integer'"],
      ['Typed', 'y', "'integer'"],
    ];
    const curried = ce.box(['Apply', f, 10]).evaluate();
    // Partial application does not change the result type; the `real` return
    // ascription is re-attached to the curried literal.
    expect(curried.type.toString()).toBe('(_1: integer) -> real');
  });
});

describe('Annotated function literal — differentiation', () => {
  test('D of a typed single-param lambda uses the annotated variable', () => {
    const ce = new ComputeEngine();
    const d = ce
      .box(['D', ['Function', ['Power', 'x', 2], ['Typed', 'x', "'real'"]], 'x'])
      .evaluate();
    expect(d.toString()).toBe('2x');
  });
});

describe('Annotated function literal — serialization drops annotations (§8)', () => {
  test('LaTeX \\mapsto drops the parameter annotation', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]]);
    expect(f.latex).toBe('x\\mapsto x+1');
  });

  test('ASCII-math drops the parameter annotation', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]]);
    expect(f.toString()).toBe('(x) |-> x + 1');
  });
});

describe('Shorthand literals are unaffected', () => {
  test('["Add", "_", 1] is unchanged', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Add', '_', 1]);
    expect(f.json).toEqual(['Add', '_', 1]);
    expect(f.type.toString()).toBe('number');
  });
});

describe('Phase 3 — signature derivation for annotated literals (§9.2)', () => {
  const typedInc = ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]];

  test('assigning an annotated literal derives an explicit operator signature', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(typedInc));
    // The operator signature carries the annotated param type AND the ascribed
    // (inferred) return type; the signature is no longer inferred.
    expect(ce.box('f').type.toString()).toBe('(x: integer) -> integer');
    const def = ce.lookupDefinition('f')!;
    expect((def as any).operator.inferredSignature).toBe(false);
  });

  test('calls validate exactly as the Declare workaround does', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(typedInc));
    // A mistyped argument surfaces the same incompatible-type marker as the
    // named `Declare(f, "(integer) -> any", …)` side channel.
    expect(ce.box(['f', 2.5]).json).toEqual([
      'f',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
    // A well-typed argument evaluates.
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('a return ascription flows into the derived signature', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Typed', ['Divide', 'x', 2], "'real'"],
        ['Typed', 'x', "'integer'"],
      ])
    );
    expect(ce.box('f').type.toString()).toBe('(x: integer) -> real');
  });

  test('an untyped literal keeps an inferred signature (pinned behavior)', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x']));
    expect(ce.box('f').type.toString()).toBe('(unknown) -> number');
    const def = ce.lookupDefinition('f')!;
    expect((def as any).operator.inferredSignature).toBe(true);
    // No apply-time validation: a mixed-type argument is not error-marked, and
    // the body beta-reduces (return-type narrowing still works).
    expect(ce.box(['f', 2.5]).json).toEqual(['f', 2.5]);
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });
});

describe('Phase 3 — declared-signature reconciliation (§6.3)', () => {
  test('bare literal assigned to a return-typed declaration no longer throws', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    // Previously threw at boxed-value-definition.ts (weak `number` inference vs
    // declared `integer`). The declared return is now ascribed onto the literal.
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 1], 'x']))
    ).not.toThrow();
    // The declared signature is kept verbatim.
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 2.5]).json).toEqual([
      'f',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('param-annotated literal (no return ascription) reconciles too', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]])
      )
    ).not.toThrow();
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 2.5]).json).toEqual([
      'f',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('Declare(f, type, value) evaluate path reconciles (03e57cc3 shape, real return)', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      'f',
      "'(integer) -> integer'",
      ['Function', ['Add', 'x', 1], 'x'],
    ]).evaluate();
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 2.5]).json).toEqual([
      'f',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('declare-with-value ({type, value}) reconciles', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      type: '(integer) -> integer',
      value: ce.box(['Function', ['Add', 'x', 1], 'x']),
    });
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('an author-supplied return ascription is respected (not overridden)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(integer) -> integer');
    // The literal already ascribes `integer`; reconciliation leaves it alone.
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Typed', ['Add', 'x', 1], "'integer'"],
        ['Typed', 'x', "'integer'"],
      ])
    );
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('a genuine param conflict is still rejected (assign path)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(string) -> string');
    // Declared param `string` vs literal param `integer` cannot be reconciled
    // by return ascription: the compatibility check rejects it.
    expect(() =>
      ce.assign(
        'f',
        ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]])
      )
    ).toThrow();
  });

  test('a genuine param conflict is still rejected (Declare-evaluate path)', () => {
    const ce = new ComputeEngine();
    expect(() =>
      ce
        .box([
          'Declare',
          'f',
          "'(string) -> string'",
          ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]],
        ])
        .evaluate()
    ).toThrow();
  });

  test('Tycho 19.1 — a tuple-param declaration stays enforced after `:=` registration', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(tuple<number, number>) -> unknown');
    // Register the body via the `:=` parse route. (The body scales the point:
    // a `Tuple` argument binds ATOMICALLY — never mapped over its components —
    // so `x + 1` would be the documented `scalar + tuple` rejection.)
    ce.parse('f(x) \\coloneq 2x').evaluate();
    // The declared signature is authoritative and preserved.
    expect(ce.box('f').type.toString()).toBe('(tuple<number, number>) -> unknown');
    // A scalar call still type-errors (tuple required)…
    expect(ce.box(['f', 3]).json).toEqual([
      'f',
      [
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          "'tuple<number, number>'",
          "'finite_integer'",
        ],
      ],
    ]);
    // …and a tuple call evaluates: the point binds whole and scales
    // component-wise (not the pre-atomic `[6,8]` List of per-component calls).
    expect(ce.parse('f((3, 4))').evaluate().toString()).toBe('(6, 8)');
  });

  test('an over-arity literal is rejected (assign path)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    // The literal takes two parameters but the declared signature accepts one.
    // Function subtyping would otherwise treat this as assignable, so the
    // reconciliation rejects it explicitly rather than storing a body that
    // partial-applies on a declared-arity call.
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).toThrow();
  });

  test('an over-arity literal is rejected (`:=` parse path)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    expect(() =>
      ce.parse('f(x, y) \\coloneq x + y').evaluate()
    ).toThrow();
  });

  test('an over-arity literal is rejected (declare-with-value path)', () => {
    const ce = new ComputeEngine();
    // `ce.declare(id, { type, value })` reconciles the literal against the
    // declared signature. The 2-parameter literal cannot service a declared
    // 1-arity call, so the declaration is rejected rather than silently stored.
    expect(() =>
      ce.declare('f', {
        type: '(number) -> number',
        value: ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']),
      })
    ).toThrow();
  });

  test('an over-arity literal is rejected (`Declare` operator surface)', () => {
    const ce = new ComputeEngine();
    // The fresh-declaration branch of the `Declare` operator routes through
    // `ce.declare` and must reject the over-arity literal too.
    expect(() =>
      ce
        .box([
          'Declare',
          'f',
          "'(number) -> number'",
          ['Function', ['Add', 'x', 'y'], 'x', 'y'],
        ])
        .evaluate()
    ).toThrow();
  });

  test('a fixed-arity literal is rejected against an optional-arg signature', () => {
    const ce = new ComputeEngine();
    // `(number, number?) -> number` permits both `f(1)` and `f(1, 2)`. A
    // 2-parameter fixed-arity literal cannot service the 1-arity call (it would
    // partial-apply), so the declaration is a genuine conflict.
    ce.declare('f', '(number, number?) -> number');
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).toThrow();
  });

  test('a fixed-arity literal is rejected against a variadic signature', () => {
    const ce = new ComputeEngine();
    // A variadic declaration accepts arbitrarily many call arities; a
    // fixed-arity literal can only service one, so it is rejected.
    ce.declare('f', '(number+) -> number');
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).toThrow();
  });

  test('an exact-arity literal against an exact declared signature is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(number, number) -> number');
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).not.toThrow();
    expect(ce.box(['f', 3, 4]).evaluate().toString()).toBe('7');
  });

  // Tycho 19.1 — the OBJECT-form declaration `ce.declare(f, { signature })`
  // creates an OPERATOR definition (vs the string form's VALUE definition).
  // Declare-then-assign must reconcile the operator slot the same way, so the
  // two documented spellings are observably equivalent.
  test('object-form declare preserves the signature after `:=` (operator slot)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(tuple<number, number>) -> unknown' });
    ce.parse('f(x) \\coloneq 2x').evaluate();
    // Declared signature preserved (authoritative), not replaced by inference.
    expect(ce.box('f').type.toString()).toBe(
      '(tuple<number, number>) -> unknown'
    );
    // Scalar call still type-errors (tuple required)…
    expect(ce.box(['f', 3]).json).toEqual([
      'f',
      [
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          "'tuple<number, number>'",
          "'finite_integer'",
        ],
      ],
    ]);
    // …and a tuple call evaluates (the point binds atomically and scales).
    expect(ce.parse('f((3, 4))').evaluate().toString()).toBe('(6, 8)');
  });

  test('object-form declare preserves the signature after ce.assign (operator slot)', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(tuple<number, number>) -> unknown' });
    ce.assign('f', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
    expect(ce.box('f').type.toString()).toBe(
      '(tuple<number, number>) -> unknown'
    );
    expect(ce.box(['f', 3]).json).toEqual([
      'f',
      [
        'Error',
        [
          'ErrorCode',
          "'incompatible-type'",
          "'tuple<number, number>'",
          "'finite_integer'",
        ],
      ],
    ]);
    expect(ce.parse('f((3, 4))').evaluate().toString()).toBe('(6, 8)');
  });

  test('object-form and string-form are byte-identical after `:=` (equivalence)', () => {
    const decl = '(tuple<number, number>) -> unknown';
    const cs = new ComputeEngine();
    cs.declare('f', decl);
    cs.parse('f(x) \\coloneq 2x').evaluate();
    const co = new ComputeEngine();
    co.declare('f', { signature: decl });
    co.parse('f(x) \\coloneq 2x').evaluate();
    expect(co.box('f').type.toString()).toBe(cs.box('f').type.toString());
    expect((co.lookupDefinition('f') as any).value.value.json).toEqual(
      (cs.lookupDefinition('f') as any).value.value.json
    );
  });

  test('object-form: an over-arity literal is rejected', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(number) -> number' });
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).toThrow();
    const ce2 = new ComputeEngine();
    ce2.declare('f', { signature: '(number) -> number' });
    expect(() => ce2.parse('f(x, y) \\coloneq x + y').evaluate()).toThrow();
  });

  test('object-form: a declared `unknown` return accepts the inferred body', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(number) -> unknown' });
    ce.parse('f(x) \\coloneq x + 1').evaluate();
    // The declared signature is preserved verbatim (as in the value-slot path);
    // the `unknown` return accepts the literal's concrete inferred body.
    expect(ce.box('f').type.toString()).toBe('(number) -> unknown');
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('object-form: a declared concrete return stays pinned and is enforced', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(integer) -> integer' });
    ce.parse('f(x) \\coloneq x + 1').evaluate();
    expect(ce.box('f').type.toString()).toBe('(integer) -> integer');
    expect(ce.box(['f', 2.5]).json).toEqual([
      'f',
      ['Error', ['ErrorCode', "'incompatible-type'", "'integer'", "'finite_real'"]],
    ]);
    expect(ce.box(['f', 3]).evaluate().json).toBe(4);
  });

  test('an inferred-signature operator def is still replaced (not reconciled)', () => {
    const ce = new ComputeEngine();
    // Assigning a literal to an undeclared name creates an OPERATOR def with an
    // INFERRED signature. A subsequent assignment freely replaces it (today's
    // behavior) — reconciliation applies only to explicitly-declared signatures.
    ce.assign('f', ce.box(['Function', ['Power', 'x', 2], 'x']));
    expect((ce.lookupDefinition('f') as any).operator.inferredSignature).toBe(
      true
    );
    expect(() =>
      ce.assign('f', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']))
    ).not.toThrow();
    expect(ce.box('f').type.toString()).toBe('(unknown, unknown) -> number');
    expect(ce.box(['f', 3, 4]).evaluate().json).toBe(7);
  });

  test('the `any`-return workaround stores the literal unchanged', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Declare',
      'f',
      "'(integer) -> any'",
      ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]],
    ]).evaluate();
    // Declared result `any` already matches the inferred body: no ascription is
    // added, so the stored value is not wrapped in a `Typed` marker.
    const def = ce.lookupDefinition('f')!;
    expect((def as any).value.value.json).toEqual([
      'Function',
      ['Block', ['Add', 'x', 1]],
      ['Typed', 'x', "'integer'"],
    ]);
    expect(ce.box('f').type.toString()).toBe('(integer) -> any');
  });
});

describe('BoxedOperatorDefinition.lambda — public function-body accessor', () => {
  test('exposes parameters and body of a user-defined function', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := x^2 + 1').evaluate();
    const def = ce.lookupDefinition('f')!;
    expect('operator' in def).toBe(true);
    const lambda = (def as any).operator.lambda;
    expect(lambda).toBeDefined();
    // Bare parameter: name preserved, type undefined.
    expect(lambda.parameters).toEqual([{ name: 'x', type: undefined }]);
    // Body is a boxed expression ready to traverse.
    expect(lambda.body.toString()).toBe('{x^2 + 1}');
  });

  test('surfaces annotated parameter types and multiple parameters', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Add', 'x', 1], ['Typed', 'x', 'integer']]));
    ce.parse('m := (u, v) \\mapsto u \\cdot v').evaluate();

    const g = (ce.lookupDefinition('g') as any).operator.lambda;
    expect(g.parameters).toEqual([{ name: 'x', type: 'integer' }]);

    const m = (ce.lookupDefinition('m') as any).operator.lambda;
    expect(m.parameters).toEqual([
      { name: 'u', type: undefined },
      { name: 'v', type: undefined },
    ]);
    expect(m.body.toString()).toBe('{u * v}');
  });

  test('is undefined for a built-in operator', () => {
    const ce = new ComputeEngine();
    const sin = ce.lookupDefinition('Sin')!;
    expect((sin as any).operator.lambda).toBeUndefined();
  });

  // A function declared with a MathJSON `evaluate` handler stores its literal
  // in `form:'raw'` (non-canonical). The accessor must still return the SAME
  // shape as the parse/assign route — a canonical scoped `Block` body — so a
  // consumer can use the body in arithmetic without tripping the "cannot be
  // used in arithmetic operations" asserts.
  test('returns a canonical scoped body for a MathJSON-declared function', () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '(number)->number',
      evaluate: ['Function', ['Add', 'x', 1], 'x'],
    });
    const lambda = (ce.lookupDefinition('g') as any).operator.lambda;
    expect(lambda).toBeDefined();
    expect(lambda.parameters).toEqual([{ name: 'x', type: undefined }]);
    // Same shape as the parse route: canonical, scoped Block.
    expect(lambda.body.operator).toBe('Block');
    expect(lambda.body.isCanonical).toBe(true);
    expect(lambda.body.toString()).toBe('{x + 1}');
    // The body is usable in arithmetic (no assert).
    expect(lambda.body.add(ce.box(2)).toString()).toBe('{x + 1} + 2');
  });

  // Both declaration routes must yield an identical public view.
  test('MathJSON-declared and parse-declared functions expose the same shape', () => {
    const ce = new ComputeEngine();
    ce.declare('gg', {
      signature: '(number)->number',
      evaluate: ['Function', ['Add', 'x', 1], 'x'],
    });
    ce.parse('k(x) := x + 1').evaluate();
    const g = (ce.lookupDefinition('gg') as any).operator.lambda;
    const h = (ce.lookupDefinition('k') as any).operator.lambda;
    expect(g.parameters).toEqual(h.parameters);
    expect(g.body.toString()).toBe(h.body.toString());
    expect(g.body.operator).toBe(h.body.operator);
    expect(g.body.isCanonical).toBe(h.body.isCanonical);
  });
});
