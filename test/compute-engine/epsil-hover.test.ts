import { ComputeEngine } from '../../src/compute-engine';
import {
  epsilDefinition as entryDefinition,
  epsilHover as entryHover,
} from '../../src/epsil';
import {
  epsilDefinition,
  epsilHover,
  type EpsilDefinition,
  type EpsilHover,
} from '../../src/epsil/hover';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const ce = new ComputeEngine();

type Options = Parameters<typeof epsilHover>[3];

/** The hover at the `▮` of `source`. */
function hover(source: string, options?: Options): EpsilHover | null {
  const offset = source.indexOf('▮');
  return epsilHover(ce, source.replace('▮', ''), offset, options);
}

/** The definition of the name at the `▮` of `source`, as the text of its
 * two ranges. */
function definition(
  source: string,
  options?: Options
): { name: string; header: string } | null {
  const offset = source.indexOf('▮');
  const text = source.replace('▮', '');
  const result: EpsilDefinition | null = epsilDefinition(
    ce,
    text,
    offset,
    options
  );
  return result === null
    ? null
    : {
        name: text.slice(...result.name),
        header: text.slice(...result.header),
      };
}

const F = `/// Twice the sine.
function f(x: real) -> real { 2 * sin(x) }
let y = f(1)
`;

describe('EPSIL HOVER: LIBRARY NAMES', () => {
  test('a library function, by its Epsil spelling', () => {
    expect(hover(F.replace('sin(x)', 's▮in(x)'))).toEqual({
      range: [54, 57],
      name: 'sin',
      kind: 'library-function',
      detail: '(complex | quantity) -> number',
      description: ['Sine of an angle.'],
      reference: 'https://epsil.dev/reference/trigonometry/#sin',
    });
  });

  test('the MathJSON name of a library function', () => {
    const result = hover('S▮in(1)');
    expect(result?.name).toBe('Sin');
    expect(result?.kind).toBe('library-function');
    expect(result?.description).toEqual(['Sine of an angle.']);
  });

  test('a library constant, also written as a glyph', () => {
    const result = hover('2 * p▮i');
    expect(result?.kind).toBe('library-constant');
    expect(result?.range).toEqual([4, 6]);
    expect(result?.reference).toBe(
      'https://epsil.dev/reference/trigonometry/#pi'
    );
    const glyph = hover('2 * ▮π');
    expect(glyph?.name).toBe('π');
    expect(glyph?.kind).toBe('library-constant');
    expect(glyph?.description).toEqual(result?.description);
  });

  test('a qualified name is the library name, whatever the source binds', () => {
    const result = hover('let sin = 5\nstd::s▮in(1)');
    expect(result?.kind).toBe('library-function');
    expect(result?.name).toBe('sin');
    expect(hover('▮std::sin(1)')).toBeNull();
    expect(hover('std::n▮osuch(1)')).toBeNull();
    // The verbatim form names the raw symbol `pi`, which is not a library
    // name: the program gives the error `not-a-library-name`.
    expect(hover('std::`p▮i`')).toBeNull();
    expect(hover('std::`P▮i`')?.kind).toBe('library-constant');
  });

  test('a qualified name is the library name, whatever the engine binds', () => {
    const engine = new ComputeEngine();
    executeEpsil(engine, 'let e = 5');
    expect(epsilHover(engine, 'e + 1', 0)).toMatchObject({
      kind: 'variable',
      detail: 'number',
    });
    expect(epsilHover(engine, 'std::e + 1', 5)).toEqual(
      epsilHover(ce, 'std::e + 1', 5)
    );
    expect(epsilHover(engine, 'std::e + 1', 5)).toMatchObject({
      range: [5, 6],
      name: 'e',
      kind: 'library-constant',
      reference: 'https://epsil.dev/reference/arithmetic/#e',
    });
  });

  test('a name in an interpolation hole of a string is code', () => {
    const source = 'let x: real = 2\n"twice sin: \\(2 * sin(x))"';
    const call = source.indexOf('sin(x)');
    expect(epsilHover(ce, source, call)).toMatchObject({
      range: [call, call + 3],
      name: 'sin',
      kind: 'library-function',
    });
    const use = source.indexOf('x))');
    expect(epsilHover(ce, source, use)).toEqual({
      range: [use, use + 1],
      name: 'x',
      kind: 'variable',
      detail: 'real',
    });
    expect(epsilDefinition(ce, source, use)).toEqual({
      name: [4, 5],
      header: [0, 15],
    });
    // The text of the string is not code.
    expect(epsilHover(ce, source, source.indexOf('sin:'))).toBeNull();
    // Strings nested in holes past the nesting limit of the parser do not
    // stop the functions.
    const deep = `let a = 1\n${'"\\('.repeat(5000)}a${')"'.repeat(5000)}`;
    expect(epsilHover(ce, deep, 4)?.kind).toBe('variable');
    expect(epsilDefinition(ce, deep, deep.indexOf('a)'))).toBeNull();
  });

  test('the name is the token that contains the offset or ends at it', () => {
    expect(hover('▮sin(1)')?.range).toEqual([0, 3]);
    expect(hover('sin▮(1)')?.range).toEqual([0, 3]);
    expect(hover('sin(▮1)')).toBeNull();
  });
});

describe('EPSIL HOVER: NAMES OF THE SOURCE', () => {
  test('a function has its signature and its doc comment', () => {
    const expected = {
      name: 'f',
      kind: 'function',
      detail: '(real) -> real',
      description: ['Twice the sine.'],
    };
    expect(hover(F.replace('f(1)', '▮f(1)'))).toEqual({
      range: [71, 72],
      ...expected,
    });
    // At the name in the definition.
    expect(hover(F.replace('f(x', '▮f(x'))).toEqual({
      range: [29, 30],
      ...expected,
    });
  });

  test('a parameter and a typed variable have their declared type', () => {
    expect(hover(F.replace('sin(x)', 'sin(▮x)'))).toEqual({
      range: [58, 59],
      name: 'x',
      kind: 'variable',
      detail: 'real',
    });
    expect(hover('let count: integer = 3\nc▮ount + 1')).toEqual({
      range: [23, 28],
      name: 'count',
      kind: 'variable',
      detail: 'integer',
    });
  });

  test('a variable with no declared type has no detail', () => {
    expect(hover(F.replace('let y', 'let ▮y'))).toEqual({
      range: [67, 68],
      name: 'y',
      kind: 'variable',
    });
  });

  test('a name of the source shadows a library name', () => {
    const result = hover('let sin = (t) => t + 1\ns▮in(2)');
    expect(result).toEqual({ range: [23, 26], name: 'sin', kind: 'variable' });
  });

  test('a type of the source, in an annotation and as a constructor', () => {
    const source =
      'type point = tuple<x: real, y: real>\nlet p: point = point(1, 2)';
    const expected = {
      name: 'point',
      kind: 'type',
      detail: 'tuple<x: real, y: real>',
    };
    expect(hover(source.replace('p: point', 'p: ▮point'))).toMatchObject(
      expected
    );
    expect(hover(source.replace('point(1', '▮point(1'))).toMatchObject(
      expected
    );
  });

  test('the variable of a library call is a variable of that call', () => {
    // `i` alone is the imaginary unit; in the sum it is the index.
    expect(hover('▮i')?.kind).toBe('library-constant');
    expect(hover('sum(▮i^2, i, 1, 3)')).toEqual({
      range: [4, 5],
      name: 'i',
      kind: 'variable',
    });
  });

  test('a variant of a sum type is a function', () => {
    const source = 'type shape = square(real) | disk\nlet s = square(2)';
    expect(hover(source.replace('= square(2)', '= ▮square(2)'))).toEqual({
      range: [41, 47],
      name: 'square',
      kind: 'function',
      detail: '(real) -> shape',
    });
    // A variant known only from the options has an unknown payload.
    expect(
      hover('let c = ▮red()', { sumVariants: { red: 'color' } })
    ).toMatchObject({ kind: 'function', detail: 'color' });
  });

  test('a function member of a protocol declared above the name', () => {
    const source =
      'protocol Sized { function area(self: Self) -> real }\narea(3)';
    expect(hover(source.replace('area(3)', '▮area(3)'))).toEqual({
      range: [53, 57],
      name: 'area',
      kind: 'function',
      detail: '(self: Self) -> real',
    });
  });

  test('the options name the types that the source does not declare', () => {
    const source = 'let a: Money = 1\n▮a';
    expect(hover(source)).toBeNull();
    expect(hover(source, { typeNames: ['Money'] })).toMatchObject({
      kind: 'variable',
      detail: 'Money',
    });
  });
});

describe('EPSIL HOVER: KEYWORDS', () => {
  test('a reserved word', () => {
    expect(hover('▮for i in [1, 2] { i }')).toEqual({
      range: [0, 3],
      name: 'for',
      kind: 'keyword',
    });
    expect(hover('for i ▮in [1, 2] { i }')?.kind).toBe('keyword');
    expect(hover('let a = ▮true')?.kind).toBe('keyword');
  });

  test('a contextual word is a keyword at the head of its statement only', () => {
    expect(hover('▮let a = 1')?.kind).toBe('keyword');
    expect(hover('▮type point = tuple<real, real>')?.kind).toBe('keyword');
    expect(hover('▮parallel for i in [1, 2] { i }')?.kind).toBe('keyword');
    expect(hover('let type = 3\n▮type + 1')).toEqual({
      range: [13, 17],
      name: 'type',
      kind: 'variable',
      detail: 'number',
    });
  });

  test('a verbatim name is not a keyword', () => {
    expect(hover('let `while` = 1\n`whi▮le` + 1')).toEqual({
      range: [16, 23],
      name: 'while',
      kind: 'variable',
      detail: 'number',
    });
  });
});

describe('EPSIL HOVER: NO NAME', () => {
  test('a string, a comment, a LaTeX island, a number and a blank', () => {
    expect(hover('let s = "the s▮in"')).toBeNull();
    expect(hover('let a = 1 // the s▮in')).toBeNull();
    expect(hover(F.replace('the sine', 'the s▮ine'))).toBeNull();
    expect(hover('let m = $s▮in(x)$')).toBeNull();
    expect(hover('let a = 1▮2')).toBeNull();
    expect(hover('let a = 1\n▮\nlet b = 2')).toBeNull();
    expect(hover('▮')).toBeNull();
  });

  test('a name that nothing defines', () => {
    expect(hover('nos▮uch + 1')).toBeNull();
    // The verbatim form names the raw symbol, not the library function.
    expect(hover('`s▮in`')).toBeNull();
  });

  test('a name that is not a use of a binding', () => {
    // `real` is a type here, not the library function `real`.
    expect(hover('function g(x: r▮eal) { x }')).toBeNull();
    // A field name, with a variable of the same name, and a field label in
    // a type.
    const source =
      'let x = 1\nfunction g(p: tuple<x: real, y: real>) { p.x + x }';
    expect(hover(source.replace('p.x', 'p.▮x'))).toBeNull();
    expect(hover(source.replace('<x: real', '<▮x: real'))).toBeNull();
    expect(hover(source.replace('+ x }', '+ ▮x }'))?.kind).toBe('variable');
    // The label of a named argument of a library function.
    expect(hover('let base = 2\nlog(8, ▮base: 2)')).toBeNull();
  });

  test('an offset outside the source is moved to its nearest end', () => {
    expect(epsilHover(ce, 'sin', 99)?.name).toBe('sin');
    expect(epsilHover(ce, 'sin', -5)?.name).toBe('sin');
  });
});

describe('EPSIL HOVER: THE ENGINE', () => {
  test('a name that an earlier program declared', () => {
    const engine = new ComputeEngine();
    executeEpsil(
      engine,
      '/// Half of a number.\nfunction half(a: real) -> real { a / 2 }\nlet sin = 5'
    );
    expect(epsilHover(engine, 'half(3)', 1)).toEqual({
      range: [0, 4],
      name: 'half',
      kind: 'function',
      detail: '(a: real) -> real',
      description: ['Half of a number.'],
    });
    // The engine's `sin` shadows the library function, as when the program
    // runs; the qualified name is still the library function.
    expect(epsilHover(engine, 'sin + 1', 1)?.kind).toBe('variable');
    expect(epsilHover(engine, 'std::sin(1)', 6)?.kind).toBe(
      'library-function'
    );
  });

  test('the source is not evaluated and declares nothing in the engine', () => {
    const engine = new ComputeEngine();
    const source = 'let a = 2\nlimit(sin(h)/h, 0) + a + b';
    expect(epsilHover(engine, source, source.indexOf('h)'))?.kind).toBe(
      'variable'
    );
    expect(epsilDefinition(engine, source, source.indexOf('a + b'))).toEqual({
      name: [4, 5],
      header: [0, 9],
    });
    for (const name of ['a', 'b', 'h'])
      expect(engine.lookupDefinition(name)).toBeUndefined();
  });
});

describe('EPSIL DEFINITION', () => {
  test('a function gives its name and its header', () => {
    expect(epsilDefinition(ce, F, F.indexOf('f(1)'))).toEqual({
      name: [29, 30],
      header: [20, 48],
    });
    expect(definition(F.replace('f(1)', '▮f(1)'))).toEqual({
      name: 'f',
      header: 'function f(x: real) -> real ',
    });
    // At the name in the definition.
    expect(definition(F.replace('f(x', '▮f(x'))?.name).toBe('f');
  });

  test('a function with several clauses gives its first clause', () => {
    const source =
      'function fact(0) { 1 }\nfunction fact(n: integer) { n * fact(n - 1) }';
    expect(epsilDefinition(ce, source, source.indexOf('fact(n - 1)'))).toEqual({
      name: [9, 13],
      header: [0, 17],
    });
  });

  test('a variable gives its statement', () => {
    expect(definition('let a = 1\nlet b = ▮a + 1')).toEqual({
      name: 'a',
      header: 'let a = 1',
    });
    // A first assignment declares.
    expect(definition('a = 1\na = 2\n▮a')).toEqual({
      name: 'a',
      header: 'a = 1',
    });
    expect(definition('let (a, b) = (1, 2)\n▮b')).toEqual({
      name: 'b',
      header: 'let (a, b) = (1, 2)',
    });
  });

  test('a parameter, a loop variable and a pattern variable', () => {
    expect(epsilDefinition(ce, F, F.indexOf('x) }'))).toEqual({
      name: [31, 32],
      header: [31, 32],
    });
    expect(definition('for i in [1, 2] { ▮i }')).toEqual({
      name: 'i',
      header: 'i in [1, 2]',
    });
    expect(definition('match (0, 2) { (0, u) => ▮u, _ => 0 }')).toEqual({
      name: 'u',
      header: 'u',
    });
  });

  test('a type gives its statement', () => {
    expect(
      definition('type point = tuple<x: real, y: real>\nlet p: ▮point = (1, 2)')
    ).toEqual({ name: 'point', header: 'type point = tuple<x: real, y: real>' });
  });

  test('the label of a named argument is the parameter', () => {
    const source =
      'let n = 1\nfunction g(x: real, n: integer = 2) { x }\ng(1, n: 3)';
    const label = source.indexOf('n: 3');
    expect(epsilHover(ce, source, label)).toEqual({
      range: [label, label + 1],
      name: 'n',
      kind: 'variable',
      detail: 'integer',
    });
    expect(epsilDefinition(ce, source, label)).toEqual({
      name: [30, 31],
      header: [30, 31],
    });
  });

  test('a use reads the innermost binding of its name', () => {
    const source = 'let x = 10\nfunction g(x: integer) { x + 1 }\nx';
    // In the body, the parameter.
    expect(epsilDefinition(ce, source, source.indexOf('x + 1'))).toEqual({
      name: [22, 23],
      header: [22, 23],
    });
    // At the top level, the variable.
    expect(epsilDefinition(ce, source, source.length)).toEqual({
      name: [4, 5],
      header: [0, 10],
    });
  });

  test('the variable of a library call has no declaration', () => {
    const source = 'let k = 4\nsum(k^2, k, 1, 3) + k';
    expect(epsilDefinition(ce, source, source.indexOf('k^2'))).toBeNull();
    expect(epsilDefinition(ce, source, source.length)).toEqual({
      name: [4, 5],
      header: [0, 9],
    });
  });

  test('no declaration in the source', () => {
    // A library name, a keyword, an unknown name, a blank, a string.
    expect(definition(F.replace('sin(x)', '▮sin(x)'))).toBeNull();
    expect(definition('▮let a = 1')).toBeNull();
    expect(definition('nos▮uch + 1')).toBeNull();
    expect(definition('let a = 1\n▮\nlet b = 2')).toBeNull();
    expect(definition('let a = 1\n"▮a"')).toBeNull();
    // A variant and a protocol function member have no site of their own.
    expect(
      definition('type shape = square(real) | disk\nlet s = ▮square(2)')
    ).toBeNull();
    // A `#error` pragma stops the parse.
    expect(definition('#error "stop"\nlet a = 1\n▮a')).toBeNull();
  });
});

describe('EPSIL HOVER AND DEFINITION: THE EPSIL ENTRY', () => {
  test('the entry exports both functions', () => {
    expect(entryHover).toBe(epsilHover);
    expect(entryDefinition).toBe(epsilDefinition);
  });
});
