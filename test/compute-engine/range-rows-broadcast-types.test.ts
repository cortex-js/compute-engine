import { ComputeEngine } from '../../src/compute-engine';

// A `Range` element of a collection literal stays a range, so `[1..3, 4..6]`
// is typed `list<range>`. A range is a list of integers, and an operator that
// broadcasts over such a list maps over the integers of each range: the value
// of `Negate([1..3, 4..6])` is a list of lists. The static type must hold
// that value. It was `list<range>` for `Negate` and `list<number>` for
// `Sqrt`, and `number` for `Sum([1..2, 3..4])`, whose value is the row
// `[4, 6]` (ROADMAP CE-496).

const ce = new ComputeEngine();

const ROWS = ['List', ['Range', 1, 3], ['Range', 4, 6]];
const SQUARE = ['List', ['Range', 1, 2], ['Range', 3, 4]];

function check(json: unknown): { type: string; value: string } {
  const expr = ce.box(json as any);
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return { type: expr.type.toString(), value: value.toString() };
}

describe('A broadcast over a list of ranges is typed as a list of lists', () => {
  test.each([
    'Negate',
    'Sqrt',
    'Floor',
    'Ceil',
    'Round',
    'Exp',
    'Ln',
    'Sin',
    'Square',
    'Factorial',
  ])('box route: %s', (op) => {
    for (const rows of [ROWS, SQUARE]) {
      const { type } = check([op, rows]);
      expect(type.startsWith('list<list<')).toBe(true);
    }
  });

  test('Negate', () => {
    expect(check(['Negate', ROWS])).toEqual({
      type: 'list<list<integer>>',
      value: '[[-1,-2,-3],[-4,-5,-6]]',
    });
  });

  test('Sqrt', () => {
    expect(check(['Sqrt', ROWS]).type).toBe('list<list<number>>');
  });

  // The static type of `Abs` and `Sign` states the range of each cell
  // (`real<0..>`, `integer<-1..1>`), which the type of a literal cell does
  // not (`integer`), so the check is on the shape only.
  test.each(['Abs', 'Sign'])('%s has the shape of its value', (op) => {
    const type = ce.box([op, ROWS] as any).type.toString();
    expect(type.startsWith('list<list<')).toBe(true);
  });

  test('a list of a range and a number', () => {
    expect(check(['Negate', ['List', ['Range', 1, 3], 5]])).toEqual({
      type: 'list<integer | list<integer>>',
      value: '[[-1,-2,-3],-5]',
    });
  });

  test('a declared list of ranges', () => {
    const engine = new ComputeEngine();
    engine.declare('R', 'list<range>');
    engine.assign('R', engine.box(ROWS as any));
    const expr = engine.box(['Negate', 'R']);
    expect(expr.type.toString()).toBe('list<list<integer>>');
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  test('parse route', () => {
    for (const latex of [
      '-[1..3, 4..6]',
      '\\sqrt{[1..3, 4..6]}',
      '\\lfloor [1..3, 4..6] \\rfloor',
    ]) {
      const expr = ce.parse(latex);
      expect(expr.type.toString().startsWith('list<list<')).toBe(true);
      expect(expr.evaluate().type.matches(expr.type)).toBe(true);
    }
  });

  test('the elements of the literal stay ranges', () => {
    expect(ce.box(ROWS as any).type.toString()).toBe('list<range>');
  });
});

describe('A reduction over a list of ranges is typed with its value', () => {
  test('Sum is a row', () => {
    expect(check(['Sum', SQUARE])).toEqual({
      type: 'integer | list<integer>',
      value: '[4,6]',
    });
    expect(check(['Sum', ROWS]).value).toBe('[5,7,9]');
  });

  test.each(['Product', 'Max', 'Min'])('box route: %s', (op) => {
    check([op, ROWS]);
    check([op, SQUARE]);
  });

  test('Max and Min', () => {
    expect(check(['Max', ROWS]).value).toBe('6');
    expect(check(['Min', ROWS]).value).toBe('1');
  });

  test('parse route: Sum', () => {
    const expr = ce.parse('\\sum [1..2, 3..4]');
    expect(expr.type.toString()).toBe('integer | list<integer>');
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });
});

describe('A list of ranges named by a transparent alias', () => {
  // The alias is unfolded before its constructors are read, so the operand
  // is typed as with `list<range>` written out.
  const ce = new ComputeEngine();
  ce.declareType('Rows', 'list<range>', { alias: true });
  ce.declare('R', 'Rows');
  ce.assign('R', ce.box(SQUARE as any));

  function checkR(op: string): { type: string; value: string } {
    const expr = ce.box([op, 'R']);
    const value = expr.evaluate();
    expect(value.type.matches(expr.type)).toBe(true);
    return { type: expr.type.toString(), value: value.toString() };
  }

  test('Sum is a row', () => {
    expect(checkR('Sum')).toEqual({
      type: 'integer | list<integer>',
      value: '[4,6]',
    });
  });

  test('Negate is a list of lists', () => {
    expect(checkR('Negate')).toEqual({
      type: 'list<list<integer>>',
      value: '[[-1,-2],[-3,-4]]',
    });
  });
});
