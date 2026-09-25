/**
 * Compiling a LIST-BUILDING user-defined recursion (JavaScript target).
 *
 * `F(n) = Which(n = K, [g(n)], True, Join([g(n)], F(n + 1)))` and the
 * relatives `listRecursionPlan` recognizes are emitted as a loop over the
 * recursion's step (`_SYS.listRecursion`) instead of a natively recursive
 * arrow. The recursive arrow overflows the JavaScript call stack near 5,000
 * levels; the loop builds a 100,000-element list in under 100 ms. The
 * interpreter runs the same plan (`evaluateListRecursion`), under the same
 * `iterationLimit` cap, so both routes agree on values and on the
 * iteration-limit error.
 *
 * The 10,000-point Fibonacci-sphere builder below is the shape that
 * motivated the lowering.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { listRecursionPlan } from '../../src/compute-engine/boxed-expression/recursive-list-builder';

/** `F(n)` builds `[n, n+1, …, D-1]` by prepending to a self-call. */
function declareCountUp(ce: ComputeEngine, D: number): void {
  ce.assign('D', D);
  ce.declare('F', '(number) -> list<number>');
  ce.assign(
    'F',
    ce.parse(
      String.raw`n \mapsto \left\{n=D-1:\left[n\right], \left[n\right].\operatorname{join}\left(F(n+1)\right)\right\}`
    )
  );
}

/** The Fibonacci-sphere document: `P` maps an index to a point on the unit
 * sphere, `F` builds the list of all `D` points. */
function declareSphere(ce: ComputeEngine, D: number): void {
  ce.assign('D', D);
  ce.assign('\\varphi', ce.parse('\\frac{1+\\sqrt5}{2}'));
  ce.declare('P', '(number) -> tuple<number,number,number>');
  ce.assign(
    'P',
    ce.parse(
      String.raw`n \mapsto \left(\sqrt{\frac{1}{4}-\left(\frac{1}{2}-\frac{n}{D-1}\right)^{2}}\cos\left(\frac{2\pi}{\varphi}n\right), \sqrt{\frac{1}{4}-\left(\frac{1}{2}-\frac{n}{D-1}\right)^{2}}\sin\left(\frac{2\pi}{\varphi}n\right), 1-\frac{n}{D-1}\right)`
    )
  );
  ce.declare('F', '(number) -> list<tuple<number,number,number>>');
  ce.assign(
    'F',
    ce.parse(
      String.raw`n \mapsto \left\{n=D-1:\left[P(n)\right], \left[P(n)\right].\operatorname{join}\left(F(n+1)\right)\right\}`
    )
  );
}

function definitionOf(preamble: string, name: string): string {
  const start = preamble.indexOf(`const ${name} =`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = preamble.indexOf('\nconst ', start + 1);
  return preamble.slice(start, end < 0 ? undefined : end);
}

describe('list-building recursion compiles to a loop', () => {
  it('emits the loop form and no self-call for the count-up builder', () => {
    const ce = new ComputeEngine();
    declareCountUp(ce, 6);
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(r?.success).toBe(true);
    const def = definitionOf(String(r!.preamble), '_fn_F');
    expect(def).toContain('_SYS.listRecursion("F", [n],');
    expect(def).not.toMatch(/_fn_F\(/);
    expect(r!.run!({})).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('the literal the emitter receives is the stored value the plan recognizes', () => {
    // The plan identifies the self-call by the identity of the stored
    // literal. The lowering fires only because the compiler hands the
    // emitter that same object; a compiler that rebuilt the literal would
    // silently fall back to the recursive arrow.
    const ce = new ComputeEngine();
    declareCountUp(ce, 6);
    expect(listRecursionPlan(ce.box('F').value!)).toBeDefined();
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(String(r!.preamble)).toContain('_SYS.listRecursion');
  });

  it('builds the 10,000-point Fibonacci sphere without a stack overflow, matching the interpreter', () => {
    const D = 10_000;
    const ce = new ComputeEngine();
    declareSphere(ce, D);
    ce.iterationLimit = D + 1;
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(r?.success).toBe(true);
    const points = r!.run!({}) as number[][];
    expect(points).toHaveLength(D);
    // Spot-check against the interpreter's own value of `P` at the same
    // indices (the interpreter's `F(0)` is linear too, but 10,000 evaluations
    // of `P` are seconds; three are enough to pin the value parity).
    for (const i of [0, 4_321, D - 1]) {
      const expected = ce
        .box(['P', i])
        .N()
        .ops!.map((c) => c.re);
      expect(points[i]).toHaveLength(3);
      for (let k = 0; k < 3; k++)
        expect(points[i][k]).toBeCloseTo(expected[k], 10);
    }
    // The third coordinate `1 - n/(D-1)` runs from 1 at the first point to
    // 0 at the last.
    expect(points[0][2]).toBe(1);
    expect(points[D - 1][2]).toBe(0);
  });

  it('agrees with the interpreter element by element on a small builder', () => {
    const ce = new ComputeEngine();
    declareCountUp(ce, 40);
    const interpreted = [...ce.box(['F', 3]).evaluate().each()].map(
      (x) => x.re
    );
    const r = compile(ce.box(['F', 3]), { fallback: false });
    expect(r!.run!({})).toEqual(interpreted);
    expect(interpreted).toHaveLength(37);
  });

  it('lowers a recursion over several parameters and a different base list', () => {
    // `G(a, b)` = `[a, a+1, …, b]` followed by `[-1]`, guarded by `a > b`.
    const ce = new ComputeEngine();
    ce.declare('G', '(number, number) -> list<number>');
    ce.assign(
      'G',
      ce.parse(
        String.raw`(a, b) \mapsto \left\{a>b:\left[-1\right], \left[a\right].\operatorname{join}\left(G(a+1, b)\right)\right\}`
      )
    );
    const r = compile(ce.box(['G', 2, 6]), { fallback: false });
    const def = definitionOf(String(r!.preamble), '_fn_G');
    expect(def).toContain('_SYS.listRecursion("G", [a, b],');
    expect(def).not.toMatch(/_fn_G\(/);
    expect(r!.run!({})).toEqual([2, 3, 4, 5, 6, -1]);
    expect([...ce.box(['G', 2, 6]).evaluate().each()].map((x) => x.re)).toEqual(
      [2, 3, 4, 5, 6, -1]
    );
  });

  it('reports the iteration-limit error, read at call time, like the interpreter', () => {
    const ce = new ComputeEngine();
    declareCountUp(ce, 5_000);
    const r = compile(ce.box(['F', 0]), { fallback: false });
    // The engine's default limit (1024) stops a 5,000-step build on both
    // routes — the compiled loop reads the limit when it runs, not when it
    // compiles, so raising it afterwards is enough.
    expect(() => r!.run!({})).toThrow(
      /Iteration limit of 1024 exceeded while evaluating F\(\)/
    );
    expect(() => ce.box(['F', 0]).evaluate()).toThrow(/Iteration limit/);
    ce.iterationLimit = 6_000;
    expect((r!.run!({}) as number[]).length).toBe(5_000);
  });

  it('a definition with no reachable base case throws instead of hanging', () => {
    // `n` counts up from 0, so `n = -1` never holds. The recursive arrow
    // overflowed the stack here; the loop stops at the iteration cap. (An
    // undecided guard — `D` unassigned, so `n = D - 1` compares against NaN —
    // is a different case: `Which` returns `undefined` at depth zero on both
    // the loop and the arrow, and no recursion happens at all.)
    const ce = new ComputeEngine();
    ce.declare('F', '(number) -> list<number>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`n \mapsto \left\{n=-1:\left[n\right], \left[n\right].\operatorname{join}\left(F(n+1)\right)\right\}`
      )
    );
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(String(r!.preamble)).toContain('_SYS.listRecursion');
    expect(() => r!.run!({})).toThrow(/Iteration limit of 1024/);
  });

  it('an undecided guard at depth zero answers undefined, as the recursive arrow did', () => {
    // `D` is unassigned, so `n = D - 1` compares against NaN and the
    // compiled `Which` answers `undefined` on its first step; nothing was
    // collected, so that is the result, on the loop as on the recursive
    // arrow.
    const ce = new ComputeEngine();
    ce.declare('D', 'number');
    ce.declare('F', '(number) -> list<number>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`n \mapsto \left\{n=D-1:\left[n\right], \left[n\right].\operatorname{join}\left(F(n+1)\right)\right\}`
      )
    );
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(String(r!.preamble)).toContain('_SYS.listRecursion');
    expect(r!.run!({ D: NaN })).toBeUndefined();
  });

  it('an undecided guard after a collected prefix throws the TypeError the nested spread threw', () => {
    // The next argument `n / m` turns NaN when `m` is 0 after the first
    // step; the recursive arrow then spread `undefined` into the collected
    // prefix (`[...[n], ...undefined]`), a `TypeError`, and the loop keeps
    // that outcome.
    const ce = new ComputeEngine();
    ce.declare('m', 'number');
    ce.declare('F', '(number) -> list<number>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`n \mapsto \left\{n=5:\left[n\right], \left[n\right].\operatorname{join}\left(F(\frac{n}{m})\right)\right\}`
      )
    );
    const r = compile(ce.box(['F', 0]), { fallback: false });
    expect(String(r!.preamble)).toContain('_SYS.listRecursion');
    expect(() => r!.run!({ m: 0 })).toThrow(TypeError);
  });

  it('a call at a repetition site still reaches the loop definition', () => {
    // A repetition site can ask for an invariant-prefix variant of the
    // callee; a recognized recursion emits no variant and the site falls
    // back to the ordinary call, which is the loop.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('G', '(number, number) -> list<number>');
    ce.assign(
      'G',
      ce.parse(
        String.raw`(a, b) \mapsto \left\{a>3:\left[\sin(b)\right], \left[a\cdot\sin(b)\right].\operatorname{join}\left(G(a+1, b)\right)\right\}`
      )
    );
    const r = compile(
      ce.parse(String.raw`\sum_{i=1}^{4} \operatorname{Length}(G(i, x))`),
      { fallback: false }
    );
    const preamble = String(r!.preamble);
    expect(preamble).toContain('_SYS.listRecursion("G", [a, b],');
    expect(preamble).not.toContain('$inv');
    expect(r!.run!({ x: 0.5 })).toBe(10);
  });

  it('a complex-declared parameter keeps the recursive arrow', () => {
    // A call site coerces a complex argument to its `{re, im}` object; the
    // loop hands the next arguments to the step with no call site between,
    // so the definition keeps the recursive form.
    const ce = new ComputeEngine();
    ce.declare('F', '(number, complex) -> list<complex>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`(n, z) \mapsto \left\{n=0:\left[z+i\right], \left[z+i\right].\operatorname{join}\left(F(n-1, 0)\right)\right\}`
      )
    );
    const r = compile(ce.box(['F', 2, 1]), { fallback: false });
    const def = definitionOf(String(r!.preamble), '_fn_F');
    expect(def).not.toContain('listRecursion');
    expect(def).toMatch(/_fn_F\(/);
    const out = r!.run!({}) as { re: number; im: number }[];
    expect(out.map((c) => [c.re, c.im])).toEqual([
      [1, 1],
      [0, 1],
      [0, 1],
    ]);
  });

  it('a collection-typed guard keeps the recursive arrow', () => {
    // `L > n` over a list `L` is a list of booleans, so the `Which` selects
    // elementwise and its result is a list, not one control record; the
    // plan admits the guard (it is pure) and the loop form declines it.
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    ce.declare('F', '(number) -> list<number>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`n \mapsto \left\{L>n:\left[n, n+1\right], \left[n\right].\operatorname{join}\left(F(n+1)\right)\right\}`
      )
    );
    expect(listRecursionPlan(ce.box('F').value!)).toBeDefined();
    const r = compile(ce.box(['F', 0]), { fallback: false });
    const def = definitionOf(String(r!.preamble), '_fn_F');
    expect(def).not.toContain('listRecursion');
    expect(def).toMatch(/_fn_F\(/);
  });

  it('a caller override of Tuple keeps the recursive arrow', () => {
    // The loop's control records are `Tuple`s; a caller that supplies its
    // own `Tuple` implementation would build them, so the definition keeps
    // the recursive form and the override applies as usual.
    const ce = new ComputeEngine();
    declareCountUp(ce, 4);
    const r = compile(ce.box(['F', 0]), {
      fallback: false,
      functions: { Tuple: '((p, q) => [q, p])' },
    });
    const def = definitionOf(String(r!.preamble), '_fn_F');
    expect(def).not.toContain('listRecursion');
    expect(def).toMatch(/_fn_F\(/);
    expect(r!.run!({})).toEqual([0, 1, 2, 3]);
  });

  it('a recursion that is not list-building keeps the recursive arrow', () => {
    const ce = new ComputeEngine();
    ce.declare('Fact', '(number) -> number');
    ce.assign(
      'Fact',
      ce.parse(
        String.raw`n \mapsto \left\{n=0:1, n \cdot \operatorname{Fact}(n-1)\right\}`
      )
    );
    const r = compile(ce.box(['Fact', 5]), { fallback: false });
    const def = definitionOf(String(r!.preamble), '_fn_Fact');
    expect(def).not.toContain('listRecursion');
    expect(def).toMatch(/_fn_Fact\(/);
    expect(r!.run!({})).toBe(120);
  });

  it('a self-call in a guard or an element keeps the recursive arrow', () => {
    // The element `F(n+1)` nested inside the prefix list is not a direct
    // self-call in a `Join` arm; the plan declines and the definition is the
    // ordinary recursive arrow.
    const ce = new ComputeEngine();
    ce.declare('F', '(number) -> list<number>');
    ce.assign(
      'F',
      ce.parse(
        String.raw`n \mapsto \left\{n\geq 3:\left[n\right], \left[\operatorname{Length}(F(n+1))\right].\operatorname{join}\left(F(n+1)\right)\right\}`
      )
    );
    const r = compile(ce.box(['F', 0]), { fallback: false });
    const def = definitionOf(String(r!.preamble), '_fn_F');
    expect(def).not.toContain('listRecursion');
    expect(def).toMatch(/_fn_F\(/);
  });

  it('the shader targets still fail closed on the same definition', () => {
    // A list has no static shader type, so the shader targets decline the
    // definition before they reach the recursion check; either way the loop
    // form is never emitted for them.
    const ce = new ComputeEngine();
    declareCountUp(ce, 6);
    for (const target of [new GLSLTarget(), new WGSLTarget()])
      expect(() => target.compile(ce.box(['F', 0]))).toThrow(
        /Could not compile/
      );
  });
});
