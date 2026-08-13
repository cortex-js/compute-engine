import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Named-argument calls — `f(rate: 0.05, years: 3)`.
//
// Design: `docs/plans/2026-08-12-named-arguments-design.md`, implementing
// `docs/TYPE_SYSTEM_ROADMAP.md` Appendix C (rulings C1–C6, sub-rulings R1–R4).
//
// These tests exercise the BOX route: the surface syntax emits one
// `["NamedArgument", "'name'", value]` carrier per named argument, and writing
// those carriers by hand reaches the very same normalization seam
// (`makeCanonicalFunction`, `boxed-expression/named-arguments.ts`) the parser
// does. Box-route parity is by construction, so the whole feature is testable
// before the parser lands.
//

/** A `NamedArgument` carrier, as the parser emits it. */
const N = (name: string, value: any): any => [
  'NamedArgument',
  { str: name },
  value,
];

/** An ANNOTATED function-literal parameter. A bare parameter's name does not
 * reach the literal's derived signature (`effects-inference.ts` writes
 * `{ type: 'unknown' }` for it), so an annotation is what makes a user
 * function addressable by name today. */
const T = (name: string, type: string): any => ['Typed', name, { str: type }];

/** Every error code embedded anywhere in `expr`, outermost first. */
function errorCodes(expr: Expression): string[] {
  const out: string[] = [];
  const visit = (e: Expression | undefined): void => {
    if (!e) return;
    if (e.operator === 'Error') {
      const cause = e.ops?.[0];
      if (cause?.operator === 'ErrorCode')
        out.push(cause.ops?.[0]?.string ?? '');
      else if (cause?.string) out.push(cause.string);
    }
    for (const op of e.ops ?? []) visit(op);
  };
  visit(expr);
  return out;
}

/** `ce.assign`ing an annotated literal derives a PINNED signature that carries
 * the parameter names — the shape a named call needs. */
function engineWithF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign(
    'f',
    ce.box([
      'Function',
      ['Divide', 'rate', 'years'],
      T('rate', 'number'),
      T('years', 'number'),
    ] as any)
  );
  return ce;
}

describe('basics', () => {
  test('a named call canonicalizes to the positional call it means', () => {
    const ce = engineWithF();
    const named = ce.box(['f', N('rate', 6), N('years', 3)] as any);
    expect(named.isSame(ce.box(['f', 6, 3] as any))).toBe(true);
    expect(named.evaluate().toString()).toBe('2');
  });

  test('named arguments are order-free', () => {
    const ce = engineWithF();
    const written = ce.box(['f', N('years', 3), N('rate', 6)] as any);
    // The permutation happens at canonicalization, so the two spellings are
    // the SAME expression — `isSame` is strictly syntactic, which is exactly
    // the equivalence being pinned.
    expect(
      written.isSame(ce.box(['f', N('rate', 6), N('years', 3)] as any))
    ).toBe(true);
    expect(written.isSame(ce.box(['f', 6, 3] as any))).toBe(true);
    expect(written.evaluate().toString()).toBe('2');
  });

  test('a positional prefix may be followed by named arguments', () => {
    const ce = engineWithF();
    const mixed = ce.box(['f', 6, N('years', 3)] as any);
    expect(mixed.isSame(ce.box(['f', 6, 3] as any))).toBe(true);
    expect(mixed.evaluate().toString()).toBe('2');
  });

  test('a trailing optional may simply be omitted', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(x: number, y: number?) -> number');
    expect(ce.box(['g', N('x', 1)] as any).toString()).toBe('g(1)');
  });
});

describe('diagnostics', () => {
  test('an unknown name reports `argument-name-unknown`, with a did-you-mean', () => {
    const ce = engineWithF();
    const bad = ce.box(['f', N('rates', 6), N('years', 3)] as any);
    expect(errorCodes(bad)).toEqual(['argument-name-unknown']);
    expect(bad.toString()).toContain('did you mean `rate`?');
    expect(bad.toString()).toContain(
      'declared parameter names: `rate`, `years`'
    );
  });

  test('a positional argument after a named one reports `argument-order-invalid`', () => {
    const ce = engineWithF();
    expect(errorCodes(ce.box(['f', N('rate', 6), 3] as any))).toEqual([
      'argument-order-invalid',
    ]);
  });

  test('a name repeated reports `argument-name-duplicate`', () => {
    const ce = engineWithF();
    const dup = ce.box(['f', N('rate', 6), N('rate', 7)] as any);
    expect(errorCodes(dup)).toEqual(['argument-name-duplicate']);
    expect(dup.toString()).toContain('filled by an earlier named argument');
  });

  test('a name for a slot already filled positionally reports `argument-name-duplicate`', () => {
    const ce = engineWithF();
    const dup = ce.box(['f', 6, N('rate', 7)] as any);
    expect(errorCodes(dup)).toEqual(['argument-name-duplicate']);
    expect(dup.toString()).toContain('filled by a positional argument');
  });

  test('skipping an earlier optional reports `argument-optional-skipped` (R1)', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(x: number, y: number?, z: number?) -> number');
    const hole = ce.box(['g', 1, N('z', 3)] as any);
    expect(errorCodes(hole)).toEqual(['argument-optional-skipped']);
    expect(hole.toString()).toContain('`y` is not');
    // The neighbouring well-formed call is unaffected.
    expect(ce.box(['g', 1, N('y', 3)] as any).toString()).toBe('g(1, 3)');
  });

  test('an optional hole is reported ahead of an unsatisfiable `+` tail', () => {
    // Two problems in one call: `b` is skipped (R1) AND the `+` tail is empty.
    // The hole is the more specific diagnostic — it names the parameter the
    // author skipped — so it is the one reported.
    //
    // The signature is built as a Type OBJECT because the type-string parser
    // rejects optional and variadic parameters in the same signature
    // ("Variadic arguments cannot be used with optional arguments",
    // common/type/parser.ts).
    const ce = new ComputeEngine();
    ce.declare('v', {
      kind: 'signature',
      args: [{ name: 'a', type: 'number' }],
      optArgs: [
        { name: 'b', type: 'number' },
        { name: 'c', type: 'number' },
      ],
      variadicArg: { name: 'rest', type: 'number' },
      variadicMin: 1,
      result: 'number',
    } as any);
    const call = ce.box(['v', N('a', 1), N('c', 3)] as any);
    expect(errorCodes(call)).toEqual(['argument-optional-skipped']);
    expect(call.toString()).toContain('`b` is not');
  });

  test('an unfilled required parameter reports `missing` — a named call never curries (C5)', () => {
    const ce = engineWithF();
    const under = ce.box(['f', N('rate', 6)] as any);
    expect(errorCodes(under)).toEqual(['missing']);
    expect(under.toString()).toContain('no value for parameter `years`');
    // Saturation is stamped at canonicalization, so evaluation cannot reach
    // the under-application (currying) branch.
    expect(under.evaluate().operator).toBe('Error');
  });

  test('the POSITIONAL under-filled call still curries', () => {
    // The saturation rule is about NAMED calls only. A callee whose signature
    // was inferred (an unannotated literal) skips argument validation, and an
    // under-filled positional call to it is a partial application, exactly as
    // before this feature.
    const ce = new ComputeEngine();
    ce.assign('p', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    const curried = ce.box(['p', 1] as any).evaluate();
    expect(curried.operator).toBe('Function');
    expect(errorCodes(curried)).toEqual([]);
  });

  test('a `+` variadic tail cannot be satisfied by a named call', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(a: number, rest: number+) -> number');
    const call = ce.box(['h', N('a', 1)] as any);
    expect(errorCodes(call)).toEqual(['missing']);
    expect(call.toString()).toContain('requires at least one');
  });

  test('a positional argument may not reach the variadic tail of a named call', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(a: number, rest: number*) -> number');
    const call = ce.box(['k', 1, 2, N('a', 3)] as any);
    expect(errorCodes(call)).toEqual(['unexpected-argument']);
    expect(call.toString()).toContain('cannot also fill the variadic tail');
  });
});

describe('spread arguments', () => {
  // A `Spread` operand does not become ONE argument: it splices into an
  // unknown number of them at EVALUATION, so which parameter each written
  // argument fills is not knowable at canonicalization. The seam fails closed
  // rather than counting the spread as one slot.
  test('a spread alongside a named argument declines (box route)', () => {
    const ce = new ComputeEngine();
    ce.declare('s', '(a: number, b: number) -> number');
    ce.declare('xs', 'tuple<number, number>');
    const call = ce.box(['s', ['Spread', 'xs'], N('b', 2)] as any);
    expect(errorCodes(call)).toEqual(['argument-names-unavailable']);
    expect(call.toString()).toContain('a spread argument makes the argument');
    // The all-positional spread call is untouched.
    expect(errorCodes(ce.box(['s', ['Spread', 'xs']] as any))).toEqual([]);
  });

  test('a spread alongside a named argument declines (parse route)', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      `function f(rate: number, years: number) { rate / years }
const t = (1, 2)
f(...t, rate: 1)`
    );
    expect(errorCodes(r.value! as any)).toEqual(['argument-names-unavailable']);
    expect(String(r.value)).toContain('a spread argument makes the argument');
  });
});

describe('`Nothing` as an omitted argument', () => {
  // `Nothing` is the engine's absent-value marker and cannot survive
  // positionally — `flatten` drops it unconditionally — so a named argument
  // carrying it is treated as not written at all, and the ordinary rules
  // apply to the slot it would have filled.
  test('a required parameter given `Nothing` is `missing`, not shifted', () => {
    const ce = new ComputeEngine();
    ce.declare('q', '(a: number, b: number) -> number');
    const call = ce.box(['q', N('a', 'Nothing'), N('b', 2)] as any);
    expect(errorCodes(call)).toEqual(['missing']);
    expect(call.toString()).toContain('no value for parameter `a`');
    // The value `2` must NOT have slid into slot 0.
    expect(call.op1.operator).toBe('Error');
    expect(call.op2.toString()).toBe('2');
  });

  test('an omitted argument is still a NAMED one for the order rule', () => {
    // The omission is applied when the slot is FILLED, not when the call is
    // split, so `Nothing` cannot launder an illegal spelling into a legal one:
    // this stays "a positional argument after a named one", and must not
    // quietly become `q(2)` with `2` bound to `a`.
    const ce = engineWithF();
    const call = ce.box(['f', N('rate', 'Nothing'), 3] as any);
    expect(errorCodes(call)).toEqual(['argument-order-invalid']);
    expect(call.isSame(ce.box(['f', 3] as any))).toBe(false);
  });

  test('a name written twice is a duplicate even when one is omitted', () => {
    // The omitted argument CLAIMS its slot, so the call is judged as written.
    const ce = engineWithF();
    expect(
      errorCodes(ce.box(['f', N('rate', 'Nothing'), N('rate', 6)] as any))
    ).toEqual(['argument-name-duplicate']);
    expect(errorCodes(ce.box(['f', 6, N('rate', 'Nothing')] as any))).toEqual([
      'argument-name-duplicate',
    ]);
  });

  test('a boxed `Nothing` symbol is recognized too', () => {
    const ce = new ComputeEngine();
    ce.declare('q', '(a: number, b: number) -> number');
    const call = ce.box(['q', N('a', ce.box('Nothing')), N('b', 2)] as any);
    expect(errorCodes(call)).toEqual(['missing']);
    expect(call.op1.operator).toBe('Error');
    expect(call.op1.toString()).toContain('no value for parameter `a`');
    expect(call.op2.toString()).toBe('2');
  });

  test('a trailing optional given `Nothing` is simply not supplied', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(a: number, b: number?) -> number');
    expect(ce.box(['g', N('a', 1), N('b', 'Nothing')] as any).toString()).toBe(
      ce.box(['g', N('a', 1)] as any).toString()
    );
    expect(
      errorCodes(ce.box(['g', N('a', 1), N('b', 'Nothing')] as any))
    ).toEqual([]);
  });

  test('an optional given `Nothing` before a supplied one is an R1 hole', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(a: number, b: number?, c: number?) -> number');
    const call = ce.box(['h', N('a', 1), N('b', 'Nothing'), N('c', 3)] as any);
    expect(errorCodes(call)).toEqual(['argument-optional-skipped']);
    expect(call.toString()).toContain('`b` is not');
  });
});

describe('library signatures', () => {
  test('a partially-named builtin accepts its named slot', () => {
    const ce = new ComputeEngine();
    // `Sort: (indexed_collection<T>, order: function?) -> list<T>` — the
    // source is positional-only, `order` is named.
    const sorted = ce.box([
      'Sort',
      ['List', 3, 1, 2],
      N('order', 'Less'),
    ] as any);
    expect(errorCodes(sorted)).toEqual([]);
    expect(sorted.evaluate().toString()).toBe('[1,2,3]');
  });

  test('a POSITIONAL-ONLY slot cannot be addressed by name', () => {
    const ce = new ComputeEngine();
    const bad = ce.box([
      'Sort',
      N('collection', ['List', 3, 1, 2]),
      N('order', 'Less'),
    ] as any);
    expect(errorCodes(bad)).toEqual(['argument-name-unknown']);
    expect(bad.toString()).toContain('declared parameter names: `order`');
  });

  test('a builtin that declares no parameter names says so', () => {
    // `Add` and `List` are variadic with unnamed parameters, so a named call
    // to either is an unknown NAME, not a shape the fast paths may swallow:
    // the numeric and `List` short paths are skipped for a named call
    // precisely so the name reaches a signature.
    const ce = new ComputeEngine();
    expect(errorCodes(ce.box(['Add', 1, N('x', 2)] as any))).toEqual([
      'argument-name-unknown',
    ]);
    const list = ce.box(['List', 1, N('x', 2)] as any);
    expect(errorCodes(list)).toEqual(['argument-name-unknown']);
    expect(list.toString()).toContain('this function declares no parameter');
  });
});

describe('callees without a usable declaration (§6)', () => {
  test('an unknown callee reports `argument-names-unavailable`', () => {
    const ce = new ComputeEngine();
    expect(errorCodes(ce.box(['undeclaredCallee', N('a', 1)] as any))).toEqual([
      'argument-names-unavailable',
    ]);
  });

  test('a forward reference reports `argument-names-unavailable`', () => {
    // The call is canonicalized BEFORE the definition exists — the shipped
    // static posture is that such a call is not validated, and there are no
    // names to check.
    const ce = new ComputeEngine();
    const early = ce.box(['later', N('rate', 6), N('years', 3)] as any);
    expect(errorCodes(early)).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
    ce.assign(
      'later',
      ce.box([
        'Function',
        ['Divide', 'rate', 'years'],
        T('rate', 'number'),
        T('years', 'number'),
      ] as any)
    );
    // Defining it afterwards does not retroactively fix the already-boxed
    // call; a freshly boxed one normalizes.
    expect(
      errorCodes(ce.box(['later', N('years', 3), N('rate', 6)] as any))
    ).toEqual([]);
  });

  test('a wildcard `function`-typed value with NO assigned value reports `argument-names-unavailable`', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'function');
    expect(errorCodes(ce.box(['w', N('a', 1), N('b', 2)] as any))).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
  });

  test('a wildcard declaration reads the ASSIGNED value’s signature', () => {
    // The bare `function` declaration carries no parameter types and stays
    // that way through assignment, so `calleeSignatureType` reads the assigned
    // value's own signature — the same source the wildcard narrowing sink
    // uses. An ANNOTATED literal therefore supplies names and the named call
    // works; an UNANNOTATED one supplies none — a bare parameter contributes
    // `{ type: 'unknown' }` with no `name` to the literal's derived signature
    // — so the call is diagnosed as an unknown name.
    const ce = new ComputeEngine();
    ce.declare('w', 'function');
    ce.assign(
      'w',
      ce.box([
        'Function',
        ['Divide', 'rate', 'years'],
        T('rate', 'number'),
        T('years', 'number'),
      ] as any)
    );
    const call = ce.box(['w', N('years', 3), N('rate', 6)] as any);
    expect(errorCodes(call)).toEqual([]);
    expect(call.evaluate().toString()).toBe('2');

    const ce2 = new ComputeEngine();
    ce2.declare('u', 'function');
    ce2.assign('u', ce2.box(['Function', ['Add', 'a', 'b'], 'a', 'b'] as any));
    expect(errorCodes(ce2.box(['u', N('a', 1), N('b', 2)] as any))).toEqual([
      'argument-name-unknown',
    ]);
  });

  test('a carrier outside any call reports `argument-names-unavailable`', () => {
    const ce = new ComputeEngine();
    expect(errorCodes(ce.box(N('a', 1)))).toEqual([
      'argument-names-unavailable',
    ]);
  });

  test('an inline literal applied directly declines (R4)', () => {
    const ce = new ComputeEngine();
    const literal: any = ['Function', ['Add', 'x', 1], T('x', 'number')];
    // Both spellings canonicalize to `Apply`, whose own first parameter is the
    // callee — so the name is meant for the literal, not for `Apply`.
    expect(errorCodes(ce.box([literal, N('x', 2)] as any))).toEqual([
      'argument-names-unavailable',
    ]);
    expect(errorCodes(ce.box(['Apply', literal, N('x', 2)] as any))).toEqual([
      'argument-names-unavailable',
    ]);
  });

  test('the QUALIFIED protocol-member spelling declines (R4)', () => {
    // `Protocol.member(…)` parses as `Apply(Field(Protocol, "member"), …)`,
    // and `Apply` is excluded from the seam: its own first parameter IS the
    // callee, so a name written in its argument list is meant for that callee.
    // The BARE spelling of the same call is permuted (see "protocol dispatch"
    // below); this one waits on `Apply` learning to read its callee's names.
    const ce = new ComputeEngine();
    ce.declareProtocol('Tagged', {
      functions: { tag: '(self: Self, prefix: string) -> string' },
    });
    ce.declareProtocolImplementation('integer', 'Tagged', {
      functions: { tag: (_self: any, prefix: any) => `${prefix.string}:int` },
    });
    const qualified: any = [
      'Apply',
      ['Field', 'Tagged', { str: 'tag' }],
      N('prefix', { str: 'p' }),
      N('self', 5),
    ];
    expect(errorCodes(ce.box(qualified))).toEqual([
      'argument-names-unavailable',
      'argument-names-unavailable',
    ]);
    // The positional qualified call is untouched.
    expect(
      ce
        .box(['Apply', ['Field', 'Tagged', { str: 'tag' }], 5, { str: 'p' }])
        .evaluate()
        .toString()
    ).toBe('"p:int"');
  });
});

describe('overloads (§4) — per-arm permutation', () => {
  /** Add one clause to a multi-clause function definition. */
  function clause(ce: ComputeEngine, name: string, fn: any): void {
    ce.box(['DefineFunction', name, fn] as any).evaluate();
  }

  /** The shipped 3-clause `fib` (`define-function.test.ts`): its clauses name
   * position 0 differently — `((z: 0) -> …) & ((o: 1) -> …) & ((n: integer) ->
   * …)` — which is why an overload set cannot be permuted with one order. */
  function engineWithFib(): ComputeEngine {
    const ce = new ComputeEngine();
    clause(ce, 'fib', ['Function', 0, T('z', '0')]);
    clause(ce, 'fib', ['Function', 1, T('o', '1')]);
    clause(ce, 'fib', [
      'Function',
      ['Add', ['fib', ['Subtract', 'n', 1]], ['fib', ['Subtract', 'n', 2]]],
      T('n', 'integer'),
    ]);
    return ce;
  }

  test('each clause is callable by its OWN parameter name', () => {
    const ce = engineWithFib();
    for (const [name, arg, result] of [
      ['z', 0, '0'],
      ['o', 1, '1'],
      ['n', 10, '55'],
    ] as const) {
      const call = ce.box(['fib', N(name, arg)] as any);
      expect(errorCodes(call)).toEqual([]);
      // Every arm's permutation is the identity at arity 1, so all three
      // spellings canonicalize to the same positional call — which is the
      // point: the NAME chose the arm, the operand list is the same.
      expect(call.isSame(ce.box(['fib', arg] as any))).toBe(true);
      expect(call.evaluate().toString()).toBe(result);
    }
  });

  test('a name no arm declares lists the union of the arms’ names', () => {
    const ce = engineWithFib();
    const bad = ce.box(['fib', N('q', 10)] as any);
    expect(errorCodes(bad)).toEqual(['argument-name-unknown']);
    expect(bad.toString()).toContain('declared parameter names: `z`, `o`, `n`');
  });

  test('names filter arms before types: a name only one arm declares', () => {
    const ce = new ComputeEngine();
    ce.declare('ov', '((a: number) -> number) & ((s: string) -> string)');
    expect(errorCodes(ce.box(['ov', N('a', 1)] as any))).toEqual([]);
    expect(ce.box(['ov', N('a', 1)] as any).type.toString()).toBe('number');
    expect(ce.box(['ov', N('s', { str: 'q' })] as any).type.toString()).toBe(
      'string'
    );
    // A name NEITHER arm declares is the union-listing diagnostic again.
    expect(errorCodes(ce.box(['ov', N('z', 1)] as any))).toEqual([
      'argument-name-unknown',
    ]);
  });

  test('swapped names: each arm reads the call in its OWN order', () => {
    // Two clauses whose parameter names are swapped and whose parameter TYPES
    // differ, so exactly one of the two permutations type-checks in each call.
    const ce = new ComputeEngine();
    clause(ce, 'sel', [
      'Function',
      ['Add', 'x', 1],
      T('x', 'integer'),
      T('y', 'string'),
    ]);
    clause(ce, 'sel', ['Function', 99, T('y', 'boolean'), T('x', 'string')]);
    expect(ce.box('sel').type.toString()).toBe(
      '((x: integer, y: string) -> integer) & ((y: boolean, x: string) -> number)'
    );

    // `x: 7` must land in the FIRST parameter (the first clause's `x`), not in
    // the position it was written at.
    const first = ce.box(['sel', N('y', { str: 's' }), N('x', 7)] as any);
    expect(errorCodes(first)).toEqual([]);
    expect(first.isSame(ce.box(['sel', 7, { str: 's' }] as any))).toBe(true);
    expect(first.evaluate().toString()).toBe('8');

    // The mirror image resolves through the OTHER clause, whose declaration
    // order is the reverse — the emitted operands are reversed with it.
    const second = ce.box(['sel', N('x', { str: 'q' }), N('y', 'True')] as any);
    expect(errorCodes(second)).toEqual([]);
    expect(second.isSame(ce.box(['sel', 'True', { str: 'q' }] as any))).toBe(
      true
    );
    expect(second.evaluate().toString()).toBe('99');
  });

  test('swapped names: one arm outranking the other resolves the call', () => {
    // Both arms accept the call in their own order, but the first is strictly
    // more specific at the source slot `x` fills (`integer` inside `number`),
    // so ranking picks it and its order is what is emitted.
    const ce = new ComputeEngine();
    ce.declare(
      'sw',
      '((x: integer, y: number) -> number) & ((y: number, x: number) -> string)'
    );
    const call = ce.box(['sw', N('x', 1), N('y', 2)] as any);
    expect(errorCodes(call)).toEqual([]);
    expect(call.isSame(ce.box(['sw', 1, 2] as any))).toBe(true);
    expect(call.type.toString()).toBe('number');
  });

  test('swapped names: a ranking tie is an error (R3)', () => {
    // Neither arm outranks the other and they disagree about which argument
    // fills which parameter, so declaration order would be picking an argument
    // ORDER, not just an implementation.
    const ce = new ComputeEngine();
    ce.declare(
      'tie',
      '((x: number, y: number) -> number) & ((y: number, x: number) -> string)'
    );
    const call = ce.box(['tie', N('x', 1), N('y', 2)] as any);
    expect(errorCodes(call)).toEqual(['argument-names-unavailable']);
    expect(call.toString()).toContain('disagree about the order');
    // The positional call through the same overload set is untouched.
    expect(errorCodes(ce.box(['tie', 1, 2] as any))).toEqual([]);
  });

  test('swapped names: an order the reordered call would lose is ENFORCED (R5)', () => {
    // What the seam normally emits is an operand ARRAY, never an arm
    // selection, and the call is resolved again below it. Here the names
    // select the second clause, but its reordered operands are ALSO accepted
    // by the first — which reads them in the other order and would bind each
    // value to the parameter the author did not name. The names determine ONE
    // clause (the first refuses `x: "q"`), so the call is pinned to that
    // clause's function literal rather than re-dispatched: that is what makes
    // the name-elimination semantic (sub-ruling R5), and it is why the printed
    // form is the direct application.
    const ce = new ComputeEngine();
    clause(ce, 'sel', [
      'Function',
      ['Add', 'x', 1],
      T('x', 'integer'),
      T('y', 'string'),
    ]);
    clause(ce, 'sel', [
      'Function',
      ['Add', 'y', 100],
      T('y', 'number'),
      T('x', 'string'),
    ]);
    const call = ce.box(['sel', N('x', { str: 'q' }), N('y', 7)] as any);
    expect(errorCodes(call)).toEqual([]);
    expect(call.toString()).toBe('Apply((y, x) |-> y + 100, 7, "q")');
    expect(call.evaluate().toString()).toBe('107');

    // The unambiguous direction needs no pinning — the positional call it
    // emits resolves to the very clause the names chose — so it keeps the
    // ordinary printed form.
    const other = ce.box(['sel', N('y', { str: 's' }), N('x', 7)] as any);
    expect(other.toString()).toBe('sel(7, "s")');
    expect(other.evaluate().toString()).toBe('8');
  });

  test('an all-positional call through the same overload sets is unchanged', () => {
    // The identity-permutation regression: with no carrier present the whole
    // §4 path is unreachable, so an overloaded callee behaves exactly as it did
    // before named arguments existed.
    const ce = engineWithFib();
    expect(ce.box(['fib', 10] as any).toString()).toBe('fib(10)');
    expect(
      ce
        .box(['fib', 10] as any)
        .evaluate()
        .toString()
    ).toBe('55');

    const ce2 = new ComputeEngine();
    ce2.declare(
      'sw',
      '((x: integer, y: number) -> number) & ((y: number, x: number) -> string)'
    );
    expect(ce2.box(['sw', 1, 2] as any).type.toString()).toBe('number');
    expect(ce2.box(['sw', 1.5, 2] as any).type.toString()).toBe('string');
    expect(
      errorCodes(ce2.box(['sw', { str: 'q' }, 2] as any)).length
    ).toBeGreaterThan(0);
  });

  //
  // Sub-ruling R5 — a name ELIMINATES every branch that does not declare it,
  // and the elimination is semantic: it survives past static resolution into
  // validation and into runtime clause dispatch. Within the surviving set,
  // resolution proceeds exactly as it does for a positional call (types
  // statically, values at runtime).
  //

  test('a single surviving arm whose types refuse is an error, not another arm (R5)', () => {
    // `a` is declared by the number arm alone, so the string arm is gone
    // before any type is looked at. The call must then be judged against the
    // arm the name chose — which refuses a string — and never quietly handed
    // to the arm that would have accepted it.
    const ce = new ComputeEngine();
    ce.declare('ov', '((a: number) -> number) & ((s: string) -> string)');
    const call = ce.box(['ov', N('a', { str: 'q' })] as any);
    expect(errorCodes(call)).toEqual(['incompatible-type']);
    expect(call.toString()).toBe(
      'ov(Error(ErrorCode("incompatible-type", "number", "string"), "q"))'
    );
    // The arm the name DOES fit is unaffected.
    expect(errorCodes(ce.box(['ov', N('a', 1)] as any))).toEqual([]);
    expect(ce.box(['ov', N('a', 1)] as any).type.toString()).toBe('number');
  });

  /** The `fib` clause shape with distinguishable bodies: which clause ran is
   * readable off the result. */
  function engineWithZON(): ComputeEngine {
    const ce = new ComputeEngine();
    clause(ce, 'f', ['Function', { str: 'zero' }, T('z', '0')]);
    clause(ce, 'f', ['Function', { str: 'one' }, T('o', '1')]);
    clause(ce, 'f', ['Function', { str: 'many' }, T('n', 'integer')]);
    return ce;
  }

  test('a name outranks a runtime value: `f(n: 0)` runs the `n` clause (R5)', () => {
    const ce = engineWithZON();
    // Positionally, 0 dispatches to the base clause.
    expect(ce.box(['f', 0] as any).evaluate().toString()).toBe('"zero"');
    // Naming `n` eliminates the `z` and `o` clauses, and the elimination
    // survives into dispatch: the call is pinned to the `n` clause's literal,
    // which is what the changed printed form records.
    const named = ce.box(['f', N('n', 0)] as any);
    expect(errorCodes(named)).toEqual([]);
    expect(named.toString()).toBe('Apply((n) |-> "many", 0)');
    expect(named.evaluate().toString()).toBe('"many"');
    // Naming the clause the value would have chosen anyway needs no pinning,
    // so those calls keep the ordinary printed form.
    expect(ce.box(['f', N('z', 0)] as any).toString()).toBe('f(0)');
    expect(ce.box(['f', N('z', 0)] as any).evaluate().toString()).toBe(
      '"zero"'
    );
    expect(ce.box(['f', N('o', 1)] as any).toString()).toBe('f(1)');
    expect(ce.box(['f', N('o', 1)] as any).evaluate().toString()).toBe('"one"');
    // No value divergence at all: an `n` call outside the base cases is the
    // plain call it always was.
    expect(ce.box(['f', N('n', 5)] as any).toString()).toBe('f(5)');
    expect(ce.box(['f', N('n', 5)] as any).evaluate().toString()).toBe(
      '"many"'
    );
  });

  test('within the surviving family the VALUE still selects the clause (R5)', () => {
    // `a` is declared by two clauses and `b` by a third. `f(a: …)` eliminates
    // the `b` clause only, and the two `a` clauses are then discriminated by
    // the argument's value exactly as a positional call discriminates them.
    const ce = new ComputeEngine();
    clause(ce, 'f', ['Function', { str: 'azero' }, T('a', '0')]);
    clause(ce, 'f', ['Function', { str: 'aint' }, T('a', 'integer')]);
    clause(ce, 'f', ['Function', { str: 'bnum' }, T('b', 'number')]);

    // The eliminated `b` clause is less specific than the `a` clause this call
    // admits, so the ordinary dispatch cannot reach it — no pinning needed,
    // and the value picks between the two survivors.
    expect(ce.box(['f', N('a', 0)] as any).toString()).toBe('f(0)');
    expect(ce.box(['f', N('a', 0)] as any).evaluate().toString()).toBe(
      '"azero"'
    );
    expect(ce.box(['f', N('a', 2)] as any).evaluate().toString()).toBe(
      '"aint"'
    );
    // Naming `b` leaves a clause the value dispatch would NOT have chosen (the
    // `a: 0` clause is more specific), so that call is pinned.
    const b = ce.box(['f', N('b', 0)] as any);
    expect(b.toString()).toBe('Apply((b) |-> "bnum", 0)');
    expect(b.evaluate().toString()).toBe('"bnum"');
  });

  test('a declared overload set with nothing to pin the call to declines (R5)', () => {
    // The name leaves the `number` arm, but the `integer` arm the name ruled
    // out is more specific and would win the positional call this seam emits —
    // and a set that is only DECLARED has no implementation to pin the call
    // to (there is no clause literal to apply). Rather than let the
    // eliminated arm type the call, the call declines and steers the author to
    // a positional one.
    const ce = new ComputeEngine();
    ce.declare('ov', '((a: number) -> number) & ((s: integer) -> string)');
    const call = ce.box(['ov', N('a', 3)] as any);
    expect(errorCodes(call)).toEqual(['argument-names-unavailable']);
    expect(call.toString()).toContain('call it with positional arguments');
    // With an eliminated arm the positional call cannot reach, the same call
    // shape is emitted untouched.
    ce.declare('ov2', '((a: number) -> number) & ((s: string) -> string)');
    expect(ce.box(['ov2', N('a', 3)] as any).toString()).toBe('ov2(3)');
  });

  test('the parse route runs the clause the names select (R5)', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `function f(z: 0) { "zero" }
function f(o: 1) { "one" }
function f(n: integer) { "many" }
[f(0), f(n: 0), f(z: 0), f(n: 5)]`
    );
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.value)).toBe(
      '["List","\'zero\'","\'many\'","\'zero\'","\'many\'"]'
    );
  });

  test('the parse route selects each clause by name', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `function fib(z: 0) { 0 }
function fib(o: 1) { 1 }
function fib(n: integer) { fib(n - 1) + fib(n - 2) }
[fib(z: 0), fib(o: 1), fib(n: 10)]`
    );
    expect(result.diagnostics).toEqual([]);
    expect(JSON.stringify(result.value)).toBe('["List",0,1,55]');
  });
});

describe('protocol dispatch (C6)', () => {
  test('a member written `self`-last still dispatches on the receiver', () => {
    // The seam runs before the dispatcher's `canonical` handler reads `ops[0]`,
    // so once the dispatcher's synthesized signature carries the requirement's
    // parameter names (`sharedParameterName`, engine-protocols.ts) the receiver
    // is at `ops[0]` whatever position the author wrote it in. Protocol members
    // are same-arity, no-optional, no-variadic — the simplest case of §3.
    const ce = new ComputeEngine();
    ce.declareProtocol('Tagged', {
      functions: { tag: '(self: Self, prefix: string) -> string' },
    });
    ce.declareProtocolImplementation('integer', 'Tagged', {
      functions: { tag: (_self: any, prefix: any) => `${prefix.string}:int` },
    });

    const call = ce.box([
      'tag',
      N('prefix', { str: 'p' }),
      N('self', 5),
    ] as any);
    expect(errorCodes(call)).toEqual([]);
    // Permuted into declaration order: the receiver is back at `ops[0]`.
    expect(call.isSame(ce.box(['tag', 5, { str: 'p' }] as any))).toBe(true);
    expect(call.evaluate().toString()).toBe('"p:int"');

    // The positional call through the same dispatcher is untouched.
    expect(
      ce
        .box(['tag', 5, { str: 'p' }] as any)
        .evaluate()
        .toString()
    ).toBe('"p:int"');
  });

  test('a position the protocols do not agree on stays positional-only', () => {
    // One dispatcher serves every protocol declaring the member name, so it can
    // only carry a name they all agree on.
    const ce = new ComputeEngine();
    ce.declareProtocol('Left', {
      functions: { pick: '(self: Self, a: number) -> number' },
    });
    ce.declareProtocol('Right', {
      functions: { pick: '(self: Self, b: number) -> number' },
    });
    expect(
      errorCodes(ce.box(['pick', N('self', 1), N('a', 2)] as any))
    ).toEqual(['argument-name-unknown']);
    // The all-positional call is untouched.
    expect(errorCodes(ce.box(['pick', 1, 2] as any))).toEqual([]);
  });

  test('the parse route dispatches a `self`-last member call', () => {
    // Two conforming types with different implementations, so the RESULT says
    // which one the call dispatched on: `self: 5` must reach the `integer`
    // implementation even though `prefix` was written first.
    const source = `protocol Tagged { function tag(self: Self, prefix: string) -> string }
type integer is Tagged { function tag(self: Self, prefix: string) -> string { "int" } }
type string is Tagged { function tag(self: Self, prefix: string) -> string { "str" } }
`;
    const ce = new ComputeEngine();
    const result = executeEpsil(ce, `${source}tag(prefix: "p", self: 5)`);
    expect(result.diagnostics).toEqual([]);
    expect(String(result.value)).toBe('"int"');

    const ce2 = new ComputeEngine();
    const other = executeEpsil(ce2, `${source}tag(prefix: "p", self: "q")`);
    expect(other.diagnostics).toEqual([]);
    expect(String(other.value)).toBe('"str"');
  });
});

describe('all-positional regression', () => {
  test('a call with no carrier is byte-identical to the pre-feature form', () => {
    const ce = engineWithF();
    // The carrier scan is the only thing an all-positional call pays for; the
    // numeric fast path, the `List` short path and definition lookup are
    // reached exactly as before.
    expect(ce.box(['Add', 1, 2, 'x'] as any).toString()).toBe('x + 3');
    expect(ce.box(['List', 1, 2, 3] as any).toString()).toBe('[1,2,3]');
    expect(ce.box(['f', 6, 3] as any).toString()).toBe('f(6, 3)');
    expect(
      ce
        .box(['f', 6, 3] as any)
        .evaluate()
        .toString()
    ).toBe('2');
    expect(ce.parse('\\sin(\\pi)').evaluate().toString()).toBe('0');
  });
});

describe('Function literal argument lists', () => {
  // The parser admits the `name: value` production inside `Function(...)`
  // because it shares parseCall's bracketed list. The engine consciously
  // rejects the carrier — Function's own signature parameters are unnamed —
  // rather than mis-reading it as a parameter declaration.
  test('a named argument inside Function(...) is rejected', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'const g = Function(x, a: 1)\ng');
    expect(errorCodes(r.value! as any)).toEqual(['argument-name-unknown']);
  });
});

describe('parse route', () => {
  // Box-route parity is by construction — both routes reach the same
  // normalization seam — so the algorithm itself is covered above. The parse
  // route is exercised here where it decides something the box route cannot
  // (clause selection by name, protocol dispatch, spread), and the surface
  // syntax itself — the lexer munch pin (`f(a: -1)` parses, `f(a:-1)` does
  // not), the `f(a := 1)` non-regression and the `epsil check` static
  // diagnostics — in `test/epsil/named-arguments-parse.test.ts`.
  test('a named call through the parser reaches the same seam', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `function f(rate: number, years: number) { rate / years }\nf(years: 3, rate: 6)`
    );
    expect(result.diagnostics).toEqual([]);
    expect(String(result.value)).toBe('2');
  });
});
