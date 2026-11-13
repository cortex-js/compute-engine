/**
 * CE-636. A `Block` local that a `Declare` gave no value could be read with
 * no value on some paths. The language no longer admits that state: a
 * declaration without a value is the static error `declaration-without-value`,
 * so there is no read of a local with no value to classify. The remaining
 * rules of block locals are pinned in `block-locals-declaration-rules.test.ts`
 * and `compile-block-locals-rules.test.ts`.
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
  test('the declaration is a static error', () => {
    const e = box(LOOP);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('declaration-without-value');
  });

  test('a block with that declaration does not compile', () => {
    const e = box(LOOP);
    for (const to of ['javascript', 'python', 'glsl', 'interval-js']) {
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
