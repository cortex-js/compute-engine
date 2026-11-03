import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A restriction over a list value, `If(c, L)`, stays ONE held restriction while
// its condition is undecided, and presents as a collection of restricted
// cells through its collection handlers (user decision 2026-09-25). Its type
// is the list's own type under the `missing` arm, `missing | vector<integer^2>`
// for `[1,2]{c}`, and every route agrees once the condition is decided: the
// whole list, or `Missing`. Before, the cells were copied into a `List` of
// restrictions, `[1{c}, 2{c}]`, a value typed `list<integer | missing>` that the
// type did not admit, and that re-evaluated to `[Missing, Missing]` once the
// condition failed while a fresh evaluation answered `Missing`. (ROADMAP,
// residues of the Tycho 306–315 round, items 2 and 4.)

const engine = () => {
  const ce = new ComputeEngine();
  ce.declare('c', 'boolean');
  ce.declare('t', 'real');
  return ce;
};

const RL = ['If', ['Less', 0, 't'], ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]];

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
    const r = probe(engine(), ['If', ['Less', 0, 't'], ['List', 1, 2]]);
    expect(r.type).toBe('vector<integer^2>');
    expect(r.value).toBe('If(0 < t, [1,2])');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test('the held form is an indexed collection of restricted cells', () => {
    const ce = engine();
    const r = ce.box(['If', 'c', ['List', 1, 2]]).evaluate();
    expect(r.operator).toBe('If');
    expect(r.isCollection).toBe(true);
    // An INDEXED collection: the broadcast machinery maps over it cell by
    // cell (`Sin(If(0<t, [1,2,3]))` gives three restricted cells).
    expect(r.isIndexedCollection).toBe(true);
    expect(r.count).toBe(2);
    expect(Array.from(r.each()).map((x) => x.toString())).toEqual([
      'If(c, 1)',
      'If(c, 2)',
    ]);
  });

  test('a list of points', () => {
    const r = probe(engine(), RL);
    expect(r.type).toBe('list<tuple<integer, integer>^2>');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
  });

  test('a matrix', () => {
    const r = probe(engine(), [
      'If',
      ['Less', 0, 't'],
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ]);
    expect(r.type).toBe('matrix<integer^(2x2)>');
    expect(r.value).toBe('If(0 < t, [[1,2],[3,4]])');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
  });

  test('a decided condition keeps the whole list or masks it', () => {
    const ce = engine();
    expect(
      ce
        .box(['If', 'True', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(
      ce
        .box(['If', 'False', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('a point, a string and a set are one value each', () => {
    const ce = engine();
    expect(ce.box(['If', 'c', ['Tuple', 1, 2]]).type.toString()).toBe(
      'tuple<integer, integer>'
    );
    expect(ce.box(['If', 'c', { str: 'ab' }]).type.toString()).toBe('string');
    expect(ce.box(['If', 'c', ['Set', 1, 2]]).type.toString()).toBe(
      'set<integer>'
    );
  });
});

describe('the applications over a restricted list follow', () => {
  test('a coordinate accessor', () => {
    const r = probe(engine(), ['PointX', RL]);
    expect(r.type).toBe('vector<integer^2>');
    expect(r.value).toBe('If(0 < t, [1,3])');
    expect(r.admitted).toBe(true);
    expect(r.twoStep).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
  });

  test.each([
    [
      'Dot',
      ['Dot', RL, ['List', ['Tuple', 1, 1], ['Tuple', 1, 1]]],
      'list<integer>',
      '"Missing"',
    ],
    ['Norm', ['Norm', RL], 'list<number>', '"Missing"'],
    [
      'Distance',
      ['Distance', RL, ['Tuple', 0, 0]],
      'list<number>',
      '"Missing"',
    ],
    [
      'Sin',
      ['Sin', ['If', ['Less', 0, 't'], ['List', 1, 2, 3]]],
      'vector<3>',
      '"Missing"',
    ],
    [
      'Add',
      ['Add', ['If', ['Less', 0, 't'], ['List', 1, 2]], 1],
      'vector<integer^2>',
      '"Missing"',
    ],
  ])(
    '%s has the type of its value and both routes agree',
    (_op, json, type, absent) => {
      const r = probe(engine(), json);
      // The type has no `missing` arm. Every application answers `Missing`
      // for an absent list: a restriction with a scalar condition selects
      // the list whole, so `Sin` and `Add` lift its condition over the
      // whole result (selection rule of 2026-11-02), where they mapped the
      // held restriction cell by cell and gave a list of `NaN`.
      expect(r.type).toBe(type);
      expect(r.twoStep).toBe(absent);
      expect(r.fresh).toBe(absent);
    }
  );

  test('an absent operand beside a list still lands in each cell of a broadcast', () => {
    const ce = engine();
    const e = ce.box(['Add', ['List', 1, 2, 3], ['If', ['Less', 0, 't'], 2]]);
    expect(e.type.toString()).toBe('vector<integer^3>');
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe('[NaN,NaN,NaN]');
  });

  test('element access of a restricted matrix', () => {
    const ce = engine();
    const M = [
      'If',
      ['Less', 0, 't'],
      ['List', ['List', 1, 2], ['List', 3, 4]],
    ];
    const row = probe(ce, ['At', M, 2]);
    expect(row.type).toBe('vector<integer^2>');
    expect(row.value).toBe('If(0 < t, [3,4])');
    expect(row.admitted).toBe(true);
    expect(row.twoStep).toBe('"Missing"');
    const cell = probe(ce, ['At', M, 2, 1]);
    // An element read of an absent collection answers the marker of its
    // codomain, `NaN` for a number (user decision 2026-09-25). A result type
    // describes the successful values, so the marker is implicit and the
    // type has no `nan` arm (`docs/ERROR-MODEL.md`, "`Missing` is a result
    // only").
    expect(cell.type).toBe('integer');
    expect(cell.value).toBe('If(0 < t, 3)');
    // A masked NUMBER is `NaN` (user decision 2026-09-25).
    expect(cell.twoStep).toBe('NaN');
    expect(cell.fresh).toBe('NaN');
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
        ['Multiply', 2, ['If', 'c', ['List', 1, 2]]],
        ['Multiply', 3, ['If', 'c', ['List', 1, 2]]],
      ],
      'If(c, [5,10])',
    ],
    [
      '2·[1,2]{c} − 3·[1,2]{c}',
      [
        'Subtract',
        ['Multiply', 2, ['If', 'c', ['List', 1, 2]]],
        ['Multiply', 3, ['If', 'c', ['List', 1, 2]]],
      ],
      'If(c, [-1,-2])',
    ],
    [
      'sin([1,2]{c}) + cos([1,2]{c})',
      [
        'Add',
        ['Sin', ['If', 'c', ['List', 1, 2]]],
        ['Cos', ['If', 'c', ['List', 1, 2]]],
      ],
      'If(c, [sin(1) + cos(1),sin(2) + cos(2)])',
    ],
    [
      '2·1{c} + 3·1{c}',
      ['Add', ['Multiply', 2, ['If', 'c', 1]], ['Multiply', 3, ['If', 'c', 1]]],
      'If(c, 5)',
    ],
    [
      '(2·x{c})·(3·y{d})',
      [
        'Multiply',
        ['Multiply', 2, ['If', 'c', 'x']],
        ['Multiply', 3, ['If', 'd', 'y']],
      ],
      'If(c && d, 6x * y)',
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
      ['Multiply', 't', ['If', G, 'P']],
      ['Multiply', ['Subtract', 1, 't'], ['If', G, 'P']],
    ]);
    const r = e.evaluate();
    // A restriction with a scalar condition is one restriction over the
    // whole list, so its condition is not repeated in each cell.
    expect(r.toString()).toBe('If(0 <= t && t <= 1, [(1, 2),(3, 4)])');
    expect(r.isCollection).toBe(true);
    expect(r.count).toBe(2);
  });
});

describe('Dot and Cross of a vector with restricted or absent cells', () => {
  test('a vector restricted element by element is accepted and stays symbolic', () => {
    const ce = engine();
    const dot = ce.box([
      'Dot',
      ['If', ['List', ['Less', 0, 't'], ['Less', 't', 0]], ['List', 1, 2]],
      ['List', 1, 1],
    ]);
    // It was an `incompatible-type` error: the operand's type,
    // `list<integer | missing>`, has no length and so did not match `vector`.
    // The length is read from the value.
    expect(dot.isValid).toBe(true);
    expect(dot.type.toString()).toBe('number');
    expect(dot.evaluate().toString()).toBe(
      'Dot([If(0 < t, 1),If(t < 0, 2)], [1,1])'
    );
    const cross = ce.box([
      'Cross',
      [
        'If',
        ['List', ['Less', 0, 't'], ['Less', 't', 0], ['Equal', 't', 0]],
        ['List', 1, 2, 3],
      ],
      ['List', 1, 1, 1],
    ]);
    expect(cross.isValid).toBe(true);
  });

  test('a restricted vector under one condition', () => {
    const ce = engine();
    const e = ce.box([
      'Dot',
      ['If', ['Less', 0, 't'], ['List', 1, 2, 3]],
      ['List', 1, 1, 1],
    ]);
    expect(e.isValid).toBe(true);
    // A number: the product of an absent vector is `Missing`, as an
    // operator over `Missing` is (`docs/ERROR-MODEL.md`, "`Missing` is a
    // result only").
    expect(e.type.toString()).toBe('number');
    // The held form keeps `Missing` as its else branch, so that it gives
    // `Missing` once the condition fails, as a fresh evaluation does.
    expect(e.evaluate().toString()).toBe('If(0 < t, 6, "Missing")');
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe('"Missing"');
  });

  test('an absent cell makes the product Missing', () => {
    const ce = engine();
    // It was an `incompatible-type` error at boxing.
    expect(
      ce
        .box(['Dot', ['List', 1, 'Missing'], ['List', 1, 1]])
        .evaluate()
        .toString()
    ).toBe('"Missing"');
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

  test('a union holding a tuple is parenthesized so that it parses back', () => {
    // The cell of a list with dimensions cannot be a list, so the union
    // holds a tuple: `list<missing | tuple<integer, integer>^2>` would not
    // parse back to the same type.
    const t = parseType('list<(tuple<integer, integer> | missing)^2>')!;
    expect(typeToString(t)).toBe('list<(missing | tuple<integer, integer>)^2>');
    expect(isSubtype(parseType(typeToString(t))!, t)).toBe(true);
    expect(isSubtype(t, parseType(typeToString(t))!)).toBe(true);
  });
});

// An element read of a restricted collection whose condition is false
// answers the absence marker of the element's domain (user decision
// 2026-09-25, `docs/ERROR-MODEL.md` §2, rules 4 and 5): `NaN` when the
// element is a number, `Missing` when it is a row, a point or a string.
// Every route agrees: the held form (evaluated while `t` is free, then again
// once `t` is negative), a fresh evaluation, `.N()` and the compiled
// JavaScript. The type of the application has a `nan` arm for a number and a
// `missing` arm otherwise. Before, a fresh evaluation of a number read
// answered `Missing`, while the held form answered `NaN`.
describe('an element read of a restricted collection whose condition is false', () => {
  const W = (x: unknown) => ['If', ['Less', 0, 't'], x];
  const M = W(['List', ['List', 1, 2], ['List', 3, 4]]);

  function routes(json: unknown) {
    const ce = engine();
    const e = ce.box(json as never);
    const held = e.evaluate();
    const code = compile(e, { to: 'javascript' });
    ce.assign('t', -1);
    const js = code.success ? code.run!({ t: -1 } as never) : 'no-compile';
    return {
      type: e.type.toString(),
      held: held.evaluate().toString(),
      fresh: e.evaluate().toString(),
      n: e.N().toString(),
      js,
    };
  }

  test.each([
    ['First of a pair', ['First', W(['Tuple', 1, 2])], 'integer'],
    ['Second of a pair', ['Second', W(['Tuple', 1, 2])], 'integer'],
    ['Last of a list', ['Last', W(['List', 1, 2])], 'integer'],
    ['At of a list', ['At', W(['List', 1, 2]), 1], 'integer'],
    ['At of a matrix, two indices', ['At', M, 2, 1], 'integer'],
  ])('%s is NaN', (_label, json, type) => {
    const r = routes(json);
    expect(r.type).toBe(type);
    expect(r.held).toBe('NaN');
    expect(r.fresh).toBe('NaN');
    expect(r.n).toBe('NaN');
    // `Last` and the two-index `At` do not compile for this operand; the
    // compiled routes that exist answer `NaN`.
    if (r.js !== 'no-compile') expect(r.js).toBeNaN();
  });

  test.each([
    ['a row of a matrix', ['At', M, 2], 'vector<integer^2>'],
    ['a string', ['First', W(['List', { str: 'a' }])], 'string'],
  ])('%s is Missing', (_label, json, type) => {
    const r = routes(json);
    expect(r.type).toBe(type);
    expect(r.held).toBe('"Missing"');
    expect(r.fresh).toBe('"Missing"');
    expect(r.n).toBe('"Missing"');
    // `undefined` is the run-time spelling of `Missing`.
    expect(r.js).toBeUndefined();
  });

  // A read of a point gives the absent value of the domain of a point, the
  // point of `NaN` coordinates (user decision 2026-11-03).
  test.each([
    [
      'a point of a list of points',
      ['First', W(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]])],
      'tuple<integer, integer>',
    ],
    [
      'a point of a list of points, by At',
      ['At', W(['List', ['Tuple', 1, 2]]), 1],
      'tuple<integer, integer>',
    ],
  ])('%s is a NaN point', (_label, json, type) => {
    const r = routes(json);
    expect(r.type).toBe(type);
    expect(r.held).toBe('(NaN, NaN)');
    expect(r.fresh).toBe('(NaN, NaN)');
    expect(r.n).toBe('(NaN, NaN)');
    expect(r.js).toEqual([NaN, NaN]);
  });

  test('an absent operand of unknown type is Missing', () => {
    const r = routes(['First', 'Missing']);
    expect(r.fresh).toBe('"Missing"');
    expect(r.n).toBe('"Missing"');
    expect(r.js).toBeUndefined();
  });

  test('an out-of-range read of a list of numbers is NaN', () => {
    const r = routes(['At', ['List', 1, 2], 5]);
    expect(r.fresh).toBe('NaN');
    expect(r.js).toBeNaN();
  });
});

// A restriction with a scalar condition selects its list whole. Only an
// operand that the call maps element by element lifts the condition over the
// call. A user function whose parameter takes the list whole (an unannotated
// parameter, a default value) receives the selection, the list or `Missing`,
// and its body decides the value.
describe('a user function applied to a restricted list', () => {
  const R = ['If', ['Less', 0, 't'], ['List', 1, 2]];
  const values = async (fn: unknown) => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.assign('f', fn as never);
    const e = ce.box(['f', R] as never);
    ce.assign('t', 1);
    const present = e.evaluate().toString();
    ce.assign('t', -1);
    return {
      present,
      absent: e.evaluate().toString(),
      absentAsync: (await e.evaluateAsync()).toString(),
    };
  };

  test('a parameter that discharges absence receives Missing', async () => {
    const r = await values([
      'Function',
      ['Coalesce', 'xs', ['List', 0]],
      'xs',
    ]);
    expect(r.present).toBe('[1,2]');
    expect(r.absent).toBe('[0]');
    expect(r.absentAsync).toBe('[0]');
  });

  test('a parameter with a default value receives Missing', async () => {
    const r = await values(['Function', ['Add', 'x', 1], ['Optional', 'x', 5]]);
    expect(r.present).toBe('[2,3]');
    expect(r.absent).toBe('6');
    expect(r.absentAsync).toBe('6');
  });

  test('a scalar parameter maps the list and lifts the condition', async () => {
    const r = await values([
      'Function',
      ['Add', 'x', 1],
      ['Typed', 'x', "'real'"],
    ]);
    expect(r.present).toBe('[2,3]');
    expect(r.absent).toBe('"Missing"');
    expect(r.absentAsync).toBe('"Missing"');
  });

  // With the condition undecided, the call keeps the held restriction as
  // its operand. A two-branch `If(c, f([1, 2]), f(Missing))` would not
  // present as a collection.
  test('an undecided condition is not split into a two-branch If', async () => {
    const ce = new ComputeEngine();
    ce.assign('f', [
      'Function',
      ['Coalesce', 'xs', ['List', 0]],
      'xs',
    ] as never);
    const e = ce.box(['f', R] as never);
    for (const v of [e.evaluate(), await e.evaluateAsync()]) {
      expect(v.operator === 'If' && v.nops === 3).toBe(false);
      expect(v.isCollection).toBe(true);
    }
  });

  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
  // "`Missing` is a result only"): a parameter typed `real | missing` is an
  // invalid type annotation.
  test('a parameter typed real | missing is a static error', () => {
    const fn = new ComputeEngine().box([
      'Function',
      ['Coalesce', 'x', 0],
      ['Typed', 'x', "'real | missing'"],
    ] as never);
    expect(fn.isValid).toBe(false);
    expect(JSON.stringify(fn.json)).toContain('invalid-type-annotation');
  });

  // The lifted call is evaluated with the options of the caller, in the
  // synchronous and in the asynchronous route.
  test('a lifted call keeps the evaluate options', async () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.assign('n', 3);
    const e = ce.box([
      'Sin',
      ['If', ['Greater', 'n', 0], ['Range', 1, 5]],
    ] as never);
    const sync = e.evaluate({ materialization: true }).toString();
    const async = (await e.evaluateAsync({ materialization: true })).toString();
    expect(sync).toBe(async);
    expect(sync).toBe('[sin(1),sin(2),sin(3),sin(4),sin(5)]');
  });

  // A condition that is a guard at a lifted position (`x`) and a selection
  // at another (`ys`) is evaluated once: the two positions agree, so the
  // value is the whole result or `Missing`, never `x + 100`, which needs a
  // draw below 0.5 for `x` and a draw of 0.5 or more for `ys`.
  test('a condition that is a guard and a selection is evaluated once', async () => {
    const ce = new ComputeEngine();
    ce.assign('g', [
      'Function',
      ['Add', 'x', ['If', ['IsMissing', 'ys'], 100, 0]],
      ['Typed', 'x', "'real'"],
      'ys',
    ] as never);
    const c = ['Less', ['Random'], 0.5];
    const e = ce.box([
      'g',
      ['If', c, ['List', 1, 2]],
      ['If', c, ['List', 5, 6]],
    ] as never);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(e.evaluate().toString());
    for (let i = 0; i < 20; i++) seen.add((await e.evaluateAsync()).toString());
    for (const v of seen) expect(['[1,2]', '"Missing"']).toContain(v);
  });

  // With the condition undecided, the lifted call is the held restriction
  // over the evaluated call, which presents as a collection.
  test('a lifted call with an undecided condition is held', async () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    const e = ce.box(['Sin', R] as never);
    for (const v of [e.evaluate(), await e.evaluateAsync()]) {
      expect(v.toString()).toBe('If(0 < t, [sin(1),sin(2)])');
      expect(v.isCollection).toBe(true);
    }
  });

  // A condition whose type admits a list of booleans can be a mask at run
  // time: the restriction is neither lifted nor selected whole.
  test('a condition typed boolean | list<boolean> is not selected whole', async () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'boolean | list<boolean>');
    ce.assign('c', ['List', 'True', 'False'] as never);
    ce.assign('g', ['Function', ['Length', 'xs'], 'xs'] as never);
    const e = ce.box(['g', ['If', 'c', ['List', 1, 2]]] as never);
    expect(e.evaluate().toString()).toBe('2');
    expect((await e.evaluateAsync()).toString()).toBe('2');
  });

  // A declared function with a string parameter does not propagate an
  // absent argument: the call receives `Missing` and gives what
  // `h(Missing)` gives, not a `Missing` lifted over the call.
  test('a declared function that does not propagate receives Missing', async () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.declare('h', '(string) -> string');
    ce.assign('h', ['Function', ['Coalesce', 's', "'none'"], 's'] as never);
    const direct = ce.box(['h', 'Missing']).evaluate().toString();
    const e = ce.box([
      'h',
      ['If', ['Less', 0, 't'], ['List', "'a'", "'b'"]],
    ] as never);
    ce.assign('t', -1);
    expect(e.evaluate().toString()).toBe(direct);
    expect((await e.evaluateAsync()).toString()).toBe(direct);
    expect(direct).not.toBe('"Missing"');
  });
});
