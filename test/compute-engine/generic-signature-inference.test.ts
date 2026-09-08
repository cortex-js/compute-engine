import { ComputeEngine } from '../../src/compute-engine';

//
// Operand inference around GENERIC signatures (`(T) -> T where T: …`).
//
// Two gaps, both found while giving `Conjugate` a function arm:
//
//  1. The boxing seam re-validates a canonical handler's same-head result
//     with inference off and only runs its numeric inference when every
//     parameter is a concrete numeric type. A type variable bounded by
//     `number` is not concrete, so a canonical-handler head with a generic
//     signature inferred nothing for a valueless operand.
//  2. A requirement on the RESULT of a generic head did not reach the operand
//     typed by the same variable, and an arithmetic operator handed a
//     `function | number` operand admitted provisionally straight through to
//     its result type.
//

describe('a canonical-handler head with a generic numeric signature', () => {
  it('narrows a valueless operand to the bound', () => {
    const ce = new ComputeEngine();
    ce.declare('Twice', {
      signature: '(T) -> T where T: number',
      canonical: (ops, { engine }) => engine._fn('Twice', ops),
      evaluate: ([x]) => x.mul(2),
    });
    const expr = ce.box(['Twice', 'q']);
    expect(expr.isValid).toBe(true);
    expect(ce.symbol('q').type.toString()).toBe('number');
    expect(expr.type.toString()).toBe('number');
    expect(ce.box(['Twice', 3]).evaluate().toString()).toBe('6');
  });

  it('leaves a declared operand alone', () => {
    const ce = new ComputeEngine();
    ce.declare('Twice', {
      signature: '(T) -> T where T: number',
      canonical: (ops, { engine }) => engine._fn('Twice', ops),
    });
    ce.declare('k', 'integer');
    ce.box(['Twice', 'k']);
    expect(ce.symbol('k').type.toString()).toBe('integer');
  });
});

describe('a generic head whose bound has a function arm', () => {
  it('forwards a numeric requirement on its result to the operand', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(T) -> T where T: number | function');
    ce.box(['f', 'u']);
    expect(ce.symbol('u').type.toString()).toBe('function | number');
    const sum = ce.box(['Add', ['f', 'u'], 1]);
    expect(sum.isValid).toBe(true);
    expect(ce.symbol('u').type.toString()).toBe('number');
    expect(sum.type.toString()).toBe('number');
  });

  it('types a sum by the number arm of a declared union operand', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'function | number');
    const sum = ce.box(['Add', 'w', 1]);
    expect(sum.type.toString()).toBe('number');
    // A declaration is a contract: the use does not rewrite it.
    expect(ce.symbol('w').type.toString()).toBe('function | number');
  });

  it('does not forward a function requirement', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(T) -> T where T: number | function');
    ce.box(['Apply', ['f', 'v'], 1]);
    expect(ce.symbol('v').type.toString()).toBe('function | number');
  });
});
