/**
 * Rest parameters and the host boundary (CE-1652, step 5;
 * `compilation/ir/README.md`, "Records").
 *
 * A call of a user function whose one parameter is a rest parameter
 * (`function draw(...args) -> nothing { figureDraw(listFrom(args)) }`)
 * binds it to the record of the arguments of the call; `ListFrom(args)` is
 * that record, which a function of the host takes. The compiled code makes
 * the engine's value of a record, a list or a tuple before it calls the
 * host function (`boxValue()` of `print-js.ts`): the host receives the
 * value that the interpreter passes, its numbers within 1e-12 (an `N(x, 15)`
 * of the interpreter keeps 15 digits, the compiled code the double).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isFunction,
  isNumber,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

type Target = 'javascript' | 'glsl' | 'interval-js';

/** A reduced prelude of Tycho's drawing library (version 25 of
 *  `src/graph-paper/notebook/drawing/prelude.ts` of Tycho): the type
 *  `Figure`, a part of the protocol `Drawable`, `circle`, and `draw`, whose
 *  rest parameter is passed to the function of the host `figureDraw`. */
const PRELUDE = `
  const figureDefault = "default"
  protocol Drawable {
    function translate(self: Self, d: tuple<real, real>) -> Self
    function rotate(self: Self, angle: real, about: any = figureDefault) -> Self
    function fill(self: Self, c: any) -> Self
  }
  type Figure = tuple<kind: string, geom: list, matrix: tuple<real, real, real, real, real, real>, fillPaint: string | color | nothing, strokePaint: string | color | nothing, strokePx: real | nothing, dashPattern: list<real> | nothing, alpha: real | nothing> is Drawable {
    function translate(self: Figure, d: tuple<real, real>) -> Figure {
      figureTransform(self, (1, 0, 0, 1, d[1], d[2]))
    }
    function rotate(self: Figure, angle: real, about: any) -> Figure {
      figureTransformAbout(self, figureRotation(angle), if about == figureDefault { (0, 0) } else { about })
    }
    function fill(self: Figure, c: any) -> Figure {
      if c is string || c is color {
        Figure(self.kind, self.geom, self.matrix, N(c), self.strokePaint, self.strokePx, self.dashPattern, self.alpha)
      } else {
        figureOf("invalid", ["fill: the color is a string or a color value"])
      }
    }
  }
  type Label = tuple<text: string, at: tuple<real, real>> is Drawable {
    function translate(self: Label, d: tuple<real, real>) -> Label { Label(self.text, (self.at[1] + d[1], self.at[2] + d[2])) }
    function rotate(self: Label, angle: real, about: any) -> Label { self }
    function fill(self: Label, c: any) -> Label { self }
  }
  function figureOf(kind: string, geom: list) {
    Figure(kind, geom, (1, 0, 0, 1, 0, 0), nothing, nothing, nothing, nothing, nothing)
  }
  function figureCompose(p: tuple<real, real, real, real, real, real>, q: tuple<real, real, real, real, real, real>) {
    (
      N(p[1] * q[1] + p[3] * q[2], 15), N(p[2] * q[1] + p[4] * q[2], 15),
      N(p[1] * q[3] + p[3] * q[4], 15), N(p[2] * q[3] + p[4] * q[4], 15),
      N(p[1] * q[5] + p[3] * q[6] + p[5], 15), N(p[2] * q[5] + p[4] * q[6] + p[6], 15)
    )
  }
  function figureTransform(fig: Figure, t: tuple<real, real, real, real, real, real>) {
    Figure(fig.kind, fig.geom, figureCompose(t, fig.matrix), fig.fillPaint, fig.strokePaint, fig.strokePx, fig.dashPattern, fig.alpha)
  }
  function figureTransformAbout(fig: Figure, t: tuple<real, real, real, real, real, real>, p: tuple<real, real>) {
    figureTransform(fig, (t[1], t[2], t[3], t[4], p[1] - t[1] * p[1] - t[3] * p[2], p[2] - t[2] * p[1] - t[4] * p[2]))
  }
  function figureRotation(angle: real) {
    (N(cos(angle), 15), N(sin(angle), 15), -N(sin(angle), 15), N(cos(angle), 15), 0, 0)
  }
  function circle(c: tuple<real, real>, r: real) {
    figureOf("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)])
  }
  function label(p: tuple<real, real>, text: string) {
    figureOf("label", [N(p[1], 15), N(p[2], 15), text])
  }
  function draw(...args) -> nothing {
    figureDraw(listFrom(args))
  }
  const pair = (1, "a")
  function same(x) { x }
  function count(...args) { length(args) }
  function second(...args) -> nothing { figureDraw(args[2]) }
  function whole(...args) -> nothing { figureDraw(args) }
  function plus(...args) -> nothing { figureDraw(listFrom(args) + 1) }
  function twoKinds(t: real) -> nothing {
    draw(circle((t, 0), 1))
    draw(t, "a")
    draw(circle((0, t), 2))
  }
  function twice(t: real) -> nothing {
    draw(circle((t, 0), 1))
    draw(circle((0, t), 2))
  }
  function branch(t: real) -> nothing {
    if t > 0 { draw(circle((t, 0), 1)) } else { figureDraw(t) }
  }
  function repeat(t: real) -> nothing {
    for i in 1..3 { figureDraw(i * t) }
  }
  function assigns(t: real) -> nothing {
    let x = t
    x = t + 1
  }
  function readsT(t: real) -> nothing { figureDraw(t); t }
  type P = tuple<x: real, y: real>
  protocol Shown { function show(self: Self) -> nothing }
  type P is Shown { function show(self: P) -> nothing { figureDraw(self.x) } }
`;

/** An engine with the prelude and the functions of the host, declared as
 *  Tycho declares them (`ce-notebook-evaluator.ts`): each records the
 *  argument it receives in `received`. */
function engine() {
  const ce = new ComputeEngine();
  const received: Expression[] = [];
  ce.declare('figureDraw', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      received.push(ops[0]);
      return ce.symbol('Nothing');
    },
  });
  ce.declare('figureAny', {
    signature: '(any) -> any',
    pure: false,
    evaluate: (ops) => ops[0],
  });
  const diagnostics = executeEpsil(ce, PRELUDE).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (diagnostics.length > 0)
    throw new Error(`prelude: ${JSON.stringify(diagnostics[0].message)}`);
  return { ce, received };
}

/** The function literal of the Epsil program `source` (`(t: real) => …`). */
function program(ce: ComputeEngine, source: string) {
  return executeEpsil(ce, source).value!;
}

function compileTo(
  ce: ComputeEngine,
  source: string,
  to: Target = 'javascript'
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(
      program(ce, source) as any,
      {
        to,
        fallback: false,
      } as any
    );
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** `got` is `expected`: the same operators, strings and symbols, and
 *  numbers within 1e-12. */
function expectSameValue(got: Expression, expected: Expression) {
  if (isNumber(expected)) {
    expect(isNumber(got)).toBe(true);
    expect(Math.abs(got.re - expected.re)).toBeLessThanOrEqual(1e-12);
    expect(Math.abs(got.im - expected.im)).toBeLessThanOrEqual(1e-12);
  } else if (isFunction(expected)) {
    expect(isFunction(got) && got.operator).toBe(expected.operator);
    expect((got as typeof expected).nops).toBe(expected.nops);
    expected.ops.forEach((x, k) =>
      expectSameValue((got as typeof expected).ops[k], x)
    );
  } else expect(got.isSame(expected)).toBe(true);
}

/** The program `source` compiles on JavaScript, and at each value of `t`
 *  calls the host function with the value that the interpreter passes, as
 *  often as the interpreter calls it. */
function expectHostAgrees(source: string, ts: number[] = [1, -0.3, 2.5]) {
  const { ce, received } = engine();
  const js = compileTo(ce, source);
  if (!js.ok) throw new Error(js.message);
  expect(js.result.hostCalls).toEqual(['figureDraw']);
  const f = program(ce, source);
  for (const t of ts) {
    received.length = 0;
    ce.box(['Apply', f, t] as any).evaluate();
    const expected = [...received];
    received.length = 0;
    expect(js.result.run(t)).toBeNaN();
    expect(received.length).toBe(expected.length);
    expected.forEach((x, k) => expectSameValue(received[k], x));
  }
  return { ce, received, result: js.result };
}

function expectDeclines(
  source: string,
  reason: RegExp,
  to: Target = 'javascript'
) {
  const { ce } = engine();
  const r = compileTo(ce, source, to);
  expect(r.ok).toBe(false);
  expect((r as { message: string }).message).toMatch(reason);
}

const WITNESSES = [
  // The witness of CE-1652.
  '(t: real) => draw(circle((cos(t), 0), 0.1))',
  // Two records of different types in one call: an unfilled and a filled
  // `Figure`.
  '(t: real) => draw(circle((0, 0), 1), circle((t, 0), 0.5).fill("red"))',
  // A protocol member on the way.
  '(t: real) => draw(circle((t, 0), 1).rotate(t))',
  '(t: real) => draw(circle((0, 0), t).fill("red").translate((1, 2)))',
  // Records of two nominal types.
  '(t: real) => draw(circle((0, 0), 1), Label("a", (t, 0)).translate((1, 2)))',
  // A list and a tuple of numbers, a string, and no argument.
  '(t: real) => draw([t, 2 * t], (t, 1), "s")',
  '(t: real) => draw()',
  // Two calls, in the order of the program, in a function of result
  // nothing.
  '(t: real) => twice(t)',
  // A record, a list and a tuple given to the host function directly.
  '(t: real) => figureDraw(circle((t, 0), 1).rotate(t))',
  '(t: real) => figureDraw([t, 2 * t])',
  '(t: real) => figureDraw([(t, 1), (2, t)])',
  // A `Tuple` and a `List` literal of several types, and a list of figures.
  '(t: real) => figureDraw((t, "a"))',
  '(t: real) => figureDraw([t, "a"])',
  '(t: real) => draw([circle((t, 0), 1), circle((0, t), 1)])',
  // A lazy collection given to the host function directly: the interpreter
  // passes the `List` of its elements, as the code does (CE-1807).
  '(t: real) => figureDraw(reverse([1, t]))',
  '(t: real) => figureDraw([1, t] + 1)',
];

describe('a function with a rest parameter that calls the host', () => {
  test.each(WITNESSES)('%s', (source) => {
    expectHostAgrees(source);
  });

  test('the host receives a List of the figures', () => {
    const { received } = expectHostAgrees(WITNESSES[0], [1]);
    const x = received[0];
    expect(isFunction(x, 'List') && x.ops[0].operator).toBe('Figure');
    expect(x.json && JSON.stringify((x as any).ops[0].ops[1].ops[0].json)).toBe(
      JSON.stringify(Math.cos(1))
    );
  });

  test('a function with a rest parameter is lowered once per type of the arguments of a call', () => {
    const { result } = expectHostAgrees('(t: real) => twoKinds(t)');
    const code: string = result.code;
    // Two types of arguments: two lowered `draw`, each with its call of
    // the host.
    expect(code.match(/const u\d+_draw =/g)?.length).toBe(2);
    expect(code).toMatch(/_SYS\.hosts\[1\]/);
    expect(code).not.toMatch(/_SYS\.hosts\[2\]/);
  });

  test('Length and At of the rest parameter', () => {
    const { ce } = engine();
    const source = '(t: real) => count(t, "a", circle((t, 0), 1))';
    const js = compileTo(ce, source);
    if (!js.ok) throw new Error(js.message);
    expect(js.result.run(2)).toBe(3);
    expectHostAgrees('(t: real) => second(t, circle((t, 0), 1))');
    // The rest parameter given whole: the Tuple of the arguments, to
    // which the interpreter binds it.
    expectHostAgrees('(t: real) => whole(t, circle((t, 0), 1))');
  });
});

describe('a rest parameter or a host argument that declines', () => {
  test('a read of the rest parameter other than ListFrom or At', () => {
    expectDeclines('(t: real) => plus(t, 2)', /Add of List\(real, integer\)/);
  });

  test('a lazy collection of the interpreter', () => {
    // The interpreter passes `List(Range(1, 3, 1))`: a `Range` in the list
    // of the arguments of `draw` stays a range, which the code holds as the
    // array of its elements.
    expectDeclines('(t: real) => draw(1..3)', /lazy collection/);
    // The elements of the `Range` share their value with the literal.
    expectDeclines('(t: real) => draw([1, 2, 3], 1..3)', /lazy collection/);
    // A function lowered for a list literal, called again with a `Range`.
    expectDeclines(
      '(t: real) => draw(same([1, 2, 3]), same(1..3))',
      /lazy collection/
    );
  });

  test('a record of no names (a Tuple or a List of several types)', () => {
    // A constant: the lowering reads its value, not a literal of the
    // program.
    expectDeclines('(t: real) => figureDraw(pair)', /a record of no names/);
  });

  test("Tycho's label: its geometry, a list of two types, at the parameter geom: list of figureOf (CE-1921)", () => {
    expectHostAgrees('(t: real) => draw(label((t, 0), "a"))');
  });

  test('a colour, which the code holds in OKLCh', () => {
    expectDeclines(
      '(t: real) => draw(circle((0, 0), 1).fill(rgb(t / 4, 0, 0)))',
      /a colour/
    );
  });

  test('a value of the static type Nothing that is read', () => {
    expectDeclines(
      '(t: real) => [draw(circle((t, 0), 1))]',
      /whose value Nothing is read/
    );
  });

  test('a function of the host of result any', () => {
    expectDeclines(
      '(t: real) => figureAny(circle((t, 0), 1))',
      /of type any|not real, integer, boolean or nothing/
    );
  });

  test.each(['glsl', 'interval-js'] as const)('%s', (to) => {
    for (const source of WITNESSES.slice(0, 3))
      expectDeclines(
        source,
        /a function with a rest parameter: records compile on javascript only|records compile on javascript only/,
        to
      );
  });
});

describe('a function of declared result nothing', () => {
  test('a recursive call whose value Nothing is read declines', () => {
    // The interpreter stops at the error of `y + 1` after one host call.
    // `rec3` is declared in an engine of its own: after another statement
    // of the same program, its declaration is refused (see the issue filed
    // with CE-1652 step 5).
    const ce = new ComputeEngine();
    ce.declare('figureDraw', {
      signature: '(any) -> nothing',
      pure: false,
      evaluate: () => ce.symbol('Nothing'),
    });
    expect(
      executeEpsil(
        ce,
        'function rec3(t: real) -> nothing { if t > 0 { let y = rec3(t - 1)\n figureDraw(y + 1) } else { figureDraw(0) } }'
      ).diagnostics
    ).toEqual([]);
    const r = compileTo(ce, '(t: real) => rec3(t)');
    expect(r.ok).toBe(false);
    expect((r as { message: string }).message).toMatch(
      /a call of rec3, whose value Nothing is read/
    );
  });
  // Its value is `Nothing` (NaN in the code) after the effects of its body,
  // whatever the body computes.
  test('a body that ends in an assignment', () => {
    // The interpreter gives `Nothing`, not the value assigned.
    const { ce } = engine();
    const f = ce.box(['Function', ['assigns', 't'], 't']);
    expect(
      ce
        .box(['Apply', f, 2] as any)
        .evaluate()
        .isSame(ce.Nothing)
    ).toBe(true);
    const r: any = compile(
      f as any,
      {
        to: 'javascript',
        fallback: false,
      } as any
    );
    expect(r.run(2)).toBeNaN();
  });

  test('a body that ends in a value that is not Nothing declines', () => {
    // The interpreter gives an `incompatible-type` error.
    const { ce } = engine();
    const v = ce.box(['readsT', 2]).evaluate();
    expect(v.operator).toBe('Error');
    expectDeclines(
      '(t: real) => readsT(t)',
      /a body of readsT whose value is not Nothing/
    );
  });

  test('a body that ends in an If or a loop of calls of the host', () => {
    expectHostAgrees('(t: real) => branch(t)');
    expectHostAgrees('(t: real) => repeat(t)');
  });

  test('a dispatched method of result nothing', () => {
    expectHostAgrees('(t: real) => P(t, 1).show()');
  });

  test('a dispatched method of result nothing whose value is read declines', () => {
    // Before and after a call whose value is not read.
    const { ce } = engine();
    const show = (y: number) => ['show', ['P', 't', y]];
    for (const body of [
      ['Block', show(1), ['List', show(2)]],
      ['Block', ['List', show(2)], show(1)],
    ]) {
      expect(() =>
        compile(
          ce.box(['Function', body, 't'] as any) as any,
          {
            to: 'javascript',
            fallback: false,
          } as any
        )
      ).toThrow(/a call of show, whose value Nothing is read/);
    }
  });
});
