import { ComputeEngine } from '../../src/compute-engine';

/**
 * Collection-aware result typing for `Multiply` (and the `Add` widening it
 * feeds) on DECLARED matrix/vector symbols — decision (d) of the
 * matrix-operator typing design: make the declared path airtight.
 *
 * NOTE: declaring `matrix`/`vector` types retypes a symbol for the engine's
 * lifetime, so each test uses a FRESH `new ComputeEngine()` and never touches
 * the shared test engine.
 */
describe('Matrix-operator typing (declared symbols)', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.declare('X', 'matrix');
    ce.declare('Y', 'matrix');
    ce.declare('v', 'vector');
    return ce;
  }

  test('scalar × matrix → matrix', () => {
    const e = engine().parse('2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix − matrix → matrix (poison via canonical -1·Y term)', () => {
    const e = engine().parse('X-Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('scalar·matrix + scalar·matrix → matrix', () => {
    const e = engine().parse('3X+2Y');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('matrix × matrix → matrix', () => {
    const e = engine().parse('XY');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('matrix');
  });

  test('det(matrix × matrix) is valid and typed number', () => {
    const e = engine().parse('\\det(XY)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('Trace(scalar × matrix) → number', () => {
    const e = engine().parse('\\operatorname{Trace}(2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('scalar × vector → vector (v’s declared type)', () => {
    const ce = engine();
    const e = ce.parse('2v');
    expect(e.isValid).toBe(true);
    // `vector` is the alias for `list<number>`; the product carries v's type.
    expect(e.type.toString()).toBe(ce.symbol('v').type.toString());
  });

  // --- Already-correct rows: guard against regression ---

  test('matrix + matrix → matrix', () => {
    expect(engine().parse('X+Y').type.toString()).toBe('matrix');
  });

  test('-matrix → matrix', () => {
    expect(engine().parse('-Y').type.toString()).toBe('matrix');
  });

  test('matrix^2 → matrix', () => {
    expect(engine().parse('X^2').type.toString()).toBe('matrix');
  });

  test('matrix^{-1} → matrix', () => {
    expect(engine().parse('X^{-1}').type.toString()).toBe('matrix');
  });

  test('det(matrix + scalar·matrix) → number', () => {
    const e = engine().parse('\\det(X+2Y)');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('number');
  });

  test('matrix + scalar keeps the honest union (leave as-is)', () => {
    expect(engine().parse('X+1').type.toString()).toBe('finite_integer | matrix');
  });

  test('vector + vector → list<number> (acceptable)', () => {
    expect(engine().parse('v+v').type.toString()).toBe('list<number>');
  });
});

describe('Matrix-operator typing (undeclared symbols — documented behavior lock)', () => {
  // OUT OF SCOPE / KNOWN LIMITATION: with FRESH (undeclared) symbols, the
  // determinant's argument type check runs before the arithmetic sub-terms are
  // inferred as matrices (inference-ordering), so the expression is rejected.
  // Locked here as a documented behavior. The residual fix — a validation-time
  // repair pass that re-infers symbols typed during the same expression's
  // canonicalization — is tracked under ROADMAP "Matrix-operator typing (M)".
  // Interim contract: declare matrix/vector symbols for symbolic matrix algebra.
  test('det(A+2B) with fresh A/B is (still) an incompatible-type error', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('\\det(A+2B)');
    expect(e.isValid).toBe(false);
    expect(e.json).toMatchObject([
      'Determinant',
      ['Error', ['ErrorCode', "'incompatible-type'", "'matrix'", "'number'"]],
    ]);
  });
});

describe('Multiply numeric typing (regression — must be unchanged)', () => {
  test('(2)(3) types finite_integer and evaluates to 6', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(2)(3)');
    expect(e.type.toString()).toBe('finite_integer');
    expect(e.evaluate().toString()).toBe('6');
  });

  test('2x for a scalar x is unchanged (finite_number)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('2x').type.toString()).toBe('finite_number');
  });
});
