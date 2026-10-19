import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// The elements of a set are not ordered: `isSame` compares two set literals
// as multisets of elements, and the hash of a set does not depend on the
// order of its elements. A two-operand set-builder (`Set(body, Element(…))`,
// `Set(…, Condition(…))`) is the exception: its operands have positions.
//
// A canonical set stores its elements in the canonical order (user decision
// 2026-10-19), so every operator that walks a set (`ListFrom`, `Reduce`,
// `String`...) gives the same result for two sets written in a different
// order. A structural or raw set keeps its written order.

const ce = new ComputeEngine();
const box = (json: unknown) => ce.box(json as any);
const raw = (json: unknown) => ce.box(json as any, { form: 'raw' });
const str = (x: Expression) => x.toString();

describe('isSame of two set literals ignores the order of the elements', () => {
  test('two elements, both directions, with equal hashes', () => {
    const a = box(['Set', 2, 1]);
    const b = box(['Set', 1, 2]);
    expect(a.isSame(b)).toBe(true);
    expect(b.isSame(a)).toBe(true);
    expect(a.hash).toBe(b.hash);
  });

  test('the canonical form sorts the elements; the structural form does not', () => {
    expect(box(['Set', 2, 1]).json).toEqual(['Set', 1, 2]);
    expect(box(['Set', 'y', 'x']).json).toEqual(['Set', 'x', 'y']);
    expect(box(['Set', 'x', 1]).json).toEqual(['Set', 1, 'x']);
    expect(
      ce.function('Set', [ce.number(2), ce.number(1)], { form: 'structural' })
        .json
    ).toEqual(['Set', 2, 1]);
    expect(raw(['Set', 2, 1]).json).toEqual(['Set', 2, 1]);
  });

  test('every permutation of three elements is the same set', () => {
    const ref = box(['Set', 1, 2, 3]);
    for (const p of [
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ]) {
      const s = box(['Set', ...p]);
      expect(s.isSame(ref)).toBe(true);
      expect(ref.isSame(s)).toBe(true);
      expect(s.hash).toBe(ref.hash);
    }
  });

  test('symbols and the parse route', () => {
    expect(box(['Set', 'x', 'y']).isSame(box(['Set', 'y', 'x']))).toBe(true);
    expect(ce.parse('\\{2, 1\\}').isSame(ce.parse('\\{1, 2\\}'))).toBe(true);
  });

  test('nested sets', () => {
    const a = box(['Set', ['Set', 1, 2], 3]);
    const b = box(['Set', 3, ['Set', 2, 1]]);
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    const c = box(['Set', ['Set', ['Set', 1, 2], 3], 4]);
    const d = box(['Set', 4, ['Set', 3, ['Set', 2, 1]]]);
    expect(c.isSame(d)).toBe(true);
    expect(c.hash).toBe(d.hash);
  });

  test('elements compare with isSame (1/2 is the same number as 0.5)', () => {
    expect(
      box(['Set', ['Rational', 1, 2], 3]).isSame(box(['Set', 3, 0.5]))
    ).toBe(true);
  });

  test('different elements or different sizes are not the same', () => {
    expect(box(['Set', 1, 2]).isSame(box(['Set', 1, 3]))).toBe(false);
    expect(box(['Set', 1, 2]).isSame(box(['Set', 1, 2, 3]))).toBe(false);
    expect(box(['Set', ['Set', 1, 2], 3]).isSame(box(['Set', 1, 2, 3]))).toBe(
      false
    );
  });

  test('a raw set keeps its duplicates and compares as a multiset', () => {
    expect(raw(['Set', 1, 1, 2]).isSame(raw(['Set', 1, 2, 1]))).toBe(true);
    expect(raw(['Set', 1, 1, 2]).hash).toBe(raw(['Set', 1, 2, 1]).hash);
    expect(raw(['Set', 1, 1, 2]).isSame(raw(['Set', 1, 2, 2]))).toBe(false);
    expect(raw(['Set', 1, 1]).isSame(raw(['Set', 1]))).toBe(false);
  });

  test('a large set in the reverse order', () => {
    const xs = Array.from({ length: 5000 }, (_, i) => i);
    const a = box(['Set', ...xs]);
    const b = box(['Set', ...xs.slice().reverse()]);
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    const c = box(['Set', ...xs.slice(1), 5000]);
    expect(a.isSame(c)).toBe(false);
  });

  test('lists and tuples stay ordered', () => {
    expect(box(['List', 2, 1]).isSame(box(['List', 1, 2]))).toBe(false);
    expect(box(['Tuple', 2, 1]).isSame(box(['Tuple', 1, 2]))).toBe(false);
  });

  test('a set-builder compares its body and indexing set by position', () => {
    const builder = box([
      'Set',
      ['Multiply', 2, 'k'],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    const swapped = box([
      'Set',
      ['Element', 'k', ['Range', 1, 3]],
      ['Multiply', 2, 'k'],
    ]);
    expect(builder.isSame(swapped)).toBe(false);
    expect(swapped.isSame(builder)).toBe(false);
    expect(builder.evaluate().json).toEqual(['Set', 2, 4, 6]);
  });
});

describe('the operators that compare elements with isSame agree', () => {
  test('a canonical set merges two elements that are the same set', () => {
    expect(box(['Set', ['Set', 1, 2], ['Set', 2, 1]]).json).toEqual([
      'Set',
      ['Set', 1, 2],
    ]);
  });

  test('Element and Count of a power set agree', () => {
    expect(
      str(
        box([
          'Element',
          ['Set', 2, 1],
          ['PowerSet', ['Set', 1, 2, 3]],
        ]).evaluate()
      )
    ).toBe('"True"');
    expect(
      str(
        box(['Count', ['PowerSet', ['Set', 1, 2, 3]], ['Set', 2, 1]]).evaluate()
      )
    ).toBe('1');
    expect(
      str(
        box([
          'Count',
          ['PowerSet', ['Set', 1, 2, 3]],
          ['Set', 3, 1, 2],
        ]).evaluate()
      )
    ).toBe('1');
    expect(
      str(
        box(['Count', ['PowerSet', ['Set', 1, 2, 3]], ['Set', 4, 1]]).evaluate()
      )
    ).toBe('0');
  });

  test('the countOf facet of PowerSet gives the count of a walk', () => {
    const ps = box(['PowerSet', ['Set', 1, 2, 3, 4]]);
    for (const target of [
      ['Set', 2, 1],
      ['Set', 4, 3, 1],
      ['Set', 3],
      ['Set', 1, 5],
    ]) {
      const t = box(target);
      let walked = 0;
      for (const x of ps.each()) if (x.isSame(t)) walked += 1;
      expect(str(box(['Count', ps.json, target]).evaluate())).toBe(
        String(walked)
      );
    }
  });

  test('Count, IndexOf, Contains, Unique and Tally over a list of sets', () => {
    const xs = ['List', ['Set', 1, 2], ['Set', 2, 1], ['Set', 1]];
    expect(str(box(['Count', xs, ['Set', 2, 1]]).evaluate())).toBe('2');
    expect(
      str(
        box([
          'IndexOf',
          ['List', ['Set', 3], ['Set', 1, 2]],
          ['Set', 2, 1],
        ]).evaluate()
      )
    ).toBe('2');
    expect(
      str(box(['Contains', ['List', ['Set', 1, 2]], ['Set', 2, 1]]).evaluate())
    ).toBe('"True"');
    expect(
      str(
        box([
          'Unique',
          ['List', ['Set', 1, 2, 3], ['Set', 3, 2, 1], ['Set', 2, 3, 1]],
        ]).evaluate()
      )
    ).toBe('[Set(1, 2, 3)]');
    expect(
      str(box(['Tally', ['List', ['Set', 1, 2], ['Set', 2, 1]]]).evaluate())
    ).toBe('([Set(1, 2)], [2])');
  });

  test('Union merges two elements that are the same set', () => {
    expect(
      str(
        box([
          'Union',
          ['Set', ['Set', 1, 2]],
          ['Set', ['Set', 2, 1]],
        ]).evaluate()
      )
    ).toBe('Set(Set(1, 2))');
  });

  test('Same', () => {
    expect(box(['Same', ['Set', 2, 1], ['Set', 1, 2]]).evaluate().symbol).toBe(
      'True'
    );
  });
});

describe('a set pattern matches the elements in any order', () => {
  test('a pattern with no wildcard', () => {
    expect(box(['Set', 2, 1]).match(box(['Set', 1, 2]))).toEqual({});
    expect(
      str(box(['Set', 2, 1]).replace({ match: ['Set', 1, 2], replace: 'x' })!)
    ).toBe('x');
  });

  test('a pattern with a wildcard', () => {
    const m = box(['Set', 2, 1]).match(raw(['Set', 1, '_a']));
    expect(m).not.toBeNull();
    expect(str(m!['_a'])).toBe('2');
  });

  test('a large set in the reverse order', () => {
    const xs = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(
      box(['Set', ...xs]).match(box(['Set', ...xs.slice().reverse()]))
    ).toEqual({});
  });

  test('a set-builder pattern matches by position', () => {
    const builder = box([
      'Set',
      ['Multiply', 2, 'k'],
      ['Element', 'k', ['Range', 1, 3]],
    ]);
    const swapped = box([
      'Set',
      ['Element', 'k', ['Range', 1, 3]],
      ['Multiply', 2, 'k'],
    ]);
    expect(swapped.match(builder)).toBeNull();
    expect(builder.match(builder)).toEqual({});
  });
});

describe('a canonical set stores its elements in the canonical order', () => {
  // Each pair is the same set written in two orders. Before the canonical
  // order, the operators that walk a set read the written order, so a
  // rewrite that relied on `isSame` changed the value.
  const reduce = (xs: unknown[]) => ['Reduce', ['Set', ...xs], 'Subtract'];

  test('Reduce gives the same value for the two written orders', () => {
    const a = box(reduce(['x', 1])).evaluate();
    const b = box(reduce([1, 'x'])).evaluate();
    expect(a.isSame(b)).toBe(true);
    const diff = box(['Subtract', reduce(['x', 1]), reduce([1, 'x'])]);
    expect(diff.evaluate().isSame(0)).toBe(true);
    expect(diff.simplify().isSame(0)).toBe(true);
  });

  test('a set of the two values has one element', () => {
    const s = box(['Set', reduce(['x', 1]), reduce([1, 'x'])]).evaluate();
    expect(s.nops).toBe(1);
  });

  test('First(ListFrom(…)): isEqual and Equal agree', () => {
    const a = box(['First', ['ListFrom', ['Set', 'x', 1]]]);
    const b = box(['First', ['ListFrom', ['Set', 1, 'x']]]);
    expect(a.isEqual(b)).toBe(true);
    expect(box(['Equal', a.json, b.json]).evaluate().symbol).toBe('True');
  });

  test('String of the two sets is the same string', () => {
    const s = box([
      'Set',
      ['String', ['Set', 'x', 1]],
      ['String', ['Set', 1, 'x']],
    ]).evaluate();
    expect(s.nops).toBe(1);
  });

  test('ListFrom and the LaTeX serialization read the canonical order', () => {
    expect(box(['ListFrom', ['Set', 2, 1]]).evaluate().json).toEqual([
      'List',
      1,
      2,
    ]);
    expect(box(['Set', 'x', 1]).latex).toBe(box(['Set', 1, 'x']).latex);
    expect(ce.parse('\\{2, 1\\}').json).toEqual(['Set', 1, 2]);
  });

  test('the results of the set operations are in the canonical order', () => {
    const json = (x: unknown) => box(x).evaluate().json;
    expect(json(['Union', ['List', 3, 1], ['List', 2, 1]])).toEqual([
      'Set',
      1,
      2,
      3,
    ]);
    expect(json(['Union', ['List', 2, 1], ['List', 1, 3]])).toEqual([
      'Set',
      1,
      2,
      3,
    ]);
    expect(json(['Intersection', ['List', 3, 2, 1], ['Set', 1, 2, 3]])).toEqual(
      ['Set', 1, 2, 3]
    );
    expect(json(['SymmetricDifference', ['Set', 3, 1], ['Set', 2, 1]])).toEqual(
      ['Set', 2, 3]
    );
  });

  test('the subsets of a power set are in the canonical order', () => {
    const subsets = [
      ...box(['PowerSet', ['Set', 'x', 2, 1]])
        .evaluate()
        .each(),
    ].map((s) => s.json);
    expect(subsets).toEqual([
      'EmptySet',
      ['Set', 1],
      ['Set', 2],
      ['Set', 1, 2],
      ['Set', 'x'],
      ['Set', 1, 'x'],
      ['Set', 2, 'x'],
      ['Set', 1, 2, 'x'],
    ]);
  });

  test('elements that order() ties are sorted by their operands', () => {
    expect(box(['Set', ['List', 3, 4], ['List', 1, 2]]).json).toEqual([
      'Set',
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(box(['Set', ['f', 'y', 'x'], ['f', 'x', 'y']]).json).toEqual([
      'Set',
      ['f', 'x', 'y'],
      ['f', 'y', 'x'],
    ]);
  });

  test('every written order of mixed elements gives one canonical form', () => {
    const elements: unknown[] = [
      'x',
      'Pi',
      1,
      2.5,
      ['Rational', 1, 3],
      ['Sqrt', 2],
      ['Complex', 1, 2],
      ['List', 1, 2],
      ['List', 3, 4],
      ['Set', 3, 'x'],
      ['Sin', 'x'],
      ['f', 'x', 'y'],
      ['f', 'y', 'x'],
      ['Add', 'x', 1],
      ['Tuple', 1, 'x'],
      ['Tuple', 'x', 1],
      { str: 'abc' },
      { str: 'b' },
    ];
    const ref = JSON.stringify(box(['Set', ...elements]).json);
    // A fixed sequence of rotations and reversals, so the test is the same
    // on every run.
    for (let k = 1; k < elements.length; k++) {
      const rotated = [...elements.slice(k), ...elements.slice(0, k)];
      expect(JSON.stringify(box(['Set', ...rotated]).json)).toBe(ref);
      expect(JSON.stringify(box(['Set', ...rotated.reverse()]).json)).toBe(ref);
    }
  });

  test('a two-element set with an Element operand keeps its order', () => {
    // Sorted, `{k ∈ S, 2k}` would be `{2k, k ∈ S}`, which is a set-builder.
    expect(
      box(['Set', ['Element', 'k', ['Range', 1, 3]], ['Multiply', 2, 'k']]).json
    ).toEqual(['Set', ['Element', 'k', ['Range', 1, 3]], ['Multiply', 2, 'k']]);
  });
});

describe('a set with an ellipsis keeps its order', () => {
  test('the ellipsis stays between its neighbours', () => {
    const s = ce.parse('\\{a_1, a_2, \\dots, a_n\\}');
    const ops = s.ops!.map((x) => JSON.stringify(x.json));
    expect(ops.indexOf('"ContinuationPlaceholder"')).toBe(2);
    // Compared by position: another order is another notation.
    expect(s.isSame(ce.parse('\\{a_n, \\dots, a_1, a_2\\}'))).toBe(false);
  });
});
