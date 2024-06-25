import { Expression } from '../../src/math-json/math-json-format';
import { engine as ce } from '../utils';

describe('BOXING OF NUMBER', () => {
  test('Boxing numbers including whitespace', () => {
    expect(
      ce.box({ num: '\u00091\u000a2\u000b3\u000c4\u000d5 6\u00a07.2' })
        .numericValue
    ).toEqual(1234567.2);
  });

  test('Lenient num argument', () => {
    // Invalid box (the argument of "num" should be a string), but accepted
    expect(ce.box({ num: 4 } as any as Expression).numericValue).toEqual(4);
  });
});
