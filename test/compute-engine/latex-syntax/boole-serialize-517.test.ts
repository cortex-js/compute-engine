/**
 * The LaTeX of `Boole` reads back as `Boole` (GitHub #517). The Iverson
 * bracket `[…]` is read as `Boole` only around a relation: `[P]` is a list.
 * So the bracket is written only around a relation, and any other operand is
 * written `\operatorname{Boole}(P)`.
 */

import { ComputeEngine } from '../../../src/compute-engine';

const ce = new ComputeEngine();

type Json = Parameters<typeof ce.box>[0];

describe('BOOLE LATEX ROUND TRIP', () => {
  const cases: [Json, string][] = [
    [['Boole', 'P'], String.raw`\operatorname{Boole}(P)`],
    [
      ['Boole', ['IsPrime', 'n']],
      String.raw`\operatorname{Boole}(\mathrm{IsPrime}(n))`,
    ],
    [['Boole', 'True'], String.raw`\operatorname{Boole}(\top)`],
    [
      ['Boole', ['Element', 'x', 'Integers']],
      String.raw`\operatorname{Boole}(x\in\mathbb{Z})`,
    ],
    [
      ['Boole', ['And', ['Greater', 'x', 0], ['Less', 'x', 1]]],
      String.raw`\operatorname{Boole}(0\lt x\land x\lt1)`,
    ],
    // A relation keeps the Iverson bracket.
    [['Boole', ['Greater', 'x', 0]], String.raw`\lbrack0\lt x\rbrack`],
    [['Boole', ['Equal', 'a', 'b']], String.raw`\lbrack a=b\rbrack`],
    [['Boole', ['Less', 0, 'x', 1]], String.raw`\lbrack0\lt x\lt1\rbrack`],
  ];

  test.each(cases)('%j', (json, latex) => {
    const expr = ce.box(json);
    expect(expr.latex).toBe(latex);
    expect(ce.parse(latex).json).toEqual(expr.json);
  });

  test('the non-canonical form reads back too', () => {
    const expr = ce.box(['Boole', 'P'], { canonical: false });
    expect(expr.latex).toBe(String.raw`\operatorname{Boole}(P)`);
    expect(ce.parse(expr.latex).json).toEqual(['Boole', 'P']);
  });

  test('a bracket around a non-relation is a list', () => {
    expect(ce.parse(String.raw`[P]`).json).toEqual(['List', 'P']);
    expect(ce.parse(String.raw`[x>0]`).json).toEqual([
      'Boole',
      ['Less', 0, 'x'],
    ]);
  });
});
