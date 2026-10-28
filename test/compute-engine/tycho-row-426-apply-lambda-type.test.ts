/**
 * Tycho ledger row 426 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`, filed
 * 2026-10-22 on CE 0.161.0): an applied function literal whose body maps a
 * function over its parameter was typed `collection<unknown>`.
 *
 * With `p(n) = s n` (`s` real) and `M: list<real>`, `Map(p, M)` is a
 * `list<number>`, but `Apply(a ↦ Map(p, a), M)` was a
 * `collection<unknown>`: the literal types its parameter `a` from the
 * signature of `Map` (`collection<unknown>`), and the application used the
 * literal's result type. The control `Apply(a ↦ 2a, M)` was a `list<real>`,
 * because a literal with a scalar parameter maps over a list argument and
 * types each cell with the parameter bound to the element type.
 *
 * The application is now typed as its beta reduction: the body with each
 * parameter bound to the type of its argument, by the body walk that types a
 * call of a named user function (`appliedLiteralResultType` and
 * `callResultType`, `boxed-expression/call-result-type.ts`). The walk stops
 * at a statement it cannot type in order (an early `Return`, a loop, an
 * assignment that is not a statement of the body), and follows an
 * assignment to a parameter.
 *
 * The review of the change found three defects that the new typing made
 * easier to reach, tested below: a literal's result type ignored an early
 * `Return`; the mapped typing of a literal ignored an early `Return` and an
 * assignment; and the index of a `Sum` with the name of a parameter typed
 * that parameter on the box route.
 *
 * The cases follow Tycho's instrument
 * (`scripts/repros/2026-10-22-ce426-apply-lambda-map-type-repro.mts`) and
 * its test `helper-function-step.test.ts`, case 12.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isDictionary,
  isFunction,
} from '../../src/compute-engine/boxed-expression/type-guards';
import { isSubtype } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';

type Json = any;

const F = (body: Json, ...params: Json[]): Json => [
  'Function',
  body,
  ...params,
];
const typed = (name: string, type: string): Json => [
  'Typed',
  name,
  `'${type}'`,
];

/** An engine with the declarations of the row: `s: real`,
 * `p := n ↦ s n`, `M: list<real>`, `N: list<integer>`. */
function rowEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('s', 'real');
  ce.declare('p', 'function');
  ce.assign('p', ce.parse('n \\mapsto s n'));
  ce.declare('M', 'list<real>');
  ce.declare('N', 'list<integer>');
  return ce;
}

const typeOf = (ce: ComputeEngine, json: Json): string =>
  ce.box(json).type.toString();

describe('row 426: an applied literal is typed as its body over the argument', () => {
  const ce = rowEngine();

  test('the row: with and without the Block, as the direct Map', () => {
    const direct = typeOf(ce, ['Map', 'p', 'M']);
    expect(direct).toBe('list<number>');
    expect(
      typeOf(ce, ['Apply', F(['Block', ['Map', 'p', 'a']], 'a'), 'M'])
    ).toBe(direct);
    expect(typeOf(ce, ['Apply', F(['Map', 'p', 'a'], 'a'), 'M'])).toBe(direct);
  });

  test('the control: a scalar parameter maps over the list', () => {
    expect(
      typeOf(ce, ['Apply', F(['Block', ['Multiply', 2, 'a']], 'a'), 'M'])
    ).toBe('list<real>');
  });

  test('other higher-order bodies type as the body written over the argument', () => {
    const positive = F(['Greater', 'u', 0], 'u');
    const double = F(['Multiply', 2, 'u'], 'u');
    const pairs: [Json, Json][] = [
      [
        ['Apply', F(['Filter', 'a', positive], 'a'), 'M'],
        ['Filter', 'M', positive],
      ],
      [
        ['Apply', F(['Reduce', 'a', 'Add'], 'a'), 'M'],
        ['Reduce', 'M', 'Add'],
      ],
      [
        ['Apply', F(['Map', double, 'a'], 'a'), 'M'],
        ['Map', double, 'M'],
      ],
      [
        ['Apply', F(['Join', 'a', 'b'], 'a', 'b'), 'M', 'N'],
        ['Join', 'M', 'N'],
      ],
    ];
    for (const [applied, direct] of pairs)
      expect(typeOf(ce, applied)).toBe(typeOf(ce, direct));
    expect(typeOf(ce, ['Map', double, 'M'])).toBe('list<real>');
    expect(typeOf(ce, ['Join', 'M', 'N'])).toBe('list<real>');
  });

  test('a scalar result is not refined, as on the named route', () => {
    // `a ↦ Sum(a)` has the result type `number`. A call of a named user
    // function with a scalar result keeps it (`callResultType` refines only
    // collection results), and the applied literal does the same.
    ce.declare('sumOf', 'function');
    ce.assign('sumOf', ce.box(F(['Sum', 'a'], 'a')));
    expect(typeOf(ce, ['Apply', F(['Sum', 'a'], 'a'), 'M'])).toBe(
      typeOf(ce, ['sumOf', 'M'])
    );
  });

  test('typing the application does not change the literal', () => {
    const literal = ce.box(F(['Map', 'p', 'a'], 'a'));
    const before = literal.type.toString();
    expect(before).toBe('(a: collection<unknown>) -> collection<unknown>');
    expect(
      ce.function('Apply', [literal, ce.symbol('M')]).type.toString()
    ).toBe('list<number>');
    expect(literal.type.toString()).toBe(before);
    // The same literal applied to a list of integers.
    expect(
      ce.function('Apply', [literal, ce.symbol('N')]).type.toString()
    ).toBe(typeOf(ce, ['Map', 'p', 'N']));
  });
});

describe('row 426: parameter contracts', () => {
  const ce = rowEngine();

  test('a declared parameter type that the argument fits', () => {
    expect(
      typeOf(ce, ['Apply', F(['Map', 'p', 'a'], typed('a', 'list<real>')), 'M'])
    ).toBe('list<number>');
  });

  test('an argument that does not fit its parameter keeps the result type of the literal', () => {
    // `M` is a list of reals, the parameter a list of integers: the
    // parameter type is the contract, and the call keeps the literal's own
    // result type.
    const literal = F(['Map', 'p', 'a'], typed('a', 'list<integer>'));
    expect(typeOf(ce, ['Apply', literal, 'M'])).toBe(
      ce
        .box(literal)
        .type.toString()
        .replace(/^.*-> /, '')
    );
    // `5` is not a collection, which the parameter of `a ↦ Map(p, a)` is
    // (inferred from `Map`).
    expect(typeOf(ce, ['Apply', F(['Map', 'p', 'a'], 'a'), 5])).toBe(
      'collection<unknown>'
    );
  });

  test('an argument of unknown type keeps the result type of the literal', () => {
    expect(typeOf(ce, ['Apply', F(['Map', 'p', 'a'], 'a'), 'unknownArg'])).toBe(
      'collection<unknown>'
    );
  });
});

describe('row 426: nested and curried applications', () => {
  const ce = rowEngine();

  test('an applied literal inside the body of another', () => {
    expect(
      typeOf(ce, [
        'Apply',
        F(['Apply', F(['Map', 'p', 'a'], 'a'), 'b'], typed('b', 'list<real>')),
        'M',
      ])
    ).toBe('list<number>');
  });

  test('a curried application keeps a type that holds the direct type', () => {
    // The callee of the outer `Apply` is an application, not a literal: its
    // body is not read, and the call keeps the result type of the inner
    // literal, which is wider than the type of the direct `Map`.
    const t = ce.box([
      'Apply',
      ['Apply', F(F(['Map', 'p', 'a'], 'a'), 'b'), 1],
      'M',
    ]).type.type;
    expect(isSubtype(ce.box(['Map', 'p', 'M']).type.type, t)).toBe(true);
  });

  test('a literal applied to itself terminates', () => {
    const self = F(['Apply', 'f', 'f'], 'f');
    expect(() => ce.box(['Apply', self, self]).type.toString()).not.toThrow();
  });

  test('a chain of 13 applied literals terminates', () => {
    let body: Json = ['Map', F(['Multiply', 2, 'u'], 'u'), 'a0'];
    for (let i = 1; i <= 12; i++)
      body = ['Apply', F(body, `a${i - 1}`), `a${i}`];
    expect(() =>
      ce.box(['Apply', F(body, 'a12'), 'M']).type.toString()
    ).not.toThrow();
  });
});

describe('row 426: routes and values', () => {
  test('the parse, box and function routes agree', () => {
    const ce = rowEngine();
    expect(
      ce.parse('(a \\mapsto \\operatorname{Map}(p, a))(M)').type.toString()
    ).toBe('list<number>');
    expect(
      ce
        .parse('\\operatorname{Apply}(a \\mapsto \\operatorname{Map}(p, a), M)')
        .type.toString()
    ).toBe('list<number>');
    expect(typeOf(ce, ['Apply', F(['Map', 'p', 'a'], 'a'), 'M'])).toBe(
      'list<number>'
    );
    expect(
      ce
        .function('Apply', [ce.box(F(['Map', 'p', 'a'], 'a')), ce.symbol('M')])
        .type.toString()
    ).toBe('list<number>');
    // `M |> f` is `f(M)`: the pipe is typed as the application.
    expect(typeOf(ce, ['Pipe', 'M', F(['Map', 'p', 'a'], 'a')])).toBe(
      'list<number>'
    );
  });

  test('the value is the value of the direct Map, and fits the type', () => {
    const ce = rowEngine();
    const applied = ce.box(['Apply', F(['Map', 'p', 'a'], 'a'), 'M']);
    const staticType: Type = applied.type.type;
    ce.assign('s', 3);
    ce.assign('M', ce.box(['List', 1.5, -2, 0.25]));
    const value = ce.box(['Apply', F(['Map', 'p', 'a'], 'a'), 'M']).evaluate();
    const direct = ce.box(['Map', 'p', 'M']).evaluate();
    // Both values may be lazy `Map` collections over different sources (the
    // list, the symbol), so their elements are compared: 3·1.5, 3·(−2),
    // 3·0.25.
    expect(value.toString()).toBe(direct.toString());
    expect(value.toString()).toBe('[4.5,-6,0.75]');
    expect(isSubtype(value.type.type, staticType)).toBe(true);
  });

  test('the step of Tycho case 12 compiles and gives the interpreter value', () => {
    // `U + q(N)` with the helper `q(v) = Map(r, v)` spliced as an applied
    // literal, and `r` a recursive helper: `r(n) = n·s` for a whole `n ≥ 0`.
    const ce = new ComputeEngine();
    ce.declare('s', 'real');
    ce.declare('r', 'function');
    ce.assign(
      'r',
      ce.parse(
        'n \\mapsto \\begin{cases} 0 & n \\le 0 \\\\ s + r(n-1) & \\text{otherwise}\\end{cases}'
      )
    );
    ce.declare('U', 'list<real>');
    ce.declare('N', 'list<real>');
    const step: Json = [
      'Add',
      'U',
      ['Apply', F(['Block', ['Map', 'r', 'v']], 'v'), 'N'],
    ];
    // The applied literal types as the direct `Map(r, N)`, and the step as
    // `U + Map(r, N)`.
    expect(typeOf(ce, step[2])).toBe(typeOf(ce, ['Map', 'r', 'N']));
    expect(typeOf(ce, step)).toBe(typeOf(ce, ['Add', 'U', ['Map', 'r', 'N']]));

    const result = compile(ce.box(step));
    expect(result.success).toBe(true);
    const U0 = [0.466203685, 0.466203685, -0.93240737];
    const compiled = result.run!({ U: U0, N: [1, 2, 3], s: 0.05 } as never) as
      number[] | undefined;

    ce.assign('s', 0.05);
    ce.assign('U', ce.box(['List', ...U0]));
    ce.assign('N', ce.box(['List', 1, 2, 3]));
    const interpreted = ce.box(step).N().json as unknown as Json[];
    expect(interpreted[0]).toBe('List');
    const expected = U0.map((u, i) => u + 0.05 * (i + 1));
    expect(compiled).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(compiled![i]).toBeCloseTo(expected[i], 12);
      expect(interpreted[i + 1]).toBeCloseTo(expected[i], 12);
    }
  });
});

/**
 * Box `json` in a row engine, then give `s` and `M` values and evaluate it:
 * the static type, and whether the value fits it.
 */
function typeAndFit(json: Json): { type: string; fits: boolean } {
  const ce = rowEngine();
  ce.declare('LL', 'list<list<real>>');
  const staticType = ce.box(json).type;
  ce.assign('s', 3);
  ce.assign('M', ce.box(['List', 1.5, -2, 0.25]));
  ce.assign('LL', ce.box(['List', ['List', 1.5], ['List', 2]]));
  const value = ce.box(json).evaluate();
  return { type: staticType.toString(), fits: value.type.matches(staticType) };
}

const longer = ['Greater', ['Length', 'a'], 1];

describe('row 426 review: statements the body walk cannot type in order', () => {
  // With an early `Return`, the value of the function is not the value of
  // its last statement. The applied literal and the pipe keep the result
  // type of the literal (which joins the returned values), as the named
  // route does.
  const early = (returned: Json): Json =>
    F(['Block', ['If', longer, ['Return', returned]], ['Map', 'p', 'a']], 'a');
  for (const [label, returned] of [
    ['a set', ['Set', 1, 2]],
    ['a tuple', ['Tuple', 'a', 'a']],
    ['a string', "'abc'"],
    ['a nested list', ['List', 'a']],
  ] as [string, Json][]) {
    test(`an early Return of ${label}: Apply and Pipe`, () => {
      for (const json of [
        ['Apply', early(returned), 'M'],
        ['Pipe', 'M', early(returned)],
      ]) {
        const { type, fits } = typeAndFit(json);
        expect(type).not.toBe('list<number>');
        expect(fits).toBe(true);
      }
    });
  }

  test('an assignment to a parameter retypes it', () => {
    // `a := Set(1)` as a statement of the body: the body is `Set(1)`.
    const { type, fits } = typeAndFit([
      'Apply',
      F(['Block', ['Assign', 'a', ['Set', 1]], 'a'], typed('a', 'collection')),
      'M',
    ]);
    expect(type).toBe('set<integer>');
    expect(fits).toBe(true);
  });

  test('an assignment inside a conditional stops the derivation', () => {
    for (const json of [
      [
        'Apply',
        F(
          ['Block', ['If', longer, ['Assign', 'a', ['Set', 1]]], 'a'],
          typed('a', 'collection')
        ),
        'M',
      ],
      [
        'Pipe',
        'M',
        F(
          ['Block', ['If', longer, ['Assign', 'a', ['Set', 1]]], 'a'],
          typed('a', 'collection')
        ),
      ],
    ]) {
      const { type, fits } = typeAndFit(json);
      expect(type).toBe('collection');
      expect(fits).toBe(true);
    }
  });

  test('a mapped literal with an assignment keeps the type of the literal', () => {
    // `a` is a scalar parameter, so the literal maps over `M`; each cell is
    // the list `[7]`, not the element.
    const { type, fits } = typeAndFit([
      'Apply',
      F(['Block', ['Assign', 'a', ['List', 7]], 'a'], 'a'),
      'M',
    ]);
    expect(type).not.toBe('list<real>');
    expect(fits).toBe(true);
  });

  test('the compiled code of an early Return declines, as the interpreter refuses', () => {
    // `First(M)` is returned, so `At(…, 1)` reads a number: the interpreter
    // answers `incompatible-type`. Typed `list<real>`, the compiled code
    // returned `null`.
    const ce = rowEngine();
    const json: Json = [
      'At',
      [
        'Apply',
        F(
          [
            'Block',
            ['If', longer, ['Return', ['First', 'a']]],
            ['Reverse', 'a'],
          ],
          'a'
        ),
        'M',
      ],
      1,
    ];
    expect(compile(ce.box(json)).success).toBe(false);
  });
});

describe('row 426 review: a literal whose body returns early', () => {
  // `x ↦ (x > 1 ? return (x, x) : x^2)`: over `M = [1.5, -2, 0.25]` the
  // values are `(1.5, 1.5)`, `4`, `0.0625`.
  const literal = F(
    [
      'Block',
      ['If', ['Greater', 'x', 1], ['Return', ['Tuple', 'x', 'x']]],
      ['Power', 'x', 2],
    ],
    'x'
  );

  test('the result type of the literal joins the returned value', () => {
    // The `any` before the arrow is the literal's effect set: a `Return`
    // is a control effect.
    const ce = rowEngine();
    expect(ce.box(literal).type.toString()).toBe(
      '(x: unknown) any -> number | tuple<number, number>'
    );
  });

  test('Apply, Pipe and Map give types that the values fit', () => {
    for (const json of [
      ['Apply', literal, 'M'],
      ['Pipe', 'M', literal],
      ['Map', literal, 'M'],
    ]) {
      const { type, fits } = typeAndFit(json);
      expect(type).toMatch(/tuple</);
      expect(fits).toBe(true);
    }
  });
});

describe('row 426 review: names and scopes', () => {
  test('a captured symbol keeps its own binding', () => {
    // The literal reads the outer `g: list<real>`. Applied in a scope that
    // declares another `g`, the body still reads the outer one.
    const ce = rowEngine();
    ce.declare('g', 'list<real>');
    const literal = ce.box(F(['Join', 'a', 'g'], 'a'));
    ce.pushScope();
    try {
      ce.declare('g', 'list<string>');
      expect(
        ce.function('Apply', [literal, ce.symbol('M')]).type.toString()
      ).toBe('list<real>');
    } finally {
      ce.popScope();
    }
  });

  test('the index of a Sum does not type a parameter of the same name', () => {
    const ce = new ComputeEngine();
    const sum = ['Sum', ['Multiply', 2, 'k'], ['Limits', 'k', 1, 3]];
    // `Reverse(k)` alone types `k` an indexed collection; the `2k` of the
    // `Sum` is the index, and adds nothing to it.
    expect(typeOf(ce, F(['Tuple', sum, ['Reverse', 'k']], 'k'))).toBe(
      typeOf(ce, F(['Tuple', 3, ['Reverse', 'k']], 'k')).replace(
        'tuple<integer,',
        'tuple<integer,'
      )
    );
    expect(typeOf(ce, F(['Tuple', sum, 'k'], 'k'))).toBe(
      '(k: unknown) -> tuple<integer, unknown>'
    );
    // The parse route agrees.
    expect(ce.parse('k \\mapsto (\\sum_{k=1}^3 2k, k)').type.toString()).toBe(
      '(k: unknown) -> tuple<integer, unknown>'
    );
  });

  test('a mapped literal types the index of a Sum as the index', () => {
    // `k ↦ (Sum(2k, k = 1..3), k)` maps over `M`: the sum is the integer
    // 12 in every cell, whatever the element.
    const { type, fits } = typeAndFit([
      'Apply',
      F(
        ['Tuple', ['Sum', ['Multiply', 2, 'k'], ['Limits', 'k', 1, 3]], 'k'],
        'k'
      ),
      'M',
    ]);
    expect(type).toBe('list<tuple<integer, real>>');
    expect(fits).toBe(true);
  });

  test('an argument that may be absent: as the named route', () => {
    // `At(LL, 1)` is `missing | list<real>`.
    const ce = rowEngine();
    ce.declare('LL', 'list<list<real>>');
    ce.declare('q', 'function');
    ce.assign('q', ce.box(F(['Map', 'p', 'a'], 'a')));
    const applied = typeOf(ce, [
      'Apply',
      F(['Map', 'p', 'a'], 'a'),
      ['At', 'LL', 1],
    ]);
    expect(applied).toBe(typeOf(ce, ['q', ['At', 'LL', 1]]));
    expect(applied).toBe('list<number> | missing');
    expect(
      typeAndFit(['Apply', F(['Map', 'p', 'a'], 'a'), ['At', 'LL', 1]]).fits
    ).toBe(true);
  });
});

describe('row 426 second review: a nested literal that reads an outer name', () => {
  // The signature of `u ↦ At(b, 1)` is typed with `b` at its inferred type,
  // not at the type of the argument: its result says nothing about the
  // call. `M` is a list of reals, `S` a list of strings.
  for (const [label, callback] of [
    ['At(b, 1)', F(['At', 'b', 1], 'u')],
    ['b', F('b', 'u')],
    ['u·b', F(['Multiply', 'u', 'b'], 'u')],
  ] as [string, Json][]) {
    test(`Map(u ↦ ${label}, a): the named and the applied routes`, () => {
      const literal = F(['Map', callback, 'a'], 'a', 'b');
      const ce = rowEngine();
      ce.declare('S', 'list<string>');
      ce.declare('q', 'function');
      ce.assign('q', ce.box(literal));
      const second = label === 'u·b' ? 'M' : 'S';
      const named = ce.box(['q', 'M', second]).type;
      const applied = ce.box(['Apply', literal, 'M', second]).type;
      ce.assign('s', 3);
      ce.assign('M', ce.box(['List', 1.5, -2, 0.25]));
      ce.assign('S', ce.box(['List', "'x'", "'y'"]));
      const value = ce.box(['Apply', literal, 'M', second]).evaluate();
      // The two routes agree, and neither is refined by the nested literal.
      expect(applied.toString()).toBe(named.toString());
      expect(applied.toString()).toBe(
        ce
          .box(literal)
          .type.toString()
          .replace(/^.*-> /, '')
      );
      // With `b = M`, `u·b` is a list: the literal's own signature types it
      // a number (the unknown parameter `b` is read as a number), so that
      // value does not fit. This is the literal's type, not the
      // application's, and it is the same before this change.
      if (label !== 'u·b') expect(value.type.matches(applied)).toBe(true);
    });
  }

  test('a nested literal that reads only its own parameter is typed', () => {
    expect(
      typeAndFit([
        'Apply',
        F(['Map', F(['Multiply', 2, 'u'], 'u'), 'a'], 'a'),
        'M',
      ])
    ).toEqual({ type: 'list<real>', fits: true });
  });

  test('Map with a callback whose result is unknown: unknown elements', () => {
    const ce = rowEngine();
    ce.declare('g', '(unknown) -> unknown');
    // `Q` is not declared: the callback's result is not known, and it is
    // not the element of `M`.
    expect(typeOf(ce, ['Map', F('Q', 'u'), 'M'])).toBe('list<unknown>');
    expect(typeOf(ce, ['Map', 'g', 'M'])).toBe('list<unknown>');
    // The identity is typed by its body.
    expect(typeOf(ce, ['Map', F('u', 'u'), 'M'])).toBe('list<real>');
  });
});

describe('row 426 second review: Return', () => {
  test('a Return with no operand adds nothing to the result', () => {
    const ce = rowEngine();
    const literal = F(
      ['Block', ['If', ['Greater', 'x', 1], ['Return']], ['Multiply', 2, 'x']],
      'x'
    );
    expect(ce.box(literal).type.toString()).toBe(
      '(x: unknown) any -> nothing | number'
    );
    const applied = ce.box(['Apply', literal, 3]);
    expect(applied.type.toString()).toBe('nothing | number');
    expect(applied.evaluate().type.matches(applied.type)).toBe(true);
  });

  test('a quoted Return is not a Return of the body', () => {
    const ce = rowEngine();
    const literal = F(
      ['Block', ['Hold', ['Return', "'abc'"]], ['Power', 'x', 2]],
      'x'
    );
    expect(ce.box(literal).type.toString()).not.toMatch(/string/);
  });

  test('a Return inside a Loop body is a Return of the body', () => {
    const ce = rowEngine();
    const literal = F(
      [
        'Block',
        ['Declare', 'i'],
        ['Assign', 'i', 0],
        [
          'Loop',
          [
            'Block',
            ['Assign', 'i', ['Add', 'i', 1]],
            ['If', ['Greater', 'i', 'x'], ['Return', "'done'"]],
          ],
        ],
        0,
      ],
      'x'
    );
    expect(ce.box(literal).type.toString()).toMatch(/string/);
  });
});

describe('row 426 second review: a lazy collection over a reassigned parameter', () => {
  // The lazy `Map` or `Filter` that a call returns reads its source when its
  // elements are read. A parameter of the call in its source is replaced
  // with the parameter's value when the call ends, not with the argument.
  const dbl = F(['Multiply', 2, 'u'], 'u');
  for (const [label, last, expected] of [
    ['Map', ['Map', dbl, 'a'], '[14,16]'],
    ['Filter', ['Filter', 'a', F(['Greater', 'u', 7], 'u')], '[8]'],
    ['Reverse', ['Reverse', 'a'], '[8,7]'],
  ] as [string, Json, string][]) {
    test(label, () => {
      const literal = F(['Block', ['Assign', 'a', ['List', 7, 8]], last], 'a');
      const ce = rowEngine();
      ce.declare('q', 'function');
      ce.assign('q', ce.box(literal));
      ce.assign('M', ce.box(['List', 1.5, -2, 0.25]));
      expect(ce.box(['Apply', literal, 'M']).evaluate().toString()).toBe(
        expected
      );
      expect(ce.box(['q', 'M']).evaluate().toString()).toBe(expected);
      const fit = typeAndFit(['Apply', literal, 'M']);
      expect(fit.fits).toBe(true);
    });
  }
});

describe('row 426 second review: number literal arguments', () => {
  test('a literal argument is bound to its tier', () => {
    const ce = rowEngine();
    const literal = F(['Tuple', ['Multiply', 2, 'x'], 'x'], 'x');
    ce.declare('q', 'function');
    ce.assign('q', ce.box(literal));
    for (const json of [
      ['Apply', literal, 3],
      ['q', 3],
    ] as Json[]) {
      const e = ce.box(json);
      expect(e.type.toString()).toBe('tuple<integer, integer>');
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

describe('row 426 third review: a plain value is copied at its assignment', () => {
  // A plain value stored by `Assign` reads the variables of the run (a
  // parameter, a block local) it names when it is stored; a closure keeps
  // the variable. `If(x > y, x, 0)` with `y` free is held: the stored value
  // used to read the reassigned `x` when the call ended.
  const iff = (v: string): Json => ['If', ['Greater', v, 'y'], v, 0];
  const stored: [string, (v: string) => Json, string][] = [
    ['If', iff, 'If(y < 3, 3, 0)'],
    ['Tuple', (v) => ['Tuple', iff(v), 1], '(If(y < 3, 3, 0), 1)'],
    [
      'Which',
      (v) => ['Which', ['Greater', v, 'y'], v, 'True', 0],
      'Which(y < 3, 3, "True", 0)',
    ],
    ['Add', (v) => ['Add', 1, iff(v)], 'If(y < 3, 3, 0) + 1'],
    ['List', (v) => ['List', iff(v)], '[If(y < 3, 3, 0)]'],
    ['Hold', (v) => ['Hold', v], 'Hold(3)'],
  ];
  for (const [label, make, expected] of stored) {
    test(`${label}: a parameter, sync and async`, async () => {
      const ce = new ComputeEngine();
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.box(
          F(
            [
              'Block',
              ['Declare', 'r'],
              ['Assign', 'r', make('x')],
              ['Assign', 'x', 100],
              'r',
            ],
            'x'
          )
        )
      );
      expect(ce.box(['f', 3]).evaluate().toString()).toBe(expected);
      expect((await ce.box(['f', 3]).evaluateAsync()).toString()).toBe(
        expected
      );
    });
    test(`${label}: a block local, sync and async`, async () => {
      const ce = new ComputeEngine();
      const block: Json = [
        'Block',
        ['Declare', 'b'],
        ['Assign', 'b', 3],
        ['Declare', 'r'],
        ['Assign', 'r', make('b')],
        ['Assign', 'b', 100],
        'r',
      ];
      expect(ce.box(block).evaluate().toString()).toBe(expected);
      expect((await ce.box(block).evaluateAsync()).toString()).toBe(expected);
    });
  }

  test('a closure keeps the variable', () => {
    const ce = new ComputeEngine();
    const addTo = (v: string) => F(['Add', 'u', v], 'u');
    // A closure over a block local and over a parameter reads the last
    // value: 1 + 10.
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'b'],
          ['Assign', 'b', 3],
          ['Declare', 'g'],
          ['Assign', 'g', addTo('b')],
          ['Assign', 'b', 10],
          ['Apply', 'g', 1],
        ])
        .evaluate()
        .toString()
    ).toBe('11');
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          [
            'Block',
            ['Declare', 'g'],
            ['Assign', 'g', addTo('a')],
            ['Assign', 'a', 10],
            'g',
          ],
          'a'
        )
      )
    );
    expect(
      ce
        .box(['Apply', ce.box(['f', 3]).evaluate(), 1])
        .evaluate()
        .toString()
    ).toBe('11');
  });

  test('a lazy collection stored in a block local reads the value it was given', () => {
    const ce = new ComputeEngine();
    const block: Json = [
      'Block',
      ['Declare', 'b'],
      ['Assign', 'b', ['List', 1, 2]],
      ['Declare', 'm'],
      ['Assign', 'm', ['Map', F(['Multiply', 2, 'u'], 'u'), 'b']],
      ['Assign', 'b', ['List', 9]],
      'm',
    ];
    expect(ce.box(block).evaluate().toString()).toBe('[2,4]');
  });
});

describe('row 426 third review: a fallthrough to Nothing', () => {
  test('the empty Block at the end keeps its nothing arm', () => {
    const ce = new ComputeEngine();
    const literal = F(
      ['Block', ['If', 'c', ['Return', 1]], ['Block']],
      typed('c', 'boolean')
    );
    expect(ce.box(literal).type.toString()).toBe(
      '(c: boolean) any -> integer | nothing'
    );
    for (const c of ['True', 'False']) {
      const e = ce.box(['Apply', literal, c]);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

describe('row 426 third review: a shared tower in a function literal', () => {
  // `Max(e, e)` of depth 30: 31 distinct nodes, 2^30 paths
  // (`dag-shared-walks.test.ts`). Each typing below walks the body of the
  // literal; a walk that unfolds the tree does not finish.
  const ce = new ComputeEngine();
  ce.declare('M', 'list<real>');
  let tower = ce.box(['Add', 'x', 'y']);
  for (let i = 0; i < 30; i++) tower = ce.function('Max', [tower, tower]);
  const x = ce.symbol('x');

  test('the literal, with and without an early Return', () => {
    expect(ce.function('Function', [tower, x]).type.toString()).toBe(
      '(x: unknown) -> number'
    );
    const early = ce.function('Function', [
      ce.function('Block', [
        ce.function('If', [
          ce.function('Greater', [x, ce.number(1)]),
          ce.function('Return', [tower]),
        ]),
        tower,
      ]),
      x,
    ]);
    expect(early.type.toString()).toMatch(/-> number$/);
  });

  test('Map, Pipe and Apply over the literal', () => {
    const literal = ce.function('Function', [tower, x]);
    const list = ce.box(['List', 1, 2]);
    expect(ce.function('Map', [literal, list]).type.toString()).toBe(
      'vector<2>'
    );
    expect(ce.function('Pipe', [list, literal]).type.toString()).toBe(
      'vector<2>'
    );
    const inner = ce.function('Function', [tower, ce.symbol('u')]);
    const outer = ce.function('Function', [
      ce.function('Map', [inner, ce.symbol('a')]),
      ce.symbol('a'),
    ]);
    // The time is part of the test. The walk that looks for a call of a
    // running literal read each node once per path, and the typing below
    // took about 130 s (2^30 paths); the test still passed, because a jest
    // time limit cannot stop a synchronous test. Read once per node, it
    // takes a few milliseconds (CE-594.1).
    const start = performance.now();
    expect(ce.function('Apply', [outer, ce.symbol('M')]).type.toString()).toBe(
      'list<number>'
    );
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('row 426 third review: a stored value with an operator that binds names', () => {
  // The operands of `Sum` and `Product` read the run variables they name
  // when the value is stored; the operator's own index stays its index; a
  // nested function literal is a closure and keeps the variable.
  const limits = (k: string): Json => ['Limits', k, 1, 3];
  const cases: [string, (v: string) => Json, string, string][] = [
    [
      'Sum',
      (v) => ['If', 'c', ['Sum', ['Multiply', v, 'k'], limits('k')], 0],
      'If(c, sum_(k=1)^(3)(3k), 0)',
      'If(c, sum_(k=1)^(3)(3k), 0)',
    ],
    [
      'Product',
      (v) => ['If', 'c', ['Product', ['Add', v, 'k'], limits('k')], 0],
      'If(c, prod_(k=1)^(3)(k + 3), 0)',
      'If(c, prod_(k=1)^(3)(k + 3), 0)',
    ],
    [
      'a Sum whose index has the name of the variable',
      (v) => ['If', 'c', ['Sum', ['Multiply', v, 'y'], limits(v)], 0],
      'If(c, sum_(x=1)^(3)(x * y), 0)',
      'If(c, sum_(b=1)^(3)(b * y), 0)',
    ],
  ];
  for (const [label, make, inCall, inBlock] of cases) {
    test(label, async () => {
      const ce = new ComputeEngine();
      ce.declare('f', 'function');
      ce.assign(
        'f',
        ce.box(
          F(
            [
              'Block',
              ['Declare', 'r'],
              ['Assign', 'r', make('x')],
              ['Assign', 'x', 100],
              'r',
            ],
            'x'
          )
        )
      );
      const block: Json = [
        'Block',
        ['Declare', 'b'],
        ['Assign', 'b', 3],
        ['Declare', 'r'],
        ['Assign', 'r', make('b')],
        ['Assign', 'b', 100],
        'r',
      ];
      expect(ce.box(['f', 3]).evaluate().toString()).toBe(inCall);
      expect((await ce.box(['f', 3]).evaluateAsync()).toString()).toBe(inCall);
      expect(ce.box(block).evaluate().toString()).toBe(inBlock);
      expect((await ce.box(block).evaluateAsync()).toString()).toBe(inBlock);
    });
  }

  test('a nested function literal stays a closure', () => {
    const ce = new ComputeEngine();
    ce.assign('c', ce.True);
    const stored = (v: string): Json => ['If', 'c', F(['Add', 'u', v], 'u'), 0];
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          [
            'Block',
            ['Declare', 'r'],
            ['Assign', 'r', stored('x')],
            ['Assign', 'x', 100],
            'r',
          ],
          'x'
        )
      )
    );
    // The closure reads the last value of the variable: 1 + 100.
    const g = ce.box(['f', 3]).evaluate();
    expect(ce.box(['Apply', g, 1]).evaluate().toString()).toBe('101');
    const h = ce
      .box([
        'Block',
        ['Declare', 'b'],
        ['Assign', 'b', 3],
        ['Declare', 'r'],
        ['Assign', 'r', stored('b')],
        ['Assign', 'b', 100],
        'r',
      ])
      .evaluate();
    expect(ce.box(['Apply', h, 1]).evaluate().toString()).toBe('101');
  });
});

describe('row 426 fourth review: every store of a plain value copies it', () => {
  const iff = (v: string): Json => ['If', ['Greater', v, 'y'], v, 0];
  const inCall = (stmt: Json, ...after: Json[]): string => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          ['Block', ['Declare', 'r'], stmt, ['Assign', 'x', 100], ...after],
          'x'
        )
      )
    );
    return ce.box(['f', 3]).evaluate().toString();
  };

  test('Declare with a value', () => {
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          [
            'Block',
            ['Declare', 'r', "'any'", iff('x')],
            ['Assign', 'x', 100],
            'r',
          ],
          'x'
        )
      )
    );
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('If(y < 3, 3, 0)');
    // A block local, at the top level.
    expect(
      ce
        .box([
          'Block',
          ['Declare', 'b'],
          ['Assign', 'b', 3],
          ['Declare', 'r', "'any'", iff('b')],
          ['Assign', 'b', 100],
          'r',
        ])
        .evaluate()
        .toString()
    ).toBe('If(y < 3, 3, 0)');
  });

  test('a destructuring assignment', () => {
    expect(
      inCall(['Assign', ['Tuple', 'r', 's'], ['Tuple', iff('x'), 1]], 'r')
    ).toBe('If(y < 3, 3, 0)');
  });

  test('Epsil: let, an assignment and a destructuring assignment', () => {
    for (const body of [
      'let r = if x > y { x } else { 0 }; x = 100; r',
      'let r = 0; r = if x > y { x } else { 0 }; x = 100; r',
      'let r = 0; let s = 0; (r, s) := (if x > y { x } else { 0 }, 1); x = 100; r',
    ]) {
      const ce = new ComputeEngine();
      ce.declare('y', 'real');
      const result = executeEpsil(ce, `function f(x) { ${body} }\nf(3)`);
      expect(result.diagnostics).toEqual([]);
      expect(result.value.toString()).toBe('If(y < 3, {3}, {0})');
    }
  });

  test('the bound of a Sum reads the variable, not the index', () => {
    // The upper bound `x` of `Limits(x, 1, x)` is the parameter, 3.
    expect(
      inCall(
        ['Assign', 'r', ['If', 'c', ['Sum', 'x', ['Limits', 'x', 1, 'x']], 0]],
        'r'
      )
    ).toBe('If(c, sum_(x=1)^(3)(x), 0)');
  });

  test('the values of a dictionary', () => {
    expect(
      inCall(
        [
          'Assign',
          'r',
          ['Dictionary', ['KeyValuePair', "'a'", ['If', 'c', 'x', 0]]],
        ],
        'r'
      )
    ).toBe('{"a" -> If(c, 3, 0)}');
  });

  test('the target of a held assignment stays a name', () => {
    const ce = new ComputeEngine();
    const v = ce
      .box([
        'Block',
        ['Declare', 'b'],
        ['Assign', 'b', 3],
        ['Declare', 'r'],
        ['Assign', 'r', ['Hold', ['Assign', 'b', ['Add', 'b', 1]]]],
        ['Assign', 'b', 100],
        'r',
      ])
      .evaluate();
    expect(v.json).toEqual(['Hold', ['Assign', 'b', ['Add', 3, 1]]]);
  });
});

describe('row 426 fifth review: the copy at assignment', () => {
  test('a destructuring assignment is simultaneous', () => {
    // The second leaf reads `x` as it was before the statement, 3, not the
    // 100 that the first leaf writes.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          [
            'Block',
            ['Declare', 'r'],
            [
              'Assign',
              ['Tuple', 'x', 'r'],
              ['Tuple', 100, ['If', ['Greater', 'x', 'y'], 'x', 0]],
            ],
            'r',
          ],
          'x'
        )
      )
    );
    expect(ce.box(['f', 3]).evaluate().toString()).toBe('If(y < 3, 3, 0)');
  });

  test('a call whose head is a variable of the run applies the function held at the assignment', () => {
    // `g` is a parameter; `r := Hold(g(1))`, then `g` is given another
    // function. The stored call applies the first one.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign(
      'f',
      ce.box(
        F(
          [
            'Block',
            ['Declare', 'r'],
            ['Assign', 'r', ['Hold', ['g', 1]]],
            ['Assign', 'g', F(['Multiply', 1000, 'v'], 'v')],
            'r',
          ],
          'g'
        )
      )
    );
    const r = ce.box(['f', F(['Multiply', 2, 'u'], 'u')]).evaluate();
    expect(ce.box(['ReleaseHold', r]).evaluate().toString()).toBe('2');
  });

  test('a rebuilt call keeps the function its head was bound to', () => {
    // `Hold(h(b))` is built where `h` is the outer function `u ↦ 2u`. Stored
    // in a block that declares its own `h` and `b`, the `b` is replaced by
    // its value, 3, and the call still applies the outer `h`: 6, not 1000.
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(F(['Multiply', 2, 'u'], 'u')));
    const held = ce.function('Hold', [ce.function('h', [ce.symbol('b')])]);
    const block = ce.function('Block', [
      ce.box(['Declare', 'b']),
      ce.box(['Assign', 'b', 3]),
      ce.box(['Declare', 'h']),
      ce.box(['Assign', 'h', F(1000, 'u')]),
      ce.function('Assign', [ce.symbol('r'), held]),
      ce.box(['Assign', 'b', 100]),
      ce.symbol('r'),
    ]);
    const r = block.evaluate();
    expect(r.toString()).toBe('Hold(h(3))');
    expect(ce.box(['ReleaseHold', r]).evaluate().toString()).toBe('6');
  });
});

describe('row 426 sixth review: the copy at assignment', () => {
  test('a call head keeps its callable binding when a declared function shadows it', () => {
    // As in the fifth review's case, with the inner `h` declared with a
    // signature: it is a function-valued variable of the block, and the
    // held call still applies the outer `h`: 6, not 1000.
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ce.box(F(['Multiply', 2, 'u'], 'u')));
    const held = ce.function('Hold', [ce.function('h', [ce.symbol('b')])]);
    const block = ce.function('Block', [
      ce.box(['Declare', 'b']),
      ce.box(['Assign', 'b', 3]),
      ce.box(['Declare', 'h', "'(real) -> real'"]),
      ce.box(['Assign', 'h', F(1000, 'u')]),
      ce.function('Assign', [ce.symbol('r'), held]),
      ce.box(['Assign', 'b', 100]),
      ce.symbol('r'),
    ]);
    const r = block.evaluate();
    expect(r.toString()).toBe('Hold(h(3))');
    expect(ce.box(['ReleaseHold', r]).evaluate().toString()).toBe('6');
  });

  test('a shared dictionary of depth 30 is copied once per node', () => {
    // Each level holds the previous dictionary under two keys: 31 distinct
    // nodes, 2^30 paths. A walk that unfolds it does not finish.
    const ce = new ComputeEngine();
    let d = ce.box(['Dictionary', ['KeyValuePair', "'a'", 'x']]);
    for (let i = 0; i < 30; i++)
      d = ce.function('Dictionary', [
        ce.function('KeyValuePair', [ce.string('p'), d]),
        ce.function('KeyValuePair', [ce.string('q'), d]),
      ]);
    const r = ce
      .function('Block', [
        ce.box(['Declare', 'x']),
        ce.box(['Assign', 'x', 3]),
        ce.box(['Declare', 'r']),
        ce.function('Assign', [ce.symbol('r'), ce.function('Hold', [d])]),
        ce.box(['Assign', 'x', 100]),
        ce.symbol('r'),
      ])
      .evaluate();
    expect(r.operator).toBe('Hold');
    // The copy keeps the sharing, and its leaf holds the value of `x` at
    // the assignment.
    let cur = isFunction(r) ? r.op1 : r;
    let depth = 0;
    while (isDictionary(cur) && cur.get('p') !== undefined) {
      expect(cur.get('p')).toBe(cur.get('q'));
      cur = cur.get('p')!;
      depth += 1;
    }
    expect(depth).toBe(30);
    expect(cur.toString()).toBe('{"a" -> 3}');
  });
});
