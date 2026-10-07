/**
 * The elements of a `Range` with exact integer bounds past 2^53 are exact
 * (GitHub issue #422). The element count of such a range has been exact
 * since 0.149.0, but the elements were computed as `lower + k·step` in
 * machine arithmetic, and `Range(2^60, 2^60 + 3)` materialized to four
 * copies of the double nearest to 2^60.
 *
 * `rangeElement()` in `src/compute-engine/library/collections.ts` now reads
 * the exact range (`exactArithmeticRange()`) and steps in `bigint`
 * arithmetic when the machine sum is not a safe integer. The same reading
 * gives a rational element for a rational bound or step that is the value
 * of a symbol, where the operand itself is not a number literal.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const TWO_60 = ['Power', 2, 60] as const;
const plus = (n: number) => ['Add', TWO_60, n];

function materialize(range: any): string[] {
  const v = ce.box(range).evaluate({ materialization: true });
  return v.ops!.map((op) => op.toString());
}

describe('RANGE ELEMENTS PAST 2^53', () => {
  test('Range(2^60, 2^60 + 3) materializes to four distinct integers', () => {
    expect(materialize(['Range', TWO_60, plus(3)])).toEqual([
      '1152921504606846976',
      '1152921504606846977',
      '1152921504606846978',
      '1152921504606846979',
    ]);
  });

  test('At(Range(2^60, 2^60 + 3), 2) is 2^60 + 1', () => {
    const v = ce.box(['At', ['Range', TWO_60, plus(3)], 2]).evaluate();
    expect(v.toString()).toBe('1152921504606846977');
    expect(v.isSame(1152921504606846977n)).toBe(true);
  });

  test('Last(Range(2^60, 2^60 + 3)) is 2^60 + 3', () => {
    const v = ce.box(['Last', ['Range', TWO_60, plus(3)]]).evaluate();
    expect(v.isSame(1152921504606846979n)).toBe(true);
  });

  test('a step of 3 past 2^53', () => {
    expect(materialize(['Range', plus(1), plus(7), 3])).toEqual([
      '1152921504606846977',
      '1152921504606846980',
      '1152921504606846983',
    ]);
  });

  test('a descending range past 2^53', () => {
    expect(materialize(['Range', plus(7), plus(1), -3])).toEqual([
      '1152921504606846983',
      '1152921504606846980',
      '1152921504606846977',
    ]);
  });

  test('a negative range past −2^53', () => {
    expect(
      materialize(['Range', ['Negate', TWO_60], ['Add', ['Negate', TWO_60], 2]])
    ).toEqual([
      '-1152921504606846976',
      '-1152921504606846975',
      '-1152921504606846974',
    ]);
  });

  test('a range crossing 2^53 steps exactly on both sides', () => {
    const lower = Number.MAX_SAFE_INTEGER - 1;
    const v = ce
      .box(['Range', lower, ['Add', lower, 3]])
      .evaluate({ materialization: true });
    expect(v.ops!.map((op) => op.toString())).toEqual([
      '9007199254740990',
      '9007199254740991',
      '9007199254740992',
      '9007199254740993',
    ]);
  });

  test('bounds held by symbols are read exactly', () => {
    ce.assign('lo', ce.box(TWO_60).evaluate());
    ce.assign('hi', ce.box(plus(2)).evaluate());
    expect(materialize(['Range', 'lo', 'hi'])).toEqual([
      '1152921504606846976',
      '1152921504606846977',
      '1152921504606846978',
    ]);
  });

  test('a small integer range is unchanged', () => {
    expect(materialize(['Range', 1, 5])).toEqual(['1', '2', '3', '4', '5']);
    const v = ce.box(['At', ['Range', 1, 5], 3]).evaluate();
    expect(v.isSame(3)).toBe(true);
  });

  test('a descending range from just past 2^53 steps exactly', () => {
    // The double of 2^53 + 1 is 2^53, and the machine sum `2^53 − 2` for
    // the second element is a safe integer: the exact element is 2^53 − 1.
    const lower = ['Add', ['Power', 2, 53], 1];
    expect(materialize(['Range', lower, ['Subtract', lower, 4], -2])).toEqual([
      '9007199254740993',
      '9007199254740991',
      '9007199254740989',
    ]);
  });

  test('a bound past 2^53 with a safe machine sum: Range(2^60 + 1, 1, -2^60)', () => {
    // The lower bound rounds to 2^60 in machine arithmetic, and the machine
    // second element is the safe integer 0; the exact element is 1.
    expect(materialize(['Range', plus(1), 1, ['Negate', TWO_60]])).toEqual([
      '1152921504606846977',
      '1',
    ]);
  });

  test('a float step keeps float elements', () => {
    expect(materialize(['Range', 1, 3, 0.5])).toEqual([
      '1',
      '1.5',
      '2',
      '2.5',
      '3',
    ]);
  });

  test('a float bound keeps float elements', () => {
    expect(materialize(['Range', 1.5, 3])).toEqual(['1.5', '2.5']);
  });

  test('a rational step held by a symbol gives exact rationals', () => {
    ce.assign('s', ce.parse('1/3'));
    expect(materialize(['Range', 0, 1, 's'])).toEqual(['0', '1/3', '2/3', '1']);
  });
});
