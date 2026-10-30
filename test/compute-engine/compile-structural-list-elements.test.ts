import { ComputeEngine, compile } from '../../src/compute-engine';

/**
 * Element comparison over a collection whose elements are lists
 * (`Contains`, `Unique`, `Element` and the sequence-search family). Lists
 * compile to JS arrays, so a bare `includes`/`Set` would compare them by
 * reference; the JavaScript target lowers them through `_SYS.eqs` /
 * `_SYS.uniqs` instead, and the result must agree with `evaluate()`.
 */
const js = (e: unknown, ce: ComputeEngine) =>
  compile(ce.box(e as never), { to: 'javascript', fallback: false });

const lit = (v: unknown): unknown =>
  Array.isArray(v) ? ['List', ...v.map(lit)] : v;

function setup() {
  const ce = new ComputeEngine();
  ce.declare('xss', 'list<list<integer>>');
  ce.declare('ys', 'list<integer>');
  ce.declare('zss', 'list<list<integer>>');
  return ce;
}

const XSS = [[1, 2], [3], [1, 2], []];

describe('Contains / Element over lists of lists', () => {
  const ce = setup();
  const cases: [string, number[]][] = [
    ['found', [1, 2]],
    ['found singleton', [3]],
    ['found empty', []],
    ['not found', [2, 1]],
    ['not found, prefix', [1]],
  ];
  test.each(cases)('%s', (_n, ys) => {
    const expected = ce
      .box(['Contains', lit(XSS), lit(ys)] as never)
      .evaluate().json;
    const r = js(['Contains', 'xss', 'ys'], ce);
    expect(r.success).toBe(true);
    expect(r.run!({ xss: XSS, ys } as never)).toBe(expected === 'True');
    const e = js(['Element', 'ys', 'xss'], ce);
    expect(e.success).toBe(true);
    expect(e.run!({ xss: XSS, ys } as never)).toBe(expected === 'True');
  });

  test('empty collection of lists', () => {
    const r = js(['Contains', 'xss', 'ys'], ce);
    expect(r.run!({ xss: [], ys: [] } as never)).toBe(false);
    expect(
      ce.box(['Contains', ['List'], ['List']] as never).evaluate().json
    ).toBe('False');
  });

  test('deeper nesting and string leaves', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('a', 'list<list<list<string>>>');
    ce2.declare('b', 'list<list<string>>');
    const r = js(['Contains', 'a', 'b'], ce2);
    expect(r.success).toBe(true);
    // Decomposed "e" + U+0301 finds the precomposed "é", as in the interpreter.
    expect(r.run!({ a: [[['é']]], b: [['é']] } as never)).toBe(true);
    expect(r.run!({ a: [[['é']]], b: [['x']] } as never)).toBe(false);
    expect(
      ce2.box(['Contains', lit([[['é']]]), lit([['é']])] as never).evaluate()
        .json
    ).toBe('True');
  });
});

describe('Unique over lists of lists', () => {
  const ce = setup();
  test.each([
    ['duplicates', [[1, 2], [3], [1, 2], [3], []]],
    ['all distinct', [[1], [2], [1, 2], [2, 1]]],
    ['empty inner lists', [[], [], [0]]],
    ['empty collection', []],
  ])('%s', (_n, xss) => {
    const r = js(['Unique', 'xss'], ce);
    expect(r.success).toBe(true);
    const expected = ce
      .box(['Unique', lit(xss)] as never)
      .evaluate()
      .toString();
    const out = r.run!({ xss } as never) as unknown[];
    expect(
      ce
        .box(lit(out) as never)
        .evaluate()
        .toString()
    ).toBe(expected);
  });
});

describe('sequence search over lists of lists', () => {
  const ce = setup();
  const subject = [[1], [2, 3], [4], [2, 3]];
  const needle = [[2, 3], [4]];
  const ev = (op: string, s: unknown, n: unknown) =>
    ce.box([op, lit(s), lit(n)] as never).evaluate();

  test.each(['ContainsSequence', 'StartsWith', 'EndsWith'])('%s', (op) => {
    const r = js([op, 'xss', 'zss'], ce);
    expect(r.success).toBe(true);
    for (const [s, n] of [
      [subject, needle],
      [subject, [[1], [2, 3]]],
      [subject, [[2, 3], [4], [2, 3]]],
      [subject, [[9]]],
      [subject, []],
      [[], [[1]]],
    ]) {
      expect(r.run!({ xss: s, zss: n } as never)).toBe(
        ev(op, s, n).json === 'True'
      );
    }
  });

  test('RangeOf', () => {
    const r = js(['RangeOf', 'xss', 'zss'], ce);
    expect(r.success).toBe(true);
    const got = r.run!({ xss: subject, zss: needle } as never);
    expect(got).toEqual([2, 3]);
    expect(ev('RangeOf', subject, needle).toString()).toBe('[2,3]');
    expect(r.run!({ xss: subject, zss: [[9]] } as never)).toBeUndefined();
    expect(ev('RangeOf', subject, [[9]]).json).toBe('Nothing');
  });
});

describe('element types that still fail closed', () => {
  test.each([
    ['list<tuple<integer, integer>>', 'Contains'],
    ['list<list<complex>>', 'Unique'],
    ['list<list<integer | missing>>', 'Unique'],
    ['list<list<any>>', 'Unique'],
  ])('%s under %s', (type, op) => {
    const ce = new ComputeEngine();
    ce.declare('xss', type);
    ce.declare('y', 'any');
    const e = op === 'Unique' ? ['Unique', 'xss'] : [op, 'xss', 'y'];
    expect(() => js(e, ce)).toThrow(/Could not compile/);
  });
});

test('list Equal still compiles through _SYS.eq', () => {
  const ce = setup();
  expect(js(['Equal', 'ys', ['List', 1, 2]], ce).code).toContain('_SYS.eq(');
});
