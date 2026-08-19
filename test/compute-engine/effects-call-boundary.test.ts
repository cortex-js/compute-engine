import { ComputeEngine } from '../../src/compute-engine';
import type { Type } from '../../src/common/type/types';

/**
 * # Call-boundary effect bounds
 *
 * Stage 2 WP-C of `docs/EFFECTS-MODEL.md` ("Subtyping" — *Requiring absence*,
 * and worked example 5):
 *
 * > An annotated parameter (`g: (real) -> real`) *is* the requirement "callers
 * > pass a pure function", checked at the call boundary as parameter types are
 * > today — an `incompatible-type` error value, with the **same timing** as
 * > existing argument validation, including its non-strict/lazy carve-outs.
 *
 * There is no separate effect check: an operand's arrow effects ride the
 * ordinary contravariant parameter check, because `isSubtype` on two signatures
 * is effect-aware (Stage 1) and `validateArguments` compares with `matches()`.
 * The one place that had to change is the INFERRED-TYPE narrowing branch, which
 * admits an operand when the parameter is a subtype of its current type: on the
 * covariant effect axis a pure parameter *is* a subtype of a `random` operand,
 * so that branch would both admit an effectful callback at a pure bound and
 * rewrite the symbol's type to claim an effect it has is absent
 * (`narrowingPreservesEffects`, `common/type/utils.ts`).
 */

/** An engine with `integ(f: (any) -> number, real, real)` — form 1 of
 * "Requiring absence": the bare arrow, i.e. the empty bound. */
function engine(
  bound = '((any) -> number, real, real) -> real'
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('integ', {
    signature: bound,
    evaluate: (_ops, { engine }) => engine.number(1),
  });
  return ce;
}

const PURE_CALLBACK = ['Function', ['Add', 'x', 1], 'x'];
const RANDOM_CALLBACK = ['Function', ['Random'], 'x'];

/** The `incompatible-type` marker an operand carries when it fails its bound. */
function rejectedOperand(
  e: ReturnType<ComputeEngine['box']>
): string | undefined {
  const bad = e.ops?.find((op) => !op.isValid);
  return bad?.toString();
}

describe('a bare-arrow parameter is a pure-callback bound', () => {
  it('accepts a pure callback', () => {
    const ce = engine();
    const e = ce.box(['integ', PURE_CALLBACK, 0, 1]);
    expect(e.isValid).toBe(true);
  });

  it('rejects a `random` callback — an `incompatible-type` error VALUE, not a throw', () => {
    const ce = engine();
    const e = ce.box(['integ', RANDOM_CALLBACK, 0, 1]);
    expect(e.isValid).toBe(false);
    expect(rejectedOperand(e)).toMatchInlineSnapshot(
      `"Error(ErrorCode("incompatible-type", "(any) -> number", "(unknown) random -> number"), (x) => Random())"`
    );
  });

  it('rejects a callback reached through a SYMBOL binding', () => {
    const ce = engine();
    ce.assign('rf', ce.box(RANDOM_CALLBACK));
    const e = ce.box(['integ', 'rf', 0, 1]);
    expect(e.isValid).toBe(false);
  });

  it('rejects an `{any}` operand: an opaque function cannot prove absence', () => {
    const ce = engine();
    ce.declare('opaqueF', ce.type('(any) any -> number'));
    expect(ce.box(['integ', 'opaqueF', 0, 1]).isValid).toBe(false);
  });

  it('rejects on the PARSE route too', () => {
    const ce = engine();
    const e = ce.parse(
      '\\operatorname{integ}(x \\mapsto \\operatorname{Random}(), 0, 1)'
    );
    expect(e.isValid).toBe(false);
  });
});

describe('a positive bound tolerates what it lists, and only that', () => {
  // Form 2 of "Requiring absence": `g: (any) scope -> number` — "scope
  // mutation tolerated, probabilistic nondeterminism excluded".
  const SCOPE_BOUND = '((any) scope -> number, real, real) -> real';

  it('admits a `scope` callback', () => {
    const ce = engine(SCOPE_BOUND);
    ce.box(['Declare', 'ctr', 0]).evaluate();
    const writer = ['Function', ['Block', ['Assign', 'ctr', 1], 2], 'x'];
    expect(ce.box(writer).type.toString()).toContain('scope');
    expect(ce.box(['integ', writer, 0, 1]).isValid).toBe(true);
  });

  it('admits a PURE callback — the empty set is below every bound', () => {
    const ce = engine(SCOPE_BOUND);
    expect(ce.box(['integ', PURE_CALLBACK, 0, 1]).isValid).toBe(true);
  });

  it('still rejects `random` — the bound excludes it', () => {
    const ce = engine(SCOPE_BOUND);
    expect(ce.box(['integ', RANDOM_CALLBACK, 0, 1]).isValid).toBe(false);
  });
});

describe('the bare `function` primitive is effect-top and never rejects', () => {
  it('`Map(x ↦ Random(), xs)` keeps working (worked example 5, the contrast)', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['Map', RANDOM_CALLBACK, ['List', 1, 2, 3]]);
    expect(e.isValid).toBe(true);
    // …and projects `{random}` rather than rejecting.
    expect(e.isPure).toBe(false);
  });

  it('an `{any}` opaque callback is admitted there as well', () => {
    const ce = new ComputeEngine();
    ce.declare('opaqueF', ce.type('(any) any -> number'));
    expect(ce.box(['Map', 'opaqueF', ['List', 1, 2, 3]]).isValid).toBe(true);
  });
});

describe('timing is the timing of argument validation — no new pass', () => {
  it('non-strict mode skips the effect check exactly as it skips the type check', () => {
    const ce = engine();
    ce.strict = false;
    expect(ce.box(['integ', RANDOM_CALLBACK, 0, 1]).isValid).toBe(true);
  });

  it('a LAZY position defers identically: unbound operands refute nothing', () => {
    const ce = new ComputeEngine();
    ce.declare('lazyInteg', {
      signature: '((any) -> number, real) -> real',
      lazy: true,
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    expect(ce.box(['lazyInteg', RANDOM_CALLBACK, 0]).isValid).toBe(true);
  });
});

describe('the narrowing branch does not narrow AWAY an effect', () => {
  it('an inferred `random` signature is not admitted at a pure bound', () => {
    const ce = engine();
    ce.declare('needsRandom', {
      signature: '((any) random -> number) -> real',
      evaluate: (_ops, { engine }) => engine.number(2),
    });
    // `k` is inferred as `(any) random -> number` by the first call…
    expect(ce.box(['needsRandom', 'k']).isValid).toBe(true);
    expect(ce.box('k').type.toString()).toBe('(any) random -> number');
    // …and the pure bound must REJECT it rather than narrow the symbol.
    expect(ce.box(['integ', 'k', 0, 1]).isValid).toBe(false);
    expect(ce.box('k').type.toString()).toBe('(any) random -> number');
  });

  it('narrowing on a non-effect axis is unaffected', () => {
    const ce = new ComputeEngine();
    ce.declare('wide', {
      signature: '(value) -> integer',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    ce.declare('narrow', {
      signature: '(set) -> integer',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    expect(ce.box(['wide', 'S']).isValid).toBe(true);
    expect(ce.box(['narrow', 'S']).isValid).toBe(true);
    expect(ce.box('S').type.toString()).toBe('set');
  });
});

/**
 * The Stage 2 **blast-radius protocol** (`docs/EFFECTS-MODEL.md`, "Migration
 * and sequencing"): enumerate every library operator whose parameter is a
 * function SIGNATURE — those carry a bound and can newly reject — as opposed to
 * the bare `function` primitive, which is effect-top and never rejects.
 *
 * Pinning the enumeration makes a new signature-typed callback parameter a
 * reviewed event: it is the only way a library operator acquires an effect
 * bound, and a bare arrow there declares "callers must pass a pure function".
 */
describe('blast radius: which library parameters carry an effect bound', () => {
  it('no library operator declares a function-SIGNATURE callback parameter', () => {
    const ce = new ComputeEngine();
    const scope = (ce as any).contextStack[0].lexicalScope;

    const armsOf = (t: Type | undefined): any[] => {
      if (!t || typeof t === 'string') return [];
      if (t.kind === 'signature') return [t];
      if (t.kind === 'intersection' || t.kind === 'union')
        return (t.types as Type[]).flatMap(armsOf);
      return [];
    };

    const bounded: string[] = [];
    for (const [name, def] of scope.bindings as Map<string, any>) {
      const opDef = def.operator;
      if (!opDef?.signature) continue;
      for (const arm of armsOf(opDef.signature.type)) {
        const params: Type[] = [
          ...(arm.args ?? []).map((a: any) => a.type),
          ...(arm.optArgs ?? []).map((a: any) => a.type),
          ...(arm.variadicArg ? [arm.variadicArg.type] : []),
        ];
        // A parameter is a BOUND only when it is a signature: the bare
        // `function` primitive (and any union containing it) is effect-top.
        if (params.some((p) => armsOf(p).length > 0)) bounded.push(name);
      }
    }

    // Design E (`docs/plans/2026-08-18-compatibility-admission-callbacks.md`
    // §4): a converted operator's slot IS a signature — that is the point —
    // spelled with the EFFECT-TOP `any` slot so it cannot newly reject an
    // effectful callback. The enumeration therefore pins the converted
    // inventory (phases E1–E2: `CountIf`, `Filter`, `Map`; the E3 sweep grows it), and the
    // assertion below verifies the effect-top spelling for each: an entry
    // appearing here WITHOUT `effects: 'any'` on its arrow params is the
    // reviewed event this pin exists to force.
    expect([...new Set(bounded)].sort()).toEqual(['CountIf', 'Filter', 'Map']);
    for (const name of new Set(bounded)) {
      const opDef = (scope.bindings as Map<string, any>).get(name)!.operator;
      for (const arm of armsOf(opDef.signature.type))
        for (const p of [
          ...(arm.args ?? []).map((a: any) => a.type),
          ...(arm.optArgs ?? []).map((a: any) => a.type),
          ...(arm.variadicArg ? [arm.variadicArg.type] : []),
        ])
          for (const cbArm of armsOf(p))
            expect(`${name}: ${cbArm.effects}`).toBe(`${name}: any`);
    }
  });

  it('the callback slots do not newly reject an impure callback today', () => {
    const ce = new ComputeEngine();
    // `Iterate` used to be in this enumeration. Its callback slot is now the
    // bare `function` primitive — effect-top by definition, so there is no
    // bound to enforce or defer. The contract is parametric (`((integer, T) ->
    // T, T?) -> list<T>`), which the grammar cannot express; see
    // `collection-callback-signatures.test.ts`. Its acceptance of an effectful
    // body stays pinned here. (It is an INFINITE collection: never materialize
    // it — take a prefix.)
    const iterate = ce.box([
      'Take',
      ['Iterate', ['Function', ['Random'], 'i', 'acc'], 0],
      2,
    ]);
    expect(iterate.isValid).toBe(true);
    expect([...iterate.evaluate().each()]).toHaveLength(2);

    // `Product` takes a HELD EXPRESSION (the multiplicand body), not a
    // function value: its body slot is `any`, aligned with `Sum`, so there is
    // no bound to enforce at all. It is also `lazy: true` — the non-strict
    // carve-out: the held body is pushed through untouched, and any effect
    // check defers with it.
    const product = ce.box(['Product', ['Random'], ['Tuple', 'i', 1, 3]]);
    expect(product.isValid).toBe(true);
    expect(product.evaluate().isValid).toBe(true);
  });
});
