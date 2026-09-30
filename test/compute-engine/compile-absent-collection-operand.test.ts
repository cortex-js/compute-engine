/**
 * A collection operand that can be ABSENT AS A WHOLE (issue #383).
 *
 * With `x: list<list<integer>>`, the row read `At(x, i)` is typed
 * `list<integer> | missing`: the index can be past the end. A restricted list
 * `xs{c}` and a symbol declared `list<integer> | missing` have the same type.
 * The interpreter answers the absence marker of the codomain for such an
 * operand when it is absent (`Length(At(x, 7))` is `NaN`, `Reverse(At(x, 7))`
 * is `Missing`), and computes on the present list otherwise.
 *
 * The JavaScript collection lowerings read an array, so they refused every
 * operand whose type has a `missing` arm: `Length(At(x, 1))` did not compile
 * ("operand is not an indexed collection"). Now such an operand is bound once
 * and the operator is lowered on the present value under a test for the
 * absent value (`absentCollectionOperandGuard`, `base-compiler.ts`).
 *
 * The interpreter had the same blind spot for LAZY operators: they hold
 * their operands, so the absence test saw only a written `Missing`, and the
 * lazy view did not read a `missing | list<…>` operand as a source.
 * `Filter(At(x, 7), p)` stayed unevaluated, and so did `Map(f, At(x, 1))`.
 *
 * Each compiled case is run without a fallback (`fallback: false`) and
 * compared with the interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ROWS = [
  [3, 1, 2],
  [4, 5],
];
const F: unknown = ['Function', ['Multiply', 2, 'k'], 'k'];
const P: unknown = ['Function', ['Greater', 'k', 1], 'k'];
const ADD2: unknown = ['Function', ['Add', 'a', 'b'], 'a', 'b'];

/** An engine with `x: list<list<integer>>`, `i: integer`, `y: list<integer>`,
 * `c: real`, `r: list<integer> | missing`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'list<list<integer>>');
  ce.declare('i', 'integer');
  ce.declare('y', 'list<integer>');
  ce.declare('c', 'real');
  ce.declare('r', 'list<integer> | missing');
  return ce;
}

/** The interpreter's value, as JSON, with `x` holding `ROWS`, `y` holding the
 * first row, `r` holding the first row or `Missing`, and `i`, `c` as given.
 * Evaluated numerically and materialized, so that an exact value
 * (`Sqrt(14)`) and a lazy view (`Reverse([3, 1, 2])`) compare with the
 * compiled array or number. */
function interpreted(
  json: unknown,
  values: { i?: number; c?: number; r?: 'present' | 'absent' }
): unknown {
  const ce = engine();
  const e = ce.box(json as never);
  expect(e.isValid).toBe(true);
  ce.assign(
    'x',
    ce.box(['List', ...ROWS.map((row) => ['List', ...row])] as never)
  );
  ce.assign('y', ce.box(['List', ...ROWS[0]] as never));
  ce.assign('i', values.i ?? 1);
  ce.assign('c', values.c ?? 1);
  ce.assign(
    'r',
    values.r === 'absent'
      ? ce.symbol('Missing')
      : ce.box(['List', ...ROWS[0]] as never)
  );
  return e.evaluate({ numericApproximation: true, materialization: true }).json;
}

/** The compiled value, or the compile error message when the target
 * declines. */
function compiled(
  json: unknown,
  vars: Record<string, unknown>
): { value?: unknown; code?: string; error?: string } {
  const ce = engine();
  const e = ce.box(json as never);
  expect(e.isValid).toBe(true);
  try {
    const r = compile(e, { to: 'javascript', fallback: false } as never);
    return { value: r.run!(vars as never), code: r.code as string };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/** The compiled value as the interpreter spells it: `NaN` for `NaN`,
 * `Missing` for `undefined`, `True`/`False` for booleans, a `List` for an
 * array. */
function spell(v: unknown): unknown {
  if (v === undefined || v === null) return 'Missing';
  if (typeof v === 'number') return Number.isNaN(v) ? 'NaN' : v;
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (Array.isArray(v)) return ['List', ...v.map(spell)];
  return v;
}

const PRESENT = { x: ROWS, y: ROWS[0], i: 1, c: 1, r: ROWS[0] };
const ABSENT = { x: ROWS, y: ROWS[0], i: 7, c: -1, r: undefined };

describe('issue #383: Length and Count of a row of a list of lists compile', () => {
  test('the reported case', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'list<list<integer>>');
    expect(ce.box(['At', 'x', 1]).type.toString()).toBe(
      'list<integer> | missing'
    );
    for (const head of ['Length', 'Count']) {
      const r = compile(ce.box([head, ['At', 'x', 1]] as never), {
        fallback: false,
      } as never);
      expect(r.success).toBe(true);
      expect(r.run!({ x: [[1, 2, 3], [4]] } as never)).toBe(3);
      // The index is past the end: `Length(Missing)` is `NaN` in the
      // interpreter, and the compiled value is `NaN` too.
      expect(r.run!({ x: [] } as never)).toBeNaN();
    }
  });

  test('the operand is bound once and tested for the absent value', () => {
    const { code } = compiled(['Length', ['At', 'x', 'i']], PRESENT);
    expect(code).toContain('=== undefined) ? Number.NaN :');
    // One read of the row, not one per use.
    expect(code!.match(/_SYS\.at\(/g)).toHaveLength(1);
  });
});

describe('compiled and interpreted values agree for a row that can be absent', () => {
  const R: unknown = ['At', 'x', 'i'];
  test.each([
    // Numeric codomain: the marker is `NaN`.
    ['Length', [R]],
    ['Count', [R]],
    ['Sum', [R]],
    ['Product', [R]],
    ['Max', [R]],
    ['Last', [R]],
    ['IndexOf', [R, 2]],
    ['Dot', [R, ['List', 1, 1, 1]]],
    ['Reduce', [R, ADD2, 0]],
    ['Reduce', [R, 'Add', 0]],
    ['Length', [['Reverse', R]]],
    ['Sum', [['Map', F, R]]],
    ['Sum', [['Filter', R, P]]],
    ['Length', [['Filter', R, P]]],
    ['Length', [['Scan', R, 'Add']]],
    // Object codomain: the marker is the absent object (`Missing`).
    ['Reverse', [R]],
    ['Sort', [R]],
    ['Take', [R, 2]],
    ['Drop', [R, 1]],
    ['Rest', [R]],
    ['Most', [R]],
    ['Unique', [R]],
    ['Join', [R, ['List', 9]]],
    ['Append', [R, 9]],
    ['ListFrom', [R]],
    ['IsEmpty', [R]],
    ['Contains', [R, 2]],
    ['Map', [F, R]],
    ['Filter', [R, P]],
    ['Any', [R, P]],
    ['Scan', [R, 'Add']],
  ])('%s(%j)', (head, args) => {
    const json = [head, ...(args as unknown[])];
    const present = compiled(json, PRESENT);
    expect(present.error).toBeUndefined();
    expect(spell(present.value)).toEqual(interpreted(json, { i: 1 }));
    const absent = compiled(json, ABSENT);
    expect(spell(absent.value)).toEqual(interpreted(json, { i: 7 }));
  });

  test('Norm of a row: a float, NaN when the row is absent', () => {
    // The interpreter's exact value is `Sqrt(14)`; the compiled one its
    // float. (`Differences` has no JavaScript lowering at all, so it is not
    // in the table above.)
    const json = ['Norm', ['At', 'x', 'i']];
    expect(compiled(json, PRESENT).value).toBeCloseTo(Math.sqrt(14), 12);
    expect(compiled(json, ABSENT).value).toBeNaN();
    expect(interpreted(json, { i: 7 })).toBe('NaN');
  });

  test('a nested read keeps its own marker', () => {
    // `At(At(x, i), 2)` compiled before this change; its value is unchanged.
    const json = ['At', ['At', 'x', 'i'], 2];
    expect(compiled(json, PRESENT).value).toBe(1);
    expect(compiled(json, ABSENT).value).toBeNaN();
    expect(interpreted(json, { i: 7 })).toBe('NaN');
  });
});

describe('other operands that can be absent as a whole', () => {
  test.each([
    ['a restricted list', ['When', 'y', ['Greater', 'c', 0]]],
    [
      'a restricted list literal',
      ['When', ['List', 3, 1, 2], ['Greater', 'c', 0]],
    ],
    ['a symbol declared `list<integer> | missing`', 'r'],
  ])('%s', (_label, operand) => {
    for (const json of [
      ['Length', operand],
      ['Sum', operand],
      ['Reverse', operand],
      ['Last', operand],
      ['Take', operand, 2],
    ]) {
      const present = compiled(json, PRESENT);
      expect(present.error).toBeUndefined();
      expect(spell(present.value)).toEqual(interpreted(json, { c: 1 }));
      const absent = compiled(json, ABSENT);
      expect(spell(absent.value)).toEqual(
        interpreted(json, { c: -1, r: 'absent' })
      );
    }
  });

  test('a restricted list of points: Last is the absent point', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'real');
    const pts = [
      'When',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Greater', 'c', 0],
    ];
    const r = compile(ce.box(['Last', pts] as never), {
      fallback: false,
    } as never);
    expect(r.success).toBe(true);
    expect(r.run!({ c: 1 } as never)).toEqual([3, 4]);
    expect(r.run!({ c: -1 } as never)).toBeUndefined();
  });

  test('two rows: Dot of two reads, either of which can be absent', () => {
    const json = ['Dot', ['At', 'x', 1], ['At', 'x', 'i']];
    const ce = engine();
    const r = compile(ce.box(json as never), { fallback: false } as never);
    expect(r.success).toBe(true);
    expect(
      r.run!({
        x: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        i: 2,
      } as never)
    ).toBe(32);
    expect(
      r.run!({
        x: [
          [1, 2, 3],
          [4, 5, 6],
        ],
        i: 7,
      } as never)
    ).toBeNaN();
  });
});

describe('the rule stands aside', () => {
  test('when another operand is not pure', () => {
    // The interpreter evaluates every operand before it tests for an
    // absent one; the guarded lowering would evaluate the count only when
    // the row is present, so a `Random` count would be drawn a different
    // number of times. The operator declines instead.
    const { error } = compiled(['Take', ['At', 'x', 'i'], ['Random']], PRESENT);
    expect(error).toContain('Could not compile `Take`');
  });

  test('for a broadcastable operator, whose absence lands in each cell', () => {
    // `[1, 2, 3] · P{c}` with the restricted point absent is a list of
    // absent cells, not one absent value (user decision of 2026-09-27).
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const json = [
      'Multiply',
      ['List', 1, 2, 3],
      ['When', ['Tuple', 't', 1], ['Less', 1, 't']],
    ];
    const r = compile(ce.box(json as never), { fallback: false } as never);
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0 } as never)).toStrictEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});

describe('Sum and Product of a list of points or of rows', () => {
  /** The compiled value and the interpreter's value of `head(name)`, with
   * `name` declared `type` and holding `value`. */
  function both(
    head: 'Sum' | 'Product',
    type: string,
    value: number[][]
  ): { compiled: unknown; interpreted: unknown } {
    const ce = new ComputeEngine();
    ce.declare('v', type);
    const e = ce.box([head, 'v'] as never);
    const r = compile(e, { fallback: false } as never);
    expect(r.success).toBe(true);
    const compiled = r.run!({ v: value } as never);
    const element = type.includes('tuple') ? 'Tuple' : 'List';
    ce.assign(
      'v',
      ce.box(['List', ...value.map((row) => [element, ...row])] as never)
    );
    return { compiled, interpreted: e.evaluate().json };
  }

  test('Sum of a list of points is the sum point', () => {
    // The scalar fold read each point as a number and answered
    // `{ re: NaN, im: NaN }`.
    const { compiled, interpreted } = both('Sum', 'list<tuple<real, real>>', [
      [1, 2],
      [3, 4],
    ]);
    expect(compiled).toEqual([4, 6]);
    expect(interpreted).toEqual(['Tuple', 4, 6]);
  });

  test('Sum and Product of rows are element-wise, as in the interpreter', () => {
    const rows = [
      [1, 2],
      [3, 4],
    ];
    const sum = both('Sum', 'list<list<real>>', rows);
    expect(sum.compiled).toEqual([4, 6]);
    expect(sum.interpreted).toEqual(['List', 4, 6]);
    const product = both('Product', 'list<list<real>>', rows);
    expect(product.compiled).toEqual([3, 8]);
    expect(product.interpreted).toEqual(['List', 3, 8]);
  });

  test('an empty list of rows sums to 0 and multiplies to 1, as in the interpreter', () => {
    const sum = both('Sum', 'list<list<real>>', []);
    expect(sum.compiled).toBe(0);
    expect(sum.interpreted).toBe(0);
    const product = both('Product', 'list<list<real>>', []);
    expect(product.compiled).toBe(1);
    expect(product.interpreted).toBe(1);
  });

  test('rows of unequal length: the interpreter reports an error, the compiled fold answers NaN', () => {
    // The element-wise combiner (`_SYS.add`) answers `NaN` for two lists of
    // unequal length, as the compiled `Add` of two such lists does; the
    // interpreter's `Add` reports `incompatible-dimensions`. The compiled
    // code has no error value, so this is the same run-time divergence
    // every compiled broadcast over unequal lengths has.
    const sum = both('Sum', 'list<list<real>>', [[1, 2], [3]]);
    expect(sum.compiled).toBeNaN();
    expect(JSON.stringify(sum.interpreted)).toContain(
      'incompatible-dimensions'
    );
  });

  test('Product of a list of points declines, as the interpreter errors', () => {
    const ce = new ComputeEngine();
    ce.declare('pts', 'list<tuple<real, real>>');
    expect(() =>
      compile(ce.box(['Product', 'pts'] as never), {
        fallback: false,
      } as never)
    ).toThrow('no product between two points');
    // The interpreter's answer is an error: `no-product-between-points` when
    // the list is known at boxing, and a type error of the `Multiply`
    // combiner of the `Reduce` the product canonicalizes to when the list is
    // assigned after boxing.
    ce.assign(
      'pts',
      ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]] as never)
    );
    expect(ce.box(['Product', 'pts'] as never).evaluate().isValid).toBe(false);
  });

  test('Sum of a list of numbers is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'list<real>');
    const r = compile(ce.box(['Sum', 'y'] as never), {
      fallback: false,
    } as never);
    expect(r.code).toBe('(_.y).reduce((_a, _b) => _a + _b, 0)');
    expect(r.run!({ y: [1, 2, 3] } as never)).toBe(6);
  });
});

/** The interpreter's exact, materialized value (see `interpreted`). */
function interpretedExact(
  json: unknown,
  values: { i?: number; c?: number }
): unknown {
  const ce = engine();
  const e = ce.box(json as never);
  ce.assign(
    'x',
    ce.box(['List', ...ROWS.map((row) => ['List', ...row])] as never)
  );
  ce.assign('y', ce.box(['List', ...ROWS[0]] as never));
  ce.assign('i', values.i ?? 1);
  ce.assign('c', values.c ?? 1);
  return e.evaluate({ materialization: true }).json;
}

describe('interpreter: lazy operators over an operand that can be absent', () => {
  test.each([
    [['Filter', ['At', 'x', 'i'], P], ['List', 3, 2], 'Missing'],
    [['Map', F, ['At', 'x', 'i']], ['List', 6, 2, 4], 'Missing'],
    [['Reduce', ['At', 'x', 'i'], 'Add', 0], 6, 'NaN'],
    [['Reduce', ['At', 'x', 'i'], ADD2, 0], 6, 'NaN'],
    [['Any', ['At', 'x', 'i'], P], 'True', 'Missing'],
    [['Scan', ['At', 'x', 'i'], 'Add'], ['List', 3, 4, 6], 'Missing'],
    [['Differences', ['At', 'x', 'i']], ['List', -2, 1], 'Missing'],
    [['Sum', ['Map', F, ['At', 'x', 'i']]], 12, 'NaN'],
    [['Sum', ['Filter', ['At', 'x', 'i'], P]], 5, 'NaN'],
    [['Length', ['Filter', ['At', 'x', 'i'], P]], 2, 'NaN'],
    [['Length', ['Map', F, ['At', 'x', 'i']]], 3, 'NaN'],
    [['Take', ['Map', F, ['At', 'x', 'i']], 2], ['List', 6, 2], 'Missing'],
    [['Product', ['When', 'y', ['Greater', 'c', 0]]], 6, 'NaN'],
    [
      ['Filter', ['When', 'y', ['Greater', 'c', 0]], P],
      ['List', 3, 2],
      'Missing',
    ],
  ])('%j', (json, present, absent) => {
    expect(interpretedExact(json, { i: 1, c: 1 })).toEqual(present);
    expect(interpretedExact(json, { i: 7, c: -1 })).toEqual(absent);
  });

  test('Sum of a Map over a written Missing is NaN', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Sum', ['Map', F, 'Missing']] as never).evaluate().json
    ).toBe('NaN');
  });

  test('a lazy view over an eager list read of a tuple evaluates', () => {
    // `t` is a pair of lists: `At(t, 1)` is typed `list<integer>` and has
    // no `missing` arm, but it is an eager operator without collection
    // handlers before it is evaluated. `Reduce` and the count of `Filter`
    // now resolve it as the lazy views resolve their sources.
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple<list<integer>, list<integer>>');
    ce.assign('t', ce.box(['Tuple', ['List', 3, 1, 2], ['List', 4]] as never));
    expect(
      ce.box(['Reduce', ['At', 't', 1], 'Add', 0] as never).evaluate().json
    ).toBe(6);
    expect(
      ce.box(['Length', ['Filter', ['At', 't', 1], P]] as never).evaluate().json
    ).toBe(2);
  });
});

describe('interpreter: materialization of a view that can be absent', () => {
  test('a present row materializes to the list, not a set', () => {
    // The walk of the unevaluated view could not tell an absent source
    // from an empty one, and built a `Set`: `Append(At(x, 1), 2)`
    // materialized to `Set(3, 1, 2)`, the duplicate lost.
    const ce = engine();
    ce.assign('x', ce.box(['List', ['List', 3, 1, 2], ['List', 4]] as never));
    const v = ce
      .box(['Append', ['At', 'x', 1], 2] as never)
      .evaluate({ materialization: true });
    expect(v.json).toEqual(['List', 3, 1, 2, 2]);
    const w = ce
      .box(['Reverse', ['At', 'x', 1]] as never)
      .evaluate({ materialization: true });
    expect(w.json).toEqual(['List', 2, 1, 3]);
  });

  test('an absent restricted list materializes to Missing, not Set(NaN)', () => {
    const ce = engine();
    ce.assign('y', ce.box(['List', 3, 1, 2] as never));
    ce.assign('c', -1);
    for (const json of [
      ['Reverse', ['When', 'y', ['Greater', 'c', 0]]],
      ['Take', ['When', 'y', ['Greater', 'c', 0]], 2],
      ['Filter', ['When', 'y', ['Greater', 'c', 0]], P],
    ])
      expect(
        ce.box(json as never).evaluate({ materialization: true }).json
      ).toBe('Missing');
  });

  test('the absent row materializes to Missing', () => {
    const ce = engine();
    ce.assign('x', ce.box(['List', ['List', 3, 1, 2]] as never));
    expect(
      ce
        .box(['Reverse', ['At', 'x', 7]] as never)
        .evaluate({ materialization: true }).json
    ).toBe('Missing');
  });
});
