import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

// A power of a matrix value `A^n` whose exponent is not a number literal
// after evaluation. An integer power of a matrix is the matrix power, and a
// power whose exponent is not an integer applies to each entry
// (`docs/BROADCAST-MODEL.md`). An exponent that is neither known to be an
// integer nor known not to be one leaves the power as it is: the power of
// each entry, `[[1, 2^n], [3^n, 4^n]]`, is wrong once `n` holds an integer.

const A = ['List', ['List', 1, 2], ['List', 3, 4]];
const NON_SQUARE = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]];
const json = (x: Expression) => JSON.stringify(x.json);

describe('POWER OF A MATRIX WITH A SYMBOLIC EXPONENT', () => {
  test('An exponent with no type information stays a power', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Power', A, 'n']);
    expect(json(p.evaluate())).toBe(json(p));
    expect(json(p.N())).toBe(json(p));
  });

  test('An exponent typed real stays a power', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    const p = ce.box(['Power', A, 'r']);
    expect(json(p.evaluate())).toBe(json(p));
  });

  test('An exponent expression with an unknown stays a power', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Power', A, ['Add', 'n', 1]]);
    expect(json(p.evaluate())).toBe(json(p));
  });

  test('The entries of a held power are evaluated', async () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'integer');
    ce.assign('x', 5);
    const p = ce.box([
      'Power',
      ['List', ['List', 'x', 2], ['List', 3, 4]],
      'n',
    ]);
    const held = '["Power",["List",["List",5,2],["List",3,4]],"n"]';
    expect(json(p.evaluate())).toBe(held);
    expect(json(await p.evaluateAsync())).toBe(held);
    const q = ce.box([
      'Power',
      ['List', ['List', 'Pi', 2], ['List', 3, 4]],
      'n',
    ]);
    expect(json(q.N())).toContain('3.14159');
  });

  test('evaluateAsync evaluates an entry that has only an asynchronous handler', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '() -> integer',
      evaluateAsync: async () => ce.number(9),
    } as any);
    const p = ce.box([
      'Power',
      ['List', ['List', ['g'], 2], ['List', 3, 4]],
      'n',
    ]);
    expect(json(await p.evaluateAsync())).toBe(
      '["Power",["List",["List",9,2],["List",3,4]],"n"]'
    );
  });

  test('evaluateAsync evaluates such an entry of the value of a symbol base', async () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '() -> integer',
      evaluateAsync: async () => ce.number(9),
    } as any);
    ce.assign('B', ce.box(['List', ['List', ['g'], 2], ['List', 3, 4]]));
    expect(json(await ce.box(['Power', 'B', 'n']).evaluateAsync())).toBe(
      '["Power",["List",["List",9,2],["List",3,4]],"n"]'
    );
  });

  test('A compound exponent that is never an integer stays a power (a known limitation)', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    const p = ce.box(['Power', A, ['Add', 'k', 0.5]]);
    expect(p.evaluate().operator).toBe('Power');
  });

  test('The power evaluates to the matrix power when the exponent gets an integer value', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Power', A, 'n']);
    ce.declare('n', 'integer');
    ce.assign('n', 2);
    expect(json(p.evaluate())).toBe('["List",["List",7,10],["List",15,22]]');
  });

  test('A symbol that holds the matrix', () => {
    const ce = new ComputeEngine();
    ce.declare('B', 'matrix<integer^(2x2)>');
    ce.assign('B', ce.box(A));
    expect(json(ce.box(['Power', 'B', 'n']).evaluate())).toBe(
      json(ce.box(['Power', A, 'n']))
    );
  });

  test('An exponent typed integer is the matrix power', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    const p = ce.box(['Power', A, 'k']).evaluate();
    expect(json(p)).toBe(json(ce.box(['MatrixPower', A, 'k'])));
  });

  test('An integer exponent of a matrix that is not square is an error', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'integer');
    const p = ce.box(['Power', NON_SQUARE, 'k']).evaluate();
    expect(p.operator).toBe('Error');
    expect(json(p)).toContain('expected-square-matrix');
  });

  test('A constant exponent that is not an integer applies to each entry', () => {
    const ce = new ComputeEngine();
    expect(json(ce.box(['Power', A, 'Pi']).evaluate())).toBe(
      '["List",["List",1,["Power",2,"Pi"]],["List",["Power",3,"Pi"],["Power",4,"Pi"]]]'
    );
    expect(json(ce.box(['Power', A, ['Sqrt', 2]]).evaluate())).toBe(
      '["List",["List",1,["Power",2,["Sqrt",2]]],["List",["Power",3,["Sqrt",2]],["Power",4,["Sqrt",2]]]]'
    );
  });

  test('A vector to a symbolic power applies to each entry', () => {
    const ce = new ComputeEngine();
    expect(json(ce.box(['Power', ['List', 1, 2, 3], 'n']).evaluate())).toBe(
      '["List",1,["Power",2,"n"],["Power",3,"n"]]'
    );
  });

  test('MatrixPower with a symbolic exponent stays as it is', () => {
    const ce = new ComputeEngine();
    const p = ce.box(['MatrixPower', A, 'n']);
    expect(json(p.evaluate())).toBe(json(p));
  });

  test('evaluateAsync agrees', async () => {
    const ce = new ComputeEngine();
    const p = ce.box(['Power', A, 'n']);
    expect(json(await p.evaluateAsync())).toBe(json(p));
    ce.declare('k', 'integer');
    expect(json(await ce.box(['Power', A, 'k']).evaluateAsync())).toBe(
      json(ce.box(['MatrixPower', A, 'k']))
    );
  });
});
