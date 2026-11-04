import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// A store into a symbol with a declared type accepts a value whose static
// type OVERLAPS the declared type, as a call accepts such an argument, and
// each read of the symbol tests the evaluated value against the declared
// type, as a call tests a bound argument. A value outside the declared type
// is an `incompatible-type` error at that read. A value whose type does not
// overlap the declared type, and a value made of literals and constants that
// does not fit, are refused at the store.
//
// ROADMAP CE-800, option 1 (user decision 2026-11-04). The witness is
// Tycho row 483: a point declared with extended-real components.
//

const E = 'real | signed_infinity | nan';
const POINT = `tuple<${E}, ${E}>`;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('a', 'real');
  ce.declare('n', 'real');
  return ce;
}

describe('a store accepts a value whose type overlaps the declared type', () => {
  test('the witness values assign without an error', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.declare('Q', POINT);
    const p = ce.parse('(-\\sqrt{1-a^2}, a)');
    const q = ce.parse('(\\frac{1}{n}, a)');
    // The types only overlap the declared type.
    expect(p.type.matches(POINT)).toBe(false);
    expect(q.type.matches(POINT)).toBe(false);
    expect(() => ce.assign('P', p)).not.toThrow();
    expect(() => ce.assign('Q', q)).not.toThrow();
    expect(ce.box('P').value?.toString()).toBe('(-sqrt(1 - a^2), a)');
  });

  test('a read gives the value when it is of the declared type', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    // `a` has no value: the value stays symbolic and is not an error.
    expect(ce.box('P').evaluate().toString()).toBe('(-sqrt(1 - a^2), a)');
    ce.assign('a', 0.5);
    const value = ce.box('P').N();
    expect(value.operator).toBe('Tuple');
    expect(value.ops![0].re).toBeCloseTo(-Math.sqrt(0.75), 12);
    expect(value.ops![1].re).toBe(0.5);
    expect(ce.box('P').evaluate().operator).toBe('Tuple');
    expect(ce.parse('P + (1, 1)').N().ops![0].re).toBeCloseTo(
      1 - Math.sqrt(0.75),
      12
    );
  });

  test('a read gives an incompatible-type error when the value is outside', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    ce.assign('a', 5);
    for (const value of [ce.box('P').evaluate(), ce.box('P').N()]) {
      expect(value.operator).toBe('Error');
      expect(value.toString()).toMatch(/incompatible-type/);
      expect(value.toString()).toMatch(/tuple<imaginary, integer>/);
    }
    // The error is the value of an expression that reads `P`.
    expect(ce.parse('P + (1, 1)').evaluate().toString()).toMatch(
      /incompatible-type/
    );
    // The same value as a call argument gives the same error.
    ce.declare('g', `(${POINT}) -> unknown`);
    ce.assign('g', ce.parse('p \\mapsto p'));
    expect(ce.parse('g((-\\sqrt{1-a^2}, a))').evaluate().toString()).toMatch(
      /incompatible-type/
    );
  });

  test('the second witness value: a quotient with a pole', () => {
    const ce = engine();
    ce.declare('Q', POINT);
    ce.assign('Q', ce.parse('(\\frac{1}{n}, a)'));
    ce.assign('a', 1);
    ce.assign('n', 2);
    expect(ce.box('Q').evaluate().toString()).toBe('(1/2, 1)');
    // `1/0` is the complex infinity, which is not a signed infinity.
    ce.assign('n', 0);
    expect(ce.box('Q').evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('an asynchronous read tests the value too', async () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    ce.assign('a', 5);
    const value = await ce.box('P').evaluateAsync();
    expect(value.toString()).toMatch(/incompatible-type/);
  });

  test('a numeric read tests the exact value and gives its approximation', async () => {
    // A float is typed `real`, not `rational`: the declared type applies to
    // the exact value `1/3`.
    const ce = engine();
    ce.declare('q', 'rational');
    ce.assign('q', ce.parse('1/a'));
    ce.assign('a', 3);
    expect(ce.box('q').evaluate().toString()).toBe('1/3');
    expect(ce.box('q').N().toString()).toBe('0.333333333333333333333');
    expect(
      ce.box('q').evaluate({ numericApproximation: true }).toString()
    ).toBe('0.333333333333333333333');
    expect(
      (await ce.box('q').evaluateAsync({ numericApproximation: true })).toString()
    ).toBe('0.333333333333333333333');
    // An exact value outside the declared type is still the error.
    ce.declare('k', 'integer');
    ce.assign('k', ce.parse('a/2'));
    ce.assign('a', 5);
    expect(ce.box('k').N().toString()).toMatch(/incompatible-type/);
    expect(
      ce.box('k').evaluate({ numericApproximation: true }).toString()
    ).toMatch(/incompatible-type/);
    expect(
      (await ce.box('k').evaluateAsync({ numericApproximation: true })).toString()
    ).toMatch(/incompatible-type/);
  });

  test('a declaration with a value and the Assign operator follow the rule', () => {
    const ce = engine();
    ce.declare('R', { type: POINT, value: ce.parse('(\\frac{1}{n}, a)') });
    ce.declare('S', POINT);
    ce.box(['Assign', 'S', ce.parse('(\\frac{1}{n}, a)')]).evaluate();
    expect(ce.box('S').value?.toString()).toBe('(1 / n, a)');
    ce.assign('a', 1);
    ce.assign('n', 0);
    expect(ce.box('R').evaluate().toString()).toMatch(/incompatible-type/);
    expect(ce.box('S').evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('an Epsil typed let follows the rule', () => {
    const ce = engine();
    const r = executeEpsil(
      ce,
      `let P: tuple<real | nan, real | nan> = (-sqrt(1 - a^2), a)\nP`
    );
    expect(r.value.toString()).toBe('(-sqrt(1 - a^2), a)');
    ce.assign('a', 5);
    expect(ce.box('P').evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('a scalar value is tested at each read', () => {
    const ce = engine();
    ce.declare('k', 'integer');
    ce.assign('k', ce.parse('a/2'));
    ce.assign('a', 4);
    expect(ce.box('k').evaluate().toString()).toBe('2');
    ce.assign('a', 5);
    expect(ce.box('k').evaluate().toString()).toMatch(/incompatible-type/);
  });

  test('compiled code reads the symbol as a value of the declared type', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    const js = ce._getCompilationTarget('javascript')!;
    const result = js.compile(ce.parse('P_1 + 1'));
    expect(result.success).toBe(true);
    expect(result.run!({ a: 0.5 })).toBeCloseTo(1 - Math.sqrt(0.75), 12);
  });

  test('a value on the complex lane declines', () => {
    // `r := z` is admitted on overlap: a complex value can be real. Code
    // compiled for the real `r` would read the `{re, im}` representation of
    // `z` as a number, so the compilation declines and the interpreter
    // gives the value.
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    ce.declare('r', 'real');
    ce.assign('r', ce.box('z'));
    expect(() => compile(ce.parse('r + 1'), { fallback: false })).toThrow(
      /^Could not compile the symbol 'r'/
    );
    const result = compile(ce.parse('r + 1'));
    expect(result.success).toBe(false);
    expect(result.run!({ z: ce.box(['Complex', 2, 0]) })).toBe(3);
  });

  test('a collection with complex elements declines', () => {
    // The elements of `zs` are emitted as `{re, im}` objects, and code
    // compiled for `L: list<real>` would read them as numbers.
    const ce = new ComputeEngine();
    ce.declare('zs', 'list<complex>');
    ce.declare('L', 'list<real>');
    ce.assign('L', ce.box('zs'));
    const zs = [ce.box(['Complex', 2, 0])];
    for (const expr of [['Add', ['At', 'L', 1], 1], ['Sum', 'L']]) {
      expect(() => compile(ce.box(expr), { fallback: false })).toThrow(
        /^Could not compile the symbol 'L'/
      );
    }
    const at = compile(ce.box(['Add', ['At', 'L', 1], 1]));
    expect(at.success).toBe(false);
    expect(at.run!({ zs })).toBe(3);
    const sum = compile(ce.box(['Sum', 'L']));
    expect(sum.success).toBe(false);
    expect(sum.run!({ zs })).toBe(2);

    ce.declare('w', 'tuple<complex, real>');
    ce.declare('P2', 'tuple<real, real>');
    ce.assign('P2', ce.box('w'));
    const first = ce.box(['Add', ['At', 'P2', 1], 1]);
    expect(() => compile(first, { fallback: false })).toThrow(
      /^Could not compile the symbol 'P2'/
    );
    const result = compile(first);
    expect(result.success).toBe(false);
    expect(result.run!({ w: [ce.box(['Complex', 2, 0]), 1] })).toBe(3);
  });
});

describe('a store still refuses a value that cannot be of the declared type', () => {
  test('a value whose type does not overlap the declared type', () => {
    const ce = new ComputeEngine();
    ce.declareType('gf8', 'value', { mint: false });
    ce.declare('t', 'gf8');
    expect(() => ce.assign('t', 2)).toThrow(/not compatible with the type/);
    ce.declare('s', 'string');
    ce.declare('x', 'real');
    expect(() => ce.assign('s', ce.parse('x + 1'))).toThrow(
      /not compatible with the type/
    );
  });

  test('a value made of literals that does not fit', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'tuple<integer, integer>');
    expect(() => ce.assign('M', ce.box(['Tuple', 1, 2.5]))).toThrow(
      /not compatible with the type/
    );
    ce.declare('L', POINT);
    expect(() => ce.assign('L', ce.parse('(1, 2i)'))).toThrow(
      /not compatible with the type/
    );
    expect(() =>
      ce.declare('K', { type: POINT, value: ce.parse('(1, 2i)') })
    ).toThrow(/not compatible with the type/);
  });
});

describe('a store of a value of the declared type is unchanged', () => {
  test('a read does not test a value that matches', () => {
    const ce = engine();
    ce.declare('C', 'tuple<number, number>');
    ce.assign('C', ce.parse('(-\\sqrt{1-a^2}, a)'));
    ce.assign('a', 5);
    // The value is of the declared type, so it is read as it is.
    expect(ce.box('C').evaluate().toString()).toBe('(-2sqrt(6)i, 5)');
  });
});

describe('every read of a value admitted on overlap is tested', () => {
  test('a function literal that reads the symbol', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    ce.assign('f', ce.parse('t \\mapsto P + (t, t)'));
    const inline = () =>
      ce
        .box(['Apply', ['Function', ['Add', 'P', ['Tuple', 't', 't']], 't'], 1])
        .evaluate();
    ce.assign('a', 0.5);
    for (const value of [ce.parse('f(1)').evaluate(), inline()]) {
      expect(value.operator).toBe('Tuple');
      expect(value.ops![0].re).toBeCloseTo(1 - Math.sqrt(0.75), 12);
      expect(value.ops![1].re).toBe(1.5);
    }
    ce.assign('a', 5);
    for (const value of [ce.parse('f(1)').evaluate(), inline()])
      expect(value.toString()).toMatch(/incompatible-type/);
  });

  test('an inline function literal of Map that reads the symbol', () => {
    const ce = engine();
    ce.declare('k', 'integer');
    ce.assign('k', ce.parse('a/2'));
    const map = () =>
      ce
        .box(['Map', ['Function', ['Add', 'x', 'k'], 'x'], ['List', 1, 2]])
        .evaluate();
    ce.assign('a', 4);
    expect(map().toString()).toBe('[3,4]');
    ce.assign('a', 5);
    expect(map().toString()).toMatch(/incompatible-type/);
  });

  test('a value held with Unevaluated', () => {
    const ce = engine();
    ce.declare('k', 'integer');
    ce.assign('k', ce.box(['Unevaluated', ['Divide', 'a', 2]]));
    ce.assign('a', 4);
    expect(ce.box('k').evaluate().toString()).toBe('2');
    ce.assign('a', 5);
    expect(ce.box('k').evaluate().toString()).toMatch(/incompatible-type/);
    expect(ce.box('k').N().toString()).toMatch(/incompatible-type/);
  });

  test('a constant whose value is computed again after a precision change', () => {
    const ce = engine();
    // A MathJSON value is boxed again when the precision changes, which gives
    // a new expression.
    ce.declare('K', {
      type: 'integer',
      value: ['Divide', 'a', 2],
      isConstant: true,
    });
    ce.assign('a', 5);
    expect(ce.box('K').evaluate().toString()).toMatch(/incompatible-type/);
    ce.precision = 40;
    expect(ce.box('K').evaluate().toString()).toMatch(/incompatible-type/);
    expect(ce.box('K').N().toString()).toMatch(/incompatible-type/);
  });

  test('an asynchronous read of a constant whose value is a number', async () => {
    // After the precision change, the value function gives the number `5/2`,
    // which the asynchronous read returns without an evaluation.
    const ce = engine();
    ce.declare('K', {
      type: 'integer',
      value: (ce) => ce.parse('a/2').evaluate(),
      isConstant: true,
    });
    ce.assign('a', 5);
    ce.precision = 40;
    expect(ce.box('K').evaluate().toString()).toMatch(/incompatible-type/);
    expect((await ce.box('K').evaluateAsync()).toString()).toMatch(
      /incompatible-type/
    );
    expect(
      (await ce.box('K').evaluateAsync({ numericApproximation: true })).toString()
    ).toMatch(/incompatible-type/);
  });

  test('GLSL code reads the components at the real lane', () => {
    const ce = engine();
    ce.declare('P', POINT);
    ce.assign('P', ce.parse('(-\\sqrt{1-a^2}, a)'));
    const glsl = ce._getCompilationTarget('glsl')!;
    // The value of `P` is typed `tuple<complex, real>`, but the code reads
    // `P` at its declared type: each component is a `float`, not a `vec2`
    // that holds a complex number.
    expect(glsl.compile(ce.parse('P + (1, 1)')).code).toBe(
      'vec2(-sqrt(-(a * a) + 1.0), a) + vec2(1.0, 1.0)'
    );
    expect(glsl.compile(ce.parse('P_1 + 1')).code).toBe(
      '(vec2(-sqrt(-(a * a) + 1.0), a)).x + 1.0'
    );
  });
});
