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
  test('Re((x + ib)²): one arrow at the top, none nested', () => {
    const ce = engine();
    const r = js(ce.parse('\\Re((x+\\imaginaryI b)^2)'));
    expect(arrowCount(r.code)).toBe(1);
    // The three operations — the imaginary product, the sum, the square — are
    // three `const` temporaries in one block, and the real part is read off
    // the last one.
    expect(r.code).toContain('const _tv2 = ({ re: 0, im: _.b });');
    expect(r.code).toContain('({ re: _tv2.re + _.x, im: _tv2.im })');
    expect(r.code).toContain(
      'const _tv1_1 = { re: _tv1.re * _tv1.re - _tv1.im * _tv1.im, im: 2 * (_tv1.re * _tv1.im) };'
    );
    expect(r.code).toContain('return _tv1_1.re;');
  });

  test('a compiled lambda body has no arrow function at all', () => {
    // A lambda's `code` IS the statement form — its body is a statement
    // position — so nothing is left to wrap. This is the shape the compiled
    // runner of an expression kernel also executes.
    const ce = engine();
    const r = compile(ce.parse('(x, b) \\mapsto \\Re((x+\\imaginaryI b)^2)'), {
      to: 'javascript',
      fallback: false,
    }) as unknown as {
      code: string;
      run: (x: number, b: number) => number;
    };
    expect(arrowCount(r.code)).toBe(0);
    expect(r.code.startsWith('(x, b) => {')).toBe(true);
    expect(r.run(2, 3)).toBe(-5); // Re((2 + 3i)²) = 4 − 9
  });

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
  // The last pair is an ABSENT/NaN operand: a compiled kernel answers NaN
  // exactly where the interpreter does.
  const POINTS: Array<[number, number]> = [
    [2, 3],
    [0.5, -1.25],
    [-3, 0.75],
    [2, NaN],
  ];
  test.each(CASES)('%s', (latex) => {
    const ce = engine();
    const e = ce.parse(latex);
    const r = js(e);
    for (const [x, b] of POINTS) {
      const expected = e.subs({ x, b }).N();
      const value = r.run({ x, b }) as number;
      if (Number.isNaN(b)) {
        expect(Number.isNaN(value)).toBe(true);
        expect(expected.isNaN).toBe(true);
        continue;
      }
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

  test('two impure factors stay two draws, bound in operand order', () => {
    const ce = engine();
    const r = js(
      ce.box([
        'Add',
        ['Multiply', 'z', ['Random']],
        ['Multiply', 'w', ['Random']],
      ])
    );
    expect(r.code.match(/drawNextRandomNumber/g)).toHaveLength(2);
    // Each draw is bound to its own temporary, and the binding of the first
    // operand's draw precedes the binding of the second one's — an operand
    // with an effect runs where the interpreter runs it.
    const draws = [
      ...r.code.matchAll(/const (_tv\d+) = _SYS\.drawNextRandomNumber\(\);/g),
    ];
    expect(draws).toHaveLength(2);
    expect(r.code.indexOf(draws[0][0])).toBeLessThan(
      r.code.indexOf(draws[1][0])
    );
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

describe('a complex factor known at compile time scales by constants', () => {
  test('i·b is { re: 0, im: b } — no multiplication by 0 or 1', () => {
    const ce = engine();
    const r = js(ce.box(['Multiply', 'ImaginaryUnit', 'b']));
    expect(r.code).toBe('({ re: 0, im: _.b })');
    expect(r.run({ b: 4 })).toEqual({ re: 0, im: 4 });
  });

  test('(3+2i)·x scales the one operand by the two constants', () => {
    const ce = engine();
    const r = js(ce.box(['Multiply', ['Complex', 3, 2], 'x']));
    expect(r.code).toContain('{ re: 3 * _tv1, im: 2 * _tv1 }');
    expect(r.run({ x: 4 })).toEqual({ re: 12, im: 8 });
  });

  test('x + i keeps the constant components out of the object', () => {
    const ce = engine();
    const r = js(ce.box(['Add', 'x', 'ImaginaryUnit']));
    expect(r.code).toBe('({ re: _.x, im: 1 })');
    expect(r.run({ x: 4 })).toEqual({ re: 4, im: 1 });
  });

  test('a negative constant scale is spelled as a negative literal', () => {
    const ce = engine();
    const r = js(ce.box(['Multiply', ['Complex', -3, 4], 'x']));
    // The two constants sit in the slots of an object literal, where a leading
    // minus sign cannot glue to a neighbouring operator, so the literal needs
    // no parentheses of its own.
    expect(r.code).toContain('{ re: -3 * _tv1, im: 4 * _tv1 }');
    expect(r.run({ x: 2 })).toEqual({ re: -6, im: 8 });
  });

  test('dropping the zero real part of `i` passes a negative zero through', () => {
    const ce = engine();
    const r = js(ce.box(['Add', 'x', 'ImaginaryUnit']));
    // The real part of `i` is the constant `0` and is dropped from the sum, so
    // the emitted real part is the operand itself. That is the one point where
    // the emitted code differs from an addition: keeping `_.x + 0` would turn
    // a negative zero into a positive one. No literal can bring a negative
    // zero here (the engine normalizes it when it boxes the number), so only a
    // value supplied at run time reaches this case.
    const value = r.run({ x: -0 }) as { re: number; im: number };
    expect(Object.is(value.re, -0)).toBe(true);
    expect(value.im).toBe(1);
  });

  test('a complex literal that is exactly zero is a REAL zero, and multiplies', () => {
    const ce = engine();
    // `Complex(0, 0)` is the real number `0`: its imaginary part is zero, so
    // the complex-valued test fails and the constant-scaling fold above is
    // never reached with two zero constants. The real arm keeps the
    // multiplication rather than collapsing it, so a non-finite operand still
    // answers `NaN`, as the interpreter does for `0 · NaN`.
    expect(ce.box(['Complex', 0, 0]).im).toBe(0);
    const r = js(ce.box(['Multiply', ['Complex', 0, 0], 'x']));
    expect(r.code).toBe('0 * _.x');
    expect(r.run({ x: NaN })).toBeNaN();
    expect(r.run({ x: Infinity })).toBeNaN();
  });
});
