import { ComputeEngine } from '../../src/compute-engine';

// `Transpose` keeps the shape of its operand, so the transpose of an operand
// with no known shape has no known type either: it is `unknown`, not
// `value`. With `value`, `MatrixMultiply(q, Transpose(q))` with a free `q`
// was an `incompatible-type` error against the `matrix | vector` parameter
// (issue #439, item 2), where `MatrixMultiply(q, q)` stays unevaluated.

describe('Transpose of an operand with no known shape', () => {
  test('a free symbol: the result is typed unknown', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Transpose', 'q']).type.toString()).toBe('unknown');
  });

  test('MatrixMultiply(q, Transpose(q)) with a free q stays unevaluated', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['MatrixMultiply', 'q', ['Transpose', 'q']]);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('MatrixMultiply(q, Transpose(q))');
    expect(e.type.toString()).toBe('matrix | vector');
    // The same expression evaluates once `q` has a value
    ce.assign('q', ['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(e.evaluate().json).toEqual([
      'List',
      ['List', 5, 11],
      ['List', 11, 25],
    ]);
  });

  test('MatrixMultiply(Transpose(q), q) with a free q stays unevaluated', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['MatrixMultiply', ['Transpose', 'q'], 'q']);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('MatrixMultiply(Transpose(q), q)');
  });

  test('a union operand type is transposed member by member', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<integer^(2x3)> | vector');
    expect(ce.box(['Transpose', 'M']).type.toString()).toBe(
      'matrix<integer^(3x2)> | vector'
    );
  });

  test('a known shape keeps its type', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix');
    ce.declare('v', 'vector');
    expect(ce.box(['Transpose', 'M']).type.toString()).toBe('matrix');
    expect(ce.box(['Transpose', 'v']).type.toString()).toBe('vector');
    expect(ce.box(['Transpose', 5]).type.toString()).toBe('integer');
    expect(
      ce
        .box(['Transpose', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .type.toString()
    ).toBe('matrix<integer^(2x2)>');
  });
});
