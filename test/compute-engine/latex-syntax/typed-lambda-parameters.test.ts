import { ComputeEngine } from '../../../src/compute-engine';

// The LaTeX notation for a typed lambda parameter: `(x: T) \mapsto body`.
// The type after the colon is read as source text and checked by the type
// parser; the `\mapsto` that follows the parameter list is what makes the
// colon an annotation. A colon in any other position reads as before.

const ce = new ComputeEngine();

describe('typed lambda parameters parse to Typed parameters', () => {
  test('one parameter, parenthesized or bare', () => {
    expect(ce.parse('(i: integer) \\mapsto 2i').json).toEqual([
      'Function',
      ['Block', ['Multiply', 2, 'i']],
      ['Typed', 'i', "'integer'"],
    ]);
    expect(ce.parse('x: real \\mapsto x^2').json).toEqual([
      'Function',
      ['Block', ['Power', 'x', 2]],
      ['Typed', 'x', "'real'"],
    ]);
    expect(ce.parse('(i: integer) \\mapsto 2i').type.toString()).toBe(
      '(i: integer) -> integer'
    );
  });

  test('several parameters, typed or not', () => {
    expect(ce.parse('(x: real, y: real) \\mapsto x + y').json).toEqual([
      'Function',
      ['Block', ['Add', 'x', 'y']],
      ['Typed', 'x', "'real'"],
      ['Typed', 'y', "'real'"],
    ]);
    expect(ce.parse('(x\\colon real, y) \\mapsto x + y').json).toEqual([
      'Function',
      ['Block', ['Add', 'x', 'y']],
      ['Typed', 'x', "'real'"],
      'y',
    ]);
  });

  test('the type is source text: constructors, arrows, wrapped names', () => {
    expect(ce.parse('(x: list<integer>) \\mapsto x').json).toEqual([
      'Function',
      ['Block', 'x'],
      ['Typed', 'x', "'list<integer>'"],
    ]);
    expect(ce.parse('(f: (real) -> real) \\mapsto f(1)').json).toEqual([
      'Function',
      ['Block', ['f', 1]],
      ['Typed', 'f', "'(real) -> real'"],
    ]);
    expect(ce.parse('(x: \\mathrm{real}) \\mapsto x').json).toEqual([
      'Function',
      ['Block', 'x'],
      ['Typed', 'x', "'real'"],
    ]);
    expect(ce.parse('(x: \\text{integer}) \\mapsto x').json).toEqual([
      'Function',
      ['Block', 'x'],
      ['Typed', 'x', "'integer'"],
    ]);
  });

  test('the \\left( … \\right) spelling', () => {
    expect(ce.parse('\\left(x\\colon real\\right)\\mapsto x').json).toEqual([
      'Function',
      ['Block', 'x'],
      ['Typed', 'x', "'real'"],
    ]);
    expect(
      ce.parse('\\left(x: real, y: \\mathrm{integer}\\right)\\mapsto x+y').json
    ).toEqual([
      'Function',
      ['Block', ['Add', 'x', 'y']],
      ['Typed', 'x', "'real'"],
      ['Typed', 'y', "'integer'"],
    ]);
  });

  test('a comma inside the type, and a quoted value type', () => {
    expect(ce.parse('(p: tuple<integer, integer>) \\mapsto p').json).toEqual([
      'Function',
      ['Block', 'p'],
      ['Typed', 'p', "'tuple<integer, integer>'"],
    ]);
    expect(
      ce.parse('(x: integer, p: tuple<real, real>) \\mapsto x').json
    ).toEqual([
      'Function',
      ['Block', 'x'],
      ['Typed', 'x', "'integer'"],
      ['Typed', 'p', "'tuple<real, real>'"],
    ]);
    expect(
      ce.parse('(f: (real, real) -> real) \\mapsto f(1, 2)').json
    ).toEqual([
      'Function',
      ['Block', ['f', 1, 2]],
      ['Typed', 'f', "'(real, real) -> real'"],
    ]);
    expect(ce.parse('(s: "a,b") \\mapsto s').json).toEqual([
      'Function',
      ['Block', 's'],
      ['Typed', 's', '\'"a,b"\''],
    ]);
  });

  test('other delimiter spellings and sizing prefixes', () => {
    for (const src of [
      '\\lparen x: integer\\rparen\\mapsto x',
      '\\bigl(x: integer\\bigr)\\mapsto x',
      '\\mleft(x: integer\\mright)\\mapsto x',
    ]) {
      expect(ce.parse(src).json).toEqual([
        'Function',
        ['Block', 'x'],
        ['Typed', 'x', "'integer'"],
      ]);
    }
    expect(
      ce.parse('(f: \\bigl(real\\bigr) -> real) \\mapsto f(1)').json
    ).toEqual([
      'Function',
      ['Block', ['f', 1]],
      ['Typed', 'f', "'(real) -> real'"],
    ]);
  });

  test('a declared nominal type name is read by its shape and resolved at boxing', () => {
    const local = new ComputeEngine();
    local.declareType('Point', 'tuple<real, real>');
    const f = local.parse('(p: Point) \\mapsto p');
    expect(f.json).toEqual([
      'Function',
      ['Block', 'p'],
      ['Typed', 'p', "'Point'"],
    ]);
    expect(f.type.toString()).toBe('(p: Point) -> Point');
  });

  test('a text that is not a type falls back to the plain colon', () => {
    const e = ce.parse('(x: a > b) \\mapsto x');
    expect(e.isValid).toBe(false);
    expect(JSON.stringify(e.json)).toContain('"Colon"');
  });
});

describe('the serializer writes the annotation back', () => {
  test('round trip through LaTeX', () => {
    for (const src of [
      '(i: integer) \\mapsto 2i',
      '(x: real, y: real) \\mapsto x + y',
      '(x\\colon real, y) \\mapsto x + y',
      '(x: list<integer>) \\mapsto x',
      '(f: (real) -> real) \\mapsto f(1)',
      '(i: integer) \\mapsto (i, 2i)',
    ]) {
      const e = ce.parse(src);
      expect(e.isValid).toBe(true);
      const back = ce.parse(e.latex);
      expect(back.isSame(e)).toBe(true);
      expect(back.type.toString()).toBe(e.type.toString());
    }
  });

  test('a typed lambda built from MathJSON keeps its annotation in LaTeX', () => {
    const f = ce.box([
      'Function',
      ['Multiply', 2, 'i'],
      ['Typed', 'i', { str: 'integer' }],
    ]);
    expect(f.latex).toBe('(i\\colon integer)\\mapsto2i');
    expect(ce.parse(f.latex).type.toString()).toBe('(i: integer) -> integer');
  });

  test('a symbol-form type serializes too', () => {
    expect(ce.box(['Function', 'x', ['Typed', 'x', 'integer']]).latex).toBe(
      '(x\\colon integer)\\mapsto x'
    );
  });

  test('an untyped lambda serializes as before', () => {
    expect(ce.parse('i \\mapsto 2i').latex).toBe('i\\mapsto2i');
    expect(ce.parse('(x, y) \\mapsto x + y').latex).toBe('(x, y)\\mapsto x+y');
  });
});

describe('every other colon reads as before', () => {
  test.each([
    ['\\{ x : x > 0 \\}', ['Set', 'x', ['Condition', ['Greater', 'x', 0]]]],
    ['\\{ x < 0 : 1, x \\}', ['Which', ['Less', 'x', 0], 1, 'True', 'x']],
    ['f: A \\to B', ['Colon', 'f', ['To', 'A', 'B']]],
    ['a : b', ['Colon', 'a', 'b']],
    ['(a : b)', ['Delimiter', ['Colon', 'a', 'b']]],
  ])('%s', (src, json) => {
    expect(ce.parse(src, { form: 'raw' }).json).toEqual(json);
  });
});
