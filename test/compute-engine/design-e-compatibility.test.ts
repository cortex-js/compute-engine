import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * # Design E — compatibility admission at arrow-typed callback slots
 *
 * Phase E1 acceptance
 * (`docs/TYPE-SYSTEM.md`):
 * `CountIf`'s predicate slot is an honest, effect-top arrow
 * (`(T) any -> boolean`), and a callback operand is admitted unless it is
 * PROVABLY UNUSABLE — not-callable, arity-incapable (the shipped
 * `callback-arity` check), provably disjoint in a parameter or the result, or
 * effect-violating. Everything the broad-admission era admitted that can work
 * still enters and resolves per element at evaluation; what changes is that
 * can-only-fail programs now fail at canonicalization, with the instantiated
 * arrow in the message.
 */

const XS = ['List', 1, 2, 3, 4] as const;

describe('the KEEP table — admission the compatibility relation preserves (§2)', () => {
  it('a named callback narrower than the instantiated slot counts', () => {
    const ce = new ComputeEngine();
    // `IsPrime: (number) -> boolean` vs the instantiated
    // `(integer) any -> boolean`: NOT a contravariant subtype, but the
    // types overlap — compatibility admits.
    const e = ce.box(['CountIf', XS, 'IsPrime']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('2');
  });

  it('an undeclared source stays `collection<unknown>` (R-E3: no callback→domain inference)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['CountIf', 'zs', 'IsPrime']).isValid).toBe(true);
    // The predicate's `(number)` domain must NOT manufacture
    // `collection<number>` out of the wildcard source.
    expect(ce.box('zs').type.toString()).toBe('collection<unknown>');
  });

  it('a wildcard `function`-typed symbol is admitted', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'function');
    const e = ce.box(['CountIf', XS, 'p']);
    expect(e.isValid).toBe(true);
    // …and the use does not narrow `p` to the per-call arrow: the slot is a
    // supply, not evidence of `p`'s own signature.
    expect(ce.box('p').type.toString()).toBe('function');
  });

  it('a mixed-element source keeps per-element dynamic behavior', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['CountIf', ['List', 2, 3, { str: 'a' }, 4], 'IsPrime']);
    expect(e.isValid).toBe(true);
    // The number/string mismatch surfaces at EVALUATION, per element — the
    // union-PERMANENT ruling's runtime half, untouched by Design E.
    expect(e.evaluate().toString()).toContain('incompatible-type');
  });

  it('an inline literal with an undeclared function in its body is admitted', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['CountIf', XS, ['Function', ['g', 'x'], 'x']]).isValid).toBe(
      true
    );
  });
});

describe('the flagship rejection — provably disjoint predicates (§13)', () => {
  it('`CountIf(names, IsPrime)` over `list<string>` is invalid at canonicalization', () => {
    const ce = new ComputeEngine();
    ce.declare('names', 'list<string>');
    const e = ce.box(['CountIf', 'names', 'IsPrime']);
    expect(e.isValid).toBe(false);
    // The diagnostic names the INSTANTIATED slot arrow and the operand's own
    // arrow — the expected/actual pair of §6.
    expect(e.toString()).toContain(
      'ErrorCode("incompatible-type", "(string) any -> boolean", "(number) -> boolean")'
    );
  });

  it('a provably non-boolean predicate RESULT rejects too (§9 Q3)', () => {
    const ce = new ComputeEngine();
    ce.declare('toInt', '(unknown) -> integer');
    expect(ce.box(['CountIf', XS, 'toInt']).isValid).toBe(false);
  });

  it('an unknown-result named callback still enters', () => {
    const ce = new ComputeEngine();
    ce.declare('mystery', '(unknown) -> unknown');
    expect(ce.box(['CountIf', XS, 'mystery']).isValid).toBe(true);
  });
});

describe('rule 5 — effects stay enforced, and effect-top slots stay open (§4)', () => {
  it('an effectful callback is admitted at the effect-top library slot', () => {
    const ce = new ComputeEngine();
    ce.declare('re', '(number) random -> boolean');
    expect(ce.box(['CountIf', XS, 're']).isValid).toBe(true);
  });

  it('a user-declared PURE arrow slot still rejects an effectful callback', () => {
    // The `integ` shape of `effects-call-boundary.test.ts`, restated here as
    // the §3 rule 5 guard: compatibility replaces only the TYPE halves of
    // admission; the effect-subset check is mandatory at every arrow slot.
    const ce = new ComputeEngine();
    ce.declare('integ2', {
      signature: '((any) -> number, real, real) -> number',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    ce.declare('re', '(number) random -> number');
    expect(ce.box(['integ2', 're', 0, 1]).isValid).toBe(false);
  });
});

describe('uniformity — user-declared arrow slots get the same relation (§9 Q1)', () => {
  it('a narrower-than-slot callback is newly ADMITTED at a user slot', () => {
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    ce.declare('onInt', '(integer) -> number');
    // Contravariance rejects (`number ⊄ integer`); overlap admits.
    expect(ce.box(['myOp', 'onInt']).isValid).toBe(true);
  });

  it('a provably disjoint callback is rejected at a user slot', () => {
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (_ops, { engine }) => engine.number(1),
    });
    ce.declare('onStr', '(string) -> number');
    expect(ce.box(['myOp', 'onStr']).isValid).toBe(false);
  });
});

describe('R-E3 at user polytypes — domain deferred, result-side flow preserved', () => {
  it('the callback result still solves `U`; its parameters no longer solve `T`', () => {
    const ce = new ComputeEngine();
    ce.declare('apply2', '((T) -> U, T) -> U where T, U');
    const e = ce.box(['apply2', 'IsPrime', 'x']);
    expect(e.isValid).toBe(true);
    // Result-side flow (Design D clause 3, preserved): `U = boolean` from
    // `IsPrime`'s own result type.
    expect(e.type.toString()).toBe('boolean');
    // Domain deferral (R-E3, uniform): `IsPrime`'s `(number)` parameter no
    // longer binds `T`, so `x` is NOT inferred `number`. Pre-E this read
    // `number` — the one deliberate user-visible inference delta of phase E1.
    expect(ce.box('x').type.toString()).toBe('unknown');
  });
});

describe('the stamp is unchanged in mechanism (§6b)', () => {
  it('an inline literal over a tuple list is stamped and evaluates', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'CountIf',
      ['List', ['Tuple', 0, 1], ['Tuple', 2, 3]],
      ['Function', ['Equal', ['At', 'pt', 1], 0], 'pt'],
    ]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('1');
  });
});

describe('route parity', () => {
  it('the box route and the pre-boxed function route agree on the flagship rejection', () => {
    const ce = new ComputeEngine();
    ce.declare('names', 'list<string>');
    const viaBox = ce.box(['CountIf', 'names', 'IsPrime']);
    const viaFn = ce.function('CountIf', [
      ce.symbol('names'),
      ce.symbol('IsPrime'),
    ]);
    expect(viaBox.isValid).toBe(false);
    expect(viaFn.isValid).toBe(false);
  });

  it('the LaTeX parse route agrees, with the same diagnostic', () => {
    const ce = new ComputeEngine();
    ce.declare('names', 'list<string>');
    const viaParse = ce.parse(
      '\\operatorname{CountIf}(\\mathrm{names}, \\operatorname{IsPrime})'
    );
    expect(viaParse.isValid).toBe(false);
    expect(viaParse.toString()).toContain(
      'ErrorCode("incompatible-type", "(string) any -> boolean", "(number) -> boolean")'
    );
  });
});

//
// ── Phase E2: the LAZY route (`Filter`, `Map`) ──────────────────────────────
//

describe('E2 — the lazy-route gate (`canonicalCallbackOperand`)', () => {
  it('`Filter(names, IsPrime)` over `list<string>` rejects at canonicalization, same diagnostic as the eager gate', () => {
    const ce = new ComputeEngine();
    ce.declare('names', 'list<string>');
    const e = ce.box(['Filter', 'names', 'IsPrime']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain(
      'ErrorCode("incompatible-type", "(string) any -> boolean", "(number) -> boolean")'
    );
    // Parse-route parity.
    expect(
      ce.parse(
        '\\operatorname{Filter}(\\mathrm{names}, \\operatorname{IsPrime})'
      ).isValid
    ).toBe(false);
  });

  it('the KEEP table holds on the lazy route', () => {
    const ce = new ComputeEngine();
    // Messy-data broadcast: admitted, per-element at evaluation.
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
    // Union source with a narrower predicate: admitted (partial overlap).
    expect(
      ce.box(['Filter', ['List', 2, 3, { str: 'a' }, 4], 'IsPrime']).isValid
    ).toBe(true);
    // Wildcard callback.
    ce.declare('p', 'function');
    expect(ce.box(['Filter', ['List', 1, 2, 3], 'p']).isValid).toBe(true);
    // Empty source: `list<never>` elements are vacuously compatible.
    expect(ce.box(['Filter', ['List'], 'IsPrime']).evaluate().toString()).toBe(
      '[]'
    );
    // Effectful predicate at the effect-top slot.
    ce.declare('re', '(number) random -> boolean');
    expect(ce.box(['Filter', ['List', 1, 2, 3], 're']).isValid).toBe(true);
    // Evaluation parity.
    expect(
      ce.box(['Filter', ['List', 1, 2, 3, 4], 'IsPrime']).evaluate().toString()
    ).toBe('[2,3]');
  });

  it('`Map` zips check POSITIONALLY against each source (the §3 supply arrow)', () => {
    const ce = new ComputeEngine();
    ce.declare('g1', '(integer, string) -> boolean');
    ce.declare('g2', '(string, integer) -> boolean');
    ce.declare('ints', 'list<integer>');
    ce.declare('strs', 'list<string>');
    // Heterogeneous zip with a MATCHING callback: admitted.
    expect(ce.box(['Map', 'g1', 'ints', 'strs']).isValid).toBe(true);
    // Position-swapped: provably unusable at position 0 — rejected. The
    // declared unary `(T) any -> U` could never catch this (its `T` is the
    // JOIN of the sources); the per-source supply arrow does.
    const sw = ce.box(['Map', 'g2', 'ints', 'strs']);
    expect(sw.isValid).toBe(false);
    expect(sw.toString()).toContain(
      'ErrorCode("incompatible-type", "(integer, string) any -> unknown", "(string, integer) -> boolean")'
    );
    // Zip arity parity: a unary callback over two sources keeps the shipped
    // `callback-arity` diagnostic (rule 2 owns arity).
    const za = ce.box(['Map', ['Function', ['Sqrt', 'x'], 'x'], 'ints', 'strs']);
    expect(za.isValid).toBe(false);
    expect(za.toString()).toContain('callback-arity');
    // Homogeneous zip evaluation parity.
    expect(
      ce
        .box([
          'Map',
          ['Function', ['Add', 'a', 'b'], 'a', 'b'],
          ['List', 1, 2],
          ['List', 3, 4],
        ])
        .evaluate()
        .toString()
    ).toBe('[4,6]');
  });

  it('a provably non-boolean inline predicate rejects at canonicalization (Q3, lazy route)', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Filter',
      ['List', 1, 2, 3],
      ['Function', ['Add', 'k', 1], 'k'],
    ]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
  });
});

describe('E3 — user-declared slots get the static arity rejection (§12d)', () => {
  it('a DECLARED binary callback at a unary user slot rejects with `callback-arity`', () => {
    // Rule 2 at a slot with no hand-wired supply: the shipped
    // `callbackArityError`, minted from the compatibility gate with a supply
    // DERIVED from the slot's own arrow arity.
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (ops) => ops[0],
    });
    ce.declare('h', '(number, number) -> boolean');
    const e = ce.box(['myOp', 'h']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain(
      'myOp calls its callback with 1 argument (per the declared parameter list); `h` declares 2 parameters'
    );
    // The library's hand-authored wording is untouched: its canonical
    // handlers mint BEFORE validation runs.
    const f = ce.box([
      'CountIf',
      ['List', 1, 2, 3],
      ['Function', ['Add', 'p', 'q'], 'p', 'q'],
    ]);
    expect(f.toString()).toContain(
      'CountIf calls its callback with 1 argument (each element of the collection)'
    );
  });

  it('an INLINE literal too wide for a unary user slot rejects the same way', () => {
    // The mismatch has to be caught in BOTH directions. Subtyping used to
    // answer only one of them — a signature with MORE required parameters
    // than the slot's arrow was a strict SUBTYPE of it, so an inline binary
    // literal sailed past the compatibility gate, which runs only where
    // subtyping FAILED. Both halves are fixed: `isSubtype` now refuses the
    // too-many direction at a fixed-arity signature, and the arity verdict is
    // asked ahead of the subtype question either way
    // (`arrowSlotArityRejection`, `boxed-expression/validate.ts`), since a
    // slot arm with an optional or variadic tail still admits a callback
    // wider than any call it can make.
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (ops) => ops[0],
    });
    const e = ce.box(['myOp', ['Function', ['Add', 'a', 'b'], 'a', 'b']]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain(
      'myOp calls its callback with 1 argument (per the declared parameter list); `(a, b) => a + b` declares 2 parameters'
    );

    // The opposite direction, which already worked, is unchanged…
    ce.declare('myOp2', {
      signature: '(((number, number) -> number)) -> number',
      evaluate: (ops) => ops[0],
    });
    expect(
      ce.box(['myOp2', ['Function', 'a', 'a']]).toString()
    ).toContain('myOp2 calls its callback with 2 arguments');
    // …and a literal of the arity the slot supplies is still admitted, at
    // either slot.
    expect(ce.box(['myOp', ['Function', 'a', 'a']]).isValid).toBe(true);
    expect(
      ce.box(['myOp2', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).isValid
    ).toBe(true);
  });

  it('a SYMBOL holding a too-wide callback is rejected, like a literal', () => {
    // The verdict has to be asked ahead of every admission that turns on
    // `matches(param)`, not just the match-failure branch: a symbol carrying
    // an INFERRED signature reaches an earlier fast path
    // (`op.valueDefinition?.inferredType && op.type.matches(param)`), and the
    // same unsound subtype rule makes its binary type match a unary arrow, so
    // the callback was admitted there and failed at application instead.
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (ops) => ops[0],
    });
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    const e = ce.box(['myOp', 'g']);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain(
      'myOp calls its callback with 1 argument (per the declared parameter list); `g` declares 2 parameters'
    );
  });

  it('an OVERLOAD set resolves to the arm that can apply the callback', () => {
    // The arity verdict has to reach overload FILTERING, not just the final
    // validation of the arm already chosen. A match at an arrow slot is no
    // longer a proof that an arm's trial would pass
    // (`trialGuaranteedToPass`, `overload.ts`): the unsound subtype rule made
    // the unary-slot arm viable for a binary callback, and being the more
    // specific arm it WON — so the call reported an arity error even though a
    // sibling arm accepted the callback.
    const ce = new ComputeEngine();
    ce.declare('ov', {
      signature:
        '((((number) -> number)) -> number) & ((((number, number) -> number)) -> string)',
      evaluate: (ops) => ops[0],
    });
    const binary = ce.box(['ov', ['Function', ['Add', 'a', 'b'], 'a', 'b']]);
    expect(binary.isValid).toBe(true);
    expect(binary.type.toString()).toBe('string');
    const unary = ce.box(['ov', ['Function', 'a', 'a']]);
    expect(unary.isValid).toBe(true);
    expect(unary.type.toString()).toBe('number');

    // The permissive sibling arm wins the same way…
    ce.declare('ovA', {
      signature: '((((number) -> number)) -> number) & ((function) -> string)',
      evaluate: (ops) => ops[0],
    });
    expect(
      ce.box(['ovA', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).type.toString()
    ).toBe('string');

    // …and when NO arm can apply the callback, the report is still the arity
    // sentence, not two signatures printed side by side.
    ce.declare('ov2', {
      signature: '((((number) -> number)) -> number) & ((string) -> string)',
      evaluate: (ops) => ops[0],
    });
    expect(
      ce.box(['ov2', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).toString()
    ).toContain(
      'ov2 calls its callback with 1 argument (per the declared parameter list); `(a, b) => a + b` declares 2 parameters'
    );
  });

  it('a NULLARY literal is a constant callback, never an arity error', () => {
    // `["Function", 42]` ignores every argument it is applied to (the
    // historical contract in `function-utils.ts` `invoke`), which is what lets
    // a constant stand in for a predicate or generator. The user-declared slot
    // must honor that exemption exactly as the library operators do — and it
    // does so through the MINT rather than the capability test: the operand's
    // TYPE reads as zero-arity, so `armArityCapable` finds no overlap, and it
    // is `callbackArity` (`callback-arity.ts`) that reads a nullary literal as
    // accepting any supply count and declines to mint. Pinned because that
    // split is easy to "simplify" into a rejection.
    const ce = new ComputeEngine();
    ce.declare('myOp', {
      signature: '((number) -> number) -> number',
      evaluate: (ops) => ops[0],
    });
    expect(ce.box(['myOp', ['Function', 42]]).isValid).toBe(true);
    // The library equivalent, unchanged.
    expect(
      ce.box(['CountIf', ['Range', 3], ['Function', 'True']]).evaluate().toString()
    ).toBe('3');
    // A nullary SYMBOL gets no such exemption: its signature is a contract.
    ce.declare('nullarySym', '() -> number');
    expect(ce.box(['myOp', 'nullarySym']).toString()).toContain(
      'callback-arity'
    );
  });

  it('a `+` tail raises the slot arm\'s MINIMUM supply count', () => {
    // A variadic arm's range is unbounded ABOVE, but its minimum is real: a
    // `+` tail demands at least one occurrence, and those stack on top of the
    // optional parameters (`arityBounds`, `overload.ts`). Reading the arm's
    // required parameters alone reported a minimum of zero, so a callback
    // that can never be applied was judged capable.
    const ce = new ComputeEngine();
    ce.declare('slotPlus', {
      signature: '(((number+) -> number)) -> number',
      evaluate: (ops) => ops[0],
    });
    ce.declare('nullary', '() -> number');
    expect(ce.box(['slotPlus', 'nullary']).toString()).toContain(
      'slotPlus calls its callback with 1 argument (at least, per the declared parameter list); `nullary` declares 0 parameters'
    );
    // A callback that CAN take the supplied arguments is untouched.
    ce.declare('binary', '(number, number) -> number');
    expect(ce.box(['slotPlus', 'binary']).isValid).toBe(true);
  });

  it('a literal at an OPTIONAL or VARIADIC slot arm keeps its whole range', () => {
    // The verdict reads the arm's admissible range (required → optional →
    // variadic), so widening the slot widens what it accepts: an arity the
    // slot can supply is never rejected by the new check.
    const ce = new ComputeEngine();
    ce.declare('opt', {
      signature: '(((number, number?) -> number)) -> number',
      evaluate: (ops) => ops[0],
    });
    expect(ce.box(['opt', ['Function', 'a', 'a']]).isValid).toBe(true);
    expect(
      ce.box(['opt', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).isValid
    ).toBe(true);
    // Past the optional tail: no supply count applies the literal.
    expect(
      ce
        .box(['opt', ['Function', ['Add', 'a', 'b'], 'a', 'b', 'c']])
        .toString()
    ).toContain('callback-arity');

    // A VARIADIC arm has no single supply count to word a sentence around,
    // and its unbounded range never proves incapability: it declines.
    ce.declare('vari', {
      signature: '(((number*) -> number)) -> number',
      evaluate: (ops) => ops[0],
    });
    expect(
      ce.box(['vari', ['Function', ['Add', 'a', 'b'], 'a', 'b']]).isValid
    ).toBe(true);
  });
});

describe('E3 — a MONOMORPHIC overload arm stamps its ground arrow slot', () => {
  it('the resolved arm stamps exactly like the standalone signature', () => {
    // The Design D ground-`S` fallback, inherited by the arrow spelling
    // (review finding, restored in `annotateCallbacksFromContextualSolve`):
    // without it an overload arm silently stamped nothing. Ambiguous sets
    // (two slot-declaring arms at the same arity) still decline — the stamp
    // never guesses an arm.
    const ce = new ComputeEngine();
    ce.declare(
      'ov',
      '(((integer) any -> boolean, number) -> integer) & ((string) -> string)'
    );
    const e = ce.box(['ov', ['Function', ['Greater', 'n', 1], 'n'], 5]);
    expect(e.op1.toMathJson()).toEqual([
      'Function',
      ['Less', 1, 'n'],
      ['Typed', 'n', "'integer'"],
    ]);
  });
});

describe('E3 — a POLYMORPHIC overload arm declines the ground-slot stamp', () => {
  it('a ground arrow slot inside an arm with its own `where` clause stays unstamped', () => {
    // Accepted narrowing (dual review, recorded in the spec's §12d): with
    // the `callback<S>` marker gone, nothing distinguishes "stamp this
    // ground slot" from an arm variable's kin inside a polymorphic arm, so
    // the fallback declines the whole arm. No shipped signature exercises
    // this shape; a user's polytype arm keeps its literal bare.
    const ce = new ComputeEngine();
    ce.declare(
      'pov',
      '(((integer) any -> boolean, T) -> T where T) & ((string) -> string)'
    );
    const e = ce.box(['pov', ['Function', ['Greater', 'n', 1], 'n'], 5]);
    expect(e.op1.toMathJson()).toEqual(['Function', ['Less', 1, 'n'], 'n']);
  });
});

describe('E2 — inferred literal parameters are not contracts', () => {
  it('a lambda whose parameter type was INFERRED from its body is admitted', () => {
    // `l => Length(l)` infers `l: collection` from the body use — a guess
    // about intent, not an authored contract, so rule 3 must not refuse it:
    // the pinned product behavior applies it per element and lets the body
    // go inert (`Length(1)` stays symbolic). The literal's RESULT stays
    // authoritative (`k => k + 1` above still rejects on `number`).
    const ce = new ComputeEngine();
    const e = ce.box([
      'CountIf',
      ['List', 1, 2, 3],
      ['Function', ['Greater', ['Length', 'l'], 0], 'l'],
    ]);
    expect(e.isValid).toBe(true);
  });
});

describe('E2 — a destructuring-pattern parameter is judged like a bare one (review fix)', () => {
  it('inferred element types inside a pattern do not reject the callback', () => {
    // The pattern's tuple SHAPE is authored, but its element types are
    // inferred from body uses — guesses, exactly like a bare symbol's type
    // (`relaxBareParams` uses the same bareness test). Only a `Typed`
    // annotation carries contractual weight at the gate.
    const ce = new ComputeEngine();
    const e = ce.box([
      'Filter',
      ['List', ['Tuple', { str: 'a' }, { str: 'b' }]],
      // ((a, b)) => Length(a) > 0 — `a` would infer non-string-ish shapes
      // from other uses; the pattern must not become a rejection contract.
      ['Function', ['Greater', ['Length', 'a'], 0], ['Tuple', 'a', 'b']],
    ]);
    expect(e.isValid).toBe(true);
  });
});

describe('E2 — the pipe placement heuristic uses compatibility at arrow slots', () => {
  it('`xs |> Map(f)` still lowers and evaluates (regression guard)', () => {
    // The placement test for displaced arguments used strict contravariant
    // `matches`, which refused the lambda at `Map`'s honest arrow slot
    // (`(unknown) -> number` is not a SUBTYPE of the grounded
    // `(any) any -> any`) and silently produced the inert legacy-order form.
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, '[1,2,3] |> Map(n => n^2)');
    expect(r.value?.toString()).toBe('[1,4,9]');
  });
});
