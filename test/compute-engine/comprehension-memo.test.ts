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

describe('Comprehension element memo — a sequential scan is linear', () => {
  // `[l[i] for i = 1…n]` over a lazy `l` asks `at(1)`, `at(2)`, … in turn.
  // The prefix fill is not resumable, so a fill that stopped exactly at the
  // asked index re-ran the body from the first element every time: 1 + 2 +
  // … + n runs, quadratic — 2,186 body runs for 64 elements at the third
  // level of a Desmos terrain's helper chain (2026-09-16). The fill now
  // grows the prefix geometrically, so the scan costs fewer than 2n runs.
  it('costs fewer than 2n body runs for n elements', () => {
    ce.assign(
      'lscan',
      ce.box([
        'Comprehension',
        ['tick', ['Multiply', 3, 'n']],
        ['Element', 'n', ['Range', 1, 64]],
      ])
    );
    const scan = ce.box([
      'Comprehension',
      ['At', 'lscan', 'i'],
      ['Element', 'i', ['Range', 1, 64]],
    ]);
    const [sum, c] = counting(() => {
      let s = 0;
      for (const el of scan.evaluate().each()) s += el.re;
      return s;
    });
    expect(sum).toBe((3 * (64 * 65)) / 2);
    expect(c).toBeLessThan(2 * 64);
    expect(c).toBeGreaterThanOrEqual(64);
  });

  it('a lone read of the first element still computes one element', () => {
    ce.assign(
      'lone',
      ce.box([
        'Comprehension',
        ['tick', ['Multiply', 5, 'n']],
        ['Element', 'n', ['Range', 1, 1000]],
      ])
    );
    const [v, c] = counting(() => ce.box(['At', 'lone', 1]).evaluate().re);
    expect(v).toBe(5);
    expect(c).toBe(1);
  });
});

describe('A symbol holding a stored expression is evaluated once across reads', () => {
  // The document manager of a consumer stores each cell's EXPRESSION; a
  // helper chain `h = d(s(u(b)))` held that way used to be re-run on every
  // read of `h`, so `[h[i] for i = 1…n]` ran the chain n times (8,192 times
  // for a terrain's point list). The dereference now keeps the evaluated
  // value, validated by the same dependency snapshot an element memo uses.
  beforeAll(() => {
    ce.declare('u2', 'function');
    ce.assign(
      'u2',
      ce.box([
        'Function',
        [
          'Comprehension',
          ['tick', ['At', 'l', ['Ceil', ['Divide', 'i', 2]]]],
          ['Element', 'i', ['Range', 1, ['Multiply', 2, ['Length', 'l']]]],
        ],
        'l',
      ])
    );
    ce.assign('base', ce.box(['List', 1, 2, 3, 4]));
  });

  it('a comprehension reading the symbol at every index runs the chain once', () => {
    // The stored value is the UNEVALUATED call chain.
    ce.assign('hchain', ce.box(['u2', ['u2', 'base']]));
    expect(ce.box('hchain').value?.operator).toBe('u2');
    const [len, c] = counting(() => {
      const scan = ce.box([
        'Comprehension',
        ['At', 'hchain', 'i'],
        ['Element', 'i', ['Range', 1, 16]],
      ]);
      return [...scan.evaluate().each()].length;
    });
    expect(len).toBe(16);
    // 8 runs for the inner level, 16 for the outer, and a geometric refill
    // at most doubles each — never 16 evaluations of the chain.
    expect(c).toBeLessThan(2 * (8 + 16) + 8);
    // A second read is served whole.
    const [, c2] = counting(() => ce.box(['At', 'hchain', 3]).evaluate().re);
    expect(c2).toBe(0);
  });

  it('is invalidated by reassigning a value the expression reads', () => {
    ce.assign('hchain', ce.box(['u2', 'base']));
    ce.box(['At', 'hchain', 2]).evaluate();
    const [v1, c1] = counting(() => ce.box(['At', 'hchain', 2]).evaluate().re);
    expect(v1).toBe(1);
    expect(c1).toBe(0);
    ce.assign('base', ce.box(['List', 10, 20, 30, 40]));
    const [v2, c2] = counting(() => ce.box(['At', 'hchain', 2]).evaluate().re);
    expect(v2).toBe(10);
    expect(c2).toBeGreaterThan(0);
  });

  it('is invalidated by redefining a helper the expression calls', () => {
    ce.assign('hchain', ce.box(['u2', 'base']));
    expect(ce.box(['At', 'hchain', 3]).evaluate().re).toBe(20);
    ce.assign(
      'u2',
      ce.box([
        'Function',
        [
          'Comprehension',
          ['Multiply', 100, ['At', 'l', 'i']],
          ['Element', 'i', ['Range', 1, ['Length', 'l']]],
        ],
        'l',
      ])
    );
    expect(ce.box(['At', 'hchain', 3]).evaluate().re).toBe(3000);
  });

  it('an impure stored expression is re-drawn on every read', () => {
    ce.assign('draw', ce.box(['Add', ['Random'], 0]));
    const a = ce.box('draw').evaluate().re;
    const values = new Set([a]);
    for (let k = 0; k < 8; k++) values.add(ce.box('draw').evaluate().re);
    expect(values.size).toBeGreaterThan(1);
  });
});

describe('A symbol holding a stored expression — what the memo must not serve', () => {
  it('a value read past an ordinary shadow is not remembered, so a later write is seen', () => {
    // Order is load-bearing: `a` is assigned while `x` is valueless, so `x`
    // stays a free symbol of the stored value (see symbol-value-scoping).
    ce.box(['Assign', 'ashadow', ['Add', 'xshadow', 1]]).evaluate();
    ce.box(['Assign', 'xshadow', 100]).evaluate();
    const underShadow = () =>
      ce
        .box([
          'Block',
          ['Declare', 'xshadow', "'real'"],
          ['Assign', 'xshadow', 7],
          ['Add', 'ashadow', 5],
        ])
        .evaluate()
        .toString();
    // The value's own binding is read past the shadow (ruling: only a shield
    // intercepts), and that read must not be cached against the shadow.
    expect(underShadow()).toEqual('106');
    ce.box(['Assign', 'xshadow', 200]).evaluate();
    expect(underShadow()).toEqual('206');
    expect(ce.box(['Add', 'ashadow', 5]).evaluate().toString()).toEqual('206');
    // …and an entry stored at top level is not served under the shadow.
    ce.box(['Assign', 'xshadow', 300]).evaluate();
    expect(ce.box(['Add', 'ashadow', 5]).evaluate().toString()).toEqual('306');
    expect(underShadow()).toEqual('306');
  });

  it('a value that is impure through what it reads is re-drawn', () => {
    ce.assign('rdraw', ce.box(['Random']));
    ce.assign('sdraw', ce.box(['Add', 'rdraw', 1]));
    expect(ce.box('sdraw').value?.isPure).toBe(true);
    const values = new Set<number>();
    for (let k = 0; k < 8; k++) values.add(ce.box('sdraw').evaluate().re);
    expect(values.size).toBeGreaterThan(1);
  });

  it('the N() read and the evaluate() read keep their own answers', () => {
    ce.box(['Assign', 'aroute', ['Add', 'xroute', 1]]).evaluate();
    ce.box(['Assign', 'xroute', 100]).evaluate();
    const block = (op: unknown) =>
      ce.box([
        'Block',
        ['Declare', 'xroute', "'real'"],
        ['Assign', 'xroute', 7],
        op,
      ]);
    // Whatever the `N()` route answers under the shadow, the evaluate route
    // still answers the own-binding value, in either order of the two reads.
    block(['N', 'aroute']).evaluate();
    expect(
      block(['Add', 'aroute', 5]).evaluate({ numericApproximation: true }).re
    ).toBe(106);
    expect(block(['Add', 'aroute', 5]).evaluate().toString()).toEqual('106');
  });
});
