/**
 * CE-827. The type of a block is read after the scope of the block was left.
 * An occurrence of a local of the block then cannot reach its own binding,
 * and the read by name found another binding of the same name, for example a
 * global. With `n := [1, 2]`, `Block(Declare(n, "real", 2), n + 1)` was typed
 * `list<real>`, and its value is `3`.
 *
 * A type computation now reads no binding for a block local when the only
 * binding of the name that it can reach is not a local of that block
 * (`isOutsideBindingOfBlockLocal()`, `boxed-expression/binders.ts`). Each
 * test compares the type with the type that the same expression has in an
 * engine with no global of that name.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil';

type Json = Parameters<ComputeEngine['box']>[0];

/** An engine where `name` is a global that holds the list `[1, 2]`. */
function engineWithGlobalList(name: string): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign(name, ce.box(['List', 1, 2]));
  return ce;
}

/** The type of `json` before a run, its value, and its type after the run. */
function typeValueType(ce: ComputeEngine, json: Json): [string, unknown, string] {
  const e = ce.box(json);
  const before = e.type.toString();
  const value = e.evaluate().json;
  return [before, value, e.type.toString()];
}

const WITNESS: Json = ['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 1]];

describe('CE-827: THE TYPE OF A BLOCK LOCAL IGNORES A GLOBAL OF THE SAME NAME', () => {
  test('a declared local: the type is that of the local, before and after a run', () => {
    expect(typeValueType(engineWithGlobalList('n'), WITNESS)).toEqual([
      'real',
      3,
      'real',
    ]);
    // The same answer as in an engine with no global `n`.
    expect(typeValueType(new ComputeEngine(), WITNESS)).toEqual([
      'real',
      3,
      'real',
    ]);
  });

  test('a global that is assigned after the block was boxed', () => {
    const ce = new ComputeEngine();
    const e = ce.box(WITNESS);
    expect(e.type.toString()).toBe('real');
    ce.assign('n', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().json).toBe(3);
    expect(e.type.toString()).toBe('real');
  });

  test('an assignment to a name with no binding is an error', () => {
    const ce = new ComputeEngine();
    // `q` has no binding when the block is boxed, so the assignment is the
    // error `assignment-to-undeclared-variable`. The global `q` is made after.
    const e = ce.box(['Block', ['Assign', 'q', 2], ['Add', 'q', 1]]);
    ce.assign('q', ce.box(['List', 1, 2]));
    expect(e.isValid).toBe(false);
    expect(e.type.toString()).toBe('error');
    expect(JSON.stringify(e.evaluate().json)).toContain(
      'assignment-to-undeclared-variable'
    );
    expect(e.type.toString()).toBe('error');
    // The run did not write the global.
    expect(ce.box('q').evaluate().json).toEqual(['List', 1, 2]);
  });

  test('a read of the local from a nested block', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      ['Block', ['Add', 'n', 1]],
    ];
    expect(typeValueType(engineWithGlobalList('n'), json)).toEqual([
      'real',
      3,
      'real',
    ]);
  });

  test('a read of the local from a branch of a conditional', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      ['If', ['Greater', 'n', 1], ['Add', 'n', 1], 0],
    ];
    const withGlobal = typeValueType(engineWithGlobalList('n'), json);
    expect(withGlobal).toEqual(typeValueType(new ComputeEngine(), json));
    expect(withGlobal[1]).toBe(3);
    // Before the fix: `integer | list<real>`.
    expect(withGlobal[0]).not.toContain('list');
  });

  test('a nested block that declares the same name reads its own local', () => {
    const json: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      [
        'Block',
        ['Declare', 'n', "'list<real>'", ['List', 5, 6]],
        ['Add', 'n', 1],
      ],
    ];
    expect(typeValueType(engineWithGlobalList('n'), json)).toEqual([
      'list<real>',
      ['List', 6, 7],
      'list<real>',
    ]);
  });

  test('a block in the body of a big operator', () => {
    const ce = new ComputeEngine();
    const e = ce.box([
      'Sum',
      ['Block', ['Declare', 'm', "'real'", 'k'], ['Multiply', 'm', 2]],
      ['Limits', 'k', 1, 3],
    ]);
    ce.assign('m', ce.box(['List', 1, 2]));
    expect(e.type.toString()).toBe('real');
    expect(e.evaluate().json).toBe(12);
    expect(e.type.toString()).toBe('real');
  });

  test('a local of the body of a function literal', () => {
    const types = (ce: ComputeEngine): string[] => {
      const f = ce.box([
        'Function',
        ['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 'x']],
        'x',
      ]);
      ce.assign('f', f);
      const call = ce.box(['f', 3]);
      const before = [f.type.toString(), call.type.toString()];
      expect(call.evaluate().json).toBe(5);
      return [...before, f.type.toString(), call.type.toString()];
    };
    const withGlobal = types(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(types(new ComputeEngine()));
    // Before the fix: `(x: unknown) -> list<number>`.
    expect(withGlobal[0]).toBe('(x: unknown) -> number');
  });

  test('the Epsil form: a `let` local of a function', () => {
    const types = (ce: ComputeEngine): string[] => {
      executeEpsil(ce, 'function f() { let n: real = 2; n + 1 }');
      const before = [ce.box('f').type.toString(), ce.box(['f']).type.toString()];
      expect(executeEpsil(ce, 'f()').value?.json).toBe(3);
      return [
        ...before,
        ce.box('f').type.toString(),
        ce.box(['f']).type.toString(),
      ];
    };
    const withGlobal = types(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(types(new ComputeEngine()));
    // Before the fix: `() -> list<real>`.
    expect(withGlobal[0]).toBe('() -> real');
  });

  test('a function literal that a block returns, called after the run', () => {
    const run = (ce: ComputeEngine): unknown[] => {
      const e = ce.box([
        'Block',
        ['Declare', 'n', "'real'", 2],
        ['Function', ['Add', 'n', 'x'], 'x'],
      ]);
      const before = e.type.toString();
      const closure = e.evaluate();
      ce.assign('g', closure);
      const call = ce.box(['g', 1]);
      return [
        before,
        closure.type.toString(),
        call.type.toString(),
        call.evaluate().json,
        call.type.toString(),
      ];
    };
    const withGlobal = run(engineWithGlobalList('n'));
    expect(withGlobal).toEqual(run(new ComputeEngine()));
    // Before the fix: `(x: unknown) -> list<number>`, and `list<real>` for
    // the call, whose value is `3`.
    expect(withGlobal).toEqual([
      '(x: unknown) -> number',
      '(x: unknown) -> number',
      'number',
      3,
      'number',
    ]);
  });

  test('the other binding is a shield of the name (`HoldValues`)', () => {
    // `HoldValues(y + 1, y)` hides the value of `y` with a binding of its
    // own, which is not the local of the block either.
    const json: Json = [
      'Block',
      ['Declare', 'y', "'real'", 3],
      ['HoldValues', ['Add', 'y', 1], 'y'],
    ];
    const withGlobal = typeValueType(engineWithGlobalList('y'), json);
    expect(withGlobal).toEqual(typeValueType(new ComputeEngine(), json));
    // Before the fix: `list<real>`.
    expect(withGlobal).toEqual(['real', ['Add', 'y', 1], 'real']);
  });

  test('the local is the upper bound of a sum', () => {
    const json: Json = [
      'Block',
      ['Declare', 'y', "'integer'", 3],
      ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 'y']],
    ];
    // Before the fix: `list<integer>`.
    expect(typeValueType(engineWithGlobalList('y'), json)).toEqual([
      'integer',
      18,
      'integer',
    ]);
  });

  test('the global keeps its value and its type', () => {
    const ce = engineWithGlobalList('n');
    const e = ce.box(WITNESS);
    expect(e.evaluate().json).toBe(3);
    const n = ce.box('n');
    expect(n.evaluate().json).toEqual(['List', 1, 2]);
    expect(ce.box(['Add', 'n', 1]).evaluate().json).toEqual(['List', 2, 3]);
    expect(ce.box(['Add', 'n', 1]).type.toString()).toBe('vector<integer^2>');
  });
});

/**
 * CE-834. The asynchronous evaluation of an operator that maps over its
 * operands (`Add`, `Multiply`, `Sin`, `Equal`) tests whether an operand is a
 * collection, and the test reads the value of a symbol. In an asynchronous
 * run of a block, each such test must read a local of the block in the
 * block, where the local has its value, and not a global of the same name.
 * The engine has the scopes of an asynchronous evaluation in place only
 * until the first `await` of the evaluation of a call, so a test that runs
 * after an `await` must put them in place again.
 *
 * When a test reads the global, with `n := [1, 2]`, the run of
 * `Block(Declare(n, "real", 2), n + 1)` starts a broadcast of `n + 1` with
 * one cell, `n + 1`, and evaluates that cell the same way, with no end, and
 * `n = 2` in that block gives `[False, True]`.
 *
 * Each test compares `evaluateAsync()` with `evaluate()`, each one in a new
 * engine. The asynchronous run starts inside a time limit, so a run that
 * does not end fails the test with a `CancellationError`.
 */
describe('CE-834: AN ASYNCHRONOUS RUN OF A BLOCK READS ITS LOCAL, NOT A GLOBAL OF THE SAME NAME', () => {
  type Boxed = ReturnType<ComputeEngine['box']>;

  /** Start `expr.evaluateAsync()` inside a `withTimeLimit` span of 3
   * seconds. The span closes when the call returns its promise, and the
   * limit stays with the evaluation. */
  function evaluateAsyncWithin(ce: ComputeEngine, expr: Boxed): Promise<Boxed> {
    let p: Promise<Boxed> | undefined;
    ce.withTimeLimit({ ms: 3000, label: 'test:ce-834' }, () => {
      p = expr.evaluateAsync();
      return 0;
    });
    return p!;
  }

  /** The value of `json` with `evaluate()` and with `evaluateAsync()`, each
   * in an engine that `makeEngine` gives. */
  async function syncAndAsync(
    makeEngine: () => ComputeEngine,
    json: Json
  ): Promise<[unknown, unknown]> {
    const sync = makeEngine().box(json).evaluate().json;
    const ce = makeEngine();
    const async = (await evaluateAsyncWithin(ce, ce.box(json))).json;
    return [sync, async];
  }

  const withGlobalN = (): ComputeEngine => engineWithGlobalList('n');

  test('a declared local, the global holds a list', async () => {
    expect(await syncAndAsync(withGlobalN, WITNESS)).toEqual([3, 3]);
  });

  test.each([
    ['Multiply', ['Multiply', 'n', 3], 6],
    ['Sin', ['Sin', 'n'], ['Sin', 2]],
    ['nested calls', ['Add', ['Power', 'n', 2], ['Multiply', 'n', 2]], 8],
    ['a list of the local', ['Add', ['List', 'n', 'n'], 'n'], ['List', 4, 4]],
    // A relational operator does not evaluate its operands before its
    // handler runs, so the operand `n` is still a symbol in the step that
    // maps over the evaluated operands. That step runs after an `await`,
    // and must still read the local: a read of the global gives
    // `[False, True]`.
    ['Equal', ['Equal', 'n', 2], 'True'],
    ['Less', ['Less', 'n', 3], 'True'],
    [
      'a condition on the local',
      ['If', ['Greater', 'n', 1], ['Add', 'n', 1], 0],
      3,
    ],
  ] as [string, Json, unknown][])(
    'another operator that maps over its operands: %s',
    async (_label, body, expected) => {
      const block: Json = ['Block', ['Declare', 'n', "'real'", 2], body];
      expect(await syncAndAsync(withGlobalN, block)).toEqual([
        expected,
        expected,
      ]);
    }
  );

  test('an assignment to a name with no binding is an error', async () => {
    const run = async (async: boolean): Promise<unknown> => {
      const ce = new ComputeEngine();
      // `q` has no binding when the block is boxed, so the assignment is the
      // error `assignment-to-undeclared-variable`. The global `q` is made
      // after.
      const e = ce.box(['Block', ['Assign', 'q', 2], ['Add', 'q', 1]]);
      ce.assign('q', ce.box(['List', 1, 2]));
      const value = async ? await evaluateAsyncWithin(ce, e) : e.evaluate();
      // The run did not write the global.
      expect(ce.box('q').evaluate().json).toEqual(['List', 1, 2]);
      return value.json;
    };
    const error = [
      'Error',
      ['ErrorCode', "'assignment-to-undeclared-variable'", "'q'"],
      ['ErrorTrace', ['ErrorFrame', "'Block'", 1]],
    ];
    expect([await run(false), await run(true)]).toEqual([error, error]);
  });

  test('a local of the body of a function literal', async () => {
    const call: Json = [
      'Apply',
      [
        'Function',
        ['Block', ['Declare', 'n', "'real'", 2], ['Add', 'n', 'x']],
        'x',
      ],
      3,
    ];
    expect(await syncAndAsync(withGlobalN, call)).toEqual([5, 5]);
  });

  test('a block in the body of a big operator', async () => {
    const sum: Json = [
      'Sum',
      ['Block', ['Declare', 'n', "'real'", 'k'], ['Multiply', 'n', 2]],
      ['Limits', 'k', 1, 3],
    ];
    expect(await syncAndAsync(withGlobalN, sum)).toEqual([12, 12]);
  });

  test('two asynchronous runs of one block at the same time', async () => {
    const ce = withGlobalN();
    const e = ce.box(WITNESS);
    const values = await Promise.all([
      evaluateAsyncWithin(ce, e),
      evaluateAsyncWithin(ce, e),
    ]);
    expect(values.map((v) => v.json)).toEqual([3, 3]);
  });

  test('the local holds a list and the global holds a number', async () => {
    const block: Json = [
      'Block',
      ['Declare', 'n', "'list<real>'", ['List', 1, 2]],
      ['Add', 'n', 1],
    ];
    const withGlobalNumber = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.assign('n', 5);
      return ce;
    };
    expect(await syncAndAsync(withGlobalNumber, block)).toEqual([
      ['List', 2, 3],
      ['List', 2, 3],
    ]);
  });

  test('a restriction that is lifted over the call', async () => {
    // The guard `0 < t` is not decided, so the call is held under it. The
    // operand `n` of the lifted call is the local.
    const block: Json = [
      'Block',
      ['Declare', 'n', "'real'", 2],
      ['Add', ['If', ['Less', 0, 't'], ['List', 1, 2]], 'n'],
    ];
    const held = ['If', ['Less', 0, 't'], ['List', 3, 4]];
    expect(await syncAndAsync(withGlobalN, block)).toEqual([held, held]);
  });

  test('a restriction that stays an operand of a user function', async () => {
    // The parameter `a` of `f` has no declared type, so the restriction is
    // not lifted over the call: the step that looks at it evaluates its
    // condition, which does `await`, and changes nothing. The steps after it
    // must still read the local `xs` in the block, where it holds a list.
    // Outside the block `xs` has no value: a read there gives the call
    // unevaluated, `f(If(0 < t, ["a", "b"]), [3, 4])`.
    const withF = (): ComputeEngine => {
      const ce = new ComputeEngine();
      ce.assign('f', ce.box(['Function', ['Add', 'k', 1], 'a', 'k']));
      return ce;
    };
    const block: Json = [
      'Block',
      ['Declare', 'xs', "'list<real>'", ['List', 3, 4]],
      ['f', ['If', ['Less', 0, 't'], ['List', "'a'", "'b'"]], 'xs'],
    ];
    expect(await syncAndAsync(withF, block)).toEqual([
      ['List', 4, 5],
      ['List', 4, 5],
    ]);
  });
});
