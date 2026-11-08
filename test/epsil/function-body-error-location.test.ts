import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The frames of a runtime error record each call that the error passes
// through, innermost first. The call of a user function and the read of a
// variable record no frame, so the frames recorded in the body of a called
// function, or in an earlier statement whose value the statement reads, come
// first. When the operator of such a frame is also written in the statement,
// the frame can select an unrelated part of the statement: with
// `function g(x) { Ln(x) + 1 }`, the error of `let v = y + g("a")` has the
// frames `Ln argument 1, Add argument 1, Add argument 2`, and the frame
// `Add argument 1` selects `y`. Such a frame is not used when its call is
// not inside the argument that an outer frame of the statement selected.
//

/** The text underlined by each runtime error of the statement that starts
 * with `marker`. */
function underlines(src: string, marker = 'let v'): string[] {
  const result = executeEpsil(new ComputeEngine(), src);
  const at = src.indexOf(marker);
  return result.diagnostics
    .filter(
      (d) =>
        Array.isArray(d.message) &&
        d.message[0] === 'runtime-error' &&
        d.range[0] >= at
    )
    .map((d) => src.slice(d.range[0], d.range[1]));
}

describe('an error in the body of a called function', () => {
  test.each([
    ['function g(x) { Ln(x) + 1 }', 'let v = y + g("a")', 'g("a")'],
    ['function g(x) { Ln(x) }', 'let v = Ln(y) + g("a")', 'g("a")'],
    ['function g(x) { Ln(x) + 1 }', 'let v = Ln(y) + y + g("a")', 'g("a")'],
    ['function g(x) { Ln(x) + 1 }', 'let v = Sqrt(y) + g("a")', 'g("a")'],
    ['function g(x) { Ln(x) + 1 }', 'let v = Sqrt(y + g("a"))', 'g("a")'],
    // A user function and `Max` record a frame for their argument.
    [
      'function g(x) { Ln(x) + 1 }\nfunction h(a, b) { b }',
      'let v = h(y + 1, g("a"))',
      'g("a")',
    ],
    ['function g(x) { Ln(x) + 1 }', 'let v = Max(y + 1, g("a"))', 'g("a")'],
    // The frames name the `If` of the statement, then the one statement of
    // its branch.
    [
      'function g(x) { Ln(x) + 1 }',
      'let v = if y == 5 { y + g("a") } else { 0 }',
      'g("a")',
    ],
    ['function g(x) { Ln(x) + 1 }', 'let v = y - g("a")', 'g("a")'],
    // The call of `g` is deeper in the statement: the sum of the statement is
    // not inside the argument that the inner frames of the statement select.
    ['function g(x) { Ln(x) + 1 }', 'let v = y + Sqrt(g("a"))', 'g("a")'],
    ['function g(x) { Ln(x) + 1 }', 'let v = y + g("a") * 2', 'g("a")'],
    ['function g(x) { Ln(x) + 1 }', 'let v = (y + 1) * Sqrt(g("a"))', 'g("a")'],
    [
      'function g(x) { Ln(x) + 1 }\nfunction h(a, b) { b }',
      'let v = y + h(1, g("a"))',
      'g("a")',
    ],
    ['function g(x) { Ln(x) + 1 }', 'v = y + g("a")', 'g("a")'],
  ])('%s, %s underlines %s', (fn, stmt, expected) => {
    expect(underlines(`${fn}\nlet y = 5\n${stmt}\n0`)).toEqual([expected]);
  });

  test('a function value made by an earlier call', () => {
    // The frames are `Multiply argument 2, Add argument 2`. The product of
    // the body is not the product `3 * y` of the statement.
    const src =
      'function g(x) { (e) => e * x }\nlet y = 5\nlet h = g("a")\nlet v = 3 * y + h(2)\n0';
    expect(underlines(src)).toEqual(['h(2)']);
  });
});

describe('an error made by an earlier statement', () => {
  // The frames are `Sin argument 1, Multiply argument 1`: the first frame
  // was recorded by the statement that assigned `w2`.
  test.each(['Sin', 'Ln'])('%s(x) is not underlined', (fn) => {
    const src = `let q: any = "a"\nlet x = 2\nlet w2: any = ${fn}(q)\nlet v = w2 * ${fn}(x)\n0`;
    expect(underlines(src)).toEqual(['w2']);
  });
});

describe('the frames of the statement still select the argument', () => {
  const prefix = 'let w: any = "s"\nlet y = 2\n';

  test.each([
    // `Exp(u)` is `Power(ExponentialE, u)`, whose frame `Power argument 2`
    // names no written call. The frame `Ln argument 1` is used.
    ['let v = Exp(Ln(w)) + y', 'w'],
    // The written power `y^2` is not inside the operand that the frame
    // `Add argument 2` selects, and its frame is not used.
    ['let v = y^2 + Exp(Ln(w))', 'w'],
    // A list records no frame. The frame `Power argument 2` of `Exp` selects
    // the `y` of the written `x^y`, which is not inside the call of a frame:
    // the frame `Ln argument 1` is still used.
    ['let x = 2\nlet v = [x^y, Exp(Ln(w))]', 'w'],
    // `Exp(u)^y` is `Power(ExponentialE, u·y)`: the frame
    // `Power argument 2` does not name the written `y`.
    ['let v = Exp(Ln(w))^y', 'w'],
    ['let v = Exp(Ln(w)^y)', 'w'],
    ['let v = Max(Exp(Ln(w))^y, 1)', 'w'],
    // The sum of the terms records frames of `Add` that are not the frames
    // of the written `Ln(w) + k`.
    ['let v = Sum(Ln(w) + k, k, 1, y)', 'w'],
    ['let v = y + Sum(Ln(w) + k, k, 1, y)', 'w'],
    ['let v = [w, 2] |> Map((e) => Ln(e) + y, _)', 'e'],
    ['let v = if y == 2 { Ln(w) } else { y + 1 }', 'w'],
    ['let v = y + Ln(w)', 'w'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });
});
