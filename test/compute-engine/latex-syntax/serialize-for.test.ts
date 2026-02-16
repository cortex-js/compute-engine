import { latex } from '../../utils';

describe('FOR LOOP - SERIALIZATION', () => {
  test('Loop with Element/Range', () => {
    expect(
      latex(['Loop', ['Square', 'i'], ['Element', 'i', ['Range', 0, 9]]])
    ).toMatchInlineSnapshot(
      `\\text{for }i\\text{ from }0\\text{ to }9\\text{ do }i^2`
    );
  });

  test('Loop with expression bounds', () => {
    expect(
      latex([
        'Loop',
        ['Add', 'k', 1],
        ['Element', 'k', ['Range', 'n', ['Multiply', 2, 'n']]],
      ])
    ).toMatchInlineSnapshot(
      `\\text{for }k\\text{ from }n\\text{ to }2n\\text{ do }k+1`
    );
  });
});

describe('BREAK / CONTINUE / RETURN - SERIALIZATION', () => {
  test('Break', () => {
    expect(latex(['Break'])).toMatchInlineSnapshot(`\\text{break}`);
  });

  test('Continue', () => {
    expect(latex(['Continue'])).toMatchInlineSnapshot(`\\text{continue}`);
  });

  test('Return with expression', () => {
    expect(latex(['Return', ['Add', 'x', 1]])).toMatchInlineSnapshot(
      `\\text{return }x+1`
    );
  });

  test('Return without expression', () => {
    expect(latex(['Return', 'Nothing'])).toMatchInlineSnapshot(
      `\\text{return}`
    );
  });
});
