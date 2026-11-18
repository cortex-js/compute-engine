/**
 * A name of a library operator used as a function value in the profile
 * `ir`: at the root (the callback of `Reduce` that the engine compiles), and
 * in the place of the function literal of a `Map` or a `Filter`. The name is
 * the literal `(p1, …, pn) ↦ Op(p1, …, pn)`, as the interpreter applies it
 * (`operatorLiteral()` in `ir/lower-lists.ts`): at the arity of its row, and
 * for a variadic row at the arity of the site (2 at the root, the number of
 * lists of a `Map`). A user function, a `chain` row and a name with no row
 * decline as before.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { _jsProfileStats } from '../../src/compute-engine/js-profile-switch';

const ce = new ComputeEngine();
const IR = { profile: 'ir', fallback: false } as const;

/** The compiled code of `json` with the profile `ir`. */
const ir = (json: unknown, engine = ce) =>
  compile(engine.box(json as never), IR) as unknown as {
    success: boolean;
    code: string;
    run: (...args: unknown[]) => unknown;
  };

/** The interpreter's value of `op` applied to `args`. */
const interpret = (op: string, args: number[]) =>
  ce
    .function(
      op,
      args.map((a) => ce.number(a))
    )
    .N().re;

describe('a root name of a library operator', () => {
  // prettier-ignore
  const BINARY = ['Add', 'Multiply', 'Subtract', 'Divide', 'Power', 'Max',
    'Min', 'Mod'];
  const PAIRS = [
    [3, 2],
    [-2.5, 4],
    [0.75, -3],
    [7, 0.5],
  ];

  test.each(BINARY)('%s is a function of two parameters', (op) => {
    const r = ir(op);
    expect(r.success).toBe(true);
    for (const [a, b] of PAIRS)
      expect(r.run(a, b)).toBeCloseTo(interpret(op, [a, b]), 14);
  });

  test.each(['Sin', 'Negate', 'Exp', 'Abs'])(
    '%s is a function of one parameter',
    (op) => {
      const r = ir(op);
      for (const x of [0, 0.5, -2, 10])
        expect(r.run(x)).toBeCloseTo(interpret(op, [x]), 14);
    }
  );

  test('the order of the operands is the interpreter’s', () => {
    expect(ir('Subtract').run(10, 4)).toBe(6);
    expect(ir('Divide').run(10, 4)).toBe(2.5);
    expect(ir('Power').run(2, 10)).toBe(1024);
  });

  test('a chain row, a name with no row and a user function decline', () => {
    const engine = new ComputeEngine();
    engine.assign('g', engine.parse('x \\mapsto x+1'));
    for (const name of ['Less', 'IsPrime', 'g'])
      expect(() => ir(name, engine)).toThrow(/Could not compile/);
  });
});

describe('a name of a library operator in a Map or a Filter', () => {
  test('Map of one list: the operator of one operand', () => {
    expect(ir(['Map', 'Sin', ['List', 1, 2, 3]]).run()).toEqual(
      [1, 2, 3].map(Math.sin)
    );
    // `Add(x)` is `x`.
    expect(ir(['Map', 'Add', ['List', 1, 2, 3]]).run()).toEqual([1, 2, 3]);
  });

  test('Map of two lists: the operator of two operands', () => {
    const l1 = ['List', 1, 5, 3];
    const l2 = ['List', 2, 2, 2];
    expect(ir(['Map', 'Power', l1, l2]).run()).toEqual([1, 25, 9]);
    expect(ir(['Map', 'Max', l1, l2]).run()).toEqual([2, 5, 3]);
    expect(ir(['Map', 'Subtract', l1, l2]).run()).toEqual([-1, 3, 1]);
  });

  test('Map of an input list', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<real>');
    const r = ir(['Map', 'Cos', 'L'], engine);
    expect(r.success).toBe(true);
    expect(r.run({ L: [0, 1, 2] })).toEqual([0, 1, 2].map(Math.cos));
  });

  test('a fixed-arity operator over the wrong number of lists declines', () => {
    expect(() => ir(['Map', 'Sin', ['List', 1], ['List', 2]])).toThrow(
      /Could not compile/
    );
  });
});

describe('a Reduce in a program by a binary operator', () => {
  const engine = new ComputeEngine();
  engine.declare('L', 'list<real>');
  const L = [1.5, 2, -3, 4];
  test.each(['Subtract', 'Divide', 'Power', 'Mod', 'Add', 'Max'])(
    '%s: a left fold from the initial value, as the interpreter’s',
    (op) => {
      const json = ['Reduce', 'L', op, 0.5];
      const r = ir(json, engine);
      expect(r.success).toBe(true);
      engine.assign('L', engine.box(['List', ...L]));
      const expected = engine.box(json as never).N().re;
      engine.assign('L', undefined as never);
      const got = r.run({ L }) as number;
      // Within the precision of a double (`Power`: 2^36, 1.8e-4 apart).
      expect(Math.abs(got - expected)).toBeLessThanOrEqual(
        1e-14 * Math.max(1, Math.abs(expected))
      );
    }
  );
});

describe('Reduce and Fold of the engine with a name of an operator', () => {
  /** An engine at machine precision with the profile `ir` first. */
  const engine = () => {
    const e = new ComputeEngine({ precision: 'machine' });
    e._jsProfile = {};
    return e;
  };
  const interpreted = new ComputeEngine({ precision: 'machine' });
  interpreted.jit = 'off';

  // prettier-ignore
  const CASES: unknown[] = [
    ['Reduce', ['List', 1.5, 2, 3, 4], 'Add'],
    ['Reduce', ['List', 1.5, 2, 3, 4], 'Multiply', 0.5],
    ['Reduce', ['List', 1.5, 2, 3, 4], 'Subtract', 0.5],
    ['Reduce', ['List', 1.5, 2, 3, 4], 'Divide'],
    ['Reduce', ['List', 1.5, 2, 3], 'Power'],
    ['Reduce', ['List', 1.5, 7, -3, 4], 'Max'],
    ['Reduce', ['List', 1.5, 7, -3, 4], 'Min', 0],
  ];

  test.each(CASES.map((c) => [JSON.stringify(c), c]))(
    '%s: the compiled fold gives the interpreter’s value',
    (_, json) => {
      const e = engine();
      const v = e.box(json as never).N();
      expect(v.re).toBe(interpreted.box(json as never).N().re);
      const stats = _jsProfileStats(e).reduce;
      expect(stats).toMatchObject({ declined: 0, failed: 0 });
      expect(stats.admitted).toBeGreaterThan(0);
    }
  );

  // `Fold` is interpreted: it compiles no callback.
  test.each([
    ['Fold', ['List', 1.5, 2, 3, 4], 'Multiply', 0.5],
    ['Fold', ['List', 1.5, 7, -3, 4], 'Max', 0],
  ])('%s of %j and %s', (...json) => {
    expect(
      engine()
        .box(json as never)
        .N().re
    ).toBe(interpreted.box(json as never).N().re);
  });

  test('a product past the range of doubles takes the compiled path', () => {
    const e = engine();
    const v = e
      .box([
        'Reduce',
        ['List', ['Power', 10, 300]],
        'Multiply',
        ['Power', 10, -400],
      ] as never)
      .N();
    expect(v.re).toBe(1e-100);
    expect(_jsProfileStats(e).reduce).toMatchObject({
      admitted: 1,
      declined: 0,
    });
  });
});
