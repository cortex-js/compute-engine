import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// CE-1748: a `function` statement whose body reads the value of its own
// call (`let y = rec(t - 1)`, then `y + 1` under `-> nothing`) is refused
// when it runs, with the error of the body: "expected `number`, got
// `nothing` at `y`", as for the same body with a function defined before.
// Before, the message said that the initializer is not a function.
//
// While the body is boxed, the self-call has no result type: a later clause
// of the same name or a broadcast over a list can give it another result
// than the stated one, so the static check does not report the error.
//

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('figureDraw', {
    signature: '(any) -> nothing',
    pure: false,
    evaluate: () => ce.symbol('Nothing'),
  });
  return ce;
}

/** The messages of the error diagnostics of a run of `source`, and the value
 * of the run. */
function run(source: string): { errors: string[]; value: string } {
  const r = executeEpsil(engine(), source);
  return {
    errors: r.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => String(d.message)),
    value: r.value.toString(),
  };
}

const READS_SELF_CALL = `function rec3(t: real) -> nothing { if t > 0 { let y = rec3(t - 1)
  figureDraw(y + 1) } else { figureDraw(0) } }`;

const BODY_ERROR = 'expected `number`, got `nothing` at `y`';

describe('CE-1748: a function whose body reads a Nothing self-call', () => {
  test('alone, the value of the program is the error of the body', () => {
    const { errors, value } = run(READS_SELF_CALL);
    expect(errors).toEqual([]);
    expect(value).toBe(
      'Error(ErrorCode("incompatible-type", "number", "nothing"), y)'
    );
  });

  test.each([
    ['after another statement', `const a = 1\n${READS_SELF_CALL}`],
    ['before another statement', `${READS_SELF_CALL}\nconst a = 1`],
  ])('%s, the run reports the error of the body', (_, src) => {
    const { errors } = run(src);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(BODY_ERROR);
    expect(errors[0]).not.toContain('initializer is not a function');
  });

  test('the same body with a function defined before gives the same error', () => {
    const { errors } = run(`function nr(t: real) -> nothing { figureDraw(0) }
function g(t: real) -> nothing { if t > 0 { let y = nr(t)
  figureDraw(y + 1) } else { figureDraw(0) } }`);
    expect(errors[0]).toContain(BODY_ERROR);
  });

  test.each([
    [
      'a self-call whose value is not read',
      `const a = 1
function rec4(t: real) -> nothing { if t > 0 { rec4(t - 1) } else { figureDraw(0) } }
rec4(2)`,
      // The text of the symbol `Nothing`.
      '"Nothing"',
    ],
    [
      'a stated result `real`',
      `const a = 1
function rec5(t: real) -> real { if t > 0 { let y = rec5(t - 1)
  y + 1 } else { 0 } }
rec5(3)`,
      '3',
    ],
    [
      // The self-call `f("s")` reaches the second clause, of result `real`.
      'a self-call that reaches a clause defined later',
      `function f(x: real) -> string { if x > 0 { let y = f("s")
  String(y + 1) } else { "n" } }
function f(x: string) -> real { 5 }
f(1)`,
      '"6"',
    ],
    [
      // The self-call over a list broadcasts, and gives a list.
      'a self-call that broadcasts',
      `function fib(n: integer) -> number { if n <= 1 { n } else { let ys = fib([n - 1, n - 2])
  ys[1] + ys[2] } }
fib(5)`,
      '5',
    ],
  ])('%s is accepted', (_, src, value) => {
    expect(run(src)).toEqual({ errors: [], value });
  });

  test('a callback with an error in a branch that does not run keeps its list type', () => {
    // The static check reports the error in the branch; the run of `map`
    // never reaches it, and the declared list accepts the result.
    const r = executeEpsil(
      new ComputeEngine(),
      'let ys: list<real> = map((x) => if x > 0 { x } else { x + "s" }, [1, 2])\nys'
    );
    expect(r.value.toString()).toBe('[1,2]');
  });

  test('a declared signature does not call a literal with an error "not a function"', () => {
    const ce = new ComputeEngine();
    ce.declare('kk', '(real) -> real');
    expect(() =>
      ce.assign(
        'kk',
        ce.expr([
          'Function',
          ['If', ['Greater', 'x', 0], 'x', ['Add', 'x', "'s'"]],
          'x',
        ])
      )
    ).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('not a function'),
      })
    );
  });
});
