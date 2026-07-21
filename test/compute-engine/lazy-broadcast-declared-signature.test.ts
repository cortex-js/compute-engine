import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 78 (2026-07-21): applying a declared-then-assigned function
 * (`ce.declare('g', '(number) -> number')` + `ce.assign('g', x ↦ …)`) to a
 * >100-element collection evaluated EAGERLY — a whole-collection walk at
 * `evaluate()` time — while the parse-assigned form (`g(x):=x+1`) and plain
 * arithmetic broadcast returned the lazy `Map`.
 *
 * Root cause: the declared form resolves to a VALUE definition holding a
 * function literal, so application routes through `applyFunctionLiteral`
 * rather than the operator-definition lambda-broadcast steps (2b/4b). Its
 * broadcast arm was an unconditional eager zip — the one broadcast site that
 * never received the 0.84.0 hybrid-laziness gate (`lazyBroadcastMapIfNeeded`).
 * Not a 0.89.0 regression: eager on every release since the gate shipped.
 */

function engineWith(
  declared: string | null,
  fnLatex = 'x \\mapsto 2x+1'
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('X', ce.parse('\\left[1...300\\right]').evaluate());
  if (declared === null) {
    ce.parse('g(x):=2x+1').evaluate();
  } else {
    ce.declare('g', declared);
    ce.assign('g', ce.parse(fnLatex));
  }
  return ce;
}

describe('declared-signature lazy broadcast (Tycho item 78)', () => {
  test('declared (number) -> number: lazy Map, correct elements', () => {
    const ce = engineWith('(number) -> number');
    const v = ce.parse('g(X)').evaluate();
    expect(v.operator).toBe('Map');
    expect(v.count).toBe(300);
    expect(v.at(1)?.json).toBe(3);
    expect(v.at(300)?.json).toBe(601);
  });

  test('declared (unknown) -> unknown: lazy Map, correct elements', () => {
    const ce = engineWith('(unknown) -> unknown');
    const v = ce.parse('g(X)').evaluate();
    expect(v.operator).toBe('Map');
    expect(v.count).toBe(300);
    expect(v.at(42)?.json).toBe(85);
  });

  test('parse-assigned form is unchanged (still lazy)', () => {
    const ce = engineWith(null);
    const v = ce.parse('g(X)').evaluate();
    expect(v.operator).toBe('Map');
    expect(v.count).toBe(300);
    expect(v.at(1)?.json).toBe(3);
  });

  test('at or below the eager threshold the eager List path is unchanged', () => {
    const ce = engineWith('(number) -> number');
    const v = ce.parse('g([1,2,3])').evaluate();
    expect(v.operator).toBe('List');
    expect(v.json).toEqual(['List', 3, 5, 7]);
  });

  test('.N() threads numericApproximation into the lazy elements', () => {
    const ce = engineWith('(number) -> number', 'x \\mapsto \\sqrt{x}');
    const v = ce.parse('g(X)').N();
    expect(v.operator).toBe('Map');
    expect(v.at(2)?.re).toBeCloseTo(Math.SQRT2, 12);
  });

  test('x.evaluate().N() ≡ x.N() on the lazy form (item-39 contract)', () => {
    const ce = engineWith('(number) -> number', 'x \\mapsto \\sqrt{x}');
    const late = ce.parse('g(X)').evaluate().N();
    expect(late.operator).toBe('Map');
    expect(late.at(2)?.re).toBeCloseTo(Math.SQRT2, 12);
  });

  test('a collection-typed parameter still binds its argument whole', () => {
    const ce = new ComputeEngine();
    ce.assign('X', ce.parse('\\left[1...300\\right]').evaluate());
    ce.declare('h', '(list<number>) -> number');
    ce.assign('h', ce.parse('L \\mapsto \\operatorname{Length}(L)'));
    expect(ce.parse('h(X)').evaluate().json).toBe(300);
  });

  test('a tuple argument stays atomic (bound whole, never mapped)', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(number) -> number');
    ce.assign('g', ce.parse('x \\mapsto 2x'));
    const v = ce.parse('g((1,2))').evaluate();
    expect(v.operator).toBe('Tuple');
    expect(v.json).toEqual(['Tuple', 2, 4]);
  });
});
