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
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function program(ce: ComputeEngine, source: string) {
  const [ast] = parseEpsil(source, {
    parseLatex: (latex: string) => ce.parse(latex).json,
  });
  return ce.box(ast as never);
}

function both(source: string) {
  const interpreted = program(new ComputeEngine(), source)
    .evaluate()
    .toString();
  const result = compile(program(new ComputeEngine(), source), {
    to: 'javascript',
    fallback: false,
  } as never)!;
  return { interpreted, compiled: result.run!({} as never) };
}

const H = 'function h(q: tuple<number, number>) { q[1] + 1 }\n';

describe('COMPILE a list of points at a bare parameter', () => {
  it('a `let` local list', () => {
    const r = both(
      H + 'const g = (p) => h(p)\nlet xs = [(1, 2), (3, 4)]\ng(xs)'
    );
    expect(r.interpreted).toBe('[2,4]');
    expect(r.compiled).toEqual([2, 4]);
  });

  it('a list literal', () => {
    const r = both(H + 'const g = (p) => h(p)\ng([(1, 2), (3, 4)])');
    expect(r.interpreted).toBe('[2,4]');
    expect(r.compiled).toEqual([2, 4]);
  });

  it('with another argument', () => {
    const r = both(
      H + 'const g = (p, k) => h(p) * k\nlet xs = [(1, 2), (3, 4)]\ng(xs, 10)'
    );
    expect(r.interpreted).toBe('[20,40]');
    expect(r.compiled).toEqual([20, 40]);
  });

  it('a local of the caller with the name of the parameter is not captured', () => {
    const r = both(
      H +
        'const g = (p) => h(p)\nlet xs = [(1, 2), (3, 4)]\nlet p = 5\ng(xs) + p'
    );
    expect(r.interpreted).toBe('[7,9]');
    expect(r.compiled).toEqual([7, 9]);
  });

  it('a `let` local list at an annotated point parameter', () => {
    const r = both(H + 'let xs = [(1, 2), (3, 4)]\nh(xs)');
    expect(r.interpreted).toBe('[2,4]');
    expect(r.compiled).toEqual([2, 4]);
  });
});

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

  it('a free symbol holding the list', () => {
    const ce = engine();
    ce.declare('xs', 'list<tuple<number, number>>');
    const result = compile(ce.box(['g', 'xs']), {
      to: 'javascript',
      fallback: false,
    });
    const xs = [
      [1, 2],
      [3, 4],
    ];
    expect(result.run!({ xs } as never)).toEqual([2, 4]);
    ce.assign('xs', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    expect(ce.box(['g', 'xs']).evaluate().toString()).toBe('[2,4]');
  });

  it('a list literal', () => {
    const ce = engine();
    const expr = ce.box(['g', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]]);
    const result = compile(expr, { to: 'javascript', fallback: false });
    expect(result.run!({} as never)).toEqual([2, 4]);
    expect(expr.evaluate().toString()).toBe('[2,4]');
  });

  it('one point still compiles as a call of the definition', () => {
    const ce = engine();
    const expr = ce.box(['g', ['Tuple', 5, 6]]);
    const result = compile(expr, { to: 'javascript', fallback: false });
    expect(result.run!({} as never)).toBe(6);
    expect(expr.evaluate().toString()).toBe('6');
  });
});
