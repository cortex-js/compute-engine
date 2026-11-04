/**
 * `Missing` is a result only (user decision of 2026-11-02,
 * `docs/ERROR-MODEL.md`, "`Missing` is a result only").
 *
 * - A declared type may not name `missing` (an input, a parameter, a local,
 *   an element). The declaration fails on the channel that the route uses
 *   for an invalid type: `ce.declare` throws, a parameter annotation of a
 *   function literal is an `invalid-type-annotation` error, a `Declare`
 *   statement is an `invalid-type-declaration` error, and Epsil reports a
 *   `type-annotation-error`. The result type of a signature may name it.
 * - `Missing` is produced by a selection with no match, an accessor out of
 *   range and the written symbol. The value of an accessor out of range
 *   follows the domain: `NaN` for a number, a point of `NaN` coordinates
 *   for a point, `Missing` otherwise.
 * - Any operator other than a reader over `Missing` gives `Missing`.
 * - `Undefined` is not an absent spelling any more: it is an unknown symbol.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { SYS_HELPERS } from '../../src/compute-engine/compilation/javascript-runtime';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

const json = (x: unknown) => ce.box(x as any).evaluate().json;

describe('A DECLARED TYPE MAY NOT NAME MISSING', () => {
  test('ce.declare of a symbol throws', () => {
    const e = new ComputeEngine();
    expect(() => e.declare('w', 'real | missing')).toThrow(
      /the type `missing` cannot be declared/
    );
    expect(() => e.declare('xs', 'list<expression | missing>')).toThrow(
      /the type `missing` cannot be declared/
    );
  });

  test('ce.declare of a function signature throws on a parameter', () => {
    const e = new ComputeEngine();
    expect(() => e.declare('f', '(real | missing) -> real')).toThrow(
      /the type `missing` cannot be declared/
    );
  });

  test('the result type of a signature may name missing', () => {
    const e = new ComputeEngine();
    expect(() => e.declare('g', '(real) -> real | missing')).not.toThrow();
  });

  test('a parameter annotation is an invalid-type-annotation error', () => {
    const fn = ce.box([
      'Function',
      'x',
      ['Typed', 'x', "'real | missing'"],
    ]);
    expect(fn.isValid).toBe(false);
    expect(JSON.stringify(fn.json)).toMatch(/invalid-type-annotation/);
  });

  test('a Declare statement is an invalid-type-declaration error', () => {
    expect(
      JSON.stringify(json(['Block', ['Declare', 'q', "'real | missing'", 1], 'q']))
    ).toMatch(/invalid-type-declaration/);
  });

  test('Epsil reports a type-annotation-error', () => {
    const e = new ComputeEngine();
    for (const src of [
      'let x: real | missing = 1\nx',
      'function f(x: real | missing) { x }\nf(1)',
    ]) {
      const r = executeEpsil(e, src);
      expect(r.diagnostics.map((d) => d.message[0])).toContain(
        'type-annotation-error'
      );
    }
  });

  test('a compiled function with such a parameter declines', () => {
    const fn = ce.box([
      'Function',
      ['Add', 'x', 1],
      ['Typed', 'x', "'real | missing'"],
    ]);
    expect(compile(fn, { to: 'javascript' }).success).toBe(false);
  });
});

describe('THE PRODUCERS', () => {
  test('an accessor out of range over points is a NaN point', () => {
    expect(json(['At', ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]], 5])).toEqual(
      ['Tuple', 'NaN', 'NaN']
    );
  });

  test('the same read in compiled JavaScript is a NaN point', () => {
    const fn = ce.box([
      'Function',
      ['At', 'ps', 'i'],
      ['Typed', 'ps', "'list<tuple<real, real>>'"],
      ['Typed', 'i', "'integer'"],
    ]);
    const r = compile(fn, { to: 'javascript' });
    expect(r.success).toBe(true);
    const out = r.run!(
      [
        [1, 2],
        [3, 4],
      ],
      5
    ) as number[];
    expect(out.length).toBe(2);
    expect(out.every((x) => Number.isNaN(x))).toBe(true);
    expect(
      r.run!(
        [
          [1, 2],
          [3, 4],
        ],
        2
      )
    ).toEqual([3, 4]);
  });

  // The element type of the base picks the read at compile time: the code
  // calls `_SYS.atPoint` and tests no type at run time.
  test('a compiled read of a list of points tests no type at run time', () => {
    const e = new ComputeEngine();
    e.declare('ps', 'list<tuple<real, real>>');
    e.declare('i', 'integer');
    for (const expr of [
      ['At', 'ps', 'i'],
      ['First', 'ps'],
      ['Second', 'ps'],
      ['Last', 'ps'],
      ['At', 'ps', ['List', 1, 'i']],
    ]) {
      const r = compile(e.box(expr), { to: 'javascript' });
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.atPoint(');
      expect(r.code).not.toContain('typeof');
    }
    const empty = (expr: unknown) =>
      compile(e.box(expr as any), { to: 'javascript' }).run!({
        ps: [],
        i: 3,
      });
    expect(empty(['First', 'ps'])).toEqual([NaN, NaN]);
    expect(empty(['Last', 'ps'])).toEqual([NaN, NaN]);
    expect(
      compile(e.box(['At', 'ps', ['List', 1, 'i']]), {
        to: 'javascript',
      }).run!({ ps: [[1, 2]], i: 3 })
    ).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  // The shape of the Tycho records of documents mavxszbvzk and njncrg9fkv:
  // a coordinate of a read out of range of a list of points, read twice (so
  // the read is a common subexpression), with the stock lowering of `At` and
  // with a host lowering of `At`. The compiler adds no code to the code of a
  // host handler, so a host that reads a list of points emits
  // `_SYS.atPointNoWrap(base, i, n)`, which gives a point of `n` `NaN`
  // coordinates out of range. Before, the coordinate read threw a `TypeError`
  // on the `undefined` that `_SYS.atNoWrap` gives there.
  test('a coordinate of a read out of range of a point-list input', () => {
    const expr = [
      'Add',
      ['PointY', ['At', 'l', ['Floor', 't']]],
      ['Multiply', 2, ['PointY', ['At', 'l', ['Floor', 't']]]],
    ];
    const l = [
      [1, 2, 3],
      [4, 5, 6],
    ];
    const interpreted = (e: ComputeEngine, t: number) => {
      e.assign('l', e.box(['List', ['Tuple', 1, 2, 3], ['Tuple', 4, 5, 6]]));
      e.assign('t', t);
      return e.box(expr).evaluate().re;
    };
    for (const host of [false, true]) {
      const e = new ComputeEngine();
      const def = e.lookupDefinition('At') as any;
      const stock = def.operator.compile;
      if (host)
        // The elements of `l` are points of 3 coordinates (its declared
        // type), so the handler reads them with `atPointNoWrap`.
        def.operator.compile = (args: any[], c: (x: any) => string) =>
          `_SYS.atPointNoWrap(${c(args[0])}, ${c(args[1])}, 3)`;
      try {
        e.declare('l', 'list<tuple<real, real, real>>');
        e.declare('t', 'real');
        const r = compile(e.box(expr), { to: 'javascript' });
        expect(r.success).toBe(true);
        expect(r.code).not.toContain('typeof');
        expect(r.run!({ l, t: 5 })).toBeNaN();
        expect(r.run!({ l, t: 2 })).toBe(15);
        // The point itself, through a broadcast.
        const p = compile(e.box(['Multiply', 0.5, ['At', 'l', 't']]), {
          to: 'javascript',
        });
        expect(p.run!({ l, t: 9 })).toEqual([NaN, NaN, NaN]);
        expect(p.run!({ l, t: 1 })).toEqual([0.5, 1, 1.5]);
        // The interpreter last: a value assigned to `t` would be read by a
        // later compilation as a constant.
        expect(interpreted(e, 5)).toBeNaN();
        expect(interpreted(e, 2)).toBe(15);
      } finally {
        def.operator.compile = stock;
      }
    }
  });

  // The runtime helper that a host `At` lowering calls for a base whose
  // elements are points: a scalar index and an array index (a gather, or a
  // boolean mask) in one helper, with a point of `NaN` coordinates at each
  // position out of range.
  test('the host helper atPointNoWrap reads a scalar, a gather and a mask', () => {
    const ps = [
      [1, 2],
      [3, 4],
    ];
    const read = SYS_HELPERS.atPointNoWrap;
    expect(read(ps, 2, 2)).toEqual([3, 4]);
    expect(read(ps, 3, 2)).toEqual([NaN, NaN]);
    expect(read(ps, -1, 2)).toEqual([NaN, NaN]);
    expect(read(ps, { re: 1, im: 0 }, 2)).toEqual([1, 2]);
    expect(read(ps, [1, 9], 2)).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
    expect(read(ps, [true, false], 2)).toEqual([[1, 2]]);
    expect(read(ps, [], 2)).toEqual([]);
    expect(read(undefined, [1], 2)).toEqual([[NaN, NaN]]);
    // The interpreter's value of the same gather and mask.
    const e = new ComputeEngine();
    const base = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
    expect(e.box(['At', base, ['List', 1, 9]]).evaluate().json).toEqual([
      'List',
      ['Tuple', 1, 2],
      ['Tuple', 'NaN', 'NaN'],
    ]);
    expect(
      e.box(['At', base, ['List', 'True', 'False']]).evaluate().json
    ).toEqual(['List', ['Tuple', 1, 2]]);
    // Through a host handler of `At`, with a gather index at run time.
    const def = e.lookupDefinition('At') as any;
    const stock = def.operator.compile;
    def.operator.compile = (args: any[], c: (x: any) => string) =>
      `_SYS.atPointNoWrap(${c(args[0])}, ${c(args[1])}, 2)`;
    try {
      e.declare('l', 'list<tuple<real, real>>');
      e.declare('k', 'list<integer>');
      const r = compile(e.box(['At', 'l', 'k']), { to: 'javascript' });
      expect(r.success).toBe(true);
      expect(r.run!({ l: ps, k: [2, 5] })).toEqual([
        [3, 4],
        [NaN, NaN],
      ]);
    } finally {
      def.operator.compile = stock;
    }
  });

  test('a read of a literal list of points inside a user function', () => {
    const e = new ComputeEngine();
    e.declare('u', 'real');
    e.declare('v', 'real');
    const pts = [
      'List',
      ['Tuple', 1, 0, 0],
      ['Tuple', -1, 0, 0],
      ['Tuple', 0, 1, 0],
      ['Tuple', 0, -1, 0],
      ['Tuple', 0, 0, 1],
      ['Tuple', 0, 0, -1],
    ];
    const read = ['At', pts, ['Add', ['Multiply', 6, 'a'], 1]];
    e.declare('C', '(real, real) -> tuple<real, real, real>');
    e.assign(
      'C',
      e.box([
        'Function',
        ['Add', ['Multiply', 0.5, read], ['Multiply', ['Subtract', 'b', 0.5], read]],
        'a',
        'b',
      ])
    );
    const expr = e.box([
      'Add',
      ['PointX', ['C', 'u', 'v']],
      ['PointY', ['C', 'u', 'v']],
    ]);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    for (const [u, v] of [
      [2, 0.3],
      [0, 0.3],
    ]) {
      e.assign('u', u);
      e.assign('v', v);
      const expected = expr.evaluate().re;
      const actual = r.run!({ u, v }) as number;
      if (Number.isNaN(expected)) expect(actual).toBeNaN();
      else expect(actual).toBeCloseTo(expected, 12);
    }
    expect(r.run!({ u: 2, v: 0.3 })).toBeNaN();
    expect(r.run!({ u: 0, v: 0.3 })).toBeCloseTo(0.3, 12);
  });

  test('an accessor out of range over strings is Missing', () => {
    expect(json(['At', ['List', "'a'", "'b'"], 5])).toBe('Missing');
  });

  test('an accessor out of range over numbers is NaN', () => {
    expect(json(['At', ['List', 1, 2], 5])).toBe('NaN');
  });

  test('Coalesce reads an absent read', () => {
    expect(json(['Coalesce', ['At', ['List', 1.5, 2], 99], 0])).toBe(0);
  });
});

describe('AN OPERATOR OVER MISSING', () => {
  test.each([
    [['Add', 'Missing', 2]],
    [['Multiply', 'Missing', 3]],
    [['Sin', 'Missing']],
    [['Negate', 'Missing']],
    [['Power', 'Missing', 2]],
  ])('%j is Missing', (expr) => {
    expect(json(expr)).toBe('Missing');
  });

  test('a comparison over Missing is False', () => {
    expect(json(['Greater', 'Missing', 0])).toBe('False');
  });

  test('a number-theory predicate over Missing is Missing', () => {
    expect(json(['IsPrime', 'Missing'])).toBe('Missing');
  });
});

describe('AN AGGREGATE OVER MISSING', () => {
  test.each([
    [['Max', 1, 'Missing']],
    [['Min', 1, 'Missing']],
    [['Max', ['List', 1, 'Missing']]],
    [['Max', 'NaN', 'Missing']],
    [['Sum', ['List', 1, 'Missing']]],
    [['Sum', ['List', 'Missing']]],
    [['Product', ['List', 2, 'Missing']]],
    [['Product', ['List', 'Missing']]],
    [['Product', 'Missing']],
    [['Sum', 'Missing']],
    [['Mean', ['List', 1, 'Missing']]],
    [['Median', ['List', 1, 'Missing', 3]]],
    [['Quantile', ['List', 1, 'Missing'], 0.5]],
    [['Covariance', ['List', 1, 2, 3], ['List', 1, 'Missing', 3]]],
    [['Norm', ['Tuple', 1, 'Missing']]],
    [['Distance', ['Tuple', 0, 0], ['Tuple', 3, 'Missing']]],
  ])('%j is Missing', (expr) => {
    expect(json(expr)).toBe('Missing');
  });

  test('an aggregate over NaN or over no data stays NaN', () => {
    expect(json(['Max', 1, 'NaN'])).toBe('NaN');
    expect(json(['Mean', ['List']])).toBe('NaN');
  });
});

describe('THE ARITHMETIC METHODS OVER MISSING', () => {
  test('.add(), .mul() and .div() give Missing', () => {
    const m = ce.box('Missing');
    expect(m.add(ce.box(1)).json).toBe('Missing');
    expect(m.mul(ce.box(2)).json).toBe('Missing');
    expect(m.div(ce.box(2)).json).toBe('Missing');
  });

  test.each([
    [['Add', 'Missing', 0]],
    [['Multiply', 1, 'Missing']],
    [['Divide', 1, 'Missing']],
    [['Divide', 'Missing', 2]],
  ])('the canonical form of %j is Missing', (expr) => {
    expect(ce.box(expr).json).toBe('Missing');
  });

  test('a broadcast gives a Missing cell', () => {
    expect(json(['Add', ['List', 1, 'Missing'], 1])).toEqual([
      'List',
      2,
      'Missing',
    ]);
    expect(json(['Multiply', 'Missing', ['List', 1, 2]])).toEqual([
      'List',
      'Missing',
      'Missing',
    ]);
  });
});

describe('THE TYPE OF AN OPERATOR OVER MISSING', () => {
  test.each([
    [['Add', 'Missing', 2]],
    [['Sqrt', 'Missing']],
    [['Multiply', 2, 'Missing']],
  ])('%j is typed missing', (expr) => {
    expect(ce.box(expr).type.toString()).toBe('missing');
  });

  test('a list with a Missing cell keeps a missing cell arm', () => {
    expect(ce.box(['Add', ['List', 1, 'Missing'], 1]).type.toString()).toBe(
      'list<integer | missing^2>'
    );
  });

  // The type follows the value: the coordinate is `Missing`, not `NaN`.
  test.each([
    [['Add', ['Tuple', 1, 'Missing'], ['Tuple', 1, 1]], ['Tuple', 2, 'Missing']],
    [['Multiply', 2, ['Tuple', 1, 'Missing']], ['Tuple', 2, 'Missing']],
  ])('%j has a missing coordinate in its type', (expr, value) => {
    expect(ce.box(expr).type.toString()).toBe('tuple<integer, missing>');
    expect(json(expr)).toEqual(value);
  });

  test('a coordinate that may be absent gains a missing arm', () => {
    const e = new ComputeEngine();
    e.declare('c', 'boolean');
    expect(
      e
        .box(['Add', ['Tuple', 1, ['Which', 'c', 2]], ['Tuple', 1, 1]])
        .type.toString()
    ).toBe('tuple<integer, integer | missing>');
    // A result that is not computed coordinate by coordinate gains the arm.
    expect(
      e.box(['Norm', ['Tuple', 1, 'Missing']]).type.matches('missing')
    ).toBe(false);
    expect(
      e.box(['Norm', ['Tuple', 1, 'Missing']]).type.toString()
    ).toContain('missing');
  });
});

describe('A STORE INTO A DECLARED NAME ACCEPTS MISSING', () => {
  test('ce.assign accepts an absent read where the type takes a present value', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    expect(() =>
      e.assign('s', e.box(['At', ['List', { str: 'a' }], 5]))
    ).not.toThrow();
    expect(e.box('s').evaluate().json).toBe('Missing');
    expect(() => e.assign('s', e.box('Missing'))).not.toThrow();
    // A value that is wrong where it is present is still refused.
    expect(() => e.assign('s', 5)).toThrow(/not compatible/);
  });

  test('the Assign operator and a Declare with a value accept it', () => {
    const e = new ComputeEngine();
    e.declare('s', 'string');
    expect(
      e.box(['Assign', 's', ['At', ['List', { str: 'a' }], 5]]).evaluate().json
    ).toBe('Missing');
    expect(() =>
      e.declare('s2', {
        type: 'string',
        value: e.box(['At', ['List', { str: 'a' }], 5]),
      })
    ).not.toThrow();
  });

  test('a collection or a tuple with Missing cells', () => {
    const e = new ComputeEngine();
    e.declare('l', 'list<string>');
    e.declare('t', 'tuple<integer, integer>');
    expect(() =>
      e.assign('l', e.box(['List', { str: 'a' }, 'Missing']))
    ).not.toThrow();
    expect(() => e.assign('l', e.box(['List', 5, 'Missing']))).toThrow(
      /not compatible/
    );
    expect(() =>
      e.assign(
        't',
        e.box(['Add', ['Tuple', 1, 'Missing'], ['Tuple', 1, 1]]).evaluate()
      )
    ).not.toThrow();
    e.declare('u', 'tuple<string, string>');
    expect(() => e.assign('u', e.box(['Tuple', 2, 'Missing']))).toThrow(
      /not compatible/
    );
  });

  test('a numeric position holds NaN, which `real` refuses and `number` accepts', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real');
    e.declare('n', 'number');
    expect(() => e.assign('x', e.box(['At', ['List', 1, 2], 5]))).toThrow(
      /not compatible/
    );
    expect(() =>
      e.assign('n', e.box(['At', ['List', 1, 2], 5]))
    ).not.toThrow();
  });
});

describe('AN ACCESSOR HAS NO MARKER ARM IN ITS TYPE', () => {
  const e = new ComputeEngine();
  e.declare('ss', 'list<string>');
  e.declare('ys', 'list<real>');
  e.declare('i', 'integer');

  test.each([
    [['At', 'ss', 'i'], 'string'],
    [['At', 'ys', 'i'], 'real'],
    [['First', 'ss'], 'string'],
    [['Last', 'ys'], 'real'],
  ])('%j is typed %s', (expr, type) => {
    expect(e.box(expr).type.toString()).toBe(type);
  });

  test('a read is not proved present by its type', () => {
    // `IsMissing`, `Coalesce` and `AssertPresent` over a read whose
    // operands have no value stay unevaluated: the read may be absent.
    expect(e.box(['IsMissing', ['At', 'ss', 'i']]).evaluate().json).toEqual([
      'IsMissing',
      ['At', 'ss', 'i'],
    ]);
    expect(
      e.box(['Coalesce', ['At', 'ss', 'i'], "'z'"]).evaluate().operator
    ).toBe('Coalesce');
    expect(
      e.box(['AssertPresent', ['At', 'ss', 'i']]).evaluate().operator
    ).toBe('AssertPresent');
  });

  test('the readers still read an absent read', () => {
    const f = new ComputeEngine();
    f.declare('xs', 'list<real>');
    f.assign('xs', f.box(['List', 1.5, 2]));
    expect(f.box(['Coalesce', ['At', 'xs', 99], 0]).evaluate().json).toBe(0);
    expect(
      f.box(['IsMissing', ['At', ['List', "'a'", "'b'"], 5]]).evaluate().json
    ).toBe('True');
  });

  test('compiled JavaScript reads an absent read', () => {
    const coalesce = compile(
      ce.box([
        'Function',
        ['Coalesce', ['At', 'ys', 99], 0],
        ['Typed', 'ys', "'list<real>'"],
      ]),
      { to: 'javascript' }
    );
    expect(coalesce.success).toBe(true);
    expect(coalesce.run!([1.5, 2])).toBe(0);

    const isMissing = compile(
      ce.box([
        'Function',
        ['IsMissing', ['At', ['List', "'a'", "'b'"], 'j']],
        ['Typed', 'j', "'integer'"],
      ]),
      { to: 'javascript' }
    );
    expect(isMissing.success).toBe(true);
    expect(isMissing.run!(5)).toBe(true);
    expect(isMissing.run!(1)).toBe(false);

    const assertPresent = compile(
      ce.box([
        'Function',
        ['AssertPresent', ['At', 'zs', 'j']],
        ['Typed', 'zs', "'list<string>'"],
        ['Typed', 'j', "'integer'"],
      ]),
      { to: 'javascript' }
    );
    expect(assertPresent.success).toBe(true);
    expect(() => assertPresent.run!(['a', 'b'], 5)).toThrow(
      /expected-present/
    );
  });
});

describe('UNDEFINED IS AN UNKNOWN SYMBOL', () => {
  test('it is not read as absent', () => {
    expect(json(['IsMissing', 'Undefined'])).toBe('False');
    expect(json(['Add', 'Undefined', 1])).toEqual(['Add', 'Undefined', 1]);
  });
});

// A read past the end of a list of points is the `NaN` point. The readers
// (`IsMissing`, `Coalesce`, `AssertPresent`, a default) read it as absent,
// as they read `Missing`, in the interpreter and in compiled code
// (`docs/ERROR-MODEL.md`, "`Missing` is a result only").
describe('THE READERS READ A NAN POINT AS ABSENT', () => {
  const e = new ComputeEngine();
  e.declare('ps', 'list<tuple<real, real>>');
  e.assign('ps', e.box(['List', ['Tuple', 1, 2]]));
  e.declare('k', 'integer');
  e.assign('k', 5);

  test('in the interpreter', () => {
    expect(e.box(['IsMissing', ['At', 'ps', 'k']]).evaluate().json).toBe(
      'True'
    );
    expect(e.box(['IsMissing', ['At', 'ps', 1]]).evaluate().json).toBe(
      'False'
    );
    expect(
      e.box(['Coalesce', ['At', 'ps', 9], ['Tuple', 0, 0]]).evaluate().json
    ).toEqual(['Tuple', 0, 0]);
    expect(
      e.box(['Coalesce', ['At', 'ps', 1], ['Tuple', 0, 0]]).evaluate().json
    ).toEqual(['Tuple', 1, 2]);
    const v = e
      .box(['AssertPresent', ['At', ['List', ['Tuple', 1, 2]], 5]])
      .evaluate();
    expect(v.operator).toBe('Error');
    expect(v.toString()).toContain('expected-present');
    // A point with one coordinate that is not `NaN` is present.
    expect(e.box(['IsMissing', ['Tuple', 'NaN', 1]]).evaluate().json).toBe(
      'False'
    );
  });

  const typed = (body: unknown) =>
    e.box([
      'Function',
      body,
      ['Typed', 'qs', "'list<tuple<real, real>>'"],
      ['Typed', 'j', "'integer'"],
    ] as any);

  test('in compiled JavaScript', () => {
    const isMissing = compile(typed(['IsMissing', ['At', 'qs', 'j']]), {
      to: 'javascript',
    });
    expect(isMissing.success).toBe(true);
    expect(isMissing.run!([[1, 2]], 5)).toBe(true);
    expect(isMissing.run!([[1, 2]], 1)).toBe(false);

    const coalesce = compile(
      typed(['Coalesce', ['At', 'qs', 'j'], ['Tuple', 0, 0]]),
      { to: 'javascript' }
    );
    expect(coalesce.success).toBe(true);
    expect(coalesce.run!([[1, 2]], 5)).toEqual([0, 0]);
    expect(coalesce.run!([[1, 2]], 1)).toEqual([1, 2]);

    const assertPresent = compile(typed(['AssertPresent', ['At', 'qs', 'j']]), {
      to: 'javascript',
    });
    expect(assertPresent.success).toBe(true);
    expect(() => assertPresent.run!([[1, 2]], 5)).toThrow(/expected-present/);
    expect(assertPresent.run!([[1, 2]], 1)).toEqual([1, 2]);
  });

  test('the compiled test is chosen from the static type', () => {
    const r = compile(typed(['IsMissing', ['At', 'qs', 'j']]), {
      to: 'javascript',
    });
    expect(r.code).toContain('Number.isNaN(_c[0]) && Number.isNaN(_c[1])');
    expect(r.code).not.toMatch(/typeof|Array\.isArray/);
    const py = compile(typed(['IsMissing', ['At', 'qs', 'j']]), {
      to: 'python',
    });
    expect(py.success).toBe(true);
    expect(py.code).toContain('cmath.isnan(_c[0]) and cmath.isnan(_c[1])');
  });

  test('an absent base of a nested read: interpreter and JavaScript agree', () => {
    const f = new ComputeEngine();
    f.declare('rows', 'list<list<tuple<real, real>>>');
    f.assign('rows', f.box(['List']));
    expect(
      f.box(['IsMissing', ['First', ['First', 'rows']]]).evaluate().json
    ).toBe('True');
    const r = compile(
      f.box([
        'Function',
        ['IsMissing', ['First', ['First', 'xs']]],
        ['Typed', 'xs', "'list<list<tuple<real, real>>>'"],
      ]),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.run!([])).toBe(true);
  });

  // A default fills only an argument that the call leaves out: a `NaN`
  // point supplied at a parameter with a default reaches the body (item
  // 3.4.5 of the CE language release, user decision 2026-11-02).
  test('a NaN point at a parameter with a default reaches the body', () => {
    const Q = ['Function', 'q', ['Optional', 'q', 5]];
    const read = ['At', ['List', ['Tuple', 1, 2]], 5];
    expect(e.box(['Apply', Q, read]).evaluate().json).toEqual([
      'Tuple',
      'NaN',
      'NaN',
    ]);
    const r = compile(typed(['Apply', Q, ['At', 'qs', 'j']]), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(r.run!([[1, 2]], 5)).toEqual([NaN, NaN]);
    expect(r.run!([[1, 2]], 1)).toEqual([1, 2]);
  });
});

// A coordinate of an absent point is `NaN`: a coordinate is a number, as
// `First` and `At` give `NaN` for a read with no element.
describe('A COORDINATE OF AN ABSENT POINT IS NAN', () => {
  test.each(['PointX', 'PointY', 'PointZ'])(
    '%s of a restricted point: the held and the fresh routes agree',
    (op) => {
      const f = new ComputeEngine();
      f.declare('c', 'boolean');
      const held = f.box([op, ['If', 'c', ['Tuple', 1, 2, 3]]]).evaluate();
      f.assign('c', false);
      expect(held.evaluate().json).toBe('NaN');
      expect(
        f.box([op, ['If', 'c', ['Tuple', 1, 2, 3]]]).evaluate().json
      ).toBe('NaN');
    }
  );

  test('PointX(Missing) is NaN, typed nan', () => {
    const f = new ComputeEngine();
    expect(f.box(['PointX', 'Missing']).evaluate().json).toBe('NaN');
    expect(f.box(['PointX', 'Missing']).type.toString()).toBe('nan');
  });
});

// A `NaN` point at a point parameter is accepted, as `NaN` is at a numeric
// parameter, and the body runs with it.
describe('A NAN POINT AT A POINT PARAMETER', () => {
  const f = new ComputeEngine();
  const F = ['Function', ['PointX', 'p'], ['Typed', 'p', "'tuple<real, real>'"]];

  test('a read out of range: the body runs', () => {
    expect(
      f.box(['Apply', F, ['At', ['List', ['Tuple', 1, 2]], 5]]).evaluate().json
    ).toBe('NaN');
    expect(
      f.box(['Apply', F, ['At', ['List', ['Tuple', 1, 2]], 1]]).evaluate().json
    ).toBe(1);
  });

  test('a written NaN point: the body runs', () => {
    expect(
      f.box(['Apply', F, ['Tuple', 'NaN', 'NaN']]).evaluate().json
    ).toBe('NaN');
  });

  test('the scalar NaN is still refused', () => {
    expect(f.box(['Apply', F, 'NaN']).evaluate().toString()).toContain(
      'incompatible-type'
    );
  });
});

// `Norm`, `Dot` and `Distance` over a list of points give `NaN` for a
// false restricted point, which is the point of `NaN` coordinates, and
// `Missing` for a written `Missing` point; the type of the result cell
// holds both.
describe('A NUMBER COMPUTED FROM AN ABSENT POINT OF A LIST', () => {
  const P = [
    'List',
    ['If', ['Greater', 'a', 0], ['Tuple', 1, 2]],
    ['Tuple', 3, 4],
  ];
  test.each([
    [['Norm', P], 'list<missing | number>', ['List', 'NaN', 5]],
    [
      ['Distance', P, ['Tuple', 0, 0]],
      'list<missing | number>',
      ['List', 'NaN', 5],
    ],
    [['Dot', P, P], 'list<integer | missing>', ['List', 'NaN', 25]],
  ])('%j', (expr, type, value) => {
    const f = new ComputeEngine();
    f.declare('a', 'real');
    expect(f.box(expr as any).type.toString()).toBe(type);
    f.assign('a', -1);
    expect(f.box(expr as any).evaluate().json).toEqual(value);
  });

  test('a written Missing point', () => {
    const e = ce.box(['Norm', ['List', ['Tuple', 3, 4], 'Missing']]);
    expect(e.type.toString()).toBe('list<missing | number>');
    expect(e.evaluate().json).toEqual(['List', 5, 'Missing']);
  });
});

// A default fills only an argument that the call leaves out (item 3.4.5 of
// the CE language release, user decision 2026-11-02): an absent argument
// supplied at a parameter with a default reaches the call, which is
// `Missing`.
test('an absent argument at a parameter with a default', () => {
  const f = new ComputeEngine();
  f.declare('g', 'function');
  f.assign(
    'g',
    f.box(['Function', 'x', ['Optional', ['Typed', 'x', "'integer'"], 2]])
  );
  const e = f.box(['g', ['First', ['List']]]);
  expect(e.type.toString()).toBe('missing');
  expect(e.evaluate().json).toBe('Missing');
  expect(f.box(['g']).evaluate().json).toBe(2);
});

// A read at a position that may not exist is typed as its element, but it
// is `NaN` out of range, so an order comparison over it is not proved.
test('a comparison over a read is not proved from the element type', () => {
  const f = new ComputeEngine();
  f.declare('xs', 'list<integer<1..10>>');
  f.declare('i', 'integer');
  const e = f.box(['Greater', ['At', 'xs', 'i'], 0]);
  expect(e.type.toString()).toBe('boolean');
  expect(e.evaluate().json).toEqual(['Less', 0, ['At', 'xs', 'i']]);
  f.assign('xs', f.box(['List', 1, 2]));
  f.assign('i', 99);
  expect(f.box(['Greater', ['At', 'xs', 'i'], 0]).evaluate().json).toBe(
    'False'
  );
  f.assign('i', 1);
  expect(f.box(['Greater', ['At', 'xs', 'i'], 0]).evaluate().json).toBe(
    'True'
  );
});

// The check that a declared type does not name `missing` reads a signature
// nested in a type by its parameters, not its result, and reads an alias
// through its definition.
describe('A NESTED SIGNATURE IN A DECLARED TYPE', () => {
  test('a parameter that names missing is refused', () => {
    const f = new ComputeEngine();
    expect(() => f.declare('g', 'list<(real | missing) -> real>')).toThrow(
      /the type `missing` cannot be declared/
    );
  });

  test('a result that names missing is accepted', () => {
    const f = new ComputeEngine();
    expect(() =>
      f.declare('g', 'list<(real) -> real | missing>')
    ).not.toThrow();
  });

  test('an alias of a signature with a missing parameter is refused', () => {
    const f = new ComputeEngine();
    f.declareType('fm', '(real | missing) -> real', {
      alias: true,
      mint: false,
    } as any);
    expect(() => f.declare('g', 'fm')).toThrow(/is invalid/);
    expect(() => f.declare('h', 'list<fm>')).toThrow(/is invalid/);
  });
});

// A matrix product reads an absent cell as `NaN` and gives `NaN` cells: the
// type of its cells has a `nan` arm.
test.each([
  [
    [
      'Multiply',
      ['List', ['List', 1, 'Missing'], ['List', 3, 4]],
      ['List', ['List', 1, 0], ['List', 0, 1]],
    ],
    ['List', ['List', 'NaN', 'NaN'], ['List', 3, 4]],
  ],
  [
    ['Multiply', ['List', 1, 'Missing'], ['List', ['List', 1, 2], ['List', 3, 4]]],
    ['List', 'NaN', 'NaN'],
  ],
])('a matrix product with an absent cell: %j', (expr, value) => {
  const e = ce.box(expr as any);
  expect(e.evaluate().json).toEqual(value);
  expect(e.type.toString()).toContain('nan');
});

// The coordinate of an absent point of a list is `NaN`, on the fresh and the
// held routes, and the type of the cell holds it.
test('a coordinate of an absent point cell is NaN', () => {
  const f = new ComputeEngine();
  f.declare('c', 'boolean');
  const E = ['PointY', ['List', ['If', 'c', ['Tuple', 1, 2]], ['Tuple', 3, 4]]];
  const held = f.box(E as any);
  expect(held.type.toString()).toBe('list<integer | nan^2>');
  f.assign('c', false);
  expect(held.evaluate().json).toEqual(['List', 'NaN', 4]);
  expect(f.box(E as any).evaluate().json).toEqual(['List', 'NaN', 4]);
  const W = ce.box(['PointY', ['List', ['Tuple', 1, 2], 'Missing']]);
  expect(W.type.toString()).toBe('list<integer | nan^2>');
  expect(W.evaluate().json).toEqual(['List', 2, 'NaN']);
});

// A point parameter that maps over a list whose cells can be `NaN` points:
// each `NaN` point is accepted, as it is at a direct call, and the body runs
// with it.
describe('A NAN POINT CELL AT A POINT PARAMETER THAT MAPS', () => {
  test('interpreter and compiled JavaScript agree', () => {
    const f = new ComputeEngine();
    f.declare('h', {
      value: [
        'Function',
        ['PointX', 'p'],
        ['Typed', 'p', "'tuple<real, real>'"],
      ],
    } as any);
    f.declare('qs', 'list<tuple<real, real>>');
    f.assign('qs', f.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    const call = f.box(['h', ['At', 'qs', ['Range', 1, 3]]]);
    expect(call.type.toString()).toBe('list<real>');
    expect(call.evaluate().json).toEqual(['List', 1, 3, 'NaN']);
    const r = compile(
      f.box([
        'Function',
        ['h', ['At', 'xs', ['Range', 1, 3]]],
        ['Typed', 'xs', "'list<tuple<real, real>>'"],
      ]),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.run!([[1, 2], [3, 4]])).toEqual([1, 3, NaN]);
  });
});

// A default fills only an argument that the call leaves out (item 3.4.5 of
// the CE language release, user decision 2026-11-02): a `NaN` point supplied
// at a parameter with a default reaches the body, in the interpreter and in
// compiled code. A point default is written as a symbol declared constant
// (`O` below): a default is a number, a string, a boolean, `[]`, `{}`, a
// constant (a library constant or a symbol declared constant) or a symbol
// that the parameter type lists.
describe('A NAN POINT AT A PARAMETER WITH A DEFAULT REACHES THE BODY', () => {
  const f = new ComputeEngine();
  const K = ['Function', 'p', ['Optional', 'p', 5]];
  f.declare('k', { value: K } as any);
  f.declare('qs', 'list<tuple<real, real>>');
  f.assign('qs', f.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
  f.declare('j', 'integer');
  f.assign('j', 9);
  const QS = ['Typed', 'qs', "'list<tuple<real, real>>'"];
  const J = ['Typed', 'j', "'integer'"];
  const run = (body: unknown, params: unknown[], args: unknown[]) => {
    const r = compile(f.box(['Function', body, ...params] as any), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    return r.run!(...(args as any[]));
  };
  const qs = [
    [1, 2],
    [3, 4],
  ];

  test('a named callback of Map', () => {
    const body = ['Map', 'k', ['At', 'qs', ['List', 1, 9]]];
    expect(f.box(body).evaluate().toString()).toBe('[(1, 2),(NaN, NaN)]');
    expect(run(body, [QS], [qs])).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  test('a literal callback of Map that calls the function', () => {
    const body = [
      'Map',
      ['Function', ['k', 'x'], 'x'],
      ['At', 'qs', ['List', 1, 9]],
    ];
    expect(f.box(body).evaluate().toString()).toBe('[(1, 2),(NaN, NaN)]');
    expect(run(body, [QS], [qs])).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  test('an applied literal', () => {
    const body = ['Apply', K, ['At', 'qs', 'j']];
    expect(f.box(body).evaluate().json).toEqual(['Tuple', 'NaN', 'NaN']);
    expect(run(body, [QS, J], [qs, 9])).toEqual([NaN, NaN]);
    expect(run(body, [QS, J], [qs, 2])).toEqual([3, 4]);
  });

  test('a local that holds a point read out of range', () => {
    const body = ['Block', ['Assign', 'pp', ['At', 'qs', 'j']], ['k', 'pp']];
    expect(f.box(body).evaluate().json).toEqual(['Tuple', 'NaN', 'NaN']);
    expect(run(body, [QS, J], [qs, 9])).toEqual([NaN, NaN]);
    expect(run(body, [QS, J], [qs, 2])).toEqual([3, 4]);
  });

  test('the root literal fills only a left-out argument', () => {
    const fn = f.box(K as any);
    expect(
      f.box(['Apply', fn, ['Tuple', 'NaN', 'NaN']]).evaluate().json
    ).toEqual(['Tuple', 'NaN', 'NaN']);
    const r = compile(fn, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('Number.isNaN');
    expect(r.run!([NaN, NaN])).toEqual([NaN, NaN]);
    expect(r.run!([3, 4])).toEqual([3, 4]);
    expect((r.run as () => unknown)()).toBe(5);
  });

  // A point default: the symbol `O`, declared constant. A left-out argument
  // receives `O`; a supplied `NaN` point reaches the body. Compiled code
  // does not fill a default that names a constant that the host declares
  // (it would read `O` by its name where the default is filled), so each
  // compilation that fills it declines.
  const declines = (body: unknown, params: unknown[]) => {
    const r = compile(f.box(['Function', body, ...params] as any), {
      to: 'javascript',
    });
    expect(r.success).toBe(false);
  };
  f.declare('O', {
    type: 'tuple<real, real>',
    value: ['Tuple', 0, 0],
    isConstant: true,
  });
  const G = ['Function', ['PointX', 'p'], ['Optional', 'p', 'O']];
  f.declare('g', { value: G } as any);

  test('a point default: a named callback of Map', () => {
    const body = ['Map', 'g', ['At', 'qs', ['List', 1, 9]]];
    expect(f.box(body).evaluate().toString()).toBe('[1,NaN]');
    declines(body, [QS]);
  });

  test('a point default: an applied literal', () => {
    const body = ['Apply', G, ['At', 'qs', 'j']];
    expect(f.box(body).evaluate().json).toBe('NaN');
    declines(body, [QS, J]);
  });

  test('a point default: a named call that leaves out the argument', () => {
    expect(f.box(['g']).evaluate().json).toBe(0);
    expect(run(['g'], [], [])).toBe(0);
  });

  test('a point default: the root literal fills only a left-out argument', () => {
    const fn = f.box(G as any);
    expect(fn.isValid).toBe(true);
    expect(f.box(['Apply', fn]).evaluate().json).toBe(0);
    expect(
      f.box(['Apply', fn, ['Tuple', 'NaN', 'NaN']]).evaluate().json
    ).toBe('NaN');
    expect(compile(fn, { to: 'javascript' }).success).toBe(false);
  });
});

// `AssertPresent` of a point whose coordinates can all be `NaN` tests it on
// the point axis; a point typed `tuple<real, real>` stays proven present.
describe('ASSERTPRESENT OF A POINT THAT MAY BE A NAN POINT', () => {
  test('interpreter and compiled JavaScript agree', () => {
    const f = new ComputeEngine();
    f.declare('P', 'tuple<number, number>');
    f.assign('P', f.box(['Tuple', 'NaN', 'NaN']));
    expect(f.box(['AssertPresent', 'P']).evaluate().toString()).toContain(
      'expected-present'
    );
    const r = compile(
      f.box([
        'Function',
        ['AssertPresent', 'P'],
        ['Typed', 'P', "'tuple<number, number>'"],
      ]),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(() => r.run!([NaN, NaN])).toThrow(/expected-present/);
    expect(r.run!([1, NaN])).toEqual([1, NaN]);
  });

  test('a point typed tuple<real, real> is tested', () => {
    // An accessor out of range gives a `NaN` point whatever the type of the
    // point says, so no point is proven present.
    const f = new ComputeEngine();
    const r = compile(
      f.box([
        'Function',
        ['AssertPresent', 'P'],
        ['Typed', 'P', "'tuple<real, real>'"],
      ]),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('expected-present');
    expect(r.run!([1, 2])).toEqual([1, 2]);
  });

  describe('a point read out of range', () => {
    const f = new ComputeEngine();
    f.declare('qs', 'list<tuple<real, real>>');
    f.assign('qs', f.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    f.declare('xs', 'list<real>');
    f.assign('xs', f.box(['List', 1, 2]));
    f.declare('j', 'integer');
    f.assign('j', 9);
    const params = [
      ['Typed', 'qs', "'list<tuple<real, real>>'"],
      ['Typed', 'xs', "'list<real>'"],
      ['Typed', 'j', "'integer'"],
    ];
    const check = (body: unknown) => {
      expect(f.box(body as any).evaluate().toString()).toContain(
        'expected-present'
      );
      const r = compile(f.box(['Function', body, ...params] as any), {
        to: 'javascript',
      });
      expect(r.success).toBe(true);
      const qs = [
        [1, 2],
        [3, 4],
      ];
      expect(() => r.run!(qs, [1, 2], 9)).toThrow(/expected-present/);
      return r;
    };

    test('through a local', () => {
      const r = check([
        'Block',
        ['Assign', 'pp', ['At', 'qs', 'j']],
        ['AssertPresent', 'pp'],
      ]);
      expect(r.run!([[1, 2]], [1, 2], 1)).toEqual([1, 2]);
    });

    test('a tuple of two numbers read out of range', () => {
      const r = check([
        'AssertPresent',
        ['Tuple', ['At', 'xs', 'j'], ['At', 'xs', 'j']],
      ]);
      expect(r.run!([[1, 2]], [1, 2], 2)).toEqual([2, 2]);
    });

    test('in a callback of Map', () => {
      check([
        'Map',
        ['Function', ['AssertPresent', 'x'], 'x'],
        ['At', 'qs', ['List', 1, 9]],
      ]);
    });
  });
});

// A default of the declared signature fills only an argument that the call
// leaves out (item 3.4.5 of the CE language release, user decision
// 2026-11-02): a supplied absent argument at the numeric parameter reaches
// the call, which is typed `missing` and gives `Missing`.
describe('A DECLARED DEFAULT AT A NUMERIC PARAMETER', () => {
  test('a supplied absent argument: the call is typed missing', () => {
    const f = new ComputeEngine();
    f.declare('g', '(integer, integer = 2) -> integer');
    f.assign('g', f.box(['Function', ['Add', 'x', 'k'], 'x', 'k']));
    const call = f.box(['g', 1, ['First', ['List']]]);
    expect(call.type.toString()).toBe('missing');
    expect(call.evaluate().json).toBe('Missing');
    expect(f.box(['g', 1]).evaluate().json).toBe(3);
  });
});

// A default of the function literal fills only an argument that the call
// leaves out: a supplied absent argument at the declared numeric parameter
// gives `Missing`, synchronously and asynchronously, whether the function is
// held as a value or as an operator definition.
describe('A LITERAL DEFAULT AT A DECLARED NUMERIC PARAMETER', () => {
  const D = ['Function', 'k', ['Optional', 'k', 2]];
  test('the function is held as a value', async () => {
    const f = new ComputeEngine();
    f.declare('g', '(number) -> number');
    f.assign('g', f.box(D as any));
    const call = f.box(['g', ['First', ['List']]]);
    expect(call.type.toString()).toBe('missing');
    expect(call.evaluate().json).toBe('Missing');
    expect((await call.evaluateAsync()).json).toBe('Missing');
  });

  test('the function is an operator definition', async () => {
    const f = new ComputeEngine();
    f.declare('g', {
      signature: '(number) -> number',
      evaluate: f.box(D as any),
    });
    const call = f.box(['g', ['First', ['List']]]);
    expect(call.evaluate().json).toBe('Missing');
    expect((await call.evaluateAsync()).json).toBe('Missing');
  });
});

// A function literal under a declared signature, held as an operator
// definition, gives `Missing` for an absent argument at a numeric parameter
// without running its body, as it does when it is held as a value.
describe('AN ABSENT ARGUMENT AT A NUMERIC PARAMETER OF AN OPERATOR', () => {
  const setup = (): ComputeEngine => {
    const f = new ComputeEngine();
    f.declare('g', {
      signature: '(number) -> unknown',
      evaluate: f.box(['Function', 7, 'x']),
    });
    f.declare('u', 'unknown');
    return f;
  };
  test('an argument that evaluates to Missing', async () => {
    const f = setup();
    const call = f.box(['g', 'u']);
    f.assign('u', f.box('Missing'));
    expect(call.evaluate().json).toBe('Missing');
    expect((await call.evaluateAsync()).json).toBe('Missing');
  });

  test('a present argument runs the body', async () => {
    const f = setup();
    const call = f.box(['g', 'u']);
    f.assign('u', 3);
    expect(call.evaluate().json).toBe(7);
    expect((await call.evaluateAsync()).json).toBe(7);
  });
});

// A false restriction of a point is the point of `NaN` coordinates, the
// absent value of the domain of a point (user decision of 2026-11-03), on the
// held route (the restriction is held while `t` is free, then `t` is
// assigned), on the fresh route (`t` is assigned first) and in compiled
// JavaScript. A restriction whose arm is a list stays `Missing`.
describe('A FALSE RESTRICTION OF A POINT IS A NAN POINT', () => {
  const C = ['Less', 't', 0];
  const L = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
  const routes = (json: unknown) => {
    const held = new ComputeEngine();
    const e = held.box(json as any);
    const h = e.evaluate();
    held.assign('t', 1);
    const fresh = new ComputeEngine();
    fresh.assign('t', 1);
    const r = compile(
      new ComputeEngine().box([
        'Function',
        json,
        ['Typed', 't', "'real'"],
      ] as any),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    return {
      held: h.evaluate().toString(),
      fresh: fresh.box(json as any).evaluate().toString(),
      js: r.run!(1),
    };
  };

  test.each([
    [
      'the restricted point',
      ['If', C, ['Tuple', 1, 2]],
      '(NaN, NaN)',
      [NaN, NaN],
    ],
    [
      'Sin of it',
      ['Sin', ['If', C, ['Tuple', 0, 1]]],
      '(NaN, NaN)',
      [NaN, NaN],
    ],
    [
      'First of a restricted list of points',
      ['First', ['If', C, L]],
      '(NaN, NaN)',
      [NaN, NaN],
    ],
    ['PointX of it', ['PointX', ['If', C, ['Tuple', 1, 2]]], 'NaN', NaN],
    [
      'IsMissing of it',
      ['IsMissing', ['If', C, ['Tuple', 1, 2]]],
      '"True"',
      true,
    ],
    [
      'Coalesce of it',
      ['Coalesce', ['If', C, ['Tuple', 1, 2]], ['Tuple', 0, 0]],
      '(0, 0)',
      [0, 0],
    ],
    ['a restricted list of points', ['If', C, L], '"Missing"', undefined],
  ])('%s', (_label, json, value, js) => {
    const r = routes(json);
    expect(r.held).toBe(value);
    expect(r.fresh).toBe(value);
    expect(r.js).toEqual(js);
  });

  test('a restricted point cell under a list of conditions', () => {
    const json = ['If', ['List', 'True', C], L];
    const r = routes(json);
    expect(r.held).toBe('[(1, 2),(NaN, NaN)]');
    expect(r.fresh).toBe('[(1, 2),(NaN, NaN)]');
    expect(r.js).toEqual([
      [1, 2],
      [NaN, NaN],
    ]);
  });

  test('compiled Python spells it as a tuple of nan', () => {
    const r = compile(
      ce.box(['Function', ['If', C, ['Tuple', 1, 2]], 't'] as any),
      { to: 'python' }
    );
    expect(r.success).toBe(true);
    expect(r.code).toContain('(np.nan, np.nan)');
  });
});

// A default fills only an argument that the call leaves out (item 3.4.5 of
// the CE language release, user decision 2026-11-02): an absent argument
// supplied at a parameter, with or without a default, reaches the body.
// `.evaluate()`, `.N()` and compiled code, which folds the constant inputs
// with `.N()`, agree on the value of the body.
describe('AN ABSENT ARGUMENT REACHES THE BODY UNDER N()', () => {
  const f = new ComputeEngine();
  f.declare('qs', 'list<tuple<real, real>>');
  f.assign('qs', f.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
  f.declare('j', 'integer');
  f.assign('j', 9);
  f.declare('L', 'list<real>');
  f.assign('L', f.box(['List', 1.5, 2.5]));
  f.declare('g', {
    value: [
      'Function',
      ['Add', ['PointX', 'p'], 'k'],
      'p',
      ['Optional', 'k', 0],
    ],
  } as any);

  test.each([
    [
      'an applied literal',
      [
        'Apply',
        ['Function', ['At', 'p', 'k'], 'p', ['Optional', 'k', 1]],
        ['At', 'qs', 'j'],
      ],
      NaN,
    ],
    ['a named user function', ['g', ['At', 'qs', 'j']], NaN],
    [
      'a jump in the body',
      [
        'Apply',
        ['Function', ['If', ['Less', ['PointX', 'p'], 1], 7, 8], 'p'],
        ['At', 'qs', 'j'],
      ],
      8,
    ],
    [
      'a scalar read out of range at a parameter with a default',
      [
        'Apply',
        ['Function', ['Floor', 'k'], ['Optional', 'k', 2.5]],
        ['At', 'L', 'j'],
      ],
      NaN,
    ],
  ])(
    '%s: evaluate(), N() and compiled code agree',
    async (_label, body, value) => {
      const e = f.box(body as any);
      expect(e.evaluate().re).toBe(value);
      expect(e.N().re).toBe(value);
      expect((await e.evaluateAsync()).re).toBe(value);
      expect(
        (await e.evaluateAsync({ numericApproximation: true })).re
      ).toBe(value);
      const r = compile(f.box(['Function', body] as any), {
        to: 'javascript',
      });
      expect(r.success).toBe(true);
      expect(r.run!()).toBe(value);
    }
  );
});

// A call with fewer arguments than the parameters is a partial application:
// an absent argument at a numeric parameter does not make it `Missing`.
// The result is `Missing` when the other arguments are supplied.
describe('A PARTIAL APPLICATION OVER MISSING', () => {
  const ADD = ['Function', ['Add', 'x', 'y'], 'x', 'y'];

  test('a local declared with a signature', () => {
    const f = new ComputeEngine();
    const call = (head: unknown) =>
      f
        .box([
          'Block',
          ['Declare', 'h', "'(number, number) -> number'", ADD],
          head,
        ] as any)
        .evaluate();
    expect(call(['h', 'Missing']).operator).toBe('Function');
    expect(call(['Apply', ['h', 'Missing'], 2]).json).toBe('Missing');
    expect(call(['Apply', ['h', 3], 2]).json).toBe(5);
  });

  test('an annotated function literal', () => {
    const f = new ComputeEngine();
    const lit = [
      'Function',
      ['Add', 'x', 'y'],
      ['Typed', 'x', "'number'"],
      ['Typed', 'y', "'number'"],
    ];
    const partial = f.box(['Apply', lit, 'Missing'] as any).evaluate();
    expect(partial.operator).toBe('Function');
    expect(f.box(['Apply', partial, 2]).evaluate().json).toBe('Missing');
  });

  test('a global name: a missing argument, as for a present one', () => {
    const f = new ComputeEngine();
    f.declare('h', '(number, number) -> number');
    f.assign('h', f.box(ADD as any));
    expect(f.box(['h', 'Missing']).evaluate().toString()).toBe(
      f.box(['h', 3]).evaluate().toString()
    );
  });
});

// A call that maps a function with a point parameter over a list of points:
// a `NaN` point of the list reaches the body, and a default fills only an
// argument that the call leaves out (item 3.4.5 of the CE language release,
// user decision 2026-11-02). The compiled map gives the same values.
describe('A CALL THAT MAPS OVER POINTS WITH A NAN POINT', () => {
  const f = new ComputeEngine();
  const P = ['Typed', 'p', "'tuple<number, number>'"];
  f.declare('g', { value: ['Function', ['PointX', 'p'], P] } as any);
  f.declare('g2', {
    value: [
      'Function',
      ['Add', ['PointX', 'p'], 'k'],
      P,
      ['Optional', ['Typed', 'k', "'number'"], 5],
    ],
  } as any);
  const QS = ['Typed', 'qs', "'list<tuple<number, number>>'"];
  const K = ['Typed', 'k', "'number'"];
  const L = ['List', ['Tuple', 1, 2], ['Tuple', 'NaN', 'NaN']];
  const qs = [
    [1, 2],
    [NaN, NaN],
  ];

  test.each([
    [['g', 'qs'], [QS], [L], [qs], ['List', 1, 'NaN'], [1, NaN]],
    [['g2', 'qs'], [QS], [L], [qs], ['List', 6, 'NaN'], [6, NaN]],
    [
      ['g2', 'qs', 'k'],
      [QS, K],
      [L, 'NaN'],
      [qs, NaN],
      ['List', 'NaN', 'NaN'],
      [NaN, NaN],
    ],
  ])(
    '%j: interpreter and JavaScript agree',
    (body, params, args, jsArgs, value, compiled) => {
      const fn = ['Function', body, ...params];
      expect(
        f.box(['Apply', fn, ...args] as any).evaluate().json
      ).toEqual(value);
      const r = compile(f.box(fn as any), { to: 'javascript' });
      expect(r.success).toBe(true);
      expect(r.run!(...(jsArgs as any[]))).toEqual(compiled);
    }
  );

  test('a read out of range of the list', () => {
    const g = new ComputeEngine();
    g.declare('h', {
      value: [
        'Function',
        ['PointX', 'p'],
        ['Typed', 'p', "'tuple<real, real>'"],
      ],
    } as any);
    const body = ['h', ['At', 'qs', ['List', 1, 9]]];
    const RQS = ['Typed', 'qs', "'list<tuple<real, real>>'"];
    const qs = ['List', ['Tuple', 1, 2]];
    expect(
      g.box(['Apply', ['Function', body, RQS], qs] as any).evaluate().json
    ).toEqual(['List', 1, 'NaN']);
    const r = compile(g.box(['Function', body, RQS] as any), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(r.run!([[1, 2]])).toEqual([1, NaN]);
  });
});
