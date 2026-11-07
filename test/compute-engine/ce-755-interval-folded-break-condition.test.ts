/**
 * CE-755. On `interval-js`, the condition of a statement `If` in a `Loop`
 * body must be a JavaScript boolean. The interval target spells the boolean
 * constants as the strings `'true'` and `'false'`, and a non-empty string is
 * truthy, so a condition that folds to `False` was emitted as
 * `if ('false') { break }` and the loop stopped at its first step. With
 * `k ∈ 1..5`, the condition `k > 20` folds to `False`: the interpreter gives
 * 15, the compiled code gave the interval `[0, 0]`. A condition that folds
 * to a constant is now the JavaScript literal, and any other condition is
 * the interval verdict converted by `_IA.decided()`
 * (`intervalStatementCondition()` in `compiler-core.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `s ≔ 0; Loop(Block(If(cond, Break()), s ≔ s + k), k ∈ 1..5); s` */
function breakLoop(cond: unknown) {
  return [
    'Block',
    ['Assign', 's', 0],
    [
      'Loop',
      ['Block', ['If', cond, ['Break']], ['Assign', 's', ['Add', 's', 'k']]],
      ['Element', 'k', ['Range', 1, 5]],
    ],
    's',
  ];
}

function check(cond: unknown, expected: number) {
  const ce = new ComputeEngine();
  const expr = ce.box(breakLoop(cond) as any);
  expect(expr.evaluate().re).toBe(expected);
  const result = compile(expr, { to: 'interval-js' });
  expect(result.success).toBe(true);
  expect(result.code).not.toMatch(/if \('(true|false)'\)/);
  expect(result.run!({})).toEqual({
    kind: 'interval',
    value: { lo: expected, hi: expected },
  });
}

describe('CE-755: a folded Break condition on interval-js', () => {
  test('a comparison that folds to False does not break', () =>
    check(['Greater', 'k', 20], 15));
  test('a comparison that folds to True breaks at once', () =>
    check(['Greater', 'k', 0], 0));
  test('the literal False does not break', () => check('False', 15));
  test('the literal True breaks at once', () => check('True', 0));
  test('a negated folded condition', () =>
    check(['Not', ['Greater', 'k', 20]], 0));
  test('a connective over a folded operand', () =>
    check(['Or', ['Greater', 'k', 20], ['Greater', 'k', 3]], 6));

  // Only the constant `False` folds: a name that a scope declares again and
  // that the host maps with `vars` keeps its mapping. On this target a `vars`
  // entry is the code of an interval.
  test('a vars mapping of a redeclared False is kept', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('False', 'real');
    const expr = ce.box(breakLoop(['Greater', 'False', 3]) as any);
    const result = compile(expr, {
      to: 'interval-js',
      vars: { False: '_IA.point(4)' },
    });
    expect(result.success).toBe(true);
    expect(result.code).toMatch(/_IA\.decided\(_IA\.less\(/);
    expect(result.run!({})).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });

  test('a redeclared False with a value is read as that value', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    ce.declare('False', { type: 'real', value: 4 });
    const expr = ce.box(breakLoop(['Greater', 'False', 3]) as any);
    expect(expr.evaluate().re).toBe(0);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.run!({})).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });

  // A string input that the host maps to the code `'false'` is a string,
  // not the boolean constant. The interval target has no comparison of
  // strings, so the condition declines, as it does in a conditional value
  // (`If(label = "false", 1, 2)`), and the interpreter evaluates the loop.
  test('a string comparison in the condition declines', () => {
    const ce = new ComputeEngine();
    ce.declare('label', 'string');
    const expr = ce.box(breakLoop(['Equal', 'label', { str: 'false' }]) as any);
    const result = compile(expr, {
      to: 'interval-js',
      vars: { label: "'false'" },
    });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Could not compile `Equal`/);
  });
});
