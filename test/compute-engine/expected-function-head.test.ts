import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// A symbol whose DECLARED type is a concrete non-function, applied as a
// function, is a definite `expected-function` error (2026-08-18). It used
// to stay inert typed `unknown` — `Pi(2)` and `Nothing()` silently absorbed
// what is almost always a syntax slip. The engine itself never generates
// such applications (verified); they only arrive from authored input.

describe('expected-function for non-callable declared heads', () => {
  test('engine constants applied as functions error', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Pi', 2]).toString()).toContain(
      'ErrorCode("expected-function", "Pi"'
    );
    expect(ce.box(['Nothing']).toString()).toContain(
      'ErrorCode("expected-function", "Nothing"'
    );
  });

  test('a number-declared variable applied errors; callable and open heads stay untouched', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'number');
    expect(ce.box(['n', 3]).isValid).toBe(false);
    // Undeclared head: stays inert (may be defined later).
    expect(ce.box(['g', 1]).isValid).toBe(true);
    expect(ce.box(['g', 1]).toString()).toBe('g(1)');
    // Function-typed head: applies normally.
    ce.declare('h', '(number) -> number');
    expect(ce.box(['h', 1]).isValid).toBe(true);
    // `any`/`unknown`-typed heads could still be functions: inert.
    ce.declare('u', 'unknown');
    expect(ce.box(['u', 1]).isValid).toBe(true);
    ce.declare('w', 'any');
    expect(ce.box(['w', 1]).isValid).toBe(true);
    // INFERRED types are guesses, owned by the devolve/repair machinery.
    const ce2 = new ComputeEngine();
    ce2.assign('m', 5); // m: integer, inferred
    expect(ce2.box(['m', 1]).isValid).toBe(true);
  });

  test('applicable non-signature heads stay untouched: collections and mixed unions', () => {
    // Tycho item 173: a collection-typed head applied is a legal
    // APPLICATION (indexing/selection semantics) — and field adjunction
    // applies a set constant (`Q(\sqrt{2})` = RationalNumbers applied).
    const ce = new ComputeEngine();
    ce.declare('S', 'set<number>');
    ce.declare('B', 'indexed_collection');
    expect(ce.box(['S', 'B']).operator).toBe('S');
    expect(ce.box(['S', 'B']).isValid).toBe(true);
    // A MIXED callable union keeps its latent callable arm.
    ce.declare('mix', '((integer) -> integer) | number');
    expect(ce.box(['mix', 1]).isValid).toBe(true);
    // A MIXED collection/scalar union could still hold an applicable
    // collection at run time — the guard uses `couldMatch`, not `matches`,
    // so the union's collection arm keeps the head applicable.
    ce.declare('cmix', 'set<number> | number');
    expect(ce.box(['cmix', 1]).isValid).toBe(true);
    // A broadcastable head is collection-capable for the same reason.
    ce.declare('br', 'broadcastable<number>');
    expect(ce.box(['br', 1]).isValid).toBe(true);
    // Control: a PURE scalar union has no callable or collection arm and
    // still errors.
    ce.declare('smix', 'integer | boolean');
    expect(ce.box(['smix', 1]).isValid).toBe(false);
  });

  test('a head declared exactly `value` errors: no positive collection evidence', () => {
    // `value` overlaps `collection<any>` only because it is the widest value
    // type; it excludes functions from the lattice, so applying a
    // `value`-declared symbol can never become a meaningful CALL. Unlike the
    // committed collection heads above, the vacuous overlap is no evidence
    // for the indexing/adjunction reading, so the guard fires. (The LaTeX
    // route reads the same juxtaposition as multiplication instead — see the
    // wide-type arms in `invisible-operator.ts`.)
    const ce = new ComputeEngine();
    ce.declare('a', 'value');
    const app = ce.box(['a', ['Subtract', 1, 'a']]);
    expect(app.isValid).toBe(false);
    expect(app.toString()).toContain('ErrorCode("expected-function", "a"');
    // Epsil route: `a(1-a)` is call syntax, so the program is diagnosed
    // statically rather than staying an inert application.
    const r = executeEpsil(new ComputeEngine(), 'a: value; a(1-a)');
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    expect(JSON.stringify(r.diagnostics)).toContain('expected-function');
  });

  test('the Epsil static pre-pass reports it before anything runs', () => {
    const r = executeEpsil(new ComputeEngine(), 'Pi(2)');
    expect(JSON.stringify(r.diagnostics)).toContain('static-type-error');
    expect(JSON.stringify(r.diagnostics)).toContain('expected-function');
  });

  test('non-strict engines skip the guard, like all application-time validation', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    ce.declare('n', 'number');
    expect(ce.box(['n', 1]).isValid).toBe(true);
    expect(ce.box(['Pi', 2]).isValid).toBe(true);
  });

  test('two heads with the same declared type keep separate diagnostics', () => {
    // The dedup key is the SITE-LESS error description, so it must carry the
    // head name from the payload: `Pi` and `ExponentialE` are both
    // `real`, and a type-only description would collapse the two
    // mistakes into one diagnostic.
    const r = executeEpsil(new ComputeEngine(), 'Pi(2)\nExponentialE(3)');
    const statics = (r.diagnostics ?? []).filter(
      (d: any) => d.message?.[0] === 'static-type-error'
    );
    expect(statics).toHaveLength(2);
    expect(JSON.stringify(statics)).toContain('Pi');
    expect(JSON.stringify(statics)).toContain('ExponentialE');
  });
});
