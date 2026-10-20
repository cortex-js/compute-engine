import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

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
    const start = Date.now();
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
    expect(Date.now() - start).toBeLessThan(4000);
  }, 5000);

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
