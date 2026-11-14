import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// `isTransitivelyPure()` reads the canonical form of a value that is not
// canonical. When that canonical form is not canonical either, `.canonical`
// gives a new object at each read, so the walk never ended: the read of `r`
// after `let r = …` did not return. Such a value is now read as impure (not
// memoized), and the read gives what the same expression written in place
// gives.
//
// The library operators no longer give such a value: a call whose
// collection operand is a function (`Map(t, x ↦ 2x)`, `Map(Sin, Cos)`) is a
// canonical type error. The example is an operator whose `canonical` handler
// returns `null` for every call: the boxing then keeps the call as written
// (`box.ts`, the call with its required operands after a declined handler),
// and its canonical form is that same raw call again.
//

function engineWithDecliningOperator(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('Raw', { signature: '(any) -> any', canonical: () => null });
  return ce;
}

describe('A STORED VALUE WHOSE CANONICAL FORM IS NOT CANONICAL', () => {
  test('the example is not canonical, and neither is its canonical form', () => {
    const ce = engineWithDecliningOperator();
    const value = ce.box(['Raw', 1]);
    expect(value.isCanonical).toBe(false);
    expect(value.canonical.isCanonical).toBe(false);
  });

  // The time bound is a hang guard: far above the time of the work and above
  // a stall of a worker in a full run; the walk that reads a new canonical
  // object at each step does not end.
  test('the read returns, as the expression written in place does', () => {
    const start = Date.now();
    const held = executeEpsil(
      engineWithDecliningOperator(),
      'let r = Raw(1)\nLength(r)'
    ).value.json;
    const inPlace = executeEpsil(
      engineWithDecliningOperator(),
      'Length(Raw(1))'
    ).value.json;
    expect(held).toEqual(inPlace);
    expect(held).toEqual(['Length', ['Raw', 1]]);
    expect(Date.now() - start).toBeLessThan(30_000);
  }, 60_000);

  test('the engine route', () => {
    const ce = engineWithDecliningOperator();
    ce.box(['Assign', 'r', ['Raw', 1]]).evaluate();
    expect(ce.box('r').evaluate().operator).toBe('Raw');
  }, 5000);
});
