import { ComputeEngine } from '../../../src/compute-engine';

/**
 * The lenient grammar reports a reading choice that has a second common
 * reading with a parse diagnostic whose code starts with `ambiguous-`. The
 * reading itself does not change, and the strict grammar reports none of
 * these codes. Design: `docs/plans/2026-10-01-lenient-ambiguity-codes.md`.
 *
 * This file covers `ambiguous-log-base`, `ambiguous-engine-operator`,
 * `ambiguous-interval`, and the reading of a library constant followed by a
 * parenthesized group as the left side of `=` (`ambiguous-constant-name`).
 */

const CODES = new Set([
  'ambiguous-log-base',
  'ambiguous-engine-operator',
  'ambiguous-interval',
  'ambiguous-constant-name',
]);

/**
 * The diagnostics of this file's codes for `text`, as `code: spanned text`.
 * The inputs are plain text, so the normalized LaTeX that the spans index
 * into is the input itself (except for the LaTeX inputs, whose normalized
 * form is also the input).
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
  // ambiguous-log-base
  ['log(x, 2)', ['ambiguous-log-base: log(x, 2)']],
  ['log(2, x)', ['ambiguous-log-base: log(2, x)']],
  ['log(2,x)', ['ambiguous-log-base: log(2,x)']],
  ['y = log(x, 10) + 1', ['ambiguous-log-base: log(x, 10)']],
  ['lg(x)', ['ambiguous-log-base: lg(x)']],
  ['lg x', ['ambiguous-log-base: lg x']],
  ['y = 2 lg(8)', ['ambiguous-log-base: lg(8)']],

  // ambiguous-engine-operator
  ['N(x)', ['ambiguous-engine-operator: N(x)']],
  ['D(x)', ['ambiguous-engine-operator: D(x)']],
  ['D(x^2, x)', ['ambiguous-engine-operator: D(x^2, x)']],
  ['y = N(t) + 1', ['ambiguous-engine-operator: N(t)']],

  // ambiguous-interval
  ['M in [0,1]^2', ['ambiguous-interval: [0,1]^2']],
  ['M in [0,1] + 1', ['ambiguous-interval: [0,1] +']],
  ['M in [0,1]/2', ['ambiguous-interval: [0,1]/2']],
  ['M in [0, 1] * 2', ['ambiguous-interval: [0, 1] *']],
  ['M in (0,1)^2', ['ambiguous-interval: (0,1)^2']],
  ['x in [0,1]^2', ['ambiguous-interval: [0,1]^2']],
  ['M in [0..1]^2', ['ambiguous-interval: [0..1]^2']],
  ['x ∈ [0,1]^2', ['ambiguous-interval: [0,1]^2']],

  // ambiguous-constant-name
  ['pi(x) = x', ['ambiguous-constant-name: pi(x)']],
  ['e(t) = t^2', ['ambiguous-constant-name: e(t)']],
  ['i(t) = 2', ['ambiguous-constant-name: i(t)']],
  ['π(x) = x + 1', ['ambiguous-constant-name: π(x)']],
];

// Ordinary math, and the inputs that have one common reading: none of this
// file's codes is reported.
const NOT_REPORTED = [
  // ambiguous-log-base
  'log(x)',
  'log(8)',
  'log_2(x)',
  'log2(x)',
  'log10(x)',
  'ln(x)',
  'lb(x)',
  'log x',
  '\\lg(x)',
  '\\log(x, 2)',
  // ambiguous-engine-operator
  'sin(x)',
  'sqrt(x)',
  'f(x)',
  'g(x, y)',
  'H(x)',
  'P(x)',
  'mod(x,2)',
  'gcd(a,b)',
  'lcm(a,b)',
  'Re(x)',
  'Im(z)',
  'exp(x)',
  'abs(x)',
  'min(a,b)',
  'max(a,b)',
  'N',
  'D',
  'N = 5',
  '\\operatorname{N}(x)',
  '\\operatorname{D}(x^2, x)',
  // ambiguous-interval
  'M in [0,1]',
  'x in [0,1)',
  'x in (0, inf)',
  'x in (0,1)',
  'M in [0..1]',
  'x in [0,1) ^2',
  'x in [0,1,2]^2',
  'x in [0,1] \\cup [2,3]',
  '[0,1]^2',
  'x = [0,1]^2',
  // ambiguous-constant-name
  'f(pi) = 3',
  'pi(x)',
  '2pi(x) = 3',
  'y = pi(x)',
  'f(x) = x',
  // The `=` of an index or a limit is not at the top level of the line
  '\\sum_{i=1}^n i',
  '\\prod_{i=1}^n i^2',
  'sum_(i=1)^n i',
  '\\sum_{e=1}^n e',
  'f(pi = 3)',
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
    expect(rawParse('log(x, 2)', true)).toEqual(['Log', 'x', 2]);
    expect(rawParse('log(2, x)', true)).toEqual(['Log', 2, 'x']);
    expect(rawParse('lg(x)', true)).toEqual(['Lg', 'x']);
    expect(rawParse('N(x)', true)).toEqual(['N', 'x']);
    expect(rawParse('D(x)', true)).toEqual(['D', 'x']);
    expect(rawParse('M in [0,1]^2', true)).toEqual([
      'Element',
      'M',
      ['Power', ['List', 0, 1], 2],
    ]);
    expect(rawParse('M in (0,1)^2', true)).toEqual([
      'Element',
      'M',
      ['Power', ['Delimiter', ['Sequence', 0, 1], "'(,)'"], 2],
    ]);
    expect(rawParse('M in [0..1]^2', true)).toEqual([
      'Element',
      'M',
      ['Power', ['Range', 0, 1], 2],
    ]);
    expect(rawParse('M in [0,1]', true)).toEqual([
      'Element',
      'M',
      ['Interval', 0, 1],
    ]);
    expect(rawParse('pi(x) = x', true)).toEqual([
      'Equal',
      ['InvisibleOperator', 'Pi', ['Delimiter', 'x']],
      'x',
    ]);
  });
});

describe('lenient ambiguity codes: strict mode', () => {
  test.each(REPORTED.map(([text]) => text))('%s reports none', (text) => {
    expect(reports(text, true)).toEqual([]);
  });
});

describe('lenient ambiguity codes: details', () => {
  const detail = (text: string, code: string) => {
    const ce = new ComputeEngine();
    return ce
      .parse(text, { strict: false, diagnostics: true })
      .parseDiagnostics?.find((d) => d.code === code)?.detail;
  };

  test('ambiguous-log-base names the function', () => {
    expect(detail('log(x, 2)', 'ambiguous-log-base')).toEqual({
      name: 'log',
    });
    expect(detail('lg(x)', 'ambiguous-log-base')).toEqual({ name: 'lg' });
  });

  test('ambiguous-engine-operator names the operator', () => {
    expect(detail('N(x)', 'ambiguous-engine-operator')).toEqual({
      name: 'N',
    });
    expect(detail('D(x)', 'ambiguous-engine-operator')).toEqual({
      name: 'D',
    });
  });

  test('ambiguous-constant-name names the constant', () => {
    expect(detail('pi(x) = x', 'ambiguous-constant-name')).toEqual({
      name: 'Pi',
    });
    expect(detail('e(t) = t^2', 'ambiguous-constant-name')).toEqual({
      name: 'e',
    });
  });

  test('ambiguous-interval after the LaTeX commands `\\in` and `\\notin`', () => {
    // The normalized LaTeX of these inputs is not the input, so the test
    // checks the code and not the spanned text.
    const codes = (text: string) =>
      new ComputeEngine()
        .parse(text, { strict: false, diagnostics: true })
        .parseDiagnostics?.map((d) => d.code);
    expect(codes('x \\in [0,1]^2')).toContain('ambiguous-interval');
    expect(codes('x \\notin [0,1]^2')).toContain('ambiguous-interval');
    expect(codes('x \\in \\left[0,1\\right]^2')).toContain(
      'ambiguous-interval'
    );
    expect(codes('x \\in [0,1]')).not.toContain('ambiguous-interval');
  });

  test('N(x) in the scope of a quantifier is a predicate, not reported', () => {
    expect(reports('\\forall x, N(x)')).toEqual([]);
  });

  test('onAmbiguity: error keeps the body of a big operator whose index is a constant name', () => {
    const ce = new ComputeEngine();
    const raw = (text: string) =>
      ce.parse(text, { strict: false, form: 'raw', onAmbiguity: 'error' }).json;
    expect(raw('\\sum_{i=1}^n i')).toEqual([
      'Sum',
      'i',
      ['Tuple', 'i', 1, 'n'],
    ]);
    expect(raw('\\prod_{i=1}^n i^2')).toEqual([
      'Product',
      ['Power', 'i', 2],
      ['Tuple', 'i', 1, 'n'],
    ]);
  });

  test('onAmbiguity: error replaces the expression that holds the span', () => {
    const ce = new ComputeEngine();
    for (const text of ['log(x, 2)', 'N(x)', 'M in [0,1]^2', 'pi(x) = x']) {
      const json = JSON.stringify(
        ce.parse(text, { strict: false, form: 'raw', onAmbiguity: 'error' })
          .json
      );
      expect(json).toContain("'ambiguous-");
    }
  });
});
