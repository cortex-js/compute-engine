import { engine } from '../utils';

function rsolve(equation: unknown, dependent = 'a', index = 'n') {
  return engine.expr(['RSolve', equation, dependent, index]).evaluate();
}

function shiftedValue(solution: ReturnType<typeof rsolve>, shift: number) {
  const rhs = solution.op1.op2;
  return rhs.subs({ n: engine.number(shift).add(engine.symbol('n')) });
}

/**
 * `expr` at the point `sample`: `c_k` in `sample` is the value of the
 * constant `ArbitraryConstant(k)`, every other key the value of a symbol.
 */
function atSample(
  expr: ReturnType<typeof rsolve>,
  sample: Record<string, number>
): ReturnType<typeof rsolve> {
  let result = expr;
  const symbols: Record<string, number> = {};
  for (const [key, value] of Object.entries(sample)) {
    const k = /^c_(\d+)$/.exec(key);
    if (k === null) symbols[key] = value;
    else
      result =
        result.replace(
          {
            match: engine.box(['ArbitraryConstant', Number(k[1])]),
            replace: engine.number(value),
          },
          { recursive: true }
        ) ?? result;
  }
  return result.subs(symbols);
}

function verifyRecurrence(
  recurrence: unknown,
  solution: ReturnType<typeof rsolve>,
  sample: Record<string, number>
): boolean {
  let substituted = engine.expr(recurrence, { form: 'raw' });
  for (let shift = 0; shift <= 4; shift++) {
    substituted =
      substituted.replace(
        {
          match: shift === 0 ? ['a', 'n'] : ['a', ['Add', 'n', shift]],
          replace: shiftedValue(solution, shift),
        },
        { recursive: true }
      ) ?? substituted;
  }

  if (substituted.operator !== 'Equal') return false;
  const residual = atSample(
    substituted.op1.sub(substituted.op2),
    sample
  ).simplify();
  return Math.abs(residual.N().re) < 1e-10;
}

describe('RSolve', () => {
  test('solves first-order geometric recurrences', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 1]],
      ['Multiply', 2, ['a', 'n']],
    ];
    const solution = rsolve(recurrence);

    expect(solution.toString()).toMatchInlineSnapshot(`[a(n) == ArbitraryConstant(1) * 2^n]`);
    expect(verifyRecurrence(recurrence, solution, { c_1: 3, n: 5 })).toBe(true);
  });

  test('applies initial conditions to first-order recurrences', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 1]],
      ['Multiply', 2, ['a', 'n']],
    ];
    const solution = rsolve(['List', recurrence, ['Equal', ['a', 0], 3]]);

    expect(solution.toString()).toMatchInlineSnapshot(`[a(n) == 3 * 2^n]`);
    expect(verifyRecurrence(recurrence, solution, { n: 5 })).toBe(true);
  });

  test('solves Fibonacci recurrence', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 2]],
      ['Add', ['a', ['Add', 'n', 1]], ['a', 'n']],
    ];
    const solution = rsolve(recurrence);

    expect(solution.operator).toBe('List');
    expect(
      verifyRecurrence(recurrence, solution, { c_1: 2, c_2: 3, n: 5 })
    ).toBe(true);
  });

  test('solves repeated-root recurrences', () => {
    const recurrence = [
      'Equal',
      ['Add', ['a', ['Add', 'n', 2]], ['a', 'n']],
      ['Multiply', 2, ['a', ['Add', 'n', 1]]],
    ];
    const solution = rsolve(recurrence);

    expect(solution.toString()).toMatchInlineSnapshot(
      `[a(n) == n * ArbitraryConstant(2) + ArbitraryConstant(1)]`
    );
    expect(
      verifyRecurrence(recurrence, solution, { c_1: 3, c_2: 5, n: 4 })
    ).toBe(true);
  });

  test('resolves order-2 initial conditions with radical coefficients (Fibonacci)', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 2]],
      ['Add', ['a', ['Add', 'n', 1]], ['a', 'n']],
    ];
    const solution = rsolve([
      'List',
      recurrence,
      ['Equal', ['a', 0], 0],
      ['Equal', ['a', 1], 1],
    ]);

    expect(solution.operator).toBe('List');
    const rhs = solution.op1.op2;
    const expected = [0, 1, 1, 2, 3, 5, 8];
    for (let i = 0; i < expected.length; i++)
      expect(Math.round(rhs.subs({ n: i }).N().re)).toBe(expected[i]);
  });

  test('resolves order-2 initial conditions without timing out (Pell)', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 2]],
      ['Add', ['Multiply', 2, ['a', ['Add', 'n', 1]]], ['a', 'n']],
    ];
    const solution = rsolve([
      'List',
      recurrence,
      ['Equal', ['a', 0], 0],
      ['Equal', ['a', 1], 1],
    ]);

    expect(solution.operator).toBe('List');
    const rhs = solution.op1.op2;
    const expected = [0, 1, 2, 5, 12, 29];
    for (let i = 0; i < expected.length; i++)
      expect(Math.round(rhs.subs({ n: i }).N().re)).toBe(expected[i]);
  });

  test('verifies extra initial conditions instead of dropping them', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 2]],
      ['Add', ['a', ['Add', 'n', 1]], ['a', 'n']],
    ];
    // Consistent third condition (a(2) = 1 for Fibonacci): still resolves.
    const consistent = rsolve([
      'List',
      recurrence,
      ['Equal', ['a', 0], 0],
      ['Equal', ['a', 1], 1],
      ['Equal', ['a', 2], 1],
    ]);
    expect(consistent.operator).toBe('List');

    // Contradictory third condition: stays inert rather than returning a
    // closed form that violates it.
    const contradictory = rsolve([
      'List',
      recurrence,
      ['Equal', ['a', 0], 0],
      ['Equal', ['a', 1], 1],
      ['Equal', ['a', 2], 99],
    ]);
    expect(contradictory.operator).toBe('RSolve');
  });

  test('stays inert for nonhomogeneous recurrences', () => {
    const result = rsolve([
      'Equal',
      ['a', ['Add', 'n', 1]],
      ['Add', ['a', 'n'], 1],
    ]);

    expect(result.operator).toBe('RSolve');
  });

  test('stays inert for malformed index shifts', () => {
    const result = rsolve(['Equal', ['a', ['Add', 'n', 'n', 1]], ['a', 'n']]);

    expect(result.operator).toBe('RSolve');
  });

  test('solves recurrences with complex characteristic roots', () => {
    const result = rsolve([
      'Equal',
      ['a', ['Add', 'n', 2]],
      ['Negate', ['a', 'n']],
    ]);

    expect(result.operator).toBe('List');
    expect(result.toString()).toMatchInlineSnapshot(
      `[a(n) == ArbitraryConstant(1) * i^n + ArbitraryConstant(2) * (-i)^n]`
    );
  });
});

// An initial condition `a(0) = 1 = 2` is two equations, and they
// contradict: the recurrence has no solution, not the solution of `a(0) = 1`.
describe('RSOLVE OF AN EQUALITY CHAIN', () => {
  test('a chain is not solved as its first link', () => {
    const r = rsolve([
      'List',
      ['Equal', ['a', 'n'], ['Multiply', 2, ['a', ['Subtract', 'n', 1]]]],
      ['Equal', ['a', 0], 1, 2],
    ]);
    expect(r.operator).toBe('RSolve');
  });
});
