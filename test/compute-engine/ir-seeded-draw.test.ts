/**
 * CE-1524: the held value of an assigned name, `a := WithRandomSeed(7,
 * RandomChoice([0, 1), 3))`, draws over literals under a number as the
 * seed, is the same at every call: it compiles as the interpreter's value, a
 * literal. Written in place, the draws run in their seeded frame. A held
 * value that reads a name with a value or calls a user function declines,
 * as before; one with another effect (`Print`) is not evaluated at compile
 * time.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { isNumber } from '../../src/compute-engine/boxed-expression/type-guards';

const IR = { profile: 'ir', fallback: false } as const;

const DRAW = [
  'WithRandomSeed',
  7,
  ['RandomChoice', ['Interval', 0, ['Open', 1]], 3],
];

describe('CE-1524, a value of seeded draws', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('a', ce.box(DRAW as never));
  const interpreted = (json: unknown, x: number) => {
    const v = ce
      .box(json as never)
      .subs({ x })
      .evaluate()
      .N();
    return isNumber(v) ? v.re : NaN;
  };

  test.each([
    ['an assigned value of draws', ['Add', 'x', ['Min', 'a']]],
    ['draws written in place', ['Add', 'x', ['Min', DRAW]]],
    ['one draw', ['Add', 'x', ['WithRandomSeed', 537911, ['Random']]]],
  ])('%s gives the interpreter value at every call', (_, json) => {
    const r = compile(ce.box(json as never), IR);
    expect(r.success).toBe(true);
    const want = interpreted(json, 0.5);
    expect(r.run!({ x: 0.5 } as never)).toBe(want);
    expect(r.run!({ x: 0.5 } as never)).toBe(want);
  });

  test('the draws are a literal of the code', () => {
    const r = compile(ce.box(['Add', 'x', ['Min', 'a']] as never), IR);
    expect(r.code).toMatch(/0\.08483070468009213/);
    expect(r.code).not.toMatch(/withRandomSeed|drawNextRandomNumber/);
    const g = compile(ce.box(['Add', 'x', ['Min', 'a']] as never), {
      ...IR,
      to: 'glsl',
    });
    expect(g.success).toBe(true);
  });

  test('a body that reads a variable runs in its seeded frame', () => {
    const json = ['WithRandomSeed', 7, ['Multiply', 'x', ['Random']]];
    const r = compile(ce.box(json as never), IR);
    expect(r.code).toMatch(/withRandomSeed/);
    expect(r.run!({ x: 2 } as never)).toBe(interpreted(json, 2));
  });

  test('draws that read a name with a value run in their frame', () => {
    // A host supplies `T` at run time (`vars`): its value at compile time is
    // not the value of the call.
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.assign(
      'b',
      local.box(['WithRandomSeed', 7, ['Multiply', 'T', ['Random']]] as never)
    );
    const options = { ...IR, vars: { T: '_.T' } };
    // Not folded: the held value declines, as a value with an effect.
    expect(() =>
      compile(local.box(['Add', 'x', 'b'] as never), options as never)
    ).toThrow(/the value of b, which has an effect/);
    // Written in place, the draws read `T` at run time.
    const inPlace = compile(
      local.box([
        'Add',
        'x',
        ['WithRandomSeed', 7, ['Multiply', 'T', ['Random']]],
      ] as never),
      options as never
    );
    expect(inPlace.code).toMatch(/_\.T/);
  });

  test('draws that call a user function are not folded', () => {
    // `f` reads `T`, which a host supplies at run time.
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.assign(
      'f',
      local.box(['Function', ['Multiply', 'T', ['Random']]] as never)
    );
    local.assign('b', local.box(['WithRandomSeed', 7, ['f']] as never));
    const options = { ...IR, vars: { T: '_.T' } };
    expect(() =>
      compile(local.box(['Add', 'x', 'b'] as never), options as never)
    ).toThrow(/the value of b/);
  });

  test('a user function named as a library head is not evaluated', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      local.assign(
        'Tuple',
        local.box(['Function', ['Block', ['Print', 't'], 't'], 't'] as never)
      );
      local.assign(
        'b',
        local.box(['WithRandomSeed', 7, ['Tuple', ['Random']]] as never)
      );
      log.mockClear();
      try {
        compile(local.box(['Add', 'x', 'b'] as never), IR);
      } catch {
        // A decline is the expected outcome.
      }
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test('a declared constant is not folded: its value can read a variable', () => {
    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.declare('k', {
      type: 'real',
      isConstant: true,
      value: local.box(['Multiply', 5, 'T'] as never),
    } as never);
    local.assign(
      'b',
      local.box([
        'WithRandomSeed',
        7,
        ['RandomChoice', ['List', 'k', 'k'], 1],
      ] as never)
    );
    expect(() =>
      compile(local.box(['Add', 'x', ['Min', 'b']] as never), {
        ...IR,
        vars: { T: '_.T' },
      } as never)
    ).toThrow(/Could not compile/);
  });

  test('a library constant folds; a shadowed one does not', () => {
    const json = ['WithRandomSeed', 7, ['RandomChoice', ['List', 'Pi', 1], 2]];
    ce.assign('withPi', ce.box(json as never));
    const r = compile(ce.box(['Add', 'x', ['Min', 'withPi']] as never), IR);
    expect(r.code).not.toMatch(/withRandomSeed/);
    expect(r.run!({ x: 0.5 } as never)).toBe(
      interpreted(['Add', 'x', ['Min', 'withPi']], 0.5)
    );

    const local = new ComputeEngine();
    local.declare('x', 'real');
    local.declare('T', 'real');
    local.assign('T', 2);
    local.pushScope();
    local.declare('Pi', {
      type: 'real',
      value: local.box(['Multiply', 5, 'T'] as never),
    } as never);
    local.assign('b', local.box(json as never));
    expect(() =>
      compile(local.box(['Add', 'x', ['Min', 'b']] as never), {
        ...IR,
        vars: { T: '_.T' },
      } as never)
    ).toThrow(/Could not compile/);
  });

  test('draws of more elements than the limit in all are not folded', () => {
    // Each draw is within the limit; together they are not.
    const draw = ['RandomChoice', ['Interval', 0, ['Open', 1]], 10000];
    ce.assign(
      'many',
      ce.box(['WithRandomSeed', 7, ['List', draw, draw, draw]] as never)
    );
    const start = Date.now();
    expect(() =>
      compile(ce.box(['Add', 'x', ['Min', ['Flatten', 'many']]] as never), IR)
    ).toThrow(/Could not compile/);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('a count above the limit is not drawn at compile time', () => {
    ce.assign(
      'big',
      ce.box([
        'WithRandomSeed',
        7,
        ['RandomSample', ['Range', 1, 3e5], 3e5],
      ] as never)
    );
    const start = Date.now();
    expect(() =>
      compile(ce.box(['Add', 'x', ['Min', 'big']] as never), IR)
    ).toThrow(/Could not compile/);
    expect(Date.now() - start).toBeLessThan(200);
  });

  test('a name whose value has another effect is not evaluated at compile time', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      ce.assign(
        'q',
        ce.box(['Block', ['Print', 1], ['Random']] as never)
      );
      ce.assign('r', ce.box(['WithRandomSeed', 7, 'q'] as never));
      log.mockClear();
      try {
        compile(ce.box(['Add', 'x', 'r'] as never), IR);
      } catch {
        // A decline is the expected outcome.
      }
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test('a body with another effect is not evaluated at compile time', () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      ce.assign(
        'p',
        ce.box([
          'WithRandomSeed',
          7,
          ['Block', ['Print', 1], ['Random']],
        ] as never)
      );
      log.mockClear();
      expect(() =>
        compile(ce.box(['Add', 'x', 'p'] as never), IR)
      ).toThrow();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
