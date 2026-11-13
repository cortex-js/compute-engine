import { ComputeEngine } from '../../src/compute-engine';
import { subsIfCaptureFree } from '../../src/compute-engine/boxed-expression/subs-capture-mode';

// A `Block` that assigns a name declared outside the block makes no local for
// it: the `Assign` writes the outer variable, and a statement that reads the
// name before the first `Assign` reads the value from outside the block. The
// free-variable walk reports such a name as free (`unknowns`). `subs()` must
// then give the block the replacement as that value. Replacing each
// occurrence of the name gives an invalid `Assign(2, 3)`, so `subs()` adds a
// first statement `Assign(name, replacement)` to the block, and keeps the
// other occurrences. Before, `subs()` counted the name as a local and did not
// replace it: `Block(Assign(a, a + 1), a)` with `a` replaced by `2`
// evaluated to `a + 1`.

describe('CE-1063: subs() into a block that reads a name and then assigns it', () => {
  it('gives the replacement to the reads before the first write', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const block = ce.box(['Block', ['Assign', 'a', ['Add', 'a', 1]], 'a']);
    expect(block.unknowns).toEqual(['a']);
    const result = block.subs({ a: 2 });
    expect(result.json).toEqual([
      'Block',
      ['Assign', 'a', 2],
      ['Assign', 'a', ['Add', 'a', 1]],
      'a',
    ]);
    expect(result.unknowns).toEqual([]);
    expect(result.evaluate().json).toEqual(3);
  });

  it('gives the replacement to a read in an earlier statement', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const block = ce.box([
      'Block',
      ['Declare', 'q', "'unknown'", ['Multiply', 2, 'a']],
      ['Assign', 'a', 1],
      ['Add', 'a', 'q'],
    ]);
    expect(block.subs({ a: 5 }).evaluate().json).toEqual(11);
  });

  it('gives the replacement to a function literal that reads the name', () => {
    // The walk counts the read in the body of `g` as a read before the
    // write, because it cannot tell when `g` is called. The first statement
    // is then not necessary, and it does not change the value.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const block = ce.box([
      'Block',
      ['Declare', 'g', "'unknown'", ['Function', ['Add', 'a', 'x'], 'x']],
      ['Assign', 'a', 5],
      ['g', 1],
    ]);
    expect(block.subs({ a: 2 }).evaluate().json).toEqual(6);
  });

  it('replaces a name that has a value', () => {
    const ce = new ComputeEngine();
    ce.assign('a', 5);
    const block = ce.box(['Block', ['Assign', 'a', ['Add', 'a', 1]], 'a']);
    expect(block.subs({ a: 2 }).evaluate().json).toEqual(3);
  });

  it('replaces the name in a block that is not canonical', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const json = ['Block', ['Assign', 'a', ['Add', 'a', 1]], 'a'] as const;
    const expected = [
      'Block',
      ['Assign', 'a', 2],
      ['Assign', 'a', ['Add', 'a', 1]],
      'a',
    ];
    const raw = ce.box(json, { form: 'raw' }).subs({ a: 2 });
    expect(raw.isCanonical).toBe(false);
    expect(raw.json).toEqual(expected);
    expect(raw.evaluate().json).toEqual(3);
    expect(ce.box(['Hold', json]).subs({ a: 2 }).json).toEqual([
      'Hold',
      expected,
    ]);
  });

  it('keeps a local of the block', () => {
    // No read before the first write: `y` is a local, and `subs()` does not
    // replace it.
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'y', "'unknown'", 5],
      ['Add', 'x', 'y'],
    ]);
    expect(block.subs({ y: 3 })).toBe(block);
    // No scope declares `q`, so the `Assign` is an error: an assignment makes
    // no local.
    const local = ce.box(['Block', ['Assign', 'q', ['Add', 'q', 1]], 'q']);
    expect(local.isValid).toBe(false);
    expect(JSON.stringify(local.json)).toContain(
      'assignment-to-undeclared-variable'
    );
  });

  it('assigns several names at the same time', () => {
    // Two statements `Assign(a, b)` and `Assign(b, a)` would give `b` the new
    // value of `a`.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.declare('b', 'real');
    const block = ce.box([
      'Block',
      ['Assign', 'a', ['Add', 'a', 1]],
      ['Assign', 'b', ['Add', 'b', 1]],
      ['Tuple', 'a', 'b'],
    ]);
    const result = block.subs({ a: 'b', b: 'a' });
    expect(result.json).toEqual([
      'Block',
      ['Assign', ['Tuple', 'a', 'b'], ['Tuple', 'b', 'a']],
      ['Assign', 'a', ['Add', 'a', 1]],
      ['Assign', 'b', ['Add', 'b', 1]],
      ['Tuple', 'a', 'b'],
    ]);
    ce.assign('a', 1);
    ce.assign('b', 10);
    expect(result.evaluate().json).toEqual(['Tuple', 11, 2]);
  });

  it('declines in the decline mode when a replacement reads an assigned name', () => {
    // The replacement `a` of `x` would read the `3` that the first
    // statement writes, not the value of `a` from outside the block.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const block = ce.box([
      'Block',
      ['Assign', 'a', ['Add', 'a', 'x']],
      'a',
    ]);
    expect(subsIfCaptureFree(block, { x: 'a', a: 3 })).toBeUndefined();
    expect(subsIfCaptureFree(block, { a: 3 })?.json).toEqual([
      'Block',
      ['Assign', 'a', 3],
      ['Assign', 'a', ['Add', 'a', 'x']],
      'a',
    ]);
  });

  it('keeps the name of a call', () => {
    // `subs()` does not replace the name of a call, so the call `f(1)` is
    // not a read of `f`: the block reads no value of `f` from outside it.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    const block = ce.box([
      'Block',
      ['Declare', 'y', "'unknown'", ['f', 1]],
      ['Assign', 'f', ['Function', ['Multiply', 2, 'x'], 'x']],
      ['Add', 'y', ['f', 3]],
    ]);
    expect(block.subs({ f: 'g' })).toBe(block);
  });

  it('renames a local of the block that the replacement reads', () => {
    // The first statement `Assign(a, c)` is in the scope of the local `c`,
    // which would capture the `c` of the replacement.
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    const block = ce.box([
      'Block',
      ['Declare', 'c', "'unknown'", 1],
      ['Assign', 'a', ['Add', 'a', 'c']],
      'a',
    ]);
    const result = block.subs({ a: 'c' });
    expect(result.json).toEqual([
      'Block',
      ['Assign', 'a', 'c'],
      ['Declare', 'c_1', "'unknown'", 1],
      ['Assign', 'a', ['Add', 'a', 'c_1']],
      'a',
    ]);
    expect(result.evaluate().json).toEqual(['Add', 'c', 1]);
  });
});
