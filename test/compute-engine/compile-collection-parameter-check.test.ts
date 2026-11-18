
/**
 * Compiled code does not test at run time an argument at a parameter
 * declared with a list or tuple type: a value outside the type gives an
 * undefined result, where the interpreter gives an `incompatible-type`
 * error. A value of the declared type gives the interpreter's value. The
 * interpreter does not check the elements (`[1.5, 2]` at `list<integer>` is
 * accepted), and neither does compiled code.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// An annotated function literal applied directly is not tested at run time:
// a value outside the annotation gives an undefined result, and an argument
// whose static type does not prove an `integer` annotation declines.
describe('COMPILE an annotated literal applied directly', () => {
  const K = ['Function', ['Add', 'k', 1], ['Typed', 'k', "'integer'"]];

  it('a parameter declared `any` at a scalar annotation declines', () => {
    // `k: integer` is a scalar parameter: the call maps over a list and
    // binds a number. A value of `any` can be either, so the shape of the
    // call is not settled, and the compilation declines (rule R3 of
    // `docs/plans/2026-10-31-static-shape-compilation.md`). The argument
    // does not prove the `integer` annotation either.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Function',
      ['Apply', K, 'v'],
      ['Typed', 'v', { str: 'any' }],
    ] as never);
    expect(() =>
      compile(expr, { to: 'javascript', fallback: false })
    ).toThrow(/Could not compile/);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(false);
  });
});
