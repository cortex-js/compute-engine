/**
 * Issue #425, two defects of `Fold` / `Reduce` with an initial value.
 *
 * 1. `Reduce` holds its operands, so the initial value arrives as written. A
 *    fold over a non-empty collection evaluates it inside its first step, but
 *    a fold over an EMPTY collection returned it unevaluated:
 *    `Fold((v, i) => v + i, 1 + Mod(4, 3), [])` was `1 + Mod(4, 3)` where the
 *    same fold over `[5]` was `7`. The seed is now evaluated before the walk.
 *
 * 2. A bare accumulator read through `At` at an INDEX position
 *    (`(s, k) => [p[s[1]], 0]`) was inferred
 *    `indexed_collection<boolean | character | indexed_collection<any> |
 *    number | string>` from that use (the index parameter of `At` accepts
 *    every kind of value), and the fixpoint refinement of the accumulator
 *    (`refineFoldAccumulator`) did not run because the element type was
 *    neither `unknown` nor `any`. The JavaScript target then refused `s[1]`
 *    ("may be text at run time") although the seed `[a, 0]` is a list of
 *    integers. An element type that admits a collection and a scalar at once
 *    now counts as imprecise, so the accumulator is typed from its seed.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const SEED = ['Add', 1, ['Mod', 4, 3]];
const ADD = ['Function', ['Add', 'v', 'i'], 'v', 'i'];
const fold = (collection: unknown, seed: unknown = SEED) => [
  'Fold',
  ADD,
  seed,
  collection,
];

describe('issue #425: an empty fold evaluates its initial value', () => {
  const ce = new ComputeEngine();

  it('folds the seed into a non-empty collection (unchanged)', () => {
    expect(ce.box(fold(['List', 5]) as any).evaluate().json).toEqual(7);
  });

  it('Fold over an empty list', () => {
    expect(ce.box(fold(['List']) as any).evaluate().json).toEqual(2);
  });

  it('Reduce over an empty list', () => {
    expect(
      ce.box(['Reduce', ['List'], ADD, SEED] as any).evaluate().json
    ).toEqual(2);
  });

  it('Reduce with a named reducer over an empty list', () => {
    expect(
      ce.box(['Reduce', ['List'], 'Add', SEED] as any).evaluate().json
    ).toEqual(2);
  });

  it('a lazy Map whose elements are empty folds lists the evaluated seed', () => {
    const inner = fold(['Range', 1, 0, 1]);
    const expr = ce.box([
      'List',
      ['Map', ['Function', inner, 'j'], ['Range', 1, 2]],
    ] as any);
    expect(expr.evaluate().json).toEqual(['List', ['List', 2, 2]]);
  });

  it('keeps an exact seed exact under evaluate() and numericizes it under N()', () => {
    const expr = ce.box(fold(['List'], ['Sqrt', 2]) as any);
    expect(expr.evaluate().json).toEqual(['Sqrt', 2]);
    expect(expr.N().re).toBeCloseTo(Math.SQRT2, 12);
  });

  it('evaluates under N() as well', () => {
    expect(ce.box(fold(['List']) as any).N().json).toEqual(2);
  });

  it('reads the value of a symbol seed', () => {
    const ce2 = new ComputeEngine();
    ce2.assign('q', 5);
    expect(ce2.box(fold(['List'], 'q') as any).evaluate().json).toEqual(5);
    expect(ce2.box(fold(['List', 1], 'q') as any).evaluate().json).toEqual(6);
  });

  it('a seedless Reduce over an empty list is still Nothing', () => {
    expect(
      ce.box(['Reduce', ['List'], ADD] as any).evaluate().symbol
    ).toEqual('Nothing');
  });

  it('N() of a non-empty fold starts from the value of a compound seed', () => {
    expect(ce.box(fold(['List', 5]) as any).N().json).toEqual(7);
  });

  it('parse route: empty and non-empty', () => {
    const empty = ce.parse(
      '\\operatorname{Fold}((v, i) \\mapsto v + i, 1 + \\operatorname{Mod}(4, 3), [])'
    );
    expect(empty.evaluate().json).toEqual(2);
    const one = ce.parse(
      '\\operatorname{Fold}((v, i) \\mapsto v + i, 1 + \\operatorname{Mod}(4, 3), [5])'
    );
    expect(one.evaluate().json).toEqual(7);
  });

  it('a collection seed is not materialized to its display preview', () => {
    // `materialization` describes the result of the evaluation. Forwarded to
    // the seed, a `Range(1, 5000)` became the eleven-element preview before
    // the first step, and this fold answered 11.
    const expr = ce.box([
      'Fold',
      ['Function', ['Length', 'a'], 'a', 'x'],
      ['Range', 1, 5000],
      ['List', 0],
    ] as any);
    expect(expr.evaluate({ materialization: [5, 5] }).json).toEqual(5000);
    expect(expr.evaluate().json).toEqual(5000);
  });

  it('the seed is not evaluated when the walk declines', () => {
    // A `Linspace` with a symbolic endpoint has a count but no elements:
    // the fold stays inert, and the seed's assignment must not run.
    const ce2 = new ComputeEngine();
    ce2.assign('hits', 0);
    const expr = ce2.box([
      'Fold',
      ADD,
      ['Block', ['Assign', 'hits', ['Add', 'hits', 1]], 1],
      ['Linspace', 'z', 1, 3],
    ] as any);
    const result = expr.evaluate();
    expect(result.operator).toEqual('Reduce');
    expect(ce2.box('hits').evaluate().json).toEqual(0);
  });
});

describe('issue #425: a list accumulator indexed by its own element compiles', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'integer');
    ce.declare('n', 'integer');
    ce.declare('p', 'list<integer>');
    return ce;
  }
  const walk = (index: unknown) => [
    'Fold',
    ['Function', ['List', ['At', 'p', index], 0], 's', 'k'],
    ['List', 'a', 0],
    ['Range', 1, 'n', 1],
  ];
  const SELF_INDEXED = walk(['At', 's', 1]);

  it('types the accumulator from its seed, not from the index use', () => {
    const ce = engine();
    const reduce = ce.box(SELF_INDEXED as any);
    const fn = reduce.ops![1];
    expect(fn.ops![1].type.toString()).toEqual('list<integer | nan^2>');
    expect(reduce.type.toString()).toEqual('list<integer | nan^2>');
  });

  it('compiles, and the compiled result matches the interpreter', () => {
    const ce = engine();
    const expr = ce.box(SELF_INDEXED as any);
    const compiled = compile(expr, { fallback: false });
    // s = [2, 0] → [p[2], 0] = [1, 0] → [p[1], 0] = [3, 0] → [p[3], 0] = [2, 0]
    expect(compiled.run!({ a: 2, n: 3, p: [3, 1, 2] })).toEqual([2, 0]);
    expect(compiled.run!({ a: 2, n: 2, p: [3, 1, 2] })).toEqual([3, 0]);
    expect(compiled.run!({ a: 2, n: 0, p: [3, 1, 2] })).toEqual([2, 0]);

    ce.assign('a', 2);
    ce.assign('n', 2);
    ce.assign('p', ce.box(['List', 3, 1, 2]));
    expect(expr.evaluate().json).toEqual(['List', 3, 0]);
  });

  it('a literal index still compiles (unchanged)', () => {
    const ce = engine();
    const compiled = compile(ce.box(walk(2) as any), { fallback: false });
    expect(compiled.run!({ a: 2, n: 3, p: [3, 1, 2] })).toEqual([1, 0]);
  });
});
