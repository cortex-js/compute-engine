import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Change 2 of `docs/COLLECTIONS-MODEL.md`:
 * a VARIADIC `Append` — `(collection, value+) -> collection` — plus a
 * same-head flatten at canonicalization so an accumulator chain stays at
 * depth 1.
 *
 * The nested form is unobservable after canonicalization (that is the whole
 * point of the flatten), so the reference for "element-for-element equal to
 * the nested form" is the STRUCTURAL form: bound, collection handlers live,
 * but not canonicalized.
 *
 * The sources below are `Range(1, 2)`, a lazy view, not the list literal
 * `[1, 2]`: a `Join` or `Append` whose operands are all list literals folds
 * into one list literal at canonicalization (pinned in
 * `join-append-literal-fold.test.ts`), which would leave nothing to observe
 * here.
 */

const ce = new ComputeEngine();

const structural = (expr: Expression) =>
  ce.expr(expr, { form: 'structural' } as any);

const elements = (expr: Expression | ReturnType<typeof structural>) => {
  const e = typeof expr === 'object' && 'each' in expr ? expr : ce.box(expr);
  return [...e.each()].map((x) => x.toString());
};

/** count / each() / at() of a collection, as a comparable record. */
function profile(e: ReturnType<typeof structural>) {
  const count = e.count;
  const finite = typeof count === 'number' && Number.isFinite(count);
  return {
    count,
    each: finite ? [...e.each()].map((x) => x.toString()) : undefined,
    at: finite
      ? Array.from({ length: count }, (_, i) => e.at(i + 1)?.toString()).concat(
          Array.from({ length: count }, (_, i) => e.at(-(i + 1))?.toString())
        )
      : undefined,
  };
}

describe('Append: variadic signature', () => {
  test('the binary MathJSON form is unchanged', () => {
    const e = ce.box(['Append', ['Range', 1, 2], 3]);
    expect(e.json).toEqual(['Append', ['Range', 1, 2], 3]);
    expect(e.nops).toBe(2);
    expect(elements(e)).toEqual(['1', '2', '3']);
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });

  test('an explicit 3-ary form is accepted (box route)', () => {
    const e = ce.box(['Append', ['Range', 1, 2], 3, 4]);
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(3);
    expect(e.count).toBe(4);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an explicit 3-ary form is accepted (ce.function route)', () => {
    const e = ce.function('Append', [
      ce.box(['Range', 1, 2]),
      ce.box(3),
      ce.box(4),
    ]);
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(3);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an explicit 3-ary form is accepted (parse route)', () => {
    const e = ce.parse('\\mathrm{Append}(\\mathrm{Range}(1,2), 3, 4)');
    expect(e.operator).toBe('Append');
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(3);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('a 5-ary form appends every value in order', () =>
    expect(elements(['Append', ['List', 1], 2, 3, 4, 5])).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
    ]));
});

describe('Append: appended values stay atomic', () => {
  // Each of the three shapes appends as exactly ONE element, and the
  // flattened form matches the nested form element-for-element.
  const triple: [string, Expression, Expression][] = [
    // [label, nested, flattened]
    [
      'scalar',
      ['Append', ['Append', ['Range', 1, 2], 3], 4],
      ['Append', ['Range', 1, 2], 3, 4],
    ],
    [
      'list (a row appended to a matrix)',
      [
        'Append',
        ['Append', ['List', ['Range', 1, 2], ['List', 3, 4]], ['List', 5, 6]],
        ['List', 7, 8],
      ],
      [
        'Append',
        ['List', ['Range', 1, 2], ['List', 3, 4]],
        ['List', 5, 6],
        ['List', 7, 8],
      ],
    ],
    [
      'tuple (a point appended to a point list)',
      [
        'Append',
        ['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4]],
        ['Tuple', 5, 6],
      ],
      ['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4], ['Tuple', 5, 6]],
    ],
  ];

  for (const [label, nested, flat] of triple)
    test(`${label}: flattened === nested, element for element`, () =>
      expect(profile(ce.box(flat))).toEqual(profile(structural(nested))));

  test('a row appended to a matrix is one row, not two elements', () => {
    const e = ce.box([
      'Append',
      ['List', ['Range', 1, 2], ['List', 3, 4]],
      ['List', 5, 6],
    ]);
    expect(e.count).toBe(3);
    expect(elements(e)).toEqual(['[1,2]', '[3,4]', '[5,6]']);
  });

  test('a point appended to a point list is one point', () => {
    const e = ce.box(['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4]]);
    expect(e.count).toBe(2);
    expect(elements(e)).toEqual(['(1, 2)', '(3, 4)']);
  });
});

describe('Append: a tuple SOURCE is still enumerated', () => {
  // Round-2 CRITICAL of the design doc: `Append` ENUMERATES a tuple source
  // (`Append((1,2),3)` has 3 elements) while `Join` holds a tuple operand
  // ATOMIC (`Join((1,2),[3])` has 2). The same-head flatten must not change
  // this — which is exactly why the cross-head rewrites were dropped.
  test('Append((1,2), 3) has 3 elements', () =>
    expect(elements(['Append', ['Tuple', 1, 2], 3])).toEqual(['1', '2', '3']));

  test('Join((1,2), [3]) still has 2 elements', () =>
    expect(elements(['Join', ['Tuple', 1, 2], ['List', 3]])).toEqual([
      '(1, 2)',
      '3',
    ]));

  test('the flattened Append((1,2), 3, 4) enumerates to 1, 2, 3, 4', () => {
    const e = ce.box(['Append', ['Append', ['Tuple', 1, 2], 3], 4]);
    expect(e.nops).toBe(3);
    expect(e.count).toBe(4);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('and agrees with the nested form element-for-element', () =>
    expect(
      profile(ce.box(['Append', ['Append', ['Tuple', 1, 2], 3], 4]))
    ).toEqual(
      profile(structural(['Append', ['Append', ['Tuple', 1, 2], 3], 4]))
    ));
});

describe('Append/Join: same-head flatten', () => {
  test('a chain of k Appends is ONE node of width k + 1', () => {
    let e: Expression = ['Range', 0, 0];
    for (let i = 1; i <= 12; i++) e = ['Append', e, i];
    const boxed = ce.box(e);
    expect(boxed.operator).toBe('Append');
    expect(boxed.nops).toBe(13);
    expect(boxed.count).toBe(13);
    expect(elements(boxed)).toEqual(
      Array.from({ length: 13 }, (_, i) => `${i}`)
    );
  });

  test('the flatten is route-independent (box / parse / ce.function)', () => {
    const viaBox = ce.box(['Append', ['Append', ['Range', 1, 2], 3], 4]);
    const viaParse = ce.parse(
      '\\mathrm{Append}(\\mathrm{Append}(\\mathrm{Range}(1,2), 3), 4)'
    );
    const viaFn = ce.function('Append', [
      ce.function('Append', [ce.box(['Range', 1, 2]), ce.box(3)]),
      ce.box(4),
    ]);
    for (const e of [viaBox, viaParse, viaFn]) {
      expect(e.operator).toBe('Append');
      expect(e.nops).toBe(3);
      expect(e.json).toEqual(['Append', ['Range', 1, 2], 3, 4]);
    }
  });

  test('a single un-nested Append is not rewritten', () => {
    const e = ce.box(['Append', ['Range', 1, 2], 3]);
    expect(e.json).toEqual(['Append', ['Range', 1, 2], 3]);
  });

  test('Join(Join(a, b), c) flattens to one Join', () => {
    const e = ce.box([
      'Join',
      ['Join', ['Range', 1, 2], ['List', 3]],
      ['List', 4],
    ]);
    expect(e.operator).toBe('Join');
    expect(e.nops).toBe(3);
    expect(e.json).toEqual(['Join', ['Range', 1, 2], ['List', 3], ['List', 4]]);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an inner Join keeps its atomic tuple operand atomic', () => {
    const e = ce.box([
      'Join',
      ['Join', ['Range', 1, 2], ['Tuple', 3, 4]],
      ['List', 5],
    ]);
    expect(e.nops).toBe(3);
    expect(elements(e)).toEqual(['1', '2', '(3, 4)', '5']);
  });

  // NO cross-head rewrites — a deliberate, reviewed decision.
  test('Append(Join(c, d), v) stays nested', () => {
    const e = ce.box(['Append', ['Join', ['Range', 1, 2], ['List', 3]], 4]);
    expect(e.operator).toBe('Append');
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Join');
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('Join(Append(c, v), d) stays nested', () => {
    const e = ce.box(['Join', ['Append', ['Range', 1, 2], 3], ['List', 4]]);
    expect(e.operator).toBe('Join');
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('a mixed chain has depth equal to its alternation count', () => {
    // Append(Join(Append([1,2], 3), [4]), 5) — three heads, three levels.
    const e = ce.box([
      'Append',
      ['Join', ['Append', ['Range', 1, 2], 3], ['List', 4]],
      5,
    ]);
    expect(e.operator).toBe('Append');
    expect(e.op1.operator).toBe('Join');
    expect(e.op1.op1.operator).toBe('Append');
    expect(elements(e)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('Append: indexing over the combined length', () => {
  const binary: Expression = ['Append', ['List', 1, 2, 3], 4];
  const ternary: Expression = ['Append', ['List', 1, 2, 3], 4, 5];

  test('positive indexing, binary', () =>
    expect([1, 3, 4, 5].map((i) => ce.box(binary).at(i)?.toString())).toEqual([
      '1',
      '3',
      '4',
      undefined,
    ]));

  test('positive indexing, 3-ary', () =>
    expect(
      [1, 3, 4, 5, 6].map((i) => ce.box(ternary).at(i)?.toString())
    ).toEqual(['1', '3', '4', '5', undefined]));

  test('at(-1) is the last appended value', () => {
    expect(ce.box(binary).at(-1)?.toString()).toBe('4');
    expect(ce.box(ternary).at(-1)?.toString()).toBe('5');
  });

  test('at(-(count)) is the first source element', () => {
    expect(ce.box(binary).at(-4)?.toString()).toBe('1');
    expect(ce.box(ternary).at(-5)?.toString()).toBe('1');
  });

  test('negative indexing walks the whole appended collection', () =>
    expect(
      [-1, -2, -3, -4, -5].map((i) => ce.box(ternary).at(i)?.toString())
    ).toEqual(['5', '4', '3', '2', '1']));

  test('out-of-range indices are undefined', () =>
    expect([0, 6, 7, -6, -7].map((i) => ce.box(ternary).at(i))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]));

  test('contains() sees both the source and every appended value', () => {
    const e = ce.box(ternary);
    expect([1, 3, 4, 5, 9].map((v) => e.contains(ce.box(v)))).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  test('isEmpty is false even for an empty source', () => {
    const e = ce.box(['Append', ['List'], 9, 10]);
    expect(e.isEmptyCollection).toBe(false);
    expect(e.count).toBe(2);
    expect(elements(e)).toEqual(['9', '10']);
  });
});

describe('Append: a non-finite source is not forced', () => {
  const inf: Expression = ['Append', ['Cycle', ['Range', 1, 2]], 5, 6];

  test('count stays Infinity', () => expect(ce.box(inf).count).toBe(Infinity));

  test('isFiniteCollection is false', () =>
    expect(ce.box(inf).isFiniteCollection).toBe(false));

  // The source never ends, so a positive index reads the source element
  // without walking the rest of the source, and the appended values have no
  // position. A negative index counts from an end that does not exist.
  test('at() reads the source and declines a negative index', () =>
    expect([1, 2, 3, -1, 0].map((i) => ce.box(inf).at(i)?.toString())).toEqual([
      '1',
      '2',
      '1',
      undefined,
      undefined,
    ]));

  test('flattening a non-finite chain reports the same as the nested form', () => {
    const flat = ce.box([
      'Append',
      ['Append', ['Cycle', ['Range', 1, 2]], 5],
      6,
    ]);
    const nested = structural([
      'Append',
      ['Append', ['Cycle', ['Range', 1, 2]], 5],
      6,
    ]);
    expect(flat.nops).toBe(3);
    expect(flat.count).toBe(nested.count);
    expect(flat.isFiniteCollection).toBe(nested.isFiniteCollection);
  });
});

describe('Append: an infinite source delivers its elements', () => {
  const inf: Expression = { num: '+Infinity' };
  const appended: Expression = ['Append', ['Range', 1, inf], 0];

  test('Take over the infinite Append materializes the prefix', () =>
    expect(ce.box(['Take', appended, 3]).evaluate().toString()).toBe(
      '[1,2,3]'
    ));

  test('Take with several appended values reads only the source', () =>
    expect(
      ce
        .box(['Take', ['Append', ['Range', 1, inf], 0, 7], 4])
        .evaluate()
        .toString()
    ).toBe('[1,2,3,4]'));

  test('At reads the source element', () => {
    expect(ce.box(['At', appended, 2]).evaluate().toString()).toBe('2');
    expect(ce.box(['At', appended, 1000]).evaluate().toString()).toBe('1000');
  });

  test('each() over the Take yields three elements', () =>
    expect(elements(ce.box(['Take', appended, 3]))).toEqual(['1', '2', '3']));

  test('a negative or zero index has no element', () =>
    expect([-1, 0].map((i) => ce.box(appended).at(i))).toEqual([
      undefined,
      undefined,
    ]));

  test('the Append itself is unchanged: lazy, infinite, previewed', () => {
    const e = ce.box(appended);
    expect(e.count).toBe(Infinity);
    expect(e.isLazyCollection).toBe(true);
    expect(e.isFiniteCollection).toBe(false);
    expect(e.evaluate().toString()).toBe('[1,2,3,4,5,...]');
  });

  test('Join over the same source agrees', () =>
    expect(
      ce
        .box(['Take', ['Join', ['Range', 1, inf], ['List', 0]], 3])
        .evaluate()
        .toString()
    ).toBe('[1,2,3]'));

  test('a finite source still counts negative indices from the end', () => {
    const finite: Expression = ['Append', ['Range', 1, 5], 0, 9];
    expect(
      [-1, -2, -3, -7, -8].map((i) =>
        ce.box(['At', finite, i]).evaluate().toString()
      )
    ).toEqual(['9', '0', '5', '1', 'NaN']);
  });
});

describe('Append: invalid operands decline the flatten', () => {
  // Captured BEFORE the variadic change; these must not move.
  const cases: [string, Expression, Expression][] = [
    [
      'a Nothing appended value',
      ['Append', ['Range', 1, 2], 'Nothing'],
      ['Append', ['Range', 1, 2], ['Error', "'missing'"]],
    ],
    [
      'a missing appended value',
      ['Append', ['Range', 1, 2]],
      ['Append', ['Range', 1, 2], ['Error', "'missing'"]],
    ],
    [
      'a non-collection source',
      ['Append', 3, 4],
      [
        'Append',
        [
          'Error',
          ['ErrorCode', "'incompatible-type'", "'collection'", "'3'"],
          3,
        ],
        4,
      ],
    ],
  ];

  for (const [label, input, expected] of cases)
    test(`${label} produces the same error as before`, () => {
      const e = ce.box(input);
      expect(e.isValid).toBe(false);
      expect(e.json).toEqual(expected);
    });

  test('an invalid INNER Append is not spliced into the outer one', () => {
    const e = ce.box(['Append', ['Append', ['Range', 1, 2], 'Nothing'], 5]);
    expect(e.isValid).toBe(false);
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
    expect(e.json).toEqual([
      'Append',
      ['Append', ['Range', 1, 2], ['Error', "'missing'"]],
      5,
    ]);
  });

  test('an invalid OUTER appended value declines the flatten', () => {
    const e = ce.box(['Append', ['Append', ['Range', 1, 2], 3], 'Nothing']);
    expect(e.isValid).toBe(false);
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
  });

  test('route parity for the error results', () => {
    const viaBox = ce.box(['Append', ['Range', 1, 2], 'Nothing']);
    const viaFn = ce.function('Append', [
      ce.box(['Range', 1, 2]),
      ce.box('Nothing'),
    ]);
    expect(viaFn.isValid).toBe(false);
    expect(viaFn.json).toEqual(viaBox.json);
  });
});

describe('Append: the compile targets follow the variadic form', () => {
  // A flattened `Append` reaches the targets with k trailing operands; a
  // binary-only lowering would silently DROP all but the first.
  // A SYMBOL source: a literal-list source folds into one list literal at
  // canonicalization (`join-append-literal-fold.test.ts`), so the spread
  // lowering would never be reached.
  ce.declare('xs', 'list<integer>');
  const flat: Expression = ['Append', ['Append', 'xs', 3], 4];

  // `constantFold: false` on every compile below: these `Append` expressions
  // are closed (all-literal operands), so compile-time constant folding would
  // evaluate them and emit the folded list (`[1, 2, 3, 4]`). What is under test
  // is the spread lowering, which only appears unfolded.
  const NO_FOLD = { constantFold: false } as const;

  test('JavaScript', () =>
    expect(compile(ce.box(flat), NO_FOLD)?.code).toBe('[...(_.xs), 3, 4]'));

  test('Python', () =>
    expect(new PythonTarget().compile(ce.box(flat), NO_FOLD)?.code).toBe(
      '[*xs, 3, 4]'
    ));

  test('the binary form is unchanged', () => {
    const binary: Expression = ['Append', 'xs', 3];
    expect(compile(ce.box(binary), NO_FOLD)?.code).toBe('[...(_.xs), 3]');
    expect(new PythonTarget().compile(ce.box(binary), NO_FOLD)?.code).toBe(
      '[*xs, 3]'
    );
  });
});

describe('Append: the result type folds the appended values in', () => {
  // Pre-existing blind spot, fixed here: the binary handler was
  // `joinResultType([ops[0]])`, which ignored the appended value's type.
  test('a string appended to an integer list widens the element type', () =>
    expect(
      ce.box(['Append', ['Range', 1, 2], { str: 'x' }]).type.toString()
    ).toBe('list<integer | string>'));

  test('a homogeneous append does not widen', () =>
    expect(ce.box(['Append', ['Range', 1, 2], 3]).type.toString()).toBe(
      'list<integer>'
    ));

  test('the flattened form agrees with the nested form', () => {
    const pairs: [Expression, Expression][] = [
      [
        ['Append', ['Append', ['Range', 1, 2], 3], { str: 'x' }],
        ['Append', ['Range', 1, 2], 3, { str: 'x' }],
      ],
      [
        ['Append', ['Append', ['Tuple', 1, 2], 3], 4],
        ['Append', ['Tuple', 1, 2], 3, 4],
      ],
    ];
    for (const [nested, flat] of pairs)
      expect(ce.box(flat).type.toString()).toBe(
        structural(nested).type.toString()
      );
  });

  test('the flattened form agrees with the nested form (a symbol source)', () => {
    // A declared symbol source for the tuple pair: a list-literal source
    // folds into a shaped literal (`list<…^3>`) that the structural nested
    // form cannot produce. The structural form does not bind a symbol, so a
    // symbol in it is typed `unknown`. The nested reference is therefore
    // built from canonical operands, where the symbol has its declared type.
    ce.declare('ts', 'list<tuple<integer, integer>>');
    const nested = ce.function(
      'Append',
      [
        ce.function('Append', [ce.box('ts'), ce.box(['Tuple', 3, 4])], {
          form: 'structural',
        }),
        ce.box(['Tuple', 5, 6]),
      ],
      { form: 'structural' }
    );
    const flat = ce.box(['Append', 'ts', ['Tuple', 3, 4], ['Tuple', 5, 6]]);
    expect(nested.op1.operator).toBe('Append');
    expect(flat.type.toString()).toBe('list<tuple<integer, integer>>');
    expect(flat.type.toString()).toBe(nested.type.toString());
  });

  test('a point list keeps matching list<tuple<…>>', () =>
    expect(
      ce
        .box([
          'Append',
          ['List', ['Tuple', 1, 2]],
          ['Tuple', 3, 4],
          ['Tuple', 5, 6],
        ])
        .type.matches('list<tuple<number, number>>')
    ).toBe(true));
});

describe('Append: a source whose type does not fix its kind', () => {
  // A source typed `any`, `unknown` or `collection<T>` can hold a set, and
  // `Append` of a set is a set. So the result type must admit a set: it is
  // `collection`, not `list`. A source typed `any` gives the element type
  // `any`, because its elements can be anything, absent values included. A
  // source typed `unknown` (an unresolved call) gives the placeholder
  // element type, which the appended values refine. A source that is known
  // to be a list, a tuple or an indexed collection keeps the result typed
  // `list`.
  const fresh = new ComputeEngine();
  fresh.declare('u', 'unknown');
  fresh.declare('a', 'any');
  fresh.declare('c', 'collection<integer>');
  fresh.declare('ic', 'indexed_collection<integer>');
  fresh.declare('l', 'list<integer>');
  fresh.declare('t', 'tuple<integer, integer>');
  fresh.declare('s', 'set<integer>');
  const freshStructural = (expr: Expression) =>
    fresh.expr(expr, { form: 'structural' } as any);
  // The nested form `Append(Append(src, 1), 2)` with structural nodes over
  // canonical operands, so that a symbol source has its declared type. The
  // structural form of the whole expression does not bind the symbol.
  const nestedOver = (src: Expression) =>
    fresh.function(
      'Append',
      [
        fresh.function('Append', [fresh.box(src), fresh.box(1)], {
          form: 'structural',
        }),
        fresh.box(2),
      ],
      { form: 'structural' }
    );
  const typeOf = (expr: Expression) => fresh.box(expr).type.toString();

  test.each([
    ['a symbol declared any', ['Append', 'a', 1], 'collection<any>'],
    ['a symbol declared unknown', ['Append', 'u', 1], 'collection<any>'],
    ['an unresolved call', ['Append', ['f', 'x'], 1], 'collection<integer>'],
    ['collection<integer>', ['Append', 'c', 1], 'collection<integer>'],
    [
      'collection<integer> and a rational',
      ['Append', 'c', ['Rational', 1, 2]],
      'collection<rational>',
    ],
    ['indexed_collection<integer>', ['Append', 'ic', 1], 'list<integer>'],
    ['list<integer>', ['Append', 'l', 1], 'list<integer>'],
    ['tuple<integer, integer>', ['Append', 't', 1], 'list<integer>'],
    ['set<integer>', ['Append', 's', 1], 'set'],
  ] as [string, Expression, string][])('%s', (_label, expr, expected) =>
    expect(typeOf(expr)).toBe(expected)
  );

  test.each([
    ['any', 'a', 'collection<any>'],
    ['unknown', 'u', 'collection<any>'],
    ['collection<integer>', 'c', 'collection<integer>'],
    ['list<integer>', 'l', 'list<integer>'],
    ['an unresolved call', ['f', 'x'], 'collection<integer>'],
  ] as [string, Expression, string][])(
    'the flattened form agrees with the nested form (%s)',
    (_label, src, expected) => {
      expect(typeOf(['Append', src, 1, 2])).toBe(expected);
      expect(nestedOver(src).type.toString()).toBe(expected);
    }
  );

  test.each(['a', 'u'])(
    'the structural form of the nested expression over %s is a collection',
    (src) =>
      // The structural form does not bind the symbol, so the inner node sees
      // a source typed `unknown` whatever the declaration is, and the
      // appended values refine the placeholder element type. The canonical
      // form reads the declaration (`a`) or infers `u` as `collection<any>`
      // from the signature, so it gives `collection<any>`. Both forms are
      // `collection`.
      expect(
        freshStructural(['Append', ['Append', src, 1], 2]).type.toString()
      ).toBe('collection<integer>')
  );

  test('the value of an `any` source decides the kind', () => {
    const e = new ComputeEngine();
    e.declare('p', 'any');
    e.declare('q', 'any');
    e.assign('p', e.box(['List', 1, 2]));
    e.assign('q', e.box(['Set', 1, 2]));
    const overList = e.box(['Append', 'p', 3]);
    const overSet = e.box(['Append', 'q', 3]);
    // The static type admits both values.
    expect(overList.type.toString()).toBe('collection<any>');
    expect(overSet.type.toString()).toBe('collection<any>');
    expect(overList.evaluate().toString()).toBe('[1,2,3]');
    expect(overSet.evaluate().toString()).toBe('Set(1, 2, 3)');
    expect(overSet.evaluate().type.matches(overSet.type)).toBe(true);
  });
});

describe('Append: a tuple SOURCE contributes its ELEMENT type', () => {
  // `joinResultType` holds a tuple operand ATOMIC, but `Append` ENUMERATES its
  // source, so delegating the source contribution to it typed
  // `Append((1,2), 3)` as `list<integer | tuple<…>>` — a tuple in the
  // element type that no element ever has.
  test('Append((1,2), 3) has no tuple in its element type', () => {
    const t = ce.box(['Append', ['Tuple', 1, 2], 3]).type.toString();
    expect(t).not.toMatch(/tuple/);
    expect(t).toBe('list<integer>');
  });

  test('a 3-ary tuple source too', () =>
    expect(ce.box(['Append', ['Tuple', 1, 2], 3, 4]).type.toString()).toBe(
      'list<integer>'
    ));

  test('the flattened form agrees with the nested form', () =>
    expect(ce.box(['Append', ['Tuple', 1, 2], 3, 4]).type.toString()).toBe(
      structural(['Append', ['Append', ['Tuple', 1, 2], 3], 4]).type.toString()
    ));

  test('a TRAILING tuple is still an atomic element', () => {
    const e = ce.box(['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4]]);
    expect(e.type.toString()).toBe('list<tuple<integer, integer>^2>');
  });

  test('a heterogeneous tuple source widens to the union of its members', () =>
    expect(
      ce.box(['Append', ['Tuple', 1, { str: 'x' }], 2]).type.toString()
    ).toBe('list<integer | string>'));
});

describe('Append: the 1-ary identity form (non-strict)', () => {
  // With `(collection, value+)`, a 1-ary `Append(c)` is a signature error in
  // strict mode but a VALID identity node in non-strict mode. Its collection
  // handlers must then agree with each other — `count === 0` and
  // `isEmptyCollection === false` was a self-contradiction.
  const looseCe = new ComputeEngine();
  looseCe.strict = false;

  test('an empty source is an EMPTY collection', () => {
    const e = looseCe.box(['Append', ['List']]);
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(1);
    expect(e.count).toBe(0);
    expect(e.isEmptyCollection).toBe(true);
    expect(elements(e)).toEqual([]);
  });

  test('a non-empty source is not empty', () => {
    const e = looseCe.box(['Append', ['Range', 1, 2]]);
    expect(e.count).toBe(2);
    expect(e.isEmptyCollection).toBe(false);
    expect(elements(e)).toEqual(['1', '2']);
  });

  test('an appended value still makes an empty source non-empty', () => {
    const e = looseCe.box(['Append', ['List'], 9]);
    expect(e.count).toBe(1);
    expect(e.isEmptyCollection).toBe(false);
  });

  test('it compiles to the identity, not an interpreter fallback', () => {
    // A unary `Append` is not folded into its source literal: the identity
    // form is what is under test here.
    const e = looseCe.box(['Append', ['List', 1, 2]]);
    // `constantFold: false`: the operand is a literal list, so compile-time
    // constant folding would emit `[1, 2]` and the identity lowering under test
    // would never run.
    expect(compile(e, { constantFold: false })?.code).toBe('[...([1, 2])]');
    expect(new PythonTarget().compile(e, { constantFold: false })?.code).toBe(
      '[*[1, 2]]'
    );
  });
});
