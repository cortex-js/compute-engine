/**
 * An index into the tuple that a block-local function returns (CE-236):
 * `const f = (u) => (u + 1, 2)` then `f(x)[1]`. The engine types the call
 * `f(x)` as `unknown`, and the `At` lowering of interval-js read that type
 * and declined with "first operand is not an indexed collection". The call
 * is now given the result type of the literal.
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

function compiled(source: string, to: string, vars: Record<string, unknown>) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real | list<real>');
  const result = compile(program(ce, source), {
    to,
    fallback: false,
  } as never)!;
  if (result.success === false) throw new Error(String(result.error));
  return result.run!(vars as never);
}

/** The interpreter's value of `source`, with `x` bound by a `let`. */
function interpreted(source: string, x: number): string {
  return program(new ComputeEngine(), `let x = ${x}\n${source}`)
    .evaluate()
    .toString();
}

const F = 'const f = (u) => (u + 1, 2)\n';

describe('COMPILE an index into the tuple a block-local function returns', () => {
  it('interval-js reads the component', () => {
    const source = F + 'f(x)[1]';
    expect(interpreted(source, 3)).toBe('4');
    expect(compiled(source, 'interval-js', { x: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 4, hi: 4 },
    });
  });

  it('interval-js reads the second component', () => {
    const source = F + 'f(x)[2] + f(x)[1]';
    expect(interpreted(source, 3)).toBe('6');
    expect(compiled(source, 'interval-js', { x: 3 })).toEqual({
      kind: 'interval',
      value: { lo: 6, hi: 6 },
    });
  });

  it('JavaScript reads the component for a number argument', () => {
    const source = F + 'f(3)[1] + f(4)[2]';
    expect(interpreted(source, 0)).toBe('6');
    expect(compiled(source, 'javascript', {})).toBe(6);
  });

  it('JavaScript compiles an argument declared as a number or a list', () => {
    // `x` is declared `real | list<real>`, so the compiled code tests the
    // shape of `x` once and holds one body for each shape. A number goes to
    // `f` directly; a list maps `f` over its elements, and `[1]` then reads
    // the first element of the resulting list of points. The interpreter does
    // the same, so the compiled value equals the interpreter's for a value of
    // each shape.
    const index1 = F + 'f(x)[1]';
    const index2 = F + 'f(x)[2]';
    const interp = (source: string, x: string) =>
      program(new ComputeEngine(), `let x = ${x}\n${source}`)
        .evaluate()
        .toString();
    expect(compiled(index1, 'javascript', { x: 3 })).toBe(4);
    expect(interp(index1, '3')).toBe('4');
    expect(compiled(index1, 'javascript', { x: [1, 2] })).toEqual([2, 2]);
    expect(interp(index1, '[1, 2]')).toBe('(2, 2)');
    expect(compiled(index2, 'javascript', { x: 3 })).toBe(2);
    expect(interp(index2, '3')).toBe('2');
    expect(compiled(index2, 'javascript', { x: [1, 2] })).toEqual([3, 2]);
    expect(interp(index2, '[1, 2]')).toBe('(3, 2)');
  });
});
