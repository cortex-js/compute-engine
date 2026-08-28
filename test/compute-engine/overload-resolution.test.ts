import { ComputeEngine } from '../../src/compute-engine';

/**
 * Overload resolution for intersection-of-signature types.
 * See `docs/TYPE-SYSTEM.md`.
 */

/** The three-arm signature from §1 of the design (with the §3 arm-1
 * correction: a REQUIRED first parameter in every arm made `Rnd()` match
 * none). */
const OVERLOAD =
  '((number?) -> real) & ((set<real>, number?) -> real) & ((collection, number?) -> any)';

function engine(signature = OVERLOAD): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Rnd', { signature, evaluate: () => ce.number(0.5) });
  return ce;
}

describe('overload resolution: arm selection', () => {
  it('selects by arity', () => {
    const ce = engine();
    // Only arm 1 accepts zero arguments.
    expect(ce.box(['Rnd']).type.toString()).toBe('real');
  });

  it('selects a disjoint arm by operand type', () => {
    const ce = engine();
    // `number` is disjoint from `set<real>` and `collection`.
    expect(ce.box(['Rnd', 5]).type.toString()).toBe('real');
  });

  it('prefers the MORE SPECIFIC of two overlapping arms', () => {
    const ce = engine();
    // `Interval(0,1)` types as `set<real>`, and `set<real> <: collection`, so
    // arms 2 AND 3 both accept it. Arm 2 is more specific, so the result is
    // `real`, not `any`.
    expect(ce.box(['Rnd', ['Interval', 0, 1]]).type.toString()).toBe('real');
    expect(ce.box(['Rnd', ['Interval', 0, 1], 7]).type.toString()).toBe('real');
  });

  it('falls to the general arm when the specific one does not apply', () => {
    const ce = engine();
    expect(ce.box(['Rnd', ['List', 1, 2, 3]]).type.toString()).toBe('any');
    expect(ce.box(['Rnd', ['List', 1, 2, 3], 7]).type.toString()).toBe('any');
  });

  it('tie-breaks incomparable arms by declaration order', () => {
    // Neither `string` nor `boolean` is a subtype of the other, and an
    // unknown-typed operand refutes neither arm, so the first wins.
    const ce = engine('((string) -> integer) & ((boolean) -> rational)');
    expect(ce.box(['Rnd', 'undeclaredSym']).type.toString()).toBe('integer');
  });
});

describe('overload resolution: diagnostics', () => {
  it('rejects a call no arm accepts', () => {
    const ce = engine();
    // A BOOLEAN: none of the arms (`collection`, `number`, `set<real>`)
    // admits it. (A string is no longer such an operand — a string is an
    // indexed collection of its characters, so the `collection` arm takes it.)
    const b = ce.box(['Rnd', 'True']);
    expect(b.isValid).toBe(false);
    // The expected type names the whole overload set at that position.
    expect(b.toString()).toContain('collection | number | set<real>');
  });

  it('blames ONLY the operands at fault', () => {
    const ce = engine();
    // The list is a fine first argument for arm 3; only the seed is bad. A
    // whole-list blame would also indict `[1,2,3]`.
    const b = ce.box(['Rnd', ['List', 1, 2, 3], { str: 'x' }]);
    expect(b.isValid).toBe(false);
    expect(b.toString()).toContain('[1,2,3]');
    expect(b.toString()).toContain('"number", "string"');
  });

  it('reports extra arguments as unexpected, not as type errors', () => {
    const ce = engine();
    const b = ce.box(['Rnd', 1, 2, 3]);
    expect(b.isValid).toBe(false);
    expect(b.toString()).toContain('unexpected-argument');
  });

  it('rejects an arity no arm offers', () => {
    const ce = engine();
    // 2 args: arm 1 is out on arity; arms 2 and 3 need a collection first.
    const b = ce.box(['Rnd', 5, 2]);
    expect(b.isValid).toBe(false);
  });

  // REGRESSION: blame was computed per COLUMN ("no arm admits position i"),
  // which is not the negation of the selection rule ("one arm admits every
  // position"). When arms cross-satisfy, every column was admitted by SOME arm,
  // nothing was blamed, and a call no arm accepts came back fully valid —
  // `isValid` being purely structural.
  it('rejects a call whose positions are individually — but not jointly — admissible', () => {
    const ce = engine(
      '((boolean, integer) -> integer) & ((integer, boolean) -> string)'
    );
    // Arm 1 accepts position 0, arm 2 accepts position 1; neither accepts both.
    const b = ce.box(['Rnd', true, true]);
    expect(b.isValid).toBe(false);
  });

  // REGRESSION: the arity branch bracketed by global min/max, so a GAP in the
  // accepted set was waved through with no marker at all.
  it('rejects an arity that falls in a GAP between the arms', () => {
    const ce = engine(
      '((integer) -> integer) & ((integer, integer, integer) -> string)'
    );
    const b = ce.box(['Rnd', 1, 2]); // arms take 1 or 3 — never 2
    expect(b.isValid).toBe(false);
    expect(b.toString()).toContain('unexpected-argument');
  });

  it('never returns an all-valid operand list when no arm was selected', () => {
    // The invariant behind both regressions above, stated directly.
    const cases: [string, any[]][] = [
      [
        '((boolean, integer) -> integer) & ((integer, boolean) -> string)',
        [true, true],
      ],
      [
        '((integer) -> integer) & ((integer, integer, integer) -> string)',
        [1, 2],
      ],
      ['((integer) -> integer) & ((string) -> string)', [true]],
      ['((integer) -> integer) & ((string) -> string)', [1, 2, 3]],
    ];
    for (const [sig, args] of cases) {
      const ce = engine(sig);
      expect(ce.box(['Rnd', ...args]).isValid).toBe(false);
    }
  });
});

describe('overload resolution: reachability of validation', () => {
  // REGRESSION: `box.ts` gated the value-definition application path on
  // `valueType.kind === 'signature'`, so an overload-typed VALUE definition
  // (as opposed to an operator definition) skipped validation entirely.
  it('validates applications of an overload-typed value definition', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '((integer) -> integer) & ((string) -> string)');
    expect(ce.box(['h', true]).isValid).toBe(false);
    expect(ce.box(['h', 1, 2, 3]).isValid).toBe(false);
    // …and still accepts the legal calls, with the selected arm's result type.
    expect(ce.box(['h', 3]).type.toString()).toBe('integer');
    expect(ce.box(['h', { str: 'a' }]).type.toString()).toBe('string');
  });

  // REGRESSION: `hasFunctionSignature` made these call sites proceed for an
  // intersection, but `assertFunctionLiteralArity` early-returned unless the
  // declaration was ONE plain signature, so the arity guard silently no-opped
  // and every declared 1-argument call would have partial-applied.
  it('arity-checks a function literal against EVERY arm', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '((integer) -> number) & ((string) -> number)');
    expect(() =>
      ce
        .box(['Assign', 'f', ['Function', ['Add', 'x', 'y'], 'x', 'y']])
        .evaluate()
    ).toThrow(/takes 2 parameter\(s\)/);
  });

  it('accepts a literal whose arity satisfies every arm', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '((integer) -> number) & ((string) -> number)');
    // One parameter satisfies both arms — the arity guard must not fire.
    // (Whether the BODY satisfies both arms is the separate subtype check.)
    expect(() =>
      ce.box(['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']]).evaluate()
    ).not.toThrow(/takes 1 parameter\(s\)/);
  });
});

describe('overload resolution: arity bounds', () => {
  // `variadicMin: 0` (`T*`) imposes nothing, so the optional parameters stay
  // optional; a positive minimum (`T+`) must clear them first, because
  // `validateArguments` fills optArgs before the variadic slot.
  it('a `T*` variadic arm accepts the bare required arity', () => {
    const ce = engine('((integer*) -> integer) & ((string, string) -> string)');
    expect(ce.box(['Rnd']).type.toString()).toBe('integer');
    expect(ce.box(['Rnd', 1, 2, 3]).type.toString()).toBe('integer');
  });

  it('a `T+` variadic arm requires at least one variadic argument', () => {
    const ce = engine(
      '((integer, integer+) -> integer) & ((string) -> string)'
    );
    expect(ce.box(['Rnd', 1, 2]).type.toString()).toBe('integer');
    // One argument satisfies only the `string` arm, which an integer fails.
    expect(ce.box(['Rnd', 1]).isValid).toBe(false);
  });
});

describe('overload resolution: inference (design §4.3)', () => {
  it('infers the JOIN of the viable arms at each position', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    ce.declare('y', 'unknown');
    expect(ce.box(['Rnd', 'x', 'y']).isValid).toBe(true);
    // Position 0: arms 2 and 3 are viable (arm 1 is out on arity);
    // widen(set<real>, collection) === collection.
    expect(ce.symbol('x').type.toString()).toBe('collection');
    // Position 1: both viable arms say `number`, so the join IS `number`.
    expect(ce.symbol('y').type.toString()).toBe('number');
  });

  it('infers the join across all three arms for a one-argument call', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    expect(ce.box(['Rnd', 'x']).isValid).toBe(true);
    expect(ce.symbol('x').type.toString()).toBe(
      'collection | number | set<real>'
    );
  });

  it('TRAP §4.5: never narrows to the MEET / most-specific parameter', () => {
    const ce = engine();
    ce.declare('x', 'unknown');
    ce.box(['Rnd', 'x']);
    // `set<real>` is the most specific candidate. Inferring it would assume
    // arm 2 was selected and would reject a later list assignment that arm 3
    // accepts.
    expect(ce.symbol('x').type.toString()).not.toBe('set<real>');
  });

  it('a single viable arm infers exactly that arm parameter', () => {
    // Byte-identical to the plain-signature path.
    const overloaded = engine();
    overloaded.declare('x', 'unknown');
    overloaded.declare('y', 'unknown');
    overloaded.box(['Rnd', 'x', 'y']);

    const plain = new ComputeEngine();
    plain.declare('F', {
      signature: '(collection, number?) -> any',
      evaluate: () => plain.Nothing,
    });
    plain.declare('x', 'unknown');
    plain.declare('y', 'unknown');
    plain.box(['F', 'x', 'y']);

    expect(overloaded.symbol('x').type.toString()).toBe(
      plain.symbol('x').type.toString()
    );
    expect(overloaded.symbol('y').type.toString()).toBe(
      plain.symbol('y').type.toString()
    );
  });

  it('KNOWN APPROXIMATION §4.6: the join is per-position, so it admits combinations no arm accepts', () => {
    const ce = engine(
      '((number, string) -> integer) & ((string, number) -> rational)'
    );
    ce.declare('x', 'unknown');
    ce.declare('y', 'unknown');
    ce.box(['Rnd', 'x', 'y']);
    // Both positions join to `number | string`, which permits `x: number,
    // y: number` — a combination neither arm accepts. Imprecision, not
    // unsoundness: the constraint is WEAKER than the truth.
    expect(ce.symbol('x').type.toString()).toBe('number | string');
    expect(ce.symbol('y').type.toString()).toBe('number | string');
  });
});

describe('overload resolution: write-freedom (design §4.2)', () => {
  it('a rejected arm does not narrow a symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('G', {
      signature: '((set, number) -> real) & ((collection, string) -> any)',
      evaluate: () => ce.Nothing,
    });
    ce.declare('A', 'set');
    // `s` is auto-declared with an INFERRED `value` type, which arm 1's `set`
    // parameter would narrow during a naive trial validation of that arm.
    ce.box(['SetMinus', 'A', 's']);
    expect(ce.symbol('s').type.toString()).toBe('value');

    // A boolean second operand refutes BOTH arms, so no arm is selected.
    expect(ce.box(['G', 's', true]).isValid).toBe(false);

    // Had resolution run arms through the real validator, arm 1 would have
    // narrowed `s` to `set` before being rejected.
    expect(ce.symbol('s').type.toString()).toBe('value');
  });
});

describe('overload resolution: route parity', () => {
  const expectRoutes = (
    ce: ComputeEngine,
    build: () => ReturnType<ComputeEngine['box']>,
    type: string
  ) => expect(build().type.toString()).toBe(type);

  it('box, function and parse routes all resolve', () => {
    const ce = engine();
    expectRoutes(ce, () => ce.box(['Rnd', ['Interval', 0, 1]]), 'real');
    expectRoutes(
      ce,
      () => ce.function('Rnd', [ce.box(['Interval', 0, 1])]),
      'real'
    );
    expectRoutes(ce, () => ce.parse('\\mathrm{Rnd}(5)'), 'real');
  });
});

describe('overload resolution: operand-less consumers (design §5)', () => {
  it('assume() on an overload-typed operator does not throw', () => {
    // `assume.ts` asserted `functionResult(...)!` non-null. An overload set has
    // no single result type, so `isSubtype` dereferenced `undefined` and threw
    // a raw TypeError. Undeterminable is not a proven contradiction.
    const ce = new ComputeEngine();
    ce.declare('Rnd', {
      signature: '((integer) -> integer) & ((string) -> string)',
      evaluate: () => ce.number(1),
    });
    expect(() => ce.assume(['Element', 'Rnd', 'Integers'])).not.toThrow();
    expect(ce.assume(['Element', 'Rnd', 'Integers'])).toBe('ok');
  });
});

describe('the bare `function` type has an UNKNOWN result, not `any`', () => {
  it('types an undeclared application honestly', () => {
    // `functionSignature` synthesized `(any*) -> unknown` for `function` while
    // `functionResult` answered `any` — an internal contradiction. `unknown` is
    // also the signal `_infer()` treats as "no information", whereas `any` gets
    // written into a definition as a positive claim.
    const ce = new ComputeEngine();
    expect(ce.box(['List', ['h', 'x']]).type.toString()).toBe('list<unknown>');
  });
});

describe('overload resolution: non-overload intersections are untouched', () => {
  it('a mixed intersection is not treated as an overload set', () => {
    const ce = new ComputeEngine();
    // `((number) -> real) & list<boolean>` is not a callable overload set.
    // Behavior must be exactly as before: no validation, `unknown` result.
    ce.declare('H', {
      signature: '((number) -> real) & list<boolean>',
      evaluate: () => ce.Nothing,
    });
    const b = ce.box(['H', { str: 'anything' }]);
    expect(b.isValid).toBe(true);
    expect(b.type.toString()).toBe('unknown');
  });
});

/**
 * Effects and overload arms (`docs/EFFECTS-MODEL.md`, "Subtyping" —
 * *Overloads*):
 *
 * > **Specificity**: effect sets are consulted only to break ties among arms
 * > already equally specific by argument type; a subset is more specific;
 * > **incomparable effect sets are not compared** and fall through to the
 * > existing tie-break. […] Arms distinguishable *only* by effect set are a
 * > definition error.
 */
describe('overload resolution: effects break ties, and only ties', () => {
  it('a SUBSET effect set is more specific among arms equal by argument type', () => {
    // Both arms bind `number`, so neither is more specific by argument type.
    // The EFFECTFUL arm is declared FIRST, so declaration order alone would
    // select it; the pure arm wins on the effect tie-break instead.
    const ce = engine('((number) scope -> rational) & ((number) -> integer)');
    expect(ce.box(['Rnd', 5]).type.toString()).toBe('integer');
  });

  it('argument specificity still outranks effects', () => {
    // Arm 2 is more specific by argument type (`integer <: number`) even
    // though its effect set is larger. Effects never overturn that.
    const ce = engine('((number) -> rational) & ((integer) scope -> integer)');
    expect(ce.box(['Rnd', 5]).type.toString()).toBe('integer');
  });

  it('INCOMPARABLE effect sets fall through to declaration order', () => {
    // `{random}` and `{scope}` are pairwise incomparable singletons: no
    // comparison is made, and the first arm wins as it does today.
    const ce = engine('((number) random -> rational) & ((number) scope -> integer)');
    expect(ce.box(['Rnd', 5]).type.toString()).toBe('rational');
  });

  it('arms distinguishable ONLY by effects are a definition error', () => {
    expect(() =>
      engine('((number) scope -> integer) & ((number) -> integer)')
    ).toThrow(/differ only by their effects/);
  });

  it('arms distinguishable by argument type may of course differ in effects', () => {
    expect(() =>
      engine('((integer) random -> integer) & ((string) -> string)')
    ).not.toThrow();
  });
});
