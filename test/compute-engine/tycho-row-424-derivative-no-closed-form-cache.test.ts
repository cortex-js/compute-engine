/**
 * Tycho ledger row 424: a derivative with no closed form was worked out again
 * every time a value that holds it was evaluated.
 *
 * The case: `h(t)` is the `join` of linear pieces, each read from a list of
 * points `P` at `⌈t⌉`, and the document asks for `D(PointY(h(u)), u)`. Two
 * causes made it slow:
 *
 * - The derivative had no closed form. `PointY` of a call is not a written-out
 *   point, so the differentiator used the generic chain rule. That rule reads
 *   `PointY` as an unknown scalar function: it multiplied the derivative of
 *   `h(u)`, a list of 29 points, by `PointY′(h(u))`, which built a result
 *   larger than the size limit, and the attempt declined after about 0.5 s.
 *   Since `D(h(u), u)` has a closed form (version 0.159.0, where the body of a
 *   user function is read from its literal), every attempt paid for that
 *   product. For a point-valued `g` that the limit does not stop, the rule
 *   gave a wrong tuple: `D(PointY(g(u)), u)` with `g(t) = (t, t²)` was
 *   `(PointY′(g(u)), 2u·PointY′(g(u)))` where it is `2u`.
 * - A `D` node whose evaluation declines was boxed again, with no record of
 *   the decline. Each later evaluation of the value (and each read of a
 *   function parameter that holds it) differentiated again: a function that
 *   reads its parameter `n` times paid about `n + 2` attempts.
 *
 * The fixes:
 *
 * - A point accessor (`PointX`, `PointY`, `PointZ`) and `At` with an index
 *   that does not depend on the variable are linear: the derivative is the
 *   accessor of the derivative of the container
 *   (`symbolic/derivative.ts`, `differentiateNode`).
 * - `PointY` of a list of symbolic points (`[At(P, ⌈u⌉), …]`, each typed
 *   `missing | tuple`) reads each point, as its type says, and does not index
 *   the list as one point (`isPointLike`, `library/collections.ts`).
 * - The `D` evaluate handler records a decline for the node, with the
 *   dependencies of the node (the binding and write version of each symbol it
 *   reads, through the bodies of the functions it calls), the `world` version
 *   and the fact-suppression side, and gives the node itself as its value. A
 *   later evaluation of the same node does not differentiate again while the
 *   record is valid (`withDeclinedDerivativeMemo`, `library/calculus.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';

/** The number of calls of `differentiate()` from outside its own module (the
 * `D` evaluate handler and the other entry points) while `run` runs. The
 * recursive calls inside the differentiator are not counted. */
function attempts(run: () => void): number {
  const spy = jest.spyOn(DerivativeModule, 'differentiate');
  try {
    run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

/** The row's setup, with `n` pieces. */
function pathEngine(n: number): ComputeEngine {
  const ce = new ComputeEngine();
  const points = Array.from({ length: 5 + n }, (_, i) => [
    'Tuple',
    i,
    (i * 7) % 5,
  ]);
  ce.declare('P', 'list');
  ce.assign('P', ce.box(['List', ...points]));
  const pieces = Array.from(
    { length: n },
    (_, k) =>
      `(1-\\operatorname{mod}(t,1))P[\\lceil t\\rceil+${k}]+\\operatorname{mod}(t,1)P[\\lceil t\\rceil+${k + 1}]`
  );
  ce.declare('h', 'function');
  ce.assign(
    'h',
    ce.parse(`t\\mapsto\\operatorname{join}(${pieces.join(',')})`)
  );
  return ce;
}

describe('the derivative of a point accessor of a call', () => {
  test('D(PointY(h(u)), u) of the row has a closed form, equal to a difference quotient', () => {
    const ce = pathEngine(4);
    const d = ce.box(['D', ['PointY', ['h', 'u']], 'u']).evaluate();
    expect(d.operator).toBe('List');
    expect(d.nops).toBe(4);
    // `h` is linear in `t` between two integers, so a difference quotient
    // inside (2, 3) is the derivative there.
    const y = (t: number) =>
      ce
        .box(['PointY', ['h', t]])
        .N()
        .ops!.map((x) => x.re);
    const quotient = y(2.6).map((v, i) => (v - y(2.4)[i]) / 0.2);
    const exact = d
      .subs({ u: 2.5 })
      .N()
      .ops!.map((x) => x.re);
    expect(exact).toEqual(quotient.map((q) => expect.closeTo(q, 9)));
    // P = [(0,0), (1,2), (2,4), (3,1), (4,3), (5,0), …], 1-based: at
    // ⌈2.5⌉ = 3 the pieces run from (2,4) to (3,1), (3,1) to (4,3), …
    expect(exact).toEqual([-3, 2, -3, 2]);
  });

  test('a point-valued function: the accessor of the derivative', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign('g', ce.parse('t\\mapsto (t, t^2)'));
    expect(ce.box(['D', ['PointY', ['g', 'u']], 'u']).evaluate().json).toEqual([
      'Multiply',
      2,
      'u',
    ]);
    expect(ce.box(['D', ['PointX', ['g', 'u']], 'u']).evaluate().json).toBe(1);
    expect(ce.box(['D', ['At', ['g', 'u'], 2], 'u']).evaluate().json).toEqual([
      'Multiply',
      2,
      'u',
    ]);
  });

  test('a function that gives a list of points', () => {
    const ce = new ComputeEngine();
    ce.declare('k', 'function');
    ce.assign('k', ce.parse('t\\mapsto [(t, t^2), (2t, t^3)]'));
    expect(
      ce
        .box(['D', ['PointY', ['k', 'u']], 'u'])
        .evaluate()
        .toString()
    ).toBe('[2u,3u^2]');
    // A constant list of points: every coordinate has the derivative 0.
    ce.declare('c', 'function');
    ce.assign('c', ce.parse('t\\mapsto [(1, 2), (3, 4)]'));
    expect(
      ce
        .box(['D', ['PointY', ['c', 'u']], 'u'])
        .evaluate()
        .toString()
    ).toBe('[0,0]');
  });
});

describe('a point accessor of a list of symbolic points', () => {
  test('reads each point, as its type says', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list');
    ce.assign('P', ce.parse('[(1,2),(3,4),(5,6)]'));
    const e = ce.box([
      'PointY',
      ['List', ['At', 'P', ['Ceil', 'u']], ['At', 'P', 2], ['At', 'P', 3]],
    ]);
    expect(e.type.toString()).toBe('list<missing | number>');
    const v = e.evaluate();
    // It was `(3, 4)`, the second element, read as the y of one point.
    expect(v.operator).toBe('List');
    expect(v.nops).toBe(3);
    expect(v.ops![0].operator).toBe('PointY');
    expect(v.ops!.slice(1).map((x) => x.re)).toEqual([4, 6]);
    expect(v.subs({ u: 1 }).evaluate().json).toEqual(['List', 2, 4, 6]);
  });

  test('PointZ of 2-D points that may be absent is a dimension error', () => {
    // The arity of a point typed `missing | tuple<…>` is that of its tuple
    // arm. It gave `[PointZ(At(P, ⌈u⌉)), NaN]`.
    const ce = new ComputeEngine();
    ce.declare('P', 'list');
    ce.assign('P', ce.parse('[(1,2),(3,4),(5,6)]'));
    for (const list of [
      ['List', ['At', 'P', ['Ceil', 'u']], ['At', 'P', 2]],
      ['List', ['At', 'P', 2], ['At', 'P', ['Ceil', 'u']]],
    ]) {
      const v = ce.box(['PointZ', list]).evaluate();
      expect(v.operator).toBe('Error');
      expect(v.toString()).toContain('incompatible-dimensions');
    }
  });
});

describe('the derivative of an accessor of a list that holds constant points', () => {
  // The values of an expression of `u`, at `u = a`, as a flat list of
  // numbers.
  function valuesAt(ce: ComputeEngine, expr: unknown, a: number): number[] {
    const v = ce
      .box(expr as never)
      .subs({ u: a })
      .N();
    const flat = (e: typeof v): number[] =>
      e.operator === 'List' || e.operator === 'Tuple'
        ? e.ops!.flatMap(flat)
        : [e.re];
    return flat(v);
  }

  // The derivative of `expr` at `a`, from the closed form and from a central
  // difference quotient of the interpreter.
  function check(ce: ComputeEngine, expr: unknown, a: number): number[] {
    const d = ce.box(['D', expr, 'u'] as never).evaluate();
    expect(d.operator).not.toBe('D');
    const exact = valuesAt(ce, d.json, a);
    const h = 1e-6;
    const plus = valuesAt(ce, expr, a + h);
    const minus = valuesAt(ce, expr, a - h);
    expect(exact).toEqual(
      plus.map((p, i) => expect.closeTo((p - minus[i]) / (2 * h), 5))
    );
    return exact;
  }

  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('Q', 'tuple<integer, integer>');
    ce.assign('Q', ce.parse('(1,2)'));
    ce.declare('R', 'tuple<integer, integer>');
    ce.assign('R', ce.parse('(3,4)'));
    ce.declare('P', 'list');
    ce.assign('P', ce.parse('[(1,2),(3,5),(4,7)]'));
    const functions: Record<string, string> = {
      k: 't\\mapsto [(t,t^2), Q]',
      k1: 't\\mapsto [Q, (t,t^2)]',
      k2: 't\\mapsto [Q, R]',
      k3: 't\\mapsto [Q, R, (t,t)]',
      hh: 't\\mapsto [(1-t)P[1] + tP[2], P[3]]',
      L: 't\\mapsto [t,t^2,t^3]',
      n: 't\\mapsto \\lceil t\\rceil',
    };
    for (const [name, body] of Object.entries(functions)) {
      ce.declare(name, 'function');
      ce.assign(name, ce.parse(body));
    }
    ce.declare('U', 'function');
    ce.assign(
      'U',
      ce.box([
        'Function',
        ['If', ['Greater', 't', 0], ['Tuple', 't', 1], 'Q'],
        't',
      ])
    );
    return ce;
  }

  test('a constant point is a zero point, not the scalar 0', () => {
    const ce = engine();
    // Each closed form was a wrong value: `[2u, Missing]`, the point
    // `(1, 2u)`, `0`, `0`, `[3, Missing]`, `0`.
    expect(check(ce, ['PointY', ['k', 'u']], 0.7)).toEqual([1.4, 0]);
    expect(check(ce, ['PointY', ['k1', 'u']], 0.7)).toEqual([0, 1.4]);
    expect(check(ce, ['PointX', ['k1', 'u']], 0.7)).toEqual([0, 1]);
    expect(check(ce, ['PointY', ['k3', 'u']], 0.7)).toEqual([0, 0, 1]);
    expect(check(ce, ['PointY', ['hh', 'u']], 0.7)).toEqual([3, 0]);
    expect(check(ce, ['PointY', ['k2', 'u']], 0.7)).toEqual([0, 0]);
  });

  test('At of a constant point is the zero point', () => {
    const ce = engine();
    expect(check(ce, ['At', ['k1', 'u'], 1], 0.7)).toEqual([0, 0]);
    expect(check(ce, ['At', ['k1', 'u'], 2], 0.7)).toEqual([1, 1.4]);
  });

  test('a piecewise point function with a constant arm', () => {
    const ce = engine();
    for (const a of [-0.5, 0.5]) {
      check(ce, ['PointX', ['U', 'u']], a);
      check(ce, ['PointY', ['U', 'u']], a);
    }
  });

  test('At with an index that is constant between its jumps', () => {
    // `⌈u⌉` depends on `u`, and its derivative is `0`. It gave
    // `Apply(Derivative("At", 1, 0), …)` terms.
    const ce = engine();
    const d = ce.box(['D', ['At', ['L', 'u'], ['n', 'u']], 'u']).evaluate();
    expect(d.toString()).toBe('At([1,2u,3u^2], ceil(u))');
    expect(check(ce, ['At', ['L', 'u'], ['n', 'u']], 1.3)).toEqual([
      expect.closeTo(2.6, 12),
    ]);
    expect(check(ce, ['At', ['L', 'u'], ['n', 'u']], 2.4)).toEqual([
      expect.closeTo(3 * 2.4 ** 2, 12),
    ]);
  });
});

describe('a derivative with no closed form is not worked out again', () => {
  /** A function whose body is the lazy operator `ND` (a numeric derivative,
   * here `a·t`): the differentiator declines it, so `D(w(u), u)` has no
   * closed form. */
  function decliningFunction(free: string): unknown {
    return [
      'Function',
      ['ND', ['Function', ['Multiply', free, 'x', 't'], 'x'], 1],
      't',
    ];
  }

  function decliningEngine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 2);
    ce.declare('w', 'function');
    ce.assign('w', ce.box(decliningFunction('a') as never));
    return ce;
  }

  test('its value, evaluated again, does not differentiate again', () => {
    const ce = decliningEngine();
    const d = ce.box(['D', ['w', 'u'], 'u']);
    let value = d;
    expect(attempts(() => (value = d.evaluate()))).toBe(1);
    expect(value.operator).toBe('D');
    expect(
      attempts(() => {
        for (let i = 0; i < 5; i++) value = value.evaluate();
      })
    ).toBe(0);
    expect(value.isSame(d)).toBe(true);
  });

  test('a function that reads its parameter several times differentiates once', () => {
    const ce = decliningEngine();
    for (const n of [1, 3, 9]) {
      ce.declare(`f_${n}`, 'function');
      ce.assign(
        `f_${n}`,
        ce.parse(
          `p\\mapsto ${Array.from({ length: n }, () => 'p.x').join('+')}`
        )
      );
    }
    for (const n of [1, 3, 9]) {
      let result = ce.box(0);
      const count = attempts(() => {
        result = ce
          .box([`f_${n}`, ['Tuple', ['D', ['w', 'u'], 'u'], 0, 0]])
          .evaluate();
      });
      // It was n + 2 before the record of the decline.
      expect(count).toBe(1);
      expect(result.toString()).toContain('D');
    }
  });

  test('a new definition of the function: the derivative closes', () => {
    const ce = decliningEngine();
    const value = ce.box(['D', ['w', 'u'], 'u']).evaluate();
    expect(value.operator).toBe('D');
    ce.assign('w', ce.parse('t\\mapsto t^2'));
    let closed = value;
    expect(attempts(() => (closed = value.evaluate()))).toBe(1);
    expect(closed.json).toEqual(['Multiply', 2, 'u']);
  });

  test('a value write to a symbol the function reads: the derivative is worked out again', () => {
    const ce = decliningEngine();
    const value = ce.box(['D', ['w', 'u'], 'u']).evaluate();
    expect(attempts(() => value.evaluate())).toBe(0);
    ce.assign('a', 3);
    expect(attempts(() => value.evaluate())).toBe(1);
    expect(attempts(() => value.evaluate())).toBe(0);
  });

  test('a type written onto a symbol the function reads: the derivative is worked out again', () => {
    const ce = decliningEngine();
    ce.declare('b', 'real');
    ce.assign('w', ce.box(decliningFunction('b') as never));
    const value = ce.box(['D', ['w', 'u'], 'u']).evaluate();
    expect(attempts(() => value.evaluate())).toBe(0);
    ce.box('b').type = 'integer';
    expect(attempts(() => value.evaluate())).toBe(1);
  });

  test('an assumption: the derivative is worked out again', () => {
    const ce = decliningEngine();
    const value = ce.box(['D', ['w', 'u'], 'u']).evaluate();
    ce.assume(ce.parse('a > 0'));
    expect(attempts(() => value.evaluate())).toBe(1);
  });

  test('a derivative in the body of a function answers per call', () => {
    // The `D` node is one node of the body of `G`, shared by every call. Its
    // operand reads the parameter `f`, which each call binds to another
    // function: a decline recorded in one call is not served in another.
    const ce = decliningEngine();
    ce.declare('v', 'function');
    ce.assign('v', ce.parse('t\\mapsto t^3'));
    ce.declare('G', 'function');
    ce.assign('G', ce.box(['Function', ['D', ['Apply', 'f', 'u'], 'u'], 'f']));
    expect(ce.box(['G', 'w']).evaluate().operator).toBe('D');
    expect(ce.box(['G', 'v']).evaluate().json).toEqual([
      'Multiply',
      3,
      ['Power', 'u', 2],
    ]);
    expect(ce.box(['G', 'w']).evaluate().operator).toBe('D');
  });

  test('a type written onto the differentiation variable: the derivative is worked out again', () => {
    // The variable is bound by the `D` node, so the dependencies of the
    // node leave it out; the record keeps its definition and write version.
    const ce = new ComputeEngine();
    const d = ce.box(['D', ['Abs', 'x'], 'x']);
    const x = d.ops![1];
    x.valueDefinition!.type = ce.type('tuple<real, real>');
    const value = d.evaluate();
    expect(value.toString()).toBe('D(|x|, x)');
    expect(attempts(() => value.evaluate())).toBe(0);
    x.valueDefinition!.type = ce.type('real');
    let closed = value;
    expect(attempts(() => (closed = value.evaluate()))).toBe(1);
    expect(closed.json).toEqual(['Sign', 'x']);
  });

  test('a decline inside another differentiation is not recorded', () => {
    // A `D` in the operand of a `D` is evaluated while the enclosing
    // differentiation runs, and shares its size budget: its decline can
    // come from the nodes that the enclosing one built, so it is not kept.
    const ce = decliningEngine();
    const inner = ce.box(['D', ['w', 'u'], 'u']);
    // The second derivative: the differentiator evaluates `inner` and,
    // since it stays a `D`, declines. No result holds `inner`, so `inner`
    // is evaluated only inside the enclosing differentiation.
    const outer = ce.function('D', [inner, ce.symbol('u')]);
    expect(outer.op1).toBe(inner);
    let value = outer;
    expect(attempts(() => (value = outer.evaluate()))).toBe(2);
    expect(value.operator).toBe('D');
    // The decline of `inner`, made inside the enclosing differentiation, is
    // not served: `inner` evaluated alone is worked out, then recorded.
    expect(attempts(() => inner.evaluate())).toBe(1);
    expect(attempts(() => inner.evaluate())).toBe(0);
  });
});
