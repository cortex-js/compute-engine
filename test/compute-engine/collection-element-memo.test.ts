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

  it('an early-abandoned walk commits nothing', () => {
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

    // Still cold: the partial walk must not have cached 3 elements as the
    // whole collection.
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
          ['Map', ['Range', 1, 2], ['Function', ['tick', ['Multiply', 'i', 'n']], 'n']],
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
    ce.assign(
      'htrans',
      ce.box(['Function', ['Multiply', 'ktrans', 'x'], 'x'])
    );
    const m = ce
      .box(['Map', ['Range', 1, 4], ['Function', ['tick', ['htrans', 'n']], 'n']])
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
