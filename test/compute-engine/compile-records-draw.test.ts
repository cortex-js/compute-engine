/**
 * Figures drawn through a function of the host (CE-1652, steps 5 and 6;
 * `compilation/ir/README.md`, "Records").
 *
 * A rest parameter (`function draw(...args)`) is bound, at each call, to
 * the record of the arguments from its position: the `Tuple` that the
 * interpreter binds. `ListFrom` of it is the `List` of its fields. A
 * function of the host takes a record, a colour or `Nothing` as an
 * argument: the code converts it to the engine's value, the application of
 * the constructor of its type for a record of a named tuple type. A user
 * function whose value is the `Nothing` of a function of the host is read
 * only as the value of the root, as the call of the host is.
 *
 * Each case is compiled on `javascript`, and the argument that the host
 * receives equals the interpreter's within 1e-12 (the acceptance of
 * `docs/plans/2026-11-23-ce1652-records-of-settled-fields.md`, section 7).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';
import type { Expression } from '../../src/compute-engine/global-types';

type Target = 'javascript' | 'glsl' | 'interval-js';

const PT = 'tuple<real, real>';
const AF = 'tuple<real, real, real, real, real, real>';

/** A reduced prelude of Tycho's drawing library
 *  (`src/graph-paper/notebook/drawing/prelude.ts` of Tycho), copied, not
 *  imported: the type `Figure`, the protocol `Drawable` with `translate`,
 *  `rotateAbout` and `fill`, the functions on the matrix, `circle`,
 *  `label`, `group`, and `draw` over the host's `figureDraw`. */
const PRELUDE = `
  protocol Drawable {
    function translate(self: Self, v: ${PT}) -> Self
    function rotateAbout(self: Self, angle: real, pivot: ${PT}) -> Self
    function fill(self: Self, c: any) -> Self
  }
  type Figure = tuple<kind: string, geom: list, matrix: ${AF}, fillPaint: string | color | nothing, strokePaint: string | color | nothing, strokePx: real | nothing, dashPattern: list<real> | nothing, alpha: real | nothing> is Drawable {
    function translate(self: Figure, v: ${PT}) -> Figure {
      figureTransform(self, (1, 0, 0, 1, v[1], v[2]))
    }
    function rotateAbout(self: Figure, angle: real, pivot: ${PT}) -> Figure {
      figureTransformAbout(self, figureRotation(angle), pivot)
    }
    function fill(self: Figure, c: any) -> Figure {
      if c is string || c is color {
        Figure(self.kind, self.geom, self.matrix, N(c), self.strokePaint, self.strokePx, self.dashPattern, self.alpha)
      } else {
        figureOf("invalid", ["fill: the color is a string or a color value"])
      }
    }
  }
  function figureOf(kind: string, geom: list) {
    Figure(kind, geom, (1, 0, 0, 1, 0, 0), nothing, nothing, nothing, nothing, nothing)
  }
  function figureCompose(p: ${AF}, q: ${AF}) {
    (
      N(p[1] * q[1] + p[3] * q[2], 15), N(p[2] * q[1] + p[4] * q[2], 15),
      N(p[1] * q[3] + p[3] * q[4], 15), N(p[2] * q[3] + p[4] * q[4], 15),
      N(p[1] * q[5] + p[3] * q[6] + p[5], 15), N(p[2] * q[5] + p[4] * q[6] + p[6], 15)
    )
  }
  function figureTransform(fig: Figure, t: ${AF}) {
    Figure(fig.kind, fig.geom, figureCompose(t, fig.matrix), fig.fillPaint, fig.strokePaint, fig.strokePx, fig.dashPattern, fig.alpha)
  }
  function figureTransformAbout(fig: Figure, t: ${AF}, p: ${PT}) {
    let px: real = N(p[1], 15)
    let py: real = N(p[2], 15)
    figureTransform(fig, (t[1], t[2], t[3], t[4], px - t[1] * px - t[3] * py, py - t[2] * px - t[4] * py))
  }
  function figureRotation(angle: real) {
    let co: real = N(cos(angle), 15)
    let si: real = N(sin(angle), 15)
    (co, si, -si, co, 0, 0)
  }
  function circle(c: ${PT}, r: real) { figureOf("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)]) }
  function label(p: ${PT}, s: string) { figureOf("label", [N(p[1], 15), N(p[2], 15), s]) }
  function group(...items) { figureOf("group", listFrom(items)) }
  function draw(...args) { figureDraw(listFrom(args)) }
`;

/** Programs over the prelude: a fixed parameter before a rest parameter,
 *  a rest parameter read at a constant index and by `Length`, and
 *  functions whose value is the `Nothing` of `draw`. */
const CASES = `
  function tagged(name: string, ...xs) { figureDraw(listFrom(xs)) }
  function second(...xs) { xs[2] }
  function count(...xs) { length(xs) }
  function show(x) { draw(x) }
  function twice(x, y) {
    draw(x)
    draw(y)
  }
  function pass(x: any) { figureDraw(x) }
  function tupleThenList(t: real) {
    pass((t, "a"))
    pass([t, "a"])
  }
`;

/** An engine with the prelude and the cases, and the arguments that the
 *  host's `figureDraw` receives, in order. */
function engine(): { ce: ComputeEngine; drawn: Expression[] } {
  const ce = new ComputeEngine();
  const drawn: Expression[] = [];
  ce.declare('figureDraw', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: (ops) => {
      drawn.push(ops[0]);
      return ce.symbol('Nothing');
    },
  });
  const diagnostics = executeEpsil(ce, PRELUDE + CASES).diagnostics;
  if (diagnostics.length > 0)
    throw new Error(`prelude: ${JSON.stringify(diagnostics[0].message)}`);
  return { ce, drawn };
}

/** The function literal of the Epsil program `source` (`(t: real) => …`). */
function program(ce: ComputeEngine, source: string) {
  return executeEpsil(ce, source).value;
}

function compileTo(
  ce: ComputeEngine,
  source: string,
  to: Target = 'javascript'
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(
      program(ce, source) as any,
      { to, fallback: false } as any
    );
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

/** The value `x` of the engine as plain data: a number, `{ s }` for a
 *  string, a symbol's name, `[head, ...operands]` for a function. */
function plain(x: Expression): unknown {
  if (isNumber(x)) return x.re;
  if (isString(x)) return { s: x.string };
  if (isSymbol(x)) return x.symbol;
  if (isFunction(x)) return [x.operator, ...x.ops.map(plain)];
  throw new Error(`no plain value for ${x.toString()}`);
}

/** `got` is `expected`, numbers within 1e-12. */
function expectClose(got: unknown, expected: unknown) {
  if (typeof expected === 'number') {
    expect(typeof got).toBe('number');
    expect(Math.abs((got as number) - expected)).toBeLessThanOrEqual(1e-12);
  } else if (Array.isArray(expected)) {
    expect(Array.isArray(got)).toBe(true);
    expect((got as unknown[]).length).toBe(expected.length);
    expected.forEach((x, k) => expectClose((got as unknown[])[k], x));
  } else expect(got).toEqual(expected);
}

/** The program `source` compiles on JavaScript, and at each value of `t`
 *  the host receives the arguments that the interpreter gives it. */
function expectDrawsAgree(
  { ce, drawn }: ReturnType<typeof engine>,
  source: string,
  ts: number[] = [1, -0.3, 2.5]
) {
  const js = compileTo(ce, source);
  if (!js.ok) throw new Error(js.message);
  const f = program(ce, source);
  for (const t of ts) {
    drawn.length = 0;
    ce.box(['Apply', f, t] as any).evaluate();
    const expected = drawn.map(plain);
    drawn.length = 0;
    js.result.run(t);
    const got = drawn.map(plain);
    expect(expected.length).toBeGreaterThan(0);
    expectClose(got, expected);
  }
  return js.result;
}

function expectDeclines(
  ce: ComputeEngine,
  source: string,
  reason: RegExp,
  to: Target = 'javascript'
) {
  const r = compileTo(ce, source, to);
  expect(r.ok).toBe(false);
  expect((r as { message: string }).message).toMatch(reason);
}

const DRAWS = [
  '(t: real) => draw(circle((cos(t), 0), 0.1))',
  // Two records of different types in one call.
  '(t: real) => draw(circle((0, 0), 1), label((0, t), "a"))',
  '(t: real) => draw(circle((0, 0), t).fill("red").translate((1, 2)))',
  '(t: real) => draw(circle((2, 0), 0.2).rotateAbout(t / 1000, (0, 0)))',
  // A list of records, a group, and no argument.
  '(t: real) => draw([circle((t, 0), 1), circle((0, t), 2)])',
  '(t: real) => draw(group(circle((t, 0), 1), label((0, 1), "b")))',
  '(t: real) => draw()',
  // A fixed parameter before the rest parameter.
  '(t: real) => tagged("x", t, circle((0, 0), 1))',
  // A user function whose value is the Nothing of draw, and one that
  // draws twice.
  '(t: real) => show(circle((t, 0), 1))',
  '(t: real) => twice(circle((t, 0), 1), label((t, 1), "c"))',
  // A record of no names, a Tuple, given to the host directly.
  '(t: real) => figureDraw((t, "a"))',
];

describe('figures drawn through a function of the host', () => {
  const e = engine();

  test.each(DRAWS)('%s', (source) => {
    expectDrawsAgree(e, source);
  });

  test('a figure returned by the root', () => {
    const source = '(t: real) => circle((cos(t), sin(t)), 0.2)';
    const r = compileTo(e.ce, source);
    if (!r.ok) throw new Error(r.message);
    const f = program(e.ce, source);
    for (const t of [1, -0.3]) {
      const expected = plain(
        e.ce.box(['Apply', f, t] as any).evaluate()
      ) as unknown[];
      // The interpreter's `Figure(…)` as the object of `run()`: its
      // operands in the order of the fields, `Nothing` as `null`, a list
      // or a tuple as an array.
      const fields = (x: unknown): unknown =>
        x === 'Nothing'
          ? null
          : Array.isArray(x)
            ? x.slice(1).map(fields)
            : typeof x === 'object' && x !== null && 's' in x
              ? (x as { s: string }).s
              : x;
      expectClose(Object.values(r.result.run(t)), fields(expected));
    }
  });

  test('one function given a Tuple and then a List of the same fields', () => {
    expectDrawsAgree(e, '(t: real) => tupleThenList(t)');
  });

  test('a rest parameter read at a constant index', () => {
    const r = compileTo(e.ce, '(t: real) => second(1, t)');
    if (!r.ok) throw new Error(r.message);
    expect(r.result.run(2.5)).toBe(2.5);
  });
});

describe('declines', () => {
  const { ce } = engine();

  test('a value Nothing that is read', () => {
    expectDeclines(
      ce,
      '(t: real) => [show(circle((t, 0), 1))]',
      /whose value Nothing \(of a function of the host\) is read/
    );
  });

  test('an if whose arms give a circle and a label', () => {
    expectDeclines(
      ce,
      '(t: real) => draw(if t > 0 { circle((0, 0), 1) } else { label((0, 0), "a") })',
      /arms of two types/
    );
  });

  test('a colour, which the code holds in OKLCh, given to the host', () => {
    // The interpreter gives the host `Rgb(t, 0, 0)`.
    expectDeclines(
      ce,
      '(t: real) => draw(circle((0, 0), t).fill(rgb(t, 0, 0)))',
      /no complex or colour field/
    );
    expectDeclines(ce, '(t: real) => figureDraw(rgb(t, 0, 0))', /colour/);
  });

  test('a list argument of the host', () => {
    expectDeclines(
      ce,
      '(t: real) => figureDraw([t, 2])',
      /an argument of type list<real\^2>/
    );
  });

  test('a rest parameter read by Length', () => {
    expectDeclines(ce, '(t: real) => count(1, t)', /a scalar where a list/);
  });

  test('on GLSL and interval-js', () => {
    for (const to of ['glsl', 'interval-js'] as Target[])
      for (const source of [
        ...DRAWS,
        '(t: real) => circle((cos(t), sin(t)), 0.2)',
      ])
        expect(compileTo(ce, source, to).ok).toBe(false);
  });
});
