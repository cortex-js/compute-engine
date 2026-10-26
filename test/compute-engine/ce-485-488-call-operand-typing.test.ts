/**
 * ROADMAP CE-485 and CE-488: the static type of a call of a user function
 * must hold the value of the call.
 *
 * CE-485. With `k: (real) -> real` holding `x ↦ 2x`, the call maps over an
 * argument that is a list. An operand typed `any` can be a list, so the box
 * route types `k(w)` with `w: any` as `any`. The descriptor route
 * (`deriveApplicationType`) over a descriptor made from the type `any` gave
 * `real`, and `Map(k, L)` with `L: list<any>` was typed `list<… | real>` for
 * the value `[[2, 4]]`.
 *
 * CE-488. A nominal type is not a subtype of its definition. With
 * `k: (tuple<number, number>) -> number`, the nominal type
 * `B = list<tuple<number, number>>` and `x: B`, the call `k(x)` was typed
 * `list<number>` (the typing read through `B` to its list of points), and its
 * value is an `incompatible-type` error. The typing now keeps the nominal
 * reference, as the evaluation does, and the call is typed `error`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';

function derived(ce: ComputeEngine, op: string, types: string[]): string {
  const t = deriveApplicationType(
    ce,
    op,
    types.map((x) => describeType(parseType(x)))
  );
  return t === undefined ? 'undefined' : typeToString(t);
}

describe('AN OPERAND TYPED any AT A DECLARED SCALAR PARAMETER (CE-485)', () => {
  const ce = new ComputeEngine();
  ce.declare('k', '(real) -> real');
  ce.assign('k', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
  ce.declare('w', 'any');
  ce.declare('L', 'list<any>');

  test('the box route and the descriptor route give the same type', () => {
    expect(ce.box(['k', 'w']).type.toString()).toBe('any');
    expect(derived(ce, 'k', ['any'])).toBe('any');
    ce.declare('v', 'value');
    expect(ce.box(['k', 'v']).type.toString()).toBe('value');
    expect(derived(ce, 'k', ['value'])).toBe('value');
  });

  test('a scalar operand keeps the declared result', () => {
    expect(derived(ce, 'k', ['real'])).toBe('real');
    expect(derived(ce, 'k', ['integer'])).toBe('real');
  });

  test('Map over a list<any> admits a list element', () => {
    const expr = ce.box(['Map', 'k', 'L']);
    expect(expr.type.toString()).toBe(
      'list<indexed_collection<any> | nan | nothing | real>'
    );
    const local = new ComputeEngine();
    local.declare('k', '(real) -> real');
    local.assign('k', local.box(['Function', ['Multiply', 2, 'x'], 'x']));
    local.declare('L', 'list<any>');
    local.assign('L', local.box(['List', ['List', 1, 2], 3]));
    const call = local.box(['Map', 'k', 'L']);
    const value = call.evaluate();
    expect(value.toString()).toBe('[[2,4],6]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('the call over a list value holds its value', () => {
    const local = new ComputeEngine();
    local.declare('k', '(real) -> real');
    local.assign('k', local.box(['Function', ['Multiply', 2, 'x'], 'x']));
    local.declare('w', 'any');
    local.assign('w', local.box(['List', 1, 2]));
    const call = local.box(['k', 'w']);
    const value = call.evaluate();
    expect(value.toString()).toBe('[2,4]');
    expect(value.type.matches(call.type)).toBe(true);
  });
});

describe('A NOMINAL LIST OF POINTS AT A POINT PARAMETER (CE-488)', () => {
  const ce = new ComputeEngine();
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign(
    'k',
    ce.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
  );
  ce.declareType('B', 'list<tuple<number, number>>');
  ce.declareType('A', 'list<tuple<number, number>>', { alias: true });
  ce.declare('x', 'B');
  ce.declare('a', 'A');
  ce.declare('y', 'list<tuple<number, number>>');

  test('the call is typed error, as its value is', () => {
    const call = ce.box(['k', 'x']);
    expect(call.type.toString()).toBe('error');
    const value = call.evaluate();
    expect(value.operator).toBe('Error');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('a transparent alias and the plain list type still map', () => {
    expect(ce.box(['k', 'a']).type.toString()).toBe('list<number>');
    expect(ce.box(['k', 'y']).type.toString()).toBe('list<number>');
  });

  test('a list of points value maps', () => {
    const local = new ComputeEngine();
    local.declare('k', '(tuple<number, number>) -> number');
    local.assign(
      'k',
      local.box(['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'])
    );
    local.declare('y', 'list<tuple<number, number>>');
    local.assign('y', local.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const call = local.box(['k', 'y']);
    const value = call.evaluate();
    expect(value.toString()).toBe('[3,7]');
    expect(value.type.matches(call.type)).toBe(true);
  });
});

describe('AN ELEMENT OF A list<unknown> AT A DECLARED SCALAR PARAMETER', () => {
  // An element typed `unknown` can be a ragged list or a list of
  // non-numeric values, as an element of a `list<any>` can: the call maps
  // over it to any depth, and the element of `Map(k, L)` is
  // `real | indexed_collection<any>`.
  const ce = new ComputeEngine();
  ce.declare('k', '(real) -> real');
  ce.assign('k', ce.box(['Function', ['Multiply', 2, 'x'], 'x']));
  ce.declare('Lu', 'list<unknown>');
  ce.declare('LLu', 'list<list<unknown>>');
  ce.declare('LLa', 'list<list<any>>');
  ce.declare('I', 'list<integer>');
  ce.declare('R', 'list<integer | vector<integer^2>>');

  test.each([
    ['Lu', 'list<indexed_collection<any> | real>'],
    ['LLu', 'list<indexed_collection<any> | real>'],
    ['LLa', 'list<indexed_collection<any> | nan | real>'],
    ['I', 'list<real>'],
    // An arm with fixed lengths keeps its lengths in the result.
    ['R', 'list<real | vector<real^2>>'],
  ])('Map(k, %s) is typed %s', (source, type) => {
    expect(ce.box(['Map', 'k', source]).type.toString()).toBe(type);
  });

  test.each([
    // A ragged list inside an element: `broadcastable<real>` does not hold
    // `[[2], [4, 6]]`.
    [
      'Lu',
      ['List', ['List', ['List', 1], ['List', 2, 3]], 4],
      '[[[2],[4,6]],8]',
    ],
    [
      'LLu',
      ['List', ['List', ['List', ['List', 1], ['List', 2, 3]]], ['List', 5]],
      '[[[[2],[4,6]]],[10]]',
    ],
  ])(
    'the value of Map(k, %s) over nested lists matches the type',
    (name, held, expected) => {
      const local = new ComputeEngine();
      local.declare('k', '(real) -> real');
      local.assign('k', local.box(['Function', ['Multiply', 2, 'x'], 'x']));
      local.declare(
        name,
        name === 'Lu' ? 'list<unknown>' : 'list<list<unknown>>'
      );
      const type = local.box(['Map', 'k', name]).type;
      expect(type.toString()).toBe('list<indexed_collection<any> | real>');
      local.assign(name, local.box(held as any));
      const value = local.box(['Map', 'k', name]).evaluate();
      expect(value.toString()).toBe(expected);
      const listed = local.function('List', [...value.each()]);
      expect(listed.type.matches(type)).toBe(true);
    }
  );

  test('a function over a list<unknown> holds the value of a ragged call', () => {
    // `g([[[1], [2, 3]]])` is a list of lists of lists.
    const local = new ComputeEngine();
    local.declare('k', '(real) -> real');
    local.assign('k', local.box(['Function', ['Multiply', 2, 'x'], 'x']));
    local.declare('g', '(list<unknown>) -> unknown');
    local.assign('g', local.box(['Function', ['Map', 'k', 'L'], 'L']));
    const call = local.box([
      'g',
      ['List', ['List', ['List', 1], ['List', 2, 3]]],
    ]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[[[2],[4,6]]]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('the value of a ragged list matches the type', () => {
    const local = new ComputeEngine();
    local.declare('k', '(real) -> real');
    local.assign('k', local.box(['Function', ['Multiply', 2, 'x'], 'x']));
    local.declare('Lu', 'list<unknown>');
    local.assign('Lu', local.box(['List', ['List', 1, 2], 3]));
    const call = local.box(['Map', 'k', 'Lu']);
    expect(call.type.toString()).toBe('list<real | vector<real^2>>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[[2,4],6]');
    const listed = local.function('List', [...value.each()]);
    expect(listed.type.matches(call.type)).toBe(true);
  });
});

describe('A CALL AT A POINT PARAMETER ON THE DESCRIPTOR ROUTE', () => {
  const ce = new ComputeEngine();
  const body = ['Function', ['Add', ['At', 'p', 1], ['At', 'p', 2]], 'p'];
  ce.declare('k', '(tuple<number, number>) -> number');
  ce.assign('k', ce.box(body as any));
  // `h` has an inferred signature.
  ce.assign('h', ce.box(body as any));

  test.each([
    ['list<tuple<number, number>>', 'list<number>'],
    ['tuple<number, number>', 'number'],
    ['list<list<tuple<number, number>>>', 'list<list<number>>'],
    [
      'tuple<number, number> | list<tuple<number, number>>',
      'list<number> | number',
    ],
    ['list<tuple<number, number>> | missing', 'list<number> | missing'],
  ])('over %s, both routes give %s', (t, expected) => {
    const name = `v${t.length}_${t.charCodeAt(5)}`;
    ce.declare(name, t);
    for (const f of ['k', 'h']) {
      expect(ce.box([f, name]).type.toString()).toBe(expected);
      expect(derived(ce, f, [t])).toBe(expected);
    }
  });

  test('the value over a list of points matches the derived type', () => {
    const local = new ComputeEngine();
    local.declare('k', '(tuple<number, number>) -> number');
    local.assign('k', local.box(body as any));
    local.declare('y', 'list<tuple<number, number>>');
    local.assign('y', local.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const t = derived(local, 'k', ['list<tuple<number, number>>']);
    const value = local.box(['k', 'y']).evaluate();
    expect(value.toString()).toBe('[3,7]');
    expect(value.type.matches(t)).toBe(true);
  });
});
