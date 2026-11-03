import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The absence semantics of the relational and logic family, of the handlers
// of `First`/`Last` and `Distance`, and of a compiled numeric slot, for the
// `Missing` symbol:
//
//   1. a comparison with an absent operand is `False` (`NotEqual`: `True`),
//      and a connective reads an absent operand as `False` (user decision of
//      2026-11-02, two-valued comparisons);
//   2. `First`/`Last` of an absent operand answer `Missing`, and `Distance`
//      from an absent point is `Missing`.
//
// This file pinned that the `Undefined` symbol was read exactly like
// `Missing` (user rulings of 2026-09-21 and 2026-09-22). Since `Missing` is
// a result only (`docs/ERROR-MODEL.md`, user decision of 2026-11-02),
// `Undefined` is an ordinary symbol with no value, and `Missing` is the one
// absent symbol: the last section pins that.
//
// `docs/ERROR-MODEL.md` §3 is the reference for the absence contract.

const ce = new ComputeEngine();

const run = (expr: any): unknown => {
  const r = compile(ce.box(expr));
  expect(r.success).toBe(true);
  return r.run!({});
};

const value = (expr: unknown): string =>
  ce
    .box(expr as any)
    .evaluate()
    .toString();

describe('MISSING — seam 1: relational and logic', () => {
  describe('scalar comparisons', () => {
    it('Equal against a scalar is False', () => {
      expect(value(['Equal', 'Missing', 1])).toBe('"False"');
    });

    it('NotEqual against a scalar is True', () => {
      expect(value(['NotEqual', 'Missing', 1])).toBe('"True"');
    });

    it('an ordering against a scalar is False', () => {
      expect(value(['Less', 'Missing', 1])).toBe('"False"');
      expect(value(['Greater', 'Missing', 1])).toBe('"False"');
    });

    it('IdenticallyEqual against a scalar is False', () => {
      expect(value(['IdenticallyEqual', 'Missing', 1])).toBe('"False"');
    });
  });

  describe('element-wise comparison against a scalar', () => {
    it('is False at the absent position and decides the others', () => {
      expect(value(['Equal', ['List', 1, 'Missing'], 1])).toBe(
        '["True","False"]'
      );
    });
  });

  describe('whole-collection comparison', () => {
    it('an absent cell on either side makes the comparison False', () => {
      expect(
        value(['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']])
      ).toBe('"False"');
    });
  });

  describe('connectives', () => {
    it('And reads an absent operand as False', () => {
      expect(value(['And', 'Missing', 'True'])).toBe('"False"');
    });

    it('And with a False operand is still False', () => {
      expect(value(['And', 'Missing', 'False'])).toBe('"False"');
    });

    it('Or reads an absent operand as False', () => {
      expect(value(['Or', 'Missing', 'False'])).toBe('"False"');
    });

    it('Or with a True operand is still True', () => {
      expect(value(['Or', 'Missing', 'True'])).toBe('"True"');
    });

    it('Not of an absent operand is True', () => {
      expect(value(['Not', 'Missing'])).toBe('"True"');
    });

    it('Implies, Nand and Nor read an absent operand as False', () => {
      // An absent operand reads as `False` (user decision of 2026-11-02,
      // two-valued comparisons): `Missing ⇒ q` is `True`.
      expect(value(['Implies', 'Missing', 'True'])).toBe('"True"');
      expect(value(['Implies', 'Missing', 'False'])).toBe('"True"');
      expect(value(['Nand', 'Missing', 'True'])).toBe('"True"');
      expect(value(['Nor', 'Missing', 'False'])).toBe('"True"');
    });
  });
});

describe('MISSING — seam 2: the absence-aware handlers', () => {
  it('First and Last of an absent operand answer the absence marker', () => {
    expect(value(['First', 'Missing'])).toBe('"Missing"');
    expect(value(['Last', 'Missing'])).toBe('"Missing"');
  });

  it('Distance from an absent point is Missing', () => {
    expect(
      ce.box(['Distance', 'Missing', ['Tuple', 1, 1]]).evaluate().symbol
    ).toBe('Missing');
    expect(
      ce.box(['Distance', ['Tuple', 1, 1], 'Missing']).evaluate().symbol
    ).toBe('Missing');
  });
});

describe('MISSING — the compiled numeric slot', () => {
  // A written absence symbol in a NUMERIC slot reaches compiled code as the
  // numeric absence marker `NaN` (the interpreter gives `Missing`, and
  // compiled code may give `NaN` there: `docs/COMPILATION-MODEL.md`,
  // "Caveats of compiled code").
  it('an absence symbol in an arithmetic slot runs to NaN', () => {
    expect(Number.isNaN(run(['Add', 'Missing', 1]) as number)).toBe(true);
  });
});

describe('UNDEFINED is not an absent value', () => {
  it('IsMissing(Undefined) is False, and Undefined + 1 stays unevaluated', () => {
    expect(ce.box(['IsMissing', 'Undefined']).evaluate().symbol).toBe(
      'False'
    );
    expect(value(['Add', 'Undefined', 1])).toBe('"Undefined" + 1');
  });
});
