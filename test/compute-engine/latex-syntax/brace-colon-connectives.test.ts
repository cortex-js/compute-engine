import { ComputeEngine } from '../../../src/compute-engine';

// Inside a brace group, `:` separates a whole condition from a whole value, so
// a `\land` or a `\lor` on either side of it stays in that condition. Outside a
// brace group, `:` binds tighter than these connectives.
function json(latex: string): unknown {
  return new ComputeEngine().parse(latex).json;
}

describe('A connective beside the colon of a brace group', () => {
  const both = ['And', ['Equal', 'm', 1], ['Less', 'z', 1]];

  test('a condition with \\land and a default', () => {
    expect(json('\\{m = 1 \\land z < 1: 2, 3\\}')).toEqual([
      'Which',
      both,
      2,
      'True',
      3,
    ]);
  });

  test('a condition with \\land and no default', () => {
    expect(json('\\{m = 1 \\land z < 1: 2\\}')).toEqual(['Which', both, 2]);
  });

  test('parentheses around each relation give the same condition', () => {
    expect(json('\\{(m = 1) \\land (z < 1): 2, 3\\}')).toEqual([
      'Which',
      both,
      2,
      'True',
      3,
    ]);
  });

  test('a connective in each branch', () => {
    expect(
      json('\\{m = 1 \\land z < 1: 2, n = 2 \\lor z > 3: 4, 5\\}')
    ).toEqual([
      'Which',
      both,
      2,
      ['Or', ['Equal', 'n', 2], ['Less', 3, 'z']],
      4,
      'True',
      5,
    ]);
  });

  test('the precedence of \\land over \\lor stays in the condition', () => {
    expect(json('\\{a = 1 \\lor b = 1 \\land c = 1: 2, 3\\}')).toEqual([
      'Which',
      ['Or', ['Equal', 'a', 1], ['And', ['Equal', 'b', 1], ['Equal', 'c', 1]]],
      2,
      'True',
      3,
    ]);
  });

  test('a brace group after an expression', () => {
    expect(json('x\\{m = 1 \\land z < 1: 2, 3\\}')).toEqual([
      'Multiply',
      'x',
      ['Which', both, 2, 'True', 3],
    ]);
  });

  test('the value of the condition selects the branch', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{m = 1 \\land z < 1: 2, 3\\}');
    ce.assign('m', 1);
    ce.assign('z', 0);
    expect(expr.evaluate().json).toBe(2);
    ce.assign('z', 5);
    expect(expr.evaluate().json).toBe(3);
  });

  const between = ['And', ['Greater', 'x', 0], ['Less', 'x', 1]];

  test('a set-builder with a connective after the colon', () => {
    expect(json('\\{x : x > 0 \\land x < 1\\}')).toEqual([
      'Set',
      'x',
      ['Condition', between],
    ]);
    expect(json('\\{x \\in \\R : x > 0 \\land x < 1\\}')).toEqual([
      'Set',
      ['Element', 'x', 'RealNumbers'],
      ['Condition', between],
    ]);
  });
});

describe('A membership in a connective before the colon', () => {
  test('with a condition after the colon, it is a set-builder', () => {
    const value = new ComputeEngine().parse(
      '\\{x \\in A \\lor x \\in B: x > 0\\}'
    );
    expect(value.operator).toBe('Set');
    expect(JSON.stringify(value.json)).toContain('Condition');
  });

  test('with a list of conditions after the colon, it is a set-builder', () => {
    const value = new ComputeEngine().parse(
      '\\{k \\in A \\lor k \\in B: k > 0, k < 5\\}'
    );
    expect(value.operator).toBe('Set');
    expect(JSON.stringify(value.json)).toContain('Condition');
  });

  test('with a value after the colon, it is a branch', () => {
    expect(
      new ComputeEngine().parse('\\{x \\in A \\lor x \\in B: 2\\}').operator
    ).toBe('Which');
  });
});

describe('The other logical connectives beside the colon', () => {
  const x = ['Less', 0, 'x'];
  const y = ['Less', 0, 'y'];

  test.each([
    ['\\veebar', 'Xor'],
    ['\\barwedge', 'Nand'],
    ['\\implies', 'Implies'],
    ['\\Rightarrow', 'Implies'],
    ['\\iff', 'Equivalent'],
    ['\\Leftrightarrow', 'Equivalent'],
  ])('%s before the colon gives a branch', (latex, head) => {
    expect(json(`\\{x > 0 ${latex} y > 0: 2, 3\\}`)).toEqual([
      'Which',
      [head, x, y],
      2,
      'True',
      3,
    ]);
    expect(json(`\\{x > 0 ${latex} y > 0: 2\\}`)).toEqual([
      'Which',
      [head, x, y],
      2,
    ]);
  });

  test('a connective in the condition of a set-builder', () => {
    expect(json('\\{x: x > 0 \\implies x > 1\\}')).toEqual([
      'Set',
      'x',
      ['Condition', ['Implies', ['Greater', 'x', 0], ['Greater', 'x', 1]]],
    ]);
  });

  test('a brace group after an expression', () => {
    expect(json('e\\{x > 0 \\veebar y > 0: 2, 3\\}')).toEqual([
      'Multiply',
      'ExponentialE',
      ['Which', ['Xor', x, y], 2, 'True', 3],
    ]);
  });

  test('a connective under a restriction before the colon', () => {
    expect(
      new ComputeEngine().parse(
        '\\{\\operatorname{Implies}(a,b)\\{c\\}: 2, 3\\}'
      ).operator
    ).toBe('Which');
  });

  test('a tighter connective stays inside the condition', () => {
    expect(json('\\{a = 1 \\implies b = 1 \\land c = 1: 2\\}')).toEqual([
      'Which',
      [
        'Implies',
        ['Equal', 'a', 1],
        ['And', ['Equal', 'b', 1], ['Equal', 'c', 1]],
      ],
      2,
    ]);
  });

  test('a membership in a connective, with a condition after the colon', () => {
    const value = new ComputeEngine().parse(
      '\\{x \\in A \\veebar x \\in B: x > 0\\}'
    );
    expect(value.operator).toBe('Set');
    expect(JSON.stringify(value.json)).toContain('Condition');
  });

  test('the value of the condition selects the branch', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('\\{x > 0 \\veebar y > 0: 2, 3\\}');
    ce.assign('x', 1);
    ce.assign('y', -1);
    expect(expr.evaluate().json).toBe(2);
    ce.assign('y', 1);
    expect(expr.evaluate().json).toBe(3);
  });
});

describe('Forms that the brace-group rule does not change', () => {
  test.each([
    ['\\implies', 'Implies'],
    ['\\iff', 'Equivalent'],
    ['\\veebar', 'Xor'],
  ])('%s with no colon is a set of one element', (latex, head) => {
    expect(json(`\\{a ${latex} b\\}`)).toEqual(['Set', [head, 'a', 'b']]);
  });

  test('a relation between formulas before the colon', () => {
    expect(json('\\{a \\vdash b: c\\}')).toEqual([
      'Set',
      ['Proves', 'a', ['Colon', 'b', 'c']],
    ]);
  });

  test('a condition with no colon', () => {
    expect(json('\\{x > 0 \\land x < 1\\}')).toEqual([
      'If',
      ['And', ['Less', 0, 'x'], ['Less', 'x', 1]],
      1,
    ]);
  });

  test('one relation before the colon', () => {
    expect(json('\\{z < 1: 2, 3\\}')).toEqual([
      'Which',
      ['Less', 'z', 1],
      2,
      'True',
      3,
    ]);
  });

  test('outside a brace group, the colon binds tighter', () => {
    expect(json('a \\land b: c')).toEqual(['And', 'a', ['Colon', 'b', 'c']]);
  });

  test('two colons under one connective have no such reading', () => {
    expect(json('\\{a: b \\land c: d\\}')).toEqual([
      'If',
      ['And', ['Colon', 'a', 'b'], ['Colon', 'c', 'd']],
      1,
    ]);
  });
});
