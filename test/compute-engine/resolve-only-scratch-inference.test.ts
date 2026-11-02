import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { withScratchScope } from '../../src/compute-engine/scratch-scopes';

// A serialization runs in a resolve-only region (`ce._resolveOnly()`), where a
// use of a symbol does not narrow the type of its binding. A type that the
// serializer reads can start the derivation of the result of a function under
// its declared parameter types (`resultUnderDeclaredParameters`,
// `declared-parameter-result.ts`), which boxes a copy of the literal in a
// scratch scope and memoizes the result. The parameters of that copy were not
// narrowed by their uses inside the region, so the memoized result depended
// on whether a serialization started the derivation. A binding under a
// scratch scope is now narrowed in a resolve-only region too: no cache that
// outlives the computation can read it.

const POINT = ['PointList', 0, 0, ['Negate', 'n']];

/** A fresh engine with `F(n) := Which(n = 9, [(0, 0, -n)], True,
 * ListJoin([(0, 0, -n)], F(n + 1)))`, `C := F(0)` (type inferred) and
 * `N(p: tuple<number, number, number>) := p.x + p.y + p.z`, and the
 * expression `N(C)`. */
function setup(): { ce: ComputeEngine; target: any } {
  const ce = new ComputeEngine();
  ce.declare('F', 'function');
  ce.assign(
    'F',
    ce.box([
      'Function',
      [
        'Block',
        [
          'Which',
          ['Equal', 'n', 9],
          ['List', POINT],
          'True',
          ['ListJoin', ['List', POINT], ['F', ['Add', 'n', 1]]],
        ],
      ],
      'n',
    ] as any)
  );
  ce.assign('C', ce.box(['F', 0]));
  ce.declare('N', { signature: '(tuple<number, number, number>) -> number' });
  ce.assign(
    'N',
    ce.box([
      'Function',
      ['Block', ['Add', ['PointX', 'p'], ['PointY', 'p'], ['PointZ', 'p']]],
      ['Typed', 'p', "'tuple<number, number, number>'"],
    ] as any)
  );
  return { ce, target: ce.box(['N', 'C']) };
}

describe('A SERIALIZATION DOES NOT CHANGE A DERIVED SIGNATURE', () => {
  test.each([false, true])(
    'the compile of N(C) succeeds (LaTeX read first: %s)',
    (readLatexFirst) => {
      const { ce, target } = setup();
      if (readLatexFirst) expect(target.latex).toBe('N(C)');
      const result = compile(target, { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(result.run?.({})).toEqual([0, -1, -2, -3, -4, -5, -6, -7, -8, -9]);
      expect(ce.box(['F', 0]).type.toString()).toBe(
        'list<tuple<integer, integer, number>>'
      );
    }
  );

  test('the type of F(0) is the same after a LaTeX read', () => {
    const { ce, target } = setup();
    void target.latex;
    expect(ce.box(['F', 0]).type.toString()).toBe(
      'list<tuple<integer, integer, number>>'
    );
    expect(ce.box('C').value!.type.toString()).toBe(
      'list<tuple<integer, integer, number>>'
    );
  });
});

describe('INFERENCE IN A RESOLVE-ONLY REGION', () => {
  /** The type of `x` after a narrowing to `integer` in a resolve-only
   * region, with `x` declared `unknown` in a scope that is registered as a
   * scratch scope or not. */
  function narrowedInRegion(scratch: boolean): string {
    const ce = new ComputeEngine();
    const scope = { parent: ce.context.lexicalScope, bindings: new Map() };
    const body = () =>
      (ce as any)._inScope(scope, () => {
        ce.declare('x', 'unknown');
        const x = ce.box('x') as any;
        (ce as any)._resolveOnly(() => x._infer(() => 'integer', 'narrow'));
        return x.type.toString();
      });
    return scratch ? withScratchScope(ce as any, scope, body) : body();
  }

  test('a binding under a scratch scope is narrowed', () =>
    expect(narrowedInRegion(true)).toBe('integer'));

  test('any other binding is not narrowed', () =>
    expect(narrowedInRegion(false)).toBe('unknown'));
});
