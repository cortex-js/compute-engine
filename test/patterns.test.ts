import { match } from '../src/compute-engine/patterns';
// import { expression, latex } from './utils';

describe('PATTERNS  MATCH', () => {
  test('Universal wildcard', () => {
    const pattern = ['Add', 1, '_'];
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`Object {}`);
    // Commutative
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`);
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`);
    // Associative
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `Object {}`
    );
  });

  test('Named wildcard', () => {
    const pattern = ['Add', 1, '_a'];
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`
      Object {
        "a": 2,
      }
    `);
    // Commutative
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`);
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`);
    // Associative
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(`
      Object {
        "a": Array [
          "Add",
          2,
          3,
        ],
      }
    `);
  });

  test('Sequence wildcard', () => {
    expect(match(['Add', 1, '__a'], ['Add', 1, 2, 3, 4])).toMatchInlineSnapshot(
      `null`
    );
    expect(
      match(['Add', 1, '__a', 4], ['Add', 1, 2, 3, 4])
    ).toMatchInlineSnapshot(`null`);
    expect(
      match(['Add', 2, '__a', 3], ['Add', 1, 2, 3, 4])
    ).toMatchInlineSnapshot(`null`);
    expect(match(['Add', 1, 2, '__a', 4, 5], ['Add', 1, 2, 3, 4, 5]))
      .toMatchInlineSnapshot(`
      Object {
        "a": Array [
          "Sequence",
          3,
        ],
      }
    `);
    expect(
      match(['Add', 1, 2, '__a', 4, 5], ['Add', 1, 2, 4, 5])
    ).toMatchInlineSnapshot(`null`);
  });
});
