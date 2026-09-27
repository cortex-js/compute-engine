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
 * while a branch over it takes no arm.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

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
  for (const absent of ['Missing', 'Undefined']) {
    test.each(RELATIONS)(`%s(${absent}, t) is undecided`, (h) => {
      const json = [h, absent, 't'];
      expect(interpreted(json, 0)).toBe('Missing');
      expect(run(json, 0)).toBeUndefined();
      // With the absent operand second.
      expect(run([h, 't', absent], 0)).toBeUndefined();
    });

    test.each(RELATIONS)(`If(%s(${absent}, t)) takes no arm`, (h) => {
      expect(run(['If', [h, absent, 't'], 1, 2], 0)).toBeNaN();
    });

    test.each(RELATIONS)(`Which(%s(${absent}, t)) takes no arm`, (h) => {
      expect(run(['Which', [h, absent, 't'], 1, 'True', 0], 0)).toBeNaN();
    });
  }

  test('Not over it stays undecided', () => {
    expect(run(['If', ['Not', ['Less', 'Missing', 't']], 1, 2], 0)).toBeNaN();
  });

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

  test.each([
    ['Equal', undefined],
    ['NotEqual', undefined],
  ])(
    '%s over a restricted string is undecided, and so is a branch over it',
    (h) => {
      const json = [h, ['When', { str: 'a' }, ['Less', 1, 't']], { str: 'b' }];
      expect(interpreted(json, 0)).toBe('Missing');
      expect(run(json, 0)).toBeUndefined();
      expect(run(['If', json, 1, 2], 0)).toBeNaN();
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
    expect(interpreted(['If', json, 1, 2], 0)).toBe('Missing');
    expect(run(['If', json, 1, 2], 0)).toBeNaN();
  });
});

describe('the Python target', () => {
  test('a comparison with a written absence operand is None', () => {
    const r = compile(ce.box(['Less', 'Missing', 't'] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toBe('None');
  });

  test('a branch over it tests the value, not the operands', () => {
    const r = compile(ce.box(['If', ['Less', 'Missing', 't'], 1, 2] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    // The undecided value `None` selects neither arm: the else arm is taken
    // only when the value is a boolean.
    expect(r.code).toContain('isinstance(None, (bool, np.bool_))');
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
  const run2 = (json: unknown, x: number): unknown => {
    const r = compile(ce.box(json as never), { to: 'javascript' } as never);
    expect(r.success).toBe(true);
    return r.run!({ x } as never);
  };
  const interpretedAt = (json: unknown, x: number): unknown =>
    ce
      .box(json as never)
      .subs({ x: ce.number(x) })
      .evaluate().json;

  const decidedFalse = ['Less', 'x', 0, 'Missing'];
  const undecided = ['Less', 'x', 5, 'Missing'];
  const leading = ['LessEqual', 'Missing', 'x', 5];

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, false, 'False'],
    ['Less(x, 5, Missing)', undecided, 1, undefined, 'Missing'],
    ['Less(x, 5, Missing)', undecided, 9, false, 'False'],
    ['LessEqual(Missing, x, 5)', leading, 1, undefined, 'Missing'],
    ['LessEqual(Missing, x, 5)', leading, 9, false, 'False'],
    ['Less(x, 0, Missing)', decidedFalse, NaN, undefined, 'Missing'],
  ])('%s at x = %p', (_l, json, x, compiled, interp) => {
    expect(interpretedAt(json, x)).toBe(interp);
    expect(run2(json, x)).toBe(compiled);
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, 2],
    ['Less(x, 5, Missing)', undecided, 1, NaN],
    ['Less(x, 5, Missing)', undecided, 9, 2],
    ['LessEqual(Missing, x, 5)', leading, 1, NaN],
    ['LessEqual(Missing, x, 5)', leading, 9, 2],
  ])('If over %s at x = %p', (_l, json, x, expected) => {
    const r = run2(['If', json, 1, 2], x);
    if (Number.isNaN(expected)) expect(r).toBeNaN();
    else {
      expect(interpretedAt(['If', json, 1, 2], x)).toBe(expected);
      expect(r).toBe(expected);
    }
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse, 1, 0],
    ['Less(x, 5, Missing)', undecided, 1, NaN],
    ['LessEqual(Missing, x, 5)', leading, 1, NaN],
    ['LessEqual(Missing, x, 5)', leading, 9, 0],
  ])('Which over %s at x = %p', (_l, json, x, expected) => {
    const which = ['Which', json, 1, 'True', 0];
    const r = run2(which, x);
    if (Number.isNaN(expected)) expect(r).toBeNaN();
    else {
      expect(interpretedAt(which, x)).toBe(expected);
      expect(r).toBe(expected);
    }
  });

  test.each([
    ['Less(x, 0, Missing)', decidedFalse],
    ['Less(x, 5, Missing)', undecided],
    ['LessEqual(Missing, x, 5)', leading],
  ])('Python: %s is the conjunction of its links', (_l, json) => {
    for (const j of [json, ['If', json, 1, 2]]) {
      const r = compile(ce.box(j as never), { to: 'python' } as never);
      expect(r.success).toBe(true);
      // The present link is compared, not replaced by `None`.
      expect(r.code).toMatch(/x <=? (0|5)|x >=? /);
      expect(r.code).toContain('None');
    }
  });

  test('a chain with an operand that has effects is declined', () => {
    const r = compile(
      ce.box(['Less', 'x', 0, 'Missing', ['Random']] as never),
      { to: 'javascript', fallback: true } as never
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/operand that has effects/);
  });
});

describe('a two-operand comparison with an absent operand and effects', () => {
  test('the other operand is still evaluated', () => {
    const r = compile(
      ce.box(['Less', 'Missing', ['Add', 't', ['Random']]] as never),
      { to: 'javascript' } as never
    );
    expect(r.success).toBe(true);
    // The random draw is emitted, and its value is discarded.
    expect(r.code).toContain('drawNextRandomNumber');
    expect(r.run!({ t: 0 } as never)).toBeUndefined();
  });
});
