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
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function compiled(source: string) {
  const ce = new ComputeEngine();
  ce.declare('m', 'real');
  ce.declare('x', 'real');
  const [ast] = parseEpsil(source);
  resolveLibraryNames(ast as never, source, ce);
  return compile(ce.box(ast as never), { to: 'javascript', fallback: false });
}

describe('COMPILE: the free symbols of names a program binds', () => {

  it('the condition of a comprehension still reports a free symbol', () => {
    expect(compiled('[k for k in 1..5 if k > m]').freeSymbols).toEqual(['m']);
  });
});
