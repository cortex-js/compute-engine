/**
 * A `Join` or `Append` that adopts the dictionary kind of an operand merges
 * key-value entries. An element that is not an entry cannot be merged, and
 * the result is a type error that names that element.
 *
 * Before 2026-09-30 the preview of such a join ended with the internal
 * `ContinuationPlaceholder` symbol, and the error named that symbol:
 * `Error(incompatible-type, tuple<string, unknown>, "symbol
 * ContinuationPlaceholder")`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const dict = ['Dictionary', ['Tuple', "'x'", 1]];

describe('A KEYED JOIN WITH AN ELEMENT THAT IS NOT AN ENTRY', () => {
  test.each([
    ['Join(dictionary, list)', ['Join', dict, ['List', 2, 3]]],
    ['Join(list, dictionary)', ['Join', ['List', 2], dict]],
    ['Join(dictionary, set)', ['Join', dict, ['Set', 2]]],
    ['Append(dictionary, 2)', ['Append', dict, 2]],
  ])('%s names the element', (_, input) => {
    const result = ce.box(input as any).evaluate();
    expect(result.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "2"), 2)'
    );
    expect(result.toString()).not.toContain('ContinuationPlaceholder');
  });

  test('a full materialization gives the same error', () => {
    const result = ce
      .box(['Join', dict, ['List', 2, 3]] as any)
      .evaluate({ materialization: true });
    expect(result.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "2"), 2)'
    );
  });

  test('a join of entries still merges', () => {
    expect(
      ce
        .box(['Join', dict, ['Tuple', "'y'", 2]] as any)
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1, "y" -> 2}');
  });
});
