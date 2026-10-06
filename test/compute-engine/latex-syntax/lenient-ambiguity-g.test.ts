import { ComputeEngine } from '../../../src/compute-engine';
import type { ParseDiagnostic } from '../../../src/compute-engine';

/**
 * The lenient grammar reports each reading choice that has a second common
 * reading with a parse diagnostic whose code starts with `ambiguous-`. These
 * tests cover the inputs that a host reported as read with no such code: a
 * number or a name after another factor, the end of an exponent, of a
 * radical, of a subscript or of a function argument, a `!` next to an
 * exponent or a radical, and names (`ii`, `min`, `_`).
 *
 * Each case is read on a new engine, as a host does. The reading does not
 * change, and the strict grammar reports none of these codes.
 *
 * Design: `docs/plans/2026-10-01-lenient-ambiguity-codes.md` (section 5).
 */

function lenient(input: string): {
  json: string;
  codes: string[];
  diagnostics: ReadonlyArray<ParseDiagnostic>;
} {
  const e = new ComputeEngine().parse(input, {
    strict: false,
    form: 'raw',
    diagnostics: true,
  });
  const diagnostics = (e.parseDiagnostics ?? []).filter((d) =>
    d.code.startsWith('ambiguous-')
  );
  return {
    json: JSON.stringify(e.json),
    codes: diagnostics.map((d) => d.code),
    diagnostics,
  };
}

/** The raw parse without diagnostics */
function reading(input: string): string {
  return JSON.stringify(
    new ComputeEngine().parse(input, { strict: false, form: 'raw' }).json
  );
}

function strictCodes(input: string): string[] {
  const e = new ComputeEngine().parse(input, {
    form: 'raw',
    diagnostics: true,
  });
  return (e.parseDiagnostics ?? [])
    .map((d) => d.code)
    .filter((c) => c.startsWith('ambiguous-'));
}

/** The text of the span of the first diagnostic with `code` */
function span(input: string, code: string): string {
  const d = lenient(input).diagnostics.find((x) => x.code === code)!;
  return input.slice(d.start, d.end);
}

/** Each input reports `code` exactly once, keeps its reading, and the strict
 * grammar does not report it. */
function expectReported(code: string, inputs: [string, string][]): void {
  for (const [input, json] of inputs) {
    test(`${input} reports ${code}`, () => {
      const result = lenient(input);
      expect(result.codes.filter((c) => c === code)).toEqual([code]);
      expect(result.json).toBe(json);
      expect(result.json).toBe(reading(input));
      expect(strictCodes(input)).toEqual([]);
    });
  }
}

function expectNotReported(code: string, inputs: string[]): void {
  for (const input of inputs) {
    test(`${input} does not report ${code}`, () => {
      expect(lenient(input).codes).not.toContain(code);
    });
  }
}

describe('a number or a name after another factor', () => {
  expectReported('ambiguous-name-then-number', [
    ['xy 0.5', '["InvisibleOperator","x","y",0.5]'],
    ['∞2', '["InvisibleOperator","PositiveInfinity",2]'],
  ]);
  expectNotReported('ambiguous-name-then-number', [
    'x0.5',
    '2∞',
    '∞ + 2',
    // LaTeX: the command `\infty` is not reported
    '\\infty2',
    // A function name of the lenient grammar is a word
    '7 mod 3',
    // The continuation glyph is not a name
    'x…2',
  ]);
  test('the span and the detail of a letter run', () => {
    expect(span('xy 0.5', 'ambiguous-name-then-number')).toBe('xy 0.5');
    expect(
      lenient('xy 0.5').diagnostics.find(
        (d) => d.code === 'ambiguous-name-then-number'
      )!.detail
    ).toEqual({ name: 'xy' });
    // Unchanged for one letter
    expect(span('x 0.5', 'ambiguous-name-then-number')).toBe('x 0.5');
  });

  expectReported('ambiguous-implicit-subscript', [
    ['M_max0.5', '["InvisibleOperator","M_max",0.5]'],
    ['x_a2', '["InvisibleOperator","x_a",2]'],
  ]);
  expectNotReported('ambiguous-implicit-subscript', [
    'M_{max}0.5',
    'M_max',
    'x_12',
    // Two letters before a digit: the second letter is a new symbol
    'a_nx',
  ]);
  test('the span of a subscript then a number', () => {
    expect(span('M_max0.5', 'ambiguous-implicit-subscript')).toBe('_max0.5');
  });

  expectReported('ambiguous-delta', [
    ['-Δα', '["InvisibleOperator",["Negate","Delta"],"alpha"]'],
    ['-Δx', '["InvisibleOperator",["Negate","Delta"],"x"]'],
  ]);
  expectNotReported('ambiguous-delta', ['Δ', '-Δ', 'Δ + α']);
});

describe('the end of an exponent', () => {
  test('x^xy reports ambiguous-exponent-end and the letter run', () => {
    const result = lenient('x^xy');
    expect(result.codes.sort()).toEqual([
      'ambiguous-exponent-end',
      'ambiguous-letter-run',
    ]);
    expect(result.json).toBe('["InvisibleOperator",["Power","x","x"],"y"]');
    expect(span('x^xy', 'ambiguous-exponent-end')).toBe('x^xy');
    expect(strictCodes('x^xy')).toEqual([]);
  });

  expectReported('ambiguous-exponent-end', [
    [
      'e^-x sin x',
      '["InvisibleOperator",["Power","e",["Negate","x"]],["Sin","x"]]',
    ],
    ['e^xy', '["InvisibleOperator",["Power","e","x"],"y"]'],
  ]);
  expectNotReported('ambiguous-exponent-end', [
    'x^2 y',
    'x^{x}y',
    // An exponent that is not signed, then a function name, is reported
    // (see `lenient-ambiguity-h.test.ts`); a braced exponent is not
    'e^{-x} sin x',
  ]);
});

describe('a factorial next to an exponent or a radical', () => {
  expectReported('ambiguous-factorial', [
    ['M³!', '["Factorial",["Power","M",3]]'],
    ['2^-k!', '["Factorial",["Power",2,["Negate","k"]]]'],
    ['√i!', '["Factorial",["Sqrt","i"]]'],
    ['n!²', '["Power",["Factorial","n"],2]'],
    ['x^2!', '["Factorial",["Power","x",2]]'],
  ]);
  expectNotReported('ambiguous-factorial', [
    'n!',
    'n!!',
    '5! = 120',
    '(M^3)!',
    '(M³)!',
    '√(i)!',
    '\\sqrt{i}!',
    'M^{n}!',
    '(n!)^2',
    '(n!)²',
  ]);
  test('the spans', () => {
    expect(span('2^-k!', 'ambiguous-factorial')).toBe('2^-k!');
    expect(span('√i!', 'ambiguous-factorial')).toBe('√i!');
    expect(span('(n+1)!^2', 'ambiguous-factorial')).toBe('(n+1)!^2');
    expect(span('10!^2', 'ambiguous-factorial')).toBe('10!^2');
    // `5!=120` keeps its own report
    expect(lenient('5!=120').codes).toEqual(['ambiguous-factorial']);
  });
});

describe('the end of a radical', () => {
  expectReported('ambiguous-radical', [
    ['√a b', '["InvisibleOperator",["Sqrt","a"],"b"]'],
    ['√2 x', '["InvisibleOperator",["Sqrt",2],"x"]'],
    ['t√y', '["InvisibleOperator","t",["Sqrt","y"]]'],
    ['2√x', '["InvisibleOperator",2,["Sqrt","x"]]'],
  ]);
  // An operand before the glyph that is not a Latin letter or a digit
  // written directly before it is a factor, not a root index: a Greek
  // letter, a group, an absolute value, or a digit then white space
  expectNotReported('ambiguous-radical', [
    '\\sqrt{a}b',
    '\\sqrt{a} b',
    '√{a} b',
    '√(a) b',
    '√x sin x',
    '√x dx',
    't √y',
    '2 √x',
    'θ√y',
    '(x)√y',
    '|x|√y',
    'π√2',
    '√a',
    'sin√x',
    'ln√x',
    '√x√y',
  ]);
  test('the span', () => {
    expect(span('√a b', 'ambiguous-radical')).toBe('√a b');
  });
});

describe('the end of a function argument', () => {
  expectReported('ambiguous-function-argument', [
    ['sin2e^a', '["Sin",["InvisibleOperator",2,["Power","e","a"]]]'],
    ['y = min', '["Equal","y","min"]'],
    ['sin*x', '["Multiply","sin","x"]'],
  ]);
  expectNotReported('ambiguous-function-argument', [
    'sin(2)e^a',
    'sin 2x',
    'sin2x',
    'sin e^x',
    'min(a,b)',
    'y = min(x, 1)',
    'sin x',
    "sin'(x)",
    'sin\\prime(x)',
  ]);

  // A prime after a function name with no backslash is the derivative of the
  // function, in each spelling of the prime. `sin\prime(x)` was read as
  // `Sin` of an `unexpected-command` error.
  test.each([
    ["sin'(x)", '["Apply",["Derivative","sin",1],"x"]'],
    ['sin\\prime(x)', '["Apply",["Derivative","sin",1],"x"]'],
    ['sin\\doubleprime(x)', '["Apply",["Derivative","sin",2],"x"]'],
  ])('%s is a derivative', (input, expected) => {
    expect(lenient(input).json).toBe(expected);
  });
});

describe('names', () => {
  expectReported('ambiguous-missing-base', [
    ['-_1', '["InvisibleOperator",["Negate","_"],1]'],
  ]);
  expectNotReported('ambiguous-missing-base', ['x_1', 'x_{1}', '-x_1', 'x _1']);
  test('the span', () => {
    expect(span('-_1', 'ambiguous-missing-base')).toBe('_1');
  });

  expectReported('ambiguous-constant-name', [['ii', '"ImaginaryUnit"']]);
  expectNotReported('ambiguous-constant-name', ['i', 'i + 1', '2i']);
  test('the detail of ii', () => {
    expect(lenient('ii').diagnostics[0].detail).toEqual({
      name: 'ImaginaryUnit',
    });
  });

  expectReported('ambiguous-implicit-subscript', [
    ['A_maxsin t', '["InvisibleOperator","A_maxsin","t"]'],
  ]);
  expectNotReported('ambiguous-implicit-subscript', [
    'A_max sin t',
    'A_{maxsin} t',
    'v_sin',
  ]);
  test('the detail of a function name at the end of a subscript', () => {
    expect(
      lenient('A_maxsin t').diagnostics.find(
        (d) => d.code === 'ambiguous-implicit-subscript'
      )!.detail
    ).toEqual({ base: 'A', subscript: 'maxsin', function: 'sin' });
  });
});
