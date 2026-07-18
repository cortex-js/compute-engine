import { ComputeEngine } from '../../src/compute-engine';

/**
 * Step-2 phase D of the `broadcastable<T>` typing lift: the JavaScript compile
 * target routes a `broadcastable<T>`-typed operand through the `_SYS.bcast`
 * runtime helper, which is correct for BOTH runtime outcomes (a scalar OR an
 * indexed collection). The GPU/interval targets are unchanged — they keep
 * compiling such an operand as a scalar slot.
 *
 * A `broadcastable<T>`-typed operand is produced here by declaring a symbol
 * `broadcastable<number>` (a symbol *declared* broadcastable triggers
 * `isPossiblyCollectionTyped`), which — unlike an unknown-return function call
 * — also compiles to a free `vars` lookup, so the compiled artifact can be
 * exercised with either a scalar or an array binding at run time.
 */

function jsCompile(setup: (ce: ComputeEngine) => any) {
  const ce = new ComputeEngine();
  const expr = setup(ce);
  return ce.getCompilationTarget('javascript')!.compile(expr);
}

describe('broadcastable<T> — JavaScript compile target', () => {
  test('1. broadcastable operand emits _SYS.bcast; scalar binding gives the scalar result', () => {
    const r = jsCompile((ce) => {
      ce.declare('b', 'broadcastable<number>');
      return ce.box(['Subtract', ['Multiply', 2, 'b'], 1]); // 2b - 1
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.bcast');
    // Scalar-returning binding through the bcast path.
    expect(r.run!({ b: 5 })).toBe(9);
  });

  test('2. scalar runtime value passes through bcast unchanged', () => {
    const r = jsCompile((ce) => {
      ce.declare('b', 'broadcastable<number>');
      return ce.box(['Add', ['Multiply', 3, 'b'], 2]); // 3b + 2
    });
    // bcast applies `f` directly when no argument is an array — so a scalar
    // binding yields exactly the plain scalar computation.
    expect(r.run!({ b: 4 })).toBe(14);
    expect(r.run!({ b: 0 })).toBe(2);
  });

  test('3b. fixed-shape broadcast chain compiles end-to-end (Tycho item 31)', () => {
    // `2·sin(3·[x,y])`: the inner product types `vector<2>`, so every scalar
    // -function hop must type `list<number>` (not collapse to scalar) for the
    // compile pipeline to lower the whole chain through `_SYS.bcast`. Before
    // the fixed-shape wrapper trigger, `Sin(3·[x,y])` typed scalar `number`
    // and the compiled chain returned a silent wrong result behind
    // `success: true`.
    const r = jsCompile((ce) =>
      ce.box(['Multiply', 2, ['Sin', ['Multiply', 3, ['List', 'x', 'y']]]])
    );
    expect(r.code).toContain('_SYS.bcast');
    const out = r.run!({ x: 0.5, y: 1.0 }) as number[];
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(2 * Math.sin(1.5), 12);
    expect(out[1]).toBeCloseTo(2 * Math.sin(3), 12);
  });

  test('3. array runtime value broadcasts element-wise, matching the interpreter', () => {
    const r = jsCompile((ce) => {
      ce.declare('b', 'broadcastable<number>');
      return ce.box(['Subtract', ['Multiply', 2, 'b'], 1]); // 2b - 1
    });
    const out = r.run!({ b: [1, 2, 3] });
    expect(out).toEqual([1, 3, 5]);

    // Independent interpreter reference on the same expression.
    const ce2 = new ComputeEngine();
    ce2.assign('b', ce2.box(['List', 1, 2, 3]));
    expect(ce2.box(['Subtract', ['Multiply', 2, 'b'], 1]).evaluate().toString()).toBe(
      '[1,3,5]'
    );
  });

  test('4. Multiply with >=2 possibly-collection operands lowers to the rank-dispatching _SYS.mul (Tycho item 34)', () => {
    // A possibly-collection operand (declared `broadcastable<number>` or a
    // top-typed application) could materialize as a scalar, a vector, OR a
    // matrix at run time — where the interpreter contracts (matrix product)
    // rather than Hadamards. With >=2 arrayish operands the shape is unprovable
    // at compile time, so instead of failing closed the target emits the
    // interpreter-faithful `_SYS.mul`, which dispatches on runtime rank. No
    // shape silently diverges.
    const r = jsCompile((ce) => {
      ce.declare('p', 'broadcastable<number>');
      ce.declare('q', 'broadcastable<number>');
      return ce.box(['Multiply', 'p', 'q']);
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.mul');
    // scalar·scalar
    expect(r.run!({ p: 3, q: 4 })).toBe(12);
    // equal-length rank-1 vectors → Hadamard (Issue #29), not the dot product
    expect(r.run!({ p: [1, 2, 3], q: [4, 5, 6] })).toEqual([4, 10, 18]);
    // scalar·vector → scale
    expect(r.run!({ p: 2, q: [4, 5, 6] })).toEqual([8, 10, 12]);
    // matrix·matrix → contract (NOT Hadamard) — the item-19 divergence the old
    // fail-closed guarded against, now handled correctly at run time.
    expect(
      r.run!({
        p: [
          [1, 2],
          [3, 4],
        ],
        q: [
          [5, 6],
          [7, 8],
        ],
      })
    ).toEqual([
      [19, 22],
      [43, 50],
    ]);

    // Independent interpreter reference for the matrix case. `_SYS.mul` mirrors
    // the interpreter's `mulTensors` (matrix product), the path taken for a
    // matrix *literal*, a matrix-returning function application (Tycho's actual
    // operand shape, `b(7)·b(13)`), and — since the `skipBroadcastForVectorOps`
    // matrix-typed-symbol fix — a symbol statically typed `matrix`. The only
    // residual interpreter divergence is a `broadcastable<number>` symbol *bound
    // to a matrix* at run time, an ill-typed input (a rank-2 value in a rank≤1
    // type) that the interpreter still Hadamards; `_SYS.mul` contracts it, which
    // is the well-typed answer. Use the application form here so the reference
    // exercises the matrix-product path unambiguously.
    const ce2 = new ComputeEngine();
    ce2.declare('w', '(number) -> unknown');
    ce2.assign('w', ce2.parse('n \\mapsto [[n, n + 1],[n + 2, n + 3]]'));
    // w(1) = [[1,2],[3,4]], w(5) = [[5,6],[7,8]]
    expect(
      ce2.box(['Multiply', ['w', 1], ['w', 5]]).evaluate().toString()
    ).toBe('[[19,22],[43,50]]');
  });

  test('4b. Multiply mixing a TOP-TYPED application with a broadcastable operand lowers to _SYS.mul', () => {
    // A bound top-typed application (`At(v, 1)` over `list<any>` types `any`) is
    // admitted as possibly-collection by the widened gate; with >=2 arrayish
    // operands the Multiply lowers to `_SYS.mul` just like two declared
    // `broadcastable` operands. Here `At(v, 1)` selects a row vector, which is
    // then Hadamard-multiplied with the broadcastable operand at run time.
    const r = jsCompile((ce) => {
      ce.declare('v', 'list<any>');
      ce.declare('p', 'broadcastable<number>');
      return ce.box(['Multiply', ['At', 'v', 1], 'p']);
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.mul');
    // v = [[1,2,3], …]; At(v,1) = [1,2,3]; p = [4,5,6] → Hadamard [4,10,18].
    expect(
      r.run!({
        v: [
          [1, 2, 3],
          [9, 9, 9],
        ],
        p: [4, 5, 6],
      })
    ).toEqual([4, 10, 18]);
  });

  test('broadcastable<complex> fails closed (declined broadcast, D6 throw)', () => {
    // The bare element parameters of the bcast closure cannot carry complex
    // scalar codegen, so `tryCompileBroadcast` declines a complex-element
    // broadcast. Since the operand may be an array at run time, the D6 guard now
    // fails closed rather than emitting scalar codegen that would be garbage on
    // an array binding.
    expect(() =>
      jsCompile((ce) => {
        ce.declare('bc', 'broadcastable<complex>');
        return ce.box(['Add', ['Multiply', 2, 'bc'], 1]);
      })
    ).toThrow(/Fail closed/);
  });

  test('Equal over a broadcastable operand lowers to _SYS.eq (Tycho item 41)', () => {
    // Previously failed closed (a raw `Math.abs(array - scalar)` would be NaN
    // garbage). The binary form now lowers to the interpreter-faithful runtime
    // dispatch: a scalar binding gives a tolerant boolean, an array binding
    // gives the element-wise array of booleans (matching `[1,4,4] = 4` →
    // `[False, True, True]` in the interpreter).
    const r = jsCompile((ce) => {
      ce.declare('b', 'broadcastable<number>');
      return ce.box(['Equal', ['Multiply', 2, 'b'], 4]); // 2b = 4
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.eq');
    expect(r.run!({ b: 2 })).toBe(true);
    expect(r.run!({ b: 3 })).toBe(false);
    expect(r.run!({ b: [1, 2, 3] })).toEqual([false, true, false]);
  });

  test('NotEqual over a broadcastable operand lowers to _SYS.neq (Tycho item 41)', () => {
    const r = jsCompile((ce) => {
      ce.declare('b', 'broadcastable<number>');
      return ce.box(['NotEqual', ['Multiply', 2, 'b'], 4]);
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.neq');
    expect(r.run!({ b: 2 })).toBe(false);
    expect(r.run!({ b: 3 })).toBe(true);
    expect(r.run!({ b: [1, 2, 3] })).toEqual([true, false, true]);
  });
});

describe('broadcastable<T> — GPU targets keep scalar-slot compilation', () => {
  test('5. glsl compiles a broadcastable operand as a scalar slot (unchanged)', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'broadcastable<number>');
    const expr = ce.box(['Subtract', ['Multiply', 2, 'b'], 1]);
    const r = ce.getCompilationTarget('glsl')!.compile(expr);
    expect(r.success).toBe(true);
    // No _SYS.bcast (a JS-only construct); a plain scalar-slot expression.
    expect(r.code).not.toContain('bcast');
    expect(r.code).toBe('2.0 * b + -1.0');
  });

  test('wgsl compiles a broadcastable operand as a scalar slot (unchanged)', () => {
    const ce = new ComputeEngine();
    ce.declare('b', 'broadcastable<number>');
    const expr = ce.box(['Subtract', ['Multiply', 2, 'b'], 1]);
    const r = ce.getCompilationTarget('wgsl')!.compile(expr);
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('bcast');
    expect(r.code).toBe('2.0 * b + -1.0');
  });
});
