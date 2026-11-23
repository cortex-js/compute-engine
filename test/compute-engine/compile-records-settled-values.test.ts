/**
 * Values settled per lowered function (CE-1652, step 4b;
 * `compilation/ir/README.md`, "Records").
 *
 * A user function is lowered once per IR type of its arguments, so inside
 * one lowered function a parameter typed `any` or of no stated type has a
 * settled IR type. These operations on such a value are decided when the
 * code is emitted, with no test of a type at run time:
 *
 * - `x is T` of the parameter: from the IR type of its argument (a record
 *   by its nominal type, a string, a colour, a real or an integer by its
 *   lane);
 * - `a == b` and `a != b` of operands of two IR types that cannot hold
 *   equal values (a tuple of reals and a string): the interpreter's
 *   constant;
 * - a real, an integer or a point at such a parameter: one lowered function
 *   per IR type;
 * - `N(x, p)` of a list or a tuple of reals: the list or the tuple.
 *
 * Every case is compared with the interpreter's value within 1e-12 on
 * `javascript`.
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
    figureEllipseBox(m, g[1], g[2], g[3], g[3])
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

/** Functions of no prelude: the cases of each rule alone. */
const CASES = `
  function kindOf(x: any) {
    if x is string { 1 } else if x is real { 3 } else if x is Figure { 4 } else { 5 }
  }
  function untypedIsText(x) { if x is string { 1 } else { 2 } }
  function isInteger(x: any) { if x is integer { 1 } else { 2 } }
  function isDefault(a: any) { if a == figureDefault { 1 } else { 2 } }
  function notDefault(a: any) { if a != figureDefault { 1 } else { 2 } }
  function keep(b: any) { if b { 1 } else { 2 } }
`;

describe('x is T of a parameter of type any or of no stated type', () => {
  const ce = engine(PRELUDE + CASES);

  test("Tycho's figureBox: x is Figure, the else arm not lowered", () => {
    expectAgrees(
      ce,
      '(t: real) => figureBox(circle((t, 0), 1), (1, 0, 0, 1, 0, 2))'
    );
    expectAgrees(ce, '(t: real) => figurePivot(circle((t, 0), 1).scale(2))');
  });

  test('a string, an integer, a real, a record and a colour', () => {
    expect(expectAgrees(ce, '(t: real) => kindOf("a")').run(1)).toBe(1);
    expect(expectAgrees(ce, '(t: real) => kindOf(2)').run(1)).toBe(3);
    expect(expectAgrees(ce, '(t: real) => kindOf(t)').run(1)).toBe(3);
    expect(
      expectAgrees(ce, '(t: real) => kindOf(circle((t, 0), 1))').run(1)
    ).toBe(4);
    expect(expectAgrees(ce, '(t: real) => kindOf(rgb(t, 0, 0))').run(1)).toBe(
      5
    );
  });

  test('a string at a parameter of no stated type', () => {
    expect(expectAgrees(ce, '(t: real) => untypedIsText("a")').run(1)).toBe(1);
  });

  test('a test that the IR type does not decide declines', () => {
    // A real can hold an integer (`t = 2`).
    expectDeclines(
      ce,
      '(t: real) => isInteger(t)',
      /MatchesType of a value of type any, which neither proves nor excludes integer/
    );
    // A number at a parameter of no stated type keeps the real lane of
    // today, which does not hold the type of the argument.
    expectDeclines(
      ce,
      '(t: real) => untypedIsText(t)',
      /MatchesType of a value of type unknown/
    );
  });
});

describe('== and != of operands that cannot be equal', () => {
  const ce = engine(PRELUDE + CASES);

  test('a tuple of reals, a real or an integer and a string', () => {
    for (const arg of ['(t, 1)', 't', '2'])
      for (const f of ['isDefault', 'notDefault'])
        expectAgrees(ce, `(t: real) => ${f}(${arg})`);
    expect(expectAgrees(ce, '(t: real) => isDefault((t, 1))').run(1)).toBe(2);
    expect(expectAgrees(ce, '(t: real) => notDefault(t)').run(1)).toBe(1);
  });

  test('two strings compare at run time', () => {
    expect(expectAgrees(ce, '(t: real) => isDefault("default")').run(1)).toBe(
      1
    );
    expect(expectAgrees(ce, '(t: real) => isDefault("other")').run(1)).toBe(2);
  });

  test('one body lowered for two types decides each test in its own function', () => {
    // `isDefault` of a real (the `==` is `False`), then of a string (the
    // `==` compares at run time), in either order; and `kindOf` of a
    // string, then of a real.
    for (const source of [
      '(t: real) => isDefault(t) + 10 * isDefault("default")',
      '(t: real) => isDefault("default") + 10 * isDefault(t)',
      '(t: real) => kindOf("a") + 10 * kindOf(t) + 100 * kindOf(circle((t, 0), 1))',
    ])
      expectAgrees(ce, source);
    expect(
      expectAgrees(
        ce,
        '(t: real) => isDefault(t) + 10 * isDefault("default")'
      ).run(1)
    ).toBe(12);
  });

  test('a record and a string, which the interpreter leaves unevaluated', () => {
    const r = compileTo(ce, '(t: real) => isDefault(circle((t, 0), 1))');
    expect(r.ok).toBe(false);
  });
});

describe('a test repeated in one body keeps its decision', () => {
  // The second test is structurally equal to the first and is lowered from
  // the memo of `value()`: its decision comes with it.
  const ce = engine(
    PRELUDE +
      `
  function twice(x: any) {
    let a = if x is string { 1 } else { 2 };
    let b = if x is string { 3 } else { x + 1 };
    a + 10 * b
  }
  function negated(x: any) {
    let a = if x is string { 1 } else { 2 };
    let b = if !(x is string) { x + 1 } else { 4 };
    a + 10 * b
  }
`
  );

  test('two conditionals on x is string', () => {
    expect(expectAgrees(ce, '(t: real) => twice("a")').run(1)).toBe(31);
    expect(expectAgrees(ce, '(t: real) => twice(t)').run(1)).toBe(22);
  });

  test('!(x is string) after x is string', () => {
    expect(expectAgrees(ce, '(t: real) => negated("a")').run(1)).toBe(41);
    expect(expectAgrees(ce, '(t: real) => negated(t)').run(1)).toBe(22);
  });

  test('a string and a number in one program: no decision leaks', () => {
    for (const source of [
      '(t: real) => twice("a") + 100 * twice(t)',
      '(t: real) => twice(t) + 100 * twice("a")',
      '(t: real) => negated("a") + 100 * negated(t)',
      '(t: real) => negated(t) + 100 * negated("a")',
    ])
      expectAgrees(ce, source);
    expect(
      expectAgrees(ce, '(t: real) => twice("a") + 100 * twice(t)').run(1)
    ).toBe(2231);
  });
});

describe('a number or a point at a parameter of type any', () => {
  const ce = engine(PRELUDE + CASES);

  test("Tycho's scale and scaleAbout: k a real, an integer or a pair", () => {
    for (const k of ['t', '2', '(2, t)'])
      for (const source of [
        `(t: real) => circle((1, 0), 1).scaleAbout(${k}, (0, 1))`,
        `(t: real) => circle((1, 0), 1).scale(${k})`,
      ])
        expectAgrees(ce, source);
  });

  test('one lowered function per IR type', () => {
    expectAgrees(
      ce,
      '(t: real) => (circle((1, 0), 1).scale(t), circle((1, 0), 1).scale((2, t)))'
    );
  });

  test('a boolean declines as before', () => {
    expect(compileTo(ce, '(t: real) => keep(t > 0)').ok).toBe(false);
  });
});

describe('N(x, p) of a list or a tuple of reals', () => {
  const ce = engine(PRELUDE + CASES);

  test('is the list or the tuple', () => {
    expectAgrees(ce, '(t: real) => N([t, 2], 15)');
    expectAgrees(ce, '(t: real) => N((t, 2.5), 15)');
  });

  test("Tycho's dash: a list<real> parameter has a run-time length", () => {
    // The field of a record has a settled shape; a `list<real>` parameter
    // on JavaScript has the length of its argument at run time.
    expectDeclines(
      ce,
      '(t: real) => circle((1, 0), 1).dash([t, 2])',
      /a record with a field of a run-time length/
    );
  });
});

describe("Tycho's fill, stroke and rotate", () => {
  const ce = engine();

  test('fill of a string and of a colour', () => {
    expectAgrees(ce, '(t: real) => circle((1, 0), 1).fill("red")');
    const r = compileTo(
      ce,
      '(t: real) => circle((0, 0), t).fill(rgb(t, 0, 0))'
    );
    const colour = compileTo(ce, '(t: real) => rgb(t, 0, 0)');
    if (!r.ok || !colour.ok) throw new Error('declined');
    expect(r.result.run(0.5).fillPaint).toEqual(colour.result.run(0.5));
  });

  test('stroke with a width', () => {
    expectAgrees(ce, '(t: real) => circle((1, 0), 1).stroke("blue", 2)');
    expectAgrees(ce, '(t: real) => circle((1, 0), 1).stroke("blue", t)');
  });

  test('rotate about a point', () => {
    expectAgrees(ce, '(t: real) => circle((1, 0), 1).rotate(t, (1, 1))');
  });

  test('the default figureDefault: two strings compare at run time', () => {
    // The arms of the `if` are two record types (stroke), or a point and a
    // string (rotate): R3.
    expectDeclines(
      ce,
      '(t: real) => circle((1, 0), 1).stroke("blue")',
      /arms of two types/
    );
    expectDeclines(
      ce,
      '(t: real) => circle((1, 0), 1).rotate(t)',
      /arms of two types/
    );
  });

  test('on GLSL and interval-js', () => {
    for (const to of ['glsl', 'interval-js'] as Target[])
      expectDeclines(
        ce,
        '(t: real) => circle((1, 0), 1).scale(t)',
        /records compile on javascript only|text compiles on javascript only/,
        to
      );
  });
});
