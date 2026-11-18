import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * A restriction, `If` and `Which` over a nested mask, on both routes (ROADMAP
 * CE-223).
 *
 * - CE-223.1: a mask of rank 2 or more is not a condition (selection rule
 *   of 2026-11-02, `docs/BROADCAST-MODEL.md`, which reverses the user
 *   decision of 2026-10-23 that such a mask selects cell by cell at every
 *   level). A condition whose static type is a matrix or a nested list is a
 *   static error, and a compilation declines. A condition whose static type
 *   does not settle its shape (`B < 0` over `B: tensor<number>`) compiles;
 *   when its value is nested, the interpreter gives an `incompatible-type`
 *   error and the compiled code `NaN`, its compiled spelling.
 * - CE-223.2: an arm typed as a point or a list of points that holds one
 *   point at run time is lifted whole, as the interpreter lifts it. Before,
 *   the compiled code indexed the point as a list.
 * - CE-223.3: `If(B < 0, B)` with `B: broadcastable<number>` compiles: such
 *   a value cannot be a point, so an array is aligned with the mask and any
 *   other value is repeated.
 */

/** The compilation of `json` declines: the expression is a static error. */
function declines(ce: ComputeEngine, json: unknown): void {
  const e = ce.box(json as any);
  expect(e.isValid).toBe(false);
  expect(() =>
    compile(e, { to: 'javascript', fallback: false } as any)
  ).toThrow(/static type error/);
}

describe('CE-223.1: a mask of rank 2 is not a condition', () => {
  const ce = new ComputeEngine();
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('v', 'real');
  ce.declare('M', 'matrix<integer^(2x2)>');
  ce.declare('B', 'tensor<number>');

  test('the interpreter refuses a nested list condition', () => {
    const e = ce.box([
      'If',
      ['List', ['List', 'True', 'False'], ['List', 'False', 'True']],
      5,
    ]);
    expect(e.isValid).toBe(false);
    expect(e.evaluate().toString()).toContain('incompatible-type');
  });

  test('a matrix mask declines', () => {
    declines(ce, ['If', 'C', 'M']);
    declines(ce, ['If', 'C', 'v']);
  });
});

describe('CE-223.2: an arm that is a point or a list of points', () => {
  const ce = new ComputeEngine();
  ce.declare('P', 'tuple<real, real> | list<tuple<real, real>>');
  ce.declare('C', 'matrix<boolean^(2x2)>');
  ce.declare('F', 'list<boolean>');

  test('one point under a nested mask declines', () => {
    declines(ce, ['If', 'C', 'P']);
  });
});
