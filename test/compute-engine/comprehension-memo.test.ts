import { ComputeEngine } from '../../src/compute-engine';

/**
 * Comprehension element-memo invalidation (Tycho item 38).
 *
 * The memo is keyed on `ce._semanticVersion` + per-dependency
 * `_writeVersion`s, NOT on the engine-wide `_anyVersion`: an unrelated
 * scoped evaluation (a `\sum`, a `Block`) between two reads must not
 * invalidate it, while a semantic mutation (reassigning a free variable the
 * body reads — directly or through a helper —, `assume`/`forget`, an
 * enclosing binder's index write) must.
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

function walkSum(name: string): number {
  let s = 0;
  for (const el of ce.box(name).evaluate().each()) s += el.re;
  return s;
}

function counting<T>(f: () => T): [T, number] {
  const before = calls;
  const v = f();
  return [v, calls - before];
}

describe('Comprehension element memo', () => {
  it('survives unrelated scoped evaluations between reads', () => {
    ce.assign('kmemo', 2);
    ce.assign(
      'dmemo',
      ce.box([
        'Comprehension',
        ['tick', ['Multiply', 'kmemo', 'n']],
        ['Element', 'n', ['Range', 1, 20]],
      ])
    );

    const [v1, c1] = counting(() => walkSum('dmemo'));
    expect(v1).toBe(2 * 210);
    expect(c1).toBe(20); // cold fill

    // The mix of scoped evaluations a live document interleaves constantly.
    ce.parse('\\sum_{i=1}^{7} i^3').evaluate();
    ce.parse('\\prod_{m=1}^{4} m').evaluate();
    ce.box(['Block', ['Add', 1, 2]]).evaluate();

    const [v2, c2] = counting(() => walkSum('dmemo'));
    expect(v2).toBe(2 * 210);
    expect(c2).toBe(0); // still warm — the item-38 fix
  });

  it('is invalidated by reassigning a free variable it reads', () => {
    ce.assign('kmemo', 5);
    const [v, c] = counting(() => walkSum('dmemo'));
    expect(v).toBe(5 * 210);
    expect(c).toBe(20); // cold refill under the new binding
  });

  it('is invalidated by a caller-scope shadow, which the walk now reads', () => {
    // A scoped comprehension evaluated in a child scope that shadows one of
    // its free names reads the child's binding (ruled 2026-09-15, Tycho item
    // 295: a directly evaluated expression reads the environment it is
    // evaluated in — `binder-scope-ambient-shadow.test.ts`). The memo's
    // resolution axis resolves through the same chain the walk reads
    // (`withAmbientChain`), so the entry filled under the root binding is
    // refilled under the shadow, and refilled again outside it: the memo
    // holds one entry, and each environment change is a semantic one.
    ce.assign('kshadow', 2);
    ce.assign(
      'gshadow',
      ce.box([
        'Comprehension',
        ['tick', ['Multiply', 'kshadow', 'n']],
        ['Element', 'n', ['Range', 1, 4]],
      ])
    );
    const [v1, c1] = counting(() => walkSum('gshadow'));
    expect(v1).toBe(2 * 10);
    expect(c1).toBe(4);

    ce.pushScope();
    ce.declare('kshadow', { value: 99 });
    const [v2, c2] = counting(() => walkSum('gshadow'));
    expect(v2).toBe(99 * 10); // the shadow is read
    expect(c2).toBe(4); // …so the memo refills under it
    ce.popScope();

    const [v3, c3] = counting(() => walkSum('gshadow'));
    expect(v3).toBe(2 * 10); // the root binding again
    expect(c3).toBe(4); // refilled once more outside the shadow
  });

  it('is invalidated by a transitive dependency (helper body)', () => {
    ce.assign('cmemo', 3);
    ce.assign('hmemo', ce.box(['Function', ['Multiply', 'cmemo', 'x'], 'x']));
    ce.assign(
      'ememo',
      ce.box([
        'Comprehension',
        ['tick', ['hmemo', 'n']],
        ['Element', 'n', ['Range', 1, 10]],
      ])
    );
    expect(walkSum('ememo')).toBe(3 * 55);
    ce.assign('cmemo', 7);
    const [v, c] = counting(() => walkSum('ememo'));
    expect(v).toBe(7 * 55);
    expect(c).toBe(10);
  });

  it('refills per enclosing binder index when nested in a Sum', () => {
    // sum_{ii=1..3} sum(  [tick(ii*j) | j in 1..2] ) = (1+2+3)(1+2) = 18.
    // A stale memo would serve ii=1's elements for ii=2,3 and produce 9.
    const nested = ce.box([
      'Sum',
      [
        'Sum',
        [
          'Comprehension',
          ['tick', ['Multiply', 'iimemo', 'j']],
          ['Element', 'j', ['Range', 1, 2]],
        ],
      ],
      ['Limits', 'iimemo', 1, 3],
    ]);
    expect(nested.evaluate().re).toBe(18);
    expect(nested.evaluate().re).toBe(18); // and again, post-memo
  });

  it('bumps _semanticVersion when a symbol-bound operator signature is inferred', () => {
    // The memo's `_semanticVersion` axis relies on every operator-definition
    // change bumping the counter (see `snapshotDeps` in
    // `collection-element-memo.ts`). A symbol bound to an
    // operator definition whose (generic) signature is narrowed by inference is
    // such a change: `BoxedSymbol._infer()`'s operator-def branch must bump too,
    // mirroring `BoxedFunction._infer()`.
    ce.declare('opmemo', { signature: 'function' });
    const s = ce.box('opmemo');
    const before = ce._semanticVersion;
    // Narrow the generic `function` signature to a concrete one — this hits the
    // `def.operator.signature = newType` exit of the operator-def branch.
    const changed = (s as any)._infer(() => '(number) -> number', 'narrow');
    expect(changed).toBe(true);
    expect(
      (ce.box('opmemo') as any)._def?.operator?.signature?.toString()
    ).toBe('(number) -> number');
    expect(ce._semanticVersion).toBeGreaterThan(before);
  });

  it('never serves the memo for a non-scoped (structural) comprehension', () => {
    // A structural comprehension has no lexical scope of its own, so its
    // body symbols carry no stable bindings the shared memo could track
    // (`snapshotDeps` marks such an instance ineligible). Each read must
    // therefore re-walk the body rather than serve a memo keyed off the
    // incidental ambient scope.
    ce.assign('kstruct', 2);
    const structural = ce.box(
      [
        'Comprehension',
        ['tick', ['Multiply', 'kstruct', 'n']],
        ['Element', 'n', ['Range', 1, 5]],
      ],
      { structural: true }
    );
    expect((structural as any).isScoped).toBe(false);

    const read = () => {
      let acc = 0;
      for (const el of structural.each()) acc += el.re;
      return acc;
    };

    const [v1, c1] = counting(read);
    expect(v1).toBe(2 * 15);
    expect(c1).toBe(5); // fresh walk
    const [v2, c2] = counting(read);
    expect(v2).toBe(2 * 15);
    expect(c2).toBe(5); // re-walked, not served from a memo
  });

  it('stays warm across unrelated assigns, colds on a related one', () => {
    // Tycho item 127: the memo is keyed on what the instance DEPENDS on, so
    // a per-frame `assign` of an unrelated symbol must not cold it.
    ce.assign('kslide', 2);
    ce.assign('tslide', 0);
    ce.assign(
      'dslide',
      ce.box([
        'Comprehension',
        ['tick', ['Multiply', 'kslide', 'n']],
        ['Element', 'n', ['Range', 1, 10]],
      ])
    );

    const [v1, c1] = counting(() => walkSum('dslide'));
    expect(v1).toBe(2 * 55);
    expect(c1).toBe(10); // cold fill

    for (const t of [1, 2, 3]) ce.assign('tslide', t);

    const [v2, c2] = counting(() => walkSum('dslide'));
    expect(v2).toBe(2 * 55);
    expect(c2).toBe(0); // warm

    ce.assign('kslide', 4);
    const [v3, c3] = counting(() => walkSum('dslide'));
    expect(v3).toBe(4 * 55);
    expect(c3).toBe(10); // cold
  });

  it('is invalidated by assume() and forget()', () => {
    ce.declare('amemo', 'real');
    ce.assign(
      'fmemo',
      ce.box([
        'Comprehension',
        ['tick', ['Add', ['Abs', 'amemo'], 'n']],
        ['Element', 'n', ['Range', 1, 5]],
      ])
    );
    walkSum('fmemo');
    let [, c] = counting(() => walkSum('fmemo'));
    expect(c).toBe(0); // warm
    ce.assume(ce.parse('a_{memo} > 0'));
    [, c] = counting(() => walkSum('fmemo'));
    expect(c).toBe(5); // assumption changed the world
    ce.forget('amemo');
    [, c] = counting(() => walkSum('fmemo'));
    expect(c).toBe(5); // and so did reverting it
  });
});
