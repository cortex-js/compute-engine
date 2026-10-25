import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// CE-150: an unevaluated `Solve` holds its equation in canonical form, so the
// parse route and the box route give the same MathJSON, without the parse
// forms `InvisibleOperator` and `Delimiter`.
describe('CE-150 an unevaluated Solve has a canonical equation', () => {
  test('parse route and box route agree', () => {
    const parsed = ce
      .parse('\\operatorname{Solve}((x-2)(x+e^x)=0, x)')
      .evaluate();
    const boxed = ce
      .box([
        'Solve',
        ['Equal', ['Multiply', ['Subtract', 'x', 2], ['Add', 'x', ['Exp', 'x']]], 0],
        'x',
      ])
      .evaluate();
    expect(parsed.operator).toBe('Solve');
    const json = JSON.stringify(parsed.json);
    expect(json).not.toContain('InvisibleOperator');
    expect(json).not.toContain('Delimiter');
    expect(json).toBe(JSON.stringify(boxed.json));
  });

  test('NSolve keeps the canonical equation too', () => {
    const e = ce
      .parse('\\operatorname{NSolve}((x-2)(x+e^x)=0, x)')
      .evaluate();
    expect(e.operator).toBe('NSolve');
    expect(JSON.stringify(e.json)).not.toContain('InvisibleOperator');
  });

  test('a solved equation is unchanged', () => {
    expect(
      ce.parse('\\operatorname{Solve}(x^2=4, x)').evaluate().toString()
    ).toBe('[2,-2]');
  });
});
