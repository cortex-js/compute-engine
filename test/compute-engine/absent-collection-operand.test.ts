import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A collection operator over an ABSENT collection answers `Missing`, also
// for a number result (user decision 2026-09-25; since 2026-11-02 an operator
// over `Missing` gives `Missing`, `docs/ERROR-MODEL.md`, "`Missing` is a
// result only"; before, a number result was `NaN`): the default absence policy of an operator with no
// declared `missingBehavior` now covers a signature whose parameters are
// collections (and functions) as well as one whose parameters are numbers
// (`signatureParamsPropagateAbsence`, `boxed-operator-definition.ts`). Before,
// `Reverse(Missing)` and `Filter(Missing, p)` were `incompatible-type` errors
// and `Map(f, Missing)` stayed a raw, unevaluated node. A restricted
// collection, `[1,2]{c}`, is one held restriction and is threaded whole by these
// operators, so the held result and a fresh evaluation agree once the
// condition is decided.

const engine = () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('t', 'real');
  return ce;
};

const f = ['Function', ['Multiply', 2, '_'], '_'];
const p = ['Function', ['Greater', '_', 1], '_'];
const plus = ['Function', ['Add', '_1', '_2'], '_1', '_2'];

describe('a collection operator over an absent collection', () => {
  test.each([
    ['Reverse', ['Reverse', 'Missing']],
    ['Sort', ['Sort', 'Missing']],
    ['Take', ['Take', 'Missing', 1]],
    ['Unique', ['Unique', 'Missing']],
    ['Zip', ['Zip', ['List', 1], 'Missing']],
    ['Map', ['Map', f, 'Missing']],
    ['Filter', ['Filter', 'Missing', p]],
  ])('%s answers Missing', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test.each([
    ['GroupBy', ['GroupBy', 'Missing', f]],
    ['Chunk', ['Chunk', 'Missing', 2]],
    ['RandomShuffle', ['RandomShuffle', 'Missing']],
  ])('%s answers Missing too', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  // A boolean predicate over an absent collection is `False`, as a
  // comparison with an absent operand is (user decision of 2026-11-02,
  // two-valued comparisons). Before, it was `Missing` (Kleene).
  test.each([
    ['Any', ['Any', 'Missing', p]],
    ['All', ['All', 'Missing', p]],
    ['IsEmpty', ['IsEmpty', 'Missing']],
    ['Contains', ['Contains', 'Missing', 1]],
  ])('%s answers False (a boolean result is two-valued)', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('boolean');
    expect(e.evaluate().toString()).toBe('"False"');
  });

  test.each([
    ['Length', ['Length', 'Missing']],
    ['Count', ['Count', 'Missing']],
    ['Reduce', ['Reduce', 'Missing', plus, 0]],
  ])('%s answers Missing, also for a number result', (_op, json) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an absent operand beside a list still lands in each cell of a broadcast', () => {
    // The stand-aside of the absence gate beside a collection is for
    // broadcastable operators only; `Zip` above is not one.
    expect(
      engine()
        .box(['Add', 'Missing', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('["Missing","Missing"]');
  });
});

describe('a collection operator over a restricted collection', () => {
  /** The value with `t` free and, once `t = -1`, the held value re-evaluated
   * and the expression evaluated fresh. */
  function probe(json: unknown) {
    const ce = engine();
    const e = ce.box(json as never);
    const held = e.evaluate();
    const free = held.toString();
    ce.assign('t', -1);
    return {
      free,
      twoStep: held.evaluate().toString(),
      fresh: e.evaluate().toString(),
    };
  }
  const RL = ['If', ['Less', 0, 't'], ['List', 1, 2]];

  test.each([
    ['Reverse', ['Reverse', RL], 'If(0 < t, Reverse([1,2]))'],
    [
      'Sort',
      ['Sort', ['If', ['Less', 0, 't'], ['List', 2, 1]]],
      'If(0 < t, [1,2])',
    ],
    ['Take', ['Take', RL, 1], 'If(0 < t, Take([1,2], 1))'],
    ['Join', ['Join', RL, ['List', 3]], 'If(0 < t, [1,2,3])'],
    ['Zip', ['Zip', RL, ['List', 3, 4]], 'If(0 < t, Zip([1,2], [3,4]))'],
    ['Map', ['Map', f, RL], 'If(0 < t, Map((_) => 2 * _, [1,2]))'],
    ['Filter', ['Filter', RL, p], 'If(0 < t, Filter([1,2], (_) => 1 < _))'],
    // `Chunk` is not lazy: its result is computed.
    ['Chunk', ['Chunk', RL, 1], 'If(0 < t, [[1,2]])'],
  ])('%s is threaded whole and both routes agree', (_op, json, free) => {
    const r = probe(json);
    // The held result wraps the operator's lazy view of the present list.
    expect(r.free).toBe(free);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test('Any is threaded whole and both routes give False', () => {
    // `Any` is not lazy: its result is computed, and the held result is the
    // restriction of a boolean, `If(0 < t, True)`, which is `False` for a
    // false scalar condition. The fresh route evaluates `Any(Missing, p)`,
    // which is `False` too: a boolean predicate over an absent collection is
    // `False` (user decision of 2026-11-02, two-valued comparisons).
    const r = probe(['Any', RL, p]);
    expect(r.free).toBe('If(0 < t, "True")');
    expect(r.twoStep).toBe('"False"');
    expect(r.fresh).toBe('"False"');
  });

  test('the held result is a collection of the present elements', () => {
    const ce = engine();
    const r = ce.box(['Reverse', RL]).evaluate();
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(2);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      'If(0 < t, 2)',
      'If(0 < t, 1)',
    ]);
  });

  test('a literal list with one restricted cell stays per cell', () => {
    expect(
      engine()
        .box(['Reverse', ['List', ['If', 'c', 1], 2]])
        .evaluate()
        .toString()
    ).toBe('[2,If(c, 1)]');
  });

  test('Map over a restricted list is no longer a set', () => {
    const ce = engine();
    const r = ce.box(['Map', f, RL]).evaluate();
    expect(r.operator).toBe('If');
    expect(r.isCollection).toBe(true);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      'If(0 < t, 2)',
      'If(0 < t, 4)',
    ]);
  });
});

describe('Insert, ReplaceAt and Append over an absent collection', () => {
  // They answer `Missing` on every route (user decision 2026-09-26), and an
  // operator over an operand typed `missing` is typed `missing`. Before, a
  // boxed `Insert(Missing, 1, 2)` was an `incompatible-type` error, and only
  // a restricted collection whose condition failed gave `Missing`.
  const RL = ['If', ['Less', 0, 't'], ['List', 1, 2]];
  test.each([
    ['Insert', ['Insert', 'Missing', 1, 2], 'missing'],
    ['ReplaceAt', ['ReplaceAt', 'Missing', 1, 2], 'missing'],
    ['Append', ['Append', 'Missing', 1], 'missing'],
  ])('%s answers Missing', (_op, json, type) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    const ce = engine();
    for (const src of [
      '\\operatorname{Insert}(\\operatorname{Missing}, 1, 2)',
      '\\operatorname{ReplaceAt}(\\operatorname{Missing}, 1, 2)',
      '\\operatorname{Append}(\\operatorname{Missing}, 1)',
    ])
      expect(ce.parse(src).evaluate().toString()).toBe('"Missing"');
  });

  test.each([
    ['Insert', ['Insert', RL, 1, 5], 'If(0 < t, [5,1,2])'],
    ['ReplaceAt', ['ReplaceAt', RL, 1, 5], 'If(0 < t, [5,2])'],
    ['Append', ['Append', RL, 5], 'If(0 < t, [1,2,5])'],
  ])('%s over a restricted collection', (_op, json, free) => {
    const ce = engine();
    const e = ce.box(json as never);
    // The type of `If(c, L)` is the type of `L`: the run-time `Missing` sits
    // outside the declared type, as `NaN` sits outside `real`.
    expect(e.type.toString()).toBe('list<integer>');
    const held = e.evaluate();
    expect(held.toString()).toBe(free);
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('an absent index or value is not an absent collection', () => {
    const ce = engine();
    // The stored value is kept as one element of the result.
    expect(
      ce
        .box(['Insert', ['List', 1, 2], 1, 'Missing'])
        .evaluate()
        .toString()
    ).toBe('["Missing",1,2]');
    // An absent index is still refused.
    expect(ce.box(['Insert', ['List', 1], 'Missing', 2]).isValid).toBe(false);
    // An absent appended value is an ordinary cell, kept in place as
    // `Insert` keeps it (rule A of
    // `docs/plans/2026-09-26-absent-values-in-collection-operators.md`).
    // Before, `Append([1], Missing)` was an `incompatible-type` error while
    // `Append([1], Undefined)` and `Append([1], NaN)` kept the cell.
    const appended = ce.box(['Append', ['List', 1], 'Missing']);
    expect(appended.isValid).toBe(true);
    expect(appended.type.toString()).toBe('list<integer | missing^2>');
    expect(appended.evaluate().toString()).toBe('[1,"Missing"]');
    expect(
      ce
        .box(['Append', ['List', 1], 'Missing', 3])
        .evaluate()
        .toString()
    ).toBe('[1,"Missing",3]');
    expect(
      ce
        .parse('\\operatorname{Append}([1], \\operatorname{Missing})')
        .evaluate()
        .toString()
    ).toBe('[1,"Missing"]');
  });
});

describe('a search finds an absent value where the same marker sits', () => {
  // Search is structural, by `isSame`, the test `Unique` and `Set` use: a
  // marker needle is found where the same marker sits, and a marker cell
  // matches only the same marker (user decision 2026-09-26, rule C of
  // `docs/plans/2026-09-26-absent-values-in-collection-operators.md`,
  // `SEARCHED_VALUE_POLICY` in `library/collections.ts`). This replaces the
  // earlier, unpublished rule of the same day under which a marker was never
  // found (`Contains([1, Missing], Missing)` was `False`, `IndexOf` and
  // `Count` were `0`).
  test.each([
    [['Contains', ['List', 1, 2], 'Missing'], '"False"', 'boolean'],
    [['Contains', ['List', 1, 2], 'Undefined'], '"False"', 'boolean'],
    [['Contains', ['List', 1, 'Missing'], 'Missing'], '"True"', 'boolean'],
    [['Contains', ['List', 1, 'Undefined'], 'Undefined'], '"True"', 'boolean'],
    [['Contains', ['List', 1, 'NaN'], 'NaN'], '"True"', 'boolean'],
    // `Missing` and `Undefined` are different symbols, as they are for
    // `Unique([Missing, Undefined])`, which keeps both.
    [['Contains', ['List', 1, 'Missing'], 'Undefined'], '"False"', 'boolean'],
    [['Contains', ['List', 1, 'NaN'], 'Missing'], '"False"', 'boolean'],
    [['IndexOf', ['List', 1, 2], 'Missing'], '0', 'integer'],
    [['IndexOf', ['List', 1, 'Missing'], 'Missing'], '2', 'integer'],
    [['IndexOf', ['List', 1, 'NaN', 3], 'NaN'], '2', 'integer'],
    [['IndexOf', ['List', 'Missing', 5], 5], '2', 'integer'],
    [['Count', ['List', 1, 2], 'Missing'], '0', 'integer'],
    [['Count', ['List', 'Missing', 'Missing'], 'Missing'], '2', 'integer'],
    [['Count', ['List', 'NaN', 1, 'NaN'], 'NaN'], '2', 'integer'],
    // A literal `NaN` in a literal list is decided at the type level.
    [['Element', 'NaN', ['List', 1, 'NaN']], '"True"', 'true'],
    [['Element', 'Missing', ['List', 1, 'Missing']], '"True"', 'boolean'],
    [['Element', 5, ['List', 1, 'Missing']], '"False"', 'boolean'],
    [['NotElement', 'NaN', ['List', 1, 'NaN']], '"False"', 'boolean'],
  ])('%j', (json, expected, type) => {
    const e = engine().box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe(expected);
    expect(e.N().toString()).toBe(expected);
  });

  test('a literal NaN membership is decided at the type level too', () => {
    // The `Element` type handler claims `true`/`false` for a literal needle
    // in a literal list; it read `NaN` as different from `NaN` and claimed
    // `false`, which the compiler then emitted as a literal.
    expect(
      engine()
        .box(['Element', 'NaN', ['List', 1, 'NaN']])
        .type.toString()
    ).toBe('true');
    expect(
      engine()
        .box(['Element', 'NaN', ['List', 1, 2]])
        .type.toString()
    ).toBe('false');
  });

  test.each([
    // An absent element of the collection does not make the answer absent,
    // so it does not widen the type.
    [['Contains', ['List', 1, 'Missing'], 2], 'boolean', '"False"'],
    [['IndexOf', ['List', 1, 'Missing'], 2], 'integer', '0'],
    [['Count', ['List', 1, 'Missing']], 'integer', '2'],
    [['Count', ['List', 1, 'Missing'], 2], 'integer', '0'],
    [
      ['Insert', ['List', 1, 'Missing'], 1, 2],
      'list<integer | missing>',
      '[2,1,"Missing"]',
    ],
    [
      ['ReplaceAt', ['List', 1, 'Missing'], 1, 2],
      'list<integer | missing>',
      '[2,"Missing"]',
    ],
    [
      ['Append', ['List', 1, 'Missing'], 2],
      'list<integer | missing^3>',
      '[1,"Missing",2]',
    ],
  ])('an absent element: %j', (json, type, expected) => {
    const e = engine().box(json as never);
    expect(e.type.toString()).toBe(type);
    expect(e.evaluate().toString()).toBe(expected);
  });

  test('the parse route', () => {
    const ce = engine();
    expect(
      ce
        .parse('\\operatorname{Contains}([1, 2], \\operatorname{Missing})')
        .evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      ce
        .parse(
          '\\operatorname{Contains}([1, \\operatorname{Missing}], \\operatorname{Missing})'
        )
        .evaluate()
        .toString()
    ).toBe('"True"');
    expect(
      ce
        .parse('\\operatorname{IndexOf}([1, \\mathrm{NaN}], \\mathrm{NaN})')
        .evaluate()
        .toString()
    ).toBe('2');
  });

  test('an absent collection still makes the answer absent, or False', () => {
    // `Contains` is a boolean predicate: over an absent collection it is
    // `False` (user decision of 2026-11-02, two-valued comparisons).
    const ce = engine();
    expect(ce.box(['Contains', 'Missing', 2]).evaluate().toString()).toBe(
      '"False"'
    );
    expect(ce.box(['IndexOf', 'Missing', 2]).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['Count', 'Missing', 2]).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(
      ce
        .box(['Contains', 'Missing', 'Missing'])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('compiled to JavaScript', () => {
    const ce = engine();
    const run = (json: unknown): unknown => {
      const r = compile(ce.box(json as never), { to: 'javascript' } as never);
      expect(r.success).toBe(true);
      return r.run!({} as never);
    };
    // `NaN` is found by the SameValueZero element test. A written `Missing`
    // compiles to `undefined`: against a list with no absent cell it is not
    // found.
    expect(run(['IndexOf', ['List', 1, 2], 'Missing'])).toBe(0);
    expect(run(['Contains', ['List', 1, 2], 'Missing'])).toBe(false);
    // (`Contains` over a list with a `missing` element arm is not compiled:
    // the target requires primitive elements, and falls back.)
    expect(run(['IndexOf', ['List', 1, 'NaN', 3], 'NaN'])).toBe(2);
    expect(run(['Contains', ['List', 1, 'NaN'], 'NaN'])).toBe(true);
    expect(run(['Element', 'NaN', ['List', 1, 'NaN']])).toBe(true);
    expect(run(['IndexOf', ['List', 1, 'NaN'], 'Missing'])).toBe(0);
  });
});

describe('Join and the set operators over an absent collection', () => {
  // A collection operator over an absent collection answers `Missing` (user
  // decision 2026-09-26). Before, `Join(Missing, [1])` was `[Missing, 1]`
  // (the absent operand was wrapped as one element), and `Union`,
  // `Intersection` and `SetMinus` refused an absent set with an
  // `incompatible-type` error, also when it was a restricted set whose
  // condition failed.
  const S = ['Set', 1, 2];
  const T = ['Set', 2, 3];
  const c = ['Less', 0, 't'];
  test.each([
    [['Join', 'Missing', ['List', 1]]],
    [['Join', ['List', 1], 'Missing']],
    [['Union', 'Missing', T]],
    [['Union', S, 'Missing']],
    [['Intersection', 'Missing', T]],
    [['SetMinus', 'Missing', 1]],
  ])('%j answers Missing', (json) => {
    const ce = engine();
    const e = ce.box(json as never);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toMatch(/missing/);
    expect(e.evaluate().toString()).toBe('"Missing"');
    expect(e.N().toString()).toBe('"Missing"');
  });

  test('the parse route', () => {
    expect(
      engine()
        .parse('\\operatorname{Join}(\\operatorname{Missing}, [1])')
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test.each([
    [['Join', ['If', c, ['List', 1]], ['List', 2]], 'If(0 < t, [1,2])'],
    [['Union', ['If', c, S], T], 'If(0 < t, Set(1, 2, 3))'],
    [['Intersection', ['If', c, S], T], 'If(0 < t, Set(2))'],
    [['SetMinus', ['If', c, S], 1], 'If(0 < t, Set(2))'],
  ])('%j over a restricted collection', (json, free) => {
    const ce = engine();
    const e = ce.box(json as never);
    const held = e.evaluate();
    expect(held.toString()).toBe(free);
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"Missing"');
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an absent element or value is not an absent collection', () => {
    const ce = engine();
    expect(
      ce
        .box(['Join', ['List', 1, 'Missing'], ['List', 2]])
        .evaluate()
        .toString()
    ).toBe('[1,"Missing",2]');
    expect(
      ce
        .box(['Union', ['Set', 1, 'Missing'], T])
        .evaluate()
        .toString()
    ).toBe('Set(1, 2, 3, "Missing")');
    // A removed value that is absent is still refused.
    expect(ce.box(['SetMinus', S, 'Missing']).isValid).toBe(false);
  });

  // `Join` and `Append` with an operand that can be absent are not collection
  // views: their collection handlers do not enumerate the present operands.
  // Before, `Join(Missing, [3])` evaluated to `Missing` but enumerated `3`,
  // so `Sum` of it stayed unevaluated while `Sum(Missing)` is `Missing`, and the
  // unevaluated `Join([1, 2]{c}, [3])` printed as a `Set` of restricted cells.
  test.each([
    [['Join', 'Missing', ['List', 3]]],
    [['Append', 'Missing', 3]],
    [['Join', ['If', c, ['List', 1, 2]], ['List', 3]]],
    [['Append', ['If', c, ['List', 1, 2]], 3]],
  ])('%j is not a collection view', (json) => {
    const e = engine().box(json as never);
    expect(e.isCollection).toBe(false);
    expect([...e.each()]).toEqual([]);
    expect(e.count).toBeUndefined();
    expect(e.isFiniteCollection).toBeUndefined();
  });

  test('the unevaluated join of a restricted list prints as written', () => {
    const e = engine().box([
      'Join',
      ['If', c, ['List', 1, 2]],
      ['List', 3],
    ] as never);
    expect(e.toString()).toBe('Join(If(0 < t, [1,2]), [3])');
  });

  test.each([
    [['Sum', ['Join', 'Missing', ['List', 3]]], '"Missing"'],
    [['Sum', ['Append', 'Missing', 3]], '"Missing"'],
    [['Max', ['Join', 'Missing', ['List', 3]]], '"Missing"'],
    [['Max', ['Append', 'Missing', 3]], '"Missing"'],
    [['Length', ['Join', 'Missing', ['List', 3]]], '"Missing"'],
    [['Reverse', ['Append', 'Missing', 3]], '"Missing"'],
  ])('a consumer of %j agrees with the evaluation', (json, expected) => {
    expect(
      engine()
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test.each([
    [['Sum', ['Join', ['If', c, ['List', 1, 2]], ['List', 3]]], '6', '"Missing"'],
    [['Sum', ['Append', ['If', c, ['List', 1, 2]], 3]], '6', '"Missing"'],
    [
      ['Length', ['Join', ['If', c, ['List', 1, 2]], ['List', 3]]],
      '3',
      '"Missing"',
    ],
  ])('a consumer of %j over a restricted list', (json, present, absent) => {
    for (const [t, expected] of [
      [2, present],
      [-1, absent],
    ] as const) {
      const ce = engine();
      ce.assign('t', t);
      expect(
        ce
          .box(json as never)
          .evaluate()
          .toString()
      ).toBe(expected);
    }
  });

  test.each(['javascript', 'python'])(
    'a join with an absent operand does not compile to %s',
    (to) => {
      // The interpreter answers `Missing` for the whole join. The compiled
      // code was `[undefined, 3]` (JavaScript) and `[math.nan, 3]` (Python).
      const r = compile(
        engine().box(['Join', 'Missing', ['List', 3]] as never),
        { to } as never
      );
      expect(r.success).toBe(false);
    }
  );
});

describe('A set relation over an absent set', () => {
  // A set relation is two-valued, as a comparison is: an absent set makes
  // it `False`, and its negated form (`NotSubset`, ...) `True` (user decision
  // of 2026-11-02, two-valued comparisons). From 2026-09-25 to 2026-11-02 an
  // absent set made the answer `Missing`.
  const relations = [
    'Subset',
    'SubsetEqual',
    'Superset',
    'SupersetEqual',
    'NotSubset',
    'NotSuperset',
    'NotSupersetEqual',
  ];
  test.each(relations)('%s over an absent set is a boolean', (op) => {
    const ce = engine();
    for (const args of [
      ['Missing', ['Set', 2, 3]],
      [['Set', 2], 'Missing'],
    ]) {
      const e = ce.box([op, ...args] as never);
      expect(e.type.toString()).toBe('boolean');
      expect(e.evaluate().toString()).toBe(
        op.startsWith('Not') ? '"True"' : '"False"'
      );
    }
  });
  test.each(relations)('%s over present sets is unchanged', (op) => {
    const ce = engine();
    const e = ce.box([op, ['Set', 2], ['Set', 2, 3]] as never);
    expect(e.type.toString()).toBe('boolean');
    expect(['"True"', '"False"']).toContain(e.evaluate().toString());
  });
});

describe('Membership that an unknown could still change', () => {
  // `Element` is mathematical membership: an element with unknowns may
  // become equal to the value later, so "not a member" is not settled and
  // the call stays held, as it already did for a `Set`. The search operators
  // `Contains`, `IndexOf` and `Count` compare structurally and are not
  // affected.
  test('the answer waits for the unknown', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Element', 'x', ['List', 1, 2]]).evaluate().operator).toBe(
      'Element'
    );
    expect(ce.box(['Element', 1, ['List', 'a', 2]]).evaluate().operator).toBe(
      'Element'
    );
    ce.assign('x', 1);
    expect(
      ce.box(['Element', 'x', ['List', 1, 2]]).evaluate().toString()
    ).toBe('"True"');
  });
  test('a settled answer is unchanged', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Element', 2, ['List', 'a', 2]]).evaluate().toString()).toBe('"True"');
    expect(ce.box(['Element', 3, ['List', 1, 2]]).evaluate().toString()).toBe('"False"');
    expect(ce.box(['Element', 2, ['List', 1, 'Missing']]).evaluate().toString()).toBe('"False"');
    // Structural search is unchanged.
    expect(ce.box(['Contains', ['List', 1, 2], 'x']).evaluate().toString()).toBe('"False"');
  });
});

describe('Element over an absent or restricted collection', () => {
  // `Element` threads a restricted collection whole, as `Contains` does.
  // Nothing is a member of an absent collection: `Element` is `False` and
  // `NotElement` is `True` (user decision of 2026-11-02, two-valued
  // comparisons).
  test('an absent collection gives False, and True for NotElement', () => {
    const ce = engine();
    for (const [op, v] of [
      ['Element', '"False"'],
      ['NotElement', '"True"'],
    ]) {
      const e = ce.box([op, 2, 'Missing'] as never);
      expect(e.type.toString()).toBe('boolean');
      expect(e.evaluate().toString()).toBe(v);
    }
  });
  test('a restricted collection is threaded, and held and fresh agree', () => {
    // The held result is the restriction of a boolean, which is `False` for
    // a false scalar condition, and the fresh route evaluates
    // `Element(2, Missing)`, which is `False` too (user decision of
    // 2026-11-02, two-valued comparisons). See `Any` above.
    const ce = engine();
    const W = ['If', ['Less', 0, 't'], ['List', 1, 2]];
    const held = ce.box(['Element', 2, W] as never).evaluate();
    expect(held.toString()).toBe('If(0 < t, "True")');
    ce.assign('t', -1);
    expect(held.evaluate().toString()).toBe('"False"');
    expect(ce.box(['Element', 2, W] as never).evaluate().toString()).toBe(
      '"False"'
    );
  });
  test('a settled exclusion from a set that is not a literal list stays', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Element', 'x', 'EmptySet']).evaluate().toString()).toBe(
      '"False"'
    );
  });
});

describe('Join and Append over a nested or piecewise absent source', () => {
  test('a nested Join over an absent operand is not a collection view', () => {
    const ce = engine();
    const e = ce.box(['Append', ['Join', 'Missing', ['List', 1]], 3]);
    expect([...e.each()].length).toBe(0);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });
  test('an undecided If operand keeps the Join held', () => {
    const ce = engine();
    const expr = [
      'Join',
      ['If', ['Greater', 't', 0], ['List', 1, 2], 'Missing'],
      ['List', 3],
    ];
    // Before, the view skipped the `If` operand and the value was `Set(3)`.
    expect(ce.box(expr as never).evaluate().operator).toBe('Join');
    ce.assign('t', 1);
    expect(ce.box(expr as never).evaluate().toString()).toBe('[1,2,3]');
    ce.assign('t', -1);
    expect(ce.box(expr as never).evaluate().toString()).toBe('"Missing"');
  });
});

describe('Membership scope and Append sources', () => {
  test('a tuple or a lazy view keeps an unknown value open', () => {
    // Their `contains` compares structurally, so "not a member" is not
    // settled while the value has unknowns.
    const ce = new ComputeEngine();
    for (const coll of [
      ['Tuple', 1, 2],
      ['Take', ['List', 1, 2, 3], 2],
      ['Reverse', ['List', 1, 2]],
    ])
      expect(ce.box(['Element', 'x', coll] as never).evaluate().operator).toBe(
        'Element'
      );
    expect(ce.box(['Element', 3, ['Tuple', 1, 2]]).evaluate().toString()).toBe(
      '"False"'
    );
    expect(ce.box(['Element', 11, ['Range', 1, 10]]).evaluate().toString()).toBe(
      '"False"'
    );
  });
  test('a piecewise appended element does not make the source absent', () => {
    const ce = engine();
    const e = ce.box([
      'Join',
      ['Append', ['Range', 1, 3], ['If', ['Greater', 't', 0], 4, 5]],
      ['List', 6],
    ] as never);
    expect([...e.each()].length).toBe(5);
  });
});

describe('Absent sources under other collection operators', () => {
  // `Take`, `Sort`, `Reverse` and the other operators that take their source
  // first pass an absent source through, so a `Join` over one of them is not
  // a collection view. Before, `Sum(Join([3], Take(Missing, 1)))` was 3.
  test('the consumers see the absence', () => {
    const ce = engine();
    for (const inner of [
      ['Take', 'Missing', 1],
      ['Sort', 'Missing'],
      ['Reverse', 'Missing'],
    ]) {
      expect(
        ce.box(['Sum', ['Join', ['List', 3], inner]] as never).evaluate().toString()
      ).toBe('"Missing"');
      expect(
        ce.box(['Length', ['Join', ['List', 3], inner]] as never).evaluate().toString()
      ).toBe('"Missing"');
    }
  });
  test('a lazy view with unknowns keeps membership open', () => {
    const ce = new ComputeEngine();
    expect(
      ce.box(['Element', 1, ['Reverse', ['List', 'x', 2]]]).evaluate().operator
    ).toBe('Element');
  });
});
