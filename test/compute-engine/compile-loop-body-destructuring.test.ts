/**
 * A destructuring `let` inside a loop body compiles to JavaScript.
 *
 * The statement list of a loop body is lowered by its own routine, not by the
 * block lowering. That routine desugared a destructuring ASSIGNMENT into
 * per-leaf writes, but not a destructuring DECLARATION
 * (`let (a, x) = (2, 3)`). The declaration then reached the value-position
 * `Declare` lowering, which fails closed, and the whole program declined with
 * "Could not compile a destructuring declaration in value position". Every
 * statement of a loop body is in statement position (the body has no value),
 * so the declaration is now desugared into per-leaf declarations there, as the
 * block lowering does for a block's statements.
 *
 * Every program is checked for parity between `evaluate()` and the compiled
 * `run()`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

/**
 * The GLSL target lowers a loop body with its own statement routine
 * (`compileStatementList`). The shader routine desugared a destructuring
 * declaration only inside a `Block` body. A bare destructuring declaration as
 * the whole loop body reached the value-position `Declare` lowering and the
 * program declined with "Could not compile a destructuring declaration in
 * value position". A destructuring declaration that is the whole loop body,
 * not a statement of a `Block`, is the error `declaration-below-statement`,
 * and every target declines it.
 */
describe('Destructuring let in a loop body on GLSL', () => {
  const loop = (body: unknown): unknown => [
    'Loop',
    body,
    ['Element', 'k', ['Range', 1, 3]],
  ];
  const CASES: Array<{ name: string; json: unknown; expected: number }> = [
    {
      name: 'the last statement of a block body',
      json: [
        'Block',
        ['Declare', 's', 'integer', 0],
        loop([
          'Block',
          ['Assign', 's', ['Add', 's', 'k']],
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 2]],
        ]),
        's',
      ],
      expected: 6,
    },
    {
      name: 'a three-position declare read by the next statement',
      json: [
        'Block',
        ['Declare', 's', 'integer', 0],
        loop([
          'Block',
          [
            'Declare',
            ['Tuple', 'a', 'b', 'c'],
            'unknown',
            ['Tuple', 'k', 2, 3],
          ],
          ['Assign', 's', ['Add', 's', 'a', 'b', 'c']],
        ]),
        's',
      ],
      // Each turn adds k + 5 for k = 1, 2, 3.
      expected: 21,
    },
  ];

  test.each(CASES)('$name: the interpreter value', ({ json, expected }) => {
    const ce = new ComputeEngine();
    expect(ce.box(json as any).evaluate().re).toBe(expected);
  });
});

/**
 * The interpreter evaluates the whole value of a destructuring `let` before
 * it binds any name of the pattern, so an element that reads a name of the
 * pattern reads the binding from before the statement. The compiled
 * declaration of that name hides the earlier binding in the same scope: the
 * per-leaf form read the value just bound (300 became 6 below). Such a
 * statement is not compiled on any target, and the interpreter evaluates it.
 */
describe('A destructuring let whose value reads a name of the pattern', () => {
  const loop = (body: unknown, hi = 3): unknown => [
    'Loop',
    body,
    ['Element', 'k', ['Range', 1, hi]],
  ];
  const CASES: Array<{ name: string; json: unknown; expected: number }> = [
    {
      name: 'an element reads the outer value of a leaf',
      json: [
        'Block',
        ['Declare', 'a', 'integer', 100],
        ['Declare', 's', 'number', 0],
        loop([
          'Block',
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 'a']],
          ['Assign', 's', ['Add', 's', 'b']],
        ]),
        's',
      ],
      expected: 300,
    },
    {
      name: 'a swap of two outer values',
      json: [
        'Block',
        ['Declare', 'a', 'integer', 1],
        ['Declare', 'b', 'integer', 2],
        ['Declare', 's', 'number', 0],
        loop([
          'Block',
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'b', 'a']],
          ['Assign', 's', ['Add', ['Multiply', 10, 's'], 'a']],
        ]),
        's',
      ],
      // Each turn reads a = 2 (the outer b): 2, 22, 222.
      expected: 222,
    },
  ];

  test.each(CASES)('$name: the interpreter value', ({ json, expected }) => {
    const ce = new ComputeEngine();
    expect(ce.box(json as any).evaluate().re).toBe(expected);
  });

  test.each(CASES)(
    '$name: the JavaScript fallback gives the interpreter value',
    ({ json, expected }) => {
      const ce = new ComputeEngine();
      const result = compile(ce.box(json as any), { to: 'javascript' });
      expect(result.success).toBe(false);
      expect(result.run!({})).toBe(expected);
    }
  );
});
