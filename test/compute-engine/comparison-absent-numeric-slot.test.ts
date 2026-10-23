import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A comparison with an absent operand is absent, in a numeric slot
// (`number | missing`) too, as the condition of an `If` reads it (user
// decision 2026-10-23, ROADMAP CE-93, Tycho row 411). Before, the slot read
// its absent value as `NaN`: `w > 0` was `False`, while `If(w > 0, 1, 0)`
// had no value.

describe('A COMPARISON WITH AN ABSENT NUMERIC OPERAND (CE-93)', () => {
  test('the standalone comparison and the condition of an If agree', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 0.5);
    // `Which(x > 5, 1)` selects no branch: `w` is absent.
    expect(
      ce
        .box([
          'Block',
          ['Assign', 'w', ['Which', ['Greater', 'x', 5], 1]],
          ['Greater', 'w', 0],
        ])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    expect(
      ce
        .box([
          'Block',
          ['Assign', 'w', ['Which', ['Greater', 'x', 5], 1]],
          ['If', ['Greater', 'w', 0], 1, 0],
        ])
        .evaluate()
        .toString()
    ).toMatch(/condition is absent/);
  });

  test('the type of the comparison admits an absent value', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    for (const h of ['Less', 'LessEqual', 'Greater', 'GreaterEqual', 'Equal'])
      expect(ce.box([h, 'w', 0]).type.toString()).toBe('boolean | missing');
    // A chain, and an operand that cannot be absent.
    expect(ce.box(['Less', 0, 'w', 2]).type.toString()).toBe(
      'boolean | missing'
    );
    ce.declare('r', 'real');
    expect(ce.box(['Less', 'r', 0]).type.toString()).toBe('boolean');
  });

  test('a NaN operand keeps the IEEE answer', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    ce.assign('w', ce.NaN);
    expect(ce.box(['Greater', 'w', 0]).evaluate().symbol).toBe('False');
    // Arithmetic still reads an absent number as NaN.
    ce.assign('w', ce.Missing);
    expect(ce.box(['Add', 'w', 1]).evaluate().isNaN).toBe(true);
    expect(ce.box(['Less', ['Add', 'w', 1], 2]).evaluate().symbol).toBe(
      'False'
    );
  });

  test('a comparison under a broadcast agrees with the scalar one', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    ce.assign('w', ce.Missing);
    expect(ce.box(['Less', 1, 'w']).evaluate().toString()).toBe('"Missing"');
    expect(
      ce
        .box(['Less', ['List', 1, 2], 'w'])
        .evaluate()
        .toString()
    ).toBe('["Missing","Missing"]');
  });

  test('compiled JavaScript reads an absent operand as absent', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    for (const [expr, present] of [
      [['Greater', 'w', 0], true],
      [['Less', 0, 'w', 2], true],
      [['Equal', 'w', 0.5], true],
    ] as const) {
      const r = compile(ce.box(expr as any), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.run!({ w: undefined } as never)).toBeUndefined();
      expect(r.run!({ w: 0.5 } as never)).toBe(present);
      expect(r.run!({ w: NaN } as never)).toBe(false);
    }
  });

  test('compiled Python tests for None', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    const r = compile(ce.box(['Greater', 'w', 0]), {
      to: 'python',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/is None/);
  });

  test('the GPU targets keep the IEEE reading, with no guard', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    for (const to of ['glsl', 'wgsl'] as const)
      for (const expr of [
        ['Greater', 'w', 0],
        ['If', ['Greater', 'w', 0], 1, 0],
        ['And', ['Greater', 'w', 0], ['Less', 'w', 1]],
      ]) {
        const r = compile(ce.box(expr as any), { to, fallback: false });
        expect(r.success).toBe(true);
      }
  });
  // The cases of the review of CE-93: each agrees with the interpreter.
  test.each([
    [
      'a chain stops at a false link',
      ['Less', 5, 0, 'w'],
      { w: undefined },
      false,
    ],
    [
      'a chain with an absent middle',
      ['Less', 0, 'w', 2],
      { w: undefined },
      undefined,
    ],
    ['a chain with a present middle', ['Less', 0, 'w', 2], { w: 1 }, true],
    ['an operand twice', ['Equal', 'w', 'w'], { w: undefined }, undefined],
    [
      'an If with no else branch',
      ['Less', ['If', ['Greater', 'x', 0], 1], 2],
      { x: -1 },
      undefined,
    ],
    [
      'a broadcast',
      ['Less', ['List', 1, 2], 'w'],
      { w: undefined },
      [undefined, undefined],
    ],
  ])('compiled: %s', (_, expr, vars, expected) => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    ce.declare('x', 'real');
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!(vars as never)).toEqual(expected);
  });

  test('the complex mode keeps the realness rule', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    const r = compile(ce.box(['Less', 'w', 1]), {
      to: 'javascript',
      mode: 'complex',
      fallback: false,
    } as any);
    expect(r.run!({ w: 0.5 } as never)).toBe(true);
    expect(r.run!({ w: undefined } as never)).toBeUndefined();
  });
  // Second review of CE-93.
  test('compiled Python reads a NaN input as a value', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    const r = compile(ce.box(['Less', 'w', 1]), {
      to: 'python',
      fallback: false,
    });
    expect(r.code).toMatch(/is None/);
    expect(r.code).not.toMatch(/isnan/);
  });

  test('a chain with an effect and an absent operand is not compiled', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    expect(() =>
      compile(ce.box(['Less', 0, 'w', ['Random']]), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });

  test('a chain of lists keeps its own lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number | missing');
    expect(() =>
      compile(ce.box(['Equal', ['List', 1, 2], ['List', 1, 2], 'w']), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });
});
