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

  test('Add of a point and a list fails closed (was a plausible zip)', () => {
    // Interpreter: `(1,2) + [3,4]` is an `incompatible-type` error, not
    // `[4, 6]`.
    const { result } = compileJS(String.raw`(1,2)+[3,4]`);
    expect(result.success).toBe(false);
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

  test('a collection-kind symbol is NOT folded: a tuple inhabits indexed_collection', () => {
    const { result } = compileJS('C=P', {
      C: 'indexed_collection<number>',
      P: 'tuple<number, number>',
    });
    expect(result.success).toBe(false);
  });
});
