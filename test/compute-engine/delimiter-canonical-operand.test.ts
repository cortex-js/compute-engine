import { ComputeEngine } from '../../src/compute-engine';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

//
// The canonical form of a `Delimiter` with a delimiter other than
// parentheses (`[x]`, `|x|`) keeps the `Delimiter`, so that other operators
// can read it. Its body is the canonical form of the body: a canonical
// expression does not hold a non-canonical operand.
//

const ce = new ComputeEngine();

describe('the body of a kept Delimiter is canonical', () => {
  test.each([["'[]'", '[x + 3]'], ["'||'", '|x + 3|']])(
    'box route, delimiter %s',
    (delimiter, text) => {
      const expr = ce.box(['Delimiter', ['Add', 1, 2, 'x'], delimiter]);
      expect(expr.isCanonical).toBe(true);
      expect(expr.operator).toBe('Delimiter');
      expect(expr.toString()).toBe(text);
      expect(expr.json).toEqual(['Delimiter', ['Add', 'x', 3], delimiter]);
      if (!isFunction(expr)) throw new Error('expected a function');
      expect(expr.op1.isCanonical).toBe(true);
      // Arithmetic on the operand works (it asserts on a non-canonical
      // operand).
      expect(expr.op1.add(ce.number(1)).toString()).toBe('x + 4');
      expect(expr.evaluate().toString()).toBe('x + 3');
    }
  );

  test('ce.function route', () => {
    const body = ce.box(['Add', 1, 2, 'x'], { form: 'raw' });
    const expr = ce.function('Delimiter', [body, ce.string('[]')]);
    expect(expr.toString()).toBe('[x + 3]');
    if (!isFunction(expr)) throw new Error('expected a function');
    expect(expr.op1.isCanonical).toBe(true);
  });

  test('parentheses and no delimiter still unwrap the body', () => {
    expect(ce.box(['Delimiter', ['Add', 1, 2, 'x']]).json).toEqual([
      'Add',
      'x',
      3,
    ]);
    expect(ce.box(['Delimiter', ['Add', 1, 2, 'x'], "'()'"]).json).toEqual([
      'Add',
      'x',
      3,
    ]);
  });
});
