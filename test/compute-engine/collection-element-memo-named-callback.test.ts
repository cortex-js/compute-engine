import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { validElementMemo } from '../../src/compute-engine/boxed-expression/collection-element-memo';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Element memo of a lazy collection whose callback is written as a bare NAME:
 * `Filter(xs, isEven)` with `isEven(n) = …`, `Map(f, xs)` with `f` a user
 * function or a variable holding a function literal.
 *
 * The canonical form keeps such a callback as a raw symbol, resolved by name
 * at each application. The dependency snapshot of the element memo
 * (`snapshotDeps`, `boxed-expression/collection-element-memo.ts`) declared
 * every such instance ineligible ("unbound symbol"), so a result walked for
 * its display and then enumerated by the host walked the pipeline twice, as
 * did two consumers of one `let`: the application memo answered the body of
 * a pure predicate, but each element paid the boxing of its application
 * again. A count of the runs of `tick` alone cannot tell the two memos apart
 * (the application memo also spares the body on a second walk), so each
 * repeated-walk test reads the element memo's state through
 * `validElementMemo` as well. The snapshot now
 * records the resolution of the name: an operator dependency for a user
 * function (plus the dependencies of its body), a chain-resolved value
 * dependency for a variable holding a literal.
 */

let ce: ComputeEngine;
let calls = 0;

beforeEach(() => {
  ce = new ComputeEngine();
  ce.declare('tick', {
    signature: '(number) -> number',
    evaluate: (ops) => {
      calls++;
      return ops[0].evaluate();
    },
  });
  calls = 0;
});

function walk(e: Expression): number[] {
  const out: number[] = [];
  for (const el of e.each()) out.push(el.re);
  return out;
}

function counting<T>(f: () => T): [T, number] {
  const before = calls;
  const v = f();
  return [v, calls - before];
}

describe('a user function named as the callback', () => {
  test('Filter: a repeated walk is served from the memo', () => {
    ce.assign('modulus', 2);
    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 'modulus'], 0],
      'n',
    ]);
    const f = ce.box(['Filter', ['Range', 1, 20], 'isMultiple']).evaluate();
    expect(f.operator).toBe('Filter');

    const [v1, c1] = counting(() => walk(f));
    expect(v1).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(c1).toBe(20);
    expect(validElementMemo(f)?.complete).toBe(true);

    const [v2, c2] = counting(() => walk(f));
    expect(v2).toEqual(v1);
    expect(c2).toBe(0);
  });

  test('Filter: a write to a variable the body reads refills', () => {
    ce.assign('modulus', 2);
    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 'modulus'], 0],
      'n',
    ]);
    const f = ce.box(['Filter', ['Range', 1, 20], 'isMultiple']).evaluate();
    walk(f);

    ce.assign('modulus', 5);
    const [v, c] = counting(() => walk(f));
    expect(v).toEqual([5, 10, 15, 20]);
    expect(c).toBe(20);
  });

  test('Filter: a redefinition of the function refills', () => {
    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 2], 0],
      'n',
    ]);
    const f = ce.box(['Filter', ['Range', 1, 20], 'isMultiple']).evaluate();
    walk(f);

    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 10], 0],
      'n',
    ]);
    const [v, c] = counting(() => walk(f));
    expect(v).toEqual([10, 20]);
    expect(c).toBe(20);
  });

  test('Filter: the name turned into a scalar invalidates the memo', () => {
    // A change of kind advances no version axis; only the re-resolution of
    // the name at validation time detects it.
    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 2], 0],
      'n',
    ]);
    const f = ce.box(['Filter', ['Range', 1, 20], 'isMultiple']).evaluate();
    walk(f);
    expect(validElementMemo(f)?.complete).toBe(true);

    ce.assign('isMultiple', 5);
    expect(validElementMemo(f)).toBeUndefined();
  });

  test('Filter: a scope that declares its own callback refills', () => {
    ce.assign('isMultiple', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 2], 0],
      'n',
    ]);
    const f = ce.box(['Filter', ['Range', 1, 20], 'isMultiple']).evaluate();
    walk(f);
    expect(validElementMemo(f)?.complete).toBe(true);

    ce.pushScope();
    try {
      ce.declare('isMultiple', {
        value: ce.box([
          'Function',
          ['Equal', ['Mod', ['tick', 'n'], 10], 0],
          'n',
        ]),
      });
      expect(validElementMemo(f)).toBeUndefined();
      const [v, c] = counting(() => walk(f));
      expect(v).toEqual([10, 20]);
      expect(c).toBe(20);
    } finally {
      ce.popScope();
    }
    // Back in the outer scope the outer definition is in force again.
    const [v2] = counting(() => walk(f));
    expect(v2).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
  });

  test('Map: a repeated walk is served from the memo', () => {
    ce.assign('sq', ['Function', ['tick', ['Square', 'n']], 'n']);
    const m = ce.box(['Map', 'sq', ['Range', 1, 10]]).evaluate();

    const [v1, c1] = counting(() => walk(m));
    expect(v1).toEqual([1, 4, 9, 16, 25, 36, 49, 64, 81, 100]);
    expect(c1).toBe(10);
    expect(validElementMemo(m)?.complete).toBe(true);

    const [, c2] = counting(() => walk(m));
    expect(c2).toBe(0);
  });

  test('the parse route', () => {
    ce.assign('isEven', [
      'Function',
      ['Equal', ['Mod', ['tick', 'n'], 2], 0],
      'n',
    ]);
    const f = ce
      .parse('\\mathrm{Filter}([1...20], \\mathrm{isEven})')
      .evaluate();
    const [, c1] = counting(() => walk(f));
    expect(c1).toBe(20);
    expect(validElementMemo(f)?.complete).toBe(true);
    const [v2, c2] = counting(() => walk(f));
    expect(v2).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(c2).toBe(0);
  });
});

describe('an Epsil program', () => {
  test('a predicate defined in the program: the display walk fills the memo', () => {
    const r = executeEpsil(
      ce,
      'isEven(n) = tick(n) % 2 == 0\nfilter(1..20, isEven)'
    );
    expect(r.diagnostics).toEqual([]);
    const value = r.value!;
    const [text, c1] = counting(() => value.toString());
    expect(text).toBe('[2,4,6,8,10,12,14,16,18,20]');
    expect(c1).toBe(20);
    expect(validElementMemo(value)?.complete).toBe(true);
    // The host enumerates the result after the display: no second run of
    // the predicate.
    const [v2, c2] = counting(() => walk(value));
    expect(v2).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(c2).toBe(0);
  });

  test('two consumers of one let: the first fills the memo the second reads', () => {
    // The body runs once per element either way: the application memo of a
    // pure function over number arguments answers the second consumer. The
    // element memo is what spares the second consumer the boxing of each
    // application, so its state is what is checked.
    const r = executeEpsil(
      ce,
      'sq(n) = tick(n^2)\nlet xs = map(sq, 1..10)\n[sum(xs), max(xs)]'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value!.toString()).toBe('[385,100]');
    expect(calls).toBe(10);
    const xs = ce.box('xs').value!;
    expect(xs.operator).toBe('Map');
    expect(validElementMemo(xs)?.complete).toBe(true);
  });

  test('a variable holding a function literal', () => {
    const r = executeEpsil(ce, 'let f = n => tick(n^2)\nmap(f, 1..10)');
    expect(r.diagnostics).toEqual([]);
    const value = r.value!;
    const [v1, c1] = counting(() => walk(value));
    expect(v1).toEqual([1, 4, 9, 16, 25, 36, 49, 64, 81, 100]);
    expect(c1).toBe(10);
    expect(validElementMemo(value)?.complete).toBe(true);
    const [, c2] = counting(() => walk(value));
    expect(c2).toBe(0);
  });

  test('a variable holding a function literal: reassigning the variable refills', () => {
    // The program's value is the lazy `Map` itself (a `let` would evaluate
    // it to a list). The reassignment is a second program on the same
    // engine, as a host's next cell is.
    const r = executeEpsil(ce, 'let f = n => tick(n^2)\nmap(f, 1..5)');
    expect(r.diagnostics).toEqual([]);
    const value = r.value!;
    const [v1, c1] = counting(() => walk(value));
    expect(v1).toEqual([1, 4, 9, 16, 25]);
    expect(c1).toBe(5);

    const r2 = executeEpsil(ce, 'f = n => tick(n + 1)');
    expect(r2.diagnostics).toEqual([]);
    const [v2, c2] = counting(() => walk(value));
    expect(v2).toEqual([2, 3, 4, 5, 6]);
    expect(c2).toBe(5);
  });
});
