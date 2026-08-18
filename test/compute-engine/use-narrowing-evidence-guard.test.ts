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
    // The mismatch is a CANONICALIZATION-time error — the Epsil static pass
    // reports it, and the diagnostic names the SYMBOL, not a substituted
    // value.
    expect(JSON.stringify(r.diagnostics)).toContain(
      'expected `integer`, got `number` at `x`'
    );
    expect(r.value?.toString()).toContain(
      'ErrorCode("incompatible-type", "integer", "number")'
    );
    // The stored type keeps the assignment evidence — the use must NOT
    // rewrite it (pre-guard it became `integer` while the symbol held a
    // `number`-typed value).
    expect(ce.box('x').type.toString()).toBe('number');
  });

  test('ONE-SHOT program: the mismatch is a STATIC diagnostic, before anything runs', () => {
    // The static pre-pass applies the TYPE EFFECT of top-level declarations
    // and assignments (`applyAssignmentTypeEffect`, static-diagnostics.ts):
    // `let f: () -> integer` installs the contract, `x = g()` gives `x` the
    // static type `number` plus assignment evidence — all without evaluating
    // anything — so `k(x)` fails in the pass itself.
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
    // `doc/08-guide-types.md` §Type Inference: argument positions infer the
    // type of an unknown symbol, and later uses refine it.
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
    const rOpt = run('opt(True, x)');
    expect(rOpt.value?.toString()).toContain('incompatible-type');
    expect(ce.box('x').type.toString()).toBe('number');
    const rVar = run('varfn(1, x)');
    expect(rVar.value?.toString()).toContain('incompatible-type');
    expect(ce.box('x').type.toString()).toBe('number');
  });

  test('STATIC: a typed declaration contributes its initializer as evidence', () => {
    // `let x: number = 1.5` — the contract is `number`, which merely
    // OVERLAPS an `integer` parameter, so without the initializer evidence
    // the free-variable un-rejection called the mismatch provisional and
    // the pre-pass stayed silent.
    const r = executeEpsil(
      new ComputeEngine(),
      ['let k: (integer) -> integer', 'let x: number = 1.5', 'k(x)'].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
  });

  test('STATIC: a destructuring assignment distributes the effect per leaf', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      [
        'let k: (integer) -> integer',
        'let (a, b) = (1, "s")',
        'k(b)',
      ].join('\n')
    );
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    // The compatible leaf stays usable.
    const r2 = executeEpsil(
      new ComputeEngine(),
      [
        'let k: (integer) -> integer',
        'let (a, b) = (1, "s")',
        'k(a)',
      ].join('\n')
    );
    expect(JSON.stringify(r2.diagnostics)).toBe('[]');
  });
});
