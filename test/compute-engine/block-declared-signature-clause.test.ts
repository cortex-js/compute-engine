import { ComputeEngine } from '../../src/compute-engine';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A block canonicalizes all of its statements before it runs the first one,
// and the `DefineFunction` canonical handler installs its clause at that
// time, onto the binding the block hoisted for the name. When a `let g: …`
// statement declares the signature of the function BEFORE its definition,
// the `Declare` statement finds a binding that already holds the clause
// (installed without the declaration), drops it, and declares the name
// fresh; the definition statement then installs its clause again, under the
// declared signature (`CLAUSE_INSTALLED_AHEAD`, `library/core.ts`).
//
// A call canonicalized before the `Declare` ran holds the dropped record by
// identity. Until 2026-10-21 that record kept the clause that was installed
// without the declaration, so the call ran a function whose parameter type
// was never checked: `g(1.5)` answered `3` where the Epsil runner, which
// runs the `let` before it boxes the definition, reports `incompatible-type`.
// The dropped record is now retired, as `ce.undeclare()` retires a record,
// and the call reads the definition the scope holds when it is evaluated.
//

const SIGNATURE = 'let g: (integer) -> integer\nfunction g(k) { 2 * k }\n';

function block(source: string): string {
  return new ComputeEngine()
    .box(parseEpsil(source)[0] as never)
    .evaluate()
    .toString();
}

function epsil(source: string): string {
  return executeEpsil(new ComputeEngine(), source).value.toString();
}

describe('A DECLARED SIGNATURE BEFORE THE DEFINITION, IN ONE BLOCK', () => {
  test('a float argument is refused against the declared parameter type', () => {
    const expected = 'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)';
    expect(block(SIGNATURE + 'g(1.5)')).toBe(expected);
    expect(epsil(SIGNATURE + 'g(1.5)')).toBe(expected);
    // Through a variable, and inside a nested `do` block.
    expect(block(SIGNATURE + 'let x = 1.5\ng(x)')).toBe(expected);
    expect(block('do {\n' + SIGNATURE + 'g(1.5) }')).toBe(expected);
  });

  test('an integer argument is applied', () => {
    expect(block(SIGNATURE + 'g(2)')).toBe('4');
    expect(block(SIGNATURE + '[g(2), g(3)]')).toBe('[4,6]');
  });

  test('a recursive definition with a typed signature still runs', () => {
    expect(
      block(
        'let f: (integer) -> integer\n' +
          'f(n) = if n <= 1 { 1 } else { n * f(n - 1) }\n' +
          'f(5)'
      )
    ).toBe('120');
  });

  test('a host block of MathJSON', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'Block',
        ['Declare', 'g', "'(integer) -> integer'"],
        ['DefineFunction', 'g', ['Function', ['Multiply', 2, 'k'], 'k']],
        ['g', 1.5],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe(
      'Error(ErrorCode("incompatible-type", "integer", "1.5"), 1.5)'
    );
  });
});
