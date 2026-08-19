import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * # Design E — compatibility admission at arrow-typed callback slots
 *
 * Phase E1 acceptance
 * (`docs/plans/2026-08-18-compatibility-admission-callbacks.md` §13):
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
    // `(finite_integer) any -> boolean`: NOT a contravariant subtype, but the
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
