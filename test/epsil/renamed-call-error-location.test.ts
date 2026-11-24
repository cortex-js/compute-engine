import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// Canonicalization changes the operator of some written calls: `Exp(w)` is
// `Power(ExponentialE, w)`, and `w/2` is `Multiply(1/2, w)`. The frames of an
// error in their argument name the canonical call (`Power argument 2`,
// `Multiply argument 2`), and the statement has no written call of that
// operator. The whole call or the whole statement was underlined. The
// canonical call keeps the source range of the written call, and its operand
// the source range of the written operand, so the frame now selects the
// written argument.
//

/** The source range, as `[start, end]` offsets, of each runtime error of the
 * program `src` that is at or after `marker`. */
function errorRanges(src: string, marker: string): [number, number][] {
  const result = executeEpsil(new ComputeEngine(), src);
  const at = src.indexOf(marker);
  return result.diagnostics
    .filter(
      (d) =>
        Array.isArray(d.message) &&
        d.message[0] === 'runtime-error' &&
        d.range[0] >= at
    )
    .map((d) => d.range);
}

/** The range of the occurrence `occurrence` (0-based) of `text` in `src`. */
function rangeOf(src: string, text: string, occurrence = 0): [number, number] {
  let start = -1;
  for (let k = 0; k <= occurrence; k++) start = src.indexOf(text, start + 1);
  return [start, start + text.length];
}

const prefix = 'let w: any = "s"\nlet u = 4\n';

describe('an error in the argument of a renamed call', () => {
  test.each([
    'let v = Exp(w) + 1',
    'let v = Exp(w)',
    'let v = Exp(w) * 2',
    'let v = Exp(w) / 2',
    'let v = Exp((w))',
    'let v = w/2 + 1',
    'let v = w/2',
    'let v = (w/2) + 1',
    'let v = Exp(w/2)',
    'let v = 3/u + w/2',
    'let v = w/2 + 3/u',
    'let v = Exp(2) + Exp(w)',
  ])('%s underlines w', (stmt) => {
    const src = `${prefix}${stmt}\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, 'w', 1)]);
  });

  test('the argument of the call on the path of the error', () => {
    // Both `w` are arguments of a renamed call; the error of `Sin(w/2)` is
    // the first to be reported.
    const src = `${prefix}let v = Sin(w/2) + Exp(w)\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, 'w', 1)]);
  });

  test('a canonical operand inside a written operand', () => {
    // `-w/2` is `Multiply(-1/2, w)`: the written argument that contains `w`
    // is `-w`.
    const src = `${prefix}let v = -w/2\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, '-w')]);
  });

  test('a written call of the operator of the frame elsewhere', () => {
    // The outer frame `Add argument 2` selects `Exp(w)`, so the frame
    // `Power argument 2` is the frame of `Exp(w)`, not of `y^2`.
    const src = `${prefix}let y = 3\nlet v = y^2 + Exp(w)\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, 'w', 1)]);
  });

  test.each([
    // The frame `Multiply argument 2` was recorded in the body of `g`. The
    // elements of a list record no frame, but the element of the value of
    // the statement that holds the error is the last one: it is underlined,
    // not the `u` of `u/2`.
    'function g(x) { Ln(x) * 2 }\nlet v = [u/2, g("a")]',
    // The same frame, recorded in the statement of `x`.
    'let x = Ln(w) * 2\nlet v = [u/2, x]',
    // The frame `Power argument 2` of `2^w`, recorded in the statement of
    // `z`, is not the frame of `Exp(u)`.
    'let z = 2^w\nlet v = [Exp(u), z]',
    // A list or a tuple written as a statement: its elements are not the
    // value of the statement.
    'let z = w/2\n[u/2, z]',
    'let z = 2^w\n[Exp(u), z]',
    'let z = w/2\n(u/2, z)',
  ])('a frame recorded outside the statement: %s', (program) => {
    const src = `${prefix}${program}\n0`;
    const stmt = program.slice(program.lastIndexOf('\n') + 1);
    // The last element, between `, ` and the closing bracket.
    const start = src.lastIndexOf(stmt) + stmt.lastIndexOf(', ') + 2;
    const end = src.lastIndexOf(stmt) + stmt.length - 1;
    expect(errorRanges(src, stmt)).toEqual([[start, end]]);
  });

  test('a call that stays a division is not changed', () => {
    const src = `${prefix}let v = 2/w + 1\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, 'w', 1)]);
  });

  test('an error of a called function is at the call', () => {
    const src = `${prefix}function g(x) { x/2 }\nlet v = u/2 + g("a")\n0`;
    expect(errorRanges(src, 'let v')).toEqual([rangeOf(src, 'g("a")')]);
  });
});

describe('the message names the written call', () => {
  /** The frames of the message of the runtime error of the statement that
   * starts with `let v`. */
  function frames(program: string): string {
    const src = `${prefix}${program}\n0`;
    const at = src.indexOf('let v');
    const d = executeEpsil(new ComputeEngine(), src).diagnostics.find(
      (x) =>
        Array.isArray(x.message) &&
        x.message[0] === 'runtime-error' &&
        x.range[0] >= at
    );
    expect(d).toBeDefined();
    return String(d!.message[2]);
  }

  test.each([
    ['let v = Exp(w) + 1', 'in Exp argument 1, in Add argument 1'],
    ['let v = w/2 + 1', 'in Divide argument 1, in Add argument 1'],
    ['let v = -w/2', 'in Divide argument 1'],
    ['let v = Exp(w/2)', 'in Divide argument 1, in Exp argument 1'],
    // `sqrt(w)/2` is `Multiply(1/2, Sqrt(w))`: the canonical `Sqrt` keeps
    // the source range of the written call, as `Ln` does.
    [
      'let v = sqrt(w)/2 + 1',
      'in Sqrt argument 1, in Divide argument 1, in Add argument 1',
    ],
    [
      'let v = ln(w)/2 + 1',
      'in Ln argument 1, in Divide argument 1, in Add argument 1',
    ],
    [
      'let v = Root(w, 3)/2 + 1',
      'in Root argument 1, in Divide argument 1, in Add argument 1',
    ],
    [
      'let v = Abs(w)/2 + 1',
      'in Abs argument 1, in Divide argument 1, in Add argument 1',
    ],
    // The frames `Negate argument 1, Add argument 1` of the canonical sum
    // name the written subtraction.
    ['let v = 1 - Exp(w)', 'in Exp argument 1, in Subtract argument 2'],
    // `y^2` is a written call of `Power`: its frame is not changed.
    ['let y = 3\nlet v = y^2 + Exp(w)', 'in Exp argument 1, in Add argument 2'],
    ['let v = 2^w + 1', 'in Power argument 2, in Add argument 1'],
  ])('%s', (program, expected) => {
    expect(frames(program)).toBe(expected);
  });

  test('a frame recorded in an earlier statement is not changed', () => {
    // The frame `Multiply argument 2` was recorded by `Ln(w) * 2` in the
    // statement of `x`. It is not the frame of the division `u/2`, whose
    // canonical form is `Multiply(1/2, u)`.
    expect(frames('let x = Ln(w) * 2\nlet v = [u/2, x]')).toBe(
      'in Ln argument 1, in Multiply argument 2'
    );
  });
});
