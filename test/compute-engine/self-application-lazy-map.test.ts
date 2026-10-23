/**
 * A function that receives itself as a parameter and recurses through a
 * lazy `Map` (issue #470, ROADMAP CE-387).
 *
 * The body scope of a function literal is shared by every application of
 * the literal. An application hides the parameter bindings of that scope,
 * so that the body reads the values in its call frame, and puts them back
 * when it ends. A nested application of the same literal put them back while
 * the enclosing application was still running. The enclosing application
 * then read its parameter `self` with no value when `Max`, `Reduce` or `Sum`
 * read the next element of the lazy `Map`, and the whole call stayed
 * unevaluated. Since 0.160.0, `Apply(G, G, [[[], []]])` gave `Apply(…)`;
 * 0.159.0 gave `2`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

/** A tree statistic written as a function of itself and a tree given as
 * nested lists: `combine` folds the values of the children. */
function treeFunction(leafValue: number, combine: (m: unknown) => unknown) {
  return [
    'Function',
    [
      'Block',
      [
        'If',
        ['Equal', ['Length', 't'], 0],
        leafValue,
        combine(['Map', ['Function', ['Block', ['self', 'self', 'c']], 'c'], 't']),
      ],
    ],
    'self',
    't',
  ];
}

const height = (fold: (m: unknown) => unknown) =>
  treeFunction(0, (m) => ['Add', fold(m), 1]);

const TWO_LEAVES = ['List', ['List'], ['List']];
const DEPTH_TWO = ['List', ['List', ['List'], ['List']]];
const DEPTH_THREE = [
  'List',
  ['List', ['List', ['List'], ['List']], ['List']],
  ['List'],
];

describe('a function applied to itself recurses through a lazy Map', () => {
  test.each([
    [
      'Reduce',
      (m: unknown) => [
        'Reduce',
        m,
        ['Function', ['Block', ['Max', 'a', 'b']], 'a', 'b'],
        0,
      ],
    ],
    ['Max', (m: unknown) => ['Max', m]],
  ])('the height of a tree with %s', (_, fold) => {
    const G = height(fold);
    expect(ce.box(['Apply', G, G, TWO_LEAVES] as any).evaluate().json).toBe(1);
    expect(ce.box(['Apply', G, G, DEPTH_TWO] as any).evaluate().json).toBe(2);
    expect(ce.box(['Apply', G, G, DEPTH_THREE] as any).evaluate().json).toBe(
      3
    );
  });

  test('the number of leaves of a tree with Sum', () => {
    const L = treeFunction(1, (m) => ['Sum', m]);
    expect(ce.box(['Apply', L, L, TWO_LEAVES] as any).evaluate().json).toBe(2);
    expect(ce.box(['Apply', L, L, DEPTH_THREE] as any).evaluate().json).toBe(
      4
    );
  });

  test('the same function, assigned to a name and passed to itself', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('H', ce2.box(height((m) => ['Max', m]) as any));
    expect(ce2.box(['H', 'H', DEPTH_THREE] as any).evaluate().json).toBe(3);
  });

  test('evaluateAsync() gives the same value', async () => {
    const G = height((m) => ['Max', m]);
    const result = await ce
      .box(['Apply', G, G, DEPTH_THREE] as any)
      .evaluateAsync();
    expect(result.json).toBe(3);
  });

  test('evaluateAsync() of several applications of one literal', async () => {
    // The applications of `G` in the operands of the tuple are awaited
    // together, and can end in another order than they started.
    const G = ce.box(height((m) => ['Max', m]) as any);
    const result = await ce
      .box([
        'Tuple',
        ['Apply', G, G, DEPTH_THREE],
        ['Apply', G, G, TWO_LEAVES],
        ['Apply', G, G, DEPTH_TWO],
      ] as any)
      .evaluateAsync();
    expect(result.json).toEqual(['Tuple', 3, 1, 2]);
    // The body scope is as it was: the literal is applied again.
    expect(ce.box(['Apply', G, G, DEPTH_TWO] as any).evaluate().json).toBe(2);
  });

  test('the literal can be applied again after a recursion', () => {
    // The bindings that the nested applications hid are put back when the
    // last application ends, so a later application sees the same body
    // scope as the first one.
    const G = ce.box(height((m) => ['Max', m]) as any);
    expect(ce.box(['Apply', G, G, DEPTH_THREE] as any).evaluate().json).toBe(
      3
    );
    expect(ce.box(['Apply', G, G, DEPTH_TWO] as any).evaluate().json).toBe(2);
    expect(ce.box(['Apply', G, G, ['List']] as any).evaluate().json).toBe(0);
  });
});
