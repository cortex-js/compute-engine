import { ComputeEngine } from '../../../src/compute-engine';
import type { ParseDiagnostic } from '../../../src/compute-engine';

/**
 * The lenient grammar reports each reading choice that has a second common
 * reading with a parse diagnostic whose code starts with `ambiguous-`. These
 * tests cover the inputs of a second host report: variants of the inputs of
 * `lenient-ambiguity-g.test.ts` that were read with no such code. They are a
 * subscript on a function name, a number after a factor that is not a
 * letter, a Greek base, the end of a radical or of an exponent, and text
 * that the parse dropped.
 *
 * Each case is read on a new engine, as a host does. A code does not change
 * the reading, and the strict grammar reports none of these codes. Two
 * readings change, because the parse dropped text: a subscript on a
 * function name other than `log` is kept, and a `^` after a postfix `.5`
 * is not read. Later readings that change for the same reason: a run of
 * digits keeps its digits, the arguments of a logarithm with a base are
 * kept, and an exponent `-1` on a logarithm is the inverse power.
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

function strict(input: string): { json: string; codes: string[] } {
  const e = new ComputeEngine().parse(input, {
    form: 'raw',
    diagnostics: true,
  });
  return {
    json: JSON.stringify(e.json),
    codes: (e.parseDiagnostics ?? [])
      .map((d) => d.code)
      .filter((c) => c.startsWith('ambiguous-')),
  };
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
      expect(strict(input).codes).toEqual([]);
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

describe('a subscript on a function name', () => {
  // On a function name other than `log`, the subscript was dropped:
  // `tan_1x` was `tan(x)`. It is now kept as the strict grammar keeps it:
  // `ln_3(x)` is `Log(x, 3)` as `\ln_3(x)` is, and `tan_1x` is
  // `Apply(Subscript(Tan, 1), x)` as `\tan_1 x` is.
  expectReported('ambiguous-function-subscript', [
    ['tan_1x', '["Apply",["Subscript","Tan",1],"x"]'],
    ['ln_3(x)', '["Log","x",3]'],
    ['sqrt _110theta', '["Apply",["Subscript","Sqrt",110],"theta"]'],
    ['sin_a(x)', '["Apply",["Subscript","Sin","a"],"x"]'],
  ]);
  test('the detail names the function and the subscript', () => {
    const d = lenient('tan_1x').diagnostics.find(
      (x) => x.code === 'ambiguous-function-subscript'
    )!;
    expect(d.detail).toEqual({ name: 'tan', subscript: 1 });
  });
  test('log keeps its base', () => {
    expect(lenient('log_2(8)')).toMatchObject({ json: '["Lb",8]', codes: [] });
    expect(lenient('log_a(x)')).toMatchObject({
      json: '["Log","x","a"]',
      codes: [],
    });
  });
  test('the strict grammar gives the same reading', () => {
    expect(strict('\\tan_1x').json).toBe(lenient('tan_1x').json);
    expect(strict('\\ln_3(x)').json).toBe(lenient('ln_3(x)').json);
  });
});

describe('a number directly after a factor that is not a letter', () => {
  expectReported('ambiguous-letter-decimal', [
    ['√b.5', '["InvisibleOperator",["Sqrt","b"],0.5]'],
    ['e^f.5', '["InvisibleOperator",["Power","e","f"],0.5]'],
    ['(x+1).5', '["InvisibleOperator",["Delimiter",["Add","x",1]],0.5]'],
    ['|x|.5', '["InvisibleOperator",["Abs","x"],0.5]'],
  ]);
  expectNotReported('ambiguous-letter-decimal', [
    'x^2.5',
    '(x+1)0.5',
    '(x+1)*.5',
    '(1,2).x',
  ]);
  // The tokenizer reads `x²` as `x^{2}`: a superscript of digits is
  // reported, braced or not. A superscript of letters keeps the Desmos
  // spelling `t^{i}.4` unreported.
  expectReported('ambiguous-letter-decimal', [
    ['x².5', '["InvisibleOperator",["Power","x",2],0.5]'],
    ['x^{2}.5', '["InvisibleOperator",["Power","x",2],0.5]'],
    [
      '(x+1)².5',
      '["InvisibleOperator",["Power",["Delimiter",["Add","x",1]],2],0.5]',
    ],
  ]);
  expectNotReported('ambiguous-letter-decimal', [
    't^{i}.4',
    '\\left(1-t\\right).9',
  ]);
  test('the detail', () => {
    const d = lenient('(x+1).5').diagnostics[0];
    expect(d.detail).toEqual({});
    expect(span('(x+1).5', 'ambiguous-letter-decimal')).toBe('.5');
    // A symbol keeps its name in the detail
    expect(lenient('x.5').diagnostics[0].detail).toEqual({ name: 'x' });
  });
});

describe('a Greek base', () => {
  expectReported('ambiguous-implicit-subscript', [
    ['Δ_a2', '["InvisibleOperator","Delta_a",2]'],
    ['θ_max0.5', '["InvisibleOperator","theta_max",0.5]'],
  ]);
  expectNotReported('ambiguous-implicit-subscript', ['Δ_a', 'Δ_{a}2', 'θ_12']);
  // A constant base and a group: the same codes
  expectReported('ambiguous-implicit-subscript', [
    ['π_a2', '["InvisibleOperator","Pi_a",2]'],
    ['π_1y', '["InvisibleOperator","Pi_1","y"]'],
    ['(x)_a2', '["InvisibleOperator",["Subscript",["Delimiter","x"],"a"],2]'],
  ]);
  expectNotReported('ambiguous-implicit-subscript', ['π_a', 'π_{a}2', 'π_1']);
  test('the span of a constant base', () => {
    expect(span('π_a2', 'ambiguous-implicit-subscript')).toBe('_a2');
    expect(lenient('π_a2').diagnostics[0].detail).toEqual({
      base: 'Pi',
      subscript: 'a',
    });
  });
  // An unbraced subscript of digits is the whole run of digits, as on a
  // letter base (`x_12`). It was `π_1·2`.
  test.each([
    ['π_12', '"Pi_12"'],
    ['(x)_12', '["Subscript",["Delimiter","x"],12]'],
    ['[1,2,3]_12', '["At",["List",1,2,3],12]'],
  ])('%s takes the whole run of digits', (input, json) => {
    expect(lenient(input)).toMatchObject({ json, codes: [] });
  });
  test('the strict grammar does not change', () => {
    expect(strict('π_12').json).toBe('["InvisibleOperator","Pi_1",2]');
  });
  test('the span and the detail', () => {
    expect(span('Δ_a2', 'ambiguous-implicit-subscript')).toBe('_a2');
    expect(lenient('Δ_a2').diagnostics[0].detail).toEqual({
      base: 'Delta',
      subscript: 'a',
    });
  });
});

describe('the end of a radical', () => {
  expectReported('ambiguous-factorial', [
    ['√i_1!', '["Factorial",["Sqrt","i_1"]]'],
    ['x^a_1!', '["Factorial",["Power","x","a_1"]]'],
  ]);
  expectNotReported('ambiguous-factorial', ['√(i_1)!', 'x_1!', 'a_1!']);

  expectReported('ambiguous-radical', [
    ['√a_1 b', '["InvisibleOperator",["Sqrt","a_1"],"b"]'],
    ['√a_b c', '["InvisibleOperator",["Sqrt","a_b"],"c"]'],
    // A radical or an infinity after a letter radicand and white space is
    // an operand too (`√(x√y)`, `√(x∞)`), as after a number radicand.
    ['√x √y', '["InvisibleOperator",["Sqrt","x"],["Sqrt","y"]]'],
    ['√x ∞', '["InvisibleOperator",["Sqrt","x"],"PositiveInfinity"]'],
  ]);
  expectNotReported('ambiguous-radical', ['√a_1 sin x', '√a_1', '√x√y']);

  // A run of letters read one letter at a time before the glyph
  test('xy√i reports ambiguous-radical and the letter run', () => {
    const result = lenient('xy√i');
    expect(result.codes.sort()).toEqual([
      'ambiguous-letter-run',
      'ambiguous-radical',
    ]);
    expect(result.json).toBe('["InvisibleOperator","x","y",["Sqrt","i"]]');
    expect(span('xy√i', 'ambiguous-radical')).toBe('√i');
    expect(strict('xy√i').codes).toEqual([]);
  });
  expectReported('ambiguous-radical', [
    ['x y√i', '["InvisibleOperator","x","y",["Sqrt","i"]]'],
  ]);
  expectNotReported('ambiguous-radical', [
    'sin√x',
    'tan√x',
    'sqrt√x',
    'pi√2',
    'xpi√2',
    'x_ab√c',
  ]);
});

describe('a number after the radical glyph', () => {
  // The whole number is the radicand, as for `sqrt12`. The TeX reading
  // (one token) differs, so a number of more than one token is reported.
  expectReported('ambiguous-radical', [
    ['√12', '["Sqrt",12]'],
    ['√2.5', '["Sqrt",2.5]'],
    ['√.5', '["Sqrt",0.5]'],
    ['√ 12', '["Sqrt",12]'],
    ['√12x', '["InvisibleOperator",["Sqrt",12],"x"]'],
    ['2√12', '["InvisibleOperator",2,["Sqrt",12]]'],
    ['√1 000', '["InvisibleOperator",["Sqrt",1],0]'],
  ]);
  expectNotReported('ambiguous-radical', ['√2', '√2/3', 'sqrt12']);
  // A number radicand, white space and an operand: `√2 x` is `√2·x`, and a
  // person can mean `√(2x)`, as for `√2x` and `√a b`. A word of two or more
  // letters after the white space is not an operand here. An empty group
  // `{}` before the number is skipped as white space is.
  expectReported('ambiguous-radical', [
    ['√2 x', '["InvisibleOperator",["Sqrt",2],"x"]'],
    ['√2 π', '["InvisibleOperator",["Sqrt",2],"Pi"]'],
    ['√2 \\pi', '["InvisibleOperator",["Sqrt",2],"Pi"]'],
    ['√12 x', '["InvisibleOperator",["Sqrt",12],"x"]'],
    ['√2.5 x', '["InvisibleOperator",["Sqrt",2.5],"x"]'],
    ['√.5 x', '["InvisibleOperator",["Sqrt",0.5],"x"]'],
    ['√ 2 x', '["InvisibleOperator",["Sqrt",2],"x"]'],
    ['√{}2 x', '["InvisibleOperator",["Sqrt",2],"x"]'],
    ['√{}12 x', '["InvisibleOperator",["Sqrt",12],"x"]'],
  ]);
  // A radical or an infinity after the radicand is such an operand too:
  // `√2 √3` is `√2·√3` and `√2 ∞` is `√2·∞`, and a person can mean `√(2√3)`
  // or `√(2∞)` (row 367 of the Tycho ledger). An infinity directly after the
  // radicand (`√2∞`) is reported as `√2x` is. A radical directly after the
  // radicand (`√2√3`) is reported once, by the digit-before-the-glyph rule
  // (`2√3` can be the cube root of 3), with the span `√3`.
  expectReported('ambiguous-radical', [
    ['√2 √3', '["InvisibleOperator",["Sqrt",2],["Sqrt",3]]'],
    ['√2 \\sqrt{3}', '["InvisibleOperator",["Sqrt",2],["Sqrt",3]]'],
    ['√2 √x', '["InvisibleOperator",["Sqrt",2],["Sqrt","x"]]'],
    ['√2 ∞', '["InvisibleOperator",["Sqrt",2],"PositiveInfinity"]'],
    ['√2 \\infty', '["InvisibleOperator",["Sqrt",2],"PositiveInfinity"]'],
    ['√2∞', '["InvisibleOperator",["Sqrt",2],"PositiveInfinity"]'],
    ['√12 √3', '["InvisibleOperator",["Sqrt",12],["Sqrt",3]]'],
    ['√12∞', '["InvisibleOperator",["Sqrt",12],"PositiveInfinity"]'],
    ['√2√3', '["InvisibleOperator",["Sqrt",2],["Sqrt",3]]'],
  ]);
  expectNotReported('ambiguous-radical', [
    '√2 sin x',
    '√2 (x)',
    '√2 + 1',
    '\\sqrt{2} √3',
    '√(2) √3',
  ]);
  test('the number ends the radicand', () => {
    expect(lenient('√1.5.5').json).toBe(
      '["InvisibleOperator",["Sqrt",1.5],0.5]'
    );
    expect(lenient('√1.5.5').codes).toContain('ambiguous-letter-decimal');
    expect(lenient('sqrt12').json).toBe('["Sqrt",12]');
  });
  test('the spans', () => {
    expect(span('√12', 'ambiguous-radical')).toBe('√12');
    expect(span('√12x', 'ambiguous-radical')).toBe('√12x');
    // One report with the wider span, not `√12` and `√12 x`
    expect(spans('√12 x', 'ambiguous-radical')).toEqual(['√12 x']);
    expect(spans('√2 π', 'ambiguous-radical')).toEqual(['√2 π']);
    expect(spans('√12 sin x', 'ambiguous-radical')).toEqual(['√12']);
    // A digit group is reported once, by the number reader
    expect(spans('√1 000', 'ambiguous-radical')).toEqual(['√1 000']);
    expect(spans('√12 000', 'ambiguous-radical')).toEqual(['√12 000']);
    expect(spans('√{}12 x', 'ambiguous-radical')).toEqual(['√{}12 x']);
    // The span holds the following radical and its radicand, or the infinity
    expect(spans('√2 √3', 'ambiguous-radical')).toEqual(['√2 √3']);
    expect(spans('√2 √ 3', 'ambiguous-radical')).toEqual(['√2 √ 3']);
    expect(spans('√2 √(3)', 'ambiguous-radical')).toEqual(['√2 √(3)']);
    // The two-token radicand of the second radical is its own report, as
    // `√1.5` alone is (the TeX reading is `√1·.5`).
    expect(spans('√2 √1.5', 'ambiguous-radical')).toEqual(['√2 √1.5', '√1.5']);
    expect(spans('√2 \\sqrt[3]{8}', 'ambiguous-radical')).toEqual([
      '√2 \\sqrt[3]{8}',
    ]);
    expect(spans('√2 √√3', 'ambiguous-radical')).toEqual(['√2 √√3']);
    expect(spans('√12 √3', 'ambiguous-radical')).toEqual(['√12 √3']);
    expect(spans('√2 ∞', 'ambiguous-radical')).toEqual(['√2 ∞']);
    expect(spans('√2∞', 'ambiguous-radical')).toEqual(['√2∞']);
    expect(spans('√12∞', 'ambiguous-radical')).toEqual(['√12∞']);
    // Directly after a one-digit radicand, the digit-before-the-glyph rule
    // reports the second radical alone; a two-token radicand is reported
    // too, on its own span.
    expect(spans('√2√3', 'ambiguous-radical')).toEqual(['√3']);
    expect(spans('√12√3', 'ambiguous-radical')).toEqual(['√12', '√3']);
  });
  test('the strict grammar keeps the TeX reading', () => {
    expect(strict('\\sqrt12').json).toBe('["InvisibleOperator",["Sqrt",1],2]');
    expect(strict('\\sqrt 12').json).toBe('["InvisibleOperator",["Sqrt",1],2]');
    expect(strict('\\sqrt{12}').json).toBe('["Sqrt",12]');
    expect(strict('√12').json).toBe('["InvisibleOperator",["Sqrt",1],2]');
  });
});

describe('the end of an exponent', () => {
  expectReported('ambiguous-exponent-end', [
    ['e^θ√z', '["InvisibleOperator",["Power","e","theta"],["Sqrt","z"]]'],
    [
      'x^√θ√g',
      '["InvisibleOperator",["Power","x",["Sqrt","theta"]],["Sqrt","g"]]',
    ],
    ['e^x √z', '["InvisibleOperator",["Power","e","x"],["Sqrt","z"]]'],
    ['e^x cos(x)', '["InvisibleOperator",["Power","e","x"],["Cos","x"]]'],
    ['e^x sin x', '["InvisibleOperator",["Power","e","x"],["Sin","x"]]'],
    ['e^2 sin x', '["InvisibleOperator",["Power","e",2],["Sin","x"]]'],
  ]);
  expectNotReported('ambiguous-exponent-end', [
    'x^2 sin x',
    'e^{x} cos(x)',
    'e^(x) cos(x)',
    'e^x*cos(x)',
    'e^x dx',
  ]);
  test('the spans', () => {
    expect(span('e^θ√z', 'ambiguous-exponent-end')).toBe('e^θ√z');
    expect(span('x^√θ√g', 'ambiguous-exponent-end')).toBe('x^√θ√g');
  });
});

describe('a factorial after a function argument and white space', () => {
  expectReported('ambiguous-factorial', [
    ['αtanπ !', '["InvisibleOperator","alpha",["Factorial",["Tan","Pi"]]]'],
    ['tan x !', '["Factorial",["Tan","x"]]'],
    // A number argument: the number reads its digit groups across white
    // space, so the `!` is reached with the white space already consumed
    ['tan 2 !', '["Factorial",["Tan",2]]'],
    ['\\sin x !', '["Factorial",["Sin","x"]]'],
    // Every route that reads an argument without parentheses
    ['\\ln x !', '["Factorial",["Ln","x"]]'],
    ['\\exp x !', '["Factorial",["Exp","x"]]'],
    ['\\operatorname{arctg} x !', '["Factorial",["Arctan","x"]]'],
  ]);
  // An argument in parentheses has a clear end
  expectNotReported('ambiguous-factorial', [
    'tan x!',
    'tan π!',
    'tan 2!',
    'tan x != 0',
    'tan(x)!',
    'tan(x) !',
    '\\sin x!',
    '\\sin(x) !',
    '\\ln(x) !',
  ]);
  test('the span starts at the function name', () => {
    expect(span('\\sin x !', 'ambiguous-factorial')).toBe('\\sin x !');
    expect(span('\\operatorname{arctg} x !', 'ambiguous-factorial')).toBe(
      '\\operatorname{arctg} x !'
    );
  });
  // The `!` applies to the call, so the script before it is not the
  // operand of the `!`: `y^2 !` is not reported as `(y^2)!`
  test('the `!` of a call is not reported as the `!` of a script', () => {
    expect(spans('x^2! + tan y^2 !', 'ambiguous-factorial').sort()).toEqual([
      'tan y^2 !',
      'x^2!',
    ]);
    expect(spans('\\sin y^2 !', 'ambiguous-factorial')).toEqual([
      '\\sin y^2 !',
    ]);
  });
});

describe('a factorial after an exponent or a radicand and white space', () => {
  // White space between the exponent or the radicand and the `!` does not
  // change the reading (`x^2 !` is `(x^2)!`, as `x^2!` is), so the report
  // is the same. Before, `√x !` was read as `√x` followed by a `Factorial`
  // of a `missing` error.
  expectReported('ambiguous-factorial', [
    ['x^2 !', '["Factorial",["Power","x",2]]'],
    ['√x !', '["Factorial",["Sqrt","x"]]'],
    ['2^-k !', '["Factorial",["Power",2,["Negate","k"]]]'],
    ['x^2 ! + 1', '["Add",["Factorial",["Power","x",2]],1]'],
    ['n !^2', '["Power",["Factorial","n"],2]'],
    // More than one white space token (`~` is one)
    ['x^2~~!', '["Factorial",["Power","x",2]]'],
  ]);
  // A parenthesized exponent or radicand has a clear end, as a braced one
  // does; a `!` after an operand that is not a script has one reading
  expectNotReported('ambiguous-factorial', [
    'x^(2)!',
    'e^(-x)!',
    '√(x) !',
    'x^{n} !',
    'n !',
    '(x+1) !',
    'x^2 != 3',
  ]);
  test('the spans', () => {
    expect(span('x^2 !', 'ambiguous-factorial')).toBe('x^2 !');
    expect(span('√x !', 'ambiguous-factorial')).toBe('√x !');
    expect(span('n !^2', 'ambiguous-factorial')).toBe('n !^2');
    // A span that starts after a command starts after the space that
    // separates the command from the letter, not at the space
    expect(span('\\alpha y^2 !', 'ambiguous-factorial')).toBe('y^2 !');
  });
});

describe('a script after a postfix operand', () => {
  // The `^` after `.5` was dropped: `x^g.5^` was read as `(x^g)^{0.5}`, in
  // both grammars. A `^` with no exponent now holds an error.
  test.each(['x^g.5^', 'e^f.5^', 'x^2!^'])('%s holds an error', (input) => {
    expect(lenient(input).json).toContain('"Error"');
    expect(strict(input).json).toContain('"Error"');
  });
  // A script after the postfix applies to the whole result, as `x.5^2` is
  // `(x·0.5)^2`. `x^2!^3` was `(x^2)^{(missing)}·3`.
  test.each([
    ['x^g.5^2', '["Power",["InvisibleOperator",["Power","x","g"],0.5],2]'],
    ['x^2!^3', '["Power",["Factorial",["Power","x",2]],3]'],
    [
      'x^g.5^2!',
      '["Factorial",["Power",["InvisibleOperator",["Power","x","g"],0.5],2]]',
    ],
  ])('%s applies the script to the whole result', (input, json) => {
    expect(lenient(input).json).toBe(json);
    expect(strict(input).json).toBe(json);
  });
  // The scripts after an unknown command apply to its error, and the parse
  // continues after them. Before, `\foo^2 + y` lost `+ y`.
  test('the scripts of an unknown command', () => {
    expect(strict('\\foo^2 + y').json).toBe(
      `["Add",["Power",["Error","'unexpected-command'",["LatexString","'\\\\foo'"]],2],"y"]`
    );
    expect(strict('\\foo_0 + y').json).toBe(
      `["Add",["Subscript",["Error","'unexpected-command'",["LatexString","'\\\\foo'"]],0],"y"]`
    );
  });
  test('a subscript after the postfix keeps its reading', () => {
    expect(lenient('x^g.5_2').json).toBe(
      '["Subscript",["InvisibleOperator",["Power","x","g"],0.5],2]'
    );
  });
  test('a script read with its base is unchanged', () => {
    expect(lenient('x^2').json).toBe('["Power","x",2]');
    expect(lenient('x_1^2').json).toBe('["Power","x_1",2]');
    expect(lenient('x.5^2').json).toBe(
      '["Power",["InvisibleOperator","x",0.5],2]'
    );
  });
});

describe('a number with a base subscript as a function argument', () => {
  // The digits follow the letters of a function name with no parentheses.
  expectReported('ambiguous-number-notation', [
    ['min3_12', '["Min",["BaseForm",3,12]]'],
    ['sin2_8', '["Sin",["BaseForm",2,8]]'],
    ['ln10_2', '["Ln",["BaseForm",2,2]]'],
  ]);
  // After another letter the digits are a subscript of the letter
  expectNotReported('ambiguous-number-notation', ['x2_1', 'a1_000']);
});

describe('Unicode superscripts', () => {
  // A Unicode superscript is read as the braced LaTeX superscript, in both
  // grammars.
  test.each([
    ['x⁻¹', 'x^{-1}'],
    ['x⁻²', 'x^{-2}'],
    ['x⁻ⁿ', 'x^{-n}'],
    ['e⁻ˣ', 'e^{-x}'],
    ['eˣ', 'e^{x}'],
    ['x⁻⁽¹⁾', 'x^{-(1)}'],
    ['x⁽ⁿ⁺¹⁾', 'x^{(n+1)}'],
  ])('%s is read as %s', (input, latex) => {
    expect(lenient(input).json).toBe(lenient(latex).json);
    expect(strict(input).json).toBe(strict(latex).json);
    expect(lenient(input).json).not.toContain('Error');
  });
  test('e⁻ˣ is a power of e', () => {
    expect(strict('e⁻ˣ').json).toBe('["Power","e",["Negate","x"]]');
  });
});

/** The source text of each diagnostic with `code`, in order */
function spans(input: string, code: string): string[] {
  return lenient(input)
    .diagnostics.filter((d) => d.code === code)
    .map((d) => input.slice(d.start, d.end));
}

describe('a run of digits keeps its digits', () => {
  // A run that a JavaScript number cannot hold exactly is a number string
  test.each([
    ['π_123456789012345678901', '"Pi_123456789012345678901"'],
    [
      '(x)_9007199254740993',
      '["Subscript",["Delimiter","x"],{"num":"9007199254740993"}]',
    ],
    [
      'log_12345678901234567890(x)',
      '["Log","x",{"num":"12345678901234567890"}]',
    ],
    [
      'x^123456789012345678901',
      '["Power","x",{"num":"123456789012345678901"}]',
    ],
    ['x123456789012345678901', '"x_123456789012345678901"'],
  ])('%s', (input, json) => {
    expect(lenient(input).json).toBe(json);
  });
  // A subscript of digits that starts with `0` on a base that is not a
  // symbol is the one token `0`, as in the strict grammar, and the reading
  // is reported. A symbol base keeps the text: `x01` is `x_01`, as `x_01`
  // is.
  expectReported('ambiguous-implicit-subscript', [
    ['(x)_01', '["InvisibleOperator",["Subscript",["Delimiter","x"],0],1]'],
    ['[1,2,3]_01', '["InvisibleOperator",["At",["List",1,2,3],0],1]'],
    [
      '(x)^2_01',
      '["InvisibleOperator",["Power",["Subscript",["Delimiter","x"],0],2],1]',
    ],
    ['x01', '"x_01"'],
    ['θ01', '"theta_01"'],
  ]);
  // A constant base keeps the text, as a letter base does, with each
  // spelling and in each order of the scripts: `π_01` is `\pi_01`. It was
  // `π_0·1`.
  test.each([
    ['π_01', '"Pi_01"'],
    ['\\pi_01', '"Pi_01"'],
    ['π^2_01', '["Power","Pi_01",2]'],
    ['π_01^2', '["Power","Pi_01",2]'],
  ])('%s keeps the text of the subscript', (input, json) => {
    expect(lenient(input)).toMatchObject({ json, codes: [] });
  });
  test('the span of a subscript that starts with 0', () => {
    expect(span('(x)_01', 'ambiguous-implicit-subscript')).toBe('_01');
    expect(span('(x)^2_01', 'ambiguous-implicit-subscript')).toBe('_01');
  });
  // The order of the scripts does not change the symbol: `x^2_01` is
  // `x_01^2`, and `x^2_05y` is `x_05^2·y`, as `x_05y` is `x_05·y`.
  test('a letter base keeps the text after a superscript', () => {
    expect(lenient('x^2_01')).toMatchObject({
      json: '["Power","x_01",2]',
      codes: [],
    });
    expect(lenient('x^2_01').json).toBe(lenient('x_01^2').json);
    expect(lenient('x^2_012').json).toBe('["Power","x_012",2]');
  });
  expectReported('ambiguous-implicit-subscript', [
    ['x^2_05y', '["InvisibleOperator",["Power","x_05",2],"y"]'],
    ['x_05y', '["InvisibleOperator","x_05","y"]'],
  ]);
  test('the detail of a letter base after a superscript', () => {
    const detail = (input: string) =>
      lenient(input).diagnostics.find(
        (d) => d.code === 'ambiguous-implicit-subscript'
      )!.detail;
    expect(detail('x^2_05y')).toEqual({ base: 'x', subscript: 5 });
    expect(detail('x^2_05y')).toEqual(detail('x_05y'));
    expect(span('x^2_05y', 'ambiguous-implicit-subscript')).toBe('_05y');
  });
  test('the digit groups of a number are reported once', () => {
    expect(lenient('1_000')).toMatchObject({
      json: '["InvisibleOperator",["Subscript",1,0],0]',
      codes: ['ambiguous-number-notation'],
    });
  });
  test('a function subscript that starts with 0', () => {
    expect(lenient('tan_01x').json).toBe(
      '["Apply",["Subscript","Tan",0],["InvisibleOperator",1,"x"]]'
    );
  });
  test('x_01 and x12 do not change', () => {
    expect(lenient('x_01').json).toBe('"x_01"');
    expect(lenient('x12').json).toBe('["Subscript","x",12]');
    expect(lenient('π_12').json).toBe('"Pi_12"');
  });
});

describe('an inverse exponent on a logarithm', () => {
  // The inverse of a logarithm is a power, as in the strict grammar. A base
  // replaces `e` or 10. With a subscript, the inverse exponent was a
  // reciprocal power: `ln_3^-1(x)` was `Power(Log(x, 3), -1)`.
  expectReported('ambiguous-inverse-function', [
    ['ln_3^-1(x)', '["Power",3,"x"]'],
    ['ln_3^{-1}(x)', '["Power",3,"x"]'],
    ['log_3^-1(x)', '["Power",3,"x"]'],
    ['ln^-1(x)', '["Exp","x"]'],
    ['log^-1(x)', '["Power",10,"x"]'],
  ]);
  test('ln_3^-1(x) also reports the subscript', () => {
    expect(lenient('ln_3^-1(x)').codes.sort()).toEqual([
      'ambiguous-function-subscript',
      'ambiguous-inverse-function',
    ]);
  });
  test('the strict grammar gives the same reading', () => {
    expect(strict('\\ln_3^{-1}(x)').json).toBe(lenient('ln_3^-1(x)').json);
    expect(strict('\\log_3^{-1}(x)').json).toBe(lenient('log_3^-1(x)').json);
    expect(strict('\\ln^{-1}(x)').json).toBe(lenient('ln^-1(x)').json);
    // The base of `\ln` is not dropped: the inverse was `exp(x)`
    expect(strict('\\ln_3^{-1}(x)').json).toBe('["Power",3,"x"]');
  });
  test('the value is the inverse', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('ln_3^-1(2)', { strict: false });
    expect(e.N().re).toBeCloseTo(9);
  });
  // A braced `-1` is the inverse too, as `\sin^{-1}` is: it was a
  // reciprocal power. The tokenizer reads `sin⁻¹` as `sin^{-1}`.
  expectReported('ambiguous-inverse-function', [
    ['sin^{-1}(x)', '["Apply",["InverseFunction","Sin"],"x"]'],
    ['sin⁻¹(x)', '["Apply",["InverseFunction","Sin"],"x"]'],
  ]);
  test('another exponent is a power', () => {
    expect(lenient('ln_3^2(x)').json).toBe('["Power",["Log","x",3],2]');
    expect(lenient('sin^-2(x)').json).toBe('["Power",["Sin","x"],-2]');
  });
  // On a subscripted function other than a logarithm, `-1` is a power, as
  // in the strict grammar (`\sin_2^{-1}(x)`)
  test('sin_2^-1(x) is a reciprocal power', () => {
    const result = lenient('sin_2^-1(x)');
    expect(result.json).toBe(
      '["Power",["Apply",["Subscript","Sin",2],"x"],-1]'
    );
    expect(result.codes).toEqual(['ambiguous-function-subscript']);
    expect(strict('\\sin_2^{-1}(x)').json).toBe(
      '["Power",["Apply",["Subscript","Sin",2],"x"],["Negate",1]]'
    );
  });
});

describe('a subscript on a special function name', () => {
  // The subscript goes on the head of the special form. `nPr` has no head,
  // so the subscript goes on the count.
  expectReported('ambiguous-function-subscript', [
    ['cbrt_2(x)', '["Apply",["Subscript","Root",2],"x",3]'],
    [
      'nPr_2(5,2)',
      '["Subscript",["Multiply",["Binomial",5,2],["Factorial",2]],2]',
    ],
  ]);
  test('cbrt and nPr without a subscript do not change', () => {
    expect(lenient('cbrt(8)').json).toBe('["Root",8,3]');
    expect(lenient('nPr(5,2)').json).toBe(
      '["Multiply",["Binomial",5,2],["Factorial",2]]'
    );
  });
});

describe('the arguments of a logarithm with a base', () => {
  // The arguments after the first are kept, and the canonical form reports
  // them. They were dropped, and `log_10(x, y)` was the logarithm in base
  // `y`.
  test.each([
    ['ln_3(x, y)', '["Log","x",3,"y"]'],
    ['log_3(x, y)', '["Log","x",3,"y"]'],
    ['log_10(x, y)', '["Log","x",10,"y"]'],
  ])('%s keeps y', (input, json) => {
    expect(lenient(input).json).toBe(json);
    const ce = new ComputeEngine();
    expect(ce.parse(input, { strict: false }).toString()).toContain(
      'unexpected-argument'
    );
  });
  test.each([
    ['\\ln_3(x, y)', '["Log","x",3,"y"]'],
    ['\\log_{10}(x, y)', '["Log","x",10,"y"]'],
  ])('strict %s keeps y', (input, json) => {
    expect(strict(input).json).toBe(json);
  });
});

describe('a letter before a radical glyph, for each glyph', () => {
  // Another glyph of the line with a letter before it does not make a
  // function name or a constant a run of letters
  test.each([
    ['n√2 + sin√x', '√x'],
    ['i√3 + pi√2', '√2'],
  ])('%s does not report %s', (input, glyph) => {
    expect(spans(input, 'ambiguous-radical')).not.toContain(glyph);
  });
  test('a run of letters on the same line is reported', () => {
    expect(spans('n√2 + xy√i', 'ambiguous-radical')).toEqual(['√2', '√i']);
  });
});

describe('a number with a base subscript, for each number', () => {
  test.each([
    ['x2_1 + min3_12', ['3_12']],
    ['x2_1 + 1_000', ['1_000']],
    ['x0x1F + 1_000', ['1_000']],
  ])('%s', (input, expected) => {
    expect(spans(input, 'ambiguous-number-notation')).toEqual(expected);
  });
  // The whole run of letters must be a function name
  expectNotReported('ambiguous-number-notation', ['xmin3_12']);
});

describe('the span of a superscript after a factorial of an exponent', () => {
  // The span starts at the base of the exponent. The `!` is also reported
  // as the `!` of `x^2!` is: `x^2!^3` can mean `x^{2!}`.
  test.each([
    ['x^2!^3', ['x^2!^3', 'x^2!']],
    ['x^-2!^3', ['x^-2!^3', 'x^-2!']],
    ['e^{x}!^2', ['e^{x}!^2']],
    ['(x+1)^2!^3', ['(x+1)^2!^3', '^2!']],
    ['n!²', ['n!²']],
  ])('%s', (input, expected) => {
    expect(spans(input, 'ambiguous-factorial')).toEqual(expected);
  });
  test.each(['x²!³', 'x²!³+1'])('%s starts at the base', (input) => {
    const ds = lenient(input).diagnostics.filter(
      (d) => d.code === 'ambiguous-factorial'
    );
    expect(ds.length).toBeGreaterThan(0);
    for (const d of ds) expect(d.start).toBe(0);
  });
});

describe('digit groups after a number radicand', () => {
  // One diagnostic, with the span of the digit groups
  expectReported('ambiguous-radical', [
    ['√12 000', '["InvisibleOperator",["Sqrt",12],0]'],
    ['√2.5 3', '["InvisibleOperator",["Sqrt",2.5],3]'],
  ]);
  test('the spans', () => {
    expect(span('√12 000', 'ambiguous-radical')).toBe('√12 000');
    expect(span('√2.5 3', 'ambiguous-radical')).toBe('√2.5 3');
  });
});

describe('a period after an error', () => {
  // `1.2.3` already holds the error of its first `.`
  expectNotReported('ambiguous-letter-decimal', ['1.5.5', '1.2.3']);
});

describe('a subscript on a base that is not a symbol, in a product', () => {
  // A symbol in parentheses, or a base that canonicalizes to a symbol, is a
  // symbol base: the canonical form is a compound symbol, and a
  // juxtaposition with it is a product. It was a `Tuple`, or a type error
  // in a sum.
  test.each([
    ['(x)_01', '"x_0"'],
    ['(x)_0 y', '["Multiply","x_0","y"]'],
    ['x2_1 + y', '["Add","x_2_1","y"]'],
  ])('%s', (input, json) => {
    const ce = new ComputeEngine();
    expect(JSON.stringify(ce.parse(input, { strict: false }).json)).toBe(json);
  });
  test('xmin3_12 is a product', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('xmin3_12', { strict: false }).operator).toBe('Multiply');
  });
  test('the strict grammar gives the same', () => {
    const ce = new ComputeEngine();
    expect(JSON.stringify(ce.parse('(x)_{0} y').json)).toBe(
      '["Multiply","x_0","y"]'
    );
    expect(JSON.stringify(ce.parse('(x)_0\\cdot y').json)).toBe(
      '["Multiply","x_0","y"]'
    );
  });
  test('a base that is not a symbol keeps its subscript', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('(x+1)_0 y', { strict: false }).toString()).toBe(
      'y * Subscript(x + 1, 0)'
    );
  });
});

describe('a base of log that starts with 0', () => {
  // The base is the `0` of the run, as in the strict grammar. A person never
  // means base 0, so the reading is reported.
  expectReported('ambiguous-function-subscript', [
    ['log_01(x)', '["Log",["InvisibleOperator",1,["Delimiter","x"]],0]'],
    ['log012(x)', '["Log",["InvisibleOperator",12,["Delimiter","x"]],0]'],
  ]);
  test('the detail', () => {
    expect(
      lenient('log_01(x)').diagnostics.find(
        (d) => d.code === 'ambiguous-function-subscript'
      )!.detail
    ).toEqual({ name: 'log', subscript: 0 });
  });
  expectNotReported('ambiguous-function-subscript', [
    'log_0(x)',
    'log0(x)',
    'log_10(x)',
    'log2(8)',
  ]);
});

describe('the base in the detail of a digit subscript', () => {
  test.each([
    ['π_1y', { base: 'Pi', subscript: 1 }],
    ['x^2_1y', { base: 'x', subscript: 1 }],
    ['(x)^2_01', { subscript: 0 }],
    ['(x)_1y', { subscript: 1 }],
  ])('%s', (input, detail) => {
    expect(
      lenient(input).diagnostics.find(
        (d) => d.code === 'ambiguous-implicit-subscript'
      )!.detail
    ).toEqual(detail);
  });
});

describe('the spans after a Unicode superscript or subscript', () => {
  // The tokenizer reads `x²` as `x^{2}`. The spans are measured on the
  // input: `x²! + 1` reported the span `x²! + `, the length of `x^{2}!`.
  test.each([
    ['x²! + 1', ['x²!']],
    ['x²y³! + 1', ['y³!']],
    ['x₁²! + 1', ['²!']],
    // The `1` is a subscript, not the base of the exponent: the span starts
    // at the `^`, as for `x_{1}^{2}!`. It started at the `1`.
    ['x_1^2! + 1', ['^2!']],
    ['x_{1}^{2}! + 1', ['^{2}!']],
  ])('%s', (input, expected) => {
    expect(spans(input, 'ambiguous-factorial')).toEqual(expected);
  });
  test('the span of a symbol after a superscript', () => {
    const e = new ComputeEngine().parse('x²y³! + 1', {
      strict: false,
      diagnostics: true,
    });
    const names = (e.parseDiagnostics ?? [])
      .filter((d) => d.code === 'undeclared-symbol')
      .map((d) => 'x²y³! + 1'.slice(d.start, d.end));
    expect(names).toEqual(['x', 'y']);
  });
  test('the error that replaces an expression holds the input text', () => {
    const e = new ComputeEngine().parse('x²! + 1', {
      strict: false,
      form: 'raw',
      onAmbiguity: 'error',
    });
    expect(JSON.stringify(e.json)).toBe(
      `["Add",["Error","'ambiguous-factorial'",["LatexString","'x²!'"]],1]`
    );
  });
});
