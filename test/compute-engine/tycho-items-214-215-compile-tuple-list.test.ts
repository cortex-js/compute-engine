import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Tycho items 214 and 215 — two `javascript`-target declines on point shapes.
 *
 * Item 214 — `[1,2,3]·(cos a, sin a)` declined (`no list-arithmetic support`)
 * while `x+[1,2,3]` and `2(cos a, sin a)` compiled. The interpreter broadcasts
 * a point against a LIST by scaling the point whole at every element (a list
 * of points); a flat `_SYS.bcast` over the two arrays would zip them instead,
 * so the product was failing closed. It now emits a NESTED broadcast — over
 * the list operands outside, over the point's components inside.
 * `Add`/`Divide` of a point against a list are NOT broadcasts in the
 * interpreter (a per-element `incompatible-type` error, an inert quotient) and
 * used to compile to a plausible zip; they now fail closed.
 *
 * Item 215 — `[1,0] = P` with `P: tuple<number, number>` declined as "a tuple
 * participant" while `[1,0]=[x,y]` and `(1,0)=(x,y)` compiled. It is not the
 * literal-vs-symbol inconsistency it looked like: a list and a point are
 * never equal in the interpreter, the literal pair `[1,0]=(1,0)` already
 * folds to `False` before compilation, and the tuple=tuple-symbol pair
 * `(1,0)=P` compiles structurally. The list-vs-point-symbol pair now compiles
 * to the interpreter's constant instead of declining.
 */

type Vars = Record<string, unknown>;

function compileJS(
  latex: string,
  declare: Record<string, string> = {}
): { ce: ComputeEngine; result: ReturnType<typeof compile> } {
  const ce = new ComputeEngine();
  for (const [k, t] of Object.entries(declare)) ce.declare(k, t as never);
  return { ce, result: compile(ce.parse(latex), { to: 'javascript' }) };
}

function run(r: ReturnType<typeof compile>, vars: Vars = {}): unknown {
  if (r.success === false) throw new Error(`declined: ${r.diagnostic?.message}`);
  return r.run(vars as never);
}

describe('Tycho item 214: a point multiplied by a list compiles to a list of points', () => {
  test('list literal × point with free symbols (A3 shape)', () => {
    const { result } = compileJS(String.raw`[1,2,3]\cdot(\cos a,\sin a)`, {
      a: 'real',
    });
    expect(result.success).not.toBe(false);
    const out = run(result, { a: 0 }) as number[][];
    expect(out).toEqual([
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
  });

  test('the nested emission keeps the point whole per element', () => {
    const { result } = compileJS(String.raw`[1,2,3]\cdot(\cos a,\sin a)`, {
      a: 'real',
    });
    expect(result.success).not.toBe(false);
    if (result.success === false) return;
    // Every operand is bound once (the immediately-applied arrow), the list
    // broadcasts outside and the point's components inside.
    expect(result.code).toBe(
      '((_tv3, _tv4) => _SYS.bcast((_tv5) => _SYS.bcast((_tv1, _tv2) => (_tv1 * _tv2), _tv3, _tv5), _tv4))([Math.cos(_.a), Math.sin(_.a)], [1, 2, 3])'
    );
  });

  test('slider-dependent range × point (the A1 witness shape) agrees with the interpreter', () => {
    const { ce, result } = compileJS(
      String.raw`(3((-N)..N)+\cos t)\cdot(\cos a,\sin a)`,
      { t: 'real', a: 'real', N: 'number' }
    );
    const out = run(result, { t: 0.25, a: 0.5, N: 1 }) as number[][];
    ce.assign('t', 0.25);
    ce.assign('a', 0.5);
    ce.assign('N', 1);
    const expected = ce
      .parse(String.raw`(3((-N)..N)+\cos t)\cdot(\cos a,\sin a)`)
      .N();
    expect(expected.type.toString()).toMatch(/tuple/);
    const pts = Array.from(expected.each()).map((p) =>
      Array.from(p.each()).map((c) => c.re)
    );
    expect(out.length).toBe(3);
    for (let i = 0; i < 3; i++) {
      expect(out[i][0]).toBeCloseTo(pts[i][0], 12);
      expect(out[i][1]).toBeCloseTo(pts[i][1], 12);
    }
  });

  test.each<[string, number[][]]>([
    [String.raw`-(1,2)\cdot[1,2]`, [[-1, -2], [-2, -4]]],
    [String.raw`2\cdot[1,2]\cdot(1,0)`, [[2, 0], [4, 0]]],
    [String.raw`[1,2]\cdot(1,0)\cdot[3,4]`, [[3, 0], [8, 0]]],
    [String.raw`(1,0)\cdot(1..3)`, [[1, 0], [2, 0], [3, 0]]],
  ])('%s', (latex, expected) => {
    const { result } = compileJS(latex);
    expect(run(result)).toEqual(expected);
  });

  test('a list-typed symbol and a tuple-typed symbol broadcast the same way', () => {
    const { result: r1 } = compileJS(String.raw`L\cdot(1,0)`, {
      L: 'list<number>',
    });
    expect(run(r1, { L: [1, 2] })).toEqual([
      [1, 0],
      [2, 0],
    ]);
    const { result: r2 } = compileJS(String.raw`[1,2]\cdot P`, {
      P: 'tuple<number, number>',
    });
    expect(run(r2, { P: [1, 0] })).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  test('shapes the interpreter does not broadcast still fail closed', () => {
    // A matrix contracts; two lists of provably different lengths are a
    // dimension error; a LIST OF POINTS times a point is `tuple·tuple` at
    // every element (an interpreter error) — the outer broadcast would have
    // descended into each point and scaled by its coordinates.
    for (const latex of [
      String.raw`[[1,2],[3,4]]\cdot(1,0)`,
      String.raw`[1,2]\cdot(1,0)\cdot[3,4,5]`,
      String.raw`[(1,2),(3,4)]\cdot(1,0)`,
    ]) {
      const { result } = compileJS(latex);
      expect(result.success).toBe(false);
    }
    // A top-typed application could be anything at run time.
    const { result } = compileJS(String.raw`h(x)\cdot(1,0)`, {
      h: '(number) -> unknown',
      x: 'real',
    });
    expect(result.success).toBe(false);
  });

  test('an impure point factor is drawn once, not once per element', () => {
    const { result } = compileJS(String.raw`[1,2]\cdot(\operatorname{Random}(), 0)`);
    const out = run(result) as number[][];
    expect(out.length).toBe(2);
    expect(out[0][1]).toBe(0);
    expect(out[1][0]).toBeCloseTo(2 * out[0][0], 12);
  });

  test('a broadcastable<number> source is a point when scalar and a list of points when a list', () => {
    const { result } = compileJS(String.raw`B\cdot(1,0)`, {
      B: 'broadcastable<number>',
    });
    expect(run(result, { B: 3 })).toEqual([3, 0]);
    expect(run(result, { B: [1, 2] })).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });

  test('Add and Divide of a point against a list fail closed (were a plausible zip)', () => {
    // Interpreter: `(1,2) + [3,4]` is a per-element `incompatible-type`
    // error and `(1,2) / [1,2]` stays inert — neither is `[4, 6]` / `[1, 1]`.
    for (const latex of [String.raw`(1,2)+[3,4]`, String.raw`(1,2)/[1,2]`]) {
      const { result } = compileJS(latex);
      expect(result.success).toBe(false);
    }
  });

  test('controls: scalar × list and scalar × point keep compiling unchanged', () => {
    expect(run(compileJS(String.raw`x+[1,2,3]`, { x: 'real' }).result, { x: 2 })).toEqual([3, 4, 5]);
    const p = run(compileJS(String.raw`2(\cos a,\sin a)`, { a: 'real' }).result, { a: 0 });
    expect(p).toEqual([2, 0]);
  });
});

describe('Tycho item 215: equality between a list and a tuple-typed symbol', () => {
  test('the interpreter never equates a list and a point', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<number, number>');
    ce.assign('P', ['Tuple', 1, 0]);
    expect(ce.parse('[1,0]=P').evaluate().toString()).toBe('"False"');
    expect(ce.parse('(1,0)=P').evaluate().toString()).toBe('"True"');
    expect(ce.box(['Equal', ['List', 1, 0], ['Tuple', 1, 0]]).evaluate().toString()).toBe('"False"');
  });

  test('list literal = tuple-typed symbol compiles to the constant the interpreter answers', () => {
    const { result } = compileJS('[1,0]=P', { P: 'tuple<number, number>' });
    expect(result.success).not.toBe(false);
    if (result.success === false) return;
    expect(result.code).toBe('false');
    expect(run(result, { P: [1, 0] })).toBe(false);
  });

  test('NotEqual folds to the complementary constant', () => {
    const { result } = compileJS(String.raw`[1,0]\ne P`, {
      P: 'tuple<number, number>',
    });
    expect(run(result, { P: [1, 0] })).toBe(true);
  });

  test('a collection-kind symbol is NOT folded: a tuple inhabits indexed_collection', () => {
    const { result } = compileJS('C=P', {
      C: 'indexed_collection<number>',
      P: 'tuple<number, number>',
    });
    expect(result.success).toBe(false);
  });

  test('list-typed symbol = tuple-typed symbol folds the same way', () => {
    const { result } = compileJS('L=P', {
      L: 'list<number>',
      P: 'tuple<number, number>',
    });
    expect(run(result, { L: [1, 0], P: [1, 0] })).toBe(false);
  });

  test('controls: tuple = tuple-typed symbol compares structurally; list = list stays element-faithful', () => {
    const tuple = compileJS('(1,0)=P', { P: 'tuple<number, number>' }).result;
    expect(run(tuple, { P: [1, 0] })).toBe(true);
    expect(run(tuple, { P: [1, 1] })).toBe(false);
    const list = compileJS('[1,0]=[x,y]', { x: 'real', y: 'real' }).result;
    expect(run(list, { x: 1, y: 0 })).toBe(true);
  });
});
