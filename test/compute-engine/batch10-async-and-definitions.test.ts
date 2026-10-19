import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// 1. The asynchronous evaluation threads a conditional value (`When`/`Which`)
//    out of an application of an operator that has only an `evaluateAsync`
//    handler. The lift applies the operator to the values with
//    `evaluateAsync()` on that route (`threadConditionalOperands`,
//    `boxed-expression/boxed-function.ts`), so the handler gets the value and
//    the result carries the condition. Before, the lift ran only for an
//    operator with a synchronous handler, and the handler got the `When`:
//    `AsyncOnly(1 {0<t})` gave `NaN`. An operand that becomes a list only
//    when it is evaluated (`[1, 2] {0<t}` with `t = 1`) is broadcast as for an
//    operator with a synchronous handler. Before, the handler got the whole
//    list and gave `NaN`.
//
// 2. With `g(t) := 2a(t)` defined before `a(x, y) := x + y`, the rebuild of
//    the body of `g` is a type error. `g` keeps its previous literal, so that
//    a later definition of `a` retries it, but an application of `g` gives no
//    value from that literal: `g(1)` stays `g(1)`, as when `a` is defined
//    first and the definition of `g` is refused. Before, `g(1)` gave
//    `2·(y ↦ 1 + y)`.

/** `AsyncOnly(x) = x + 5`, with only an `evaluateAsync` handler, and `Both`,
 * the same function with a synchronous handler too. */
function engine(t?: number | boolean): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('AsyncOnly', {
    broadcastable: true,
    signature: '(number) -> number',
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  });
  ce.declare('Both', {
    broadcastable: true,
    signature: '(number) -> number',
    evaluate: ([x]) => ce.number(x.re + 5),
    evaluateAsync: async ([x]) => ce.number(x.re + 5),
  });
  if (t !== undefined) ce.assign('t', t);
  return ce;
}

const POSITIVE = ['Less', 0, 't'];

/** Replace each `F` in `json` with `head`. */
function withHead(json: unknown, head: string): unknown {
  if (json === 'F') return head;
  if (Array.isArray(json)) return json.map((x) => withHead(x, head));
  return json;
}

/** [name, MathJSON with `F` for the operator, value of `evaluateAsync()` with
 * `t` free, with `t = 1`, with `t = -1`] */
const CASES: [string, unknown, string, string, string][] = [
  ['When', ['F', ['When', 1, POSITIVE]], '6 {0 < t}', '6', 'NaN'],
  [
    'Which',
    ['F', ['Which', POSITIVE, 1, 'True', 2]],
    'Which(0 < t, 6, "True", 7)',
    '6',
    '7',
  ],
  [
    'restricted list',
    ['F', ['When', ['List', 1, 2], POSITIVE]],
    '[6,7] {0 < t}',
    '[6,7]',
    '"Missing"',
  ],
  [
    'list with a restricted cell',
    ['F', ['List', 1, ['When', 2, POSITIVE]]],
    '[6,7 {0 < t}]',
    '[6,7]',
    '[6,NaN]',
  ],
  [
    'in a sum',
    ['Add', ['F', ['When', 1, POSITIVE]], 1],
    '7 {0 < t}',
    '7',
    'NaN',
  ],
  [
    'in a Sum',
    ['Sum', ['F', ['When', 'k', POSITIVE]], ['Limits', 'k', 1, 3]],
    '21 {0 < t}',
    '21',
    'NaN',
  ],
];

describe('evaluateAsync threads a conditional value out of an async-only operator', () => {
  test.each(CASES)('%s', async (_name, json, free, tPositive, tNegative) => {
    for (const [t, expected] of [
      [undefined, free],
      [1, tPositive],
      [-1, tNegative],
    ] as const) {
      const box = (head: string) =>
        engine(t).box(withHead(json, head) as MathJsonExpression);
      const async_ = (await box('AsyncOnly').evaluateAsync()).toString();
      expect([t, async_]).toEqual([t, expected]);
      // The same value as the twin with a synchronous handler, on both
      // routes.
      expect([t, box('Both').evaluate().toString()]).toEqual([t, expected]);
      expect([t, (await box('Both').evaluateAsync()).toString()]).toEqual([
        t,
        expected,
      ]);
    }
  });

  test('the synchronous route keeps the async-only application', () => {
    expect(
      engine()
        .box(['AsyncOnly', ['When', 1, POSITIVE]])
        .evaluate()
        .toString()
    ).toBe('AsyncOnly(1) {0 < t}');
    expect(
      engine()
        .box(['AsyncOnly', ['Which', POSITIVE, 1, 'True', 2]])
        .evaluate()
        .toString()
    ).toBe('Which(0 < t, AsyncOnly(1), "True", AsyncOnly(2))');
  });

  test('a boolean condition, unknown, true and false', async () => {
    for (const [t, expected] of [
      [undefined, '6 {t}'],
      [true, '6'],
      [false, 'NaN'],
    ] as const) {
      const e = engine(t).box(['AsyncOnly', ['When', 1, 't']]);
      expect([t, (await e.evaluateAsync()).toString()]).toEqual([t, expected]);
    }
  });

  test.each([
    ['\\operatorname{AsyncOnly}(1\\{0<t\\})', '6 {0 < t}'],
    ['\\operatorname{AsyncOnly}([1,2]\\{0<t\\})', '[6,7] {0 < t}'],
    ['\\operatorname{AsyncOnly}(1\\{0<t\\})+1', '7 {0 < t}'],
  ])('%s, parse route', async (tex, expected) => {
    expect((await engine().parse(tex).evaluateAsync()).toString()).toBe(
      expected
    );
  });

  test('the held result agrees with a fresh evaluation', async () => {
    const ce = engine();
    const e = ce.box(['AsyncOnly', ['When', 1, POSITIVE]]);
    const held = await e.evaluateAsync();
    expect(held.toString()).toBe('6 {0 < t}');
    ce.assign('t', 1);
    expect((await held.evaluateAsync()).toString()).toBe('6');
    expect((await e.evaluateAsync()).toString()).toBe('6');
    ce.assign('t', -1);
    expect((await held.evaluateAsync()).toString()).toBe('NaN');
    expect((await e.evaluateAsync()).toString()).toBe('NaN');
  });
});

describe('a dependent whose rebuilt body is invalid gives no value', () => {
  const A_TEX = 'a(x,y)\\coloneq x+y';
  const G_TEX = 'g(t)\\coloneq 2a(t)';
  const A_JSON = ['Assign', 'a', ['Function', ['Add', 'x', 'y'], 'x', 'y']];
  const G_JSON = [
    'Assign',
    'g',
    ['Function', ['Multiply', 2, ['a', 't']], 't'],
  ];

  const define: [string, (ce: ComputeEngine, which: 'a' | 'g') => void][] = [
    [
      'parse',
      (ce, which) => {
        ce.parse(which === 'a' ? A_TEX : G_TEX).evaluate();
      },
    ],
    [
      'box',
      (ce, which) => {
        ce.box(
          (which === 'a' ? A_JSON : G_JSON) as MathJsonExpression
        ).evaluate();
      },
    ],
  ];

  describe.each(define)('%s route', (_route, def) => {
    test.each([
      ['a then g', ['a', 'g']],
      ['g then a', ['g', 'a']],
    ] as const)('%s: g(1) stays unevaluated', async (_order, order) => {
      const ce = new ComputeEngine();
      for (const which of order) def(ce, which);
      expect(ce.parse('g(1)').evaluate().toString()).toBe('g(1)');
      expect(ce.parse('g(1)').N().toString()).toBe('g(1)');
      expect((await ce.parse('g(1)').evaluateAsync()).toString()).toBe('g(1)');
      expect(ce.box(['Apply', 'g', 1]).evaluate().toString()).toBe('g(1)');
    });
  });

  test('g keeps its literal and is retried by a later definition', () => {
    const ce = new ComputeEngine();
    ce.parse(G_TEX).evaluate();
    const held = ce.parse('g(3)');
    // Before `a` has a definition, the application of `a` is held.
    expect(held.evaluate().toString()).toBe('2a(3)');
    ce.parse(A_TEX).evaluate();
    expect(
      (ce.lookupDefinition('g') as any).operator._lambdaLiteral.toString()
    ).toBe('(t) => 2a(t)');
    // The memoized value of the earlier evaluation is not used.
    expect(held.evaluate().toString()).toBe('g(3)');
    ce.parse('a(t)\\coloneq t^2').evaluate();
    expect(held.evaluate().toString()).toBe('18');
    expect(ce.parse('g(3)').evaluate().toString()).toBe('18');
  });

  test.each([
    ['a then g', 'a(x, y) = x + y\ng(t) = 2a(t)\ng(1)'],
    ['g then a', 'g(t) = 2a(t)\na(x, y) = x + y\ng(1)'],
  ])('Epsil, %s: g(1) stays unevaluated', (_order, source) => {
    const ce = new ComputeEngine();
    const parseLatex = (latex: string): MathJsonExpression =>
      ce.parse(latex).json;
    const { value, diagnostics } = executeEpsil(ce, source, { parseLatex });
    expect(value.toString()).toBe('g(1)');
    // The type error is reported in both orders.
    expect(
      diagnostics.some(
        (d) =>
          Array.isArray(d.message) &&
          d.message[0] === 'runtime-error' &&
          d.message[3] === 'incompatible-type'
      )
    ).toBe(true);
  });
});
