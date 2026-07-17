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

  test('4. Multiply with >=2 broadcastable operands fails closed (D6 throw)', () => {
    // A broadcastable operand could materialize as a matrix at run time, where
    // the interpreter would contract (matrix product) rather than Hadamard.
    // With >=2 arrayish operands and any broadcastable-typed, the shape is
    // unprovable, so `tryCompileBroadcast` declines — and the widened D6 guard
    // (which now matches possibly-collection-typed operands) fails closed rather
    // than letting the scalar path emit `p * q` list garbage behind
    // `success: true`. Codegen throws; the engine-level `compile()` catches it
    // and falls back to the interpreter.
    expect(() =>
      jsCompile((ce) => {
        ce.declare('p', 'broadcastable<number>');
        ce.declare('q', 'broadcastable<number>');
        return ce.box(['Multiply', 'p', 'q']);
      })
    ).toThrow(/Fail closed/);
  });

  test('4b. Multiply mixing a TOP-TYPED application with a broadcastable operand fails closed', () => {
    // A bound top-typed application (`At(v, 1)` over `list<any>` types `any`)
    // is admitted as possibly-collection by the widened gate; with >=2 arrayish
    // operands the shape (matrix contraction vs Hadamard) is unprovable, so the
    // Multiply carve-out declines for ANY possibly-collection operand — not
    // just declared-`broadcastable` ones — and compilation fails closed.
    expect(() =>
      jsCompile((ce) => {
        ce.declare('v', 'list<any>');
        ce.declare('p', 'broadcastable<number>');
        return ce.box(['Multiply', ['At', 'v', 1], 'p']);
      })
    ).toThrow(/Fail closed|cannot compile/);
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

  test('Equal over a broadcastable operand fails closed (D6 throw)', () => {
    // A `broadcastable<T>` operand may be an array at run time, where
    // `Math.abs(array - scalar)` is NaN garbage. `broadcastable<T>` is not a
    // subtype of `collection`, so `compileJSEquality` now has its own
    // possibly-collection gate — Equal/NotEqual fail closed instead of emitting
    // a wrong boolean behind `success: true`.
    expect(() =>
      jsCompile((ce) => {
        ce.declare('b', 'broadcastable<number>');
        return ce.box(['Equal', ['Multiply', 2, 'b'], 4]); // 2b = 4
      })
    ).toThrow(/Fail closed/);
  });

  test('NotEqual over a broadcastable operand fails closed (D6 throw)', () => {
    expect(() =>
      jsCompile((ce) => {
        ce.declare('b', 'broadcastable<number>');
        return ce.box(['NotEqual', ['Multiply', 2, 'b'], 4]);
      })
    ).toThrow(/Fail closed/);
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
