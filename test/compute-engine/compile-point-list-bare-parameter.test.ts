/**
 * A list of points at a bare parameter of a block-local function whose type
 * is inferred as one point from the body (CE-238). With
 * `function h(q: tuple<number, number>) { q[1] + 1 }` and
 * `const g = (p) => h(p)`, the interpreter binds the list whole to `p` and
 * maps at the call of `h`. The compiled body of `g` reads one point, so the
 * call `g(xs)` declined. It is now written with the body of `g`, so that the
 * call of `h` maps over the list.
 *
 * The file also covers a list of points held by a `let` local at a point
 * parameter: the compiled call passed the list whole and answered the string
 * "1,21", because the constant fold narrowed the type of the valueless local
 * to `never` before the call read it.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The same call of an engine-level function compiled the emitted definition
// for one point and answered the string "1,21" (a wrong value, not a
// decline). The call is inlined now.
describe('COMPILE a list of points at a bare parameter of an engine function', () => {
  function engine() {
    const ce = new ComputeEngine();
    ce.declare('h', '(tuple<number, number>) -> number');
    ce.assign('h', ce.box(['Function', ['Add', ['At', 'q', 1], 1], 'q']));
    ce.declare('g', 'function');
    ce.assign('g', ce.box(['Function', ['h', 'p'], 'p']));
    return ce;
  }

  it('one point still compiles as a call of the definition', () => {
    const ce = engine();
    const expr = ce.box(['g', ['Tuple', 5, 6]]);
    const result = compile(expr, { to: 'javascript', fallback: false });
    expect(result.run!({} as never)).toBe(6);
    expect(expr.evaluate().toString()).toBe('6');
  });
});
