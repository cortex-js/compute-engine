import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { takeProvisionalDependents } from '../../src/compute-engine/boxed-expression/provisional-application';

// Definition order must not change semantics (Tycho 0.100.0 adoption item 1).
//
// `2a(t)` is genuinely ambiguous: a product when `a` is a scalar, an
// application when `a` is a function. `canonicalInvisibleOperator` decides on
// the only evidence available — whether `a` currently has an operator
// definition — which is right for a fresh parse but froze the WRONG reading
// into a `Function` literal defined BEFORE its callee:
//
//   g(t) := 2a(t)          // `a` unknown → body frozen as 2·a·t
//   a(t) := [cos t, sin t] // too late
//   g(1)                   // → `2a` instead of [2cos 1, 2sin 1]
//
// The repair (`boxed-expression/provisional-application.ts`) records the raw
// operands of any literal whose body made such a provisional reading and
// re-derives the literal when the symbol gains an operator definition.

/** Interpreted and compiled results of `probe` after registering `defs` in
 * order, on a fresh engine. */
function evaluateInOrder(
  defs: string[],
  probe: string
): { interpreted: string; compiled: unknown } {
  return evaluateAfter((ce) => {
    for (const def of defs) ce.parse(def).evaluate();
  }, probe);
}

/** The same, for definitions registered through the programmatic API. */
function evaluateAfter(
  define: (ce: ComputeEngine) => void,
  probe: string
): { interpreted: string; compiled: unknown } {
  const ce = new ComputeEngine();
  define(ce);
  const expr = ce.parse(probe);
  const result = compile(expr);
  expect(result.success).toBe(true);
  return { interpreted: expr.evaluate().toString(), compiled: result.run({}) };
}

describe('definition order does not change semantics', () => {
  //
  // 1/ The two-definition witness, list-valued and scalar-valued callee
  //
  describe.each([
    ['list-valued callee', 'a(t)\\coloneq[t, 2t]', 'g(1)'],
    ['scalar-valued callee', 'a(t)\\coloneq t^2+1', 'g(3)'],
  ])('%s', (_label, calleeDef, probe) => {
    const callerDef = 'g(t)\\coloneq 2a(t)';

    test('caller before callee matches callee before caller', () => {
      const calleeFirst = evaluateInOrder([calleeDef, callerDef], probe);
      const callerFirst = evaluateInOrder([callerDef, calleeDef], probe);
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });
  });

  test('list-valued callee: the frozen product used to survive as `2a`', () => {
    const { interpreted, compiled } = evaluateInOrder(
      ['g(t)\\coloneq 2a(t)', 'a(t)\\coloneq[t, 2t]'],
      'g(1)'
    );
    expect(interpreted).toEqual('[2,4]');
    // `JSON.stringify(NaN)` is `null`: the corrupted body compiled to a free
    // variable `a` and returned NaN behind `success: true`.
    expect(compiled).toEqual([2, 4]);
  });

  test('scalar-valued callee: the frozen product used to survive as `2a`', () => {
    const { interpreted, compiled } = evaluateInOrder(
      ['g(t)\\coloneq 2a(t)', 'a(t)\\coloneq t^2+1'],
      'g(3)'
    );
    expect(interpreted).toEqual('20');
    expect(compiled).toEqual(20);
  });

  test('a sum of two applications is repaired too (the product folds away)', () => {
    // `a(t) + a(2t)` collapsed to `3at` at canonicalization, so there was no
    // product node left to rewrite — the repair re-derives from the RAW body.
    const calleeFirst = evaluateInOrder(
      ['a(t)\\coloneq[t, 2t]', 'g(t)\\coloneq a(t)+a(2t)'],
      'g(1)'
    );
    const callerFirst = evaluateInOrder(
      ['g(t)\\coloneq a(t)+a(2t)', 'a(t)\\coloneq[t, 2t]'],
      'g(1)'
    );
    expect(calleeFirst.interpreted).toEqual('[3,6]');
    expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
    expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
  });

  test('a forward reference through a chain of definitions is repaired', () => {
    const calleeFirst = evaluateInOrder(
      ['a(t)\\coloneq t^2', 'g(t)\\coloneq 2a(t)', 'h(t)\\coloneq g(t)+1'],
      'h(3)'
    );
    const callerFirst = evaluateInOrder(
      ['h(t)\\coloneq g(t)+1', 'g(t)\\coloneq 2a(t)', 'a(t)\\coloneq t^2'],
      'h(3)'
    );
    expect(calleeFirst.interpreted).toEqual('19');
    expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
    expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
  });

  //
  // 2/ The three-definition Sum-shaped matrix (Tycho's item-121 forward
  //    reference arm): `A` calls both a LIST-valued `a` and a SCALAR-valued
  //    `h`, so every permutation exercises a forward reference of one or both.
  //    A `Sum` body matters: the corrupted emission took the unrolled scalar
  //    arm and returned `[null, null]` (NaN through `JSON`) from
  //    `_SYS.bcastFn` behind `success: true`.
  //
  describe('three-definition Sum matrix', () => {
    const DEFS: Record<string, string> = {
      a: 'a(t)\\coloneq[\\cos t,\\sin t]',
      h: 'h(i)\\coloneq\\operatorname{mod}(10^4\\sin(10^4i),1)',
      A: 'A(t)\\coloneq\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^i}a(2^it+2\\pi h(i+.5))',
    };
    const PROBE = 'A(0.3)';

    // The control: every callee is defined before its caller.
    const reference = evaluateInOrder([DEFS.a, DEFS.h, DEFS.A], PROBE);

    test('the control order produces a 2-vector', () => {
      expect(Array.isArray(reference.compiled)).toBe(true);
      expect(reference.compiled).toHaveLength(2);
      for (const x of reference.compiled as number[])
        expect(Number.isFinite(x)).toBe(true);
    });

    test.each([['h,a,A'], ['a,A,h'], ['h,A,a'], ['A,h,a'], ['A,a,h']])(
      'order %s matches the control order',
      (order) => {
        const { interpreted, compiled } = evaluateInOrder(
          order.split(',').map((k) => DEFS[k]),
          PROBE
        );
        expect(interpreted).toEqual(reference.interpreted);
        expect(compiled).toEqual(reference.compiled);
      }
    );
  });

  //
  // 3/ Route parity: the literal reaches the definition by three routes.
  //
  describe('every literal route is repaired', () => {
    test('the `\\mapsto` route', () => {
      const ce = new ComputeEngine();
      ce.assign('g', ce.parse('t \\mapsto 2a(t)'));
      ce.assign('a', ce.parse('t \\mapsto t^2'));
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('18');
    });

    test('the `ce.box` route', () => {
      const ce = new ComputeEngine();
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['InvisibleOperator', 2, 'a', ['Delimiter', 't']],
          't',
        ])
      );
      ce.assign('a', ce.parse('t \\mapsto t^2'));
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('18');
    });

    test('a nested literal inside the body', () => {
      const ce = new ComputeEngine();
      ce.parse(
        'g(t)\\coloneq\\operatorname{Map}([1,2,3], u \\mapsto a(u)+t)'
      ).evaluate();
      ce.parse('a(t)\\coloneq t^2').evaluate();
      expect(ce.parse('g(0)').evaluate().toString()).toEqual('[1,4,9]');
    });

    test('a declaration with no value is enough to re-derive the body', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      ce.declare('a', { signature: '(number) -> number' });
      const def: any = ce.lookupDefinition('g');
      expect(def.operator._lambdaLiteral.toString()).toEqual('(t) |-> 2a(t)');
      ce.assign('a', ce.parse('t \\mapsto t+1'));
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('8');
    });

    test('the repaired signature is re-inferred, not left scalar', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      ce.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
      const def: any = ce.lookupDefinition('g');
      expect(def.operator.signature.toString()).toEqual(
        '(unknown) -> vector<finite_number^2>'
      );
    });

    test('a definition in a local scope is repaired in that scope', () => {
      const ce = new ComputeEngine();
      const result = ce
        .parse(
          '\\operatorname{Block}(g(t)\\coloneq 2a(t), a(t)\\coloneq t^2, g(3))'
        )
        .evaluate();
      expect(result.toString()).toEqual('18');
    });
  });

  //
  // 4/ Recursion: the repair must not re-enter the definition it is rebuilding.
  //
  describe('recursive definitions', () => {
    test('a self-recursive body still evaluates', () => {
      const ce = new ComputeEngine();
      ce.parse(
        'f(n)\\coloneq\\operatorname{If}(n\\le1, 1, nf(n-1))'
      ).evaluate();
      expect(ce.parse('f(5)').evaluate().toString()).toEqual('120');
    });

    test('mutually recursive definitions still evaluate', () => {
      const ce = new ComputeEngine();
      ce.parse('p(n)\\coloneq\\operatorname{If}(n\\le0, 1, q(n-1))').evaluate();
      ce.parse('q(n)\\coloneq\\operatorname{If}(n\\le0, 0, p(n-1))').evaluate();
      expect(ce.parse('p(5)').evaluate().toString()).toEqual('0');
    });
  });

  //
  // 5/ Non-regression: juxtaposition stays multiplication when the leading
  //    symbol is not (and does not become) a function.
  //
  describe('juxtaposition multiplication is preserved', () => {
    test('a forever-undefined scalar stays a product', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2x(t+1)').evaluate();
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('8x');
    });

    test('a symbol declared numeric stays a product', () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'number');
      ce.parse('g(t)\\coloneq 2x(t+1)').evaluate();
      const def: any = ce.lookupDefinition('g');
      expect(def.operator._lambdaLiteral.toString()).toEqual(
        '(t) |-> 2x * (t + 1)'
      );
    });

    test('a symbol later assigned a number stays a product', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2x(t+1)').evaluate();
      ce.parse('x\\coloneq5').evaluate();
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('40');
    });

    test('a plain expression is not a definition and is not repaired', () => {
      // Only `Function` literals freeze a reading; a standalone expression is
      // whatever it was when it was parsed, and a fresh parse sees the new
      // definition.
      const ce = new ComputeEngine();
      const frozen = ce.parse('2x(3)');
      ce.parse('x(t)\\coloneq t+1').evaluate();
      expect(frozen.evaluate().toString()).toEqual('6x');
      expect(ce.parse('2x(3)').evaluate().toString()).toEqual('8');
    });
  });

  //
  // 6/ Value-definition routes. A function-typed VALUE definition is read as
  //    an application by `canonicalInvisibleOperator` too, so `declare` +
  //    `assign` — which stores the literal as a value under the declared
  //    signature, never as an operator — is exactly as order-dependent.
  //
  describe('the declare-then-assign (value definition) route', () => {
    const declareAssignCaller = (ce: ComputeEngine) => {
      ce.declare('g', '(number) -> number');
      ce.assign('g', ce.parse('t \\mapsto 2a(t)'));
    };

    test('the caller is repaired when it was declared and assigned', () => {
      const calleeFirst = evaluateAfter((ce) => {
        ce.parse('a(t)\\coloneq t^2').evaluate();
        declareAssignCaller(ce);
      }, 'g(3)');
      const callerFirst = evaluateAfter((ce) => {
        declareAssignCaller(ce);
        ce.parse('a(t)\\coloneq t^2').evaluate();
      }, 'g(3)');
      expect(calleeFirst.interpreted).toEqual('18');
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });

    test('the callee triggers the repair when it arrives by that route', () => {
      const declareAssignCallee = (ce: ComputeEngine) => {
        ce.declare('a', '(number) -> list<number>');
        ce.assign('a', ce.parse('t \\mapsto [t, 2t]'));
      };
      const calleeFirst = evaluateAfter((ce) => {
        declareAssignCallee(ce);
        ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      }, 'g(1)');
      const callerFirst = evaluateAfter((ce) => {
        ce.parse('g(t)\\coloneq 2a(t)').evaluate();
        declareAssignCallee(ce);
      }, 'g(1)');
      expect(calleeFirst.interpreted).toEqual('[2,4]');
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });

    test('the caller is repaired when it was declared WITH its value', () => {
      // `declare(name, { type, value })` installs the literal through
      // `updateDef` alone — no value-setter write follows it.
      const declareWithValue = (ce: ComputeEngine) =>
        ce.declare('g', {
          type: '(number) -> number',
          value: ce.parse('t \\mapsto 2a(t)'),
        });
      const calleeFirst = evaluateAfter((ce) => {
        ce.parse('a(t)\\coloneq t^2').evaluate();
        declareWithValue(ce);
      }, 'g(3)');
      const callerFirst = evaluateAfter((ce) => {
        declareWithValue(ce);
        ce.parse('a(t)\\coloneq t^2').evaluate();
      }, 'g(3)');
      expect(calleeFirst.interpreted).toEqual('18');
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });

    test('both halves by that route, in either order', () => {
      const declareAssignCallee = (ce: ComputeEngine) => {
        ce.declare('a', '(number) -> number');
        ce.assign('a', ce.parse('t \\mapsto t^2'));
      };
      const calleeFirst = evaluateAfter((ce) => {
        declareAssignCallee(ce);
        declareAssignCaller(ce);
      }, 'g(3)');
      const callerFirst = evaluateAfter((ce) => {
        declareAssignCaller(ce);
        declareAssignCallee(ce);
      }, 'g(3)');
      expect(calleeFirst.interpreted).toEqual('18');
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });
  });

  //
  // 7/ A rebuild that cannot be installed. The re-derived body is installed
  //    even when it is INVALID — fresh-parse parity is the contract, and a
  //    silent stale product answers a different question. When the install is
  //    rejected outright, the failure must not take the queue with it.
  //
  describe('a rebuild that fails', () => {
    // The callee's arity leaves the re-derived application a missing argument,
    // which the definition constructor rejects.
    const declareArity2 = (ce: ComputeEngine) =>
      ce.declare('a', { signature: '(number, number) -> number' });

    test('an incompatible arity reads the same in either order', () => {
      const calleeFirst = evaluateInOrder(
        ['a(x,y)\\coloneq x+y', 'g(t)\\coloneq 2a(t)'],
        'g(3)'
      );
      const callerFirst = evaluateInOrder(
        ['g(t)\\coloneq 2a(t)', 'a(x,y)\\coloneq x+y'],
        'g(3)'
      );
      expect(callerFirst.interpreted).toEqual(calleeFirst.interpreted);
      expect(callerFirst.compiled).toEqual(calleeFirst.compiled);
    });

    test('the error surfaces and no dependent is dropped', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      ce.parse('h(t)\\coloneq 2a(t)+1').evaluate();

      const generation = ce._anyVersion;
      expect(() => declareArity2(ce)).toThrow();

      // The callee's own installation is committed — it is valid; only the
      // dependents' rebuilds failed — and so is the generation bump the
      // caller's post-`updateDef` bookkeeping would have been skipped by.
      expect((ce.lookupDefinition('a') as any).operator).toBeDefined();
      expect(ce._anyVersion).toBeGreaterThan(generation);

      // Each dependent kept its previous definition...
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('6a');
      expect(ce.parse('h(3)').evaluate().toString()).toEqual('6a + 1');
      // ...and BOTH are still waiting, so a later redefinition can retry them.
      // The first failure used to abort the loop over a queue that had already
      // been drained, losing every dependent after it.
      expect(takeProvisionalDependents(ce, 'a')).toHaveLength(2);
    });
  });

  //
  // 8/ The registry holds STRONG references to the definitions waiting on a
  //    name, so a superseded definition must leave it with the record.
  //
  describe('superseded definitions leave the registry', () => {
    test('only the installed definition waits on the callee', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      ce.parse('g(t)\\coloneq 3a(t)').evaluate();
      ce.parse('g(t)\\coloneq 4a(t)').evaluate();
      // Each reassignment builds a FRESH operator definition; the two it
      // superseded used to stay in the registry forever, one orphan — with its
      // literal and raw operands — per reassignment.
      expect(takeProvisionalDependents(ce, 'a')).toHaveLength(1);
    });

    test('the last definition is the one repaired', () => {
      const ce = new ComputeEngine();
      ce.parse('g(t)\\coloneq 2a(t)').evaluate();
      ce.parse('g(t)\\coloneq 3a(t)').evaluate();
      ce.parse('a(t)\\coloneq t^2').evaluate();
      expect(ce.parse('g(3)').evaluate().toString()).toEqual('27');
    });
  });
});
