import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// EVIDENCE BEATS REQUIREMENT (`docs/INFERENCE_ROADMAP.md`, Phase 0 verdict,
// ruled GO 2026-08-18).
//
// Use-narrowing — an argument position writing the parameter type onto an
// inferred-typed symbol operand — is the CAS reading: a use of a VALUELESS
// symbol declares what the symbol must be. A symbol that HOLDS a value has
// assignment evidence, and a use is then a requirement to CHECK against that
// evidence. Before the guard, the check was skipped in favor of the write:
// `x = g()` (a `number`) passed a `(integer) -> integer` parameter by
// narrowing `x`'s type to `integer`, the conflict surfaced only at
// evaluation, and the stored type was left contradicting the held value.

describe('use-narrowing evidence guard', () => {
  test('PROGRAM persona: a use of an ASSIGNED symbol checks, not narrows', () => {
    const ce = new ComputeEngine();
    const run = (src: string) => executeEpsil(ce, src);
    run(
      [
        'let x',
        'let f: () -> integer',
        'let g: () -> number',
        'let k: (integer) -> integer',
        'x = f()',
        'x = g()',
      ].join('\n')
    );
    expect(ce.box('x').type.toString()).toBe('number');

    const r = run('k(x)');
    // Re-read under R1 overlap admission (§4.4 of
    // `docs/plans/2026-08-22-type-handlers-on-types.md`; this pin was a
    // canonicalization-time error before). The evidence (`x` holds `g()`,
    // typed `number`) merely OVERLAPS `integer` — `g()` could well return
    // 5 — so the mismatch is not provable and boxing admits the call
    // provisionally: it stays INERT rather than erroring. A CONCRETE
    // evidence value still refuses at boxing (see the STATIC initializer
    // test below).
    expect(JSON.stringify(r.diagnostics)).toBe('[]');
    expect(r.value?.toString()).toBe('k(g())');
    // The heart of the guard is unchanged: the stored type keeps the
    // assignment evidence — the use must NOT rewrite it (pre-guard it
    // became `integer` while the symbol held a `number`-typed value; the
    // overlap admission is deferred, excluded from the inference pass).
    expect(ce.box('x').type.toString()).toBe('number');
    // The Epsil linter's stricter evidence check does not reach this
    // program: `k(x)` is submitted as its OWN program, which contains no
    // assignment, so its pre-pass records no assignment evidence for `x`
    // and the held (non-concrete) value `g()` decides by overlap, as
    // engine semantics say it must. The stricter verdict applies only to a
    // call the pre-pass sees in the same program as the assignment — see
    // the ONE-SHOT test below.
  });

  test('ONE-SHOT program: an evidence-type mismatch flags statically (linter is stricter than the engine)', () => {
    // RULED 2026-08-23 (path 2 of the ROADMAP entry "Epsil static evidence
    // diagnostics lost to overlap admission"): the Epsil static pre-pass is
    // a LINTER and is deliberately stricter than engine admission, the way
    // TypeScript flags code that would run. The pre-pass applies the TYPE
    // EFFECT of assignments (`applyAssignmentTypeEffect`,
    // static-diagnostics.ts): `x = g()` gives `x` the static type `number`
    // plus assignment evidence, without evaluating anything. A `number`
    // evidence type does not FIT an `integer` parameter, so the call is
    // refused at boxing and the pre-pass — which reads its diagnostics off
    // boxing errors — reports a `static-type-error`, even though `g()`
    // could well return 5 and the call would then succeed. What the program
    // as written does is assign a `number` where an `integer` is required.
    //
    // This is lint-only: the assignment evidence exists only while a
    // pre-pass runs, so the EXECUTED program is unaffected — see the
    // "lint-only" test below, where the same shape flags statically and
    // still evaluates.
    const one = (lines: string[]) =>
      executeEpsil(new ComputeEngine(), lines.join('\n')).diagnostics;
    expect(
      JSON.stringify(
        one([
          'let x',
          'let f: () -> integer',
          'let g: () -> number',
          'let k: (integer) -> integer',
          'x = f()',
          'x = g()',
          'k(x)',
        ])
      )
    ).toContain('static-type-error');
    // The possibly-incompatible refinement (user-ruled 2026-08-23): a
    // symbolic-evidence overlap mismatch carries a suggestion note to
    // annotate the declaration; a DEFINITE mismatch (disjoint literal
    // evidence, pinned elsewhere in this file) does not.
    expect(
      JSON.stringify(
        one([
          'let x',
          'let f: () -> integer',
          'let g: () -> number',
          'let k: (integer) -> integer',
          'x = f()',
          'x = g()',
          'k(x)',
        ])
      )
    ).toContain('annotate the declaration');

    // Assignment is LAST-WRITE-WINS: the reverse order is a correct program
    // and must stay clean (a join-of-assignments model would wrongly flag it).
    expect(
      one([
        'let x',
        'let f: () -> integer',
        'let g: () -> number',
        'let k: (integer) -> integer',
        'x = g()',
        'x = f()',
        'k(x)',
      ])
    ).toEqual([]);

    // The evidence recorded is the RAW right-hand-side type: `v = 1 - i`
    // stores widened `number`, which `⊄ complex` — but the raw
    // `finite_complex` fits, so no false static error.
    expect(
      one(['let Q: (complex) -> complex', 'let v = 1 - i', 'Q(v)'])
    ).toEqual([]);

    // A valueless symbol keeps the CAS declaration reading in one-shot
    // programs too.
    expect(one(['let n', 'let k: (integer) -> integer', 'k(n)'])).toEqual([]);
  });

  test('the stricter evidence verdict is LINT-ONLY: the program still runs', () => {
    // The stricter check reads `ce._staticAssignmentEvidence`, which is
    // non-undefined only while the static pre-pass runs, so it cannot
    // change what the program computes. Here `y` is declared `number` and
    // `x = y` therefore records `number` as `x`'s assignment evidence,
    // which does not fit `k`'s `integer` parameter: the pre-pass flags the
    // call. Executing the same program then evaluates `k(x)` to 6, because
    // by the time the call boxes during execution `x` HOLDS 5 and a
    // concrete value decides admission exactly.
    const r = executeEpsil(
      new ComputeEngine(),
      [
        'k(n: integer) = n + 1',
        'let y: number',
        'y = 5',
        'let x',
        'x = y',
        'k(x)',
      ].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    expect(r.value?.toString()).toBe('6');
  });

  test('OVERLOADS: evidence fitting ANY arm stays clean', () => {
    // The evidence check lives in `overlapAdmission`, which each arm's own
    // validation calls, so the verdict is per-arm: an argument refused
    // under one arm can still be admitted by another. `number` evidence
    // fits the `(number) -> number` arm, so the call is clean even though
    // the `(integer) -> integer` arm refuses it.
    const one = (lines: string[]) =>
      executeEpsil(new ComputeEngine(), lines.join('\n')).diagnostics;
    expect(
      one([
        'let p: ((integer) -> integer) & ((number) -> number)',
        'let g: () -> number',
        'let x',
        'x = g()',
        'p(x)',
      ])
    ).toEqual([]);

    // When NO arm fits, the call flags and the error names the union of the
    // arms' parameter types.
    expect(
      JSON.stringify(
        one([
          'let p: ((integer) -> integer) & ((string) -> string)',
          'let g: () -> number',
          'let x',
          'x = g()',
          'p(x)',
        ])
      )
    ).toContain('static-type-error');
  });

  test('CAS persona: a use of a VALUELESS symbol still narrows (declaration reading)', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(integer) -> integer');
    ce.box(['k', 'n']);
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  test('the documented inference example is unchanged', () => {
    // Argument positions infer the type of an unknown symbol, and later uses
    // refine it.
    const ce = new ComputeEngine();
    ce.declare('n', 'unknown');
    ce.declare('f', '(number) -> number');
    ce.box(['f', 'n']);
    expect(ce.box('n').type.toString()).toBe('number');
    ce.declare('g', '(integer) -> number');
    ce.box(['g', 'n']);
    expect(ce.box('n').type.toString()).toBe('integer');
  });

  test('WIDENED evidence: the held VALUE decides, not the widened symbol type', () => {
    // Assignment widening stores `v := Complex(1,-1)` under the symbol type
    // `number`, and `number ⊄ complex` — but the held value's own type fits
    // a `complex` parameter, so the use is admitted (with no type write).
    // Pre-guard this worked by silently narrowing `v` to `complex`;
    // post-guard it works by checking the evidence itself.
    const ce = new ComputeEngine();
    ce.declare('Q', '(complex) -> complex');
    ce.assign('v', ce.box(['Complex', 1, -1]));
    expect(ce.box('v').type.toString()).toBe('number');
    const call = ce.box(['Q', 'v']);
    expect(call.isValid).toBe(true);
    // The post-validation inference pass then sharpens the widened `number`
    // to `complex` — a write LICENSED by the evidence (admission required
    // `held.type.matches(param)`, so the stored type remains an
    // over-approximation of the held value; contrast the PROGRAM-persona
    // test above, where the inconsistent write is refused and the stored
    // type stays put).
    expect(ce.box('v').type.toString()).toBe('complex');
  });

  test('an assigned symbol whose type already fits is admitted without a write (pre-existing matches branch)', () => {
    const ce = new ComputeEngine();
    const run = (src: string) => executeEpsil(ce, src);
    run(
      [
        'let y',
        'let f: () -> integer',
        'let k: (number) -> number',
        'y = f()',
      ].join('\n')
    );
    expect(ce.box('y').type.toString()).toBe('integer');
    const r = run('k(y)');
    expect(JSON.stringify(r.diagnostics)).toBe('[]');
    // No widening either: the evidence stands as-is. NOTE: this admission
    // comes from the PRE-EXISTING `matches(param)` branch (`integer` fits
    // `number` directly) — the evidence guard only engages when the
    // parameter is STRICTLY below the stored type, so this pins the
    // surrounding behavior the guard must not disturb, not the guard
    // itself.
    expect(ce.box('y').type.toString()).toBe('integer');
  });

  test('optional and variadic slots apply the same evidence guard', () => {
    // The guard originally lived only in the required-parameter loop; the
    // optional and variadic loops narrowed unconditionally, so an assigned
    // symbol could still be silently rewritten through those slots.
    const ce = new ComputeEngine();
    const run = (src: string) => executeEpsil(ce, src);
    run(
      [
        'let x',
        'let g: () -> number',
        'let opt: (boolean, integer?) -> integer',
        'let varfn: (integer+) -> integer',
        'x = g()',
      ].join('\n')
    );
    // Re-read under R1 overlap admission (§4.4): the `number` evidence
    // OVERLAPS `integer`, so both calls now box and stay inert instead of
    // erroring. The Epsil linter's stricter evidence check does not reach
    // them either — each call is submitted as its own program, containing
    // no assignment, so its pre-pass records no assignment evidence for
    // `x`. What this test pins is the guard itself — the optional and
    // variadic slots must not narrow the assigned symbol — and that half
    // is unchanged.
    const rOpt = run('opt(True, x)');
    expect(rOpt.value?.toString()).toBe('opt("True", g())');
    expect(ce.box('x').type.toString()).toBe('number');
    const rVar = run('varfn(1, x)');
    expect(rVar.value?.toString()).toBe('varfn(1, g())');
    expect(ce.box('x').type.toString()).toBe('number');
  });

  test('a typed declaration with a concrete initializer flags statically again', () => {
    // Restored 2026-08-23 by literal-type evidence (path 1 of the ROADMAP
    // entry "Epsil static evidence diagnostics lost to overlap
    // admission"): the pre-pass records the concrete initializer's
    // handler-visible literal type (`1.5`, not the widened `number`), and
    // `1.5` provably cannot inhabit `integer`, so overlap admission
    // refuses at boxing and the pre-pass mints the static line R1 had
    // silenced. The RUN is unchanged: by the time `k(x)` boxes during
    // execution, `x` HOLDS 1.5, and a concrete value decides exactly.
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let x: number = 1.5', 'k(x)'].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    // A DEFINITE mismatch — the literal evidence `1.5` is provably
    // disjoint from `integer` — carries NO annotation suggestion: no
    // annotation rescues it (contrast the possibly-incompatible note
    // pinned in the ONE-SHOT symbolic test above).
    expect(JSON.stringify(r.diagnostics)).not.toContain(
      'annotate the declaration'
    );
    expect(r.value?.toString()).toContain(
      'ErrorCode("incompatible-type", "integer", "number")'
    );
  });

  test('an UNTYPED concrete literal initializer flags statically too', () => {
    // The same restoration through the untyped arm: `let x = 1.5` records
    // the literal evidence even though `x`'s inferred type stays the
    // widened `real` ("more likely, not broadest").
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let x = 1.5', 'k(x)'].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
  });

  test('an integer-valued literal initializer stays admitted', () => {
    // The exact evidence cuts both ways: `2` inhabits `integer`, so the
    // program is clean and runs.
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let x = 2', 'k(x)'].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toBe('[]');
    expect(r.value?.toString()).toBe('k(2)');
  });

  test('STATIC: a destructuring assignment distributes the effect per leaf', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let (a, b) = (1, "s")', 'k(b)'].join(
        '\n'
      )
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    // The compatible leaf stays usable.
    const r2 = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let (a, b) = (1, "s")', 'k(a)'].join(
        '\n'
      )
    );
    expect(JSON.stringify(r2.diagnostics)).toBe('[]');
  });
});
