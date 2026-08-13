import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

/**
 * Phase 1 of the function-polymorphism design
 * (docs/plans/2026-08-01-function-polymorphism-design.md §4.2–§4.4, D5–D8;
 * implementation plan …-phase1-plan.md): multi-clause function definitions
 * via the `DefineFunction` head — clause accumulation, tri-state dispatch,
 * inert-on-undecidable, `no-matching-clause`, symbol-level effect row.
 *
 * Box/programmatic routes only (the Epsil surface is Phase 2).
 */

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** Define one clause: `DefineFunction(name, Function(body, …params))`. */
function clause(name: string, fn: MathJsonExpression): string {
  return ce.box(['DefineFunction', name, fn]).evaluate().toString();
}

/** A `Typed` parameter carrying a type annotation. */
function p(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

// ─── The §1 acceptance case ─────────────────────────────────────────────────

describe('DEFINE FUNCTION — multi-clause fib (spec §1)', () => {
  beforeEach(() => {
    clause('fib', ['Function', 0, p('z', '0')]);
    clause('fib', ['Function', 1, p('o', '1')]);
    clause('fib', [
      'Function',
      ['Add', ['fib', ['Subtract', 'n', 1]], ['fib', ['Subtract', 'n', 2]]],
      p('n', 'integer'),
    ]);
  });

  it('declares the overload-set type', () => {
    expect(ce.box('fib').type.toString()).toMatchInlineSnapshot(
      `"((z: 0) -> finite_integer) & ((o: 1) -> finite_integer) & ((n: integer) -> broadcastable<number>)"`
    );
  });

  it('dispatches base cases and recursion', () => {
    expect(ce.box(['fib', 0]).evaluate().toString()).toBe('0');
    expect(ce.box(['fib', 1]).evaluate().toString()).toBe('1');
    expect(ce.box(['fib', 10]).evaluate().toString()).toBe('55');
  });

  it('repeated calls with different arguments see each frame', () => {
    // The Match staleness-bug test class: same engine, different args.
    expect(ce.box(['fib', 5]).evaluate().toString()).toBe('5');
    expect(ce.box(['fib', 7]).evaluate().toString()).toBe('13');
    expect(ce.box(['fib', 5]).evaluate().toString()).toBe('5');
    expect(ce.box(['fib', 0]).evaluate().toString()).toBe('0');
    expect(ce.box(['fib', 7]).evaluate().toString()).toBe('13');
  });
});

// ─── Accumulation: replace vs append (§4.3) ─────────────────────────────────

describe('DEFINE FUNCTION — accumulation', () => {
  it('same parameter domain replaces in place; new domain appends', () => {
    clause('g', ['Function', 100, p('a', '0')]);
    clause('g', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    // Same domain (`0`), different parameter NAME and body: replaces.
    clause('g', ['Function', 999, p('b', '0')]);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('999');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('6');
    // Still two clauses (replace, not append): the type has two arms.
    const arms = ce.box('g').type.toString().split('&');
    expect(arms).toHaveLength(2);
  });

  it('replacement preserves clause position (tie-break order stable)', () => {
    clause('g', ['Function', 1, p('a', '0')]);
    clause('g', ['Function', 2, p('x', 'integer')]);
    clause('g', ['Function', 3, p('b', '0')]); // replaces clause 1 in place
    const arms = ce.box('g').type.toString().split(' & ');
    expect(arms[0]).toContain('0');
  });

  it('a body edit changing the inferred result type still replaces', () => {
    clause('g', ['Function', 1, p('a', '0')]);
    clause('g', ['Function', { str: 'now a string' }, p('b', '0')]);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('"now a string"');
    expect(ce.box('g').type.toString()).not.toContain('&');
  });

  it('re-running an identical clause set is idempotent', () => {
    for (let round = 0; round < 2; round++) {
      clause('g', ['Function', 7, p('a', '0')]);
      clause('g', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    }
    expect(ce.box('g').type.toString().split('&')).toHaveLength(2);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('7');
  });

  it('Assign after DefineFunction discards the clause list (D6)', () => {
    clause('g', ['Function', 7, p('a', '0')]);
    clause('g', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    ce.assign('g', ce.box(['Function', ['Multiply', 'x', 2], 'x']).canonical);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('0');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('10');
  });

  it('DefineFunction accumulates onto an Assign-defined function', () => {
    ce.assign(
      'g',
      ce.box(['Function', ['Multiply', 'x', 2], p('x', 'integer')]).canonical
    );
    clause('g', ['Function', 999, p('a', '0')]);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('999');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('10');
  });

  it('a non-Function operand is rejected with an error value', () => {
    const r = clause('bad', 5 as unknown as MathJsonExpression);
    expect(r).toContain('invalid-clause-definition');
  });

  it('a builtin name is shadowed, not accumulated onto', () => {
    clause('Sin', ['Function', 999, p('a', '0')]);
    expect(ce.box(['Sin', 0]).evaluate().toString()).toBe('999');
    // The builtin is untouched in a fresh engine.
    const ce2 = new ComputeEngine();
    expect(ce2.box(['Sin', 0]).evaluate().toString()).toBe('0');
  });

  it('a RECURSIVE clause on a builtin name recurses through the shadow', () => {
    // The self-call must bind the shadowing definition, not the builtin:
    // without the pre-shadow shell, `Sin(n-1)` inside the clause body
    // canonicalizes against builtin Sin and never recurses.
    clause('Sin', ['Function', 0, p('z', '0')]);
    clause('Sin', [
      'Function',
      ['Add', ['Sin', ['Subtract', 'n', 1]], 1],
      p('n', 'integer'),
    ]);
    expect(ce.box(['Sin', 3]).evaluate().toString()).toBe('3');
  });

  it('a rejected clause leaves the installed definition unchanged', () => {
    // The effect-row state must not be mutated by a REJECTED accumulation
    // (a phantom established row would poison later definitions).
    clause('v', ['Function', 1, p('a', '0')]);
    // Reject: a clause whose STATED effects (pure) are exceeded by its own
    // body is refused…
    const r = clause('v', [
      'Function',
      ['Typed', ['Block', ['Random']], { str: '(x: integer) pure -> real' }],
      'x',
    ]);
    expect(r).toContain('incompatible-clause-effects');
    // …and the surviving definition still accepts a compatible clause with
    // NO phantom row established: an effectful clause joins fine.
    const ok = clause('v', ['Function', ['Random'], p('x', 'integer')]);
    expect(ok).toBe('"Nothing"');
    expect(ce.box(['v', 0]).evaluate().toString()).toBe('1');
  });

  it('an explicit row narrower than an existing clause is rejected', () => {
    // Establishing `pure` over an already-registered effectful clause must
    // fail — not silently re-stamp the effectful arm as pure.
    clause('w2', ['Function', ['Random'], p('a', '0')]);
    const r = clause('w2', [
      'Function',
      ['Typed', ['Block', 'x'], { str: '(x: integer) pure -> integer' }],
      'x',
    ]);
    expect(r).toContain('incompatible-clause-effects');
    // The effectful clause still carries its row.
    expect(ce.box('w2').type.toString()).toContain('random');
  });

  it('a type constructor name takes the CONSTRUCTOR interpretation (spec §4.7)', () => {
    // With nominal-types v2 constructor functions live, a definition
    // statement targeting a same-scope type name is a smart-constructor
    // definition — the constructor interpretation wins over clause
    // accumulation. (Epsil: `type frac = …; function frac(…) { … }`.)
    ce.declareType('point', 'tuple<integer, integer>');
    const r = clause('point', [
      'Function',
      ['Tuple', 'a', 'a'],
      p('a', 'integer'),
    ]);
    expect(r).toBe('"Nothing"');
    // The user's arm constructs; the raw-injection arm is intact.
    expect(ce.box(['point', 7]).evaluate().type.toString()).toBe('point');
    expect(ce.box(['point', 1, 2]).evaluate().type.toString()).toBe('point');
  });
});

// ─── Dispatch (§4.4) ────────────────────────────────────────────────────────

describe('DEFINE FUNCTION — tri-state dispatch', () => {
  beforeEach(() => {
    clause('j', ['Function', { str: 'zero!' }, p('a', '0')]);
    clause('j', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
  });

  it('a concrete literal dispatches to the most specific clause', () => {
    expect(ce.box(['j', 0]).evaluate().toString()).toBe('"zero!"');
    expect(ce.box(['j', 3]).evaluate().toString()).toBe('4');
  });

  it('declaration order breaks ties only; specificity wins regardless', () => {
    // The general clause is declared FIRST here; the value clause must
    // still win on its point.
    clause('k', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    clause('k', ['Function', 999, p('a', '0')]);
    expect(ce.box(['k', 0]).evaluate().toString()).toBe('999');
  });

  it('a symbolic argument stays inert while a value clause is undecidable', () => {
    ce.declare('q', 'integer');
    const call = ce.box(['j', 'q']);
    // The general clause ADMITS q — but the more-specific value clause is
    // undecidable, so dispatch must NOT commit (the blocking rule).
    expect(call.evaluate().toString()).toBe('j(q)');
  });

  it('assigning the symbol later dispatches correctly', () => {
    ce.declare('q', 'integer');
    ce.assign('q', 0);
    expect(ce.box(['j', 'q']).evaluate().toString()).toBe('"zero!"');
    const ce2 = ce; // same engine, different value
    ce2.assign('q2', 5);
    expect(ce2.box(['j', 'q2']).evaluate().toString()).toBe('6');
  });

  it('static result type: JOIN when blocked, exact arm when decided', () => {
    ce.declare('q', 'integer');
    expect(ce.box(['j', 'q']).type.toString()).toBe('integer | string');
    expect(ce.box(['j', 0]).type.toString()).toBe('string');
    expect(ce.box(['j', 3]).type.toString()).toBe('integer');
  });

  it('a symbol DECLARED with a value type statically admits (no over-join)', () => {
    // `z: 0` (no value assigned) statically satisfies the `0` clause —
    // dispatch is DECIDED, not undecidable: exact arm result, and the call
    // dispatches to the value clause.
    ce.declare('z', '0');
    expect(ce.box(['j', 'z']).type.toString()).toBe('string');
    expect(ce.box(['j', 'z']).evaluate().toString()).toBe('"zero!"');
  });

  it('a direct literal miss is statically invalid (§4.4 static refutation)', () => {
    clause('only', ['Function', 1, p('a', '0')]);
    clause('only', ['Function', 2, p('b', '1')]);
    // 5 refutes every clause STATICALLY: the call is invalid at
    // validation (not the runtime no-matching-clause path).
    expect(ce.box(['only', 5]).isValid).toBe(false);
  });

  it('a miss revealed only after evaluation is no-matching-clause (D7)', () => {
    clause('only', ['Function', 1, p('a', '0')]);
    clause('only', ['Function', 2, p('b', '1')]);
    ce.declare('w', 'integer'); // statically undecidable against 0|1
    const call = ce.box(['only', 'w']); // boxed BEFORE the value is known
    expect(call.isValid).toBe(true);
    ce.assign('w', 7); // evaluation reveals the miss
    expect(call.evaluate().toString()).toContain('no-matching-clause');
    // Re-BOXING after the assignment sees the concrete value through the
    // symbol and refutes statically instead (§4.4 static consumption).
    expect(ce.box(['only', 'w']).isValid).toBe(false);
  });

  it('mixed arity is allowed (D2); unsaturated calls do not curry (D8)', () => {
    clause('m', ['Function', ['Add', 'x', 'y'], 'x', 'y']);
    clause('m', ['Function', 0, p('a', '0')]);
    expect(ce.box(['m', 1, 2]).evaluate().toString()).toBe('3');
    expect(ce.box(['m', 0]).evaluate().toString()).toBe('0');
    // Arity 1 with a non-0 argument: the unary clause refutes on value,
    // the binary clause refutes on arity — no partial application.
    const miss = ce.box(['m', 9]);
    expect(miss.isValid).toBe(false);
  });
});

// ─── A fully-known value always decides (USER RULING 2026-08-12) ────────────

describe('DEFINE FUNCTION — a fully-known value never keeps dispatch inert', () => {
  beforeEach(() => {
    // No clause carries a VALUE component here: before the ruling,
    // `admissionOf` short-circuited on `hasValueComponent` and `0.3` against
    // `integer` came back undecidable — the more-specific `integer` clause
    // blocked and `a(0.3)` stayed inert even though the argument is fully
    // known. The membership oracle refutes it exactly.
    clause('a', ['Function', 1, p('t', 'integer')]);
    clause('a', ['Function', 2, p('t', 'real')]);
  });

  it('a non-integer literal selects the `real` clause', () => {
    expect(ce.box(['a', 0.3]).evaluate().toString()).toBe('2');
    expect(ce.box(['a', 1.5]).evaluate().toString()).toBe('2');
  });

  it('an integer literal still selects the `integer` clause', () => {
    expect(ce.box(['a', 2]).evaluate().toString()).toBe('1');
    expect(ce.box(['a', -7]).evaluate().toString()).toBe('1');
  });

  it('a value reached through a symbol decides the same way', () => {
    ce.assign('v', 0.3);
    expect(ce.box(['a', 'v']).evaluate().toString()).toBe('2');
  });

  it('a symbolic operand is still undecidable (the blocking rule holds)', () => {
    // The refutation is a property of the VALUE, not of the type: a symbol
    // merely DECLARED `real` cannot refute the `0` clause, so the
    // more-specific clause still blocks.
    clause('d', ['Function', 10, p('a', '0')]);
    clause('d', ['Function', 20, p('t', 'real')]);
    ce.declare('q', 'real');
    expect(ce.box(['d', 'q']).evaluate().toString()).toBe('d(q)');
    // …while the concrete values on either side of the value clause decide.
    expect(ce.box(['d', 0]).evaluate().toString()).toBe('10');
    expect(ce.box(['d', 0.3]).evaluate().toString()).toBe('20');
  });

  it('value-type and disjoint clause rows are unchanged', () => {
    clause('e', ['Function', 10, p('a', '0')]);
    clause('e', ['Function', 20, p('t', 'real')]);
    clause('e', ['Function', 30, p('s', 'string')]);
    expect(ce.box(['e', 0]).evaluate().toString()).toBe('10');
    expect(ce.box(['e', 2]).evaluate().toString()).toBe('20');
    expect(ce.box(['e', 0.3]).evaluate().toString()).toBe('20');
    expect(ce.box(['e', { str: 'hi' }]).evaluate().toString()).toBe('30');
  });
});

// ─── Cyclic structural aliases in a clause parameter ────────────────────────

describe('DEFINE FUNCTION — a cyclic alias parameter terminates', () => {
  it('a NON-PROGRESSING alias cycle decides instead of overflowing', () => {
    // `type alias cyc = cyc | 0` reaches itself through a bare union arm, so
    // unfolding it makes no progress. Routing every fully-known argument
    // through the membership oracle put that shape on the dispatch path:
    // `accepts` recursed forever and threw `RangeError: Maximum call stack
    // size exceeded` for EVERY argument, `0` included. Membership is the
    // least fixed point, so `cyc`'s members are exactly `0`.
    ce.declareType('cyc', 'cyc | 0', { alias: true });
    clause('g', ['Function', 1, p('c', 'cyc')]);
    clause('g', ['Function', 2, p('t', 'number')]);
    expect(ce.box(['g', 0]).evaluate().toString()).toBe('1');
    expect(ce.box(['g', 5]).evaluate().toString()).toBe('2');
    expect(ce.box(['g', 0.3]).evaluate().toString()).toBe('2');
  });

  it('a PROGRESSING recursive value still admits', () => {
    // `type alias nz = 0 | list<nz>` reaches itself through a CONSTRUCTOR, so
    // it legitimately unfolds once per nesting level, each time against a
    // strictly SMALLER value. The guard is keyed on the alias/value PAIR
    // precisely so this keeps working: keyed on the alias alone it cuts at
    // the first element and reports a non-member — `nz` then loses
    // `List(0, 0)` to the `list<number>` clause (verified by trying it).
    //
    // The value component (`0`) is load-bearing in this witness. With a
    // purely structural recursive alias (`number | list<…>`) the static
    // `matches` check admits first and the value oracle never runs at all.
    ce.declareType('nz', '0 | list<nz>', { alias: true });
    clause('k', ['Function', 1, p('n', 'nz')]);
    clause('k', ['Function', 2, p('t', 'number | list<number>')]);
    expect(ce.box(['k', 0]).evaluate().toString()).toBe('1');
    expect(ce.box(['k', ['List', 0, 0]]).evaluate().toString()).toBe('1');
    expect(
      ce.box(['k', ['List', 0, ['List', 0]]]).evaluate().toString()
    ).toBe('1');
    // …and a non-member still falls through to the wider clause.
    expect(ce.box(['k', 1]).evaluate().toString()).toBe('2');
    expect(ce.box(['k', ['List', 1, 2]]).evaluate().toString()).toBe('2');
  });
});

// ─── Effects (D5) ───────────────────────────────────────────────────────────

describe('DEFINE FUNCTION — symbol-level effect row', () => {
  it('the row is the join of the clauses’ inferred effects', () => {
    clause('r', ['Function', ['Random'], p('a', '0')]);
    clause('r', ['Function', 5, p('x', 'integer')]);
    // Both arms carry the joined row; the pure clause adopts it.
    const t = ce.box('r').type.toString();
    expect(t.split('&').every((arm) => arm.includes('random'))).toBe(true);
  });

  it('a pure multi-clause function stays pure', () => {
    clause('s', ['Function', 1, p('a', '0')]);
    clause('s', ['Function', 2, p('x', 'integer')]);
    expect(ce.box('s').type.toString()).not.toContain('random');
    expect(ce.box(['s', 3]).isPure).toBe(true);
  });

  it('arguments are evaluated exactly once per call', () => {
    // An effectful ARGUMENT: admission and application must consume the
    // same evaluated value (one draw per call, not two), and the draw must
    // fire (the identity body returns the drawn literal, not the
    // unevaluated Random application).
    clause('t', ['Function', 'x', p('x', 'real')]);
    const a = ce.box(['t', ['Random']]).evaluate();
    expect(a.isNumberLiteral).toBe(true);
  });
});

// ─── About clause listing (§4.6, Phase 2) ───────────────────────────────────

describe('DEFINE FUNCTION — About clause listing', () => {
  it('lists clauses in declaration order', () => {
    clause('f', ['Function', 100, p('a', '0')]);
    clause('f', ['Function', ['Add', 'n', 1], p('n', 'integer')]);
    const about = ce.box(['About', 'f']).evaluate().toString();
    expect(about).toContain('multi-clause function (2 clauses)');
    expect(about).toContain('clause 1: (a: 0) ->');
    expect(about).toContain('clause 2: (n: integer) ->');
  });

  it('suppresses GENERATED literal-parameter names (§4.5)', () => {
    // The Epsil lowering's generated names (`literalParam_<n>`) render by
    // their value type alone; a user-chosen name (above) is kept.
    clause('f', ['Function', 100, p('literalParam_1', '0')]);
    clause('f', ['Function', ['Add', 'n', 1], p('n', 'integer')]);
    const about = ce.box(['About', 'f']).evaluate().toString();
    expect(about).toContain('clause 1: (0) ->');
    expect(about).not.toContain('literalParam');
  });

  it('annotates a boolean clause covered by true/false clauses', () => {
    clause('f', ['Function', 1, p('a', 'true')]);
    clause('f', ['Function', 0, p('b', 'false')]);
    clause('f', ['Function', 2, p('c', 'boolean')]);
    const about = ce.box(['About', 'f']).evaluate().toString();
    expect(about).toContain('unreachable (covered)');
  });

  it('annotates a tie overlap between incomparable clauses', () => {
    clause('g', ['Function', 1, p('x', 'integer'), p('y', 'number')]);
    clause('g', ['Function', 2, p('x', 'number'), p('y', 'integer')]);
    const about = ce.box(['About', 'g']).evaluate().toString();
    expect(about).toContain(
      'overlaps clause 1; declaration order decides in the overlap'
    );
  });

  it('a single-clause definition keeps today’s About', () => {
    clause('f', ['Function', ['Add', 'x', 1], 'x']);
    const about = ce.box(['About', 'f']).evaluate().toString();
    expect(about).not.toContain('multi-clause function');
  });
});

// ─── Declare-then-define (§4.3a) ────────────────────────────────────────────

describe('DEFINE FUNCTION — declare then define', () => {
  it('accepts clauses that NARROW the declared signature', () => {
    // A clause is an ARM of the declaration: `0 <: number`. Checking it as a
    // function SUBTYPE of the declaration can never pass (parameters are
    // contravariant) — the clause SET implements the declaration.
    ce.declare('J', '(number, complex) -> complex');
    expect(
      clause('J', [
        'Function',
        p('z', 'complex'),
        p('k', '0'),
        p('z', 'complex'),
      ])
    ).toBe('"Nothing"');
    expect(
      clause('J', [
        'Function',
        ['Add', ['Square', ['J', ['Subtract', 'n', 1], 'z']], 'z'],
        p('n', 'integer'),
        p('z', 'complex'),
      ])
    ).toBe('"Nothing"');

    // The declaration stays the symbol's type — a recursive clause's
    // self-call types against it.
    expect(ce.box('J').type.toString()).toBe('(number, complex) -> complex');
    expect(
      ce
        .box(['J', 0, ['Complex', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('(1 + 2i)');
    // z² + z at z = 1+2i is (1+2i)² + (1+2i) = (-3+4i) + (1+2i) = -2+6i
    expect(
      ce
        .box(['J', 1, ['Complex', 1, 2]])
        .N()
        .toString()
    ).toBe('(-2 + 6i)');
  });

  it('a call outside every clause is the D7 error, not a silent total function', () => {
    // The declaration admits `J(5, z)` statically; no clause covers it, so
    // the miss surfaces at evaluation instead of applying the `J(0, z)` body.
    ce.declare('J', '(number, complex) -> complex');
    clause('J', [
      'Function',
      p('z', 'complex'),
      p('k', '0'),
      p('z', 'complex'),
    ]);
    expect(
      ce
        .box(['J', 5, ['Complex', 1, 2]])
        .evaluate()
        .toString()
    ).toContain('no-matching-clause');
  });

  it('a clause outside the declared domain is a LOUD error value', () => {
    ce.declare('g', '(integer) -> integer');
    const r = clause('g', ['Function', 1, p('s', 'string')]);
    expect(r).toContain('invalid-clause-definition');
    expect(r).toContain('is outside the declared');
  });

  it('a clause whose ASCRIBED result escapes the declaration is rejected, and the record stays usable', () => {
    ce.declare('k', '(number) -> integer');
    const r = clause('k', [
      'Function',
      ['Typed', { str: 'hello' }, { str: 'string' }],
      p('a', '0'),
    ]);
    expect(r).toContain('invalid-clause-definition');
    expect(r).toContain('is not a subtype of the declared');
    // Nothing was installed: the declaration survives, the call is inert
    // (not a crash), and a well-typed clause still installs afterwards.
    expect(ce.box('k').type.toString()).toBe('(number) -> integer');
    expect(ce.box(['k', 0]).evaluate().toString()).toBe('k(0)');
    expect(clause('k', ['Function', 7, p('a', '0')])).toBe('"Nothing"');
    expect(ce.box(['k', 0]).evaluate().toString()).toBe('7');
  });

  it('an undeclared clause set is unchanged (intersection signature)', () => {
    clause('f', ['Function', 1, p('a', '0')]);
    clause('f', ['Function', ['Add', 'x', 1], p('x', 'integer')]);
    expect(ce.box('f').type.toString()).toContain('&');
    expect(ce.box(['f', 0]).evaluate().toString()).toBe('1');
    expect(ce.box(['f', 4]).evaluate().toString()).toBe('5');
  });
});

// ─── Route parity ───────────────────────────────────────────────────────────

describe('DEFINE FUNCTION — route parity (box vs pre-boxed)', () => {
  it('pre-boxed ce.function route behaves like raw MathJSON', () => {
    const fn = ce.box(['Function', 42, p('a', '0')]).canonical;
    ce.function('DefineFunction', [ce.symbol('u'), fn]).evaluate();
    ce.box([
      'DefineFunction',
      'u',
      ['Function', ['Add', 'x', 1], p('x', 'integer')],
    ]).evaluate();
    expect(ce.box(['u', 0]).evaluate().toString()).toBe('42');
    expect(ce.box(['u', 9]).evaluate().toString()).toBe('10');
  });
});
