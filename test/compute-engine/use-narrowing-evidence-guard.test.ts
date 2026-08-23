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
  });

  test('ONE-SHOT program: an evidence-type mismatch no longer flags statically (R1)', () => {
    // Re-read under R1 overlap admission (§4.4 of
    // `docs/plans/2026-08-22-type-handlers-on-types.md`; before R1 the
    // pre-pass flagged `k(x)` as a `static-type-error`). The static
    // pre-pass applies the TYPE EFFECT of assignments
    // (`applyAssignmentTypeEffect`, static-diagnostics.ts): `x = g()` gives
    // `x` the static type `number` plus assignment evidence, without
    // evaluating anything. A `number` evidence TYPE merely OVERLAPS an
    // `integer` parameter — not a provable mismatch — so boxing now admits
    // the call and the pre-pass, which reads diagnostics off boxing
    // errors, stays silent. Restoring a static line for this program needs
    // evidence that refutes provably — the literal-type evidence of O9 /
    // §4.3 (ROADMAP: "Epsil static evidence diagnostics lost to overlap
    // admission").
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
    ).toBe('[]');

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
    // erroring. What this test pins is the guard itself — the optional and
    // variadic slots must not narrow the assigned symbol — and that half
    // is unchanged.
    const rOpt = run('opt(True, x)');
    expect(rOpt.value?.toString()).toBe('opt("True", g())');
    expect(ce.box('x').type.toString()).toBe('number');
    const rVar = run('varfn(1, x)');
    expect(rVar.value?.toString()).toBe('varfn(1, g())');
    expect(ce.box('x').type.toString()).toBe('number');
  });

  test('a typed declaration with a concrete initializer still refuses at run time', () => {
    // Re-read under R1 overlap admission (§4.4; before R1 the pre-pass
    // flagged this statically off the initializer evidence). The pre-pass
    // runs valueless, records the evidence as a TYPE (`number`), and
    // `number` overlaps `integer` — so no static line until evidence
    // carries literal types (O9 / §4.3; ROADMAP: "Epsil static evidence
    // diagnostics lost to overlap admission"). The RUN is unchanged: by
    // the time `k(x)` boxes, `x` HOLDS 1.5, and a concrete value decides
    // exactly — the mismatch is still the same boxing-time error.
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let x: number = 1.5', 'k(x)'].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toBe('[]');
    expect(r.value?.toString()).toContain(
      'ErrorCode("incompatible-type", "integer", "number")'
    );
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
