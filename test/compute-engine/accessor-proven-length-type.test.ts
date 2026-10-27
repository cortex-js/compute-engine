/**
 * The result type of `First`, `Second`, `Third`, `Last` and of `At` with a
 * literal index has an absent member (`missing` for a point, a string or a
 * row, `nan` for a number) only when the access can find nothing (user
 * decision 2026-09-30). When the operand is PROVED to hold the position, the
 * result is the element type. The proof is read from pure sources
 * (`provenLengthD`, `library/collections.ts`): a list type with a length,
 * a list literal, a string literal, a `Range` with literal bounds, and
 * `Rest`, `Most`, `Take` and `Drop` (with a literal count) of such an
 * operand.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { BoxedSymbol } from '../../src/compute-engine/boxed-expression/boxed-symbol';

const POINTS = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'integer');
  ce.declare('pts', 'list<tuple<number, number>>');
  ce.declare('pts2', 'list<tuple<number, number>^2>');
  ce.declare('v3', 'list<number^3>');
  ce.declare('m23', 'matrix<2x3>');
  ce.declare('held', 'list<tuple<number, number>>');
  ce.assign('held', ce.box(POINTS as any));
  return ce;
}

function typeOf(ce: ComputeEngine, json: unknown): string {
  return ce.box(json as any).type.toString();
}

describe('an access into an operand proved to hold the position', () => {
  const ce = engine();

  test.each([
    ['First', [POINTS], 'tuple<integer, integer>'],
    ['Second', [POINTS], 'tuple<integer, integer>'],
    ['Last', [POINTS], 'tuple<integer, integer>'],
    ['At', [POINTS, 1], 'tuple<integer, integer>'],
    ['At', [POINTS, -1], 'tuple<integer, integer>'],
    ['First', [['List', 7, 8, 9]], 'integer'],
    ['Third', [['List', 7, 8, 9]], 'integer'],
    ['At', [['List', 7, 8, 9], 2], 'integer'],
    ['First', [['List', { str: 'a' }, { str: 'b' }]], 'string'],
    ['First', ['pts2'], 'tuple<number, number>'],
    ['Last', ['pts2'], 'tuple<number, number>'],
    ['First', [['Reverse', POINTS]], 'tuple<integer, integer>'],
    ['First', [['Range', 1, 5]], 'integer'],
    ['Third', [['Range', 1, 5]], 'integer'],
    ['Last', [['Range', 2, 10, 2]], 'integer'],
    ['First', [{ str: 'abc' }], 'character'],
    ['Third', [{ str: 'abc' }], 'character'],
    // A range with no step counts towards its upper bound: 5, 4, 3, 2, 1.
    ['Third', [['Range', 5, 1]], 'integer'],
    // A step that is not an integer: 0, 0.5, 1.
    ['Third', [['Range', 0, 1, 0.5]], 'real'],
    // A matrix type states its rows.
    ['First', ['m23'], 'vector<3>'],
    ['Last', ['m23'], 'vector<3>'],
    // `Rest`, `Most`, `Take` and `Drop` of an operand with a proved length,
    // with a literal count, have a proved length too.
    ['First', [['Rest', POINTS]], 'tuple<integer, integer>'],
    ['First', [['Rest', ['List', 1, 2, 3]]], 'integer'],
    ['First', [['Take', ['List', 1, 2, 3], 2]], 'integer'],
    ['Second', [['Take', ['List', 1, 2, 3], -2]], 'integer'],
    ['First', [['Drop', ['List', 1, 2, 3], 2]], 'integer'],
    ['Last', [['Most', ['List', 1, 2, 3]]], 'integer'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });
});

describe('an access into an operand proved NOT to hold the position', () => {
  const ce = engine();

  // The value is always the marker, and the type is the marker alone:
  // `nan` for number elements, `missing` for other elements. A chained read
  // reads its marker from the element type of the operand of the inner
  // access (`M[7][1]` over a matrix is `NaN`, typed `nan`).
  test.each([
    ['Third', [POINTS], 'missing'],
    ['At', [POINTS, 9], 'missing'],
    ['At', [POINTS, 0], 'missing'],
    ['At', [['List', 7, 8, 9], 9], 'nan'],
    ['At', ['v3', 4], 'nan'],
    ['At', [{ str: 'abc' }, 9], 'missing'],
    ['At', [['List', { str: 'a' }, { str: 'b' }], -3], 'missing'],
    ['First', [['Take', POINTS, 0]], 'missing'],
    ['At', ['m23', 3], 'missing'],
    // A range that holds fewer elements than the position.
    ['Third', [['Range', 1, 2]], 'nan'],
    ['First', [['Range', 1, 5, -1]], 'nan'],
    ['Second', [['Drop', ['List', 1, 2, 3], 2]], 'nan'],
    ['First', [['Rest', ['List', 1]]], 'nan'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });

  test('the value is the marker', () => {
    expect(
      ce
        .box(['Third', POINTS] as any)
        .evaluate()
        .toString()
    ).toBe('"Missing"');
    expect(ce.box(['At', ['List', 7, 8, 9], 9]).evaluate().isNaN).toBe(true);
    for (const json of [
      ['Third', ['Range', 1, 2]],
      ['First', ['Range', 1, 5, -1]],
      ['Second', ['Drop', ['List', 1, 2, 3], 2]],
      ['First', ['Rest', ['List', 1]]],
    ])
      expect(ce.box(json as any).evaluate().isNaN).toBe(true);
  });

  test('the value of an access through Rest, Most, Take or Drop has the type', () => {
    for (const [json, value] of [
      [['First', ['Rest', ['List', 1, 2, 3]]], '2'],
      [['First', ['Take', ['List', 1, 2, 3], 2]], '1'],
      [['Second', ['Take', ['List', 1, 2, 3], -2]], '3'],
      [['First', ['Drop', ['List', 1, 2, 3], 2]], '3'],
      [['Last', ['Most', ['List', 1, 2, 3]]], '2'],
    ] as [unknown, string][]) {
      const expr = ce.box(json as any);
      const v = expr.evaluate();
      expect(v.toString()).toBe(value);
      expect(v.type.matches(expr.type)).toBe(true);
    }
  });

  test('a chained read past the end of a matrix answers the numeric marker', () => {
    const rows = ['List', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['At', ['At', rows, 7], 1] as any).evaluate().isNaN).toBe(
      true
    );
  });

  test('a chained read reads its marker from the rows of the inner operand', () => {
    const rows = ['List', ['List', 1, 2], ['List', 3, 4]];
    const strings = ['List', { str: 'ab' }, { str: 'cd' }];
    for (const [json, type, value] of [
      [['At', rows, 7], 'missing', '"Missing"'],
      [['At', ['At', rows, 7], 1], 'nan', 'NaN'],
      [['First', ['At', rows, 7]], 'nan', 'NaN'],
      [['Last', ['Third', rows]], 'nan', 'NaN'],
      [['At', ['At', POINTS, 9], 2], 'nan', 'NaN'],
      [['Second', ['At', POINTS, -5]], 'nan', 'NaN'],
      [['At', ['At', strings, 3], 1], 'missing', '"Missing"'],
      [['First', ['First', ['Take', rows, 0]]], 'nan', 'NaN'],
      // Two levels of absent access.
      [
        ['At', ['At', ['At', ['List', rows, rows], 5], 1], 2],
        'nan',
        'NaN',
      ],
    ] as [unknown, string, string][]) {
      const expr = ce.box(json as any);
      expect([json, expr.type.toString()]).toEqual([json, type]);
      const v = expr.evaluate();
      expect([json, v.toString()]).toEqual([json, value]);
      expect(v.type.matches(expr.type)).toBe(true);
    }
    // A declared matrix with no value: the read stays symbolic, with the
    // type of the marker it answers once the matrix has a value.
    expect(typeOf(ce, ['At', ['At', 'm23', 3], 1])).toBe('nan');
    // The same through the LaTeX route.
    const parsed = ce.parse('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}[7][1]');
    expect(parsed.type.toString()).toBe('nan');
    expect(parsed.evaluate().isNaN).toBe(true);
  });
});

describe('an access that can find nothing keeps its absent member', () => {
  const ce = engine();
  const filter = [
    'Filter',
    POINTS,
    ['Function', ['Greater', ['At', 'c', 1], 0], 'c'],
  ];

  test.each([
    // A filter can select nothing.
    ['First', [filter], 'missing | tuple<integer, integer>'],
    // The source of `Rest` has no proved length, so an empty result is
    // possible.
    ['First', [['Rest', 'pts']], 'missing | tuple<number, number>'],
    // A count that is not a literal.
    ['First', [['Take', POINTS, 'n']], 'missing | tuple<integer, integer>'],
    // A declaration with no length: the value can be replaced by `[]`.
    ['First', ['pts'], 'missing | tuple<number, number>'],
    ['First', ['held'], 'missing | tuple<number, number>'],
    // A range with a symbolic bound.
    ['First', [['Range', 1, 'n']], 'integer | nan'],
    // A variable index.
    ['At', [POINTS, 'n'], 'missing | tuple<integer, integer>'],
  ])('%s%j is typed %s', (head, args, expected) => {
    expect(typeOf(ce, [head, ...(args as unknown[])])).toBe(expected);
  });

  test('an operand that may be absent as a whole keeps the member', () => {
    // `At(rows, n)` is typed `missing | vector<integer^2>`: the row has a
    // length, but there may be no row.
    const rows = ['List', ['List', 1, 2], ['List', 3, 4]];
    const t = typeOf(ce, ['First', ['At', rows, 'n']]);
    expect(t).toContain('nan');
  });

  test('a literal element that may evaluate to Nothing does not prove a length', () => {
    // The list erases an element that evaluates to `Nothing`, so
    // `[If(c, "a", Nothing)]` is `[]` when `c` is false, and `First` of it
    // is `Missing`. Before, the literal was typed `list<string^1>` and the
    // `First` of it `string`.
    const ce = engine();
    ce.declare('c', 'boolean');
    const list = ['List', ['If', 'c', "'a'", 'Nothing']];
    expect(typeOf(ce, list)).toBe('list<string>');
    expect(typeOf(ce, ['First', list])).toBe('missing | string');
    expect(
      typeOf(ce, ['First', ['List', ['Which', 'c', "'a'", 'True', 'Nothing']]])
    ).toBe('missing | string');
    ce.assign('c', false);
    expect(ce.box(['First', list]).evaluate().symbol).toBe('Missing');
    // A conditional with no `Nothing` branch still proves the length.
    expect(typeOf(ce, ['First', ['List', ['If', 'c', "'a'", "'b'"]]])).toBe(
      'string'
    );
  });

  test('no length or shape is derived from such a literal', () => {
    // The consumers that read a list literal's structure (a matrix row, a
    // sum of lists, a broadcast, a vector operator) read its type, which has
    // no length, so none of them claims a length or a shape.
    const ce = engine();
    ce.declare('c', 'boolean');
    const v = ['List', ['If', 'c', 1, 'Nothing'], 2];
    const rows = ['List', v, ['List', 3, 4]];
    expect(typeOf(ce, rows)).toBe('list<list<integer>>');
    expect(typeOf(ce, ['Add', v, ['List', 10, 20]])).toBe('list<integer>');
    expect(typeOf(ce, ['Multiply', v, 3])).toBe('list<integer>');
    expect(typeOf(ce, ['Sin', v])).toBe('list<number>');
    expect(typeOf(ce, ['Transpose', rows])).toBe('list<list<integer>>');
  });

  test('a tuple coordinate that may evaluate to Nothing keeps its position', () => {
    // A possible omission remains in the coordinate type, with fixed arity.
    const ce = engine();
    ce.declare('c', 'boolean');
    const t = ['Tuple', ['If', 'c', 1, 'Nothing'], 2];
    expect(typeOf(ce, t)).toBe('tuple<integer | nothing, integer>');
    ce.assign('c', false);
    expect(ce.box(t as any).evaluate().json).toEqual(['Tuple', 'Nothing', 2]);
  });
});

describe('a broadcast over a list literal with an element that may evaluate to Nothing', () => {
  // The broadcast, a lazy `Map` and the collection handlers of the literal
  // walked its operands, and evaluated each one in its own cell, so the list
  // never erased the element: with `c` false, `Sin([If(c, 1, Nothing), 2])`
  // was `[Sin(Nothing), Sin(2)]`. They now walk the elements of its value.
  const v = ['List', ['If', 'c', 1, 'Nothing'], 2];
  const value = (ce: ComputeEngine, json: unknown) =>
    ce
      .box(json as any)
      .evaluate()
      .toString();

  test.each([
    [false, ['Sin', v], '[sin(2)]'],
    [false, ['Power', v, 2], '[4]'],
    [false, ['Abs', v], '[2]'],
    [false, ['Sqrt', v], '[sqrt(2)]'],
    [false, ['Add', v, 1], '[3]'],
    [false, ['Map', 'Sin', v], '[sin(2)]'],
    [false, ['Map', ['Function', ['Sin', 'x'], 'x'], v], '[sin(2)]'],
    [false, ['Filter', v, ['Function', 'True', 'x']], '[2]'],
    [false, ['Sin', ['List', v, ['List', 3, 4]]], '[[sin(2)],[sin(3),sin(4)]]'],
    [true, ['Sin', v], '[sin(1),sin(2)]'],
    [true, ['Power', v, 2], '[1,4]'],
    [true, ['Map', 'Sin', v], '[sin(1),sin(2)]'],
  ])('with c = %s, %j is %s', (c, json, expected) => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.assign('c', c);
    expect(value(ce, json)).toBe(expected);
  });

  test('the literal counts and indexes the elements of its value', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.assign('c', false);
    const literal = ce.box(v as any);
    expect(literal.count).toBe(1);
    expect(literal.at(1)?.toString()).toBe('2');
  });

  test('the literal is scanned once for an element that may be erased, not on every access', () => {
    // Each collection handler of a literal (`at`, the iterator, `contains`)
    // asks whether an element may evaluate to `Nothing`, and the scan reads
    // the type of every element. A loop of `at(1)` … `at(n)` read n² types.
    // The answer is kept per literal while the engine is not changed. Count
    // the type reads of the elements, which are symbols.
    const ce = new ComputeEngine();
    const n = 200;
    const literal = ce.function(
      'List',
      Array.from({ length: n }, (_, i) => ce.symbol(`s${i}`))
    );
    const proto = BoxedSymbol.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'type')!;
    let reads = 0;
    Object.defineProperty(proto, 'type', {
      ...descriptor,
      get() {
        reads += 1;
        return descriptor.get!.call(this);
      },
    });
    try {
      for (let i = 1; i <= n; i += 1)
        expect(literal.at(i)?.symbol).toBe(`s${i - 1}`);
    } finally {
      Object.defineProperty(proto, 'type', descriptor);
    }
    // One scan of n elements. Without the memo it was n · n = 40000.
    expect(reads).toBeLessThanOrEqual(n);
  });

  test('an assignment after a first access is seen by the next access', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean');
    ce.assign('c', false);
    const literal = ce.box(v as any);
    expect(literal.count).toBe(1);
    ce.assign('c', true);
    expect(literal.count).toBe(2);
    expect(literal.at(1)?.toString()).toBe('1');
  });

  test('the compiled code agrees', () => {
    for (const c of [false, true]) {
      const ce = new ComputeEngine();
      ce.declare('c', 'boolean');
      ce.assign('c', c);
      const expected = c ? [Math.sin(1), Math.sin(2)] : [Math.sin(2)];
      for (const json of [
        ['Sin', v],
        ['Map', 'Sin', v],
      ]) {
        const f = compile(ce.box(json as any));
        expect(f.success).toBe(true);
        expect(f.run!({ c })).toEqual(expected);
      }
    }
  });
});

// An element read over a base that declares `any` elements (`list<any>`,
// `collection<any>`, `indexed_collection<any>`) or that is a top type which
// may hold a collection (`any`, `value`) is typed `any`. It used to be
// `unknown`, the values-only top, so `P[i] - P[j]` typed
// `broadcastable<number>` while its value can be a point: `(3, 4) - (1, 1)`
// is `(2, 3)` (Tycho ledger row 409). A base whose type was inferred keeps
// `unknown`: there `any` means "no element type yet", and a numeric use
// refines the base (`elementReadType()`, `library/collections.ts`).
describe('an element read over a base that declares any elements', () => {
  function declared(t?: string): ComputeEngine {
    const ce = new ComputeEngine();
    if (t !== undefined) ce.declare('P', t);
    ce.declare('i', 'integer');
    ce.declare('j', 'integer');
    return ce;
  }

  test.each([
    ['list<any>', 'any'],
    ['collection<any>', 'any'],
    ['indexed_collection<any>', 'any'],
    ['any', 'any'],
    ['value', 'any'],
    // Controls
    ['list<number>', 'number'],
    ['list<integer>', 'integer | nan'],
    ['list', 'any'],
  ])('P: %s, P[i] is %s on the parse and box routes', (t, expected) => {
    const ce = declared(t);
    expect(ce.parse('P[i]').type.toString()).toBe(expected);
    expect(typeOf(ce, ['At', 'P', 'i'])).toBe(expected);
    expect(
      ce.function('At', [ce.symbol('P'), ce.symbol('i')]).type.toString()
    ).toBe(expected);
  });

  test.each([['list<any>'], ['any']])(
    'P: %s, the difference of two reads is any',
    (t) => {
      const ce = declared(t);
      expect(ce.parse('P[i]-P[j]').type.toString()).toBe('any');
      expect(ce.symbol('P').type.toString()).toBe(t);
    }
  );

  test('P: list<number>, the difference of two reads is a number', () => {
    const ce = declared('list<number>');
    expect(ce.parse('P[i]-P[j]').type.toString()).toBe('number');
  });

  test.each([['unknown'], [undefined]])(
    'P: %s (inferred), a read is unknown and a numeric use refines P',
    (t) => {
      const ce = declared(t);
      expect(ce.parse('P[i]').type.toString()).toBe('unknown');
      expect(ce.parse('P[i]-P[j]').type.toString()).toBe('number');
      expect(ce.symbol('P').type.toString()).toBe('indexed_collection<number>');
    }
  );

  test('the other accessors and access forms', () => {
    const ce = declared('list<any>');
    ce.declare('A', 'any');
    ce.declare('M', 'list<list<any>>');
    ce.declare('D', 'dictionary<any>');
    ce.declare('k', 'string');
    expect(typeOf(ce, ['First', 'P'])).toBe('any');
    expect(typeOf(ce, ['Last', 'P'])).toBe('any');
    expect(typeOf(ce, ['First', 'A'])).toBe('any');
    expect(typeOf(ce, ['At', 'P', ['List', 1, 2]])).toBe('list<any>');
    expect(typeOf(ce, ['At', 'M', 'i', 'j'])).toBe('any');
    expect(typeOf(ce, ['At', 'A', 'i', 'j'])).toBe('any');
    expect(typeOf(ce, ['At', 'D', 'k'])).toBe('any');
    expect(typeOf(ce, ['Field', 'D', { str: 'a' }])).toBe('any');
    ce.declare('E', 'dictionary<number>');
    expect(typeOf(ce, ['Field', 'E', { str: 'a' }])).toBe('number');
  });

  test('P: any holding points, the type of the difference holds its value', () => {
    const ce = declared('any');
    ce.assign('P', ce.box(['List', ['Tuple', 3, 4], ['Tuple', 1, 1]]));
    const expr = ce.parse('P[1]-P[2]');
    const value = expr.evaluate();
    expect(value.toString()).toBe('(2, 3)');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  // A function of a read keeps `any`: the read may be a point or a list, and
  // `any` is the declared element.
  test.each([
    [['Sqrt', ['At', 'P', 'i']]],
    [['Sin', ['At', 'P', 'i']]],
    [['h', ['At', 'P', 'i']]],
  ])('P: list<any>, %j is any', (json) => {
    const ce = declared('list<any>');
    ce.declare('h', '(number) -> number');
    expect(typeOf(ce, json)).toBe('any');
  });

  test.each([
    ['tuple<any, any>', ['At', 'T', 'i'], 'any'],
    ['tuple<number, any>', ['At', 'T', 'i'], 'any'],
    ['tuple<number, any>', ['At', 'T', 1], 'number'],
    ['record{a: any, b: number}', ['At', 'T', 'k'], 'any'],
    ['record{a: any, b: number}', ['At', 'T', { str: 'b' }], 'number'],
    ['list<any>', ['Second', 'T'], 'any'],
    ['list<any>', ['Third', 'T'], 'any'],
  ])('T: %s, %j is %s', (t, json, expected) => {
    const ce = declared();
    ce.declare('T', t);
    ce.declare('k', 'string');
    expect(typeOf(ce, json)).toBe(expected);
  });

  // `Rest(P)` holds the elements of `P`: with `P` inferred, a read of it is
  // `unknown` as a read of `P` is, not `any`.
  test('P inferred, a read of Rest(P) is unknown', () => {
    const ce = declared();
    ce.box(['First', 'P']);
    expect(ce.symbol('P').type.toString()).toBe('indexed_collection<any>');
    expect(typeOf(ce, ['At', ['Rest', 'P'], 1])).toBe('unknown');
    expect(typeOf(ce, ['Add', ['At', ['Rest', 'P'], 1], 1])).toBe(
      'list<list<any> | number | tuple> | number | tuple'
    );
  });

  // `Take(P, 2)` and `Rest(P)` with `P` undeclared are typed
  // `list<unknown> | string`. A read of them is `unknown`, not the
  // `character` of the `string` option, so a numeric use is valid.
  test.each([[['Take', 'P', 2]], [['Rest', 'P']]])(
    'P inferred, a numeric use of a read of %j is valid',
    (part) => {
      const ce = declared();
      expect(typeOf(ce, ['At', part, 'i'])).toBe('unknown');
      const sum = ce.box(['Add', ['At', part, 'i'], 1] as any);
      expect(sum.isValid).toBe(true);
      expect(sum.type.toString()).toBe(
        'list<list<any> | number | tuple> | number | tuple'
      );
    }
  );
});

// A raw collection can retain Nothing, including one declared with a bare
// family or explicit any content type. Such reads cannot prove tuple slots
// omission-free. A concrete numeric contract remains compilable.
describe('compiling tuple coordinates requires omission-free reads', () => {
  const POINT = ['Tuple', ['At', 'P', 1], ['At', 'P', 2]];

  test.each(['list', 'list<any>', 'collection<any> | tuple', 'list<any^2>'])(
    'P: %s cannot exclude omitted coordinates',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('P', type);
      const result = compile(ce.box(POINT as any), { to: 'javascript' });
      expect(result.success).toBe(false);
      expect(result.diagnostic?.message ?? '').toMatch(/Nothing/);
    }
  );

  test('a literal of unrestricted runtime operands is not an omission proof', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'any');
    ce.declare('b', 'any');
    ce.declare('i', 'integer');
    const result = compile(
      ce.box(['Tuple', ['At', ['List', 'a', 'b'], 'i'], 1]),
      { to: 'javascript' }
    );
    expect(result.success).toBe(false);
    expect(result.diagnostic?.message ?? '').toMatch(/Nothing/);
  });

  test.each(['dictionary<any>', 'record{a: any}'])(
    'D: %s cannot prove a keyed read excludes Nothing',
    (type) => {
      const ce = new ComputeEngine();
      ce.declare('D', type);
      const result = compile(
        ce.box(['Tuple', ['At', 'D', { str: 'a' }], 1]),
        { to: 'javascript' }
      );
      expect(result.success).toBe(false);
      expect(result.diagnostic?.message ?? '').toMatch(/Nothing/);
    }
  );

  test('P: vector<number^2> compiles on glsl', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'vector<number^2>');
    const result = compile(ce.box(POINT as any), { to: 'glsl' });
    expect(result.success).toBe(true);
    expect(result.code).toBe('vec2(P.x, P.y)');
  });

  // A tuple slot may hold `Nothing`: a read of a slot typed `any` still
  // refuses.
  test('T: tuple<number, any>, the refusal stands', () => {
    const ce = new ComputeEngine();
    ce.declare('T', 'tuple<number, any>');
    const result = compile(
      ce.box(['Tuple', ['At', 'T', 1], ['At', 'T', 2]] as any),
      { to: 'javascript' }
    );
    expect(result.success).toBe(false);
    expect(result.diagnostic?.message ?? '').toMatch(/Nothing/);
  });
});

describe('arithmetic over a read proved to find no row', () => {
  // The read is typed `missing`, but it is an absent ROW: the sum of a row
  // and a number is a row, and an absent row is `Missing`
  // (`docs/ERROR-MODEL.md`, "An absent OBJECT in compiled arithmetic is the
  // object null too"). An absent number is `NaN`.
  const ce = engine();
  const rows = ['List', ['List', 1, 2], ['List', 3, 4]];

  test.each([
    [['Add', ['At', rows, 5], 1], 'Missing'],
    [['Multiply', 2, ['Third', rows]], 'Missing'],
    [['Add', ['At', POINTS, 9], ['Tuple', 1, 1]], 'Missing'],
    [['Add', ['At', ['List', 7, 8], 5], 1], 'NaN'],
  ])('%j is %s, with a type that holds it', (json, value) => {
    const expr = ce.box(json as any);
    const v = expr.evaluate();
    expect(v.toString().replace(/"/g, '')).toBe(value);
    expect(v.type.matches(expr.type)).toBe(true);
  });

  // A block local that holds the read keeps the domain of the read: the
  // local is typed `missing | <row type>`, and the sum is `Missing`, as for
  // the read itself. An absent number stays `NaN`.
  test.each([
    [['At', rows, 7], 'Missing'],
    [['Third', rows], 'Missing'],
    [['At', ['At', rows, 7], 1], 'NaN'],
    [['At', ['List', 7, 8], 5], 'NaN'],
  ])('a block local bound to %j gives %s in a sum', (read, value) => {
    for (const json of [
      ['Block', ['Assign', 'r', read], ['Add', 'r', 1]],
      ['Block', ['Declare', 'r'], ['Assign', 'r', read], ['Add', 'r', 1]],
    ]) {
      const expr = ce.box(json as any);
      const v = expr.evaluate();
      expect(v.toString().replace(/"/g, '')).toBe(value);
      expect(v.type.matches(expr.type)).toBe(true);
    }
  });

  test('the compiled code declines an absent row, and keeps an absent number', () => {
    expect(() =>
      compile(ce.box(['Add', ['At', rows, 5], 1] as any), {
        fallback: false,
      } as any)
    ).toThrow(/absent/);
    const n = compile(ce.box(['Add', ['At', ['List', 7, 8], 5], 1] as any), {
      fallback: false,
    } as any);
    expect(Number.isNaN((n.run as any)({}))).toBe(true);
  });
});
