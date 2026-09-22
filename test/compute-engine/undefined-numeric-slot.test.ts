import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// `Undefined` in a NUMERIC slot is normalized like `Missing` (user ruling of
// 2026-09-21, recorded in `docs/ERROR-MODEL.md` §3). The absence gate turns an
// absent scalar operand of a `propagate` operator into the marker of the
// operator's own codomain, and both absence symbols — `Missing` and
// `Undefined` — take that route. Outside a numeric slot `Undefined` keeps its
// own meaning.

const ce = new ComputeEngine();

describe('UNDEFINED in a numeric slot', () => {
  describe('interpreter, evaluate() and N()', () => {
    it('Cos(Undefined) is NaN, as Cos(Missing) is', () => {
      expect(ce.box(['Cos', 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Undefined']).N().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Missing']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Cos', 'Missing']).N().isNaN).toBe(true);
    });

    it('Undefined + 1 is NaN', () => {
      expect(ce.box(['Add', 'Undefined', 1]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Add', 'Undefined', 1]).N().isNaN).toBe(true);
    });

    it('a product, a quotient and a root of Undefined are NaN', () => {
      expect(ce.box(['Multiply', 'Undefined', 2]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Divide', 1, 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Sqrt', 'Undefined']).evaluate().isNaN).toBe(true);
      expect(ce.box(['Power', 'Undefined', 2]).evaluate().isNaN).toBe(true);
    });

    it('evaluateAsync answers NaN too — the async gate is the lockstep twin of the sync one', async () => {
      const r = await ce.box(['Cos', 'Undefined']).evaluateAsync();
      expect(r.isNaN).toBe(true);
    });

    it('Sin(When(1, False)) is NaN', () => {
      // `When` masks to `Missing`; the numeric slot of `Sin` absorbs it.
      expect(ce.box(['Sin', ['When', 1, 'False']]).evaluate().isNaN).toBe(true);
      expect(ce.box(['Sin', ['When', 1, 'False']]).N().isNaN).toBe(true);
    });

    it('an Undefined cell under a broadcast head is NaN at that position, as a Missing cell is', () => {
      const withUndefined = ce
        .box(['Sin', ['List', 1, 'Undefined', 3]])
        .evaluate();
      const withMissing = ce.box(['Sin', ['List', 1, 'Missing', 3]]).evaluate();
      expect(withUndefined.toString()).toEqual(withMissing.toString());
      expect(withUndefined.ops![1].isNaN).toBe(true);

      const nUndefined = ce.box(['Sin', ['List', 1, 'Undefined', 3]]).N();
      const nMissing = ce.box(['Sin', ['List', 1, 'Missing', 3]]).N();
      expect(nUndefined.toString()).toEqual(nMissing.toString());
      expect(nUndefined.ops![1].isNaN).toBe(true);
    });
  });

  describe('compiled JavaScript lane', () => {
    it('answers NaN for the same rows', () => {
      for (const expr of [
        ['Cos', 'Undefined'],
        ['Add', 'Undefined', 1],
        ['Sin', ['When', 1, 'False']],
      ]) {
        const result = compile(ce.expr(expr as any))!;
        expect(result.success).toBe(true);
        expect(Number.isNaN(result.run!({}) as number)).toBe(true);
      }
    });
  });

  describe('outside a numeric slot, Undefined is unchanged', () => {
    it('a bare Undefined evaluates to itself', () => {
      expect(ce.box('Undefined').evaluate().symbol).toBe('Undefined');
    });

    it('its declared type is still `unknown`', () => {
      expect(ce.box('Undefined').type.toString()).toBe('unknown');
    });

    it('the operators that own their absence semantics still read it as an ordinary value', () => {
      expect(ce.box(['IsMissing', 'Undefined']).evaluate().symbol).toBe(
        'False'
      );
      expect(ce.box(['Coalesce', 'Undefined', 2]).evaluate().symbol).toBe(
        'Undefined'
      );
    });
  });

  describe('the When restriction', () => {
    // The masking answer of `When` is `Missing`, not `Undefined`: the 2026-09-09
    // ruling aligned it with a default-less `Which` and the else-less `If`.
    it('When(1, False) answers Missing', () => {
      expect(ce.box(['When', 1, 'False']).evaluate().symbol).toBe('Missing');
    });

    it('its result type carries the `missing` arm', () => {
      expect(ce.box(['When', 1, 'False']).type.toString()).toBe(
        'integer | missing'
      );
      expect(ce.box(['When', 1, 'True']).type.toString()).toBe('integer');
    });
  });
});
