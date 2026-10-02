import { ComputeEngine } from '../../src/compute-engine';
import { engine as ce } from '../utils';

// Wolfram Language names that are aliases of an existing operator. Each alias
// has the same meaning, argument order and number of arguments as its
// target, so its canonical form is the target (see the naming policy in
// `docs/MATHEMATICA-NAMES.md`). `StirlingS2` is tested in
// `item-395-stirling-s2.test.ts`.

type AliasCase = {
  alias: string;
  target: string;
  // [operand, value]: the value is Mathematica's value for the same input
  values: [unknown, string][];
  // An operand of the wrong type
  wrongType: unknown;
  // The LaTeX of the canonical form of `alias(symbolic)`
  symbolic: unknown;
  latex: string;
};

const MATRIX = ['List', ['List', 1, 2], ['List', 3, 4]];

const cases: AliasCase[] = [
  {
    alias: 'EulerPhi',
    target: 'Totient',
    // φ(0) = 0 and φ(−n) = φ(n), as Mathematica's `EulerPhi`.
    values: [
      [1, '1'],
      [12, '4'],
      [1776, '576'],
      [0, '0'],
      [-12, '4'],
      [-1, '1'],
    ],
    wrongType: "'a'",
    symbolic: 'n',
    latex: '\\mathrm{Totient}(n)',
  },
  {
    alias: 'PartitionsP',
    target: 'NPartition',
    // p(n) = 0 for n < 0, as Mathematica's `PartitionsP` (OEIS A000041 for
    // n ≥ 0).
    values: [
      [0, '1'],
      [1, '1'],
      [5, '7'],
      [10, '42'],
      [100, '190569292'],
      [-1, '0'],
      [-7, '0'],
    ],
    wrongType: 2.5,
    symbolic: 'n',
    latex: '\\mathrm{NPartition}(n)',
  },
  {
    alias: 'Det',
    target: 'Determinant',
    values: [
      [MATRIX, '-2'],
      [['List', ['List', 2, 0, 0], ['List', 0, 3, 0], ['List', 0, 0, 4]], '24'],
      [['List', ['List', 'a', 'b'], ['List', 'c', 'd']], '-b * c + a * d'],
    ],
    wrongType: 5,
    symbolic: 'm',
    latex: '\\det m',
  },
];

for (const { alias, target, values, wrongType, symbolic, latex } of cases) {
  describe(`${alias} is an alias for ${target}`, () => {
    for (const [operand, value] of values) {
      const a = ce.expr([alias, operand] as any);
      const b = ce.expr([target, operand] as any);

      test(`${alias}(${JSON.stringify(operand)}) = ${value} (evaluate)`, () => {
        expect(a.evaluate().toString()).toBe(value);
        expect(b.evaluate().toString()).toBe(value);
      });

      test(`${alias}(${JSON.stringify(operand)}) = ${value} (.N())`, () => {
        expect(a.N().toString()).toBe(b.N().toString());
      });
    }

    test(`the canonical form is ${target}, the preferred name`, () => {
      const e = ce.expr([alias, symbolic] as any);
      expect(e.operator).toBe(target);
      expect(e.isSame(ce.expr([target, symbolic] as any))).toBe(true);
      expect(JSON.stringify(e.json)).toBe(
        JSON.stringify([target, symbolic])
      );
    });

    test(`the raw form keeps the ${alias} spelling`, () => {
      expect(
        ce.expr([alias, symbolic] as any, { form: 'raw' }).operator
      ).toBe(alias);
    });

    test(`the LaTeX of the canonical form is the LaTeX of ${target}`, () => {
      expect(ce.expr([alias, symbolic] as any).latex).toBe(latex);
      expect(ce.expr([target, symbolic] as any).latex).toBe(latex);
    });

    test(`${alias} with a symbolic operand stays unevaluated as ${target}`, () => {
      expect(ce.expr([alias, symbolic] as any).evaluate().operator).toBe(
        target
      );
    });

    // The alias must fail exactly where the target fails: a missing operand,
    // an extra operand (strict mode) and an operand of the wrong type.
    test.each([
      [[alias], [target]],
      [
        [alias, values[0][0], 3],
        [target, values[0][0], 3],
      ],
      [
        [alias, wrongType],
        [target, wrongType],
      ],
    ])('%j is validated like the target', (aliasJson, targetJson) => {
      const engine = new ComputeEngine();
      engine.strict = true;
      const a = engine.box(aliasJson as any);
      const b = engine.box(targetJson as any);
      expect(a.isValid).toBe(false);
      expect(JSON.stringify(a.json)).toBe(JSON.stringify(b.json));
      expect(a.evaluate().toString()).toBe(b.evaluate().toString());
    });
  });
}

describe('Wolfram aliases on the parse route', () => {
  test.each([
    ['\\operatorname{EulerPhi}(12)', '["Totient",12]', '4'],
    ['\\operatorname{PartitionsP}(5)', '["NPartition",5]', '7'],
    [
      '\\operatorname{Det}(\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix})',
      '["Determinant",["Matrix",["List",["List",1,2],["List",3,4]]]]',
      '-2',
    ],
  ])('%s', (latex, json, value) => {
    const e = ce.parse(latex);
    expect(JSON.stringify(e.json)).toBe(json);
    expect(e.evaluate().toString()).toBe(value);
  });
});

// `Det[m, Modulus -> n]` is a Mathematica option form with no CE equivalent.
// It must not give the determinant computed without the modulus.
describe('Det with the Modulus option is an error', () => {
  test('the second operand is an unexpected argument', () => {
    const e = ce.expr(['Det', MATRIX, ['Rule', "'Modulus'", 3]] as any);
    expect(e.isValid).toBe(false);
    expect(e.operator).toBe('Determinant');
    expect(e.evaluate().operator).toBe('Error');
  });
});

// `Tr` gets no alias: Mathematica's `Tr` of a rectangular matrix is the sum
// of its diagonal elements (CE's `Trace` requires a square matrix), `Tr` of a
// vector is the sum of its
// elements and `Tr` of a rank-3 tensor is the sum of t[i,i,i], while CE's
// `Trace` rejects a vector and gives the batch trace (a vector) of a rank-3
// tensor. The two- and three-operand forms differ too (`Tr[list, f, n]`
// against `Trace(m, axis1, axis2)`).
describe('Tr is not an alias for Trace', () => {
  test('Tr stays an unknown head', () => {
    const e = ce.expr(['Tr', MATRIX] as any);
    expect(e.operator).toBe('Tr');
  });
});
