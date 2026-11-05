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
import { compile } from '../../src/compute-engine/compilation/compile-expression';

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

  it('compiles the example of the issue to the values of the interpreter', () => {
    const e = ce.box(outer(['Greater', 'm', 'l']) as any);
    const result = compile(e, { fallback: false });
    expect(result.success).toBe(true);
    for (const [n, l] of [
      [3, 4],
      [5, 6],
      [0, 3],
      [6, 0],
    ]) {
      const expected = e.subs({ n, l }).evaluate().json;
      expect(['List', ...(result.run!({ n, l }) as number[])]).toEqual(
        expected
      );
    }
    expect(result.run!({ n: 3, l: 4 })).toEqual([1, 1, 2, 4, 7]);
  });

  it('compiles a body whose branches make the accumulator shorter and longer', () => {
    const e = ce.box([
      'Fold',
      [
        'Function',
        [
          'If',
          ['Greater', 'k', 2],
          ['Rest', 't'],
          ['Join', 't', ['List', ['Add', ['At', 't', 1], 'k']]],
        ],
        't',
        'k',
      ],
      ['List', 1, 2],
      ['Range', 1, 'n', 1],
    ] as any);
    const result = compile(e, { fallback: false });
    expect(result.success).toBe(true);
    for (const n of [0, 2, 3, 5]) {
      const expected = e.subs({ n }).evaluate().json;
      expect(['List', ...(result.run!({ n }) as number[])]).toEqual(expected);
    }
    expect(result.run!({ n: 3 })).toEqual([2, 2, 3]);
  });

  it('compiles an accumulator whose inferred element type has a missing arm', () => {
    // The case of the issue body: the read `acc[c - 1]` can be out of range,
    // so the accumulator is typed `list<integer | missing>`, a type that no
    // annotation can name.
    const ce2 = new ComputeEngine();
    ce2.declare('xs', 'list<integer>');
    const e = ce2.box([
      'Fold',
      [
        'Function',
        [
          'Join',
          'acc',
          [
            'List',
            [
              'Add',
              ['If', ['Equal', 'c', 1], 0, ['At', 'acc', ['Subtract', 'c', 1]]],
              ['At', 'xs', 'c'],
            ],
          ],
        ],
        'acc',
        'c',
      ],
      ['List'],
      ['Range', 1, ['Count', 'xs'], 1],
    ] as any);
    expect(e.type.toString()).toBe('list<integer | missing>');
    const result = compile(e, { fallback: false });
    expect(result.success).toBe(true);
    for (const xs of [[3, 1, 4, 1, 5], [], [7]]) {
      const expected = e.subs({ xs: ce2.box(['List', ...xs]) }).evaluate().json;
      expect(['List', ...(result.run!({ xs }) as number[])]).toEqual(expected);
    }
    expect(result.run!({ xs: [3, 1, 4, 1, 5] })).toEqual([3, 4, 8, 9, 14]);
  });

  it('compiles with a condition that is always false', () => {
    const e = ce.box(outer('False') as any);
    const result = compile(e, { fallback: false });
    expect(result.success).toBe(true);
    expect(result.run!({ n: 5, l: 6 })).toEqual([1, 1, 2, 4, 8, 16, 31]);
  });
});
