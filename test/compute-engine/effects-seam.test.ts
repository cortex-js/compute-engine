import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { ComputeEngine } from '../../src/compute-engine';

/**
 * # The `Function`-literal construction seam — guard test
 *
 * Stage 2 of the effects model (`docs/EFFECTS-MODEL.md`, "Inference") requires
 * ONE choke point:
 *
 * > The effect walk runs where a `Function` literal's signature type is
 * > constructed. […] Stage 2 must route them through a single shared
 * > construction seam that performs the walk, plus a **guard test that fails
 * > if a construction site bypasses it** — a missed site silently reintroduces
 * > the inline-callback gap.
 *
 * The seam is `src/compute-engine/boxed-expression/effects-inference.ts`.
 *
 * ## The mechanism, and why this one
 *
 * A construction site builds an *expression*; the arrow only ever materializes
 * on `.type`. So the guard has two halves:
 *
 * 1. **Behavioral (the teeth).** A route matrix: for every way the engine
 *    produces a `Function` literal — `ce.parse`, `ce.box`, `ce.function`,
 *    `ce._fn` (canonical, non-canonical, structural), `ce.expr`, and the
 *    internal constructions in `library/calculus.ts`, `library/collections.ts`,
 *    `library/core.ts`, `engine-declarations.ts` — the resulting literal's type
 *    must carry the effect specifier the walk infers. A site that built an
 *    arrow by hand would show up here as a missing specifier.
 * 2. **Structural (the review gate).** The set of `src/` files importing the
 *    seam is pinned, and the one delegating call site is pinned to its exact
 *    text. Adding a second builder — or re-implementing the walk — cannot land
 *    without editing this test, which is the review the spec asks for.
 *
 * A pure regex hunt for "something that looks like an arrow being built" was
 * rejected: the fingerprint (`functionLiteralParameters` + `parseType`) already
 * false-positives on `engine-declarations.ts`, so it would be brittle in the
 * expensive direction — noisy, then disabled.
 */

const SRC = join(__dirname, '../../src');

/** Every `.ts` file under `src/`, as `[repoRelativePath, contents]`. */
function sourceFiles(): [string, string][] {
  const out: [string, string][] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (entry.endsWith('.ts'))
        out.push([p.slice(SRC.length + 1), readFileSync(p, 'utf-8')]);
    }
  };
  walk(SRC);
  return out;
}

describe('The Function-literal construction seam is the only builder', () => {
  it('the seam is imported only by the reviewed consumers', () => {
    // Adding a consumer is legitimate — but it must be reviewed, because a
    // consumer that builds an arrow ITSELF (rather than delegating) is the
    // bypass this whole seam exists to prevent.
    const ALLOWED = [
      'compute-engine/boxed-expression/boxed-function.ts',
      'compute-engine/boxed-expression/boxed-operator-definition.ts',
      // (The runtime effect channel, `effects-of.ts`, no longer appears here:
      // the seam re-exported `signatureEffects` for it, and since item 142 the
      // dependency runs the other way — the seam reads the channel's shared
      // `effectiveDischarge` so both channels apply ONE discharge rule. It now
      // reads `signatureEffects` from `common/type/utils.ts`, where it is
      // defined; it still never builds an arrow.)
      // The value-definition constructor: it applies the per-axis declared/
      // inferred split (`matchesDeclaredTypeAxes`) to the value-vs-type
      // compatibility check. It READS a stored literal's arrow; it never
      // builds one.
      'compute-engine/boxed-expression/boxed-value-definition.ts',
      // Argument validation's placeholder-signature reconciliation
      // (`admitsPlaceholderSignature`): a function-typed operand whose
      // INFERRED arrow carries `unknown` slots adopts the expected
      // parameter's slots before the admission check (the placeholder
      // ruling, 2026-08-15 — previously this admission rode on the
      // erroneous `any <: unknown` edge, removed 2026-08-17). It READS the
      // operand's arrow through `refineDeclaredPlaceholders`; it never
      // builds one.
      'compute-engine/boxed-expression/validate.ts',
      'compute-engine/engine-declarations.ts',
      // The protocol dispatcher's DERIVED effect set: a function requirement
      // with a bare effect specifier imposes no bound, so the dispatcher's
      // effects are the union of the inferred effects of the registered
      // conforming implementations (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B,
      // "Changing a field is an effect"). It RUNS the walk over each
      // conformer's stored literal; it builds no arrow of its own.
      'compute-engine/engine-protocols.ts',
      'compute-engine/library/core.ts',
      // Clause accumulation enforces the default-`!scope` ceiling for the
      // multi-clause route: a clause set installs an `evaluate` DISPATCH
      // function with an already-unioned effect row presented as author-stated,
      // so the operator-definition constructor's walk-and-gate never sees a
      // clause body and `defineFunctionClause` has to run the walk itself. It
      // RUNS the walk over the incoming clause literal to read `escapingWrite`;
      // every arrow it handles comes from that literal's own `.type`, so it
      // builds none.
      'compute-engine/multi-clause.ts',
    ].sort();

    const importers = sourceFiles()
      .filter(
        ([path, src]) =>
          !path.endsWith('boxed-expression/effects-inference.ts') &&
          /from\s+'[^']*effects-inference\.js'/.test(src)
      )
      .map(([path]) => path.split('\\').join('/'))
      .sort();

    expect(importers).toEqual(ALLOWED);
  });

  it('`type()` delegates the Function case verbatim, and builds no arrow', () => {
    const src = sourceFiles().find(([p]) =>
      p.endsWith('boxed-expression/boxed-function.ts')
    )![1];

    expect(src).toContain(
      "if (expr.operator === 'Function') return functionLiteralSignatureType(expr);"
    );
    // The shape accessors are the raw material of an arrow. `boxed-function.ts`
    // must not touch them: it delegates.
    expect(src).not.toMatch(
      /functionLiteralParameters|functionLiteralReturnType/
    );
  });

  it('the definition route runs the walk rather than its own', () => {
    // `boxed-operator-definition.ts` assembles a DEFINITION signature from a
    // lambda body (`(unknown, …) -> bodyType`). That is not the literal's arrow
    // — the effect set is stamped onto it by `_setEffects` — but it must get
    // that set from the seam, never from a private re-implementation.
    const src = sourceFiles().find(([p]) =>
      p.endsWith('boxed-expression/boxed-operator-definition.ts')
    )![1];
    expect(src).toContain('inferFunctionLiteralEffects(');
    expect(src).not.toMatch(/function inferLambdaFlags/);
  });
});

/** The effect specifier on a literal's arrow, or `''` when the arrow is pure. */
function specifier(t: string): string {
  const m = /\)\s*([a-z_ ]*?)\s*->/.exec(t);
  return m ? m[1] : `NO ARROW in "${t}"`;
}

describe('Every Function-literal construction route runs the walk', () => {
  // Each route produces the literal `(x) ↦ Random()`; the arrow must carry
  // `random`. A construction site that assembled its own signature would land
  // here with an empty specifier.
  const RANDOM_BODY = ['Random'];

  it('ce.box', () => {
    const ce = new ComputeEngine();
    expect(
      specifier(ce.box(['Function', RANDOM_BODY, 'x']).type.toString())
    ).toBe('random');
  });

  it('ce.parse', () => {
    const ce = new ComputeEngine();
    expect(
      specifier(ce.parse('x \\mapsto \\operatorname{Random}()').type.toString())
    ).toBe('random');
  });

  it('ce.expr', () => {
    const ce = new ComputeEngine();
    expect(
      specifier(ce.expr(['Function', RANDOM_BODY, 'x']).type.toString())
    ).toBe('random');
  });

  it('ce.function (canonical)', () => {
    const ce = new ComputeEngine();
    const literal = ce.function('Function', [
      ce.box(RANDOM_BODY),
      ce.symbol('x'),
    ]);
    expect(specifier(literal.type.toString())).toBe('random');
  });

  it('ce.function (structural)', () => {
    const ce = new ComputeEngine();
    const literal = ce.function(
      'Function',
      [ce.box(RANDOM_BODY), ce.symbol('x')],
      { structural: true }
    );
    expect(specifier(literal.type.toString())).toBe('random');
  });

  it('ce._fn (non-canonical)', () => {
    const ce = new ComputeEngine();
    const literal = ce._fn('Function', [ce.box(RANDOM_BODY), ce.symbol('x')], {
      canonical: false,
    });
    expect(specifier(literal.type.toString())).toBe('random');
  });

  it('an inline callback operand (library/collections.ts)', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Map',
      ['List', 1, 2, 3],
      ['Function', RANDOM_BODY, 'x'],
    ]);
    expect(specifier(e.op2.type.toString())).toBe('random');
  });

  it('a literal SYNTHESIZED by an operator canonicalization (library/calculus.ts)', () => {
    const ce = new ComputeEngine();
    // `Integrate` wraps a bare expression operand into a `Function` literal
    // (`ce.expr(['Function', f, variable])`) — an internal construction site
    // that never sees the box/parse routes.
    const e = ce.box(['Integrate', ['Random'], 'x']);
    const literal = e.ops.find((x) => x.operator === 'Function');
    expect(literal).toBeDefined();
    expect(specifier(literal!.type.toString())).toBe('random');
  });

  it('the definition route (engine-declarations.ts)', () => {
    const ce = new ComputeEngine();
    ce.assign('seam9x', ce.box(['Function', RANDOM_BODY, 'x']));
    const def = ce.lookupDefinition('seam9x')!['operator'];
    expect(specifier(def.signature.toString())).toBe('random');
  });

  it('the Assign-operator route (library/core.ts)', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'seam9y', ['Function', RANDOM_BODY, 'x']]).evaluate();
    const def = ce.lookupDefinition('seam9y')!['operator'];
    expect(specifier(def.signature.toString())).toBe('random');
  });
});
