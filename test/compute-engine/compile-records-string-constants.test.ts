/**
 * String constants settled in the IR type (CE-1652, step 4c;
 * `compilation/ir/README.md`, "Records").
 *
 * A string whose value is known when the code is emitted (a literal, a
 * protocol default, a field of a record made from one, a parameter whose
 * argument is one) is that value in the function lowered for it: `==` and
 * `!=` of two such strings, and `match` on such a subject, are decided at
 * compile time, and the conditional lowers only the arm taken. A program
 * that compiles without the constants keeps its code: the constants are
 * kept only in a second lowering of a program that the first declines.
 *
 * Every case is compared with the interpreter's value within 1e-12 on
 * `javascript`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { sliceProgram } from '../../src/compute-engine/compilation/ir/index';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Target = 'javascript' | 'glsl' | 'interval-js';

const PT = 'tuple<real, real>';
const AF = 'tuple<real, real, real, real, real, real>';

/** A reduced prelude of Tycho's drawing library
 *  (`src/graph-paper/notebook/drawing/prelude.ts` of Tycho, version 24),
 *  copied, not imported. It keeps Tycho's forms for `figureBox(x: any)`
 *  with `x is Figure`, `rotate(self, a, about: any = figureDefault)` with
 *  `about == figureDefault`, `scale(self, k: any)` and `scaleAbout` with
 *  `k` a number or a pair (`figureScaling`, a `match`), `dash` with `N` of
 *  a list, the matrix read by index and `fill(self, c: any)`. The pivot is
 *  the center of the box of the figure (`figureBox`), read by index: Tycho's
 *  `figureBoxCenter` matches a nested `Tuple` pattern, which declines. */
const PRELUDE = `
  const figureDefault = "default"
  protocol Drawable {
    function translate(self: Self, v: ${PT}) -> Self
    function rotate(self: Self, angle: real, about: any = figureDefault) -> Self
    function rotateAbout(self: Self, angle: real, pivot: ${PT}) -> Self
    function scale(self: Self, k: any) -> Self
    function scaleAbout(self: Self, k: any, pivot: ${PT}) -> Self
    function fill(self: Self, c: any) -> Self
    function stroke(self: Self, c: any, w: any = figureDefault) -> Self
    function strokeWidth(self: Self, w: real) -> Self
    function dash(self: Self, pattern: list<real>) -> Self
    function reflect(self: Self, axis: string) -> Self
    function skew(self: Self, ax: real, ay: real) -> Self
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
    function scaleAbout(self: Figure, k: any, pivot: ${PT}) -> Figure {
      figureTransformAbout(self, figureScaling(k), pivot)
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
    function reflect(self: Figure, axis: string) -> Figure {
      if axis == "x" {
        figureTransformAbout(self, (1, 0, 0, -1, 0, 0), figurePivot(self))
      } else if axis == "y" {
        figureTransformAbout(self, (-1, 0, 0, 1, 0, 0), figurePivot(self))
      } else {
        figureOf("invalid", ["reflect: the axis is not x or y"])
      }
    }
    function skew(self: Figure, ax: real, ay: real) -> Figure {
      figureTransformAbout(self, (1, tan(ay), tan(ax), 1, 0, 0), figurePivot(self))
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
    let (px, py) = figureApply(m, g[1], g[2])
    ((N(px, 15), N(py, 15)), (N(px, 15), N(py, 15)))
  }
  function figureEllipseBox(m: ${AF}, cx: real, cy: real, rx: real, ry: real) {
    let (px, py) = figureApply(m, cx, cy)
    let ex = sqrt((m[1] * rx)^2 + (m[3] * ry)^2)
    let ey = sqrt((m[2] * rx)^2 + (m[4] * ry)^2)
    ((N(px - ex, 15), N(py - ey, 15)), (N(px + ex, 15), N(py + ey, 15)))
  }
  function figureBoxUnion(a: any, b: any) { a }
  function figurePivot(fig: Figure) {
    let box = figureBox(fig, (1, 0, 0, 1, 0, 0))
    let cx: real = N((box[1][1] + box[2][1]) / 2, 15)
    let cy: real = N((box[1][2] + box[2][2]) / 2, 15)
    (cx, cy)
  }
  function circle(c: ${PT}, r: real) { figureOf("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)]) }
  function label(p: ${PT}, s: string) { figureOf("label", [N(p[1], 15), N(p[2], 15), s]) }
`;

function engine(prelude = PRELUDE): ComputeEngine {
  const ce = new ComputeEngine();
  const diagnostics = executeEpsil(ce, prelude).diagnostics;
  if (diagnostics.length > 0)
    throw new Error(`prelude: ${JSON.stringify(diagnostics[0].message)}`);
  return ce;
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
  if (isSymbol(v, 'True')) return true;
  if (isSymbol(v, 'False')) return false;
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

/** The program `source` compiles on JavaScript and gives the interpreter's
 *  value at each value of `t`. */
function expectAgrees(
  ce: ComputeEngine,
  source: string,
  ts: number[] = [1, -0.3, 2.5]
) {
  const js = compileTo(ce, source);
  if (!js.ok) throw new Error(js.message);
  const f = program(ce, source);
  for (const t of ts) {
    const expected = ce
      .box(['Apply', f, t] as any)
      .evaluate()
      .N();
    expectClose(js.result.run(t), hostValue(expected));
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

const MEMBERS = [
  '(t: real) => circle((t, 0), 1).rotate(t)',
  '(t: real) => circle((t, 0), 1).scale(2)',
  '(t: real) => circle((t, 0), 1).reflect("x")',
  '(t: real) => circle((t, 0), 1).skew(t, 0.5)',
  '(t: real) => circle((t, 0), 1).stroke("blue")',
];

describe("Tycho's members whose body reads a string constant", () => {
  const ce = engine();

  test.each(MEMBERS)('%s', (source) => {
    expectAgrees(ce, source);
  });
});

/** The number of user functions lowered for `source` on JavaScript, before
 *  the passes (which inline a function called once). */
function loweredFunctions(ce: ComputeEngine, source: string): number {
  const p = sliceProgram(program(ce, source) as any, {
    target: 'javascript',
    passes: false,
  });
  return p.functions.filter((f) => f.source !== undefined).length;
}

const CASES = `
  function size(fig: Figure) {
    match fig.kind {
      == "circle" => fig.geom[3]
      == "label" => fig.geom[3]
      _ => "none"
    }
  }
  function pick(s: string, x: real) {
    if s == "a" { (x, x) } else if s != "b" { "neither" } else { x }
  }
  function twice(s: any) { if s == "a" { 1 } else { 2 } }
  function again(s: string, x: real) {
    if s == "a" { if s == "a" { (x, x) } else { "no" } } else { x }
  }
  function dot(p: ${PT}) { figureOf("point", [N(p[1], 15), N(p[2], 15)]) }
  function reflectY(fig: Figure) {
    let a = "y"
    fig.reflect(a)
  }
  function countTo(fig: Figure, n: integer) {
    let k = fig.kind
    let i = 0
    while i < n {
      k = "other"
      i = i + 1
    }
    if k == "circle" { 1 } else { 2 }
  }
`;

describe('== and match of known strings', () => {
  const ce = engine(PRELUDE + CASES);

  test('match on the kind of a record: one arm lowered per kind', () => {
    expectAgrees(ce, '(t: real) => size(circle((t, 0), t))');
    expectAgrees(
      ce,
      '(t: real) => (size(circle((t, 0), t)), size(dot((t, 1))))'
    );
  });

  test('== and != of a parameter of type string', () => {
    expectAgrees(ce, '(t: real) => pick("a", t)');
    expectAgrees(ce, '(t: real) => pick("b", t)');
    expectAgrees(ce, '(t: real) => pick("c", t)');
    expectAgrees(ce, '(t: real) => (pick("a", t), pick("b", t), pick("c", t))');
  });

  test('a test repeated in one body, for two constants: no decision leaks', () => {
    // The second `s == "a"` is lowered from the memo of `value()`: its
    // decision comes with it, and is the one of the function being lowered.
    for (const source of [
      '(t: real) => (again("a", t), again("b", t))',
      '(t: real) => (again("b", t), again("a", t))',
      '(t: real) => (circle((t, 0), 1).rotate(t), twice("a"), twice("b"))',
    ])
      expectAgrees(ce, source);
  });

  test("Tycho's reflect: each axis", () => {
    for (const axis of ['"x"', '"y"'])
      expectAgrees(ce, `(t: real) => circle((t, 0), 1).reflect(${axis})`);
    // Another axis takes the arm of the invalid figure, whose `geom` is a
    // list of strings: such a list declines as a field of the result.
    expectDeclines(
      ce,
      '(t: real) => circle((t, 0), 1).reflect("z")',
      /a list of strings other than a literal/
    );
  });

  test('a local bound to a string constant', () => {
    expectAgrees(ce, '(t: real) => reflectY(circle((t, 0), 1))');
  });

  test('a string computed at run time is not known', () => {
    // The `if` of two constants with a run-time condition is a string: the
    // arms of `reflect` are two record types (the invalid figure), R3.
    expectDeclines(
      ce,
      '(t: real) => circle((t, 0), 1).reflect(if t > 0 { "x" } else { "y" })',
      /arms of two types/
    );
  });

  test('two records whose constant fields differ join as one record type', () => {
    // The stroke colours differ: the field is a string after the `if`; the
    // kind, `"circle"` in both, stays known for the `match` of `rotate`.
    expectAgrees(
      ce,
      '(t: real) => (if t > 0 { circle((t, 0), 1).stroke("blue") } else { circle((t, 0), 1).stroke("red") }).rotate(t)'
    );
  });

  test('a local of a known string written in a loop is not known', () => {
    expectAgrees(
      ce,
      '(t: real) => (circle((t, 0), 1).rotate(t), countTo(circle((t, 0), 1), 2), countTo(circle((t, 0), 1), 0))'
    );
  });
});

describe('a program that compiles without the constants keeps its code', () => {
  const ce = engine(PRELUDE + CASES);

  test('two string literals at a parameter of type any: one function', () => {
    // `==` of two strings compares at run time: the program compiles
    // without the constants, and `twice` is lowered once.
    const source = '(t: real) => twice("a") + 10 * twice("b")';
    expect(expectAgrees(ce, source).run(1)).toBe(21);
    expect(loweredFunctions(ce, source)).toBe(1);
  });

  test('a program that needs them: one function per constant', () => {
    expect(
      loweredFunctions(
        ce,
        '(t: real) => (pick("a", t), pick("b", t), pick("c", t))'
      )
    ).toBe(3);
  });

  test('a constant that no test reads is not kept: one function for two colours', () => {
    // The fill colours are known strings, but no `==` or `match` reads
    // them: the red and the blue figure are one record type.
    const two =
      '(t: real) => (circle((t, 0), 1).rotate(t), circle((0, t), 1).fill("red").rotate(t))';
    const three =
      '(t: real) => (circle((t, 0), 1).rotate(t), circle((0, t), 1).fill("red").rotate(t), circle((0, t), 2).fill("blue").rotate(t))';
    expectAgrees(ce, three);
    expect(loweredFunctions(ce, three)).toBe(loweredFunctions(ce, two));
  });
});

describe('the other targets', () => {
  const ce = engine();

  test.each(['glsl', 'interval-js'] as Target[])('%s declines', (to) => {
    expectDeclines(
      ce,
      '(t: real) => circle((t, 0), 1).rotate(t)',
      /records compile on javascript only|text compiles on javascript only/,
      to
    );
  });
});

describe('a recursive call reaches only the function of its constant', () => {
  /** `rec(s, n)`, assigned with no declaration, so that its recursive
   *  call is a free call head (the call takes the function being lowered):
   *  for `s == "a"`, a recursive call with `other`; otherwise an `if` whose
   *  arms are of two types, which declines. */
  function rec(other: string) {
    const ce = new ComputeEngine();
    ce.assign(
      'rec',
      ce.box([
        'Function',
        [
          'Block',
          [
            'If',
            ['Equal', 's', "'a'"],
            [
              'If',
              ['Greater', 'n', 0],
              ['Add', ['rec', `'${other}'`, ['Subtract', 'n', 1]], 1],
              1,
            ],
            ['If', ['Greater', 'n', 5], ['Tuple', 1, 2], ['Add', 'n', 10]],
          ],
        ],
        's',
        'n',
      ] as any)
    );
    const f = ce.box(['Function', ['Add', ['rec', "'a'", 2], 't'], 't'] as any);
    return { ce, f };
  }

  test('the same string: the function of that string', () => {
    const { ce, f } = rec('a');
    const js = compile(f as any, { to: 'javascript', fallback: false } as any);
    for (const t of [0, 0.5])
      expectClose(
        (js as any).run(t),
        ce
          .box(['Apply', f, t] as any)
          .evaluate()
          .N().re
      );
  });

  test('another string declines (it took the function of "a": 3, not 12)', () => {
    const { f } = rec('b');
    expect(() =>
      compile(f as any, { to: 'javascript', fallback: false } as any)
    ).toThrow(/an argument of rec that is not the string "a"/);
  });
});
