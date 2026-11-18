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
 * `c: real`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'list<list<integer>>');
  ce.declare('i', 'integer');
  ce.declare('y', 'list<integer>');
  ce.declare('c', 'real');
  return ce;
}

describe('a declared absent operand', () => {
  test('is an error: `Missing` is a result only', () => {
    expect(() =>
      new ComputeEngine().declare('r', 'list<integer> | missing')
    ).toThrow(/cannot be declared/);
  });
});

describe('Sum and Product of a list of points or of rows', () => {

  test('Product of a list of points declines, as the interpreter errors', () => {
    const ce = new ComputeEngine();
    ce.declare('pts', 'list<tuple<real, real>>');
    expect(() =>
      compile(ce.box(['Product', 'pts'] as never), {
        fallback: false,
      } as never)
    ).toThrow(/Could not compile/);
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
    [['Reduce', ['At', 'x', 'i'], 'Add', 0], 6, 'Missing'],
    [['Reduce', ['At', 'x', 'i'], ADD2, 0], 6, 'Missing'],
    [['Any', ['At', 'x', 'i'], P], 'True', 'False'],
    [['Scan', ['At', 'x', 'i'], 'Add'], ['List', 3, 4, 6], 'Missing'],
    [['Differences', ['At', 'x', 'i']], ['List', -2, 1], 'Missing'],
    [['Sum', ['Map', F, ['At', 'x', 'i']]], 12, 'Missing'],
    [['Sum', ['Filter', ['At', 'x', 'i'], P]], 5, 'Missing'],
    [['Length', ['Filter', ['At', 'x', 'i'], P]], 2, 'Missing'],
    [['Length', ['Map', F, ['At', 'x', 'i']]], 3, 'Missing'],
    [['Take', ['Map', F, ['At', 'x', 'i']], 2], ['List', 6, 2], 'Missing'],
    [['Product', ['If', ['Greater', 'c', 0], 'y']], 6, 'Missing'],
    [
      ['Filter', ['If', ['Greater', 'c', 0], 'y'], P],
      ['List', 3, 2],
      'Missing',
    ],
  ])('%j', (json, present, absent) => {
    expect(interpretedExact(json, { i: 1, c: 1 })).toEqual(present);
    expect(interpretedExact(json, { i: 7, c: -1 })).toEqual(absent);
  });

  test('Sum of a Map over a written Missing is Missing', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Sum', ['Map', F, 'Missing']] as never).evaluate().json
    ).toBe('Missing');
  });

  test('an error in one operand is not hidden by an absent operand', () => {
    // `a` holds `Missing` and `g(5)` evaluates to an error (`Reverse(5)`):
    // the error is the result, with the frame of `Map`, in both orders, on
    // the synchronous and the asynchronous routes.
    const ce = new ComputeEngine();
    // A store into a declared name accepts `Missing`.
    ce.declare('a', 'list<integer>');
    ce.assign('a', ce.symbol('Missing'));
    ce.declare('g', '(unknown) -> list<integer> | missing');
    ce.assign('g', ce.box(['Function', ['Sin', ['Reverse', 'k']], 'k']));
    const frames = (v: { json: unknown }) =>
      JSON.stringify(v.json).match(/ErrorFrame","'(\w+)'",(\d)/g);
    const before = ce.box(['Map', 'Add', ['g', 5], 'a'] as never);
    const after = ce.box(['Map', 'Add', 'a', ['g', 5]] as never);
    expect(before.evaluate().operator).toBe('Error');
    expect(frames(before.evaluate())?.at(-1)).toBe(`ErrorFrame","'Map'",2`);
    expect(after.evaluate().operator).toBe('Error');
    expect(frames(after.evaluate())?.at(-1)).toBe(`ErrorFrame","'Map'",3`);
    return after.evaluateAsync().then((v) => {
      expect(v.operator).toBe('Error');
    });
  });

  test('Sum and Product await an operand that has only an asynchronous handler', async () => {
    // A source typed `list<integer> | missing` with only an `evaluateAsync`
    // handler does not evaluate on the synchronous route: the asynchronous
    // handlers of `Sum` and `Product` must await it.
    const ce = new ComputeEngine();
    let present = true;
    ce.declare('Src', {
      signature: '() -> list<integer> | missing',
      pure: true,
      evaluateAsync: async () =>
        present ? ce.box(['List', 1, 2, 3]) : ce.symbol('Missing'),
    } as never);
    for (const op of ['Sum', 'Product']) {
      const e = ce.box([op, ['Src']] as never);
      present = true;
      expect((await e.evaluateAsync()).json).toBe(6);
      present = false;
      expect((await e.evaluateAsync()).json).toBe('Missing');
    }
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
      ['Reverse', ['If', ['Greater', 'c', 0], 'y']],
      ['Take', ['If', ['Greater', 'c', 0], 'y'], 2],
      ['Filter', ['If', ['Greater', 'c', 0], 'y'], P],
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
