import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The source range of an error whose frames name the same operator more than
// once. An `else if` is an `If` inside the third argument of an `If`, so an
// error in the branch of an `else if` has the frames `If argument 2, If
// argument 3`. The locator (`locateError()`, `src/epsil/error-location.ts`)
// matches a frame to the source by its operator name, and when the name
// occurs more than once in the statement it walks the frames from the
// outermost one down from the statement node. Before, it gave up on the
// ambiguous name and underlined the whole statement.
//

const G = 'function g(x) { 1/x }\n';

function run(source: string): {
  diagnostics: ReturnType<typeof executeEpsil>['diagnostics'];
  at: string[];
  frames: string[];
} {
  const result = executeEpsil(new ComputeEngine(), source);
  return {
    diagnostics: result.diagnostics,
    // The source text under each diagnostic.
    at: result.diagnostics.map((d) => source.slice(d.range[0], d.range[1])),
    frames: result.diagnostics.map((d) => String(d.message[2])),
  };
}

describe('AN ERROR IN THE BRANCH OF AN ELSE IF', () => {
  test('the then branch of the else if', () => {
    const r = run(
      G +
        'let n = 2\nlet v = if n == 1 { 0 } else if n == 2 { g("a") } else { n }\nv'
    );
    expect(r.frames).toEqual(['in If argument 2, in If argument 3']);
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('the else branch after an else if', () => {
    const r = run(
      G +
        'let n = 3\nlet v = if n == 1 { 0 } else if n == 2 { 1 } else { g("a") }\nv'
    );
    expect(r.frames).toEqual(['in If argument 3, in If argument 3']);
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('three else if: the branch of the last one', () => {
    const r = run(
      G +
        'let n = 4\nlet v = if n == 1 { 0 } else if n == 2 { 1 } else if n == 3 { 2 } else if n == 4 { g("a") } else { 5 }\nv'
    );
    expect(r.frames).toEqual([
      'in If argument 2, in If argument 3, in If argument 3, in If argument 3',
    ]);
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('three else if: the branch of the middle one', () => {
    const r = run(
      G +
        'let n = 3\nlet v = if n == 1 { 0 } else if n == 2 { 1 } else if n == 3 { g("a") } else if n == 4 { 3 } else { 5 }\nv'
    );
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('three else if: the final else', () => {
    const r = run(
      G +
        'let n = 9\nlet v = if n == 1 { 0 } else if n == 2 { 1 } else if n == 3 { 2 } else if n == 4 { 3 } else { g("a") }\nv'
    );
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('the condition of an else if', () => {
    const r = run(
      G +
        'let n = 2\nlet v = if n == 1 { 0 } else if g("a") == 2 { 1 } else { 2 }\nv'
    );
    expect(r.frames).toEqual([
      'in Equal argument 1, in If argument 1, in If argument 3',
    ]);
    expect(r.at).toEqual(['g("a")']);
  });

  test('an if in the then branch of the outer if is not selected', () => {
    // The `If` in the first branch is a call of the same operator that is not
    // on the way of the error: the walk selects the outer `if` first, and
    // then searches only in its `else` argument.
    const r = run(
      G +
        'let n = 2\nlet v = if n == 1 { if n == 3 { 0 } else { 1 } } else if n == 2 { g("a") } else { 3 }\nv'
    );
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('an else if in the then branch of an if', () => {
    const r = run(
      G +
        'let n = 2\nlet v = if n > 0 { if n == 1 { 0 } else if n == 2 { g("a") } else { 1 } } else { 3 }\nv'
    );
    expect(r.frames).toEqual([
      'in If argument 2, in If argument 3, in If argument 2',
    ]);
    expect(r.at).toEqual(['{ g("a") }']);
  });
});

describe('AN ELSE IF INSIDE ANOTHER CONSTRUCT', () => {
  test('an if with an else if as the argument of a call', () => {
    const r = run(
      G +
        'function h(x) { x }\nlet n = 2\nlet v = h(if n == 1 { 0 } else if n == 2 { g("a") } else { n })\nv'
    );
    expect(r.frames).toEqual([
      'in If argument 2, in If argument 3, in h argument 1',
    ]);
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('an if with an else if in a case of a match', () => {
    // `Match` records no frame, so the outermost frame is the outer `if`.
    const r = run(
      G +
        'let n = 2\nlet v = match n {\n  1 => 0\n  2 => if n == 1 { 0 } else if n == 2 { g("a") } else { n }\n  _ => 3\n}\nv'
    );
    // The frame of the selected case of the `match` comes last.
    expect(r.frames).toEqual([
      'in If argument 2, in If argument 3, in Match argument 3',
    ]);
    expect(r.at).toEqual(['{ g("a") }']);
  });

  test('two ifs as arguments of Which', () => {
    const r = run(
      G +
        'let n = 2\nlet v = Which(n == 1, if n == 1 { 0 } else { 1 }, n == 2, if n == 2 { g("a") } else { 0 }, True, n)\nv'
    );
    expect(r.frames).toEqual(['in If argument 2, in Which argument 4']);
    expect(r.at).toEqual(['{ g("a") }']);
  });
});

describe('WHEN THE WALK CANNOT DECIDE', () => {
  test('two ifs in a list, which records no frame: the whole statement', () => {
    // The only frame is `If argument 2`, and there are two `if` in the
    // statement that are not inside one another. The locator does not guess.
    const source =
      G +
      'let n = 2\nlet v = [if n == 1 { 0 } else { 1 }, if n == 2 { g("a") } else { n }]\nv';
    const r = run(source);
    expect(r.frames).toEqual(['in If argument 2']);
    expect(r.at).toEqual([
      'let v = [if n == 1 { 0 } else { 1 }, if n == 2 { g("a") } else { n }]',
    ]);
  });
});

describe('NESTED CALLS OF ONE OPERATOR', () => {
  test('a runtime error inside the second argument of the outer call', () => {
    const r = run('Arctan2(1, Arctan2("a", 1))\n1');
    const runtime = r.diagnostics.findIndex(
      (d) => d.message[0] === 'runtime-error'
    );
    expect(r.frames[runtime]).toBe(
      'in Arctan2 argument 1, in Arctan2 argument 2'
    );
    expect(r.at[runtime]).toBe('"a"');
  });

  test('a static error has one frame: the argument must contain the error', () => {
    // The static check gives only the innermost frame, `Arctan2 argument 1`.
    // Argument 1 of the outer call is `1`, which does not contain the inner
    // call, so the locator keeps the whole statement.
    const r = run('Arctan2(1, Arctan2("a", 1))\n1');
    const stat = r.diagnostics.findIndex(
      (d) => d.message[0] === 'static-type-error'
    );
    expect(r.at[stat]).toBe('Arctan2(1, Arctan2("a", 1))');
  });

  test('a static error in the first argument of the outer call', () => {
    // Argument 1 of the outer `ln` contains the inner `ln`, so the locator
    // can narrow to it.
    const r = run('ln(ln("a"))\n1');
    const stat = r.diagnostics.findIndex(
      (d) => d.message[0] === 'static-type-error'
    );
    expect(r.at[stat]).toBe('ln("a")');
    const runtime = r.diagnostics.findIndex(
      (d) => d.message[0] === 'runtime-error'
    );
    expect(r.at[runtime]).toBe('"a"');
  });
});

describe('A FRAME OF AN OPERATOR THAT REORDERS ITS OPERANDS', () => {
  // `Add` and `Multiply` sort their operands in canonical form, so the frame
  // `Add argument 2` counts the CANONICAL operands and can name the first
  // written operand. When both written operands hold an `if`, the locator
  // cannot know which one has the error. It must then underline a range that
  // contains the error (the whole sum), never a branch of the other `if`.
  // (The range of a sum of parenthesized operands does not include the first
  // and the last parenthesis, so the test checks what the range contains.)
  const ERROR_CALL = 'g("a")';

  /** The text under the runtime diagnostic, and whether it holds the call
   * that made the error. */
  function underline(program: string): { at: string; holdsError: boolean } {
    const source = G + program;
    const r = executeEpsil(new ComputeEngine(), source);
    const d = r.diagnostics.find((x) => x.message[0] === 'runtime-error');
    expect(d).toBeDefined();
    const at = source.slice(d!.range[0], d!.range[1]);
    const errorAt = source.indexOf(ERROR_CALL);
    return {
      at,
      holdsError:
        d!.range[0] <= errorAt && errorAt + ERROR_CALL.length <= d!.range[1],
    };
  }

  test('a sum, error in the first written operand', () => {
    const u = underline(
      'let n = 1\nlet v = (if n == 1 { g("a") } else { 0 }) + (if n == 2 { 2 } else { 3 })\nv'
    );
    expect(u.holdsError).toBe(true);
    expect(u.at).toContain(' + ');
  });

  test('a sum, error in the second written operand', () => {
    const u = underline(
      'let n = 1\nlet v = (if n == 5 { 2 } else { 3 }) + (if n == 1 { g("a") } else { 0 })\nv'
    );
    expect(u.holdsError).toBe(true);
    expect(u.at).toContain(' + ');
  });

  test('a product, error in the first written operand', () => {
    const u = underline(
      'let n = 1\nlet v = (if n == 1 { g("a") } else { 0 }) * (if n == 2 { 2 } else { 3 })\nv'
    );
    expect(u.holdsError).toBe(true);
    expect(u.at).toContain(' * ');
  });

  test('a product, error in the second written operand', () => {
    const u = underline(
      'let n = 1\nlet v = (if n == 5 { 2 } else { 3 }) * (if n == 1 { g("a") } else { 0 })\nv'
    );
    expect(u.holdsError).toBe(true);
    expect(u.at).toContain(' * ');
  });

  test('a sum with an else if', () => {
    const u = underline(
      'let n = 2\nlet v = (if n == 1 { 0 } else if n == 2 { g("a") } else { 1 }) + (if n == 5 { 2 } else { 3 })\nv'
    );
    expect(u.holdsError).toBe(true);
  });

  test('a sum with a subtraction, error in the subtracted operand', () => {
    // `2 + a - b` is written `Subtract(Add(2, a), b)` and is one canonical
    // sum, `Add(2, a, Negate(b))`.
    const u = underline(
      'let n = 1\nlet v = 2 + (if n == 2 { 2 } else { 3 }) - (if n == 1 { g("a") } else { 0 })\nv'
    );
    expect(u.holdsError).toBe(true);
  });

  test('only one operand of the sum holds an if: the branch', () => {
    const u = underline(
      'let n = 1\nlet v = (if n == 1 { g("a") } else { 0 }) + ln(2)\nv'
    );
    expect(u.at).toBe('{ g("a") }');
  });

  test('two calls of ln in a sum: not the argument of the other one', () => {
    const source = 'let v = x + ln("a") + ln(2)\n1';
    const r = executeEpsil(new ComputeEngine(), source);
    const d = r.diagnostics.find((x) => x.message[0] === 'runtime-error');
    expect(d!.message[2]).toBe('in Ln argument 1, in Add argument 2');
    const at = source.slice(d!.range[0], d!.range[1]);
    expect(at).toContain('ln("a")');
  });

  test('an operand that the sum refuses keeps its written position', () => {
    expect(run('let v = "a" + 1\nv').at).toContain('"a"');
    const r = run('let n = 1\nlet v = 1 + n * "a" + 2\nv');
    expect(r.frames).toContain('in Multiply argument 2, in Add argument 2');
    expect(r.at.every((x) => x === '"a"')).toBe(true);
  });
});
