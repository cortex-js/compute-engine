/**
 * A `Join` or `Append` that adopts the dictionary kind of an operand merges
 * key-value entries. An element that is not an entry cannot be merged, and
 * the result is a type error that names that element.
 *
 * Before 2026-09-30 the preview of such a join ended with the internal
 * `ContinuationPlaceholder` symbol, and the error named that symbol:
 * `Error(incompatible-type, tuple<string, unknown>, "symbol
 * ContinuationPlaceholder")`.
 *
 * Before 2026-10-17 `evaluate()` returned the unevaluated `Join`, typed
 * `record`, and the error appeared only when its elements were read (by
 * `toString()`, for example). Since the user decision of 2026-10-17, an
 * element that can never be an entry (a literal that is not a tuple, a tuple
 * that is not a pair with a string key, a string, a range) makes the
 * canonical form the error itself. An element that may still hold an entry
 * (a symbol with no value) keeps the lazy `Join`, and its read reports it.
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
    // The value itself is the error, not a lazy `Join` whose read fails.
    expect(result.operator).toBe('Error');
    expect(ce.box(input as any).operator).toBe('Error');
  });

  test.each([
    [
      'a tuple that is not a pair',
      ['Join', dict, ['Tuple', 1, 2, 3]],
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "tuple<integer, integer, integer>"), (1, 2, 3))',
    ],
    [
      'a pair whose key is a number',
      ['Join', dict, ['List', ['Tuple', 1, 2]]],
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "tuple<integer, integer>"), (1, 2))',
    ],
    [
      'a list element',
      ['Join', dict, ['List', ['List', 1]]],
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "vector<integer^1>"), [1])',
    ],
    [
      'a range',
      ['Join', dict, ['Range', 1, 3]],
      'Error(ErrorCode("incompatible-type", "collection<tuple<string, any>>", "range"), Range(1, 3))',
    ],
    [
      'a string',
      ['Join', dict, "'ab'"],
      'Error(ErrorCode("incompatible-type", "collection<tuple<string, any>>", "string"), "ab")',
    ],
  ])('%s is refused when boxed', (_, input, expected) => {
    const boxed = ce.box(input as any);
    expect(boxed.operator).toBe('Error');
    expect(boxed.evaluate().toString()).toBe(expected);
  });

  test('a symbol that holds a list is refused when evaluated', () => {
    const engine = new ComputeEngine();
    engine.assign('d', engine.box(dict as any));
    engine.declare('C', 'collection');
    engine.assign('C', engine.box(['List', 2, 3]));
    const join = engine.box(['Join', 'd', 'C']);
    // The canonical form does not read the value `C` holds now.
    expect(join.operator).toBe('Join');
    expect(join.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "2"), 2)'
    );
    // Assigned a list of entries, the same expression merges.
    engine.assign('C', engine.box(['List', ['Tuple', "'y'", 2]] as any));
    expect(join.evaluate().toString()).toBe('{"x" -> 1, "y" -> 2}');
  });

  test('a symbol that holds a dictionary is checked when evaluated', () => {
    // The canonical form does not read the type `d` has from its value, so
    // the same expression follows a new value of `d`.
    const engine = new ComputeEngine();
    engine.assign('d', engine.box(dict as any));
    const join = engine.box(['Join', 'd', ['List', 2]]);
    const append = engine.box(['Append', 'd', 2]);
    const nested = engine.box([
      'Append',
      ['Append', 'd', ['Tuple', "'y'", 2]],
      3,
    ] as any);
    expect(join.operator).toBe('Join');
    expect(append.operator).toBe('Append');
    const refused =
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "2"), 2)';
    expect(join.evaluate().toString()).toBe(refused);
    expect(append.evaluate().toString()).toBe(refused);
    expect(nested.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "3"), 3)'
    );
    engine.assign('d', engine.box(['List', 1]));
    expect(join.evaluate().toString()).toBe('[1,2]');
    expect(append.evaluate().toString()).toBe('[1,2]');
    expect(nested.evaluate().toString()).toBe('[1,("y", 2),3]');
  });

  test.each([
    ['an empty list', ['List']],
    ['an empty string', "''"],
    ['an empty range', ['Range', 5, 1, 1]],
    ['an empty linspace', ['Linspace', 0, 1, 0]],
  ])('%s contributes no element', (_, operand) => {
    expect(
      ce
        .box(['Join', dict, operand] as any)
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1}');
  });

  test('a tuple whose arity may change is decided when evaluated', () => {
    // `If(c, 3, Nothing)` is dropped when `c` is false, and the tuple is
    // then the entry `("y", 2)`.
    const engine = new ComputeEngine();
    const input = [
      'Append',
      dict,
      ['Tuple', "'y'", 2, ['If', 'c', 3, 'Nothing']],
    ] as any;
    expect(engine.box(input).operator).toBe('Append');
    engine.assign('c', false);
    expect(engine.box(input).evaluate().toString()).toBe(
      '{"x" -> 1, "y" -> 2}'
    );
  });

  test('an element with no value keeps the lazy join', () => {
    const boxed = ce.box(['Join', dict, ['List', 'z']] as any);
    expect(boxed.operator).toBe('Join');
    expect(boxed.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "tuple<string, any>", "unknown"), z)'
    );
  });

  test('an absent operand is absent', () => {
    expect(
      ce
        .box(['Join', dict, 'Missing'] as any)
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('a list literal with a spread of a dictionary is a list', () => {
    // `[...d, 2]` is a `ListJoin`, whose result is a list whatever its
    // operands are: the dictionary gives its entries.
    expect(
      ce
        .box(['List', ['Spread', dict], 2] as any)
        .evaluate()
        .toString()
    ).toBe('[("x", 1),2]');
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
    expect(
      ce
        .box(['Join', dict, ['List', ['Tuple', "'y'", 2]]] as any)
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1, "y" -> 2}');
    expect(
      ce
        .box(['Append', dict, ['Tuple', "'y'", 2]] as any)
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1, "y" -> 2}');
    expect(
      ce
        .box(['Join', dict, ['Dictionary', ['Tuple', "'y'", 2]]] as any)
        .evaluate()
        .toString()
    ).toBe('{"x" -> 1, "y" -> 2}');
  });
});
