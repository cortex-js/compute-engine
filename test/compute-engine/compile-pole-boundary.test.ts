import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

//
// The compiled JavaScript runner's ENTRY CHECK projects the interpreter's
// unsigned pole `~oo` (ComplexInfinity) to the IEEE `Infinity` when it is
// bound to a symbol or parameter the compilation analyzed as REAL, instead of
// refusing it as a complex value.
//
// Compiled code already spells a pole it PRODUCES as `Infinity` — an embedded
// `~oo` literal, a folded `Gamma(-2)`, a run-time `1 / 0`. Before this
// projection existed, the same pole arriving as an ARGUMENT threw instead, so
// one mathematical value had two incompatible behaviors depending on which
// side of the boundary it came from. It now has one spelling on both routes.
//
// A genuine complex value is still refused: reading `3 + 4i` as a number
// would be silently wrong, while reading `~oo` as `Infinity` is the
// documented float encoding of it.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

/** The interpreter's answer for `expr` with `x := ~oo`. */
function interpretedAtPole(expr: any): number {
  const e = new ComputeEngine();
  e.box(['Assign', 'x', 'ComplexInfinity']).evaluate();
  return e.box(expr).evaluate().re;
}

describe('COMPILED POLE BOUNDARY — a `~oo` argument projects to Infinity', () => {
  it('projects a boxed `~oo` bound to a real free symbol, matching the interpreter', () => {
    // Each row is a compiled expression over one real symbol. The compiled
    // answer and the interpreter's answer for `x := ~oo` must agree.
    const rows: [any, number][] = [
      [['Add', 'x', 1], Infinity],
      ['x', Infinity],
      [['Abs', 'x'], Infinity],
      [['Multiply', 2, 'x'], Infinity],
      [['Divide', 1, 'x'], 0],
    ];
    for (const [expr, expected] of rows) {
      const r = compile(ce.box(expr));
      expect(r?.run?.({ x: ce.box('ComplexInfinity') } as any)).toBe(expected);
      expect(interpretedAtPole(expr)).toBe(expected);
    }
    // `Sin` of a pole is NaN on both sides.
    expect(
      compile(ce.box(['Sin', 'x']))?.run?.({
        x: ce.box('ComplexInfinity'),
      } as any)
    ).toBeNaN();
    expect(interpretedAtPole(['Sin', 'x'])).toBeNaN();
  });

  it('projects the plain `{re, im}` spelling of `~oo` as well as the boxed one', () => {
    // A caller working in the JS target's own value convention hands in a
    // `{re, im}` object rather than a boxed expression. `~oo` carries an
    // infinite part and a non-zero imaginary part in both spellings.
    const r = compile(ce.box(['Add', 'x', 1]));
    expect(r?.run?.({ x: { re: Infinity, im: Infinity } } as any)).toBe(
      Infinity
    );
    expect(r?.run?.({ x: { re: 3, im: Infinity } } as any)).toBe(Infinity);
    expect(r?.run?.({ x: { re: -Infinity, im: -Infinity } } as any)).toBe(
      Infinity
    );
  });

  it('projects a `~oo` positional argument on the lambda route', () => {
    const r = compile(ce.box(['Function', ['Add', 'y', 1], 'y']));
    expect((r?.run as any)?.(5)).toBe(6);
    expect((r?.run as any)?.(ce.box('ComplexInfinity'))).toBe(Infinity);
    expect((r?.run as any)?.({ re: Infinity, im: Infinity })).toBe(Infinity);
  });

  it('still refuses a genuine complex value on both routes', () => {
    // The projection is confined to the pole. A finite complex bound to a
    // real symbol remains the caller mistake it always was.
    const r = compile(ce.box(['Add', 'x', 1]));
    expect(() => r?.run?.({ x: { re: 3, im: 4 } } as any)).toThrow(
      /compiled as a real number/
    );
    expect(() => r?.run?.({ x: ce.box(['Complex', 3, 4]) } as any)).toThrow(
      /compiled as a real number/
    );
    const rl = compile(ce.box(['Function', ['Add', 'y', 1], 'y']));
    expect(() => (rl?.run as any)?.({ re: 3, im: 4 })).toThrow(
      /compiled as a real number/
    );
    // An imaginary part of exactly zero is a real, not a pole: a `{re, im}`
    // object spelling a SIGNED infinity is not projected.
    expect(() => r?.run?.({ x: { re: Infinity, im: 0 } } as any)).toThrow(
      /compiled as a real number/
    );
  });

  it('gives the pole one spelling across the produced and boundary routes', () => {
    // The value the compiled body PRODUCES for a pole and the value a `~oo`
    // ARGUMENT becomes are now the same number.
    const produced = compile(ce.box(['Divide', 1, 'w']), {
      constantFold: false,
    })?.run?.({ w: 0 });
    const embedded = compile(ce.box('ComplexInfinity'))?.run?.({});
    const boundary = compile(ce.box('x'))?.run?.({
      x: ce.box('ComplexInfinity'),
    } as any);
    expect(produced).toBe(Infinity);
    expect(embedded).toBe(Infinity);
    expect(boundary).toBe(Infinity);
  });
});
