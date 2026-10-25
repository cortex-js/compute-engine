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
  const result = compile(program(new ComputeEngine(), source), {
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

  it('JavaScript still declines for an argument that can be a list', () => {
    // The compiled call maps over a list argument, and the interpreter binds
    // it whole, so the two values differ when `x` is a list.
    expect(() => compiled(F + 'f(x)[1]', 'javascript', { x: 3 })).toThrow(
      /first operand is not an indexed collection/
    );
  });
});
