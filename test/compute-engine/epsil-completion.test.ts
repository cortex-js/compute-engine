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
    // A comparison and a new statement are not
    for (const source of ['let x = a < ▮', 'let x: integer\nb | ▮'])
      expect(item(complete(source), 'real')?.kind).toBe('library-function');
    // A parameter is a new name or a literal
    expect(labels(complete('function f(x: real, ▮'))).toEqual([
      'false',
      'true',
    ]);
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

describe('EPSIL COMPLETION: ONLY WHAT THE GRAMMAR ADMITS', () => {
  test.each([
    // A name being declared, and the place after it or after its type.
    ['let ▮', []],
    ['const ▮', []],
    ['let a ▮', []],
    ['let a: integer ▮', []],
    ['let a: list<integer> ▮', []],
    ['let (a, ▮', []],
    ['function ▮', []],
    ['function f ▮', []],
    // A parameter of a multi-clause function can be a literal.
    ['function f(▮', ['false', 'true']],
    ['function f(x ▮', []],
    ['function f(x: integer, ▮', ['false', 'true']],
    // The specifier words of a function header.
    ['function f(x) ra▮', ['random']],
    ['function f(x) random sc▮', ['scope']],
    ['function f(x) -> real ▮', []],
    ['type alias ▮', []],
    ['type T = integer ▮', []],
    ['protocol ▮', []],
    ['protocol P { readonly ▮', []],
    ['for ▮', []],
    ['do ▮', []],
    // A keyword that the construct needs next.
    ['for i ▮', ['in']],
    ['for (i, j) ▮', ['in']],
    ['parallel ▮', ['for']],
    ['type ▮', ['alias']],
    ['type T ▮', ['is']],
    ['protocol P ▮', ['extends']],
    ['protocol P { ▮', ['function', 'readonly', 'readwrite']],
    ['if x { 1 } else ▮', ['if']],
    ['if x { 1 } ▮', ['else']],
    ['if x { 1 } else if y { 2 } ▮', ['else']],
    ['if x { 1 } else { 2 } ▮', []],
    ['while x { 1 } ▮', []],
    // After a complete expression on its line.
    ['f(1) ▮', ['if', 'in', 'is']],
    ['let a = 1 ▮', ['if', 'in', 'is']],
    ['a if c ▮', ['else', 'if', 'in', 'is']],
    ['match x { y ▮', ['if']],
    // In a guard, the `if` of the case is not a postfix `if`.
    ['match x { n if n ▮', ['if', 'in', 'is']],
    // The `if` of a statement is not a postfix `if`.
    ['let a = 1\nif a ▮', ['if', 'in', 'is']],
    // A set ends an operand; a type test is an expression.
    ['let s = {1} ▮', ['if', 'in', 'is']],
    ['x is integer ▮', ['if', 'in', 'is']],
    ['let f: (integer) -> real ▮', []],
    ['protocol P { readonly x ▮', []],
    ['continue ▮', []],
    ['let b = x in {1, 2} ▮', ['if', 'in', 'is']],
    // The `>` of a type argument list ends a type, not an operand.
    ['function f(x) -> list<integer> { [x] } ▮', []],
    ['if x is list<integer> { 1 } ▮', ['else']],
    ['if x is list<integer> { 1 } else ▮', ['if']],
    // A literal parameter admits no default value before it.
    ['function f(x: integer = 1, ▮', []],
    ['let a = do { 1 } ▮', ['if', 'in', 'is']],
    ['let is ▮', []],
    ['let a: integer |\n  real ▮', []],
  ])('%j offers %j', (source, expected) => {
    expect(labels(complete(source))).toEqual(expected);
  });

  test.each([
    ['for i ▮', ' L { i }'],
    ['parallel ▮', ' i in L { i }'],
    ['type ▮', ' T = integer'],
    ['protocol P ▮', ' Q {}'],
    ['if x { 1 } ▮', ' { 2 }'],
    ['if x { 1 }\n▮', ' { 2 }'],
    ['let x = 1 if c ▮', ' 2'],
  ])('%j: the keyword offered makes a valid program', (source, rest) => {
    const result = complete(source);
    const keyword = labels(result, 'keyword').find(
      (k) =>
        k === 'in' ||
        k === 'for' ||
        k === 'alias' ||
        k === 'extends' ||
        k === 'else'
    );
    expect(keyword).toBeDefined();
    const program =
      (source.startsWith('protocol P') ? 'protocol Q {}\n' : '') +
      source.replace('▮', keyword! + rest);
    expect(parseEpsil(program)[1]).toEqual([]);
  });

  test('a type test is a type position', () => {
    const result = complete('x is ▮');
    expect(new Set(result.items.map((i) => i.kind))).toEqual(new Set(['type']));
    expect(labels(result)).toContain('integer');
  });

  test('a list of protocols offers the protocols', () => {
    for (const source of [
      'protocol Q {}\ntype integer is ▮',
      'protocol Q {}\ntype integer is Q & ▮',
      'protocol Q {}\nprotocol P extends ▮',
      'protocol Q {}\nprotocol P extends Q, ▮',
    ])
      expect(labels(complete(source))).toEqual(['Q']);
    expect(labels(complete('protocol Q {}\ntype integer is Q ▮'))).toEqual([]);
  });

  test('a case pattern offers no statement or expression keyword', () => {
    for (const source of ['match x { ▮', 'match x {\n  1 => 2\n  ▮']) {
      const keywords = labels(complete(source), 'keyword');
      expect(keywords).toEqual(['false', 'true']);
    }
  });

  test('a member name offers no keyword', () => {
    expect(labels(complete('x.▮'), 'keyword')).toEqual([]);
  });

  test('a new line after an if block also offers `else`', () => {
    const keywords = labels(complete('if x { 1 }\n▮'), 'keyword');
    expect(keywords).toContain('else');
    expect(keywords).toContain('let');
  });

  test('a new line after a declaration is a statement start', () => {
    expect(labels(complete('let a\n▮'), 'keyword')).toContain('let');
  });

  test('the `else` of a postfix conditional takes an expression', () => {
    const result = complete('let c = 1\nlet x = 1 if c else ▮');
    expect(labels(result, 'variable')).toEqual(['c']);
    expect(labels(result, 'keyword')).toContain('match');
  });

  test('a type test also offers the protocols', () => {
    expect(labels(complete('protocol Shape {}\nx is ▮'))).toContain('Shape');
    expect(labels(complete('protocol Shape {}\nlet a: ▮'))).not.toContain(
      'Shape'
    );
  });

  test('a new line after `continue` is a statement start', () => {
    expect(labels(complete('while true {\ncontinue\n▮'), 'keyword')).toContain(
      'let'
    );
  });

  test('the `else` after a set or a `do` block takes an expression', () => {
    for (const source of [
      'let c = 1\nlet a = 1 if x in {1, 2} else ▮',
      'let c = 1\nlet a = 1 if do { true } else ▮',
    ])
      expect(labels(complete(source), 'variable')).toEqual(['c']);
  });

  test('a type test ends at its line', () => {
    expect(labels(complete('x is\n▮'), 'keyword')).toContain('let');
    expect(labels(complete('x\nis ▮'), 'type')).toEqual([]);
  });

  test('a protocol name that needs backticks is inserted with them', () => {
    const result = complete('protocol `type` {}\nprotocol P extends ▮');
    expect(item(result, 'type')?.insertText).toBe('`type`');
  });
});

describe('EPSIL COMPLETION: FIT', () => {
  const fit = (result: EpsilCompletions, label: string) =>
    item(result, label)?.fit;
  const program =
    'const A : matrix = identityMatrix(4)\nconst another = 5\nconst anumber: integer = 3\n';

  test('a result broader than the expected type, or a union with an arm that fits, may fit', () => {
    const result = complete('determinant(▮');
    expect(result.expectedType).toBe('matrix');
    for (const name of [
      'transpose',
      'conjugateTranspose',
      'diagonal',
      'hadamardProduct',
    ])
      expect(fit(result, name)).toBe('maybe');
    expect(item(result, 'adjugateMatrix')).toMatchObject({
      rank: 3,
      fit: 'match',
    });
    // A broadcastable function maps over a matrix (`determinant(abs(A))`),
    // and a call of `isPrime` gives a matrix of booleans at best.
    expect(fit(result, 'abs')).toBe('maybe');
    expect(fit(result, 'tan')).toBe('maybe');
    expect(fit(result, 'isPrime')).toBe('never');
    // A generic result is judged by its bound.
    expect(fit(result, 'reverse')).toBe('maybe');
  });

  test('within a rank, the names that may fit come before those that cannot', () => {
    const result = complete('determinant(▮');
    const rank5 = result.items.filter((i) => i.rank === 5).map((i) => i.fit);
    expect(rank5).toEqual(
      [...rank5].sort(
        (a, b) => (a === 'never' ? 1 : 0) - (b === 'never' ? 1 : 0)
      )
    );
    expect(rank5).toContain('never');
  });

  test('a name of the source with a literal value has the type of the value', () => {
    const result = complete(program + 'inverse(a▮');
    expect(item(result, 'A')).toMatchObject({ rank: 2, fit: 'match' });
    expect(item(result, 'anumber')).toMatchObject({ rank: 4, fit: 'never' });
    expect(item(result, 'another')).toMatchObject({
      rank: 4,
      fit: 'never',
      detail: 'integer',
    });
    // A `let` takes the wider type of a local, which a later assignment
    // keeps.
    const lets = complete('let x = 5\nlet l = [1, 2]\nlet s = "a"\n▮');
    expect(item(lets, 'x')?.detail).toBe('number');
    expect(item(lets, 'l')?.detail).toBe('list<number>');
    expect(item(lets, 's')?.detail).toBe('string');
    expect(item(lets, 'x')?.fit).toBeUndefined();
    // Any other value gives no type.
    expect(item(complete('let y = sin(1)\n▮'), 'y')?.detail).toBeUndefined();
  });

  test('the right side of |> expects a function of the left side', () => {
    const result = complete(program + 'A |> inv▮');
    expect(result.expectedType).toBe('(matrix) -> any');
    expect(item(result, 'inverse')).toMatchObject({ rank: 3, fit: 'match' });
    // A call `inverseFunction(g)` gives a function: `A |> inverseFunction(g)`.
    expect(fit(result, 'inverseFunction')).toBe('maybe');
    // A broadcastable function of a real maps over the matrix.
    expect(fit(result, 'inverseHaversine')).toBe('maybe');
    // `A` is a matrix, not a function.
    expect(fit(complete(program + 'A |> ▮'), 'A')).toBe('never');
  });

  test('a function argument is judged by its signature', () => {
    expect(fit(complete('filter([1, 2], is▮'), 'isPrime')).toBe('match');
    // An unbound type variable may be anything.
    expect(fit(complete('filter(xs, is▮'), 'isPrime')).toBe('maybe');
    const source = complete(
      'function g(m: matrix) -> matrix { m }\nfunction h(a, b) { a }\nconst A: matrix = identityMatrix(2)\nA |> ▮'
    );
    expect(item(source, 'g')).toMatchObject({ rank: 2, fit: 'match' });
    // `h` takes two arguments: `A |> h(b)` is `h(A, b)`.
    expect(fit(source, 'h')).toBe('maybe');
  });

  test('the right side of |> admits a function that takes more arguments', () => {
    const result = complete('[3, 1, 2] |> ▮');
    for (const name of ['take', 'map', 'filter'])
      expect(fit(result, name)).not.toBe('never');
    // With a left side of no static type, the expected type is `function`.
    expect(complete('xs |> ▮').expectedType).toBe('function');
  });

  test('a name of a function type may be called where a value is expected', () => {
    const result = complete(
      'function apply(f: (matrix) -> matrix, A: matrix) { determinant(▮'
    );
    expect(item(result, 'f')).toMatchObject({ rank: 2, fit: 'match' });
  });

  test('a function argument must take the optional arguments of the expected signature', () => {
    const result = complete(
      'function k(f: (real, real?) -> real) { f(1) }\n' +
        'function u(x: real) pure -> real { x }\n' +
        'function o(x: real, y: real = 0) pure -> real { x }\n' +
        'function b(x: real, y: string) pure -> real { x }\n' +
        'k(▮'
    );
    expect(item(result, 'o')).toMatchObject({ rank: 2, fit: 'match' });
    // `u` cannot take a second argument, which `k` may pass.
    expect(fit(result, 'u')).toBe('maybe');
    // The second parameter of `b` does not admit a real, which `k` may pass.
    expect(fit(result, 'b')).toBe('maybe');
  });

  test('a function argument must have the effects that the expected signature admits', () => {
    const result = complete(
      'function k(f: (real) pure -> real) { f(1) }\n' +
        'function p(x: real) pure -> real { x }\n' +
        'function r(x: real) random -> real { x }\n' +
        'function w(x: real) -> real { x }\n' +
        'k(▮'
    );
    expect(fit(result, 'p')).toBe('match');
    expect(fit(result, 'r')).toBe('never');
    // The effects of `w` are not declared.
    expect(fit(result, 'w')).toBe('maybe');
  });

  test('a function whose result may be a function may be called where a function is expected', () => {
    expect(
      fit(
        complete('const A: matrix = identityMatrix(2)\nA |> ▮'),
        'inverseFunction'
      )
    ).not.toBe('never');
    expect(fit(complete('[1, 2] |> ▮'), 'derivative')).not.toBe('never');
    const result = complete(
      'function mk(n: integer) -> function { n }\n' +
        'function z(x: integer) pure -> string { "" }\n' +
        'filter([1, 2], ▮'
    );
    expect(fit(result, 'mk')).toBe('maybe');
    // A string is not a function.
    expect(fit(result, 'z')).toBe('never');
  });

  test('a union with a function arm admits a function', () => {
    const result = complete(
      'function f(x: real) pure -> real { x }\n' +
        'function s(x: string) pure -> real { x }\n' +
        'let cb: function | nothing = ▮'
    );
    expect(fit(result, 'f')).toBe('match');
    const typed = complete(
      'function f(x: real) pure -> real { x }\n' +
        'function s(x: string) pure -> real { 0 }\n' +
        'let cb: ((real) -> real) | nothing = ▮'
    );
    expect(fit(typed, 'f')).toBe('match');
    expect(fit(typed, 's')).toBe('never');
  });

  test('a transparent alias of a signature is unfolded', () => {
    const engine = new ComputeEngine();
    engine.declareType('Predicate', '(integer) pure -> boolean', {
      alias: true,
    });
    const source =
      'function p(x: integer) pure -> boolean { true }\n' +
      'function r(x: integer) random -> boolean { true }\n' +
      'let q: Predicate = ▮';
    const result = epsilCompletions(
      engine,
      source.replace('▮', ''),
      source.indexOf('▮'),
      { typeNames: ['Predicate'] }
    );
    expect(result.expectedType).toBe('Predicate');
    expect(fit(result, 'p')).toBe('match');
    expect(fit(result, 'r')).toBe('never');
  });

  test('a callback of a function with a variadic list of sources may take more arguments', () => {
    const result = complete(
      'function combine(a: integer, b: string) pure -> integer { a }\n' +
        'map(▮, [1, 2], ["x", "y"])'
    );
    expect(fit(result, 'combine')).toBe('maybe');
    // `map` calls `one` with two arguments here.
    expect(
      fit(
        complete(
          'function one(a: integer) pure -> integer { a }\nmap(▮, [1, 2], ["x", "y"])'
        ),
        'one'
      )
    ).toBe('maybe');
    // The type of the callback is bound from the second source, but `xs`
    // may hold strings.
    expect(
      fit(
        complete(
          'function combine(a: string, b: integer) pure -> integer { b }\n' +
            'function run(xs) { map(▮, xs, [1, 2]) }'
        ),
        'combine'
      )
    ).not.toBe('never');
    // `filter` calls its predicate with one argument.
    expect(
      fit(
        complete(
          'function two(a: integer, b: integer) pure -> boolean { true }\nfilter([1, 2], ▮'
        ),
        'two'
      )
    ).toBe('never');
  });

  test('the variadic tail of the expected signature fills the further parameters', () => {
    const result = complete(
      'function k(f: (integer+) -> boolean) { f(1) }\n' +
        'function run(h: (integer, string*) -> boolean, g: (integer*) -> boolean) { k(▮'
    );
    // A call `h(1, 2)` passes an integer to `string*`.
    expect(fit(result, 'h')).toBe('maybe');
    expect(fit(result, 'g')).toBe('match');
  });

  test('a union of function types matches only when each arm does', () => {
    const result = complete(
      'function t(p: ((integer) any -> boolean) | ((string) any -> boolean)) { filter([1, 2], ▮'
    );
    expect(fit(result, 'p')).toBe('maybe');
  });

  test('an operand of a broadcastable operator admits a list', () => {
    const result = complete('const A: matrix = identityMatrix(2)\nA * ▮');
    expect(fit(result, 'A')).not.toBe('never');
  });

  test('a keyword and a likely value have no fit', () => {
    const result = complete('let a: integer = ▮');
    expect(fit(result, '0')).toBeUndefined();
    expect(fit(result, 'if')).toBeUndefined();
    expect(fit(complete('let b = ▮'), 'sin')).toBeUndefined();
  });
});

describe('EPSIL COMPLETION: MEMBERS', () => {
  const SHAPES = `protocol Shape {
  function area(self: Self) -> number
  function scale(self: Self, k: number) -> Self
}
protocol Labeled extends Shape { readonly label: string }
type Circle = tuple<r: number> is Shape {
  function area(self: Circle) -> number { Pi * self.r^2 }
  function scale(self: Circle, k: number) -> Circle { Circle(self.r * k) }
}
type Tag = record{name: string} is Labeled {
  function area(self: Tag) -> number { 0 }
  function scale(self: Tag, k: number) -> Tag { self }
  get label(self) -> string { self.name }
}
const c: Circle = Circle(1)
const p: record{x: real, y: real, tag: string} = {x -> 1, y -> 2, tag -> "a"}
`;

  test('a tuple lists its named elements and its protocol functions', () => {
    const result = complete(SHAPES + 'c.▮');
    expect(result.items.map((i) => [i.label, i.kind, i.detail, i.insertText]))
      .toMatchInlineSnapshot(`
      [
        [
          "area",
          "function",
          "() -> number",
          "area()",
        ],
        [
          "r",
          "variable",
          "number",
          undefined,
        ],
        [
          "scale",
          "function",
          "(k: number) -> Circle",
          undefined,
        ],
      ]
    `);
  });

  test('a record lists its fields, with their types', () => {
    const result = complete(SHAPES + 'p.▮');
    expect(result.items.map((i) => [i.label, i.detail])).toEqual([
      ['tag', 'string'],
      ['x', 'real'],
      ['y', 'real'],
    ]);
  });

  test('the word after the dot filters the members', () => {
    expect(labels(complete(SHAPES + 'p.t▮'))).toEqual(['tag']);
  });

  test('a readonly property of a protocol, and the members of its parents', () => {
    const result = complete(SHAPES + 'const t: Tag = Tag({name -> "a"})\nt.▮');
    expect(result.items.map((i) => [i.label, i.detail])).toEqual([
      ['area', '() -> number'],
      ['label', 'string'],
      ['name', 'string'],
      ['scale', '(k: number) -> Tag'],
    ]);
  });

  test('a conformance of a primitive type', () => {
    const result = complete(
      'protocol Signed { readonly sign: string }\n' +
        'type number is Signed {\n' +
        '  get sign(self) -> string { if (self < 0) { "-" } else { "+" } }\n' +
        '}\n' +
        'let x = -12\nx.▮'
    );
    expect(result.items.map((i) => [i.label, i.detail])).toEqual([
      ['sign', 'string'],
    ]);
  });

  test('a chain reads the type of the field before the dot', () => {
    const result = complete(
      'const a: record{b: record{u: integer, v: string}} = {b -> {u -> 1, v -> "s"}}\na.b.▮'
    );
    expect(result.items.map((i) => [i.label, i.detail])).toEqual([
      ['u', 'integer'],
      ['v', 'string'],
    ]);
  });

  test('a receiver whose type is not known has no items', () => {
    expect(complete('let q = f(3)\nq.▮').items).toEqual([]);
    expect(complete('zz.▮').items).toEqual([]);
  });

  test('before `(`, a function member is inserted as its name', () => {
    expect(item(complete(SHAPES + 'c.ar▮()'), 'area')?.insertText).toBe(
      undefined
    );
  });

  test('a member in an argument fits the type of the parameter', () => {
    // `sqrt` takes `complex | infinity`, which `number` (with `NaN`) is not
    // a subtype of.
    const sqrt = complete(SHAPES + 'sqrt(c.▮');
    expect(sqrt.expectedType).toBe('complex | infinity');
    expect(item(sqrt, 'area')?.fit).toBe('maybe');
    expect(item(sqrt, 'scale')?.fit).toBe('never');
    const h = complete(SHAPES + 'function h(x: number) -> number { x }\nh(c.▮');
    expect(h.expectedType).toBe('number');
    expect(item(h, 'area')?.fit).toBe('match');
    expect(item(h, 'r')?.fit).toBe('match');
    expect(item(h, 'scale')?.fit).toBe('never');
  });

  const members = (source: string) =>
    complete(source).items.map((i) => [i.label, i.detail]);

  test('an object type lists its fields, and its protocol properties', () => {
    const PERSON =
      'type Person = object{first: string, last: string}\n' +
      'const p: Person = Person(first: "a", last: "b")\n';
    expect(members(PERSON + 'p.▮')).toEqual([
      ['first', 'string'],
      ['last', 'string'],
    ]);
    expect(
      members(
        'protocol Nameable { readwrite name: string }\n' +
          'type Person = object{first: string, last: string} is Nameable {\n' +
          '  get name(self) -> string { self.first }\n' +
          '  set name(self, v: string) { }\n' +
          '}\n' +
          'const p: Person = Person(first: "a", last: "b")\np.▮'
      )
    ).toEqual([
      ['first', 'string'],
      ['last', 'string'],
      ['name', 'string'],
    ]);
  });

  test('a nominal type over a conforming type does not conform', () => {
    // `w.area()` is `protocol-implementation-missing`; the layout is read
    // through the nominal type.
    expect(
      members(
        'protocol Shape { function area(self: Self) -> number }\n' +
          'type Circle = tuple<r: number> is Shape {\n' +
          '  function area(self: Circle) -> number { self.r }\n' +
          '}\n' +
          'type Wrapped = Circle\n' +
          'const w: Wrapped = Wrapped(Circle(1))\nw.▮'
      )
    ).toEqual([['r', 'number']]);
  });

  test('a transparent alias inherits the conformance of a supertype', () => {
    expect(
      members(
        'protocol Signed { readonly sign: string }\n' +
          'type number is Signed {\n' +
          '  get sign(self) -> string { "+" }\n' +
          '}\n' +
          'type alias Scalar = real\n' +
          'const s: Scalar = 2\ns.▮'
      )
    ).toEqual([['sign', 'string']]);
  });

  test('a conditional conformance applies when the clause holds', () => {
    const SUMMABLE =
      'protocol Summable { function total(self: Self) -> number }\n' +
      'type list<T> is Summable where T: number {\n' +
      '  function total(self: Self) -> number { sum(self) }\n' +
      '}\n' +
      'const xs: list<real> = [1, 2]\n' +
      'const ys: list<string> = ["a"]\n';
    expect(members(SUMMABLE + 'xs.▮')).toEqual([['total', '() -> number']]);
    expect(members(SUMMABLE + 'ys.▮')).toEqual([]);
  });

  test('a call of a field that holds a function', () => {
    expect(
      members(
        'function mk() -> record{x: integer} { {x -> 1} }\n' +
          'const r: record{make: () -> record{x: integer}} = {make -> mk}\n' +
          'r.make().▮'
      )
    ).toEqual([['x', 'integer']]);
  });

  test('a variant of a sum type has its payload and its conformances', () => {
    expect(
      members(
        'protocol Area { function area(self: Self) -> number }\n' +
          'type shape = circle(r: number) | square(s: number)\n' +
          'type shape is Area {\n' +
          '  function area(self: Self) -> number {\n' +
          '    match self {\n' +
          '      circle(r) => 3 * r * r\n' +
          '      square(s) => s * s\n' +
          '    }\n' +
          '  }\n' +
          '}\n' +
          'const q: square = square(3)\nq.▮'
      )
    ).toEqual([
      ['area', '() -> number'],
      ['s', 'number'],
    ]);
  });

  test('a function that two protocols declare is left out', () => {
    // `t.f()` is `protocol-call-ambiguous`.
    expect(
      members(
        'protocol A { function f(self: Self) -> number }\n' +
          'protocol B { function f(self: Self) -> string }\n' +
          'type T = tuple<v: number> is A & B\n' +
          'type T is A { function f(self: Self) -> number { 1 } }\n' +
          'type T is B { function f(self: Self) -> string { "a" } }\n' +
          'const t: T = T(1)\nt.▮'
      )
    ).toEqual([['v', 'number']]);
  });

  test('a function that two protocols declare is left out, also when one target is more specific', () => {
    // `x.f()` is 2: the engine takes the conformance of `integer`.
    expect(
      members(
        'protocol A { function f(self: Self) -> number }\n' +
          'protocol B { function f(self: Self) -> number }\n' +
          'type number is A { function f(self: Self) -> number { 1 } }\n' +
          'type integer is B { function f(self: Self) -> number { 2 } }\n' +
          'const x: integer = 3\nx.▮'
      )
    ).toEqual([]);
  });

  test('a function inherited through a parent protocol counts its declaring protocol', () => {
    // `x.f()` is `protocol-call-ambiguous`.
    expect(
      members(
        'protocol A { function f(self: Self) -> number }\n' +
          'protocol B { function f(self: Self) -> number }\n' +
          'protocol C extends A {}\n' +
          'type number is A { function f(self: Self) -> number { 1 } }\n' +
          'type number is B { function f(self: Self) -> number { 2 } }\n' +
          'type integer is C\n' +
          'const x: integer = 3\nx.▮'
      )
    ).toEqual([]);
  });

  test('a function reached directly and through a child protocol has one owner', () => {
    // `t.f()` is 1: `C` adds no declaration of `f`.
    expect(
      members(
        'protocol A { function f(self: Self) -> number }\n' +
          'protocol C extends A {}\n' +
          'type T = tuple<v: number>\n' +
          'type T is A { function f(self: Self) -> number { 1 } }\n' +
          'type T is C\n' +
          'const t: T = T(1)\nt.▮'
      )
    ).toEqual([
      ['f', '() -> number'],
      ['v', 'number'],
    ]);
  });

  test('a name that is a property of one protocol and a function of another is the property', () => {
    const SOURCE =
      'protocol A { function label(self: Self) -> number }\n' +
      'protocol B { readonly label: string }\n' +
      'type T = tuple<v: number>\n' +
      'type T is A { function label(self: Self) -> number { 1 } }\n' +
      'type T is B { get label(self) -> string { "b" } }\n' +
      'const t: T = T(1)\n';
    expect(
      executeEpsil(new ComputeEngine(), SOURCE + 't.label').value.json
    ).toBe("'b'");
    const result = complete(SOURCE + 't.▮');
    expect(result.items.map((i) => [i.label, i.kind, i.detail])).toEqual([
      ['label', 'variable', 'string'],
      ['v', 'variable', 'number'],
    ]);
  });

  test('a property that two protocols declare is left out', () => {
    // `t.label` is `protocol-property-ambiguous`.
    expect(
      members(
        'protocol A { readonly label: string }\n' +
          'protocol B { readonly label: string }\n' +
          'type T = tuple<v: number>\n' +
          'type T is A { get label(self) -> string { "a" } }\n' +
          'type T is B { get label(self) -> string { "b" } }\n' +
          'const t: T = T(1)\nt.▮'
      )
    ).toEqual([['v', 'number']]);
  });

  test('a clause that names a protocol holds through a conformance', () => {
    // `xs.total()` is 3; `ys.total()` is `protocol-implementation-missing`.
    const SUMMABLE =
      'protocol P { function g(self: Self) -> number }\n' +
      'protocol S { function total(self: Self) -> number }\n' +
      'type real is P { function g(self: Self) -> number { 1 } }\n' +
      'type list<T> is S where T is P {\n' +
      '  function total(self: Self) -> number { sum(self) }\n' +
      '}\n' +
      'const xs: list<real> = [1, 2]\n' +
      'const ys: list<string> = ["a"]\n';
    expect(members(SUMMABLE + 'xs.▮')).toEqual([['total', '() -> number']]);
    expect(members(SUMMABLE + 'ys.▮')).toEqual([]);
  });
});

describe('EPSIL COMPLETION: SNIPPETS', () => {
  const snippet = (source: string, label: string) =>
    item(complete(source), label)?.snippet;

  /** Whether `text` is one line with no `{`, `}`, `$`, `#` or `\` outside
   * its fields `${n:…}` and `${0}`. */
  function isSafeSnippet(text: string): boolean {
    if (/[\n\r\u2028\u2029]/.test(text)) return false;
    const rest = text.replace(/\$\{[1-9]\d*:[^{}$#\\]*\}|\$\{0\}/g, '');
    return !/[{}$#\\]/.test(rest);
  }

  test('a library function has one field per required parameter', () => {
    expect(snippet('tak▮', 'take')).toBe('take(${1:xs}, ${2:count})${0}');
    expect(item(complete('tak▮'), 'take')?.insertText).toBeUndefined();
  });

  test('an optional parameter has no field', () => {
    expect(snippet('function g(a: real, b: integer = 2) { a }\ng▮', 'g')).toBe(
      'g(${1:a})${0}'
    );
  });

  test('a function with no required parameter has no snippet', () => {
    expect(item(complete('function z() { 1 }\nz▮'), 'z')).not.toHaveProperty(
      'snippet'
    );
    const SHAPE =
      'protocol Shape { function area(self: Self) -> number }\n' +
      'type Sq = tuple<s: number> is Shape {\n' +
      '  function area(self: Sq) -> number { self.s^2 }\n' +
      '}\n' +
      'const q: Sq = Sq(1)\nq.▮';
    const area = item(complete(SHAPE), 'area');
    expect(area?.insertText).toBe('area()');
    expect(area).not.toHaveProperty('snippet');
  });

  test('before `(`, no snippet', () => {
    expect(snippet('tak▮(xs, 2)', 'take')).toBeUndefined();
    expect(snippet('tak▮ \t(xs, 2)', 'take')).toBeUndefined();
    expect(snippet('tak▮\n(xs, 2)', 'take')).toBe(
      'take(${1:xs}, ${2:count})${0}'
    );
  });

  test('where a function value is expected, no snippet', () => {
    expect(
      snippet(
        'function k(f: (real) -> real) { f(1) }\n' +
          'function p(x: real) { x }\nk(p▮)',
        'p'
      )
    ).toBeUndefined();
    expect(snippet('filter([1, 2], isPr▮', 'isPrime')).toBeUndefined();
    expect(
      item(complete('let g: (real) -> real = (x) -> x\ng▮'), 'g')
    ).not.toHaveProperty('snippet');
  });

  test('a function defined several times', () => {
    expect(
      snippet(
        'function f(x: real) { x }\nfunction f(x: real, y: real) { x+y }\nf▮',
        'f'
      )
    ).toBeUndefined();
    expect(
      snippet('function f(x: real) { x }\nfunction f(y: string) { y }\nf▮', 'f')
    ).toBe('f(${1:x})${0}');
  });

  test('after `|>`, the field of the piped value is left out', () => {
    const XS = 'const xs: list<integer> = [1, 2]\n';
    expect(snippet(XS + 'xs |> tak▮', 'take')).toBe('take(${1:count})${0}');
    // `xs |> fold(f, initial)` is `fold(f, initial, xs)`
    expect(snippet(XS + 'xs |> fol▮', 'fold')).toBe(
      'fold(${1:reducer}, ${2:initial})${0}'
    );
    // `[1, 2] |> map(f)` is `map(f, [1, 2])`: the collection is the rest
    // parameter, which has no field
    expect(snippet('[1, 2] |> ma▮', 'map')).toBe('map(${1:mapping})${0}');
    // With no static type of the piped value, the slot is not known
    expect(snippet('ys |> tak▮', 'take')).toBeUndefined();
    const h = item(complete('function h(x: real) { x }\n3 |> h▮'), 'h');
    expect(h).not.toHaveProperty('snippet');
    expect(h?.insertText).toBeUndefined();
  });

  test('in a call after `|>`, the piped value fills a slot', () => {
    // `1..10 |> filter(p)` is `filter(1..10, p)`
    const filtered = item(complete('1..10 |> filter(isPr▮)'), 'isPrime');
    expect(filtered).not.toHaveProperty('snippet');
    expect(filtered?.fit).toBe('match');
    // `[1, 2] |> map(f)` is `map(f, [1, 2])`
    expect(snippet('[1, 2] |> map(isPr▮)', 'isPrime')).toBeUndefined();
    expect(complete('[1, 2] |> map(isPr▮)').expectedType).toBe('(T) any -> U');
    // `Take` is an overload set, `Quantile` has one signature
    expect(complete('[0.1, 0.5] |> quantile(▮').expectedType).toBe(
      'real<0..1>'
    );
    expect(complete('[0.1, 0.5] |> quantile(_, ▮').expectedType).toBe(
      'real<0..1>'
    );
    expect(complete('[0.1, 0.5] |> quantile(▮, 0.5)').expectedType).toBe(
      'collection<any> | distribution'
    );
    const K =
      'function k(n: integer, f: (real) -> real) { f(n) }\n' +
      'function p(x: real) { x }\n';
    expect(complete(K + '3 |> k(▮').expectedType).toBe('(real) -> real');
    expect(snippet(K + '3 |> k(p▮)', 'p')).toBeUndefined();
    // With no static type of the piped value, the slot is not known
    expect(complete('xs |> quantile(▮').expectedType).toBeUndefined();
  });

  test('an alias of a function type, or an optional callback, is passed', () => {
    const P = 'function p(x: real) { x }\n';
    expect(
      snippet(
        P + 'type alias F = (real) -> real\nfunction k(f: F) { f(1) }\nk(p▮)',
        'p'
      )
    ).toBeUndefined();
    expect(
      snippet(P + 'let g: ((real) -> real) | nothing = p▮', 'p')
    ).toBeUndefined();
    expect(snippet(P + 'let g: ((real) -> real) | real = p▮', 'p')).toBe(
      'p(${1:x})${0}'
    );
  });

  test('a protocol function member leaves out its receiver', () => {
    const SHAPE =
      'protocol Shape { function scale(self: Self, k: number) -> Self }\n' +
      'type Sq = tuple<s: number> is Shape {\n' +
      '  function scale(self: Sq, k: number) -> Sq { Sq(self.s * k) }\n' +
      '}\n' +
      'const q: Sq = Sq(1)\n';
    expect(snippet(SHAPE + 'q.▮', 'scale')).toBe('scale(${1:k})${0}');
    expect(snippet(SHAPE + 'q.sc▮()', 'scale')).toBeUndefined();
    expect(snippet(SHAPE + 'q.sc▮ (2)', 'scale')).toBeUndefined();
  });

  test('a variant constructor has a field per payload element', () => {
    const source = 'type shape = circle(r: real) | sq(real, real) | dot\n';
    expect(snippet(source + 'let a = ▮', 'circle')).toBe('circle(${1:r})${0}');
    expect(snippet(source + 'let a = ▮', 'sq')).toBe(
      'sq(${1:real}, ${2:real})${0}'
    );
    expect(item(complete(source + 'let a = ▮'), 'dot')).not.toHaveProperty(
      'snippet'
    );
  });

  test('two parameters of the same name have distinct numbers', () => {
    expect(snippet('function d(x: real, x: real) { x }\nd▮', 'd')).toBe(
      'd(${1:x}, ${2:x})${0}'
    );
  });

  test('a type with braces as the default text gives way to `arg<n>`', () => {
    const source =
      'protocol Moves { function shift(self: Self, record{x: real}) -> Self }\n' +
      'type Pt = tuple<x: real> is Moves {\n' +
      '  function shift(self: Pt, d: record{x: real}) -> Pt { self }\n' +
      '}\n' +
      'const p: Pt = Pt(1)\np.▮';
    expect(snippet(source, 'shift')).toBe('shift(${1:arg1})${0}');
  });

  test('an overload set whose arities differ has no snippet', () => {
    // `slice(value, span)` and `slice(value, start, end)`
    expect(item(complete('sli▮'), 'slice')).not.toHaveProperty('snippet');
  });

  test('every snippet is one line with no stray field characters', () => {
    for (const source of ['▮', 'take(▮'])
      for (const { snippet } of complete(source).items)
        if (snippet !== undefined)
          expect([snippet, isSafeSnippet(snippet)]).toEqual([snippet, true]);
    expect(isSafeSnippet('f(${1:record{x: real}})${0}')).toBe(false);
  });
});
