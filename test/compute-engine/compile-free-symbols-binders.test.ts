/**
 * The free symbols that `compile()` reports (`freeSymbols`) for names that
 * the program binds or that are not inputs (CE-232). The Epsil corpus report
 * reads a non-empty list as "the compiled program reads a symbol with no
 * value", and these programs were reported so although their compiled code
 * reads no input:
 *
 * - a library function passed by name (`reduce(1..20, lcm, 1)`: `LCM`);
 * - the index of a comprehension read by its condition (`k`);
 * - the leaves of a destructuring loop index (`for (value, letters) in …`);
 * - the absent bounds of an indefinite integral (`Nothing`), whose variable
 *   is the real input of the compiled antiderivative.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function compiled(source: string) {
  const ce = new ComputeEngine();
  const [ast] = parseEpsil(source);
  resolveLibraryNames(ast as never, source, ce);
  return compile(ce.box(ast as never), { to: 'javascript', fallback: false });
}

function interpreted(source: string): string {
  return String(executeEpsil(new ComputeEngine(), source).value);
}

describe('COMPILE: the free symbols of names a program binds', () => {
  it('a library function passed by name is not an input', () => {
    const source = 'reduce(1..20, lcm, 1)';
    const r = compiled(source);
    expect(r.freeSymbols).toEqual([]);
    expect(r.run!({} as never)).toBe(232792560);
    expect(interpreted(source)).toBe('232792560');
  });

  it('the condition of a comprehension reads the index', () => {
    const source = '[k for k in 1..30 if isOdd(sigma0(k))]';
    const r = compiled(source);
    expect(r.freeSymbols).toEqual([]);
    expect(r.run!({} as never)).toEqual([1, 4, 9, 16, 25]);
    expect(interpreted(source)).toBe('[1,4,9,16,25]');
  });

  it('a later clause of a comprehension reads an earlier index', () => {
    const source = '[(i, j) for i in 1..3, j in 1..i]';
    const r = compiled(source);
    expect(r.freeSymbols).toEqual([]);
    expect(r.run!({} as never)).toEqual([
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 1],
      [3, 2],
      [3, 3],
    ]);
    expect(interpreted(source)).toBe(
      '[(1, 1),(2, 1),(2, 2),(3, 1),(3, 2),(3, 3)]'
    );
  });

  it('the condition of a comprehension still reports a free symbol', () => {
    expect(compiled('[k for k in 1..5 if k > m]').freeSymbols).toEqual(['m']);
  });

  it('the leaves of a destructuring loop index are not inputs', () => {
    const source =
      'let t = [(1, 2), (3, 4)]\nlet s = 0\nfor (a, b) in t { s = s + a * b }\ns';
    const r = compiled(source);
    expect(r.freeSymbols).toEqual([]);
    expect(r.run!({} as never)).toBe(14);
    expect(interpreted(source)).toBe('14');
  });

  it('an indefinite integral reads its variable, not `Nothing`', () => {
    const r = compiled('integrate(x * e^x, x)');
    expect(r.freeSymbols).toEqual(['x']);
    expect(r.run!({ x: 1 } as never)).toBeCloseTo(0, 12);
    const ce = new ComputeEngine();
    // The interpreter's antiderivative `x e^x - e^x`, at x = 2.
    expect(
      ce.parse('\\int x e^x dx').evaluate().subs({ x: 2 }).N().re
    ).toBeCloseTo(Math.exp(2), 12);
    expect(r.run!({ x: 2 } as never)).toBeCloseTo(Math.exp(2), 12);
  });
});
