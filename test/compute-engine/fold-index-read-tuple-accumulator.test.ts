/**
 * Issue #454, three defects that together typed a list-valued `Fold` as
 * `broadcastable<tuple<integer>>`, so its compile at a `list<integer>`
 * parameter threw.
 *
 * 1. The index reads of the accumulator (`q(s[1])` with `q: (integer) -> …`)
 *    typed it `tuple<integer>`, a tuple of ONE integer, and the fixpoint
 *    refinement of the accumulator (`refineFoldAccumulator`) did not run
 *    because that type counted as precise. A tuple made by index reads alone
 *    does not prove a length, so it now counts as imprecise and the
 *    accumulator is typed from its seed `[1, 0, 1]`.
 *
 * 2. An `If` or `Which` whose condition is only POSSIBLY a boolean list was
 *    typed `broadcastable` of the element types of its arms. The join drops
 *    an `unknown` element type, so an arm such as `u: list` was lost, while a
 *    scalar condition returns that arm whole. Such an arm is now kept in the
 *    result type.
 *
 * 3. A seeded fold over an empty collection returns its seed, but the fold
 *    was typed by its combiner alone: `Fold((a, k) => "x", 0,
 *    Range(1, n, 1))` was typed `string` and gave `0` for `n = 0`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const AP = [
  'Apply',
  ['Function', ['List', 'q', 0], ['Typed', 'q', "'integer'"]],
  ['At', 's', 1],
];
const FOLD = [
  'Fold',
  [
    'Function',
    [
      'If',
      ['NotEqual', ['At', 's', 2], 0],
      's',
      [
        'If',
        ['Greater', 'k', 'n'],
        ['List', ['At', 's', 1], 1, ['At', 's', 3]],
        AP,
      ],
    ],
    's',
    'k',
  ],
  ['List', 1, 0, 1],
  ['Range', 1, 'n'],
];
const CALL = [
  'Apply',
  ['Function', ['At', 'w', 1], ['Typed', 'w', "'list<integer>'"]],
  FOLD,
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  return ce;
}

describe('issue #454: a fold whose accumulator is read by index', () => {
  it('is typed as a list, not as a one-element tuple', () => {
    const ce = engine();
    expect(ce.box(FOLD as any).type.toString()).toEqual(
      'list<integer | nan^3> | vector<integer^2>'
    );
  });

  it('compiles at a list<integer> parameter, as the interpreter runs it', () => {
    const ce = engine();
    const expr = ce.box(CALL as any);
    const compiled = compile(expr, { fallback: false });
    for (const n of [0, 1, 3]) {
      ce.assign('n', n);
      expect(compiled.run!({ n })).toEqual(expr.evaluate().re);
    }
  });

  it('compiles a scalar read of the fold result', () => {
    const ce = engine();
    ce.declare('acc', 'integer');
    const expr = ce.box(['Add', 'acc', ['At', FOLD, 1]] as any);
    const compiled = compile(expr, { fallback: false });
    expect(compiled.run!({ acc: 10, n: 3 })).toEqual(11);
  });
});

describe('issue #454: a selection on a possibly element-wise condition', () => {
  function selectionEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('u', 'list');
    ce.declare('p', 'tuple<integer>');
    return ce;
  }
  const COND = ['NotEqual', ['At', 'u', 2], 0];

  it('If keeps an arm whose elements are unknown', () => {
    const ce = selectionEngine();
    const expr = ce.box(['If', COND, 'p', 'u'] as any);
    expect(expr.type.toString()).toEqual('broadcastable<any>');
    ce.assign('u', ce.box(['List', 1, 0, 3]));
    const value = expr.evaluate();
    expect(value.json).toEqual(['List', 1, 0, 3]);
    expect(value.type.matches(expr.type)).toBe(true);
  });

  it('Which keeps an arm whose elements are unknown', () => {
    const ce = selectionEngine();
    const expr = ce.box(['Which', COND, 5, 'True', 'u'] as any);
    expect(expr.type.toString()).toEqual('broadcastable<any>');
  });

  it('an arm the broadcastable type admits adds nothing (unchanged)', () => {
    const ce = selectionEngine();
    ce.declare('xs', 'list<integer>');
    expect(ce.box(['If', COND, 5, 'xs'] as any).type.toString()).toEqual(
      'broadcastable<integer>'
    );
  });
});

describe('issue #454: a seeded fold over a collection that may be empty', () => {
  const STEP = ['Function', "'x'", 'a', 'k'];

  it('admits the seed in its type', () => {
    const ce = engine();
    const expr = ce.box(['Fold', STEP, 0, ['Range', 1, 'n', 1]] as any);
    expect(expr.type.toString()).toEqual('integer | string');
    ce.assign('n', 0);
    expect(expr.evaluate().json).toEqual(0);
  });

  it('a literal list is never empty: the combiner type alone (unchanged)', () => {
    const ce = engine();
    expect(
      ce.box(['Fold', STEP, 0, ['List', 1, 2]] as any).type.toString()
    ).toEqual('string');
  });

  it('a Range with no step is never empty: the combiner type alone', () => {
    const ce = engine();
    for (const range of [
      ['Range', 1, 'n'],
      ['Range', 'n'],
      ['Range', 1, 5],
    ]) {
      const expr = ce.box(['Fold', STEP, 0, range] as any);
      expect(expr.type.toString()).toEqual('string');
    }
    // Range(1, 0) counts down: [1, 0], so the fold runs.
    ce.assign('n', 0);
    expect(
      ce.box(['Fold', STEP, 0, ['Range', 1, 'n']] as any).evaluate().json
    ).toEqual("'x'");
  });
});
