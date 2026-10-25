import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A comparison over a string or a tensor of strings (ROADMAP CE-219). With
 * `S: broadcastable<string>`, `Less(S, "b")`, `Equal(S, "a")` and
 * `NotEqual(S, "a")` compiled on 0.161.0. When `broadcastable<string>`
 * became `string | tensor<string>`, the JavaScript target refused them,
 * because only a string or a list of strings one level deep was known to
 * compile to the answer of the interpreter. The compiled code maps each cell
 * of nested arrays, as the interpreter compares each cell, so a tensor of
 * strings of any rank is admitted.
 */

type Value = string | Value[];

const box = (v: Value): unknown =>
  typeof v === 'string' ? { str: v } : ['List', ...v.map(box)];

/** The interpreter's answer, with `True`/`False` read as booleans. */
function interpreted(ce: ComputeEngine, json: unknown): unknown {
  const read = (x: any): unknown =>
    Array.isArray(x)
      ? x[0] === 'List'
        ? x.slice(1).map(read)
        : x
      : x === 'True'
        ? true
        : x === 'False'
          ? false
          : x;
  return read(ce.box(json as any).evaluate().json);
}

const VALUES: Value[] = [
  'a',
  'b',
  ['a', 'c'],
  [
    ['a', 'b'],
    ['c', 'd'],
  ],
  [['a'], ['b', 'c', 'd']],
];

describe('CE-219: a comparison over broadcastable<string> compiles', () => {
  const ce = new ComputeEngine();
  ce.declare('S', 'broadcastable<string>');
  for (const h of [
    'Less',
    'LessEqual',
    'Greater',
    'GreaterEqual',
    'Equal',
    'NotEqual',
  ]) {
    test(`${h}(S, "b") agrees with the interpreter`, () => {
      const r = compile(ce.box([h, 'S', { str: 'b' }] as any), {
        to: 'javascript',
        fallback: false,
      } as any) as any;
      expect(r.success).toBe(true);
      for (const v of VALUES)
        expect(r.run({ S: v })).toEqual(
          interpreted(ce, [h, box(v), { str: 'b' }])
        );
    });
  }

  test('two tensors of strings compare cell by cell', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'matrix<string>');
    ce2.declare('T', 'matrix<string>');
    const r = compile(ce2.box(['Less', 'S', 'T']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    const S: Value = [
      ['a', 'x'],
      ['c', 'd'],
    ];
    const T: Value = [
      ['b', 'b'],
      ['c', 'z'],
    ];
    expect(r.run({ S, T })).toEqual(interpreted(ce2, ['Less', box(S), box(T)]));
  });

  test('a mixed ordering still declines', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('S', 'broadcastable<string>');
    ce2.declare('n', 'real');
    expect(() =>
      compile(ce2.box(['Less', 'S', 'n']), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/Could not compile/);
  });
});
