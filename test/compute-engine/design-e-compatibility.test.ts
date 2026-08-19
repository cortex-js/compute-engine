import { ComputeEngine } from '../../src/compute-engine';

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
