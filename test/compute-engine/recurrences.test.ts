import { engine } from '../utils';

function rsolve(equation: unknown, dependent = 'a', index = 'n') {
  return engine.expr(['RSolve', equation, dependent, index]).evaluate();
}

function shiftedValue(solution: ReturnType<typeof rsolve>, shift: number) {
  const rhs = solution.op1.op2;
  return rhs.subs({ n: engine.number(shift).add(engine.symbol('n')) });
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
  const residual = substituted.op1.sub(substituted.op2).subs(sample).simplify();
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

    expect(solution.toString()).toMatchInlineSnapshot(`[a(n) === "c_1" * 2^n]`);
    expect(verifyRecurrence(recurrence, solution, { c_1: 3, n: 5 })).toBe(true);
  });

  test('applies initial conditions to first-order recurrences', () => {
    const recurrence = [
      'Equal',
      ['a', ['Add', 'n', 1]],
      ['Multiply', 2, ['a', 'n']],
    ];
    const solution = rsolve(['List', recurrence, ['Equal', ['a', 0], 3]]);

    expect(solution.toString()).toMatchInlineSnapshot(`[a(n) === 3 * 2^n]`);
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
      `[a(n) === "c_2" * n + "c_1"]`
    );
    expect(
      verifyRecurrence(recurrence, solution, { c_1: 3, c_2: 5, n: 4 })
    ).toBe(true);
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
      `[a(n) === "c_1" * i^n + "c_2" * (-i)^n]`
    );
  });
});
