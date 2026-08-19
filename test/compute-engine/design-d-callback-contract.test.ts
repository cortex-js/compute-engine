import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import {
  freeTypeVariables,
  solveTypeArguments,
  substituteTypeVariables,
} from '../../src/common/type/instantiate';
import {
  contextualCallbackPlan,
  contextualSlotSignature,
  instantiateCallbackSlots,
} from '../../src/compute-engine/boxed-expression/generic-instantiation';
import { resolveContextualArm } from '../../src/compute-engine/boxed-expression/overload';
import type { FunctionSignature, Type } from '../../src/common/type/types';

/**
 * # The converted-callback family — behavioral contract under Design E
 *
 * `docs/TYPE-SYSTEM.md`. Design E
 * retired the `callback<S>` type constructor: a callback slot is now written
 * as the plain, effect-top arrow it always meant (`predicate: (T) any ->
 * boolean`), an operand is ADMITTED at such a slot unless it is provably
 * unusable there (§3's compatibility relation, not contravariant subtyping),
 * and the R-D5 display projection is gone — every operator now prints the
 * honest polytype it declares (§8).
 *
 * What this file pins for the whole converted family — `CountIf`, `Filter`,
 * `Find`, `IndexWhere`, `Position`, `Any`, `All`, `TakeWhile`, `DropWhile`,
 * `FlatMap`, `Reduce`, `Scan`, `Fold`, `Partition`, `Map`:
 *
 * - **admission** — a named narrower-than-slot callback, a wildcard
 *   `function`-typed symbol and an inline literal with an undeclared head all
 *   enter and stay dynamic per element, while a provably-disjoint operand is
 *   rejected at canonicalization (§3 rules 1/3/4);
 * - **contextual stamping** — the slot's solved parameter type is written
 *   onto an inline `Function` literal, with the union-source, arity and
 *   unprovable-source declines unchanged (§10 keeps the stamp and its gates);
 * - **route parity** — box, Epsil and LaTeX produce byte-identical canonical
 *   forms, since the gate and the stamp both run at canonicalization;
 * - **display** — the declared signature IS the displayed signature, on
 *   `.type`, the `Signature` operator, `toJSON()` and the scope listing;
 * - **the constructor's retirement** — the `callback<…>` spelling no longer
 *   parses, and says so with a migration hint.
 *
 * The suites that pin what must NOT change are elsewhere and stay untouched:
 * `collection-callback-signatures.test.ts` (the admission contract),
 * `design-e-compatibility.test.ts` (the relation itself) and
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
// ── The retired constructor, and the plain-arrow trigger that replaced it ────
//

describe('the `callback<…>` constructor is RETIRED (Design E §7)', () => {
  // Design D's five-clause contract dissolved with the constructor
  // (`docs/TYPE-SYSTEM.md`): admission
  // is the compatibility relation of §3, contextual typing triggers on plain
  // arrow slots, and there is nothing left to erase. What this block pins is
  // the DELETION itself.
  it('the spelling no longer parses, and the message carries the migration hint', () => {
    // The constructor is gone from the grammar, on the bare `parseType` route
    // and through a declaration alike. Both spell the replacement in the
    // message, so a user reading the error can rewrite the signature without
    // opening the design doc.
    expect(() => parseType('callback<(T) -> boolean>')).toThrow(
      /retired: write the arrow directly/
    );
    const ce = new ComputeEngine();
    expect(() =>
      ce.declare(
        'f',
        '(collection<T>, callback<(T) -> boolean>) -> integer where T'
      )
    ).toThrow(/retired: write the arrow directly/);
  });

  it('a user type NAMED `callback` is unaffected in its bare spelling', () => {
    // Only the CONSTRUCTOR spelling `callback<…>` was hijacked by the grammar
    // and is now a parse error; the bare identifier is an ordinary type name a
    // user may still claim. A transparent alias displays by its own NAME here
    // — that is how every alias prints, not something specific to this one —
    // and resolves to its definition for matching.
    const ce = new ComputeEngine();
    ce.declareType('callback', 'integer', { alias: true });
    ce.declare('n', 'callback');
    expect(ce.box('n').type.toString()).toBe('callback');
    expect(ce.box('n').type.matches('integer')).toBe(true);
  });
});

describe('the contextual solve plans PLAIN-ARROW slots (Design E §6b)', () => {
  const ARM = parseType(
    '(collection<T>, (T) any -> boolean) -> integer where T'
  ) as FunctionSignature;

  it('plans the arrow slot and the sources its PARAMETERS read', () => {
    const plan = contextualCallbackPlan(ARM, 2)!;
    expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
    expect([...plan.domainVars]).toEqual(['T']);
    expect(plan.sources).toEqual([0]);
  });

  it('instantiates the slot from the source operand alone', () => {
    const plan = contextualCallbackPlan(ARM, 2)!;
    const slots = instantiateCallbackSlots(ARM, plan, [
      parseType('list<integer>'),
      undefined,
    ]);
    expect(typeToString(slots.get(1)!)).toBe('(integer) any -> boolean');
  });

  it('declines with no domain source', () => {
    // `T` read only by the slot's RESULT: nothing to solve the domain from.
    const resultOnly = parseType(
      '(() any -> T, T) -> integer where T'
    ) as FunctionSignature;
    expect(contextualCallbackPlan(resultOnly, 2)).toBeUndefined();
  });
});

describe('phase 0: `CountIf` converts to the contextual signature', () => {
  it('declares the contextual slot and NO metadata', () => {
    const ce = new ComputeEngine();
    // Design E phase E1: the slot is an honest, effect-top arrow — the
    // `callback<S>` constructor is retired from converted signatures
    // (`docs/TYPE-SYSTEM.md`).
    expect(ce.type(declaredSignature(ce, 'CountIf')).toString()).toBe(
      '(collection<T>, predicate: (T) any -> boolean) -> integer where T'
    );
    // Read through `typeToString`, not `ce.type()`: the slot is OPEN (it
    // mentions the arm's `T`), and an open type is deliberately not boxable.
    expect(typeToString(declaredParam(ce, 'CountIf', 1))).toBe(
      '(T) any -> boolean'
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
    executeEpsil(ce, 'let pred = n => n > 1');
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
    // `constantFold: false`: the whole call is constant (a literal list and a
    // literal predicate), so compile-time constant folding would emit the
    // value `2` instead of the callback lowering this test pins.
    const r = compile(e, { fallback: false, constantFold: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '((_f) => ([1, 2, 3]).filter((_x) => _f(_x)).length)(((n) => 1 < n))'
    );
    expect((r.run as () => unknown)()).toBe(2);
    expect(new PythonTarget().compile(e, { constantFold: false })?.code).toBe(
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
    // Design E phase E2: honest, effect-top arrow (the constructor is gone).
    expect(ce.type(declaredSignature(ce, 'Filter')).toString()).toBe(
      '(collection<T>, predicate: (T) any -> boolean) -> collection where T'
    );
    expect(hasCallbackMetadata(ce, 'Filter')).toBe(false);
    // §7 rule 1: the result stays with the `type:` handler — the source's
    // indexedness, which the signature cannot express. Since the per-kind
    // result rule (`docs/STRING_ROADMAP.md`, Phase 0b) that handler yields
    // `list<T>` for an indexed source rather than echoing the source's own
    // type: filtering changes the length, so the former `vector<3>` claim for
    // a filtered 3-vector was a lie.
    expect(
      ce.box(['Filter', ['List', 1, 2, 3], 'IsPrime']).type.toString()
    ).toBe('list<finite_integer>');
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
        ce.box(parseEpsil('Filter(points, p => p == (0, 0))')[0])
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
          ['Function', ['Sqrt', 'x'], 'x'],
          ['List', 16, -4, { str: 'banana' }, 81],
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
    executeEpsil(ce, 'let isbig = (n: integer) => n > 1');
    const e = ce.box(['Filter', 'mixed', 'isbig']);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual(['Filter', 'mixed', 'isbig']);
    const out = e.evaluate().toString();
    expect(out).toContain('incompatible-type');
    expect(out).toContain('2');
  });

  // Was "the lazy slot stays inert for a non-function operand": a
  // parameterless operand is now rejected at every callback slot, lazy and
  // eager alike (ruled 2026-08-09 — see `canonicalCallbackOperand`). Admission
  // through `callback<S>` is unchanged; what changed is that the operand never
  // reaches it, having been replaced by the declared slot's own diagnostic.
  it('the lazy slot rejects a non-function operand', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Filter', XS, 5]);
    expect(e.isValid).toBe(false);
    expect(e.errors[0]?.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "function", "finite_integer"), 5)'
    );
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
  /** op, declared signature — which under Design E is also what it DISPLAYS. */
  const CONVERTED: ReadonlyArray<[string, string]> = [
    ['Find', '(collection<T>, predicate: (T) any -> boolean) -> any where T'],
    [
      'IndexWhere',
      '(collection<T>, predicate: (T) any -> boolean) -> integer where T',
    ],
    [
      'Position',
      '(collection<T>, predicate: (T) any -> boolean) -> list<integer> where T',
    ],
    [
      'Any',
      '(collection<T>, predicate: (T) any -> boolean?) -> boolean where T',
    ],
    [
      'All',
      '(collection<T>, predicate: (T) any -> boolean?) -> boolean where T',
    ],
    [
      'TakeWhile',
      '(collection<T>, predicate: (T) any -> boolean) -> collection where T',
    ],
    [
      'DropWhile',
      '(collection<T>, predicate: (T) any -> boolean) -> collection where T',
    ],
    ['FlatMap', '(collection<T>, mapping: (T) any -> U) -> list where T, U'],
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
    '%s displays its honest declared signature',
    (op, declared) => {
      // Design E §8 (`docs/TYPE-SYSTEM.md`)
      // voided R-D5's premise: the arrow now STATES the (compatibility) contract,
      // so printing it claims no narrowing and there is nothing left to ground.
      // Declaration and display are one string, on all three surfaces.
      const ce = new ComputeEngine();
      expect(ce.box(op).type.toString()).toBe(declared);
      expect(ce.function('Signature', [ce.symbol(op)]).evaluate().string).toBe(
        declared
      );
      expect((ce.lookupDefinition(op) as any).operator.toJSON().signature).toBe(
        declared
      );
    }
  );

  // ROADMAP cleanup (2026-08-09): `Signature` is `lazy` with no `canonical`
  // handler, so its operand arrived UNBOUND on the box and parse routes and
  // `.operatorDefinition` read `undefined` there — EVERY operator answered
  // `Nothing` unless the caller went through `ce.function`, which boxes its
  // arguments first. The name is now resolved by LOOKUP, which also keeps the
  // route free of the scope side effect `.canonical` would have had (it
  // DECLARES an unknown symbol).
  // The answer itself is now the honest declared signature (Design E §8,
  // `docs/TYPE-SYSTEM.md`); what this
  // test is about — that all three routes agree on it — is unchanged.
  it.each(CONVERTED)(
    '%s answers on the box and parse routes',
    (op, declared) => {
      const ce = new ComputeEngine();
      expect(ce.box(['Signature', op]).evaluate().string).toBe(declared);
      expect(
        ce.parse(`\\mathrm{Signature}(\\mathrm{${op}})`).evaluate().string
      ).toBe(declared);
    }
  );

  it('`Signature` of an unknown name is `Nothing`, and declares nothing', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Signature', 'nosuchoperator']).evaluate().symbol).toBe(
      'Nothing'
    );
    expect(ce.lookupDefinition('nosuchoperator')).toBe(undefined);
  });

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
    // Design E §3 (`docs/TYPE-SYSTEM.md`):
    // admission asks whether the operand is provably UNUSABLE, not whether it
    // is a subtype of the slot. `IsPrime: (number) -> boolean` overlaps the
    // solved `(finite_integer) any -> boolean` at every position, so it enters
    // every converted slot and is never rebuilt.
    const ce = new ComputeEngine();
    const e = ce.box([op, XS, 'IsPrime'] as any);
    expect(e.isValid).toBe(true);
    expect(e.toMathJson()).toEqual([op, [...XS], 'IsPrime']);
  });
});

describe('phase 1: `Any` / `All` — the OPTIONAL callback slot', () => {
  const ARM = parseType(
    '(collection<T>, predicate: (T) any -> boolean?) -> boolean where T'
  ) as FunctionSignature;

  it('the planner maps an OPTIONAL slot to its operand position', () => {
    // The `parameterPositions` / `paramAt` reconciliation: the contextual pass
    // and argument validation now read ONE definition of the
    // required→optional→variadic consumption order, so an optional callback
    // lands at operand 1 for both.
    const plan = contextualCallbackPlan(ARM, 2)!;
    expect(plan.callbacks.map((c) => c.index)).toEqual([1]);
    expect(plan.sources).toEqual([0]);
    // Design E §5: the converted slot is spelled effect-TOP, and instantiation
    // preserves the effect specifier — so the solved slot reads
    // `(integer) any -> boolean`, not the pure `(integer) -> boolean` the
    // `callback<S>` spelling used to carry
    // (`docs/TYPE-SYSTEM.md`).
    expect(
      typeToString(
        instantiateCallbackSlots(ARM, plan, [
          parseType('list<integer>'),
          undefined,
        ]).get(1)!
      )
    ).toBe('(integer) any -> boolean');
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
    '(collection<T>, mapping: (T) any -> U) -> list where T, U'
  ) as FunctionSignature;

  it('the SOLVER binds `U` from the callback’s result, `T` from the source', () => {
    // R-D2′ at the constraint level: `U` comes from the slot's RESULT position
    // only, `T` from the source.
    const solved = solveTypeArguments(ARM, [
      parseType('list<integer>'),
      parseType('(string) -> list<string>'),
    ]);
    expect(typeToString(solved.bindings['T'])).toBe('integer');
    expect(typeToString(solved.bindings['U'])).toBe('list<string>');
    // The callback's `string` PARAMETER now DOES reach `T` at this level and
    // conflicts with the source's `integer`: Design E deleted the blanket
    // "callback parameters never constrain the solve" and moved the skip up
    // into `solveArm`, which drops an arrow-slot operand only when every
    // variable in the slot's parameters also occurs at a data position — the
    // FlatMap case, hence the engine-level admission below (R-E3′, §12b item 1
    // of `docs/TYPE-SYSTEM.md`). The RAW
    // solver, which has no such notion, reports the conflict.
    expect(solved.failures).toEqual([
      {
        kind: 'upper',
        variable: 'T',
        solution: 'integer',
        expected: 'string',
        index: 1,
        pin: 'integer',
        detail:
          '`T` was solved to `integer` (from argument 1); this position requires `T <: string`',
      },
    ]);
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
    // The slot is `(T) any -> U`, not `callback<(T) -> collection<U>>`:
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

  it('a PROVABLY DISJOINT named callback is rejected at canonicalization', () => {
    // Compatibility admission (`docs/TYPE-SYSTEM.md`): a `string` parameter
    // can never receive an element of a
    // `list<integer>`, so this operand is provably unusable and the call is
    // statically invalid — where Design D admitted it and let the mismatch
    // surface as a per-element error VALUE. The diagnostic names both arrows:
    // the per-call SUPPLY arrow built from the source, and the operand's own
    // declared type. Partial overlap (a narrower callback over a union source)
    // is still admitted — see `Filter`'s per-element-dynamics pin above.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let wrap = (s: string) => [s]');
    const e = ce.box(['FlatMap', 'cs', 'wrap']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toBe(
      'FlatMap("cs", Error(ErrorCode("incompatible-type", "(integer) any -> unknown", "(s: string) -> list<string^1>"), "wrap"))'
    );
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
        ce.box(parseEpsil('TakeWhile(points, p => p == (0, 0))')[0])
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
        ce.box(parseEpsil('IndexWhere(points, p => p == (0, 0))')[0])
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
  /** op, declared signature — which under Design E is also what it DISPLAYS. */
  const CONVERTED: ReadonlyArray<[string, string]> = [
    [
      'Reduce',
      '(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> value where T',
    ],
    [
      'Scan',
      '(collection<T>, reducer: (unknown, T) any -> unknown, initial: value?) -> indexed_collection where T',
    ],
    [
      'Fold',
      '(reducer: (unknown, T) any -> unknown, initial: value, collection<T>) -> value where T',
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
    '%s displays its honest declared signature',
    (op, declared) => {
      // Design E §8 (`docs/TYPE-SYSTEM.md`):
      // the R-D5 projection is gone, so the `unknown` accumulator and the `where`
      // clause are printed as declared on all three display surfaces.
      const ce = new ComputeEngine();
      expect(ce.box(op).type.toString()).toBe(declared);
      expect(ce.function('Signature', [ce.symbol(op)]).evaluate().string).toBe(
        declared
      );
      expect((ce.lookupDefinition(op) as any).operator.toJSON().signature).toBe(
        declared
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
  // The arrow arm has to be PARENTHESIZED inside the union: written bare, the
  // arrow's result would swallow the `| integer` and the slot would parse as
  // `(T) any -> (boolean | integer)`.
  const DECLARED =
    '(collection<T>, ((T) any -> boolean) | integer, integer?) -> list<list<T>> where T';

  it('declares the union slot, displays it honestly, and drops the metadata', () => {
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'Partition'))).toBe(DECLARED);
    expect(hasCallbackMetadata(ce, 'Partition')).toBe(false);
    // Design E §9 item 4 kept the UNION spelling (compatibility applies to the
    // arrow arm), and §8 retired the R-D5 projection — so the display is now
    // the declared union verbatim rather than the grounded `function | integer`
    // (`docs/TYPE-SYSTEM.md`).
    expect(ce.box('Partition').type.toString()).toBe(DECLARED);
    expect(
      ce.function('Signature', [ce.symbol('Partition')]).evaluate().string
    ).toBe(DECLARED);
    expect(
      (ce.lookupDefinition('Partition') as any).operator.toJSON().signature
    ).toBe(DECLARED);
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
    // A non-function, non-integer operand is rejected as before; what changed
    // is that the diagnostic now names the INSTANTIATED union rather than the
    // erased `function | integer` (Design E §12b item 3,
    // `docs/TYPE-SYSTEM.md`) — strictly
    // more informative, since it says which element type the predicate arm
    // would have been applied to.
    expect(ce.box(['Partition', 'cs', { str: 'banana' }]).toString()).toBe(
      'Partition("cs", Error(ErrorCode("incompatible-type", "((integer) any -> boolean) | integer", "string"), "banana"))'
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
    // The instantiated slot is the ARROW ARM alone — the union resolves before
    // the solve — and it keeps the effect-top specifier the Design E respelling
    // gave it (§5, `docs/TYPE-SYSTEM.md`).
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
    ).toBe('(integer) any -> boolean');
  });
});

describe('phase 3: `Map` — the callback-first signature', () => {
  // Since the 2026-08-14 argument-order flip, `Map` has ONE honest positional
  // spelling: the mapping first, then a one-or-more variadic of sources.
  // (The retired §6-rev-4 two-clause encoding existed because the historical
  // collection-first order could not put a callback-LAST variadic into the
  // required→optional→variadic type language.) The callback slot is
  // contextual at every arity; the zip form's n-ary callback stays unstamped
  // via the R-D6 arity gate against the unary `(T) -> U`.
  const DECLARED =
    '(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U';
  // Design E phase E2 (§8): the display IS the honest declared polytype.
  const DISPLAY =
    '(mapping: (T) any -> U, collection<T>+) -> indexed_collection where T, U';

  it('declares the two clauses in one signature and drops the metadata', () => {
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'Map'))).toBe(DECLARED);
    // The metadata channel no longer exists at all (phase 3 deleted it with
    // its last consumer) — not merely undeclared here.
    expect(hasCallbackMetadata(ce, 'Map')).toBe(false);
  });

  it('displays the GROUND form (R-D5), with the §13 arity delta', () => {
    // The ground form is the DECLARED signature with its callback type
    // erased to the bare `function` primitive and its type variables
    // dropped. Operand 0 is the mapping in both, which is what `Map(f, xs)`
    // passes there.
    //
    // Before the argument-order flip these two disagreed: the signature
    // declared `(collection+, mapping: function)` while the parser HOISTED
    // the mapping into display position 0 — the drift the artifact §2
    // recorded as "declares but does not apply". Callback-first removed the
    // hoist, so declaration and display now agree on operand order and the
    // erasure is the only difference between them. Still no narrowing
    // claim: every slot reads `function`/`collection`, and the tail keeps
    // the multi-collection form admitted.
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
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      'points',
    ]);
    expect(e.ops[0].type.toString()).toBe(
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
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(homog.toMathJson()).toEqual([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(homog.evaluate().toString()).toBe('[4,6]');

    // Heterogeneous zip.
    const heterog = ce.box([
      'Map',
      ['Function', ['Tuple', 'n', 's'], 'n', 's'],
      'cs',
      'ss',
    ]);
    expect(heterog.toMathJson()).toEqual([
      'Map',
      ['Function', ['Pair', 'n', 's'], 'n', 's'],
      'cs',
      'ss',
    ]);
    expect(heterog.evaluate().toString()).toBe(
      '[(1, "a"),(2, "bb"),(3, "ccc")]'
    );

    // Three sources.
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Add', 'a', 'b', 'c'], 'a', 'b', 'c'],
          ['List', 1, 2],
          ['List', 3, 4],
          ['List', 5, 6],
        ])
        .evaluate()
        .toString()
    ).toBe('[9,12]');

    // Arity-mismatched callback: the diagnostic VALUE, verbatim. Since the
    // static callback-arity check (2026-08-15) this is settled at
    // CANONICALIZATION — a unary literal cannot be applied to one element of
    // each of two sources — instead of at application time, where it used to
    // surface as a thrown `Too many arguments`.
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Add', 'a', 1], 'a'],
          ['List', 1, 2],
          ['List', 3, 4],
        ])
        .evaluate()
        .toString()
    ).toContain(
      'Map calls its callback with 2 arguments (one element from each of the 2 collections); `(a) => a + 1` declares 1 parameter'
    );

    // A named callback is shared, never rebuilt — on both clauses.
    executeEpsil(ce, 'let pair = (n, s) => (n, s)');
    expect(ce.box(['Map', 'pair', 'cs', 'ss']).toMathJson()).toEqual([
      'Map',
      'pair',
      'cs',
      'ss',
    ]);
    expect(
      ce
        .box(['Map', 'Add', ['List', 1, 2], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[4,6]');
  });

  it('admission is byte-identical: named, wildcard, non-function, union', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare('p', 'function');
    expect(ce.box(['Map', 'IsPrime', 'cs']).evaluate().toString()).toBe(
      '["False","True","True"]'
    );
    expect(ce.box(['Map', 'p', 'cs']).evaluate().toString()).toBe(
      '[p(1),p(2),p(3)]'
    );
    // A non-function operand: the canonical handler replaces it with the
    // declared slot's diagnostic, the same one the EAGER siblings report
    // through `validateArguments` (ruled 2026-08-09 — before that, `Map` alone
    // stayed inert here because its canonical handler ran instead of argument
    // validation).
    expect(
      ce
        .box(['Map', { str: 'banana' }, 'cs'])
        .evaluate()
        .toString()
    ).toBe(
      'Map(Error(ErrorCode("incompatible-type", "function", "string"), "banana"), "cs")'
    );
    // A union source still declines the stamp (the permanent union ruling).
    executeEpsil(ce, 'let mixed: list<integer|string> = [1,"a",2]');
    expect(
      ce.box(['Map', ['Function', ['Add', 'x', 1], 'x'], 'mixed']).toMathJson()
    ).toEqual(['Map', ['Function', ['Add', 'x', 1], 'x'], 'mixed']);
  });

  it('the callback slot is contextual at every arity (callback-first)', () => {
    // Under the 2026-08-14 callback-first signature there is ONE clause: the
    // mapping is operand 0 at every arity, and every following operand is a
    // `collection<T>` source contributing to the solve (their JOIN — a union
    // join declines the stamp, and an arity-mismatched literal is admitted
    // unstamped under R-D6, which is what keeps the zip form's SUCCESS path
    // exactly as it was under the retired two-clause spelling of §6 rev 4).
    const ARM = parseType(DECLARED) as FunctionSignature;
    for (const count of [2, 3, 4]) {
      const plan = contextualCallbackPlan(ARM, count)!;
      expect(plan.callbacks.map((c) => c.index)).toEqual([0]);
      expect(plan.sources).toEqual(
        Array.from({ length: count - 1 }, (_, i) => i + 1)
      );
    }
    // …and one operand offers no source to solve from.
    expect(contextualCallbackPlan(ARM, 1)).toBeUndefined();
  });
});

describe('R-D4: the resolve-then-stamp helpers', () => {
  const CB = '(integer) any -> boolean';

  it('SLOT granularity: a union resolves to its single callback arm', () => {
    // Design E §6 replaced `contextualSlotCallback` with
    // `contextualSlotSignature`: the trigger is now the PLAIN ARROW rather than
    // the retired `callback<S>` spelling, and the forced-resolution rule for a
    // union slot is carried over unchanged
    // (`docs/TYPE-SYSTEM.md`). An arrow
    // arm inside a union must be parenthesized, or its result swallows the
    // sibling arms.
    const cb = (spec: string) =>
      contextualSlotSignature(parseType(spec)) === undefined
        ? undefined
        : typeToString(contextualSlotSignature(parseType(spec))!);

    expect(cb(CB)).toBe(CB);
    expect(cb(`integer | (${CB})`)).toBe(CB);
    expect(cb('function')).toBeUndefined();
    expect(cb('integer')).toBeUndefined();
    // Ambiguous: a second callback arm, or an arm a function could inhabit.
    expect(cb(`(${CB}) | ((string) any -> boolean)`)).toBeUndefined();
    expect(cb(`(${CB}) | function`)).toBeUndefined();
    expect(cb(`(${CB}) | any`)).toBeUndefined();
    expect(cb(`(${CB}) | ((integer) -> string)`)).toBeUndefined();
  });

  it('SLOT granularity: an OPEN sibling arm declines (and never reaches `provablyDisjoint`)', () => {
    // The ground invariant asserts on an open type, so the check is ordered to
    // decline before it: nothing says a function could not inhabit `T` anyway.
    const arm = (
      parseType(`(x: T | (${CB})) -> integer where T`) as FunctionSignature
    ).args![0].type;
    expect(contextualSlotSignature(arm)).toBeUndefined();
  });

  it('ARM granularity: arity, then the contextual slot, then ambiguity', () => {
    const sig = (s: string) => parseType(s) as FunctionSignature;
    const unary = sig(`(collection<T>, (T) any -> boolean) -> integer where T`);
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
      '((collection<T>, (T) any -> boolean) -> integer where T) & ((collection, integer) -> integer)'
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
      '((collection<T>, (T) any -> boolean) -> integer where T) & ((collection<T>, f: function) -> string where T)'
    );
    expect(
      ce.box(['amb', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual(['amb', 'cs', ['Function', ['Less', 1, 'n'], 'n']]);

    // …and the `Partition`-shaped disjointness still stamps: `integer` is
    // provably disjoint from `function`.
    ce.declare(
      'ok',
      '((collection<T>, (T) any -> boolean) -> integer where T) & ((collection<T>, n: integer) -> string where T)'
    );
    expect(
      ce.box(['ok', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual([
      'ok',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
  });

  it('a user overload set with ONE resolvable arrow arm stamps like its standalone twin', () => {
    // Design E: the uniform trigger reaches user overload sets — the arm
    // resolution (one arrow-slot arm, the competitor provably unable to take
    // a function) is the same R-D4 machinery the library uses, and the
    // resolved arm stamps exactly as the standalone signature always did.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare(
      'two',
      '((collection, (integer) -> boolean) -> integer) & ((collection, string) -> integer)'
    );
    expect(
      ce.box(['two', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual([
      'two',
      'cs',
      ['Function', ['Less', 1, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
  });

  it('an AMBIGUOUS user overload set — two arrow arms — keeps the conservative skip', () => {
    // The stamp never guesses which arm an operand took: with two
    // slot-declaring arms at the same arity, resolution declines and the
    // literal stays bare.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare(
      'amb',
      '((collection, (integer) -> boolean) -> integer) & ((collection, (string) -> boolean) -> string)'
    );
    expect(
      ce.box(['amb', 'cs', ['Function', ['Greater', 'n', 1], 'n']]).toMathJson()
    ).toEqual(['amb', 'cs', ['Function', ['Less', 1, 'n'], 'n']]);
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
      parityJson((ce) => ce.box(parseEpsil('Partition(cs, n => n < 3)')[0]))
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
      parityJson((ce) => ce.box(parseEpsil('Reduce(cs, (a, x) => a + x)')[0]))
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
// Coverage the first implementation pass left open. The three erasure blocks
// this round originally added went out with the constructor: Design E deleted
// `callback<S>`, so there is no longer a spelling for the subtype layer, the
// argument-validation diagnostics or the dedup key to erase
// (`docs/TYPE-SYSTEM.md`).
//

describe('runtime signature display is the HONEST declared polytype', () => {
  // R-D5 (ruled 2026-08-09) grounded every displayed signature that carried a
  // `callback<S>`, because printing the constructor's inner arrow would have
  // claimed a contravariant narrowing that admission did not perform. Design E
  // §8 (`docs/TYPE-SYSTEM.md`) voided
  // that premise — the arrow now STATES the compatibility contract — and
  // deleted the projection outright, so declaration and display are one string
  // everywhere: `.type`, the `Signature` operator, `toJSON()`, the scope
  // listing, and the VALUE-definition surface for a user's own signature.
  const COUNT_IF_E =
    '(collection<T>, predicate: (T) any -> boolean) -> integer where T';
  // Design E phase E2: `Filter` converted — honest polytype display (§8).
  const FILTER =
    '(collection<T>, predicate: (T) any -> boolean) -> collection where T';

  it('a boxed operator NAME reports the signature honestly', () => {
    const ce = new ComputeEngine();
    expect(ce.box('CountIf').type.toString()).toBe(COUNT_IF_E);
    expect(ce.box('Filter').type.toString()).toBe(FILTER);
  });

  it('the `Signature` operator agrees', () => {
    const ce = new ComputeEngine();
    const sig = (op: string) =>
      ce.function('Signature', [ce.symbol(op)]).evaluate().string;
    expect(sig('CountIf')).toBe(COUNT_IF_E);
    expect(sig('Filter')).toBe(FILTER);
  });

  it('the definition JSON and the scope listing agree', () => {
    const ce = new ComputeEngine();
    const def = ce.lookupDefinition('CountIf') as any;
    expect(def.operator.toJSON().signature).toBe(COUNT_IF_E);

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
    expect(countIfLine).toBe(`CountIf: ${COUNT_IF_E}`);
  });

  it('an operator with no callback slot is untouched; the comparators converted', () => {
    const ce = new ComputeEngine();
    expect(ce.box('Add').type.toString()).toBe('(value+) -> value');
    // `Sort`'s comparator slots were ruled INTO the sweep (Design E §9 item 6,
    // `docs/TYPE-SYSTEM.md`) with the
    // union spelling chosen for dual-mode slots — a unary key extractor or a
    // binary comparator — so both arms now print their honest slot type where
    // they used to print the bare `function`. `Sort` gained the leading
    // string-preserving arm with Strings Phase 1 (a reordering of a string's
    // characters is a string); both arms still display their `where` clause.
    expect(ce.box('Sort').type.toString()).toBe(
      '((T, order: ((character) any -> unknown) | ((character, character) any -> number)?) -> T where T: string) & ((indexed_collection<T>, order: ((T) any -> unknown) | ((any, any) any -> number)?) -> list<T> where T)'
    );
  });

  it('definition and display COINCIDE for a Design E operator', () => {
    // Under Design E there is no projection seam left for `CountIf`: the
    // declared arrow is the displayed arrow.
    const ce = new ComputeEngine();
    expect(typeToString(declaredSignature(ce, 'CountIf'))).toBe(COUNT_IF_E);
  });

  // `.type` was always the FAITHFUL type — semantics byte-identical to the
  // definition — and under Design E its printed form is faithful too.
  it('the boxed type is FAITHFUL: polymorphic, and it matches its declaration', () => {
    const ce = new ComputeEngine();
    const t = ce.box('CountIf').type;
    expect(t.toString()).toBe(COUNT_IF_E);
    // Dropping the `where` clause on the `.type` object flipped this, and with it
    // every `Ground <: Poly` answer (which is unconditionally false).
    expect(t.isPolymorphic).toBe(true);
    expect(t.matches(COUNT_IF_E)).toBe(true);

    // …and the same for a user's own callback-bearing polytype, on the VALUE
    // definition surface: it now prints what its author wrote, where R-D5 used
    // to project it to `(collection, p: function) -> integer` (Design E §8,
    // `docs/TYPE-SYSTEM.md`).
    const MY_COUNT =
      '(collection<T>, p: (T) any -> boolean) -> integer where T';
    ce.declare('myCount', MY_COUNT);
    const u = ce.symbol('myCount').type;
    expect(u.toString()).toBe(MY_COUNT);
    expect(u.isPolymorphic).toBe(true);
    expect(u.matches(MY_COUNT)).toBe(true);
    expect(
      typeToString((ce.lookupDefinition('myCount') as any).value.type.type)
    ).toBe(MY_COUNT);
  });
});

describe('contextual stamping: shapes the first pass did not cover', () => {
  it('a multi-parameter `S` stamps from TWO sources', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'zipw',
      '(collection<T>, collection<U>, (T, U) any -> V) -> list<V> where T, U, V'
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
    expect(typeToString(parseType('(integer, string?) any -> boolean'))).toBe(
      '(integer, string?) any -> boolean'
    );
    const ce = new ComputeEngine();
    ce.declare(
      'optcb',
      '(collection<T>, (T, T?) any -> boolean) -> integer where T'
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
      '(collection<T>, (T) any -> boolean, (T) any -> boolean) -> integer where T'
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
    ce.declare('vz', '(collection<T>, (T+) any -> U) -> list<U> where T, U');
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
      '(collection<T>, (T, U) any -> boolean) -> integer where T, U'
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
        ce.box(parseEpsil('CountIf(points, p => p == (0, 0))')[0])
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
// converted slot, and route parity for the remaining shapes. The two blocks
// this round added for the `callback<S>` spelling itself — its ground stamp
// and its display cache's re-grounding — went out with the constructor and
// its display projection (Design E §7/§8,
// `docs/TYPE-SYSTEM.md`).
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
      const t = ce.box([
        'Function',
        op === 'Map' ? [op, 'q', ['List', 1, 2]] : [op, ['List', 1, 2], 'q'],
        'xs',
      ]).type;
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

describe('the stamp declines on an ARITY mismatch', () => {
  // The stamp pairs the literal's parameters with `S`'s POSITIONALLY, so a
  // two-parameter literal at a unary slot used to take a PARTIAL stamp (the
  // first parameter annotated, the second bare). The whole stamp declines
  // instead; evaluation is identical either way — the arity error dominates.
  it('a binary literal at a unary slot is rejected, never half-stamped', () => {
    // Since the static callback-arity check (2026-08-15) the arity error
    // dominates at CANONICALIZATION: `Filter` applies its predicate to one
    // element, so a binary literal can never be applied and the slot holds the
    // diagnostic. The stamp still never runs — which is what this test is
    // about — and there is no half-annotated literal to be found anywhere.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const e = ce.box([
      'Filter',
      'cs',
      ['Function', ['Greater', 'a', 'b'], 'a', 'b'],
    ]);
    expect(e.toString()).toContain(
      'Filter calls its callback with 1 argument (each element of the collection); `(a, b) => b < a` declares 2 parameters'
    );
    expect(e.toString()).not.toContain('Typed');
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

describe('a user polytype displays its declared contract', () => {
  it('a user polytype with no callback keeps its declared contract', () => {
    const ce = new ComputeEngine();
    ce.declare('idf', '(x: T) -> T where T');
    expect(ce.symbol('idf').type.toString()).toBe('(x: T) -> T where T');
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
      parityJson((ce) => ce.box(parseEpsil('Fold((a, x) => a + x, 10, cs)')[0]))
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
      parityJson((ce) => ce.box(parseEpsil('Scan(cs, (a, x) => a + x)')[0]))
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
      parityJson((ce) => ce.box(parseEpsil('Any(cs, n => n > 1)')[0]))
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
