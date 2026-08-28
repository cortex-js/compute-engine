import { ComputeEngine } from '../../src/compute-engine';

// R4 of `docs/plans/2026-08-22-type-handlers-on-types.md` §4.2 (re-ratified
// 2026-08-22): the revision of an INFERRED type against its value is a LIVE
// READ WITH NO WRITE. `_reviseInferredType` computes the value's current
// type — a memo keyed on `ce._anyVersion` — and answers with it when it
// refutes the recorded guess; it writes nothing (no `_type`, no
// `_writeVersion` bump, no journal entry, no `type-write` event) and keeps
// no once-per-generation gate. These are the four §4.2 acceptance criteria.

describe('R4 — the inferred-type revision is a pure live read', () => {
  test('prerequisite 1a: mutual recursion terminates with today’s answers', () => {
    // Termination relies on the expression type memo's in-flight window
    // (`cache.ts`), which answers a re-entrant read with the previous
    // value — there is no once-per-generation gate any more.
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['Add', 'b', 1]));
    ce.assign('b', ce.box(['Add', 'a', 1]));
    expect(ce.symbol('a').type.toString()).toBe('number');
    expect(ce.symbol('b').type.toString()).toBe('number');
  });

  test('prerequisite 1b: an eight-deep chain over one base symbol propagates', () => {
    const ce = new ComputeEngine();
    ce.assign('c1', ce.box(['Add', 'base', 1]));
    for (let i = 2; i <= 8; i++)
      ce.assign(`c${i}`, ce.box(['Add', `c${i - 1}`, 1]));
    expect(ce.symbol('c8').type.toString()).toBe('number');
    // Refute the whole chain's guess with one write to the base…
    ce.assign('base', ce.box(['List', 10, 30]));
    // …and every link revises on read, through seven inferred links.
    expect(ce.symbol('c8').type.toString()).toBe('vector<integer^2>');
    expect(ce.box('c8').evaluate().toString()).toBe('[18,38]');
  });

  test('prerequisite 2: the revised answer survives an unrelated write', () => {
    // The §2.5 staleness defect: the old once-per-generation gate was keyed
    // on `_semanticVersion` while the value-type memo it guarded was keyed
    // on `_anyVersion`, so a revision could be skipped for a whole
    // generation after an unrelated write. With the gate gone this cannot
    // regress.
    const ce = new ComputeEngine();
    ce.assign('y', ce.box(['Add', 'x', 1]));
    expect(ce.symbol('y').type.toString()).toBe('number');
    ce.assign('x', ce.box(['List', 10, 30]));
    expect(ce.symbol('y').type.toString()).toBe('vector<integer^2>');
    ce.assign('z', 1); // unrelated
    expect(ce.symbol('y').type.toString()).toBe('vector<integer^2>');
  });

  test('the read writes nothing, and the returned type is identity-stable', () => {
    const ce = new ComputeEngine();
    ce.assign('y', ce.box(['Add', 'x', 1]));
    ce.assign('x', ce.box(['List', 10, 30]));
    const record = (ce.lookupDefinition('y') as any).value;
    const before = record._writeVersion;
    const t1 = ce.symbol('y').type;
    const t2 = ce.symbol('y').type;
    expect(record._writeVersion).toBe(before);
    // Prerequisite 3: the returned `BoxedType` is the value's own memoized
    // type, stable within a generation, so caches keyed on `BoxedType`
    // identity (the R-D5 display projection) do not miss on every read.
    expect(t1).toBe(t2);
  });
});
