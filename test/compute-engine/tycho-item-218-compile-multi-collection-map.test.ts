import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import type { ExpressionInput } from '../../src/compute-engine/types-expression';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * Tycho item 218 — the `javascript` target declined the multi-collection
 * (zipWith) form of `Map` whenever the sources stayed symbolic:
 * `Map((_1,_2) ↦ _1+_2, 1..N, 2..N)` with `N` a free input answered
 * "Could not compile `Map`: multi-collection form is not compiled", while the same shape with
 * literal bounds const-folded and a single-collection `Map` compiled either
 * way. The interpreter evaluated the declined shape correctly.
 *
 * Witness (neyret `sxgedpjlla`): Desmos' element-wise list difference
 * `c = (1..N) − Join([0], 1..(N−1))` EVALUATES to a two-collection `Map`,
 * and `T = Map(Z ↦ Σ_{j=1}^{Z} c[j], 1..N)` — which compiles `c`'s bound
 * value — declined with it.
 *
 * The zip form now lowers on the JavaScript target: each
 * source is materialized once, the callback receives one element from each
 * source per position, and the result is as long as the SHORTEST source —
 * the interpreter's `count` for the form, and what `Zip` does.
 */

const F2: ExpressionInput = [
  'Function',
  ['Block', ['Add', '_1', '_2']],
  '_1',
  '_2',
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('N', 'number');
  ce.declare('M', 'number');
  return ce;
}

function js(ce: ComputeEngine, json: ExpressionInput) {
  return jsOf(ce.box(json));
}

function jsOf(expr: Expression) {
  const r = compile<'javascript', number[]>(expr, { to: 'javascript' });
  // `CompiledRunner` types every input as a `number`; a list-typed free
  // input (`L: list<number>`) is passed as an array, which the runtime
  // accepts. The cast is confined here so the tests read plainly.
  const run = (vars: Record<string, number | number[]>): number[] =>
    r.run(vars as Record<string, number>);
  return { success: r.success, diagnostic: r.diagnostic, run };
}

describe('Tycho item 218: the zip form of Map compiles over symbolic sources (javascript)', () => {
  test('B5 — two symbolic ranges', () => {
    const ce = engine();
    const json: ExpressionInput = [
      'Map',
      F2,
      ['Range', 1, 'N'],
      ['Range', 2, 'N'],
    ];
    const r = js(ce, json);
    expect(r.success).toBe(true);
    expect(r.run({ N: 4 })).toEqual([3, 5, 7]);
    expect(ce.box(json).subs({ N: 4 }).evaluate().toString()).toBe('[3,5,7]');
  });

  test('B5c — the single-collection control still compiles', () => {
    const ce = engine();
    const r = js(ce, [
      'Map',
      ['Function', ['Block', ['Negate', '_1']], '_1'],
      ['Range', 1, 'N'],
    ]);
    expect(r.success).toBe(true);
    expect(r.run({ N: 4 })).toEqual([-1, -2, -3, -4]);
  });

  test('the result is as long as the shortest source, like the interpreter', () => {
    const ce = engine();
    const json: ExpressionInput = [
      'Map',
      F2,
      ['Range', 1, 'N'],
      ['Range', 1, 'M'],
    ];
    const r = js(ce, json);
    expect(r.success).toBe(true);
    expect(r.run({ N: 3, M: 2 })).toEqual([2, 4]);
    expect(r.run({ N: 2, M: 3 })).toEqual([2, 4]);
    // `Range(1, 0)` is not empty: a two-operand range infers a DESCENDING
    // step, so it is `[1, 0]` and the zip pairs it with `[1, 2]`.
    expect(r.run({ N: 3, M: 0 })).toEqual([2, 2]);
    expect(ce.box(json).subs({ N: 3, M: 2 }).evaluate().toString()).toBe(
      '[2,4]'
    );
    expect(ce.box(json).subs({ N: 3, M: 0 }).evaluate().toString()).toBe(
      '[2,2]'
    );
  });

  test('an empty source empties the result', () => {
    const ce = engine();
    ce.declare('L', 'list<number>');
    const r = js(ce, ['Map', F2, ['Range', 1, 'N'], 'L']);
    expect(r.success).toBe(true);
    expect(r.run({ N: 3, L: [] })).toEqual([]);
  });

  test('three sources', () => {
    const ce = engine();
    const r = js(ce, [
      'Map',
      ['Function', ['Add', '_1', '_2', '_3'], '_1', '_2', '_3'],
      ['Range', 1, 'N'],
      ['Range', 1, 'N'],
      ['Range', 1, 'N'],
    ]);
    expect(r.success).toBe(true);
    expect(r.run({ N: 3 })).toEqual([3, 6, 9]);
  });
});

describe('Tycho item 218: a parameter annotation is checked against ITS source, position by position', () => {
  // `Range(1, K)` with `K: integer` types `indexed_collection<integer>`.
  // A range's element type comes from its lower bound and step only — the
  // upper bound just says where the run stops — so `Range(2, N)` with
  // `N: number` is still integer-valued, while `Range(2.5, N)` types
  // `indexed_collection<real>`, which does not provably satisfy an `integer`
  // annotation — the same D6 decline the unary form gives
  // (`BaseCompiler.assertCallbackAnnotations`).
  function annotated(
    a: string | undefined,
    b: string | undefined
  ): ExpressionInput {
    return [
      'Function',
      ['Add', 'a', 'b'],
      a === undefined ? 'a' : ['Typed', 'a', a],
      b === undefined ? 'b' : ['Typed', 'b', b],
    ];
  }

  test('both provable: compiles', () => {
    const ce = engine();
    ce.declare('K', 'integer');
    const r = js(ce, [
      'Map',
      annotated('integer', 'integer'),
      ['Range', 1, 'K'],
      ['Range', 2, 'K'],
    ]);
    expect(r.success).toBe(true);
    expect(r.run({ K: 4 })).toEqual([3, 5, 7]);
  });

  test('an unannotated parameter over the number-typed source is unconstrained', () => {
    const ce = engine();
    ce.declare('K', 'integer');
    const r = js(ce, [
      'Map',
      annotated('integer', undefined),
      ['Range', 1, 'K'],
      ['Range', 2, 'N'],
    ]);
    expect(r.success).toBe(true);
    expect(r.run({ K: 3, N: 4 })).toEqual([3, 5, 7]);
  });
});

describe('Tycho item 218: shapes the zip lowering must refuse (fail closed, the interpreter evaluates them)', () => {
  test('a bare variadic operator symbol over THREE sources takes three arguments', () => {
    const ce = engine();
    const json: ExpressionInput = [
      'Map',
      'Add',
      ['Range', 1, 'N'],
      ['Range', 2, 'N'],
      ['Range', 3, 'N'],
    ];
    // The interpreter applies the variadic `Add` to one element from each.
    expect(ce.box(json).subs({ N: 4 }).evaluate().toString()).toBe('[6,9]');
    const r = js(ce, json);
    expect(r.success).toBe(true);
    expect(r.run({ N: 4 })).toEqual([6, 9]);
  });

  test('a bare binary operator symbol over exactly two sources compiles', () => {
    const ce = engine();
    const r = js(ce, ['Map', 'Add', ['Range', 1, 'N'], ['Range', 2, 'N']]);
    expect(r.success).toBe(true);
    expect(r.run({ N: 4 })).toEqual([3, 5, 7]);
  });

  test.each([
    ['complex elements', 'list<complex>'],
    ['nested lists', 'list<list<number>>'],
    ['strings', 'list<string>'],
    ['no provable element type', 'list'],
  ])(
    'a source of %s declines — the bare parameters compile as real numbers',
    (_label, type) => {
      const ce = engine();
      ce.declare('S', type);
      const r = js(ce, ['Map', F2, ['Range', 1, 'N'], 'S']);
      expect(r.success).toBe(false);
      // A list of strings is admitted as an input (CE-1548): it declines at
      // the first operation that reads its elements as numbers.
      expect(r.diagnostic?.message).toMatch(
        /the input S of type|Add of integer, string/
      );
    }
  );

  test('a source with observable effects declines — the interpreter stops at the shortest source', () => {
    const ce = engine();
    const drawing: ExpressionInput = [
      'Map',
      ['Function', ['Random'], '_1'],
      ['Range', 1, 1000],
    ];
    const r = compile(ce.box(['Map', F2, ['Range', 1, 'N'], drawing]), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.message).toContain('Map of a list with an effect');
    // `Zip` materializes every source the same way, so it refuses the same
    // source; a pure `Zip` still compiles.
    const zip = compile(ce.box(['Zip', ['Range', 1, 'N'], drawing]), {
      to: 'javascript',
      constantFold: false,
    });
    expect(zip.success).toBe(false);
    expect(zip.diagnostic?.message).toContain('Zip of a list with an effect');
    const pure = compile<'javascript', number[][]>(
      ce.box(['Zip', ['Range', 1, 'N'], ['Range', 2, 'N']]),
      { to: 'javascript' }
    );
    expect(pure.success).toBe(true);
    expect(pure.run({ N: 3 })).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });
});
