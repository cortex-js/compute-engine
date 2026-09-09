import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';

/**
 * Assigning a function literal to a symbol declared with the bare `function`
 * wildcard must keep the body's inferred result type, including a result that
 * is a union with an absence marker.
 *
 * A piecewise head with no default arm — a `Which` with no literal-`True`
 * clause, and the else-less `If` — types `missing | T` (ruled 2026-09-09). The
 * declared-signature reconciliation on the assign route reads the wildcard's
 * result as `unknown` and used to ascribe it onto the body whenever the body's
 * own result failed a covariant check against `unknown`. Because `unknown`
 * excludes the absence markers, `missing | rational` failed that check and was
 * rebuilt as `-> unknown`, while a plain `number` body passed and was left
 * alone. The symbol then had no usable result type, so every product around a
 * call to it broadcast instead of multiplying.
 *
 * The fix is in `reconcileFunctionLiteralReturn`
 * (`src/compute-engine/engine-declarations.ts`): a declared result of
 * `unknown` is a placeholder the definition refines, so it is never ascribed.
 */

/** A `Which` with no default arm: types `missing | rational`. */
const WHICH_BODY = [
  'Which',
  ['Less', ['Mod', 't', 5], 1],
  ['Rational', 1, 2],
  ['Equal', ['Floor', 't'], 26],
  ['Rational', 1, 2],
] as const;

/** A body with an ordinary numeric result, as a control. */
const PLAIN_BODY = ['Add', ['Mod', 't', 1], ['Rational', -1, 2]] as const;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'number');
  return ce;
}

function literal(ce: ComputeEngine, body: unknown): BoxedExpression {
  return ce.box(['Function', ['Block', body as any], 't'] as any);
}

describe('assign keeps a `missing | T` result under a bare `function` declaration', () => {
  it('types the literal itself as `missing | rational`', () => {
    const ce = engine();
    expect(literal(ce, WHICH_BODY).type.toString()).toBe(
      '(unknown) -> missing | rational'
    );
  });

  it('keeps the union on the no-declare route', () => {
    const ce = engine();
    ce.assign('l', literal(ce, WHICH_BODY));
    expect(ce.parse('l(t)').type.toString()).toBe('missing | rational');
  });

  it('keeps the union on the signature-declare route', () => {
    const ce = engine();
    ce.declare('l', '(unknown) -> unknown');
    ce.assign('l', literal(ce, WHICH_BODY));
    expect(ce.parse('l(t)').type.toString()).toBe('missing | rational');
  });

  it('keeps the union after a bare `function` declaration (boxed literal)', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', literal(ce, WHICH_BODY));
    expect(ce.parse('l(t)').type.toString()).toBe('missing | rational');
  });

  it('keeps the union after a bare `function` declaration (parsed `\\mapsto`)', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', ce.parse('t \\mapsto \\mathrm{Which}(t < 1, 1, t > 3, 2)'));
    expect(ce.parse('l(t)').type.toString()).toBe('integer | missing');
  });

  it('keeps the union after a bare `function` declaration (`f(t) := …` parse route)', () => {
    const ce = engine();
    ce.declare('g', 'function');
    ce.parse('g(t) := \\mathrm{Which}(t < 1, 1, t > 3, 2)').evaluate();
    expect(ce.parse('g(t)').type.toString()).toBe('integer | missing');
  });

  it('keeps a plain numeric result after a bare `function` declaration', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', literal(ce, PLAIN_BODY));
    expect(ce.parse('l(t)').type.toString()).toBe('number');
  });

  it('does not broadcast a scalar function of the call', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', literal(ce, WHICH_BODY));
    expect(ce.parse('\\sin(l(t))').type.toString()).toBe('number');
  });

  it('keeps an else-less `If` result and the other absence marker', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', literal(ce, ['If', ['Less', 't', 1], 1]));
    expect(ce.parse('l(t)').type.toString()).toBe('integer | missing');

    const ce2 = engine();
    ce2.declare('l', 'function');
    ce2.assign('l', literal(ce2, 'Nothing'));
    expect(ce2.parse('l(t)').type.toString()).toBe('nothing');
  });

  it('keeps a `nan` result and a marker nested in a collection (unaffected before the fix)', () => {
    const ce = engine();
    ce.declare('l', 'function');
    ce.assign('l', literal(ce, ['Divide', 0, 0]));
    expect(ce.parse('l(t)').type.toString()).toBe('nan');

    const ce2 = engine();
    ce2.declare('l', 'function');
    ce2.assign(
      'l',
      literal(ce2, ['Tuple', ['If', ['Less', 't', 1], 1], ['Add', 't', 1]])
    );
    expect(ce2.parse('l(t)').type.toString()).toBe(
      'tuple<integer | missing, number>'
    );
  });
});
