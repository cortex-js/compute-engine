import { ComputeEngine } from '../../src/compute-engine';

// A collection whose elements may be absent (user decision 2026-10-07).
//
// A dictionary lookup or an index with a computed key is typed `T | missing`,
// so a `Map` over such reads is typed `list<T | missing>` even when every
// element exists. A collection typed `collection<T | missing>` (any kind:
// list, set, tuple, dictionary values) is admitted where `collection<T>` is
// expected, as one value typed `T | missing` is admitted where `T` is
// expected. The operator that reads an absent element decides at run time: a
// text operator answers an `incompatible-type` error that names the element,
// an aggregate answers `NaN`, a positional operator keeps the cell.
//
// The admission is `absentElementsMatchParam`
// (`src/compute-engine/boxed-expression/validate.ts`); the design text is
// `docs/ERROR-MODEL.md` §3, "A collection whose elements may be absent".
//
// Each case is probed on the box route and on the parse route.

const L = (...xs: unknown[]) => ['List', ...xs];

/** An engine with operators whose collection parameter does not strip
 * `missing`: the `string` parameter makes the resolved missing behavior
 * `pass-through` (an operator whose parameters are all numeric or collections
 * would be `propagate`, which strips every `missing` arm already). */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('joinList', {
    signature: '(list<string>, string) -> string',
    evaluate: (_ops, { engine }) => engine.string('joined'),
  });
  ce.declare('countAll', {
    signature: '(collection<number>, string) -> integer',
    evaluate: (_ops, { engine }) => engine.number(1),
  });
  ce.declare('countInts', {
    signature: '(collection<integer>, string) -> integer',
    evaluate: (_ops, { engine }) => engine.number(1),
  });
  ce.declare('ys', 'collection<string | missing>');
  ce.declare('zs', 'list<string | missing>');
  return ce;
}

function boxed(json: unknown) {
  return engine().box(json as never);
}

function parsed(latex: string) {
  return engine().parse(latex);
}

describe('A collection of possibly absent elements at a collection parameter', () => {
  test.each([
    [
      'list<missing | string> at collection<character | string>',
      ['StringJoin', L("'a'", 'Missing', "'b'")],
    ],
    [
      'list<missing | string> at list<string>',
      ['joinList', L("'a'", 'Missing', "'b'"), "'-'"],
    ],
    [
      'list<integer | missing> at collection<number>',
      ['countAll', L(1, 'Missing', 3), "'x'"],
    ],
    [
      'set<missing | string> at collection<character | string>',
      ['StringJoin', ['Set', "'a'", 'Missing']],
    ],
    ['a declared collection<string | missing>', ['StringJoin', 'ys']],
    ['a declared list<string | missing>', ['joinList', 'zs', "'-'"]],
  ])('box route: %s is admitted', (_label, json) => {
    expect(boxed(json).isValid).toBe(true);
  });

  test.each([
    [
      'list<missing | string> at collection<character | string>',
      '\\operatorname{StringJoin}([\\text{a}, \\operatorname{Missing}, \\text{b}])',
    ],
    [
      'list<missing | string> at list<string>',
      '\\operatorname{joinList}([\\text{a}, \\operatorname{Missing}, \\text{b}], \\text{-})',
    ],
    [
      'list<integer | missing> at collection<number>',
      '\\operatorname{countAll}([1, \\operatorname{Missing}, 3], \\text{x})',
    ],
    [
      'a declared collection<string | missing>',
      '\\operatorname{StringJoin}(\\operatorname{ys})',
    ],
    [
      'a declared list<string | missing>',
      '\\operatorname{joinList}(\\operatorname{zs}, \\text{-})',
    ],
  ])('parse route: %s is admitted', (_label, latex) => {
    expect(parsed(latex).isValid).toBe(true);
  });

  test('a collection of the wrong element type is still refused', () => {
    // `list<string>` at `collection<integer>`: no element can fit, absent or
    // not.
    for (const e of [
      boxed(['countInts', L("'a'", "'b'"), "'x'"]),
      parsed('\\operatorname{countInts}([\\text{a}, \\text{b}], \\text{x})'),
      // The `missing` arm is removed, and what is left still does not fit.
      boxed(['countInts', L("'a'", 'Missing'), "'x'"]),
    ]) {
      expect(e.isValid).toBe(false);
      expect(JSON.stringify(e.json)).toContain('incompatible-type');
    }
  });

  test('a collection that can hold only absent elements is refused', () => {
    // `[Missing, Missing]` is typed `list<missing>`: every read of it fails,
    // as a scalar operand typed `missing` alone is refused by a text
    // operator (`ToUpperCase(Missing)`).
    for (const e of [
      boxed(['StringJoin', L('Missing', 'Missing')]),
      parsed(
        '\\operatorname{StringJoin}([\\operatorname{Missing}, \\operatorname{Missing}])'
      ),
    ]) {
      expect(e.isValid).toBe(false);
      expect(JSON.stringify(e.json)).toContain('incompatible-type');
    }
  });
});

describe('Run time: the operator that reads an absent element answers', () => {
  const absentError = (name: string) =>
    JSON.stringify([
      'Error',
      ['ErrorCode', "'incompatible-type'", "'character | string'", "'missing'"],
      name,
    ]);

  test('StringJoin answers an error that names the absent element', () => {
    expect(
      JSON.stringify(
        boxed(['StringJoin', L("'a'", 'Missing', "'b'")]).evaluate().json
      )
    ).toBe(absentError('Missing'));
    expect(
      JSON.stringify(
        parsed(
          '\\operatorname{StringJoin}([\\text{a}, \\operatorname{Missing}, \\text{b}])'
        ).evaluate().json
      )
    ).toBe(absentError('Missing'));
    // `Undefined` is an absent cell too: a list types it as `missing`.
    expect(
      JSON.stringify(
        boxed(['StringJoin', L("'a'", 'Undefined'), "'-'"]).evaluate().json
      )
    ).toBe(absentError('Undefined'));
  });

  test('StringJoin of present elements is unchanged', () => {
    expect(
      boxed(['StringJoin', L("'a'", "'b'"), "'-'"])
        .evaluate()
        .toString()
    ).toBe('"a-b"');
  });

  test('Trim answers the same error for an absent character to strip', () => {
    expect(
      JSON.stringify(
        boxed(['Trim', "'xaxx'", L("'x'", 'Missing')]).evaluate().json
      )
    ).toBe(absentError('Missing'));
    expect(
      boxed(['Trim', "'xaxx'", L("'x'")])
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  // The collection operators already answer by the rules of
  // `docs/ERROR-MODEL.md` §3, "Absent values in collection operators".
  test.each([
    ['Sum', ['Sum', L(1, 'Missing', 3)], 'NaN'],
    ['Max', ['Max', L(1, 'Missing', 3)], 'NaN'],
    ['Length', ['Length', L(1, 'Missing', 3)], '3'],
    ['Length of strings', ['Length', L("'a'", 'Missing', "'b'")], '3'],
    ['Sort', ['Sort', L(3, 'Missing', 1)], '[1,3,"Missing"]'],
    [
      'Sort of strings',
      ['Sort', L("'b'", 'Missing', "'a'")],
      '["a","b","Missing"]',
    ],
    [
      'Filter',
      ['Filter', L(1, 'Missing', 3), ['Function', ['Greater', 'x', 0], 'x']],
      '[1,3]',
    ],
    [
      'Map',
      ['Map', ['Function', ['Multiply', 2, 'x'], 'x'], L(1, 'Missing', 3)],
      '[2,NaN,6]',
    ],
  ])('%s', (_label, json, expected) => {
    expect(boxed(json).evaluate().toString()).toBe(expected);
  });

  test.each([
    ['Sum', '\\operatorname{Sum}([1, \\operatorname{Missing}, 3])', 'NaN'],
    ['Max', '\\max([1, \\operatorname{Missing}, 3])', 'NaN'],
    ['Length', '\\operatorname{Length}([1, \\operatorname{Missing}, 3])', '3'],
  ])('parse route: %s', (_label, latex, expected) => {
    expect(parsed(latex).evaluate().toString()).toBe(expected);
  });
});

// A `Map` whose callback is a lambda literal applies it to an absent element
// in the same way as a `Map` whose callback is the named operator: the
// operator in the body decides. A text operator answers the
// `incompatible-type` error for the cell, and a numeric operator answers
// `NaN`. The lambda `x ↦ ToUpperCase(x)` is a broadcast shape, so its
// elements come from the lowered route (`makeSpineRunner()`,
// `library/map-lowering.ts`). That route read the error of the level as a
// level failure and put `Missing` in the cell, so the result held `Missing`
// with a type that has no `missing` arm.
describe('Map: a lambda callback and the named operator agree on an absent element', () => {
  const upper = ['Function', ['ToUpperCase', 'x'], 'x'];
  const strings = L("'a'", 'Missing', "'b'");
  const cells = (e: ReturnType<typeof boxed>) =>
    [...e.evaluate().each()].map((x) => JSON.stringify(x.json));

  test('a text body: the lambda gives the error of the named operator', () => {
    const lambda = boxed(['Map', upper, strings]);
    const named = boxed(['Map', 'ToUpperCase', strings]);
    const expected = cells(named);
    expect(expected[1]).toContain('incompatible-type');
    expect(expected[1]).toContain("'missing'");
    expect(cells(lambda)).toEqual(expected);
    // The error is the element itself, not `Missing`.
    expect(cells(lambda)[1]).not.toBe('"Missing"');
    expect(cells(lambda)[0]).toBe(`"'A'"`);
    expect(cells(lambda)[2]).toBe(`"'B'"`);
  });

  test('a text body: the indexed read gives the same error', () => {
    const lambda = boxed(['Map', upper, strings]).evaluate();
    const named = boxed(['Map', 'ToUpperCase', strings]).evaluate();
    expect(JSON.stringify(lambda.at(2)!.json)).toBe(
      JSON.stringify(named.at(2)!.json)
    );
    expect(JSON.stringify(lambda.at(2)!.json)).toContain('incompatible-type');
  });

  test('a text body: the lambda gives the error of a direct application', () => {
    const direct = boxed(['Apply', upper, 'Missing']).evaluate();
    expect(cells(boxed(['Map', upper, strings]))[1]).toBe(
      JSON.stringify(direct.json)
    );
  });

  test('a text body: the parse route agrees with the box route', () => {
    const lambda = parsed(
      '\\operatorname{Map}(x \\mapsto \\operatorname{ToUpperCase}(x), [\\text{a}, \\operatorname{Missing}, \\text{b}])'
    );
    expect(cells(lambda)).toEqual(
      cells(boxed(['Map', 'ToUpperCase', strings]))
    );
  });

  test('a text body: the two spellings have the same result type', () => {
    const lambda = boxed(['Map', upper, strings]);
    const named = boxed(['Map', 'ToUpperCase', strings]);
    expect(lambda.type.toString()).toBe(named.type.toString());
    expect(lambda.evaluate().type.toString()).toBe(
      named.evaluate().type.toString()
    );
  });

  test('a numeric body: both spellings still give NaN for the absent cell', () => {
    const numbers = L(1, 'Missing', 2);
    const lambda = boxed(['Map', ['Function', ['Abs', 'x'], 'x'], numbers]);
    const named = boxed(['Map', 'Abs', numbers]);
    expect(lambda.evaluate().toString()).toBe('[1,NaN,2]');
    expect(named.evaluate().toString()).toBe('[1,NaN,2]');
    expect(lambda.type.toString()).toBe(named.type.toString());
    expect(
      boxed(['Map', ['Function', ['Add', 'x', 1], 'x'], numbers])
        .evaluate()
        .toString()
    ).toBe('[2,NaN,3]');
  });
});
