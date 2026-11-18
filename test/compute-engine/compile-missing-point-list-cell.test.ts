import { ComputeEngine, compile } from '../../src/compute-engine';

// A restriction or a `Which` over a list of conditions that selects no clause
// at a position gives `NaN` in a number cell and a point whose coordinates
// are `NaN` in a point cell, in the interpreter and in compiled JavaScript
// (`[NaN, NaN]`). Such a cell is never `Missing` or `undefined`, so
// `IsMissing` and `Coalesce` read it as present. A string arm under a list
// of conditions is a static error: a string has no `NaN`. This is the
// selection rule of 2026-11-02 (`docs/BROADCAST-MODEL.md`), which reverses
// the decision of 2026-10-18 that such a point or string cell is absent.

const ce = new ComputeEngine();
ce.declare('v', 'list<real>');

const V = [1, -1];

function interpreted(json: any): string {
  return ce
    .box(json)
    .subs({ v: ce.box(['List', ...V]) })
    .evaluate()
    .toString();
}

describe('COMPILED LIST CELL OF AN UNMATCHED POINT', () => {

  test('a string arm is a static error in both forms', () => {
    // A string has no value for a position that is not selected, so the
    // selection refuses a string arm under a list of conditions, and the
    // compilation of the invalid expression throws.
    for (const json of [
      ['Which', ['Greater', 'v', 0], { str: 'a' }],
      ['If', ['Greater', 'v', 0], { str: 'a' }],
      ['IsMissing', ['At', ['Which', ['Greater', 'v', 0], { str: 'a' }], 2]],
    ]) {
      expect(interpreted(json)).toContain('incompatible-type');
      expect(() => compile(ce.box(json as any), { fallback: false })).toThrow(
        /Could not compile/
      );
    }
  });
});

describe('a discharge reads a written Missing and a present value in the interpreter', () => {
  const engine = new ComputeEngine();
  // A declared type cannot name `missing` (`docs/ERROR-MODEL.md`,
  // "`Missing` is a result only"), so `u` and `z` hold present values only.
  engine.declare('u', 'real | string');
  engine.declare('z', 'complex');

  test('the interpreter agrees', () => {
    const at = (j: unknown) => engine.box(j as any).evaluate().toString();
    expect(at(['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 2]])).toBe(
      '"True"'
    );
    expect(
      at(['Coalesce', ['At', ['List', { str: 'a' }, 'Missing'], 2], { str: 'z' }])
    ).toBe('"z"');
    expect(at(['IsMissing', ['At', ['List', { str: 'a' }, 'Missing'], 1]])).toBe(
      '"False"'
    );
    expect(
      engine.box(['IsMissing', 'u']).subs({ u: engine.string('ab') }).evaluate()
        .toString()
    ).toBe('"False"');
    expect(
      engine
        .box(['IsMissing', 'z'])
        .subs({ z: engine.box(['Complex', 1, 2]) })
        .evaluate()
        .toString()
    ).toBe('"False"');
  });
});
