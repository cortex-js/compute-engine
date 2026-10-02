import { ComputeEngine } from '../../../src/compute-engine';

/**
 * The lenient grammar reports a reading choice that has a second common
 * reading with a parse diagnostic whose code starts with `ambiguous-`. The
 * reading itself does not change, and the strict grammar reports none of
 * these codes. Design: `docs/plans/2026-10-01-lenient-ambiguity-codes.md`.
 *
 * This file covers the codes for products and groups
 * (`ambiguous-equation-number`, `ambiguous-group-product`), for operators
 * (`ambiguous-factorial`, `ambiguous-arrow`, `ambiguous-equal-chain`,
 * `ambiguous-element`, `ambiguous-range`, `ambiguous-percent`) and for
 * numbers and layout (`ambiguous-comma`, `ambiguous-list-label`,
 * `ambiguous-number-notation`, `ambiguous-date`).
 */

const CODES = new Set([
  'ambiguous-equation-number',
  'ambiguous-group-product',
  'ambiguous-factorial',
  'ambiguous-arrow',
  'ambiguous-equal-chain',
  'ambiguous-element',
  'ambiguous-range',
  'ambiguous-percent',
  'ambiguous-comma',
  'ambiguous-list-label',
  'ambiguous-number-notation',
  'ambiguous-date',
]);

/**
 * The diagnostics of this file's codes for `text`, as `code: spanned text`.
 * The inputs are plain text, so the normalized LaTeX that the spans index
 * into is the input itself.
 */
function reports(text: string, strict = false): string[] {
  const ce = new ComputeEngine();
  const e = ce.parse(text, { strict, diagnostics: true });
  return (e.parseDiagnostics ?? [])
    .filter((d) => CODES.has(d.code))
    .map((d) => `${d.code}: ${text.slice(d.start, d.end)}`);
}

function rawParse(text: string, diagnostics: boolean): unknown {
  const ce = new ComputeEngine();
  return ce.parse(text, { strict: false, form: 'raw', diagnostics }).json;
}

// Each input with the diagnostics it reports, as `code: spanned text`.
const REPORTED: [string, string[]][] = [
  // ambiguous-equation-number
  ['y = x^2 (2)', ['ambiguous-equation-number: (2)']],
  ['y = 2x + 1 (4)', ['ambiguous-equation-number: (4)']],
  ['x^2 + y^2 = 1 (5)', ['ambiguous-equation-number: (5)']],
  ['y = x^2 + 1 (1.2)', ['ambiguous-equation-number: (1.2)']],
  ['x = 4 (m)', ['ambiguous-equation-number: (m)']],
  ['y = 2 (i)', ['ambiguous-equation-number: (i)']],
  ['g(t) = 3 (1)', ['ambiguous-equation-number: (1)']],

  // ambiguous-group-product
  ['(x)(1,2)', ['ambiguous-group-product: (x)(1,2)']],
  ['(t)(cos t, sin t)', ['ambiguous-group-product: (t)(cos t, sin t)']],
  ['(θ)(1,2)', ['ambiguous-group-product: (θ)(1,2)']],
  ['(alpha)(1,2)', ['ambiguous-group-product: (alpha)(1,2)']],
  ['((x))(1,2)', ['ambiguous-group-product: ((x))(1,2)']],
  ['(x_1)(1,2)', ['ambiguous-group-product: (x_1)(1,2)']],
  ['y = 2(x)(1,2)', ['ambiguous-group-product: (x)(1,2)']],

  // ambiguous-factorial
  ['5!=120', ['ambiguous-factorial: !=']],
  ['n!=n(n-1)!', ['ambiguous-factorial: !=']],
  ['k!=1', ['ambiguous-factorial: !=']],
  ['5 !=120', ['ambiguous-factorial: !=']],

  // ambiguous-arrow
  ['x <- 2', ['ambiguous-arrow: <-']],
  ['x<-2', ['ambiguous-arrow: <-']],
  ['x <-1', ['ambiguous-arrow: <-']],

  // ambiguous-equal-chain
  ['x = x = x = x', ['ambiguous-equal-chain: = x = x =']],
  ['x = y = 0', ['ambiguous-equal-chain: = y =']],

  // ambiguous-element
  ['y = x in [0,1]', ['ambiguous-element: in']],
  ['y = 2 in x', ['ambiguous-element: in']],
  ['y = x \\in [0,1]', ['ambiguous-element: \\in']],
  ['y = x ∈ [0,1]', ['ambiguous-element: ∈']],

  // ambiguous-range
  ['1..10..2', ['ambiguous-range: ..10..']],
  ['0..1..0.1', ['ambiguous-range: ..1..']],
  // The trailing-noise recovery parses `1..3.`: the last `.` counts as the
  // second `..`.
  ['1..3..', ['ambiguous-range: ..3.']],

  // ambiguous-percent
  ['y = 50%', ['ambiguous-percent: 50%']],
  ['0.5 %', ['ambiguous-percent: 0.5 %']],

  // ambiguous-comma
  ['1,5', ['ambiguous-comma: ,']],
  ['1 , 5', ['ambiguous-comma: ,']],
  ['x = 1, y = 2', ['ambiguous-comma: ,']],

  // ambiguous-list-label
  ['1. y = x', ['ambiguous-list-label: 1.']],
  ['10. 5', ['ambiguous-list-label: 10.']],
  ['1234. y = x', ['ambiguous-list-label: 1234.']],
  ['x = 1. 5', ['ambiguous-list-label: 1.']],
  ['y = 1. -x', ['ambiguous-list-label: 1.']],
  ['(1) y = x', ['ambiguous-list-label: (1)']],
  ['1) y = x', ['ambiguous-list-label: 1)']],
  ['a) y = x', ['ambiguous-list-label: a)']],
  ['1.', ['ambiguous-list-label: 1.']],
  ['(1)', ['ambiguous-list-label: (1)']],
  // A line that is only a letter label from `a` to `h`, or the Roman `v`
  ['(a)', ['ambiguous-list-label: (a)']],
  ['[a]', ['ambiguous-list-label: [a]']],
  ['(v)', ['ambiguous-list-label: (v)']],
  ['(12)', ['ambiguous-list-label: (12)']],
  ['(i)', ['ambiguous-list-label: (i)']],
  ['(iv)', ['ambiguous-list-label: (iv)']],
  ['[1]', ['ambiguous-list-label: [1]']],
  ['(a) y = x', ['ambiguous-list-label: (a)']],
  ['(ii) y = x', ['ambiguous-list-label: (ii)']],

  // ambiguous-number-notation
  ['1_000', ['ambiguous-number-notation: 1_000']],
  ['1_000_000', ['ambiguous-number-notation: 1_000_000']],
  ['0x10', ['ambiguous-number-notation: 0x10']],
  ['y = 0xff', ['ambiguous-number-notation: 0xff']],

  // ambiguous-date
  ['2026-10-15', ['ambiguous-date: 2026-10-15']],
  ['2026-9-30', ['ambiguous-date: 2026-9-30']],
  ['9/30/2026', ['ambiguous-date: 9/30/2026']],
  ['555-1234', ['ambiguous-date: 555-1234']],
  ['555-0123', ['ambiguous-date: 555-0123']],
  ['1-800-555-1234', ['ambiguous-date: 1-800-555-1234']],
  ['7-11', ['ambiguous-date: 7-11']],
  ['10-20', ['ambiguous-date: 10-20']],
  ['1999-2000', ['ambiguous-date: 1999-2000']],
  ['x = 10-20', ['ambiguous-date: 10-20']],
  // Three or more groups next to a parenthesis are still reported
  ['(2026-10-15)', ['ambiguous-date: 2026-10-15']],
  ['x = (1-800-555-1234)', ['ambiguous-date: 1-800-555-1234']],
];

// Ordinary math, and the inputs that the design lists as having one common
// reading: none of this file's codes is reported.
const NOT_REPORTED = [
  '3/4',
  '24/7',
  '2-1',
  '2 - 1',
  '100-20',
  '10-20x',
  '2^10-20',
  'y = x^2-1',
  'x = 2',
  'x = 5.',
  '1..10',
  '1...10',
  '[0,1]',
  'f(x, y)',
  '(1, 2)',
  '\\{1, 2\\}',
  '\\text{a, b}',
  '\\text{5!=120}',
  'x^2 + y^2 = 1',
  'y = 2x + 1',
  '0 < x < 1',
  'x < -2',
  'x <= y',
  'a = b',
  'x != y',
  '5! = 120',
  '2.5',
  'y = 3.5 x',
  'x in [0,1]',
  'x \\in [0,1]',
  'M in [0,1]',
  '(a)(b)',
  '(k)(x-1)',
  'y = (m)(x) + b',
  '(x)(y)',
  '(x+1)(1,2)',
  '2 (x+1)',
  '(x+1) (x-1)',
  'sin (2)',
  'y = (2)',
  'y = x^2 + 1',
  'x_1 = 2',
  'x^{1_000}',
  '(1) + 2',
  // A line that is only `(x)` is a variable, not a label
  '(x)',
  // A letter label that is followed by more is one of `a` to `h`
  '(x) y = x',
  'z) y = x',
  // Two digit groups in parentheses are a difference
  'x = (1-10)',
  '(10-20)',
];

describe('lenient ambiguity codes: reported', () => {
  test.each(REPORTED)('%s', (text, expected) => {
    expect(reports(text)).toEqual(expected);
  });
});

describe('lenient ambiguity codes: not reported', () => {
  test.each(NOT_REPORTED)('%s', (text) => {
    expect(reports(text)).toEqual([]);
  });
});

describe('lenient ambiguity codes: the reading does not change', () => {
  test.each(REPORTED.map(([text]) => text))('%s', (text) => {
    expect(rawParse(text, true)).toEqual(rawParse(text, false));
  });

  test('the readings', () => {
    expect(rawParse('5!=120', true)).toEqual(['NotEqual', 5, 120]);
    expect(rawParse('x <- 2', true)).toEqual(['Less', 'x', ['Negate', 2]]);
    expect(rawParse('y = 50%', true)).toEqual(['Equal', 'y', 50]);
    expect(rawParse('y = x in [0,1]', true)).toEqual([
      'Element',
      ['Equal', 'y', 'x'],
      ['Interval', 0, 1],
    ]);
    expect(rawParse('1,5', true)).toEqual([
      'Delimiter',
      ['Sequence', 1, 5],
      "','",
    ]);
    expect(rawParse('7-11', true)).toEqual(['Subtract', 7, 11]);
    expect(rawParse('x = 4 (m)', true)).toEqual([
      'Equal',
      'x',
      ['InvisibleOperator', 4, ['Delimiter', 'm']],
    ]);
  });
});

describe('lenient ambiguity codes: strict mode', () => {
  test.each(REPORTED.map(([text]) => text))('%s reports none', (text) => {
    expect(reports(text, true)).toEqual([]);
  });
});

describe('lenient ambiguity codes: details', () => {
  test('ambiguous-number-notation names the notation', () => {
    const ce = new ComputeEngine();
    const detail = (text: string) =>
      ce
        .parse(text, { strict: false, diagnostics: true })
        .parseDiagnostics?.find((d) => d.code === 'ambiguous-number-notation')
        ?.detail;
    expect(detail('1_000')).toEqual({ notation: 'digit-grouping' });
    expect(detail('0x10')).toEqual({ notation: 'hexadecimal' });
  });

  test('a LaTeX spacing command before an equation number', () => {
    // The span is in normalized LaTeX, where no space follows `\quad`.
    const ce = new ComputeEngine();
    const ds = ce
      .parse('y = x \\quad (2)', { strict: false, diagnostics: true })
      .parseDiagnostics?.filter((d) => d.code === 'ambiguous-equation-number');
    expect(ds).toEqual([
      { code: 'ambiguous-equation-number', start: 11, end: 14 },
    ]);
  });

  test('ambiguous-percent is reported with comment-discarded', () => {
    const ce = new ComputeEngine();
    const codes = ce
      .parse('y = 50%', { strict: false, diagnostics: true })
      .parseDiagnostics?.map((d) => d.code);
    expect(codes).toContain('comment-discarded');
    expect(codes).toContain('ambiguous-percent');
  });
});
