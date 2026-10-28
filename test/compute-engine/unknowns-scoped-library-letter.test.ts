import { ComputeEngine } from '../../src/compute-engine';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// A letter that names a library operator (`N`, `D`) and is used as a value is
// bound to a value definition of the scope the expression is parsed in. Read
// outside that scope, the name finds the library operator; the occurrence is
// still a free variable, as `evaluate()` and `subs()` treat it.

describe('unknowns of a library letter parsed in a created scope', () => {
  test.each(['N', 'D'])('`y = x + %s`', (letter) => {
    const ce = new ComputeEngine();
    const expected = [letter, 'x', 'y'].sort();
    expect(ce.parse(`y=x+${letter}`).unknowns).toEqual(expected);
    const scoped = ce.parse(`y=x+${letter}`, { scope: ce.createScope() });
    expect(scoped.unknowns).toEqual(expected);
    expect(scoped.freeVariables).toEqual(expected);
  });

  test('a value given to the letter in the scope is not read outside it', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('x+N', { scope: ce.createScope() });
    if (!isFunction(expr)) throw new Error('expected a function expression');
    const n = expr.ops.find((op) => isSymbol(op, 'N'));
    if (n === undefined || !isSymbol(n) || n.valueDefinition === undefined)
      throw new Error('expected `N` bound to a value definition');
    n.valueDefinition.value = ce.number(3);
    // `evaluate()` reads the binding of `N` from the current scope (the
    // library operator), not the scope's value.
    expect(expr.evaluate().json).toEqual(['Add', 'N', 'x']);
    expect(expr.unknowns).toEqual(['N', 'x']);
  });

  test('an applied library operator is still not a free variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\mathrm{N}(x)', { scope: ce.createScope() });
    expect(expr.unknowns).toEqual(['x']);
  });
});
