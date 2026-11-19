/**
 * CE-1472: a `Comprehension` of the calls of a recursive function that has
 * no effect (README of `src/compute-engine/compilation/ir/`, "Lists"). The
 * instructions of the function's body, among them its recursive call, whose
 * effect is not known while the body is lowered, are not counted as the
 * caller's: the call counts by the effect of the function, `may-fail`.
 *
 * The values are compared with the interpreter's; its `Comprehension` is
 * lazy, read through `ListFrom`.
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Json = unknown;
type Value = number | Value[];

/** A fresh engine with the signatures `sigs`, the functions `fns` and the
 *  declarations `decl`. */
function engine(
  sigs: Record<string, string>,
  fns: Record<string, Json>,
  decl: Record<string, string> = {}
) {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(decl)) ce.declare(k, t as never);
  for (const [k, t] of Object.entries(sigs))
    ce.declare(k, { signature: t } as never);
  for (const [k, f] of Object.entries(fns)) ce.assign(k, ce.box(f as never));
  return ce;
}

/** The interpreter's value: a tuple or a list is an array. */
function read(e: Expression): Value {
  if (isNumber(e)) return e.re;
  if (isFunction(e, 'List') || isFunction(e, 'Tuple')) return e.ops.map(read);
  if (isFunction(e) && e.isCollection && e.isFiniteCollection)
    return read(e.engine.function('ListFrom', [e]).evaluate().N());
  throw new Error(`no value: ${e.toString()}`);
}

/** The message of a compilation that throws, or `undefined`. */
function failure(f: () => unknown): string | undefined {
  try {
    f();
  } catch (x) {
    return (x as { diagnostic?: { message: string } }).diagnostic?.message;
  }
  return undefined;
}

type Case = {
  sigs: Record<string, string>;
  fns: Record<string, Json>;
  decl?: Record<string, string>;
  json: Json;
  inputs?: Record<string, string>;
  /** The inputs, as MathJSON for the interpreter and as values. */
  at?: Record<string, [Json, unknown]>;
};

const compileTo = (c: Case) =>
  compile(engine(c.sigs, c.fns, c.decl).box(c.json as never), {
    to: 'javascript',
    fallback: false,
    ...(c.inputs ? { inputs: c.inputs } : {}),
  } as never);

/** Compiles on JavaScript with no fallback, and gives the interpreter's
 *  value. */
function check(c: Case): Value {
  const r = compileTo(c);
  expect(r).toMatchObject({ success: true });
  const at = Object.entries(c.at ?? {});
  const got = r.run!(
    Object.fromEntries(at.map(([k, [, v]]) => [k, v])) as never
  ) as Value;
  const ce = engine(c.sigs, c.fns, c.decl);
  for (const [k, [v]] of at) ce.assign(k, ce.box(v as never));
  const want = read(
    ce
      .box(c.json as never)
      .evaluate()
      .N()
  );
  expect(got).toEqual(want);
  return got;
}

const fn = (body: Json, ...params: string[]) => ['Function', body, ...params];
const which = (c: Json, a: Json, b: Json) => ['Which', c, a, 'True', b];
const range = (i: string, a: number, b: number, ...cond: Json[]) => [
  'Element',
  i,
  ['Range', a, b],
  ...cond,
];

/** `r(k) = Which(k <= 0, 0, True, s + r(k - 1))`, of the input `s`. */
const r = {
  sigs: { r: '(real) -> real' },
  fns: {
    r: fn(
      which(['LessEqual', 'k', 0], 0, ['Add', 's', ['r', ['Subtract', 'k', 1]]]),
      'k'
    ),
  },
  decl: { s: 'real' },
  inputs: { s: 'real' },
  at: { s: [2, 2] as [Json, unknown] },
};

describe('CE-1472: a Comprehension of the calls of a recursive function', () => {
  test('the witness', () => {
    expect(
      check({ ...r, json: ['Comprehension', ['r', 'i'], range('i', 0, 5)] })
    ).toEqual([0, 2, 4, 6, 8, 10]);
  });

  test('with a condition that calls the function', () => {
    expect(
      check({
        ...r,
        json: [
          'Comprehension',
          ['r', 'i'],
          range('i', 0, 5, ['Greater', ['r', 'i'], 3]),
        ],
      })
    ).toEqual([4, 6, 8, 10]);
  });

  test('two clauses, and its length', () => {
    check({
      ...r,
      json: [
        'Comprehension',
        ['Add', ['r', 'i'], 'j'],
        range('i', 0, 2),
        range('j', 1, 2),
      ],
    });
    check({
      ...r,
      json: ['Length', ['Comprehension', ['r', 'i'], range('i', 0, 5)]],
    });
  });

  test('an element read where the others are past the recursion limit of the interpreter', () => {
    // The interpreter computes the element read only; the compiled code
    // computes every element, each a value.
    check({
      ...r,
      json: ['At', ['Comprehension', ['r', 'i'], range('i', 0, 300)], 2],
    });
  });

  test('mutual recursion', () => {
    const k1 = ['Subtract', 'k', 1];
    check({
      sigs: { f: '(real) -> real', g: '(real) -> real' },
      fns: {
        f: fn(which(['LessEqual', 'k', 0], 1, ['Add', 1, ['g', k1]]), 'k'),
        g: fn(which(['LessEqual', 'k', 0], 2, ['Multiply', 2, ['f', k1]]), 'k'),
      },
      json: ['Comprehension', ['f', 'i'], range('i', 0, 4)],
    });
  });

  // Tycho's `[P(i, P_0) for i = 0..40]` of a point recursion.
  const P = {
    sigs: { P: '(real, tuple<real, real>) -> tuple<real, real>' },
    fns: {
      P: fn(
        which(['LessEqual', 'k', 0], 'p', [
          'Add',
          ['P', ['Subtract', 'k', 1], 'p'],
          ['Tuple', 1, ['Multiply', 0.5, 'k']],
        ]),
        'k',
        'p'
      ),
      P_0: ['Tuple', 1, 2],
    },
    decl: { P_0: 'tuple<real, real>' },
  };

  test('a point recursion', () => {
    const v = check({
      ...P,
      json: ['Comprehension', ['P', 'i', 'P_0'], range('i', 0, 40)],
    }) as number[][];
    expect(v.length).toBe(41);
    expect(v[40]).toEqual([41, 412]);
    check({
      ...P,
      json: ['Comprehension', ['P', 'i', 'Q'], range('i', 0, 3)],
      inputs: { Q: 'tuple<real, real>' },
      at: { Q: [['Tuple', 3, 4], [3, 4]] },
    });
  });

  test('a function that draws declines', () => {
    const effect = /a Comprehension with an effect/;
    const recursive = {
      sigs: { d: '(real) -> real' },
      fns: {
        d: fn(
          which(['LessEqual', 'k', 0], ['Random'], [
            'Add',
            ['Random'],
            ['d', ['Subtract', 'k', 1]],
          ]),
          'k'
        ),
      },
      json: ['Comprehension', ['d', 'i'], range('i', 0, 5)],
    };
    expect(failure(() => compileTo(recursive))).toMatch(effect);
    expect(
      failure(() =>
        compileTo({
          ...recursive,
          fns: { d: fn(['Add', ['Random'], 'k'], 'k') },
        })
      )
    ).toMatch(effect);
  });
});
