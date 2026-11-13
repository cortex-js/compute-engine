import { ComputeEngine } from '../../src/compute-engine';
import {
  isFunction,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

// A letter that names a library operator (`N`, `D`) and is used as a value is
// a free name read as a variable, with the scope the expression is parsed in
// as its home. Read outside that scope, the name finds the library operator;
// the occurrence is still a free variable, as `evaluate()` and `subs()` treat
// it.

describe('unknowns of a library letter parsed in a created scope', () => {
  test.each(['N', 'D'])('`y = x + %s`', (letter) => {
    const ce = new ComputeEngine();
    const expected = [letter, 'x', 'y'].sort();
    expect(ce.parse(`y=x+${letter}`).unknowns).toEqual(expected);
    const scoped = ce.parse(`y=x+${letter}`, { scope: ce.createScope() });
    expect(scoped.unknowns).toEqual(expected);
    expect(scoped.freeVariables).toEqual(expected);
  });

  test('a value given to the letter in the scope is read by the expression parsed in it', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    const expr = ce.parse('x+N', { scope });
    if (!isFunction(expr)) throw new Error('expected a function expression');
    const n = expr.ops.find((op) => isSymbol(op, 'N'));
    if (n === undefined || !isSymbol(n))
      throw new Error('expected the symbol `N`');
    // The parse declares no name: the value is given by an assignment in
    // the scope.
    expect(n.valueDefinition).toBeUndefined();
    ce._inScope(scope, () => ce.assign('N', 3));
    expect(ce._inScope(scope, () => expr.evaluate().json)).toEqual([
      'Add',
      'x',
      3,
    ]);
    // The expression reads `N` from the scope it was parsed in, also when
    // that scope is not current.
    expect(expr.evaluate().json).toEqual(['Add', 'x', 3]);
    expect(expr.unknowns).toEqual(['x']);
  });

  test('an applied library operator is still not a free variable', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\mathrm{N}(x)', { scope: ce.createScope() });
    expect(expr.unknowns).toEqual(['x']);
  });
});
