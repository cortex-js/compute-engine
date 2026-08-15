import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho item 189: `Add` returned a NESTED result — every cell a whole
 * collection — when at least two operands were tensor-valued lists and at
 * least one other operand was a collection that is not a tensor VALUE (a
 * `Range`, a `Reverse`/`Take` view, or the lazy `Map` that a broadcast over
 * more than `MAX_SIZE_EAGER_COLLECTION` = 100 elements produces).
 *
 * `addTensors` (`boxed-expression/arithmetic-add.ts`) bucketed such an operand
 * as a SCALAR, and each cell's sum starts at the combined scalar sum, so every
 * cell became `<whole collection> + <cell>`. Only the diagonal — member k's
 * k-th entry — held the intended value, and the result was O(n²).
 * `mulTensors` already declined the kernel on the same shape; `addTensors` now
 * carries the identical guard.
 *
 * The size threshold is incidental: the defect reproduces on three elements
 * with a `Range`, and reproduced in the field only because a 900-element
 * broadcast stays lazy.
 */
describe('Tycho item 189 — Add with a non-tensor collection operand', () => {
  test('a Range operand zips instead of being lifted whole', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Range', 1, 3],
    ]);
    expect(result.evaluate().toString()).toBe('[6,9,12]');
  });

  test('a Reverse view zips instead of being lifted whole', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Reverse', ['List', 7, 8, 9]],
    ]);
    expect(result.evaluate().toString()).toBe('[14,15,16]');
  });

  test('a Take view zips instead of being lifted whole', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Take', ['List', 7, 8, 9, 10], 3],
    ]);
    expect(result.evaluate().toString()).toBe('[12,15,18]');
  });

  test('a Filter view zips instead of being lifted whole', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Filter', ['List', 7, 8, 9, 0], ['Function', ['Greater', '_1', 1], '_1']],
    ]);
    expect(result.evaluate().toString()).toBe('[12,15,18]');
  });

  test('rank 2: a collection operand broadcasts over the rows, not into the cells', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', ['List', 5, 6], ['List', 7, 8]],
      ['Range', 1, 2],
    ]);
    // Row j gets the j-th cell of the Range; before the fix each cell of the
    // matrix sum became a whole 2-element collection: [[[7,8],[9,10]],…].
    expect(result.evaluate().toString()).toBe('[[7,9],[12,14]]');
  });

  test('a collection operand of a different length is a dimension error, not a nested result', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Range', 1, 5],
    ]);
    // Declining the tensor kernel routes to `broadcastOverIndexedCollections`,
    // which enforces the strict-length regime; before the fix a mismatched
    // operand was silently lifted whole instead, yielding a 3-member list of
    // 5-element collections.
    expect(result.evaluate().toString()).toBe(
      'Error("incompatible-dimensions", "5 vs 3")'
    );
  });

  test('a genuine scalar operand still broadcasts over every cell', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Range', 1, 3],
      5,
    ]);
    expect(result.evaluate().toString()).toBe('[11,14,17]');
  });

  test('a symbolic scalar operand still broadcasts over every cell', () => {
    const ce = new ComputeEngine();
    const result = ce.box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6], 'x']);
    expect(result.evaluate().toString()).toBe('[x + 5,x + 7,x + 9]');
  });

  test('a pure tensor sum is unchanged', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Add', ['List', 1, 2, 3], ['List', 4, 5, 6], ['List', 7, 8, 9]])
        .evaluate()
        .toString()
    ).toBe('[12,15,18]');
    expect(
      ce
        .box([
          'Add',
          ['List', ['List', 1, 2], ['List', 3, 4]],
          ['List', ['List', 10, 20], ['List', 30, 40]],
        ])
        .evaluate()
        .toString()
    ).toBe('[[11,22],[33,44]]');
  });

  test('tuples still add component-wise, never broadcast', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Add', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 10, 20]])
        .evaluate()
        .toString()
    ).toBe('(14, 26)');
  });

  test('N() takes the same path as evaluate()', () => {
    const ce = new ComputeEngine();
    const result = ce.box([
      'Add',
      ['List', 1, 2, 3],
      ['List', 4, 5, 6],
      ['Range', 1, 3],
    ]);
    expect(result.N().toString()).toBe('[6,9,12]');
  });

  /**
   * The field shape: a broadcast whose intermediate stays LAZY because it
   * exceeds `MAX_SIZE_EAGER_COLLECTION`. `Sqrt(C)` materializes at n = 100 (so
   * all three operands are tensors and the kernel is correct) and stays a lazy
   * `Map` at n = 101 — which is why the witness reproduced at 900 elements and
   * every hand-written probe at N = 4 did not.
   */
  describe.each([100, 101, 128, 400])(
    'a lazy broadcast operand, n = %i',
    (n) => {
      const A = Array.from({ length: n }, (_, i) => i / 100);
      const B = Array.from({ length: n }, (_, i) => 1 + i / 50);
      const C = Array.from({ length: n }, (_, i) => 4 + i / 10);

      test('every cell is a scalar with the element-wise value', () => {
        const ce = new ComputeEngine();
        const result = ce
          .box([
            'Add',
            ['List', ...A],
            ['List', ...B],
            ['Sqrt', ['List', ...C]],
          ])
          .evaluate();

        const cells = Array.from(result.each());
        expect(cells.length).toBe(n);
        expect(cells.filter((cell) => cell.isCollection === true).length).toBe(
          0
        );

        let maxError = 0;
        for (let k = 0; k < n; k++) {
          const got = Number(cells[k].N().re ?? NaN);
          maxError = Math.max(
            maxError,
            Math.abs(got - (A[k] + B[k] + Math.sqrt(C[k])))
          );
        }
        expect(maxError).toBeLessThan(1e-12);
      });
    }
  );

  /**
   * `Subtract` desugars to `Add(a, Negate(b))`, so it reaches the same kernel.
   * The case has to be built above the eager/lazy boundary to be meaningful:
   * at three elements `Negate(Range(1,3))` materializes into a plain list, so
   * every small `Subtract` shape is a tensor sum and was never affected.
   */
  test('Subtract over a lazy broadcast operand zips', () => {
    const ce = new ComputeEngine();
    const n = 128;
    const A = Array.from({ length: n }, (_, i) => i / 100);
    const B = Array.from({ length: n }, (_, i) => 1 + i / 50);
    const C = Array.from({ length: n }, (_, i) => 4 + i / 10);

    const result = ce
      .box([
        'Subtract',
        ['Add', ['List', ...A], ['List', ...B]],
        ['Sqrt', ['List', ...C]],
      ])
      .evaluate();

    const cells = Array.from(result.each());
    expect(cells.length).toBe(n);
    expect(cells.filter((cell) => cell.isCollection === true).length).toBe(0);

    let maxError = 0;
    for (let k = 0; k < n; k++) {
      const got = Number(cells[k].N().re ?? NaN);
      maxError = Math.max(
        maxError,
        Math.abs(got - (A[k] + B[k] - Math.sqrt(C[k])))
      );
    }
    expect(maxError).toBeLessThan(1e-12);
  });

  /**
   * The field shape that motivated the fix, reduced to the engine: a colour
   * constructor over a piecewise whose guarded arm sums three collection
   * operands. The 900-element census reported 707 members holding a whole
   * 900-element colour collection and 193 scalars; all 900 must be scalars.
   * (The reporting consumer tracks this grid under its own witness identifier
   * `wsne0l2tcv`, which lives in their tracker, not in this repo.)
   */
  test('a 30x30 colour grid over a piecewise produces 900 scalar members', () => {
    const ce = new ComputeEngine();
    const N = 30;
    ce.assign('t', 1.86);
    ce.parse('l(x,y) \\coloneq \\sqrt{x^2+y^2}').evaluate();
    ce.parse(
      'f(x,y) \\coloneq \\begin{cases}\\frac{1}{1.41}(\\sqrt{1-l(x,y)^2}\\sin(t)+x\\cos(t)+y) & l(x,y)\\le1 \\\\ 0.8 \\end{cases}'
    ).evaluate();

    // The document registers `g` while `X`/`Y` are still unknown, so the body
    // is stored with the colour constructor already distributed into the
    // piecewise arms; the grids are substituted in later.
    const body = ce.box(['Hsv', 0, 0, ['f', 'X', 'Y']]).evaluate();
    expect(body.operator).toBe('Which');

    const xs: number[] = [];
    const ys: number[] = [];
    for (let p = 0; p < N * N; p++) {
      xs.push((2 * (p % N)) / N - 1);
      ys.push((2 * Math.floor(p / N)) / N - 1);
    }
    const substituted = body.subs({
      X: ce.box(['List', ...xs]),
      Y: ce.box(['List', ...ys]),
    });
    const value = ce.box(substituted.json).evaluate();

    const cells = Array.from(value.each());
    expect(cells.length).toBe(N * N);
    expect(cells.filter((cell) => cell.isCollection === true).length).toBe(0);
  });
});
