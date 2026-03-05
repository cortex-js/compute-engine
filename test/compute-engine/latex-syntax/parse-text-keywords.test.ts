import { engine as ce } from '../../utils';

describe('TEXT KEYWORDS', () => {
  test('\\text{and} as logical conjunction', () => {
    expect(ce.parse('x > 0 \\text{ and } x < 10').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Less,
          0,
          x,
        ],
        [
          Less,
          x,
          10,
        ],
      ]
    `);
  });

  test('\\text{or} as logical disjunction', () => {
    expect(ce.parse('x = 0 \\text{ or } x = 1').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Equal,
          x,
          0,
        ],
        [
          Equal,
          x,
          1,
        ],
      ]
    `);
  });

  test('\\text{iff} as biconditional', () => {
    expect(ce.parse('P \\text{ iff } Q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });

  test('\\text{andy} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{andy}').json).toMatchInlineSnapshot(`andy`);
  });

  test('\\text{organic} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{organic}').json).toMatchInlineSnapshot(`organic`);
  });

  test('\\text{if and only if} as biconditional', () => {
    expect(ce.parse('P \\text{ if and only if } Q').json).toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });
});
