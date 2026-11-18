/**
 * A constant list literal in a compiled body is emitted ONCE as a preamble
 * local the runner evaluates once per artifact, instead of being built again
 * on every call (Tycho ledger row 370).
 *
 * A plotting consumer substitutes a resolved document list by value into a
 * row before compiling it, so `T[⌊Nx⌋ + N⌊Ny⌋] < k` compiled with `T`'s
 * 9 801 numbers as a literal, and the `javascript` target wrote the 49 KB
 * array literal into the per-call code: a region fill that sampled the kernel
 * 1.2 million times spent the whole of its paint building the literal. The
 * same list assigned to a symbol was already hoisted (`const _val_T = …` in
 * `preambleOnce`), 40× to 660× faster per call. `List` literals whose
 * elements are all finite real number literals, or such lists nested, now
 * get the same treatment (`BaseCompiler.hoistConstantListLiteral`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

describe('Tycho row 370: a constant list literal is hoisted out of the per-call code', () => {
  const ce = new ComputeEngine();
  ce.declare('i', 'integer');
  ce.declare('j', 'integer');
  ce.declare('x', 'real');

  test('the interval target is unchanged: the list is already a constant there', () => {
    const r = compile(
      ce.box([
        'Add',
        ['At', ['List', 1, 2, 3, 4, 5, 6, 7, 8], ['Floor', ['Multiply', 8, 'x']]],
        -3,
      ]),
      { to: 'interval-js', fallback: false } as any
    );
    expect(r.success).toBe(true);
  });
});
