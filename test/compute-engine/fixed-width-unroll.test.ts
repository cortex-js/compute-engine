import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { unrollFixedWidthCollections } from '../../src/compute-engine/compilation/fixed-width-unroll';

/**
 * The fixed-width unroll (`compilation/fixed-width-unroll.ts`).
 *
 * A collection whose WIDTH is known at compile time — a literal `List` of N
 * elements, reached after canonicalization or after a user function is inlined
 * at its call site — used to be lowered as a runtime array: `_SYS.bcast`
 * closures and `reduce` on the JavaScript target, and a fail-closed decline on
 * the shader and interval targets, which hold one scalar and cannot hold a
 * collection at all. The interpreter, given the same expression, produces
 * straight-line scalar arithmetic. This pass reproduces that shape
 * structurally, before any target sees the expression.
 *
 * The first half pins each rewrite rule and the cases that must stay
 * untouched. The second half is the reason the pass exists: the Voronoi chain
 * from the Desmos state `62urmx2dcm`, whose `PointX` over a nine-element list
 * of points declined on `glsl`, `wgsl` and `interval-js` and ran 6.7 times
 * slower than the interpreter's own scalar form on `javascript`.
 *
 * Two preconditions run through every rule below and shape the fixtures. A
 * literal list is unrolled only when it has at least FIVE elements — a
 * narrower one is a `vec2`/`vec3`/`vec4` on the shader targets and a native
 * fan-out elsewhere — and only when at least one element is not a NUMBER
 * LITERAL, since a list of constants is answered by the constant folder or,
 * with folding off, by the target's own fan-out. Hence the five-element lists
 * of symbols throughout.
 */

/** A five-element list of declared scalar symbols: the narrowest list the
 * pass unrolls. */
const FIVE = ['List', 'a', 'b', 'c', 'd', 's'];

/** An engine whose scalar symbols are declared, so `type.matches('number')`
 * — the pass's scalarity test — answers `true` for them. */
function scalarEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['a', 'b', 'c', 'd', 's', 'x', 'y'])
    ce.declare(name, 'number');
  ce.declare('L', 'list<number>');
  return ce;
}

describe('FIXED-WIDTH UNROLL — point accessors', () => {
  const ce = scalarEngine();
  // A list of five points, each written in one of the shapes the pass
  // decomposes: a tuple, an all-scalar `PointList`, a sum of points, a scalar
  // multiple of a point, and a negated point.
  const POINTS = [
    'List',
    ['Tuple', 'a', 'b'],
    ['PointList', 'a', 'b'],
    ['Add', ['Tuple', 'a', 'b'], ['Tuple', 'c', 'd']],
    ['Multiply', 's', ['PointList', 'a', 'b']],
    ['Negate', ['PointList', 'a', 'b']],
  ];
  const unrolled = (json: any) => unrollFixedWidthCollections(ce.box(json));

  it('reads the coordinate of every element of a wide list of points', () => {
    expect(unrolled(['PointX', POINTS]).json).toEqual([
      'List',
      'a',
      'a',
      ['Add', 'a', 'c'],
      ['Multiply', 'a', 's'],
      ['Negate', 'a'],
    ]);
    expect(unrolled(['PointY', POINTS]).json).toEqual([
      'List',
      'b',
      'b',
      ['Add', 'b', 'd'],
      ['Multiply', 'b', 's'],
      ['Negate', 'b'],
    ]);
  });

  it('leaves a SINGLE literal point to the target, by default', () => {
    // The shader targets read it with a native `vec2` swizzle. Only the
    // inliner asks for this fold.
    const expr = ce.box(['PointX', ['Tuple', 'a', 'b']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
    expect(
      unrollFixedWidthCollections(expr, { foldSingleLiteralPoint: true }).json
    ).toEqual('a');
    expect(
      unrollFixedWidthCollections(ce.box(['PointY', ['PointList', 'a', 'b']]), {
        foldSingleLiteralPoint: true,
      }).json
    ).toEqual('b');
  });

  it('leaves a NARROW list of points untouched', () => {
    const expr = ce.box([
      'PointX',
      ['List', ['Tuple', 'a', 'b'], ['Tuple', 'c', 'd']],
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves an IMPURE discarded coordinate untouched', () => {
    // Reading `y` of `(Random(), b)` would drop the `Random()` call, which the
    // interpreter runs once when it builds the point.
    const impure = ['Tuple', ['Random'], 'b'];
    const expr = ce.box([
      'PointY',
      ['List', impure, impure, impure, impure, impure],
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('folds a coordinate whose SIBLING is impure but is itself kept', () => {
    const impure = ['Tuple', ['Random'], 'b'];
    expect(
      unrolled(['PointX', ['List', impure, impure, impure, impure, impure]])
        .json
    ).toEqual([
      'List',
      ['Random'],
      ['Random'],
      ['Random'],
      ['Random'],
      ['Random'],
    ]);
  });

  it('leaves a coordinate past the arity of the point untouched', () => {
    const p = ['Tuple', 'a', 'b'];
    const expr = ce.box(['PointZ', ['List', p, p, p, p, p]]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });
});

describe('FIXED-WIDTH UNROLL — Map over a literal list', () => {
  const ce = scalarEngine();
  const unrolled = (json: any) => unrollFixedWidthCollections(ce.box(json));

  it('substitutes the body once per element', () => {
    expect(
      unrolled(['Map', ['Function', ['Square', '_'], '_'], FIVE]).json
    ).toEqual([
      'List',
      ['Power', 'a', 2],
      ['Power', 'b', 2],
      ['Power', 'c', 2],
      ['Power', 'd', 2],
      ['Power', 's', 2],
    ]);
  });

  it('leaves an IMPURE element untouched', () => {
    // The body may mention the parameter several times; substitution would
    // then repeat the `Random()` call, which the interpreter evaluates once.
    const expr = ce.box([
      'Map',
      ['Function', ['Square', '_'], '_'],
      ['List', ['Random'], 'b', 'c', 'd', 's'],
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a body that BINDS a name untouched', () => {
    // `subs` is not capture-avoiding.
    const expr = ce.box([
      'Map',
      ['Function', ['Sum', ['Multiply', '_', 'i'], ['Limits', 'i', 1, 3]], '_'],
      FIVE,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a REST parameter untouched', () => {
    // A rest parameter binds its ONE name to a TUPLE of the arguments from
    // its position onwards, so `(...r) ↦ …` mapped over a list sees the
    // 1-tuple `(element)`, not the element. Substituting the element itself
    // would compute something else — with the guard removed, this body
    // indexes a number and boxes an `incompatible-type` error.
    const expr = ce.box([
      'Map',
      ['Function', ['Square', ['At', 'r', 1]], ['Spread', 'r']],
      FIVE,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a list of unknown length untouched', () => {
    const expr = ce.box(['Map', ['Function', ['Square', '_'], '_'], 'L']);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a NARROW list untouched', () => {
    const expr = ce.box([
      'Map',
      ['Function', ['Square', '_'], '_'],
      ['List', 'a', 'b'],
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });
});

describe('FIXED-WIDTH UNROLL — Map with a bare user-function head', () => {
  // A callback written as a bare NAME rather than as a lambda. The JavaScript
  // target lowered it as a runtime `.map` over an array, and the interval
  // target, which holds one interval and cannot hold a collection, declined
  // the whole expression.
  const ce = scalarEngine();
  const define = (name: string, body: any, ...params: string[]) =>
    ce.box(['DefineFunction', name, ['Function', body, ...params]]).evaluate();
  define('h', ['Multiply', 2, '_1'], '_1');
  define('two', ['Add', '_1', '_2'], '_1', '_2');
  define('noisy', ['Multiply', ['Random'], '_1'], '_1');
  const unrolled = (json: any) => unrollFixedWidthCollections(ce.box(json));

  it('applies the named function once per element', () => {
    expect(unrolled(['Map', 'h', FIVE]).json).toEqual([
      'List',
      ['h', 'a'],
      ['h', 'b'],
      ['h', 'c'],
      ['h', 'd'],
      ['h', 's'],
    ]);
  });

  it('emits a literal array of calls on javascript', () => {
    const r: any = compile(ce.box(['Map', 'h', FIVE]), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    const source = `${r.preamble ?? ''}${r.code ?? ''}`;
    expect(source).toContain(
      '[_fn_h(_.a), _fn_h(_.b), _fn_h(_.c), _fn_h(_.d), _fn_h(_.s)]'
    );
    expect(source).not.toContain('.map(');
    // The compiled values are the interpreter's own, element by element.
    const args = { a: 1, b: 2, c: 3, d: 4, s: 5 };
    const want = Object.values(args).map((k) => ce.box(['h', k]).evaluate().re);
    expect(r.run(args)).toEqual(want);
  });

  it('compiles `Min(Map(h, …))` on interval-js', () => {
    // The reduction rule turns the unrolled list into an n-ary `Min`, which
    // this target folds with `_IA.min`. Before the unroll the `Map` and its
    // `List` had no lowering here at all.
    const r: any = compile(ce.box(['Min', ['Map', 'h', FIVE]]), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(`${r.preamble ?? ''}${r.code ?? ''}`).toContain('_IA.min');
  });

  it('leaves a TWO-PARAMETER head untouched', () => {
    // `Map` calls its callback with one argument, so the canonical form of
    // this expression is already a `callback-arity` error rather than a
    // symbol operand. The pass is also asked directly, with the node built
    // structurally, so the arity gate itself is exercised.
    const canonical = ce.box(['Map', 'two', FIVE]);
    expect(unrollFixedWidthCollections(canonical)).toBe(canonical);
    const structural = ce.function('Map', [ce.symbol('two'), ce.box(FIVE)], {
      form: 'structural',
    } as any);
    expect(unrollFixedWidthCollections(structural)).toBe(structural);
  });

  it('leaves an IMPURE element untouched', () => {
    const expr = ce.box(['Map', 'h', ['List', ['Random'], 'b', 'c', 'd', 's']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves an IMPURE call untouched', () => {
    // Two elements of a list may be the same expression, and the emitters
    // bind an identical call once. That would run an effect fewer times than
    // the interpreter does.
    const expr = ce.box(['Map', 'noisy', FIVE]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a LIBRARY operator head untouched', () => {
    // A target may lower an operator applied to a collection differently
    // from a list of separate applications.
    const expr = ce.box(['Map', 'Sin', FIVE]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a list of unknown length untouched', () => {
    const expr = ce.box(['Map', 'h', 'L']);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a NARROW list untouched', () => {
    const expr = ce.box(['Map', 'h', ['List', 'a', 'b']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });
});

describe('FIXED-WIDTH UNROLL — reductions over a literal list', () => {
  const ce = scalarEngine();
  const unrolled = (json: any) => unrollFixedWidthCollections(ce.box(json));

  it('makes Min and Max n-ary', () => {
    expect(unrolled(['Min', FIVE]).json).toEqual([
      'Min',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
    expect(unrolled(['Max', FIVE]).json).toEqual([
      'Max',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it('makes Sum an Add', () => {
    expect(unrolled(['Sum', FIVE]).json).toEqual([
      'Add',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it('leaves an EMPTY list untouched', () => {
    // Each reduction has its own identity element for the empty list, which
    // the interpreter supplies and this rewrite would not.
    const expr = ce.box(['Min', ['List']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('makes a NARROW list n-ary too', () => {
    // A reduction has NO width gate. The claim behind the gate — that a
    // narrow list already has a native lowering — is false here: the interval
    // target's `Min` handler reads the n-ary shape only, so `Min([a, b, c])`
    // compiles its `List` operand, for which that target has no lowering at
    // all.
    expect(unrolled(['Min', ['List', 'a', 'b', 'c']]).json).toEqual([
      'Min',
      'a',
      'b',
      'c',
    ]);
    expect(unrolled(['Sum', ['List', 'a', 'b']]).json).toEqual([
      'Add',
      'a',
      'b',
    ]);
  });

  it('compiles a NARROW Min over a list on interval-js', () => {
    const r: any = compile(ce.box(['Min', ['List', 'a', 'b', 'c']]), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(`${r.preamble ?? ''}${r.code ?? ''}`).toContain('_IA.min');
  });

  it('leaves a list of NUMBER LITERALS untouched', () => {
    const expr = ce.box(['Sum', ['List', 1, 2, 3, 4, 5]]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a list of unknown length untouched', () => {
    const expr = ce.box(['Min', 'L']);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  // `Reduce(collection, combiner, initial?)` is the shape canonicalization
  // gives `Product`, so a product over a literal list reaches the pass as a
  // fold rather than under its own head. A left fold equals the flat n-ary
  // form only for an ASSOCIATIVE and COMMUTATIVE combiner, so the rewrite
  // reads the combiner and rewrites four of them.
  it('makes a Product an n-ary Multiply', () => {
    const product = ce.box(['Product', FIVE]);
    expect(product.json).toEqual(['Reduce', FIVE, 'Multiply', 1]);
    expect(unrollFixedWidthCollections(product).json).toEqual([
      'Multiply',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it.each(['javascript', 'interval-js'] as const)(
    'compiles a Product as n-ary multiplication on %s',
    (to) => {
      const r: any = compile(ce.box(['Product', FIVE]), {
        to,
        fallback: false,
      } as any);
      expect(r.success).not.toBe(false);
      expect(`${r.preamble ?? ''}${r.code ?? ''}`).not.toContain('reduce');
    }
  );

  it('runs a compiled Product to the interpreter value', () => {
    const r: any = compile(ce.box(['Product', FIVE]), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(`${r.preamble ?? ''}${r.code ?? ''}`).toContain(
      '_.a * _.b * _.c * _.d * _.s'
    );
    expect(r.run({ a: 2, b: 3, c: 4, d: 5, s: 6 })).toBe(720);
  });

  it('drops an initial value that is the identity of the combiner', () => {
    // `0` leaves a sum unchanged and `1` a product, so emitting it would only
    // lengthen the generated code.
    expect(unrolled(['Reduce', FIVE, 'Add', 0]).json).toEqual([
      'Add',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
    expect(unrolled(['Reduce', FIVE, 'Multiply', 1]).json).toEqual([
      'Multiply',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it('keeps a NON-IDENTITY initial value as the first operand', () => {
    expect(unrolled(['Reduce', FIVE, 'Add', 10]).json).toEqual([
      'Add',
      10,
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
    // `Min` and `Max` have no finite identity, so any initial value is kept.
    expect(unrolled(['Reduce', FIVE, 'Max', 3]).json).toEqual([
      'Max',
      3,
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it('rewrites a SEEDLESS fold with no extra operand', () => {
    // A seedless fold starts from the first element, which the n-ary form
    // does too.
    expect(unrolled(['Reduce', FIVE, 'Min']).json).toEqual([
      'Min',
      'a',
      'b',
      'c',
      'd',
      's',
    ]);
  });

  it('agrees with the interpreter on a seeded fold', () => {
    const engine = new ComputeEngine();
    const seeded = engine.box(['Reduce', ['List', 1, 2, 3, 4, 5], 'Max', 3]);
    expect(unrollFixedWidthCollections(seeded).evaluate().re).toEqual(
      seeded.evaluate().re
    );
  });

  it('leaves a LAMBDA combiner untouched', () => {
    // The pass cannot prove an arbitrary reducer associative and commutative.
    const expr = ce.box([
      'Reduce',
      FIVE,
      ['Function', ['Multiply', '_1', '_2'], '_1', '_2'],
      1,
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves an IMPURE initial value untouched', () => {
    // Dropping an identity seed would remove its effect, and keeping one would
    // move it ahead of the first element.
    const expr = ce.box(['Reduce', FIVE, 'Add', ['Random']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves an EMPTY Reduce untouched', () => {
    const expr = ce.box(['Reduce', ['List'], 'Add', 0]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a Reduce over NUMBER LITERALS untouched', () => {
    const expr = ce.box(['Reduce', ['List', 1, 2, 3, 4, 5], 'Add', 0]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });
});

describe('FIXED-WIDTH UNROLL — scalar-versus-list arithmetic', () => {
  const ce = scalarEngine();
  const unrolled = (json: any) => unrollFixedWidthCollections(ce.box(json));

  const minus = (e: string) => ['Add', ['Negate', e], 'x'];

  it('distributes a scalar operand over the elements', () => {
    // `x - [a, …]` canonicalizes to `x + (-[a, …])`, so the rewrite runs
    // through `Negate` and then `Add`.
    expect(unrolled(['Subtract', 'x', FIVE]).json).toEqual([
      'List',
      minus('a'),
      minus('b'),
      minus('c'),
      minus('d'),
      minus('s'),
    ]);
  });

  it('distributes a unary elementary head', () => {
    expect(unrolled(['Sin', FIVE]).json).toEqual([
      'List',
      ['Sin', 'a'],
      ['Sin', 'b'],
      ['Sin', 'c'],
      ['Sin', 'd'],
      ['Sin', 's'],
    ]);
  });

  it('distributes an exponent', () => {
    expect(unrolled(['Power', FIVE, 2]).json).toEqual([
      'List',
      ['Power', 'a', 2],
      ['Power', 'b', 2],
      ['Power', 'c', 2],
      ['Power', 'd', 2],
      ['Power', 's', 2],
    ]);
  });

  it('zips two literal lists of the same width', () => {
    const other = ['List', 'c', 'd', 's', 'a', 'b'];
    expect(unrolled(['Add', FIVE, other]).json).toEqual([
      'List',
      ['Add', 'a', 'c'],
      ['Add', 'b', 'd'],
      ['Add', 'c', 's'],
      ['Add', 'a', 'd'],
      ['Add', 'b', 's'],
    ]);
  });

  it('leaves two lists with an IMPURE element untouched', () => {
    // The zip INTERLEAVES the two lists — e1, f1, e2, f2, … — where the
    // original evaluates every element of the first, then every element of
    // the second. Under a seeded engine that pairs different `Random()` draws
    // with each other (`docs/RANDOMNESS-MODEL.md`).
    const expr = ce.box([
      'Add',
      ['List', ['Random'], 'b', 'c', 'd', 's'],
      ['List', ['Random'], 'd', 's', 'a', 'b'],
    ]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves two literal lists of DIFFERENT widths untouched', () => {
    const expr = ce.box(['Add', FIVE, ['List', 'c', 'd', 's', 'a', 'b', 'c']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a NARROW list untouched', () => {
    const expr = ce.box(['Subtract', 'x', ['List', 'a', 'b']]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a list of NUMBER LITERALS untouched', () => {
    const expr = ce.box(['Sin', ['List', 1, 2, 3, 4, 5]]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves a list of unknown length untouched', () => {
    const expr = ce.box(['Add', 'x', 'L']);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('leaves an IMPURE scalar operand untouched', () => {
    // The scalar is repeated once per element; an impure one would then run
    // its effect N times where the interpreter runs it once.
    const expr = ce.box(['Multiply', ['Random'], FIVE]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });

  it('composes with a reduction', () => {
    expect(unrolled(['Min', ['Subtract', 'x', FIVE]]).json).toEqual([
      'Min',
      minus('a'),
      minus('b'),
      minus('c'),
      minus('d'),
      minus('s'),
    ]);
  });

  it('leaves an expression with no collection untouched', () => {
    const expr = ce.box(['Add', 'x', 1]);
    expect(unrollFixedWidthCollections(expr)).toBe(expr);
  });
});

describe('FIXED-WIDTH UNROLL — a head the caller overrode', () => {
  const ce = scalarEngine();

  it('leaves an overridden head to the caller implementation', () => {
    // The caller's `Add` replaces the emission and is handed the operands of
    // the node it covers. Without the skip the pass unrolls the list first,
    // and the per-element `Add` nodes it produces are emitted as the built-in
    // `+` — the override disappears from the generated code entirely.
    const r: any = compile(ce.box(['Add', 'x', FIVE]), {
      to: 'javascript',
      functions: { Add: 'customAdd' },
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    const source = `${r.preamble ?? ''}${r.code ?? ''}`;
    expect(source).toContain('customAdd');
    // The list reaches the broadcast helper whole, as it does with no pass at
    // all.
    expect(source).toContain('_SYS.bcast');
    expect(source).toContain('[_.a, _.b, _.c, _.d, _.s]');
  });

  it('still unrolls a head the caller did NOT override', () => {
    const r: any = compile(ce.box(['Add', 'x', FIVE]), {
      to: 'javascript',
      functions: { customThing: '((t) => t)' },
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    expect(`${r.preamble ?? ''}${r.code ?? ''}`).not.toContain('_SYS.bcast');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The Voronoi chain of the Desmos state `62urmx2dcm`.
//
//   n = 4, h = 1/n
//   S(x, y, s) = Mod(10000·sin(10000·(⌊nx⌋ + n⌊ny⌋ + s)), 1)   — a hash
//   P(x, y)    = (1/n)·(⌊nx⌋, ⌊ny⌋) + (1/n)·(S(x,y,0), S(x,y,0.5))
//   V(x, y)    = the nine P's of the 3×3 neighborhood
//   d(x, y)    = (x − V.x)² + (y − V.y)²      — nine squared distances
//   m(x, y)    = min d
//   d2(x, y)   = d with the minimum replaced by 1e9
//   row(x, y)  = (1/16)² − |min d2 − m|
// ─────────────────────────────────────────────────────────────────────────

const N_CELLS = 16;
const N = 4;
const H_STEP = 1 / N;
const OFFSETS: Array<[number, number]> = [
  [-H_STEP, -H_STEP],
  [0, -H_STEP],
  [H_STEP, -H_STEP],
  [-H_STEP, 0],
  [0, 0],
  [H_STEP, 0],
  [-H_STEP, H_STEP],
  [0, H_STEP],
  [H_STEP, H_STEP],
];

const hash = (a: any) => [
  'Mod',
  ['Multiply', 10000, ['Sin', ['Multiply', 10000, a]]],
  1,
];
const S = (x: any, y: any, s: number) =>
  hash([
    'Add',
    ['Floor', ['Multiply', N, x]],
    ['Multiply', N, ['Floor', ['Multiply', N, y]]],
    s,
  ]);
const P = (x: any, y: any) => [
  'Add',
  [
    'Multiply',
    ['Divide', 1, N],
    ['PointList', ['Floor', ['Multiply', N, x]], ['Floor', ['Multiply', N, y]]],
  ],
  ['Multiply', ['Divide', 1, N], ['PointList', S(x, y, 0), S(x, y, 0.5)]],
];
const V = (x: any, y: any) => [
  'List',
  ...OFFSETS.map(([dx, dy]) => P(['Add', x, dx], ['Add', y, dy])),
];
const D = (x: any, y: any) => [
  'Add',
  ['Square', ['Subtract', x, ['PointX', V(x, y)]]],
  ['Square', ['Subtract', y, ['PointY', V(x, y)]]],
];
const M = (x: any, y: any) => ['Min', D(x, y)];
const D2 = (x: any, y: any) => [
  'Map',
  ['Function', ['Which', ['Equal', '_', M(x, y)], 1e9, 'True', '_'], '_'],
  D(x, y),
];
const ROW = (x: any, y: any) => [
  'Subtract',
  ['Power', ['Divide', 1, N_CELLS], 2],
  ['Abs', ['Subtract', ['Min', D2(x, y)], M(x, y)]],
];

const SAMPLES: Array<[number, number]> = Array.from({ length: 20 }, (_, i) => [
  -1 + (i % 5) * 0.37,
  -0.8 + Math.floor(i / 5) * 0.41,
]);

describe('FIXED-WIDTH UNROLL — Voronoi route parity (inlined)', () => {
  const ce = new ComputeEngine();

  it.each(['javascript', 'glsl', 'wgsl', 'interval-js'] as const)(
    'compiles the inlined `m` on %s',
    (to) => {
      const r: any = compile(ce.box(M('x', 'y') as any), {
        to,
        fallback: false,
      } as any);
      expect(r.success).not.toBe(false);
    }
  );

  it.each(['javascript', 'glsl', 'wgsl', 'interval-js'] as const)(
    'compiles the inlined row on %s',
    (to) => {
      const r: any = compile(ce.box(ROW('x', 'y') as any), {
        to,
        fallback: false,
      } as any);
      expect(r.success).not.toBe(false);
    }
  );

  it('emits scalar shader code for `m`, with no array constructor', () => {
    for (const to of ['glsl', 'wgsl'] as const) {
      const r: any = compile(ce.box(M('x', 'y') as any), {
        to,
        fallback: false,
      } as any);
      const source = `${r.preamble ?? ''}${r.code ?? ''}`;
      expect(source).not.toContain('float[');
      expect(source).not.toContain('array<f32');
    }
  });

  it('emits an n-ary interval minimum for `m`', () => {
    const r: any = compile(ce.box(M('x', 'y') as any), {
      to: 'interval-js',
      fallback: false,
    } as any);
    expect(`${r.preamble ?? ''}${r.code ?? ''}`).toContain('_IA.min');
  });
});

describe('FIXED-WIDTH UNROLL — Voronoi numeric parity', () => {
  // `evaluate()` of the row is the interpreter's own scalar reduction of the
  // same expression: it distributes the coordinate accessors and unrolls the
  // `Map` exactly as this pass does, so its compiled form is an independent
  // oracle for the compiled unrolled one.
  it('agrees with the interpreter at 20 sample points', () => {
    const ce = new ComputeEngine();
    const row = ce.box(ROW('x', 'y') as any);
    const compiled: any = compile(row, {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(compiled.success).not.toBe(false);

    const evaluated = row.evaluate();
    const oracle: any = compile(evaluated, {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(oracle.success).not.toBe(false);

    for (const [x, y] of SAMPLES) {
      const got = compiled.run({ x, y }) as number;
      const want = oracle.run({ x, y }) as number;
      expect(Number.isFinite(got)).toBe(true);
      expect(Math.abs(got - want)).toBeLessThan(1e-9);
    }

    // One point checked against the INTERPRETER itself, with no compilation
    // on either side of the comparison.
    const [x0, y0] = SAMPLES[0];
    const interpreted = evaluated
      .subs({ x: ce.number(x0), y: ce.number(y0) })
      .N();
    expect(
      Math.abs((compiled.run({ x: x0, y: y0 }) as number) - interpreted.re)
    ).toBeLessThan(1e-9);
  }, 60000);
});

describe('FIXED-WIDTH UNROLL — Voronoi route parity (by reference)', () => {
  // The by-reference chain reaches the pass through the INLINER: `d` returns
  // `list<tuple<number, number>^9>`, which no shader or interval target can
  // hold, so its definition declines and the call is inlined instead. The
  // inliner substitutes the body, substitutes the nested collection-valued
  // calls it contains (`V`), and unrolls the result.
  //
  // `x` and `y` are DECLARED: the inliner only substitutes an argument it can
  // prove is not a collection, and an undeclared symbol types `unknown`.
  const ce = new ComputeEngine();
  ce.declare('x', 'number');
  ce.declare('y', 'number');
  const define = (name: string, body: any) =>
    ce.box(['DefineFunction', name, ['Function', body, 'x', 'y']]).evaluate();
  define('V', V('x', 'y'));
  define('d', [
    'Add',
    ['Square', ['Subtract', 'x', ['PointX', ['V', 'x', 'y']]]],
    ['Square', ['Subtract', 'y', ['PointY', ['V', 'x', 'y']]]],
  ]);
  define('m', ['Min', ['d', 'x', 'y']]);
  define('d2', [
    'Map',
    [
      'Function',
      ['Which', ['Equal', '_', ['m', 'x', 'y']], 1e9, 'True', '_'],
      '_',
    ],
    ['d', 'x', 'y'],
  ]);
  define('m2', ['Min', ['d2', 'x', 'y']]);
  define('row', [
    'Subtract',
    ['Power', ['Divide', 1, N_CELLS], 2],
    ['Abs', ['Subtract', ['m2', 'x', 'y'], ['m', 'x', 'y']]],
  ]);

  it.each(['glsl', 'wgsl', 'interval-js'] as const)(
    'compiles the by-reference `m(x, y)` on %s',
    (to) => {
      const r: any = compile(ce.box(['m', 'x', 'y']), {
        to,
        fallback: false,
      } as any);
      expect(r.success).not.toBe(false);
    }
  );

  it.each(['glsl', 'wgsl', 'interval-js'] as const)(
    'compiles the by-reference `row(x, y)` on %s',
    (to) => {
      // `d2`'s whole body is a `Map`, which BINDS the lambda parameter. A
      // decline on the mere presence of a binder refused to inline `d2` and
      // this row failed closed on every target that cannot hold a collection.
      // The substitution is capture-safe here — the lambda's `_` is neither a
      // parameter being substituted nor a symbol of an argument — so it
      // inlines.
      const r: any = compile(ce.box(['row', 'x', 'y']), {
        to,
        fallback: false,
      } as any);
      expect(r.success).not.toBe(false);
    }
  );

  it('unrolls a definition body through its `Block`', () => {
    // A canonical user-function body is a `Block` whose local scope binds the
    // parameters. The pass rebuilds such a node onto its OWN scope, so it can
    // reach the collection inside; the emitted definition is then a flat
    // n-ary `Math.min` rather than a reduce over a runtime array.
    const engine = new ComputeEngine();
    engine.declare('u', 'number');
    engine.box([
      'DefineFunction',
      'wide',
      [
        'Function',
        [
          'Min',
          [
            'List',
            ['Add', 'u', 1],
            ['Add', 'u', 2],
            ['Add', 'u', 3],
            ['Add', 'u', 4],
            ['Add', 'u', 5],
          ],
        ],
        'u',
      ],
    ]).evaluate();
    const r: any = compile(engine.box(['wide', 'u']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    const source = `${r.preamble ?? ''}${r.code ?? ''}`;
    expect(source).toContain('Math.min(');
    expect(source).not.toContain('reduce');
    expect(r.run({ u: 10 })).toBe(11);
  });

  it('agrees with the interpreter on javascript', () => {
    const r: any = compile(ce.box(['m', 'x', 'y']), {
      to: 'javascript',
      fallback: false,
    } as any);
    expect(r.success).not.toBe(false);
    for (const [x, y] of SAMPLES.slice(0, 5)) {
      const want = ce.box(M(ce.number(x), ce.number(y)) as any).N()
        .re as number;
      expect(Math.abs((r.run({ x, y }) as number) - want)).toBeLessThan(1e-9);
    }
  }, 60000);
});
