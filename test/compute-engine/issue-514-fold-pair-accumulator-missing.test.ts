/**
 * Issue #514: a fold whose accumulator is a pair seeded with a pair literal,
 * and whose body builds the new pair from a read of the accumulator and a
 * value that can be `Missing` (`[p[1] + At([], x), x]`), was refused by the
 * JavaScript target.
 *
 * The fixpoint of `fixpointLiteral()` (`library/collections.ts`) settles on
 * `list<integer | missing^2>`. The use `p[1] + …` is at a slot that
 * propagates absence, so it removes `missing` from the binding of `p`, which
 * is then `vector<integer^2>`. The fixpoint compared its type with that
 * binding without first removing the `missing` arms, as the validation of an
 * argument does, and rejected the fold. The accumulator then kept the type
 * that the index reads alone gave it, `tuple<number>`, so the branches of the
 * `If` had a list type and a tuple type, and the compilation declined.
 */
import { ComputeEngine } from '../../src/compute-engine';

const fold = (body: unknown) => [
  'Fold',
  ['Function', body, 'p', 'x'],
  ['List', 1, 2],
  ['Range', 1, 'n'],
];
const pairStep = (first: unknown) => [
  'If',
  ['Greater', 'x', 1],
  ['List', first, 'x'],
  'p',
];
const MAYBE_MISSING = ['At', ['List'], 'x'];

describe('issue #514: a pair accumulator built from a read that can be Missing', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');

  const cases: [string, unknown][] = [
    ['Add of the first entry', pairStep(['Add', ['At', 'p', 1], MAYBE_MISSING])],
    [
      'Multiply of the first entry',
      pairStep(['Multiply', ['At', 'p', 1], MAYBE_MISSING]),
    ],
    ['Add of the second entry', pairStep(['Add', ['At', 'p', 2], MAYBE_MISSING])],
    [
      'a test of IsMissing on the first entry',
      [
        'If',
        ['IsMissing', ['At', 'p', 1]],
        ['List', 0, 'x'],
        ['List', ['Add', ['At', 'p', 1], MAYBE_MISSING], 'x'],
      ],
    ],
  ];

  it.each(cases)('types the fold of %s as a list of pairs', (_, body) => {
    expect(ce.box(fold(body) as any).type.toString()).toBe(
      'list<integer | missing^2>'
    );
  });

});
