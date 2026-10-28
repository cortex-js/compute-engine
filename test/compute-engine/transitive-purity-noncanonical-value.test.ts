import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { isTransitivelyPure } from '../../src/compute-engine/boxed-expression/transitive-purity';

//
// `isTransitivelyPure()` reads the canonical form of a value that is not
// canonical. The canonical form of `Map(t, x ↦ 2x)` (the arguments in the
// wrong order, `t` with no value) is not canonical either, and `.canonical`
// gives a new object at each read, so the walk never ended: the read of `r`
// after `r = Map(t, (x) => x * 2)` did not return. Such a value is now read
// as impure (not memoized), and the read gives what the same expression
// written in place gives.
//

describe('A STORED VALUE WHOSE CANONICAL FORM IS NOT CANONICAL', () => {
  test('the read returns, as the expression written in place does', () => {
    const held = executeEpsil(
      new ComputeEngine(),
      'r = Map(t, (x) => x * 2)\nLength(r)'
    ).value.json;
    const inPlace = executeEpsil(
      new ComputeEngine(),
      'Length(Map(t, (x) => x * 2))'
    ).value.json;
    expect(held).toEqual(inPlace);
    expect(held).toEqual([
      'Length',
      ['Map', 't', ['Function', ['Multiply', 'x', 2], 'x']],
    ]);
  }, 5000);

  test('the purity walk stops at a canonical form that is still noncanonical', () => {
    const ce = new ComputeEngine();
    const value = ce.box(
      ['Map', 't', ['Function', ['Multiply', 'x', 2], 'x']],
      { form: 'raw' }
    );
    const next = value.canonical;
    expect(next.isCanonical).toBe(false);
    let reads = 0;
    const canonical = jest
      .spyOn(value, 'canonical', 'get')
      .mockImplementation(() => {
        if (++reads > 1)
          throw new Error('Purity revisited a noncanonical value');
        return next;
      });
    try {
      expect(isTransitivelyPure(value)).toBe(false);
      expect(reads).toBe(1);
    } finally {
      canonical.mockRestore();
    }
  });

  test('the engine route', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      'r',
      ['Map', 't', ['Function', ['Multiply', 'x', 2], 'x']],
    ]).evaluate();
    expect(ce.box('r').evaluate().operator).toBe('Map');
  }, 5000);
});
