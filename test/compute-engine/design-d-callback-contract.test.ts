import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { parseType } from '../../src/common/type/parse';
import { typeToDedupKey, typeToString } from '../../src/common/type/serialize';
import { isSubtype, provablyDisjoint } from '../../src/common/type/subtype';
import {
  freeTypeVariables,
  solveTypeArguments,
  substituteTypeVariables,
} from '../../src/common/type/instantiate';
import {
  contextualCallbackPlan,
  contextualSlotCallback,
  instantiateCallbackSlots,
} from '../../src/compute-engine/boxed-expression/generic-instantiation';
import { resolveContextualArm } from '../../src/compute-engine/boxed-expression/overload';
import type { FunctionSignature, Type } from '../../src/common/type/types';

/**
 * # Design D — the `callback<S>` contract, phases 0 through 3
 *
 * `docs/plans/2026-08-09-design-d-generic-callback-signatures.md`. §4 states
 * the constructor's contract as five independently testable clauses; §10 is
 * the acceptance list, starting with `CountIf` (phase 0, eager) and `Filter`
 * (phase 0b, lazy) and ending with `Map`'s two clauses (phase 3), which is
 * where the superseded `callbackElementOf` metadata was deleted outright.
 *
 * The suites that pin what must NOT change are elsewhere and stay untouched:
 * `collection-callback-signatures.test.ts` (the admission contract) and
 * `lambda-param-element-inference.test.ts` (the stamps and their evaluation).
 */

/** The signature actually DECLARED for an operator, so these can't drift. */
function declaredSignature(ce: ComputeEngine, op: string): Type {
  const def = ce.lookupDefinition(op) as any;
  return def.operator.signature.type;
}

/**
 * Does an operator definition carry the RETIRED `callbackElementOf` metadata?
 *
 * Phase 3 deleted the mechanism outright with its last consumer (`Map`), so
 * this is now `false` STRUCTURALLY — the property does not exist on the
 * definition at all, rather than existing and being `undefined`. Written as an
 * `in` test for exactly that reason: a `toBeUndefined()` assertion would pass
 * vacuously and stop pinning anything.
 */
function hasCallbackMetadata(ce: ComputeEngine, op: string): boolean {
  const def = (ce.lookupDefinition(op) as any).operator;
  return 'callbackElementOf' in def || 'callbackElementOf' in def.toJSON();
}

/** The parameter type declared at `index` of an operator's signature. */
function declaredParam(ce: ComputeEngine, op: string, index: number): Type {
  const sig = declaredSignature(ce, op) as FunctionSignature;
  return sig.args![index].type;
}

const XS = ['List', 1, 2, 3, 4] as const;

//
// ── Clause 1 — ordinary admission and subtyping see only `function` ──────────
//

describe('clause 1: `callback<S>` IS the primitive `function` for subtyping', () => {
  const CB = 'callback<(integer) -> boolean>';

  it('is bivariant with `function`, in both directions', () => {
    const ce = new ComputeEngine();
    expect(ce.type(CB).matches('function')).toBe(true);
    expect(ce.type('function').matches(CB)).toBe(true);
    expect(ce.type(CB).is('function')).toBe(true);
    expect(isSubtype(parseType(CB), 'function')).toBe(true);
    expect(isSubtype('function', parseType(CB))).toBe(true);
  });

  it('admits a NARROWER named callback the wrapped arrow would reject', () => {
    // The finding that forced the constructor (§2, F1): under a plain arrow
    // this operand is rejected contravariantly. `S` plays no role in
    // admission, so it is admitted and judged per element at runtime.
    const ce = new ComputeEngine();
    expect(
      ce.type('(number) -> boolean').matches('(unknown) any -> boolean')
    ).toBe(false);
    expect(
      ce
        .type('(number) -> boolean')
        .matches('callback<(unknown) any -> boolean>')
    ).toBe(true);
  });

  it('admits a bare-`function` symbol and an unknown-result literal', () => {
    const ce = new ComputeEngine();
    // The primitive is a subtype of NO signature — only of the callback slot.
    expect(ce.type('function').matches('(never) any -> boolean')).toBe(false);
    expect(
      ce.type('function').matches('callback<(never) any -> boolean>')
    ).toBe(true);
    expect(ce.type('(unknown) any -> unknown').matches(CB)).toBe(true);
  });

  it('admits an unknown ARITY (the `Sort` comparator shape)', () => {
    const ce = new ComputeEngine();
    expect(ce.type('(integer, integer) -> integer').matches(CB)).toBe(true);
  });

  it('is disjoint from exactly what `function` is disjoint from', () => {
    expect(provablyDisjoint(parseType(CB), 'string')).toBe(
      provablyDisjoint('function', 'string')
    );
    expect(provablyDisjoint(parseType(CB), 'function')).toBe(false);
    const ce = new ComputeEngine();
    expect(ce.type(CB).couldMatch('function')).toBe(true);
    expect(ce.type('(integer) -> boolean').couldMatch(CB)).toBe(true);
  });

  it('a non-function operand is still refused, and the message says `function`', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['CountIf', XS, 5]);
    expect(e.isValid).toBe(false);
    // The erasure reaches the DIAGNOSTIC too: the converted slot reports
    // exactly what the bare-`function` slot reported.
    expect(e.toString()).toContain('"function"');
    expect(e.toString()).not.toContain('callback<');
  });
});

//
// ── Clause 2 — the contextual solve reads only `S`'s PARAMETER types ─────────
//

describe('clause 2: the contextual solve traverses `S`’s parameters only', () => {
  const ARM = parseType(
    'forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>'
  ) as FunctionSignature;

  it('plans the callback slot and the sources its PARAMETERS read', () => {
    const plan = contextualCallbackPlan(ARM, 2)!;
    expect(plan).toBeDefined();
    expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
    // Operand 0 mentions `T`, which `S`'s parameter reads. `U` occurs only in
    // `S`'s RESULT, so no position is a source on its account.
    expect(plan.sources).toEqual([0]);
  });

  it('instantiates `S` from the source operand alone', () => {
    const plan = contextualCallbackPlan(ARM, 2)!;
    // A sparse actuals array: only the planned source carries a type — the
    // callback operand is never forced (the lazy carve-out’s rationale).
    const slots = instantiateCallbackSlots(ARM, plan, [
      parseType('list<integer>'),
      undefined,
    ]);
    expect(typeToString(slots.get(1)!)).toBe('(integer) -> U');
  });

  it('declines when the arm has no callback slot, or no source for one', () => {
    const plain = parseType(
      'forall T. (collection<T>, (T) -> boolean) -> integer'
    ) as FunctionSignature;
    expect(contextualCallbackPlan(plain, 2)).toBeUndefined();
    // `T` is read only by `S`'s RESULT: nothing to solve the domain from.
    const resultOnly = parseType(
      'forall T. (callback<() -> T>, T) -> integer'
    ) as FunctionSignature;
    expect(contextualCallbackPlan(resultOnly, 2)).toBeUndefined();
  });
});

//
// ── Clause 3 — inference from the operand is RESULT-side only ────────────────
//

describe('clause 3: a named callback’s PARAMETERS never constrain a variable', () => {
  const ARM = parseType(
    'forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>'
  ) as FunctionSignature;

  it('the callback’s RESULT contributes, its parameters do not', () => {
    const solved = solveTypeArguments(ARM, [
      parseType('list<integer>'),
      parseType('(string) -> boolean'),
    ]);
    // `T` from the source only — an arrow pattern would have collected the
    // callback's `string` parameter as an UPPER bound and failed.
    expect(typeToString(solved.bindings['T'])).toBe('integer');
    expect(typeToString(solved.bindings['U'])).toBe('boolean');
    expect(solved.failures).toEqual([]);
    expect(solved.matched).toBe(true);
  });

  it('the same arm spelled with a bare arrow DOES conflict — the contrast', () => {
    const plain = parseType(
      'forall T, U. (collection<T>, (T) -> U) -> list<U>'
    ) as FunctionSignature;
    const solved = solveTypeArguments(plain, [
      parseType('list<integer>'),
      parseType('(string) -> boolean'),
    ]);
    expect(solved.failures.length).toBeGreaterThan(0);
  });

  it('an operand at a callback slot never refutes the structural match', () => {
    // A `function`-typed symbol, and an operand that is not callable at all:
    // admission is clause 1's business, not the walk's.
    for (const actual of ['function', 'integer'] as Type[]) {
      const solved = solveTypeArguments(ARM, [
        parseType('list<integer>'),
        actual,
      ]);
      expect(solved.failures).toEqual([]);
    }
  });
});

//
// ── Clause 4 — free variables and substitution reach inside `S` ──────────────
//

describe('clause 4: variables inside `S` are retained and substituted', () => {
  it('a variable occurring ONLY inside `S` counts as occurring in an argument', () => {
    // Without discovery inside `S` this is `unsolvable-type-variable`.
    expect(() =>
      parseType('forall T. (callback<(T) -> boolean>) -> integer')
    ).not.toThrow();
  });

  it('an unquantified variable inside `S` is still reported', () => {
    expect(() => parseType('(callback<(T) -> boolean>) -> integer')).toThrow(
      /unresolved-type-variable|Unknown type/
    );
  });

  it('`freeTypeVariables` sees through the wrapper', () => {
    const arm = parseType(
      'forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>'
    ) as FunctionSignature;
    // Quantified at the arm, so free at the arm is empty…
    expect([...freeTypeVariables(arm)]).toEqual([]);
    // …but present in the slot read on its own.
    expect([...freeTypeVariables(arm.args![1].type)].sort()).toEqual([
      'T',
      'U',
    ]);
  });

  it('substitution rewrites inside `S`, and returns identity otherwise', () => {
    const slot = parseType(
      'forall T. (callback<(T) -> boolean>) -> integer'
    ) as FunctionSignature;
    const cb = slot.args![0].type;
    expect(typeToString(substituteTypeVariables(cb, { T: 'integer' }))).toBe(
      'callback<(integer) -> boolean>'
    );
    expect(substituteTypeVariables(cb, { Z: 'integer' })).toBe(cb);
  });
});

//
// ── Clause 5 — internal serialization preserves the constructor ──────────────
//

describe('clause 5: `callback<S>` round-trips through serialize/parse', () => {
  const SPELLINGS = [
    'callback<(integer) -> boolean>',
    'callback<(integer, string) -> list<integer>>',
    'callback<(integer) random -> boolean>',
    'callback<() -> nothing>',
    'forall T. (callback<(T) -> boolean>) -> integer',
    'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> integer',
    'forall T, U. (collection<T>, callback<(T) -> U>) -> list<U>',
  ];

  it.each(SPELLINGS)('%s survives a round trip exactly', (text) => {
    const t = parseType(text);
    expect(typeToString(t)).toBe(text);
    expect(typeToString(parseType(typeToString(t)))).toBe(text);
  });

  it('the dedup key distinguishes it from the bare `function`', () => {
    expect(
      typeToDedupKey(parseType('callback<(integer) -> boolean>'))
    ).not.toBe(typeToDedupKey('function'));
    expect(typeToDedupKey(parseType('callback<(integer) -> boolean>'))).toBe(
      'callback<(integer) -> boolean>'
    );
  });

  it('a user type NAMED `callback` is unaffected', () => {
    // The constructor is recognized only when a `<` follows, so a bare
    // `callback` is still an ordinary type reference.
    const ce = new ComputeEngine();
    ce.declareType('callback', 'integer', { alias: true });
    expect(ce.type('callback').matches('integer')).toBe(true);
  });

  it('the wrapper requires an arrow', () => {
    expect(() => parseType('callback<integer>')).toThrow(
      /expects a function signature/
    );
  });
});

//
// ── §10 acceptance — phase 0 (`CountIf`, eager) ──────────────────────────────
//

describe('phase 0: `CountIf` converts to the contextual signature', () => {
  it('declares the contextual slot and NO metadata', () => {
    const ce = new ComputeEngine();
    expect(ce.type(declaredSignature(ce, 'CountIf')).toString()).toBe(
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> integer'
    );
    // Read through `typeToString`, not `ce.type()`: the slot is OPEN (it
    // mentions the arm's `T`), and an open type is deliberately not boxable.
    expect(typeToString(declaredParam(ce, 'CountIf', 1))).toBe(
      'callback<(T) -> boolean>'
    );
    expect(hasCallbackMetadata(ce, 'CountIf')).toBe(false);
  });

  it('admits a NAMED, narrower-than-instantiated callback and counts', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['CountIf', XS, 'IsPrime']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('2');
  });

  it('admits a WILDCARD `function`-typed symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    expect(ce.box(['CountIf', XS, 'p']).isValid).toBe(true);
  });

  it('admits an UNKNOWN-result literal (`x ↦ g(x)`, `g` undeclared)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['CountIf', XS, ['Function', ['g', 'x'], 'x']]).isValid).toBe(
      true
    );
  });

  it('stamps an inline literal with the source’s element type', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box(['CountIf', 'cs', ['Function', ['Greater', 'n', 1], 'n']]);
    expect(e.toMathJson()).toEqual([
      'CountIf',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
    expect(e.evaluate().toString()).toBe('2');
  });

  it('stamps a COMPOSITE element type', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let points: list<tuple<number, number>> = [(0,0),(1,2)]');
    const e = ce.box([
      'CountIf',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
    ]);
    expect(e.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(e.evaluate().toString()).toBe('1');
  });

  it('an unprovable source leaves the parameter bare', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    expect(
      ce
        .box(['CountIf', 'us', ['Function', ['Greater', 'n', 1], 'n']])
        .toMathJson()
    ).toEqual(['CountIf', 'us', ['Function', ['Less', 1, 'n'], 'n']]);
  });

  it('a NAMED callback is never rebuilt (the sharing pin)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let pred = n |-> n > 1');
    expect(ce.box(['CountIf', 'cs', 'pred']).toMathJson()).toEqual([
      'CountIf',
      'cs',
      'pred',
    ]);
  });

  it('a stamped `CountIf` still compiles, with run() parity', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box(['CountIf', 'cs', ['Function', ['Greater', 'n', 1], 'n']]);
    const r = compile(e, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '((_f) => ([1, 2, 3]).filter((_x) => _f(_x)).length)(((n) => 1 < n))'
    );
    expect((r.run as () => unknown)()).toBe(2);
    expect(new PythonTarget().compile(e)?.code).toBe(
      '(lambda _f: sum(1 for _x in [1, 2, 3] if _f(_x)))((lambda n: 1 < n))'
    );
  });
});

//
// ── §10 acceptance — phase 0b (`Filter`, lazy) ───────────────────────────────
//

describe('phase 0b: `Filter` converts, on the LAZY path', () => {
  it('declares the contextual slot, keeps its result typing, drops the metadata', () => {
    const ce = new ComputeEngine();
    expect(ce.type(declaredSignature(ce, 'Filter')).toString()).toBe(
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> collection'
    );
    expect(hasCallbackMetadata(ce, 'Filter')).toBe(false);
    // §7 rule 1: the result stays with the `type:` handler — the source's own
    // collection kind and indexedness, which the signature cannot express.
    expect(
      ce.box(['Filter', ['List', 1, 2, 3], 'IsPrime']).type.toString()
    ).toBe('vector<finite_integer^3>');
  });

  it('stamps an inline literal identically on every route', () => {
    const canonicalJson = (build: (ce: ComputeEngine) => any): string => {
      const ce = new ComputeEngine();
      executeEpsil(
        ce,
        'let points: list<tuple<number, number>> = [(0,0),(1,2)]'
      );
      return JSON.stringify(build(ce).toMathJson());
    };
    const viaBox = canonicalJson((ce) =>
      ce.box([
        'Filter',
        'points',
        ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      ])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Filter',
      'points',
      [
        'Function',
        ['Equal', 'p', ['Pair', 0, 0]],
        ['Typed', 'p', 'tuple<number, number>'],
      ],
    ]);
    expect(
      canonicalJson((ce) =>
        ce.box(parseEpsil('Filter(points, p |-> p == (0, 0))')[0])
      )
    ).toBe(viaBox);
    expect(
      canonicalJson((ce) =>
        ce.parse(
          '\\operatorname{Filter}(\\mathrm{points}, p \\mapsto p = (0,0))'
        )
      )
    ).toBe(viaBox);
  });

  it('evaluates the stamped predicate', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let points: list<tuple<number, number>> = [(0,0),(1,2)]');
    expect(
      ce
        .box([
          'Filter',
          'points',
          ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
        ])
        .evaluate()
        .toString()
    ).toBe('[(0, 0)]');
  });

  it('the union flagship is unchanged by `Map`’s own conversion', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Map',
          ['List', 16, -4, { str: 'banana' }, 81],
          ['Function', ['Sqrt', 'x'], 'x'],
        ])
        .evaluate()
        .toString()
    ).toBe('[4,2i,NaN,9]');
  });

  it('a UNION source declines the stamp (the permanent union ruling)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let mixed: list<integer|string> = [1,"a",2]');
    expect(
      ce
        .box(['Filter', 'mixed', ['Function', ['Greater', 'x', 1], 'x']])
        .toMathJson()
    ).toEqual(['Filter', 'mixed', ['Function', ['Less', 1, 'x'], 'x']]);
  });

  it('a union source with a NARROWER NAMED predicate keeps per-element dynamics', () => {
    // The review's F1 probe (§10). A plain generic arrow would reject this at
    // the call boundary; the callback slot admits it and the errors stay
    // per-element values, which is the published Epsil behavior.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let mixed: list<integer|string> = [1,"a",2]');
    executeEpsil(ce, 'let isbig = (n: integer) |-> n > 1');
    const e = ce.box(['Filter', 'mixed', 'isbig']);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual(['Filter', 'mixed', 'isbig']);
    const out = e.evaluate().toString();
    expect(out).toContain('incompatible-type');
    expect(out).toContain('2');
  });

  it('the lazy slot stays inert for a non-function operand', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Filter', XS, 5]).isValid).toBe(true);
  });
});

//
// ── §8 phase 1 — the single-CLAUSE single-collection family ──────────────────
//
// `Find`, `IndexWhere`, `Position`, `Any`, `All`, `TakeWhile`, `DropWhile`,
// `FlatMap`. Each conversion carries a contract audit (§7's F4 rules): the
// contextual slot moves into the signature, the RESULT stays wherever it
// already was — a `type:` handler for the four operators whose precise result
// the type language cannot express — and the metadata entry is deleted in the
// same edit.
//

describe('phase 1: the single-clause single-collection family converts', () => {
  /** op, declared signature, pre-conversion GROUND display, callback slot. */
  const CONVERTED: ReadonlyArray<[string, string, string]> = [
    [
      'Find',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> any',
      '(collection, predicate: function) -> any',
    ],
    [
      'IndexWhere',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> integer',
      '(collection, predicate: function) -> integer',
    ],
    [
      'Position',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> list<integer>',
      '(collection, predicate: function) -> list<integer>',
    ],
    [
      'Any',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>?) -> boolean',
      '(collection, predicate: function?) -> boolean',
    ],
    [
      'All',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>?) -> boolean',
      '(collection, predicate: function?) -> boolean',
    ],
    [
      'TakeWhile',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> collection',
      '(collection, predicate: function) -> collection',
    ],
    [
      'DropWhile',
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> collection',
      '(collection, predicate: function) -> collection',
    ],
    [
      'FlatMap',
      'forall T, U. (collection<T>, mapping: callback<(T) -> U>) -> list',
      '(collection, mapping: function) -> list',
    ],
  ];

  it.each(CONVERTED)(
    '%s declares the contextual signature and NO metadata',
    (op, declared) => {
      const ce = new ComputeEngine();
      expect(typeToString(declaredSignature(ce, op))).toBe(declared);
      expect(hasCallbackMetadata(ce, op)).toBe(false);
    }
  );

  it.each(CONVERTED)(
    '%s displays its PRE-conversion ground signature (R-D5)',
    (op, _declared, ground) => {
      const ce = new ComputeEngine();
      expect(ce.box(op).type.toString()).toBe(ground);
      expect(ce.function('Signature', [ce.symbol(op)]).evaluate().string).toBe(
        ground
      );
      expect((ce.lookupDefinition(op) as any).operator.toJSON().signature).toBe(
        ground
      );
    }
  );

  /** op, raw body, canonical body, evaluated result over `cs = [1,2,3]`. */
  const STAMPS: ReadonlyArray<[string, unknown, unknown, string]> = [
    ['Find', ['Greater', 'n', 1], ['Less', 1, 'n'], '2'],
    ['IndexWhere', ['Greater', 'n', 1], ['Less', 1, 'n'], '2'],
    ['Position', ['Greater', 'n', 1], ['Less', 1, 'n'], '[2,3]'],
    ['Any', ['Greater', 'n', 1], ['Less', 1, 'n'], '"True"'],
    ['All', ['Greater', 'n', 0], ['Less', 0, 'n'], '"True"'],
    ['TakeWhile', ['Greater', 'n', 0], ['Less', 0, 'n'], '[1,2,3]'],
    ['DropWhile', ['Greater', 'n', 0], ['Less', 0, 'n'], '[]'],
    ['FlatMap', ['List', 'n', 'n'], ['List', 'n', 'n'], '[1,1,2,2,3,3]'],
  ];

  it.each(STAMPS)(
    '%s stamps an inline literal from the SIGNATURE and evaluates',
    (op, body, canonicalBody, result) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      const e = ce.box([op, 'cs', ['Function', body, 'n']] as any);
      expect(e.toMathJson()).toEqual([
        op,
        'cs',
        ['Function', canonicalBody, ['Typed', 'n', "'integer'"]],
      ]);
      expect(e.evaluate().toString()).toBe(result);
    }
  );

  it.each(CONVERTED)('%s admits a NAMED, narrower callback', (op) => {
    // Clause 1: `S` plays no role in admission, so `IsPrime: (number) ->
    // boolean` still enters every converted slot and is never rebuilt.
    const ce = new ComputeEngine();
    const e = ce.box([op, XS, 'IsPrime'] as any);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual([op, [...XS], 'IsPrime']);
  });
});

describe('phase 1: `Any` / `All` — the OPTIONAL callback slot', () => {
  const ARM = parseType(
    'forall T. (collection<T>, predicate: callback<(T) -> boolean>?) -> boolean'
  ) as FunctionSignature;

  it('the planner maps an OPTIONAL slot to its operand position', () => {
    // The `parameterPositions` / `paramAt` reconciliation: the contextual pass
    // and argument validation now read ONE definition of the
    // required→optional→variadic consumption order, so an optional callback
    // lands at operand 1 for both.
    const plan = contextualCallbackPlan(ARM, 2)!;
    expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
    expect(plan.sources).toEqual([0]);
    expect(
      typeToString(
        instantiateCallbackSlots(ARM, plan, [
          parseType('list<integer>'),
          undefined,
        ]).get(1)!
      )
    ).toBe('(integer) -> boolean');
  });

  it('the slot is ABSENT at one operand: nothing to plan, nothing to stamp', () => {
    expect(contextualCallbackPlan(ARM, 1)).toBeUndefined();
  });

  it('the no-callback form is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Any', ['List', 'True', 'False']])
        .evaluate()
        .toString()
    ).toBe('"True"');
    expect(
      ce
        .box(['All', ['List', 'True', 'False']])
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .box(['All', ['List', 'True', 'True']])
        .evaluate()
        .toString()
    ).toBe('"True"');
    // Vacuously true on an empty collection, as before.
    expect(
      ce
        .box(['All', ['List']])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  it('a COMPOSITE element type stamps through the optional slot', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let points: list<tuple<number, number>> = [(0,0),(1,2)]');
    const e = ce.box([
      'Any',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
    ]);
    expect(e.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(e.evaluate().toString()).toBe('"True"');
  });
});

describe('phase 1: `FlatMap` — R-D2′ result inference', () => {
  const ARM = parseType(
    'forall T, U. (collection<T>, mapping: callback<(T) -> U>) -> list'
  ) as FunctionSignature;

  it('the SOLVER binds `U` from the callback’s result, `T` from the source', () => {
    // R-D2′ at the constraint level: `U` comes from `S`'s RESULT position only.
    const solved = solveTypeArguments(ARM, [
      parseType('list<integer>'),
      parseType('(string) -> list<string>'),
    ]);
    expect(typeToString(solved.bindings['T'])).toBe('integer');
    expect(typeToString(solved.bindings['U'])).toBe('list<string>');
    // …and the callback's `string` PARAMETER never touched `T` (clause 3).
    expect(solved.failures).toEqual([]);
  });

  it('an INLINE literal’s result reaches the application type', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box(['FlatMap', 'cs', ['Function', ['List', 'n', 'n'], 'n']]);
    expect(e.ops[1].type.toString()).toBe('(n: integer) -> vector<integer^2>');
    expect(e.type.toString()).toBe('list<integer>');
    expect(e.evaluate().toString()).toBe('[1,1,2,2,3,3]');
  });

  it('a NAMED callback declared `(integer) -> string` reports `list<string>`', () => {
    // R-D2′ ruled BOTH contribute. The named case needs the result-side read to
    // reach past the lazy hold — `FlatMap` holds its callback structurally, so
    // an unbound symbol reports `unknown` until it is canonicalized.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare('tostr', '(integer) -> string');
    expect(ce.box(['FlatMap', 'cs', 'tostr']).type.toString()).toBe(
      'list<string>'
    );
    // A collection-valued result is FLATTENED one level, as before.
    ce.declare('tolist', '(integer) -> list<string>');
    expect(ce.box(['FlatMap', 'cs', 'tolist']).type.toString()).toBe(
      'list<string>'
    );
  });

  it('a SCALAR callback result is still singleton-lifted (§7 rule 2)', () => {
    // The slot is `callback<(T) -> U>`, not `callback<(T) -> collection<U>>`:
    // `S` describes the stamp, never the operator's tolerance.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box([
      'FlatMap',
      'cs',
      ['Function', ['Multiply', 2, 'n'], 'n'],
    ]);
    expect(e.type.toString()).toBe('list<number>');
    expect(e.evaluate().toString()).toBe('[2,4,6]');
  });

  it('a MISMATCHED named callback is admitted and stays dynamic', () => {
    // Clause 3 end to end: the operand's `string` parameter never constrains
    // `T`, so the call is admitted and the type error is a per-element VALUE.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let wrap = (s: string) |-> [s]');
    const e = ce.box(['FlatMap', 'cs', 'wrap']);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual(['FlatMap', 'cs', 'wrap']);
    expect(e.evaluate().toString()).toContain('incompatible-type');
  });
});

describe('phase 1: route parity (box / Epsil / LaTeX)', () => {
  const parityJson = (
    build: (ce: ComputeEngine) => any,
    setup = 'let points: list<tuple<number, number>> = [(0,0),(1,2)]'
  ): string => {
    const ce = new ComputeEngine();
    executeEpsil(ce, setup);
    return JSON.stringify(build(ce).toMathJson());
  };

  it('`TakeWhile` (lazy) stamps identically on every route', () => {
    const viaBox = parityJson((ce) =>
      ce.box([
        'TakeWhile',
        'points',
        ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      ])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'TakeWhile',
      'points',
      [
        'Function',
        ['Equal', 'p', ['Pair', 0, 0]],
        ['Typed', 'p', 'tuple<number, number>'],
      ],
    ]);
    expect(
      parityJson((ce) =>
        ce.box(parseEpsil('TakeWhile(points, p |-> p == (0, 0))')[0])
      )
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse(
          '\\operatorname{TakeWhile}(\\mathrm{points}, p \\mapsto p = (0,0))'
        )
      )
    ).toBe(viaBox);
  });

  it('`IndexWhere` (eager) stamps identically on every route', () => {
    const viaBox = parityJson((ce) =>
      ce.box([
        'IndexWhere',
        'points',
        ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      ])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'IndexWhere',
      'points',
      [
        'Function',
        ['Equal', 'p', ['Pair', 0, 0]],
        ['Typed', 'p', 'tuple<number, number>'],
      ],
    ]);
    expect(
      parityJson((ce) =>
        ce.box(parseEpsil('IndexWhere(points, p |-> p == (0, 0))')[0])
      )
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse(
          '\\operatorname{IndexWhere}(\\mathrm{points}, p \\mapsto p = (0,0))'
        )
      )
    ).toBe(viaBox);
  });
});

//
// ── §8 phase 2 — the multi-arm operators: Reduce / Scan / Fold / Partition ───
//
// The R-D4 (resolve-then-stamp, ruled 2026-08-09) phase. Two granularities,
// both implemented and both exercised below:
//
// - ARM — `resolveContextualArm` (overload.ts) picks the single arity-viable
//   arm of an overload set that declares a contextual slot. This is what
//   `Map`'s two clauses will resolve with in phase 3, and the `Pipe` consumer
//   after it; a set no arm of which declares a slot (every user-defined
//   overload set) resolves to nothing and keeps its ratified conservative skip.
// - SLOT — `contextualSlotCallback` (generic-instantiation.ts) picks the
//   callback arm of a UNION slot.
//
// `Partition` — the phase's genuine two-arm shape — takes the SLOT form: its
// predicate and SIZE arms stay ONE union, so admission, validation,
// diagnostics, result typing and the DISPLAYED signature are byte-identical to
// the pre-conversion spelling, where an intersection would have changed all
// five (and R-D5's projection does not reach inside one).
//
// AUDIT (§7's two F4 rules), per operator:
//
// - `Reduce` / `Scan` / `Fold` — the RESULT stays with the `type:` handler
//   (`Reduce`: the reducer's own result; `Scan`: the source's shape with that
//   result as its elements) or with the pre-conversion ground spelling
//   (`Fold`'s `value`). `S` stamps the ELEMENT parameter ONLY: the
//   accumulator is spelled `unknown`, which the stamp gate declines.
// - `Partition` — result unchanged (`list<list<T>>`, off the same `T` as
//   before); the SIZE arm unchanged.
//

describe('phase 2: the folds convert — `Reduce` / `Scan` / `Fold`', () => {
  /** op, declared signature, pre-conversion GROUND display. */
  const CONVERTED: ReadonlyArray<[string, string, string]> = [
    [
      'Reduce',
      'forall T. (collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> value',
      '(collection, reducer: function, initial: value?) -> value',
    ],
    [
      'Scan',
      'forall T. (collection<T>, reducer: callback<(unknown, T) -> unknown>, initial: value?) -> indexed_collection',
      '(collection, reducer: function, initial: value?) -> indexed_collection',
    ],
    [
      'Fold',
      'forall T. (reducer: callback<(unknown, T) -> unknown>, initial: value, collection<T>) -> value',
      '(reducer: function, initial: value, collection) -> value',
    ],
  ];

  it.each(CONVERTED)(
    '%s declares the contextual signature and NO metadata',
    (op, declared) => {
      const ce = new ComputeEngine();
      expect(typeToString(declaredSignature(ce, op))).toBe(declared);
      expect(hasCallbackMetadata(ce, op)).toBe(false);
    }
  );

  it.each(CONVERTED)(
    '%s displays its PRE-conversion ground signature (R-D5)',
    (op, _declared, ground) => {
      const ce = new ComputeEngine();
      expect(ce.box(op).type.toString()).toBe(ground);
      expect(ce.function('Signature', [ce.symbol(op)]).evaluate().string).toBe(
        ground
      );
      expect((ce.lookupDefinition(op) as any).operator.toJSON().signature).toBe(
        ground
      );
    }
  );

  it('`Reduce` stamps the ELEMENT parameter, seeded and seedless alike', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const seedless = ce.box([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
    ]);
    expect(seedless.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
    ]);
    expect(seedless.ops[1].type.toString()).toBe(
      '(unknown, x: integer) -> number'
    );
    expect(seedless.evaluate().toString()).toBe('6');

    const seeded = ce.box([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      10,
    ]);
    expect(seeded.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      10,
    ]);
    expect(seeded.evaluate().toString()).toBe('16');
  });

  it('the ACCUMULATOR stays bare, and that is what preserves the fold tolerance', () => {
    // §7 rule 2 — `S` describes the STAMP, not the operator's tolerance. The
    // rule is stated there for the SEEDLESS fold; it holds just as hard for
    // the seeded one, which is why the accumulator is `unknown` in `S` rather
    // than a `U` solved from the initial value. A fold's accumulator may
    // CHANGE TYPE mid-fold, and the narrow annotation `U` would produce
    // rejects it at apply time — the two probes below are the same program,
    // once stamped and once hand-annotated the way `(U, T) -> U` with `U`
    // from the initial value would have stamped it.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    expect(ce.box(1).type.toString()).toBe('finite_integer');

    const stamped = ce.box([
      'Reduce',
      'cs',
      ['Function', ['Divide', 'a', 'x'], 'a', 'x'],
      1,
    ]);
    expect(stamped.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Divide', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      1,
    ]);
    expect(stamped.evaluate().toString()).toBe('1/6');

    const asIfAccumulatorStamped = ce.box([
      'Reduce',
      'cs',
      [
        'Function',
        ['Divide', 'a', 'x'],
        ['Typed', 'a', { str: 'finite_integer' }],
        ['Typed', 'x', { str: 'integer' }],
      ],
      1,
    ]);
    expect(asIfAccumulatorStamped.evaluate().toString()).toContain(
      'incompatible-type'
    );
  });

  it('`Scan` stamps the element, seeded and seedless, and keeps its result typing', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const seeded = ce.box([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      0,
    ]);
    expect(seeded.toMathJson()).toEqual([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      0,
    ]);
    expect(seeded.ops[1].type.toString()).toBe(
      '(unknown, x: integer) -> number'
    );
    expect(seeded.evaluate().toString()).toBe('[1,3,6]');
    expect(
      ce
        .box(['Scan', 'cs', ['Function', ['Add', 'a', 'x'], 'a', 'x']])
        .evaluate()
        .toString()
    ).toBe('[1,3,6]');
    // §7 rule 1: the `type:` handler still computes the source's shape with
    // the fold's result as its elements.
    expect(
      ce
        .box([
          'Scan',
          ['List', 1, 2, 3],
          ['Function', ['Add', 'a', 'x'], 'a', 'x'],
        ])
        .type.toString()
    ).toBe('vector<3>');
  });

  it('`Fold`’s callback-FIRST slot stamps, and the stamp survives the rewrite into `Reduce`', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box([
      'Fold',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      10,
      'cs',
    ]);
    expect(e.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      10,
    ]);
    expect(e.evaluate().toString()).toBe('16');
  });

  it.each(CONVERTED)('%s leaves an unprovable source bare', (op) => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    const raw = ['Function', ['Add', 'a', 'x'], 'a', 'x'];
    const call: any =
      op === 'Fold' ? ['Fold', raw, 10, 'us'] : [op, 'us', raw, 0];
    // `Fold` rewrites to `Reduce`; either way the literal is untouched.
    expect((ce.box(call).toMathJson() as any)[2]).toEqual(raw);
  });

  // Clause 1: `S` plays no role in admission, and a named callback is shared,
  // never rebuilt. (`Fold` canonicalizes to the equivalent `Reduce`.)
  it.each([
    [
      ['Reduce', 'cs', 'Add'],
      ['Reduce', 'cs', 'Add'],
    ],
    [
      ['Scan', 'cs', 'Add'],
      ['Scan', 'cs', 'Add'],
    ],
    [
      ['Fold', 'Add', 0, 'cs'],
      ['Reduce', 'cs', 'Add', 0],
    ],
  ])('%s admits a NAMED callback and never rebuilds it', (call, expected) => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box(call as any);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual(expected);
  });

  it('the seedless-fold rulings are untouched', () => {
    const ce = new ComputeEngine();
    const r = (xs: any, f: any) =>
      ce.box(['Reduce', xs, f]).evaluate().toString();
    expect(
      r(['List', 1, 2, 3], ['Function', ['Subtract', 'a', 'b'], 'a', 'b'])
    ).toBe('-4');
    expect(r(['List', 2, 3, 2], 'Power')).toBe('64');
    expect(r(['List'], 'Add')).toBe('"Nothing"');
    expect(r(['List', 5], 'Add')).toBe('5');
  });
});

describe('phase 2: `Partition` — R-D4 resolve-then-stamp at SLOT granularity', () => {
  const DECLARED =
    'forall T. (collection<T>, callback<(T) -> boolean> | integer, integer?) -> list<list<T>>';
  const DISPLAY =
    'forall T. (collection<T>, function | integer, integer?) -> list<list<T>>';

  it('declares the union slot, keeps its display, and drops the metadata', () => {
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'Partition'))).toBe(DECLARED);
    expect(hasCallbackMetadata(ce, 'Partition')).toBe(false);
    // R-D5, with the vacuity refinement phase 2 required: `T` still relates
    // the source's elements to the result AFTER the callback erasure, so it is
    // a pre-existing declared contract — not a conversion artifact — and the
    // `forall` clause survives the projection. Byte-identical to the
    // pre-conversion display.
    expect(ce.box('Partition').type.toString()).toBe(DISPLAY);
    expect(
      ce.function('Signature', [ce.symbol('Partition')]).evaluate().string
    ).toBe(DISPLAY);
    expect(
      (ce.lookupDefinition('Partition') as any).operator.toJSON().signature
    ).toBe(DISPLAY);
  });

  it('stamps the PREDICATE arm', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    const e = ce.box(['Partition', 'cs', ['Function', ['Less', 'n', 3], 'n']]);
    expect(e.toMathJson()).toEqual([
      'Partition',
      'cs',
      ['Function', ['Less', 'n', 3], ['Typed', 'n', "'integer'"]],
    ]);
    expect(e.evaluate().toString()).toBe('[[1,2,1],[3]]');
  });

  it('leaves every SIZE-arm shape byte-identical', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    executeEpsil(ce, 'let k: integer = 2');
    expect(ce.box(['Partition', 'cs', 2]).toMathJson()).toEqual([
      'Partition',
      'cs',
      2,
    ]);
    expect(ce.box(['Partition', 'cs', 2]).evaluate().toString()).toBe(
      '[[1,2],[3,1]]'
    );
    // …with a `step` (sliding windows), and with a SYMBOL holding the size.
    expect(ce.box(['Partition', 'cs', 2, 1]).evaluate().toString()).toBe(
      '[[1,2],[2,3],[3,1]]'
    );
    expect(ce.box(['Partition', 'cs', 'k']).evaluate().toString()).toBe(
      '[[1,2],[3,1]]'
    );
    // The result type comes off the same `T` as before, on both arms.
    expect(ce.box(['Partition', 'cs', 2]).type.toString()).toBe(
      'list<list<integer>>'
    );
    expect(ce.box(['Partition', 'cs', 'IsPrime']).type.toString()).toBe(
      'list<list<integer>>'
    );
  });

  it('admission is byte-identical: named, wildcard, non-function', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    ce.declare('p', 'function');
    expect(ce.box(['Partition', 'cs', 'IsPrime']).toMathJson()).toEqual([
      'Partition',
      'cs',
      'IsPrime',
    ]);
    expect(ce.box(['Partition', 'cs', 'p']).isValid).toBe(true);
    // The diagnostic names the GROUND union (clause 1's deep erasure), which
    // is what it named before the conversion.
    expect(ce.box(['Partition', 'cs', { str: 'banana' }]).toString()).toBe(
      'Partition("cs", Error(ErrorCode("incompatible-type", "function | integer", "string")))'
    );
  });

  it('a UNION source declines the stamp (the permanent union ruling)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let mixed: list<integer|string> = [1,"a"]');
    expect(
      ce
        .box(['Partition', 'mixed', ['Function', ['Less', 'n', 3], 'n']])
        .toMathJson()
    ).toEqual(['Partition', 'mixed', ['Function', ['Less', 'n', 3], 'n']]);
  });

  it('the planner reads the callback out of the UNION slot', () => {
    const ARM = parseType(DECLARED) as FunctionSignature;
    const plan = contextualCallbackPlan(ARM, 2)!;
    expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
    expect(plan.sources).toEqual([0]);
    expect(
      typeToString(
        instantiateCallbackSlots(ARM, plan, [
          parseType('list<integer>'),
          undefined,
        ]).get(1)!
      )
    ).toBe('(integer) -> boolean');
  });
});

describe('phase 3: `Map` — the two clauses of §6 (revision 4)', () => {
  // The unary clause is the contextual one; the trailing `collection*` is the
  // variadic (zipWith) clause and declares NO contextual slot. One LOOSE
  // signature rather than an overload set — see the §13 addendum: the type
  // language consumes required→optional→variadic, so a callback-LAST variadic
  // cannot be spelled positionally, and an intersection would have made every
  // consumer of `Map`'s signature resolve an overload set for no behavioral
  // gain.
  const DECLARED =
    'forall T, U. (collection<T>, mapping: callback<(T) -> U>, collection*) -> indexed_collection';
  const DISPLAY =
    '(collection, mapping: function, collection*) -> indexed_collection';

  it('declares the two clauses in one signature and drops the metadata', () => {
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'Map'))).toBe(DECLARED);
    // The metadata channel no longer exists at all (phase 3 deleted it with
    // its last consumer) — not merely undeclared here.
    expect(hasCallbackMetadata(ce, 'Map')).toBe(false);
  });

  it('displays the GROUND form (R-D5), with the §13 arity delta', () => {
    // NOT byte-identical to the pre-conversion string, which was
    // `(mapping: function, collection+) -> indexed_collection`: that spelling
    // was the parser's HOIST of `(collection+, mapping: function)` — it named
    // operand 0 the mapping, the artifact §2 recorded as "declares but does
    // not apply". The ground form now names operand 0 the collection, which is
    // what `Map(xs, f)` actually passes there. Still no narrowing claim: every
    // slot reads `function`/`collection`, and the tail keeps the
    // multi-collection form admitted (`*`, not `+`, so the unary form is not
    // made to look invalid).
    const ce = new ComputeEngine();
    expect(ce.box('Map').type.toString()).toBe(DISPLAY);
    expect(ce.function('Signature', [ce.symbol('Map')]).evaluate().string).toBe(
      DISPLAY
    );
    expect(
      (ce.lookupDefinition('Map') as any).operator.toJSON().signature
    ).toBe(DISPLAY);
  });

  it('the UNARY clause stamps, byte-identical to the metadata result', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'let points: list<tuple<number, number>> = [(0,0),(1,2),(3,4)]'
    );
    const e = ce.box([
      'Map',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
    ]);
    expect(e.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(e.evaluate().toString()).toBe('["True","False","False"]');
  });

  it('the VARIADIC clause never stamps — evaluation parity throughout', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let ss: list<string> = ["a","bb","ccc"]');

    // Homogeneous zip.
    const homog = ce.box([
      'Map',
      ['List', 1, 2],
      ['List', 3, 4],
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
    ]);
    expect(homog.toMathJson()).toEqual([
      'Map',
      ['List', 1, 2],
      ['List', 3, 4],
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
    ]);
    expect(homog.evaluate().toString()).toBe('[4,6]');

    // Heterogeneous zip.
    const heterog = ce.box([
      'Map',
      'cs',
      'ss',
      ['Function', ['Tuple', 'n', 's'], 'n', 's'],
    ]);
    expect(heterog.toMathJson()).toEqual([
      'Map',
      'cs',
      'ss',
      ['Function', ['Pair', 'n', 's'], 'n', 's'],
    ]);
    expect(heterog.evaluate().toString()).toBe(
      '[(1, "a"),(2, "bb"),(3, "ccc")]'
    );

    // Three sources.
    expect(
      ce
        .box([
          'Map',
          ['List', 1, 2],
          ['List', 3, 4],
          ['List', 5, 6],
          ['Function', ['Add', 'a', 'b', 'c'], 'a', 'b', 'c'],
        ])
        .evaluate()
        .toString()
    ).toBe('[9,12]');

    // Arity-mismatched callback: the diagnostic VALUE, verbatim.
    expect(
      ce
        .box([
          'Map',
          ['List', 1, 2],
          ['List', 3, 4],
          ['Function', ['Add', 'a', 1], 'a'],
        ])
        .evaluate()
        .toString()
    ).toBe(
      'Too many arguments for function "(a) |-> a + 1": expected 1, got 2'
    );

    // A named callback is shared, never rebuilt — on both clauses.
    executeEpsil(ce, 'let pair = (n, s) |-> (n, s)');
    expect(ce.box(['Map', 'cs', 'ss', 'pair']).toMathJson()).toEqual([
      'Map',
      'cs',
      'ss',
      'pair',
    ]);
    expect(
      ce
        .box(['Map', ['List', 1, 2], ['List', 3, 4], 'Add'])
        .evaluate()
        .toString()
    ).toBe('[4,6]');
  });

  it('admission is byte-identical: named, wildcard, non-function, union', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare('p', 'function');
    expect(ce.box(['Map', 'cs', 'IsPrime']).evaluate().toString()).toBe(
      '["False","True","True"]'
    );
    expect(ce.box(['Map', 'cs', 'p']).evaluate().toString()).toBe(
      '[p(1),p(2),p(3)]'
    );
    // A non-function operand: the canonical handler declines and the
    // expression stays inert, exactly as before the conversion (`Map` is lazy
    // WITH a canonical handler, so argument validation never runs on it).
    expect(
      ce
        .box(['Map', 'cs', { str: 'banana' }])
        .evaluate()
        .toString()
    ).toBe('Map("cs", "banana")');
    // A union source still declines the stamp (the permanent union ruling).
    executeEpsil(ce, 'let mixed: list<integer|string> = [1,"a",2]');
    expect(
      ce.box(['Map', 'mixed', ['Function', ['Add', 'x', 1], 'x']]).toMathJson()
    ).toEqual(['Map', 'mixed', ['Function', ['Add', 'x', 1], 'x']]);
  });

  it('the clauses separate by ARITY, with nothing added (§12.2)', () => {
    // At two operands the contextual slot IS the mapping; at three it lands on
    // a SOURCE, which is never an inline `Function` literal — so the stamp
    // declines by construction rather than by a special case.
    const ARM = parseType(DECLARED) as FunctionSignature;
    for (const count of [2, 3, 4]) {
      const plan = contextualCallbackPlan(ARM, count)!;
      expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
      expect(plan.sources).toEqual([0]);
    }
    // …and one operand offers no slot at all.
    expect(contextualCallbackPlan(ARM, 1)).toBeUndefined();
  });
});

describe('R-D4: the resolve-then-stamp helpers', () => {
  const CB = 'callback<(integer) -> boolean>';

  it('SLOT granularity: a union resolves to its single callback arm', () => {
    const cb = (spec: string) =>
      contextualSlotCallback(parseType(spec)) === undefined
        ? undefined
        : typeToString(contextualSlotCallback(parseType(spec))!);

    expect(cb(CB)).toBe(CB);
    expect(cb(`integer | ${CB}`)).toBe(CB);
    expect(cb('function')).toBeUndefined();
    expect(cb('integer')).toBeUndefined();
    // Ambiguous: a second callback arm, or an arm a function could inhabit.
    expect(cb(`${CB} | callback<(string) -> boolean>`)).toBeUndefined();
    expect(cb(`${CB} | function`)).toBeUndefined();
    expect(cb(`${CB} | any`)).toBeUndefined();
    expect(cb(`${CB} | ((integer) -> string)`)).toBeUndefined();
  });

  it('SLOT granularity: an OPEN sibling arm declines (and never reaches `provablyDisjoint`)', () => {
    // The §4.2 ground invariant asserts on an open type, so the check is
    // ordered to decline before it: nothing says a function could not inhabit
    // `T` anyway.
    const arm = (
      parseType(`forall T. (x: T | ${CB}) -> integer`) as FunctionSignature
    ).args![0].type;
    expect(contextualSlotCallback(arm)).toBeUndefined();
  });

  it('ARM granularity: arity, then the contextual slot, then ambiguity', () => {
    const sig = (s: string) => parseType(s) as FunctionSignature;
    const unary = sig(
      `forall T. (collection<T>, callback<(T) -> boolean>) -> integer`
    );
    // Spelled variadic-LAST: `(collection+, function)` is the same type (the
    // bins are filled by modifier, not by source order) but the type parser
    // now rejects that spelling rather than silently hoisting the `function`
    // to operand 0.
    const variadic = sig('(function, collection+) -> integer');
    const arms = [unary, variadic];

    // `Map`'s phase-3 shape in miniature: at arity 2 the contextual arm is the
    // only candidate; at arity 3 the arity filter leaves only the variadic
    // arm, which declares no slot — the re-ruled "the variadic form is NOT
    // stamped" falls out.
    expect(resolveContextualArm(arms, 2)).toBe(unary);
    expect(resolveContextualArm(arms, 3)).toBeUndefined();
    // A set no arm of which declares a slot: every user-defined overload set.
    expect(resolveContextualArm([variadic], 2)).toBeUndefined();
    // Ambiguity declines rather than guessing.
    expect(resolveContextualArm([unary, unary], 2)).toBeUndefined();
  });

  it('ARM granularity, end to end: the stamp runs against the RESOLVED arm', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare(
      'pick',
      '(forall T. (collection<T>, callback<(T) -> boolean>) -> integer) & ((collection, integer) -> integer)'
    );
    expect(
      ce
        .box(['pick', 'cs', ['Function', ['Greater', 'n', 1], 'n']])
        .toMathJson()
    ).toEqual([
      'pick',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
    // The other arm's operand shape is untouched.
    expect(ce.box(['pick', 'cs', 2]).toMathJson()).toEqual(['pick', 'cs', 2]);
  });

  it('ARM granularity: a COMPETING arm that could take the function declines', () => {
    // Filtering to the callback-bearing arms is not resolution: an arity-viable
    // sibling whose slot could equally take the `Function` operand leaves the
    // choice to the operand's own type, which the stamp runs before reading.
    // The tightened rule requires every other arity-viable arm to be provably
    // unable to accept a `function` at the candidate's contextual slots.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare(
      'amb',
      '(forall T. (collection<T>, callback<(T) -> boolean>) -> integer) & (forall T. (collection<T>, f: function) -> string)'
    );
    expect(
      ce.box(['amb', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual(['amb', 'cs', ['Function', ['Less', 1, 'n'], 'n']]);

    // …and the `Partition`-shaped disjointness still stamps: `integer` is
    // provably disjoint from `function`.
    ce.declare(
      'ok',
      '(forall T. (collection<T>, callback<(T) -> boolean>) -> integer) & (forall T. (collection<T>, n: integer) -> string)'
    );
    expect(
      ce.box(['ok', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual([
      'ok',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
  });

  it('a GROUND `callback<S>` in an overload arm stamps like the standalone signature', () => {
    // The contextual plan is `undefined` when there are no domain variables to
    // solve — the ground-`S` case — and the overload route used to stop there,
    // stamping nothing where the identical non-overload signature stamped.
    const ce = new ComputeEngine();
    const literal = ['Function', ['Less', 'x', 2], 'x'];
    const stamped = ['Function', ['Less', 'x', 2], ['Typed', 'x', "'integer'"]];
    ce.declare(
      'g1',
      '(collection<integer>, p: callback<(integer) -> boolean>) -> integer'
    );
    ce.declare(
      'g2',
      '((collection<integer>, p: callback<(integer) -> boolean>) -> integer) & ((string, string) -> string)'
    );
    expect(ce.box(['g1', ['List', 1, 2], literal]).ops[1].toMathJson()).toEqual(
      stamped
    );
    expect(ce.box(['g2', ['List', 1, 2], literal]).ops[1].toMathJson()).toEqual(
      stamped
    );
  });

  it('a user-defined overload set with NO contextual slot keeps the conservative skip', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare(
      'two',
      '((collection, (integer) -> boolean) -> integer) & ((collection, string) -> integer)'
    );
    expect(
      ce.box(['two', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual(['two', 'cs', ['Function', ['Less', 1, 'n'], 'n']]);
  });
});

describe('phase 2: route parity (box / Epsil / LaTeX)', () => {
  const parityJson = (build: (ce: ComputeEngine) => any): string => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    return JSON.stringify(build(ce).toMathJson());
  };

  it('`Partition` (eager, union slot) stamps identically on every route', () => {
    const viaBox = parityJson((ce) =>
      ce.box(['Partition', 'cs', ['Function', ['Less', 'n', 3], 'n']])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Partition',
      'cs',
      ['Function', ['Less', 'n', 3], ['Typed', 'n', "'integer'"]],
    ]);
    expect(
      parityJson((ce) => ce.box(parseEpsil('Partition(cs, n |-> n < 3)')[0]))
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse('\\operatorname{Partition}(\\mathrm{cs}, n \\mapsto n < 3)')
      )
    ).toBe(viaBox);
  });

  it('`Reduce` (lazy) stamps identically on every route', () => {
    const viaBox = parityJson((ce) =>
      ce.box(['Reduce', 'cs', ['Function', ['Add', 'a', 'x'], 'a', 'x']])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
    ]);
    expect(
      parityJson((ce) => ce.box(parseEpsil('Reduce(cs, (a, x) |-> a + x)')[0]))
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse('\\operatorname{Reduce}(\\mathrm{cs}, (a, x) \\mapsto a + x)')
      )
    ).toBe(viaBox);
  });
});

//
// ── Adversarial-review round (2026-08-09) ────────────────────────────────────
//
// Coverage the first implementation pass left open, plus regressions for the
// three erasure/display holes the review found.
//

describe('clause 1, on the POLYTYPE path: erasure reaches α-equivalence', () => {
  // `Poly <: Poly` is decided by comparing dedup-key STRINGS, and the dedup
  // key PRESERVES `callback<S>` (clause 5). Without a deep erasure on that
  // path the two arms below were unrelated in BOTH directions — clause 1
  // holding for ground signatures but not for the `forall` arms that actually
  // carry the constructor.
  const WITH = 'forall T. (collection<T>, callback<(T) -> boolean>) -> integer';
  const WITHOUT = 'forall T. (collection<T>, function) -> integer';

  it('a converted arm and its pre-conversion arm are equivalent', () => {
    expect(isSubtype(parseType(WITH), parseType(WITHOUT))).toBe(true);
    expect(isSubtype(parseType(WITHOUT), parseType(WITH))).toBe(true);
    const ce = new ComputeEngine();
    expect(ce.type(WITH).matches(WITHOUT)).toBe(true);
    expect(ce.type(WITHOUT).matches(WITH)).toBe(true);
  });

  it('the erasure is DEEP — a nested slot too', () => {
    expect(
      isSubtype(
        parseType(
          'forall T. (collection<T>, list<callback<(T) -> boolean>>) -> integer'
        ),
        parseType('forall T. (collection<T>, list<function>) -> integer')
      )
    ).toBe(true);
    expect(
      isSubtype(
        parseType('forall T. (collection<T>, list<function>) -> integer'),
        parseType(
          'forall T. (collection<T>, list<callback<(T) -> boolean>>) -> integer'
        )
      )
    ).toBe(true);
  });

  it('NEGATIVE control: a non-callback difference is still a difference', () => {
    expect(
      isSubtype(
        parseType(WITHOUT),
        parseType('forall T. (collection<T>, function) -> number')
      )
    ).toBe(false);
    expect(
      isSubtype(
        parseType(WITH),
        parseType('forall T. (list<T>, callback<(T) -> boolean>) -> integer')
      )
    ).toBe(false);
    // …and the dedup key itself still distinguishes them (clause 5 intact).
    expect(
      typeToDedupKey(parseType('callback<(integer) -> boolean>'))
    ).not.toBe(typeToDedupKey('function'));
  });
});

describe('clause 1: the erasure is DEEP in argument validation', () => {
  // A builtin writes the constructor as a whole parameter slot, but a
  // USER-declared signature may nest it — and a top-level-only erasure leaked
  // `callback<…>` into both the diagnostic and the `infer()` write.
  const NESTED = '(list<callback<(integer) -> boolean>>) -> integer';

  it('the diagnostic says `list<function>`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', NESTED);
    const e = ce.box(['g', 5]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('list<function>');
    expect(e.toString()).not.toContain('callback<');
  });

  it('the inference write is `list<function>`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', NESTED);
    ce.declare('u', 'unknown');
    ce.box(['g', 'u']);
    expect(ce.box('u').type.toString()).toBe('list<function>');
  });

  it('the TOP-LEVEL behavior is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(callback<(integer) -> boolean>) -> integer');
    expect(ce.box(['h', 5]).toString()).toContain('"function"');
    ce.declare('v', 'unknown');
    ce.box(['h', 'v']);
    expect(ce.box('v').type.toString()).toBe('function');
  });
});

describe('R-D5: runtime signature display is the GROUND form', () => {
  // Ruled 2026-08-09. A converted operator prints exactly its pre-conversion
  // signature — `callback<S>` erased to `function`, the `forall` variables at
  // their ground skeleton — because neither carries admission information.
  const COUNT_IF = '(collection, predicate: function) -> integer';
  const FILTER = '(collection, predicate: function) -> collection';

  it('a boxed operator NAME reports the pre-conversion string', () => {
    const ce = new ComputeEngine();
    expect(ce.box('CountIf').type.toString()).toBe(COUNT_IF);
    expect(ce.box('Filter').type.toString()).toBe(FILTER);
  });

  it('the `Signature` operator agrees', () => {
    const ce = new ComputeEngine();
    const sig = (op: string) =>
      ce.function('Signature', [ce.symbol(op)]).evaluate().string;
    expect(sig('CountIf')).toBe(COUNT_IF);
    expect(sig('Filter')).toBe(FILTER);
  });

  it('the definition JSON and the scope listing agree', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('CountIf') as any;
    expect(def.operator.toJSON().signature).toBe(COUNT_IF);

    // The scope listing writes to the console; capture it, strip the ANSI
    // color codes, and read the operator's line back.
    const lines: string[] = [];
    const push = (...a: unknown[]) => void lines.push(a.join(' '));
    const saved = {
      info: console.info,
      group: console.group,
      groupCollapsed: console.groupCollapsed,
      groupEnd: console.groupEnd,
    };
    console.info = push;
    console.group = push;
    console.groupCollapsed = push;
    console.groupEnd = () => {};
    try {
      (ce as any)._printStack({ details: true, maxDepth: 10 });
    } finally {
      Object.assign(console, saved);
    }
    const ansi = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
    const countIfLine = lines
      .map((l) => l.replace(ansi, ''))
      .find((l) => l.startsWith('CountIf:'));
    expect(countIfLine).toBe(`CountIf: ${COUNT_IF}`);
  });

  it('an UNCONVERTED operator is byte-identical to before', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Add').type.toString()).toBe('(value+) -> value');
    // …and an unconverted POLYTYPE keeps its `forall` display: the trigger is
    // the presence of a `callback<S>`, not being generic (R-D5, scoping).
    expect(ce.box('Sort').type.toString()).toBe(
      'forall T. (indexed_collection<T>, order: function?) -> list<T>'
    );
  });

  it('DISPLAY ONLY: the definition still holds the contextual signature', () => {
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'CountIf'))).toBe(
      'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> integer'
    );
  });

  // The seam is STRINGIFICATION, not the type (review round A). `.type`
  // returns the FAITHFUL type — semantics byte-identical to the definition —
  // and only its printed form is projected.
  it('the boxed type is FAITHFUL: polymorphic, and it matches its declaration', () => {
    const ce = new ComputeEngine();
    const t = ce.box('CountIf').type;
    expect(t.toString()).toBe(COUNT_IF);
    // Dropping the `forall` on the `.type` object flipped this, and with it
    // every `Ground <: Poly` answer (which is unconditionally false).
    expect(t.isPolymorphic).toBe(true);
    expect(
      t.matches(
        'forall T. (collection<T>, predicate: callback<(T) -> boolean>) -> integer'
      )
    ).toBe(true);

    // …and the same for a user's own callback-bearing polytype, on the VALUE
    // definition surface.
    ce.declare(
      'myCount',
      'forall T. (collection<T>, p: callback<(T) -> boolean>) -> integer'
    );
    const u = ce.symbol('myCount').type;
    expect(u.toString()).toBe('(collection, p: function) -> integer');
    expect(u.isPolymorphic).toBe(true);
    expect(
      u.matches(
        'forall T. (collection<T>, p: callback<(T) -> boolean>) -> integer'
      )
    ).toBe(true);
  });

  it('a callback-bearing INTERSECTION displays its ARMS, never `nothing`', () => {
    // `reduceType` collapses an intersection of two signatures that are not
    // mutually subtypes to the empty type, so a projection that ended in it
    // erased a user's whole overload set — through `.type`, hence through
    // `.matches` too.
    const ce = new ComputeEngine();
    ce.declare(
      'ov',
      '((collection<integer>, p: callback<(integer) -> boolean>) -> integer) & ((string) -> string)'
    );
    const t = ce.symbol('ov').type;
    expect(t.toString()).toBe(
      '((collection<integer>, p: function) -> integer) & ((string) -> string)'
    );
    expect(t.matches('(string) -> string')).toBe(true);
  });

  it('the projection never THROWS out of the getter', () => {
    // The erasure can leave a quantified variable occurring only result-side,
    // which is not a declarable polytype: re-boxing that form raised
    // `unsolvable-type-variable` from a property read. The projection now falls
    // back to the erased-but-`forall`-kept spelling.
    const ce = new ComputeEngine();
    ce.declare('r', 'forall T. (c: callback<(T) -> boolean>) -> tuple<T, T>');
    expect(ce.symbol('r').type.toString()).toBe(
      'forall T. (c: function) -> tuple<T, T>'
    );
    // A variable the erasure leaves relating an argument to the result is kept
    // as before (the §12.3 vacuity rule) and validates.
    ce.declare(
      'r2',
      'forall T. (c: callback<(T) -> boolean>, collection<T>) -> tuple<T, T>'
    );
    expect(ce.symbol('r2').type.toString()).toBe(
      'forall T. (c: function, collection<T>) -> tuple<T, T>'
    );
  });
});

describe('contextual stamping: shapes the first pass did not cover', () => {
  it('a multi-parameter `S` stamps from TWO sources', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'zipw',
      'forall T, U, V. (collection<T>, collection<U>, callback<(T, U) -> V>) -> list<V>'
    );
    const e = ce.box([
      'zipw',
      ['List', 1, 2],
      ['List', { str: 'a' }, { str: 'b' }],
      ['Function', ['Tuple', 'a', 'b'], 'a', 'b'],
    ]);
    expect(e.ops[2].toMathJson()).toEqual([
      'Function',
      ['Pair', 'a', 'b'],
      ['Typed', 'a', "'finite_integer'"],
      ['Typed', 'b', "'string'"],
    ]);
  });

  it('OPTIONAL parameters inside `S` round-trip and stamp', () => {
    expect(
      typeToString(parseType('callback<(integer, string?) -> boolean>'))
    ).toBe('callback<(integer, string?) -> boolean>');
    const ce = new ComputeEngine();
    ce.declare(
      'optcb',
      'forall T. (collection<T>, callback<(T, T?) -> boolean>) -> integer'
    );
    const e = ce.box([
      'optcb',
      ['List', 1, 2],
      ['Function', ['Greater', 'p', 1], 'p', 'q'],
    ]);
    expect(e.ops[1].toMathJson()).toEqual([
      'Function',
      ['Less', 1, 'p'],
      ['Typed', 'p', "'finite_integer'"],
      ['Typed', 'q', "'finite_integer'"],
    ]);
  });

  it('TWO callback slots in one arm are both stamped', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'two',
      'forall T. (collection<T>, callback<(T) -> boolean>, callback<(T) -> boolean>) -> integer'
    );
    const e = ce.box([
      'two',
      ['List', 1, 2],
      ['Function', ['Greater', 'a', 1], 'a'],
      ['Function', ['Less', 'b', 1], 'b'],
    ]);
    expect(e.ops[1].toMathJson()).toEqual([
      'Function',
      ['Less', 1, 'a'],
      ['Typed', 'a', "'finite_integer'"],
    ]);
    expect(e.ops[2].toMathJson()).toEqual([
      'Function',
      ['Less', 'b', 1],
      ['Typed', 'b', "'finite_integer'"],
    ]);
  });

  it('a VARIADIC `S` is admitted but declines the stamp (R-D6, retired)', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'vz',
      'forall T, U. (collection<T>, callback<(T+) -> U>) -> list<U>'
    );
    const e = ce.box([
      'vz',
      ['List', 1, 2],
      ['Function', ['Greater', 'a', 1], 'a'],
    ]);
    expect(e.isValid).toBe(true);
    // Admitted, parameter left BARE — pairing one parameter with N sources
    // was R-D6, RETIRED with the §6 rev-4 re-ruling (the variadic `Map` clause
    // it existed for declares no contextual slot at all). No converted
    // signature spells a variadic `S`; one that did declines outright.
    expect(e.ops[1].toMathJson()).toEqual(['Function', ['Less', 1, 'a'], 'a']);
  });

  it('a PARTIAL solve stamps the solved parameter and leaves the open one bare', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'part',
      'forall T, U. (collection<T>, callback<(T, U) -> boolean>) -> integer'
    );
    const e = ce.box([
      'part',
      ['List', 1, 2],
      ['Function', ['Greater', 'a', 1], 'a', 'b'],
    ]);
    // `U` has no source, so it stays open and its parameter declines — each
    // parameter is an independent contract.
    expect(e.ops[1].toMathJson()).toEqual([
      'Function',
      ['Less', 1, 'a'],
      ['Typed', 'a', "'finite_integer'"],
      'b',
    ]);
  });

  it('an OPERATOR NAME at a converted slot is admitted and never rebuilt', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['CountIf', ['List', 1, 2, 3, 4], 'IsEven']);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual(['CountIf', ['List', 1, 2, 3, 4], 'IsEven']);
    expect(e.evaluate().toString()).toBe('2');
  });

  it('`CountIf` stamps identically on every route (box / Epsil / LaTeX)', () => {
    const canonicalJson = (build: (ce: ComputeEngine) => any): string => {
      const ce = new ComputeEngine();
      executeEpsil(
        ce,
        'let points: list<tuple<number, number>> = [(0,0),(1,2)]'
      );
      return JSON.stringify(build(ce).toMathJson());
    };
    const viaBox = canonicalJson((ce) =>
      ce.box([
        'CountIf',
        'points',
        ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      ])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'CountIf',
      'points',
      [
        'Function',
        ['Equal', 'p', ['Pair', 0, 0]],
        ['Typed', 'p', 'tuple<number, number>'],
      ],
    ]);
    expect(
      canonicalJson((ce) =>
        ce.box(parseEpsil('CountIf(points, p |-> p == (0, 0))')[0])
      )
    ).toBe(viaBox);
    expect(
      canonicalJson((ce) =>
        ce.parse(
          '\\operatorname{CountIf}(\\mathrm{points}, p \\mapsto p = (0,0))'
        )
      )
    ).toBe(viaBox);
  });
});

//
// ── Adversarial-review round 2 (2026-08-09) ─────────────────────────────────
//
// Conformance the first review round found missing: the effects marker at a
// converted slot, the GROUND `callback<S>` stamp, route parity for the
// remaining shapes, and the display cache's re-grounding.
//

describe('effects: an undeclared symbol at a converted slot reads `any`', () => {
  // Ruling (v5): an unresolved named head infers `{any}` — sound, at the cost
  // of caching for forward references. A `type:` handler that reaches for the
  // callback's result type must not defeat it: reading `.type` here used to
  // canonicalize the held operand, which DECLARES the name into the literal's
  // scope, and the walker then saw a resolved head and reported the whole
  // literal PURE. Every converted operator must agree.
  for (const op of ['FlatMap', 'Map', 'Filter', 'CountIf', 'Scan'] as const) {
    it(`${op} keeps the \`any\` marker`, () => {
      const ce = new ComputeEngine();
      const t = ce.box(['Function', [op, ['List', 1, 2], 'q'], 'xs']).type;
      expect(t.toString()).toContain(') any ->');
      // …and the READ itself declared nothing.
      expect(ce.lookupDefinition('q')).toBeUndefined();
    });
  }

  it('`FlatMap` still sharpens its result from a DECLARED named callback', () => {
    // R-D2′ precision survives the side-effect-free lookup: a declared name is
    // read from its DEFINITION, not by canonicalizing the held operand.
    const ce = new ComputeEngine();
    ce.declare('tostr', '(integer) -> string');
    expect(ce.box(['FlatMap', ['List', 1, 2], 'tostr']).type.toString()).toBe(
      'list<string>'
    );
  });
});

describe('a GROUND `callback<S>` stamps like the plain-arrow spelling', () => {
  // §4 makes contextual typing `S`'s ONLY purpose, so a MONOMORPHIC signature
  // that spells its slot `callback<(integer) -> boolean>` must stamp — it
  // never reaches the contextual solve (a polytype route) and a ground `S` has
  // no domain variables to solve. A dead `S` would violate §4.
  const CB = '(list<integer>, callback<(integer) -> boolean>) -> integer';
  const ARROW = '(list<integer>, (integer) -> boolean) -> integer';
  const call = (ce: ComputeEngine, op: string) =>
    ce.box([op, ['List', 1, 2, 3], ['Function', ['Greater', 'n', 0], 'n']]);

  it('stamps identically to the plain arrow', () => {
    const ce = new ComputeEngine();
    ce.declare('cbCount', CB);
    ce.declare('arrCount', ARROW);
    const stamped = ['Function', ['Less', 0, 'n'], ['Typed', 'n', "'integer'"]];
    expect(call(ce, 'cbCount').toMathJson()).toEqual([
      'cbCount',
      ['List', 1, 2, 3],
      stamped,
    ]);
    expect(call(ce, 'arrCount').toMathJson()).toEqual([
      'arrCount',
      ['List', 1, 2, 3],
      stamped,
    ]);
  });

  it('…but admits BROADLY where the plain arrow narrows (clause 1)', () => {
    // The whole reason the two spellings exist. A named callback whose own
    // signature does not fit the slot ENTERS at `callback<S>` — and is judged
    // at application time — where the plain arrow rejects it at the boundary.
    const ce = new ComputeEngine();
    ce.declare('cbCount', CB);
    ce.declare('arrCount', ARROW);
    ce.assign(
      'strPred',
      ce.box(['Function', ['StringJoin', 's', '!'], ['Typed', 's', "'string'"]])
    );
    const cb = ce.function('cbCount', [
      ce.box(['List', 1, 2, 3]),
      ce.symbol('strPred'),
    ]);
    expect(cb.isValid).toBe(true);
    const arrow = ce.function('arrCount', [
      ce.box(['List', 1, 2, 3]),
      ce.symbol('strPred'),
    ]);
    expect(arrow.isValid).toBe(false);
    expect(arrow.toString()).toContain('incompatible-type');
  });

  it('a non-function at the slot reports `function`, not `S`', () => {
    // The R-D5/clause-1 erasure of the DIAGNOSTIC: `S` is contextual-typing
    // information and never claims a narrowing that did not happen.
    const ce = new ComputeEngine();
    ce.declare('cbCount', CB);
    ce.declare('arrCount', ARROW);
    expect(
      ce.function('cbCount', [ce.box(['List', 1]), ce.box(42)]).toString()
    ).toContain('"function", "finite_integer"');
    expect(
      ce.function('arrCount', [ce.box(['List', 1]), ce.box(42)]).toString()
    ).toContain('"(integer) -> boolean", "finite_integer"');
  });
});

describe('the stamp declines on an ARITY mismatch', () => {
  // The stamp pairs the literal's parameters with `S`'s POSITIONALLY, so a
  // two-parameter literal at a unary slot used to take a PARTIAL stamp (the
  // first parameter annotated, the second bare). The whole stamp declines
  // instead; evaluation is identical either way — the arity error dominates.
  it('a binary literal at a unary slot is left entirely bare', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box([
      'Filter',
      'cs',
      ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
    ]);
    expect(e.toMathJson()).toEqual([
      'Filter',
      'cs',
      ['Function', ['Less', 'b', 'a'], 'a', 'b'],
    ]);
  });

  it('the matching arity still stamps', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    expect(
      ce
        .box(['Filter', 'cs', ['Function', ['Greater', 'a', 0], 'a']])
        .toMathJson()
    ).toEqual([
      'Filter',
      'cs',
      ['Function', ['Less', 0, 'a'], ['Typed', 'a', "'integer'"]],
    ]);
  });
});

describe('R-D5: the ground display reaches the VALUE-definition surface', () => {
  // The same signature displayed the raw `forall`/`callback<>` as a value
  // definition and the ground form as an operator definition. The projection
  // is trigger-scoped (presence of a `callback<S>`), so nothing else moves.
  const SIG =
    'forall T. (collection<T>, p: callback<(T) -> boolean>) -> integer';

  it('a function-typed value declared with a `callback<S>` displays ground', () => {
    const ce = new ComputeEngine();
    ce.declare('myCount', SIG);
    expect(ce.symbol('myCount').type.toString()).toBe(
      '(collection, p: function) -> integer'
    );
    // Clause 5: the DEFINITION keeps the constructor for round-tripping.
    expect(
      typeToString((ce.lookupDefinition('myCount') as any).value.type.type)
    ).toBe(SIG);
  });

  it('a user polytype with no callback keeps its declared contract', () => {
    const ce = new ComputeEngine();
    ce.declare('idf', 'forall T. (x: T) -> T');
    expect(ce.symbol('idf').type.toString()).toBe('forall T. (x: T) -> T');
  });
});

describe('R-D5: the display cache re-grounds a REPLACED signature', () => {
  it('an operator whose signature is updated displays the new ground form', () => {
    // The cache is keyed on the signature `BoxedType` OBJECT, so a definition
    // whose signature is replaced is re-grounded on the next read rather than
    // serving a stale projection.
    const ce = new ComputeEngine();
    expect(ce.symbol('CountIf').type.toString()).toBe(
      '(collection, predicate: function) -> integer'
    );
    (ce.lookupDefinition('CountIf') as any).operator.update({
      signature:
        'forall U. (collection<U>, p: callback<(U) -> boolean>) -> number',
    });
    expect(ce.symbol('CountIf').type.toString()).toBe(
      '(collection, p: function) -> number'
    );
  });
});

describe('phase 2/3: route parity for the remaining shapes', () => {
  const parityJson = (build: (ce: ComputeEngine) => any): string => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    return JSON.stringify(build(ce).toMathJson());
  };

  it('`Fold` (callback FIRST) stamps identically on every route', () => {
    // The most parse-sensitive shape: the callback is operand 0 and its source
    // is operand 2, and the stamp has to survive `Fold`'s rewrite into
    // `Reduce`.
    const viaBox = parityJson((ce) =>
      ce.box(['Fold', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 10, 'cs'])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      10,
    ]);
    expect(
      parityJson((ce) =>
        ce.box(parseEpsil('Fold((a, x) |-> a + x, 10, cs)')[0])
      )
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse(
          '\\operatorname{Fold}((a, x) \\mapsto a + x, 10, \\mathrm{cs})'
        )
      )
    ).toBe(viaBox);
  });

  it('`Scan` stamps identically on every route', () => {
    const viaBox = parityJson((ce) =>
      ce.box(['Scan', 'cs', ['Function', ['Add', 'a', 'x'], 'a', 'x']])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
    ]);
    expect(
      parityJson((ce) => ce.box(parseEpsil('Scan(cs, (a, x) |-> a + x)')[0]))
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse('\\operatorname{Scan}(\\mathrm{cs}, (a, x) \\mapsto a + x)')
      )
    ).toBe(viaBox);
  });

  it("`Any`'s OPTIONAL slot stamps identically on every route", () => {
    const viaBox = parityJson((ce) =>
      ce.box(['Any', 'cs', ['Function', ['Greater', 'n', 1], 'n']])
    );
    expect(JSON.parse(viaBox)).toEqual([
      'Any',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
    expect(
      parityJson((ce) => ce.box(parseEpsil('Any(cs, n |-> n > 1)')[0]))
    ).toBe(viaBox);
    expect(
      parityJson((ce) =>
        ce.parse('\\operatorname{Any}(\\mathrm{cs}, n \\mapsto n > 1)')
      )
    ).toBe(viaBox);
    // The slot being OPTIONAL, the no-predicate form still canonicalizes.
    expect(parityJson((ce) => ce.box(['Any', ['List', 'True', 'False']]))).toBe(
      JSON.stringify(['Any', ['List', 'True', 'False']])
    );
  });
});

describe('`FlatMap` declares its finiteness facet', () => {
  // Without it every finite-guarded consumer was inert over a `FlatMap`, even
  // over a list literal — which stranded phase 1's R-D2′ result typing.
  const FM = [
    'FlatMap',
    ['List', 1, 2],
    ['Function', ['List', 'n', ['Multiply', 'n', 10]], 'n'],
  ];

  it('a finite source makes the flattened stream finite', () => {
    const ce = new ComputeEngine();
    expect(ce.box(FM).isFiniteCollection).toBe(true);
  });

  it('a finite-guarded consumer now runs over it', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Reduce', FM, ['Function', ['Add', 'a', 'x'], 'a', 'x'], 0])
        .evaluate()
        .toString()
    ).toBe('33');
  });

  it('an UNBOUNDED source keeps the stream infinite', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box([
        'FlatMap',
        ['Range', 1, 'PositiveInfinity'],
        ['Function', ['List', 'n'], 'n'],
      ]).isFiniteCollection
    ).toBe(false);
  });
});
