import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Canonicalization sorts the operands of a commutative call and flattens the
// nested calls of an associative one, so the argument index of an error's
// frame does not always count the operands as written. `Ln(w) * 2` is
// `2·Ln(w)` in canonical form, and its error has the frame
// `Multiply argument 2`: the second written operand, `2`, was underlined.
// The location of a runtime error now maps the frame back to the written
// operand, through the source range that each canonical operand keeps. When
// that is not possible, it underlines the one operand that can make an error,
// or the whole call, which contains the error. It never underlines an operand
// that cannot have made the error.
//

/** The text underlined by each `runtime-error` diagnostic of the statement
 * that starts with `marker`. */
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

describe('an error in an operand of a sum or product', () => {
  const prefix = 'let w: any = "s"\n';

  test.each([
    ['let v = Ln(w) * 2', 'Ln(w)'],
    ['let v = Sin(w) * 2', 'Sin(w)'],
    ['let v = 2 * Ln(w)', 'Ln(w)'],
    // `Max` keeps the written order of its operands.
    ['let v = Max(z, Ln(w))', 'Ln(w)'],
    // `Xor(Not(w), B)` is `Xor(B, Not(w))` in canonical form, and its error
    // has the frame `Xor argument 2`.
    ['let v = Xor(Not(w), B)', 'Not(w)'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });

  test('an operand refused at canonicalization keeps its underline', () => {
    expect(underlines('let v = 1 + "a"\n0')).toEqual(['"a"']);
    expect(underlines('let v = "a" + 1\n0')).toEqual(['"a"']);
  });

  test('two equal operands underline the whole call', () => {
    expect(underlines(`${prefix}let v = Ln(w) + Ln(w)\n0`)).toEqual([
      'Ln(w) + Ln(w)',
    ]);
  });

  test('two operands that can fail underline the whole call', () => {
    expect(
      underlines(`${prefix}let u: any = "t"\nlet v = Sin(u) * Ln(w)\n0`)
    ).toEqual(['Sin(u) * Ln(w)']);
  });

  test('in a nested statement', () => {
    expect(
      underlines(`${prefix}for i in [1] { let q = Ln(w) * 2 }\n0`, 'for')
    ).toEqual(['Ln(w)']);
  });
});

describe('an error in an operand of a commutative or associative function', () => {
  const failing = 'let w = Ln("a")\n';

  test('a commutative function sorts its operands', () => {
    const src = `function op(a, b) commutative { [a, b] }\n${failing}let v = op(z, w)\n0`;
    expect(underlines(src)).toEqual(['w']);
  });

  test('two equal operands of a commutative function', () => {
    const src = `function op(a, b) commutative { [a, b] }\n${failing}let v = op(w, w)\n0`;
    expect(underlines(src)).toEqual(['w']);
  });

  test('an associative function flattens its nested calls', () => {
    const src = `function op(a, b) associative { [a, b] }\n${failing}let v = op(z, op(y, w))\n0`;
    expect(underlines(src)).toEqual(['w']);
  });
});

describe('an error value made in an earlier statement', () => {
  // The error of `Ln("a")` has the frame `Ln argument 1`. When the error is
  // the value of `x`, a later statement that also calls `Ln` must not
  // underline the argument of that call: the `2` of `Ln(2)` is not the value
  // `"a"` that the error names.
  const failing = 'let x = Ln("a")\n';

  test.each([
    ['let v = x + Ln(2)', 'x'],
    ['let v = 2 * x * Ln(3)', 'x'],
    ['let v = Max(Ln(2), x)', 'x'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${failing}${stmt}\n0`)).toEqual([expected]);
  });

  test('a commutative function', () => {
    const src = `function op(a, b) commutative { [a, b] }\n${failing}let v = op(Ln(2), x)\n0`;
    expect(underlines(src)).toEqual(['x']);
  });

  test('the call that made the error is still underlined', () => {
    expect(underlines('let x = Ln(2)\nlet v = x + Ln("a")\n0')).toEqual([
      '"a"',
    ]);
  });
});

describe('an error in an operand of a subtraction', () => {
  // `3 - Ln(w)` is a sum in canonical form, so its error has an `Add` frame.
  // The written `Subtract` is the call of that frame.
  const prefix = 'let w: any = "s"\n';

  test.each([
    ['let v = 3 - Ln(w)', 'Ln(w)'],
    ['let v = (3 - Ln(w)) - 1', 'Ln(w)'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });
});

describe('a commutative function passes an error through', () => {
  // With `w = Ln("a")`, a function without the `commutative` word gives the
  // error of `Ln`. The same function with the word gave a new error,
  // "expected `unknown`, got `error`", because its parameters, which have no
  // type, were checked as `unknown`. They are now checked as `any`, as they
  // are without the word.
  const call = 'let w = Ln("a")\nop(z, w)';

  test.each(['', 'commutative', 'associative', 'commutative associative'])(
    'function op(a, b) %s',
    (words) => {
      const result = executeEpsil(
        new ComputeEngine(),
        `function op(a, b) ${words} { [a, b] }\n${call}`
      );
      const json = JSON.stringify(result.value.json);
      expect(json).toContain(
        `["ErrorCode","'incompatible-type'","'number'","'string'"]`
      );
      expect(json).toContain(`["ErrorFrame","'Ln'",1]`);
    }
  );

  test('the number of arguments is still checked', () => {
    const result = executeEpsil(
      new ComputeEngine(),
      'function op(a, b) commutative { a + b }\nop(1)'
    );
    expect(result.value.toString()).toBe('Error("missing")');
  });

  test('a parameter with a type is still checked', () => {
    const result = executeEpsil(
      new ComputeEngine(),
      'function op(a: number, b) commutative { a + b }\nop("x", 1)'
    );
    expect(JSON.stringify(result.value.json)).toContain(
      `["ErrorCode","'incompatible-type'","'number'","'string'"]`
    );
  });
});
