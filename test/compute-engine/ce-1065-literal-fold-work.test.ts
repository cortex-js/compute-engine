import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { isColorValued } from '../../src/compute-engine/compilation/color-space-fact';
import { isSubtypeOfBroadcastOrIndexed } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';

/**
 * The compile of a symbol whose value is a list of tuples of numbers writes
 * that value into the code. Two costs of that fold were paid once for each
 * tuple (CE-1065, the `apollonian-gasket` prelude of Tycho, 224 tuples):
 *
 * - `isColorValued()` ran its four-level subtype test also for a type with
 *   no `color` in it. A pre-test now answers `false` for such a type; it
 *   must never change the answer of the full test.
 * - `tryConstantFold()` evaluated each tuple of number literals and ran the
 *   gates of the fold, then emitted a new tuple of the same numbers. It now
 *   emits that new tuple without the evaluation and the gates, so the code
 *   does not change.
 */

/** The element type of the full color test of `isColorValued()`. */
const NESTED_COLOR_ELEMENT = parseType(
  'broadcastable<broadcastable<broadcastable<color>>>'
);

describe('isColorValued with the pre-test', () => {
  const types = [
    'integer',
    'real',
    'number',
    'boolean',
    'string',
    'color',
    'any',
    'unknown',
    'list<color>',
    'list<integer>',
    'list<list<color>>',
    'list<list<list<list<color>>>>',
    'list<list<list<list<list<color>>>>>',
    'matrix<color>',
    'tuple<integer, real, real, integer>',
    'tuple<color, real>',
    'tuple<color>',
    'list<tuple<integer, real>>',
    'integer | color',
    'color | list<color>',
    'list<integer> | list<color>',
    'list<integer> | string',
    'indexed_collection<color>',
    'indexed_collection<integer>',
    'collection<color>',
    'collection<integer>',
    'broadcastable<color>',
    'broadcastable<real>',
    'set<color>',
    'real<0..1>',
    'list<real<0..1>>',
  ];
  test.each(types)('%s gives the answer of the full test', (t) => {
    const ce = new ComputeEngine();
    ce.declare('x', t);
    const x = ce.box('x');
    expect(isColorValued(x)).toBe(
      isSubtypeOfBroadcastOrIndexed(x.type.type, NESTED_COLOR_ELEMENT)
    );
  });

  test('a list of colors is color-valued, a tuple of numbers is not', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'list<color>');
    ce.declare('p', 'tuple<integer, real, real, integer>');
    expect(isColorValued(ce.box('c'))).toBe(true);
    expect(isColorValued(ce.box('p'))).toBe(false);
  });
});

describe('the fold of a symbol value that is a list of literal tuples', () => {
  const TUPLES = [
    [2, 0.5, 0, 1],
    [3, -0.25, 0.75, 2],
    [15, 0.125, 0.6666666666666666, 3],
  ];

  /** Count the calls of `N()` on each tuple of `list` while `run` runs. */
  function countEvaluations(list: Expression, run: () => void): number {
    let calls = 0;
    const tuples = list.ops!;
    for (const tuple of tuples) {
      const N = tuple.N.bind(tuple);
      Object.defineProperty(tuple, 'N', {
        configurable: true,
        value: () => {
          calls += 1;
          return N();
        },
      });
    }
    try {
      run();
      return calls;
    } finally {
      for (const tuple of tuples) delete (tuple as { N?: unknown }).N;
    }
  }

  test('does not evaluate a tuple of number literals, and gives its value', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'pts',
      ce.box(['List', ...TUPLES.map((t) => ['Tuple', ...t])] as any)
    );
    const stored = ce._getSymbolValue('pts')!;
    let result: ReturnType<typeof compile> | undefined;
    const calls = countEvaluations(stored, () => {
      result = compile(ce.box('pts'), { to: 'javascript' });
    });
    expect(calls).toBe(0);
    expect(result!.success).toBe(true);
    expect((result!.run as () => unknown)()).toEqual(TUPLES);
  });

  // The fold emits a new node, which the common subexpression pass does not
  // know: a repeated literal stays a literal, and does not become a shared
  // temporary. The code is the code from before CE-1065.
  test('a repeated literal list keeps the code of the fold', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const seven = ['List', 1.5, 2, 3, 4, 5, 6, 7];
    const expr = ce.box(['List', seven, seven, 'x'] as any);
    const js = compile(expr, { to: 'javascript' });
    expect(js.success).toBe(true);
    expect(js.code).toBe('[_lit_1, _lit_1, _.x]');
    const py = compile(expr, { to: 'python' });
    expect(py.success).toBe(true);
    expect(py.code).toBe(
      '[[1.5, 2, 3, 4, 5, 6, 7], [1.5, 2, 3, 4, 5, 6, 7], x]'
    );
  });

  test('a tuple with an exact rational still gives its value', () => {
    const ce = new ComputeEngine();
    ce.assign('q', ce.box(['List', ['Tuple', ['Rational', 1, 3], 2]]));
    const result = compile(ce.box('q'), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect((result.run as () => unknown)()).toEqual([[1 / 3, 2]]);
  });
});
