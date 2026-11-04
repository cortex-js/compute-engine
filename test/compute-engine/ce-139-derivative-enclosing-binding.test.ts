/**
 * The type of `D` and of an indefinite `Integrate` holds the values that the
 * enclosing binding of a variable gives them (ROADMAP CE-139).
 *
 * `D` and `Integrate` bind their variables in their own scope, so their type
 * handler types the operand with a scalar variable, and the type was
 * `number`. The value (`D(a^2, a)` is `2a`) still holds the variable, and
 * outside the operator the variable reads its enclosing binding: when that
 * binding is a list, the value is a list. The type now holds that list, and
 * the number of a closed form without the variable (`D(3a, a)` is `3`).
 *
 * Compiled code evaluated the closed form `2a` with the variable read as a
 * number (`(a) => 2 * a`, `NaN` for a list). The compilation now declines
 * then: for a `D` whose closed form holds a variable with a list binding
 * that the compilation scope does not see, and for every `Integrate` whose
 * variable has a list binding.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const LIST = ['List', 1.5, -2, 0.25];

function typeAndValue(ce: ComputeEngine, json: unknown) {
  const expr = ce.box(json as never);
  const value = expr.evaluate();
  return {
    type: expr.type.toString(),
    value: value.toString(),
    valueFitsType: value.type.matches(expr.type),
  };
}

describe('CE-139: D and Integrate over a variable with a list binding', () => {
  test('the function literal of the entry', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['Tuple', ['D', ['Power', 'a', 2], 'a'], ['Reverse', 'a']],
      'a',
    ];
    // `a` may hold a string (`Reverse` accepts one), so the first slot is
    // `any`, not `number`.
    expect(ce.box(fn as never).type.toString()).toBe(
      '(a: indexed_collection<any>) -> tuple<any, list | string>'
    );
    expect(typeAndValue(ce, ['Apply', fn, LIST])).toEqual({
      type: 'tuple<any, list | string>',
      value: '([3,-4,0.5], [0.25,-2,1.5])',
      valueFitsType: true,
    });
  });

  test('a parameter of a list type', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['D', ['Power', 'a', 2], 'a'],
      ['Typed', 'a', "'list<real>'"],
    ];
    expect(ce.box(fn as never).type.toString()).toBe(
      '(a: list<real>) -> list<number> | number'
    );
    expect(typeAndValue(ce, ['Apply', fn, ['List', 1, 2]])).toEqual({
      type: 'list<number> | number',
      value: '[2,4]',
      valueFitsType: true,
    });
  });

  test('a closed form without the variable is a number', () => {
    const ce = new ComputeEngine();
    const apply = (body: unknown) =>
      typeAndValue(ce, [
        'Apply',
        ['Function', body, ['Typed', 'a', "'list<real>'"]],
        ['List', 1, 2],
      ]);
    expect(apply(['D', ['Multiply', 3, 'a'], 'a'])).toEqual({
      type: 'list<number> | number',
      value: '3',
      valueFitsType: true,
    });
    expect(apply(['D', 5, 'a']).value).toBe('0');
    expect(apply(['D', 5, 'a']).valueFitsType).toBe(true);
    expect(apply(['Integrate', ['Multiply', 0, 'a'], 'a'])).toEqual({
      type: 'list<number> | number',
      value: '0',
      valueFitsType: true,
    });
  });

  test('a list result over a list binding is nested', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['D', ['List', ['Power', 'a', 2], ['Power', 'a', 3]], 'a'],
      ['Typed', 'a', "'list<real>'"],
    ];
    expect(typeAndValue(ce, ['Apply', fn, ['List', 1, 2, 3]])).toEqual({
      type: 'any',
      value: '[[2,4,6],[3,12,27]]',
      valueFitsType: true,
    });
  });

  test('a block local of a list type', () => {
    const ce = new ComputeEngine();
    const r = typeAndValue(ce, [
      'Block',
      ['Declare', 'b', "'list<real>'", ['List', 1, 2]],
      ['D', ['Power', 'b', 2], 'b'],
    ]);
    expect(r.type).toBe('list<number> | number');
    expect(r.valueFitsType).toBe(true);
  });

  test('a global of a list type', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'list<real>');
    ce.assign('g', ce.box(['List', 1, 2]));
    expect(typeAndValue(ce, ['Tuple', ['D', ['Power', 'g', 2], 'g']])).toEqual({
      type: 'tuple<list<number> | number>',
      value: '(2g)',
      valueFitsType: true,
    });
    expect(typeAndValue(ce, ['D', ['Multiply', 3, 'g'], 'g'])).toEqual({
      type: 'list<number> | number',
      value: '3',
      valueFitsType: true,
    });
  });

  test('Integrate over a parameter of a list type', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['Integrate', ['Power', 'a', 2], 'a'],
      ['Typed', 'a', "'list<real>'"],
    ];
    expect(typeAndValue(ce, ['Apply', fn, ['List', 1, 2]])).toEqual({
      type: 'list<number> | number',
      value: '[1/3,8/3]',
      valueFitsType: true,
    });
  });

  test('a definite integral has no free variable: its type is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'list<real>');
    const expr = ce.box([
      'Integrate',
      ['Power', 'g', 2],
      ['Limits', 'g', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('number');
  });

  test('control: a parameter of a real type keeps the type number', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['D', ['Power', 'a', 2], 'a'],
      ['Typed', 'a', "'real'"],
    ];
    expect(ce.box(fn as never).type.toString()).toBe('(a: real) -> number');
    expect(typeAndValue(ce, ['Apply', fn, 3])).toEqual({
      type: 'number',
      value: '6',
      valueFitsType: true,
    });
    // A parameter of type `unknown` is read as a number.
    expect(
      ce.box(['Function', ['D', ['Power', 'a', 2], 'a'], 'a']).type.toString()
    ).toBe('(a: unknown) -> number');
    expect(ce.box(['D', ['Power', 'x', 2], 'x']).type.toString()).toBe(
      'number'
    );
  });
});

describe('CE-139: compiled D and Integrate over a variable with a list binding', () => {
  test('a parameter of a list type declines', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'list<real>');
    for (const op of ['D', 'Integrate']) {
      const expr = ce.box([
        'Apply',
        [
          'Function',
          [op, ['Power', 'a', 2], 'a'],
          ['Typed', 'a', "'list<real>'"],
        ],
        'v',
      ]);
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/may hold a collection/);
    }
  });

  test('a block local of a list type declines', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'b', "'list<real>'", ['List', 1, 2]],
      ['D', ['Power', 'b', 2], 'b'],
    ]);
    expect(() => compile(expr, { to: 'javascript', fallback: false })).toThrow(
      /may hold a collection/
    );
  });

  test('a closed form without the variable compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'list<real>');
    const r = compile(
      ce.box([
        'Apply',
        [
          'Function',
          ['D', ['Multiply', 3, 'a'], 'a'],
          ['Typed', 'a', "'list<real>'"],
        ],
        'v',
      ]),
      { to: 'javascript', fallback: false }
    );
    expect(r.run!({ v: [1, 2] } as never)).toBe(3);
  });

  test('D over a global of a list type compiles to a broadcast', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'list<real>');
    const r = compile(ce.box(['D', ['Power', 'g', 2], 'g']));
    expect(r.success).toBe(true);
    expect(r.run!({ g: [1, 2] } as never)).toEqual([2, 4]);
  });

  test('D over a global of a list type with no closed form declines', () => {
    // The numeric stencil reads `g` as a number, `NaN` for a list.
    const ce = new ComputeEngine();
    ce.declare('g', 'list<real>');
    for (const body of [
      ['Max', 'g', 1],
      ['Norm', 'g'],
    ]) {
      const expr = ce.box(['D', body, 'g']);
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/may hold a collection/);
    }
  });

  test('an operator with the name of the variable is not the variable', () => {
    // `D(Cos * Sin(x), Cos, x)` is `Cos(x)`: `Cos` is an operator there,
    // not the list parameter, so the closed form does not read the list.
    // The compile handler of `D` declines this case for another reason (it
    // has no lowering for it), so the test checks only that the decline is
    // not the one for a list binding.
    const ce = new ComputeEngine();
    ce.declare('v', 'list<real>');
    ce.declare('r', 'real');
    const expr = ce.box([
      'Apply',
      [
        'Function',
        ['D', ['Multiply', 'Cos', ['Sin', 'x']], 'Cos', 'x'],
        ['Typed', 'Cos', "'list<real>'"],
        ['Typed', 'x', "'real'"],
      ],
      'v',
      'r',
    ]);
    let message = '';
    try {
      compile(expr, { to: 'javascript', fallback: false });
    } catch (e) {
      message = String(e);
    }
    expect(message).not.toMatch(/may hold a collection/);
  });

  test('Integrate over a global of a list type declines', () => {
    // The lowering of a closed-form integral read `g` as a number:
    // `Integrate(g^2, g)` compiled to `_SYS.pow3(_.g) / 3`, `NaN` for a
    // list, where the interpreter gives `[1/3, 8/3]` for `g = [1, 2]`.
    const ce = new ComputeEngine();
    ce.declare('g', 'list<real>');
    // `Integrate(0, g)` declines too: the check does not look at the
    // antiderivative.
    for (const body of [['Power', 'g', 2], ['Sin', 'g'], 'g', 0]) {
      const expr = ce.box(['Integrate', body, 'g']);
      expect(() =>
        compile(expr, { to: 'javascript', fallback: false })
      ).toThrow(/may hold a collection/);
    }
  });

  test('control: a parameter of a real type compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    for (const [op, expected] of [
      ['D', 6],
      ['Integrate', 9],
    ] as const) {
      const r = compile(
        ce.box([
          'Apply',
          ['Function', [op, ['Power', 'a', 2], 'a'], ['Typed', 'a', "'real'"]],
          'r',
        ])
      );
      expect(r.success).toBe(true);
      expect(r.run!({ r: 3 } as never)).toBeCloseTo(expected, 12);
    }
  });
});
