import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isTransitivelyPure } from '../../src/compute-engine/boxed-expression/transitive-purity';

/**
 * `isTransitivelyPure()` follows what an evaluation reads: the values of
 * the symbols, the bodies of the user functions and the sources of a
 * sequence. It is the one purity walker of the engine: the `.N()`
 * arithmetic, the exact-value rescues and the sequences use it.
 */

/** The boxed operands of a store-backed list, or `undefined` when they
 * were never made (`BoxedFunction._opsStorage`). */
function boxedOperands(list: Expression): unknown {
  return (list as unknown as { _opsStorage: unknown })._opsStorage;
}

describe('TRANSITIVE PURITY', () => {
  test('a number and a symbol with no value are pure', () => {
    const ce = new ComputeEngine();
    expect(isTransitivelyPure(ce.number(2))).toBe(true);
    expect(isTransitivelyPure(ce.symbol('x'))).toBe(true);
    expect(isTransitivelyPure(ce.box(['Add', 'x', 1]))).toBe(true);
  });

  test('a value that calls an impure function is impure', () => {
    const ce = new ComputeEngine();
    ce.declare('r', { value: ce.box(['Random'], { form: 'raw' }) });
    ce.parse('f := t \\mapsto t + \\operatorname{Random}()').evaluate();
    ce.declare('w', { value: ce.box(['f', 2], { form: 'raw' }) });
    expect(isTransitivelyPure(ce.symbol('r'))).toBe(false);
    expect(isTransitivelyPure(ce.symbol('w'))).toBe(false);
    expect(isTransitivelyPure(ce.box(['Add', 'w', 1]))).toBe(false);
  });

  test('a value that reads an impure sequence is impure', () => {
    // The value of `u` is not canonical: its symbol `S` has no definition
    // until the value is canonicalized, as an evaluation does.
    const ce = new ComputeEngine();
    ce.declareSequence('S', {
      base: { 0: 0 },
      recurrence: 'S_{n-1} + \\operatorname{Random}()',
    });
    ce.declare('u', { value: ce.box(['Subscript', 'S', 3], { form: 'raw' }) });
    expect(isTransitivelyPure(ce.box(['Subscript', 'S', 3]))).toBe(false);
    expect(isTransitivelyPure(ce.symbol('u'))).toBe(false);
  });

  test('two values that read each other', () => {
    const ce = new ComputeEngine();
    ce.declare('a', { value: ce.box(['Add', 'b', 1], { form: 'raw' }) });
    ce.declare('b', { value: ce.box(['Add', 'a', 1], { form: 'raw' }) });
    expect(isTransitivelyPure(ce.symbol('a'))).toBe(true);
  });

  test('the elements of a store-backed list are not made', () => {
    // A read of the operands of a list that `ce.list()` made makes an
    // expression for each element. Its elements are numbers, which are
    // pure, so the walk does not read them.
    const ce = new ComputeEngine();
    const list = ce.list(Array.from({ length: 1000 }, (_, i) => i));
    ce.assign('L', list);
    expect(ce.symbol('L').value).toBe(list);
    expect(isTransitivelyPure(list)).toBe(true);
    expect(isTransitivelyPure(ce.symbol('L'))).toBe(true);
    expect(isTransitivelyPure(ce.box(['Add', 'L', 1]))).toBe(true);
    expect(boxedOperands(list)).toBeUndefined();
  });
});
