/**
 * A declared loop local may remain uninitialized on some paths. Runtime reads
 * report that state, and compilation conservatively declines the declaration.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function box(json: unknown) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce.box(json as any);
}

// The loop example of CE-636, with the declaration as it was written then.
const LOOP = [
  'Block',
  ['Declare', 's', "'unknown'", 0],
  [
    'Loop',
    [
      'Block',
      ['Declare', 'n', "'integer'"],
      ['If', ['Greater', 'i', 3], ['Assign', 'n', 1]],
      ['If', ['NotEqual', 'n', 1], ['Assign', 's', ['Add', 's', 'i']]],
    ],
    ['Element', 'i', ['Range', 1, 5]],
  ],
  's',
];

describe('CE-636: A DECLARATION WITHOUT A VALUE', () => {
  test('the declaration is valid but a read before initialization fails', () => {
    const e = box(LOOP);
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().toString()).toContain('read-before-initialization');
  });

  test('a block with that declaration does not compile', () => {
    const e = box(LOOP);
    for (const to of ['javascript', 'glsl', 'interval-js']) {
      let compiled = true;
      try {
        compiled = compile(e, { to: to as any, fallback: false }).success;
      } catch {
        compiled = false;
      }
      expect(compiled).toBe(false);
    }
  });

  test('a declaration with a value, assigned on some paths, compiles', () => {
    const e = box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        [
          'Block',
          ['Declare', 'n', "'integer'", 0],
          ['If', ['Greater', 'i', 3], ['Assign', 'n', 1]],
          ['If', ['NotEqual', 'n', 1], ['Assign', 's', ['Add', 's', 'i']]],
        ],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ]);
    expect(e.evaluate().toString()).toBe('6');
    const r = compile(e, { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as (v: Record<string, unknown>) => unknown)({ x: 1 })).toBe(6);
  });
});
