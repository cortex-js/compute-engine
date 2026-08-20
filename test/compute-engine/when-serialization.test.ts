import { ComputeEngine } from '../../src/compute-engine';

/**
 * Serialization of the `When` restriction `expr\left\{cond\right\}`.
 *
 * Two defects, both reported by the Desmos-corpus consumer against 0.116.1.
 *
 * The serializer tested its operands for TRUTHINESS where it meant to test for
 * absence. The MathJSON of the literal `0` is the number `0`, which is falsy,
 * so any restriction on a literal zero serialized to the empty string — and
 * silently, since parsing was never at fault. That is the Desmos full-plane
 * gate `1>0\left\{cond\right\}` and the axis-line gate `y=0\left\{cond\right\}`:
 * 18 of their 687 states attach a restriction to a literal `0`, and 14 of them
 * converted damaged. Most lost ink from surviving rows rather than rendering
 * nothing, which is why a render-outcome sweep never caught it.
 *
 * Separately, the restricted expression was serialized without regard to its
 * own precedence, so a negative subject came back bound the wrong way round.
 *
 * The truthiness test was not unique to `When`: the same shape sat in five
 * other serializers, each losing a literal `0` operand in its own way. Those
 * are covered at the bottom of this file, since one fix and one class of
 * regression covers them all.
 */

const ce = new ComputeEngine();

/** Parse `latex` without canonicalizing, and return its MathJSON. */
function raw(latex: string): unknown {
  return ce.parse(latex, { form: 'raw' }).json;
}

describe('`When` serializes a literal `0` operand', () => {
  test('a restriction ON zero is not dropped', () => {
    expect(ce.box(['When', 0, ['Equal', 'x', 'x']]).latex).toEqual(
      '0\\left\\{x=x\\right\\}'
    );
  });

  test('a zero CONDITION is not dropped either', () => {
    expect(ce.box(['When', 'x', 0]).latex).toEqual('x\\left\\{0\\right\\}');
  });

  test('the operands that always worked are unchanged', () => {
    expect(ce.box(['When', 1, ['Equal', 'x', 'x']]).latex).toEqual(
      '1\\left\\{x=x\\right\\}'
    );
    expect(ce.box(['When', 0.5, ['Equal', 'x', 'x']]).latex).toEqual(
      '0.5\\left\\{x=x\\right\\}'
    );
    expect(ce.box(['When', 'x', ['Equal', 'x', 'x']]).latex).toEqual(
      'x\\left\\{x=x\\right\\}'
    );
  });
});

describe('`When` round-trips the Desmos gates through latex', () => {
  // A document's persisted cell latex is a string boundary for the consumer,
  // so a serialization that does not reparse is unrecoverable data loss.
  test('the full-plane gate `1>0{cond}` survives, raw and canonical', () => {
    const source = '1>0\\left\\{x=x\\right\\}';
    const parsed = ce.parse(source, { form: 'raw' });
    expect(parsed.json).toEqual([
      'Greater',
      1,
      ['When', 0, ['Equal', 'x', 'x']],
    ]);
    expect(raw(parsed.latex)).toEqual(parsed.json);

    const canonical = ce.parse(source);
    expect(ce.parse(canonical.latex).json).toEqual(canonical.json);
  });

  test('the axis-line gate `y=0{cond}` survives', () => {
    const parsed = ce.parse('y=0\\left\\{x>1\\right\\}', { form: 'raw' });
    expect(parsed.json).toEqual([
      'Equal',
      'y',
      ['When', 0, ['Greater', 'x', 1]],
    ]);
    expect(raw(parsed.latex)).toEqual(parsed.json);
  });
});

describe('`When` keeps a low-precedence subject grouped', () => {
  test('a negative subject reparses as the subject, not as a negated When', () => {
    // Serialized bare, `-1\left\{c\right\}` reads as `Negate(When(1, c))` —
    // the negation applied to the restriction instead of to its subject.
    const expr = ce.box(['When', -1, ['Equal', 'x', 'x']]);
    expect(expr.latex).toEqual('(-1)\\left\\{x=x\\right\\}');
    expect(ce.parse(expr.latex).json).toEqual([
      'When',
      -1,
      ['Equal', 'x', 'x'],
    ]);
  });
});

describe('a literal `0` operand survives the sibling serializers', () => {
  // Every one of these tested an operand for truthiness where it meant to test
  // for absence — `operand()` answers `null` when an operand is missing, and
  // the MathJSON of the literal `0` is the falsy number `0`.
  //
  // Serialization here is deliberately non-canonical: canonicalization folds
  // several of these away (`Sum` of a constant, `Delimiter`), and the defect is
  // in the serializer, which a consumer reaches on whatever tree it holds.
  const raw = (json: any) => ce.box(json, { canonical: false }).latex;

  test('`return 0` keeps its value', () => {
    expect(raw(['Return', 0])).toEqual('\\text{return }0');
    // A `Return` with nothing to return still prints the bare keyword.
    expect(raw(['Return'])).toEqual('\\text{return}');
    expect(raw(['Return', 'Nothing'])).toEqual('\\text{return}');
  });

  test('a big operator keeps a zero body AND its indexing sets', () => {
    // The body was dropped together with the limits, so the whole sum
    // collapsed to a bare `\\sum`.
    expect(raw(['Sum', 0, ['Limits', 'i', 1, 10]])).toEqual('\\sum_{i=1}^{10}0');
    expect(raw(['Product', 0, ['Limits', 'i', 1, 10]])).toEqual(
      '\\prod_{i=1}^{10}0'
    );
    expect(raw(['Sum'])).toEqual('\\sum');
  });

  test('an integral keeps a zero integrand', () => {
    expect(raw(['Integrate', 0, 'x'])).toEqual('\\int\\!0\\, \\mathrm{d}x');
    expect(raw(['Integrate'])).toEqual('\\int');
  });

  test('`Log` treats a zero base as a base', () => {
    // Notationally a base is a base; `\\log(x, 0)` was the argument-list
    // fallback meant for a one-operand `Log`.
    expect(raw(['Log', 'x', 0])).toEqual('\\log_{0}(x)');
    expect(raw(['Log', 'x'])).toEqual('\\log(x)');
  });

  test('a parenthesized zero integrand keeps its body', () => {
    // The differential-extraction pass reads a `Delimiter` body recursively,
    // and its "the parens held only differentials" branch also tested for
    // falsiness.
    expect(ce.parse('\\int (0)\\,dx', { form: 'raw' }).json).toEqual([
      'Integrate',
      ['Delimiter', 0],
      'x',
    ]);
  });

  test('`Delimiter` keeps a zero body', () => {
    expect(raw(['Delimiter', 0])).toEqual('(0)');
    expect(raw(['Delimiter', 0, "','"])).toEqual('0');
  });
});
