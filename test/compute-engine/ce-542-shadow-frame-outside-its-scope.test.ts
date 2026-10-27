import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

// CE-542: canonicalizing a `Block` printed "error canonicalizing `Block`:
// Cannot read properties of undefined (reading 'parent')". Found by the Tycho
// document-open corpus run, on the Desmos state `g(x) with b = 1`, where `g`
// calls `f(x) = sin(b·x)`.
//
// While a `Block` (or a function literal) is canonicalized, the engine keeps
// a frame with the names it declares and the scope that encloses it (the
// boundary). A reference to such a name resolves to a binding below the
// boundary, never to an outer one. Here the block declares `b` and calls
// `f`. The call reads the signature of `f`, which is derived by boxing a
// typed copy of `f`'s literal in a new scope under the scope where `f` is
// defined (`resultUnderDeclaredParameters()`). That scope is not inside the
// block, but the block's frame was still read there: the free `b` of `f`'s
// body was taken for the block's local, and its resolution walked from a
// scope that the boundary does not enclose, past the root scope, whose
// parent was `undefined` where the walk tested for `null`. The typed copy
// failed, so the derived signature of `f` fell back to `(real) -> number`.
//
// The same block in the global scope did not print the error, because the
// global scope is an ancestor of every scope, but `b` was still taken for
// the block's local, with the same wrong signature.
//
// The same applied to a function stored as an operator definition (declared
// with `signature` and `evaluate`, then assigned a new literal), which
// derives its signature by the same boxing.
//
// Fix: the typed copy is boxed with no frame (`_withoutShadowedParameters()`,
// called by `resultUnderDeclaredParameters()` in
// `boxed-expression/declared-parameter-result.ts`); a frame applies only
// where its boundary is on the current scope chain (`_shadowFrame()`, `compute-engine/index.ts`);
// and the walks up the scope chain stop at a `null` or `undefined` parent.

function run(withScope: boolean, asOperator = false) {
  const ce = new ComputeEngine();
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    ce.declare('b', 'real');
    ce.assign('b', 2.3);
    ce.declare(
      'f',
      asOperator
        ? {
            signature: '(real) -> unknown',
            evaluate: ce.expr(['Function', 0, 'p']),
          }
        : { signature: '(real) -> unknown' }
    );
    ce.assign('f', ['Function', ['Sin', ['Multiply', 'b', 'p']], 'p']);
    const block = ce.expr(
      ['Block', ['Declare', 'b'], ['Assign', 'b', 1], ['f', 0.5]],
      withScope ? { scope: ce.createScope() } : undefined
    );
    return { ce, block, errors };
  } finally {
    console.error = original;
  }
}

// The type of the call `f(0.5)`, the last statement of the block.
function callType(block: ReturnType<typeof run>['block']): string {
  if (!isFunction(block)) throw new Error('expected a Block');
  return block.ops[2].type.toString();
}

describe('CE-542: a Block local does not shadow a name outside the Block', () => {
  test('a block in a host scope that calls a function reading the same name', () => {
    const { ce, block, errors } = run(true);
    expect(errors).toEqual([]);
    expect(block.isValid).toBe(true);
    // The signature derived from the body: `sin` of a real is real.
    expect(callType(block)).toBe('real');
    expect(ce.expr('f').type.toString()).toBe('(real) -> real');
    // `f` reads the `b` of the scope where it is defined (2.3), not the
    // block's local: sin(2.3 · 0.5).
    expect(block.evaluate().re).toBeCloseTo(Math.sin(1.15), 12);
  });

  test('the same block in the global scope', () => {
    const { block, errors } = run(false);
    expect(errors).toEqual([]);
    expect(callType(block)).toBe('real');
    expect(block.evaluate().re).toBeCloseTo(Math.sin(1.15), 12);
  });

  test('a function stored as an operator definition', () => {
    for (const withScope of [false, true]) {
      const { ce, block, errors } = run(withScope, true);
      // The route under test: `f` is still an operator definition.
      expect('operator' in ce.lookupDefinition('f')!).toBe(true);
      expect(errors).toEqual([]);
      expect(callType(block)).toBe('real');
      expect(block.evaluate().re).toBeCloseTo(Math.sin(1.15), 12);
    }
  });
});
