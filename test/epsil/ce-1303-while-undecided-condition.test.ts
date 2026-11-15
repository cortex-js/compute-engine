import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

//
// CE-1303: a `while` whose condition is neither `True` nor `False` (a
// comparison with a name that has no value) ends the loop with the
// `incompatible-type` error (expected `boolean`, at the condition), which the
// run reports as a runtime error. It used to never return: the parser lowers
// `while c { b }` to `Loop(Block(If(Not(c), Break), b))`, and the held `If`
// never takes the `Break`.
//
// The per-test timeout of the runner does not stop a synchronous loop, so
// each engine has an `iterationLimit` as a backstop: a regression then
// fails with `iteration-limit-exceeded` instead of hanging the runner.
//

const LIMIT = 200;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.iterationLimit = LIMIT;
  return ce;
}

function messages(r: { diagnostics: { message: unknown }[] }): string[] {
  return r.diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message.join(' | ') : String(d.message)
  );
}

function run(
  source: string,
  ce = engine()
): { value: string; diagnostics: string[] } {
  const r = executeEpsil(ce, source);
  return { value: r.value.toString(), diagnostics: messages(r) };
}

describe('CE-1303: while with an undecided condition', () => {
  test('a bound with no value ends the loop with an error', () => {
    const r = run('let i = 1\nwhile i <= n {\n  i = i + 1\n}\ni');
    expect(r.value).toBe('1');
    expect(r.diagnostics).toEqual([
      'runtime-error | incompatible type: boolean at `i <= n` | in If argument 1 | incompatible-type',
    ]);
  });

  test('length(L) with L free ends the loop with an error', () => {
    const r = run(
      'let total = 0\nlet i = 1\n' +
        'while i <= length(L) { total = total + L[i]; i = i + 1 }\n' +
        '[total, i]'
    );
    expect(r.value).toBe('[0,1]');
    expect(r.diagnostics).toEqual([
      'runtime-error | incompatible type: boolean at `i <= length(L)` | in If argument 1 | incompatible-type',
    ]);
  });

  test('the loop stops after the iterations whose condition was decided', () => {
    const r = run(
      'let i = 0\nwhile i < 3 { i = i + 1 }\nwhile i < m { i = i + 1 }\ni'
    );
    expect(r.value).toBe('3');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toContain('incompatible type: boolean at `i < m`');
  });

  test('a negated condition', () => {
    const r = run('let i = 0\nwhile !done { i = i + 1 }\ni');
    expect(r.value).toBe('0');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toContain('incompatible type: boolean at `!done`');
  });

  test('a body of two statements', () => {
    const r = run(
      'let i = 0\nlet s = 0\nwhile i < m { i = i + 1; s = s + i }\n[i, s]'
    );
    expect(r.value).toBe('[0,0]');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toContain('incompatible type: boolean at `i < m`');
  });

  test('an empty body', () => {
    const r = run('let i = 0\nwhile i < m {}\ni');
    expect(r.value).toBe('0');
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0]).toContain('incompatible type: boolean at `i < m`');
  });

  test('in a function body, the error is the value of the call', () => {
    const src = 'function f(n) { let i = 1; while i <= n { i = i + 1 }; i }\n';
    expect(run(src + 'f(4)')).toEqual({ value: '5', diagnostics: [] });
    expect(run(src + 'f(m)').value).toBe(
      'Error(ErrorCode("incompatible-type", "boolean"), i <= m)'
    );
  });

  test('a function called several times', () => {
    const src = 'function f(n) { let i = 0; while i < n { i = i + 1 }; i }\n';
    expect(run(src + '[f(2), f(5)]')).toEqual({
      value: '[2,5]',
      diagnostics: [],
    });
    expect(
      run(src + 'let a = f(2)\nlet b = f(m)\nlet c = f(3)\n[a, c]')
    ).toEqual({
      value: '[2,3]',
      diagnostics: [
        'runtime-error | incompatible type: boolean at `i < m` | in If argument 1 | incompatible-type',
      ],
    });
  });

  test('a loop that runs inside itself keeps its mark', () => {
    // The outer run of the loop is undecided on its second turn, after an
    // inner run of the same loop (a recursive call) has ended.
    const r = run(
      'function r(d, b) { let i = 0; ' +
        'while i == 0 || i < b { i = i + 1; if d > 0 { r(d - 1, 2) } }; i }\n' +
        'r(1, m)'
    );
    expect(r.value).toBe(
      'Error(ErrorCode("incompatible-type", "boolean"), i == 0 || i < m)'
    );
  });

  test('the guard is not marked after its loop ends', () => {
    // A host that keeps the guard `If` and evaluates it after the loop gets
    // the held `If`, not the error of a `while`.
    const ce = engine();
    ce.declare('k', { type: 'integer', value: 0 });
    const loop = ce.box([
      'Loop',
      [
        'Block',
        ['If', ['Not', ['Less', 'k', 'm']], ['Break']],
        ['Block', ['Assign', 'k', ['Add', 'k', 1]]],
      ],
    ]);
    expect(loop.evaluate().operator).toBe('Error');
    const guard = loop.ops![0].ops![0];
    expect(guard.operator).toBe('If');
    expect(guard.evaluate().operator).toBe('If');
  });

  test('a condition undecided on the first turn ends the loop before the body runs', () => {
    // A condition must be decided at each turn: the body does not run to
    // give its name a value. In Epsil, `let x` with no value is a static
    // error, so the program does not run (as before CE-1303); a host loop
    // stops on the first turn, where it used to assign `x` and end.
    expect(run('let x\nwhile x != 5 { x = 5 }\nx').diagnostics).toEqual([
      'static-type-error | `x` is declared without a value: write `let x = …` | let x | declaration-without-value',
    ]);
    const ce = engine();
    ce.declare('x', 'integer');
    const loop = ce.box([
      'Loop',
      [
        'Block',
        ['If', ['Not', ['NotEqual', 'x', 5]], ['Break']],
        ['Block', ['Assign', 'x', 5]],
      ],
    ]);
    expect(loop.evaluate().toString()).toBe(
      'Error(ErrorCode("incompatible-type", "boolean"), x != 5)'
    );
    expect(ce.box('x').evaluate().toString()).toBe('x');
  });

  test('the program of the issue with a syntax error returns', () => {
    const r = run(
      'fn f(L: list<real>) { let total = 0; let i = 1; ' +
        'while i <= length(L) { total = total + L[i]; i = i + 1 }; total }; ' +
        'f([1, 2, 3])'
    );
    expect(r.diagnostics.slice(0, 2)).toEqual([
      'unexpected-symbol | f',
      'unexpected-symbol | }',
    ]);
    expect(r.diagnostics.join('\n')).not.toContain('iteration-limit');
  });

  test('executeEpsilAsync ends the loop the same way', async () => {
    const r = await executeEpsilAsync(
      engine(),
      'let i = 1\nwhile i <= n {\n  i = i + 1\n}\ni'
    );
    expect(r.value.toString()).toBe('1');
    expect(messages(r)).toEqual([
      'runtime-error | incompatible type: boolean at `i <= n` | in If argument 1 | incompatible-type',
    ]);
  });
});

describe('CE-1303: a decided while loop is unchanged', () => {
  test('value and number of evaluations of the condition', () => {
    const ce = engine();
    let calls = 0;
    // A host predicate that counts its calls: the condition is evaluated
    // once for each iteration, and once more for the test that ends the
    // loop.
    ce.declare('more', {
      signature: '(integer) -> boolean',
      evaluate: ([x]) => {
        calls += 1;
        return x.re < 3 ? ce.True : ce.False;
      },
    });
    const r = run('let i = 0\nwhile more(i) { i = i + 1 }\ni', ce);
    expect(r).toEqual({ value: '3', diagnostics: [] });
    expect(calls).toBe(4);
  });

  test('break in the body', () => {
    expect(
      run('let i = 0\nwhile true { i = i + 1\n if i == 5 { break } }\ni')
    ).toEqual({ value: '5', diagnostics: [] });
  });
});

describe('CE-1303: a Loop of another shape is unchanged', () => {
  test('a guard that is not the first statement of the body', () => {
    // `Loop(Block(Assign(…), If(c, Break)))` is not the form of a `while`:
    // its undecided guard is held, and the loop runs to the iteration limit.
    const ce = engine();
    ce.declare('j', { type: 'integer', value: 0 });
    const loop = ce.box([
      'Loop',
      [
        'Block',
        ['Assign', 'j', ['Add', 'j', 1]],
        ['If', ['Less', 'm', 'j'], ['Break']],
      ],
    ]);
    expect(() => loop.evaluate()).toThrow();
    expect(ce.box('j').evaluate().re).toBeGreaterThan(LIMIT);
  });
});
