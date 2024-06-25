import { engine as ce } from '../utils';

describe('ELEMENT', () => {
  test(`literal`, () => {
    expect(ce.box(['Element', 2, 'Integers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'Numbers']).evaluate()).toMatchInlineSnapshot(
      `True`
    );
    expect(ce.box(['Element', 2, 'Booleans']).evaluate()).toMatchInlineSnapshot(
      `False`
    );
  });

  test(`strings`, () => {
    expect(
      ce.box(['Element', { str: 'wor' }, { str: 'Hello world' }]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.box(['Element', { str: 'cat' }, { str: 'Hello world' }]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.box(['Element', { str: 'wa' }, { str: 'Hello world' }]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.box(['Element', { str: 'rld' }, { str: 'Hello world' }]).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('List', () => {
    expect(
      ce.box(['Element', 3, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.box(['Element', 5, ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
  });

  test('Sublists', () => {
    expect(
      ce.box(['Element', ['List', 2, 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
    expect(
      ce.box(['Element', ['List', 3, 2], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`False`);
    expect(
      ce.box(['Element', ['List', 3], ['List', 2, 3, 4]]).evaluate()
    ).toMatchInlineSnapshot(`True`);
  });

  test('INVALID', () => {
    expect(ce.box(['Element']).evaluate()).toMatchInlineSnapshot(
      `["Element", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(ce.box(['Element', 2]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, ["Error", "'missing'"]]`
    );
    expect(ce.box(['Element', 2, 'Integers', 'Numbers']).evaluate())
      .toMatchInlineSnapshot(`
      [
        "Element",
        2,
        "Integers",
        ["Error", "'unexpected-argument'", "Numbers"]
      ]
    `);
    expect(ce.box(['Element', 2, 3]).evaluate()).toMatchInlineSnapshot(
      `["Element", 2, 3]`
    );
  });
});
