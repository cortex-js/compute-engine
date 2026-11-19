import { ComputeEngine } from '../../src/compute-engine';
import {
  epsilCompletions,
  type EpsilCompletions,
} from '../../src/epsil/completion';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';

const ce = new ComputeEngine();

/** The completions at the `▮` of `source`. */
function complete(source: string): EpsilCompletions {
  const offset = source.indexOf('▮');
  return epsilCompletions(ce, source.replace('▮', ''), offset);
}

function labels(result: EpsilCompletions, kind?: string): string[] {
  return result.items
    .filter((item) => kind === undefined || item.kind === kind)
    .map((item) => item.label);
}

function item(result: EpsilCompletions, label: string) {
  return result.items.find((i) => i.label === label);
}

/** The likely values at the `▮` of `source`, each checked to give a source
 * that parses with no diagnostics where it is offered. */
function values(source: string): string[] {
  const result = labels(complete(source), 'value');
  for (const value of result)
    expect(parseEpsil(source.replace('▮', value))[1]).toEqual([]);
  return result;
}

describe('EPSIL COMPLETION: CONTEXT', () => {
  test('the value of a typed let expects its type', () => {
    const result = complete('let a: integer = ▮');
    expect(result.expectedType).toBe('integer');
    expect(result.range).toEqual([17, 17]);
    expect(result.items[0]).toMatchObject({ label: '0', kind: 'value' });
  });

  test('a string let expects a string', () => {
    const result = complete('let s: string = ▮');
    expect(result.expectedType).toBe('string');
    expect(labels(result, 'value')).toEqual(['""']);
  });

  test('an argument of a function of the source expects its parameter type', () => {
    const result = complete('function f(x: real, n: integer) { x }\nf(1, ▮)');
    expect(result.expectedType).toBe('integer');
    expect(labels(result, 'value')).toEqual(['0']);
  });

  test('an element of an unclosed list expects the element type', () => {
    expect(complete('let L: list<real> = [1, ▮').expectedType).toBe('real');
  });

  test('an argument of an unclosed library call expects its signature type', () => {
    expect(complete('let b = Sin(▮').expectedType).toBe('complex | quantity');
    // The Epsil spelling of the library name too
    expect(complete('let b = sin(▮').expectedType).toBe('complex | quantity');
  });

  test('the value of an assignment expects the declared type', () => {
    const result = complete('let x: integer = 1\nx = ▮');
    expect(result.expectedType).toBe('integer');
    expect(item(result, 'x')).toMatchObject({ kind: 'variable', rank: 2 });
  });

  test('after `:` of a let, the items are type names', () => {
    const result = complete('type point = tuple<x: real, y: real>\nlet a: ▮');
    expect(result.expectedType).toBeUndefined();
    expect(new Set(result.items.map((i) => i.kind))).toEqual(new Set(['type']));
    expect(labels(result)).toContain('integer');
    // A type of the source comes before the built-in types
    expect(result.items[0]).toMatchObject({
      label: 'point',
      detail: 'tuple<x: real, y: real>',
    });
  });

  test('a parameter annotation and a result type are type positions', () => {
    expect(labels(complete('function f(x: ▮'))).toContain('real');
    expect(labels(complete('function f(x: real) -> ▮'))).toContain('boolean');
    // A named argument is a value, not a type
    expect(labels(complete('f(a: ▮'))).toContain('sin');
  });

  test('a type argument and a union member are type positions', () => {
    for (const source of [
      'let xs: list<re▮>',
      'let x: integer | ▮',
      'let m: dictionary<string, ▮',
      'let x: list<list<integer>> | ▮',
      'function f(x: list<▮',
    ]) {
      const result = complete(source);
      expect(new Set(result.items.map((i) => i.kind))).toEqual(
        new Set(['type'])
      );
      expect(labels(result)).toContain('real');
    }
    // A comparison, a parameter name and a new statement are not
    for (const source of [
      'let x = a < ▮',
      'function f(x: real, ▮',
      'let x: integer\nb | ▮',
    ])
      expect(item(complete(source), 'real')?.kind).toBe('library-function');
  });

  test('a dropped statement gets names and keywords, with no expected type', () => {
    const result = complete('let k = 1\nif ▮');
    expect(result.expectedType).toBeUndefined();
    expect(labels(result, 'variable')).toEqual(['k']);
    expect(labels(result, 'keyword')).toEqual(['false', 'if', 'match', 'true']);
  });

  test('the start of a statement offers the statement keywords', () => {
    const keywords = labels(complete('let k = 1\n▮'), 'keyword');
    expect(keywords).toContain('let');
    expect(keywords).toContain('function');
    expect(keywords).toContain('true');
  });

  test('no items inside a string or a comment', () => {
    expect(complete('let s = "ab▮"').items).toEqual([]);
    expect(complete('let s = 1 // co▮').items).toEqual([]);
  });

  test('a protocol is not offered in a type position', () => {
    const source =
      'protocol Shape { function area(s: Self) -> real }\nlet a: ▮';
    expect(labels(complete(source))).not.toContain('Shape');
    const offset = source.indexOf('▮');
    const result = epsilCompletions(ce, source.replace('▮', ''), offset, {
      protocolNames: ['Comparable'],
    });
    expect(labels(result)).not.toContain('Comparable');
    expect(labels(result)).toContain('integer');
  });

  test('a word with a non-BMP letter is one word', () => {
    const result = complete('let 𝑥 = 1\nlet b = 𝑥▮');
    // `𝑥` is two UTF-16 units
    expect(result.range).toEqual([19, 21]);
    expect(result.replaceEnd).toBe(21);
    expect(labels(result, 'variable')).toEqual(['𝑥']);
  });

  test('comments follow the lexer: nesting, and `//` in a closed comment', () => {
    expect(complete('/* outer /* inner */ co▮ */').items).toEqual([]);
    expect(labels(complete('/* https://example.com */ co▮'))).toContain('cos');
    expect(complete('/* unclosed co▮').items).toEqual([]);
  });

  test('an unclosed string mid-document, and a closed extended string', () => {
    expect(complete('let s = "hi ▮\nlet t = 1').items).toEqual([]);
    expect(complete('let s = #"ab"#▮').items).not.toEqual([]);
  });

  test('replaceEnd is the end of the word under the offset', () => {
    const result = complete('l▮e');
    expect(result.range).toEqual([0, 1]);
    expect(result.replaceEnd).toBe(2);
    expect(labels(result)).toContain('let');
  });
});

describe('EPSIL COMPLETION: LIKELY VALUES', () => {
  test.each([
    ['let a: integer = ▮', ['0']],
    ['let a: real = ▮', ['0']],
    ['let a: number = ▮', ['0']],
    ['let a: boolean = ▮', ['false', 'true']],
    ['let a: string = ▮', ['""']],
    ['let a: list<integer> = ▮', ['[]']],
    ['let a: tuple<integer, real> = ▮', ['(0, 0)']],
    ['let a: record{x: real, y: string} = ▮', ['{x -> 0, y -> ""}']],
    ['type light = red | green\nlet a: light = ▮', ['green()', 'red()']],
    [
      'type shape = circle(real) | square\nlet a: shape = ▮',
      ['circle(0)', 'square()'],
    ],
    ['type alias pair = tuple<integer, integer>\nlet a: pair = ▮', ['(0, 0)']],
    ['type point = tuple<x: real, y: real>\nlet a: point = ▮', ['point(0, 0)']],
  ])('%s', (source, values) => {
    const result = complete(source);
    expect(labels(result, 'value')).toEqual(values);
    for (const value of values)
      expect(parseEpsil(source.replace('▮', value))[1]).toEqual([]);
    expect(result.items.slice(0, values.length).map((i) => i.rank)).toEqual(
      values.map(() => 1)
    );
    // Each value is accepted where it is offered
    for (const value of values) {
      const program = source.replace('▮', value);
      expect(() => executeEpsil(new ComputeEngine(), program)).not.toThrow();
    }
  });

  test('a range type that excludes 0 has no likely value', () => {
    expect(labels(complete('let a: integer<1..5> = ▮'), 'value')).toEqual([]);
  });

  test('a variant with several fields takes one argument per field', () => {
    const source = 'type p = pair(integer, string)\nlet x: p = ▮';
    expect(labels(complete(source), 'value')).toEqual(['pair(0, "")']);
    const result = executeEpsil(
      new ComputeEngine(),
      source.replace('▮', 'pair(0, "")')
    );
    expect(result.diagnostics).toEqual([]);
  });

  test('a variant known only from the options has no likely value', () => {
    const source = 'let a: shape = ';
    const result = epsilCompletions(ce, source, source.length, {
      typeNames: ['shape'],
      sumVariants: { circle: 'shape' },
    });
    expect(labels(result, 'value')).toEqual([]);
  });

  test('the variants of a sum type are names', () => {
    const source = 'type light = red | green\nlet a = ▮';
    expect(item(complete(source), 'green')).toMatchObject({
      kind: 'function',
      insertText: 'green()',
      detail: '() -> light',
    });
    // A constructor that inserts a likely value is offered once, as the value
    const expected = complete('type light = red | green\nlet a: light = ▮');
    expect(
      expected.items.filter((i) => (i.insertText ?? i.label) === 'red()')
    ).toEqual([expect.objectContaining({ kind: 'value', rank: 1 })]);
    // A variant is a type: `let a: red = red()`
    expect(
      item(complete('type light = red | green\nlet a: ▮'), 'red')
    ).toMatchObject({ kind: 'type', detail: 'light' });
    expect(
      executeEpsil(
        new ComputeEngine(),
        'type light = red | green\nlet a: red = red()'
      ).diagnostics
    ).toEqual([]);
  });

  test('a variant known only from the options is a name, not a type', () => {
    const options = { typeNames: ['shape'], sumVariants: { circle: 'shape' } };
    const value = epsilCompletions(ce, 'let a = ', 8, options);
    const circle = item(value, 'circle');
    expect(circle).toMatchObject({ kind: 'function', detail: 'shape' });
    expect(circle?.insertText).toBeUndefined();
    expect(labels(epsilCompletions(ce, 'let a: ', 7, options))).not.toContain(
      'circle'
    );
  });

  test('a list type that fixes a size has no empty list', () => {
    for (const type of ['vector<integer^3>', 'matrix<2x3>', 'matrix'])
      expect(labels(complete(`let a: ${type} = ▮`), 'value')).toEqual([]);
    expect(labels(complete('let a: vector = ▮'), 'value')).toEqual(['[]']);
  });
});

describe('EPSIL COMPLETION: SCOPE', () => {
  test('a local is not visible before its let', () => {
    const result = complete('function g() {\n  ▮\n  let y = 2\n}');
    expect(labels(result)).not.toContain('y');
  });

  test('a local is visible after its let, before the globals', () => {
    const result = complete('let w = 1\nfunction g() {\n  let y = 2\n  ▮\n}');
    expect(labels(result, 'variable')).toEqual(['y', 'w']);
  });

  test('a let is not visible in its own initializer', () => {
    expect(labels(complete('let q = ▮'))).not.toContain('q');
  });

  test('a parameter is visible only in its body', () => {
    expect(
      labels(complete('function f(p: integer) {\n  ▮\n}'), 'variable')
    ).toEqual(['p']);
    expect(labels(complete('function f(p: integer) { p }\n▮'))).not.toContain(
      'p'
    );
  });

  test('a function is visible above its definition', () => {
    const result = complete('▮\nfunction f(x: real) -> integer { 1 }');
    expect(item(result, 'f')).toMatchObject({
      kind: 'function',
      detail: '(real) -> integer',
    });
  });

  test('effects or type parameters: the ascription is the signature', () => {
    const pure = complete('function h(x) pure -> real { x + 1 }\n▮');
    expect(item(pure, 'h')).toMatchObject({ detail: '(any) pure -> real' });
    const generic = complete('function id<T>(x: T) -> T { x }\n▮');
    expect(item(generic, 'id')).toMatchObject({
      detail: '(T) -> T where T',
    });
    // A return type that is a function type stays a return type.
    const k = complete('function k(x) -> (real) pure -> real { x }\n▮');
    expect(item(k, 'k')).toMatchObject({
      detail: '(any) -> (real) pure -> real',
    });
    // A type of the source in a full signature.
    const point = complete(
      'type Point = tuple<x: real, y: real>\nfunction h(p: Point) pure -> real { 1 }\n▮'
    );
    expect(item(point, 'h')).toMatchObject({ detail: '(Point) pure -> real' });
    // A full signature that does not parse is not a return type.
    const box = complete(
      'type Box<T> = tuple<T>\nfunction h(p: Box<real>) pure -> real { 1 }\n▮'
    );
    expect(item(box, 'h')).toMatchObject({ detail: '(Box<real>)' });
  });

  test('a name of the source shadows a library name', () => {
    const result = complete('let sin = 2\n▮');
    expect(result.items.filter((i) => i.label === 'sin')).toEqual([
      expect.objectContaining({ kind: 'variable' }),
    ]);
  });
});

describe('EPSIL COMPLETION: RANKING AND FILTERING', () => {
  test('ranks: values, matching names, matching library names, other names, other library names, keywords', () => {
    const result = complete(
      'let n: integer = 1\nlet s = "a"\nlet a: integer = ▮'
    );
    expect(item(result, '0')?.rank).toBe(1);
    expect(item(result, 'n')?.rank).toBe(2);
    expect(item(result, 'digitSum')?.rank).toBe(3);
    expect(item(result, 's')?.rank).toBe(4);
    expect(item(result, 'sin')?.rank).toBe(5);
    expect(item(result, 'if')?.rank).toBe(6);
    const ranks = result.items.map((i) => i.rank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test('a library item has its signature and description', () => {
    expect(item(complete('let b = ▮'), 'digitSum')).toMatchObject({
      kind: 'library-function',
      detail: expect.stringContaining('-> integer'),
      documentation: expect.any(String),
    });
    expect(item(complete('let b = ▮'), 'pi')).toMatchObject({
      kind: 'library-constant',
    });
  });

  test('the items match the word typed, ignoring case', () => {
    const result = complete('let alpha = 1\nlet Alright = 2\nAL▮');
    expect(result.range).toEqual([30, 32]);
    expect(labels(result).every((l) => l.toLowerCase().startsWith('al'))).toBe(
      true
    );
    expect(labels(result)).toEqual(
      expect.arrayContaining(['alpha', 'Alright'])
    );
  });

  test('the rest of a word after the offset does not change the context', () => {
    const result = complete('let a: integer = 1\nlet b: integer = a▮bc');
    expect(result.range).toEqual([36, 37]);
    expect(result.expectedType).toBe('integer');
    expect(labels(result, 'variable')).toEqual(['a']);
  });
});

describe('EPSIL COMPLETION: SPELLING', () => {
  test('a word holds what the lexer accepts in a name', () => {
    // `x` + U+0302 COMBINING CIRCUMFLEX ACCENT
    const result = complete('let x̂y = 1\nlet b = x̂▮');
    expect(result.range).toEqual([20, 22]);
    expect(labels(result)).toEqual(['x̂y']);
    const emoji = complete('let 😀a = 1\nlet b = 😀▮');
    expect(emoji.range).toEqual([20, 22]);
    expect(labels(emoji)).toEqual(['😀a']);
  });

  test('a name in backticks does not hide the keyword of the same text', () => {
    const result = complete('let `while` = 1\nwh▮');
    expect(result.items).toEqual([
      expect.objectContaining({ label: 'while', insertText: '`while`' }),
      expect.objectContaining({ label: 'while', kind: 'keyword' }),
    ]);
    // A name that inserts the keyword's text hides it
    const parallel = complete('let parallel = 1\nparal▮');
    expect(parallel.items.filter((i) => i.label === 'parallel')).toEqual([
      expect.objectContaining({ kind: 'variable' }),
    ]);
  });

  test('an unclosed verbatim name ends at its line', () => {
    const result = complete('let `wh\n▮');
    expect(result.range).toEqual([8, 8]);
    expect(result.items).not.toEqual([]);
  });

  test('a closed verbatim name with the offset inside', () => {
    const result = complete('let `while` = 1\nlet x = `wh▮`');
    expect(result.range).toEqual([24, 27]);
    // The word replaced runs to the closing backtick
    expect(result.replaceEnd).toBe(28);
    expect(item(result, 'while')).toMatchObject({ insertText: '`while`' });
  });

  test('a name that needs backticks is inserted with them', () => {
    expect(
      item(complete('let `while` = 1\nlet x = wh▮'), 'while')
    ).toMatchObject({ kind: 'variable', insertText: '`while`' });
    // After an opening backtick, the range covers it
    const result = complete('let `while` = 1\nlet x = `wh▮');
    expect(result.range).toEqual([24, 27]);
    expect(item(result, 'while')).toMatchObject({ insertText: '`while`' });
  });

  test('a tuple of zero or one element uses the function form', () => {
    expect(labels(complete('let a: tuple<integer> = ▮'), 'value')).toEqual([
      'Tuple(0)',
    ]);
    expect(labels(complete('let a: tuple<> = ▮'), 'value')).toEqual([
      'Tuple()',
    ]);
    expect(
      labels(complete('let a: tuple<integer, real> = ▮'), 'value')
    ).toEqual(['(0, 0)']);
  });

  test('a record key that is not a plain name is a string', () => {
    const source = 'let a: record{`while`: integer, y: real} = ▮';
    expect(values(source)).toEqual(['{"while" -> 0, y -> 0}']);
    expect(
      executeEpsil(
        new ComputeEngine(),
        source.replace('▮', '{"while" -> 0, y -> 0}')
      ).diagnostics
    ).toEqual([]);
    // `{"first-name" -> 0}` is a dictionary, not a record: no likely value
    expect(values('let a: record{`first-name`: integer} = ▮')).toEqual([]);
  });

  test('the likely values of the spelling tests parse', () => {
    expect(values('let a: tuple<integer> = ▮')).toEqual(['Tuple(0)']);
    expect(values('let a: tuple<> = ▮')).toEqual(['Tuple()']);
    expect(values('function f(m: real, n: integer) { n }\nf(n: ▮)')).toEqual([
      '0',
    ]);
  });

  test('a parameter with a default keeps its type', () => {
    const result = complete('function f(n: integer = 1) { n }\nf(▮)');
    expect(result.expectedType).toBe('integer');
    expect(item(result, 'f')).toMatchObject({ detail: '(integer?)' });
  });

  test('a named argument expects the type of its parameter', () => {
    const result = complete('function f(m: real, n: integer) { n }\nf(n: ▮)');
    expect(result.expectedType).toBe('integer');
    expect(labels(result, 'value')).toEqual(['0']);
  });
});
