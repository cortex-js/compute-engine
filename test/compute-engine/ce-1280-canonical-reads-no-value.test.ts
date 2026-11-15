import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// CE-1280. An arithmetic canonical rewrite (`Power`, `Divide`) decides a
// form from what an assignment cannot change: of a variable that is not a
// constant, its declared type (a ranged type included) and the assumptions,
// not the value it holds or a type inferred from that value
// (`staticFact()`). A form boxed while `k` holds 4 is the form boxed while
// `k` has no value, and stays right after `k := 0.5`.

const epsil = (source: string) =>
  executeEpsil(new ComputeEngine(), source).value.toString();

describe('THE RULE: A FORM BOXED WITH A VALUE IS THE FORM BOXED WITHOUT ONE', () => {
  test.each([
    ['(x^2)^k', 'k', 4],
    ['(x^2)^{-k}', 'k', 4],
    ['(x^2)^{2k}', 'k', 4],
    ['(x^2)^{k+1}', 'k', 4],
    ['(p^2)^{1/2}', 'p', 2],
    ['\\frac{\\infty}{a}', 'a', 2],
    ['\\frac{2}{a}', 'a', 'PositiveInfinity'],
    ['z^0', 'z', 0],
  ] as [string, string, number | string][])(
    '%s with %s',
    (latex, name, value) => {
      const valueless = new ComputeEngine();
      valueless.declare('x', 'real');
      const held = new ComputeEngine();
      held.declare('x', 'real');
      held.assign(name, typeof value === 'string' ? held.box(value) : value);
      expect(held.parse(latex).json).toEqual(valueless.parse(latex).json);
    }
  );

  test('a substitution and a simplification', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('k', 4);
    const expected = ['Power', ['Power', 'x', 2], 'k'];
    expect(ce.parse('(x^2)^y').subs({ y: 'k' }).json).toEqual(expected);
    expect(ce.parse('(x^2)^k').simplify().json).toEqual(expected);
  });

  test('a declared type is read', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('k', 'integer');
    ce.assign('k', 4);
    expect(ce.parse('(x^2)^k').json).toEqual([
      'Power',
      'x',
      ['Multiply', 2, 'k'],
    ]);
    ce.declare('p', 'real<0..>');
    ce.assign('p', 2);
    expect(ce.parse('(p^2)^{1/2}').json).toEqual('p');
    ce.declare('q', 'real');
    ce.assign('q', 2);
    expect(ce.parse('(q^2)^{1/2}').json).toEqual(['Sqrt', ['Power', 'q', 2]]);
  });
});

describe('THE NAMES THAT GIVE NO FACT', () => {
  test('a name that was free when it was boxed, assigned later: subs', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const e = ce.parse('(x^2)^k');
    ce.assign('k', 4);
    const f = e.subs({ x: 'y' });
    expect(f.json).toEqual(['Power', ['Power', 'y', 2], 'k']);
    ce.assign('k', 0.5);
    ce.assign('y', -3);
    expect(f.evaluate().re).toBe(3);
    expect(e.simplify().json).toEqual(['Power', ['Power', 'x', 2], 'k']);
  });

  test('a name that was free when it was boxed, assigned later: the sign', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('(p^2)^y');
    ce.assign('p', 2);
    expect(e.subs({ y: ce.parse('1/2') }).json).toEqual([
      'Sqrt',
      ['Power', 'p', 2],
    ]);
  });

  test('a cleared value leaves an inferred type, which gives no fact', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('k', 4);
    ce.assign('k', undefined);
    const expected = ['Power', ['Power', 'x', 2], 'k'];
    expect(ce.parse('(x^2)^k').json).toEqual(expected);
    expect(
      ce.withValues({ k: undefined } as any, () => ce.parse('(x^2)^k')).json
    ).toEqual(expected);
  });

  test('a constant whose value reads a variable gives no fact', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.declare('c', { type: 'real', value: ce.box('p'), isConstant: true });
    ce.assign('p', 2);
    const e = ce.parse('(c^2)^{1/2}');
    expect(e.json).toEqual(['Sqrt', ['Power', 'c', 2]]);
    ce.assign('p', -2);
    expect(e.evaluate().re).toBe(2);
    // A constant with a closed value is read as before.
    ce.declare('h', { type: 'real', value: 2, isConstant: true });
    expect(ce.parse('(h^2)^{1/2}').json).toEqual('h');
  });

  test('a held value that blocks a fold keeps the form: a/∞ with a := ∞', () => {
    // The numerator is infinite only by the value it holds: neither `0` nor
    // `NaN` is boxed, and each evaluation reads the value of that time.
    const ce = new ComputeEngine();
    ce.assign('a', ce.box('PositiveInfinity'));
    const e = ce.box(['Divide', 'a', 'PositiveInfinity']);
    expect(e.json).toEqual(['Divide', 'a', 'PositiveInfinity']);
    expect(e.evaluate().json).toEqual('NaN');
    ce.assign('a', 2);
    expect(e.evaluate().json).toEqual(0);
  });
});

describe('THE SHAPE AND THE KIND ARE READ FROM THE HELD VALUE', () => {
  test('an undeclared matrix: A^{-1} is its inverse', () => {
    const ce = new ComputeEngine();
    ce.assign('A', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(ce.box(['Power', 'A', -1]).evaluate().toString()).toBe(
      '[[-2,1],[3/2,-1/2]]'
    );
  });

  test('an undeclared list: L/∞ is a list of zeros', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2]));
    expect(
      ce.box(['Divide', 'L', 'PositiveInfinity']).evaluate().toString()
    ).toBe('[0,0]');
  });

  test('an undeclared residue class: the powers are not combined', () => {
    const ce = new ComputeEngine();
    ce.assign('c', ce.box(['ResidueClass', 2, 4]));
    expect(
      ce.box(['Power', ['Power', 'c', ['Rational', 2, 3]], 3]).json
    ).toEqual(['Power', ['Power', 'c', ['Rational', 2, 3]], 3]);
    expect(ce.box(['Power', ['Power', 'c', -1], -1]).json).toEqual([
      'Power',
      ['Power', 'c', -1],
      -1,
    ]);
  });
});

describe('THE WITNESSES OF CE-1280', () => {
  test('W1: (x^2)^k with an undeclared k that holds 4', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('k', 4);
    const e = ce.parse('(x^2)^k');
    expect(e.json).toEqual(['Power', ['Power', 'x', 2], 'k']);
    ce.assign('k', 0.5);
    ce.assign('x', -3);
    expect(e.evaluate().re).toBe(3);
  });

  test('W1c: the compiled form of the same expression', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.assign('k', 4);
    const e = ce.parse('(x^2)^k');
    const r = compile(e, { vars: { k: '_.k' } } as any) as any;
    expect(r.run({ x: -3, k: 0.5 })).toBe(3);
  });

  test('W2: a function defined while k holds 4', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 4);
    ce.parse('f(x) := (x^2)^k').evaluate();
    ce.assign('k', 0.5);
    expect(ce.parse('f(-3)').evaluate().re).toBe(3);
  });

  test('W3: (p^2)^{1/2} with an undeclared p that holds 2', () => {
    const ce = new ComputeEngine();
    ce.assign('p', 2);
    const e = ce.parse('(p^2)^{1/2}');
    expect(e.json).toEqual(['Sqrt', ['Power', 'p', 2]]);
    ce.assign('p', -2);
    expect(e.evaluate().re).toBe(2);
  });

  test('W6: the sign of a declared real that holds 2 is not read', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    ce.assign('p', 2);
    const e = ce.parse('(p^2)^{1/2}');
    expect(e.json).toEqual(['Sqrt', ['Power', 'p', 2]]);
    ce.assign('p', -2);
    expect(e.evaluate().re).toBe(2);
  });

  test('W9: Epsil, a let with a declared type', () => {
    expect(epsil('let p: real = 2\ng() = (p^2)^(1/2)\np = -2\ng()')).toBe('2');
  });

  test('W10: Epsil, a let with no type', () => {
    expect(epsil('let k = 4\nlet f = (x) => (x^2)^k\nk = 0.5\nf(-3)')).toBe(
      '3'
    );
  });
});

describe('THE CONTROLS', () => {
  test('W4: k declared real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('k', 'real');
    ce.assign('k', 4);
    const e = ce.parse('(x^2)^k');
    expect(e.json).toEqual(['Power', ['Power', 'x', 2], 'k']);
    ce.assign('k', 0.5);
    ce.assign('x', -3);
    expect(e.evaluate().re).toBe(3);
  });

  test('W5: k declared integer refuses 0.5', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    ce.assign('k', 4);
    expect(() => ce.assign('k', 0.5)).toThrow();
  });

  test('W7: p declared real, with no value', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real');
    const e = ce.parse('(p^2)^{1/2}');
    ce.assign('p', -2);
    expect(e.evaluate().re).toBe(2);
  });

  test('W8: Epsil, k declared real', () => {
    expect(epsil('let k: real = 4\nf(x) = (x^2)^k\nk = 0.5\nf(-3)')).toBe('3');
  });
});

describe('WHERE THE LINE FALLS', () => {
  test('a constant is read: (p^2)^{1/2} is p', () => {
    const ce = new ComputeEngine();
    ce.declare('p', { type: 'real', value: 2, isConstant: true });
    expect(ce.parse('(p^2)^{1/2}').json).toEqual('p');
  });

  test('a ranged declared type is read: (p^2)^{1/2} is p', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'real<0..>');
    ce.assign('p', 2);
    expect(ce.parse('(p^2)^{1/2}').json).toEqual('p');
  });

  test('an assumption is read; a contradicting assignment is refused', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('p > 0'));
    expect(ce.parse('(p^2)^{1/2}').json).toEqual('p');
    expect(() => ce.assign('p', -2)).toThrow();
  });

  test('a value given by withValues() is not read', () => {
    const ce = new ComputeEngine();
    const e = ce.withValues({ p: 2 }, () => ce.parse('(p^2)^{1/2}'));
    expect(e.json).toEqual(['Sqrt', ['Power', 'p', 2]]);
    ce.assign('p', -2);
    expect(e.evaluate().re).toBe(2);
  });

  test('a parameter', () => {
    const ce = new ComputeEngine();
    ce.parse('f(p) := (p^2)^{1/2}').evaluate();
    expect(ce.parse('f(-2)').evaluate().re).toBe(2);
  });

  test('a local of a block', () => {
    const ce = new ComputeEngine();
    const b = ce.box([
      'Block',
      ['Declare', 'p', "'real'", 2],
      ['Power', ['Power', 'p', 2], ['Rational', 1, 2]],
    ]);
    expect(b.evaluate().re).toBe(2);
  });

  test('Epsil, a let at the top level', () => {
    expect(epsil('let p = 2\ng() = (p^2)^(1/2)\np = -2\ng()')).toBe('2');
  });

  test('Epsil, a let in the body of a function', () => {
    expect(
      epsil(
        'function f() { let q = 2; let g = () => (q^2)^(1/2); q = -2; g() }\nf()'
      )
    ).toBe('2');
  });
});
