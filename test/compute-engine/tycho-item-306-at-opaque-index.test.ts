/**
 * Tycho item 306: `At` whose index is an opaque head.
 *
 * `[1,2,3][1:2]` parses to `At(List(1, 2, 3), Colon(1, 2))`. `Colon` is an
 * opaque head (a type annotation `a : b`) with no evaluation, so the index
 * is never a number, a string, a boolean or a collection. The engine does
 * not read a colon index as a slice. Before this fix the expression was
 * valid, stayed unevaluated, and was typed as one element (`integer | nan`);
 * a function whose body held it refined its result type to `number`.
 *
 * The index is now refused at canonicalization with an `incompatible-type`
 * error, as for any other index of the wrong type. The same applies to every
 * library opaque head typed `expression` (`Triangle`, `Segment`, …).
 *
 * The range spelling `[1,2,3][1...2]` is a valid gather and does not change.
 */

import { ComputeEngine } from '../../src/compute-engine';

const INDEX_ERROR =
  '["Error",["ErrorCode","\'incompatible-type\'","\'boolean | indexed_collection | number\'","\'expression\'"],';

describe('At refuses an opaque-head index (Tycho item 306)', () => {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');

  test('a colon index is an incompatible-type error (parse route)', () => {
    const e = ce.parse('[1,2,3][1:2]');
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.json)).toBe(
      `["At",["List",1,2,3],${INDEX_ERROR}["Colon",1,2]]]`
    );
  });

  test('a colon index with a symbolic bound is refused too', () => {
    const e = ce.parse('[1,2,3][1:n]');
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
  });

  test('a colon index is refused on the box route', () => {
    const e = ce.box(['At', ['List', 1, 2, 3], ['Colon', 1, 2]]);
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
  });

  test('a colon index in a chained access is refused', () => {
    const e = ce.box([
      'At',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      1,
      ['Colon', 1, 2],
    ]);
    expect(e.isValid).toBe(false);
    expect(e.ops![1].isValid).toBe(true);
    expect(e.ops![2].operator).toBe('Error');
  });

  test('other opaque heads are refused as an index', () => {
    const e = ce.box(['At', ['List', 1, 2, 3], ['Segment', 'A', 'B']]);
    expect(e.isValid).toBe(false);
  });

  test('a function whose body holds it does not refine to number', () => {
    const f = ce.parse('x \\mapsto [1,2,3][1:2]+\\sin(x)');
    expect(f.isValid).toBe(false);
    ce.declare('f306', { signature: '(unknown) -> unknown' });
    expect(() => ce.assign('f306', f)).toThrow();
    expect(ce.box('f306').type.toString()).toBe('(unknown) -> unknown');
  });

  test('assigning an invalid lambda does not claim it is not a function', () => {
    // The value is a function with an invalid body (type `error`); the
    // "initializer is not a function" hint of a signature mismatch must not
    // be given for it.
    ce.declare('g306', { signature: '(unknown) -> unknown' });
    let message = '';
    try {
      ce.assign('g306', ce.parse('x \\mapsto [1,2,3][1:2]+\\sin(x)'));
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('of type "error"');
    expect(message).not.toContain('not a function');
  });

  test('a colon outside an index is not affected', () => {
    const e = ce.parse('a:b');
    expect(e.isValid).toBe(true);
    expect(JSON.stringify(e.json)).toBe('["Colon","a","b"]');
    // Desmos piecewise brace group: the colon is read as a clause.
    const p = ce.parse('x\\{x>0: 1\\}');
    expect(p.isValid).toBe(true);
    expect(JSON.stringify(p.json)).toBe(
      '["Multiply","x",["Which",["Less",0,"x"],1]]'
    );
  });
});

describe('At with a valid index is not affected (Tycho item 306)', () => {
  const ce = new ComputeEngine();
  const ev = (latex: string) => ce.parse(latex).evaluate().toString();

  test('a range index is a gather', () => {
    const e = ce.parse('[1,2,3][1...2]');
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('list<integer | nan>');
    expect(e.evaluate().toString()).toBe('[1,2]');
  });

  test('integer, list and symbol indexes', () => {
    expect(ev('[1,2,3][2]')).toBe('2');
    expect(ev('[1,2,3][-1]')).toBe('3');
    expect(ev('[1,2,3][[1,3]]')).toBe('[1,3]');
    const e = ce.parse('[1,2,3][k]');
    expect(e.isValid).toBe(true);
    expect(e.evaluate().operator).toBe('At');
  });

  test('an index of an unknown function application stays valid', () => {
    // `g` has no body yet; it may be given one later, so it is not refused.
    ce.declare('g306', 'function');
    const e = ce.box(['At', ['List', 1, 2, 3], ['g306', 1]]);
    expect(e.isValid).toBe(true);
  });

  test('strings, tuples, dictionaries and records', () => {
    expect(ce.box(['At', { str: 'abc' }, 2]).evaluate().toString()).toBe(
      '"b"'
    );
    expect(ce.box(['At', ['Tuple', 1, 'x'], 2]).evaluate().toString()).toBe(
      'x'
    );
    expect(
      ce
        .box(['At', ['Dictionary', ['Tuple', "'a'", 1]], "'a'"])
        .evaluate()
        .toString()
    ).toBe('1');
    const r = ce.box(['At', ['Record', ['Tuple', "'a'", 7]], "'a'"]);
    expect(r.isValid).toBe(true);
  });
});
