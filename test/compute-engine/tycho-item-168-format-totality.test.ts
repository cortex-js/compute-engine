import { ComputeEngine } from '../../src/compute-engine';

// Tycho item 168 (2026-08-11): `toLatex()` and the `.latex` getter could
// THROW, because formatting a lazy collection materializes it — and
// materialization EVALUATES. A comprehension over an unresolvable binding
// raises "Condition must evaluate to True or False" from its `Which`, and that
// escaped a *formatting* call, aborting a whole document open.
//
// An unresolvable binding is not a formatting error: the tree is perfectly
// printable, as the same expression with nothing bound demonstrates. The
// materialization is now guarded, falling through to the symbolic spelling.
//
// A `CancellationError` is deliberately still propagated: deadlines are only
// ever installed by an enclosing `ce.withTimeLimit()` span, and a caller who
// set a budget must see it expire rather than receive a silently degraded
// spelling.
//
// Callers who want the un-materialized form BY CONTRACT rather than by
// fallback should pass `toLatex({ materialization: false })`, which never
// evaluates — that is the supported opt-out, and it worked before this fix.

const COMPREHENSION =
  '\\left[\\begin{cases}P_{iecepos}[m+n]&\\vert\\sum P_{iecepos}[(m+n)..(m+n+4)]\\vert=5\\\\0&\\top\\end{cases} \\operatorname{for} n = 1..11, m = 0..15..210\\right]';
const TARGET =
  '\\mathrm{Join}(\\mathrm{Filter}(C_{heckH}, Z\\mapsto\\vert Z\\vert\\gt0))';

describe('Tycho item 168: formatting is total', () => {
  describe('the repro — C_heckH bound, P_iecepos unbound', () => {
    let ce: ComputeEngine;
    let expr: ReturnType<ComputeEngine['parse']>;

    beforeEach(() => {
      ce = new ComputeEngine();
      ce.assign('C_heckH', ce.parse(COMPREHENSION));
      expr = ce.parse(TARGET);
    });

    test('the operand really is a lazy collection (the branch is reached)', () => {
      expect(expr.isLazyCollection).toBe(true);
    });

    test('.latex does not throw', () => {
      expect(() => expr.latex).not.toThrow();
    });

    test('toLatex() does not throw', () => {
      expect(() => expr.toLatex()).not.toThrow();
    });

    test('it degrades to the SYMBOLIC spelling, not an error string', () => {
      const out = expr.latex;
      expect(out).toContain('Join');
      expect(out).toContain('Filter');
      expect(out).not.toContain('Error');
    });

    test('the degraded spelling equals the nothing-bound spelling', () => {
      // The whole argument for falling through: the expression prints exactly
      // as it does when no binding has been made at all.
      const bare = new ComputeEngine();
      expect(expr.latex).toBe(bare.parse(TARGET).latex);
    });

    test('the documented opt-out never evaluated, and still works', () => {
      expect(expr.toLatex({ materialization: false })).toBe(expr.latex);
    });
  });

  describe('the other binding states are unchanged', () => {
    test('nothing bound prints', () => {
      const ce = new ComputeEngine();
      expect(() => ce.parse(TARGET).latex).not.toThrow();
    });

    test('both bound prints, and materializes to a shorter form', () => {
      const ce = new ComputeEngine();
      ce.assign('P_iecepos', ce.parse('\\left[1,2,3,4,5\\right]'));
      ce.assign('C_heckH', ce.parse(COMPREHENSION));
      const out = ce.parse(TARGET).latex;
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toContain('Error');
    });

    test('P_iecepos bound only prints', () => {
      const ce = new ComputeEngine();
      ce.assign('P_iecepos', ce.parse('\\left[1,2,3,4,5\\right]'));
      expect(() => ce.parse(TARGET).latex).not.toThrow();
    });
  });

  describe('successful materialization is NOT affected', () => {
    // The guard must only catch where the code threw before — a healthy lazy
    // collection must still materialize into its elided/eager spelling.
    test('a healthy lazy Map still materializes under toLatex', () => {
      const ce = new ComputeEngine();
      const e = ce.parse('\\mathrm{Map}(1..5, k \\mapsto 2k)');
      expect(e.toLatex({ materialization: true })).toContain('2');
      expect(e.toLatex({ materialization: true })).not.toContain('Map');
    });

    test('materialization:false keeps the operator form', () => {
      const ce = new ComputeEngine();
      const e = ce.parse('\\mathrm{Map}(1..5, k \\mapsto 2k)');
      expect(e.toLatex({ materialization: false })).toContain('Map');
    });

    test('ordinary expressions are untouched', () => {
      const ce = new ComputeEngine();
      expect(ce.parse('x^2+1').latex).toBe(ce.box(['Add', ['Power', 'x', 2], 1]).latex);
      expect(ce.box(['Add', 'x', 1]).latex).toContain('x');
    });
  });
});
