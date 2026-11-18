/**
 * Issue #511: the accumulator of a fold whose body appends on one branch and
 * returns the accumulator on the other (`If(c, t, Join(t, [x]))`) did not
 * settle on a list type. At the first step of the fixpoint the body's result
 * is the union `vector<2> | vector<integer^1>`. `withoutLengthChange()`
 * (`library/collections.ts`) dropped the length of a single list result only,
 * so the accumulator was typed with the union at the next step. An index read
 * of the accumulator in a nested fold then gave `unknown`, the outer fold was
 * typed `list<any>`, and the JavaScript compilation declined the nested
 * callback with "does not settle one shape".
 */
import { ComputeEngine } from '../../src/compute-engine';

const GUARDED = [
  'If',
  ['LessEqual', 'k', 'm'],
  ['At', 't', ['Add', ['Subtract', 'm', 'k'], 1]],
  0,
];
const INNER = [
  'Fold',
  ['Function', ['Add', 'a', GUARDED], 'a', 'k'],
  0,
  ['Range', 1, 'n', 1],
];
const outer = (cond: unknown) => [
  'Fold',
  ['Function', ['If', cond, 't', ['Join', 't', ['List', INNER]]], 't', 'm'],
  ['List', 1],
  ['Range', 1, 'l', 1],
];

describe('issue #511: a fold that appends on one branch of an If', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('l', 'integer');

  it('types the accumulator as a list of numbers', () => {
    expect(ce.box(outer(['Greater', 'm', 'l']) as any).type.toString()).toBe(
      'list<number>'
    );
  });
});
