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
      ? Array.from({ length: count }, (_, i) =>
          e.at(i + 1)?.toString()
        ).concat(
          Array.from({ length: count }, (_, i) => e.at(-(i + 1))?.toString())
        )
      : undefined,
  };
}

describe('Append: variadic signature', () => {
  test('the binary MathJSON form is unchanged', () => {
    const e = ce.box(['Append', ['List', 1, 2], 3]);
    expect(e.json).toEqual(['Append', ['List', 1, 2], 3]);
    expect(e.nops).toBe(2);
    expect(elements(e)).toEqual(['1', '2', '3']);
    expect(e.evaluate().toString()).toBe('[1,2,3]');
  });

  test('an explicit 3-ary form is accepted (box route)', () => {
    const e = ce.box(['Append', ['List', 1, 2], 3, 4]);
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(3);
    expect(e.count).toBe(4);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an explicit 3-ary form is accepted (ce.function route)', () => {
    const e = ce.function('Append', [
      ce.box(['List', 1, 2]),
      ce.box(3),
      ce.box(4),
    ]);
    expect(e.isValid).toBe(true);
    expect(e.nops).toBe(3);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an explicit 3-ary form is accepted (parse route)', () => {
    const e = ce.parse('\\mathrm{Append}([1,2], 3, 4)');
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
      ['Append', ['Append', ['List', 1, 2], 3], 4],
      ['Append', ['List', 1, 2], 3, 4],
    ],
    [
      'list (a row appended to a matrix)',
      [
        'Append',
        ['Append', ['List', ['List', 1, 2], ['List', 3, 4]], ['List', 5, 6]],
        ['List', 7, 8],
      ],
      [
        'Append',
        ['List', ['List', 1, 2], ['List', 3, 4]],
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
      [
        'Append',
        ['List', ['Tuple', 1, 2]],
        ['Tuple', 3, 4],
        ['Tuple', 5, 6],
      ],
    ],
  ];

  for (const [label, nested, flat] of triple)
    test(`${label}: flattened === nested, element for element`, () =>
      expect(profile(ce.box(flat))).toEqual(profile(structural(nested))));

  test('a row appended to a matrix is one row, not two elements', () => {
    const e = ce.box([
      'Append',
      ['List', ['List', 1, 2], ['List', 3, 4]],
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
    ).toEqual(profile(structural(['Append', ['Append', ['Tuple', 1, 2], 3], 4]))));
});

describe('Append/Join: same-head flatten', () => {
  test('a chain of k Appends is ONE node of width k + 1', () => {
    let e: Expression = ['List', 0];
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
    const viaBox = ce.box(['Append', ['Append', ['List', 1, 2], 3], 4]);
    const viaParse = ce.parse(
      '\\mathrm{Append}(\\mathrm{Append}([1,2], 3), 4)'
    );
    const viaFn = ce.function('Append', [
      ce.function('Append', [ce.box(['List', 1, 2]), ce.box(3)]),
      ce.box(4),
    ]);
    for (const e of [viaBox, viaParse, viaFn]) {
      expect(e.operator).toBe('Append');
      expect(e.nops).toBe(3);
      expect(e.json).toEqual(['Append', ['List', 1, 2], 3, 4]);
    }
  });

  test('a single un-nested Append is not rewritten', () => {
    const e = ce.box(['Append', ['List', 1, 2], 3]);
    expect(e.json).toEqual(['Append', ['List', 1, 2], 3]);
  });

  test('Join(Join(a, b), c) flattens to one Join', () => {
    const e = ce.box([
      'Join',
      ['Join', ['List', 1, 2], ['List', 3]],
      ['List', 4],
    ]);
    expect(e.operator).toBe('Join');
    expect(e.nops).toBe(3);
    expect(e.json).toEqual(['Join', ['List', 1, 2], ['List', 3], ['List', 4]]);
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('an inner Join keeps its atomic tuple operand atomic', () => {
    const e = ce.box([
      'Join',
      ['Join', ['List', 1, 2], ['Tuple', 3, 4]],
      ['List', 5],
    ]);
    expect(e.nops).toBe(3);
    expect(elements(e)).toEqual(['1', '2', '(3, 4)', '5']);
  });

  // NO cross-head rewrites — a deliberate, reviewed decision.
  test('Append(Join(c, d), v) stays nested', () => {
    const e = ce.box([
      'Append',
      ['Join', ['List', 1, 2], ['List', 3]],
      4,
    ]);
    expect(e.operator).toBe('Append');
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Join');
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('Join(Append(c, v), d) stays nested', () => {
    const e = ce.box([
      'Join',
      ['Append', ['List', 1, 2], 3],
      ['List', 4],
    ]);
    expect(e.operator).toBe('Join');
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
    expect(elements(e)).toEqual(['1', '2', '3', '4']);
  });

  test('a mixed chain has depth equal to its alternation count', () => {
    // Append(Join(Append([1,2], 3), [4]), 5) — three heads, three levels.
    const e = ce.box([
      'Append',
      ['Join', ['Append', ['List', 1, 2], 3], ['List', 4]],
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
    expect(
      [0, 6, 7, -6, -7].map((i) => ce.box(ternary).at(i))
    ).toEqual([undefined, undefined, undefined, undefined, undefined]));

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
  const inf: Expression = ['Append', ['Cycle', ['List', 1, 2]], 5, 6];

  test('count stays Infinity', () =>
    expect(ce.box(inf).count).toBe(Infinity));

  test('isFiniteCollection is false', () =>
    expect(ce.box(inf).isFiniteCollection).toBe(false));

  test('at() declines rather than forcing the source', () =>
    expect([1, -1].map((i) => ce.box(inf).at(i))).toEqual([
      undefined,
      undefined,
    ]));

  test('flattening a non-finite chain reports the same as the nested form', () => {
    const flat = ce.box(['Append', ['Append', ['Cycle', ['List', 1, 2]], 5], 6]);
    const nested = structural([
      'Append',
      ['Append', ['Cycle', ['List', 1, 2]], 5],
      6,
    ]);
    expect(flat.nops).toBe(3);
    expect(flat.count).toBe(nested.count);
    expect(flat.isFiniteCollection).toBe(nested.isFiniteCollection);
  });
});

describe('Append: invalid operands decline the flatten', () => {
  // Captured BEFORE the variadic change; these must not move.
  const cases: [string, Expression, Expression][] = [
    [
      'a Nothing appended value',
      ['Append', ['List', 1, 2], 'Nothing'],
      ['Append', ['List', 1, 2], ['Error', "'missing'"]],
    ],
    [
      'a missing appended value',
      ['Append', ['List', 1, 2]],
      ['Append', ['List', 1, 2], ['Error', "'missing'"]],
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
    const e = ce.box(['Append', ['Append', ['List', 1, 2], 'Nothing'], 5]);
    expect(e.isValid).toBe(false);
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
    expect(e.json).toEqual([
      'Append',
      ['Append', ['List', 1, 2], ['Error', "'missing'"]],
      5,
    ]);
  });

  test('an invalid OUTER appended value declines the flatten', () => {
    const e = ce.box(['Append', ['Append', ['List', 1, 2], 3], 'Nothing']);
    expect(e.isValid).toBe(false);
    expect(e.nops).toBe(2);
    expect(e.op1.operator).toBe('Append');
  });

  test('route parity for the error results', () => {
    const viaBox = ce.box(['Append', ['List', 1, 2], 'Nothing']);
    const viaFn = ce.function('Append', [
      ce.box(['List', 1, 2]),
      ce.box('Nothing'),
    ]);
    expect(viaFn.isValid).toBe(false);
    expect(viaFn.json).toEqual(viaBox.json);
  });
});

describe('Append: the compile targets follow the variadic form', () => {
  // A flattened `Append` reaches the targets with k trailing operands; a
  // binary-only lowering would silently DROP all but the first.
  const flat: Expression = ['Append', ['Append', ['List', 1, 2], 3], 4];

  // `constantFold: false` on every compile below: these `Append` expressions
  // are closed (all-literal operands), so compile-time constant folding would
  // evaluate them and emit the folded list (`[1, 2, 3, 4]`). What is under test
  // is the spread lowering, which only appears unfolded.
  const NO_FOLD = { constantFold: false } as const;

  test('JavaScript', () =>
    expect(compile(ce.box(flat), NO_FOLD)?.code).toBe('[...([1, 2]), 3, 4]'));

  test('Python', () =>
    expect(new PythonTarget().compile(ce.box(flat), NO_FOLD)?.code).toBe(
      '[*[1, 2], 3, 4]'
    ));

  test('the binary form is unchanged', () => {
    const binary: Expression = ['Append', ['List', 1, 2], 3];
    expect(compile(ce.box(binary), NO_FOLD)?.code).toBe('[...([1, 2]), 3]');
    expect(new PythonTarget().compile(ce.box(binary), NO_FOLD)?.code).toBe(
      '[*[1, 2], 3]'
    );
  });
});

describe('Append: the result type folds the appended values in', () => {
  // Pre-existing blind spot, fixed here: the binary handler was
  // `joinResultType([ops[0]])`, which ignored the appended value's type.
  test('a string appended to an integer list widens the element type', () =>
    expect(ce.box(['Append', ['List', 1, 2], { str: 'x' }]).type.toString()).toBe(
      'list<integer | string>'
    ));

  test('a homogeneous append does not widen', () =>
    expect(ce.box(['Append', ['List', 1, 2], 3]).type.toString()).toBe(
      'list<integer>'
    ));

  test('the flattened form agrees with the nested form', () => {
    const pairs: [Expression, Expression][] = [
      [
        ['Append', ['Append', ['List', 1, 2], 3], { str: 'x' }],
        ['Append', ['List', 1, 2], 3, { str: 'x' }],
      ],
      [
        ['Append', ['Append', ['Tuple', 1, 2], 3], 4],
        ['Append', ['Tuple', 1, 2], 3, 4],
      ],
      [
        [
          'Append',
          ['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4]],
          ['Tuple', 5, 6],
        ],
        [
          'Append',
          ['List', ['Tuple', 1, 2]],
          ['Tuple', 3, 4],
          ['Tuple', 5, 6],
        ],
      ],
    ];
    for (const [nested, flat] of pairs)
      expect(ce.box(flat).type.toString()).toBe(
        structural(nested).type.toString()
      );
  });

  test('a point list keeps matching list<tuple<…>>', () =>
    expect(
      ce
        .box(['Append', ['List', ['Tuple', 1, 2]], ['Tuple', 3, 4], ['Tuple', 5, 6]])
        .type.matches('list<tuple<number, number>>')
    ).toBe(true));
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
    expect(e.type.toString()).toBe(
      'list<tuple<integer, integer>>'
    );
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
    const e = looseCe.box(['Append', ['List', 1, 2]]);
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
    const e = looseCe.box(['Append', ['List', 1, 2]]);
    // `constantFold: false`: the operand is a literal list, so compile-time
    // constant folding would emit `[1, 2]` and the identity lowering under test
    // would never run.
    expect(compile(e, { constantFold: false })?.code).toBe('[...([1, 2])]');
    expect(
      new PythonTarget().compile(e, { constantFold: false })?.code
    ).toBe('[*[1, 2]]');
  });
});
