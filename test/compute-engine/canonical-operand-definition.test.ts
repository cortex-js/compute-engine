import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

//
// The canonical steps that compare an operand with the call being built
// compare their definitions, not their names: the `idempotent` and
// `involution` folds and the associative flatten of the canonical form
// (`box.ts`, `flatten.ts`), the associative flatten of the operands at
// evaluation (`hold.ts`), and the check that an assignment is not an operand
// (`withoutStatementOperands()`, `boxed-function.ts`). A call of a user
// function that has the name of a library operator is a value, so a library
// rule of that operator does not apply to it.
//
// Each test makes a call of a user function in a scope, pops the scope, and
// gives the call as an operand of a call of the library operator. This is
// what the qualified call `std::name` does with the values of its arguments.
// (`docs/plans/2026-11-07-ce1109-definition-identity.md`, CE-1109.3.)
//

/** In a new scope, declare the user function `name` with the value `fn`,
 * box the call `[name, ...args]` and pop the scope. The call stays bound to
 * the user function. */
function userCall(
  ce: ComputeEngine,
  name: string,
  fn: unknown,
  args: unknown[]
): Expression {
  ce.pushScope();
  ce.declare(name, 'function');
  ce.assign(name, ce.box(fn as any));
  const call = ce.box([name, ...args] as any);
  ce.popScope();
  return call;
}

describe('involution and idempotent folds', () => {
  test('a user Not inside the library Not is not folded', () => {
    const ce = new ComputeEngine();
    // The user `Not` is the identity, so the user call has the value False.
    const u = userCall(ce, 'Not', ['Function', 'x', 'x'], ['False']);
    expect(u.evaluate().symbol).toBe('False');
    expect(ce.function('Not', [u]).evaluate().symbol).toBe('True');
  });

  test('a library Not inside the library Not is folded', () => {
    const ce = new ComputeEngine();
    const expr = ce.function('Not', [ce.function('Not', [ce.box('p')])]);
    expect(expr.symbol).toBe('p');
  });

  test('a user Abs inside the library Abs is not folded', () => {
    const ce = new ComputeEngine();
    const u = userCall(ce, 'Abs', ['Function', ['Subtract', 'x', 5], 'x'], [1]);
    expect(u.evaluate().re).toBe(-4);
    expect(ce.function('Abs', [u]).evaluate().re).toBe(4);
  });

  test('a user Chop inside the library Chop is not folded', () => {
    const ce = new ComputeEngine();
    const u = userCall(ce, 'Chop', ['Function', ['Add', 'x', 1], 'x'], [1]);
    expect(ce.function('Chop', [u]).evaluate().re).toBe(2);
  });
});

describe('associative flatten', () => {
  test('a user Add inside the library Add is not spliced', () => {
    const ce = new ComputeEngine();
    // The user `Add` multiplies: the user call has the value 6.
    const u = userCall(
      ce,
      'Add',
      ['Function', ['Multiply', 'x', 'y'], 'x', 'y'],
      [2, 3]
    );
    expect(ce.function('Add', [u, 1]).evaluate().re).toBe(7);
    expect(ce.box(['Add', u, 1]).evaluate().re).toBe(7);
    // The structural form, which `.json` serializes, keeps the operand too.
    expect(ce.function('Add', [u, 1]).json).toEqual(['Add', 1, ['Add', 2, 3]]);
  });

  test('a user Xor inside the library Xor is not spliced', () => {
    const ce = new ComputeEngine();
    // `Xor` has no canonical handler: the canonical form flattens it
    // (`box.ts`), and so does the evaluation of its operands (`hold.ts`).
    const u = userCall(
      ce,
      'Xor',
      ['Function', ['Or', 'x', 'y'], 'x', 'y'],
      ['True', 'True']
    );
    expect(u.evaluate().symbol).toBe('True');
    const expr = ce.function('Xor', [u, 'False']);
    expect(expr.nops).toBe(2);
    expect(expr.evaluate().symbol).toBe('True');
  });

  test('a user And inside the library And is not spliced', () => {
    const ce = new ComputeEngine();
    const u = userCall(
      ce,
      'And',
      ['Function', ['Or', 'x', 'y'], 'x', 'y'],
      ['True', 'False']
    );
    expect(ce.function('And', [u, 'True']).evaluate().symbol).toBe('True');
  });

  test('a user Union inside the library Union is not spliced', () => {
    const ce = new ComputeEngine();
    // The user `Union` intersects: the user call has the value {2}.
    const u = userCall(
      ce,
      'Union',
      ['Function', ['Intersection', 'x', 'y'], 'x', 'y'],
      [
        ['Set', 1, 2],
        ['Set', 2, 3],
      ]
    );
    expect(
      ce
        .function('Union', [u, ce.box(['Set', 5])])
        .evaluate()
        .toString()
    ).toBe('Set(2, 5)');
  });

  test('a user Chop inside the library Chop is not spliced', () => {
    const ce = new ComputeEngine();
    const u = userCall(ce, 'Chop', ['Function', ['Add', 'x', 1], 'x'], [1]);
    const expr = ce.function('Chop', [u]);
    expect(expr.op1.operator).toBe('Chop');
    expect(u.valueDefinition).toBeDefined();
    expect(expr.op1.valueDefinition).toBe(u.valueDefinition);
  });

  test('a library Add inside the library Add is spliced', () => {
    const ce = new ComputeEngine();
    const expr = ce.function('Add', [
      ce.function('Add', [ce.box('a'), ce.box('b')]),
      ce.box('c'),
    ]);
    expect(expr.nops).toBe(3);
  });

  test('a library Xor inside the library Xor is spliced', () => {
    const ce = new ComputeEngine();
    const expr = ce.function('Xor', [
      ce.function('Xor', [ce.box('p'), ce.box('q')]),
      ce.box('r'),
    ]);
    expect(expr.nops).toBe(3);
  });

  test('a call of a user associative operator is spliced', () => {
    const ce = new ComputeEngine();
    ce.declare('f', {
      signature: '(number+) -> number',
      associative: true,
      evaluate: (ops) => ce.number(ops.reduce((s, x) => s + x.re, 0)),
    });
    const expr = ce.box(['f', 1, ['f', 2, 3]]);
    expect(expr.nops).toBe(3);
    expect(expr.evaluate().re).toBe(6);
  });
});

describe('an assignment as an operand', () => {
  test('a call of a user function named AddTo is a value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('AddTo', 'function');
    ce.assign('AddTo', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    const expr = ce.box(['Add', ['AddTo', 1, 2], 1]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().re).toBe(4);
    ce.popScope();
  });

  test('a call of a user function named Assign is a value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('Assign', 'function');
    ce.assign('Assign', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    const expr = ce.box(['Add', ['Assign', 1, 2], 1]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().re).toBe(4);
    ce.popScope();
  });

  test('a library assignment as an operand is an error', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Add', ['Assign', 'a', 2], 1]);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain('assignment-in-operand');
  });
});
