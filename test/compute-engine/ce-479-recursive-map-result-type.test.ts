/**
 * CE-479: the stored signature of a function that calls itself from the
 * callback of `Map` must hold the values of the function.
 *
 * `m(n) := Map(x ↦ If(x < 1, 0, m(x - 1)), [n])` gives `[0]`, `[[0]]`,
 * `[[[0]]]`, …: one more level of nesting for each level of recursion. The
 * derivation of the signature read the recursive call as `unknown`, and the
 * join of `unknown` with `integer` is `integer`, so the callback was typed
 * `-> integer` and the function `-> list<number>`, which does not hold
 * `[[0]]`. No finite nesting holds every value, so the result is a list of
 * integers or lists of any contents.
 */
import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';

const BODY = [
  'Function',
  [
    'Map',
    ['Function', ['If', ['Less', 'x', 1], 0, ['m', ['Subtract', 'x', 1]]], 'x'],
    ['List', 'n'],
  ],
  'n',
] as const;

/** The value `v` with every element evaluated, as a list literal. A `Map`
 * evaluates to a lazy collection, whose own type is the type of the `Map`
 * expression, so the check reads the elements instead. */
function materialize(ce: ComputeEngine, v: Expression): Expression {
  if (!v.isCollection) return v;
  return ce.function(
    'List',
    [...v.each()].map((x) => materialize(ce, x.evaluate()))
  );
}

function engine(route: 'undeclared' | 'parse' | string): ComputeEngine {
  const ce = new ComputeEngine();
  if (route === 'parse') {
    ce.parse(
      'm(n) := \\operatorname{Map}(x \\mapsto \\operatorname{If}(x < 1, 0, m(x-1)), [n])'
    ).evaluate();
    return ce;
  }
  if (route !== 'undeclared') ce.declare('m', route);
  ce.assign('m', ce.box(BODY as any));
  return ce;
}

describe('CE-479: A RECURSIVE FUNCTION OVER MAP HOLDS ITS VALUES', () => {
  test.each([
    ['undeclared', '(n: unknown) -> list<integer | list>'],
    ['parse', '(n: unknown) -> list<integer | list>'],
    ['(unknown) -> unknown', '(unknown) -> list<integer | list>'],
    ['(integer) -> unknown', '(integer) -> list<integer | list>'],
  ])('%s', (route, signature) => {
    const ce = engine(route);
    const sig = ce.box('m').type;
    expect(sig.toString()).toBe(signature);
    const result = sig.toString().replace(/^.*-> /, '');
    const expected = ['[0]', '[[0]]', '[[[0]]]'];
    for (const k of [0, 1, 2]) {
      // The call type is read before the evaluation.
      const call = ce.box(['m', k]);
      const callType = call.type;
      const value = materialize(ce, call.evaluate());
      expect(value.toString()).toBe(expected[k]);
      expect(value.type.matches(callType)).toBe(true);
      expect(value.type.matches(result)).toBe(true);
    }
    // A second read of the signature gives the same answer.
    expect(ce.box('m').type.toString()).toBe(signature);
  });

  test('a deep call read first is typed by the signature', () => {
    // The call type was derived from the cached type of the callback, which
    // was computed while the signature was not derived: `m(8)` was typed
    // `list<integer | vector<1>>`.
    const ce = engine('(integer) -> unknown');
    const call = ce.box(['m', 8]);
    const callType = call.type;
    expect(callType.toString()).toBe('list<integer | list>');
    expect(materialize(ce, call.evaluate()).type.matches(callType)).toBe(true);
  });
});

/** `name := n ↦ Map(x ↦ If(x < 1, 0, other(x − 1)), [n])`. */
function mapCalling(other: string) {
  return [
    'Function',
    [
      'Map',
      [
        'Function',
        ['If', ['Less', 'x', 1], 0, [other, ['Subtract', 'x', 1]]],
        'x',
      ],
      ['List', 'n'],
    ],
    'n',
  ];
}

/** Each call of `f` at depths 0 to 2 gives a value that matches the call
 * type and the result of the signature of `f`. */
function expectValuesMatch(ce: ComputeEngine, f: string) {
  const result = ce
    .box(f)
    .type.toString()
    .replace(/^.*-> /, '');
  const expected = ['[0]', '[[0]]', '[[[0]]]'];
  for (const k of [0, 1, 2]) {
    const call = ce.box([f, k]);
    const callType = call.type;
    const value = materialize(ce, call.evaluate());
    expect(value.toString()).toBe(expected[k]);
    expect(value.type.matches(callType)).toBe(true);
    expect(value.type.matches(result)).toBe(true);
  }
}

describe('CE-479: TWO FUNCTIONS THAT CALL EACH OTHER FROM A MAP CALLBACK', () => {
  // A call of the other function of the cycle is typed by its candidate
  // result while the result of one function is verified. Before, `ha` was
  // typed `-> list<number>` and `ha(1)` `list<number>` for `[[0]]`.
  test.each(['ab', 'ba'])('declared, assigned in the order %s', (order) => {
    const ce = new ComputeEngine();
    ce.declare('ha', '(unknown) -> unknown');
    ce.declare('hb', '(unknown) -> unknown');
    for (const c of order)
      ce.assign(`h${c}`, ce.box(mapCalling(c === 'a' ? 'hb' : 'ha') as any));
    for (const f of ['ha', 'hb']) {
      expect(ce.box(f).type.toString()).toBe(
        '(unknown) -> list<integer | list>'
      );
      expectValuesMatch(ce, f);
    }
  });

  // The function assigned first was not recursive when it was assigned:
  // its inferred signature is refined when the second one completes the
  // cycle (`_refineRecursiveCycleMembers`). Before, it kept
  // `-> list<number>`.
  test.each(['ab', 'ba'])('undeclared, assigned in the order %s', (order) => {
    const ce = new ComputeEngine();
    for (const c of order)
      ce.assign(`h${c}`, ce.box(mapCalling(c === 'a' ? 'hb' : 'ha') as any));
    for (const f of ['ha', 'hb']) {
      expect(ce.box(f).type.toString()).toMatch(/-> list<integer \| list>$/);
      expectValuesMatch(ce, f);
    }
  });
});

describe('CE-479: A FUNCTION PASSED BY NAME TO MAP IN ITS OWN BODY', () => {
  // `p := n ↦ If(n < 1, 0, Map(p, [n − 1]))` gives `0`, `[0]`, `[[0]]`.
  // The call type was derived by a walk of the body that typed `p` by its
  // signature, derived with the call typed `unknown`: `p(2)` was typed
  // `integer | list<unknown^1>`. The result of the signature is now made
  // of the bare type of each arm of the widened candidate.
  test('the call types and the signature hold the values', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'p',
      ce.box([
        'Function',
        [
          'If',
          ['Less', 'n', 1],
          0,
          ['Map', 'p', ['List', ['Subtract', 'n', 1]]],
        ],
        'n',
      ])
    );
    expect(ce.box('p').type.toString()).toBe(
      '(n: unknown) -> integer | list<integer | list>'
    );
    const expected = ['0', '[0]', '[[0]]'];
    for (const k of [0, 1, 2]) {
      const call = ce.box(['p', k]);
      const callType = call.type;
      const value = materialize(ce, call.evaluate());
      expect(value.toString()).toBe(expected[k]);
      expect(value.type.matches(callType)).toBe(true);
    }
  });
});
