// `epsilDebugStatements()` (`src/epsil/debug-statements.ts`): the statements
// of an Epsil source at which a debug run of `executeEpsilAsync()` can pause.
// Each case runs the source with a `beforeStatement` hook and checks the list
// against the run: no statement listed as "cannot pause" calls the hook, and
// every statement that calls it is listed as "can pause".

import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsilAsync } from '../../src/epsil/execute-epsil';
import { epsilDebugStatements } from '../../src/epsil/debug-statements';

type Run = {
  /** The text of each statement that the function lists, by `canPause`. */
  canPause: string[];
  cannotPause: string[];
  /** The text of each statement that called `beforeStatement`. */
  reached: string[];
  value: string;
};

/** Run `source` with a `beforeStatement` hook, and check the list of
 * `epsilDebugStatements()` against the statements that called it. */
async function check(
  source: string,
  setup?: (ce: ComputeEngine) => void
): Promise<Run> {
  const ce = new ComputeEngine();
  setup?.(ce);
  const sites = epsilDebugStatements(ce, source);
  const reachedRanges: [number, number][] = [];
  const result = await executeEpsilAsync(ce, source, {
    debug: {
      beforeStatement: (at) =>
        void reachedRanges.push([at.range[0], at.range[1]]),
    },
  });
  const text = ([start, end]: readonly [number, number]) =>
    source.slice(start, end);
  for (const range of reachedRanges) {
    // Every statement that called the hook is listed, as one that can pause.
    const site = sites.find(
      (s) => s.range[0] === range[0] && s.range[1] === range[1]
    );
    expect({ statement: text(range), canPause: site?.canPause }).toEqual({
      statement: text(range),
      canPause: true,
    });
  }
  return {
    canPause: sites.filter((s) => s.canPause).map((s) => text(s.range)),
    cannotPause: sites.filter((s) => !s.canPause).map((s) => text(s.range)),
    reached: reachedRanges.map(text),
    value: String(result.value),
  };
}

describe('Statements that can pause', () => {
  test('top-level statements and a function body', async () => {
    const run = await check(
      'function f(n) {\n  let a = n * 2\n  a + 1\n}\nf(3)'
    );
    expect(run.value).toBe('7');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toEqual(
      expect.arrayContaining(['f(3)', 'let a = n * 2', 'a + 1'])
    );
  });

  test('a loop body, a `while` body and a branch of `if`', async () => {
    const run = await check(
      'let s = 0\nfor i in 1..3 {\n  if i > 1 {\n    s += i\n  } else {\n    s += 10\n  }\n}\nlet j = 0\nwhile j < 2 { j += 1 }\ns'
    );
    expect(run.value).toBe('15');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toEqual(
      expect.arrayContaining(['s += i', 's += 10', 'j += 1'])
    );
  });

  test('a `do` block and a `parallel for` body', async () => {
    const run = await check(
      'let w = do { let q = 1; q + 1 }\nlet s = 0\nparallel for k in 1..2 { let t = k; s += t }\nw + s'
    );
    expect(run.value).toBe('5');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toEqual(
      expect.arrayContaining(['let q = 1', 'q + 1', 'let t = k', 's += t'])
    );
  });

  test('the body of a function that is not a block', async () => {
    const run = await check('let f = t => t * 2\nf(3)');
    expect(run.value).toBe('6');
    expect(run.reached).toContain('t * 2');
    expect(run.canPause).toContain('t * 2');
  });

  test('a function with a return type', async () => {
    const run = await check(
      'function f(t) -> number { let k = t; k + 1 }\nf(2)'
    );
    expect(run.value).toBe('3');
    expect(run.reached).toEqual(expect.arrayContaining(['let k = t', 'k + 1']));
  });

  test('the body of a function with no parameters', async () => {
    const run = await check(
      'let a = 0\nlet cb = () => do {\n  a = a + 1\n  a\n}\ncb()'
    );
    expect(run.value).toBe('1');
    expect(run.reached).toEqual([
      'let a = 0',
      'let cb = () => do {\n  a = a + 1\n  a\n}',
      'cb()',
      'a = a + 1',
      'a',
    ]);
  });

  test('the body of a recursive function with no parameters', async () => {
    const run = await check(
      'let n = 0\nlet f = () => do {\n  n = n + 1\n  if n < 2 { f() } else { n }\n}\nf()'
    );
    expect(run.value).toBe('2');
    expect(run.reached.filter((s) => s === 'n = n + 1')).toHaveLength(2);
  });

  test('the body of a function with no parameters that is not a block', async () => {
    const run = await check('let a = 1\nlet g = () => a + 1\ng()');
    expect(run.value).toBe('2');
    expect(run.reached).toContain('a + 1');
  });

  test('the predicate of `any` and `all`', async () => {
    const run = await check(
      'let a = any([1, 2, 3], k => do { let t = k; t > 1 })\nlet b = all([1, 2, 3], k => do { let u = k; u > 0 })\na && b'
    );
    expect(run.value).toBe('"True"');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toEqual(
      expect.arrayContaining(['let t = k', 'let u = k'])
    );
  });

  test('a `map` that the source defines is not the library `map`', async () => {
    const run = await check(
      'function map(f, xs) { let r = f(xs); r }\nmap(k => do { let t = k; t * 2 }, 3)'
    );
    expect(run.value).toBe('6');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toContain('let t = k');
  });

  test('a `Map` that the source defines hides the library `Map`', async () => {
    const run = await check(
      'function Map(f, xs) { let r = f(xs); r }\nMap(k => do { let t = k; t * 2 }, 3)'
    );
    expect(run.value).toBe('6');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toContain('let t = k');
  });

  test('a `Map` that a loop variable binds hides the library `Map`', async () => {
    const run = await check(
      'function invoke(f, xs) { let r = f(xs); r }\nfor Map in [invoke] { Map(k => do { let t = k; t }, 3) }'
    );
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toContain('let t = k');
  });

  test('a shorthand function inside a `let`, a list or a pipe', async () => {
    // The body is the operand that the engine makes a function, not the
    // statement or the expression that holds the call.
    const a = await check('let r = any([1, 2], _1 > 1)\nr');
    expect(a.canPause).toEqual(['let r = any([1, 2], _1 > 1)', '_1 > 1', 'r']);
    const b = await check('[any([1, 2], _1 > 1)]');
    expect(b.canPause).toEqual(['[any([1, 2], _1 > 1)]', '_1 > 1']);
    const c = await check('map(_ * 2, [1, 2]) |> sum');
    expect([...c.canPause, ...c.cannotPause]).toContain('_ * 2');
    expect([...c.canPause, ...c.cannotPause]).not.toContain(
      'map(_ * 2, [1, 2])'
    );
  });

  test('a shorthand function whose slot is the callee', async () => {
    const run = await check('any([t => t > 0], _1(1))');
    expect(run.value).toBe('"True"');
    expect(run.reached).toContain('_1(1)');
    expect(run.canPause).toContain('_1(1)');
  });

  test('the body of a shorthand function, listed once as a whole', async () => {
    const run = await check('any([1, 2], _1 > 1 + 2 * _1)');
    expect(run.value).toBe('"False"');
    expect(run.reached).toContain('_1 > 1 + 2 * _1');
    expect(run.canPause).toEqual([
      'any([1, 2], _1 > 1 + 2 * _1)',
      '_1 > 1 + 2 * _1',
    ]);
  });

  test('a statement of `withRandomSeed` when the engine has an operator with only an asynchronous handler', async () => {
    // The engine then evaluates the `if` on the asynchronous route.
    const run = await check(
      'withRandomSeed(1, if 1 > 0 { let a = 1; a } else { 0 })',
      (ce) =>
        ce.declare('SlowF', {
          signature: '(number) -> number',
          evaluateAsync: async (ops) => ops[0],
        })
    );
    expect(run.value).toBe('1');
    expect(run.reached).toEqual(expect.arrayContaining(['let a = 1', 'a']));
    expect(run.cannotPause).toEqual([]);
  });
});

describe('Statements that cannot pause', () => {
  test('the function of `map`', async () => {
    const run = await check('sum(map(k => do { let t = k; t * 2 }, 1..3))');
    expect(run.value).toBe('12');
    expect(run.cannotPause).toEqual(['let t = k', 't * 2']);
  });

  test('the body of a function of `map` that is not a block', async () => {
    const run = await check('sum(map(k => k * 2, [1, 2]))');
    expect(run.value).toBe('6');
    expect(run.cannotPause).toEqual(['k * 2']);
  });

  test('the predicate of `filter`, `takeWhile` and `count`', async () => {
    const run = await check(
      'let a = filter([1, 2, 3], k => do { let t = k; t > 1 })\nlet b = takeWhile(1..5, k => do { let u = k; u < 3 })\nlet c = count(1..3, k => do { let v = k; v > 1 })\n[a, b, c]'
    );
    expect(run.value).toBe('[[2,3],[1,2],2]');
    expect(run.cannotPause).toEqual([
      'let t = k',
      't > 1',
      'let u = k',
      'u < 3',
      'let v = k',
      'v > 1',
    ]);
  });

  test('the function of `map` in a pipe', async () => {
    const run = await check('[1, 2, 3] |> map(k => do { let t = k; t * 2 })');
    expect(run.value).toBe('[2,4,6]');
    expect(run.cannotPause).toEqual(['let t = k', 't * 2']);
  });

  test('a lazy collection that the host reads after the run', async () => {
    const ce = new ComputeEngine();
    const source = 'map(k => do { let t = k; t * 2 }, 1..3)';
    const reached: string[] = [];
    const result = await executeEpsilAsync(ce, source, {
      debug: {
        beforeStatement: (at) =>
          void reached.push(source.slice(at.range[0], at.range[1])),
      },
    });
    // The host reads the elements after the run.
    expect(String(result.value.evaluate({ materialization: true }))).toBe(
      '[2,4,6]'
    );
    expect(reached).toEqual([source]);
    const sites = epsilDebugStatements(ce, source);
    expect(
      sites
        .filter((s) => !s.canPause)
        .map((s) => source.slice(s.range[0], s.range[1]))
    ).toEqual(['let t = k', 't * 2']);
  });
});

describe('Statements of a function made in a place that cannot pause', () => {
  test('a function literal that `withRandomSeed` returns', async () => {
    const run = await check(
      'let h = withRandomSeed(1, t => do { let z = t; z })\nh(4)'
    );
    expect(run.value).toBe('4');
    expect(run.cannotPause).toEqual([]);
    expect(run.reached).toEqual(expect.arrayContaining(['let z = t', 'z']));
  });

  test('a function in a block of `withRandomSeed`', async () => {
    const run = await check(
      'let h = withRandomSeed(1, do { function g(x) { let y = x; y }; g })\nh(2)'
    );
    expect(run.value).toBe('2');
    expect(run.reached).toContain('let y = x');
    expect(run.cannotPause).not.toContain('let y = x');
  });

  test('a function literal that the function of `map` returns', async () => {
    const run = await check(
      'let fs = map(k => (t => do { let z = t + k; z }), 1..2)\nfs[1](5)'
    );
    expect(run.value).toBe('6');
    expect(run.reached).toEqual(expect.arrayContaining(['let z = t + k', 'z']));
  });
});

describe('Statements listed as "can pause" that never pause', () => {
  test('the operands of `withRandomSeed`, with a loop body', async () => {
    // With no operator that has only an asynchronous handler, the engine
    // evaluates them on the synchronous route.
    const run = await check(
      'withRandomSeed(7, do {\n  let s = 0\n  for k in 1..2 { s += k }\n  parallel for k in 1..2 { s += random(1..3) }\n  s > 0\n})'
    );
    expect(run.value).toBe('"True"');
    expect(run.reached).toEqual([
      'withRandomSeed(7, do {\n  let s = 0\n  for k in 1..2 { s += k }\n  parallel for k in 1..2 { s += random(1..3) }\n  s > 0\n})',
    ]);
    expect(run.cannotPause).toEqual([]);
  });

  test('a named function that only `map` applies', async () => {
    const run = await check(
      'function sq(k) {\n  let t = k * k\n  t\n}\nsum(map(sq, 1..3))'
    );
    expect(run.value).toBe('14');
    expect(run.canPause).toEqual(expect.arrayContaining(['let t = k * k']));
    expect(run.reached).not.toContain('let t = k * k');
  });

  test('a function called in the domain of a `for`', async () => {
    const run = await check(
      'function g(n) { let a = n; a }\nlet s = 0\nfor x in 1..g(2) { s += x }\ns'
    );
    expect(run.value).toBe('3');
    expect(run.canPause).toContain('let a = n');
    expect(run.reached).not.toContain('let a = n');
  });

  test('a `do` block in a comprehension', async () => {
    const run = await check('[do { let t = k; t } for k in 1..3]');
    expect(run.value).toBe('[1,2,3]');
    expect(run.canPause).toContain('let t = k');
    expect(run.reached).not.toContain('let t = k');
  });
});

describe('Sources with no statement', () => {
  test('an empty source', () => {
    expect(epsilDebugStatements(new ComputeEngine(), '')).toEqual([]);
  });

  test('a `#error` pragma', () => {
    expect(
      epsilDebugStatements(new ComputeEngine(), '#error "stop"\n1 + 2')
    ).toEqual([]);
  });
});
