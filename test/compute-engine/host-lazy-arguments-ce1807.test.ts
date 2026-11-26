/**
 * CE-1807: a function of the host that is not `lazy` receives a `List`
 * where an argument evaluates to a finite lazy indexed collection (a `Range`,
 * a `Reverse`, a `Map`, ...), in the interpreter (`listedHostArguments()` of
 * `listed-element.ts`) and in compiled JavaScript, which builds the `List`
 * from its array (`hostCall()` of `compilation/ir/lower.ts`). Both use one
 * predicate for "function of the host" (`isHostFunctionDefinition()` of
 * `definition-guards.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  executeEpsil,
  parseEpsil,
  resolveLibraryNames,
} from '../../src/epsil';

/** An engine with functions of the host that record the operator and the
 *  JSON of their first argument in `seen`. */
function engine() {
  const ce = new ComputeEngine();
  const seen: string[] = [];
  const record = (name: string) => (ops: ReadonlyArray<any>) => {
    seen.push(`${name} ${ops[0].operator} ${JSON.stringify(ops[0].json)}`);
    return ce.number(0);
  };
  ce.declare('hostSum', {
    signature: '(indexed_collection<real>) -> real',
    evaluate: record('hostSum'),
  });
  ce.declare('hostLazy', {
    signature: '(indexed_collection<real>) -> real',
    lazy: true,
    evaluate: record('hostLazy'),
  });
  ce.declare('hostSet', {
    signature: '(collection<real>) -> real',
    evaluate: record('hostSet'),
  });
  // A callback with an effect: each call is recorded.
  ce.declare('tick', {
    signature: '(real) -> real',
    pure: false,
    evaluate: (ops) => {
      seen.push(`tick ${JSON.stringify(ops[0].json)}`);
      return ops[0];
    },
  });
  return { ce, seen };
}

/** The calls that the interpreter makes for the Epsil program `src`. */
function interpreted(src: string): string[] {
  const { ce, seen } = engine();
  const result = executeEpsil(ce, src);
  expect(result.diagnostics.map((d) => d.message)).toEqual([]);
  return seen;
}

/** The compilation of the Epsil program `src` on JavaScript, run once:
 *  the calls it makes, or the message of the decline. */
function compiled(src: string): string[] | { declined: string } {
  const { ce, seen } = engine();
  const [program] = parseEpsil(src);
  try {
    const result = compile(ce.box(resolveLibraryNames(program, src, ce)), {
      to: 'javascript',
      fallback: false,
    } as any);
    result.run!({});
  } catch (e) {
    return { declined: (e as Error).message };
  }
  return seen;
}

describe('a finite lazy collection given to a function of the host', () => {
  test.each([
    ['hostSum([1, 2])', 'hostSum List ["List",1,2]'],
    ['hostSum(1..3)', 'hostSum List ["List",1,2,3]'],
    ['hostSum(reverse([1, 2]))', 'hostSum List ["List",2,1]'],
    ['hostSum(map(x => x * 2, [1, 2]))', 'hostSum List ["List",2,4]'],
    ['hostSum([1, 2] + 1)', 'hostSum List ["List",2,3]'],
    ['hostSum(linspace(0, 1, 3))', 'hostSum List ["List",0,0.5,1]'],
    ['hostSum([k * 2 for k in 1..3])', 'hostSum List ["List",2,4,6]'],
  ])('%s: a List, interpreted and compiled', (src, call) => {
    expect(interpreted(src)).toEqual([call]);
    expect(compiled(src)).toEqual([call]);
  });

  test('a variable that holds a range', () => {
    const src = 'let r = 1..3; hostSum(r)';
    expect(interpreted(src)).toEqual(['hostSum List ["List",1,2,3]']);
    expect(compiled(src)).toEqual(['hostSum List ["List",1,2,3]']);
  });

  test('an if of two lists, and a list constant', () => {
    const src =
      'let t = 2; const L = [5, 6]; hostSum(if t > 1 { [1, 2] } else { [3, 4] }); hostSum(L)';
    const calls = ['hostSum List ["List",1,2]', 'hostSum List ["List",5,6]'];
    expect(interpreted(src)).toEqual(calls);
    expect(compiled(src)).toEqual(calls);
  });

  test('a list of a run-time length: interpreted, a List; compiled, declines', () => {
    const src = 'hostSum(filter([1, 2, 3], x => x > 1))';
    expect(interpreted(src)).toEqual(['hostSum List ["List",2,3]']);
    expect(compiled(src)).toEqual({
      declined: expect.stringMatching(/lazy collection/),
    });
  });

  test('a range of a length given at run time declines', () => {
    // The interpreter keeps a range above `ce.maxCollectionSize` as a view.
    const { ce } = engine();
    ce.declare('n', 'integer');
    expect(() =>
      compile(ce.box(['hostSum', ['Range', 1, 'n']]), {
        to: 'javascript',
        fallback: false,
      } as any)
    ).toThrow(/lazy collection/);
  });

  test('a Map callback with an effect: interpreted, called before the handler; compiled, declines', () => {
    const src = 'hostSum(map(x => tick(x), [1, 2, 3]))';
    expect(interpreted(src)).toEqual([
      'tick 1',
      'tick 2',
      'tick 3',
      'hostSum List ["List",1,2,3]',
    ]);
    // The interpreter lists the view after the other arguments; the code
    // would build it where it stands.
    expect(compiled(src)).toEqual({
      declined: expect.stringMatching(/list argument that has an effect/),
    });
  });

  test('a Tabulate callback with an effect: interpreted, called before the handler; compiled, declines', () => {
    // Its count is its outer dimension, read with no call of the callback
    // (`hasConstantTimeCount()`), so the interpreter lists it (CE-1809).
    const src = 'hostSum(tabulate(i => tick(i), 3))';
    expect(interpreted(src)).toEqual([
      'tick 1',
      'tick 2',
      'tick 3',
      'hostSum List ["List",1,2,3]',
    ]);
    expect(compiled(src)).toEqual({
      declined: expect.stringMatching(/Tabulate with an effect/),
    });
  });

  test('a function with only an evaluateAsync handler receives a List', async () => {
    const { ce } = engine();
    const got: string[] = [];
    ce.declare('hostLater', {
      signature: '(indexed_collection<real>) -> real',
      evaluateAsync: async (ops) => {
        got.push(JSON.stringify(ops[0].json));
        return ce.number(0);
      },
    });
    await ce.box(['hostLater', ['Range', 1, 3]]).evaluateAsync();
    expect(got).toEqual(['["List",1,2,3]']);
  });

  test('N() and evaluateAsync() pass a List', async () => {
    const { ce, seen } = engine();
    ce.box(['hostSum', ['Range', 1, 3]]).N();
    await ce.box(['hostSum', ['Reverse', ['List', 1, 2]]]).evaluateAsync();
    await ce
      .box(['hostSum', ['Range', 1, 2]])
      .evaluateAsync({ numericApproximation: true });
    expect(seen).toEqual([
      'hostSum List ["List",1,2,3]',
      'hostSum List ["List",2,1]',
      'hostSum List ["List",1,2]',
    ]);
  });
});

describe('the arguments that are not changed', () => {
  test('a lazy function of the host receives the operand as written', () => {
    const src = 'hostLazy(1..3)';
    expect(interpreted(src)).toEqual(['hostLazy Range ["Range",1,3,1]']);
    // A lazy function is not a function of the host for the compiler.
    expect(compiled(src)).toEqual({
      declined: expect.stringMatching(/not the library operator/),
    });
  });

  test('an endless range stays a view, and the compilation declines', () => {
    const src = 'hostSum(1..oo)';
    expect(interpreted(src)).toEqual([
      'hostSum Range ["Range",1,"PositiveInfinity",1]',
    ]);
    expect(compiled(src)).toEqual({
      declined: expect.stringMatching(/constant infinity/),
    });
  });

  test('a set, and a view over a set', () => {
    expect(interpreted('hostSet({1, 2})')).toEqual([
      'hostSet Set ["Set",1,2]',
    ]);
    expect(interpreted('hostSet(map(x => x * 2, {1, 2}))')).toEqual([
      'hostSet Map ["Map",["Function",["Block",["Multiply",2,"x"]],"x"],["Set",1,2]]',
    ]);
    expect(compiled('hostSet({1, 2})')).toEqual({
      declined: expect.any(String),
    });
  });

  test('a range nested in a list argument stays a range', () => {
    const { ce, seen } = engine();
    ce.declare('hostAny', {
      signature: '(any) -> real',
      evaluate: (ops) => {
        seen.push(JSON.stringify(ops[0].json));
        return ce.number(0);
      },
    });
    executeEpsil(ce, 'hostAny([1..3])');
    expect(seen).toEqual(['["List",["Range",1,3,1]]']);
  });

  test('a user function receives the view', () => {
    const { ce } = engine();
    const result = executeEpsil(
      ce,
      'function f(xs: list<integer>) -> list<integer> { xs }; f(1..3)'
    );
    expect(result.value?.json).toEqual(['Range', 1, 3, 1]);
  });

  test('a range above ce.maxCollectionSize stays a view', () => {
    const { ce, seen } = engine();
    ce.maxCollectionSize = 5;
    ce.box(['hostSum', ['Range', 1, 6]]).evaluate();
    ce.box(['hostSum', ['Range', 1, 5]]).evaluate();
    expect(seen).toEqual([
      'hostSum Range ["Range",1,6]',
      'hostSum List ["List",1,2,3,4,5]',
    ]);
  });
});
