import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// 1. A list that holds a failed cell, grown in a loop (`fs = [...fs, x]`),
//    stays one flat list. Before, each turn added one level of `ListJoin`
//    nesting, and at about 1000 turns a walk of the value threw a
//    `RangeError` to the host. No walk of a statement value may throw to the
//    host: a walk that throws becomes a diagnostic.
//
// 2. An error that the taken branch of an `if` makes when it is evaluated
//    (a call of a user function whose body fails) has the frame of that
//    branch, not of the condition.
//

const G = 'function g(x) { 1/x }\n';

const ERR = 'Error(ErrorCode("incompatible-type", "number", "string"), "a")';

function run(
  source: string,
  ce = new ComputeEngine()
): ReturnType<typeof executeEpsil> & { at: string[]; codes: string[] } {
  const result = executeEpsil(ce, source);
  return {
    ...result,
    // The source text under each diagnostic.
    at: result.diagnostics.map((d) => source.slice(d.range[0], d.range[1])),
    codes: result.diagnostics.map((d) => String(d.message[0])),
  };
}

describe('A LIST WITH A FAILED CELL GROWN IN A LOOP', () => {
  test('every cell fails: 1000 turns give a flat list', () => {
    const r = run(
      G + 'let fs = []\nfor i in 1..1000 { fs = [...fs, g("a")] }\nfs'
    );
    expect(r.value.operator).toBe('List');
    expect(r.value.nops).toBe(1000);
    expect(r.value.errors.length).toBe(1000);
    expect(r.value.ops!.every((x) => x.toString() === ERR)).toBe(true);
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.at).toEqual(['fs = [...fs, g("a")]']);
  });

  test('only the first cell fails: 3200 turns give a flat list', () => {
    const r = run(
      G +
        'let fs = []\nfor i in 1..3200 { fs = [...fs, if i == 1 { g("a") } else { i }] }\nfs'
    );
    expect(r.value.operator).toBe('List');
    expect(r.value.nops).toBe(3200);
    // The failed cell is kept in its position, and the other cells are the
    // numbers.
    expect(r.value.errors.length).toBe(1);
    expect(r.value.ops![0].operator).toBe('Error');
    expect(r.value.ops![1].toString()).toBe('2');
    expect(r.value.ops![3199].toString()).toBe('3200');
    expect(r.codes).toEqual(['runtime-error']);
  });

  test('a cell added at the front keeps the list flat', () => {
    const r = run(
      G + 'let fs = []\nfor i in 1..3 { fs = [g("a"), ...fs, i] }\nfs'
    );
    expect(r.value.toString()).toBe(`[${ERR},${ERR},${ERR},1,2,3]`);
  });

  test('a list without a failed cell is unchanged', () => {
    const r = run('let fs = []\nfor i in 1..4 { fs = [...fs, i] }\nfs');
    expect(r.value.toString()).toBe('[1,2,3,4]');
    expect(r.diagnostics).toEqual([]);
  });
});

describe('A WALK OF A STATEMENT VALUE THAT THROWS', () => {
  // A value can be nested so deeply that a recursive walk overflows the
  // stack. Here a getter is replaced by one that throws for a marked value,
  // the list `[7, 7, 7]`, from its call number `from` on. The first read of
  // `errors` is inside the per-statement `try`, which already turns an
  // exception into the value of the statement; the reads after it are the
  // walks outside that `try`.
  function withThrowingGetter(
    name: 'json' | 'errors',
    from: number,
    body: () => void
  ) {
    const ce = new ComputeEngine();
    const proto = Object.getPrototypeOf(ce.box(['List', 1]));
    let owner = proto;
    while (owner && !Object.getOwnPropertyDescriptor(owner, name))
      owner = Object.getPrototypeOf(owner);
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)!;
    let calls = 0;
    Object.defineProperty(proto, name, {
      configurable: true,
      get(this: any) {
        if (
          this.operator === 'List' &&
          this.nops === 3 &&
          this.ops.every((x: any) => x.re === 7)
        ) {
          calls += 1;
          if (calls >= from)
            throw new RangeError('Maximum call stack size exceeded');
        }
        return descriptor.get!.call(this);
      },
    });
    try {
      body();
    } finally {
      if (owner === proto) Object.defineProperty(proto, name, descriptor);
      else delete proto[name];
    }
  }

  const failures = (r: ReturnType<typeof executeEpsil>, source: string) =>
    r.diagnostics
      .filter(
        (x) =>
          x.message[0] === 'runtime-error' &&
          x.message[1] === 'Maximum call stack size exceeded'
      )
      .map((d) => source.slice(d.range[0], d.range[1]));

  for (const [name, from] of [
    ['json', 1],
    ['errors', 2],
  ] as const) {
    test(`a throwing \`${name}\` of a non-final statement is a diagnostic`, () => {
      withThrowingGetter(name, from, () => {
        const source = 'let xs = [7, 7, 7]\n1';
        let r: ReturnType<typeof executeEpsil> | undefined;
        expect(() => {
          r = executeEpsil(new ComputeEngine(), source);
        }).not.toThrow();
        expect(r!.value.toString()).toBe('1');
        expect(failures(r!, source)).toEqual(['let xs = [7, 7, 7]']);
      });
    });

    test(`a throwing \`${name}\` of the final statement is a diagnostic`, () => {
      withThrowingGetter(name, from, () => {
        const source = '[7, 7, 7]';
        let r: ReturnType<typeof executeEpsil> | undefined;
        expect(() => {
          r = executeEpsil(new ComputeEngine(), source);
        }).not.toThrow();
        expect(r!.value.operator).toBe('List');
        expect(failures(r!, source)).toEqual(['[7, 7, 7]']);
      });
    });
  }
});

describe('THE FRAME OF AN ERROR FROM A BRANCH OF AN IF', () => {
  test('the then branch is argument 2', () => {
    const r = run(G + 'let n = 2\nlet v = if n == 2 { g("a") } else { n }\nv');
    expect(r.codes).toEqual(['runtime-error']);
    expect(r.diagnostics[0].message[2]).toBe('in If argument 2');
    expect(r.at).toEqual(['{ g("a") }']);
    expect(r.value.toString()).toBe(ERR);
  });

  test('the else branch is argument 3', () => {
    const r = run(G + 'let n = 2\nlet v = if n == 3 { n } else { g("a") }\nv');
    expect(r.diagnostics[0].message[2]).toBe('in If argument 3');
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('an error of the condition is argument 1', () => {
    const r = run(G + 'let n = 2\nlet v = if g("a") == 2 { 1 } else { n }\nv');
    expect(r.diagnostics[0].message[2]).toBe(
      'in Equal argument 1, in If argument 1'
    );
    expect(r.at).toEqual(['g("a")']);
  });

  test('an error held by the branch when it is boxed is unchanged', () => {
    const r = run('let n = 2\nlet v = if n == 2 { ln("a") } else { n }\nv');
    const runtime = r.diagnostics.find((d) => d.message[0] === 'runtime-error');
    expect(runtime?.message[2]).toBe('in Ln argument 1, in If argument 2');
  });
});
