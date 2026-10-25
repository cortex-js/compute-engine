/**
 * A block local bound to the result of a call that returns a function
 * (`let a = mk(2)` with `function mk(n) { (x) => x + n }`) is called as the
 * function it holds at run time (CE-225). Before the fix the call `a(1)`
 * failed the compilation with "Unknown operator `a`". The literals that the
 * callee returns give the signature of the call; when they do not agree, or
 * when the callee does not return a function literal on every path, the
 * call declines with a reason.
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

function both(source: string, to = 'javascript') {
  const interpreted = program(new ComputeEngine(), source)
    .evaluate()
    .toString();
  const result = compile(program(new ComputeEngine(), source), {
    to,
    fallback: false,
  } as never)!;
  if (result.success === false) throw new Error(String(result.error));
  return { interpreted, compiled: result.run!({} as never) };
}

describe('COMPILE a call of a function returned by a call', () => {
  it('calls the function that a `function` definition returns', () => {
    const r = both('function mk(n) { (x) => x + n }\nlet a = mk(2)\na(1)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBe(3);
  });

  it('calls the function returned from a branch', () => {
    const r = both(
      'function mk(n) { if n > 0 { (x) => x + n } else { (x) => x - n } }\n' +
        'let a = mk(2)\nlet b = mk(-5)\n(a(1), b(1))'
    );
    expect(r.interpreted).toBe('(3, 6)');
    expect(r.compiled).toEqual([3, 6]);
  });

  it('calls the function that a `const` lambda returns', () => {
    const r = both('const mk = (n) => (x) => x + n\nlet a = mk(2)\na(1)');
    expect(r.interpreted).toBe('3');
    expect(r.compiled).toBe(3);
  });

  it('broadcasts the returned function over a list, as the interpreter does', () => {
    const r = both(
      'function mk(n) { (x) => x * n }\nlet a = mk(3)\na([1, 2, 4])'
    );
    expect(r.interpreted).toBe('[3,6,12]');
    expect(r.compiled).toEqual([3, 6, 12]);
  });

  it('reads the binding that a reassignment wrote', () => {
    const r = both(
      'const mk = (n) => (x) => x + n\nlet a = mk(2)\na = mk(10)\na(1)'
    );
    expect(r.interpreted).toBe('11');
    expect(r.compiled).toBe(11);
  });

  it('declines when the returned functions have different signatures', () => {
    expect(() =>
      both(
        'function mk(n) { if n > 0 { (x) => x + n } else { (x, y) => x - n } }\n' +
          'let a = mk(2)\na(1)'
      )
    ).toThrow(
      /value of `a` is a function returned by a call.*different signatures/
    );
  });

  it('declines when the callee does not return a function on every path', () => {
    expect(() =>
      both(
        'function mk(n) { if n > 0 { (x) => x + n } else { 5 } }\n' +
          'let a = mk(2)\na(1)'
      )
    ).toThrow(/does not return a function literal on every path/);
  });

  it('declines on interval-js, which reads no function value at run time', () => {
    expect(() =>
      both(
        'function mk(n) { (x) => x * n }\nlet a = mk(3)\na(2)',
        'interval-js'
      )
    ).toThrow(/or from the result of a call/);
  });
});

// Found while working on CE-225: arithmetic on a block-local function value
// (`g + 1`) compiled to JavaScript `+` on a function, which answered the
// string "(_tv2) => …1" (and `2 * g` answered `null`). The interpreter keeps
// the expression symbolic. The compilation now declines.
describe('COMPILE arithmetic on a function value', () => {
  it('declines `g + 1` and `2 * g`', () => {
    expect(() => both('const g = (x) => x + 2\ng + 1')).toThrow(
      /operand `g` is a function/
    );
    expect(() => both('const g = (x) => x + 2\n2 * g')).toThrow(
      /operand `g` is a function/
    );
  });

  it('compiles a parameter that shadows the local function', () => {
    const r = both('const g = (x) => x + 2\nconst h = (g) => g + 1\nh(3)');
    expect(r.interpreted).toBe('4');
    expect(r.compiled).toBe(4);
  });
});
