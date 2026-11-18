/**
 * The complex lane lowers to STRAIGHT-LINE STATEMENTS.
 *
 * Every complex `Add`, `Multiply`, `Divide`, `Power` and `Log` used to build
 * its result inside an immediately invoked arrow function, so an expression
 * `n` complex operations deep allocated and called `n` nested closures on
 * every evaluation. Each of those operations now binds its operands through
 * the JavaScript statement sink (`javascript-statements.ts`), which splices an
 * operand that is itself such a form as plain statements of the enclosing
 * block. A whole complex expression is therefore one block of `const`
 * temporaries.
 *
 * The kernel of an expression-position compile (`calling: 'expression'`) is by
 * contract an EXPRESSION, so its `code` still opens with one arrow function at
 * the very top — there is no statement position around it to lay the block
 * out in. What this file pins is that there is exactly one, at the top, with
 * no closure nested inside it. The compiled RUNNER is built from the statement
 * form directly and allocates no closure at all.
 *
 * The component reads (`Re`, `Im`, `arg`, `|·|`) and every `_SYS.c…` helper
 * call take their operand the same way, so `Re(sin(z²))` is one block too.
 */

import { ComputeEngine, compile } from '../../src/compute-engine';

/** Compile to JavaScript with no interpreter fallback. */
function js(expr: ReturnType<ComputeEngine['box']>) {
  const r = compile(expr, { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  return r as unknown as {
    code: string;
    run: (v: Record<string, unknown>) => unknown;
  };
}

function arrowCount(code: string): number {
  return code.match(/\(\(\) =>/g)?.length ?? 0;
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('b', 'real');
  ce.declare('z', 'complex');
  ce.declare('w', 'complex');
  return ce;
}

describe('a chain of complex operations is one block of statements', () => {
  test.each([
    ['\\Re((x+\\imaginaryI b)^2)', 'a power of a sum'],
    ['\\Im((x+\\imaginaryI b)^2)', 'the imaginary part of one'],
    ['\\left|(x+\\imaginaryI b)^3\\right|', 'a modulus of a cube'],
    ['\\arg((x+\\imaginaryI b)^2)', 'an argument'],
    ['\\Re(z(x+\\imaginaryI b))', 'a product of two complex values'],
    ['\\Re(\\frac{z}{x+\\imaginaryI b})', 'a quotient'],
    ['\\Re(\\ln_{2+\\imaginaryI}(x+\\imaginaryI b))', 'a complex-base log'],
    ['\\Re(\\sin((x+\\imaginaryI b)^2))', 'a transcendental of a chain'],
    ['\\Re((x+\\imaginaryI b)^2+(b+\\imaginaryI x)^2)', 'a sum of two chains'],
    ['\\Re((x+\\imaginaryI b)^{2.5})', 'a non-integer power'],
  ])('%s (%s) nests no arrow function', (latex) => {
    expect(arrowCount(js(engine().parse(latex)).code)).toBeLessThanOrEqual(1);
  });
});

describe('the value is the interpreter’s', () => {
  const CASES = [
    '\\Re((x+\\imaginaryI b)^2)',
    '\\Im((x+\\imaginaryI b)^2)',
    '\\left|(x+\\imaginaryI b)^3\\right|',
    '\\arg((x+\\imaginaryI b)^2)',
    '\\Re(\\frac{x+\\imaginaryI b}{2+\\imaginaryI x})',
    '\\Re(\\sin((x+\\imaginaryI b)^2))',
    '\\Re(\\ln_{2+\\imaginaryI}(x+\\imaginaryI b))',
  ];
  const POINTS: Array<[number, number]> = [
    [2, 3],
    [0.5, -1.25],
    [-3, 0.75],
  ];
  test.each(CASES)('%s', (latex) => {
    const ce = engine();
    const e = ce.parse(latex);
    const r = js(e);
    for (const [x, b] of POINTS) {
      const expected = e.subs({ x, b }).N();
      const value = r.run({ x, b }) as number;
      expect(value).toBeCloseTo(expected.re, 10);
    }
  });
});

describe('operands keep their evaluation order and are read once', () => {
  test('an impure factor is drawn exactly once', () => {
    const ce = engine();
    const r = js(ce.box(['Real', ['Multiply', 'z', ['Random']]]));
    expect(r.code.match(/drawNextRandomNumber/g)).toHaveLength(1);
    expect(typeof r.run({ z: { re: 2, im: 3 } })).toBe('number');
  });

  test('a symbol operand is read once per operation', () => {
    const ce = engine();
    const r = js(ce.box(['Real', ['Multiply', 'z', 'w']]));
    expect(r.code.match(/_\.z/g)).toHaveLength(1);
    expect(r.code.match(/_\.w/g)).toHaveLength(1);
    expect(r.run({ z: { re: 1, im: 2 }, w: { re: 3, im: -1 } })).toBeCloseTo(
      1 * 3 - 2 * -1,
      12
    );
  });
});
