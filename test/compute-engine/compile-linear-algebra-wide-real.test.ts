import { ComputeEngine, compile } from '../../src/compute-engine';

function js(expr: any, mode: string = 'strict'): any {
  return compile(expr, { to: 'javascript', mode, fallback: false } as any);
}

// A collection read on the real lane is passed to the compiled code as it
// is: the runner does not read its entries and does not copy a typed array
// into a plain array. Until the user's decision of 2026-10-13 the runner
// walked every entry on each call and threw a diagnostic that named the
// binding and the complex or non-numeric entry; the walk was removed because
// its cost grew with the data (Tycho ledger row 371). The caller now supplies
// plain arrays with real entries, or declares the entries `complex`.
describe('A COLLECTION READ ON THE REAL LANE IS NOT CHECKED ENTRY BY ENTRY', () => {
  // The same holds outside the linear-algebra heads: an element read of a
  // `number`-typed list added to 1 computes with the complex object as plain
  // JavaScript would, and the result is not specified.
  it('At(L, 1) + 1 over a list<number> bound to a complex entry is not refused', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 1], 1]));
    expect(result.run({ L: [2, 3] })).toBe(3);
    expect(() => result.run({ L: [{ re: 1, im: 2 }, 3] })).not.toThrow();
  });

  it('a list<number> entry that the code does not read has no effect, whatever it holds', () => {
    // The runner does not read the entries, so a string or an absent entry
    // that the compiled code does not read changes nothing.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const result = js(ce.box(['Add', ['At', 'L', 2], 1]));
    expect(result.run({ L: ['a', 2] })).toBe(3);
    expect(result.run({ L: [undefined, 2] })).toBe(3);
  });
});
