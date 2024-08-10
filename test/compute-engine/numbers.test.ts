import { Expression } from '../../src/math-json/types.ts';
import { engine as ce } from '../utils';

describe('BOXING OF NUMBER', () => {
  test('Boxing numbers including whitespace', () => {
    expect(
      ce.box({ num: '\u00091\u000a2\u000b3\u000c4\u000d5 6\u00a07.2' })
        .numericValue
    ).toEqual(1234567.2);
  });

  test('Lenient num argument', () => {
    // num with a numeric value is accepted, although it's technically invalid
    expect(ce.box({ num: 4 } as any as Expression).numericValue).toEqual(4);
  });

  test('Not numbers', () => {
    expect(ce.box(NaN).numericValue).toEqual(NaN);
    expect(ce.box(Infinity).numericValue).toEqual(Infinity);
    // Invalid box
    expect(ce.box({ num: Infinity } as any as Expression).numericValue).toEqual(
      Infinity
    );
    expect(ce.box({ num: 'infinity' }).numericValue).toEqual(Infinity);
  });

  test('Bigints', () => {
    // expect(latex({ num: 12n })).toMatchInlineSnapshot();
    expect(ce.box({ num: '12n' }).numericValue).toEqual(12);
    // 1.873 461 923 786 192 834 612 398 761 298 192 306 423 768 912 387 649 238 476 9... × 10^196
    expect(
      ce.box({
        num: '187346192378619283461239876129819230642376891238764923847000000000000000000000',
      })
    ).toMatchInlineSnapshot(
      `{num: "187346192378619283461239876129819230642376891238764923847e+21"}`
    );

    expect(
      ce.box({
        num: '18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764n',
      })
    ).toMatchInlineSnapshot(`
      {
        num: "18734619237861928346123987612981923064237689123876492384769123786412837040123612308964123876412307864012346012837491237864192837641923876419238764123987642198764987162398716239871236912347619238764"
      }
    `);
  });
});
