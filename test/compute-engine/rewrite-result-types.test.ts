/**
 * The static result types of operators whose declared result is broader than
 * what their operands determine.
 *
 * - `TrigExpand`, `TrigToExp` and `TrigReduce` are declared
 *   `(value) -> value`. A numeric operand gives `number` (never the
 *   operand's own type: `TrigToExp` of a real operand is typed `complex`, and
 *   a rewrite does not keep a range). A boolean operand gives `boolean` for
 *   `TrigExpand` and `TrigToExp`. Any other operand keeps `value`.
 * - `TupleFrom` is declared `(value*) -> tuple`. When the operand types give
 *   the number and the types of the components, the result is that tuple
 *   type: `TupleFrom([1, 2, 3])` is `tuple<integer, integer, integer>`.
 *
 * Each case checks the static type, and that the type of the evaluated value
 * (`evaluate()` and `N()`) is a subtype of it.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';

const ce = new ComputeEngine();
ce.declare('a', 'real');
ce.declare('b', 'real');
ce.declare('P', 'boolean');
ce.declare('M', 'number | missing');

/** The static type, after checking that every evaluated value fits it. */
function staticType(expr: Expression): string {
  const t = expr.type.type;
  for (const v of [expr.evaluate(), expr.N()])
    expect([
      v.toString(),
      v.type.toString(),
      isSubtype(v.type.type, t),
    ]).toEqual([v.toString(), v.type.toString(), true]);
  return expr.type.toString();
}

describe('TRIGEXPAND RESULT TYPE', () => {
  test.each<[string, unknown, string]>([
    ['sum angle', ['TrigExpand', ['Sin', ['Add', 'a', 'b']]], 'number'],
    ['multiple angle', ['TrigExpand', ['Cos', ['Multiply', 3, 'a']]], 'number'],
    // `Tan(a + b)` expands to a quotient, which can be infinite: a ranged or
    // real claim would be wrong.
    ['quotient', ['TrigExpand', ['Tan', ['Add', 'a', 'b']]], 'number'],
    [
      'ranged operand',
      ['TrigExpand', ['Power', ['Sin', ['Multiply', 2, 'a']], 2]],
      'number',
    ],
    ['hyperbolic', ['TrigExpand', ['Sinh', ['Add', 'a', 'b']]], 'number'],
    ['complex argument', ['TrigExpand', ['Sin', ['Complex', 1, 2]]], 'number'],
    ['NaN', ['TrigExpand', 'NaN'], 'number'],
    ['complex infinity', ['TrigExpand', ['Divide', 1, 0]], 'number'],
    [
      'equation',
      ['TrigExpand', ['Equal', ['Sin', ['Multiply', 2, 'a']], 0]],
      'boolean',
    ],
    [
      'inequality',
      ['TrigExpand', ['Less', ['Sin', ['Add', 'a', 'b']], 1]],
      'boolean',
    ],
    [
      'connective',
      ['TrigExpand', ['And', 'P', ['Less', ['Sin', 'a'], 1]]],
      'boolean',
    ],
    ['boolean symbol', ['TrigExpand', 'P'], 'boolean'],
    // A collection or a string keeps the declared result.
    [
      'list',
      ['TrigExpand', ['List', ['Sin', ['Add', 'a', 'b']], ['Cos', 'a']]],
      'value',
    ],
    ['tuple', ['TrigExpand', ['Tuple', ['Sin', 'a'], 3]], 'value'],
    ['string', ['TrigExpand', "'hello'"], 'value'],
  ])('%s', (_label, json, expected) => {
    expect(staticType(ce.box(json as any))).toBe(expected);
  });

  test('the same type on the box, parse and function routes', () => {
    const box = ce.box(['TrigExpand', ['Sin', ['Add', 'a', 'b']]]);
    const parsed = ce.parse('\\operatorname{TrigExpand}(\\sin(a+b))');
    const fn = ce.function('TrigExpand', [ce.box(['Sin', ['Add', 'a', 'b']])]);
    expect([staticType(box), staticType(parsed), staticType(fn)]).toEqual([
      'number',
      'number',
      'number',
    ]);
  });

  test('an operand that is an error makes the call an error', () => {
    // `sin(a)·P` multiplies a boolean: its canonical form is an error. The
    // operand is bound at canonicalization, so the call is typed `error`,
    // as its value is.
    const expr = ce.box(['TrigExpand', ['Multiply', ['Sin', 'a'], 'P']]);
    expect(expr.type.toString()).toBe('error');
    expect(expr.evaluate().type.toString()).toBe('error');
  });

  test('a parameter that has the name of a global is typed as the parameter', () => {
    // `P ↦ TrigExpand(P)` with a global boolean `P`: the call `g(3)` has
    // the value `3`. The operand is bound in the scope of the function
    // literal, so the global `P` does not type it.
    const ce2 = new ComputeEngine();
    ce2.declare('P', 'boolean');
    ce2.assign('g', ce2.box(['Function', ['TrigExpand', 'P'], 'P']));
    const call = ce2.box(['g', 3]);
    expect(isSubtype(call.evaluate().type.type, call.type.type)).toBe(true);
    expect(call.type.toString()).not.toBe('boolean');
  });
});

describe('TRIGTOEXP RESULT TYPE', () => {
  test.each<[string, unknown, string]>([
    // A real operand: the exponential form is typed `complex`, so the
    // result is `number`, not `real`.
    ['real operand', ['TrigToExp', ['Cos', 'a']], 'number'],
    ['real constant', ['TrigToExp', ['Cos', 'ExponentialE']], 'number'],
    ['sum angle', ['TrigToExp', ['Sin', ['Add', 'a', 'b']]], 'number'],
    ['quotient', ['TrigToExp', ['Tan', ['Add', 'a', 'b']]], 'number'],
    [
      'product',
      ['TrigToExp', ['Multiply', ['Sin', 'a'], ['Cos', 'b']]],
      'number',
    ],
    ['hyperbolic', ['TrigToExp', ['Cosh', ['Multiply', 3, 'a']]], 'number'],
    ['integer', ['TrigToExp', 2], 'number'],
    ['NaN', ['TrigToExp', 'NaN'], 'number'],
    [
      'equation',
      ['TrigToExp', ['Equal', ['Sin', ['Multiply', 2, 'a']], 0]],
      'boolean',
    ],
    [
      'connective',
      ['TrigToExp', ['And', 'P', ['Less', ['Sin', 'a'], 1]]],
      'boolean',
    ],
    ['list', ['TrigToExp', ['List', ['Sin', 'a'], ['Cos', 'b']]], 'value'],
    ['string', ['TrigToExp', "'hello'"], 'value'],
  ])('%s', (_label, json, expected) => {
    expect(staticType(ce.box(json as any))).toBe(expected);
  });

  test('a real operand evaluates to a complex-typed value', () => {
    const expr = ce.box(['TrigToExp', ['Cos', 'ExponentialE']]);
    expect(expr.evaluate().type.toString()).toBe('complex');
    expect(expr.type.toString()).toBe('number');
  });

  test('the parse route', () => {
    expect(staticType(ce.parse('\\operatorname{TrigToExp}(\\cos a)'))).toBe(
      'number'
    );
  });
});

describe('TRIGREDUCE RESULT TYPE', () => {
  test.each<[string, unknown, string]>([
    ['square', ['TrigReduce', ['Power', ['Sin', 'a'], 2]], 'number'],
    [
      'product',
      ['TrigReduce', ['Multiply', ['Sin', 'a'], ['Cos', 'b']]],
      'number',
    ],
    ['quotient', ['TrigReduce', ['Tan', ['Add', 'a', 'b']]], 'number'],
    ['hyperbolic', ['TrigReduce', ['Cosh', ['Multiply', 3, 'a']]], 'number'],
    ['complex argument', ['TrigReduce', ['Sin', ['Complex', 1, 2]]], 'number'],
    ['constant', ['TrigReduce', 'Pi'], 'number'],
    ['NaN', ['TrigReduce', 'NaN'], 'number'],
    // `TrigReduce` reads its operand as a sum of products: no boolean result
    // is claimed for an equation, and no shape for a list.
    [
      'equation',
      ['TrigReduce', ['Equal', ['Sin', ['Multiply', 2, 'a']], 0]],
      'value',
    ],
    ['boolean symbol', ['TrigReduce', 'P'], 'value'],
    ['list', ['TrigReduce', ['List', ['Sin', 'a'], ['Cos', 'b']]], 'value'],
    ['string', ['TrigReduce', "'hello'"], 'value'],
  ])('%s', (_label, json, expected) => {
    expect(staticType(ce.box(json as any))).toBe(expected);
  });

  test('the parse and function routes', () => {
    expect(staticType(ce.parse('\\operatorname{TrigReduce}(\\sin(a)^2)'))).toBe(
      'number'
    );
    expect(
      staticType(ce.function('TrigReduce', [ce.parse('\\sin(a)\\cos(a)')]))
    ).toBe('number');
  });
});

describe('TRIG REWRITES OF AN OPERAND THAT MAY NOT BE A VALUE', () => {
  // An operand whose type is not below `value` (`Missing`, a symbol with no
  // type, a possibly absent symbol) gives its own type: the declared result
  // `value` does not hold such a value. A tuple keeps the declared `value`.
  test.each<[string, unknown, string, string]>([
    ['Missing', ['TrigExpand', 'Missing'], 'missing', 'missing'],
    [
      'possibly absent symbol',
      ['TrigExpand', 'M'],
      'missing | number',
      'missing | number',
    ],
    ['symbol with no type', ['TrigToExp', 'zz'], 'unknown', 'unknown'],
    [
      'tuple under TrigReduce',
      ['TrigReduce', ['Tuple', ['Sin', 'a'], 3]],
      'value',
      'tuple<real, integer>',
    ],
  ])('%s', (_label, json, staticType, valueType) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(staticType);
    const v = expr.evaluate();
    expect(v.type.toString()).toBe(valueType);
    expect(v.type.matches(expr.type)).toBe(true);
  });

  test('a `Nothing` operand is erased, as for any operator', () => {
    // The operand is bound at canonicalization, so `Nothing` is erased
    // from the argument list, as `Sin(Nothing)` is `Sin()`: the call is
    // the error of a missing argument. It was `Nothing` (`TrigReduce`:
    // `0`) while the operand stayed unbound.
    for (const op of ['TrigExpand', 'TrigToExp', 'TrigReduce']) {
      const expr = ce.box([op, 'Nothing']);
      expect(expr.type.toString()).toBe('error');
      expect(expr.evaluate().toString()).toBe('Error("missing")');
    }
  });
});

describe('TUPLEFROM RESULT TYPE', () => {
  const ce = new ComputeEngine();
  ce.declare('L3', 'list<integer^3>');
  ce.assign('L3', ce.box(['List', 4, 5, 6]));
  ce.declare('V3', 'list<integer^3>');
  ce.declare('M23', 'matrix<integer^(2x3)>');
  ce.assign('M23', ce.box(['List', ['List', 1, 2, 3], ['List', 4, 5, 6]]));
  ce.declare('Lu', 'list<integer>');
  ce.assign('Lu', ce.box(['List', 1, 2]));
  ce.declare('Ln', 'list<number^2>');
  ce.assign('Ln', ce.box(['List', 'u', 'v']));
  ce.declare('Lr', 'list<real^2>');
  ce.assign('Lr', ce.box(['List', 1.5, 'Pi']));
  ce.declare('Lm', 'list<integer^3> | missing');
  ce.declare('T2', 'tuple<integer, string>');
  ce.assign('T2', ce.box(['Tuple', 1, "'a'"]));
  ce.declare('n', 'integer');
  ce.declare('B', 'boolean');
  ce.assign('B', ce.False);
  ce.declare('x', 'real');
  ce.assign('x', 0.5);

  test.each<[string, unknown, string]>([
    [
      'list literal',
      ['TupleFrom', ['List', 1, 2, 3]],
      'tuple<integer, integer, integer>',
    ],
    [
      'absent cell',
      ['TupleFrom', ['List', 1, 'Missing', 3]],
      'tuple<integer, missing, integer>',
    ],
    [
      'Undefined cell',
      ['TupleFrom', ['List', 1, 'Undefined']],
      'tuple<integer, missing>',
    ],
    [
      'Nothing cell',
      ['TupleFrom', ['List', 1, 'Nothing', 3]],
      'tuple<integer, integer>',
    ],
    [
      'mixed list',
      ['TupleFrom', ['List', 1, "'a'", 'True']],
      'tuple<integer, string, boolean>',
    ],
    [
      'scalar and list',
      ['TupleFrom', 5, ['List', 1.5, 2]],
      'tuple<integer, real, integer>',
    ],
    [
      'matrix literal',
      ['TupleFrom', ['List', ['List', 1, 2], ['List', 3, 4]]],
      'tuple<vector<integer^2>, vector<integer^2>>',
    ],
    [
      'tuple literal',
      ['TupleFrom', ['Tuple', 1, "'a'"]],
      'tuple<integer, string>',
    ],
    [
      'declared vector',
      ['TupleFrom', 'L3'],
      'tuple<integer, integer, integer>',
    ],
    // A valueless symbol stays unevaluated, with the same type.
    [
      'valueless vector',
      ['TupleFrom', 'V3'],
      'tuple<integer, integer, integer>',
    ],
    [
      'declared matrix',
      ['TupleFrom', 'M23'],
      'tuple<vector<integer^3>, vector<integer^3>>',
    ],
    ['declared real vector', ['TupleFrom', 'Lr'], 'tuple<real, real>'],
    ['declared tuple', ['TupleFrom', 'T2'], 'tuple<integer, string>'],
    [
      'vector expression',
      ['TupleFrom', ['Add', ['List', 1, 2], 1]],
      'tuple<integer, integer>',
    ],
    // `Abs(x)` is `real<0..>`, and its value `0.5` is a `real` component.
    ['ranged component', ['TupleFrom', ['Abs', 'x']], 'tuple<real>'],
    [
      'possibly absent operand',
      ['TupleFrom', 'Lm'],
      'missing | tuple<integer, integer, integer>',
    ],
    [
      'restricted list',
      ['TupleFrom', ['When', ['List', 1, 2], ['Greater', 'n', 0]]],
      'missing | tuple<integer, integer>',
    ],
    // The operand types do not give the components: the declared `tuple`.
    ['list of unknown length', ['TupleFrom', 'Lu'], 'tuple'],
    // `L := [u, v]` matches `list<number^2>`, and its components are `u` and
    // `v`, whose type is `unknown`.
    ['number cells', ['TupleFrom', 'Ln'], 'tuple'],
    [
      'possibly Nothing cell',
      ['TupleFrom', ['List', ['If', 'B', 1, 'Nothing'], 2]],
      'tuple',
    ],
    ['Range', ['TupleFrom', ['Range', 1, 3]], 'tuple'],
    ['list of a Range', ['TupleFrom', ['List', ['Range', 1, 3]]], 'tuple'],
    // A Range inside a nested literal evaluates to a list too: the nested
    // literal is accepted only when each of its elements is.
    [
      'nested list of a Range',
      ['TupleFrom', ['List', ['List', ['Range', 1, 2]]]],
      'tuple',
    ],
    [
      'nested tuple with a Range',
      ['TupleFrom', ['List', ['Tuple', ['Range', 1, 2], 1]]],
      'tuple',
    ],
    [
      'nested literal of numbers',
      ['TupleFrom', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
      'tuple<tuple<integer, integer>, tuple<integer, integer>>',
    ],
    ['string', ['TupleFrom', "'abc'"], 'tuple'],
    ['set', ['TupleFrom', ['Set', 1, 2]], 'tuple'],
    // The literal list does not infer its free symbols (CE-663), and the
    // components of the tuple are read from the elements.
    ['symbols with no type', ['TupleFrom', ['List', 'p', 'q']], 'tuple'],
    ['Missing', ['TupleFrom', 'Missing'], 'missing | tuple'],
  ])('%s', (_label, json, expected) => {
    expect(staticType(ce.box(json as any))).toBe(expected);
  });

  test('an empty list gives the empty tuple', () => {
    const expr = ce.box(['TupleFrom', ['List']]);
    staticType(expr);
    expect(expr.type.type).toEqual({ kind: 'tuple', elements: [] });
    expect(isSubtype(parseType('tuple<integer>'), expr.type.type)).toBe(false);
  });

  test('the parse route', () => {
    expect(staticType(ce.parse('\\operatorname{TupleFrom}([1, 2, 3])'))).toBe(
      'tuple<integer, integer, integer>'
    );
  });
});
