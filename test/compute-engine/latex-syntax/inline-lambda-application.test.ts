import { ComputeEngine } from '../../../src/compute-engine';

// A parenthesized function literal followed by a delimited argument list is
// an application, the way `f(3)` is for a function symbol — never a product
// of the literal with its arguments.

const ce = new ComputeEngine();

describe('a parenthesized lambda applied inline', () => {
  test('parses to Apply and evaluates', () => {
    const e = ce.parse('(i \\mapsto 2i)(3)');
    expect(e.json).toEqual([
      'Apply',
      ['Function', ['Block', ['Multiply', 2, 'i']], 'i'],
      3,
    ]);
    expect(e.evaluate().toString()).toBe('6');
    expect(ce.parse('((x, y) \\mapsto x + y)(2, 3)').evaluate().toString()).toBe(
      '5'
    );
    expect(ce.parse('(x \\mapsto x^2)(4)').evaluate().toString()).toBe('16');
  });

  test('a typed lambda applied inline', () => {
    expect(
      ce.parse('((i: integer) \\mapsto 2i)(3)').evaluate().toString()
    ).toBe('6');
  });

  test('in a larger expression, and after a coefficient', () => {
    expect(ce.parse('(i \\mapsto 2i)(3) + 1').evaluate().toString()).toBe('7');
    expect(ce.parse('2(i \\mapsto 2i)(3)').evaluate().toString()).toBe('12');
  });

  test('a power or factorial on the argument list applies to the application', () => {
    expect(ce.parse('(x \\mapsto 2x)(3)^2').json).toEqual([
      'Power',
      ['Apply', ['Function', ['Block', ['Multiply', 2, 'x']], 'x'], 3],
      2,
    ]);
    expect(ce.parse('(x \\mapsto 2x)(3)^2').evaluate().toString()).toBe('36');
    expect(ce.parse('(x \\mapsto 2x)(3)!').evaluate().toString()).toBe('720');
    expect(ce.parse('2(x \\mapsto 2x)(3)^2').evaluate().toString()).toBe('72');
  });

  test('redundant parentheses around the literal', () => {
    expect(ce.parse('((x \\mapsto 2x))(3)').evaluate().toString()).toBe('6');
    expect(ce.parse('2((x \\mapsto 2x))(3)').evaluate().toString()).toBe('12');
  });

  test('the application keeps its parentheses under every function style', () => {
    const e = ce.box(['Apply', ['Function', ['Multiply', 2, 'x'], 'x'], 3]);
    expect(e.toLatex({ applyFunctionStyle: () => 'none' })).toBe(
      '(x\\mapsto2x)(3)'
    );
    const sq = ce.box([
      'Square',
      ['Apply', ['Function', ['Multiply', 2, 'x'], 'x'], 3],
    ]);
    expect(ce.parse(sq.latex).evaluate().toString()).toBe('36');
  });

  test('serializes back to the same spelling and round-trips', () => {
    const e = ce.parse('(i \\mapsto 2i)(3)');
    expect(e.latex).toBe('(i\\mapsto2i)(3)');
    expect(ce.parse(e.latex).isSame(e)).toBe(true);
    const g = ce.parse('((x, y) \\mapsto x + y)(2, 3)');
    expect(ce.parse(g.latex).isSame(g)).toBe(true);
  });

  test('a function symbol and an ordinary parenthesized factor read as before', () => {
    const local = new ComputeEngine();
    local.assign('f', local.parse('x \\mapsto 2x'));
    expect(local.parse('(f)(3)').evaluate().toString()).toBe('6');
    expect(local.parse('(x+1)(3)').json).toEqual([
      'Multiply',
      3,
      ['Add', 'x', 1],
    ]);
  });
});

describe('a parenthesized function symbol with a postfix on its argument list', () => {
  test('a declared function applies through the power or factorial', () => {
    const local = new ComputeEngine();
    local.assign('f', local.parse('x \\mapsto 2x'));
    local.declare('h', '(number) -> number');
    expect(local.parse('(f)(3)^2').json).toEqual(['Power', ['f', 3], 2]);
    expect(local.parse('(f)(3)^2').evaluate().toString()).toBe('36');
    expect(local.parse('(f)(3)!').evaluate().toString()).toBe('720');
    expect(local.parse('2(f)(3)^2').evaluate().toString()).toBe('72');
    expect(local.parse('2(f)(3)').evaluate().toString()).toBe('12');
    expect(local.parse('2f (3)^2').evaluate().toString()).toBe('72');
    // A chain of postfix operators is walked down to the argument list.
    expect(local.parse('(f)(3)!^2').json).toEqual([
      'Power',
      ['Factorial', ['f', 3]],
      2,
    ]);
    expect(local.parse('(x \\mapsto 2x)(3)!^2').evaluate().toString()).toBe(
      '518400'
    );
    expect(local.parse('(h)(3)^2').json).toEqual(['Power', ['h', 3], 2]);
    expect(local.parse('(\\sin)(x)^2').json).toEqual([
      'Power',
      ['Sin', 'x'],
      2,
    ]);
  });

  test('a number or an undeclared symbol keeps the product', () => {
    const local = new ComputeEngine();
    local.assign('x', 5);
    expect(local.parse('(x)(3)^2').evaluate().toString()).toBe('45');
    expect(local.parse('(g)(3)^2').json).toEqual(['Multiply', 9, 'g']);
  });
});

describe('what the notation does not cover', () => {
  test('a second argument list is a factor, not a curried application', () => {
    // `(f)(3)(4)` read as `f(3) · 4` before the postfix rule and still does:
    // a curried application has no juxtaposition notation.
    const local = new ComputeEngine();
    local.assign('f', local.parse('x \\mapsto 2x'));
    expect(local.parse('(f)(3)(4)').json).toEqual(['Multiply', 4, ['f', 3]]);
  });

  test('a symbol defined after the expression repairs the product reading', () => {
    // The product reading of `(g)(t)^2` rests on `g` having no definition
    // yet; once `g` becomes a function, a later use of the body reads the
    // application. The bare-list spelling has always done this.
    const local = new ComputeEngine();
    local.assign('k', local.parse('t \\mapsto (g)(t)^2'));
    local.assign('g', local.parse('x \\mapsto 2x'));
    expect(local.parse('k(3)').evaluate().toString()).toBe('36');
  });
});
