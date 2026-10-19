/**
 * Collection views and eager collection operators: seven fixes.
 *
 * 1. A view that reads its source by a position computed from the count of
 *    the source (`Reverse`, `Most`, `RotateLeft`, `RotateRight`) over a
 *    finite source with no count (`FlatMap([1, 2], x ↦ [x, x])`, whose count
 *    needs the results of its callback) lists its source once, so that a
 *    consumer of the view (`Sum`, `Max`, `First`) gets a value. Over a source
 *    that cannot be listed, or an infinite source, the view cannot be
 *    enumerated, and its consumer stays unevaluated.
 * 2. `Insert`, `DeleteAt` and `ReplaceAt` list such a source too.
 * 3. The walks of `Permutations`, `Combinations` and `PowerSet` are loops, not
 *    recursions of depth `k`, and `PowerSet` does not use 32-bit masks.
 * 4. `Sort` and `Ordering` refuse a comparator whose parameter type does not
 *    accept every element.
 * 5. A positional view refused for a set gives the bare `Error` with its
 *    frame, as `Sort` does.
 * 6. A `Table` whose upper bound is below its lower bound, with a positive
 *    step, is `[]`.
 * 7. `z ∈ Filter([z], y ↦ y > 0)` stays unevaluated, and a predicate error
 *    does not give a spell-check hint about a parameter of the predicate.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const doubled = [
  'FlatMap',
  ['List', 1, 2],
  ['Function', ['List', 'x', 'x'], 'x'],
];
const DOUBLED_LATEX = '\\operatorname{FlatMap}([1, 2], x \\mapsto [x, x])';

function evaluate(expr: unknown): string {
  return ce
    .box(expr as any)
    .evaluate()
    .toString();
}

function parseEvaluate(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('1. a position view over a finite source with no count', () => {
  test.each([
    ['Reverse', [], '6', '2', '1'],
    ['Most', [], '4', '1', '2'],
    ['RotateLeft', [], '6', '1', '1'],
    ['RotateRight', [1], '6', '2', '2'],
  ])('%s', (op, extra, sum, first, last) => {
    const view = [op, doubled, ...extra];
    expect(evaluate(['Sum', view])).toBe(sum);
    expect(evaluate(['First', view])).toBe(first);
    expect(evaluate(['Last', view])).toBe(last);
    expect(evaluate(['Max', view])).toBe('2');
  });

  test('the ROADMAP example', () => {
    expect(evaluate(['Sum', ['Reverse', doubled]])).toBe('6');
    expect(evaluate(['Product', ['Reverse', doubled]])).toBe('4');
    expect(evaluate(['Reverse', doubled])).toBe('[2,2,1,1]');
  });

  test('a view of a view', () => {
    expect(evaluate(['Sum', ['Reverse', ['Reverse', doubled]]])).toBe('6');
    expect(evaluate(['First', ['Reverse', ['Reverse', doubled]]])).toBe('1');
  });

  test('parse route', () => {
    expect(
      parseEvaluate(
        `\\operatorname{Sum}(\\operatorname{Reverse}(${DOUBLED_LATEX}))`
      )
    ).toBe('6');
    expect(
      parseEvaluate(
        `\\operatorname{Max}(\\operatorname{Most}(${DOUBLED_LATEX}))`
      )
    ).toBe('2');
  });

  test('async route', async () => {
    const result = await ce
      .box(['Sum', ['Reverse', doubled]] as any)
      .evaluateAsync();
    expect(result.toString()).toBe('6');
  });

  test('a source that cannot be listed stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'list<integer>');
    const missing = [
      'FlatMap',
      ['List', 1, 2],
      ['Function', ['Join', ['List', 'x'], 'v'], 'x'],
    ];
    for (const op of ['Reverse', 'Most', 'RotateLeft', 'RotateRight']) {
      expect(ce.box(['Sum', [op, missing]]).evaluate().operator).toBe('Sum');
      // The walk of the source misses the elements of `v`, so the search
      // does not decide: it answered `False`.
      expect(
        ce
          .box(['Any', [op, missing], ['Function', ['Greater', 'x', 5], 'x']])
          .evaluate().operator
      ).toBe('Any');
    }
  });

  test('a view over an eager source', () => {
    // `Divisors(12)` has no count before it is evaluated. The rotations and
    // `Most` walked nothing: `Sum` answered `0` and `Any` answered `False`.
    const gt1 = ['Function', ['Greater', 'x', 1], 'x'];
    for (const [op, sum] of [
      ['Reverse', '28'],
      ['RotateLeft', '28'],
      ['RotateRight', '28'],
      ['Most', '16'],
    ]) {
      expect(evaluate(['Sum', [op, ['Divisors', 12]]])).toBe(sum);
      expect(evaluate(['Any', [op, ['Divisors', 12]], gt1])).toBe('"True"');
    }
    expect(evaluate(['RotateLeft', ['Divisors', 12]])).toBe('[2,3,4,6,12,1]');
  });

  test('a rotation by an offset that has no value', () => {
    // The walk cannot compute a position. `Any` answered `False`.
    for (const op of ['RotateLeft', 'RotateRight']) {
      expect(
        evaluate([
          'Any',
          [op, ['List', 1, 2, 3], 'n'],
          ['Function', ['Greater', 'x', 0], 'x'],
        ])
      ).toMatch(/^Any\(/);
    }
  });

  test('a view that reads its source from the end over an infinite source', () => {
    // An infinite collection has no last element. These answered `False`.
    for (const op of ['Reverse', 'RotateLeft', 'RotateRight']) {
      expect(
        evaluate([
          'Any',
          [op, ['Range', 1, 'PositiveInfinity']],
          ['Function', ['Greater', 'x', 0], 'x'],
        ])
      ).toMatch(/^Any\(/);
    }
    // `Most` of an infinite collection is the collection itself.
    expect(
      evaluate([
        'Any',
        ['Most', ['Range', 1, 'PositiveInfinity']],
        ['Function', ['Greater', 'x', 0], 'x'],
      ])
    ).toBe('"True"');
  });
});

describe('2. Insert, DeleteAt and ReplaceAt over a source with no count', () => {
  test('the eager handlers list the source', () => {
    expect(evaluate(['Insert', doubled, 1, 0])).toBe('[0,1,1,2,2]');
    expect(evaluate(['Insert', doubled, -1, 0])).toBe('[1,1,2,2,0]');
    expect(evaluate(['DeleteAt', doubled, 1])).toBe('[1,2,2]');
    expect(evaluate(['DeleteAt', doubled, -1])).toBe('[1,1,2]');
    expect(evaluate(['ReplaceAt', doubled, 1, 0])).toBe('[0,1,2,2]');
  });

  test('a consumer that holds its operand', () => {
    expect(evaluate(['Sum', ['Insert', doubled, 1, 0]])).toBe('6');
    expect(evaluate(['Sum', ['DeleteAt', doubled, 1]])).toBe('5');
    expect(evaluate(['Sum', ['ReplaceAt', doubled, 1, 5]])).toBe('10');
  });

  test('an index outside the source stays unevaluated', () => {
    expect(evaluate(['Insert', doubled, 9, 0])).toMatch(/^Insert\(/);
    expect(evaluate(['Sum', ['Insert', doubled, 9, 0]])).toMatch(/^sum\(/);
    expect(evaluate(['Sum', ['DeleteAt', doubled, 9]])).toMatch(/^sum\(/);
    expect(evaluate(['Sum', ['ReplaceAt', doubled, -9, 0]])).toMatch(/^sum\(/);
  });

  test('parse route', () => {
    expect(
      parseEvaluate(`\\operatorname{Insert}(${DOUBLED_LATEX}, 1, 0)`)
    ).toBe('[0,1,1,2,2]');
  });
});

describe('3. the walks of the combinatorial collections', () => {
  test('a long permutation', () => {
    const first = ce
      .box(['First', ['Permutations', ['Range', 1, 5000]]])
      .evaluate();
    expect(first.operator).toBe('List');
    expect(first.nops).toBe(5000);
    expect(first.ops![0].toString()).toBe('1');
    expect(first.ops![4999].toString()).toBe('5000');
  });

  test('a long combination', () => {
    const first = ce
      .box(['First', ['Combinations', ['Range', 1, 5000], 5000]])
      .evaluate();
    expect(first.nops).toBe(5000);
    expect(first.ops![4999].toString()).toBe('5000');
  });

  test('the order of the elements does not change', () => {
    expect(evaluate(['Permutations', ['List', 1, 2, 3]])).toBe(
      '[[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]'
    );
    expect(evaluate(['Permutations', ['List', 1, 2, 3], 2])).toBe(
      '[[1,2],[1,3],[2,1],[2,3],[3,1],[3,2]]'
    );
    expect(evaluate(['Permutations', ['List'], 0])).toBe('[[]]');
    expect(evaluate(['Permutations', ['List']])).toBe('[[]]');
    expect(evaluate(['Permutations', ['List', 1, 2], 3])).toBe('[]');
    expect(evaluate(['Combinations', ['List', 1, 2, 3, 4], 2])).toBe(
      '[[1,2],[1,3],[1,4],[2,3],[2,4],[3,4]]'
    );
    expect(evaluate(['Combinations', ['List', 1, 2, 3], 3])).toBe('[[1,2,3]]');
    expect(evaluate(['Combinations', ['List', 1, 2, 3], 4])).toBe('[]');
    expect(
      [...ce.box(['PowerSet', ['Set', 1, 2, 3]]).each()].map(String)
    ).toEqual([
      '"EmptySet"',
      'Set(1)',
      'Set(2)',
      'Set(1, 2)',
      'Set(3)',
      'Set(1, 3)',
      'Set(2, 3)',
      'Set(1, 2, 3)',
    ]);
  });

  test('a power set of 33 elements', () => {
    // `1 << 33` is `2` in JavaScript: the walk ended after two subsets.
    const set = ['Set', ...Array.from({ length: 33 }, (_, i) => i + 1)];
    const it = ce.box(['PowerSet', set]).each();
    const firsts: string[] = [];
    for (let i = 0; i < 4; i++) firsts.push(it.next().value!.toString());
    expect(firsts).toEqual(['"EmptySet"', 'Set(1)', 'Set(2)', 'Set(1, 2)']);
  });
});

describe('4. a typed comparator must accept every element', () => {
  const integerComparator = [
    'Function',
    ['Subtract', 'b', 'a'],
    ['Typed', 'a', "'integer'"],
    ['Typed', 'b', "'integer'"],
  ];

  test.each(['Sort', 'Ordering'])('%s refuses it', (op) => {
    const result = ce
      .box([op, ['List', 3, 1.5, 2], integerComparator])
      .evaluate();
    expect(result.json).toEqual([
      'Error',
      [
        'ErrorCode',
        "'incompatible-type'",
        "'(real, real) any -> boolean | number'",
        "'(a: integer, b: integer) -> integer'",
      ],
      [
        'Function',
        ['Block', ['Add', ['Negate', 'a'], 'b']],
        ['Typed', 'a', "'integer'"],
        ['Typed', 'b', "'integer'"],
      ],
      ['ErrorTrace', ['ErrorFrame', `'${op}'`, 2]],
    ]);
  });

  test('a rational element', () => {
    expect(
      ce
        .box(['Sort', ['List', 3, ['Rational', 1, 2]], integerComparator])
        .evaluate().operator
    ).toBe('Error');
  });

  test('the elements are integers', () => {
    expect(evaluate(['Sort', ['List', 3, 1, 2], integerComparator])).toBe(
      '[3,2,1]'
    );
  });

  test('a source with a symbol that has no value is not refused', () => {
    // `x` can hold an integer, so the comparator can accept every element.
    expect(
      ce.box(['Sort', ['List', 3, 'x', 2], integerComparator]).evaluate()
        .operator
    ).toBe('List');
  });

  test('parse route', () => {
    const result = ce
      .parse(
        '\\operatorname{Sort}([3, 1.5, 2], (a: \\operatorname{integer}, b: \\operatorname{integer}) \\mapsto b - a)'
      )
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toMatch(/incompatible-type/);
  });
});

describe('5. a positional view refused for a set', () => {
  const ce = new ComputeEngine();
  ce.assign('c', ce.box(['Set', 1, 2, 3]));
  const refusal = (op: string, index = 1) => [
    'Error',
    [
      'ErrorCode',
      "'incompatible-type'",
      "'indexed_collection'",
      "'set<integer>'",
    ],
    ['Set', 1, 2, 3],
    ['ErrorTrace', ['ErrorFrame', `'${op}'`, index]],
  ];

  test.each([
    ['Reverse', []],
    ['Take', [1]],
    ['Drop', [1]],
    ['Rest', []],
    ['Most', []],
    ['RotateLeft', []],
    ['RotateRight', [1]],
    ['Slice', [1, 2]],
    ['Zip', []],
  ])('%s gives the bare Error', (op, extra) => {
    expect(ce.box([op, 'c', ...extra]).evaluate().json).toEqual(refusal(op));
    // A literal set, refused when the call is boxed.
    expect(ce.box([op, ['Set', 1, 2, 3], ...extra]).evaluate().json).toEqual(
      refusal(op)
    );
  });

  test('as Sort does', () => {
    expect(ce.box(['Sort', 'c']).evaluate().json).toEqual(refusal('Sort'));
  });

  test('the second source of Zip', () => {
    expect(ce.box(['Zip', ['List', 1, 2], 'c']).evaluate().json).toEqual(
      refusal('Zip', 2)
    );
  });

  test('async route', async () => {
    const result = await ce.box(['Reverse', 'c']).evaluateAsync();
    expect(result.json).toEqual(refusal('Reverse'));
  });

  test('parse route', () => {
    const result = ce
      .parse('\\operatorname{Reverse}(\\{1, 2, 3\\})')
      .evaluate();
    expect(result.operator).toBe('Error');
    expect(JSON.stringify(result.json)).toMatch(/ErrorFrame.*Reverse/);
  });

  test('the boxed form keeps the error in place', () => {
    expect(ce.box(['Reverse', ['Set', 1, 2, 3]]).operator).toBe('Reverse');
  });
});

describe('6. a Table with an empty range', () => {
  const square = ['Power', 'k', 2];

  test('the upper bound is below the lower bound', () => {
    expect(evaluate(['Table', square, ['Tuple', 'k', 1, 0]])).toBe('[]');
    expect(evaluate(['Table', square, ['Tuple', 'k', 2, 0]])).toBe('[]');
    expect(evaluate(['Table', square, ['Tuple', 'k', 0]])).toBe('[]');
    expect(evaluate(['Table', square, ['Tuple', 'k', -3]])).toBe('[]');
    expect(evaluate(['Table', square, ['Tuple', 'k', 1, 0.5]])).toBe('[]');
    expect(evaluate(['Table', square, ['Tuple', 'k', 3, 1, 1]])).toBe('[]');
  });

  test('a count-down needs an explicit negative step', () => {
    expect(evaluate(['Table', square, ['Tuple', 'k', 2, 0, -1]])).toBe(
      '[4,1,0]'
    );
  });

  test('two dimensions', () => {
    const ij = ['Multiply', 'i', 'j'];
    expect(
      evaluate(['Table', ij, ['Tuple', 'i', 1, 2], ['Tuple', 'j', 1, 0]])
    ).toBe('[[],[]]');
    expect(
      evaluate(['Table', ij, ['Tuple', 'i', 1, 0], ['Tuple', 'j', 1, 3]])
    ).toBe('[]');
  });

  test('a range that is not empty', () => {
    expect(evaluate(['Table', square, ['Tuple', 'k', 1, 3]])).toBe('[1,4,9]');
    expect(evaluate(['Table', square, ['Tuple', 'k', 2, 4]])).toBe('[4,9,16]');
  });

  test('a symbolic upper bound that is assigned later', () => {
    const ce = new ComputeEngine();
    const table = ce.box(['Table', 'k', ['Tuple', 'k', 2, 'm']]);
    ce.assign('m', 0);
    expect(table.evaluate().toString()).toBe('[]');
  });

  test('parse route', () => {
    expect(parseEvaluate('\\operatorname{Table}(k^2, (k, 1, 0))')).toBe('[]');
    expect(parseEvaluate('\\operatorname{Table}(k^2, (k, 2, 0))')).toBe('[]');
  });
});

describe('7. Element over a Filter with an undecided predicate', () => {
  const filter = [
    'Filter',
    ['List', 'z'],
    ['Function', ['Greater', 'y', 0], 'y'],
  ];

  test('the membership is undecided', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Element', 'z', filter]).evaluate().operator).toBe(
      'Element'
    );
    expect(ce.box(filter).contains(ce.symbol('z'))).toBeUndefined();
  });

  test('parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse('z \\in \\operatorname{Filter}([z], y \\mapsto y > 0)')
        .evaluate().operator
    ).toBe('Element');
  });

  test('a value for the element decides it', () => {
    const ce = new ComputeEngine();
    ce.assign('z', 3);
    expect(ce.box(['Element', 'z', filter]).evaluate().toString()).toBe(
      '"True"'
    );
  });

  test('no spell-check hint about a parameter of the predicate', () => {
    const ce = new ComputeEngine();
    // The predicate `y ↦ y > 0` is applied to `z`: the hint said
    // `Unknown symbol "y". Did you mean "z"?`.
    let message = '';
    try {
      ce.box(filter).evaluate();
      ce.box(['Count', filter]).evaluate();
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/Unknown symbol "y"/);
    // A misspelled operator still gives a hint.
    expect(() =>
      ce
        .box(['CountIf', ['List', 1, 2], ['Function', ['Greter', 'x', 1], 'x']])
        .evaluate()
    ).toThrow(/Did you mean "Greater"/);
  });
});
