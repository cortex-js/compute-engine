/**
 * A compiled comparison with an ABSENT operand.
 *
 * The interpreter answers `Missing` for a comparison with a written absence
 * operand (`Less(Missing, t)`, `Equal(Undefined, 1)`: Kleene). The compiled
 * JavaScript lowered the absence symbol to `undefined` and compared it, so
 * the value was a confident `false` (`true` for `NotEqual`), and an `If` over
 * it took an arm — the else arm for `Less`, the then arm for `NotEqual` —
 * where the interpreter takes none. The compiled value is now the target's
 * object null, `undefined`, which is also the undecided value of the
 * three-valued conditions, so `If`/`Which` take no arm and answer `NaN`
 * (`docs/ERROR-MODEL.md`: a compiled condition that is not exactly
 * `true`/`false` takes no branch and answers `NaN`).
 *
 * A NUMERIC operand that holds `NaN` keeps its IEEE comparison: a restricted
 * number is `NaN` when absent, and `Less(NaN, 1)` is `False` on both routes,
 * and so a branch over it takes the else arm (user decision 2026-10-20);
 * `NotEqual(NaN, 1)` is `True`, and a branch over it takes the then arm
 * (user decision 2026-10-23).
 *
 * Since 2026-11-01 the compiled value of a comparison with an absent
 * operand is not specified (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code", the bullet "Everything computed from an absent value,
 * except at a discharge"). The tests below check the interpreter's value for
 * it, and the compiled value for present operands only.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('t', 'real');
ce.declare('x', 'real');

const RELATIONS = [
  'Less',
  'Greater',
  'LessEqual',
  'GreaterEqual',
  'Equal',
  'NotEqual',
];

function run(json: unknown, t: number): unknown {
  const r = compile(ce.box(json as never), { to: 'javascript' } as never);
  expect(r.success).toBe(true);
  return r.run!({ t } as never);
}

/** The interpreter's value, as MathJSON. */
function interpreted(json: unknown, t: number): unknown {
  return ce
    .box(json as never)
    .subs({ t: ce.number(t) })
    .evaluate().json;
}

describe('a comparison with a written absence operand', () => {
  // The compiled value of a comparison with an absent operand, and of a
  // branch or a connective over it, is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4
  // of `docs/plans/2026-11-01-absent-value-contract.md`). Only the
  // interpreter's value is checked for it.
  for (const absent of ['Missing', 'Undefined']) {
    test.each(RELATIONS)(`%s(${absent}, t) is undecided`, (h) => {
      const json = [h, absent, 't'];
      expect(interpreted(json, 0)).toBe('Missing');
    });
  }

  test('a settling sibling still decides a connective', () => {
    // Kleene: `And(undecided, false)` is false, `Or(undecided, true)` true.
    const and = [
      'If',
      ['And', ['Less', 'Missing', 't'], ['Less', 't', -1]],
      1,
      2,
    ];
    const or = ['If', ['Or', ['Less', 'Missing', 't'], ['Less', 't', 1]], 1, 2];
    expect(interpreted(and, 0)).toBe(2);
    expect(run(and, 0)).toBe(2);
    expect(interpreted(or, 0)).toBe(1);
    expect(run(or, 0)).toBe(1);
  });
});

describe('a comparison with an operand that may be absent', () => {
  // `First([Missing, 1])` is typed `integer | missing | nan` and is the
  // object null at run time. Its comparison is `false` on both routes (the
  // interpreter reads it in a numeric slot as NaN), but a branch over it is
  // undecided: the interpreter refuses to branch on the absent condition.
  const F = ['First', ['List', 'Missing', 1]];

  test.each(RELATIONS)('If(%s(First([Missing, 1]), t)) takes no arm', (h) => {
    expect(interpreted(['If', [h, F, 't'], 1, 2], 0)).toEqual(
      expect.arrayContaining(['Error'])
    );
    expect(run(['If', [h, F, 't'], 1, 2], 0)).toBeNaN();
  });

  test('a present value still decides the branch', () => {
    const G = ['First', ['List', 3, 'Missing']];
    expect(run(['If', ['Less', G, 't'], 1, 2], 5)).toBe(1);
    expect(run(['If', ['Less', G, 't'], 1, 2], 0)).toBe(2);
  });

  // The compiled value of a comparison with an absent string, and of a
  // branch over it, is not specified (`docs/COMPILATION-MODEL.md`, "Caveats
  // of compiled code", the bullet "Everything computed from an absent value,
  // except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`): the compiled branch is
  // checked with a present string only.
  test.each([
    ['Equal', undefined],
    ['NotEqual', undefined],
  ])(
    '%s over a restricted string is undecided in the interpreter',
    (h) => {
      const json = [h, ['When', { str: 'a' }, ['Less', 1, 't']], { str: 'b' }];
      expect(interpreted(json, 0)).toBe('Missing');
      expect(run(['If', json, 1, 2], 2)).toBe(h === 'Equal' ? 2 : 1);
    }
  );
});

describe('a restricted NUMBER keeps its IEEE comparison', () => {
  const R = ['When', ['Add', 't', 5], ['Less', 1, 't']];
  test.each(RELATIONS)('%s', (h) => {
    const json = [h, R, 't'];
    const expected = h === 'NotEqual';
    expect(interpreted(json, 0)).toBe(expected ? 'True' : 'False');
    expect(run(json, 0)).toBe(expected);
    // The masked number is `NaN`. A branch over a relation with a NaN
    // operand takes the arm of the relation's IEEE value on both routes
    // (user decisions 2026-10-20, Tycho rows 411 and 413, and 2026-10-23;
    // before them, the branch took no arm).
    const arm = expected ? 1 : 2;
    expect(interpreted(['If', json, 1, 2], 0)).toBe(arm);
    expect(run(['If', json, 1, 2], 0)).toBe(arm);
  });
});

describe('the Python target', () => {
  // The compiled value of a comparison with an absent operand, and of a
  // branch or a connective over it, is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4
  // of `docs/plans/2026-11-01-absent-value-contract.md`). The
  // written absence lowers to the `NaN` of its numeric slot, and the
  // comparison is the target's own.
  test('a comparison with a written absence operand compares NaN', () => {
    const r = compile(ce.box(['Less', 'Missing', 't'] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toBe('math.nan < t');
  });

  test('a branch over it tests the value, not the operands', () => {
    const r = compile(ce.box(['If', ['Less', 'Missing', 't'], 1, 2] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('(math.nan < t)');
    expect(r.code).toContain("float('nan')");
  });
});

/**
 * A CHAIN with an absent operand is the Kleene conjunction of its pairwise
 * links: one link that is decidedly false makes the chain false, and a chain
 * whose present links all hold is undecided. With `x = 1`,
 * `Less(x, 0, Missing)` is `False` (the link `x < 0` fails) and
 * `Less(x, 5, Missing)` is `Missing`.
 */
describe('a chained comparison with an absent operand', () => {
  // The compiled value of a comparison with an absent operand, and of a
  // branch or a connective over it, is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4
  // of `docs/plans/2026-11-01-absent-value-contract.md`). Only the
  // interpreter's value is checked for it.
  const interpretedAt = (json: unknown, x: number): unknown =>
    ce
      .box(json as never)
      .subs({ x: ce.number(x) })
      .evaluate().json;

  const decidedFalse = ['Less', 'x', 0, 'Missing'];
  const undecided = ['Less', 'x', 5, 'Missing'];
  const leading = ['LessEqual', 'Missing', 'x', 5];

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, 'False'],
    ['Less(x, 5, Missing)', undecided, 1, 'Missing'],
    ['Less(x, 5, Missing)', undecided, 9, 'False'],
    ['LessEqual(Missing, x, 5)', leading, 1, 'Missing'],
    ['LessEqual(Missing, x, 5)', leading, 9, 'False'],
    // A NaN link is `False` (user decision 2026-10-23): `NaN < 0` decides
    // the chain, wherever the absent operand sits. Before, the absent operand
    // won and the chain was `Missing`.
    ['Less(x, 0, Missing)', decidedFalse, NaN, 'False'],
    ['LessEqual(Missing, x, 5)', leading, NaN, 'False'],
  ])('%s at x = %p', (_l, json, x, interp) => {
    expect(interpretedAt(json, x)).toBe(interp);
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, 2],
    ['Less(x, 5, Missing)', undecided, 9, 2],
    ['LessEqual(Missing, x, 5)', leading, 9, 2],
    ['Less(x, 0, Missing)', decidedFalse, NaN, 2],
    ['LessEqual(Missing, x, 5)', leading, NaN, 2],
  ])('If over %s at x = %p', (_l, json, x, expected) => {
    expect(interpretedAt(['If', json, 1, 2], x)).toBe(expected);
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, 0],
    ['LessEqual(Missing, x, 5)', leading, 9, 0],
    ['Less(x, 0, Missing)', decidedFalse, NaN, 0],
  ])('Which over %s at x = %p', (_l, json, x, expected) => {
    expect(interpretedAt(['Which', json, 1, 'True', 0], x)).toBe(expected);
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse],
    ['Less(x, 5, Missing)', undecided],
    ['LessEqual(Missing, x, 5)', leading],
  ])('Python: %s is the conjunction of its links', (_l, json) => {
    for (const j of [json, ['If', json, 1, 2]]) {
      const r = compile(ce.box(j as never), { to: 'python' } as never);
      expect(r.success).toBe(true);
      // The present link is compared, and the written absence is the `NaN`
      // of its numeric slot.
      expect(r.code).toMatch(/x <=? (0|5)|x >=? /);
      expect(r.code).toContain('math.nan');
    }
  });

  test.each([
    [['Less', 0, 'NaN', 'Missing'], 'False'],
    [['Less', 0, 'NaN', 'Undefined'], 'False'],
    [['Less', 'Missing', 0, 'NaN'], 'False'],
    // Every pair has the absent operand: the chain stays absent.
    [['Less', 'NaN', 'Missing', 0], 'Missing'],
    [['Less', 'NaN', 'Undefined', 0], 'Missing'],
    [['Less', ['Complex', 0, 1], 'Undefined', 0], 'Missing'],
  ])('the interpreter reads %j as %s', (json, expected) => {
    expect(ce.box(json as never).evaluate().json).toBe(expected);
  });
});

describe('a branch over a chain with an input that may be absent', () => {
  // The branch decides a chain link by link, as the interpreter does: one
  // false link decides it, whatever an absent operand of another link holds.
  // Before, the chain was tested for all its operands at once, and an absent
  // `w` made the branch take no arm,
  // where `If(And(x < 0, 0 < w), 1, 2)` already gave `2`.
  const e = new ComputeEngine();
  e.declare('x', 'number');
  e.declare('y', 'number');
  e.declare('w', 'number | missing');
  const compiled = (json: unknown, vars: object): unknown => {
    const r = compile(e.box(json as never), {
      to: 'javascript',
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    return r.run!(vars as never);
  };
  const held = (json: unknown, x: number): unknown => {
    const h = new ComputeEngine();
    h.declare('w', 'number | missing');
    h.assign('x', x);
    h.assign('w', h.Missing);
    return h.box(json as never).evaluate().json;
  };

  test.each([
    [1, 2],
    [NaN, 2],
  ])('If(x < 0 < w, 1, 2) at x = %p and w absent is %p', (x, expected) => {
    const json = ['If', ['Less', 'x', 0, 'w'], 1, 2];
    expect(held(json, x)).toBe(expected);
    expect(compiled(json, { x })).toBe(expected);
  });

  test('a link that the absent operand leaves undecided still takes no arm', () => {
    const json = ['If', ['Less', 'x', 0, 'w'], 1, 2];
    expect(compiled(json, { x: -1 })).toBeNaN();
    expect(compiled(json, { x: -1, w: 5 })).toBe(1);
  });

  test('a chained Equal over lists is not split into links, and still declines', () => {
    // `Equal([1, 2, 3], [1, 2, 3], 3)` is the scalar `False`, not the
    // conjunction of its links, so the branch analysis keeps the chain whole
    // and its lowering declines it.
    const lists = new ComputeEngine();
    for (const s of ['a', 'b', 'c']) lists.declare(s, 'list<number>');
    expect(() =>
      compile(lists.box(['If', ['Equal', 'a', 'b', 'c'], 1, 2] as never), {
        to: 'javascript',
        fallback: false,
      } as never)
    ).toThrow(/chained \(n-ary\) comparison/);
  });

  test('a chain over two inputs', () => {
    const json = ['If', ['Less', 'x', 0, 'y'], 1, 2];
    expect(compiled(json, { x: 1, y: 5 })).toBe(2);
    expect(compiled(json, { x: -1, y: -5 })).toBe(2);
    expect(compiled(json, { x: -1, y: 5 })).toBe(1);
  });
});

describe('a two-operand comparison with an absent operand and effects', () => {
  // The compiled value of a comparison with an absent operand, and of a
  // branch or a connective over it, is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4
  // of `docs/plans/2026-11-01-absent-value-contract.md`). Only the
  // emitted code is checked.
  test('the other operand is still evaluated', () => {
    const r = compile(
      ce.box(['Less', 'Missing', ['Add', 't', ['Random']]] as never),
      { to: 'javascript' } as never
    );
    expect(r.success).toBe(true);
    // The random draw is emitted, and its value is discarded.
    expect(r.code).toContain('drawNextRandomNumber');
  });
});
