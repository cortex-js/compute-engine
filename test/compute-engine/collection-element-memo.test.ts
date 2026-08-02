import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { validElementMemo } from '../../src/compute-engine/boxed-expression/collection-element-memo';

/**
 * Element memo for flagged lazy operators (Tycho item 126).
 *
 * `Map`, `Filter`, `Tabulate`, … opt into the per-instance element memo via
 * the `elementMemo` collection-handler flag, applied at the
 * `BoxedFunction.each()`/`at()` seam. Invalidation mirrors the Comprehension
 * memo (Tycho item 38): `ce._mutationGeneration` plus per-dependency binding
 * identity and `_writeVersion` — an unrelated scoped evaluation between two
 * walks stays warm, a semantic mutation (reassigning a free variable, an
 * enclosing binder's index write) refills.
 *
 * By ruling (2026-08-02), the memo applies to IMPURE element bodies too:
 * repeated walks of one instance are one draw set (`RANDOMNESS-MODEL.md` §6).
 */

let ce: ComputeEngine;
let calls = 0;

beforeAll(() => {
  ce = new ComputeEngine();
  ce.declare('tick', {
    signature: '(number) -> number',
    evaluate: (ops) => {
      calls++;
      return ops[0].evaluate();
    },
  });
});

function walkSum(e: Expression): number {
  let s = 0;
  for (const el of e.each()) s += el.re;
  return s;
}

function counting<T>(f: () => T): [T, number] {
  const before = calls;
  const v = f();
  return [v, calls - before];
}

describe('Map element memo', () => {
  it('serves a repeated walk of one instance from the memo', () => {
    ce.assign('mfree', 2);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 20],
        ['Function', ['tick', ['Multiply', 'mfree', 'n']], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(2 * 210);
    expect(c1).toBe(20); // cold fill

    // The mix of scoped evaluations a live document interleaves constantly.
    ce.parse('\\sum_{i=1}^{7} i^3').evaluate();
    ce.box(['Block', ['Add', 1, 2]]).evaluate();

    const [v2, c2] = counting(() => walkSum(m));
    expect(v2).toBe(2 * 210);
    expect(c2).toBe(0); // warm

    // Reassigning a free variable the mapping body reads refills.
    ce.assign('mfree', 5);
    const [v3, c3] = counting(() => walkSum(m));
    expect(v3).toBe(5 * 210);
    expect(c3).toBe(20);
  });

  it('works identically on the parse route', () => {
    ce.assign('pfree', 3);
    const m = ce
      .parse(
        '\\mathrm{Map}\\left(\\left[1...10\\right], n \\mapsto \\operatorname{tick}(\\mathrm{pfree}\\cdot n)\\right)',
        { strict: false }
      )
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(3 * 55);
    expect(c1).toBe(10);

    const [v2, c2] = counting(() => walkSum(m));
    expect(v2).toBe(3 * 55);
    expect(c2).toBe(0);
  });

  it('memoizes the variadic (zipWith) form', () => {
    const m = ce
      .box([
        'Map',
        ['Range', 1, 5],
        ['Range', 11, 15],
        ['Function', ['tick', ['Add', 'a', 'b']], 'a', 'b'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(15 + 65);
    expect(c1).toBe(5);

    const [, c2] = counting(() => walkSum(m));
    expect(c2).toBe(0);
  });

  it('an early-abandoned walk never commits a COMPLETE entry', () => {
    const m = ce
      .box(['Map', ['Range', 1, 10], ['Function', ['tick', 'n'], 'n']])
      .evaluate();

    const [, cPartial] = counting(() => {
      let taken = 0;
      for (const el of m.each()) {
        void el;
        if (++taken === 3) break;
      }
    });
    expect(cPartial).toBe(3);

    // Still cold for a WALK: the partial walk commits a 3-element prefix
    // (see the prefix-commit test below), which `each()` must not serve as
    // the whole collection.
    const [v, cFull] = counting(() => walkSum(m));
    expect(v).toBe(55);
    expect(cFull).toBe(10);

    const [, cWarm] = counting(() => walkSum(m));
    expect(cWarm).toBe(0);
  });

  it('at() serves from a covering cached prefix', () => {
    const m = ce
      .box(['Map', ['Range', 1, 10], ['Function', ['tick', 'n'], 'n']])
      .evaluate();

    counting(() => walkSum(m)); // fill
    const [v, c] = counting(() => m.at(7)!.re);
    expect(v).toBe(7);
    expect(c).toBe(0);

    // Past the end of a complete cache: the handler's own out-of-range
    // answer, not a cache artifact.
    expect(m.at(11)).toBeUndefined();
  });

  it('refills per iteration when nested under a binder that writes its index', () => {
    // The Sum's ephemeral index writes bump only the index definition's
    // `_writeVersion`, not `_mutationGeneration` — the per-dependency axis
    // must catch them or every iteration would reuse iteration 1's elements.
    ce.assign(
      'msum',
      ce.box([
        'Sum',
        [
          'Sum',
          [
            'Map',
            ['Range', 1, 2],
            ['Function', ['tick', ['Multiply', 'i', 'n']], 'n'],
          ],
        ],
        ['Tuple', 'i', 1, 3],
      ])
    );
    const [v, c] = counting(() => ce.box('msum').evaluate().re);
    // Σ_i Σ_n∈[1,2] i·n = (1+2)·(1+2+3) = 18; stale memo would give 3·3 = 9.
    expect(v).toBe(18);
    expect(c).toBeGreaterThanOrEqual(6);
  });
});

describe('eligibility gates', () => {
  it('a by-reference helper with a NEVER-DECLARED free symbol is ineligible', () => {
    // `qlate` is auto-declared (valueless) inside the helper's body scope
    // when `hlate` is assigned; a later `ce.assign('qlate', …)` installs the
    // value in a DIFFERENT definition via the declare path, which bumps
    // neither `_mutationGeneration` nor the tracked `_writeVersion`. The
    // valueless-binding gate must therefore refuse to memoize — a committed
    // cache here would serve stale symbolic elements forever.
    ce.assign('hlate', ce.box(['Function', ['Add', 'x', 'qlate'], 'x']));
    const m = ce.box(['hlate', ['Range', 1, 5]]).evaluate();

    const els1 = [...m.each()].map((el) => el.toString());
    expect(els1[0]).toContain('qlate'); // symbolic: qlate has no value

    // The full drain must NOT have committed a memo.
    expect(validElementMemo(m)).toBeUndefined();
  });

  it('tracks a transitive dependency through a bound helper', () => {
    ce.assign('ktrans', 2);
    ce.assign('htrans', ce.box(['Function', ['Multiply', 'ktrans', 'x'], 'x']));
    const m = ce
      .box([
        'Map',
        ['Range', 1, 4],
        ['Function', ['tick', ['htrans', 'n']], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(2 * 10);
    expect(c1).toBe(4);

    const [, c2] = counting(() => walkSum(m));
    expect(c2).toBe(0); // warm

    // Reassigning the helper's own dependency refills.
    ce.assign('ktrans', 7);
    const [v3, c3] = counting(() => walkSum(m));
    expect(v3).toBe(7 * 10);
    expect(c3).toBe(4);
  });
});

describe('other flagged operators', () => {
  it('Filter memoizes its predicate walk', () => {
    const f = ce
      .box([
        'Filter',
        ['Range', 1, 10],
        ['Function', ['Greater', ['tick', 'n'], 5], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(f));
    expect(v1).toBe(6 + 7 + 8 + 9 + 10);
    expect(c1).toBe(10);

    const [v2, c2] = counting(() => walkSum(f));
    expect(v2).toBe(40);
    expect(c2).toBe(0);
  });

  it('Tabulate memoizes', () => {
    const t = ce
      .box(['Tabulate', ['Function', ['tick', ['Square', 'n']], 'n'], 6])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(t));
    expect(v1).toBe(91);
    expect(c1).toBe(6);

    const [, c2] = counting(() => walkSum(t));
    expect(c2).toBe(0);
  });
});

describe('review fixes (2026-08-02)', () => {
  it('at(-1) serves the memoized last element (negative-index coherence)', () => {
    const m = ce
      .box(['Map', ['Range', 1, 6], ['Function', ['Random'], 'n']])
      .evaluate();
    const walked = [...m.each()].map((el) => el.re);
    // `Last`-style access must agree with the walk on the same instance —
    // re-deriving here would be a fresh draw.
    expect(m.at(-1)!.re).toBe(walked[5]);
    expect(m.at(-6)!.re).toBe(walked[0]);
  });

  it('a shadowing declaration in a pushed scope is not served stale', () => {
    ce.assign('shadowed', 2);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 3],
        ['Function', ['tick', ['Multiply', 'shadowed', 'n']], 'n'],
      ])
      .evaluate();

    // Fill INSIDE a scope that shadows the dependency: a fresh declaration
    // bumps no mutation counter and touches no tracked definition.
    ce.pushScope();
    ce.declare('shadowed_probe', 'number'); // ensure scope machinery is live
    ce.declare('shadowed', { value: 99 });
    const inScopeSum = counting(() => walkSum(m))[0];
    ce.popScope();

    // Outside the scope the walk must NOT serve the in-scope elements.
    const [vOut] = counting(() => walkSum(m));
    expect(vOut).toBe(2 * 6);
    // (If the in-scope walk resolved the shadow, the two must differ.)
    if (inScopeSum === 99 * 6) expect(vOut).not.toBe(inScopeSum);
  });

  it('a mutation while the walk is suspended prevents the commit', () => {
    ce.assign('midwalk', 1);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 4],
        ['Function', ['tick', ['Multiply', 'midwalk', 'n']], 'n'],
      ])
      .evaluate();

    // Pull two elements, mutate the dependency, then drain: the buffer is a
    // before/after mix and must not be certified as uniform.
    const it1 = m.each();
    const mixed: number[] = [it1.next().value!.re, it1.next().value!.re];
    ce.assign('midwalk', 10);
    let r = it1.next();
    while (!r.done) {
      mixed.push(r.value!.re);
      r = it1.next();
    }
    expect(mixed).toEqual([1, 2, 30, 40]); // genuinely mixed

    // The next walk must recompute uniformly, not serve the mixed buffer.
    const [v, c] = counting(() => walkSum(m));
    expect(v).toBe(10 * 10);
    expect(c).toBe(4);
  });
});

describe('dependency-precise invalidation (Tycho item 127)', () => {
  it('stays warm across unrelated assigns, colds on a related one', () => {
    // The headline: a per-frame `assign` of a symbol the instance cannot
    // reference must not cold it. Under the old `_mutationGeneration`
    // equality requirement every one of these assigns refilled the memo.
    ce.assign('kslider', 2);
    ce.assign('tslider', 0);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 8],
        ['Function', ['tick', ['Multiply', 'kslider', 'n']], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(2 * 36);
    expect(c1).toBe(8); // cold fill

    for (const t of [1, 2, 3]) ce.assign('tslider', t);

    const [v2, c2] = counting(() => walkSum(m));
    expect(v2).toBe(2 * 36);
    expect(c2).toBe(0); // warm: `tslider` is not a dependency

    ce.assign('kslider', 5);
    const [v3, c3] = counting(() => walkSum(m));
    expect(v3).toBe(5 * 36);
    expect(c3).toBe(8); // cold: `kslider` is
  });

  it('a transitive helper dependency has the same asymmetry', () => {
    ce.assign('cwarm', 3);
    ce.assign('hwarm', ce.box(['Function', ['Multiply', 'cwarm', 'x'], 'x']));
    ce.assign('twarm', 0);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 5],
        ['Function', ['tick', ['hwarm', 'n']], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(3 * 15);
    expect(c1).toBe(5);

    for (const t of [1, 2, 3]) ce.assign('twarm', t);
    const [v2, c2] = counting(() => walkSum(m));
    expect(v2).toBe(3 * 15);
    expect(c2).toBe(0); // warm through the helper's body too

    // The helper's OWN dependency is tracked transitively: reassigning it
    // colds.
    ce.assign('cwarm', 7);
    const [v3, c3] = counting(() => walkSum(m));
    expect(v3).toBe(7 * 15);
    expect(c3).toBe(5);
  });

  it('a suspended write to a NON-dependency still commits', () => {
    // A consumer that assigns an unrelated accumulator between two pulls
    // cannot have mixed the buffer, so the walk must still commit. The
    // start/end dependency diff is what distinguishes this from the mixed
    // case pinned by 'a mutation while the walk is suspended…'.
    ce.assign('kpull', 2);
    ce.assign('accpull', 0);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 6],
        ['Function', ['tick', ['Multiply', 'kpull', 'n']], 'n'],
      ])
      .evaluate();

    const it1 = m.each();
    const got: number[] = [it1.next().value!.re, it1.next().value!.re];
    ce.assign('accpull', 99);
    let r = it1.next();
    while (!r.done) {
      got.push(r.value!.re);
      r = it1.next();
    }
    expect(got).toEqual([2, 4, 6, 8, 10, 12]); // uniform, not mixed

    const [v, c] = counting(() => walkSum(m));
    expect(v).toBe(2 * 21);
    expect(c).toBe(0); // committed despite the suspended write
  });

  it('a suspended EPOCH change refuses the commit', () => {
    // A global-semantics change between two pulls has no per-dependency
    // counterpart to diff, and the entry would be stamped with the POST-change
    // epoch — certifying a straddling buffer as valid in the new world.
    const saved = ce.tolerance;
    const m = ce
      .box(['Map', ['Range', 1, 5], ['Function', ['tick', 'n'], 'n']])
      .evaluate();

    const it1 = m.each();
    it1.next();
    it1.next();
    ce.tolerance = saved * 10;
    let r = it1.next();
    while (!r.done) r = it1.next();

    const [v, c] = counting(() => walkSum(m));
    expect(v).toBe(15);
    expect(c).toBe(5); // nothing was committed

    ce.tolerance = saved;
  });

  it('an abandoned walk commits a prefix that at() serves', () => {
    const m = ce
      .box(['Map', ['Range', 1, 10], ['Function', ['tick', 'n'], 'n']])
      .evaluate();

    const [, cPartial] = counting(() => {
      let taken = 0;
      for (const el of m.each()) {
        void el;
        if (++taken === 3) break;
      }
    });
    expect(cPartial).toBe(3);

    // Inside the committed prefix: free.
    const [v2, c2] = counting(() => m.at(2)!.re);
    expect(v2).toBe(2);
    expect(c2).toBe(0);

    // Outside it: the handler's own random access, at its own cost.
    const [v5, c5] = counting(() => m.at(5)!.re);
    expect(v5).toBe(5);
    expect(c5).toBe(1);

    // A partial entry never serves a WALK, and the complete drain upgrades it.
    const [vFull, cFull] = counting(() => walkSum(m));
    expect(vFull).toBe(55);
    expect(cFull).toBe(10);

    expect(counting(() => walkSum(m))[1]).toBe(0);
    expect(counting(() => m.at(9)!.re)).toEqual([9, 0]);
  });

  it('a tolerance change colds the memo (epoch, not a config stamp)', () => {
    const saved = ce.tolerance;
    const m = ce
      .box(['Map', ['Range', 1, 4], ['Function', ['tick', 'n'], 'n']])
      .evaluate();

    expect(counting(() => walkSum(m))[1]).toBe(4);
    expect(counting(() => walkSum(m))[1]).toBe(0);

    ce.tolerance = saved * 10;
    expect(counting(() => walkSum(m))[1]).toBe(4); // cold: the world changed

    ce.tolerance = saved; // shared engine: restore
  });
});

describe('review-round pins (2026-08-02, round 3)', () => {
  it('a nested helper reading a global spelled like a caller parameter still tracks it', () => {
    // C1: skip sets must not cross definition boundaries. `houter(q)` calls
    // `ginner(y)`; `ginner`'s body reads the GLOBAL `qglobal9`… spelled `q`
    // is the trap, so use the exact collision: houter's parameter is named
    // `qcol` and ginner reads a global `qcol`.
    ce.assign('qcol', 5);
    ce.assign('ginner', ce.box(['Function', ['Multiply', 'qcol', 'y'], 'y']));
    ce.assign(
      'houter',
      ce.box(['Function', ['ginner', ['Add', 'qcol', 0]], 'qcol'])
    );
    const m = ce
      .box([
        'Map',
        ['Range', 1, 3],
        ['Function', ['tick', ['houter', 'n']], 'n'],
      ])
      .evaluate();

    const [v1, c1] = counting(() => walkSum(m));
    expect(v1).toBe(5 * (1 + 2 + 3)); // houter(n) = ginner(n) = qcol·n
    expect(c1).toBe(3);

    // Reassigning the GLOBAL qcol must refill — under the inherited-skip
    // bug this dependency was silently dropped and the memo served stale.
    ce.assign('qcol', 7);
    const [v2, c2] = counting(() => walkSum(m));
    expect(v2).toBe(7 * 6);
    expect(c2).toBe(3);
  });

  it('a pull-mutate-break consumer does not certify a stale prefix', () => {
    // C2: the final yield→finally jump skips the loop's boundary check; the
    // finally must re-sample. Pull one element, mutate the DEP, break — the
    // committed-would-be prefix holds a value computed under the old
    // binding but would be stamped with the new state.
    ce.assign('kbrk', 2);
    const m = ce
      .box([
        'Map',
        ['Range', 1, 6],
        ['Function', ['tick', ['Multiply', 'kbrk', 'n']], 'n'],
      ])
      .evaluate();

    const it1 = m.each();
    expect(it1.next().value!.re).toBe(2); // computed under kbrk = 2
    ce.assign('kbrk', 10);
    it1.return?.(undefined); // abrupt closure — the C2 gap

    // A covered indexed read must NOT see the stale 2.
    const first = m.at(1)!;
    expect(first.re).toBe(10);
  });

  it('impure partial prefixes are not cached (draw coherence)', () => {
    // C4: a partial prefix of a drawing body would be replaced by a later
    // complete walk's fresh draws — at(1) before/after would disagree.
    const r = ce
      .box(['Map', ['Range', 1, 5], ['Function', ['Random'], 'n']])
      .evaluate();
    const it1 = r.each();
    const firstDraw = it1.next().value!.re;
    it1.return?.(undefined); // abandon — must NOT commit a prefix

    const walked = [...r.each()].map((el) => el.re); // complete walk = the draw set
    expect(r.at(1)!.re).toBe(walked[0]); // coherent with the committed set
    void firstDraw; // the abandoned draw is simply discarded, never served
  });

  it('an impure instance stays one draw set across UNRELATED assigns', () => {
    // C3 (revised ruling, RANDOMNESS-MODEL §6): the coherence window is
    // dependency-precise — an unrelated write no longer re-draws.
    const r = ce
      .box(['Map', ['Range', 1, 5], ['Function', ['Random'], 'n']])
      .evaluate();
    const draws = [...r.each()].map((el) => el.re);
    ce.assign('unrelatedDrawTick', 1);
    ce.assign('unrelatedDrawTick', 2);
    expect([...r.each()].map((el) => el.re)).toEqual(draws); // same draw set
  });
});

describe('paranoid canary (CE_MEMO_PARANOID)', () => {
  // The canary re-walks every warm serve (pure bodies only) and asserts
  // element-wise agreement with the cache — a dependency-closure leak shows
  // up here as a stale-serve divergence. It re-evaluates element bodies, so
  // it cannot run under the count-asserting suites; this smoke test manages
  // the flag itself. Soak usage: run any suite with CE_MEMO_PARANOID=1
  // (expect the warm-count pins in THIS file to fail by construction).
  it('cross-checks a warm serve cleanly and skips impure bodies', () => {
    const savedEnv = process.env.CE_MEMO_PARANOID;
    const savedAssert = console.assert;
    const failures: unknown[][] = [];
    console.assert = ((cond: unknown, ...msg: unknown[]) => {
      if (!cond) failures.push(msg);
    }) as typeof console.assert;
    try {
      process.env.CE_MEMO_PARANOID = '1';
      ce.assign('kcanary', 3);
      const m = ce
        .box([
          'Map',
          ['Range', 1, 6],
          ['Function', ['tick', ['Multiply', 'kcanary', 'n']], 'n'],
        ])
        .evaluate();
      const w1 = [...m.each()].map((el) => el.re);
      const w2 = [...m.each()].map((el) => el.re); // canary active here
      expect(w2).toEqual(w1);
      expect(failures).toEqual([]); // no divergence

      // Impure body: the canary must SKIP (a re-walk legitimately differs
      // by the draw-set ruling) and the walk stays coherent.
      const r = ce
        .box(['Map', ['Range', 1, 4], ['Function', ['Random'], 'n']])
        .evaluate();
      const r1 = [...r.each()].map((el) => el.re);
      const r2 = [...r.each()].map((el) => el.re);
      expect(r2).toEqual(r1);
      expect(failures).toEqual([]);
    } finally {
      if (savedEnv === undefined) delete process.env.CE_MEMO_PARANOID;
      else process.env.CE_MEMO_PARANOID = savedEnv;
      console.assert = savedAssert;
    }
  });
});

describe('impure element bodies (ruled 2026-08-02)', () => {
  it('a random-bodied Map is one draw set per instance', () => {
    const m = ce
      .box(['Map', ['Range', 1, 6], ['Function', ['Random'], 'n']])
      .evaluate();

    const walk = () => [...m.each()].map((el) => el.re);
    const first = walk();
    expect(walk()).toEqual(first); // coherent: same instance, same values

    // A re-derived instance is a fresh instance: fresh draws.
    const m2 = ce
      .box(['Map', ['Range', 1, 6], ['Function', ['Random'], 'n']])
      .evaluate();
    const other = [...m2.each()].map((el) => el.re);
    expect(other).not.toEqual(first);
  });
});
