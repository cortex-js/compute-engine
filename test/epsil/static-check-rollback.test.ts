import { ComputeEngine } from '../../src/compute-engine';
import { parseSource } from '../../src/cli/check';
import { staticDiagnostics } from '../../src/epsil/static-diagnostics';
import { isValueDef } from '../../src/compute-engine/boxed-expression/utils';

//
// The static checking pass runs under an inference ROLLBACK FRAME (phase 2b
// of `docs/plans/2026-08-13-inference-tx-design.md`): a
// checked-but-never-run program must leave the engine exactly as it found
// it — including the type inference the pass's pushed scope never shielded
// (writes onto pre-existing outer definitions) and the forward-reference
// registry (whose previous snapshot-based rollback had a one-shot defect:
// its restore re-installed the snapshot's own Set objects, so a second
// rollback restored already-mutated state).
//

function check(ce: ComputeEngine, source: string) {
  const { ast, diagnostics } = parseSource(source, undefined, ce);
  expect(diagnostics.filter((d) => d.severity === 'error')).toHaveLength(0);
  return staticDiagnostics(ce, ast!, source);
}

describe('STATIC CHECK — engine state rolls back', () => {
  test('inference onto a pre-existing outer definition is undone', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    const def = ce.lookupDefinition('u')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const provenanceBefore = def.value._typeProvenance?.slice() ?? [];

    check(ce, 'let z = u + 1\nz');

    expect(ce.lookupDefinition('u')).toBe(def);
    expect(def.value.type.toString()).toBe('unknown');
    const provenanceAfter = def.value._typeProvenance ?? [];
    expect(provenanceAfter.length).toBe(provenanceBefore.length);
    // No bindings leak from the checked program.
    expect(ce.lookupDefinition('z')).toBeUndefined();
  });

  test('a program that runs the devolve repair leaves the builtin binding intact', () => {
    const ce = new ComputeEngine();
    // `N + 1` uses the standard-library operator `N` as a bare operand: the
    // devolve repair shadows it during checking. The shadow is a frame
    // declaration and must roll back with everything else.
    const diagnostics = check(ce, 'let M = N + 1\nM');
    expect(diagnostics).toHaveLength(0);
    const nDef = ce.lookupDefinition('N');
    expect(nDef !== undefined && 'operator' in nDef).toBe(true);
    expect(ce.lookupDefinition('M')).toBeUndefined();
  });

  test('two passes over one engine agree (the one-shot registry defect)', () => {
    const ce = new ComputeEngine();
    // A forward-referencing program: checking it installs a definition that
    // registers in the forward-reference registry, and the rollback must
    // restore the registry EXACTLY — twice.
    const program = [
      'function g(t) { 2 * a(t) }',
      'function a(t) { t + 1 }',
      'g(1)',
    ].join('\n');
    const first = check(ce, program);
    const second = check(ce, program);
    expect(second).toEqual(first);
    expect(ce.lookupDefinition('g')).toBeUndefined();
    expect(ce.lookupDefinition('a')).toBeUndefined();
  });

  test('the recursion-knot retype of a pre-existing inferred binding is undone', () => {
    // `DefineFunction`/`Assign` canonicalization pre-declares the target as
    // function-typed BEFORE canonicalizing the body (the recursion knot,
    // `library/core.ts`) — a direct type write that can land on a
    // PRE-EXISTING inferred binding from an enclosing scope. Checking a
    // program that defines `f` must not leave a session's auto-declared `f`
    // retyped `function`.
    const ce = new ComputeEngine();
    ce.parse('f + 1').evaluate(); // auto-declares f, inferred number
    const def = ce.lookupDefinition('f')!;
    if (!isValueDef(def)) throw new Error('expected a value definition');
    const typeBefore = def.value.type.toString();
    expect(def.value.inferredType).toBe(true);

    check(ce, 'function f(x) { x + 1 }\nf(2)');
    check(ce, 'f = x |-> x + 1\nf(2)');

    expect(ce.lookupDefinition('f')).toBe(def);
    expect(def.value.type.toString()).toBe(typeBefore);
  });

  test('route parity after a checked program: box, ce.function and parse agree', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'unknown');
    const def = ce.lookupDefinition('u')!;

    check(ce, 'let z = u + 1\nz');

    // The checked program left no trace, so all three construction routes
    // resolve `u` to the SAME pre-pass definition and agree structurally.
    const viaBox = ce.box(['Add', 'u', 1]);
    const viaFunction = ce.function('Add', [ce.box('u'), ce.box(1)]);
    const viaParse = ce.parse('u + 1');
    expect(viaBox.isSame(viaFunction)).toBe(true);
    expect(viaBox.isSame(viaParse)).toBe(true);
    expect(ce.lookupDefinition('u')).toBe(def);
  });
});
