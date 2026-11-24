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
// The error of `Ln(w)`, with `w` a variable that holds the string `"s"`, has
// the frame `Ln argument 1`, as the error of `Ln("s")` has. The underline is
// then the argument `w` inside the operand `Ln(w)`.
//

/** The text underlined by each diagnostic of kind `kind` of the statement
 * that starts with `marker`. */
function underlines(
  src: string,
  marker = 'let v',
  kind = 'runtime-error'
): string[] {
  const result = executeEpsil(new ComputeEngine(), src);
  const at = src.indexOf(marker);
  return result.diagnostics
    .filter(
      (d) =>
        Array.isArray(d.message) && d.message[0] === kind && d.range[0] >= at
    )
    .map((d) => src.slice(d.range[0], d.range[1]));
}

describe('an error in an operand of a sum or product', () => {
  const prefix = 'let w: any = "s"\n';

  test.each([
    ['let v = Ln(w) * 2', 'w'],
    // The error that the handler of `Sin` makes has the frame
    // `Sin argument 1`, as the error of `Ln(w)` has.
    ['let v = Sin(w) * 2', 'w'],
    ['let v = 2 * Ln(w)', 'w'],
    // `Max` keeps the written order of its operands.
    ['let v = Max(z, Ln(w))', 'w'],
    // `Xor(Not(w), B)` is `Xor(B, Not(w))` in canonical form, and its error
    // has the frames `Not argument 1, Xor argument 2`.
    ['let v = Xor(Not(w), B)', 'w'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });

  test('an operand refused at canonicalization keeps its underline', () => {
    expect(underlines('let v = 1 + "a"\n0')).toEqual(['"a"']);
    expect(underlines('let v = "a" + 1\n0')).toEqual(['"a"']);
  });

  test('of two equal operands, the first is underlined', () => {
    // The sum evaluates its operands in order, and the frame names the
    // first one, whose evaluation returned the error. The underline is the
    // argument `w` of that operand.
    const src = `${prefix}let v = Ln(w) + Ln(w)\n0`;
    const result = executeEpsil(new ComputeEngine(), src);
    const ranges = result.diagnostics
      .filter(
        (d) => Array.isArray(d.message) && d.message[0] === 'runtime-error'
      )
      .map((d) => d.range);
    const first = src.indexOf('Ln(w)') + 'Ln('.length;
    expect(ranges).toEqual([[first, first + 1]]);
  });

  // The error of an operand that the product evaluates names that operand of
  // the canonical call, and the frame `Sin argument 1` then names the
  // argument `w`, when other operands can also fail. The frames do not count
  // the operands of the result of the evaluation (`Cos(x)·Error(…)`).
  test.each([
    ['let v = Sin(w) * Cos(x)', 'w'],
    ['let v = Cos(x) * Sin(w)', 'w'],
    ['let v = Sin(w) + Ln(x)', 'w'],
    ['let v = Cos(x) - Sin(w)', 'w'],
    ['let v = x * y * Sin(w)', 'w'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });

  test('two operands that can fail underline the first that fails', () => {
    expect(
      underlines(`${prefix}let u: any = "t"\nlet v = Sin(u) * Ln(w)\n0`)
    ).toEqual(['u']);
  });

  test('a variable that holds an expression that fails when it is read', () => {
    // `w2` holds `Sin(q)`, which fails once `q` holds a string. The frame names
    // `w2`, not `Cos(x)`, the operand at the same position of the result of
    // the evaluation. `q` is a variable of the host with no value yet.
    const src = 'let w2: any = Sin(q)\nq = "a"\n';
    for (const [stmt, marker] of [
      ['let v = w2 * Cos(x)', 'let v'],
      ['let v = Cos(x) * w2', 'let v'],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('q', 'any');
      const full = `${src}${stmt}\n0`;
      const at = full.indexOf(marker);
      const underlined = executeEpsil(ce, full)
        .diagnostics.filter(
          (d) => d.message[0] === 'runtime-error' && d.range[0] >= at
        )
        .map((d) => full.slice(d.range[0], d.range[1]));
      expect(underlined).toEqual(['w2']);
    }
  });

  test('a second product inside an operand does not hide the argument', () => {
    // The frames `Sin argument 1, Multiply argument 2` select the `w` of
    // `Sin(w)`, not an operand of the product `x * y`.
    expect(underlines(`${prefix}let v = Ln(x * y) * Sin(w)\n0`)).toEqual(['w']);
  });

  test('in a nested statement', () => {
    expect(
      underlines(`${prefix}for i in [1] { let q = Ln(w) * 2 }\n0`, 'for')
    ).toEqual(['w']);
  });
});

describe('a variable that holds a string, as an operand of a sum or product', () => {
  // The variable evaluates to a valid string, and the handler of `Add` or
  // `Multiply` makes the type error, which names the string. The handler
  // records the operand whose value is that string, and the evaluation of
  // the sum or product adds a frame for it (`recordRefusedOperand()` in
  // `src/compute-engine/boxed-expression/error-value.ts`). Before, the
  // error had no frame, and the whole statement was underlined.
  const prefix = 'let s: any = "a"\n';

  test.each([
    ['let v = s * Cos(x)', 's'],
    ['let v = Cos(x) * s', 's'],
    ['let v = s + Cos(x)', 's'],
    ['let v = Cos(x) + s', 's'],
    ['let v = x * s * y', 's'],
    ['let v = 2 * s', 's'],
    ['let v = s - 3', 's'],
    ['let v = Sin(x) + 2 * s', 's'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });

  test('of two variables, the one whose value the error names', () => {
    const src = `${prefix}let t: any = "b"\nlet v = t * s\n0`;
    const result = executeEpsil(new ComputeEngine(), src);
    const errors = result.diagnostics.filter(
      (d) => Array.isArray(d.message) && d.message[0] === 'runtime-error'
    );
    expect(errors).toHaveLength(1);
    const named = String(errors[0].message[1]).endsWith('at `a`') ? 's' : 't';
    expect(src.slice(errors[0].range[0], errors[0].range[1])).toBe(named);
  });
});

describe('a call that returns a string, as an operand of a sum or product', () => {
  // The handler of `Add` or `Multiply` records the operand that it
  // evaluated to the string that the error names. The call is not
  // evaluated again. Before, the error had no frame, and the whole
  // statement was underlined.
  const prefix = 'let w: any = ["a"]\nlet y = 5\n';

  test.each([
    ['let v = w[1] * Cos(x)', 'w[1]'],
    ['let v = Cos(x) * w[1]', 'w[1]'],
    ['let v = w[1] + Cos(x)', 'w[1]'],
    ['let v = 2 * w[1]', 'w[1]'],
    ['let v = w[1] - 3', 'w[1]'],
    ['let v = y * w[1] * Sin(x)', 'w[1]'],
    ['let v = Sin(x) + 2 * w[1]', 'w[1]'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}${stmt}\n0`)).toEqual([expected]);
  });

  test('of two operands with the same value, the first is underlined', () => {
    const src = `${prefix}let v = w[1] * w[1]\n0`;
    const result = executeEpsil(new ComputeEngine(), src);
    const ranges = result.diagnostics
      .filter(
        (d) => Array.isArray(d.message) && d.message[0] === 'runtime-error'
      )
      .map((d) => d.range);
    const first = src.indexOf('w[1] *');
    expect(ranges).toEqual([[first, first + 'w[1]'.length]]);
  });

  test.each([
    ['"b"', 'let v = s * F()', 'F()'],
    ['2', 'let v = F() * s', 's'],
  ])(
    'a call that assigns an operand and returns %s: %s underlines %s',
    (value, stmt, expected) => {
      // `F()` assigns `"a"` to the operand `s`. The handler records the
      // operand from the values that it evaluated, so the operand that is
      // underlined is the one whose value the handler refused: `F()` when it
      // returns `"b"`, and `s` when `s` is evaluated after the call.
      const src = `let s: any = 1\nlet F: () scope -> any = () => do { s = "a"\n ${value} }\n${stmt}\n0`;
      expect(underlines(src)).toEqual([expected]);
    }
  );
});

describe('a sum or product in the body of a called function', () => {
  // The variable `x` of the body holds the string, but the sum or product of
  // the body adds no frame for it: the breadcrumb has no frame for the call
  // of `g`, so a frame of the body would be matched by name to a call of the
  // statement, and `Add argument 1` would select the `y` of `y + g("a")`.
  test.each([
    ['function g(x) { x + 1 }', 'let v = y + g("a")', 'g("a")'],
    ['function g(x) { 1 + x }', 'let v = g("a") + y', 'g("a")'],
    ['function g(x) { x * 2 }', 'let v = 3 * y + g("a")', 'g("a")'],
    ['function g(x) { x + 1 }', 'let v = Sin(y + 1) * g("a")', 'g("a")'],
    // The element of the list that holds the error selects the call.
    ['function g(x) { x * 2 }', 'let v = [3 * y, g("a")]', 'g("a")'],
  ])('%s, %s underlines %s', (definition, stmt, expected) => {
    expect(underlines(`${definition}\nlet y = 5\n${stmt}\n0`)).toEqual([
      expected,
    ]);
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

  test('no call of the statement made the error', () => {
    expect(underlines(`${failing}let v = x + Ln(2) + Ln(3)\n0`)).toEqual(['x']);
  });
});

describe('an error in one of two calls of the same function', () => {
  // Both calls match the frame `Ln argument 1`. The argument of the other
  // call is a literal that is not the value that the error names, so it did
  // not make the error.
  test.each([
    ['let v = Ln("a") + Ln(2)', '"a"'],
    ['let v = Ln(2) + Ln("a")', '"a"'],
    ['let v = Ln("a") * Ln(2)', '"a"'],
    ['let v = Max(Ln(2), Ln("a"))', '"a"'],
    ['let v = Max(Ln(2), Ln(3), Ln("a"))', '"a"'],
  ])('%s underlines %s', (stmt, expected) => {
    const src = `${stmt}\n0`;
    expect(underlines(src)).toEqual([expected]);
    expect(underlines(src, 'let v', 'static-type-error')).toEqual([expected]);
  });

  test('two arguments that can be the value: the frame of the sum selects the call', () => {
    // `x` can be the value `"a"`, so the value does not select a call. The
    // frame `Add argument 1` names the canonical operand, which keeps the
    // source range of `Ln("a")`.
    expect(underlines('let v = Ln("a") + Ln(x)\n0')).toEqual(['"a"']);
    expect(underlines('let v = Ln(x) + Ln("a")\n0')).toEqual(['"a"']);
    expect(underlines('let v = Ln(x) - Ln("a")\n0')).toEqual(['"a"']);
  });

  test('an argument that is not a literal does not select its call', () => {
    // The error is in `x`, made by the first statement. The value does not
    // select `Ln(y)`, whose argument is a variable. The two written `+` make
    // one canonical sum, and the frame `Add argument 1` names its operand
    // `x`, by the source range of the canonical operand. No call of `Ln` is
    // inside `x`, so the frame `Ln argument 1` was recorded by an earlier
    // statement, and `x` is underlined.
    const src = 'let x = Ln("a")\nlet y = 2\nlet v = x + Ln(y) + Ln(2)\n0';
    expect(underlines(src)).toEqual(['x']);
  });

  test.each([
    'let v = if n == 1 { Ln("a") } else { x + Ln(2) }',
    'let v = if n == 1 { Ln("a") } else { x + Ln(2) + Ln(3) }',
    'let v = if n == 1 { Ln("a") + 0 } else { Ln(2) + x }',
  ])('a call in the branch that did not run: %s', (stmt) => {
    // The frame `If argument 3` selects the `else` branch, and the error is
    // in `x`, not in the `Ln("a")` of the other branch.
    const src = `let x = Ln("a")\nlet n = 2\n${stmt}\n0`;
    expect(underlines(src)).toEqual(['x']);
  });

  test('three calls of the same function', () => {
    const src = 'let v = Ln(2) + Ln(3) + Ln("a")\n0';
    expect(underlines(src)).toEqual(['"a"']);
    expect(underlines(src, 'let v', 'static-type-error')).toEqual(['"a"']);
  });

  test('a third call with the value', () => {
    // Two calls have the argument `"a"`. The second one is evaluated, and
    // its range is underlined.
    const src =
      'let n = 2\nlet v = if n == 1 { Ln("a") + Ln(2) } else { Ln("a") }\n0';
    const result = executeEpsil(new ComputeEngine(), src);
    const ranges = result.diagnostics
      .filter(
        (d) => Array.isArray(d.message) && d.message[0] === 'runtime-error'
      )
      .map((d) => d.range[0]);
    expect(ranges).toEqual([src.lastIndexOf('"a"')]);
  });

  // The error of an extra argument names it by its text, not by its value:
  // `'3'` for `3`, and `'"a"'` for `"a"`.
  test.each([
    ['let v = Sqrt(2, 3)', '3'],
    ['let v = Sqrt(2, "a")', '"a"'],
  ])('an error that names the argument by its text: %s', (stmt, expected) => {
    const src = `${stmt}\n0`;
    expect(underlines(src)).toEqual([expected]);
    expect(underlines(src, 'let v', 'static-type-error')).toEqual([expected]);
  });

  test('two extra arguments: the frame of the sum selects the call', () => {
    // Both calls have an extra argument. The frame `Add argument 1` names
    // the canonical operand whose evaluation returned the error.
    expect(underlines('let v = Sqrt(2, 3) + Sqrt(2, 4)\n0')).toEqual(['3']);
  });
});

describe('an error in an operand of a subtraction', () => {
  // `3 - Ln(w)` is a sum in canonical form, so its error has an `Add` frame.
  // The written `Subtract` is the call of that frame.
  const prefix = 'let w: any = "s"\n';

  test.each([
    ['let v = 3 - Ln(w)', 'w'],
    ['let v = (3 - Ln(w)) - 1', 'w'],
    ['let v = Sqrt(y + 2) - Ln(w)', 'w'],
  ])('%s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}let y = 5\n${stmt}\n0`)).toEqual([expected]);
  });

  // The frame `Add argument 1` can name the subtraction or a sum inside one
  // of its operands. The written `Add` and `Subtract` calls are searched
  // together, so the frame does not select an operand of the inner sum. When
  // an operand holds another sum, such as the `y + 2` inside `Sqrt`, the
  // frame can name that sum, and the whole subtraction is underlined, as for
  // a sum.
  test.each([
    ['let v = Sqrt(y + 2) - s', 'Sqrt(y + 2) - s'],
    ['let v = s - Sqrt(y + 2)', 's - Sqrt(y + 2)'],
    ['let v = Sqrt(y - 2) - s', 'Sqrt(y - 2) - s'],
    ['let v = Sqrt(y + 2) + s', 'Sqrt(y + 2) + s'],
    ['let v = Sqrt(y - 2) + s', 'Sqrt(y - 2) + s'],
    ['let v = y + 2 - s', 's'],
    ['let v = s - y + 2', 's'],
  ])('%s underlines %s', (stmt, expected) => {
    const src = `let s: any = "a"\nlet y = 5\n${stmt}\n0`;
    expect(underlines(src)).toEqual([expected]);
  });
});

describe('an error in the second operand of a subtraction with a unary minus', () => {
  // `a - b` is `Add(a, Negate(b))` in canonical form, so the error of `b`
  // has the frame `Negate argument 1`. The written subtraction is a call of
  // that frame, as the written unary minus is, and the unary minus of the
  // first operand is not the only candidate. When the frames cannot tell
  // the two calls apart, the underline is the subtraction or the site that
  // the engine recorded, never the operand of the unary minus.
  const prefix = 'let s: any = "a"\nlet y = 5\n';

  test.each([
    ['let v = -(y + 2) - s', '-(y + 2) - s'],
    ['let v = -y - s', 's'],
    ['let v = -s - y', 's'],
    ['let v = [-y - s, 1]', 's'],
    ['let v = Sin(-y - s)', 's'],
    ['let v = -(2) - "a"', '"a"'],
    ['let v = -("a") - 2', '"a"'],
    // `y - 2` is `Add(y, -2)` in canonical form, with no `Negate`.
    ['let v = [y - 2, -s]', 's'],
    ['let v = [-s, y - 2]', 's'],
    // A runtime error of the `Negate` of a subtraction has an `Add` frame
    // after its `Negate` frame, so the frame alone names the `-s`.
    ['let v = [y - z, -s]', 's'],
  ])('runtime: %s underlines %s', (stmt, expected) => {
    expect(underlines(`${prefix}let z = 1\n${stmt}\n0`)).toEqual([expected]);
  });

  test('a Negate frame of an earlier statement does not select a subtrahend', () => {
    // The error of `-s` is held by `x`. The frame `Add argument 1` of the
    // subtraction names `x`, so the frame `Negate argument 1` was not
    // recorded by the subtraction.
    const src = `${prefix}let x: any = -s\nlet v = [x - y, 1]\n0`;
    expect(underlines(src)).toEqual(['x']);
  });

  test.each([
    ['let v = -(y + 2) - s', 's'],
    ['let v = -y - s', 's'],
    ['let v = -s - y', 's'],
    ['let v = Sin(-y - s)', 's'],
    ['let v = -(2) - "a"', '"a"'],
  ])('static: %s underlines %s', (stmt, expected) => {
    expect(
      underlines(`${prefix}${stmt}\n0`, 'let v', 'static-type-error')
    ).toEqual([expected]);
  });
});

describe('an argument whose value the logarithm refuses', () => {
  // `Ln(w)`, with `w` a variable that holds `"s"`, is valid when it is
  // boxed, and the evaluation refuses the value. The error has the frame
  // `Ln argument 1`, as the error of `Ln("s")` has, and the underline is the
  // argument `w`.
  const prefix = 'let w: any = "s"\n';

  function runtime(stmt: string): { frames: string; at: string } {
    const src = `${prefix}${stmt}\n0`;
    const result = executeEpsil(new ComputeEngine(), src);
    const d = result.diagnostics.find(
      (x) => Array.isArray(x.message) && x.message[0] === 'runtime-error'
    );
    expect(d).toBeDefined();
    return {
      frames: String(d!.message[2]),
      at: src.slice(d!.range[0], d!.range[1]),
    };
  }

  test.each([
    ['let v = 3 - ln(w)', 'in Ln argument 1, in Subtract argument 2'],
    ['let v = ln(w) * 2', 'in Ln argument 1, in Multiply argument 2'],
    ['let v = -ln(w)', 'in Ln argument 1, in Negate argument 1'],
    ['let v = sqrt(w) + 1', 'in Sqrt argument 1, in Add argument 1'],
  ])('%s', (stmt, frames) => {
    expect(runtime(stmt)).toEqual({ frames, at: 'w' });
  });

  test('another call of ln in the sum', () => {
    // Both operands of the sum hold a call of `ln`. The frame
    // `Add argument 1` selects `ln(w)` by the source range of the canonical
    // operand.
    expect(runtime('let v = ln(w) + ln(2)').at).toBe('w');
    expect(runtime('let v = ln(2) + ln(w)').at).toBe('w');
    expect(runtime('let v = ln(x) * ln(w)').at).toBe('w');
  });
});

describe('the frames of an error in the second operand of a subtraction', () => {
  // `a - b` is `Add(a, Negate(b))` in canonical form. The two frames
  // `Negate argument 1, Add argument k` that the canonical sum records for
  // `b` are the one frame `Subtract argument 2` of the written subtraction.
  const prefix = 'let w: any = "s"\n';

  function runtimeFrames(program: string): string[] {
    const src = `${prefix}${program}\n0`;
    return executeEpsil(new ComputeEngine(), src)
      .diagnostics.filter(
        (x) => Array.isArray(x.message) && x.message[0] === 'runtime-error'
      )
      .map((d) => String(d.message[2]));
  }

  test.each([
    ['let v = 2 - w', 'in Subtract argument 2'],
    ['let v = 1 + 2 - ln(w)', 'in Ln argument 1, in Subtract argument 2'],
    ['let v = 1 - ln(w) - 2', 'in Ln argument 1, in Subtract argument 2'],
    // Two subtractions: the canonical operand of the frame `Add argument 2`
    // is made from the `ln(w)` of the inner one.
    [
      'let y = 2\nlet v = y - ln(w) - ln(2)',
      'in Ln argument 1, in Subtract argument 2',
    ],
    ['let v = [1 - ln(w), 2]', 'in Ln argument 1, in Subtract argument 2'],
    [
      'let v = Sin(3 - ln(w))',
      'in Ln argument 1, in Subtract argument 2, in Sin argument 1',
    ],
    // A written unary minus in a sum is not a subtraction.
    [
      'let v = 1 + -ln(w)',
      'in Ln argument 1, in Negate argument 1, in Add argument 1',
    ],
    // The subtraction of a number is `Add(ln(w), -3)`, with no `Negate`.
    ['let v = ln(w) - 3', 'in Ln argument 1, in Add argument 1'],
    // The `Add` frame of the unary minus selects `-ln(w)`, which is not the
    // second operand of a subtraction. The subtraction `2 - ln(y)` elsewhere
    // in the statement does not change it.
    [
      'let y = 2\nlet v = Cos(1 + -ln(w)) + Sin(2 - ln(y))',
      'in Ln argument 1, in Negate argument 1, in Add argument 1, in Cos argument 1, in Add argument 1',
    ],
    // The inner pair names the unary minus inside the subtrahend.
    [
      'let v = 2 - Sin(1 + -ln(w))',
      'in Ln argument 1, in Negate argument 1, in Add argument 1, in Sin argument 1, in Subtract argument 2',
    ],
  ])('%s', (program, expected) => {
    expect(runtimeFrames(program)).toEqual([expected]);
  });

  test('the frames of an earlier statement are not changed', () => {
    // The first two frames after `Ln` were recorded by `1 + -Ln(x)` in the
    // body of `g`, and the last two by the subtraction of the statement.
    expect(
      runtimeFrames('function g(x) { 1 + -Ln(x) }\nlet v = 5 - g(w)')
    ).toEqual([
      'in Ln argument 1, in Negate argument 1, in Add argument 1, in Subtract argument 2',
    ]);
    // The error of `x` is reported for its statement, and again for the
    // statement that reads `x`.
    expect(runtimeFrames('let x = 1 - ln(w)\nlet v = 5 - x')).toEqual([
      'in Ln argument 1, in Subtract argument 2',
      'in Ln argument 1, in Negate argument 1, in Add argument 1, in Subtract argument 2',
    ]);
  });

  test('a pair of an earlier statement is not matched to a subtraction', () => {
    // The frames `Negate argument 1, Add argument 2` were recorded by the
    // unary minus in the statement of `x`. The pipe records an `Apply` frame
    // that no written call of the statement matches, so no frame of the
    // statement selects an operand, and the subtraction `Sin(_) - ln(y)`
    // does not name them.
    const frames = runtimeFrames(
      'let y = 2\nlet x = y + -ln(w)\nlet v = x |> Sin(_) - ln(y)'
    );
    expect(frames[frames.length - 1]).toBe(
      'in Ln argument 1, in Negate argument 1, in Add argument 2, in Apply argument 2'
    );
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
