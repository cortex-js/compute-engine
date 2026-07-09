import { ComputeEngine } from '../../src/compute-engine';

/**
 * Label-operand tolerance for set operations (MathNet corpus,
 * `geometry-intersection` / `sets-and-congruence` categories, ROADMAP
 * "Geometry intersection idiom"): olympiad geometry uses `P = AC \cap BD`
 * (intersection of lines through points) and group theory uses
 * `x \in G \setminus H`, `|H \cap xH|`, where a *label* — a single-letter
 * symbol, or an implicit product of them — appears where a set is expected.
 * `Intersection`, `Union`, `SetMinus` and `NotElement` keep such expressions
 * inert instead of flagging `incompatible-type`.
 */

const ce = new ComputeEngine();

function isClean(s: string): boolean {
  const expr = ce.parse(s);
  return expr.isValid && !JSON.stringify(expr.json).includes('"Error"');
}

describe('geometry intersection idiom', () => {
  test('lines through points intersect', () => {
    expect(ce.parse('P = AC \\cap BD').json).toEqual([
      'Equal',
      'P',
      ['Intersection', ['Multiply', 'A', 'C'], ['Multiply', 'B', 'D']],
    ]);
    expect(isClean('BD \\cap AC = \\{E\\}')).toBe(true);
    expect(isClean('\\{F\\} = DI \\cap AM')).toBe(true);
    expect(isClean('KB \\cap CC_1 = \\{L\\}')).toBe(true);
  });

  test('labels that bind to constants still qualify (G, E)', () => {
    expect(isClean('K = AC \\cap EG')).toBe(true);
    expect(isClean('x \\in G \\setminus H')).toBe(true);
    expect(isClean('x \\in G \\setminus \\{e\\}')).toBe(true);
  });

  test('union and membership over labels', () => {
    expect(isClean('AB \\cup CD')).toBe(true);
    expect(ce.parse('K_a \\notin BC').json).toEqual([
      'NotElement',
      'K_a',
      ['Multiply', 'B', 'C'],
    ]);
  });

  test('group cosets: product with one uppercase letter qualifies', () => {
    expect(isClean('|H \\cap xH| \\geq 2p - n')).toBe(true);
  });

  test('genuine type errors are preserved', () => {
    // Number literals are not labels
    expect(isClean('1 \\cap 2')).toBe(false);
    // All-lowercase product is a genuine error (tier4-structural guard)
    expect(isClean('kstr \\setminus A')).toBe(false);
  });
});

describe('set-operation evaluation stays sound with inert operands', () => {
  test('literal set operations are unchanged', () => {
    expect(
      ce
        .box(['Intersection', ['Set', 1, 2, 3], ['Set', 2, 3]])
        .evaluate()
        .json
    ).toEqual(['Set', 2, 3]);
    expect(
      ce
        .box(['SetMinus', ['Set', 1, 2, 3], 2])
        .evaluate()
        .json
    ).toEqual(['Set', 1, 3]);
  });

  test('intersection of unknown symbols stays inert (was EmptySet)', () => {
    expect(ce.parse('H \\cap K').evaluate().json).toEqual([
      'Intersection',
      'H',
      'K',
    ]);
    const geo = ce.parse('AC \\cap BD').evaluate();
    expect(JSON.stringify(geo.json)).not.toContain('EmptySet');
  });

  test('intersection with an infinite first operand stays inert (was EmptySet)', () => {
    expect(
      ce
        .box(['Intersection', 'Integers', ['Set', 1, 2]])
        .evaluate()
        .json
    ).toEqual(['Intersection', 'Integers', ['Set', 1, 2]]);
  });
});
