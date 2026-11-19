/**
 * CE-1501: a recursive function whose result type wraps the result of its
 * recursive call (`Length(n) + P(n − 1, x)` gives `broadcastable<H>` for a
 * call result `H`) got a deeper type at each read:
 * `broadcastable<broadcastable<…>>`, one level more at each derivation of
 * its signature, and each read took longer than the one before (the fourth
 * about 15 s).
 *
 * A derivation of the signature reads the earlier result H as the result of
 * the recursive calls. A result f(H) that is equivalent to H (each a subtype
 * of the other) but written differently is no longer stored: the earlier
 * signature is kept. A narrower or a wider f(H) is stored as before, so that
 * a later derivation can reach a narrower fixed point
 * (`_deriveSignatureOnce`, `boxed-value-definition.ts`).
 *
 * The variants declared `function` do not reach that rule (their type was
 * already stable); they guard the wildcard-signature path. The accumulators
 * declared `function` check that the rule keeps the narrow fixed point.
 */
import { ComputeEngine } from '../../src/compute-engine';

type MathJson = Parameters<ComputeEngine['box']>[0];

function engineWith(
  body: MathJson,
  params: string[],
  declared: string
): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', declared);
  ce.assign('P', ce.box(['Function', body, ...params]));
  return ce;
}

const LENGTH_OF_PARAMETER: MathJson = [
  'Which',
  ['Equal', 'n', 0],
  'x',
  'True',
  ['Add', ['Length', 'n'], ['P', ['Subtract', 'n', 1], 'x']],
];

// The Tycho test: the recursive call passes `n` itself.
const SAME_ARGUMENT: MathJson = [
  'Which',
  ['Equal', 'n', 0],
  'x',
  'True',
  ['Add', ['Length', 'n'], ['P', 'n', 'x']],
];

describe('CE-1501 recursive signature reaches a fixed point', () => {
  for (const [label, body] of [
    ['P(n − 1, x)', LENGTH_OF_PARAMETER],
    ['P(n, x)', SAME_ARGUMENT],
  ] as const) {
    for (const declared of ['(unknown, unknown) -> unknown', 'function']) {
      test(`${label}, declared ${declared}: the type is the same at every read`, () => {
        const ce = engineWith(body, ['n', 'x'], declared);
        const first = String(ce.box(['P', 1, 2]).type);
        let last = first;
        for (let i = 0; i < 50; i++) last = String(ce.box(['P', 1, 2]).type);
        expect(last).toBe(first);
        expect(String(ce.box('P').type)).not.toMatch(
          /broadcastable<broadcastable/
        );
      });
    }
  }

  test('the values do not change', () => {
    const ce = engineWith(
      LENGTH_OF_PARAMETER,
      ['n', 'x'],
      '(unknown, unknown) -> unknown'
    );
    expect(ce.box(['P', 0, 2]).evaluate().toString()).toBe('2');

    const ce2 = engineWith(
      [
        'If',
        ['Equal', 'k', 0],
        0,
        ['Add', ['Length', 'L'], ['P', 'L', ['Subtract', 'k', 1]]],
      ],
      ['L', 'k'],
      '(unknown, unknown) -> unknown'
    );
    for (let i = 0; i < 5; i++)
      expect(
        ce2
          .box(['P', ['List', 1, 2, 3], 4])
          .evaluate()
          .toString()
      ).toBe('12');

    const ce3 = engineWith(
      [
        'If',
        ['Equal', 'k', 0],
        'L',
        ['P', ['Append', 'L', ['Length', 'L']], ['Subtract', 'k', 1]],
      ],
      ['L', 'k'],
      '(unknown, unknown) -> unknown'
    );
    expect(
      ce3
        .box(['P', ['List', 7], 3])
        .evaluate()
        .toString()
    ).toBe('[7,1,2,3]');
  });

  // The first derivation gives `unknown`, wider than the skeleton's result;
  // a later one reaches the narrow fixed point.
  for (const [label, base, step, type, value] of [
    [
      'tuple',
      ['Tuple', 0, 0],
      ['Tuple', 1, 2],
      'tuple<number, number>',
      '(2, 4)',
    ],
    ['list', ['List', 0, 0], ['List', 1, 2], 'vector<integer^2>', '[2,4]'],
  ] as const) {
    test(`a ${label} accumulator declared function keeps its narrow type`, () => {
      const ce = engineWith(
        [
          'If',
          ['LessEqual', 'n', 0],
          base,
          ['Add', ['P', ['Subtract', 'n', 1]], step],
        ],
        ['n'],
        'function'
      );
      for (let i = 0; i < 5; i++)
        expect(String(ce.box(['P', 2]).type)).toBe(type);
      expect(ce.box(['P', 2]).evaluate().toString()).toBe(value);
    });
  }
});
