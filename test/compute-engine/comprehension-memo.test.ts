import { ComputeEngine } from '../../src/compute-engine';

/**
 * Comprehension element-memo invalidation (Tycho item 38).
 *
 * The memo is keyed on `ce._mutationGeneration` + per-dependency
 * `_writeVersion`s, NOT on the engine-wide `_generation`: an unrelated
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

  it('bumps _mutationGeneration when a symbol-bound operator signature is inferred', () => {
    // The memo's `_mutationGeneration` axis relies on every operator-definition
    // change bumping the counter (see `comprehensionDeps`). A symbol bound to an
    // operator definition whose (generic) signature is narrowed by inference is
    // such a change: `BoxedSymbol.infer()`'s operator-def branch must bump too,
    // mirroring `BoxedFunction.infer()`.
    ce.declare('opmemo', { signature: 'function' });
    const s = ce.box('opmemo');
    const before = ce._mutationGeneration;
    // Narrow the generic `function` signature to a concrete one — this hits the
    // `def.operator.signature = newType` exit of the operator-def branch.
    const changed = (s as any).infer('(number) -> number', 'narrow');
    expect(changed).toBe(true);
    expect((ce.box('opmemo') as any)._def?.operator?.signature?.toString()).toBe(
      '(number) -> number'
    );
    expect(ce._mutationGeneration).toBeGreaterThan(before);
  });

  it('never serves the memo for a non-scoped (structural) comprehension', () => {
    // A structural comprehension has no lexical scope of its own, so the memo
    // has no stable key: `comprehensionScope()` returns `undefined` and the
    // cache paths treat it as "always invalid". Each read must therefore
    // re-walk the body rather than serve a memo keyed off the incidental
    // ambient scope.
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
