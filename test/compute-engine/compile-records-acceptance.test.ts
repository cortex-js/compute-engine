/**
 * The acceptance of CE-1652 (`docs/plans/2026-11-23-ce1652-records-of-settled-fields.md`,
 * section 7): a function that builds a figure of Tycho's drawing library
 * compiles on JavaScript, and its value, or the argument that the function
 * of the host `figureDraw` receives, is the interpreter's (numbers within
 * 1e-12, structure exact). The declines are those that the rules and the
 * user decisions of the issue give, each with its reason.
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
 *  (`src/graph-paper/notebook/drawing/prelude.ts` of Tycho, version 25),
 *  copied, not imported. The bodies are Tycho's; `figureKindBox` keeps the
 *  arms of the kinds made here (`group`, `invalid`, `circle`, `label`, and
 *  the default), and `bitmap` calls a host `figureBitmapRaster` declared as
 *  Tycho declares it. */
const PRELUDE = `
const figureDefault = "default"
protocol Drawable {
  function translate(self: Self, v: ${PT}) -> Self
  function rotate(self: Self, angle: real, about: any = figureDefault) -> Self
  function rotateAbout(self: Self, angle: real, pivot: ${PT}) -> Self
  function scale(self: Self, k: any) -> Self
  function fill(self: Self, c: any) -> Self
  function stroke(self: Self, c: any, w: any = figureDefault) -> Self
  function strokeWidth(self: Self, w: real) -> Self
  function dash(self: Self, pattern: list<real>) -> Self
  function center(self: Self) -> ${PT}
}
type Figure = tuple<kind: string, geom: list, matrix: ${AF}, fillPaint: string | color | nothing, strokePaint: string | color | nothing, strokePx: real | nothing, dashPattern: list<real> | nothing, alpha: real | nothing> is Drawable {
  function translate(self: Figure, v: ${PT}) -> Figure {
    figureTransform(self, (1, 0, 0, 1, v[1], v[2]))
  }
  function rotate(self: Figure, angle: real, about: any) -> Figure {
    figureTransformAbout(self, figureRotation(angle), if about == figureDefault { figurePivot(self) } else { about })
  }
  function rotateAbout(self: Figure, angle: real, pivot: ${PT}) -> Figure {
    figureTransformAbout(self, figureRotation(angle), pivot)
  }
  function scale(self: Figure, k: any) -> Figure {
    figureTransformAbout(self, figureScaling(k), figurePivot(self))
  }
  function fill(self: Figure, c: any) -> Figure {
    if c is string || c is color {
      Figure(self.kind, self.geom, self.matrix, N(c), self.strokePaint, self.strokePx, self.dashPattern, self.alpha)
    } else {
      figureOf("invalid", ["fill: the color is a string or a color value"])
    }
  }
  function stroke(self: Figure, c: any, w: any) -> Figure {
    if !(c is string || c is color) {
      figureOf("invalid", ["stroke: the color is a string or a color value"])
    } else if w is string && w == figureDefault {
      Figure(self.kind, self.geom, self.matrix, self.fillPaint, N(c), self.strokePx, self.dashPattern, self.alpha)
    } else if w is real {
      strokeWidth(Figure(self.kind, self.geom, self.matrix, self.fillPaint, N(c), self.strokePx, self.dashPattern, self.alpha), w)
    } else {
      figureOf("invalid", ["stroke: the width is a real number of pixels"])
    }
  }
  function strokeWidth(self: Figure, w: real) -> Figure {
    Figure(self.kind, self.geom, self.matrix, self.fillPaint, self.strokePaint, N(w, 15), self.dashPattern, self.alpha)
  }
  function dash(self: Figure, pattern: list<real>) -> Figure {
    Figure(self.kind, self.geom, self.matrix, self.fillPaint, self.strokePaint, self.strokePx, N(pattern, 15), self.alpha)
  }
  function center(self: Figure) -> ${PT} {
    figureBoxCenter(figureBox(self, (1, 0, 0, 1, 0, 0)))
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
function figureApply(m: ${AF}, x: real, y: real) {
  (m[1] * x + m[3] * y + m[5], m[2] * x + m[4] * y + m[6])
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
function figureScaling(k: any) {
  match k {
    (kx, ky) => (N(kx, 15), 0, 0, N(ky, 15), 0, 0)
    _ => (N(k, 15), 0, 0, N(k, 15), 0, 0)
  }
}
function figureBox(x: any, outer: ${AF}) {
  if x is Figure {
    figureKindBox(x, figureCompose(outer, x.matrix))
  } else {
    reduce(x, (acc: any, item: any) => figureBoxUnion(acc, figureBox(item, outer)), nothing)
  }
}
function figureKindBox(fig: Figure, m: ${AF}) {
  let g = fig.geom
  match fig.kind {
    == "group" => figureBox(g, m)
    == "invalid" => nothing
    == "circle" => figureEllipseBox(m, g[1], g[2], g[3], g[3])
    == "label" => figurePointsBox(m, [g[1], g[2]])
    _ => figurePointsBox(m, g)
  }
}
function figurePointsBox(m: ${AF}, g: list) {
  if length(g) < 2 {
    nothing
  } else {
    let xs = []
    let ys = []
    let i = 1
    while i < length(g) {
      let (px, py) = figureApply(m, g[i], g[i + 1])
      xs = [...xs, px]
      ys = [...ys, py]
      i = i + 2
    }
    ((N(min(xs), 15), N(min(ys), 15)), (N(max(xs), 15), N(max(ys), 15)))
  }
}
function figureEllipseBox(m: ${AF}, cx: real, cy: real, rx: real, ry: real) {
  let (px, py) = figureApply(m, cx, cy)
  let ex = sqrt((m[1] * rx)^2 + (m[3] * ry)^2)
  let ey = sqrt((m[2] * rx)^2 + (m[4] * ry)^2)
  ((N(px - ex, 15), N(py - ey, 15)), (N(px + ex, 15), N(py + ey, 15)))
}
function figureBoxUnion(a: any, b: any) {
  match a {
    ((ax0, ay0), (ax1, ay1)) => match b {
      ((bx0, by0), (bx1, by1)) => if figureBoxFinite(b) { ((min(ax0, bx0), min(ay0, by0)), (max(ax1, bx1), max(ay1, by1))) } else { a }
      _ => a
    }
    _ => if figureBoxFinite(b) { b } else { nothing }
  }
}
function figureBoxFinite(box: any) {
  match box {
    ((x0, y0), (x1, y1)) => abs(x0) < oo && abs(y0) < oo && abs(x1) < oo && abs(y1) < oo
    _ => false
  }
}
function figureBoxCenter(box: any) {
  if box is nothing {
    (0, 0)
  } else {
    (N((box[1][1] + box[2][1]) / 2, 15), N((box[1][2] + box[2][2]) / 2, 15))
  }
}
function figurePivot(fig: Figure) {
  let (cx, cy) = figureBoxCenter(figureKindBox(fig, (1, 0, 0, 1, 0, 0)))
  figureApply(fig.matrix, cx, cy)
}
function circle(c: ${PT}, r: real) { figureOf("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)]) }
function label(p: ${PT}, text: string) { figureOf("label", [N(p[1], 15), N(p[2], 15), text]) }
function group(...items) {
  figureOf("group", listFrom(items))
}
function bitmap(...args) {
  figureBitmap(figureBitmapRaster(listFrom(args)))
}
function figureBitmap(raster: any) {
  if raster is string {
    figureOf("invalid", [raster])
  } else {
    figureOf("bitmap", raster)
  }
}
function draw(...args) -> nothing {
  figureDraw(listFrom(args))
}
`;

/** The Game of Life of Tycho's `requirements/archive/EPSIL_ANIMATION.md`
 *  § 1, with n = 12. */
const LIFE = `
let n = 12
glider(i: integer, j: integer) = (i == 1 && j == 2) || (i == 2 && j == 3) || (i == 3 && (j == 1 || j == 2 || j == 3))
let g = map(i => map(j => if glider(i, j) { 1 } else { 0 }, Range(1, n)), Range(1, n))
wrap(k: integer) = Mod(k - 1 + n, n) + 1
count(g: list, i: integer, j: integer) = sum(map(d => g[wrap(i + d[1])][wrap(j + d[2])], [(-1,-1),(-1,0),(-1,1),(0,-1),(0,1),(1,-1),(1,0),(1,1)]))
nextCell(g: list, i: integer, j: integer) = if count(g, i, j) == 3 || (count(g, i, j) == 2 && g[i][j] == 1) { 1 } else { 0 }
step(g: list) = map(i => map(j => nextCell(g, i, j), Range(1, n)), Range(1, n))
`;

/** An engine with the prelude and the functions of the host, declared as
 *  Tycho declares them (`ce-notebook-evaluator.ts`, `bitmap.ts`):
 *  `figureDraw` records the argument it receives in `received`. */
function engine(source = '') {
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
  ce.declare('figureBitmapRaster', {
    signature: '(any) -> any',
    pure: false,
    evaluate: () =>
      ce.function('List', [ce.string('data:'), ce.number(0), ce.number(0)]),
  });
  const diagnostics = executeEpsil(ce, PRELUDE + source).diagnostics.filter(
    (d) => d.severity === 'error'
  );
  if (diagnostics.length > 0)
    throw new Error(`prelude: ${JSON.stringify(diagnostics[0].message)}`);
  return { ce, received };
}

/** The function literal of the Epsil program `source` (`(t: real) => …`). */
function program(ce: ComputeEngine, source: string) {
  const r = executeEpsil(ce, source);
  const errors = r.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length > 0)
    throw new Error(`${source}: ${JSON.stringify(errors[0].message)}`);
  return r.value!;
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

/** The field names of the named tuple type of the value `v`. */
function fieldNames(v: any): string[] | undefined {
  const t = v.type.type;
  if (typeof t !== 'object' || t.kind !== 'reference') return undefined;
  const elements = t.def?.kind === 'tuple' ? t.def.elements : undefined;
  return elements?.every((x: any) => x.name !== undefined)
    ? elements.map((x: any) => x.name)
    : undefined;
}

/** The JavaScript value that `run()` gives for the interpreter's value
 *  `v`: an object for a value of a named tuple type, an array for a list or
 *  a tuple, `null` for `Nothing`. */
function hostValue(v: any): unknown {
  if (isSymbol(v, 'Nothing')) return null;
  if (isString(v)) return v.string;
  if (isNumber(v)) return v.re;
  if (isFunction(v)) {
    const items = v.ops.map(hostValue);
    if (v.operator === 'List' || v.operator === 'Tuple') return items;
    const names = fieldNames(v);
    if (names !== undefined)
      return Object.fromEntries(names.map((n, k) => [n, items[k]]));
  }
  throw new Error(`no host value for ${v.toString()}`);
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
  } else if (expected !== null && typeof expected === 'object') {
    expect(Object.keys(got as object)).toEqual(Object.keys(expected));
    for (const [k, x] of Object.entries(expected))
      expectClose((got as any)[k], x);
  } else expect(got).toBe(expected);
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

const TS = [1, -0.3, 2.5];

/** The program `source` (after the statements `before`) compiles on
 *  JavaScript and gives the interpreter's value at each value of `t`. */
function expectValueAgrees(source: string, before = '') {
  const { ce } = engine(before);
  const js = compileTo(ce, source);
  if (!js.ok) throw new Error(js.message);
  const f = program(ce, source);
  for (const t of TS) {
    const expected = ce
      .box(['Apply', f, t] as any)
      .evaluate()
      .N();
    expectClose(js.result.run(t), hostValue(expected));
  }
  return js.result;
}

/** The program `source` (after the statements `before`) compiles on
 *  JavaScript, and at each value of `t` calls `figureDraw` with the value
 *  that the interpreter passes, as often as the interpreter calls it. */
function expectHostAgrees(source: string, before = '') {
  const { ce, received } = engine(before);
  const js = compileTo(ce, source);
  if (!js.ok) throw new Error(js.message);
  expect(js.result.hostCalls).toEqual(['figureDraw']);
  const f = program(ce, source);
  for (const t of TS) {
    received.length = 0;
    ce.box(['Apply', f, t] as any).evaluate();
    const expected = [...received];
    received.length = 0;
    expect(js.result.run(t)).toBeNaN();
    expect(received.length).toBe(expected.length);
    expect(expected.length).toBeGreaterThan(0);
    expected.forEach((x, k) => expectSameValue(received[k], x));
  }
  return js.result;
}

function expectDeclines(
  source: string,
  reason: RegExp,
  to: Target = 'javascript',
  before = ''
) {
  const { ce } = engine(before);
  const r = compileTo(ce, source, to);
  expect(r.ok).toBe(false);
  expect((r as { message: string }).message).toMatch(reason);
}

/** The scene of the orbit of Tycho's `EPSIL_ANIMATION.md` § 1, built once
 *  before the callback. */
const ORBIT_SCENE = `
let sun = circle((0, 0), 0.5).fill("orange")
let earth = circle((2, 0), 0.2).fill("blue")
let orbit = circle((0, 0), 2).stroke("gray")
`;

/** The cases whose value `run()` returns. */
const VALUES = [
  '(t: real) => circle((cos(t), sin(t)), 0.2)',
  '(t: real) => circle((2, 0), 0.2).rotateAbout(t / 1000, (0, 0))',
  '(t: real) => circle((0, 0), t).fill("red").translate((1, 2))',
  '(t: real) => circle((t, 0), 1).center()',
];

/** The cases that call `draw`. */
const DRAWS = [
  '(t: real) => draw(circle((cos(t), 0), 0.1))',
  '(t: real) => draw(circle((t, 0), 1).rotate(t))',
  '(t: real) => draw(circle((t, 0), 1).scale(2))',
  '(t: real) => draw(circle((t, 0), 1).stroke("blue"))',
  '(t: real) => draw(circle((0, 0), t).fill("red").translate((1, 2)))',
  // Two records of different types (an unfilled and a filled `Figure`) in
  // one `draw`.
  '(t: real) => draw(circle((0, 0), 1), circle((t, 0), 0.5).fill("red"))',
];

describe('CE-1652 acceptance: a function that builds a figure', () => {
  test.each(VALUES)('%s', (source) => {
    expectValueAgrees(source);
  });

  test('(t: real) => circle((0, 0), t).fill(rgb(t, 0, 0)): a colour field, not given to the host', () => {
    // `run()` holds the compiled colour (the object that the compiled
    // `rgb(t, 0, 0)` gives), where the interpreter's field is
    // `Rgb(t, 0, 0)`; every other field is the interpreter's.
    const source = '(t: real) => circle((0, 0), t).fill(rgb(t, 0, 0))';
    const { ce } = engine();
    const js = compileTo(ce, source);
    const colour = compileTo(ce, '(t: real) => rgb(t, 0, 0)');
    if (!js.ok) throw new Error(js.message);
    if (!colour.ok) throw new Error(colour.message);
    const f = program(ce, source);
    for (const t of [0.25, 0.5, 1]) {
      const expected = ce
        .box(['Apply', f, t] as any)
        .evaluate()
        .N();
      if (!isFunction(expected)) throw new Error('not a figure');
      expect(expected.ops[3].json).toEqual(['Rgb', t, 0, 0]);
      const got = js.result.run(t);
      expect(got.fillPaint).toEqual(colour.result.run(t));
      expectClose(
        { ...got, fillPaint: null },
        {
          ...(hostValue(
            ce.function('Figure', [
              ...expected.ops.slice(0, 3),
              ce.symbol('Nothing'),
              ...expected.ops.slice(4),
            ])
          ) as object),
        }
      );
    }
  });

  test.each(DRAWS)('%s', (source) => {
    expectHostAgrees(source);
  });

  test('the orbit of EPSIL_ANIMATION.md § 1, the scene built once', () => {
    expectHostAgrees(
      '(t: real) => draw([orbit, sun, earth.rotateAbout(t / 1000, (0, 0))])',
      ORBIT_SCENE
    );
  });
});

describe('CE-1652 acceptance: the Game of Life state update', () => {
  test('g = step(g) compiles and equals the interpreter after a few ticks', () => {
    const tick = '(t: real) => do { g = step(g) }';
    const compiled = engine(LIFE);
    const js = compileTo(compiled.ce, tick);
    if (!js.ok) throw new Error(js.message);
    expect(js.result.assigns).toEqual(['g']);
    const interpreted = engine(LIFE);
    const f = program(interpreted.ce, tick);
    for (let k = 0; k < 5; k += 1) {
      js.result.run(16 * k);
      interpreted.ce.box(['Apply', f, 16 * k] as any).evaluate();
      expect(compiled.ce.box('g').evaluate().json).toEqual(
        interpreted.ce.box('g').evaluate().json
      );
    }
  });
});

describe('CE-1652 acceptance: declines', () => {
  // Plan section 7 expected `draw(circle(…), label(…))` and
  // `fill(rgb(…))` through `draw` to compile. The steps decline them: a
  // label's geometry `[x, y, text]` is a list of two types, which the
  // parameter `geom: list` of `figureOf` does not take (step 5), and the
  // compiled colour is in OKLCh where the interpreter keeps `Rgb(…)`, so a
  // colour is not given to the host (step 5).
  test('a label: its geometry is a list of two types', () => {
    expectDeclines(
      '(t: real) => draw(circle((0, 0), 1), label((0, 1), "a"))',
      /the parameter geom of figureOf is not a scalar \(list\)/
    );
  });

  test('a colour given to the host', () => {
    expectDeclines(
      '(t: real) => draw(circle((0, 0), t).fill(rgb(t, 0, 0)))',
      /a colour \(the compiled colour is in OKLCh/
    );
  });

  test('an if with a run-time condition whose arms give two figure types', () => {
    // The label declines first, at its geometry.
    expectDeclines(
      '(t: real) => if t > 0 { circle((t, 0), 1) } else { label((t, 0), "a") }',
      /the parameter geom of figureOf is not a scalar \(list\)/
    );
    // An unfilled and a filled circle are two record types (R3).
    expectDeclines(
      '(t: real) => if t > 0 { circle((t, 0), 1) } else { circle((t, 0), 1).fill("red") }',
      /arms of two types/
    );
  });

  test('a figure of kind group', () => {
    // Plan section 4.4 names the recursive `figureBox` of a group; the
    // compilation declines before it, at the geometry of the group, a list
    // of figures, which the parameter `geom: list` of `figureOf` does not
    // take.
    for (const source of [
      '(t: real) => draw(group(circle((t, 0), 1), circle((0, t), 1)))',
      '(t: real) => draw(group(circle((t, 0), 1), circle((0, t), 1)).rotate(t))',
      '(t: real) => group(circle((t, 0), 1)).center()',
    ])
      expectDeclines(
        source,
        /the parameter geom of figureOf is not a scalar \(list\)/
      );
  });

  test('a dash of a list of a run-time length, carried by the record', () => {
    expectHostAgrees('(t: real) => draw(circle((0, 0), 1).dash([t, 2]))');
  });

  test('the Game of Life callback that draws (user decision: Tycho splits it)', () => {
    // A call of the host in a function that assigns a variable of the
    // engine declines: Tycho compiles `g = step(g)` and interprets the
    // `draw`.
    expectDeclines(
      '(t: real) => do { g = step(g)\n draw(bitmap(g, ((0, 0), (n, n)))) }',
      /a call of the function figureBitmapRaster of the host, in a function that assigns the list variable g of the engine/,
      'javascript',
      LIFE
    );
  });

  test.each(['glsl', 'interval-js'] as const)('%s', (to) => {
    // A string declines first where the case builds a figure, a call of
    // `draw` where it draws one.
    for (const source of VALUES)
      expectDeclines(source, /a string: text compiles on javascript only/, to);
    expectDeclines(
      '(t: real) => circle((0, 0), t).fill(rgb(t, 0, 0))',
      /a string: text compiles on javascript only/,
      to
    );
    for (const source of DRAWS)
      expectDeclines(
        source,
        /a function with a rest parameter: records compile on javascript only/,
        to
      );
    expectDeclines(
      '(t: real) => draw([orbit, sun, earth.rotateAbout(t / 1000, (0, 0))])',
      /a function with a rest parameter: records compile on javascript only/,
      to,
      ORBIT_SCENE
    );
    expectDeclines(
      '(t: real) => do { g = step(g) }',
      /an assignment of g, a variable of the engine, on this target/,
      to,
      LIFE
    );
  });
});
