import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Sum`/`Product` declare their index with the sanctioned binder mechanism
 * (`scoped: indexingSetSites(1, 'integer')`,
 * `docs/SCOPING-MODEL.md`). The index is bound in
 * the big op's OWN scope, which is what makes it shadow a same-named library
 * constant or global value, and what makes the parse, `ce.box()` and
 * `ce.function()` routes agree about the same expression.
 */

describe('big-op index binding', () => {
  test('the index shadows a library constant (i, e)', () => {
    const ce = new ComputeEngine();
    // `i` is the imaginary unit and `e` is Euler's number in the root scope;
    // as an index each is a different variable.
    expect(ce.parse('\\sum_{i=1}^{4} i').evaluate().re).toEqual(10);
    expect(ce.parse('\\sum_{e=1}^{4} e').evaluate().re).toEqual(10);
    expect(ce.parse('\\prod_{i=1}^{4} i').evaluate().re).toEqual(24);
    expect(ce.parse('\\prod_{e=1}^{4} e').evaluate().re).toEqual(24);
  });

  test('the index shadows a global value of the same name', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 100);
    expect(ce.parse('\\sum_{k=1}^{3} k').evaluate().re).toEqual(6);
    expect(ce.box('k').evaluate().re).toEqual(100);
  });

  test('the index is bound by the big op itself', () => {
    const ce = new ComputeEngine();
    const sum = ce.parse('\\sum_{k=1}^{3} k');
    expect([...(sum.localScope?.bindings.keys() ?? [])]).toEqual(['k']);
  });

  test('the parse, box and function routes agree', () => {
    const ce = new ComputeEngine();
    const parsed = ce.parse('\\sum_{k=1}^{3} k');
    const boxed = ce.box(['Sum', 'k', ['Limits', 'k', 1, 3]]);
    const applied = ce.function('Sum', [
      ce.symbol('k'),
      ce.function('Limits', [ce.symbol('k'), ce.number(1), ce.number(3)]),
    ]);
    expect(parsed.isSame(boxed)).toBe(true);
    expect(parsed.isSame(applied)).toBe(true);
    expect(applied.evaluate().re).toEqual(6);
  });
});

/**
 * `Comprehension`'s own description states the contract: "Later clauses see
 * earlier bindings; independent clauses produce a Cartesian product." So an
 * EARLIER clause's collection must resolve a name a LATER clause binds in the
 * ENCLOSING scope — the binder hook's sites are `clauseLocal`.
 */
describe('binder clause ordering', () => {
  test('an earlier clause sees the enclosing binding of a later index', () => {
    const ce = new ComputeEngine();
    ce.assign('j', 7);
    // `q` is drawn from [j, j+1] = [7, 8] — the GLOBAL `j`, not the loop's.
    const boxed = ce.box([
      'Comprehension',
      ['Tuple', 'q', 'j'],
      ['Element', 'q', ['List', 'j', ['Add', 'j', 1]]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
    expect(boxed.evaluate().toString()).toEqual(
      '[(7, 10),(7, 20),(8, 10),(8, 20)]'
    );
    // The loop's `j` did not leak into the enclosing scope.
    expect(ce.box('j').evaluate().re).toEqual(7);
  });

  test('the box and function routes agree about clause ordering', () => {
    const ce = new ComputeEngine();
    ce.assign('j', 7);
    const boxed = ce.box([
      'Comprehension',
      ['Tuple', 'q', 'j'],
      ['Element', 'q', ['List', 'j', ['Add', 'j', 1]]],
      ['Element', 'j', ['List', 10, 20]],
    ]);
    const applied = ce.function('Comprehension', [
      ce.function('Tuple', [ce.symbol('q'), ce.symbol('j')]),
      ce.function('Element', [
        ce.symbol('q'),
        ce.function('List', [ce.symbol('j'), ce.symbol('j').add(1)]),
      ]),
      ce.function('Element', [
        ce.symbol('j'),
        ce.function('List', [ce.number(10), ce.number(20)]),
      ]),
    ]);
    expect(boxed.isSame(applied)).toBe(true);
    expect(applied.evaluate().toString()).toEqual(boxed.evaluate().toString());
  });

  test('the body sees every clause binding', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box([
      'Comprehension',
      ['Add', 'q', 'r'],
      ['Element', 'q', ['List', 1, 2]],
      ['Element', 'r', ['List', 10, 20]],
    ]);
    expect([...(boxed.localScope?.bindings.keys() ?? [])]).toEqual(['q', 'r']);
    expect(boxed.evaluate().toString()).toEqual('[11,21,12,22]');
  });
});

/**
 * A binder whose operands hold no binding site (a bare `Loop(body)`) must not
 * canonicalize its body inside a scope that is pushed and then discarded.
 */
describe('a binder with no binding site pushes no scope', () => {
  test('a bare Loop carries no local scope', () => {
    const ce = new ComputeEngine();
    const loop = ce.box(['Loop', ['Block', ['Break']]]);
    expect(loop.localScope).toBeUndefined();
  });

  test('a nested binder in a bare Loop body is parented to the ambient scope', () => {
    const ce = new ComputeEngine();
    const loop = ce.box(['Loop', ['Sum', 'k', ['Limits', 'k', 1, 3]]]);
    const sum = loop.ops![0];
    expect([...(sum.localScope?.bindings.keys() ?? [])]).toEqual(['k']);
    // No discarded frame between the `Sum` scope and the ambient one.
    expect(sum.localScope?.parent === ce.context.lexicalScope).toBe(true);
  });

  test('`Series` still finds its default expansion variable', () => {
    const ce = new ComputeEngine();
    const series = ce.box(['Series', ['Sin', 'x']]);
    expect(series.toString()).toEqual('Series(sin(x), x, 0, 5)');
    expect([...(series.localScope?.bindings.keys() ?? [])]).toEqual(['x']);
    expect(ce.parse('\\sin x').evaluate().toString()).toEqual('sin(x)');
  });
});

/**
 * `.subs()` rebuilds every node it touches. A SCOPED node must be rebuilt onto
 * its own scope: minting a fresh one parents it at the substitution site's
 * ambient scope, so a nested binder's scope goes on pointing at the original
 * outer scope while the rebuilt outer node advertises a different one. The
 * chain from the inner body then never reaches the outer binder's index, and
 * an index whose name collides with a library constant resolves to the
 * CONSTANT instead — silently, since the substituted tree is `isCanonical` and
 * prints identically to the directly-built one.
 *
 * The gate is BOTH the nesting AND a constant-colliding OUTER index: only the
 * outer binder's name is re-resolved inside the inner body, so `p`/`q` agreed
 * all along and `i`/`j` — what anyone writes first — did not.
 */
describe('`.subs()` preserves a binder scope', () => {
  test('a nested Sum keeps its scope chain', () => {
    const ce = new ComputeEngine();
    const nested = ce.box([
      'Sum',
      ['Sum', ['Multiply', 'x', 'i'], ['Limits', 'j', 1, 2]],
      ['Limits', 'i', 1, 2],
    ]);
    const substituted = nested.subs({ x: 1 });
    expect(substituted.ops![0].localScope?.parent).toBe(substituted.localScope);
  });

  test('a substituted nested Sum answers as the direct one does', () => {
    const ce = new ComputeEngine();
    ce.assign('K', ce.box(['List', 10, 20, 30, 40, 50]));
    const direct = ce.box([
      'Sum',
      ['Sum', ['At', 'K', ['Add', 'i', 'j']], ['Limits', 'j', 1, 2]],
      ['Limits', 'i', 1, 2],
    ]);
    const substituted = ce
      .box([
        'Sum',
        [
          'Sum',
          ['Multiply', 'x', ['At', 'K', ['Add', 'i', 'j']]],
          ['Limits', 'j', 1, 2],
        ],
        ['Limits', 'i', 1, 2],
      ])
      .subs({ x: 1 });
    expect(direct.evaluate().re).toEqual(120);
    expect(substituted.evaluate().re).toEqual(120);
  });

  test('the outer index is not captured by a colliding library constant', () => {
    const ce = new ComputeEngine();
    // Every outer index name must agree: `i` and `e` are the imaginary unit
    // and Euler's number in the root scope, `p` is neither.
    for (const outer of ['i', 'e', 'p']) {
      const substituted = ce
        .box([
          'Sum',
          ['Sum', ['Multiply', 'x', outer], ['Limits', 'j', 1, 2]],
          ['Limits', outer, 1, 2],
        ])
        .subs({ x: 1 });
      expect(substituted.evaluate().re).toEqual(6);
    }
  });

  test('three levels of nesting keep every index bound', () => {
    const ce = new ComputeEngine();
    const substituted = ce
      .box([
        'Sum',
        [
          'Sum',
          [
            'Sum',
            ['Multiply', 'x', ['Add', 'i', 'j', 'k']],
            ['Limits', 'k', 1, 2],
          ],
          ['Limits', 'j', 1, 2],
        ],
        ['Limits', 'i', 1, 2],
      ])
      .subs({ x: 1 });
    expect(substituted.evaluate().re).toEqual(36);
  });
});

/**
 * `.subs()` is not the only pass that rebuilds a node. Every rewriting walk
 * that reconstructs a scoped node owes it the same scope, and a partial
 * `CanonicalForm[]` request — which runs BEFORE any binder scope exists — owes
 * the binder's own variables the same immunity from symbol resolution. Both
 * failed the same way: an index named after a library constant came back as
 * the constant (`docs/SCOPING-MODEL.md`, "Rebuilding a scoped node").
 */
describe('rewriting a nested binder keeps its index bound', () => {
  /** `Σ_{i=1}^{2} Σ_{j=1}^{2} c·i` = `c·(1+1+2+2)` = `6c`. */
  function nested(ce: ComputeEngine): ReturnType<ComputeEngine['box']> {
    return ce.box([
      'Sum',
      ['Sum', ['Multiply', 'x', 'i'], ['Limits', 'j', 1, 2]],
      ['Limits', 'i', 1, 2],
    ]);
  }

  test('`.replace()` rewrites the body without capturing the index', () => {
    const ce = new ComputeEngine();
    const rewritten = nested(ce).replace(
      ce.rules([{ match: 'x', replace: '2' }]),
      { recursive: true }
    );
    expect(rewritten).not.toBeNull();
    expect(rewritten!.evaluate().re).toEqual(12);
  });

  test('`.map()` does the same', () => {
    const ce = new ComputeEngine();
    const mapped = nested(ce).map((x) => (x.symbol === 'x' ? ce.number(2) : x));
    expect(mapped.evaluate().re).toEqual(12);
  });

  test('a partial CanonicalForm request leaves the index a symbol', () => {
    const ce = new ComputeEngine();
    // Every form runs the symbol pass, and `Number` additionally rewrites
    // every spelling of the imaginary unit — so `i` was rewritten twice over,
    // at the binding site as well as in the body.
    for (const form of [
      ['Order'],
      ['Flatten'],
      ['Number'],
      ['Multiply'],
      ['Number', 'Order'],
    ] as const) {
      const sum = ce.box(['Sum', ['Multiply', 2, 'i'], ['Limits', 'i', 1, 3]], {
        form: [...form],
      });
      expect(sum.json).toEqual([
        'Sum',
        ['Multiply', 2, 'i'],
        ['Limits', 'i', 1, 3],
      ]);
      expect(sum.evaluate().re).toEqual(12);
    }
  });

  test('a FREE imaginary unit still folds under the Number form', () => {
    const ce = new ComputeEngine();
    // The guard is about BOUND occurrences only: nothing binds `i` here.
    expect(ce.box(['Multiply', 2, 'i'], { form: ['Number'] }).json).toEqual([
      'Multiply',
      2,
      ['Complex', 0, 1],
    ]);
    expect(ce.box(['Negate', 'i'], { form: ['Number'] }).json).toEqual([
      'Complex',
      0,
      -1,
    ]);
  });
});

/**
 * The three guards the dual review added to the binder-scope round.
 */
describe('binder rewriting: the boundary cases', () => {
  test('renaming the index does not touch the ORIGINAL scope', () => {
    const ce = new ComputeEngine();
    const original = ce.box([
      'Sum',
      ['Multiply', 2, 'i'],
      ['Limits', 'i', 1, 3],
    ]);
    // Reusing the receiver's scope is what preserves a nested chain, but it is
    // only safe while the rebuild declares nothing new into it. `.subs()`
    // rewrites the binding site like any other operand, so this IS a rename —
    // and it must not leave a stray `k` in the scope of an expression the
    // caller still holds.
    const renamed = original.subs({ i: ce.symbol('k') });
    expect([...(original.localScope?.bindings.keys() ?? [])]).toEqual(['i']);
    expect(renamed.localScope).not.toBe(original.localScope);
    expect(renamed.evaluate().re).toEqual(12);
    expect(original.evaluate().re).toEqual(12);
  });

  test('the InvisibleOperator form leaves a bound index alone', () => {
    const ce = new ComputeEngine();
    // `2i` parses to `InvisibleOperator(2, i)`, and resolving it reads the
    // `i` twice over: once in the imaginary-unit arm, and again when the
    // operands are flattened (which canonicalizes by default).
    const sum = ce.box(
      ['Sum', ['InvisibleOperator', 2, 'i'], ['Limits', 'i', 1, 3]],
      { form: ['InvisibleOperator'] }
    );
    expect(sum.json).toEqual([
      'Sum',
      ['Multiply', 2, 'i'],
      ['Limits', 'i', 1, 3],
    ]);
    expect(sum.evaluate().re).toEqual(12);

    // A FREE `2i` is still the imaginary number it has always been.
    expect(
      ce.box(['InvisibleOperator', 2, 'i'], { form: ['InvisibleOperator'] })
        .json
    ).toEqual(['Complex', 0, 2]);
  });

  test('a clause-local index does not shadow an earlier clause', () => {
    const ce = new ComputeEngine();
    // `Element(i, j)` names `j`, which the SECOND clause binds. The earlier
    // clause is outside that binding, so its `j` is the ambient list — the
    // rule `bindBindingSites` enforces after canonicalization, which the
    // partial-form pass has to match rather than shadow every name everywhere.
    ce.assign('j', ce.box(['List', 7, 8]));
    const expr = [
      'Comprehension',
      ['Add', 'i', 'k'],
      ['Element', 'i', 'j'],
      ['Element', 'k', ['List', 1, 2]],
    ];
    const canonical = ce.box(expr).evaluate().toString();
    const partial = ce
      .box(expr, { form: ['Order'] })
      .evaluate()
      .toString();
    expect(canonical).toEqual('[8,9,9,10]');
    expect(partial).toEqual(canonical);
  });
});
