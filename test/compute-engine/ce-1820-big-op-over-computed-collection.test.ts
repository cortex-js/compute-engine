import { ComputeEngine } from '../../src/compute-engine';

//
// CE-1820: a `Sum` or a `Product` over the elements of a call whose value is
// a finite collection (`Sort(L)`, `Reverse(L)`, `Take(L, n)`) stayed
// unevaluated: only a written `List`, `Set`, `Range` or `Interval` was read.
// The collection is now evaluated and its elements are the values of the
// index. A computed list of two integers is a list, not a range.
//

const ce = new ComputeEngine();
const value = (e: unknown) => ce.expr(e as any).evaluate().json;
const L = ['List', 3, 2, 1];

describe('CE-1820 BIG OPERATOR OVER A COMPUTED COLLECTION', () => {
  test.each([
    ['Sort', ['Sort', L], 14, 36],
    ['Reverse', ['Reverse', L], 14, 36],
    ['Take', ['Take', L, 2], 13, 36],
  ])('%s', (_, xs, sum, product) => {
    expect(value(['Sum', ['Power', 'k', 2], ['Element', 'k', xs]])).toBe(sum);
    expect(value(['Product', ['Power', 'k', 2], ['Element', 'k', xs]])).toBe(
      product
    );
  });

  test('A computed list of two integers is not a range', () => {
    // A written `[1, 5]` is the range 1..5; `Take([1, 5, 7], 2)` is [1, 5].
    expect(
      value(['Sum', 'k', ['Element', 'k', ['Take', ['List', 1, 5, 7], 2]]])
    ).toBe(6);
  });

  test('A condition filters the elements', () => {
    expect(
      value(['Sum', 'k', ['Element', 'k', ['Sort', L], ['Greater', 'k', 1]]])
    ).toBe(5);
  });

  test('A collection that names an outer index', () => {
    // i = 1: 1·1, i = 2: 2·(1 + 2), i = 3: 3·(1 + 2 + 3)
    expect(
      value([
        'Sum',
        ['Multiply', 'i', 'j'],
        ['Limits', 'i', 1, 3],
        ['Element', 'j', ['Take', ['List', 1, 2, 3], 'i']],
      ])
    ).toBe(25);
  });

  test('A collection that does not evaluate stays unevaluated', () => {
    const e = ['Sum', 'k', ['Element', 'k', ['Sort', ['List', 'x', 1]]]];
    expect(value(e)).toEqual(e);
  });

  test('A view of a declared collection with no value stays unevaluated', () => {
    // `Take(L, 2)` has a count of 2 and no elements: the sum is not 0.
    const ce = new ComputeEngine();
    ce.declare('L', 'vector<3>');
    const e = ['Sum', 'k', ['Element', 'k', ['Take', 'L', 2]]];
    expect(ce.expr(e as any).evaluate().json).toEqual(e);
  });

  test('A pure call domain is evaluated once', () => {
    // A counter is enough to see the evaluations; `Gen` is declared pure.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Gen', {
      signature: '() -> list<integer>',
      pure: true,
      evaluate: () => {
        calls += 1;
        return ce.expr(['List', 1, 2, 3]);
      },
    });
    const once = (e: unknown, expected: unknown) => {
      calls = 0;
      expect(ce.expr(e as any).evaluate().json).toEqual(expected);
      expect(calls).toBe(1);
    };
    once(['Sum', 'k', ['Element', 'k', ['Gen']]], 6);
    once(['Sum', 'k', ['Element', 'k', ['Gen'], ['Greater', 'k', 1]]], 5);
    once(['ForAll', ['Element', 'k', ['Gen']], ['Greater', 'k', 0]], 'True');
  });

  test('An impure call domain is not evaluated', () => {
    // A quantifier that is not decided returns the call as written: an
    // evaluation of the call here would run its effects once more at the
    // next evaluation.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('Gen', {
      signature: '() -> list<integer>',
      pure: false,
      evaluate: () => {
        calls += 1;
        return ce.expr(['List', 1, 2, 3]);
      },
    });
    const sum = ['Sum', 'k', ['Element', 'k', ['Gen']]];
    expect(ce.expr(sum as any).evaluate().json).toEqual(sum);
    const forAll = ce.expr([
      'ForAll',
      ['Element', 'k', ['Gen']],
      ['Greater', 'k', 't'],
    ]);
    expect(forAll.evaluate().json).toEqual(forAll.json);
    expect(calls).toBe(0);
  });

  test('The quantifiers read the computed collection too', () => {
    expect(
      value(['ForAll', ['Element', 'x', ['Sort', L]], ['Greater', 'x', 0]])
    ).toBe('True');
    expect(
      value(['Exists', ['Element', 'x', ['Reverse', L]], ['Equal', 'x', 5]])
    ).toBe('False');
  });
});
