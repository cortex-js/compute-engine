/**
 * Interpreter tests for the de-conflated `Loop` (imperative, for effect) and
 * `Comprehension` (value-producing) operators.
 *
 * Note on variable names: an Element index (`Element(i, coll)`) is explicitly
 * declared in the loop scope, so `i` is safe there. A *Block-local* counter is
 * NOT — a bare `i` resolves to the imaginary unit — so bare-loop tests use
 * `k`/`n` for their counters.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { CancellationError } from '../../src/common/interruptible';

describe('Loop — imperative (interpreter)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('Loop(body) with Break(v) returns the break value', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', 0],
        [
          'Loop',
          [
            'If',
            ['GreaterEqual', 'k', 5],
            ['Break', 'k'],
            ['Assign', 'k', ['Add', 'k', 1]],
          ],
        ],
      ])
      .evaluate();
    expect(result.re).toBe(5);
  });

  test('Loop(body) with a bare Break returns Nothing', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', 0],
        [
          'Loop',
          [
            'If',
            ['GreaterEqual', 'k', 3],
            ['Break'],
            ['Assign', 'k', ['Add', 'k', 1]],
          ],
        ],
      ])
      .evaluate();
    expect(result.symbol).toBe('Nothing');
  });

  test('Loop(body) without Break throws CancellationError (iteration limit)', () => {
    ce.iterationLimit = 500;
    expect(() => ce.expr(['Loop', ['Add', 1, 1]]).evaluate()).toThrow(
      CancellationError
    );
  });

  test('Loop(Element) accumulator ends at 55, loop value is Nothing', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 's'],
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 10]],
      ],
      's',
    ]);
    expect(expr.evaluate().re).toBe(55);
    // The Loop itself is for effect: value Nothing.
    const loopOnly = ce.expr([
      'Loop',
      ['Assign', 's', 'i'],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(loopOnly.evaluate().symbol).toBe('Nothing');
  });

  test('Continue in body skips (accumulate only even i → 30)', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 's'],
        ['Assign', 's', 0],
        [
          'Loop',
          [
            'If',
            ['NotEqual', ['Mod', 'i', 2], 0],
            ['Continue'],
            ['Assign', 's', ['Add', 's', 'i']],
          ],
          ['Element', 'i', ['Range', 1, 10]],
        ],
        's',
      ])
      .evaluate();
    expect(result.re).toBe(30);
  });

  test('Break with value inside Element form returns that value', () => {
    const result = ce
      .expr([
        'Loop',
        [
          'If',
          ['Greater', ['Power', 'i', 2], 10],
          ['Break', ['Power', 'i', 2]],
          'Nothing',
        ],
        ['Element', 'i', ['Range', 1, 10]],
      ])
      .evaluate();
    // i = 4 is the first with i² > 10.
    expect(result.re).toBe(16);
  });

  test('Break produced by a statement result terminates the loop', () => {
    // Regression: a Break that is the *result* of a statement (here the If)
    // must propagate out of the Block to the Loop — previously only a literal
    // Break statement short-circuited the Block, and this shape looped to the
    // iteration limit.
    const result = ce
      .expr(['Loop', ['Block', ['If', 'True', ['Break']]]])
      .evaluate();
    expect(result.symbol).toBe('Nothing');
  });

  test('Break inside If inside Block terminates the loop (while-lowering shape)', () => {
    // `while cond { body }` lowers to Loop(Block(If(Not(cond), Break), body)).
    // The counter is an engine-level binding: a Block-local read from within
    // a nested Block does not resolve reliably (pre-existing scope-capture
    // bug), and this test targets Break propagation, not scope resolution.
    ce.declare('k', 'integer');
    ce.assign('k', 0);
    const result = ce
      .expr([
        'Loop',
        [
          'Block',
          ['If', ['Not', ['Less', 'k', 5]], ['Break']],
          ['Assign', 'k', ['Add', 'k', 1]],
        ],
      ])
      .evaluate();
    expect(result.symbol).toBe('Nothing');
    expect(ce.expr('k').evaluate().re).toBe(5);
  });

  test('Break with value inside If inside Block becomes the loop value', () => {
    ce.declare('k', 'integer');
    ce.assign('k', 0);
    const result = ce
      .expr([
        'Loop',
        [
          'Block',
          ['Assign', 'k', ['Add', 'k', 1]],
          ['If', ['GreaterEqual', 'k', 4], ['Break', ['Multiply', 'k', 10]]],
        ],
      ])
      .evaluate();
    expect(result.re).toBe(40);
  });

  test('two-argument If (no else branch) canonicalizes and evaluates', () => {
    // Regression: If's canonical handler destructured a missing else branch
    // and threw "Cannot read properties of undefined (reading 'canonical')",
    // leaving the expression non-canonical (and a Loop over it unable to
    // terminate).
    const t = ce.expr(['If', 'True', 7]);
    expect(t.isCanonical).toBe(true);
    expect(t.evaluate().re).toBe(7);
    expect(ce.expr(['If', 'False', 7]).evaluate().symbol).toBe('Nothing');
  });

  test('Return propagates through Block and Loop to the function boundary', () => {
    // The Return is produced by an If *result* inside the loop-body Block; it
    // must escape the Block, then the Loop, then the function-body Block, and
    // be unwrapped at the application boundary. (The condition is a constant:
    // reading a parameter from a nested Block is a separate, pre-existing
    // scope-capture bug.)
    const fn = ce.expr([
      'Function',
      [
        'Block',
        ['Loop', ['Block', ['If', 'True', ['Return', 42]], ['Break']]],
        -1,
      ],
      'x',
    ]);
    const result = ce.function('Apply', [fn, ce.number(1)]).evaluate();
    expect(result.re).toBe(42);
  });

  test('Loop type is `nothing` for a for-effect body', () => {
    const expr = ce.box([
      'Loop',
      ['Assign', 's', 'i'],
      ['Element', 'i', ['Range', 1, 3]],
    ]);
    expect(expr.type.toString()).toBe('nothing');
  });

  test('Loop type is `unknown` when the body can yield a value', () => {
    const expr = ce.box([
      'Loop',
      ['If', ['Greater', 'i', 3], ['Return', 'i'], 'Nothing'],
      ['Element', 'i', ['Range', 1, 5]],
    ]);
    expect(expr.type.toString()).toBe('unknown');
  });
});

describe('Comprehension (interpreter)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('single clause → List of squares', () => {
    // A `Comprehension` is a LAZY indexed collection (like `Range`/`Map`):
    // `evaluate()` returns the comprehension itself; its elements are
    // materialized only when consumed.
    const result = ce
      .expr(['Comprehension', ['Square', 'x'], ['Element', 'x', ['Range', 1, 3]]])
      .evaluate();
    expect(result.operator).toBe('Comprehension');
    expect(result.isCollection).toBe(true);
    expect([...result.each()].map((x) => x.json)).toEqual([1, 4, 9]);
  });

  test('Cartesian product of two independent clauses', () => {
    const result = ce
      .expr([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ])
      .evaluate();
    // Independent clauses have a cheap product count, no materialization.
    expect(result.count).toBe(4);
    expect([...result.each()].length).toBe(4);
  });

  test('dependent binding (triangle)', () => {
    const result = ce
      .expr([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 3]],
        ['Element', 'y', ['Range', 1, 'x']],
      ])
      .evaluate();
    // Dependent clause (`y` range references `x`): the count is not known
    // without walking, so it materializes on iteration. 1 + 2 + 3 = 6 tuples.
    expect([...result.each()].length).toBe(6);
  });

  test('scope hygiene: bound name does not leak', () => {
    const ce2 = new ComputeEngine();
    ce2
      .expr(['Comprehension', 'x', ['Element', 'x', ['Range', 1, 3]]])
      .evaluate();
    expect(ce2.lookupDefinition('x')).toBeUndefined();
  });

  test('binding an unread comprehension is lazy (no materialization)', () => {
    // Regression for the eager-materialization cost: an unread comprehension
    // bound to a name must NOT walk its whole domain. Its collection type and
    // `.count` are answered from the clause counts; elements materialize only
    // when actually consumed.
    const N = 1e6;
    const comp = ce
      .expr(['Comprehension', ['Square', 'i'], ['Element', 'i', ['Range', 1, N]]])
      .evaluate();
    // Stays lazy (does not become a materialized `List`).
    expect(comp.operator).toBe('Comprehension');
    expect(comp.isCollection).toBe(true);
    // `.count` is the clause count — O(1), never enumerated (a materialized
    // 1e6-element list would blow the iteration limit).
    expect(comp.count).toBe(N);
    expect(comp.type.toString()).toContain('indexed_collection');
    // Consumption materializes a single element on demand.
    expect(comp.at(3)?.json).toEqual(9);
  });

  test('bracket comprehension parses to the comprehension itself, not List(Comprehension)', () => {
    // `[body \operatorname{for} …]` IS the collection — it must not be wrapped
    // in a one-element `List` (which would report `count: 1` and mis-index).
    const expr = ce.parse('[i^2 \\operatorname{for} i=[1...5]]');
    expect(expr.operator).toBe('Comprehension');
    expect(expr.count).toBe(5);
    expect(ce.box(['At', expr, 3]).evaluate().json).toEqual(9);
  });

  test('dependent comprehension: .count is exact and stable across iteration', () => {
    // Regression: a dependent comprehension has no closed-form count, so it is
    // counted by enumeration — which is correct (6, the triangle number) and
    // does NOT depend on scope state. Earlier bugs made this either a bogus
    // product (9, from a stale x=3 left in the loop scope) or `undefined`
    // (which broke `Length`/`Sum`). It must be 6 both before and after a walk.
    const dep = ce
      .expr([
        'Comprehension',
        ['Add', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 3]],
        ['Element', 'y', ['Range', 1, 'x']],
      ])
      .evaluate();
    expect(dep.count).toBe(6);
    expect(dep.isFiniteCollection).toBe(true);
    expect([...dep.each()].map((e) => e.toString())).toEqual([
      '2',
      '3',
      '4',
      '4',
      '5',
      '6',
    ]);
    expect(dep.count).toBe(6); // stable — not 9, not undefined
    // Dependent comprehensions must work with finite reducers/aggregators.
    expect(ce.box(['Sum', dep]).evaluate().toString()).toBe('24');
    expect(ce.box(['Length', dep]).evaluate().toString()).toBe('6');
  });

  test('comprehension iteration does not leak the loop scope on early break', () => {
    // Regression: an iterator that held the loop scope across `yield`s leaked it
    // when a consumer broke early (`each()` does not forward `.return()`),
    // corrupting later evaluation. The scope is now pushed only around each
    // synchronous advance, never across a `yield`, so the eval-context stack
    // stays balanced.
    const stack = (ce as unknown as { _evalContextStack: unknown[] })
      ._evalContextStack;
    const before = stack.length;
    const comp = ce.expr([
      'Comprehension',
      ['Square', 'i'],
      ['Element', 'i', ['Range', 1, 100]],
    ]);
    let n = 0;
    for (const _ of comp.each()) if (++n === 3) break;
    expect(stack.length).toBe(before);
  });

  test('comprehension iteration is lazy: an infinite domain streams a prefix', () => {
    // The iterator yields one element at a time, so consuming only a prefix of
    // an infinite comprehension terminates instead of hitting the iteration
    // limit. (A fully eager iterator would throw here.)
    const inf = ce.expr([
      'Comprehension',
      ['Square', 'i'],
      ['Element', 'i', ['Range', 1, Infinity]],
    ]);
    const out: string[] = [];
    for (const x of inf.each()) {
      out.push(x.toString());
      if (out.length === 4) break;
    }
    expect(out).toEqual(['1', '4', '9', '16']);
    expect(inf.at(3)?.toString()).toBe('9');
    // It IS an infinite collection (independent, infinite clause).
    expect(inf.isFiniteCollection).toBe(false);
  });

  test('comprehension .count is order-independent (empty beats unknown/infinite)', () => {
    ce.declare('m', 'number'); // Range(1,m): a collection whose count is unknown
    const unknownClause = ['Element', 'x', ['Range', 1, 'm']];
    const emptyClause = ['Element', 'y', ['List']];
    const infClause = ['Element', 'z', ['Range', 1, Infinity]];
    // An empty clause makes the whole comprehension empty regardless of order.
    for (const clauses of [
      [unknownClause, emptyClause],
      [emptyClause, unknownClause],
      [infClause, emptyClause],
    ]) {
      const c = ce.box(['Comprehension', ['Add', 'x', 'y'], ...clauses]);
      expect(c.count).toBe(0);
      expect(c.isEmptyCollection).toBe(true);
      expect(c.isFiniteCollection).toBe(true);
    }
    // Unknown × infinite (no empty) is genuinely unknown.
    const u = ce.box(['Comprehension', ['Add', 'x', 'z'], unknownClause, infClause]);
    expect(u.count).toBeUndefined();
    expect(u.isFiniteCollection).toBeUndefined();
  });

  test('reading .count of a dependent comprehension does not evaluate its body', () => {
    // Cardinality is a domain-only traversal — it must not run the body (which
    // could assign, consume randomness, etc.).
    const ce2 = new ComputeEngine();
    let calls = 0;
    ce2.declare('probe', {
      signature: '(number) -> number',
      evaluate: (args: any) => {
        calls += 1;
        return args[0];
      },
    } as any);
    const dep = ce2.box([
      'Comprehension',
      ['probe', 'x'],
      ['Element', 'x', ['Range', 1, 3]],
      ['Element', 'y', ['Range', 1, 'x']],
    ]);
    expect(dep.count).toBe(6);
    expect(calls).toBe(0); // count did NOT evaluate the body
    // ...but iterating does.
    [...dep.evaluate().each()];
    expect(calls).toBe(6);
  });

  test('comprehension re-materializes after an outer binding changes (no stale cache)', () => {
    // Regression: elements must not be cached across a binding change — the same
    // boxed comprehension must reflect the current value of a free variable it
    // references (correct for reactive/live documents).
    const ce2 = new ComputeEngine();
    ce2.assign('a', 10);
    const comp = ce2
      .expr(['Comprehension', ['Multiply', 'a', 'i'], ['Element', 'i', ['Range', 1, 3]]])
      .evaluate();
    expect([...comp.each()].map((e) => e.toString())).toEqual(['10', '20', '30']);
    ce2.assign('a', 100);
    expect([...comp.each()].map((e) => e.toString())).toEqual([
      '100',
      '200',
      '300',
    ]);
  });

  test('Break canonicalizes without error and stays inert', () => {
    const b = ce.expr(['Break']);
    expect(b.operator).toBe('Break');
    expect(b.evaluate().operator).toBe('Break');
  });
});
