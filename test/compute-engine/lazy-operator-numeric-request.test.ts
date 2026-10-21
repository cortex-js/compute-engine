import { ComputeEngine } from '../../src/compute-engine';

// Under `.N()`, a parameter of a user function is bound to the float of the
// argument, and the activation records the written argument
// (`exact-argument-source.ts`): a function that jumps (`Floor`, a
// comparison) evaluated with the numeric request reads the exact argument
// again when the float is near the jump. A `lazy` operator in the body
// (`If`, `Which`, `When`, `Pipe`, the quantifiers) holds its operands and
// evaluated them EXACTLY, so the comparison or the `Floor` inside read the
// float: `c((25! − 1)/24!).N()` for `c := x ↦ If(x < 25, 0, 1)` was 1, and
// `g((25! − 1)/24!).N()` for `g := x ↦ If(True, Floor(x), 0)` was 25. A lazy
// operator now forwards the numeric request to the operands it evaluates
// (user decision 2026-10-17).

const Q = ['Divide', ['Subtract', ['Factorial', 25], 1], ['Factorial', 24]];
const H = ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 10000]];

function engineWith(body: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('f', ce.box(['Function', body, 'x'] as any));
  return ce;
}

function n(ce: ComputeEngine, x: unknown): string {
  return ce
    .box(['f', x] as any)
    .N()
    .toString();
}

describe('a lazy operator in the body of a user function under .N()', () => {
  test('the condition of an If', () => {
    const ce = engineWith(['If', ['Less', 'x', 25], 0, 1]);
    expect(n(ce, Q)).toBe('0');
    expect(ce.box(['f', Q]).evaluate().toString()).toBe('0');
    // As written without the function.
    expect(
      ce
        .box(['If', ['Less', Q, 25], 0, 1])
        .N()
        .toString()
    ).toBe('0');
  });

  test('the branches of an If', () => {
    expect(n(engineWith(['If', 'True', ['Floor', 'x'], 0]), Q)).toBe('24');
    expect(n(engineWith(['If', 'False', 0, ['Floor', 'x']]), Q)).toBe('24');
  });

  test('the guard of a Which and of a When', () => {
    expect(n(engineWith(['Which', ['Less', 'x', 25], 0, 'True', 1]), Q)).toBe(
      '0'
    );
    expect(n(engineWith(['When', 0, ['Less', 'x', 25]]), Q)).toBe('0');
  });

  test('a connective in the condition of an If', () => {
    const lt = ['Less', 'x', 25];
    expect(n(engineWith(['If', ['And', lt, 'True'], 0, 1]), Q)).toBe('0');
    expect(n(engineWith(['If', ['Or', lt, 'False'], 0, 1]), Q)).toBe('0');
    expect(n(engineWith(['If', ['Not', lt], 0, 1]), Q)).toBe('1');
    expect(n(engineWith(['If', ['Implies', 'True', lt], 0, 1]), Q)).toBe('0');
  });

  test('a Pipe', () => {
    expect(n(engineWith(['Pipe', 'x', 'Floor']), Q)).toBe('24');
    expect(
      n(engineWith(['Pipe', 'x', ['Function', ['Floor', 'y'], 'y']]), Q)
    ).toBe('24');
  });

  test('the body of a quantifier', () => {
    const body = ['Less', 'x', ['Multiply', 25, 'k']];
    const domain = ['Element', 'k', ['List', 1]];
    expect(n(engineWith(['Exists', domain, body]), Q)).toBe('"True"');
    expect(n(engineWith(['ForAll', domain, body]), Q)).toBe('"True"');
  });

  test('a comparison of a jump in the body', () => {
    // The exact value of `Floor(x)` is not the exact evaluation of
    // `Floor(x)` with `x` bound to the float `25`: the comparison uses the
    // float `24` that the `Floor` reads from the recorded argument.
    expect(n(engineWith(['Equal', ['Floor', 'x'], 24]), Q)).toBe('"True"');
    expect(n(engineWith(['NotEqual', ['Floor', 'x'], 24]), Q)).toBe('"False"');
  });

  test('the parse route', () => {
    const ce = new ComputeEngine();
    ce.parse(
      'c(x) := \\text{if } x < 25 \\text{ then } 0 \\text{ else } 1'
    ).evaluate();
    ce.parse(
      'w(x) := \\begin{cases} 0 & x < 25 \\\\ 1 & \\text{otherwise}\\end{cases}'
    ).evaluate();
    ce.parse(
      'g(x) := \\text{if } x < 30 \\text{ then } \\lfloor x \\rfloor \\text{ else } 0'
    ).evaluate();
    const q = '\\frac{25! - 1}{24!}';
    expect(ce.parse(`c(${q})`).N().toString()).toBe('0');
    expect(ce.parse(`w(${q})`).N().toString()).toBe('0');
    expect(ce.parse(`g(${q})`).N().toString()).toBe('24');
    expect(ce.parse(`c(${q})`).evaluate().toString()).toBe('0');
  });

  test('the asynchronous route', async () => {
    const opts = { numericApproximation: true } as const;
    const c = engineWith(['If', ['Less', 'x', 25], 0, 1]);
    expect((await c.box(['f', Q] as any).evaluateAsync(opts)).toString()).toBe(
      '0'
    );
    const g = engineWith(['If', 'True', ['Floor', 'x'], 0]);
    expect((await g.box(['f', Q] as any).evaluateAsync(opts)).toString()).toBe(
      '24'
    );
    const w = engineWith(['Which', ['Less', 'x', 25], 0, 'True', 1]);
    expect((await w.box(['f', Q] as any).evaluateAsync(opts)).toString()).toBe(
      '0'
    );
  });
});

describe('a lazy operator at the top level under .N()', () => {
  test('the selected branch of an If is a float, as for Which', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['If', 'True', ['Sqrt', 2], 0])
        .N()
        .toString()
    ).toBe(
      ce
        .box(['Which', 'True', ['Sqrt', 2]])
        .N()
        .toString()
    );
    expect(
      ce
        .box(['If', 'True', ['Sqrt', 2], 0])
        .N()
        .toString()
    ).toBe(ce.box(['Sqrt', 2]).N().toString());
    // An exact evaluation is unchanged.
    expect(
      ce
        .box(['If', 'True', ['Sqrt', 2], 0])
        .evaluate()
        .toString()
    ).toBe('sqrt(2)');
  });

  test('a condition near a tie is decided exactly', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['If', ['Less', Q, 25], 0, 1])
        .N()
        .toString()
    ).toBe('0');
    expect(
      ce
        .box(['If', ['Less', 'Pi', ['Rational', 22, 7]], 0, 1])
        .N()
        .toString()
    ).toBe('0');
  });

  test('a condition decided by NaN takes the else branch, NotEqual none', () => {
    // User decision 2026-10-20: `NaN < 0` is `False` in a branch condition
    // too (before it, the `If` selected no branch and gave `Missing`). A
    // `NotEqual` with a NaN operand still selects no branch.
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['If', ['Less', 'NaN', 0], 1, 2])
        .N()
        .toString()
    ).toBe('2');
    expect(
      ce
        .box(['If', ['NotEqual', 'NaN', 0], 1, 2])
        .N()
        .toString()
    ).toBe('"Missing"');
  });

  test('an operand of the condition with an effect is evaluated once', () => {
    const ce = new ComputeEngine();
    ce.assign('m', 0);
    ce.box(['If', ['Less', ['Assign', 'm', ['Add', 'm', 0.5]], 25], 0, 1]).N();
    expect(ce.box('m').evaluate().toString()).toBe('0.5');
  });
});

// The exact value of H is a rational with thousands of digits: evaluating it
// exactly takes about 30 s (measured 2026-10-20 on an M5), while the numeric
// route takes about 0.1 s locally and up to 4 s on a loaded continuous-
// integration runner. A limit of 15 s separates the two routes on any of
// these machines; a limit of 2 s failed on the Node 26 runner. Each test sets
// a jest timeout above the limit, so a regression fails on the assertion and
// not on the default 5 s jest timeout.
const EXACT_ROUTE_LIMIT_MS = 15_000;
const TEST_TIMEOUT_MS = 20_000;

describe('the cost of the numeric request', () => {
  test(
    'an argument far from a jump is not evaluated exactly',
    () => {
      const ce = engineWith(['If', ['Less', 'x', 10], ['Floor', 'x'], 0]);
      const start = Date.now();
      expect(n(ce, H)).toBe('9');
      expect(Date.now() - start).toBeLessThan(EXACT_ROUTE_LIMIT_MS);
    },
    TEST_TIMEOUT_MS
  );

  test(
    'the condition of an If at the top level is evaluated numerically',
    () => {
      const ce = new ComputeEngine();
      const start = Date.now();
      expect(
        ce
          .box(['If', ['Less', H, 10], 0, 1])
          .N()
          .toString()
      ).toBe('0');
      expect(Date.now() - start).toBeLessThan(EXACT_ROUTE_LIMIT_MS);
    },
    TEST_TIMEOUT_MS
  );
});

describe('the operands of a condition under .N() given to the relation as written', () => {
  test('an operand with an effect keeps the values already computed', () => {
    // `rhs()` assigns `x` before the relation is decided. The relation must
    // compare the values read in order, `0.5 < 1`, not the value of `x` read
    // again after the effect, `10 < 1`.
    const ce = new ComputeEngine();
    ce.assign('x', 0.5);
    let calls = 0;
    ce.declare('rhs', {
      signature: '() -> number',
      pure: false,
      evaluate: () => {
        calls += 1;
        ce.assign('x', 10);
        return ce.One;
      },
    });
    expect(
      ce
        .box(['If', ['Less', 'x', ['rhs']], 1, 0])
        .N()
        .toString()
    ).toBe('1');
    expect(calls).toBe(1);
  });

  test('a pure operand far from a tie is evaluated once', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 0.3);
    let calls = 0;
    ce.declare('tick', {
      signature: '(number) -> number',
      evaluate: ([v]) => {
        calls += 1;
        return v;
      },
    });
    expect(
      ce
        .box(['If', ['Less', ['tick', 'x'], 1], 1, 0])
        .N()
        .toString()
    ).toBe('1');
    expect(calls).toBe(1);
  });

  test('a recursive condition has a linear cost', () => {
    // `g(n)` compares `g(n − 1)`: a second evaluation of `g(n − 1)` at each
    // level makes the cost exponential in `n`. `tick` counts the calls.
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('tick', {
      signature: '(number) -> number',
      evaluate: ([v]) => {
        calls += 1;
        return v;
      },
    });
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'If',
          ['Less', 'n', 1],
          0.5,
          [
            'If',
            ['Greater', ['g', ['tick', ['Subtract', 'n', 1]]], 5],
            1.5,
            2.5,
          ],
        ],
        'n',
      ])
    );
    expect(ce.box(['g', 12]).N().toString()).toBe('2.5');
    expect(calls).toBe(12);
  });

  test('an exact constant expression is compared by its exact form', () => {
    // `√(10⁶⁰ + 10⁴⁰) − 10³⁰` is about `5·10⁹`, but its float at the working
    // precision is wrong by much more than that, as its terms cancel.
    const ce = new ComputeEngine();
    const c = [
      'Subtract',
      ['Sqrt', ['Add', ['Power', 10, 60], ['Power', 10, 40]]],
      ['Power', 10, 30],
    ];
    expect(
      ce
        .box(['If', ['Less', c, 6000000000], 1, 0])
        .N()
        .toString()
    ).toBe('1');
  });
});

describe('the exact re-read of an expression that reads a parameter', () => {
  test('a parameter bound to an exact value is read exactly', () => {
    // An integer argument too large for a double stays exact under `.N()`,
    // so the parameter is bound to the exact integer. `x − 10³⁰` is then
    // evaluated exactly at the jump of `Floor`: its float at 21 digits is 0.
    const ce = engineWith(['Floor', ['Subtract', 'x', ['Power', 10, 30]]]);
    expect(n(ce, { num: '1000000000000000000000000000001' })).toBe('1');
  });

  test('a rational argument whose double is an integer is not an integer', () => {
    // The double of `1 − 10⁻³⁰` is the integer 1, but the argument is not
    // an integer: `Floor(x)` is not evaluated exactly with `x` bound to the
    // float 1, and the comparison reads the float 0 of `Floor(x)`.
    const ce = engineWith(['Equal', ['Floor', 'x'], 0]);
    const r = [
      'Rational',
      { num: '9'.repeat(30) },
      { num: '1' + '0'.repeat(30) },
    ];
    expect(n(ce, r)).toBe('"True"');
    expect(n(ce, ['Subtract', 1, ['Power', 10, -30]])).toBe('"True"');
  });

  test('an integer argument is read exactly', () => {
    // The products of the doubles `√x·√3` at 3, 12 and 27 are below the
    // integers 3, 6 and 9.
    const ce = new ComputeEngine();
    const body = ['Floor', ['Multiply', ['Sqrt', 'x'], ['Sqrt', 3]]];
    const r = ce
      .box(['Map', ['Function', body, 'x'], ['Range', 1, 300]] as any)
      .N();
    const at = (k: number) => ce.box(['At', r, k]).evaluate().re;
    expect([at(3), at(12), at(27)]).toEqual([3, 6, 9]);
  });
});

describe('a comparison of numbers too large for a double under .N()', () => {
  // The double of both rationals is `Infinity`: the comparison is decided
  // by their exact values.
  const big = '3' + '0'.repeat(400);
  const A = ['Rational', { num: big.slice(0, -1) + '1' }, 3];
  const B = ['Rational', { num: big.slice(0, -1) + '2' }, 3];

  test('Less', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['Less', A, B] as any)
        .N()
        .toString()
    ).toBe('"True"');
    expect(
      ce
        .box(['Less', B, A] as any)
        .N()
        .toString()
    ).toBe('"False"');
  });

  test('the condition of an If', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(['If', ['Less', A, B], 1, 0] as any)
        .N()
        .toString()
    ).toBe('1');
    expect(
      ce
        .box(['If', ['Less', B, A], 1, 0] as any)
        .N()
        .toString()
    ).toBe('0');
  });
});
