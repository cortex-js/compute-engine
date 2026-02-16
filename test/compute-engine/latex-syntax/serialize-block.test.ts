import { engine as ce, latex } from '../../utils';

describe('BLOCK - SERIALIZATION', () => {
  test('Block with Declare, Assign, and body', () => {
    expect(
      latex(['Block', ['Declare', 'x'], ['Assign', 'x', 5], ['Add', 'x', 1]])
    ).toMatchInlineSnapshot(`x\\coloneq5;\\; x+1`);
  });

  test('Block with multiple assignments', () => {
    expect(
      latex([
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', 1],
        ['Declare', 'b'],
        ['Assign', 'b', 2],
        ['Add', 'a', 'b'],
      ])
    ).toMatchInlineSnapshot(`a\\coloneq1;\\; b\\coloneq2;\\; a+b`);
  });

  test('Block round-trip via semicolons', () => {
    const input = 'x \\coloneq 5; x + 1';
    const parsed = ce.parse(input);
    expect(parsed.latex).toMatchInlineSnapshot(`x\\coloneq5;\\; x+1`);
  });
});
