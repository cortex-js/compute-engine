import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * `Find` with no matching element gives the absent value of the domain of
 * the elements, as a read out of range does (`docs/ERROR-MODEL.md`, "One
 * static error, one dynamic non-value per domain"): `NaN` for numbers, the
 * point of `NaN` coordinates for points, and `Missing` otherwise. Its type
 * shows that value: `integer | nan`, `tuple<…> | tuple<nan, nan>`,
 * `missing | string`. It gave `Nothing` before (user decision 2026-11-04).
 */

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

const greaterThan = (k: number) => ['Function', ['Greater', 'x', k], 'x'];
const equalTo = (s: string) => ['Function', ['Equal', 'x', { str: s }], 'x'];

describe('the absent value of the element domain', () => {
  test('numbers: NaN, typed integer | nan', () => {
    const e = ce.box(['Find', ['List', 1, 2, 3], greaterThan(5)]);
    expect(e.type.toString()).toBe('integer | nan');
    expect(e.evaluate().isNaN).toBe(true);
    // A match is unchanged.
    expect(
      ce.box(['Find', ['List', 1, 2, 3], greaterThan(1)]).evaluate().re
    ).toBe(2);
  });

  test('strings: Missing, typed missing | string', () => {
    const e = ce.box(['Find', ['List', { str: 'a' }], equalTo('b')]);
    expect(e.type.toString()).toBe('missing | string');
    expect(e.evaluate().symbol).toBe('Missing');
  });

  test('points: the point of NaN coordinates', () => {
    const e = ce.box([
      'Find',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Function', ['Greater', ['First', 'x'], 9], 'x'],
    ]);
    expect(e.type.toString()).toBe('tuple<integer, integer> | tuple<nan, nan>');
    expect(e.evaluate().toString()).toBe('(NaN, NaN)');
  });

  test('a declared source with no element reads the declared domain', () => {
    ce.declare('E', 'list<integer>');
    ce.assign('E', ce.box(['List']));
    expect(ce.box(['Find', 'E', greaterThan(5)]).evaluate().isNaN).toBe(true);
    ce.declare('S', 'list<string>');
    ce.assign('S', ce.box(['List']));
    expect(ce.box(['Find', 'S', equalTo('b')]).evaluate().symbol).toBe(
      'Missing'
    );
  });

  test('a union element type admits the absent value of each arm', () => {
    // The value `[1, 2]` shows numbers only, so the answer is `NaN`, which
    // the type must admit beside `missing`.
    ce.declare('U', 'list<integer | string>');
    ce.assign('U', ce.box(['List', 1, 2]));
    const e = ce.box(['Find', 'U', greaterThan(5)]);
    const v = e.evaluate();
    expect(v.isNaN).toBe(true);
    expect(v.type.matches(e.type)).toBe(true);
    // An empty literal has no element domain: `Missing`, typed `missing`.
    const empty = ce.box(['Find', ['List'], greaterThan(5)]);
    expect(empty.type.toString()).toBe('missing');
    expect(empty.evaluate().symbol).toBe('Missing');
  });

  test('Coalesce and IsMissing read the absent value', () => {
    expect(
      ce
        .box(['Coalesce', ['Find', ['List', 1, 2, 3], greaterThan(5)], 0])
        .evaluate().re
    ).toBe(0);
    expect(
      ce
        .box(['IsMissing', ['Find', ['List', { str: 'a' }], equalTo('b')]])
        .evaluate().symbol
    ).toBe('True');
  });

  test('the asynchronous route gives the same value', async () => {
    const v = await ce
      .box(['Find', ['List', 1, 2, 3], greaterThan(5)])
      .evaluateAsync();
    expect(v.isNaN).toBe(true);
  });
});

describe('compiled JavaScript', () => {
  test('a number gives NaN and a point gives the point of NaN coordinates', () => {
    ce.declare('xs', 'list<real>');
    ce.declare('ps', 'list<tuple<real, real>>');
    const numbers = compile(ce.box(['Find', 'xs', greaterThan(5)]), {
      to: 'javascript',
      fallback: false,
    });
    expect(numbers.success).toBe(true);
    expect(numbers.run!({ xs: [1, 2] } as never)).toBeNaN();
    expect(numbers.run!({ xs: [1, 9] } as never)).toBe(9);

    const points = compile(
      ce.box([
        'Find',
        'ps',
        ['Function', ['Greater', ['First', 'x'], 5], 'x'],
      ]),
      { to: 'javascript', fallback: false }
    );
    expect(points.success).toBe(true);
    expect(points.run!({ ps: [[1, 2]] } as never)).toEqual([NaN, NaN]);
    expect(points.run!({ ps: [[1, 2], [7, 8]] } as never)).toEqual([7, 8]);
  });
});
