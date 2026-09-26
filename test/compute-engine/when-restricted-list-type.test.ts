import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';

// A restriction over a list value, `When(L, c)`, stays ONE held `When` while
// its condition is undecided, and presents as a collection of restricted
// cells through its collection handlers (user decision 2026-09-25). Its type
// is the list's own type under the `missing` arm, `missing | vector<integer^2>`
// for `[1,2]{c}`, and every route agrees once the condition is decided: the
// whole list, or `Missing`. Before, the cells were copied into a `List` of
// `When`s, `[1{c}, 2{c}]`, a value typed `list<integer | missing>` that the
// type did not admit, and that re-evaluated to `[Missing, Missing]` once the
// condition failed while a fresh evaluation answered `Missing`. (ROADMAP,
// residues of the Tycho 306–315 round, items 2 and 4.)

const engine = () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('t', 'real');
  return ce;
};

const RL = [
  'When',
  ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  ['Less', 0, 't'],
];

/** The static type of `json`, its evaluated value with `t` free, whether the
 * type admits that value, and the value once `t` is decided against. */
function probe(ce: ComputeEngine, json: unknown) {
  const e = ce.box(json as never);
  const held = e.evaluate();
  const free = {
    type: e.type.toString(),
    value: held.toString(),
    valueType: held.type.toString(),
    admitted: isSubtype(held.type.type, e.type.type),
  };
  ce.assign('t', -1);
  // The held form and a fresh evaluation must agree.
  const decided = {
    twoStep: held.evaluate().toString(),
    fresh: e.evaluate().toString(),
  };
  ce.assign('t', ce.symbol('t'));
  return { ...free, ...decided };
}

describe('a restricted list is one held restriction', () => {
  test('a list of numbers', () => {
    const r = probe(engine(), ['When', ['List', 1, 2], ['Less', 0, 't']]);
    expect(r.type).toBe('missing | vector<integer^2>');
    expect(r.value).toBe('[1,2] {0 < t}');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test('the held form is an indexed collection of restricted cells', () => {
    const ce = engine();
    const r = ce.box(['When', ['List', 1, 2], 'c']).evaluate();
    expect(r.operator).toBe('When');
    expect(r.isCollection).toBe(true);
    // Not an INDEXED collection: the broadcast machinery decides what to map
    // over cell by cell through that predicate, and a restriction is threaded
    // whole instead (`Sin([1,2,3]{0<t})` is `[sin 1, sin 2, sin 3]{0<t}`).
    expect(r.isIndexedCollection).toBe(false);
    expect(r.count).toBe(2);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      '1 {c}',
      '2 {c}',
    ]);
  });

  test('a list of points', () => {
    const r = probe(engine(), RL);
    expect(r.type).toBe('list<tuple<integer, integer>^2> | missing');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
  });

  test('a matrix', () => {
    const r = probe(engine(), [
      'When',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['Less', 0, 't'],
    ]);
    expect(r.type).toBe('matrix<integer^(2x2)> | missing');
    expect(r.value).toBe('[[1,2],[3,4]] {0 < t}');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
  });

  test('a decided condition keeps the whole list or masks it', () => {
    const ce = engine();
    expect(
      ce
        .box(['When', ['List', 1, 2], 'True'])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(
      ce
        .box(['When', ['List', 1, 2], 'False'])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('a point, a string and a set are one value each', () => {
    const ce = engine();
    expect(ce.box(['When', ['Tuple', 1, 2], 'c']).type.toString()).toBe(
      'missing | tuple<integer, integer>'
    );
    expect(ce.box(['When', { str: 'ab' }, 'c']).type.toString()).toBe(
      'missing | string'
    );
    expect(ce.box(['When', ['Set', 1, 2], 'c']).type.toString()).toBe(
      'missing | set<integer>'
    );
  });
});

describe('the applications over a restricted list follow', () => {
  test('a coordinate accessor', () => {
    const r = probe(engine(), ['PointX', RL]);
    expect(r.type).toBe('missing | vector<2>');
    expect(r.value).toBe('[1,3] {0 < t}');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test.each([
    [
      'Dot',
      ['Dot', RL, ['List', ['Tuple', 1, 1], ['Tuple', 1, 1]]],
      'list<integer> | missing',
    ],
    ['Norm', ['Norm', RL], 'list<number> | missing'],
    ['Distance', ['Distance', RL, ['Tuple', 0, 0]], 'list<number> | missing'],
    [
      'Sin',
      ['Sin', ['When', ['List', 1, 2, 3], ['Less', 0, 't']]],
      'missing | vector<3>',
    ],
    [
      'Add',
      ['Add', ['When', ['List', 1, 2], ['Less', 0, 't']], 1],
      'missing | vector<integer^2>',
    ],
  ])(
    '%s keeps the whole-absence arm and both routes agree',
    (_op, json, type) => {
      const r = probe(engine(), json);
      // `Dot` lost the arm before, although it answers `Missing` for an
      // absent list beside a list: it threads its conditional operands whole.
      expect(r.type).toBe(type);
      expect(r.admitted).toBe(true);
      expect(r.twoStep).toBe('"Missing"');
      expect(r.fresh).toBe('"Missing"');
    }
  );

  test('an absent operand beside a list still lands in each cell of a broadcast', () => {
    const ce = engine();
    const e = ce.box(['Add', ['List', 1, 2, 3], ['When', 2, ['Less', 0, 't']]]);
    expect(e.type.toString()).toBe('list<integer | nan^3>');
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe('[NaN,NaN,NaN]');
  });

  test('element access of a restricted matrix', () => {
    const ce = engine();
    const M = [
      'When',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['Less', 0, 't'],
    ];
    const row = probe(ce, ['At', M, 2]);
    expect(row.type).toBe('missing | vector<integer^2>');
    expect(row.value).toBe('[3,4] {0 < t}');
    expect(row.admitted).toBe(true);
    expect(row.twoStep).toBe('"Missing"');
    const cell = probe(ce, ['At', M, 2, 1]);
    expect(cell.type).toBe('integer | missing | nan');
    expect(cell.value).toBe('3 {0 < t}');
    // A masked NUMBER is `NaN` (user decision 2026-09-25).
    expect(cell.twoStep).toBe('NaN');
  });
});

describe('a sum or product whose operands become restrictions when evaluated', () => {
  // `Add` and `Multiply` are lazy: the driver's threading step sees their
  // RAW operands, so a restriction hidden inside a product was not threaded
  // and the sum stayed symbolic, `[2,4]{c} + [3,6]{c}`.
  test.each([
    [
      '2·[1,2]{c} + 3·[1,2]{c}',
      [
        'Add',
        ['Multiply', 2, ['When', ['List', 1, 2], 'c']],
        ['Multiply', 3, ['When', ['List', 1, 2], 'c']],
      ],
      '[5,10] {c}',
    ],
    [
      '2·[1,2]{c} − 3·[1,2]{c}',
      [
        'Subtract',
        ['Multiply', 2, ['When', ['List', 1, 2], 'c']],
        ['Multiply', 3, ['When', ['List', 1, 2], 'c']],
      ],
      '[-1,-2] {c}',
    ],
    [
      'sin([1,2]{c}) + cos([1,2]{c})',
      [
        'Add',
        ['Sin', ['When', ['List', 1, 2], 'c']],
        ['Cos', ['When', ['List', 1, 2], 'c']],
      ],
      '[sin(1) + cos(1),sin(2) + cos(2)] {c}',
    ],
    [
      '2·1{c} + 3·1{c}',
      [
        'Add',
        ['Multiply', 2, ['When', 1, 'c']],
        ['Multiply', 3, ['When', 1, 'c']],
      ],
      '5 {c}',
    ],
    [
      '(2·x{c})·(3·y{d})',
      [
        'Multiply',
        ['Multiply', 2, ['When', 'x', 'c']],
        ['Multiply', 3, ['When', 'y', 'd']],
      ],
      '6x * y {c && d}',
    ],
  ])('%s', (_label, json, expected) => {
    expect(
      engine()
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });

  test('a convex combination of a restricted list of points', () => {
    const ce = engine();
    ce.assign('P', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const G = ['And', ['LessEqual', 0, 't'], ['LessEqual', 't', 1]];
    const e = ce.box([
      'Add',
      ['Multiply', 't', ['When', 'P', G]],
      ['Multiply', ['Subtract', 1, 't'], ['When', 'P', G]],
    ]);
    const r = e.evaluate();
    expect(r.toString()).toBe('[(1, 2),(3, 4)] {0 <= t && t <= 1}');
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(2);
  });
});

describe('Dot and Cross of a vector with restricted or absent cells', () => {
  test('a vector restricted element by element is accepted and stays symbolic', () => {
    const ce = engine();
    const dot = ce.box([
      'Dot',
      ['When', ['List', 1, 2], ['List', ['Less', 0, 't'], ['Less', 't', 0]]],
      ['List', 1, 1],
    ]);
    // It was an `incompatible-type` error: the operand's type,
    // `list<integer | missing>`, has no length and so did not match `vector`.
    // The length is read from the value.
    expect(dot.isValid).toBe(true);
    expect(dot.type.toString()).toBe('number');
    expect(dot.evaluate().toString()).toBe('Dot([1 {0 < t},2 {t < 0}], [1,1])');
    const cross = ce.box([
      'Cross',
      [
        'When',
        ['List', 1, 2, 3],
        ['List', ['Less', 0, 't'], ['Less', 't', 0], ['Equal', 't', 0]],
      ],
      ['List', 1, 1, 1],
    ]);
    expect(cross.isValid).toBe(true);
  });

  test('a restricted vector under one condition', () => {
    const ce = engine();
    const e = ce.box([
      'Dot',
      ['When', ['List', 1, 2, 3], ['Less', 0, 't']],
      ['List', 1, 1, 1],
    ]);
    expect(e.isValid).toBe(true);
    // A number: the product of an absent vector is `NaN`, as it is for a
    // restricted point (`Dot((1, 2){0 < t}, (1, 1))`).
    expect(e.type.toString()).toBe('number');
    expect(e.evaluate().toString()).toBe('6 {0 < t}');
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe('NaN');
  });

  test('an absent cell makes the product NaN', () => {
    const ce = engine();
    // It was an `incompatible-type` error at boxing.
    expect(
      ce
        .box(['Dot', ['List', 1, 'Missing'], ['List', 1, 1]])
        .evaluate()
        .toString()
    ).toBe('NaN');
    expect(
      ce
        .box(['Cross', ['List', 1, 'Missing', 3], ['List', 1, 1, 1]])
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN,NaN]');
    // Unequal lengths are still a dimension error, as for present vectors.
    expect(
      ce
        .box(['Dot', ['List', 1, 'Missing'], ['List', 1, 1, 1]])
        .evaluate()
        .toString()
    ).toContain('incompatible-dimensions');
    expect(
      ce
        .box(['Cross', ['List', 1, 'Missing'], ['List', 1, 1]])
        .evaluate()
        .toString()
    ).toContain('incompatible-dimensions');
  });

  test('a valueless symbol declared as a list of points that may be absent stays symbolic', () => {
    const ce = engine();
    ce.declare('R', 'list<missing | tuple<integer, integer>>');
    // It was an `incompatible-type` error at evaluation.
    expect(
      ce
        .box(['Dot', 'R', ['Tuple', 1, 1]])
        .evaluate()
        .toString()
    ).toBe('Dot(R, (1, 1))');
  });
});

describe('a union element type under a length', () => {
  test('a union of scalars keeps its bare spelling and round-trips', () => {
    const t = parseType('list<(integer | missing)^3>')!;
    // The parser binds the length to the list, so the bare spelling parses
    // back to the same type; consumers match on it, so it is kept.
    expect(typeToString(t)).toBe('list<integer | missing^3>');
    expect(isSubtype(parseType(typeToString(t))!, t)).toBe(true);
    expect(isSubtype(t, parseType(typeToString(t))!)).toBe(true);
  });

  test('a union holding a list is parenthesized so that it parses back', () => {
    const t = parseType('list<(list<(integer | missing)^2> | missing)^2>')!;
    // `list<list<integer | missing^2> | missing^2>` did not parse back to the
    // same type.
    expect(typeToString(t)).toBe(
      'list<(list<integer | missing^2> | missing)^2>'
    );
    expect(isSubtype(parseType(typeToString(t))!, t)).toBe(true);
    expect(isSubtype(t, parseType(typeToString(t))!)).toBe(true);
  });
});
