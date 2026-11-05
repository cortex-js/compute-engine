import { ComputeEngine } from '../../src/compute-engine';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

//
// A collection operator that keeps the elements of its operand as they are
// gives a result whose element type is the element type of the operand. A
// result type with an open element type (`list`, `set`, `list<list>`)
// makes a read of an element `any`, and a compiled consumer of such a read
// (`Max`) declines.
//
// GitHub issue #512: `Flatten` of a `list<list<integer>>` was typed `list`,
// so `At(Flatten(xs), i)` was `any`, and `Max` of two such reads did not
// compile.
//

const ce = new ComputeEngine();
ce.declare('xs', 'list<integer>');
ce.declare('ll', 'list<list<integer>>');
ce.declare('lll', 'list<list<list<integer>>>');
ce.declare('lt', 'list<tuple<integer, integer>>');
ce.declare('llt', 'list<list<tuple<integer, integer>>>');
ce.declare('ss', 'set<integer>');
ce.declare('i', 'integer');
ce.declare('j', 'integer');
ce.declare('n', 'integer');
ce.declare('g', '(integer) -> integer');
ce.declare('p', '(integer) -> boolean');

const typeOf = (json: unknown) => ce.box(json as any).type.toString();

describe('FLATTEN', () => {
  test.each([
    [['Flatten', 'll'], 'list<integer>'],
    [['At', ['Flatten', 'll'], 'i'], 'integer'],
    [['Flatten', 'lll'], 'list<integer>'],
    [['Flatten', 'lll', 1], 'list<list<integer>>'],
    [['Flatten', 'lll', 0], 'list<list<list<integer>>>'],
    // A depth that is not a literal does not settle the leaves.
    [['Flatten', 'lll', 'n'], 'list'],
    // A tuple element is kept whole at every depth, with its type.
    [['Flatten', 'lt'], 'list<tuple<integer, integer>>'],
    [['Flatten', 'lt', 1], 'list<tuple<integer, integer>>'],
    [
      ['Flatten', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]],
      'list<tuple<integer, integer>>',
    ],
    [['Flatten', 'lt', 0], 'list<tuple<integer, integer>>'],
    [['Flatten', 'llt', 1], 'list<tuple<integer, integer>>'],
    // A number operand is wrapped in a list.
    [['Flatten', 'i'], 'list<integer>'],
    // A set operand stays unevaluated: no element type.
    [['Flatten', 'ss'], 'list'],
    [['Flatten', ['Map', ['Function', ['Most', 'b'], 'b'], 'll']], 'list<integer>'],
  ])('%j is %s', (json, type) => {
    expect(typeOf(json)).toBe(type);
  });

  test.each([
    [['Flatten', ['List', ['List', 1, 2], ['List', 3]]]],
    [['Flatten', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]]],
    [['Flatten', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 1]],
    [['Flatten', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4, 5]]]],
    [['Flatten', ['List', ['Tuple', 1.5, "'a'"], 3]]],
    [['Flatten', ['List', ['List', ['List', 1]], ['List', 2]], 1]],
    [['Flatten', ['List', "'ab'", ['List', "'c'"]]]],
    [['Flatten', ['List', ['List', 1, 'Missing'], ['List', 2]]]],
  ])('the value of %j is in its type', (json) => {
    const expr = ce.box(json as any);
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  // An element that cannot be spliced leaves the `Flatten` unevaluated, so
  // its type holds no wrong value: an infinite list, a list not known to be
  // finite, and an unevaluated read of a list with no value.
  test.each([
    [['List', ['List', 1], ['Cycle', ['List', 2]]]],
    [['List', ['List', 1], ['Filter', ['Cycle', ['List', 2]], 'p']]],
    [['List', ['List', 1], ['At', 'll', 1]]],
    [['List', ['List', 1], ['First', 'll']]],
  ])('%j leaves the `Flatten` unevaluated', (operand) => {
    const expr = ce.box(['Flatten', operand]);
    expect(expr.type.toString()).toBe('list<integer>');
    expect(expr.evaluate().operator).toBe('Flatten');
  });

  // A tuple element is kept whole, whatever the form of the call. The tensor
  // branch of the evaluate handler and `flattenToDepth()` gave different
  // results before.
  test.each([
    [['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], undefined, '[(1, 2),(3, 4)]'],
    [['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 1, '[(1, 2),(3, 4)]'],
    [['List', ['Tuple', 1, 2], ['Tuple', 3, 4, 5]], undefined, '[(1, 2),(3, 4, 5)]'],
    [['List', ['Tuple', 1, 2], ['List', 3]], undefined, '[(1, 2),3]'],
    [['List', ['Pair', 1, 2], ['List', ['Tuple', 3, 4]]], undefined, '[(1, 2),(3, 4)]'],
    // A tuple OPERAND is opened, but its elements follow the same rule.
    [['Tuple', ['List', 1, 2], 3], undefined, '[1,2,3]'],
    [['Tuple', ['Tuple', 1, 2], 3], undefined, '[(1, 2),3]'],
  ])('Flatten(%j, %s) is %s', (operand, depth, value) => {
    const json = depth === undefined ? ['Flatten', operand] : ['Flatten', operand, depth];
    const expr = ce.box(json as any);
    const result = expr.evaluate();
    expect(result.toString()).toBe(value);
    expect(result.type.matches(expr.type)).toBe(true);
  });

  // The Python `Zip` makes its rows with `list()`, and the Python `Flatten`
  // opens every list, so it declines as the JavaScript `Flatten` does.
  test('the Python `Flatten` declines when a tuple can be reached', () => {
    expect(() =>
      new PythonTarget().compile(ce.box(['Flatten', ['Zip', 'xs', 'xs']]))
    ).toThrow(/Flatten/);
    expect(new PythonTarget().compile(ce.box(['Flatten', 'll'])).success).toBe(
      true
    );
  });

  test('`Max` of two elements of a flattened list compiles (issue #512)', () => {
    const F = ['Flatten', 'll'];
    const r = new JavaScriptTarget().compile(
      ce.box(['Max', ['At', F, 'i'], ['At', F, 'j']])
    );
    expect(r.success).toBe(true);
    expect(r.run!({ ll: [[1, 5], [7, 3]], i: 2, j: 3 })).toBe(7);
  });

  test('the form of issue #512, with `Map` and `Most`, compiles', () => {
    const F = ['Flatten', ['Map', ['Function', ['Most', 'b'], 'b'], 'll']];
    const r = new JavaScriptTarget().compile(
      ce.box(['Max', ['At', F, 'i'], ['At', F, 'j']])
    );
    expect(r.success).toBe(true);
    expect(r.run!({ ll: [[1, 5, 9], [7, 3, 0]], i: 2, j: 3 })).toBe(7);
  });

  // Compiled code holds a tuple as an array, and `Array.prototype.flat()`
  // opens every array, but the interpreter can keep a tuple element whole. So
  // the compilation declines when `flat()` would reach a tuple.
  test.each([
    [['Length', ['Flatten', 'lt']]],
    [['At', ['Flatten', 'lt'], 'i']],
    [['Flatten', 'llt']],
  ])('%j declines: a tuple element would be opened', (json) => {
    expect(() =>
      new JavaScriptTarget().compile(ce.box(json as any))
    ).toThrow(/Flatten/);
  });

  test.each([
    [['Flatten', 'lt', 0], [[1, 2], [3, 4]]],
    [['Flatten', 'llt', 1], [[1, 2], [3, 4]]],
    [['Flatten', 'lll', 1], [[1], [2], [3]]],
  ])('%j compiles: the depth stops before the tuples', (json, expected) => {
    const r = new JavaScriptTarget().compile(ce.box(json as any));
    expect(r.success).toBe(true);
    expect(
      r.run!({ lt: [[1, 2], [3, 4]], llt: [[[1, 2]], [[3, 4]]], lll: [[[1], [2]], [[3]]] })
    ).toEqual(expected);
  });
});

describe('OTHER OPERATORS KEEP THE ELEMENT TYPE', () => {
  test.each([
    [['Chunk', 'xs', 2], 'list<list<integer>>'],
    [['GroupBy', 'xs', 'g'], 'dictionary<list<integer>>'],
    [['Cycle', 'xs'], 'list<integer>'],
    [['Union', 'ss', 'ss'], 'set<integer>'],
    [['Intersection', 'ss', 'ss'], 'set<integer>'],
    [['SetMinus', 'ss', 'ss'], 'set<integer>'],
    [['Join', ['Set', 1], ['Set', 2]], 'set<integer>'],
    [['Iterate', 'g', 1], 'list<integer>'],
    [['Reshape', 'xs', ['Tuple', 2, 2]], 'matrix<integer^(2x2)>'],
    [['Tabulate', ['Function', ['Multiply', 2, 'k'], 'k'], 5], 'vector<integer^5>'],
    [
      ['Tabulate', ['Function', ['N', ['Divide', 'k', 3]], 'k'], 3],
      'vector<real^3>',
    ],
    // A string source makes groups that are strings.
    [['Chunk', { str: 'abcd' }, 2], 'list<string>'],
  ])('%j is %s', (json, type) => {
    expect(typeOf(json)).toBe(type);
  });

  // The type of a function literal is computed with parameters of unknown
  // type, so it does not give the elements of an iteration: `x ↦ x + 1`
  // with the initial value `[1, 2]` gives lists.
  test('`Iterate` of a function literal keeps the open element type', () => {
    expect(
      typeOf(['Iterate', ['Function', ['Add', 'x', 1], 'x'], ['List', 1, 2]])
    ).toBe('list');
  });

  // The result type in the signature of a symbol does not give the elements:
  // `f := x ↦ x + 1` is typed `(unknown) -> number`, but with the initial value
  // `[1, 2]` its answers are lists. The call typed on the initial value shows
  // that. A library operator gets no element type: the type handlers of some
  // operators do not give the type of a call on a stand-in operand.
  describe('`Iterate` of a symbol: every element is in the type', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.box(['Function', ['Add', 'x', 1], 'x']));
    engine.assign('half', engine.box(['Function', ['Divide', 'x', 2], 'x']));
    engine.assign('wrap', engine.box(['Function', ['List', 'x'], 'x']));
    test.each([
      [['Iterate', 'f', ['List', 1, 2]], 'list<vector<2>>'],
      [['Iterate', 'f', 1], 'list<number>'],
      [['Iterate', 'half', 1], 'list<number>'],
      [['Iterate', 'Negate', ['List', 1, 2]], 'list'],
      [['Iterate', 'Negate', 1], 'list'],
      [['Iterate', 'AbsArg', 1], 'list'],
      // The answers grow at each step, so no type holds them all.
      [['Iterate', 'wrap', 1], 'list'],
    ])('%j', (json, type) => {
      const expr = engine.box(json as any);
      expect(expr.type.toString()).toBe(type);
      const elements = [];
      for (const e of expr.evaluate().each()) {
        elements.push(e);
        if (elements.length === 4) break;
      }
      expect(engine.function('List', elements).type.matches(expr.type)).toBe(
        true
      );
    });
  });

  // A flat list of booleans is finite: a `Cycle` is refused when the
  // expression is boxed, although its type is `list<boolean>`.
  test('an unbounded condition of `Which` is still a static error', () => {
    const r = ce
      .box([
        'Which',
        ['List', 'False', 'False'],
        1,
        ['Cycle', ['List', 'True', 'False']],
        2,
      ])
      .evaluate();
    expect(r.isValid).toBe(false);
    expect(r.toString()).toMatch(/incompatible-type/);
  });
});
