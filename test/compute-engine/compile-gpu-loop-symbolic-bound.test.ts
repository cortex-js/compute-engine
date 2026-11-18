/**
 * A `Loop` over a `Range` on the shader targets: a bound with a value known
 * at compile time is written in the `for` statement, and any other bound is
 * read once, before the loop, into an integer temporary, as the JavaScript
 * target reads it at run time. The step is read at compile time, and a
 * decline names the requirement.
 *
 * A symbol with a value (`N := 4`) gives its value through `.re`, as the
 * JavaScript target folds it. A symbolic bound with no value (`Range(1, n)`,
 * an input of the shader) and a local of the function (`Range(1, e)`) are
 * read at run time; such a bound must have the static type `integer`. The
 * value of a local is never read at compile time: `let e = 0; …; e = m;
 * for j in 1..e` ran the loop up to the value of the declaration. An
 * infinite literal bound (`Range(1, +oo)`) keeps its own message.
 *
 * The step of the range was ignored: `Range(1, 10, 3)` compiled to a loop
 * over every integer from 1 to 10, where the JavaScript target visits 1, 4, 7
 * and 10, and a negative step gave a loop with no iteration.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');
ce.declare('x', 'real');
ce.assign('N', 4);

describe('a Loop over a Range on a shader target', () => {
  test('the JavaScript target compiles the symbolic bound and reads it at run time', () => {
    // `Loop` evaluates to `Nothing`; the sum is read back through a local.
    const sumTo = [
      'Block',
      ['Declare', 'c', "'integer'", 0],
      [
        'Loop',
        ['Assign', 'c', ['Add', 'c', 'j']],
        ['Element', 'j', ['Range', 1, 'n', 3]],
      ],
      'c',
    ];
    const r = compile(ce.box(sumTo as never));
    expect(r.success).toBe(true);
    // 1 + 4 + 7 + 10: the same iterations as the shader loop above.
    expect(r.run({ n: 10 })).toBe(22);
  });
});
