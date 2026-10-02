import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Two reading choices of the lenient grammar that have a second common
 * reading, reported by a host after the first round of `ambiguous-*` codes:
 * `sin^-1(x)` (the inverse function, or the reciprocal `1/sin(x)`), and a
 * range with one `..` next to an operation (`1..5/2`: the range from 1 to
 * 5/2, or the whole range divided by 2). The reading does not change, and
 * the strict grammar reports nothing.
 */

function codes(text: string, strict = false): string[] {
  const ce = new ComputeEngine();
  const e = ce.parse(text, { strict, diagnostics: true });
  return (e.parseDiagnostics ?? [])
    .map((d) => d.code)
    .filter((c) => c.startsWith('ambiguous-'));
}

function raw(text: string, diagnostics: boolean): unknown {
  const ce = new ComputeEngine();
  return ce.parse(text, { strict: false, form: 'raw', diagnostics }).json;
}

describe('ambiguous-inverse-function', () => {
  test.each(['sin^-1(x)', 'cos^-1(x)', 'tan^-1(y/x)', 'sin^-1 1'])(
    '%s is reported',
    (text) => {
      expect(codes(text)).toContain('ambiguous-inverse-function');
      expect(raw(text, true)).toEqual(raw(text, false));
    }
  );

  test('the reading is the inverse function', () => {
    expect(raw('sin^-1(x)', false)).toEqual([
      'Apply',
      ['InverseFunction', 'Sin'],
      'x',
    ]);
  });

  test.each(['sin^2(x)', 'arcsin(x)', 'sin(x)^-1', '\\sin^{-1}(x)'])(
    '%s is not reported',
    (text) => expect(codes(text)).not.toContain('ambiguous-inverse-function')
  );

  test('strict mode reports nothing', () => {
    expect(codes('\\sin^{-1}(x)', true)).toEqual([]);
  });

  test('onAmbiguity error replaces the call', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('sin^-1(x)', { strict: false, onAmbiguity: 'error' }).json
    ).toEqual([
      'Error',
      "'ambiguous-inverse-function'",
      ['LatexString', "'sin^-1(x)'"],
    ]);
  });
});

describe('ambiguous-range next to an operation', () => {
  test.each(['1..5/2', '1..n+1', '2*1..5', 'x+1..5', 'y = 2*1..5'])(
    '%s is reported',
    (text) => {
      expect(codes(text)).toContain('ambiguous-range');
      expect(raw(text, true)).toEqual(raw(text, false));
    }
  );

  test.each(['1..10', '-1..5', '1..-5', '-2..-1', 'a..b', 'x in [0..1]'])(
    '%s is not reported',
    (text) => expect(codes(text)).not.toContain('ambiguous-range')
  );
});
