import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// The `Undefined` symbol is read exactly like the `Missing` symbol — in a
// numeric slot (user ruling of 2026-09-21) and by the operators that own their
// absence semantics (user ruling of 2026-09-22). This file pins the seams that
// used to read `Missing` by name and treat `Undefined` as an ordinary value,
// each with the two symbols side by side:
//
//   1. the scalar relational and logic family, which answered a confident
//      `False` for `Undefined` where it answered the absence marker for
//      `Missing`;
//   2. the handlers of `First`/`Last` and `Distance`, which answered an
//      `incompatible-type` error for `Undefined` where they answered an
//      absence marker for `Missing`.
//
// `docs/ERROR-MODEL.md` §3 is the reference for the absence contract: the
// interpreter spells absence `Missing` or `NaN`, whichever the codomain asks
// for.

const ce = new ComputeEngine();

const run = (expr: any): unknown => {
  const r = compile(ce.box(expr));
  expect(r.success).toBe(true);
  return r.run!({});
};

describe('UNDEFINED reads like MISSING — seam 1: relational and logic', () => {
  describe('scalar comparisons', () => {
    it('Equal against a scalar is the absence marker', () => {
      expect(ce.box(['Equal', 'Missing', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Equal', 'Undefined', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('NotEqual against a scalar is the absence marker', () => {
      expect(ce.box(['NotEqual', 'Missing', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['NotEqual', 'Undefined', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('an ordering against a scalar is the absence marker', () => {
      expect(ce.box(['Less', 'Missing', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Less', 'Undefined', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Greater', 'Missing', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Greater', 'Undefined', 1]).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('IdenticallyEqual against a scalar is the absence marker', () => {
      expect(
        ce.box(['IdenticallyEqual', 'Missing', 1]).evaluate().toString()
      ).toBe('"Missing"');
      expect(
        ce.box(['IdenticallyEqual', 'Undefined', 1]).evaluate().toString()
      ).toBe('"Missing"');
    });
  });

  describe('element-wise comparison against a scalar', () => {
    it('marks the absent position and decides the others', () => {
      expect(
        ce
          .box(['Equal', ['List', 1, 'Missing'], 1])
          .evaluate()
          .toString()
      ).toBe('["True","Missing"]');
      expect(
        ce
          .box(['Equal', ['List', 1, 'Undefined'], 1])
          .evaluate()
          .toString()
      ).toBe('["True","Missing"]');
    });
  });

  describe('whole-collection comparison', () => {
    it('an absent cell on either side leaves the question unanswered', () => {
      expect(
        ce
          .box(['Equal', ['List', 1, 'Missing'], ['List', 1, 'Missing']])
          .evaluate()
          .toString()
      ).toBe('"Missing"');
      expect(
        ce
          .box(['Equal', ['List', 1, 'Undefined'], ['List', 1, 'Undefined']])
          .evaluate()
          .toString()
      ).toBe('"Missing"');
    });
  });

  describe('connectives', () => {
    it('And with an absent operand is the absence marker', () => {
      expect(ce.box(['And', 'Missing', 'True']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['And', 'Undefined', 'True']).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('And with a False operand is still False', () => {
      expect(ce.box(['And', 'Missing', 'False']).evaluate().toString()).toBe(
        '"False"'
      );
      expect(ce.box(['And', 'Undefined', 'False']).evaluate().toString()).toBe(
        '"False"'
      );
    });

    it('Or with an absent operand is the absence marker', () => {
      expect(ce.box(['Or', 'Missing', 'False']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Or', 'Undefined', 'False']).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('Or with a True operand is still True', () => {
      expect(ce.box(['Or', 'Missing', 'True']).evaluate().toString()).toBe(
        '"True"'
      );
      expect(ce.box(['Or', 'Undefined', 'True']).evaluate().toString()).toBe(
        '"True"'
      );
    });

    it('Not of an absent operand is the absence marker', () => {
      expect(ce.box(['Not', 'Missing']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Not', 'Undefined']).evaluate().toString()).toBe(
        '"Missing"'
      );
    });

    it('Implies, Nand and Nor read both absence symbols alike', () => {
      expect(ce.box(['Implies', 'Missing', 'True']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(
        ce.box(['Implies', 'Undefined', 'True']).evaluate().toString()
      ).toBe('"Missing"');
      expect(ce.box(['Nand', 'Missing', 'True']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Nand', 'Undefined', 'True']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Nor', 'Missing', 'False']).evaluate().toString()).toBe(
        '"Missing"'
      );
      expect(ce.box(['Nor', 'Undefined', 'False']).evaluate().toString()).toBe(
        '"Missing"'
      );
    });
  });
});

describe('UNDEFINED reads like MISSING — seam 2: the absence-aware handlers', () => {
  it('First and Last of an absent operand answer the absence marker', () => {
    expect(ce.box(['First', 'Missing']).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['First', 'Undefined']).evaluate().toString()).toBe(
      '"Missing"'
    );
    expect(ce.box(['Last', 'Missing']).evaluate().toString()).toBe('"Missing"');
    expect(ce.box(['Last', 'Undefined']).evaluate().toString()).toBe(
      '"Missing"'
    );
  });

  it('Distance from an absent point is NaN', () => {
    expect(
      ce.box(['Distance', 'Missing', ['Tuple', 1, 1]]).evaluate().isNaN
    ).toBe(true);
    expect(
      ce.box(['Distance', 'Undefined', ['Tuple', 1, 1]]).evaluate().isNaN
    ).toBe(true);
    expect(
      ce.box(['Distance', ['Tuple', 1, 1], 'Undefined']).evaluate().isNaN
    ).toBe(true);
  });
});

describe('UNDEFINED reads like MISSING — the compiled numeric slot', () => {
  // A written absence symbol in a NUMERIC slot is normalized before the
  // compile boundary, so both symbols reach compiled code as the numeric
  // absence marker `NaN`. (How a written absence symbol lowers OUTSIDE a
  // numeric slot is a separate question: the JavaScript lane spells an absent
  // collection CELL `undefined` and a `NaN` cell a present number, because the
  // interpreter decides `Equal([1, NaN], [1, NaN])` and leaves
  // `Equal([1, Missing], [1, Missing])` undecided. See
  // `collection-equality-absent.test.ts`.)
  it('an absence symbol in an arithmetic slot runs to NaN', () => {
    expect(Number.isNaN(run(['Add', 'Missing', 1]) as number)).toBe(true);
    expect(Number.isNaN(run(['Add', 'Undefined', 1]) as number)).toBe(true);
  });
});
