/**
 * ROADMAP CE-454: an undeclared self-recursive numeric function was typed
 * wider than a declared one.
 *
 * `fact := n ↦ If(n ≤ 1, 1, n·fact(n − 1))` was typed
 * `(unknown) -> broadcastable<number>`: when the literal is boxed, `fact` is
 * an undeclared name, read as a function whose result may be a collection,
 * so the product was typed `broadcastable<number>`. The same literal
 * assigned to a name declared `(unknown) -> unknown` derives `-> number`.
 * The recursive refinement of an inferred signature now also tries the
 * hypothesis `number` for a `broadcastable<number>` result, and keeps it
 * because the body bears it out (`listHypothesisOf`,
 * `boxed-expression/declared-parameter-result.ts`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const FACT = [
  'Function',
  [
    'If',
    ['LessEqual', 'n', 1],
    1,
    ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
  ],
  'n',
];

describe('AN UNDECLARED RECURSIVE NUMERIC FUNCTION (CE-454)', () => {
  test('is typed as the declared one', () => {
    const undeclared = new ComputeEngine();
    undeclared.assign('fact', undeclared.box(FACT as any));
    const declared = new ComputeEngine();
    declared.declare('fact', '(unknown) -> unknown');
    declared.assign('fact', declared.box(FACT as any));
    expect(undeclared.box('fact').type.toString()).toBe('(unknown) -> number');
    expect(declared.box('fact').type.toString()).toBe('(unknown) -> number');
  });

  test('a call over a scalar and over a list holds its value', () => {
    const ce = new ComputeEngine();
    ce.assign('fact', ce.box(FACT as any));
    const scalar = ce.box(['fact', 5]);
    expect(scalar.type.toString()).toBe('number');
    expect(scalar.evaluate().toString()).toBe('120');
    const list = ce.box(['fact', ['List', 3, 4]]);
    expect(list.type.toString()).toBe('vector<2>');
    expect(list.evaluate().toString()).toBe('[6,24]');
  });
});
