/**
 * Compiled code tests at run time an argument at a parameter declared with
 * a list or tuple type (CE-226.2). The interpreter gives an
 * `incompatible-type` error for a number at a `list<number>` parameter and
 * for a tuple of three numbers at a `tuple<number, number>` parameter; the
 * compiled call ran the body on the value. It now answers `NaN`, the value
 * compiled code has where the interpreter answers an error (as for a value
 * outside an `integer` parameter). The interpreter does not check the
 * elements (`[1.5, 2]` at `list<integer>` is accepted), and neither does the
 * test.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** The interpreter's value with `v` bound by a `let`, and the compiled
 * value with `v` a free input declared `any`. */
function both(fn: string, literal: string, value: unknown) {
  const ce1 = new ComputeEngine();
  const [a1] = parseEpsil(`${fn}\nlet v = ${literal}\nf(v)`, {
    parseLatex: (l: string) => ce1.parse(l).json,
  });
  const interpreted = ce1
    .box(a1 as never)
    .evaluate()
    .toString();
  const ce2 = new ComputeEngine();
  ce2.declare('v', 'any');
  const [a2] = parseEpsil(`${fn}\nf(v)`, {
    parseLatex: (l: string) => ce2.parse(l).json,
  });
  const result = compile(ce2.box(a2 as never), {
    to: 'javascript',
    fallback: false,
  });
  return { interpreted, compiled: result.run!({ v: value } as never) };
}

describe('COMPILE a run-time check of a collection parameter', () => {
  it('a number at a `list<number>` parameter', () => {
    const r = both('function f(xs: list<number>) { 7 }', '5', 5);
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.compiled).toBeNaN();
  });

  it('a number at a `tuple<number, number>` parameter', () => {
    const r = both('function f(p: tuple<number, number>) { 7 }', '5', 5);
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.compiled).toBeNaN();
  });

  it('a tuple of three numbers at a `tuple<number, number>` parameter', () => {
    const r = both(
      'function f(p: tuple<number, number>) { p[1] + 1 }',
      '(1, 2, 3)',
      [1, 2, 3]
    );
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.compiled).toBeNaN();
  });

  it('a list and a tuple of the right shape pass', () => {
    const list = both(
      'function f(xs: list<number>) { xs[1] + 1 }',
      '[4, 5]',
      [4, 5]
    );
    expect(list.interpreted).toBe('5');
    expect(list.compiled).toBe(5);
    const tuple = both(
      'function f(p: tuple<number, number>) { p[2] + 1 }',
      '(4, 5)',
      [4, 5]
    );
    expect(tuple.interpreted).toBe('6');
    expect(tuple.compiled).toBe(6);
  });

  it('the elements are not checked, as in the interpreter', () => {
    const r = both(
      'function f(xs: list<integer>) { xs[1] + 1 }',
      '[1.5, 2]',
      [1.5, 2]
    );
    expect(r.interpreted).toBe('2.5');
    expect(r.compiled).toBe(2.5);
  });

  it('an engine-level function is checked through its shim', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(tuple<number, number>) -> number');
    ce.assign('g', ce.box(['Function', ['At', 'p', 1], 'p']));
    ce.declare('v', 'any');
    const expr = ce.box(['g', 'v']);
    const result = compile(expr, { to: 'javascript', fallback: false });
    expect(result.run!({ v: 5 } as never)).toBeNaN();
    expect(result.run!({ v: [3, 4] } as never)).toBe(3);
    ce.assign('v', 5);
    expect(expr.evaluate().toString()).toMatch(/incompatible-type/);
  });
});

// An annotated function literal applied directly is tested at run time
// (CE-226.3). Before, only an argument whose static type cannot match was
// refused, and `Apply((k: integer) ↦ k + 1, v)` gave 2.5 at `v = 1.5`.
describe('COMPILE a run-time check of an annotated literal applied directly', () => {
  function apply(fn: unknown, value: unknown, json: unknown) {
    const ce1 = new ComputeEngine();
    ce1.declare('v', 'any');
    const expr = ce1.box(['Apply', fn, 'v'] as never);
    ce1.assign('v', ce1.box(json as never));
    const interpreted = expr.evaluate().toString();
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'any');
    const result = compile(ce2.box(['Apply', fn, 'v'] as never), {
      to: 'javascript',
      fallback: false,
    });
    return { interpreted, compiled: result.run!({ v: value } as never) };
  }
  const K = ['Function', ['Add', 'k', 1], ['Typed', 'k', "'integer'"]];
  const P = [
    'Function',
    ['Add', ['At', 'p', 1], 1],
    ['Typed', 'p', "'tuple<number, number>'"],
  ];

  it('a value outside an `integer` annotation', () => {
    const r = apply(K, 1.5, 1.5);
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.compiled).toBeNaN();
    const ok = apply(K, 2, 2);
    expect(ok.interpreted).toBe('3');
    expect(ok.compiled).toBe(3);
  });

  it('a list maps, and each element is tested', () => {
    const r = apply(K, [1, 2.5], ['List', 1, 2.5]);
    expect(r.interpreted).toMatch(/^\[2,Error/);
    expect((r.compiled as number[])[0]).toBe(2);
    expect((r.compiled as number[])[1]).toBeNaN();
  });

  it('a tuple of the wrong length at a tuple annotation', () => {
    const r = apply(P, [1, 2, 3], ['Tuple', 1, 2, 3]);
    expect(r.interpreted).toMatch(/incompatible-type/);
    expect(r.compiled).toBeNaN();
    const ok = apply(P, [4, 5], ['Tuple', 4, 5]);
    expect(ok.interpreted).toBe('5');
    expect(ok.compiled).toBe(5);
  });

  it('a literal with no annotation is compiled once', () => {
    // The literal needs no run-time test, so it is compiled only for the
    // emitted call. A second, discarded compile allocated the temporaries of
    // the literal again: the accumulator of the sum was `_tv4`, not `_tv1`.
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Apply',
        [
          'Function',
          ['Sum', ['Multiply', 'k', 'j'], ['Limits', 'j', 1, 'n']],
          'k',
        ],
        'x',
      ] as never),
      { to: 'javascript', fallback: false }
    );
    expect(result.code).toContain('let _tv1 = 0;');
    expect(result.run!({ x: 2, n: 3 } as never)).toBe(12);
  });
});
