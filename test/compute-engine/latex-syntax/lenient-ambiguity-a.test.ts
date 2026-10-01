import { ComputeEngine } from '../../../src/compute-engine';
import type { ParseDiagnostic } from '../../../src/compute-engine';

/**
 * The lenient grammar reports each reading choice that has a second common
 * reading with a parse diagnostic whose code starts with `ambiguous-`. The
 * reading does not change: the parse result is the same with and without
 * `diagnostics: true`, and the strict grammar reports none of these codes.
 *
 * Design: `docs/plans/2026-10-01-lenient-ambiguity-codes.md` (sections 5.1,
 * 5.2 and 5.3, and the lenient function names of section 7).
 */

const ce = new ComputeEngine();
// A function declared in the engine, for `ambiguous-function-without-parentheses`
ce.declare('f', 'function');

function lenient(input: string): {
  json: string;
  codes: string[];
  diagnostics: ReadonlyArray<ParseDiagnostic>;
} {
  const e = ce.parse(input, {
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
  return JSON.stringify(ce.parse(input, { strict: false, form: 'raw' }).json);
}

function strictCodes(input: string): string[] {
  const e = ce.parse(input, { form: 'raw', diagnostics: true });
  return (e.parseDiagnostics ?? [])
    .map((d) => d.code)
    .filter((c) => c.startsWith('ambiguous-'));
}

/** Each input reports `code` exactly once, keeps the reading it has without
 * diagnostics, and the strict grammar does not report it. */
function expectReported(code: string, inputs: string[]): void {
  for (const input of inputs) {
    test(`${input} reports ${code}`, () => {
      const result = lenient(input);
      expect(result.codes.filter((c) => c === code)).toEqual([code]);
      expect(result.json).toBe(reading(input));
      expect(strictCodes(input)).toEqual([]);
    });
  }
}

function expectNotReported(code: string, inputs: string[]): void {
  for (const input of inputs) {
    test(`${input} does not report ${code}`, () => {
      const result = lenient(input);
      expect(result.codes).not.toContain(code);
      expect(result.json).toBe(reading(input));
    });
  }
}

describe('ambiguous-exponent-end', () => {
  expectReported('ambiguous-exponent-end', [
    'e^2pi',
    'x^2y',
    'e^2π',
    'e^i pi',
    'e^-x y',
    'e^2 pi i',
    'e^x/2',
    'e^-x/2',
    'x^pi/2',
    'x^1/2',
  ]);
  expectNotReported('ambiguous-exponent-end', [
    'x^2 y',
    'x^3/2',
    'e^{2}pi',
    'e^(2)pi',
    'e^x',
    'e^x dx',
    'e^x sin x',
    'x^2 + y',
    // A one-letter exponent before a letter is a letter run
    'e^xy',
  ]);

  test('the reading and the detail', () => {
    expect(lenient('e^2pi').json).toBe(
      '["InvisibleOperator",["Power","e",2],"Pi"]'
    );
    expect(lenient('x^1/2').json).toBe('["Divide",["Power","x",1],2]');
    const [d] = lenient('e^-x y').diagnostics;
    expect(d.detail).toEqual({ exponent: '-x' });
    // The span starts at the base and ends after the operand that follows
    expect('e^-x y'.slice(d.start, d.end)).toBe('e^-x y');
    const span = (text: string) => {
      const [first] = lenient(text).diagnostics;
      return text.slice(first.start, first.end);
    };
    expect(span('e^2pi')).toBe('e^2pi');
    expect(span('y = e^x/2')).toBe('e^x/2');
    expect(span('e^i pi')).toBe('e^i pi');
  });
});

describe('ambiguous-implicit-subscript', () => {
  expectReported('ambiguous-implicit-subscript', [
    'x2',
    'θ2',
    'π2',
    'α1',
    'alpha2',
    'y = x2',
    'x_1y',
  ]);
  expectNotReported('ambiguous-implicit-subscript', [
    'atan2(1, 2)',
    'log2(x)',
    'log10(x)',
    'x_1 y',
    'x_{1}y',
    'x_2',
  ]);

  test('the reading', () => {
    expect(lenient('x2').json).toBe('["Subscript","x",2]');
    expect(lenient('x_1y').json).toBe('["InvisibleOperator","x_1","y"]');
  });
});

describe('ambiguous-name-digits', () => {
  expectReported('ambiguous-name-digits', ['atan3(y)']);
  expectNotReported('ambiguous-name-digits', [
    'atan2(y, x)',
    'log2(x)',
    'log10(x)',
    'atan(3y)',
  ]);

  test('the reading', () => {
    expect(lenient('atan3(y)').json).toBe(
      '["Arctan",["InvisibleOperator",3,["Delimiter","y"]]]'
    );
  });
});

describe('ambiguous-function-argument', () => {
  expectReported('ambiguous-function-argument', [
    'sin x y',
    'sqrt 2 x',
    'ln 2 x',
    'exp 2 x',
    'abs 2 x',
    'log 2 x',
  ]);
  expectNotReported('ambiguous-function-argument', [
    'sin 2x',
    'sin x',
    'sin x + y',
    'sin x cos y',
    'sin 2(x + 1)',
    'sin(x) y',
    'log2 x',
    'log2(x)',
  ]);

  test('the reading', () => {
    expect(lenient('sin x y').json).toBe(
      '["Sin",["InvisibleOperator","x","y"]]'
    );
    expect(lenient('log 2 x').json).toBe('["Lb","x"]');
  });
});

describe('ambiguous-function-without-parentheses', () => {
  expectReported('ambiguous-function-without-parentheses', ['f x', '2 f x']);
  expectNotReported('ambiguous-function-without-parentheses', [
    'f(x)',
    // `g` is not declared as a function
    'g x',
  ]);

  test('the reading', () => {
    expect(lenient('f x').json).toBe('["InvisibleOperator","f","x"]');
  });
});

describe('ambiguous-name-then-number', () => {
  expectReported('ambiguous-name-then-number', ['x 2', 'θ 2', 'x  2']);
  expectNotReported('ambiguous-name-then-number', [
    'x2',
    '2 x',
    // The last letter of a letter run is not a name
    '7 mod 3',
  ]);

  test('the reading', () => {
    expect(lenient('x 2').json).toBe('["InvisibleOperator","x",2]');
  });
});

describe('ambiguous-delta', () => {
  expectReported('ambiguous-delta', [
    'Δx',
    'Q = m c ΔT',
    'Delta x = 2',
    'Deltax',
  ]);
  expectNotReported('ambiguous-delta', ['Δ', 'Δ + x', 'Delta then']);

  test('each delta is reported', () => {
    expect(lenient('ΔxΔy').codes).toEqual([
      'ambiguous-delta',
      'ambiguous-delta',
    ]);
  });

  test('the reading', () => {
    expect(lenient('Δx').json).toBe('["InvisibleOperator","Delta","x"]');
  });
});

describe('ambiguous-constant-name', () => {
  expectReported('ambiguous-constant-name', [
    'e = 1.6e-19',
    'i = V/R',
    'pi = 3.14',
    'π = 3',
    'inf = 2',
  ]);
  expectNotReported('ambiguous-constant-name', [
    'f(pi) = 3',
    'y = pi',
    '2pi = 3',
    'x = 3',
  ]);

  test('the reading', () => {
    expect(lenient('pi = 3.14').json).toBe('["Equal","Pi",3.14]');
  });
});

describe('ambiguous-lookalike-letter', () => {
  expectReported('ambiguous-lookalike-letter', ['Α + 1', 'Ρ = 2', 'ο', 'Χ']);
  expectNotReported('ambiguous-lookalike-letter', ['A + 1', 'Ω', 'θ']);

  test('the reading', () => {
    expect(lenient('Ρ = 2').json).toBe('["Equal","Rho",2]');
  });
});

describe('ambiguous-unknown-character', () => {
  expectReported('ambiguous-unknown-character', ['y = ж', 'y = é']);
  expectNotReported('ambiguous-unknown-character', ['y = x', 'y = θ']);

  test('the reading', () => {
    expect(lenient('y = ж').json).toBe(`["Equal","y","'ж'"]`);
  });
});

describe('ambiguous-radical', () => {
  expectReported('ambiguous-radical', [
    '√2π',
    '√2x',
    '√xy',
    '√x²',
    '√x²+y²',
    '3√8',
  ]);
  expectNotReported('ambiguous-radical', [
    '√2',
    '√(2π)',
    '√{2π}',
    '√2/2',
    '√2 + 1',
  ]);

  test('the reading', () => {
    expect(lenient('√2π').json).toBe('["InvisibleOperator",["Sqrt",2],"Pi"]');
    expect(lenient('√x²').json).toBe('["Power",["Sqrt","x"],2]');
    expect(lenient('3√8').json).toBe('["InvisibleOperator",3,["Sqrt",8]]');
  });

  test('the span ends after the operand that follows the radicand', () => {
    const span = (text: string) => {
      const [first] = lenient(text).diagnostics;
      return text.slice(first.start, first.end);
    };
    expect(span('√2π')).toBe('√2π');
    expect(span('√xy')).toBe('√xy');
    expect(span('√2ab')).toBe('√2ab');
    expect(span('√x^2')).toBe('√x^2');
    // A command for a letter starts an operand, as a letter does
    expect(lenient('√2\\pi').codes).toEqual(['ambiguous-radical']);
  });
});

describe('ambiguous-absolute-value', () => {
  expectReported('ambiguous-absolute-value', ['|x|y|z|']);
  expectNotReported('ambiguous-absolute-value', [
    '|x|',
    '|x|y',
    '|a|+|b|',
    '||x||',
    '2|x|',
  ]);

  test('the reading', () => {
    expect(lenient('|x|y|z|').json).toBe(
      '["InvisibleOperator",["Abs","x"],"y",["Abs","z"]]'
    );
  });
});

describe('lenient function names', () => {
  test.each([
    ['mod(x, 2)', '["Mod","x",2]'],
    ['pow(x, 2)', '["Power","x",2]'],
    ['trunc(x)', '["Truncate","x"]'],
    ['Re(z)', '["Real","z"]'],
    ['Im(z)', '["Imaginary","z"]'],
    ['mod (x, 2)', '["Mod","x",2]'],
  ])('%s', (input, expected) => {
    expect(reading(input)).toBe(expected);
  });

  test('evaluate', () => {
    expect(ce.parse('mod(7, 3)', { strict: false }).evaluate().json).toBe(1);
    expect(ce.parse('trunc(2.5)', { strict: false }).evaluate().json).toBe(2);
  });

  test('without a parenthesis, the words are letters', () => {
    expect(reading('7 mod 3')).toBe('["InvisibleOperator",7,"m","o","d",3]');
  });

  test('the strict grammar does not read them', () => {
    expect(
      JSON.stringify(ce.parse('mod(x, 2)', { form: 'raw' }).json)
    ).not.toBe('["Mod","x",2]');
  });
});

describe('diagnostics and backtracking', () => {
  test('a diagnostic is not reported twice', () => {
    for (const input of ['e^2pi', 'x2', '√2π', '|x|y|z|', 'sin x y']) {
      const ds = lenient(input).diagnostics;
      const keys = ds.map((d) => `${d.code}:${d.start}:${d.end}`);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  test('a diagnostic inside a group is kept once', () => {
    expect(lenient('[x^2y, 3]').codes).toEqual(['ambiguous-exponent-end']);
    expect(lenient('|x^2y|').codes).toEqual(['ambiguous-exponent-end']);
  });

  test('a double superscript is an error, not an exponent end', () => {
    expect(lenient('e^-x^2 y').codes).toEqual([]);
  });
});
