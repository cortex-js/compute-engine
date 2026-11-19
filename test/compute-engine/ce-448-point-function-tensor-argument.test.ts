import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * A user function whose parameter is declared as a point
 * (`g: (tuple<real, real>) -> real`) maps a call over a collection of
 * points at every rank: a matrix of points, a list of lists of points, a
 * tensor of points of unknown rank, and a `broadcastable<tuple<…>>` value.
 * The result has the shape of the argument, as `PointX` and `Abs` give over
 * a matrix of points. A `broadcastable<P>` argument types the call
 * `broadcastable<R>`, and a `tensor<P>` argument types it `tensor<R>` (user
 * decision 2026-10-25, ROADMAP CE-448). Before, a matrix of points was an
 * `incompatible-type` error, `g(P)` with `P: broadcastable<tuple<…>>` was
 * typed `list<real> | real`, and `g(T)` with `T: tensor<tuple<…>>` was typed
 * `error`.
 */

const POINT = 'tuple<real, real>';
const MATRIX = [
  'List',
  ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
  ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
];

/** An engine with `g(p) = p.x + 10 p.y`, declared `(tuple<real, real>) ->
 * real`. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', `(${POINT}) -> real`);
  ce.assign(
    'g',
    ce.box([
      'Function',
      ['Add', ['PointX', 'p'], ['Multiply', 10, ['PointY', 'p']]],
      'p',
    ])
  );
  return ce;
}

/** The static type of `g(name)` with `name` declared `decl` and no value. */
function staticType(decl: string): string {
  const ce = engine();
  ce.declare('S', decl);
  return ce.box(['g', 'S']).type.toString();
}

/** The value of `g(name)` with `name` declared `decl` and assigned `value`,
 * and the check that the value matches the static type. */
function valueOf(decl: string, value: unknown): string {
  const type = staticType(decl);
  const ce = engine();
  ce.declare('S', decl);
  ce.assign('S', ce.box(value as any));
  const v = ce.box(['g', 'S']).evaluate();
  expect(v.type.matches(ce.type(type))).toBe(true);
  return v.toString();
}

/** The static type and the value of `g(value)` with the argument written
 * in the call, and the check that the value matches the static type. */
function literal(value: unknown): [string, string] {
  const e = engine().box(['g', value] as any);
  const v = e.evaluate();
  expect(v.type.matches(e.type)).toBe(true);
  return [e.type.toString(), v.toString()];
}

describe('CE-448: a function of a point maps over a tensor of points', () => {
  test('broadcastable<P> types the call broadcastable<R>', () => {
    expect(staticType(`broadcastable<${POINT}>`)).toBe('broadcastable<real>');
  });

  test('a matrix of points in a broadcastable<P> symbol maps at rank 2', () => {
    expect(valueOf(`broadcastable<${POINT}>`, MATRIX)).toBe(
      '[[21,43],[65,87]]'
    );
  });

  test('one point and a list of points in a broadcastable<P> symbol', () => {
    expect(valueOf(`broadcastable<${POINT}>`, ['Tuple', 1, 2])).toBe('21');
    expect(
      valueOf(`broadcastable<${POINT}>`, [
        'List',
        ['Tuple', 1, 2],
        ['Tuple', 3, 4],
      ])
    ).toBe('[21,43]');
    expect(
      valueOf(`broadcastable<${POINT}>`, [
        'List',
        ['List', ['List', ['Tuple', 1, 2]]],
      ])
    ).toBe('[[[21]]]');
  });

  test('tensor<P> is admitted and types the call tensor<R>', () => {
    const ce = engine();
    ce.declare('T', `tensor<${POINT}>`);
    const e = ce.box(['g', 'T']);
    expect(e.isValid).toBe(true);
    expect(e.type.toString()).toBe('tensor<real>');
    expect(valueOf(`tensor<${POINT}>`, MATRIX)).toBe('[[21,43],[65,87]]');
  });

  test('list<list<P>> and matrix<P^(2x2)> type the call list<list<R>>', () => {
    expect(staticType(`list<list<${POINT}>>`)).toBe('list<list<real>>');
    expect(staticType(`matrix<${POINT}^(2x2)>`)).toBe('list<list<real>>');
    expect(valueOf(`list<list<${POINT}>>`, MATRIX)).toBe('[[21,43],[65,87]]');
  });

  test('a literal matrix of points maps, on the box, function and parse routes', () => {
    const ce = engine();
    const boxed = ce.box(['g', MATRIX] as any);
    expect(boxed.type.toString()).toBe('list<list<real>>');
    const v = boxed.evaluate();
    expect(v.toString()).toBe('[[21,43],[65,87]]');
    expect(v.type.matches(boxed.type)).toBe(true);

    const fn = ce.function('g', [ce.box(MATRIX as any)]);
    expect(fn.evaluate().toString()).toBe('[[21,43],[65,87]]');

    const parsed = ce.parse('g([[(1,2),(3,4)],[(5,6),(7,8)]])');
    expect(parsed.type.toString()).toBe('list<list<real>>');
    expect(parsed.evaluate().toString()).toBe('[[21,43],[65,87]]');
  });

  test('a symbol holding a matrix of points maps on the parse route', () => {
    const ce = engine();
    ce.declare('P', `broadcastable<${POINT}>`);
    ce.assign('P', ce.box(MATRIX as any));
    const e = ce.parse('g(P)');
    expect(e.type.toString()).toBe('broadcastable<real>');
    expect(e.evaluate().toString()).toBe('[[21,43],[65,87]]');
  });

  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`, "`Missing`
  // is a result only"), so the absent points below are written in the
  // argument, and its type is inferred.
  test('an argument cannot be declared with absent points', () => {
    expect(() =>
      engine().declare('S', `list<list<${POINT} | missing>>`)
    ).toThrow(/cannot be declared/);
  });

  test('an absent point at depth 2 is a Missing cell, and the type says so', () => {
    const value = [
      'List',
      ['List', ['Tuple', 1, 2], 'Missing'],
      ['List', ['Tuple', 5, 6], ['Tuple', 7, 8]],
    ];
    expect(literal(value)).toEqual([
      'list<list<missing | real>>',
      '[[21,"Missing"],[65,87]]',
    ]);
  });

  test('an absent row is a Missing element of the top list, and the type says so', () => {
    // The `missing` arm is on the rows of the result, not on its cells:
    // the value `["Missing", [21]]` is not a `list<list<real | missing>>`.
    expect(literal(['List', 'Missing', ['List', ['Tuple', 1, 2]]])).toEqual([
      'list<list<real> | missing>',
      '["Missing",[21]]',
    ]);
    // Absent rows and absent points: an arm at each depth.
    expect(
      literal(['List', 'Missing', ['List', 'Missing', ['Tuple', 1, 2]]])
    ).toEqual([
      'list<list<missing | real> | missing>',
      '["Missing",["Missing",21]]',
    ]);
  });

  test('a tensor whose points are all absent maps to Missing cells', () => {
    expect(literal(['List', ['List', 'Missing']])[1]).toBe('[["Missing"]]');
    expect(literal(['List', ['List', 'Missing', 'Missing']])[1]).toBe(
      '[["Missing","Missing"]]'
    );
    // A ragged list: a row of absent points beside a row of points, and
    // beside an absent row.
    expect(
      literal([
        'List',
        ['List', 'Missing'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ])[1]
    ).toBe('[["Missing"],[21,43]]');
    expect(literal(['List', ['List', 'Missing'], 'Missing'])[1]).toBe(
      '[["Missing"],"Missing"]'
    );
  });

  test('another parameter is passed to each point, or paired by rows', () => {
    const ce = new ComputeEngine();
    ce.declare('h', `(${POINT}, real) -> real`);
    ce.assign(
      'h',
      ce.box([
        'Function',
        [
          'Add',
          ['PointX', 'p'],
          ['Multiply', 10, ['PointY', 'p']],
          ['Multiply', 100, 't'],
        ],
        'p',
        't',
      ])
    );
    const one = ce.box(['h', MATRIX, 1] as any);
    expect(one.evaluate().toString()).toBe('[[121,143],[165,187]]');
    const rows = ce.box(['h', MATRIX, ['List', 1, 2]] as any);
    const v = rows.evaluate();
    expect(v.toString()).toBe('[[121,143],[265,287]]');
    expect(v.type.matches(rows.type)).toBe(true);
  });
});

describe('CE-448: a compiled call that maps one level only fails closed', () => {
  test('a list of points at an unknown-paired call declines', () => {
    const engine = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.assign(
        'h',
        ce.box([
          'Function',
          ['Add', ['At', 'p', 1], 's'],
          ['Typed', 'p', `'${POINT}'`],
          's',
        ])
      );
      return ce;
    };
    // `L` and `u` are parameters of the root function, with their declared
    // types. With `u: unknown`, the call pairs the points of `L` with a
    // value whose shape is known only at run time: the call declines.
    const root = (uType: string) =>
      engine().box([
        'Function',
        ['h', 'L', 'u'],
        ['Typed', 'L', { str: `list<${POINT}>` }],
        ['Typed', 'u', { str: uType }],
      ]);
    const unknown = compile(root('unknown'), {} as any) as any;
    expect(unknown.success).toBe(false);
    // The interpreter pairs point `i` with element `i` of a list, and reuses
    // a number for each point.
    const v = engine();
    const P = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    expect(
      v
        .box(['h', P, ['List', 10, 20]] as any)
        .evaluate()
        .toString()
    ).toBe('[11,23]');
    expect(
      v
        .box(['h', P, 5] as any)
        .evaluate()
        .toString()
    ).toBe('[6,8]');
  });
});

describe('a flat list mapped beside an argument of type unknown declines', () => {
  // `(L, u) ↦ h(L, u)`: at `u = [10, 20]` the interpreter zips the lists
  // (`[11, 22]`); the static type `unknown` of `u` settles no shape (R3).
  test.each([['h(s, t) := s + t', ['Function', ['Add', 's', 't'], 's', 't']]])(
    '%s',
    (_, h) => {
      const ce = new ComputeEngine();
      ce.declare('h', 'function');
      ce.assign('h', ce.box(h as never));
      const root = ce.box([
        'Function',
        ['h', 'L', 'u'],
        ['Typed', 'L', "'list<real>'"],
        'u',
      ] as never);
      let message: string | undefined;
      try {
        compile(root, { fallback: false } as never);
      } catch (x) {
        message = (x as { diagnostic?: { message: string } }).diagnostic
          ?.message;
      }
      expect(message).toMatch(/beside a list that the call maps over/);
    }
  );
});
