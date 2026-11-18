/**
 * A block-local function that receives complex numbers.
 *
 * The block binds a local function once (`g = (a, b) => a + b`), and the
 * body of that binding is compiled in the lane of the parameter types of
 * its literal. A parameter with no complex type is a real number there, so
 * a call with `{re, im}` arguments used the real `+`, which joins two
 * objects as strings: `Reduce(L, g, 0)` over `[1 + i, 2]` gave the string
 * "[object Object][object Object][object Object]", where the interpreter
 * gives `3 + i`. Such a call is now a lane mismatch, as for an
 * engine-level function. In `mode: 'complex'` the local compiles in the
 * complex lane. In `mode: 'strict'` (the default) the compilation declines.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('h', ce.box(['Function', ['Multiply', 3, 'p'], 'p'] as any));
ce.assign('k', ce.box(['Function', ['Add', 'p', 'q'], 'p', 'q'] as any));

const local = (value: unknown, type = "'function'") => [
  ['Declare', 'g', type, value],
];
const add = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

/** The function of `L: list<complex>` whose body is the block `stmts`. */
function fn(...stmts: unknown[]) {
  return ['Function', ['Block', ...stmts], ['Typed', 'L', "'list<complex>'"]];
}

describe('A block-local function called with complex arguments', () => {

  test('strict mode declines a parameter that is not complex', () => {
    for (const body of [
      ['Reduce', 'L', 'g', 0],
      ['Map', 'g', 'L'],
      ['g', ['At', 'L', 1], ['At', 'L', 2]],
    ]) {
      const value =
        body[0] === 'Map' ? ['Function', ['Multiply', 2, 'a'], 'a'] : add;
      expect(() =>
        compile(ce.box(fn(...local(value), body) as any), {
          fallback: false,
          mode: 'strict',
        } as any)
      ).toThrow(/the input L of type list<complex>/);
    }
  });

});
