/**
 * A list-building recursion `F(n) = Which(n = D - 1, [p(n)], True,
 * Join([p(n)], F(n + 1)))` compiles on the JavaScript target to a loop over
 * its step (`_SYS.listRecursion`), whatever the declaration of `F`:
 *
 *  - `F` assigned with no declaration. The assignment makes an operator
 *    definition, which keeps the literal it applies (`_lambdaLiteral`).
 *    `listRecursionPlan` did not recognize the recursive call through that
 *    definition, so neither the compiler nor the interpreter used the loop.
 *  - `F` declared `function`, then assigned. Its parameter is open, so the
 *    scalar call `F(0)` gets a call-shape specialization with the parameter
 *    typed `number`. That copy is emitted under the ordinary name, but the
 *    loop was tried only with no specialization (since 0.172.0).
 *  - `F` declared `(real) -> list`. The loop declined every parameter that
 *    has an entry in the complex-parameter frame, and a parameter declared
 *    real has one too (with the value `false`).
 *
 * The recursive arrow overflows the JavaScript call stack near 5,000 levels.
 * The loop builds 10,000 elements.
 */
import { ComputeEngine } from '../../src/compute-engine';

/** The error both routes give when the loop of `F` reaches the iteration
 * limit `n`, as a pattern that matches the whole message. */
const limitError = (n: number, op = 'F'): RegExp =>
  new RegExp(`^Iteration limit of ${n} exceeded while evaluating ${op}\\(\\)$`);

describe('CE-579: a list-building recursion compiles to a loop', () => {
  // The compiler declines a list-building recursion (`Join` is not in its
  // slice): only the interpreter is checked.
  it('the interpreter checks each next argument against the declared parameter type', () => {
    // `F: (integer) -> list`, `F(n) = Which(n >= 2, [n], True, Join([n],
    // F(n + 1/2)))`. The recursive call `F(1/2)` is refused, as the direct
    // call is, and its error is the value of `F(0)`. Before, the loop of the
    // interpreter ran the step on `1/2` and gave `[0, 1/2, 1, 3/2, 2]`.
    const ce = new ComputeEngine();
    ce.declare('F', '(integer) -> list');
    ce.assign(
      'F',
      ce.box([
        'Function',
        [
          'Block',
          [
            'Which',
            ['GreaterEqual', 'n', 2],
            ['List', 'n'],
            'True',
            ['Join', ['List', 'n'], ['F', ['Add', 'n', ['Rational', 1, 2]]]],
          ],
        ],
        'n',
      ] as any)
    );
    const direct = ce
      .box(['F', ['Rational', 1, 2]])
      .evaluate()
      .toString();
    expect(direct).toMatch(/^Error\(ErrorCode\("incompatible-type", "integer"/);
    expect(ce.box(['F', 0]).evaluate().toString()).toBe(direct);
    // NaN at the numeric parameter is accepted: `F(NaN)` runs the body.
    ce.iterationLimit = 50;
    expect(() => ce.box(['F', 'NaN']).evaluate()).toThrow(limitError(50));
  });
});
