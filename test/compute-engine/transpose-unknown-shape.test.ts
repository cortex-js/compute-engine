import { compile, ComputeEngine } from '../../src/compute-engine';

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
    // The product of two vectors is a number.
    expect(e.type.toString()).toBe('matrix | number | vector');
    // The same expression evaluates once `q` has a value
    ce.assign('q', ['List', ['List', 1, 2], ['List', 3, 4]]);
    expect(e.evaluate().type.matches(e.type)).toBe(true);
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

  test.each(['Transpose', 'ConjugateTranspose'])(
    '%s swaps a fixed row width with an unknown row count',
    (operator) => {
      const ce = new ComputeEngine();
      ce.declare('P', 'list<list<real^2>>');
      ce.declare('axis', 'integer');
      expect(ce.expr([operator, 'P']).type.toString()).toBe(
        'matrix<real^(2x?)>'
      );
      expect(ce.expr([operator, 'P', 1, 1]).type.toString()).toBe(
        'matrix<real^(?x2)>'
      );
      expect(ce.expr([operator, 'P', 'axis', 2]).type.toString()).toBe(
        'matrix<real>'
      );
    }
  );

  test('Length counts the filtered rows of a transpose (CE-1875)', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<list<real^2>>');
    const count = ce.expr([
      'Length',
      [
        'Filter',
        ['Transpose', 'P'],
        ['Function', ['Greater', ['Sum', 'r'], 6], 'r'],
      ],
    ]);
    const compiled = compile(count, { fallback: false });

    ce.assign('P', ['List', ['List', 1, 2]]);
    expect(count.evaluate().json).toBe(0);
    expect(compiled.run?.({ P: [[1, 2]] })).toBe(0);

    ce.assign('P', ['List', ['List', 1, 2], ['List', 3, 8], ['List', 2, 1]]);
    expect(count.evaluate().json).toBe(1);
    expect(compiled.run?.({ P: [[1, 2], [3, 8], [2, 1]] })).toBe(1);
  });
});
