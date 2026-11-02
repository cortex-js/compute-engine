import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { MAX_SIZE_EAGER_COLLECTION } from '../../src/compute-engine/collection-utils';
import { isSubtype } from '../../src/common/type/subtype';

/**
 * A call of a user function with a point parameter, over a list argument.
 *
 * - ROADMAP CE-412 (Tycho row 437): a parameter declared
 *   `broadcastable<tuple<…>>` maps to the cells, and a point is a cell, so a
 *   call over a list of points (or a point-or-point-list union) compiles to
 *   one call per point, as for a parameter declared `tuple<…>`. Before, the
 *   compiled call was declined.
 * - ROADMAP CE-413 (Tycho row 438): a bare `tuple<…>` parameter given a list
 *   of points whose length is not known (a lazy `Map` over `Range(0, n)`
 *   with `n` unbound) maps lazily, as a `broadcastable<tuple<…>>` parameter
 *   does. Before, the call was an `incompatible-type` error.
 * - ROADMAP CE-414.1 (Tycho row 439): a list at a scalar parameter (`real`,
 *   `number`, `nan | real | signed_infinity`) of a function that also has a
 *   point parameter maps one element per call, as the one-parameter
 *   function does. Before, the call was an `incompatible-type` error.
 *
 * Each case checks the `ce.parse`, `ce.box` and `ce.function` routes, and
 * the compiled JavaScript where the call compiles.
 */

const POINT = 'tuple<number, number>';

type Json = unknown;

/** The compiled value of `latex` for the values `vars` of its inputs.
 *
 * A free input of type `unknown` or `any` is refused. When an input of
 * `vars` has such a type, `latex` is compiled as the body of the function
 * whose parameters are the names of `vars`, with their types, and the
 * function is called with the values. */
function compiled(
  ce: ComputeEngine,
  latex: string,
  vars: Record<string, unknown> = {}
): unknown {
  const r = compileRoot(ce, latex, Object.keys(vars));
  expect(r.success).toBe(true);
  return r.root
    ? (r.run as (...args: unknown[]) => unknown)(...Object.values(vars))
    : r.run!(vars);
}

/** The compilation of `latex`; as the body of the function of the
 * parameters `names` when one of them has the type `unknown` or `any`
 * (`root` is then true). */
function compileRoot(
  ce: ComputeEngine,
  latex: string,
  names: string[]
): {
  success: boolean;
  code: string;
  root: boolean;
  run?: (v: Record<string, unknown>) => unknown;
} {
  const types = names.map((n) => ce.box(n).type.toString());
  const root = types.some((t) => t === 'unknown' || t === 'any');
  const expr = root
    ? ce.box([
        'Function',
        ce.parse(latex).json,
        ...names.map((n, i) => ['Typed', n, { str: types[i] }]),
      ] as never)
    : ce.parse(latex);
  const r = compile(expr, { fallback: false } as never) as {
    success: boolean;
    code: string;
    run?: (v: Record<string, unknown>) => unknown;
  };
  return { ...r, success: r.success, code: r.code, run: r.run, root };
}

/** Expect the compilation of `latex`, as the body of the function of the
 * parameters `names` with the types that `ce` declares for them, to decline
 * because one of those types does not settle the shape of an argument: the
 * code is `unsettled-shape` and `unsupported` names each of `names`. */
function expectUnsettledDecline(
  ce: ComputeEngine,
  latex: string,
  names: string[]
): void {
  const r = compile(
    ce.box([
      'Function',
      ce.parse(latex).json,
      ...names.map((n) => ['Typed', n, { str: ce.box(n).type.toString() }]),
    ] as never),
    {} as never
  );
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
  for (const n of names) expect(r.unsupported).toContain(n);
}

function declines(ce: ComputeEngine, latex: string): void {
  expect(() =>
    compile(ce.parse(latex), { fallback: false } as never)
  ).toThrow();
}

/** The value of the call on the three routes, which must agree. */
function routes(ce: ComputeEngine, latex: string, json: Json[]): string {
  const [head, ...args] = json as [string, ...Json[]];
  const parsed = ce.parse(latex).evaluate().toString();
  const boxed = ce
    .box(json as never)
    .evaluate()
    .toString();
  const fn = ce
    .function(
      head,
      args.map((a) => ce.box(a as never))
    )
    .evaluate()
    .toString();
  expect(boxed).toBe(parsed);
  expect(fn).toBe(parsed);
  return parsed;
}

describe('CE-412: A broadcastable<tuple<…>> PARAMETER COMPILES OVER A LIST OF POINTS', () => {
  function engine(argType?: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(broadcastable<${POINT}>) -> unknown` });
    ce.assign('f', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
    if (argType !== undefined) ce.declare('P', argType);
    return ce;
  }

  test('the interpreter maps one point per call', () => {
    expect(
      routes(engine(), 'f([(1,2),(3,4)])', [
        'f',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ])
    ).toBe('[(2, 3),(4, 5)]');
  });

  test('a list of points compiles to one call per point', () => {
    expect(
      compiled(engine(`list<${POINT}>`), 'f(P)', {
        P: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      })
    ).toEqual([
      [2, 3],
      [4, 5],
      [6, 7],
    ]);
  });

  test('a point or a list of points is tested at run time', () => {
    const ce = engine(`${POINT} | list<${POINT}>`);
    expect(
      compiled(ce, 'f(P)', {
        P: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
    expect(compiled(ce, 'f(P)', { P: [1, 2] })).toEqual([2, 3]);
  });

  test('a tensor of points of rank 2 maps to the points, as the interpreter does', () => {
    const ce = engine(`broadcastable<${POINT}>`);
    expect(
      ce
        .box([
          'f',
          ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 3, 4]]],
        ])
        .evaluate()
        .toString()
    ).toBe('[[(2, 3)],[(4, 5)]]');
    expect(compiled(ce, 'f(P)', { P: [[[1, 2]], [[3, 4]]] })).toEqual([
      [[2, 3]],
      [[4, 5]],
    ]);
    expect(compiled(ce, 'f(P)', { P: [1, 2] })).toEqual([2, 3]);
  });

  test('controls: a bare tuple parameter and one point', () => {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${POINT}) -> unknown` });
    ce.assign('f', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
    ce.declare('P', `list<${POINT}>`);
    expect(compiled(ce, 'f(P)', { P: [[1, 2]] })).toEqual([[2, 3]]);
    expect(compiled(engine(), 'f((1,2))')).toEqual([2, 3]);
  });

  // ROADMAP CE-415: a symbol declared `broadcastable<tuple<…>>` that holds
  // one point. The compiled code bakes the held value, so the call is one
  // call on that point, as in the interpreter. Before, the compile was
  // declined because the declared type is not a point type.
  test('a broadcastable<tuple<…>> symbol that holds one point (CE-415)', () => {
    const ce = engine(`broadcastable<${POINT}>`);
    ce.assign('P', ce.parse('(1,2)'));
    expect(routes(ce, 'f(P)', ['f', 'P'])).toBe('(2, 3)');
    expect(compiled(ce, 'f(P)')).toEqual([2, 3]);
    // A live input (`vars`) is not baked: the compiled call tests the value
    // at run time.
    const r = compile(ce.parse('f(P)'), {
      fallback: false,
      vars: { P: '_.P' },
    } as never) as { success: boolean; run: (v: object) => unknown };
    expect(r.success).toBe(true);
    expect(r.run({ P: [1, 2] })).toEqual([2, 3]);
    expect(
      r.run({
        P: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });
});

describe('CE-413: A BARE tuple<…> PARAMETER MAPS A LIST OF UNKNOWN LENGTH', () => {
  function engine(param: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('l', { signature: `(${param}) -> unknown` });
    ce.assign('l', ce.parse('A \\mapsto \\sqrt{A.x^2+A.y^2}'));
    ce.declare('P', `${POINT} | list<${POINT}>`);
    ce.assign(
      'P',
      ce
        .parse(
          '\\operatorname{Map}((u,v) \\mapsto (u,v), \\frac{1}{n}\\cdot[0...n], \\frac{1}{n}\\cdot[0...n])'
        )
        .evaluate()
    );
    return ce;
  }

  test.each([POINT, `broadcastable<${POINT}>`])(
    'the call maps lazily, then reads each point (parameter %s)',
    (param) => {
      const ce = engine(param);
      const lp = ce.parse('l(P)').evaluate();
      expect(lp.operator).toBe('Map');
      const viaFunction = ce
        .function('l', [ce.symbol('P').evaluate()])
        .evaluate();
      expect(viaFunction.operator).toBe('Map');
      const q = ce.parse('\\frac{P}{l(P)}').evaluate();
      expect(q.operator).not.toBe('Error');
      expect(q.type.toString()).not.toBe('error');
      ce.assign('n', 2);
      // The points are (0, 0), (1/2, 1/2) and (1, 1): their norms are 0,
      // √2/2 and √2.
      expect(lp.evaluate().toString()).toBe('[0,sqrt(2)/2,sqrt(2)]');
      expect(ce.parse('l(P)').evaluate().toString()).toBe(
        '[0,sqrt(2)/2,sqrt(2)]'
      );
    }
  );

  test('control: with n assigned, the call maps one point per call', () => {
    const ce = engine(POINT);
    ce.assign('n', 4);
    const lp = ce.parse('l(P)').evaluate();
    expect(lp.operator).toBe('List');
    expect(lp.nops).toBe(5);
  });
});

describe('CE-414.1: A LIST AT A SCALAR SLOT BESIDE A POINT PARAMETER MAPS', () => {
  function engine(t: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: `(${t}) -> unknown` });
    ce.assign('g', ce.parse('t \\mapsto t + 1'));
    ce.declare('h', { signature: `(${POINT}, ${t}) -> unknown` });
    ce.assign('h', ce.parse('(P,t) \\mapsto P.x + t'));
    return ce;
  }

  test.each(['real', 'number', 'nan | real | signed_infinity'])(
    'one element per call, typed as a list (slot %s)',
    (t) => {
      const ce = engine(t);
      expect(ce.parse('h((1,2),[0,1,2])').type.toString()).toBe('list<number>');
      expect(
        routes(ce, 'h((1,2),[0,1,2])', [
          'h',
          ['Tuple', 1, 2],
          ['List', 0, 1, 2],
        ])
      ).toBe('[1,2,3]');
      expect(compiled(ce, 'h((1,2),[0,1,2])')).toEqual([1, 2, 3]);
      ce.declare('L', 'list<real>');
      expect(compiled(ce, 'h((1,2),L)', { L: [0, 1, 2] })).toEqual([1, 2, 3]);
      // Controls.
      expect(routes(ce, 'h((1,2),2)', ['h', ['Tuple', 1, 2], 2])).toBe('3');
      expect(compiled(ce, 'h((1,2),2)')).toBe(3);
      expect(routes(ce, 'g([0,1,2])', ['g', ['List', 0, 1, 2]])).toBe(
        '[1,2,3]'
      );
    }
  );

  test('a function literal with typed parameters (operator definition)', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'k',
      ce.box([
        'Function',
        ['Add', ['At', 'P', 1], 't'],
        ['Typed', 'P', `'${POINT}'`],
        ['Typed', 't', "'real'"],
      ] as never)
    );
    expect(
      routes(ce, 'k((1,2),[0,1,2])', ['k', ['Tuple', 1, 2], ['List', 0, 1, 2]])
    ).toBe('[1,2,3]');
    expect(compiled(ce, 'k((1,2),[0,1,2])')).toEqual([1, 2, 3]);
  });

  test('a list of lists maps to the cells, as the one-parameter function does', () => {
    const ce = engine('real');
    expect(ce.parse('h((1,2),[[0,1],[2,3]])').type.toString()).toBe(
      'list<list<number>>'
    );
    expect(
      routes(ce, 'h((1,2),[[0,1],[2,3]])', [
        'h',
        ['Tuple', 1, 2],
        ['List', ['List', 0, 1], ['List', 2, 3]],
      ])
    ).toBe('[[1,2],[3,4]]');
    expect(ce.parse('g([[0,1],[2,3]])').evaluate().toString()).toBe(
      '[[1,2],[3,4]]'
    );
    // The static type `list<list<number>>` gives the rank 2, and the
    // compiled call is the static map over both levels.
    expect(compiled(ce, 'h((1,2),[[0,1],[2,3]])')).toEqual([
      [1, 2],
      [3, 4],
    ]);
    ce.declare('M', 'list<list<real>>');
    const r = compileRoot(ce, 'h((1,2),M)', ['M']);
    expect(r.code).toContain('_SYS.mapFn(');
    expect(r.code).not.toContain('Array.isArray');
    expect(
      compiled(ce, 'h((1,2),M)', {
        M: [
          [0, 1],
          [2, 3],
        ],
      })
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('a list of points and a list of scalars are paired', () => {
    const ce = engine('real');
    expect(
      routes(ce, 'h([(1,2),(3,4)],[0,1])', [
        'h',
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
        ['List', 0, 1],
      ])
    ).toBe('[1,4]');
    // With literal arguments the compiler folds the call to its value.
    expect(compiled(ce, 'h([(1,2),(3,4)],[0,1])')).toEqual([1, 4]);
    // With two list inputs, the compiled call is the static map that pairs
    // point `i` with element `i` of `L`, as the interpreter does.
    ce.declare('Q', `list<${POINT}>`);
    ce.declare('L', 'list<real>');
    const r = compileRoot(ce, 'h(Q,L)', ['Q', 'L']);
    expect(r.code).toContain('_SYS.mapFn(');
    expect(
      compiled(ce, 'h(Q,L)', {
        Q: [
          [1, 2],
          [3, 4],
        ],
        L: [0, 1],
      })
    ).toEqual([1, 4]);
  });

  test('an argument that may be a list is typed R | list<R>', () => {
    const ce = engine('real');
    ce.declare('U', 'real | list<real>');
    expect(ce.parse('h((1,2),U)').type.toString()).toBe(
      'list<number> | number'
    );
    expect(ce.parse('g(U)').type.toString()).toBe('list<real> | real');
    // `U` is declared with two shapes, so the compiled call tests the shape
    // of `U` once and holds one body for each: a number is one call, a list
    // is one call per element. Each value equals the interpreter's.
    const call = ce.parse('h((1,2),U)');
    expect(compiled(ce, 'h((1,2),U)', { U: 5 })).toBe(6);
    expect(call.subs({ U: ce.number(5) }).evaluate().toString()).toBe('6');
    expect(compiled(ce, 'h((1,2),U)', { U: [0, 1, 2] })).toEqual([1, 2, 3]);
    expect(
      call.subs({ U: ce.box(['List', 0, 1, 2]) }).evaluate().toString()
    ).toBe('[1,2,3]');
  });

  test('beside a broadcastable<tuple<…>> parameter, a list of points and a scalar list are paired, and the compiled call declines', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: `(broadcastable<${POINT}>, real) -> unknown`,
    });
    ce.assign('f', ce.parse('(P,t) \\mapsto (P.x, t)'));
    expect(ce.parse('f([(1,2),(3,4)],[5,6])').evaluate().toString()).toBe(
      '[(1, 5),(3, 6)]'
    );
    expect(ce.parse('f([(1,2),(3,4)],[5,6,7])').evaluate().operator).toBe(
      'Error'
    );
    // Before, the compiled call mapped the points only and passed the whole
    // scalar list to each call.
    declines(ce, 'f([(1,2),(3,4)],[5,6])');
    declines(ce, 'f([(1,2),(3,4)],[5,6,7])');
    ce.declare('Q', `list<${POINT}>`);
    ce.declare('L', 'list<real>');
    declines(ce, 'f(Q,L)');
    // One point and a scalar list: one call per element, on both routes.
    expect(ce.parse('f((1,2),[5,6])').evaluate().toString()).toBe(
      '[(1, 5),(1, 6)]'
    );
    expect(compiled(ce, 'f((1,2),[5,6])')).toEqual([
      [1, 5],
      [1, 6],
    ]);
  });

  test('the compiled map declines when the elements may not fit the parameter type', () => {
    const ce = new ComputeEngine();
    ce.declare('b', { signature: `(${POINT}, boolean) -> unknown` });
    ce.assign('b', ce.parse('(P,t) \\mapsto t'));
    const b = ce.parse('b((1,2),[0,1,2])').evaluate();
    expect(b.toString()).toContain('incompatible-type');
    declines(ce, 'b((1,2),[0,1,2])');
    ce.declare('n', { signature: `(${POINT}, integer) -> unknown` });
    ce.assign('n', ce.parse('(P,t) \\mapsto P.x + t'));
    expect(ce.parse('n((1,2),[0.5,1,2])').evaluate().toString()).toContain(
      'incompatible-type'
    );
    declines(ce, 'n((1,2),[0.5,1,2])');
    // Control: integer elements at an integer parameter compile.
    expect(compiled(ce, 'n((1,2),[0,1,2])')).toEqual([1, 2, 3]);
  });

  test('an absent element at a scalar slot is bound to the parameter, not replaced by Missing', () => {
    const ce = new ComputeEngine();
    ce.declare('k', {
      signature: `(${POINT}, real | missing) -> integer`,
    });
    ce.assign('k', ce.parse('(P,t) \\mapsto 7'));
    const json = ['k', ['Tuple', 1, 2], ['List', 'Missing', 1]];
    expect(
      ce
        .box(json as never)
        .evaluate()
        .toString()
    ).toBe('[7,7]');
    expect(ce.box(json as never).type.toString()).toBe('list<integer>');
  });

  test('a tensor of unknown rank at a scalar slot types the call as a tensor', () => {
    const ce = engine('real');
    ce.declare('T', 'tensor<real>');
    ce.assign('T', ce.parse('[[0,1],[2,3]]'));
    const call = ce.parse('h((1,2),T)');
    // `tensor` is `tensor<number>`. Before, the call was typed
    // `list<number>`, while its value is a matrix.
    expect(call.type.toString()).toBe('tensor');
    const value = call.evaluate();
    expect(value.toString()).toBe('[[1,2],[3,4]]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('an empty list gives an empty list', () => {
    const ce = engine('real');
    expect(routes(ce, 'h((1,2),[])', ['h', ['Tuple', 1, 2], ['List']])).toBe(
      '[]'
    );
  });
});

describe('CE-414.2: AN unknown SLOT BESIDE A POINT PARAMETER', () => {
  // User decision 2026-10-24 (option B): beside a point parameter, a slot
  // whose type can hold a list (`unknown`, `any`, no annotation) follows the
  // rule of a one-parameter function. Its type is refined from the body of
  // the assigned function: a slot that stays `unknown` maps a list (to the
  // cells), and a slot the body uses as a collection (`Length(L)`, refined
  // to `collection`) takes the list whole. Before, every such slot took the
  // list whole.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${POINT}, unknown) -> unknown` });
    ce.assign('f', ce.parse('(P,t) \\mapsto (P.x+t, P.y)'));
    ce.declare('m', { signature: `(${POINT}, unknown) -> unknown` });
    ce.assign('m', ce.parse('(P,L) \\mapsto \\operatorname{Length}(L)'));
    return ce;
  }

  test('a slot that stays unknown maps the list', () => {
    const ce = engine();
    expect(
      routes(ce, 'f((1,2),[0,1,2])', ['f', ['Tuple', 1, 2], ['List', 0, 1, 2]])
    ).toBe('[(1, 2),(2, 2),(3, 2)]');
    expect(ce.parse('f((1,2),[0,1,2])').type.toString()).toBe(
      'list<tuple<number, number>>'
    );
    expect(compiled(ce, 'f((1,2),[0,1,2])')).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
    // Control: a number binds whole.
    expect(routes(ce, 'f((1,2),3)', ['f', ['Tuple', 1, 2], 3])).toBe('(4, 2)');
  });

  test('a list of lists maps to the cells, as the one-parameter function does', () => {
    const ce = engine();
    expect(
      routes(ce, 'f((1,2),[[0,1],[2]])', [
        'f',
        ['Tuple', 1, 2],
        ['List', ['List', 0, 1], ['List', 2]],
      ])
    ).toBe('[[(1, 2),(2, 2)],[(3, 2)]]');
    const g = new ComputeEngine();
    g.declare('g', { signature: '(unknown) -> unknown' });
    g.assign('g', g.parse('t \\mapsto (t,1)'));
    expect(g.parse('g([[0,1],[2]])').evaluate().toString()).toBe(
      '[[(0, 1),(1, 1)],[(2, 1)]]'
    );
  });

  test('a slot refined to collection takes the list whole', () => {
    const ce = engine();
    expect(
      routes(ce, 'm((1,2),[0,1,2])', ['m', ['Tuple', 1, 2], ['List', 0, 1, 2]])
    ).toBe('3');
    expect(compiled(ce, 'm((1,2),[0,1,2])')).toBe(3);
  });

  test('an argument of type any declines when compiled', () => {
    // The interpreter maps the call when the value is a list and binds the
    // value whole otherwise. The compiler settles that choice from the
    // type of the argument, so an argument whose type does not settle a
    // shape declines. A free input of that type is refused, so `x` is a
    // parameter of the root function.
    const ce = engine();
    ce.declare('x', 'any');
    expectUnsettledDecline(ce, 'f((1,2), x)', ['x']);
  });

  test('an argument of type unknown at the root function is a scalar', () => {
    // `x` is the only parameter of the root function `x ↦ f((1, 2), x)`,
    // and it has no type annotation (`unknown`). Such a root function is
    // compiled for a scalar argument: a parameter with no type of a root
    // function whose parameters are all scalar holds a scalar, and a host
    // that passes a list gives an unspecified result (design decision D3
    // in `docs/scratch/2026-10-31-ce712-2-design.md`, and the decision of
    // ROADMAP CE-706 for a root lambda). So the call is the direct call of
    // the function, with no map and no run-time test of the value, and
    // its value for a number equals the interpreter's.
    const ce = engine();
    ce.declare('x', 'unknown');
    const r = compileRoot(ce, 'f((1,2), x)', ['x']);
    expect(r.success).toBe(true);
    expect(r.root).toBe(true);
    expect(r.code).toContain('_fn_f(');
    expect(r.code).not.toContain('mapFn');
    expect(r.code).not.toContain('.map(');
    expect(r.code).not.toContain('Array.isArray');
    expect(compiled(ce, 'f((1,2), x)', { x: 3 })).toEqual([4, 2]);
    expect(routes(ce, 'f((1,2),3)', ['f', ['Tuple', 1, 2], 3])).toBe('(4, 2)');
  });

  test('an argument with a declared shape maps or binds whole when compiled', () => {
    // With `x: list<real>` the compiled call maps over the list with a
    // static map; with `x: real` it calls the function once.
    const list = engine();
    list.declare('x', 'list<real>');
    const r = compileRoot(list, 'f((1,2), x)', ['x']);
    expect(r.success).toBe(true);
    expect(r.code).toContain('.map(');
    expect(r.code).not.toContain('bcastFn');
    expect(compiled(list, 'f((1,2), x)', { x: [0, 1, 2] })).toEqual([
      [1, 2],
      [2, 2],
      [3, 2],
    ]);
    list.assign('x', list.box(['List', 0, 1, 2]));
    expect(list.parse('f((1,2), x)').evaluate().toString()).toBe(
      '[(1, 2),(2, 2),(3, 2)]'
    );
    const scalar = engine();
    scalar.declare('x', 'real');
    expect(compiled(scalar, 'f((1,2), x)', { x: 5 })).toEqual([6, 2]);
    scalar.assign('x', 5);
    expect(scalar.parse('f((1,2), x)').evaluate().toString()).toBe('(6, 2)');
  });
});

describe('CE-418: A broadcastable<tuple<…>> PARAMETER BESIDE A BARE tuple<…> PARAMETER', () => {
  // With one parameter declared `broadcastable<tuple<…>>` and the other a
  // bare `tuple<…>`, two lists of points pair, as they do when both
  // parameters have the same declaration. Before, the broadcastable slot
  // mapped and the bare tuple slot received the whole list: each call was an
  // `incompatible-type` error.
  const L = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];
  const M = ['List', ['Tuple', 10, 20], ['Tuple', 30, 40]];
  function engine(sig: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `${sig} -> unknown` });
    ce.assign('f', ce.parse('(a, b) \\mapsto (a.x + b.x, a.y + b.y)'));
    return ce;
  }
  const B = `broadcastable<${POINT}>`;
  const SIGS = {
    'broadcastable first': `(${B}, ${POINT})`,
    'broadcastable second': `(${POINT}, ${B})`,
    'both bare': `(${POINT}, ${POINT})`,
    'both broadcastable': `(${B}, ${B})`,
  };

  for (const [name, sig] of Object.entries(SIGS)) {
    test(`two lists of points pair (${name})`, () => {
      const ce = engine(sig);
      const latex = 'f([(1,2),(3,4)], [(10,20),(30,40)])';
      expect(routes(ce, latex, ['f', L, M])).toBe('[(11, 22),(33, 44)]');
      expect(ce.parse(latex).type.toString()).toMatch(/^list<tuple</);
      ce.assign('Q', ce.box(M as never));
      expect(routes(ce, 'f([(1,2),(3,4)], Q)', ['f', L, 'Q'])).toBe(
        '[(11, 22),(33, 44)]'
      );
    });

    test(`a length mismatch is the same error (${name})`, () => {
      const ce = engine(sig);
      const latex = 'f([(1,2),(3,4),(5,6)], [(10,20),(30,40)])';
      expect(
        routes(ce, latex, [
          'f',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 6]],
          M,
        ])
      ).toBe(
        routes(engine(SIGS['both bare']), latex, [
          'f',
          ['List', ['Tuple', 1, 2], ['Tuple', 3, 4], ['Tuple', 5, 6]],
          M,
        ])
      );
      expect(ce.parse(latex).evaluate().json).toEqual([
        'Error',
        "'incompatible-dimensions'",
        "'3 vs 2'",
      ]);
    });
  }

  test('a list of numbers at the bare tuple slot is bound whole', () => {
    // As with two bare `tuple<…>` parameters: the bare slot maps only a list
    // of points.
    const ce = engine(SIGS['broadcastable first']);
    const json = ce.parse('f([(1,2),(3,4)], [1,2])').evaluate().json;
    expect(JSON.stringify(json)).toContain("'incompatible-type'");
    expect(JSON.stringify(json)).toContain('ErrorFrame');
  });

  test('an absent point at the bare tuple slot answers Missing', () => {
    // The bare tuple slot maps a list of points, so an absent point there
    // answers `Missing`, as with two bare `tuple<…>` parameters, and the
    // type keeps its `missing` arm. Before, the mixed declaration bound the
    // absent point to the parameter: an `incompatible-type` error.
    const A = ['List', ['Tuple', 10, 20], 'Missing'];
    const expected = ['List', ['Tuple', 11, 22], 'Missing'];
    for (const name of [
      'broadcastable first',
      'broadcastable second',
      'both bare',
    ] as const) {
      const ce = engine(SIGS[name]);
      const args = name === 'broadcastable second' ? [A, L] : [L, A];
      const call = ce.box(['f', ...args] as never);
      expect(call.evaluate().json).toEqual(expected);
      expect(
        ce
          .function(
            'f',
            args.map((a) => ce.box(a as never))
          )
          .evaluate().json
      ).toEqual(expected);
      expect(call.type.toString()).toBe(
        'list<missing | tuple<number, number>>'
      );
    }
  });

  test('an absent point at a broadcastable slot answers Missing', async () => {
    // User decision 2026-10-24, ROADMAP CE-420 (option A): both parameters
    // `broadcastable<tuple<…>>` answer `Missing` for an absent point, as a
    // bare `tuple<…>` parameter does. Before, the absent point was bound to
    // the parameter: an `incompatible-type` error in that cell.
    const A = ['List', ['Tuple', 10, 20], 'Missing'];
    const expected = ['List', ['Tuple', 11, 22], 'Missing'];
    const ce = engine(SIGS['both broadcastable']);
    const call = ce.box(['f', L, A] as never);
    expect(call.evaluate().json).toEqual(expected);
    expect((await call.evaluateAsync()).json).toEqual(expected);
    expect(
      ce.function('f', [ce.box(L as never), ce.box(A as never)]).evaluate().json
    ).toEqual(expected);
    expect(
      ce.parse('f([(1,2),(3,4)], [(10,20), \\mathrm{Missing}])').evaluate().json
    ).toEqual(expected);
    // The type has the `missing` arm and admits the value.
    expect(call.type.toString()).toMatch(/^list<missing \| tuple</);
    expect(isSubtype(call.evaluate().type.type, call.type.type)).toBe(true);
  });

  test('a list of absent points answers a list of Missing, for every declaration', async () => {
    // `[Missing, Missing]`, typed `list<missing^2>`, is read as a list of
    // absent points (ROADMAP CE-420). Before, at a bare `tuple<…>` slot the
    // call was an `incompatible-type` error, and at a `broadcastable<…>`
    // slot each cell was one.
    const A = ['List', 'Missing', 'Missing'];
    for (const [name, sig] of Object.entries(SIGS)) {
      const ce = engine(sig);
      const args = name === 'broadcastable second' ? [A, L] : [L, A];
      const call = ce.box(['f', ...args] as never);
      expect(call.evaluate().json).toEqual(['List', 'Missing', 'Missing']);
      expect((await call.evaluateAsync()).json).toEqual([
        'List',
        'Missing',
        'Missing',
      ]);
      expect(call.type.toString()).toBe(
        'list<missing | tuple<number, number>>'
      );
    }
  });

  test('a list of points absent as a whole answers Missing, for every declaration', async () => {
    // ROADMAP CE-420, user decision 2026-10-24: an argument typed as a list
    // of points (or as a point or a list of points) that is absent as a
    // whole gives `Missing`, at a `broadcastable<tuple<…>>` parameter as at a
    // `tuple<…>` one, and the type of the call has the `missing` option.
    // Before, the `broadcastable<…>` parameter refused it with an
    // `incompatible-type` error.
    for (const decl of [`list<${POINT}> | missing`, `${B} | missing`]) {
      for (const [name, sig] of Object.entries(SIGS)) {
        const ce = engine(sig);
        ce.declare('U', decl);
        ce.declare('V', `list<${POINT}>`);
        const args = name === 'broadcastable second' ? ['V', 'U'] : ['U', 'V'];
        const latex = `f(${args.join(', ')})`;
        const type = ce.parse(latex).type;
        expect(isSubtype('missing', type.type)).toBe(true);
        ce.assign('U', ce.Missing);
        ce.assign('V', ce.box(L as never));
        const call = ce.box(['f', ...args] as never);
        expect(call.evaluate().symbol).toBe('Missing');
        expect((await call.evaluateAsync()).symbol).toBe('Missing');
        expect(
          ce
            .function(
              'f',
              args.map((a) => ce.symbol(a))
            )
            .evaluate().symbol
        ).toBe('Missing');
        expect(ce.parse(latex).evaluate().symbol).toBe('Missing');
      }
    }
    // One parameter: the type is the bare `tuple<…>` one.
    const ce = new ComputeEngine();
    ce.declare('g', { signature: `(${B}) -> unknown` });
    ce.assign('g', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
    ce.declare('U', `list<${POINT}> | missing`);
    expect(ce.parse('g(U)').type.toString()).toBe(
      'list<tuple<number, number>> | missing'
    );
    ce.assign('U', ce.Missing);
    expect(ce.parse('g(U)').evaluate().symbol).toBe('Missing');
    // A single point that may be absent is still refused, at either
    // declaration.
    for (const sig of [`(${B})`, `(${POINT})`]) {
      const ce2 = new ComputeEngine();
      ce2.declare('g', { signature: `${sig} -> unknown` });
      ce2.assign('g', ce2.parse('a \\mapsto (a.x+1, a.y+1)'));
      ce2.declare('Q', `${POINT} | missing`);
      ce2.assign('Q', ce2.Missing);
      expect(JSON.stringify(ce2.parse('g(Q)').evaluate().json)).toContain(
        "'incompatible-type'"
      );
    }
  });

  test('the async route answers Missing at an absent point', async () => {
    const ce = engine(SIGS['broadcastable first']);
    const call = ce.box([
      'f',
      L,
      ['List', ['Tuple', 10, 20], 'Missing'],
    ] as never);
    expect((await call.evaluateAsync()).json).toEqual([
      'List',
      ['Tuple', 11, 22],
      'Missing',
    ]);
  });

  test('the compiled call declines, as for the uniform declarations', () => {
    for (const sig of Object.values(SIGS))
      declines(engine(sig), 'f([(1,2),(3,4)], [(10,20),(30,40)])');
  });
});

describe('CE-419: A SCALAR-SLOT TENSOR OF UNKNOWN RANK KEEPS THE ABSENCES OF THE POINTS', () => {
  // With `Ps` a list of points that may hold an absent point, the call maps
  // the absent point to a `Missing` element. A scalar-slot argument typed
  // `tensor<real>` gave the call the type `tensor<real>`, without the
  // `missing` arm that the known-rank `list<real>` argument gives.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: `(tuple<real, real>, real) -> real` });
    ce.assign('h', ce.parse('(P, t) \\mapsto P.x + t'));
    ce.declare('TT', 'tensor<real>');
    return ce;
  }

  test('the type has the missing arm, and admits the value', () => {
    const ce = engine();
    ce.assign('PV', ce.box(['List', ['Tuple', 1, 2], 'Missing']));
    ce.assign('TT', ce.box(['List', ['List', 10, 20], ['List', 30, 40]]));
    const call = ce.box(['h', 'PV', 'TT']);
    expect(call.type.toString()).toBe('list<missing | real | tensor<real>>');
    const value = call.evaluate();
    expect(value.json).toEqual(['List', ['List', 11, 21], 'Missing']);
    expect(value.type.matches(call.type)).toBe(true);
    // The known-rank argument carries the arm too.
    ce.declare('TL', 'list<real>');
    expect(ce.box(['h', 'PV', 'TL']).type.toString()).toBe(
      'list<missing | real>'
    );
  });

  test('an operand that may be absent as a whole adds missing', () => {
    const ce = engine();
    ce.declare('Pw', 'list<tuple<real, real>> | missing');
    expect(ce.box(['h', 'Pw', 'TT']).type.toString()).toBe(
      'missing | tensor<real>'
    );
  });

  test('without absence the type is tensor<real>', () => {
    const ce = engine();
    ce.declare('Pn', 'list<tuple<real, real>>');
    expect(ce.box(['h', 'Pn', 'TT']).type.toString()).toBe('tensor<real>');
  });
});

describe('review round 2 (compiler)', () => {
  // A compiled call must answer as the interpreter does, or decline so that
  // the default `fallback` uses the interpreter.
  function engine(sig: string, body: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `${sig} -> unknown` });
    ce.assign('f', ce.parse(body));
    return ce;
  }
  const B = `broadcastable<${POINT}>`;
  const PAIR = '(a, b) \\mapsto (a.x + b.x, a.y + b.y)';
  const ONE = 'a \\mapsto (a.x+1, a.y+1)';

  test('a rank-2 list at a broadcastable slot beside a list of points declines', () => {
    // The interpreter maps the rank-2 list to its points and pairs it with
    // the list of points. The compiled map passed the rank-2 list whole to
    // each call, which threw at run time.
    const ce = engine(`(${B}, ${POINT})`, PAIR);
    const latex = 'f([[(1,2)],[(3,4)]], [(10,20),(30,40)])';
    expect(ce.parse(latex).evaluate().toString()).toBe(
      '[[(11, 22)],[(33, 44)]]'
    );
    declines(ce, latex);
    const r = compile(ce.parse(latex)) as {
      success: boolean;
      run: (v: object) => unknown;
    };
    expect(r.success).toBe(false);
    expect(r.run({})).toEqual([[[11, 22]], [[33, 44]]]);
  });

  test('control: a list of points beside one point compiles', () => {
    const ce = engine(`(${B}, ${POINT})`, PAIR);
    ce.declare('P', `list<${POINT}>`);
    ce.declare('Q', POINT);
    const P = [
      [1, 2],
      [3, 4],
    ];
    const expected = [
      [11, 22],
      [13, 24],
    ];
    expect(compiled(ce, 'f(P, (10,20))', { P })).toEqual(expected);
    expect(compiled(ce, 'f(P, Q)', { P, Q: [10, 20] })).toEqual(expected);
  });

  test('an absent point at a broadcastable slot compiles to undefined', () => {
    // User decision 2026-10-24, ROADMAP CE-420: the interpreter answers
    // `Missing` for the absent point, as for a bare `tuple<…>` parameter,
    // and the compiled map answers `undefined`, the compiled spelling of
    // `Missing`. Before, the compiled call declined.
    const ce = engine(`(${B})`, ONE);
    ce.declare('P', `list<missing | ${POINT}>`);
    expect(compiled(ce, 'f(P)', { P: [[1, 2], undefined] })).toEqual([
      [2, 3],
      undefined,
    ]);
    ce.assign('P', ce.box(['List', ['Tuple', 1, 2], 'Missing']));
    expect(ce.parse('f(P)').evaluate().json).toEqual([
      'List',
      ['Tuple', 2, 3],
      'Missing',
    ]);
  });

  test('a list absent as a whole at a broadcastable slot compiles to undefined', () => {
    // ROADMAP CE-420: the interpreter answers `Missing` for a list of points
    // that is absent as a whole, as for a bare `tuple<…>` parameter.
    for (const decl of [`list<${POINT}> | missing`, `${B} | missing`]) {
      const ce = engine(`(${B})`, ONE);
      ce.declare('P', decl);
      expect(compiled(ce, 'f(P)', { P: undefined })).toBeUndefined();
      expect(compiled(ce, 'f(P)', { P: [[1, 2]] })).toEqual([[2, 3]]);
    }
  });

  test('a point that may be absent at another broadcastable slot declines', () => {
    // The interpreter refuses an absent point passed whole (as for a bare
    // `tuple<…>` parameter); the compiled map would compute with it.
    const ce = engine(`(${B}, ${POINT})`, PAIR);
    ce.declare('U', `${POINT} | missing`);
    ce.declare('V', `list<${POINT}>`);
    declines(ce, 'f(U, V)');
  });

  test('control: an absent point at a bare tuple slot compiles to undefined', () => {
    const ce = engine(`(${POINT})`, ONE);
    ce.declare('P', `list<missing | ${POINT}>`);
    expect(compiled(ce, 'f(P)', { P: [[1, 2], undefined] })).toEqual([
      [2, 3],
      undefined,
    ]);
  });
});

describe('review round 2 (interpreter)', () => {
  // The type of a call must admit every value its evaluation can give, and
  // the value must not depend on the length of the lists.
  const B = `broadcastable<${POINT}>`;
  const PAIR = '(a, b) \\mapsto (a.x + b.x, a.y + b.y)';
  function engine(sig: string): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `${sig} -> unknown` });
    ce.assign('f', ce.parse(PAIR));
    return ce;
  }

  test('a list of lists of points at a broadcastable slot beside a list of points: the type admits the value', () => {
    // The broadcastable slot maps to the points, so the value is a list of
    // lists. Before, the call was typed `list<tuple<number, number>>`.
    const ce = engine(`(${B}, ${POINT})`);
    const call = ce.box([
      'f',
      ['List', ['List', ['Tuple', 1, 2]], ['List', ['Tuple', 3, 4]]],
      ['List', ['Tuple', 10, 20], ['Tuple', 30, 40]],
    ] as never);
    expect(call.type.toString()).toBe('list<list<tuple<number, number>>>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[[(11, 22)],[(33, 44)]]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    const parsed = ce.parse('f([[(1,2)],[(3,4)]], [(10,20),(30,40)])');
    expect(parsed.type.toString()).toBe(call.type.toString());
    // Control: a list of points at the broadcastable slot.
    expect(
      ce.parse('f([(1,2),(3,4)], [(10,20),(30,40)])').type.toString()
    ).toBe('list<tuple<number, number>>');
  });

  test('a scalar slot typed as a union maps each arm at its depth', () => {
    const ce = new ComputeEngine();
    ce.declare('h', { signature: '(tuple<real, real>, real) -> real' });
    ce.assign('h', ce.parse('(P, t) \\mapsto P.x + t'));
    ce.declare('U', 'real | list<list<real>>');
    // Before, the call was typed `real | list<real>`.
    expect(ce.box(['h', ['Tuple', 1, 2], 'U']).type.toString()).toBe(
      'list<list<real>> | real'
    );
    for (const u of [['List', ['List', 1, 2], ['List', 3, 4]], 3]) {
      ce.assign('U', ce.box(u as never));
      const call = ce.box(['h', ['Tuple', 1, 2], 'U']);
      const value = call.evaluate();
      expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    }
    // A ragged list keeps the nested arm.
    ce.declare('V', 'list<real | list<real>>');
    ce.assign('V', ce.box(['List', 1, ['List', 3, 4]]));
    const call = ce.box(['h', ['Tuple', 1, 2], 'V']);
    expect(call.type.toString()).toBe('list<list<real> | real>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[2,[4,5]]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  for (const [name, sig] of [
    ['broadcastable first', `(${B}, ${POINT})`],
    ['broadcastable second', `(${POINT}, ${B})`],
    ['both bare', `(${POINT}, ${POINT})`],
    // ROADMAP CE-420, user decision 2026-10-24.
    ['both broadcastable', `(${B}, ${B})`],
  ] as const) {
    test(`an absent point in a list longer than the eager threshold is Missing (${name})`, async () => {
      // A list longer than `MAX_SIZE_EAGER_COLLECTION` is mapped lazily.
      // Before, the lazy map bound the absent point to the parameter, which
      // is an `incompatible-type` error, while a short list gave `Missing`.
      const ce = engine(sig);
      const n = MAX_SIZE_EAGER_COLLECTION + 20;
      const points = [
        'List',
        ...Array.from({ length: n }, (_, k) => ['Tuple', k, k]),
      ];
      const withAbsent = [
        'List',
        ...Array.from({ length: n }, (_, k) =>
          k === 1 ? 'Missing' : ['Tuple', 10, 20]
        ),
      ];
      const json = sig.startsWith(`(${POINT}, ${B}`)
        ? ['f', withAbsent, points]
        : ['f', points, withAbsent];
      const call = ce.box(json as never);
      for (const value of [call.evaluate(), await call.evaluateAsync()]) {
        expect(value.count).toBe(n);
        expect(value.at(1)?.toString()).toBe('(10, 20)');
        expect(value.at(2)?.symbol).toBe('Missing');
        expect(value.at(3)?.toString()).toBe('(12, 22)');
      }
      // Control: a short list gives `Missing` too.
      const short = sig.startsWith(`(${POINT}, ${B}`)
        ? [
            'f',
            ['List', ['Tuple', 10, 20], 'Missing'],
            ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
          ]
        : [
            'f',
            ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
            ['List', ['Tuple', 10, 20], 'Missing'],
          ];
      expect(ce.box(short as never).evaluate().json).toEqual([
        'List',
        ['Tuple', 11, 22],
        'Missing',
      ]);
    });
  }
});

describe('review round 3 (compiler)', () => {
  // `f(Ps, t)` with `t` free and typed `unknown`, at an `unknown` slot
  // beside a list of points. The interpreter pairs `t` with the points when
  // its value is a list (ROADMAP CE-414.2) and passes it whole otherwise.
  // The compiler settles that choice from the type of `t`: with `t:
  // unknown` the compilation declines, and with `t` declared `real`,
  // `list<real>` or `list<list<real>>` it compiles a direct call or a
  // static map (`compiled()`).
  function engine(tType = 'unknown'): ComputeEngine {
    const ce = new ComputeEngine();
    if (tType !== 'unknown') ce.declare('t', tType);
    ce.declare('Ps', `list<${POINT}>`);
    ce.declare('f', { signature: `(${POINT}, unknown) -> unknown` });
    ce.assign('f', ce.parse('(P, t) \\mapsto (P.x + t, P.y)'));
    return ce;
  }
  const Ps = [
    [1, 2],
    [3, 4],
  ];
  function interpreted(ce: ComputeEngine, t: Json): string {
    ce.assign('Ps', ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]));
    ce.assign('t', ce.box(t as never));
    return ce.parse('f(\\mathrm{Ps}, t)').evaluate().toString();
  }

  test.each(['unknown', 'any'])('an argument of type %s declines', (type) => {
    // `Ps` and `t` are both parameters of the root function: a root
    // function literal reads no free input, so with `Ps` free the
    // compilation failed on `Ps` (`compile-error`) before the call was
    // reached. The root function has a list parameter, so its parameter
    // `t` is not known to hold a scalar, and the type of `t` settles no
    // shape: the call declines and names `t`.
    const ce = engine();
    const r = compile(
      ce.box([
        'Function',
        ce.parse('f(\\mathrm{Ps}, t)').json,
        ['Typed', 'Ps', { str: `list<${POINT}>` }],
        ['Typed', 't', { str: type }],
      ] as never),
      {} as never
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.unsupported).toContain('t');
  });

  test('a number is passed whole to each call', () => {
    const ce = engine('real');
    expect(compiled(ce, 'f(\\mathrm{Ps}, t)', { Ps, t: 10 })).toEqual([
      [11, 2],
      [13, 4],
    ]);
    expect(interpreted(ce, 10)).toBe('[(11, 2),(13, 4)]');
  });

  test('a list is paired with the points', () => {
    const ce = engine('list<real>');
    expect(compiled(ce, 'f(\\mathrm{Ps}, t)', { Ps, t: [10, 20] })).toEqual([
      [11, 2],
      [23, 4],
    ]);
    expect(interpreted(ce, ['List', 10, 20])).toBe('[(11, 2),(23, 4)]');
  });

  test('an element that is a list maps the call again', () => {
    const ce = engine('list<list<real>>');
    expect(
      compiled(ce, 'f(\\mathrm{Ps}, t)', {
        Ps,
        t: [
          [10, 20],
          [1, 2],
        ],
      })
    ).toEqual([
      [
        [11, 2],
        [21, 2],
      ],
      [
        [4, 4],
        [5, 4],
      ],
    ]);
    expect(interpreted(ce, ['List', ['List', 10, 20], ['List', 1, 2]])).toBe(
      '[[(11, 2),(21, 2)],[(4, 4),(5, 4)]]'
    );
  });

  test('a length mismatch is NaN, the compiled incompatible-dimensions', () => {
    const ce = engine('list<real>');
    expect(
      compiled(ce, 'f(\\mathrm{Ps}, t)', { Ps, t: [10, 20, 30] })
    ).toBeNaN();
    expect(interpreted(ce, ['List', 10, 20, 30])).toBe(
      'Error("incompatible-dimensions", "2 vs 3")'
    );
  });
});

describe('review round 3 (interpreter)', () => {
  // The type of a call must admit every value its evaluation gives, and the
  // value must not depend on the length of the lists.
  const B = `broadcastable<${POINT}>`;

  test('a list of lists at an unknown slot beside a broadcastable slot maps one rank', () => {
    // The `unknown` slot of the declared plan maps one rank down and binds
    // each element whole (`slotMapsOneRank`), so the value is a list of
    // results. Before, the call was typed `list<list<real>>`.
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature:
        '(broadcastable<tuple<real, real>>, tuple<real, real>, unknown) -> real',
    });
    ce.assign('f', ce.parse('(P, Q, u) \\mapsto 42'));
    for (const first of [
      ['Tuple', 0, 0],
      ['List', ['Tuple', 0, 0], ['Tuple', 1, 1]],
    ]) {
      const call = ce.box([
        'f',
        first,
        ['Tuple', 1, 2],
        ['List', ['List', 1], ['List', 2]],
      ] as never);
      expect(call.type.toString()).toBe('list<real>');
      const value = call.evaluate();
      expect(value.toString()).toBe('[42,42]');
      expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    }
    // An operand that may or may not be a list gives both shapes.
    ce.declare('U', 'real | list<list<real>>');
    for (const u of [['List', ['List', 1], ['List', 2]], 3]) {
      ce.assign('U', ce.box(u as never));
      const call = ce.box(['f', ['Tuple', 0, 0], ['Tuple', 1, 2], 'U']);
      const value = call.evaluate();
      expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    }
  });

  test('controls: without a broadcastable slot, the unknown slot maps to the cells', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(tuple<real, real>, unknown) -> real' });
    ce.assign('g', ce.parse('(Q, u) \\mapsto 42'));
    const call = ce.box([
      'g',
      ['Tuple', 1, 2],
      ['List', ['List', 1], ['List', 2]],
    ]);
    expect(call.type.toString()).toBe('list<list<real>>');
    expect(call.evaluate().toString()).toBe('[[42],[42]]');
    // A list of points at a bare point parameter.
    ce.declare('h', {
      signature: '(tuple<real, real>, tuple<real, real>) -> real',
    });
    ce.assign('h', ce.parse('(P, Q) \\mapsto P.x + Q.x'));
    const points = ce.box([
      'h',
      ['List', ['Tuple', 0, 0], ['Tuple', 1, 1]],
      ['Tuple', 1, 2],
    ]);
    expect(points.type.toString()).toBe('list<real>');
    expect(points.evaluate().toString()).toBe('[1,2]');
  });

  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', { signature: `(${B}) -> unknown` });
    ce.assign('f', ce.parse('(P) \\mapsto P.x'));
    return ce;
  }

  test('a NaN element at a broadcastable point slot is an error on a short list', () => {
    // `NaN` is not an absent point: only `Missing` and `Undefined` are.
    const ce = engine();
    const value = ce
      .box(['f', ['List', ['Tuple', 1, 2], 'NaN', 'Missing']] as never)
      .evaluate();
    expect(value.at(1)?.toString()).toBe('1');
    expect(value.at(2)?.operator).toBe('Error');
    expect(value.at(2)?.toString()).toContain('incompatible-type');
    expect(value.at(3)?.symbol).toBe('Missing');
  });

  test('a NaN element at a broadcastable point slot is an error on a long list', async () => {
    // A list longer than `MAX_SIZE_EAGER_COLLECTION` is mapped lazily. Before,
    // the lazy map tested `IsMissing`, which is true for `NaN`, and so gave
    // `Missing` where the eager loop gives an `incompatible-type` error.
    const ce = engine();
    const n = MAX_SIZE_EAGER_COLLECTION + 20;
    const items = Array.from({ length: n }, (_, k) =>
      k === 1
        ? 'NaN'
        : k === 2
          ? 'Missing'
          : k === 3
            ? 'Undefined'
            : ['Tuple', k, 0]
    );
    const call = ce.box(['f', ['List', ...items]] as never);
    for (const value of [call.evaluate(), await call.evaluateAsync()]) {
      expect(value.count).toBe(n);
      expect(value.at(1)?.toString()).toBe('0');
      expect(value.at(2)?.operator).toBe('Error');
      expect(value.at(2)?.toString()).toContain('incompatible-type');
      expect(value.at(3)?.symbol).toBe('Missing');
      expect(value.at(4)?.symbol).toBe('Missing');
      expect(value.at(5)?.toString()).toBe('4');
    }
  });
});

describe('A LIST OF POINTS AT A POINT PARAMETER BESIDE unknown SLOTS THAT ANOTHER CALL READS', () => {
  // The map over the list calls, for each point, the definition that the
  // call on one point takes: the one with each parameter typed by its
  // argument. With the definition typed by the declaration, `D2` and `d2`
  // are `unknown`, and the call `C(D2, d2)` in the body declined, because
  // the interpreter maps `C` over a list argument.
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('C', 'function');
    ce.assign(
      'C',
      ce.box([
        'Function',
        ['Tuple', ['Divide', ['Subtract', 'D', 'd'], 2], 0],
        'D',
        'd',
      ])
    );
    ce.declare('n', {
      signature: `(${POINT}, unknown, unknown) -> ${POINT}`,
    });
    ce.assign(
      'n',
      ce.box([
        'Function',
        ['Add', 'q', ['C', 'D2', 'd2']],
        ['Typed', 'q', `'${POINT}'`],
        'D2',
        'd2',
      ])
    );
    return ce;
  }

  test('the call on one point (control)', () => {
    const ce = engine();
    const expr = ce.box(['n', ['Tuple', 1, 2], 4, 2]);
    expect(expr.evaluate().toString()).toBe('(2, 2)');
    const r = compile(expr, { to: 'javascript', fallback: false } as never)!;
    expect(r.run!({} as never)).toEqual([2, 2]);
  });

  test('the call over a list of points', () => {
    const ce = engine();
    const expr = ce.box([
      'n',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      4,
      2,
    ]);
    expect(expr.evaluate().toString()).toBe('[(2, 2),(4, 4)]');
    const r = compile(expr, { to: 'javascript', fallback: false } as never)!;
    expect(r.run!({} as never)).toEqual([
      [2, 2],
      [4, 4],
    ]);
  });

  test('a declared input at an unknown slot', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'n',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      'x',
      2,
    ]);
    const r = compile(expr, { to: 'javascript', fallback: false } as never)!;
    expect(r.run!({ x: 6 } as never)).toEqual([
      [3, 2],
      [5, 4],
    ]);
  });
});
