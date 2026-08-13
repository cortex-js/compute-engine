import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The inference-provenance note (`provenanceNote` in
// `src/epsil/signature-notes.ts`): an `incompatible-type` static diagnostic
// whose faulted operand is a bare symbol names the SITE that committed the
// symbol's type — the second half of a two-site type conflict. The bare
// message shows only the failing use; the note shows where the conflicting
// type came from (`_typeProvenance`, see
// docs/plans/2026-08-13-inference-provenance-journal.md).
//
// Resolution is BINDING-ACCURATE (user-ruled 2026-08-13, option b): the
// engine attaches the faulted operand itself as the error's site operand, so
// the note reads provenance off the operand's own binding — scope-correct
// even for a parameter or local whose scope is gone at diagnostic time, and
// immune to a same-named outer symbol shadowing it.
//

function staticDiagnosticsOf(source: string) {
  const { diagnostics } = executeEpsil(new ComputeEngine(), source);
  return diagnostics.filter((d) => d.message[0] === 'static-type-error');
}

describe('EPSIL PROVENANCE NOTE — two-site incompatible-type diagnostics', () => {
  test('top level: a boolean-inferred symbol used numerically names the inferring site', () => {
    const diagnostics = staticDiagnosticsOf(
      ['let b = p && q', 'let y = p + 1', 'y'].join('\n')
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message[1]).toBe(
      'expected `number`, got `boolean` at `p`'
    );
    const notes = (diagnostics[0].notes ?? []).map((n) => n.message);
    expect(notes).toContain(
      '`p` was inferred to have type `boolean` from its use in `p && q`'
    );
  });

  test('parameter shadowing a same-named global: the note names the PARAMETER’s own evidence, not the global’s', () => {
    // Global `p` is inferred boolean from `p && q`; the lambda's parameter
    // `p` is a distinct binding, inferred boolean from `p && r` in the body.
    // The fault is on the parameter, so the note must cite `p && r` — citing
    // `p && q` would be the ambient-scope misattribution this route exists
    // to prevent.
    const diagnostics = staticDiagnosticsOf(
      [
        'let b = p && q',
        'let f = p |-> do { let c = p && r; p + 1 }',
        'f',
      ].join('\n')
    );
    const notes = diagnostics.flatMap((d) =>
      (d.notes ?? []).map((n) => n.message)
    );
    expect(notes).toContain(
      '`p` was inferred to have type `boolean` from its use in `p && r`'
    );
    expect(notes).not.toContain(
      '`p` was inferred to have type `boolean` from its use in `p && q`'
    );
  });

  test('parameter with no same-named global: the note is minted from the (scope-dead) parameter binding', () => {
    const diagnostics = staticDiagnosticsOf(
      ['let g = m |-> do { let c = m && r; m + 1 }', 'g'].join('\n')
    );
    const notes = diagnostics.flatMap((d) =>
      (d.notes ?? []).map((n) => n.message)
    );
    expect(notes).toContain(
      '`m` was inferred to have type `boolean` from its use in `m && r`'
    );
  });

  test('a declared symbol gets no provenance note (nothing was inferred)', () => {
    const diagnostics = staticDiagnosticsOf(
      ['let p: boolean = true', 'let y = p + 1', 'y'].join('\n')
    );
    for (const d of diagnostics)
      for (const n of d.notes ?? [])
        expect(n.message).not.toContain('was inferred');
  });
});
