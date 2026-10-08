import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { LatexSyntax } from '../../src/latex-syntax';
import { dictionaryFromEntries } from '../../src/math-json/utils';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// A dictionary has no notation of its own in LaTeX. It is written as the
// function application `\operatorname{Dictionary}(\operatorname{KeyValuePair}(
// \text{a}, 1), …)`, which the parser reads back as the same dictionary. A
// string key or value is written as any other string: with double quotes
// when `\text{…}` would parse as something else (`\text{m}` is the unit
// meter).
//

const ce = new ComputeEngine();

const D = (...entries: [string, unknown][]): unknown => [
  'Dictionary',
  ...entries.map(([key, value]) => ['KeyValuePair', `'${key}'`, value]),
];

describe('DICTIONARY LATEX ROUND TRIP', () => {
  test.each([
    ['an empty dictionary', D(), '\\operatorname{Dictionary}()'],
    [
      'one entry',
      D(['a', 1]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a}, 1))',
    ],
    [
      'two entries, one with a string value',
      D(['a', 1], ['b', "'s'"]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a}, 1), \\operatorname{KeyValuePair}(\\text{b}, "s"))',
    ],
    [
      'a list value',
      D(['k', ['List', 1, 2]]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{k}, \\bigl\\lbrack1, 2\\bigr\\rbrack))',
    ],
    [
      'a dictionary value',
      D(['k', D(['m', 2])]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{k}, \\operatorname{Dictionary}(\\operatorname{KeyValuePair}("m", 2))))',
    ],
    [
      'a key that is not an identifier',
      D(['a b', 1]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a b}, 1))',
    ],
    [
      'keys that are unit names',
      D(['m', 1], ['s', 2]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}("m", 1), \\operatorname{KeyValuePair}("s", 2))',
    ],
    [
      'a symbol value',
      D(['k', 'x']),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{k}, x))',
    ],
    // The dictionary's values are serialized with the caller's options, as
    // a tuple's operands are, so a function literal whose body is a
    // single-statement `Block` is written without the block marker. With
    // the raw `.json` of the dictionary the value was written
    // `u\mapsto u+1;`, which does not parse back.
    [
      'a function literal value',
      D(['k', ['Function', ['Add', 'u', 1], 'u']]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{k}, u\\mapsto u+1))',
    ],
    [
      'an exact rational value',
      D(['k', ['Rational', 1, 3]]),
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{k}, \\frac{1}{3}))',
    ],
  ])('%s', (_label, json, latex) => {
    const expr = ce.box(json as Expression);
    expect(expr.latex).toBe(latex);
    const back = ce.parse(expr.latex);
    expect(back.json).toEqual(expr.json);
    expect(back.isSame(expr)).toBe(true);
  });

  test('Count of a dictionary keeps the function spelling', () => {
    const expr = ce.box(['Count', D(['a', 1])] as Expression);
    expect(expr.latex).toBe(
      '\\mathrm{Count}(\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a}, 1)))'
    );
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });

  test('a dictionary object, serialized without the compute engine', () => {
    const syntax = new LatexSyntax();
    expect(
      syntax.serialize({ dict: { a: 1, b: 's', c: [1, 2], d: true } })
    ).toBe(
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a}, 1), \\operatorname{KeyValuePair}(\\text{b}, "s"), \\operatorname{KeyValuePair}(\\text{c}, \\bigl\\lbrack1, 2\\bigr\\rbrack), \\operatorname{KeyValuePair}(\\text{d}, \\top))'
    );
  });
});

describe('DICTIONARY KEYS THAT DOUBLE QUOTES CANNOT CARRY', () => {
  test('a key with a double quote is written with \\text and reads back', () => {
    const expr = ce.box(D(['a"b', 1]) as Expression);
    expect(expr.latex).toBe(
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{a"b}, 1))'
    );
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });

  test('a key `$` is escaped and reads back', () => {
    const expr = ce.box(D(['$', 1]) as Expression);
    expect(expr.latex).toBe(
      '\\operatorname{Dictionary}(\\operatorname{KeyValuePair}(\\text{\\$}, 1))'
    );
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });
});

describe('DICTIONARY JSON ROUND TRIP', () => {
  // A function value or an exact rational value used to be written in the
  // `{dict: …}` shorthand as a bare array or a machine number: `Sqrt(2)`
  // came back as the list `["Sqrt", 2]`, and `1/3` as `0.333…`.
  // The comparison is on `.json` and `isExact`, not on `isSame`: `isSame`
  // takes the float 0.5 and the rational 1/2 as the same number.
  test.each([
    ['an exact rational', ['Rational', 1, 3]],
    ['an exact dyadic rational', ['Rational', 1, 2]],
    ['a function', ['Sqrt', 2]],
    ['a list of exact values', ['List', 1, ['Rational', 1, 2]]],
    ['a big decimal', { num: '1.2345678901234567890123456789' }],
    ['a machine number', 1.5],
    ['an integer', 2],
  ])('%s', (_label, value) => {
    const expr = ce.box(D(['k', value]) as Expression);
    const back = ce.box(expr.json);
    expect(back.json).toEqual(expr.json);
    expect(back.isSame(expr)).toBe(true);
  });

  test('an exact rational whose machine value is an integer stays exact', () => {
    // `(10^20 + 1)/10^20` is the machine number 1, but it is not an integer.
    const value = [
      'Rational',
      { num: '100000000000000000001' },
      { num: '100000000000000000000' },
    ];
    const expr = ce.box(D(['k', value]) as Expression);
    expect(JSON.stringify(expr.json)).toContain('Rational');
    const back = ce.box(expr.json);
    expect(back.json).toEqual(expr.json);
    expect(back.isSame(expr)).toBe(true);
  });

  test('an exact rational stays exact', () => {
    for (const value of [
      ['Rational', 1, 2],
      ['List', ['Rational', 1, 2], 3],
    ]) {
      const expr = ce.box(D(['k', value]) as Expression);
      expect(JSON.stringify(expr.json)).toContain('Rational');
      const dict = ce.box(expr.json) as unknown as {
        get(key: string): Expression;
      };
      const k = dict.get('k');
      const first = k.operator === 'List' ? k.ops![0] : k;
      expect(first.isExact).toBe(true);
    }
  });

  test('a machine number keeps the shorthand', () => {
    expect(ce.box(D(['k', 1.5]) as Expression).json).toEqual({
      dict: { k: 1.5 },
    });
  });
});

//
// A string is written `\text{…}`, unless the parser would read that content
// as something other than a string (a unit or a keyword). Then it is written
// with double quotes, which always read as a string.
//
describe('STRING LATEX ROUND TRIP', () => {
  test.each([
    ['a unit symbol', 'm', '"m"'],
    ['a one-letter unit', 's', '"s"'],
    ['a unit prefix and symbol', 'km', '"km"'],
    ['a unit quotient', 'm/s', '"m/s"'],
    [
      'a unit power, with an escaped ^',
      'cm^2',
      '\\text{cm\\textasciicircum{}2}',
    ],
    ['a unit word', 'meter', '"meter"'],
    ['unit words', 'miles per hour', '"miles per hour"'],
    ['a keyword', 'and', '"and"'],
    ['a word that is not a unit', 'abc', '\\text{abc}'],
    ['words that are not units', 'hello world', '\\text{hello world}'],
    ['a single letter that is not a unit', 'x', '\\text{x}'],
    ['the empty string', '', '\\text{}'],
  ])('%s', (_label, s, latex) => {
    const expr = ce.box({ str: s });
    expect(expr.latex).toBe(latex);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
    // In a list too
    const list = ce.box(['List', { str: s }, 1]);
    expect(ce.parse(list.latex).isSame(list)).toBe(true);
  });

  test('a string value of a dictionary inside a list', () => {
    const expr = ce.box(D(['k', ['List', "'m'", "'abc'"]]) as Expression);
    expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
  });
});

//
// Inside `\text{…}`, a character that LaTeX reads as a command or a
// delimiter is escaped, and the parser reads the escape back as the
// character. A string with such a character round-trips alone, in a list,
// and as a dictionary key or value.
//
describe('STRINGS WITH LATEX SPECIAL CHARACTERS', () => {
  test.each([
    ['%', '\\text{\\%}'],
    ['{', '\\text{\\{}'],
    ['}', '\\text{\\}}'],
    ['~', '\\text{\\textasciitilde{}}'],
    ['$', '\\text{\\$}'],
    ['"', '\\text{"}'],
    ['\\', '\\text{\\textbackslash{}}'],
    ['#', '\\text{\\#}'],
    ['&', '\\text{\\&}'],
    ['_', '\\text{\\_}'],
    ['^', '\\text{\\textasciicircum{}}'],
    ['50%', '\\text{50\\%}'],
    ['a\\b', '\\text{a\\textbackslash{}b}'],
    ['$5 & #3', '\\text{\\$5 \\& \\#3}'],
    ['cm^2', '\\text{cm\\textasciicircum{}2}'],
  ])('%j', (s, latex) => {
    const expr = ce.box({ str: s });
    expect(expr.latex).toBe(latex);
    for (const json of [
      { str: s },
      ['List', { str: s }, 1],
      ['Dictionary', ['KeyValuePair', { str: s }, 1]],
      ['Dictionary', ['KeyValuePair', { str: 'k' }, { str: s }]],
    ]) {
      const e = ce.box(json as Expression);
      expect(ce.parse(e.latex).json).toEqual(e.json);
    }
  });
});

//
// `dictionaryFromEntries()` builds the style dictionary of an annotated text
// run (`\textcolor{red}{…}` in `\text{…}`). A value that is a MathJSON
// expression object is kept; it used to be read as a nested dictionary.
//
describe('DICTIONARY FROM ENTRIES', () => {
  test('the style of a text run', () => {
    expect(ce.parse('\\text{\\textcolor{red}{abc}}').json).toEqual([
      'Annotated',
      "'abc'",
      { dict: { color: 'red' } },
    ]);
  });

  test('values that are MathJSON expression objects are kept', () => {
    const dict = dictionaryFromEntries({
      a: { num: '1.5' },
      b: { sym: 'x' },
      c: { fn: ['Add', 'x', 1] },
      d: { str: 's' },
      e: { dict: { g: 1 } },
    });
    expect(dict).toEqual({
      dict: {
        a: { num: '1.5' },
        b: { sym: 'x' },
        c: { fn: ['Add', 'x', 1] },
        d: { str: 's' },
        e: { dict: { g: 1 } },
      },
    });
    expect(ce.box(dict).toString()).toBe(
      '{"a" -> 1.5, "b" -> x, "c" -> x + 1, "d" -> "s", "e" -> {"g" -> 1}}'
    );
  });

  test('JavaScript values: a string, an array, a plain object', () => {
    const dict = dictionaryFromEntries({
      h: 'text',
      j: [1, 2] as unknown as MathJsonExpression,
      i: { k: [3, 4] } as unknown as MathJsonExpression,
    });
    expect(ce.box(dict).toString()).toBe(
      '{"h" -> "text", "j" -> [1,2], "i" -> {"k" -> [3,4]}}'
    );
  });
});
