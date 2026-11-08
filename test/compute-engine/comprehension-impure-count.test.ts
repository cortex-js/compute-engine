import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * The count of a comprehension whose guard or domain draws a random number
 * comes from the same draws as its elements (`docs/RANDOMNESS-MODEL.md` §6,
 * "One instance, one draw set"). The count is read from one complete walk of
 * the elements, which the element memo of the instance keeps, so that the
 * length, the emptiness and every read of an element agree, in any order.
 */

function run(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

/** The numbers of a printed list such as `[1,3,5]`. */
function listOf(text: string): number[] {
  const inner = text.trim().replace(/^\[/, '').replace(/\]$/, '').trim();
  return inner === '' ? [] : inner.split(',').map((x) => Number(x));
}

/** Split `(a, b, [c, d])` into `a`, `b` and the list `[c, d]`. */
function tripleOf(text: string): [string, string, number[]] {
  const m = /^\((.*?), (.*?), (\[.*\])\)$/.exec(text.replace(/\s+/g, ' '));
  if (m === null) throw new Error(`not a triple: ${text}`);
  return [m[1], m[2], listOf(m[3])];
}

const sumOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('the length of a comprehension with a random guard', () => {
  test.each([1, 7, 11, 23, 42])(
    'length, sum and the list agree when the length is read first (seed %d)',
    (seed) => {
      const [len, sum, list] = tripleOf(
        run(
          `WithRandomSeed(${seed}, do { let v = [j for j in 1..10 if random() < 0.5]; (length(v), sum(v), v) })`
        )
      );
      expect(Number(len)).toBe(list.length);
      expect(Number(sum)).toBe(sumOf(list));
    }
  );

  test.each([1, 7, 11, 23, 42])(
    'length, sum and the list agree when the sum is read first (seed %d)',
    (seed) => {
      const [sum, len, list] = tripleOf(
        run(
          `WithRandomSeed(${seed}, do { let v = [j for j in 1..10 if random() < 0.5]; (sum(v), length(v), v) })`
        )
      );
      expect(Number(len)).toBe(list.length);
      expect(Number(sum)).toBe(sumOf(list));
    }
  );

  test('the witness of the issue gives one draw set', () => {
    expect(
      run(
        'WithRandomSeed(7, do { let v = [j for j in 1..10 if random() < 0.5]; (length(v), sum(v), v) })'
      )
    ).toBe(
      run(
        'WithRandomSeed(7, do { let v = [j for j in 1..10 if random() < 0.5]; (length(v), sum(v), v) })'
      )
    );
    const [len, sum, list] = tripleOf(
      run(
        'WithRandomSeed(7, do { let v = [j for j in 1..10 if random() < 0.5]; (length(v), sum(v), v) })'
      )
    );
    expect([Number(len), Number(sum)]).toEqual([list.length, sumOf(list)]);
  });

  test('a dependent comprehension with a random guard', () => {
    const [len, sum, list] = tripleOf(
      run(
        'WithRandomSeed(3, do { let v = [j for j in 1..10, k in 1..j if random() < 0.2]; (length(v), sum(v), v) })'
      )
    );
    expect(Number(len)).toBe(list.length);
    expect(Number(sum)).toBe(sumOf(list));
  });
});

describe('the count of one boxed instance', () => {
  const ce = new ComputeEngine();
  const guarded = (): Expression =>
    ce.box([
      'Comprehension',
      'j',
      ['Element', 'j', ['Range', 1, 30], ['Less', ['Random'], 0.5]],
    ]);
  const elements = (v: Expression): number[] =>
    [...v.each()].map((x) => x.re);

  test('the count, then the elements', () => {
    for (let i = 0; i < 10; i++) {
      const v = guarded();
      const n = v.count;
      expect(elements(v).length).toBe(n);
      expect(v.count).toBe(n);
    }
  });

  test('the elements, then the count', () => {
    for (let i = 0; i < 10; i++) {
      const v = guarded();
      const xs = elements(v);
      expect(v.count).toBe(xs.length);
      expect(elements(v)).toEqual(xs);
    }
  });

  // A read by position BEFORE a complete walk draws again for each read: the
  // memo keeps no partial walk of a random instance. That is CE-1125.
  test('the count, then a read by position and the elements', () => {
    for (let i = 0; i < 10; i++) {
      const v = guarded();
      const n = v.count;
      const second = v.at(2)?.re;
      const last = v.at(-1)?.re;
      const xs = elements(v);
      expect(xs.length).toBe(n);
      if (n !== undefined && n >= 2) expect(xs[1]).toBe(second);
      if (n !== undefined && n >= 1) expect(xs[n - 1]).toBe(last);
    }
  });

  test('the emptiness agrees with the elements', () => {
    for (let i = 0; i < 10; i++) {
      const v = ce.box([
        'Comprehension',
        'j',
        ['Element', 'j', ['Range', 1, 3], ['Less', ['Random'], 0.3]],
      ]);
      const empty = v.isEmptyCollection;
      expect(elements(v).length === 0).toBe(empty);
    }
  });

  test('a random guard over an infinite domain has no count', () => {
    const v = ce.box([
      'Comprehension',
      'j',
      [
        'Element',
        'j',
        ['Range', 1, 'PositiveInfinity'],
        ['Less', ['Random'], 0.5],
      ],
    ]);
    expect(v.count).toBeUndefined();
  });
});

describe('a pure guard keeps the count that does not run the body', () => {
  test('the count runs the guard, not the body', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('tick', {
      signature: '(number) -> number',
      pure: true,
      evaluate: (ops) => {
        calls += 1;
        return ops[0].evaluate();
      },
    });
    const v = ce.box([
      'Comprehension',
      ['tick', 'j'],
      ['Element', 'j', ['Range', 1, 10], ['Less', 'j', 4]],
    ]);
    expect(v.count).toBe(3);
    expect(calls).toBe(0);
  });
});
