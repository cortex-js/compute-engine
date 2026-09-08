import { ComputeEngine } from '../../src/compute-engine';

//
// `Conjugate` of a FUNCTION is the pointwise conjugate, a function literal
// `(x) ↦ Conjugate(f(x))`. Before this, the signature `(T) -> T where T:
// number` refused a function-typed operand as `incompatible-type number
// function` — the conjugate Dirichlet character `Conjugate(chi)` of Fungrim
// entry 288207 could not be boxed.
//
// The function arm lives in the canonical handler, not in the signature:
// widening the bound to `number | function` made every valueless operand
// infer that union, so `Conjugate(u) + 1` typed `function | number` instead
// of narrowing `u` to a number. The numeric arm must therefore behave exactly
// as the handler-less operator did — the second block pins that.
//

describe('Conjugate of a function', () => {
  it('rewrites a function-typed symbol to the pointwise literal', () => {
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    const conj = ce.box(['Conjugate', 'chi']);
    expect(conj.isValid).toBe(true);
    // A bare `function` is `(any*) -> any`: the wrapper takes a rest
    // parameter and spreads it back into the application.
    expect(conj.json).toEqual([
      'Function',
      ['Block', ['Conjugate', ['Apply', 'chi', ['Spread', 'args']]]],
      ['Spread', 'args'],
    ]);
    expect(conj.type.matches('function')).toBe(true);
  });

  it('applies to any number of arguments as the conjugate of the value', () => {
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    ce.declare('n', 'integer');
    const conj = ['Conjugate', 'chi'];
    expect(ce.box(['Apply', conj, 'n']).evaluate().toString()).toBe(
      'Conjugate(chi(n))'
    );
    expect(ce.box(['Apply', conj, 1, 2]).evaluate().toString()).toBe(
      'Conjugate(chi(1, 2))'
    );
    expect(ce.box(['Apply', conj]).evaluate().toString()).toBe(
      'Conjugate(chi())'
    );
  });

  it('evaluates through a held lambda', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.parse('x \\mapsto x^2 + \\imaginaryI'));
    const applied = ce.box(['Apply', ['Conjugate', 'h'], 2]).evaluate();
    expect(applied.toString()).toBe('(4 - i)');
  });

  it('keeps the parameters of a literal operand', () => {
    const ce = new ComputeEngine();
    const conj = ce.box(['Conjugate', ['Function', ['Add', 't', 'y'], 't']]);
    expect(conj.isValid).toBe(true);
    // The literal's own parameter `t` is reused, so the free `y` of the body
    // is not captured.
    expect(conj.ops![1].toString()).toBe('t');
    expect(ce.box(['Apply', conj, 1]).evaluate().toString()).toBe(
      'Conjugate(y + 1)'
    );
  });

  it('keeps the rest parameter of a literal operand', () => {
    const ce = new ComputeEngine();
    ce.declare('chi', 'function');
    const conj = ce.box([
      'Conjugate',
      ['Function', ['Apply', 'chi', ['Spread', 'r']], ['Spread', 'r']],
    ]);
    expect(conj.isValid).toBe(true);
    expect(ce.box(['Apply', conj, 5]).evaluate().json).toEqual([
      'Conjugate',
      ['chi', 5],
    ]);
    expect(ce.box(['Apply', conj, 1, 2]).evaluate().json).toEqual([
      'Conjugate',
      ['chi', 1, 2],
    ]);
  });

  it('gives one parameter per required argument of a declared signature', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(complex, integer) -> complex');
    const conj = ce.box(['Conjugate', 'g']);
    expect(conj.ops!.slice(1).map((p) => p.json)).toEqual(['x_1', 'x_2']);
    expect(ce.box(['Apply', conj, 'a', 'b']).evaluate().json).toEqual([
      'Conjugate',
      ['g', 'a', 'b'],
    ]);
  });

  it('binds its parameter in its own scope, not the enclosing one', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'string');
    ce.declare('g', '(complex) -> complex');
    // The wrapper's `x` is the literal's parameter: the outer string `x`
    // must neither be validated against `g` nor be retyped by the wrapper.
    const conj = ce.box(['Conjugate', 'g']);
    expect(conj.isValid).toBe(true);
    expect(conj.toString()).toBe('(x) => Conjugate(g(x))');
    expect(ce.symbol('x').type.toString()).toBe('string');
  });

  it('adds a rest parameter for optional and variadic arguments', () => {
    const ce = new ComputeEngine();
    ce.declare('opt', '(integer?) -> integer');
    ce.declare('v', '(complex, real*) -> complex');
    const params = (e: ReturnType<typeof ce.box>) =>
      e.ops!.slice(1).map((p) => p.json);
    expect(params(ce.box(['Conjugate', 'opt']))).toEqual([['Spread', 'args']]);
    expect(params(ce.box(['Conjugate', 'v']))).toEqual([
      'x',
      ['Spread', 'args'],
    ]);
    expect(
      ce.box(['Apply', ['Conjugate', 'v'], 'a', 1, 2]).evaluate().json
    ).toEqual(['Conjugate', ['v', 'a', 1, 2]]);
  });

  it('is accepted where a function-typed argument is expected', () => {
    const ce = new ComputeEngine();
    // Fungrim entry 288207 passes the conjugate character to a shell.
    ce.declare('DirichletLambda', '(complex, any) -> complex');
    ce.declare('chi', 'function');
    ce.declare('s', 'complex');
    const expr = ce.box([
      'DirichletLambda',
      ['Subtract', 1, 's'],
      ['Conjugate', 'chi'],
    ]);
    expect(expr.isValid).toBe(true);
  });
});

describe('Conjugate of a number is unchanged', () => {
  it('narrows a valueless operand to number', () => {
    const ce = new ComputeEngine();
    const conj = ce.box(['Conjugate', 'z']);
    expect(ce.symbol('z').type.toString()).toBe('number');
    expect(conj.type.toString()).toBe('number');
    const sum = ce.box(['Add', ['Conjugate', 'u'], 1]);
    expect(sum.type.toString()).toBe('number');
    expect(ce.symbol('u').type.toString()).toBe('number');
  });

  it('keeps the operand type and folds literals', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Conjugate', 2]).type.toString()).toBe('integer');
    expect(
      ce
        .box(['Conjugate', ['Complex', 3, 2]])
        .evaluate()
        .toString()
    ).toBe('(3 - 2i)');
    expect(
      ce
        .box(['Conjugate', ['List', ['Complex', 1, 1], 2]])
        .evaluate()
        .toString()
    ).toBe('[(1 - i),2]');
    expect(ce.box(['Conjugate', 'NaN']).evaluate().toString()).toBe('NaN');
    expect(
      ce.box(['Conjugate', 'PositiveInfinity']).evaluate().toString()
    ).toBe('+oo');
  });

  it('still reports arity and type errors', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Conjugate', ['String', 's']]).isValid).toBe(false);
    expect(ce.box(['Conjugate']).isValid).toBe(false);
    expect(ce.box(['Conjugate', 1, 2]).isValid).toBe(false);
  });
});
