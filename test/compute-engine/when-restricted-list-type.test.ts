import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';

// A restriction over a list value, `When(L, c)`, distributes an undecided
// scalar condition into the cells when it is evaluated (`[1,2]{c}` is
// `[1{c}, 2{c}]`), so its type must admit that list of cells as well as the
// whole list (condition true) and `Missing` (condition false). The type was
// `missing | vector<integer^2>`, which the list of cells, typed
// `list<integer | missing>`, did not match; every accessor over the restricted
// list inherited the mismatch. (ROADMAP, residues of the Tycho 306–315 round,
// item 4, and item 2 for `Dot`/`Cross` of a vector restricted element by
// element.)

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

/** The static type of `json`, and whether it admits the evaluated value. */
function typeAndValue(ce: ComputeEngine, json: unknown) {
  const e = ce.box(json as never);
  const v = e.evaluate();
  return {
    type: e.type.toString(),
    value: v.toString(),
    valueType: v.type.toString(),
    admitted: isSubtype(v.type.type, e.type.type),
  };
}

describe('the type of a restricted list admits its undecided value', () => {
  test('a list of numbers', () => {
    const r = typeAndValue(engine(), ['When', ['List', 1, 2], 'c']);
    expect(r.type).toBe('list<integer | missing> | missing');
    expect(r.value).toBe('[1 {c},2 {c}]');
    expect(r.valueType).toBe('list<integer | missing>');
    expect(r.admitted).toBe(true);
  });

  test('a list of points', () => {
    const r = typeAndValue(engine(), RL);
    expect(r.type).toBe('list<missing | tuple<integer, integer>> | missing');
    expect(r.admitted).toBe(true);
  });

  test('a matrix is a list of restricted rows', () => {
    const r = typeAndValue(engine(), [
      'When',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      'c',
    ]);
    expect(r.type).toBe('list<list<integer | missing> | missing> | missing');
    expect(r.value).toBe('[[1,2] {c},[3,4] {c}]');
    expect(r.admitted).toBe(true);
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
    const r = typeAndValue(engine(), ['PointX', RL]);
    // Absent as a whole when the condition is false, a list of coordinates
    // that may each be absent while it is undecided.
    expect(r.type).toBe('list<missing | number> | missing');
    expect(r.value).toBe('[1 {0 < t},3 {0 < t}]');
    expect(r.admitted).toBe(true);
  });

  test('Dot, Norm, Distance and a broadcast keep the whole-absence arm', () => {
    const ce = engine();
    const L = ['List', ['Tuple', 1, 1], ['Tuple', 1, 1]];
    for (const json of [
      ['Dot', RL, L],
      ['Norm', RL],
      ['Distance', RL, ['Tuple', 0, 0]],
      ['Sin', ['When', ['List', 1, 2, 3], ['Less', 0, 't']]],
      ['Add', ['When', ['List', 1, 2], ['Less', 0, 't']], 1],
    ]) {
      const e = ce.box(json as never);
      // `Dot` lost the arm before, although it answers `Missing` for an
      // absent list beside a list: it threads its conditional operands whole.
      expect(e.type.toString()).toBe('list<number> | missing');
      ce.assign('t', -1);
      expect(e.evaluate().toString()).toBe('"Missing"');
      ce.assign('t', ce.symbol('t'));
    }
  });

  test('an absent operand beside a list still lands in each cell of a broadcast', () => {
    const ce = engine();
    const e = ce.box(['Add', ['List', 1, 2, 3], ['When', 2, ['Less', 0, 't']]]);
    expect(e.type.toString()).toBe('vector<3>');
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
    // A row is a restricted list; it was `missing | vector<integer^2>`, which
    // did not admit the row `[3{0 < t}, 4{0 < t}]`.
    expect(ce.box(['At', M, 2]).type.toString()).toBe(
      'list<integer | missing> | missing'
    );
    // Two indices reach the cell through the row's union type; it was
    // `unknown`.
    expect(ce.box(['At', M, 2, 1]).type.toString()).toBe(
      'integer | missing | nan'
    );
    expect(ce.box(['At', M, 2, 1]).evaluate().toString()).toBe('3 {0 < t}');
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
