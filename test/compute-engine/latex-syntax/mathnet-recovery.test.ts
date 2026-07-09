import { engine as ce } from '../../utils';

/**
 * Parser-hardening (MathNet corpus) Tier-2 recovery:
 *   - ellipsis tolerance (`\cdots`, `\dotsb/c/m`, Unicode `…`) parsing to an
 *     inert `ContinuationPlaceholder` operand, and
 *   - trailing sentence-punctuation recovery (`.`, `;`, `,`) on otherwise-Error
 *     parses.
 *
 * A parse is considered "clean" when it produces a valid expression with no
 * `Error` subexpression.
 */

function json(s: string): string {
  return JSON.stringify(ce.parse(s).json);
}

function isClean(s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

describe('MathNet Tier-2: ellipsis tolerance', () => {
  test('\\cdots in a product parses cleanly with an inert placeholder', () => {
    expect(isClean('(2!+2)(3!+3) \\cdots (2019!+3)')).toBe(true);
    expect(json('(2!+2)(3!+3) \\cdots (2019!+3)')).toContain(
      'ContinuationPlaceholder'
    );
  });

  test('\\cdots in a sum stays valid', () => {
    expect(isClean('1 + 2 + \\cdots + n')).toBe(true);
    expect(json('1 + 2 + \\cdots + n')).toContain('ContinuationPlaceholder');
  });

  test('\\ldots / \\dots in a tuple stays valid', () => {
    expect(isClean('(a_1, \\ldots, a_n)')).toBe(true);
    expect(isClean('(a_1, \\dots, a_n)')).toBe(true);
  });

  test('\\dotsb / \\dotsc / \\dotsm parse to ContinuationPlaceholder', () => {
    for (const cmd of ['\\dotsb', '\\dotsc', '\\dotsm']) {
      expect(ce.parse(cmd).json).toEqual('ContinuationPlaceholder');
    }
  });

  test('Unicode … (U+2026) parses to ContinuationPlaceholder', () => {
    expect(ce.parse('…').json).toEqual('ContinuationPlaceholder');
    expect(isClean('1, 2, …, 10')).toBe(true);
  });

  test('ellipsis in an Add stays valid (no Error node)', () => {
    expect(isClean('(1!)^2 + (2!)^2 + \\dots + (2018!)^2')).toBe(true);
  });

  test('trailing \\ldots without a comma parses like the comma form', () => {
    expect(ce.parse('a_{1}, a_{2}, a_{3} \\ldots').json).toEqual(
      ce.parse('a_{1}, a_{2}, a_{3}, \\ldots').json
    );
    expect(ce.parse('F_{1}, F_{2}, F_{3} \\ldots').json).toEqual([
      'Tuple',
      'F_1',
      'F_2',
      'F_3',
      'ContinuationPlaceholder',
    ]);
    // Mid-sequence: the spliced continuation keeps the following elements flat
    expect(ce.parse('a_3 \\ldots, b').json).toEqual([
      'Tuple',
      'a_3',
      'ContinuationPlaceholder',
      'b',
    ]);
  });

  test('number followed by trailing \\ldots is clean', () => {
    expect(isClean('122333444455555 \\ldots')).toBe(true);
    expect(json('122333444455555 \\ldots')).toContain(
      'ContinuationPlaceholder'
    );
  });

  test('\\vdots / \\ddots parse to ContinuationPlaceholder', () => {
    expect(ce.parse('\\vdots').json).toEqual('ContinuationPlaceholder');
    expect(ce.parse('\\ddots').json).toEqual('ContinuationPlaceholder');
    // Inside a matrix, omitted rows become placeholder cells (no Error)
    expect(
      isClean('\\begin{pmatrix} 1 & 2 \\\\ \\vdots & \\ddots \\end{pmatrix}')
    ).toBe(true);
  });

  test('range parsing is unaffected by the trailing-dots recovery', () => {
    expect(ce.parse('[1 \\ldots 9]').json).toEqual(['Range', 1, 9]);
    expect(ce.parse('[1 \\dots 9]').json).toEqual(['Range', 1, 9]);
    expect(ce.parse('1..5').json).toEqual(['Range', 1, 5]);
    // The programmatic `..` operator does NOT get the recovery: `1..` never
    // becomes a continuation (the trailing-punctuation recovery strips the
    // stray dot instead: `1..` → `1.` → 1).
    expect(json('1..')).not.toContain('ContinuationPlaceholder');
    expect(ce.parse('1..').json).toEqual(1);
    expect(ce.parse('1..2..10').json).toEqual(['Range', 1, 10, 1]);
  });
});

describe('MathNet Tier-2: trailing sentence-punctuation recovery', () => {
  test('trailing period on an equation is dropped', () => {
    expect(isClean('(x^2-1)^2 (y^2-1)^2 + 16x^2 y^2 = z^2.')).toBe(true);
    // Recovers to the bare equation, no trailing punctuation artifact
    expect(json('(x^2-1)^2 (y^2-1)^2 + 16x^2 y^2 = z^2.')).not.toContain(
      'Error'
    );
  });

  test('trailing period with a space is dropped', () => {
    expect(isClean('a + b = c .')).toBe(true);
    expect(ce.parse('a + b = c .').json).toEqual(
      ce.parse('a + b = c').json
    );
  });

  test('trailing semicolon is tolerated', () => {
    expect(isClean('x + y = z;')).toBe(true);
  });

  test('trailing comma on a complete expression is tolerated', () => {
    expect(isClean('a + b = c,')).toBe(true);
  });

  test('trailing question mark is dropped (MCQ/rhetorical fragments)', () => {
    expect(isClean('\\cos^2 x + 2\\sin^2 x = 1?')).toBe(true);
    expect(isClean('\\sum_{n=1}^{100} a_n^2?')).toBe(true);
    expect(isClean('a^3+b^3+c^3+5a^2+5b^2+5c^2?')).toBe(true);
    expect(ce.parse('x + y = z?').json).toEqual(ce.parse('x + y = z').json);
  });
});

describe('Algebraic-structure tuples (bare operators as elements)', () => {
  test('(A, +) and (K, +, \\cdot) parse with inert operation names', () => {
    expect(ce.parse('(A,+)').json).toEqual(['Tuple', 'A', 'Add']);
    expect(ce.parse('(K, +, \\cdot)').json).toEqual([
      'Tuple',
      'K',
      'Add',
      'Multiply',
    ]);
  });

  test('recovery requires the operator to be bare', () => {
    // `+b` is a normal prefixed element, not a bare operator
    expect(ce.parse('(a, +b)').json).toEqual(['Tuple', 'a', 'b']);
    expect(ce.parse('f(x, -y)').json).toEqual(['f', 'x', ['Negate', 'y']]);
  });
});

describe('Decorated binary operators parse to inert heads', () => {
  test('\\oplus / \\otimes / \\star / \\circledast', () => {
    expect(ce.parse('a \\oplus b').json).toEqual(['CirclePlus', 'a', 'b']);
    expect(ce.parse('a \\otimes b \\otimes c').json).toEqual([
      'CircleTimes',
      'a',
      'b',
      'c',
    ]);
    expect(ce.parse('x \\star y').json).toEqual(['Star', 'x', 'y']);
    expect(ce.parse('(2+3) \\circledast (0+3)').json).toEqual([
      'CircledAst',
      5,
      3,
    ]);
  });

  test('round-trip serialization', () => {
    expect(ce.parse('a \\oplus b').latex).toBe('a\\oplus b');
    expect(ce.parse('x \\star y').latex).toBe('x\\star y');
  });

  test('existing \\star spellings are unaffected', () => {
    expect(ce.parse('A^\\star').json).toEqual(['ConjugateTranspose', 'A']);
    expect(ce.parse('x \\star\\star y').json).toEqual(['Starstar', 'x', 'y']);
  });
});

describe('MathNet Tier-2: non-regression guards', () => {
  test('`5.` still parses as the number 5', () => {
    expect(ce.parse('5.').json).toEqual(5);
  });

  test('decimal literal at end of expression is unaffected', () => {
    expect(ce.parse('x = 5.').json).toEqual(['Equal', 'x', 5]);
  });

  test('tuple (1,2) is unaffected', () => {
    expect(ce.parse('(1,2)').json).toEqual(['Tuple', 1, 2]);
  });

  test('sequence 1,2,3 is unaffected', () => {
    expect(ce.parse('1,2,3').json).toEqual(['Tuple', 1, 2, 3]);
  });

  test('valid expression without trailing punctuation is unchanged', () => {
    expect(ce.parse('a + b').json).toEqual(['Add', 'a', 'b']);
  });

  test('recovery does not fire when the stripped parse is still an Error', () => {
    // `26 = .` is blocked by the missing right-hand side, not by the
    // trailing period, so recovery must NOT silently substitute a
    // still-broken parse. The result keeps its Error (no change of meaning).
    // (Former fixtures `M=N+1 .` and `(A,+) .` no longer apply: bare `N`
    // devolves to a plain symbol, and bare operators are now valid tuple
    // elements.)
    expect(JSON.stringify(ce.parse('26 = .').json)).toContain('Error');
    expect(JSON.stringify(ce.parse('26 =').json)).toContain('Error');
  });
});
