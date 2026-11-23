/**
 * Protocol methods on records, dispatched at compile time (CE-1652, step 4;
 * `compilation/ir/README.md`, "Records").
 *
 * A call of a protocol member whose first operand is a record of a named
 * type `T` calls the one implementation that the interpreter selects for
 * every value of `T`: exactly one conformance edge overlaps `T`, its
 * target holds `T`, it is not conditional and its implementation is an
 * Epsil function. The implementation is lowered as a user function, once
 * per record type, and a parameter that the call leaves out takes the
 * default of the requirement, as the interpreter fills it. Every other call
 * declines.
 *
 * Every case is compared with the interpreter's value within 1e-12 on
 * `javascript`; GLSL and `interval-js` decline a record.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  implementationLiteralAt,
  protocolDispatchCandidates,
} from '../../src/compute-engine/engine-protocols';
import {
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../../src/compute-engine/boxed-expression/type-guards';

type Target = 'javascript' | 'glsl' | 'interval-js';

/** A reduced prelude of Tycho's drawing library
 *  (`src/graph-paper/notebook/drawing/prelude.ts` of Tycho): the type
 *  `Figure`, the protocol `Drawable`, and the functions on the matrix that
 *  implement it. `rotate` is Tycho's, with its default `figureDefault`. */
const PRELUDE = `
  const figureDefault = "default"
  const figureScale = 2
  protocol Drawable {
    /// Moves the figure by the vector \`d\`.
    function translate(self: Self, d: tuple<real, real>) -> Self
    /// Rotates the figure by \`angle\` radians about the point \`about\`.
    function rotateAbout(self: Self, angle: real, about: tuple<real, real>) -> Self
    /// Rotates the figure by \`angle\` radians: about the origin, or about the point \`about\` when given.
    function rotate(self: Self, angle: real, about: any = figureDefault) -> Self
    /// Fills the figure with \`paint\`.
    function fill(self: Self, paint: any) -> Self
    /// Draws the outline in \`paint\`, the constant \`figureDefault\` when not given.
    function stroke(self: Self, paint: any = figureDefault) -> Self
    /// Scales the figure by \`k\` about the origin, by \`figureScale\` when not given.
    function grow(self: Self, k: real = figureScale) -> Self
    /// Sets the opacity to the product of the two numbers of \`pattern\`.
    function fade(self: Self, pattern: list<real>) -> Self
  }
  type Figure = tuple<kind: string, geom: list, matrix: tuple<real, real, real, real, real, real>, fillPaint: string | color | nothing, strokePaint: string | color | nothing, strokePx: real | nothing, dashPattern: list<real> | nothing, alpha: real | nothing> is Drawable {
    function translate(self: Figure, d: tuple<real, real>) -> Figure {
      figureTransform(self, (1, 0, 0, 1, d[1], d[2]))
    }
    function rotateAbout(self: Figure, angle: real, about: tuple<real, real>) -> Figure {
      figureTransformAbout(self, figureRotation(angle), about)
    }
    function rotate(self: Figure, angle: real, about: any) -> Figure {
      figureTransformAbout(self, figureRotation(angle), if about == figureDefault { (0, 0) } else { about })
    }
    function fill(self: Figure, paint: any) -> Figure {
      Figure(self.kind, self.geom, self.matrix, paint, self.strokePaint, self.strokePx, self.dashPattern, self.alpha)
    }
    function stroke(self: Figure, paint: any) -> Figure {
      Figure(self.kind, self.geom, self.matrix, self.fillPaint, paint, self.strokePx, self.dashPattern, self.alpha)
    }
    function grow(self: Figure, k: real) -> Figure {
      figureTransform(self, (k, 0, 0, k, 0, 0))
    }
    function fade(self: Figure, pattern: list<real>) -> Figure {
      Figure(self.kind, self.geom, self.matrix, self.fillPaint, self.strokePaint, self.strokePx, self.dashPattern, pattern[1] * pattern[2])
    }
  }
  type Label = tuple<text: string, at: tuple<real, real>> is Drawable {
    function translate(self: Label, d: tuple<real, real>) -> Label { Label(self.text, (self.at[1] + d[1], self.at[2] + d[2])) }
    function rotateAbout(self: Label, angle: real, about: tuple<real, real>) -> Label { self }
    function rotate(self: Label, angle: real, about: any) -> Label { self }
    function fill(self: Label, paint: any) -> Label { self }
    function stroke(self: Label, paint: any) -> Label { self }
    function grow(self: Label, k: real) -> Label { self }
    function fade(self: Label, pattern: list<real>) -> Label { self }
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
    Figure("circle", [N(c[1], 15), N(c[2], 15), N(r, 15)], (1, 0, 0, 1, 0, 0), Nothing, Nothing, Nothing, Nothing, Nothing)
  }
  function spin(fig: Figure, a: real) { fig.rotateAbout(a, (0, 0)) }
  function moveAny(fig: any) { fig.translate((1, 2)) }
  function moveUntyped(x) { x.translate((1, 2)) }
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
  to: Target = 'javascript',
  mode?: string
): { ok: true; result: any } | { ok: false; message: string } {
  try {
    const result: any = compile(
      program(ce, source) as any,
      {
        to,
        fallback: false,
        ...(mode === undefined ? {} : { mode }),
      } as any
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

const WITNESSES = [
  // The witness of CE-1652.
  '(t: real) => circle((2, 0), 0.2).rotateAbout(t / 1000, (0, 0))',
  '(t: real) => circle((0, 0), t).fill("red").translate((1, 2))',
  // The function-call form.
  '(t: real) => rotateAbout(circle((1, 0), 1), t, (0, 0))',
];

describe('a protocol method on a record', () => {
  const ce = engine();

  test('the member call and the function call', () => {
    for (const source of WITNESSES) expectAgrees(ce, source);
  });

  test('the witness of CE-1652: the matrix of the rotation', () => {
    const r = expectAgrees(ce, WITNESSES[0]);
    const a = 1 / 1000;
    expectClose(r.run(1), {
      kind: 'circle',
      geom: [2, 0, 0.2],
      matrix: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0],
      fillPaint: null,
      strokePaint: null,
      strokePx: null,
      dashPattern: null,
      alpha: null,
    });
  });

  test('a colour argument at a parameter of type any', () => {
    const r = compileTo(
      ce,
      '(t: real) => circle((0, 0), t).fill(rgb(t, 0, 0))'
    );
    const colour = compileTo(ce, '(t: real) => rgb(t, 0, 0)');
    if (!r.ok || !colour.ok) throw new Error('declined');
    expect(r.result.run(0.5).fillPaint).toEqual(colour.result.run(0.5));
  });

  test('a method called on a parameter of a user function', () => {
    expectAgrees(ce, '(t: real) => spin(circle((1, 0), 1), t)');
    // A parameter of type any, and one of no stated type, that hold the
    // record.
    expectAgrees(ce, '(t: real) => moveAny(circle((t, 0), 1))');
    expectAgrees(ce, '(t: real) => moveUntyped(circle((t, 0), 1))');
  });

  test('a method of a type that another type also implements', () => {
    // `Label` conforms to `Drawable` too: its edge does not overlap
    // `Figure`.
    expectAgrees(ce, '(t: real) => Label("a", (t, 1)).translate((1, 2))');
    expectAgrees(
      ce,
      '(t: real) => (Label("a", (t, 1)).translate((1, 2)), circle((t, 0), 1).translate((1, 2)))'
    );
  });

  test('a list argument at a list parameter is passed whole', () => {
    expectAgrees(ce, '(t: real) => circle((t, 0), 1).fade([t, 2])');
  });

  test('a receiver with an effect is lowered once', () => {
    const r = compileTo(
      ce,
      '(t: real) => circle((random() + t, 0), 1).translate((1, 2))'
    );
    if (!r.ok) throw new Error(r.message);
    const text = `${r.result.preamble ?? ''}\n${r.result.code}`;
    expect(text.match(/drawNextRandomNumber\(/g)?.length).toBe(1);
  });

  test('one lowered implementation per record type', () => {
    // The functions lowered for `source`: in the complex mode, where the
    // pass `inline` does not copy a function called twice.
    const lowered = (source: string) => {
      const r = compileTo(ce, source, 'javascript', 'complex');
      if (!r.ok) throw new Error(r.message);
      const code = `${r.result.preamble ?? ''}\n${r.result.code}`;
      return new Set(code.match(/u\d+_translate\b/g)).size;
    };
    // Two figures of one record type: one function.
    const one =
      '(t: real) => (circle((t, 0), 1).translate((1, 2)), circle((0, t), 2).translate((t, 0)))';
    expectAgrees(ce, one);
    expect(lowered(one)).toBe(1);
    // A filled and an unfilled figure: two record types, two functions.
    const two =
      '(t: real) => (circle((t, 0), 1).translate((1, 2)), circle((0, t), 2).fill("red").translate((t, 0)))';
    expectAgrees(ce, two);
    expect(lowered(two)).toBe(2);
  });
});

describe('the defaults of a protocol member', () => {
  const ce = engine();

  test('a constant default that the call leaves out', () => {
    // `grow(k: real = figureScale)`: the interpreter passes the value of
    // the constant.
    const r = expectAgrees(ce, '(t: real) => circle((t, 0), 1).grow()');
    expect(r.run(1).matrix).toEqual([2, 0, 0, 2, 0, 0]);
    expectAgrees(ce, '(t: real) => circle((t, 0), 1).grow(t)');
    expectAgrees(ce, '(t: real) => grow(circle((t, 0), 1))');
  });

  test("a string default at a parameter of type any (Tycho's figureDefault)", () => {
    const r = expectAgrees(ce, '(t: real) => circle((t, 0), 1).stroke()');
    expect(r.run(1).strokePaint).toBe('default');
    expectAgrees(ce, '(t: real) => circle((t, 0), 1).stroke("blue")');
  });

  test('a constant default is a dependency of the code', () => {
    // The interpreter reads the constant at each call: a program that
    // declares it again changes the value, and a host that recompiles on a
    // change of `symbolDeps` sees it.
    const ce2 = engine(`
      const growBy = 3
      type P = tuple<x: real, y: real>
      protocol Grown { function g(self: Self, k: real = growBy) -> real }
      type P is Grown { function g(self: P, k: real) -> real { self.x * k } }
    `);
    const source = '(t: real) => P(t, 1).g()';
    const deps = new Set<string>();
    const r: any = compile(
      program(ce2, source) as any,
      {
        to: 'javascript',
        fallback: false,
        symbolDeps: deps,
      } as any
    );
    expect(deps.has('growBy')).toBe(true);
    expect(r.run(2)).toBe(6);
    expectAgrees(ce2, source);
    executeEpsil(ce2, 'const growBy = 5');
    expect(expectAgrees(ce2, source).run(2)).toBe(10);
  });

  test('a symbol default with no value declines', () => {
    const ce2 = engine(`
      type P = tuple<x: real, y: real>
      protocol Moded {
        function m(self: Self, mode: symbol<Auto> | symbol<Manual> = Auto) -> real
      }
      type P is Moded {
        function m(self: P, mode: symbol<Auto> | symbol<Manual>) -> real { self.x }
      }
    `);
    expectDeclines(
      ce2,
      '(t: real) => P(t, 1).m()',
      /the default Auto of the protocol method m, whose value reads a name of the program or has no value/
    );
  });

  test('a constant default whose value is a name with no value declines', () => {
    const ce2 = engine(`
      const mode0 = Auto
      type P = tuple<x: real, y: real>
      protocol Moded2 {
        function m(self: Self, mode: symbol<Auto> | symbol<Manual> = mode0) -> real
      }
      type P is Moded2 {
        function m(self: P, mode: symbol<Auto> | symbol<Manual>) -> real { self.x }
      }
    `);
    expectDeclines(
      ce2,
      '(t: real) => P(t, 1).m()',
      /the default mode0 of the protocol method m, whose value reads a name/
    );
  });

  test('a constant default whose value is a symbol compiles', () => {
    const ce2 = engine(`
      const flag = True
      type P = tuple<x: real, y: real>
      protocol Flagged { function h(self: Self, b: boolean = flag) -> real }
      type P is Flagged {
        function h(self: P, b: boolean) -> real { if b { self.x } else { 0 } }
      }
    `);
    expect(expectAgrees(ce2, '(t: real) => P(t, 1).h()').run(2)).toBe(2);
  });
});

describe('a protocol method declines', () => {
  const ce = engine();

  test("Tycho's rotate: a body that compares the default with a point", () => {
    // `if about == figureDefault { … } else { about }`: with the default,
    // the arms are a point and a string; with a point, `==` of a tuple.
    expectDeclines(
      ce,
      '(t: real) => circle((1, 0), 1).rotate(t)',
      /arms of two types/
    );
    expectDeclines(
      ce,
      '(t: real) => circle((1, 0), 1).rotate(t, (1, 1))',
      /Equal of a tuple/
    );
  });

  test('a list at a parameter of type any (the interpreter binds it whole)', () => {
    expectDeclines(
      ce,
      '(t: real) => circle((t, 0), 1).fill([t, 2])',
      /a list argument of the protocol method fill at a parameter of type any/
    );
  });

  test('a record of no named type', () => {
    expectDeclines(
      ce,
      '(t: real) => moveUntyped((t, "a"))',
      /the protocol method translate on a record of no named type/
    );
  });

  test('a first operand that is not a record', () => {
    const ce2 = engine(`
      protocol Describable { function describe(self: Self) -> real }
      type real is Describable { function describe(self: real) -> real { 2 * self } }
    `);
    expectDeclines(
      ce2,
      '(t: real) => describe(t)',
      /the protocol method describe on a value that is not a record/
    );
  });

  test('two protocols that implement the member for the type', () => {
    // The interpreter reports `protocol-call-ambiguous`.
    const ce2 = engine(`${PRELUDE}
      protocol Spinnable {
        function rotateAbout(self: Self, angle: real, about: tuple<real, real>) -> Self
      }
      type Figure is Spinnable {
        function rotateAbout(self: Figure, angle: real, about: tuple<real, real>) -> Figure { self }
      }
    `);
    expectDeclines(
      ce2,
      WITNESSES[0],
      /the protocol method rotateAbout on a value of type Figure, which 2 implementations can serve \(Drawable\(Figure\), Spinnable\(Figure\)\)/
    );
  });

  test('a parameterized type whose value selects the edge at run time', () => {
    // `Box(t)` is a `Box<integer>` when `t` is an integer at run time, so
    // the interpreter selects the edge by the value. A record of a
    // parameterized type does not compile.
    const ce2 = engine(`
      protocol Bumped { function bump(self: Self) -> real }
      type Box<out T> = tuple<v: T>
      type Box<real> is Bumped { function bump(self: Box<real>) -> real { 1 } }
      type Box<integer> is Bumped { function bump(self: Box<integer>) -> real { 2 } }
    `);
    const f = program(ce2, '(t: real) => Box(t).bump()');
    expect(ce2.box(['Apply', f, 1] as any).evaluate().re).toBe(2);
    expect(ce2.box(['Apply', f, 0.5] as any).evaluate().re).toBe(1);
    expectDeclines(
      ce2,
      '(t: real) => Box(t).bump()',
      /Box is not the library operator/
    );
  });

  test('a body that does not prove the declared result', () => {
    // The interpreter checks the value of the body against the result of
    // the implementation: `incompatible-type`.
    const ce2 = engine(`
      type P = tuple<x: real, y: real>
      protocol Checked {
        function check(self: Self) -> boolean
        function good(self: Self) -> real
      }
      type P is Checked {
        function check(self: P) -> boolean { self.x + 1 }
        function good(self: P) -> real { self.x + 1 }
      }
    `);
    const f = program(ce2, '(t: real) => P(t, 1).check()');
    expect(
      ce2
        .box(['Apply', f, 1] as any)
        .evaluate()
        .toString()
    ).toMatch(/incompatible-type/);
    expectDeclines(
      ce2,
      '(t: real) => P(t, 1).check()',
      /a body of check that is not boolean/
    );
    expectAgrees(ce2, '(t: real) => P(t, 1).good()');
  });

  test('an implementation of the host', () => {
    const ce2 = engine('type P = tuple<x: real, y: real>');
    ce2.declareProtocol('Tagged', {
      functions: { tag: '(self: Self) -> Self' },
    });
    ce2.declareProtocolImplementation('P', 'Tagged', {
      functions: { tag: (x: any) => x },
    });
    expectDeclines(
      ce2,
      '(t: real) => tag(P(t, 1))',
      /the protocol method tag implemented by a function of the host/
    );
  });

  test('on GLSL and interval-js', () => {
    for (const to of ['glsl', 'interval-js'] as Target[])
      for (const source of WITNESSES)
        expectDeclines(
          ce,
          source,
          /records compile on javascript only|text compiles on javascript only/,
          to
        );
  });
});

/** `implementationLiteralAt()`: the implementation of a member on an edge,
 *  as a function literal whose annotations name the target of the edge in
 *  place of `Self`; `null` for a host callback or a member the edge does
 *  not implement. */
describe('implementationLiteralAt', () => {
  test('Self is replaced by the target of the edge', () => {
    const ce = engine(`
      protocol Same { function same(self: Self, other: Self) -> Self }
      type P = tuple<x: real> is Same {
        function same(self: Self, other: Self) -> Self { P(self.x + other.x) }
      }
    `);
    const [c] = protocolDispatchCandidates(ce as any, 'same')!;
    expect(c.edge.targetKey).toBe('P');
    const literal = implementationLiteralAt(ce as any, c.edge, 'same')!;
    expect(literal.json).toEqual([
      'Function',
      [
        'Typed',
        [
          'Block',
          ['P', ['Add', ['Field', 'self', "'x'"], ['Field', 'other', "'x'"]]],
        ],
        "'P'",
      ],
      ['Typed', 'self', "'P'"],
      ['Typed', 'other', "'P'"],
    ]);
    expect(implementationLiteralAt(ce as any, c.edge, 'other')).toBeNull();
  });

  test('a parameter with a default keeps its default', () => {
    const ce = engine(`
      protocol Scaled { function scaled(self: Self, k: real = 2) -> Self }
      type P = tuple<x: real> is Scaled {
        function scaled(self: Self, k: real = 2) -> Self { P(k * self.x) }
      }
    `);
    const [c] = protocolDispatchCandidates(ce as any, 'scaled')!;
    const literal = implementationLiteralAt(ce as any, c.edge, 'scaled')!;
    expect(literal.json).toEqual([
      'Function',
      [
        'Typed',
        ['Block', ['P', ['Multiply', 'k', ['Field', 'self', "'x'"]]]],
        "'P'",
      ],
      ['Typed', 'self', "'P'"],
      ['Optional', ['Typed', 'k', "'real'"], 2],
    ]);
  });

  test('a host callback has no literal', () => {
    const ce = engine('type P = tuple<x: real>');
    ce.declareProtocol('Tagged', {
      functions: { tag: '(self: Self) -> Self' },
    });
    ce.declareProtocolImplementation('P', 'Tagged', {
      functions: { tag: (x: any) => x },
    });
    const [c] = protocolDispatchCandidates(ce as any, 'tag')!;
    expect(c.host).toBe(true);
    expect(implementationLiteralAt(ce as any, c.edge, 'tag')).toBeNull();
  });

  test('a conditional edge has no literal', () => {
    const ce = engine(`
      protocol Comparable { function compare(self: Self, other: Self) -> string }
      type string is Comparable {
        function compare(self: Self, other: Self) -> string { if self < other { "<" } else { ">=" } }
      }
      type list<T> is Comparable where T is Comparable {
        function compare(self: list<T>, other: list<T>) -> string { compare(self[1], other[1]) }
      }
    `);
    const candidates = protocolDispatchCandidates(ce as any, 'compare')!;
    const conditional = candidates.find((c) => c.conditional)!;
    expect(conditional).toBeDefined();
    expect(
      implementationLiteralAt(ce as any, conditional.edge, 'compare')
    ).toBeNull();
    const plain = candidates.find((c) => !c.conditional)!;
    expect(
      implementationLiteralAt(ce as any, plain.edge, 'compare')
    ).not.toBeNull();
  });
});
