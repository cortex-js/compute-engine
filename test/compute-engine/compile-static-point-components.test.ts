import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A POINT — a numeric tuple — states its width in its type, so arithmetic
// over points whose every operand is a point of that width, or a scalar
// where the interpreter admits one, is emitted component by component on the
// `javascript` target, and the inner product of two such points is written
// out as the sum of the component products. Before this, a tuple-typed CALL
// (a user function returning a point) plus a literal point went through the
// `_SYS.bcast` run-time dispatch, and every `Dot` through `_SYS.matmul`.
//
// The point rules follow the interpreter: a point summed with a scalar is an
// `incompatible-type` error there, so that shape fails closed instead of
// answering a plausible array.
//
// Every block checks the emitted TEXT and the VALUE the compiled function
// returns against what the interpreter answers for the same input.

/** A fresh engine per block: a declaration must not leak between blocks. */
function newEngine(declarations: Record<string, string> = {}): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(declarations))
    ce.declare(name, type as any);
  return ce;
}

describe('point arithmetic fans out by the width of the tuple type', () => {

  test('a point summed with a scalar fails closed', () => {
    // `(x, y) + 3` is an `incompatible-type` error in the interpreter for
    // whatever `x` and `y` hold. It used to compile to `_SYS.bcast` and run to
    // `[3.3, 3.7]`.
    const ce = newEngine();
    // Once the types of `x` and `y` are up to date, the sum is found invalid
    // before its lowering ("Cannot compile invalid expression: …
    // incompatible-type").
    expect(() => compile(ce.parse('(x,y)+3'), { fallback: false })).toThrow(
      /could not compile/i
    );
    expect(compile(ce.parse('(x,y)+3')).success).toBe(false);
    expect(ce.parse('(x,y)+3').subs({ x: 0.3, y: 0.7 }).N().operator).toBe(
      'Error'
    );
  });

});

