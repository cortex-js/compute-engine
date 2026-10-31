import { ComputeEngine } from '../../src/compute-engine';

// `TakeWhile` and `DropWhile` stop their leading run at the first verdict
// that is not `True`. An UNDECIDED verdict (`y > z` for a `z` with no value,
// or a call of an operator that only `evaluateAsync()` can run) does not say
// whether the run ends there. The walk then ends and records that it missed
// an element, so the view and every reader of it (`Length`, materialization)
// stay unevaluated. `TakeWhile([6, 7, 8], y ↦ y > z)` is not `[]`, and its
// `Length` is not `0`: either value would claim that the run ends at `6`.

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

const FREE_SYMBOL = ['Function', ['Greater', 'y', 'z'], 'y'];
const ASYNC_ONLY = ['Function', ['Greater', ['AsyncOnly', 'y'], 10], 'y'];
const DECIDED = ['Function', ['Less', 'y', 7], 'y'];

function evaluated(json: unknown, materialization = false): string {
  return engine()
    .box(json as never)
    .evaluate({ materialization })
    .toString();
}

describe('AN UNDECIDED VERDICT LEAVES TAKEWHILE AND DROPWHILE UNEVALUATED', () => {
  test.each([
    ['a free symbol', FREE_SYMBOL],
    ['an asynchronous-only call', ASYNC_ONLY],
  ])('%s: the views and their readers stay unevaluated', (_name, p) => {
    for (const op of ['TakeWhile', 'DropWhile']) {
      const ce = engine();
      const view = ce.box([op, ['List', 6, 7, 8], p] as never);
      expect(view.evaluate({ materialization: true }).isSame(view)).toBe(true);
      // `IsEmpty` of a `TakeWhile` reads its own facet, which applies the
      // predicate to the first element without the iterator.
      for (const reader of [
        ['Length', view],
        ['IsEmpty', view],
        ['First', view],
        ['At', view, 1],
      ]) {
        const read = ce.box(reader as never);
        expect(read.evaluate().isSame(read)).toBe(true);
      }
    }
  });

  test('an undecided verdict after decided ones stays unevaluated', () => {
    expect(evaluated(['TakeWhile', ['List', 1, 2, 'z'], DECIDED], true)).toBe(
      'TakeWhile([1,2,z], (y) => y < 7)'
    );
    // The walk of `DropWhile` ends in the middle of the dropped run.
    expect(evaluated(['DropWhile', ['List', 1, 2, 'z'], DECIDED], true)).toBe(
      'DropWhile([1,2,z], (y) => y < 7)'
    );
  });

  test('decided verdicts give the leading run', () => {
    expect(evaluated(['TakeWhile', ['List', 6, 7, 8], DECIDED], true)).toBe(
      '[6]'
    );
    expect(evaluated(['DropWhile', ['List', 6, 7, 8], DECIDED], true)).toBe(
      '[7,8]'
    );
    expect(
      evaluated(['Length', ['TakeWhile', ['List', 6, 7, 8], DECIDED]])
    ).toBe('1');
  });
});
