import { ComputeEngine } from '../../src/compute-engine';
import { isRepairableOperatorSymbol } from '../../src/compute-engine/boxed-expression/overload';

/**
 * Prose-style fallback for un-applied builtin operators (MathNet corpus,
 * `builtin-symbol-collision` category): a single uppercase-letter symbol
 * bound to a standard-library operator (`N`, `D`) used as a bare operand of
 * a numeric function devolves to an unknown symbol — `N + 1` means a
 * variable, not the numeric-evaluation operator.
 *
 * The devolution shadows the builtin in the current scope, so it is
 * use-order dependent (same convention as type inference). Tests use a
 * fresh engine each to avoid cross-contamination.
 */

function isClean(ce: ComputeEngine, s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

describe('un-applied builtin operator devolves to a symbol', () => {
  test('N in arithmetic contexts', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + M').json).toEqual(['Add', 'M', 'N']);
    expect(ce.parse('N^2').json).toEqual(['Power', 'N', 2]);
    expect(ce.parse('N-2').json).toEqual(['Add', 'N', -2]);
    expect(ce.parse('M=N+1').json).toEqual(['Equal', 'M', ['Add', 'N', 1]]);
  });

  test('repeated occurrences in one expression (re-encounter path)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N + N').json).toEqual(['Add', 'N', 'N']);
    expect(ce.parse('N, N+1, N+2, N+3').json).toEqual([
      'Tuple',
      'N',
      ['Add', 'N', 1],
      ['Add', 'N', 2],
      ['Add', 'N', 3],
    ]);
  });

  test('D in arithmetic contexts', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\frac{S}{D}').json).toEqual(['Divide', 'S', 'D']);
  });

  test('devolved symbol gets an inferred numeric type', () => {
    const ce = new ComputeEngine();
    ce.parse('N + 1');
    expect(ce.box('N').type.matches('number')).toBe(true);
  });

  test('geometry labels containing D no longer poison the expression', () => {
    const ce = new ComputeEngine();
    expect(isClean(ce, '(DB+BC)^2=AD^2+AC^2.')).toBe(true);
  });

  test('builtins still work when used applied (fresh engine)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('N(3.14159, 2)').evaluate().json).toBe(3.1);
  });

  test('use-order dependence: N(...) after N+1 re-resolves the builtin', () => {
    // Once devolved, `N` refers to the variable in VALUE position (`N + 1`)
    // for the rest of the scope. In OPERATOR position, however, the devolved
    // binding provably cannot be applied (its type is numeric), so
    // `lookupApplicable` defers to the shadowed builtin: `N(3.14159, 2)`
    // numericizes. (Until the Tycho item-42 round this application stayed
    // symbolic; resolving the builtin is strictly more useful and matches
    // the `N = 85` shadowing fix for the lazy-broadcast `.N()` wrapper.)
    const ce = new ComputeEngine();
    ce.parse('N + 1');
    const later = ce.parse('N(3.14159, 2)').evaluate();
    expect(later.isValid).toBe(true);
    expect(later.json).toBe(3.1);
    // The value-position devolution is unaffected:
    expect(ce.parse('N + 1').json).toEqual(['Add', 'N', 1]);
  });

  test('user-declared functions are NOT devolved', () => {
    const ce = new ComputeEngine();
    ce.declare('F', '(real) -> real');
    const expr = ce.box(['Add', 'F', 1]);
    expect(JSON.stringify(expr.json)).toContain('Error');
  });

  test('user-ASSIGNED functions are NOT devolved (root-scope hoisting)', () => {
    // A top-level `ce.assign('F', λ)` hoists its definition into the same
    // parentless scope as the standard library — the devolve fallback must
    // discriminate on the definition's ORIGIN, not its scope position.
    const ce = new ComputeEngine();
    ce.assign('F', ce.parse('x \\mapsto x^2'));
    const boxed = ce.box(['Add', 'F', 1]);
    expect(JSON.stringify(boxed.json)).toContain('Error');
    const parsed = ce.parse('F + 1');
    expect(JSON.stringify(parsed.json)).toContain('Error');
    // The assigned function is intact — no silent engine-lifetime shadow
    // (before the fix, `F(2)` here evaluated to the product `2F`).
    expect(ce.parse('F(2)').evaluate().json).toBe(4);
  });

  test('multi-letter builtin operators are NOT devolved', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', 'Sin', 1]);
    expect(JSON.stringify(expr.json)).toContain('Error');
  });
});

describe('the devolution runs at every parameter position', () => {
  // The repair lives in the argument validation that every declared
  // signature goes through. It used to run only for a REQUIRED parameter:
  // the optional and variadic gates raised `incompatible-type` on the bare
  // builtin instead, so `Range(1, N)` (upper bound = the optional second
  // parameter of `(number, number?, step: number?)`) and `Max(1, N)` (the
  // variadic tail) refused the same `N` that `N + 1` and `Range(N)` accept.
  // Each assertion takes a fresh engine: the first devolution of `N` in an
  // engine shadows the builtin, so a second expression in the same engine
  // would see an ordinary variable and never reach the repair.
  test('optional parameter: Range upper bound and step', () => {
    expect(new ComputeEngine().box(['Range', 1, 'N']).json).toEqual([
      'Range',
      1,
      'N',
    ]);
    expect(new ComputeEngine().box(['Range', 1, 'D']).json).toEqual([
      'Range',
      1,
      'D',
    ]);
    expect(new ComputeEngine().box(['Range', 1, 10, 'N']).json).toEqual([
      'Range',
      1,
      10,
      'N',
    ]);
    expect(new ComputeEngine().parse('[1,\\ldots,N]').json).toEqual([
      'Range',
      1,
      'N',
    ]);
  });

  test('variadic parameter: Max / Min tail', () => {
    expect(new ComputeEngine().box(['Max', 1, 'N']).json).toEqual([
      'Max',
      1,
      'N',
    ]);
    expect(new ComputeEngine().box(['Min', 2, 'N', 'M']).json).toEqual([
      'Min',
      2,
      'N',
      'M',
    ]);
  });

  test('the trial-mode precondition matches the repair', () => {
    // An overload trial admits an operand by this write-free precondition
    // and the winning arm's real validation then runs the repair. The two
    // must agree: a user-assigned function hoisted into the root scope is
    // refused by the repair, so the precondition must refuse it too, or an
    // arm survives its trial and fails the real validation with no sibling
    // arm tried.
    const ce = new ComputeEngine();
    ce.assign('F', ['Function', ['Square', 'x'], 'x']);
    expect(isRepairableOperatorSymbol(ce, ce.box('F'))).toBe(false);
    expect(isRepairableOperatorSymbol(ce, ce.box('N'))).toBe(true);
    ce.declare('G', '(number) -> number');
    expect(isRepairableOperatorSymbol(ce, ce.box('G'))).toBe(false);
  });

  test('a user-declared function in an optional slot is still refused', () => {
    const ce = new ComputeEngine();
    ce.declare('F', '(number) -> number');
    const e = ce.box(['Range', 1, 'F']);
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toContain('incompatible-type');
  });
});
