/**
 * `Multiply` over operands of MIXED collection kinds.
 *
 * A `List` literal packs as a tensor value; a `Range`/`Filter`/`Take`/`Reverse`
 * result does not. `mulTensors` classified the non-tensor operand as a SCALAR
 * factor, and its final fold applies a scalar with `scaleTensor` — which
 * multiplies every CELL by that factor. A collection factor therefore turned
 * each cell into a list:
 *
 *   Range(1,3) · [1,2,3]  →  [[1,2,3],[2,4,6],[3,6,9]]   (a 3×3 nest)
 *   Range(1,3) + [1,2,3]  →  [2,4,6]                     (`Add`, element-wise)
 *
 * Not a length problem — it misfired at MATCHED lengths, and same-kind pairs
 * (List×List, Range×Range) were always element-wise, because neither operand
 * reached the scalar bucket. `addTensors` avoids it by declining when fewer
 * than two tensors packed; `mulTensors` now declines when a non-tensor
 * broadcastable collection would land among the scalars, so `mul()` falls
 * through to `broadcastOverIndexedCollections` and zips.
 *
 * Measured against the published 0.96.0 bundle, so every "was" below is the
 * shipped behavior, not a regression introduced alongside this test.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const value = (expr: any): string => ce.box(expr).evaluate().toString();

describe('MULTIPLY — mixed collection kinds zip element-wise', () => {
  const filter = [
    'Filter',
    ['Range', 1, 5],
    ['Function', ['Greater', '_', 2], '_'],
  ]; // [3, 4, 5]

  test('Range against a List literal', () => {
    // Was `[[1,2,3],[2,4,6],[3,6,9]]`.
    expect(value(['Multiply', ['Range', 1, 3], ['List', 1, 2, 3]])).toBe(
      '[1,4,9]'
    );
  });

  test('the Desmos-style surface form', () => {
    // `[1...3] · [4,5,6]` — the shape a consumer reaches for first.
    expect(ce.parse('[1...3] \\cdot [4,5,6]').evaluate().toString()).toBe(
      '[4,10,18]'
    );
  });

  test('Filter, Take and Reverse views', () => {
    expect(value(['Multiply', filter, ['List', 1, 2, 3]])).toBe('[3,8,15]');
    expect(
      value(['Multiply', ['Take', ['List', 9, 8, 7], 3], ['List', 1, 2, 3]])
    ).toBe('[9,16,21]');
    expect(
      value(['Multiply', ['Reverse', ['List', 1, 2, 3]], ['List', 1, 2, 3]])
    ).toBe('[3,4,3]');
  });

  test('Multiply now agrees with Add on the same operands', () => {
    const operands = [
      ['Range', 1, 3],
      ['List', 1, 2, 3],
    ];
    expect(value(['Add', ...operands])).toBe('[2,4,6]');
    expect(value(['Multiply', ...operands])).toBe('[1,4,9]');
  });

  test('a mixed-kind mismatch reports incompatible-dimensions', () => {
    // Routing through the generic broadcast also brings the length ruling.
    expect(value(['Multiply', ['Range', 1, 3], ['List', 1, 2]])).toMatch(
      /incompatible-dimensions/
    );
  });
});

describe('MULTIPLY — the paths that must not move', () => {
  test('scalar times a list still scales, on the tensor path', () => {
    expect(value(['Multiply', 2, ['List', 1, 2, 3]])).toBe('[2,4,6]');
  });

  test('same-kind pairs are unchanged', () => {
    expect(value(['Multiply', ['List', 1, 2, 3], ['List', 4, 5, 6]])).toBe(
      '[4,10,18]'
    );
    expect(value(['Multiply', ['Range', 1, 3], ['Range', 1, 3]])).toBe(
      '[1,4,9]'
    );
  });

  test('matrix products still contract', () => {
    expect(
      value([
        'Multiply',
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', ['List', 1, 0], ['List', 0, 1]],
      ])
    ).toBe('[[1,2],[3,4]]');
    expect(
      value([
        'Multiply',
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', 1, 1],
      ])
    ).toBe('[3,7]');
  });

  test('tuples still scale component-wise, never broadcast as lists', () => {
    expect(value(['Multiply', 2, ['Tuple', 1, 2]])).toBe('(2, 4)');
    // A collection times a tuple keeps the documented List-of-Tuples reading.
    expect(value(['Multiply', ['Range', -2, 2], ['Tuple', 2, 3]])).toBe(
      '[(-4, -6),(-2, -3),(0, 0),(2, 3),(4, 6)]'
    );
  });

  test('two mismatched List literals join the length ruling', () => {
    // Was inert-symbolic (`[1,2,3] * [2,2]`): the rank-1 fold in `mulTensors`
    // returned an inert product instead of consulting the mismatch check, so
    // `Multiply` neither truncated nor diagnosed the shape while `Add` on the
    // same operands errored. Both now report `incompatible-dimensions`.
    expect(value(['Multiply', ['List', 1, 2, 3], ['List', 2, 2]])).toMatch(
      /incompatible-dimensions/
    );
    expect(value(['Add', ['List', 1, 2, 3], ['List', 2, 2]])).toMatch(
      /incompatible-dimensions/
    );
    // The unit-carrying variant lands in the same fold, and is diagnosed too.
    expect(
      value([
        'Multiply',
        ['List', 1, 2, 3],
        ['Multiply', ['List', 1, 2], 'Meter'],
      ])
    ).toMatch(/incompatible-dimensions/);
    // A third, matching operand does not mask the mismatch.
    expect(
      value(['Multiply', ['List', 1, 2, 3], ['List', 2, 2], ['List', 1, 1, 1]])
    ).toMatch(/incompatible-dimensions/);
  });
});
