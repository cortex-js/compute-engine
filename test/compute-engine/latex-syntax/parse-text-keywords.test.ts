import { ComputeEngine } from '../../../src/compute-engine';
import { engine as ce } from '../../utils';

describe('DOUBLE-QUOTED STRING LITERALS', () => {
  test('parses a double-quoted string', () => {
    expect(ce.parse('"hello"').string).toBe('hello');
  });

  test('parses an empty string', () => {
    expect(ce.parse('""').string).toBe('');
  });

  test('preserves spaces', () => {
    expect(ce.parse('"a b c"').string).toBe('a b c');
  });

  test('normalizes commands to Unicode, like \\text', () => {
    expect(ce.parse('"\\alpha"').string).toBe('α');
  });

  test('serializes back to \\text{…} (no round-trip to quotes)', () => {
    expect(ce.parse('"hello"').latex).toBe('\\text{hello}');
  });

  test('does not interfere with \\unicode hex prefix', () => {
    // The `"` inside `\unicode{…}` is a hex prefix on a separate parse path.
    expect(ce.parse('\\unicode{"2012}').json).toEqual('____002012');
  });

  test('an unterminated string is an error', () => {
    expect(ce.parse('"abc').operator).toBe('Error');
  });

  test('reads a dictionary value by key via bracket notation', () => {
    const engine = new ComputeEngine();
    const dict = engine.box({ dict: { height: 42, width: 7 } });
    engine.declare('tbl', dict.type);
    engine.assign('tbl', dict);
    expect(engine.parse('\\mathrm{tbl}["height"]').evaluate().valueOf()).toBe(
      42
    );
  });
});

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
    expect(ce.parse('\\text{andy}').json).toMatchInlineSnapshot(`'andy'`);
  });

  test('\\text{organic} is NOT a keyword (text run)', () => {
    expect(ce.parse('\\text{organic}').json).toMatchInlineSnapshot(`'organic'`);
  });

  test('\\text{if and only if} as biconditional', () => {
    expect(ce.parse('P \\text{ if and only if } Q').json)
      .toMatchInlineSnapshot(`
      [
        Equivalent,
        P,
        Q,
      ]
    `);
  });
});
