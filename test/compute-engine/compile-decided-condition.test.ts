/**
 * A conditional whose condition is a constant, that has an `else` arm, and
 * whose arms are all of one scalar kind (integer, real or boolean), takes its
 * arm when it is lowered, and the other arm is not lowered (CE-1560). The
 * interpreter does not evaluate the arm that is not taken, so an arm that the
 * compiler would decline (a comparison with a complex constant,
 * `Less(x, -√(1 − 1.2²))`) does not decline the program.
 *
 * Every value case is checked against the interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

/** `Which(c ≤ 1, Which(x < −√(1 − c²), 1, True, 0), True, 1)`: a Desmos
 *  slider value `c` substituted in the program. */
const witness = (c: number) => [
  'Which',
  ['LessEqual', c, 1],
  [
    'Which',
    [
      'Less',
      'x',
      ['Negate', ['Sqrt', ['Add', 1, ['Negate', ['Power', c, 2]]]]],
    ],
    1,
    'True',
    0,
  ],
  'True',
  1,
];

function compiled(json: unknown, to = 'javascript') {
  return compile(engine().box(json as never), { to } as never);
}

function interpreted(json: unknown, x: number): unknown {
  const ce = engine();
  ce.assign('x', x);
  return ce.box(json as never).N().json;
}

describe('A CONSTANT CONDITION TAKES ITS ARM (CE-1560)', () => {
  test('the arm not taken, which would decline, does not decline the program', () => {
    const r = compiled(witness(1.2));
    expect(r.success).toBe(true);
    for (const x of [-2, 0, 0.3])
      expect(r.run!({ x } as never)).toBe(interpreted(witness(1.2), x));
  });

  test('the same on GLSL', () => {
    expect(compiled(witness(1.2), 'glsl').success).toBe(true);
  });

  test('a taken arm that compiles is computed', () => {
    const r = compiled(witness(0.5));
    expect(r.success).toBe(true);
    for (const x of [-2, 0, 0.3])
      expect(r.run!({ x } as never)).toBe(interpreted(witness(0.5), x));
  });

  test('a taken arm that would decline still declines', () => {
    const json = ['If', ['Less', 1, 2], ['Less', 'x', ['Sqrt', -2]], 'True'];
    expect(compiled(json).success).toBe(false);
  });

  test('an If whose constant condition is true takes its then arm', () => {
    const json = [
      'If',
      ['Greater', 'Pi', 3],
      ['Less', 'x', 1],
      ['Less', 'x', ['Sqrt', -2]],
    ];
    const r = compiled(json);
    expect(r.success).toBe(true);
    expect(r.run!({ x: 0.5 } as never)).toBe(true);
  });

  test('with constantFold off, both arms are lowered and the witness declines', () => {
    const r = compile(engine().box(witness(1.2) as never), {
      to: 'javascript',
      constantFold: false,
    } as never);
    expect(r.success).toBe(false);
  });

  // The arms are compared also where the condition is known
  // (`docs/COMPILATION-MODEL.md`): an arm is left out only when all the
  // arms are of one scalar kind.
  test('arms of two shapes still decline', () => {
    expect(compiled(['If', ['Less', 2, 3], 'x', ['List', 1, 2]]).success).toBe(
      false
    );
  });

  test('a complex arm not taken keeps the complex lane of the result', () => {
    const ce = engine();
    ce.declare('z', 'complex');
    const json = ['If', ['Less', 1, 2], 'x', 'z'];
    const r = compile(ce.box(json as never), { to: 'glsl' } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('vec2');
  });

  test('an integer arm beside a real arm keeps the real lane on GLSL', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    const json = ['If', ['Less', 1, 2], 'n', 'x'];
    const r = compile(ce.box(json as never), { to: 'glsl' } as never);
    expect(r.success).toBe(true);
    // Both arms are lowered: the join makes the result a float.
    expect(r.code).toMatch(/= x;/);
  });
});
