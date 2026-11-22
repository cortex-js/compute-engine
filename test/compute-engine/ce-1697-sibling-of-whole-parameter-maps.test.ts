/**
 * CE-1697: a list at a parameter with no type is mapped, one call per
 * element, also when another parameter binds its argument whole (user
 * decision 2026-11-22, `docs/BROADCAST-MODEL.md` rule 1). The parameter that
 * binds whole is not part of the map.
 */
import { ComputeEngine } from '../../src/compute-engine';

const L = ['List', 1, 2, 6];

describe('a list at an untyped parameter beside a whole-bound one', () => {
  const ce = new ComputeEngine();
  const run = (expr: unknown) =>
    JSON.stringify(ce.box(expr as never).evaluate().json);
  const typeOf = (expr: unknown) => ce.box(expr as never).type.toString();

  test('a recursion on the count ends for each element', () => {
    ce.assign('rec', [
      'Function',
      [
        'Which',
        ['Equal', 'n', 0],
        0,
        'True',
        ['Add', ['Mean', 'L'], ['rec', 'L', ['Subtract', 'n', 1]]],
      ],
      'L',
      'n',
    ] as never);
    expect(run(['rec', L, ['List', 1, 2]])).toBe('["List",3,6]');
    expect(run(['rec', L, 2])).toBe('6');
  });

  test('a parameter made a collection by the recursion binds whole', () => {
    ce.assign('self', [
      'Function',
      [
        'If',
        ['Equal', 'n', 0],
        's',
        ['self', ['Subtract', 'n', 1], ['List', 1, 2]],
      ],
      'n',
      's',
    ] as never);
    expect(run(['self', ['List', 0, 1], ['List', 9]])).toBe(
      '["List",["List",9],["List",1,2]]'
    );
  });

  test('each element is one call, and the call is typed as a list', () => {
    ce.assign('take', ['Function', ['Take', 'L', 'k'], 'L', 'k'] as never);
    expect(run(['take', ['List', 10, 20, 30], ['List', 1, 2]])).toBe(
      '["List",["List",10],["List",10,20]]'
    );
    ce.assign('scale', [
      'Function',
      ['Multiply', ['Mean', 'L'], 'k'],
      'L',
      'k',
    ] as never);
    expect(run(['scale', L, ['List', 1, 2]])).toBe('["List",3,6]');
    expect(typeOf(['scale', L, ['List', 1, 2]])).toBe('list<number>');
    expect(typeOf(['scale', L, 2])).toBe('number');
  });

  test('a body that pairs the whole list with the element gives one row per element', () => {
    ce.assign('pair', [
      'Function',
      ['Add', ['Mean', 'L'], ['Multiply', 'L', 'k']],
      'L',
      'k',
    ] as never);
    expect(run(['pair', L, ['List', 1, 2]])).toBe(
      '["List",["List",4,5,9],["List",5,7,15]]'
    );
  });

  test('Apply of the literal maps as the named call', () => {
    const literal = ['Function', ['Multiply', ['Mean', 'L'], 'k'], 'L', 'k'];
    const pairs = [
      'Function',
      ['Add', ['Mean', 'L'], ['Multiply', 'L', 'k']],
      'L',
      'k',
    ];
    ce.assign('pairs', pairs as never);
    expect(run(['Apply', literal, L, ['List', 1, 2]])).toBe('["List",3,6]');
    expect(typeOf(['Apply', literal, L, ['List', 1, 2]])).toBe('list<number>');
    expect(run(['Apply', pairs, L, ['List', 1, 2]])).toBe(
      run(['pairs', L, ['List', 1, 2]])
    );
    expect(typeOf(['Apply', pairs, L, ['List', 1, 2]])).toBe(
      typeOf(['pairs', L, ['List', 1, 2]])
    );
  });

  test('a collection at a wide parameter makes the cell any', () => {
    // The signature result `number` does not describe a cell when `L`,
    // declared `expression`, holds a list.
    const wide = [
      'Function',
      ['Multiply', 'L', 'k'],
      ['Typed', 'L', "'expression'"],
      'k',
    ];
    ce.assign('wide', wide as never);
    for (const call of [
      ['wide', L, ['List', 1, 2]],
      ['Apply', wide, L, ['List', 1, 2]],
    ]) {
      const expr = ce.box(call as never);
      expect(expr.type.toString()).toBe('list<any>');
      const value = expr.evaluate();
      expect(JSON.stringify(value.json)).toBe(
        '["List",["List",1,2,6],["List",2,4,12]]'
      );
      expect(value.type.matches(expr.type)).toBe(true);
    }
  });

  test('Apply of a literal returned by a call is typed as the map', () => {
    ce.assign('mk', [
      'Function',
      ['Function', ['Tuple', ['Mean', 'L'], 'k', 'a'], 'L', 'k'],
      'a',
    ] as never);
    const expr = ce.box(['Apply', ['mk', 2], L, ['List', 1, 2]] as never);
    const value = expr.evaluate();
    expect(JSON.stringify(value.json)).toBe(
      '["List",["Tuple",3,1,2],["Tuple",3,2,2]]'
    );
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('a declared scalar parameter of a built-in does not map', () => {
    // `Repeat(value, integer)`: the count is declared, not `unknown`.
    expect(ce.box(['Repeat', 0, ['List', 1, 2]] as never).isValid).toBe(false);
  });

  test('a function-typed parameter does not change the map', () => {
    ce.assign('app', ['Function', ['f', 'x'], 'f', 'x'] as never);
    expect(run(['app', 'Sqrt', ['List', 4, 9]])).toBe('["List",2,3]');
  });
});
