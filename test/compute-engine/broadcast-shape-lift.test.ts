import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

/**
 * Phase B of the tensor-unification design (§D6 of
 * `docs/COLLECTIONS-MODEL.md`):
 *
 * - D6.1 — rank/shape-aware broadcast lift: the static type of a broadcast
 *   application mirrors the shape-bearing operands' statically-provable
 *   structure (dimensioned encoding), with a merge rule for multiple
 *   operands that never invents structure.
 * - D6.2 — overlap-deferred validation: a collection-kind signature
 *   parameter accepts an operand whose static type does not REFUTE
 *   conformance; runtime conformance is the operator's own evaluate gate
 *   (handler precedence).
 */

describe('D6.1 — rank/shape-aware broadcast lift', () => {
  // Phase C representation unification: literal lists type honestly
  // (list<finite_…^dims>); broadcast-applied scalar results report `number`
  // cells.
  const ce = new ComputeEngine();
  const M = ['List', ['List', 2, 3], ['List', 5, 7]];

  test('fixed-shape source: Sqrt(M) types with the operand dims', () => {
    const s = ce.box(['Sqrt', M]);
    // At least `matrix<2x2>`: the operand dims are what this guards; the cell
    // tier may refine (`matrix<2x2>` is a sound answer), but
    // not to rational cells — `√2`, `√3`, `√5`, `√7` are irrational.
    expectTypeBetween(s, {
      atMost: 'matrix<2x2>',
      above: 'matrix<rational^(2x2)>',
    });
    expect(s.type.matches('matrix')).toBe(true);
  });

  test('headline gate: Determinant(Sqrt(M)) canonicalizes without incompatible-type', () => {
    const det = ce.box(['Determinant', ['Sqrt', M]]);
    expect(det.isValid).toBe(true);
  });

  test('MatrixMultiply(Sqrt(M), Sqrt(M)) canonicalizes', () => {
    expect(ce.box(['MatrixMultiply', ['Sqrt', M], ['Sqrt', M]]).isValid).toBe(
      true
    );
  });

  test('unknown-length source is unchanged (no invented lengths)', () => {
    ce.declare('xs', 'list<number>');
    expect(ce.function('Sqrt', [ce.symbol('xs')]).type.toString()).toBe(
      'list<number>'
    );
  });

  test('mixed-shape n-ary operands: no dims invented (merge rule)', () => {
    ce.declare('A2', 'matrix<2x2>');
    ce.declare('v3', 'vector<3>');
    // Rank mismatch across shape-bearing operands → plain unbounded list.
    expect(ce.box(['Greater', 'A2', 'v3']).type.toString()).toBe(
      'list<boolean>'
    );
  });

  test('finite materialized operand: static and evaluated types coincide', () => {
    const expr = ce.box(['Sin', ['List', 0, 1]]);
    // At least `vector<2>`: the shape is what this guards; the cell tier may
    // refine, but not to rational cells (`sin 1` is irrational). The
    // evaluated-vs-declared check below guards the over-narrow direction too.
    expectTypeBetween(expr, {
      atMost: 'vector<2>',
      above: 'vector<rational^2>',
    });
    // evaluated ⊆ declared (the broadcast soundness contract)
    expect(expr.evaluate().type.matches(expr.type.type)).toBe(true);
  });

  test('provably-wrong operands still error at canonicalization', () => {
    expect(ce.box(['Determinant', { str: 'abc' }]).isValid).toBe(false);
    expect(ce.box(['Determinant', 5]).isValid).toBe(false);
  });
});

describe('D6.2 — overlap-deferred validation', () => {
  test('bare-list operand: provisional accept, inert while unassigned, evaluates when conforming', () => {
    const ce = new ComputeEngine();
    ce.declare('bl', 'list');
    const det = ce.box(['Determinant', 'bl']);
    expect(det.isValid).toBe(true);
    // Still-overlapping (unassigned) → inert, no error.
    expect(det.evaluate().operator).toBe('Determinant');
    // Conforming value → evaluates (the deferral payoff).
    ce.assign('bl', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(det.evaluate().toString()).toBe('-2');
  });

  test('nonconforming value → the handler-specific error (handler precedence)', () => {
    const ce = new ComputeEngine();
    ce.declare('bl', 'list');
    const det = ce.box(['Determinant', 'bl']);
    ce.assign('bl', ce.box(['List', 1, 2, 3]));
    expect(det.evaluate().toString()).toContain('expected-square-matrix');
  });

  test('list<unknown> operand is in the overlap zone', () => {
    const ce = new ComputeEngine();
    ce.declare('lu', 'list<unknown>');
    expect(ce.box(['Determinant', 'lu']).isValid).toBe(true);
  });

  test('union params (matrix|vector family) participate in deferral', () => {
    const ce = new ComputeEngine();
    ce.declare('bl', 'list');
    const M = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['MatrixMultiply', 'bl', M]).isValid).toBe(true);
    expect(ce.box(['Dot', 'bl', M]).isValid).toBe(true);
  });

  test('partially-dimensioned nested list defers (rank from dims + nesting)', () => {
    const ce = new ComputeEngine();
    // list<list<number>^2>: 2 rows, each an open-length numeric list —
    // rank 2, compatible with `matrix`.
    ce.declare('rl', 'list<list<number>^2>');
    expect(ce.box(['Determinant', 'rl']).isValid).toBe(true);
  });

  test('boolean tensor through a deferred param: inert, never a crash', () => {
    const ce = new ComputeEngine();
    ce.declare('bl', 'list');
    const det = ce.box(['Determinant', 'bl']);
    ce.assign(
      'bl',
      ce.box(['List', ['List', 'True', 'False'], ['List', 'False', 'True']])
    );
    // Boolean tensors have no arithmetic field: the handler declines, and
    // the deferred parameter check then refutes the value it was handed —
    // the answer is that `incompatible-type` error (an operand that fails
    // only when evaluated bubbles, docs/ERROR-MODEL.md §3), never a crash.
    // Until 2026-09-03 the error stayed embedded in an inert `Determinant`.
    const v = det.evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toContain('incompatible-type');
  });

  test('deferred acceptance does not narrow an inferred symbol to the param', () => {
    const ce = new ComputeEngine();
    ce.declare('bl', 'list');
    ce.box(['Determinant', 'bl']);
    // The declared type is untouched, and (for inferred symbols) deferral
    // must not have narrowed toward `matrix` — `bl` still accepts a flat
    // list value.
    expect(ce.box('bl').type.toString()).toBe('list');
  });

  test('provable refutations still error at canonicalization', () => {
    const ce = new ComputeEngine();
    // Rank refutation: list<number> is provably rank 1 (number elements) —
    // it can never be a matrix (whose elements are rows).
    ce.declare('ln', 'list<number>');
    expect(ce.box(['Determinant', 'ln']).isValid).toBe(false);
    // Leaf refutation: rank-compatible but provably-disjoint leaf types.
    ce.declare('lls', 'list<list<string>>');
    expect(ce.box(['Determinant', 'lls']).isValid).toBe(false);
  });
});
