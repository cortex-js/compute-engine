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
    // Neither `real` nor `integer | string` is a subtype of the other, and
    // the integer operand fits both, so the first arm wins.
    const ce = engine('((real) -> integer) & ((integer | string) -> rational)');
    expect(ce.box(['Rnd', 5]).type.toString()).toBe('integer');
  });

  it('joins the results of incomparable arms on an unknown operand', () => {
    // Neither `string` nor `boolean` is a subtype of the other, and an
    // unknown-typed operand refutes neither arm. The call can take either arm
    // at run time, so its result type is the join of `integer` and
    // `rational` (which is `rational`), not the result of the first arm.
    const ce = engine('((string) -> integer) & ((boolean) -> rational)');
    expect(ce.box(['Rnd', 'undeclaredSym']).type.toString()).toBe('rational');
  });
});

describe('overload resolution: result join on an undecided operand', () => {
  it('joins the results of every viable arm', () => {
    const ce = engine('((string) -> string) & ((boolean) -> integer)');
    // An undeclared symbol, a symbol declared `unknown`, and one declared
    // `any` all leave both arms viable.
    expect(ce.box(['Rnd', 'w']).type.toString()).toBe('integer | string');
    ce.declare('u', 'unknown');
    expect(ce.box(['Rnd', 'u']).type.toString()).toBe('integer | string');
    ce.declare('a', 'any');
    expect(ce.box(['Rnd', 'a']).type.toString()).toBe('integer | string');
  });

  it('a concrete operand still selects one arm', () => {
    const ce = engine('((string) -> string) & ((boolean) -> integer)');
    expect(ce.box(['Rnd', 'True']).type.toString()).toBe('integer');
    expect(ce.box(['Rnd', { str: 'x' }]).type.toString()).toBe('string');
  });

  it('keeps the selected result when every viable arm has the same result', () => {
    const ce = engine('((string) -> integer) & ((boolean) -> integer)');
    expect(ce.box(['Rnd', 'w']).type.toString()).toBe('integer');
  });

  it('an arm whose result is unknown makes the join unknown', () => {
    // `widen` would drop the `unknown` and claim `integer`.
    const ce = engine('((string) -> integer) & ((boolean) -> unknown)');
    expect(ce.box(['Rnd', 'w']).type.toString()).toBe('unknown');
  });

  it('a lazy operator keeps the selected result', () => {
    // A lazy operator's operands arrive unbound, so their types do not
    // decide anything, and the result is read off the selected arm.
    const ce = new ComputeEngine();
    ce.declare('Rnd', {
      signature: '((string) -> integer) & ((boolean) -> rational)',
      lazy: true,
      evaluate: () => ce.number(0.5),
    });
    expect(ce.box(['Rnd', 'w']).type.toString()).toBe('integer');
  });

  it('a bounded type variable reads as its bound in the join (Slice)', () => {
    // `Slice` has string arms `(value: T, …) -> T where T: string` and list
    // arms `(value: indexed_collection<T>, …) -> list<T> where T`. An
    // unknown operand binds no `T`, so the string arm contributes `string`.
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    expect(ce.box(['Slice', 'u', 1, 2]).type.toString()).toBe(
      'list<unknown> | string'
    );
    // An undeclared symbol is narrowed by the call (a string is an indexed
    // collection, so to `indexed_collection<unknown>`), but the call keeps
    // the resolution it was validated against.
    expect(ce.box(['Slice', 'v', 1, 2]).type.toString()).toBe(
      'list<unknown> | string'
    );
    // A concrete operand selects one arm.
    expect(ce.box(['Slice', { str: 'abc' }, 1, 2]).type.toString()).toBe(
      'string'
    );
    expect(ce.box(['Slice', ['List', 1, 2, 3], 1, 2]).type.toString()).toBe(
      'list<integer>'
    );
  });

  it('a string consumer accepts a slice of an unknown operand', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    const expr = ce.box(['Characters', ['Slice', 'u', 1, 2]]);
    expect(expr.isValid).toBe(true);
    expect(expr.type.toString()).toBe('list<character>');
    ce.assign('u', { str: 'abc' });
    expect(expr.evaluate().toString()).toBe('["a","b"]');
  });
});

describe('overload resolution: result join on an overlapping operand', () => {
  it('a non-viable generic arm that can take the operand at run time joins', () => {
    // Arm 2 is the only viable arm and it matches strictly (`collection` is
    // `collection`). Arm 1 is refused by its bound (`collection` is not a
    // subtype of `string`), but a collection value can be a string at run
    // time, so the call is undecided and the result joins both arms. A
    // shortcut that reads "one strictly matching viable arm" as decided
    // would type this `integer`.
    const ce = engine('((T) -> T where T: string) & ((collection) -> integer)');
    ce.declare('c', 'collection');
    expect(ce.box(['Rnd', 'c']).type.toString()).toBe('integer | string');
  });

  // An operand whose type only OVERLAPS a parameter (shares a value with it
  // without being a subtype of it) does not decide the arm either: at run
  // time the value may or may not be one that arm takes.

  it('a collection-typed operand at the string-preserving operators joins', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'collection');
    ce.declare('ic', 'indexed_collection');
    for (const s of ['c', 'ic']) {
      expect(ce.box(['Slice', s, 1, 2]).type.toString()).toBe(
        'list<unknown> | string'
      );
      expect(ce.box(['Take', s, 2]).type.toString()).toBe(
        'list<unknown> | string'
      );
      expect(ce.box(['Reverse', s]).type.toString()).toBe('list | string');
    }
  });

  it('an operand that decides the arm still selects one arm', () => {
    const ce = new ComputeEngine();
    ce.declare('li', 'list<integer>');
    ce.declare('st', 'string');
    expect(ce.box(['Slice', 'li', 1, 2]).type.toString()).toBe('list<integer>');
    expect(ce.box(['Take', 'li', 2]).type.toString()).toBe('list<integer>');
    expect(ce.box(['Reverse', 'li']).type.toString()).toBe('list<integer>');
    expect(ce.box(['Slice', 'st', 1, 2]).type.toString()).toBe('string');
    expect(ce.box(['Take', 'st', 2]).type.toString()).toBe('string');
    expect(ce.box(['Reverse', 'st']).type.toString()).toBe('string');
  });

  it('a collection bound keeps the element type of the operand', () => {
    // `Reverse` has a `T where T: list` arm. An
    // `indexed_collection<boolean>` operand overlaps `list`, and the arm's
    // result is read as `list<boolean>`, not as the bare `list`.
    const ce = new ComputeEngine();
    ce.declare('ib', 'indexed_collection<boolean>');
    expect(ce.box(['Reverse', 'ib']).type.toString()).toBe('list<boolean>');
  });

  it('ground arms: an operand that overlaps two incomparable parameters joins', () => {
    const ce = engine('((list<integer>) -> integer) & ((string) -> string)');
    ce.declare('ic', 'indexed_collection');
    expect(ce.box(['Rnd', 'ic']).type.toString()).toBe('integer | string');
    const ce2 = engine('((integer) -> integer) & ((real) -> string)');
    ce2.declare('n', 'number');
    expect(ce2.box(['Rnd', 'n']).type.toString()).toBe('integer | string');
  });

  it('ground arms: an operand that is a subtype of one parameter selects it', () => {
    const ce = engine('((list<integer>) -> integer) & ((string) -> string)');
    ce.declare('li', 'list<integer>');
    expect(ce.box(['Rnd', 'li']).type.toString()).toBe('integer');
    ce.declare('st', 'string');
    expect(ce.box(['Rnd', 'st']).type.toString()).toBe('string');
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
