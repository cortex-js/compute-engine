import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import * as limitProbe from '../../src/compute-engine/symbolic/limit';
import { uncachedHostCallCount } from '../../src/compute-engine/boxed-expression/host-handler-changes';
import {
  _mapAutoCompileStats as mapStats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';
import {
  exactComplexParts,
  exactZeroVerdict,
} from '../../src/compute-engine/symbolic/contour';

/**
 * ROADMAP CE-601: an expression that uses one node object at several places
 * (built with `ce.function()`) was evaluated once per PATH to the node, so
 * `Max(t, t)` nested 30 deep (31 distinct nodes, 2^30 paths) did not end.
 * One top-level evaluation now remembers the result of each pure node, per
 * evaluation frame, until a state change (`shared-evaluation-memo.ts`).
 *
 * A jest time limit cannot stop a synchronous test, so the time is measured
 * with `performance.now()` and compared to a generous limit.
 */

/** `Max(t, t)` nested `depth` deep over `leaf`: every level holds the same
 * node twice. */
function tower(ce: ComputeEngine, leaf: Expression, depth: number): Expression {
  let t = leaf;
  for (let i = 0; i < depth; i++) t = ce.function('Max', [t, t]);
  return t;
}

function timed<T>(f: () => T): [T, number] {
  const start = performance.now();
  const result = f();
  return [result, performance.now() - start];
}

describe('CE-601: SHARED NODES ARE EVALUATED ONCE', () => {
  test('A tower of 2^30 paths over x + y, exact and numeric', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    ce.assign('y', 3);
    const t = tower(
      ce,
      ce.function('Add', [ce.symbol('x'), ce.symbol('y')]),
      30
    );
    const [exact, exactMs] = timed(() => t.evaluate());
    expect(exact.json).toEqual(5);
    expect(exactMs).toBeLessThan(2000);
    const [numeric, numericMs] = timed(() => t.N());
    expect(numeric.re).toEqual(5);
    expect(numericMs).toBeLessThan(2000);
  });

  test('The exact and the numeric results are kept apart', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    ce.assign('y', 3);
    const q = ce.function('Divide', [ce.symbol('x'), ce.symbol('y')]);
    // The same node `q` is read exactly, under `N`, and exactly again.
    const l = ce.function('List', [q, ce.function('N', [q]), q]);
    expect(l.evaluate().toString()).toBe('[2/3,0.666666666666666666667,2/3]');
    // A requested precision is part of the key too.
    const s = ce.function('Sqrt', [ce.symbol('x')]);
    const p = ce.function('List', [
      ce.function('N', [s, ce.number(30)]),
      s,
      ce.function('N', [s]),
    ]);
    expect(p.evaluate().toString()).toBe(
      '[1.41421356237309504880168872421,sqrt(2),1.4142135623730950488]'
    );
  });

  test('A recursive function whose body is a tower', () => {
    const ce = new ComputeEngine();
    const n = ce.symbol('n');
    // r(n) = If(n < 1, 0, r(n - 1)), its body a tower of 2^30 paths.
    const leaf = ce.function('If', [
      ce.function('Less', [n, ce.number(1)]),
      ce.number(0),
      ce.function('r', [ce.function('Subtract', [n, ce.number(1)])]),
    ]);
    ce.assign('r', ce.function('Function', [tower(ce, leaf, 30), n]));
    for (const arg of [0, 1, 4]) {
      const [result, ms] = timed(() => ce.box(['r', arg]).evaluate());
      expect(result.json).toEqual(0);
      expect(ms).toBeLessThan(2000);
    }
  });

  test('A recursive call does not reuse the results of its caller', () => {
    const ce = new ComputeEngine();
    const n = ce.symbol('n');
    // r(n) = If(n < 1, n, n + r(n - 1)) = n(n + 1)/2. The body nodes are
    // the same in each call, with another value of `n`.
    const leaf = ce.function('If', [
      ce.function('Less', [n, ce.number(1)]),
      n,
      ce.function('Add', [
        n,
        ce.function('r', [ce.function('Subtract', [n, ce.number(1)])]),
      ]),
    ]);
    ce.assign('r', ce.function('Function', [tower(ce, leaf, 4), n]));
    expect([0, 1, 2, 5].map((k) => ce.box(['r', k]).evaluate().json)).toEqual([
      0, 1, 3, 15,
    ]);
  });

  test('Calls of one function with different arguments', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('x \\mapsto x^2+1'));
    ce.assign('g', ce.parse('y \\mapsto f(y)+f(y+1)'));
    // g(1) = 2 + 5, g(2) = 5 + 10, g(3) = 10 + 17, f(27) = 730.
    const e = ce.parse('g(1)+g(2)+f(g(3))');
    expect(e.evaluate().json).toEqual(752);
    expect(e.N().re).toEqual(752);
  });

  test('A Sum whose body is shared', () => {
    const ce = new ComputeEngine();
    const k = ce.symbol('k');
    // B = 8 k^2, as a tower of three `Add(B, B)` over `k^2`.
    let b: Expression = ce.function('Power', [k, ce.number(2)]);
    for (let i = 0; i < 3; i++) b = ce.function('Add', [b, b]);
    const sum = (hi: number) =>
      ce.function('Sum', [
        b,
        ce.function('Limits', [k, ce.number(1), ce.number(hi)]),
      ]);
    // The index changes between two evaluations of the same body node.
    expect(sum(4).evaluate().json).toEqual(240);
    expect(sum(4).N().re).toEqual(240);
    // The same body in two sums of one evaluation.
    const s4 = sum(4);
    const l = ce.function('List', [s4, sum(2), s4]);
    expect(l.evaluate().json).toEqual(['List', 240, 40, 240]);
  });

  test('An assignment between two reads of a shared node', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    const xp1 = ce.function('Add', [ce.symbol('x'), ce.number(1)]);
    const b = ce.function('Block', [
      ce.function('Assign', [ce.symbol('y'), xp1]),
      ce.function('Assign', [ce.symbol('x'), ce.number(5)]),
      ce.function('List', [ce.symbol('y'), xp1]),
    ]);
    expect(b.evaluate().json).toEqual(['List', 2, 6]);

    // The assignment is deeper than the two reads.
    ce.assign('x', 1);
    const l = ce.function('List', [
      xp1,
      ce.function('Block', [
        ce.function('If', [
          ce.symbol('True'),
          ce.function('Assign', [ce.symbol('x'), ce.number(7)]),
          ce.number(0),
        ]),
      ]),
      xp1,
    ]);
    expect(l.evaluate().json).toEqual(['List', 2, 7, 8]);
  });

  test('An assignment made by a host handler between two reads', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare('SetX', {
      signature: '() -> integer',
      evaluate: () => {
        ce.assign('x', 10);
        return ce.number(0);
      },
    });
    const xp1 = ce.function('Add', [ce.symbol('x'), ce.number(1)]);
    const l = ce.function('List', [xp1, ce.function('SetX', []), xp1]);
    expect(l.evaluate().json).toEqual(['List', 2, 0, 11]);
  });

  test('A shared Random() node is drawn at each occurrence', () => {
    const ce = new ComputeEngine();
    const r = ce.function('Random', []);
    // 2^4 occurrences of one node: 16 draws, all distinct.
    let t: Expression = r;
    for (let i = 0; i < 4; i++) t = ce.function('List', [t, t]);
    const draws = JSON.stringify(t.evaluate().json).match(/[0-9.]+(e-?\d+)?/g);
    expect(new Set(draws).size).toEqual(16);
  });

  test('A shared host operator declared impure is evaluated at each occurrence', () => {
    const ce = new ComputeEngine();
    let count = 0;
    ce.declare('Count', {
      signature: '() -> integer',
      pure: false,
      evaluate: () => ce.number(++count),
    });
    const c = ce.function('Count', []);
    expect(ce.function('List', [c, c]).evaluate().json).toEqual(['List', 1, 2]);
  });
  test('A shared node is evaluated again inside a transient angular unit', () => {
    // `_withTransientAngularUnit` (used by the symbolic integrator, which
    // works in radians) changes the unit with no state event and no new
    // frame. `InRadians` evaluates its operand in such a window.
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    ce.declare('InRadians', {
      signature: '(any) -> any',
      lazy: true,
      evaluate: ([x], { engine }) =>
        engine._withTransientAngularUnit('rad', () => x.N()),
    });
    const s = ce.function('Sin', [ce.number(30.0)]);
    const l = ce.function('List', [s, ce.function('InRadians', [s]), s]);
    const v = l.N().ops!.map((x) => x.re);
    expect(v[0]).toBeCloseTo(0.5, 10);
    expect(v[1]).toBeCloseTo(Math.sin(30), 10);
    expect(v[2]).toBeCloseTo(0.5, 10);
  });

  test('A shared Monte Carlo estimate under two seeds', () => {
    // The estimate is pure, but its samples come from the `WithRandomSeed`
    // frame in force: the same node under two seeds has two values.
    const ce = new ComputeEngine();
    const q = ce.parse('N(\\int_0^1 \\frac{1}{\\sqrt{x}}\\sin(1/x) dx)');
    const seeded = (seed: number) =>
      ce.function('WithRandomSeed', [ce.number(seed), q]);
    const separate = [1, 2].map((k) => seeded(k).evaluate().re);
    expect(separate[0]).not.toEqual(separate[1]);
    const both = ce.function('List', [seeded(1), seeded(2)]).evaluate();
    expect(both.ops!.map((x) => x.re)).toEqual(separate);
  });

  test('A host handler that wrongly states pure and assigns an outer symbol inside a shared node', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    // `pure: true` is wrong: the handler adds 1 to `x`. The declaration must
    // not corrupt the results of the nodes around the call.
    ce.declare('IncX', {
      signature: '() -> integer',
      pure: true,
      evaluate: () => {
        ce.assign('x', (ce.symbol('x').value!.re as number) + 1);
        return ce.number(0);
      },
    });
    // n = 3x + IncX(): each read of `n` reads x, then adds 1 to it. `n` is
    // kept from its second read on, so three reads are needed.
    const n = ce.function('Add', [
      ce.function('Multiply', [ce.symbol('x'), ce.number(3)]),
      ce.function('IncX', []),
    ]);
    expect(ce.function('List', [n, n, n]).evaluate().json).toEqual([
      'List',
      3,
      6,
      9,
    ]);
  });
  test('A node that reads a symbol holding Random() is not kept', () => {
    // `isPure` of `r + 1` does not follow the value of `r`: the evaluation
    // of the stored `Random()` is an impure evaluation inside the node.
    const ce = new ComputeEngine();
    ce.assign('r', ce.function('Random', []));
    const t = ce.function('Add', [ce.symbol('r'), ce.number(1)]);
    const v = ce.function('List', [t, t]).evaluate();
    expect(v.ops![0].re).not.toEqual(v.ops![1].re);
  });

  test('A host handler that declares a value for a symbol', () => {
    const ce = new ComputeEngine();
    const t = ce.function('Add', [ce.symbol('x'), ce.number(1)]);
    ce.declare('SetX', {
      signature: '() -> integer',
      pure: true,
      evaluate: () => {
        ce.declare('x', { value: 10 });
        return ce.number(0);
      },
    });
    // `t` is kept from its second read on, so it is read twice before.
    const l = ce.function('List', [t, t, ce.function('SetX', []), t]);
    expect(l.evaluate().json).toEqual([
      'List',
      ['Add', 'x', 1],
      ['Add', 'x', 1],
      0,
      11,
    ]);
  });

  test('Remembered results still spend steps of a step budget', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    const t = ce.function('Add', [ce.symbol('x'), ce.number(1)]);
    // 100,000 reads of one shared node: one evaluation, then hits.
    const l = ce.function('List', new Array(100_000).fill(t));
    expect(() =>
      ce.withStepBudget({ steps: 10, label: 'test:ce-601' }, () => l.evaluate())
    ).toThrow();
  });

  test('An operator of a library that the host passes to the constructor', () => {
    // The library is bound in the system scope, like the standard ones, but
    // it is host code: an operator in it that does not state `pure: true`
    // is evaluated at each occurrence.
    let count = 0;
    const ce: ComputeEngine = new ComputeEngine({
      libraries: [
        'core',
        'arithmetic',
        'collections',
        {
          name: 'hostlib',
          requires: ['arithmetic'],
          definitions: {
            HostCount: {
              signature: '() -> integer',
              evaluate: () => ce.number(++count),
            },
          },
        },
      ],
    });
    const c = ce.function('HostCount', []);
    expect(ce.function('List', [c, c, c]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
  });

  test('The application memo of a function literal after a host handler changed state', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare('AddTen', {
      signature: '() -> integer',
      evaluate: () => {
        ce.assign('x', (ce.symbol('x').value!.re as number) + 10);
        return ce.number(0);
      },
    });
    // g(t) = x·t + AddTen(): each call reads x, then adds 10 to it.
    ce.assign(
      'g',
      ce.box(['Function', ['Add', ['Multiply', 'x', 't'], ['AddTen']], 't'])
    );
    // Three distinct nodes `g(1)`: the memo of the applications of `g` must
    // not give the first answer to the next two.
    const l = ce.box(['List', ['g', 1], ['g', 1], ['g', 1]]);
    expect(l.evaluate().json).toEqual(['List', 1, 11, 21]);
  });

  test('The application memo after a host handler that wrongly states pure changed state', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 1);
    ce.declare('AddTen', {
      signature: '() -> integer',
      pure: true,
      evaluate: () => {
        ce.assign('x', (ce.symbol('x').value!.re as number) + 10);
        return ce.number(0);
      },
    });
    ce.assign(
      'g',
      ce.box(['Function', ['Add', ['Multiply', 'x', 't'], ['AddTen']], 't'])
    );
    const l = ce.box(['List', ['g', 1], ['g', 1], ['g', 1]]);
    expect(l.evaluate().json).toEqual(['List', 1, 11, 21]);
  });
  test('A declaration into an ancestor scope of a lower frame', () => {
    // The frame of the expression reads `y` through the scope `s1`, which is
    // not the scope of a frame. The call `h()` is on top of the stack, with
    // a chain that does not hold `s1`, when `Poke` declares `y` there.
    const ce = new ComputeEngine();
    ce.assign('y', 1);
    const s1 = { parent: ce.context.lexicalScope, bindings: new Map() };
    ce.declare('Poke', {
      signature: '() -> integer',
      pure: true,
      evaluate: () => {
        ce.declare('y', { value: 10 }, s1);
        return ce.number(0);
      },
    });
    ce.assign('h', ce.box(['Function', ['Poke']]));
    const t = ce.function('Add', [ce.symbol('y'), ce.number(1)]);
    // `t` is kept from its second read on, so it is read twice before `h()`.
    const l = ce.function('List', [t, t, ce.function('h', []), t]);
    ce.pushScope({ parent: s1, bindings: new Map() });
    try {
      expect(l.evaluate().json).toEqual(['List', 2, 2, 0, 11]);
    } finally {
      ce.popScope();
    }
  });

  test('A host handler that evaluates a Sum is not a change of state', () => {
    // The index of the `Sum` is written in the scope of the `Sum`, gone when
    // the handler returns: a tower over the handler stays linear.
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    ce.declare('G', {
      signature: '(number) -> number',
      pure: true,
      evaluate: ([a]) =>
        ce
          .box(['Sum', ['Multiply', a.json, 'k'], ['Limits', 'k', 1, 10]])
          .evaluate(),
    });
    let t: Expression = ce.function('G', [ce.symbol('x')]);
    for (let i = 0; i < 16; i++)
      t = ce.function('Max', [t, ce.function('Add', [t, ce.number(1)])]);
    const [result, ms] = timed(() => t.evaluate());
    expect(result.json).toEqual(126);
    expect(ms).toBeLessThan(1000);
  });
  test('A host operator is cached only when it states pure: true', () => {
    const ce = new ComputeEngine();
    let count = 0;
    ce.declare('Count', {
      signature: '() -> integer',
      evaluate: () => ce.number(++count),
    });
    let stated = 0;
    ce.declare('Stated', {
      signature: '() -> integer',
      pure: true,
      evaluate: () => ce.number(++stated),
    });
    // One shared node read three times: the first read marks it, the second
    // computes it again and keeps it, the third is a hit.
    const c = ce.function('Count', []);
    expect(ce.function('List', [c, c, c]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
    const s = ce.function('Stated', []);
    expect(ce.function('List', [s, s, s]).evaluate().json).toEqual([
      'List',
      1,
      2,
      2,
    ]);
  });

  test('A function literal over a host handler that reads a symbol by name', () => {
    const ce = new ComputeEngine();
    // `R(a)` reads the value of `x` by name, which the dependency snapshot of
    // the application memo of `g` does not record. `R` does not state
    // `pure: true`, so the applications of `g` are not memoized.
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.assign('g', ce.box(['Function', ['R', 'n'], 'n']));
    ce.assign('x', 1);
    expect(ce.box(['g', 1]).evaluate().json).toEqual(2);
    ce.assign('x', 100);
    expect(ce.box(['g', 1]).evaluate().json).toEqual(101);
  });

  test('A shared estimate under an entropy handler that withEffects() installs', () => {
    const ce = new ComputeEngine();
    // `WithEntropy` evaluates its operand with a constant entropy handler.
    ce.declare('WithEntropy', {
      signature: '(any) -> any',
      lazy: true,
      pure: true,
      evaluate: ([x], { engine }) =>
        engine.withEffects({ entropy: { random: () => 0.25 } }, () =>
          x.evaluate()
        ),
    });
    // An unseeded Monte Carlo estimate: pure for the effects model, but it
    // draws through the `entropy` handler of the evaluation.
    const q = ce.parse('N(\\int_0^1 \\frac{1}{\\sqrt{x}}\\sin(1/x) dx)');
    const alone = ce.function('WithEntropy', [q]).evaluate().toString();
    const l = ce
      .function('List', [q, q, ce.function('WithEntropy', [q])])
      .evaluate();
    expect(l.ops![2].toString()).toEqual(alone);
  });

  test('A collection handler of a host operator that wrongly states pure', () => {
    // The library `At` calls the `at` handler of `Sq`, which adds 1 to `x`.
    const ce = new ComputeEngine();
    ce.assign('x', 0);
    ce.declare('Sq', {
      signature: '(integer) -> list<integer>',
      pure: true,
      collection: {
        isLazy: () => true,
        count: () => Infinity,
        iterator: () => {
          let i = 0;
          return {
            next: () => {
              i += 1;
              return { value: ce.number(i * i), done: false };
            },
          };
        },
        isFinite: () => false,
        at: (_expr, i) => {
          ce.assign('x', (ce.symbol('x').value!.re as number) + 1);
          return ce.number((i as number) * (i as number));
        },
      },
    });
    const p = ce.function('Add', [
      ce.symbol('x'),
      ce.function('At', [ce.function('Sq', [ce.number(1)]), ce.number(2)]),
    ]);
    expect(ce.function('List', [p, p, p, p]).evaluate().json).toEqual([
      'List',
      4,
      5,
      6,
      7,
    ]);
  });

  test('A pure host operator over a comprehension, with an assignment between two reads', () => {
    const ce = new ComputeEngine();
    ce.declare('total', {
      signature: '(any) -> any',
      pure: true,
      evaluate: (ops) => ce.function('Sum', ops).evaluate(),
    });
    const comprehension = [
      'Comprehension',
      ['Multiply', 'a', 'k'],
      ['Element', 'k', ['Range', 1, 3]],
    ];
    // Directly, and through a stored literal, with `a` assigned between two
    // top-level evaluations.
    const direct = ce.box(['total', comprehension]);
    ce.assign('G', ce.box(['Function', ['total', comprehension]]));
    ce.assign('a', 1);
    expect(direct.evaluate().json).toEqual(6);
    expect(ce.box(['G']).evaluate().json).toEqual(6);
    ce.assign('a', 5);
    expect(direct.evaluate().json).toEqual(30);
    expect(ce.box(['G']).evaluate().json).toEqual(30);
    // In one evaluation: a shared node read twice before the assignment.
    ce.assign('a', 1);
    const t = ce.box(['total', comprehension]);
    const l = ce.function('List', [t, t, ce.box(['Assign', 'a', 5]), t]);
    expect(l.evaluate().json).toEqual(['List', 6, 6, 5, 30]);
  });
  test('The asynchronous route: a host operator that reads a symbol by name', async () => {
    const ce = new ComputeEngine();
    // `R` and `RA` read `x` by name and do not state their purity: no memo
    // keeps a result that depends on them, on either route.
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.declare('RA', {
      signature: '(number) -> number',
      evaluateAsync: async ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.assign('g', ce.box(['Function', ['R', 'n'], 'n']));
    ce.assign('ga', ce.box(['Function', ['RA', 'n'], 'n']));
    ce.assign('x', 1);
    expect((await ce.box(['g', 1]).evaluateAsync()).json).toEqual(2);
    expect((await ce.box(['ga', 1]).evaluateAsync()).json).toEqual(2);
    ce.assign('x', 100);
    expect((await ce.box(['g', 1]).evaluateAsync()).json).toEqual(101);
    expect(ce.box(['g', 1]).evaluate().json).toEqual(101);
    expect((await ce.box(['ga', 1]).evaluateAsync()).json).toEqual(101);
  });

  test('The memo of an inert value: a host operator with a symbolic result', () => {
    const ce = new ComputeEngine();
    let count = 0;
    ce.declare('H', {
      signature: '() -> number',
      evaluate: () => ce.box(['Add', 'x', ++count]),
    });
    ce.declare('x', 'real');
    const h = ce.function('H', []);
    expect(h.evaluate().json).toEqual(['Add', 'x', 1]);
    expect(h.evaluate().json).toEqual(['Add', 'x', 2]);
    expect(h.evaluate().json).toEqual(['Add', 'x', 3]);
  });

  test('The element memo: a host operator that reads a symbol by name', () => {
    const ce = new ComputeEngine();
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.assign(
      'L',
      ce.box(['Map', ['Function', ['R', 'k'], 'k'], ['Range', 1, 3]])
    );
    ce.assign('x', 1);
    expect(ce.box(['At', 'L', 2]).evaluate().json).toEqual(3);
    ce.assign('x', 100);
    expect(ce.box(['At', 'L', 2]).evaluate().json).toEqual(102);
  });

  test('The application memo and a collection handler that wrongly states pure', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 0);
    ce.declare('Sq', {
      signature: '(integer) -> list<integer>',
      pure: true,
      collection: {
        isLazy: () => true,
        count: () => Infinity,
        isFinite: () => false,
        iterator: () => {
          let i = 0;
          return {
            next: () => {
              i += 1;
              return { value: ce.number(i * i), done: false };
            },
          };
        },
        at: (_expr, i) => {
          ce.assign('x', (ce.symbol('x').value!.re as number) + 1);
          return ce.number((i as number) * (i as number));
        },
      },
    });
    ce.assign(
      'g',
      ce.box(['Function', ['Add', 'x', ['At', ['Sq', 'n'], 2]], 'n'])
    );
    // Two distinct nodes `g(1)`: each reads x, then the `at` handler adds 1.
    const l = ce.box(['List', ['g', 1], ['g', 1]]);
    expect(l.evaluate().json).toEqual(['List', 4, 5]);
  });

  test('A custom library that defines a standard name does not make the standard operator host code', () => {
    // The custom `Sin` is refused (the standard library keeps the name): the
    // standard `Sin` stays library code, and a shared `Sin` is evaluated once.
    let ce: ComputeEngine | undefined;
    try {
      ce = new ComputeEngine({
        libraries: [
          'core',
          'arithmetic',
          'trigonometry',
          'collections',
          {
            name: 'hostlib',
            requires: ['trigonometry'],
            definitions: {
              Sin: {
                signature: '(number) -> number',
                evaluate: () => undefined,
              },
            },
          },
        ],
      });
    } catch {
      // The refusal can be reported as an error: the engine is built anyway
      // below with the standard libraries only, which keeps the test about
      // the classification.
    }
    ce ??= new ComputeEngine();
    ce.assign('x', 0.5);
    const t = tower(ce, ce.function('Sin', [ce.symbol('x')]), 20);
    const [, ms] = timed(() => t.N());
    expect(ms).toBeLessThan(1000);
  });

  test('A standard definition reused under another name stays library code', () => {
    const ce = new ComputeEngine();
    ce.declare('MySin', ce.lookupDefinition('Sin')!.operator!);
    ce.assign('x', 0.5);
    // An application of `MySin` is evaluated first: it must not change the
    // classification of the shared `Sin` definition.
    ce.function('MySin', [ce.symbol('x')]).N();
    const t = tower(ce, ce.function('Sin', [ce.symbol('x')]), 20);
    const [, ms] = timed(() => t.N());
    expect(ms).toBeLessThan(1000);
  });

  test('The stored-value memo of a symbol: a host operator that reads a symbol by name', () => {
    const ce = new ComputeEngine();
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.assign('x', 1);
    ce.assign('v', ce.box(['R', 1], { form: 'raw' }));
    expect(ce.symbol('v').evaluate().json).toEqual(2);
    expect(ce.symbol('v').N().json).toEqual(2);
    ce.assign('x', 100);
    expect(ce.symbol('v').evaluate().json).toEqual(101);
    expect(ce.symbol('v').N().json).toEqual(101);
  });

  test('The element memo: an unstated host collection that only reads outside state', () => {
    const ce = new ComputeEngine();
    let offset = 0;
    ce.declare('S', {
      signature: '() -> list<integer>',
      collection: {
        elementMemo: true,
        count: () => 3,
        isFinite: () => true,
        iterator: () => {
          let i = 0;
          return {
            next: () =>
              i < 3
                ? { value: ce.number(++i + offset), done: false }
                : { value: undefined, done: true },
          };
        },
        at: (_expr, i) => ce.number((i as number) + offset),
      },
    });
    const s = ce.function('S', []);
    expect(s.at(1)?.json).toEqual(1);
    offset = 100;
    expect(s.at(1)?.json).toEqual(101);
    expect([...s.each()].map((x) => x.json)).toEqual([101, 102, 103]);
  });

  test('Collection handlers that are methods of a class', () => {
    const ce = new ComputeEngine();
    class Squares {
      count() {
        return 3;
      }
      isFinite() {
        return true;
      }
      *iterator() {
        for (let i = 1; i <= 3; i++) yield ce.number(this.square(i));
      }
      at(_expr: Expression, i: number | string) {
        return ce.number(this.square(i as number));
      }
      square(i: number) {
        return i * i;
      }
    }
    ce.declare('Sq3', {
      signature: '() -> list<integer>',
      collection: new Squares() as never,
    });
    expect(ce.box(['At', ['Sq3'], 2]).evaluate().json).toEqual(4);
    expect([...ce.box(['Sq3']).each()].map((x) => x.json)).toEqual([1, 4, 9]);
  });

  test('A standard operator extended with a description stays library code', () => {
    const ce = new ComputeEngine();
    ce.declare('Sin', { description: 'the sine' }, { extend: true });
    ce.assign('x', 0.5);
    const t = tower(ce, ce.function('Sin', [ce.symbol('x')]), 20);
    const [, ms] = timed(() => t.N());
    expect(ms).toBeLessThan(1000);
  });

  test('An extension of a host operator keeps its statement of purity', () => {
    const ce = new ComputeEngine();
    let count = 0;
    ce.declare('P', {
      signature: '(number) -> number',
      pure: true,
      evaluate: ([a]) => ce.number(a.re + ++count * 0),
    });
    ce.declare('P', { description: 'pure' }, { extend: true });
    // The first two visits of the shared node evaluate it, the third reads
    // the memo. A host operator with no statement of purity is evaluated
    // at each of the three visits.
    const p = ce.function('P', [ce.number(1)]);
    ce.function('List', [p, p, p]).evaluate();
    expect(count).toBe(2);
  });

  test('The sequence term memo: a recurrence over a host operator', () => {
    const ce = new ComputeEngine();
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + ce.symbol('x').value!.re),
    });
    ce.assign('x', 1);
    ce.declareSequence('A', {
      base: { 0: 0 },
      recurrence: 'A_{n-1} + R(n)',
    });
    // A_3 = (1 + 1) + (2 + 1) + (3 + 1) = 9
    expect(ce.parse('A_3').evaluate().json).toEqual(9);
    ce.assign('x', 100);
    // A_3 = 101 + 102 + 103 = 306
    expect(ce.parse('A_3').evaluate().json).toEqual(306);
  });

  test('A subscriptEvaluate handler that the host gives is host code', () => {
    const ce = new ComputeEngine();
    ce.declare('s', {
      subscriptEvaluate: (i) =>
        ce.number((i.re as number) + (ce.symbol('x').value!.re as number)),
    });
    ce.assign('x', 1);
    ce.assign('g', ce.box(['Function', ['Subscript', 's', 'n'], 'n']));
    expect(ce.box(['g', 1]).evaluate().json).toEqual(2);
    ce.assign('x', 100);
    expect(ce.box(['Subscript', 's', 1]).evaluate().json).toEqual(101);
    expect(ce.box(['g', 1]).evaluate().json).toEqual(101);
  });

  test('An extension of a host collection wraps the handlers that the host gave', () => {
    // `T` states no purity: each call of a collection handler is counted, and
    // no memo keeps an element. The extension states `pure: true`: the new
    // definition wraps the handlers that the host gave, so the element memo
    // keeps the element. If the new wrapper wrapped the old one, each call
    // would still be counted by the old wrapper.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('T', {
      signature: '() -> list<integer>',
      collection: {
        elementMemo: true,
        count: () => 2,
        isFinite: () => true,
        iterator: () => [ce.number(1), ce.number(2)][Symbol.iterator](),
        at: (_expr, i) => {
          calls += 1;
          return ce.number(i as number);
        },
      },
    });
    ce.declare('T', { pure: true }, { extend: true });
    const t = ce.function('T', []);
    expect(t.at(1)?.json).toEqual(1);
    expect(t.at(1)?.json).toEqual(1);
    expect(calls).toBe(1);
  });

  test('Every operator definition of a new engine is library code', () => {
    const ce = new ComputeEngine();
    const scope = ce.contextStack[0].lexicalScope;
    const host: string[] = [];
    for (const [name, def] of scope.bindings)
      if ('operator' in def && !def.operator._standardLibrary) host.push(name);
    expect(host).toEqual([]);
  });

  test('The compiled probes of Limit: a base that holds a host operator', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + m),
    });
    // e^(R(1)x)/x^3 with R(1) = 1 + m.
    const lim = ce.box([
      'Limit',
      [
        'Function',
        ['Divide', ['Exp', ['Multiply', ['R', 1], 'x']], ['Power', 'x', 3]],
        'x',
      ],
      'PositiveInfinity',
    ]);
    m = 1;
    expect(lim.evaluate().json).toEqual('PositiveInfinity');
    m = -3;
    expect(lim.evaluate().json).toEqual(0);
  });

  test('The exact parts memo of the contour code: a constant that holds a host operator', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + m),
    });
    const z = ce.box(['Add', ['R', 0], 'ImaginaryUnit']);
    expect(exactComplexParts(z)?.x.json).toEqual(1);
    m = 2;
    expect(exactComplexParts(z)?.x.json).toEqual(2);
  });

  test('The facet memo: the count of an unstated host collection', () => {
    const ce = new ComputeEngine();
    let n = 3;
    ce.declare('S', {
      signature: '() -> list<integer>',
      collection: {
        count: () => n,
        isFinite: () => true,
        iterator: () => {
          let i = 0;
          return {
            next: () =>
              i < n
                ? { value: ce.number(++i), done: false }
                : { value: undefined, done: true },
          };
        },
        at: (_expr, i) => ce.number(i as number),
      },
    });
    const s = ce.function('S', []);
    expect(s.count).toBe(3);
    n = 5;
    expect(s.count).toBe(5);
  });

  test('The materialized value of a host operator that returns a list', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('HL', {
      signature: '() -> list<integer>',
      evaluate: () => ce.box(['List', m, m + 1, m + 2]),
    });
    const h = ce.function('HL', []);
    expect(h.at(1)?.json).toEqual(1);
    m = 10;
    expect(h.at(1)?.json).toEqual(10);
  });

  test('The slice bounds memo: a span that holds a host operator', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + m),
    });
    const sl = ce.box(['Slice', ['List', 1, 2, 3, 4, 5], 1, ['R', 0]]);
    expect(sl.count).toBe(1);
    m = 3;
    expect(sl.count).toBe(3);
  });

  test('exactZeroVerdict() of a constant that holds a host operator follows the host state', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + m),
    });
    const z = ce.box(['Subtract', ['R', 0], 1]);
    expect(exactZeroVerdict(z)).toBe(true);
    m = 2;
    expect(exactZeroVerdict(z)).toBe(false);
  });

  test('The approximation memo of the comparisons: a constant whose value holds a host operator', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('R', {
      signature: '(number) -> number',
      evaluate: ([a]) => ce.number(a.re + m),
    });
    ce.declare('k', { value: ce.box(['R', 0.5]), isConstant: true });
    const lt = ce.box(['Less', 'k', 1.6]);
    expect(lt.evaluate().json).toEqual('True');
    m = 2;
    expect(lt.evaluate().json).toEqual('False');
  });

  test('The compiled probes of Limit are not kept across an assignment', () => {
    const ce = new ComputeEngine();
    // The limit of e^(ax)/x^3 is +oo for a = 2 and 0 for a = -2: a probe
    // compiled with a = 2 decided the second limit.
    const lim = ce.box([
      'Limit',
      [
        'Function',
        ['Divide', ['Exp', ['Multiply', 'a', 'x']], ['Power', 'x', 3]],
        'x',
      ],
      'PositiveInfinity',
    ]);
    ce.assign('a', 2);
    expect(lim.evaluate().json).toEqual('PositiveInfinity');
    ce.assign('a', -2);
    expect(lim.evaluate().json).toEqual(0);
  });

  test('exactZeroVerdict() after a redefinition of an operator that the constant calls', () => {
    const ce = new ComputeEngine();
    ce.declare('F', {
      signature: '(number) -> number',
      pure: true,
      evaluate: ([a]) => ce.number(a.re),
    });
    expect(exactZeroVerdict(ce.box(['Subtract', ['F', 1], 1]))).toBe(true);
    ce.declare(
      'F',
      { evaluate: ([a]) => ce.number(a.re + 1) },
      { extend: true }
    );
    expect(exactZeroVerdict(ce.box(['Subtract', ['F', 1], 1]))).toBe(false);
  });

  test('One Limit compiles each probe once', () => {
    // The probe of an expression is compiled once and then read from the
    // cache: building the function literal of a probe moves the cache
    // generation of the engine, so a generation stamp never matched.
    const ce = new ComputeEngine();
    const before = limitProbe.limitProbeCompileCount;
    expect(
      ce
        .box([
          'Limit',
          ['Function', ['Divide', ['Ln', ['Ln', 'x']], ['Ln', 'x']], 'x'],
          'PositiveInfinity',
        ])
        .evaluate().json
    ).toEqual(0);
    expect(limitProbe.limitProbeCompileCount - before).toBeLessThan(20);
  });

  test('A host callback of a protocol implementation is host code', () => {
    const ce = new ComputeEngine();
    let k = 2;
    let calls = 0;
    ce.declareProtocol('Scalable', {
      functions: { scale: '(self: Self) -> number' },
    });
    ce.declareProtocolImplementation('integer', 'Scalable', {
      functions: {
        scale: (x: Expression) => {
          calls += 1;
          return (x.re as number) * k;
        },
      },
    });
    ce.assign('g', ce.box(['Function', ['Add', ['scale', 'n'], 1], 'n']));
    expect(ce.box(['g', 3]).evaluate().json).toEqual(7);
    k = 100;
    expect(ce.box(['g', 3]).evaluate().json).toEqual(301);
    // A shared `scale(5)` is called at each of its three occurrences.
    const s = ce.function('scale', [ce.number(5)]);
    calls = 0;
    expect(ce.function('Add', [s, s, s]).evaluate().json).toEqual(1500);
    expect(calls).toBe(3);
  });

  test('A view over an unstated host source: the finiteness read', () => {
    const ce = new ComputeEngine();
    let m = 1;
    ce.declare('src', {
      signature: '() -> list<integer>',
      evaluate: () => ce.box(['List', m, m + 1, m + 2]),
    });
    const view = ce.box(['Join', ['src'], ['List', 4]]);
    expect(view.evaluate().json).toEqual(['List', 1, 2, 3, 4]);
    m = 10;
    expect(view.evaluate().json).toEqual(['List', 10, 11, 12, 4]);
  });

  test('A user function with a host evaluateAsync handler, on the asynchronous route', async () => {
    const ce = new ComputeEngine();
    ce.declare('U', {
      signature: '(number) -> number',
      evaluate: ce.box(['Function', 'n', 'n']),
      evaluateAsync: async ([a]) =>
        ce.number((a.re as number) + (ce.symbol('x').value!.re as number)),
    });
    ce.assign('x', 1);
    ce.assign('ga', ce.box(['Function', ['U', 'n'], 'n']));
    expect((await ce.box(['ga', 1]).evaluateAsync()).json).toEqual(2);
    ce.assign('x', 100);
    expect((await ce.box(['ga', 1]).evaluateAsync()).json).toEqual(101);
  });

  test('A drained Map whose function holds an unstated host operator', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    let m = 1;
    ce.declare('F', {
      signature: '() -> real',
      evaluate: () => ce.number(m + 0.5),
    });
    _resetMapAutoCompileStats();
    const e = ce.box([
      'Map',
      ['Function', ['Add', 'k', ['F']], 'k'],
      ['Range', 1, 300],
    ]);
    const first = [...e.N().each()].slice(0, 2).map((x) => x.re);
    expect(first).toEqual([2.5, 3.5]);
    expect(mapStats.attempts).toBe(1);
    expect(mapStats.compiledHits).toBe(0);
    m = 10;
    const second = [...e.N().each()].slice(0, 2).map((x) => x.re);
    expect(second).toEqual([11.5, 12.5]);
  });

  test('A collection handler that describes the collection is not counted', () => {
    const ce = new ComputeEngine();
    ce.declare('S', {
      signature: '() -> list<integer>',
      collection: {
        isLazy: () => true,
        count: () => 2,
        isFinite: () => true,
        iterator: () => [ce.number(1), ce.number(2)][Symbol.iterator](),
        at: (_expr, i) => ce.number(i as number),
      },
    });
    const isLazy = ce.lookupDefinition('S')!.operator!.collection!.isLazy!;
    const before = uncachedHostCallCount();
    expect(isLazy(ce.function('S', []))).toBe(true);
    expect(uncachedHostCallCount()).toBe(before);
  });

  test('A view over an unstated host source calls it once per evaluation', () => {
    // The finiteness read of the view and its operand step share the value
    // of the source: one call, and one value for both. The source gives a
    // finite list on odd calls and an infinite range on even calls.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return calls % 2 === 1
          ? ce.box(['List', 3, 1, 2])
          : ce.box(['Range', 1, 'PositiveInfinity']);
      },
    });
    expect(ce.box(['Join', ['src', 1], ['List', 4]]).evaluate().json).toEqual([
      'List',
      3,
      1,
      2,
      4,
    ]);
    expect(calls).toBe(1);
  });

  test('Series after a change of a symbol that a coefficient reads', () => {
    const ce = new ComputeEngine();
    const series = () =>
      ce
        .parse('\\operatorname{Series}((x + \\sin(a) - \\sin(1))/x, x, 0, 2)')
        .evaluate()
        .toString();
    ce.assign('a', 1);
    expect(series()).toBe('1');
    // With a = 2 the pole (sin(2) - sin(1))/x stays.
    ce.assign('a', 2);
    expect(series()).toContain('sin(a) - sin(1)');
  });

  test('A host evaluateAsync handler that changes state and throws before it returns its promise', async () => {
    const ce = new ComputeEngine();
    ce.assign('x', 0);
    ce.declare('T', {
      signature: '(number) -> number',
      pure: true,
      // Not an `async` function: it throws synchronously.
      evaluateAsync: () => {
        ce.assign('x', (ce.symbol('x').value!.re as number) + 1);
        throw new TypeError('no value');
      },
    });
    // The handler states `pure: true` and changes state: its call is
    // counted as host code that no memo keeps a result across, also when it
    // throws before it returns its promise.
    const before = uncachedHostCallCount();
    let result: Expression | undefined;
    try {
      result = await ce.box(['T', 1]).evaluateAsync();
    } catch {
      result = undefined;
    }
    expect(result === undefined || result.isValid === false).toBe(true);
    expect(ce.symbol('x').value!.re).toBe(1);
    expect(uncachedHostCallCount()).toBeGreaterThan(before);
  });

  test('An unstated host source is called once per top-level evaluation, by every consumer', () => {
    const ce = new ComputeEngine();
    const log: string[] = [];
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: ([n]) => {
        calls += 1;
        log.push(`src(${n.re})#${calls}`);
        // A finite list on odd calls, an infinite range on even calls.
        return calls % 2 === 1
          ? ce.box(['List', 3, 1, 2])
          : ce.box(['Range', 1, 'PositiveInfinity']);
      },
    });
    // A held consumer: `Sum` reads the finiteness of the view, then
    // iterates it.
    expect(
      ce.box(['Sum', ['Join', ['src', 1], ['List', 4]]]).evaluate().json
    ).toEqual(10);
    expect(log).toEqual(['src(1)#1']);
    // A nested view: each source is called once, and the result holds the
    // values that the finiteness reads saw (the first call of each source
    // gives a finite list).
    log.length = 0;
    calls = 0;
    ce.declare('pair', {
      signature: '(integer) -> list<integer>',
      evaluate: ([n]) => {
        calls += 1;
        log.push(`pair(${n.re})#${calls}`);
        return calls <= 2
          ? ce.box(['List', n.re, n.re])
          : ce.box(['Range', 1, 'PositiveInfinity']);
      },
    });
    expect(
      ce
        .box(['Join', ['pair', 2], ['Join', ['pair', 1], ['List', 4]]])
        .evaluate().json
    ).toEqual(['List', 2, 2, 1, 1, 4]);
    expect(log.length).toBe(2);
    // A second top-level evaluation calls the source again.
    log.length = 0;
    calls = 0;
    const view = ce.box(['Sum', ['Join', ['src', 1], ['List', 4]]]);
    expect(view.evaluate().json).toEqual(10);
    calls = 0;
    expect(view.evaluate().json).toEqual(10);
    expect(log).toEqual(['src(1)#1', 'src(1)#1']);
  });

  test('Two asynchronous evaluations at the same time each call an unstated host source', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return ce.box(['List', 3, 1, 2]);
      },
    });
    // Each evaluation keeps the value of the source for itself: the second
    // one does not replace the value of the first one, so each calls the
    // source once.
    const view = ce.box(['Sum', ['Join', ['src', 1], ['List', 4]]]);
    const results = await Promise.all([
      view.evaluateAsync(),
      view.evaluateAsync(),
    ]);
    expect(results.map((r) => r.json)).toEqual([10, 10]);
    expect(calls).toBe(2);
  });

  test('The element memo: a walk whose iterator evaluates an unstated host source', () => {
    // The iterator of `Join` walks its operands when it is built, which
    // evaluates `src(1)` before the first element is pulled.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '(integer) -> list<integer>',
      evaluate: () => {
        calls += 1;
        return ce.box(['List', 100 * calls]);
      },
    });
    const j = ce.box(['Join', ['src', 1], ['List', 4]]);
    const first = [...j.each()].map((x) => x.re);
    const callsAfterFirst = calls;
    const second = [...j.each()].map((x) => x.re);
    // The second walk calls the source again and gives its new value.
    expect(calls).toBeGreaterThan(callsAfterFirst);
    expect(second[0]).toBeGreaterThan(first[0]);
    expect(second[1]).toBe(4);
    // `Sum` follows the source too.
    const callsBeforeSum = calls;
    const sum = ce.box(['Sum', j]).evaluate().re;
    expect(calls).toBeGreaterThan(callsBeforeSum);
    expect(sum).toBeGreaterThan(second[0] + 4);
  });

  test('Two overlapping asynchronous views over one unstated host source', async () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('src', {
      signature: '() -> list<integer>',
      evaluate: () => {
        calls += 1;
        return ce.box(['List', 1, 2]);
      },
    });
    const s = ce.box(['src']);
    const results = await Promise.all([
      ce
        .function('Append', [ce.function('Reverse', [s]), ce.number(4)])
        .evaluateAsync(),
      ce
        .function('Append', [ce.function('Reverse', [s]), ce.number(5)])
        .evaluateAsync(),
    ]);
    expect(calls).toBe(2);
    expect(results.map((r) => [...r.each()].map((x) => x.re))).toEqual([
      [2, 1, 4],
      [2, 1, 5],
    ]);
  });

  test('The zero verdict of a tower of shared nodes', () => {
    const ce = new ComputeEngine();
    const t = tower(ce, ce.number(2), 30);
    const c = ce.function('Subtract', [t, ce.number(2)], {
      form: 'structural',
    });
    const [zero, ms] = timed(() => exactZeroVerdict(c));
    expect(zero).toBe(true);
    expect(ms).toBeLessThan(2000);
  });

  test('drawsRandom: false alone does not state purity', () => {
    const ce = new ComputeEngine();
    let count = 0;
    ce.declare('C', {
      signature: '() -> integer',
      drawsRandom: false,
      evaluate: () => ce.number(++count),
    });
    const c = ce.function('C', []);
    expect(ce.function('List', [c, c, c]).evaluate().json).toEqual([
      'List',
      1,
      2,
      3,
    ]);
  });
});
