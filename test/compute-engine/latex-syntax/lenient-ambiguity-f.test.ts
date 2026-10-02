import { ComputeEngine } from '../../../src/compute-engine';

/**
 * Plain-text inputs that the lenient grammar read with no signal, or read
 * differently from an equal spelling (Tycho ledger row 358):
 *
 * - `**` is read as `^`: `-e**θ` is `-(e^θ)`, and a `^` after a `**`
 *   exponent is a second superscript (an error), as `x^y^z` is. A chain of
 *   `**` alone is read from the right: `2**3**2` is `2^(3^2)`.
 * - White space after `^`, and after the `-` of a signed exponent on a
 *   letter, does not change the reading: `x ^ pi` is `x^pi`, `e^- x` is
 *   `e^-x`.
 * - `÷` reports `ambiguous-denominator` as `/` does.
 * - `x^^2` and `x^²` are a second superscript (an error), not `x^2`.
 * - `3 .5` reports `ambiguous-digit-groups`, `.5...5` reports
 *   `ambiguous-range`, `ln+1` reports `ambiguous-function-argument`.
 */

function codes(text: string, strict = false): string[] {
  const ce = new ComputeEngine();
  const e = ce.parse(text, { strict, diagnostics: true });
  return (e.parseDiagnostics ?? [])
    .map((d) => d.code)
    .filter((c) => c.startsWith('ambiguous-'));
}

function raw(text: string, diagnostics = false, strict = false): unknown {
  const ce = new ComputeEngine();
  return ce.parse(text, { strict, form: 'raw', diagnostics }).json;
}

function hasError(text: string): boolean {
  return JSON.stringify(raw(text)).includes('"Error"');
}

describe('`**` reads as `^`', () => {
  test.each([
    ['-e**θ', '-e^θ'],
    ['-x**2', '-x^2'],
    ['x**-2', 'x^-2'],
    ['e**-x', 'e^-x'],
    ['x ** 2', 'x^2'],
    ['x**pi', 'x^pi'],
    ['x**(1/2)', 'x^(1/2)'],
    ['(x+1)**2', '(x+1)^2'],
  ])('%s is read as %s', (text, reference) =>
    expect(raw(text)).toEqual(raw(reference))
  );

  test('-e**θ is the negation of a power', () =>
    expect(raw('-e**θ')).toEqual(['Negate', ['Power', 'e', 'theta']]));

  test('a chain of ** is read from the right', () => {
    expect(raw('2**3**2')).toEqual(['Power', 2, ['Power', 3, 2]]);
    expect(raw('2 ** 3 ** 2')).toEqual(['Power', 2, ['Power', 3, 2]]);
  });

  test('1^x^M is an unexpected-superscript error', () =>
    expect(JSON.stringify(raw('1^x^M'))).toContain("'unexpected-superscript'"));

  test.each(['1**x^M', '1^x**M', 'x^2**3'])(
    '%s is an unexpected-superscript error, as 1^x^M is',
    (text) =>
      expect(JSON.stringify(raw(text))).toContain("'unexpected-superscript'")
  );

  test('a sign after ** applies to the rest of the chain, as in Python', () => {
    expect(raw('2**-3**2')).toEqual(['Power', 2, ['Negate', ['Power', 3, 2]]]);
    expect(raw('2**-x**2')).toEqual([
      'Power',
      2,
      ['Negate', ['Power', 'x', 2]],
    ]);
    expect(raw('2**-3')).toEqual(['Power', 2, -3]);
    expect(raw('-2**2')).toEqual(['Negate', ['Power', 2, 2]]);
  });

  test('x**2y reports ambiguous-exponent-end, as x^2y does', () => {
    expect(codes('x**2y')).toContain('ambiguous-exponent-end');
    expect(raw('x**2y')).toEqual(raw('x^2y'));
  });

  test('x**2 reports nothing', () => expect(codes('x**2')).toEqual([]));
});

describe('white space after `^`', () => {
  test.each([
    ['x ^ pi', 'x^pi'],
    ['x^ pi', 'x^pi'],
    ['x^ -y', 'x^-y'],
    ['e^- x', 'e^-x'],
  ])('%s is read as %s', (text, reference) =>
    expect(raw(text)).toEqual(raw(reference))
  );

  test('x ^ pi is x^π', () =>
    expect(raw('x ^ pi')).toEqual(['Power', 'x', 'Pi']));

  test('e^- x is e^(-x)', () =>
    expect(raw('e^- x')).toEqual(['Power', 'e', ['Negate', 'x']]));

  test('x^pi reports nothing', () => expect(codes('x^pi')).toEqual([]));

  test('a `+` keeps the postfix sign', () =>
    expect(raw('A^+ x')).toEqual([
      'InvisibleOperator',
      ['PseudoInverse', 'A'],
      'x',
    ]));

  test('a base that is not a letter keeps the postfix sign', () => {
    expect(raw('\\R^- x')).toEqual([
      'InvisibleOperator',
      'NegativeNumbers',
      'x',
    ]);
    expect(raw('0^- x')).toEqual(['InvisibleOperator', ['Superminus', 0], 'x']);
  });

  test('the strict grammar keeps its reading', () =>
    expect(raw('e^- x', false, true)).toEqual([
      'InvisibleOperator',
      ['Superminus', 'e'],
      'x',
    ]));
});

describe('ambiguous-denominator after ÷', () => {
  test('13÷2x is reported, as 13/2x is', () => {
    expect(codes('13÷2x')).toContain('ambiguous-denominator');
    expect(codes('13/2x')).toContain('ambiguous-denominator');
    expect(raw('13÷2x', true)).toEqual(raw('13÷2x', false));
    expect(raw('13÷2x')).toEqual(['Divide', 13, ['InvisibleOperator', 2, 'x']]);
  });

  test.each(['13÷2', '13÷x', '13÷f(x)'])('%s is not reported', (text) =>
    expect(codes(text)).not.toContain('ambiguous-denominator')
  );
});

describe('two superscript markers in a row', () => {
  test.each(['x^^2', 'x^²'])('%s is an error', (text) =>
    expect(hasError(text)).toBe(true)
  );

  test.each(['x^2', 'x²', 'x^{2}'])('%s is x^2', (text) =>
    expect(raw(text)).toEqual(['Power', 'x', 2])
  );

  test('a ^^ hexadecimal character is still read', () =>
    expect(raw('x^^41', false, true)).toEqual(['InvisibleOperator', 'x', 'A']));
});

describe('ambiguous-digit-groups before a decimal separator', () => {
  test('3 .5 is reported, and the reading is 3.5', () => {
    expect(codes('3 .5')).toContain('ambiguous-digit-groups');
    expect(raw('3 .5')).toEqual(3.5);
    expect(raw('3 .5', true)).toEqual(raw('3 .5', false));
  });

  test('3 4 .5 is reported once', () =>
    expect(codes('3 4 .5')).toEqual(['ambiguous-digit-groups']));

  test.each(['3.5', '.5', 'x = 3.5'])('%s is not reported', (text) =>
    expect(codes(text)).toEqual([])
  );

  test('the strict grammar reports nothing', () =>
    expect(codes('3 .5', true)).toEqual([]));
});

describe('ambiguous-range for a decimal before `...`', () => {
  test.each(['.5...5', '0.5...5', '-.5...5'])(
    '%s is reported, and the reading is a range',
    (text) => {
      expect(codes(text)).toContain('ambiguous-range');
      expect(raw(text, true)).toEqual(raw(text, false));
    }
  );

  test('.5...5 is the range from 0.5 to 5', () =>
    expect(raw('.5...5')).toEqual(['Range', 0.5, 5]));

  test.each(['1..5', '1...5', '[-9...9]', '0.5..5', '.5... 5'])(
    '%s is not reported',
    (text) => expect(codes(text)).not.toContain('ambiguous-range')
  );

  test('the strict grammar reports nothing', () =>
    expect(codes('.5...5', true)).toEqual([]));
});

describe('ambiguous-function-argument for a `+` after a function name', () => {
  test.each(['ln+1', 'ln +1', 'sin+x'])(
    '%s is reported, and the reading is kept',
    (text) => {
      expect(codes(text)).toContain('ambiguous-function-argument');
      expect(raw(text, true)).toEqual(raw(text, false));
    }
  );

  test('ln+1 is ln(1)', () => expect(raw('ln+1')).toEqual(['Ln', 1]));

  test.each(['ln(x)+1', 'ln x + 1', 'sin -x', 'ln-1'])(
    '%s is not reported',
    (text) => expect(codes(text)).not.toContain('ambiguous-function-argument')
  );
});
