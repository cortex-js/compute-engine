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
    expect(() => engine().declare('S', `list<list<${POINT} | missing>>`)).toThrow(
      /cannot be declared/
    );
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

describe('CE-448: the compiled call maps over a tensor of points', () => {
  const run = (decl: string) => {
    const ce = engine();
    const r = compile(
      ce.box(['Function', ['g', 'w'], ['Typed', 'w', `'${decl}'`]] as any),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    return r.run as (w: unknown) => unknown;
  };
  const RANK2 = [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [5, 6],
      [7, 8],
    ],
  ];

  test('broadcastable<P>: one point, a list of points, a matrix of points', () => {
    const f = run(`broadcastable<${POINT}>`);
    expect(f([1, 2])).toBe(21);
    expect(
      f([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([21, 43]);
    expect(f(RANK2)).toEqual([
      [21, 43],
      [65, 87],
    ]);
  });

  test('tensor<P> and list<list<P>>', () => {
    expect(run(`tensor<${POINT}>`)(RANK2)).toEqual([
      [21, 43],
      [65, 87],
    ]);
    expect(run(`list<list<${POINT}>>`)(RANK2)).toEqual([
      [21, 43],
      [65, 87],
    ]);
  });
});

describe('CE-448: a compiled call that maps one level only fails closed', () => {
  const RANK2 = [
    [
      [1, 2],
      [3, 4],
    ],
    [
      [5, 6],
      [7, 8],
    ],
  ];

  test('a tensor of points paired with an argument at an unknown parameter', () => {
    // `h := (p: tuple<real, real>, s) ↦ p[1] + s`: the interpreter maps to
    // the points and pairs a list `u` with the rows. The compiled call
    // paired one level only and gave each row whole to `h`
    // (`["101,2", "205,6"]` for `u = [10, 20]`).
    const ce = new ComputeEngine();
    ce.declare('M', `matrix<${POINT}^(2x2)>`);
    ce.declare('u', 'unknown');
    ce.assign(
      'h',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], 's'],
        ['Typed', 'p', `'${POINT}'`],
        's',
      ])
    );
    const e = ce.box(['h', 'M', 'u']);
    expect(() => compile(e, { fallback: false } as any)).toThrow(
      /tensor of points of rank 2 or more.*pairs one level only/
    );

    const v = new ComputeEngine();
    v.assign(
      'h',
      v.box([
        'Function',
        ['Add', ['At', 'p', 1], 's'],
        ['Typed', 'p', `'${POINT}'`],
        's',
      ])
    );
    expect(
      v
        .box(['h', MATRIX, ['List', 10, 20]] as any)
        .evaluate()
        .toString()
    ).toBe('[[11,13],[25,27]]');
    expect(
      v
        .box(['h', MATRIX, 5] as any)
        .evaluate()
        .toString()
    ).toBe('[[6,8],[10,12]]');
  });

  test('a list of points at an unknown-paired call declines; a typed pair compiles', () => {
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
    // value whose shape is known only at run time: the call declines, and
    // names `u`.
    const root = (uType: string) =>
      engine().box([
        'Function',
        ['h', 'L', 'u'],
        ['Typed', 'L', { str: `list<${POINT}>` }],
        ['Typed', 'u', { str: uType }],
      ]);
    const unknown = compile(root('unknown'), {} as any) as any;
    expect(unknown.success).toBe(false);
    expect(unknown.unsupported).toContain('u');
    // With `u: real`, the call compiles and agrees with the interpreter: the
    // number is reused for each point. With `u: list<real>`, the call is
    // the static map that pairs point `i` with element `i` of `u`, as the
    // interpreter does; a length mismatch gives `NaN`, the compiled value
    // of the interpreter's `incompatible-dimensions` error.
    const points = [
      [1, 2],
      [3, 4],
    ];
    const scalar = compile(root('real'), { fallback: false } as any) as any;
    expect(scalar.run(points, 5)).toEqual([6, 8]);
    const list = compile(root('list<real>'), { fallback: false } as any) as any;
    expect(list.success).toBe(true);
    expect(list.code).toContain('_SYS.mapFn(');
    expect(list.code).not.toContain('Array.isArray');
    expect(list.run(points, [10, 20])).toEqual([11, 23]);
    expect(list.run(points, [10, 20, 30])).toBeNaN();
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

  /** `g` declared with the bare type `function`, whose literal declares
   * its parameter as a point. */
  function bareFunctionEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Add', ['At', 'p', 1], ['At', 'p', 2]],
        ['Typed', 'p', `'${POINT}'`],
      ])
    );
    return ce;
  }

  test.each([
    [`broadcastable<${POINT}>`, RANK2[0], '[3,7]'],
    [`broadcastable<${POINT}>`, RANK2, '[[3,7],[11,15]]'],
    [`matrix<${POINT}^(2x2)>`, RANK2, '[[3,7],[11,15]]'],
    [`list<list<${POINT}>>`, RANK2, '[[3,7],[11,15]]'],
    [`tensor<${POINT}>`, RANK2, '[[3,7],[11,15]]'],
    [`list<${POINT}>`, RANK2[0], '[3,7]'],
  ])(
    'a user function declared `function`, argument %s, maps over the points',
    (decl, value, interpreted) => {
      // The call maps `g` over the points at every depth, as the
      // interpreter does.
      const ce = bareFunctionEngine();
      ce.declare('B', decl);
      const e = ce.box(['g', 'B']);
      const r = compile(e, { fallback: false } as any) as any;
      expect(r.success).toBe(true);
      expect(JSON.stringify(r.run({ B: value }))).toBe(
        interpreted.replace(/\s/g, '')
      );
      // When the declared type gives the rank of the tensor of points
      // (`list<list<P>>`, `matrix<P^(2x2)>`), the call is the static map
      // over that rank, with no run-time test of the value. A type that
      // does not give the rank (`broadcastable<P>`, `tensor<P>`) keeps the
      // run-time walk over the levels.
      if (decl.startsWith('list<list<') || decl.startsWith('matrix<')) {
        expect(r.code).toBe('_SYS.mapFn(_fn_g, [2], _.B)');
      }

      const v = bareFunctionEngine();
      v.declare('B', decl);
      const toBox = (x: any): any =>
        typeof x[0] === 'number' ? ['Tuple', ...x] : ['List', ...x.map(toBox)];
      v.assign('B', v.box(toBox(value)));
      expect(v.box(['g', 'B']).evaluate().toString()).toBe(interpreted);
    }
  );

  test('the Apply of a function literal over a list of points fails closed', () => {
    for (const decl of [
      `list<${POINT}>`,
      `broadcastable<${POINT}>`,
      `matrix<${POINT}^(2x2)>`,
    ]) {
      const ce = new ComputeEngine();
      ce.declare('B', decl);
      const e = ce.box([
        'Apply',
        [
          'Function',
          ['Add', ['At', 'p', 1], ['At', 'p', 2]],
          ['Typed', 'p', `'${POINT}'`],
        ],
        'B',
      ]);
      expect(() => compile(e, { fallback: false } as any)).toThrow(
        /The interpreter maps the call over the points/
      );
    }
  });
});
