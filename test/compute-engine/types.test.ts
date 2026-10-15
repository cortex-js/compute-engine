import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { reduceType } from '../../src/common/type/reduce';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';
import { engine as ce } from '../utils';

describe('NUMERIC TYPES', () => {
  it('should recognize the type of a number', () => {
    const expr = ce.parse('3');
    expect(expr.type.toString()).toBe('3');
  });
  it('should recognize the type of a complex number', () => {
    const expr = ce.parse('3 + 4i');
    expect(expr.type.toString()).toBe('complex');
  });
  it('should recognize the type of a rational number', () => {
    const expr = ce.parse('3/4');
    expect(expr.type.toString()).toBe('rational<0.75..0.75>');
  });
  it('should recognize the type of a real number', () => {
    const expr = ce.parse('3.4');
    expect(expr.type.toString()).toBe('3.4');
  });
  it('should recognize the type of an imaginary number', () => {
    const expr = ce.parse('4i');
    expect(expr.type.toString()).toBe('imaginary');
  });
  it('should recognize the type of a non-finite number', () => {
    // A literal's public type is the singleton that names it (ruling O9), and
    // `+∞` is a literal like any other. The serializer spells the two signed
    // infinities with the `+oo`/`-oo` forms of the type grammar.
    const expr = ce.parse('\\infty');
    expect(expr.type.toString()).toBe('+oo');
    expect(expr.type.matches('infinity')).toBe(true);
  });
  it('should recognize the type of complex infinity', () => {
    // The unsigned infinity has its own singleton spelling, `~oo`, and widens
    // to `infinity` — never to `complex`, which is finite.
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.toString()).toBe('~oo');
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('complex')).toBe(false);
  });
});

describe('NUMERIC SUBTYPES', () => {
  it('should recognize the type of an integer', () => {
    const expr = ce.parse('3');
    expect(expr.type.matches('integer')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('rational')).toBe(true);
    expect(expr.type.matches('imaginary')).toBe(false);
  });
  it('should recognize the type of a complex number', () => {
    const expr = ce.parse('3 + 4i');
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('imaginary')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('number')).toBe(true);
  });
  it('should recognize the type of an imaginary number', () => {
    const expr = ce.parse('4i');
    expect(expr.type.matches('imaginary')).toBe(true);
    expect(expr.type.matches('complex')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
  });
  it('should recognize the type of a rational number', () => {
    const expr = ce.parse('3/4');
    expect(expr.type.matches('rational')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('integer')).toBe(false);
  });
  it('should recognize the type of a real number', () => {
    const expr = ce.parse('3.4');
    expect(expr.type.matches('real')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('integer')).toBe(false);
  });
  it('should recognize the type of a non-finite number', () => {
    // The finite-by-default flip: the bare numeric names contain only finite
    // values, so an infinity matches `infinity` (and the signed pair
    // `signed_infinity`) and nothing in the `complex` subtree.
    const expr = ce.parse('\\infty');
    expect(expr.type.matches('signed_infinity')).toBe(true);
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('integer')).toBe(false);
    expect(expr.type.matches('rational')).toBe(false);
    expect(expr.type.matches('integer')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('complex')).toBe(false);
    // The extended real line is spelled out as a union.
    expect(expr.type.matches('real | infinity')).toBe(true);
  });
  it('should recognize the type of a complex infinity', () => {
    // Admitted by `infinity` (and thence `number`) — `complex` refuses it,
    // exactly as it refuses NaN (see the NaN case below). It is unsigned, so
    // the signed pair refuses it too.
    const expr = ce.parse('\\tilde\\infty');
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('real')).toBe(false);
    expect(expr.type.matches('infinity')).toBe(true);
    expect(expr.type.matches('signed_infinity')).toBe(false);
    expect(expr.type.matches('number')).toBe(true);
  });
  it('should recognize the type of NaN', () => {
    const expr = ce.parse('\\mathrm{NaN}');
    expect(expr.type.matches('number')).toBe(true);
    expect(expr.type.matches('nan')).toBe(true);
    expect(expr.type.matches('real')).toBe(false);
    // `complex` is also the finiteness gate — every bare name under `number`
    // denotes finite values alone — and NaN is not a finite number.
    expect(expr.type.matches('complex')).toBe(false);
    expect(expr.type.matches('infinity')).toBe(false);
    expect(expr.type.matches('signed_infinity')).toBe(false);
  });
});

// https://github.com/cortex-js/compute-engine/issues/235
describe('BROADCASTABLE FUNCTIONS WITH UNION TYPES', () => {
  it('should accept number | list arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should accept number | list arguments for Add', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    const expr = ce.expr(['Add', 'a', 'b']);
    expect(expr.json).toEqual(['Add', 'a', 'b']);
  });

  it('should accept any-typed arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'any');
    ce.declare('b', 'any');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should accept unknown-typed arguments for Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'unknown');
    ce.declare('b', 'unknown');
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.json).toEqual(['Multiply', 'a', 'b']);
  });

  it('should evaluate Multiply with list-valued symbols', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'number | list');
    ce.declare('b', 'number | list');
    ce.assign('a', ['List', 1, 2, 3]);
    ce.assign('b', ['List', 4, 5, 6]);
    const expr = ce.expr(['Multiply', 'a', 'b']);
    expect(expr.evaluate().json).toEqual(['List', 4, 10, 18]);
  });
});

// An open extent of a list type is stored as -1. It is printed as `?`, the
// spelling the type parser reads back, and the printed type parses back to
// the same type. Before, a mixed shape printed the -1 (`matrix<integer^(2x-1)>`,
// which does not parse), and a shape of rank 3 or more printed a nested list
// (`list<list<list<integer^3>>^2>`), a wider type that allows rows of
// different lengths.
describe('OPEN EXTENTS IN LIST TYPES', () => {
  const spellings: [string, string][] = [
    ['matrix<integer^(2x?)>', 'matrix<integer^(2x?)>'],
    ['list<integer^(2x?)>', 'matrix<integer^(2x?)>'],
    ['matrix<integer^(?x3)>', 'matrix<integer^(?x3)>'],
    ['matrix<2x?>', 'matrix<2x?>'],
    ['matrix<number^(?x2)>', 'matrix<?x2>'],
    ['list<string^(2x?)>', 'list<string^(2x?)>'],
    ['list<integer^(2x?x3)>', 'list<integer^(2x?x3)>'],
    ['list<integer^(?x?x?)>', 'list<integer^(?x?x?)>'],
  ];
  test.each(spellings)('%s prints as %s and parses back', (input, printed) => {
    const t = parseType(input);
    expect(typeToString(t)).toBe(printed);
    const back = parseType(printed);
    expect(typeToString(back)).toBe(printed);
    expect(isSubtype(t, back) && isSubtype(back, t)).toBe(true);
  });

  test('the type of a declared symbol prints the open extent as ?', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'matrix<integer^(2x?)>');
    expect(ce.symbol('h').type.toString()).toBe('matrix<integer^(2x?)>');
    ce.declare('k', 'list<integer^(2x?)>');
    expect(ce.symbol('k').type.toString()).toBe('matrix<integer^(2x?)>');
  });
});

describe('ZERO-LENGTH AXES IN LIST TYPES', () => {
  // A zero-length axis is kept: `list<integer^(2x0)>` is two empty rows, a
  // value of rank 2 with 0 elements. The reduction used to drop the zero
  // axis (`vector<integer^2>`, a list of two integers) and read an all-zero
  // shape as `nothing`.
  const spellings: [string, string, number[]][] = [
    ['list<integer^(2x0)>', 'matrix<integer^(2x0)>', [2, 0]],
    ['list<integer^(0x2)>', 'matrix<integer^(0x2)>', [0, 2]],
    ['list<integer^(0x0)>', 'matrix<integer^(0x0)>', [0, 0]],
    ['list<integer^0>', 'vector<integer^0>', [0]],
    ['list<integer^(2x0x3)>', 'list<integer^(2x0x3)>', [2, 0, 3]],
    ['matrix<0x2>', 'matrix<0x2>', [0, 2]],
  ];
  test.each(spellings)(
    '%s reduces to %s and keeps its axes',
    (input, printed, dims) => {
      const t = parseType(input);
      const reduced = reduceType(t);
      expect(typeToString(reduced)).toBe(printed);
      expect(typeof reduced === 'object' && reduced.kind === 'list').toBe(true);
      if (typeof reduced === 'object' && reduced.kind === 'list')
        expect(reduced.dimensions).toEqual(dims);
      const back = parseType(printed);
      expect(typeToString(reduceType(back))).toBe(printed);
      expect(isSubtype(t, back) && isSubtype(back, t)).toBe(true);
    }
  );

  test('`0x2` in a dimension position is the shape 0 x 2, not a hexadecimal 2', () => {
    expect(typeToString(parseType('list<integer^(0x2)>'))).toBe(
      typeToString(parseType('list<integer^(0 x 2)>'))
    );
    expect(typeToString(parseType('list<integer^(0x2)>'))).not.toBe(
      'vector<integer^2>'
    );
  });

  test('a dimension is never a hexadecimal literal: `0xa` is the shape 0 x a', () => {
    // `a` is a legal dimension-variable name, so `0xa` is zero rows and `a`
    // columns, not the hexadecimal number 10.
    const t = parseType('list<integer^(0xa)>');
    expect(typeToString(t)).toBe('matrix<integer^(0xa)>');
    expect(typeof t === 'object' && t.kind === 'list' && t.dimensions).toEqual([
      0, -1,
    ]);
    expect(
      typeof t === 'object' && t.kind === 'list' && t.dimensionVariables
    ).toEqual([undefined, 'a']);
    expect(typeToString(parseType(typeToString(t)))).toBe(
      'matrix<integer^(0xa)>'
    );
    expect(typeToString(parseType('list<integer^(0xN)>'))).toBe(
      'matrix<integer^(0xN)>'
    );
    expect(typeToString(parseType('list<integer^(2 x 0x3)>'))).toBe(
      'list<integer^(2x0x3)>'
    );
    // The separator is a lowercase `x`: `0X2` is not a shape, and it is an
    // error instead of the hexadecimal number 2.
    expect(() => parseType('list<integer^(0X2)>')).toThrow();
  });

  test('a zero-length axis is not a list of the other axes', () => {
    expect(
      isSubtype(parseType('list<integer^(2x0)>'), parseType('list<integer^2>'))
    ).toBe(false);
    expect(
      isSubtype(parseType('list<integer^(2x0)>'), parseType('matrix'))
    ).toBe(true);
    expect(
      isSubtype(
        parseType('list<integer^(2x0)>'),
        parseType('list<integer^(2x3)>')
      )
    ).toBe(false);
  });

  test('the empty list literal is a value of a list type whose first axis is 0', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['List']).type.toString()).toBe('list<never>');
    expect(ce.box(['List']).type.matches('list<integer^0>')).toBe(true);
    expect(ce.box(['List']).type.matches('list<integer^(0x2)>')).toBe(true);
    expect(ce.box(['List']).type.matches('list<integer^2>')).toBe(false);
    ce.declare('z', 'list<integer^0>');
    expect(ce.symbol('z').type.toString()).toBe('vector<integer^0>');
    ce.assign('z', ce.box(['List']));
    expect(ce.symbol('z').evaluate().toString()).toBe('[]');
  });

  test('the type of a declared symbol keeps the zero axis', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'list<integer^(2x0)>');
    expect(ce.symbol('w').type.toString()).toBe('matrix<integer^(2x0)>');
  });
});
