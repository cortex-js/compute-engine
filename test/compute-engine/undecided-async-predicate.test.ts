import { ComputeEngine } from '../../src/compute-engine';

// A predicate whose boolean holds a call of an operator that has only an
// `evaluateAsync` handler is UNDECIDED under `evaluate()`, not malformed:
// `evaluate()` cannot run that operator, and `evaluateAsync()` can decide the
// boolean later. So the predicate reader stays unevaluated, and does not throw
// "<Operator> predicate must return "True" or "False"". A call of a name with
// no definition (`Foo(y) > 10`) is not such a call, and keeps the error with
// its spelling hint.

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  // `evaluate()` leaves `AsyncOnly(x)` unevaluated, `evaluateAsync()` gives
  // `x + 5`.
  ce.declare('AsyncOnly', {
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  } as never);
  return ce;
}

const ASYNC_PREDICATE = ['Function', ['Greater', ['AsyncOnly', 'y'], 10], 'y'];
const UNKNOWN_NAME_PREDICATE = ['Function', ['Greater', ['Foo', 'y'], 10], 'y'];

function evaluated(json: unknown): string {
  return engine()
    .box(json as never)
    .evaluate()
    .toString();
}

describe('A HELD ASYNCHRONOUS-ONLY CALL IS AN UNDECIDED PREDICATE VERDICT', () => {
  test.each([
    [
      'Length of a Filter',
      ['Length', ['Filter', ['Range', 1, 10], ASYNC_PREDICATE]],
    ],
    [
      'First of a Filter over an infinite range',
      ['First', ['Filter', ['Range', 1, 'PositiveInfinity'], ASYNC_PREDICATE]],
    ],
    ['CountIf', ['CountIf', ['List', 1, 2, 3], ASYNC_PREDICATE]],
    ['Find', ['Find', ['List', 1, 2, 3], ASYNC_PREDICATE]],
    ['Position', ['Position', ['List', 1, 2, 3], ASYNC_PREDICATE]],
    ['IndexWhere', ['IndexWhere', ['List', 1, 2, 3], ASYNC_PREDICATE]],
  ])('%s stays unevaluated under evaluate()', (_name, json) => {
    const ce = engine();
    const expr = ce.box(json as never);
    const result = expr.evaluate();
    expect(result.operator).toBe(expr.operator);
    expect(result.isSame(expr)).toBe(true);
  });

  // The asynchronous-only call can be reached through a symbol whose value is
  // the predicate, or through the body of a helper function that the
  // predicate calls.
  test.each([
    [
      'a symbol callee',
      (ce: ComputeEngine) => {
        ce.assign('g', ce.box(ASYNC_PREDICATE as never));
        return 'g';
      },
    ],
    [
      'a helper function in the body',
      (ce: ComputeEngine) => {
        ce.assign('h', ce.box(['Function', ['AsyncOnly', 'y'], 'y'] as never));
        return ['Function', ['Greater', ['h', 'y'], 10], 'y'];
      },
    ],
  ])('%s is undecided under evaluate()', async (_name, setup) => {
    for (const reader of [
      (p: unknown) => ['CountIf', ['List', 1, 2, 3], p],
      (p: unknown) => ['Length', ['Filter', ['Range', 1, 10], p]],
    ]) {
      const ce = engine();
      const expr = ce.box(reader(setup(ce)) as never);
      expect(expr.evaluate().isSame(expr)).toBe(true);
    }
    const ce = engine();
    const counted = ce.box(['CountIf', ['List', 4, 6, 8], setup(ce)] as never);
    expect((await counted.evaluateAsync()).toString()).toBe('2');
  });

  test('a Filter view over a list prints without an error', () => {
    expect(evaluated(['Filter', ['List', 1, 2, 3], ASYNC_PREDICATE])).toBe(
      'Filter([1,2,3], (y) => 10 < AsyncOnly(y))'
    );
  });

  test('the eager readers decide the predicate under evaluateAsync()', async () => {
    const ce = engine();
    const value = async (json: unknown) =>
      (await ce.box(json as never).evaluateAsync()).toString();
    // AsyncOnly(y) is y + 5: 6, 7, 8 are not greater than 10, and 9, 11, 13
    // has two values greater than 10.
    expect(await value(['CountIf', ['List', 1, 2, 3], ASYNC_PREDICATE])).toBe(
      '0'
    );
    expect(await value(['CountIf', ['List', 4, 6, 8], ASYNC_PREDICATE])).toBe(
      '2'
    );
    expect(
      await value(['IndexWhere', ['List', 4, 6, 8], ASYNC_PREDICATE])
    ).toBe('2');
  });
});

describe('A CALL OF A NAME WITH NO DEFINITION IS STILL A MALFORMED PREDICATE', () => {
  test('Length of a Filter throws with the spelling hint', () => {
    expect(() =>
      evaluated([
        'Length',
        ['Filter', ['Range', 1, 10], UNKNOWN_NAME_PREDICATE],
      ])
    ).toThrow(
      /Filter predicate must return "True" or "False"\. Unknown symbol "Foo"/
    );
  });

  test('CountIf throws with the spelling hint', () => {
    expect(() =>
      evaluated(['CountIf', ['List', 1, 2, 3], UNKNOWN_NAME_PREDICATE])
    ).toThrow(
      /CountIf predicate must return "True" or "False"\. Unknown symbol "Foo"/
    );
  });
});
