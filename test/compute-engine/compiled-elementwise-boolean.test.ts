/**
 * Element-wise COMPILED comparisons and logical connectives.
 *
 * These heads lower to raw JavaScript infix operators (`<`, `&&`, `!`), which
 * are silently wrong on an array:
 *
 *   - `0 < [1, 0, 1]` stringifies the array (`0 < "1,0,1"`) → scalar `false`;
 *   - a JS array is TRUTHY, so `m1 && m2` returns a whole operand and `!m`
 *     returns `false`.
 *
 * They used to fail closed, which was correct but sent the Desmos filter form
 * `L[|[1...n]-k|>0]` to the interpreter. They now broadcast through
 * `_SYS.bcast`, wrapping the head's own scalar codegen, under two rulings that
 * apply to EVERY broadcast (see ROADMAP.md, "Element-wise compiled
 * comparisons"):
 *
 *   1. broadcast operands are evaluated ONCE, then the operation maps over
 *      cells (the NumPy/Julia/R model);
 *   2. a length mismatch is an ERROR (`incompatible-dimensions`) — no
 *      truncation, no recycling — which a real compile target projects as NaN.
 *
 * Per-POSITION projection falls out of recursing per position rather than
 * post-scanning the result: an empty or mismatched position yields NaN without
 * poisoning its siblings.
 *
 * The soundness boundary is NOT the static type: `q(L)` with `q: t ↦ n·t+1`
 * types `list<unknown>`, yet the compiled callee emits the scalar body and
 * returns NaN on an array. Arithmetic tolerates that (NaN stays NaN); a
 * comparison would turn it into a plausible `false`. So an operand must
 * provably COMPILE to an array — concrete collection, list-typed symbol, or a
 * built-in broadcastable head over one of those.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.assign('k', ce.box(2 as any));

/** Interpretation, projected the way a real target represents it. */
function interpreted(expr: BoxedExpression): unknown {
  const project = (x: BoxedExpression): unknown => {
    if (x.symbol === 'True') return true;
    if (x.symbol === 'False') return false;
    if (x.symbol === 'Nothing') return NaN;
    if (x.operator === 'Error') return NaN;
    if (x.operator === 'List') return (x.ops ?? []).map(project);
    return x.re;
  };
  return project(expr.evaluate());
}

/** Compile `expr`, run it, and assert it matches interpretation. */
function parity(expr: BoxedExpression): unknown {
  const r = compile(expr);
  expect(r?.success).toBe(true);
  const compiled = r!.run!();
  expect(compiled).toEqual(interpreted(expr));
  return compiled;
}

/** `[True, False, True]` — a mask that is only an array at RUN time. */
const m1 = () => ce.parse('|[1...3]-k|>0');
/** `[False, True, True]` — a second, differently-shaped mask. */
const m2 = () => ce.parse('[1...3]>1');

describe('a computed collection operand broadcasts element-wise', () => {
  test('an ordering over a computed collection', () => {
    expect(parity(m1())).toEqual([true, false, true]);
    expect(parity(m2())).toEqual([false, true, true]);
  });

  test('the connectives over computed collections', () => {
    expect(parity(ce.box(['And', m1(), m2()] as any))).toEqual([
      false,
      false,
      true,
    ]);
    expect(parity(ce.box(['Or', m1(), m2()] as any))).toEqual([
      true,
      true,
      true,
    ]);
    expect(parity(ce.box(['Not', m1()] as any))).toEqual([false, true, false]);
  });

  test('a declared collection-typed operand', () => {
    const engine = new ComputeEngine();
    engine.declare('xs', 'list<real>');
    const r = compile(engine.box(['Less', 0, 'xs'] as any));
    expect(r?.success).toBe(true);
    expect(r!.run!({ xs: [1, -2, 3] })).toEqual([true, false, true]);
  });

  test('the Desmos filter form that motivated this compiles', () => {
    // `L[|[1...n]-k|>0]` used to compile to NaN, because its mask collapsed to
    // a scalar `false` before `_SYS.at` ever saw it; then it failed closed.
    expect(parity(ce.parse('[10,20,30][|[1...3]-k|>0]'))).toEqual([10, 30]);
  });
});

describe('ruling 1 — broadcast operands are evaluated ONCE', () => {
  // `L < Random()` draws ONE number and compares every cell against it. A
  // per-cell draw is written explicitly: `Map(L, l ↦ l < Random())`.
  const cells = ['List', 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];

  test('an impure scalar operand is drawn once (compiled)', () => {
    const r = compile(ce.box(['Less', cells, ['Random']] as any));
    expect(r?.success).toBe(true);
    const out = r!.run!() as boolean[];
    expect(out).toHaveLength(6);
    expect(new Set(out).size).toBe(1);
  });

  test('an impure scalar operand is drawn once (interpreted)', () => {
    const out = interpreted(ce.box(['Less', cells, ['Random']] as any));
    expect(out).toHaveLength(6);
    expect(new Set(out as boolean[]).size).toBe(1);
  });

  test('an impure operand that IS the traversed collection still draws per cell', () => {
    // The draws are the cells here, not a lifted scalar — each is its own.
    const expr = ce.box([
      'Less',
      ['List', ['Random'], ['Random'], ['Random'], ['Random']],
      2,
    ] as any);
    expect(interpreted(expr)).toEqual([true, true, true, true]);
  });
});

describe('ruling 2 — a length mismatch is an error, not a truncation', () => {
  test('interpretation answers incompatible-dimensions', () => {
    const expr = ce.box(['Less', ['List', 1, 2, 3], ['List', 2, 2]] as any);
    const v = expr.evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toMatch(/incompatible-dimensions/);
  });

  test('the compiled form projects it as NaN, matching interpretation', () => {
    // It used to truncate to `[true, false]` — the longer operand's tail was
    // silently dropped, while the arithmetic broadcast has always errored.
    expect(
      parity(ce.box(['Less', ['List', 1, 2, 3], ['List', 2, 2]] as any))
    ).toBeNaN();
  });

  test('the connectives mismatch the same way', () => {
    const expr = ce.box([
      'And',
      ['List', 'True', 'True', 'False'],
      ['List', 'True', 'True'],
    ] as any);
    expect(expr.evaluate().toString()).toMatch(/incompatible-dimensions/);
  });

  test('a scalar operand is a LIFT, never a mismatch', () => {
    expect(parity(ce.box(['Less', ['List', 1, 2, 3], 2] as any))).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('equal lengths are unaffected', () => {
    expect(
      parity(ce.box(['Less', ['List', 1, 2, 3], ['List', 2, 2, 2]] as any))
    ).toEqual([true, false, false]);
  });

  test('SIZE does not decide the semantics', () => {
    // Past the eager threshold a broadcast returns the lazy `Map` form, which
    // zips to the shortest source. The length check therefore runs BEFORE the
    // lazy form is built — otherwise a mismatch would error on a short
    // collection and silently truncate on a long one.
    const big = ce.box(['Less', ['Range', 1, 2000], ['Range', 1, 1500]] as any);
    expect(big.evaluate().toString()).toMatch(/incompatible-dimensions/);
    // Arithmetic had the same hole, in the other direction: it errored eagerly
    // and truncated lazily.
    const bigAdd = ce.box(['Add', ['Range', 1, 2000], ['Range', 1, 1500]] as any);
    expect(bigAdd.evaluate().toString()).toMatch(/incompatible-dimensions/);
    // Equal lengths still take the lazy path, unmaterialized.
    const ok = ce.box(['Less', ['Range', 1, 2000], ['Range', 1, 2000]] as any);
    expect(ok.evaluate().count).toBe(2000);
  });

  test('a lazy broadcast draws its lifted operand once, too', () => {
    // The lazy `Map` closes over the EVALUATED operand, so every element sees
    // the same draw rather than re-drawing on access. (A lazy `Map`'s `.ops`
    // are its OPERANDS — source and lambda — so the elements come from
    // `each()`, which materializes.)
    const r = ce.box(['Add', ['Range', 1, 2000], ['Random']] as any).evaluate();
    expect(r.operator).toBe('Map');
    const it = r.each();
    const first = it.next().value!.re;
    const second = it.next().value!.re;
    expect(second - first).toBeCloseTo(1, 10);
  });
});

describe('per-position projection', () => {
  test('an empty operand is Nothing, not an empty list', () => {
    expect(parity(ce.box(['Not', ['List']] as any))).toBeNaN();
  });

  test('an empty POSITION does not poison its siblings', () => {
    // The withdrawn implementation collapsed the whole result to a scalar NaN
    // by post-scanning; recursing per position keeps `[False]` intact.
    const out = parity(
      ce.box(['Not', ['List', ['List'], ['List', 'True']]] as any)
    ) as unknown[];
    expect(out).toHaveLength(2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toEqual([false]);
  });
});

describe('the mismatch ruling reaches every broadcast path', () => {
  // Review round: the first implementation checked lengths only at the
  // `BoxedFunction` broadcast steps, so `Add`/`Multiply` — which reach their
  // element-wise path through `broadcastOverIndexedCollections` — still
  // zip-to-shortest whenever `addTensors` did not catch the shape. The same
  // operand shape then errored under `Less` and truncated under `Add`.
  const filter = ['Filter', ['Range', 1, 5], ['Function', ['Greater', '_', 2], '_']];

  test('Add over a Filter source of a different length', () => {
    expect(
      ce.box(['Add', filter, ['List', 1, 2, 3, 4, 5]] as any).evaluate().toString()
    ).toMatch(/incompatible-dimensions/);
  });

  test('the comparison agrees with it', () => {
    expect(
      ce.box(['Less', filter, ['List', 1, 2, 3, 4, 5]] as any).evaluate().toString()
    ).toMatch(/incompatible-dimensions/);
  });

  test('an INFINITE operand against a finite one', () => {
    // `count` is `Infinity` for a `Cycle`, which mismatches any finite length
    // — the ruling's "unbounded against finite errors on the count comparison".
    expect(
      ce
        .box(['Less', ['Cycle', ['List', 1, 2]], ['List', 1, 2, 3]] as any)
        .evaluate()
        .toString()
    ).toMatch(/incompatible-dimensions/);
  });

  test('the arithmetic value path agrees on an INFINITE operand', () => {
    // Audit finding (2026-07-27): `addN`/`mulN` route an infinite operand to
    // the lazy `Map` form via `isUnknownLengthBroadcast` — a path with no
    // earlier mismatch check — so `Add([1,2,3], Range(1,∞))` zipped to
    // `[2,4,6]` while `Less` on the same operands errored. The check now
    // lives in the `lazyBroadcastMap` funnel itself: an infinite count is
    // KNOWN (`Infinity`), not unknown, so it is compared.
    const inf = ['Range', 1, 'PositiveInfinity'];
    for (const op of ['Add', 'Subtract', 'Multiply']) {
      expect(
        ce.box([op, ['List', 1, 2, 3], inf] as any).evaluate().toString()
      ).toMatch(/incompatible-dimensions/);
    }
    // `.N()` takes the same funnel.
    expect(
      ce.box(['Add', ['List', 1, 2, 3], inf] as any).N().toString()
    ).toMatch(/incompatible-dimensions/);
  });

  test('two INFINITE operands still zip lazily — Infinity agrees with Infinity', () => {
    const inf = ['Range', 1, 'PositiveInfinity'];
    const r = ce.box(['Add', inf, inf] as any).evaluate();
    expect(r.operator).toBe('Map');
    expect(r.at(3)?.re).toBe(6);
  });

  test('an operand whose count is UNKNOWN is still not compared', () => {
    // A `Filter` reports `count === undefined` until drained — there is
    // nothing to compare until it resolves (the ROADMAP residue), so the
    // scalar-lifted sum evaluates rather than erroring.
    const filter3 = [
      'Filter',
      ['Range', 1, 5],
      ['Function', ['Greater', '_', 2], '_'],
    ];
    expect(ce.box(['Add', filter3, 1] as any).evaluate().toString()).toBe(
      '[4,5,6]'
    );
  });

  test('PointList keeps its ratified shortest-zip contract', () => {
    // `PointList` ZIPS components rather than broadcasting an operator over
    // them (Tycho item 52), so it opts out of the ruling explicitly — pairing
    // constructors define their length as the shortest input (see
    // `docs/BROADCAST-MODEL.md`).
    expect(
      ce.box(['PointList', ['List', 1, 2, 3], ['List', 10, 20]] as any).evaluate()
        .json
    ).toEqual(['List', ['Tuple', 1, 10], ['Tuple', 2, 20]]);
  });
});

describe('absence survives a composed connective', () => {
  // `_SYS.bcast` represents an error position as NaN, and raw JS coerces it:
  // `!NaN` is `true`, `NaN || false` is `false`. The interpreter absorbs a
  // dominant operand and otherwise propagates the error, so the compiled
  // connectives guard for it.
  const err = ['Less', ['List', 1, 2, 3], ['List', 2, 2]];

  test('Not over an error position stays absent', () => {
    const r = compile(ce.box(['Not', err] as any));
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBeNaN();
  });

  test('Or over an error position stays absent', () => {
    const r = compile(ce.box(['Or', err, 'False'] as any));
    expect(r?.success).toBe(true);
    expect(r!.run!()).toBeNaN();
  });

  test('a dominant operand still absorbs, as the interpreter does', () => {
    expect(parity(ce.box(['And', 'False', err] as any))).toBe(false);
    expect(parity(ce.box(['Or', 'True', err] as any))).toBe(true);
  });
});

describe('a numeric missing slot keeps its IEEE reading under a broadcast', () => {
  // Substituting a lifted operand with its VALUE erases the declared type the
  // comparison absence-read keys on, so `x: number | missing = Missing` was
  // read as Kleene under a broadcast and IEEE as a scalar.
  const engine = new ComputeEngine();
  engine.declare('x', 'number | missing');
  engine.assign('x', engine.symbol('Missing'));

  test('scalar and broadcast agree', () => {
    expect(engine.box(['Less', 1, 'x'] as any).evaluate().toString()).toBe(
      '"False"'
    );
    expect(
      engine.box(['Less', ['List', 1, 2], 'x'] as any).evaluate().toString()
    ).toBe('["False","False"]');
  });
});

describe('the shapes that must keep failing closed', () => {
  test('a TUPLE operand — atomic, never a broadcast source', () => {
    // A tuple lowers to a JS array but carries point/vector semantics, so the
    // interpreter leaves `Less(Tuple(1,2), 3)` inert. Admitting it compiled
    // that into `[true, true]`. NOTE: the guard is type-based and must stay
    // ahead of the other admission tests — `tuple<real,real>` matches
    // `indexed_collection`.
    expect(compile(ce.box(['Less', ['Tuple', 1, 2], 3] as any))?.success).toBe(
      false
    );
    expect(
      compile(ce.box(['Less', ['Tuple', 1, 2], ['Tuple', 3, 4]] as any))?.success
    ).toBe(false);
    const engine = new ComputeEngine();
    engine.declare('p', 'tuple<real,real>');
    expect(compile(engine.parse('p < 3'))?.success).toBe(false);
  });

  // The operand types as a list but does NOT compile to one: a user function
  // compiles its body as scalar code, so `q(L)` returns NaN at run time and a
  // comparison would silently answer a plausible boolean.
  function make(): ComputeEngine {
    const engine = new ComputeEngine();
    engine.declare('n', 'number');
    engine.declare('q', { signature: '(unknown) -> unknown' });
    engine.assign('q', engine.parse('t \\mapsto n\\cdot t+1'));
    engine.declare('L', 'list<number>');
    return engine;
  }

  test('a user-function application over a list argument', () => {
    const engine = make();
    expect(compile(engine.parse('q(L)<y'))?.success).toBe(false);
    // ...including when mixed with a genuinely array-valued operand.
    expect(compile(engine.parse('q(L)<L'))?.success).toBe(false);
  });

  test('a CHAINED ordering over a collection', () => {
    // `a < b < c` is a pairwise `&&` conjunction, sound only over scalars.
    const engine = new ComputeEngine();
    engine.declare('xs', 'list<real>');
    expect(compile(engine.box(['Less', 0, 'xs', 5] as any))?.success).toBe(
      false
    );
  });
});

describe('Equal/NotEqual keep whole-collection semantics', () => {
  // Two collections compare as WHOLE values (a scalar boolean), so they must
  // not be swept into the element-wise lowering; they keep the `_SYS.eq`
  // dispatch, which is element-wise only for the list-vs-scalar case.
  test('two collections compare whole', () => {
    expect(
      parity(ce.box(['Equal', ['List', 1, 2, 3], ['List', 1, 9, 3]] as any))
    ).toBe(false);
    expect(
      parity(ce.box(['Equal', ['List', 1, 2, 3], ['List', 1, 2, 3]] as any))
    ).toBe(true);
  });

  test('list-vs-scalar stays element-wise', () => {
    expect(parity(ce.box(['Equal', ['List', 1, 2, 3], 2] as any))).toEqual([
      false,
      true,
      false,
    ]);
  });
});

describe('a CONCRETE list compiles through the broadcast', () => {
  test('Not over a literal boolean list', () => {
    expect(parity(ce.box(['Not', ['List', 'True', 'False']] as any))).toEqual([
      false,
      true,
    ]);
    expect(
      parity(ce.box(['Not', ['List', 'True', 'True', 'False']] as any))
    ).toEqual([false, false, true]);
  });
});

describe('the scalar paths are unchanged', () => {
  test('orderings', () => {
    expect(parity(ce.parse('2 < 3'))).toBe(true);
    expect(parity(ce.parse('3 \\le 3'))).toBe(true);
    expect(parity(ce.parse('2 > 3'))).toBe(false);
    // Chained scalar comparisons still conjoin pairwise.
    expect(parity(ce.parse('1 < 2 < 3'))).toBe(true);
  });

  test('connectives', () => {
    expect(parity(ce.box(['And', 'True', 'False'] as any))).toBe(false);
    expect(parity(ce.box(['Or', 'True', 'False'] as any))).toBe(true);
    expect(parity(ce.box(['Not', 'True'] as any))).toBe(false);
    expect(parity(ce.box(['And', ['Less', 2, 3], ['Less', 3, 4]] as any))).toBe(
      true
    );
  });

  test('a scalar plot variable stays on the infix fast path', () => {
    // No runtime guard is added to the hot scalar path.
    const engine = new ComputeEngine();
    engine.declare('x', 'real');
    const r = compile(engine.parse('x < 3'));
    expect(r?.success).toBe(true);
    expect(r!.code).toMatch(/_\.x < 3/);
  });
});

describe('other targets keep their existing lowering', () => {
  // The element-wise lowering is JavaScript-only: it emits `_SYS.bcast`, which
  // only the JavaScript runtime provides. Python is untouched.
  const engine = new ComputeEngine();

  test('Python still lowers a collection comparison as before', () => {
    const r = compile(engine.box(['Less', ['List', 1, 2], 2] as any), {
      to: 'python',
    });
    expect(r?.success).toBe(true);
    expect(r!.code).toMatch(/np\.less/);
  });

  test('Python equality keeps its tolerance-aware lowering', () => {
    const r = compile(engine.box(['Equal', ['List', 1, 2], 2] as any), {
      to: 'python',
    });
    expect(r?.success).toBe(true);
    expect(r!.code).not.toMatch(/np\./);
  });
});
