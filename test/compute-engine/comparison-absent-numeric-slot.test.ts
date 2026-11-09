import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A comparison with an absent operand is `False` (`NotEqual`: `True`), in a
// numeric slot (`number | missing`) too, and the condition of an `If` reads
// it the same way (user decision 2026-11-02, two-valued comparisons). So the
// standalone comparison and the condition agree: `w > 0` is `False` and
// `If(w > 0, 1, 0)` is `0`. From 2026-10-23 (ROADMAP CE-93, Tycho row 411)
// to 2026-11-02 the comparison was `Missing` and the `If` was the
// absent-condition error. Before 2026-10-23 the slot read its absent value
// as `NaN`: `w > 0` was `False`, while `If(w > 0, 1, 0)` had no value.
//
// A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing` is
// a result only"): the absent operand below is a selection with no match or
// the symbol `Missing`, and a compiled input is declared `number`.

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
    ).toBe('"False"');
    expect(
      ce
        .box([
          'Block',
          ['Assign', 'w', ['Which', ['Greater', 'x', 5], 1]],
          ['If', ['Greater', 'w', 0], 1, 0],
        ])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  // `IsMissing` reads the comparison, not `w`: the comparison is `False`, a
  // value, so the interpreter gives 0. (From 2026-10-23 to 2026-11-02 the
  // comparison was `Missing` and the interpreter gave 1.)
  test('IsMissing of a comparison with an absent operand, interpreted', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['If', ['IsMissing', ['Greater', 'Missing', 0]], 1, 0])
        .evaluate()
        .toString()
    ).toBe('0');
  });

  test('the type of the comparison is boolean', () => {
    const ce = new ComputeEngine();
    for (const h of ['Less', 'LessEqual', 'Greater', 'GreaterEqual', 'Equal'])
      expect(ce.box([h, 'Missing', 0]).type.toString()).toBe('boolean');
    // A chain, and an operand that cannot be absent.
    expect(ce.box(['Less', 0, 'Missing', 2]).type.toString()).toBe('boolean');
    ce.declare('r', 'real');
    expect(ce.box(['Less', 'r', 0]).type.toString()).toBe('boolean');
  });

  test('a NaN operand keeps the IEEE answer', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    ce.assign('w', ce.NaN);
    expect(ce.box(['Greater', 'w', 0]).evaluate().symbol).toBe('False');
    // Arithmetic over an absent operand is `Missing`, and a comparison with
    // it is `False`.
    expect(ce.box(['Add', 'Missing', 1]).evaluate().symbol).toBe('Missing');
    expect(
      ce.box(['Less', ['Add', 'Missing', 1], 2]).evaluate().symbol
    ).toBe('False');
  });

  test('a comparison under a broadcast agrees with the scalar one', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Less', 1, 'Missing']).evaluate().toString()).toBe(
      '"False"'
    );
    expect(
      ce
        .box(['Less', ['List', 1, 2], 'Missing'])
        .evaluate()
        .toString()
    ).toBe('["False","False"]');
  });

  // The compiled value of a comparison with an absent operand is not
  // specified (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the
  // bullet "Everything computed from an absent value, except at a
  // discharge"; R4 of `docs/plans/2026-11-01-absent-value-contract.md`), and
  // an input cannot be declared absent: the compiled tests below check
  // present operands only.
  test('an input declared with missing is a static error', () => {
    const ce = new ComputeEngine();
    expect(() => ce.declare('w', 'number | missing')).toThrow();
  });

  test('compiled JavaScript compares a present operand', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    for (const [expr, present] of [
      [['Greater', 'w', 0], true],
      [['Less', 0, 'w', 2], true],
      [['Equal', 'w', 0.5], true],
    ] as const) {
      const r = compile(ce.box(expr as any), {
        to: 'javascript',
        fallback: false,
      });
      expect(r.run!({ w: 0.5 } as never)).toBe(present);
      expect(r.run!({ w: NaN } as never)).toBe(false);
    }
  });

  test('compiled Python compares with the native operator', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const r = compile(ce.box(['Greater', 'w', 0]), {
      to: 'python',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe('0 < w');
  });

  test('the GPU targets keep the IEEE reading, with no guard', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    for (const to of ['glsl'] as const)
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
    ['a chain with a present middle', ['Less', 0, 'w', 2], { w: 1 }, true],
  ])('compiled: %s', (_, expr, vars, expected) => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    ce.declare('x', 'real');
    const r = compile(ce.box(expr as any), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.run!(vars as never)).toEqual(expected);
  });

  test('the complex mode keeps the realness rule', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const r = compile(ce.box(['Less', 'w', 1]), {
      to: 'javascript',
      mode: 'complex',
      fallback: false,
    } as any);
    expect(r.run!({ w: 0.5 } as never)).toBe(true);
  });
  // Second review of CE-93.
  test('compiled Python reads a NaN input as a value', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const r = compile(ce.box(['Less', 'w', 1]), {
      to: 'python',
      fallback: false,
    });
    expect(r.code).toBe('w < 1');
  });

  test('a chain of lists keeps its own lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    expect(() =>
      compile(ce.box(['Equal', ['List', 1, 2], ['List', 1, 2], 'w']), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/Could not compile/);
  });
});
