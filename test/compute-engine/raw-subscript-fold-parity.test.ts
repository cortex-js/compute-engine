/**
 * Raw-form subscript folding is script-independent (user-ruled 2026-08-19,
 * consumer item: a raw-form reader discovering definition heads saw `"a_0"`
 * for a Latin base but `["Subscript","eta","w"]` for a Greek one).
 *
 * The rule, identical for a single-letter base (`a`) and a dictionary-spelled
 * one (`\eta`):
 * - a base with `subscriptEvaluate` owns its subscripts (never folds);
 * - an indexed-collection base folds only a DECLARED joined name — an
 *   undeclared subscript keeps the `At(base, sub)` element-access reading;
 * - any other base folds unconditionally, declared or not.
 *
 * Canonical form folded both scripts before this rule; these tests pin the
 * RAW form, where the two scripts used to diverge.
 */
import { ComputeEngine } from '../../src/compute-engine';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;

describe('raw-form subscript folding, Latin vs Greek parity', () => {
  test('undeclared names fold to a joined symbol on both scripts', () => {
    expect(raw('a_{0}')).toEqual('a_0');
    expect(raw('b_{w}')).toEqual('b_w');
    expect(raw('\\eta_{w}')).toEqual('eta_w');
    expect(raw('\\lambda_{0}')).toEqual('lambda_0');
    expect(raw('\\alpha_{1}')).toEqual('alpha_1');
  });

  test('prefixed (operatorname) bases fold, and both orders agree', () => {
    // The prefixed spelling routes through `matchPrefixedSymbol`, not the
    // dictionary branch — it must fold under the same rule (canonical has
    // always folded it), and the prime-first spelling must match.
    expect(raw('\\operatorname{speed}_{0}')).toEqual('speed_0');
    expect(raw("\\operatorname{speed}'_{0}(t)")).toEqual(
      raw("\\operatorname{speed}_{0}'(t)")
    );
    expect(raw("\\operatorname{speed}'_{0}(t)")).toEqual([
      'Apply',
      ['Derivative', 'speed_0', 1],
      't',
    ]);
  });

  test('a collection-typed prefixed base keeps the element-access reading', () => {
    ce.assign('speed', ce.box(['List', 10, 20, 30]));
    expect(raw('\\operatorname{speed}_{1}')).toEqual(['At', 'speed', 1]);
  });

  test('dictionary constants with subscripts fold like canonical always did', () => {
    // `\pi_{1}` canonicalized to the symbol `Pi_1` before this rule existed
    // (as did the Latin constant spelling `e_{1}` → `e_1`, even in raw
    // form); raw form folding it too is alignment, not a new reading.
    expect(raw('\\pi_{1}')).toEqual('Pi_1');
    expect(raw('e_{1}')).toEqual('e_1');
  });

  test('a function-trigger name keeps its subscript-binding call parser', () => {
    // `log` is claimed by a `kind: 'function'` dictionary entry whose parser
    // binds the subscript as the log BASE. Absorption folding `log_2` into a
    // symbol would make the trigger lookup miss and decay the call to a
    // product (caught by the full-suite gate on first landing).
    expect(ce.parse('\\operatorname{log}_2(x)').json).toEqual(['Log', 'x', 2]);
  });

  test('function-claimed and subscript-owning bases stay structural', () => {
    // `\Gamma` is the Gamma FUNCTION — a function-kind dictionary entry never
    // reaches the symbol-absorption branch, so its subscript stays a node.
    expect(raw('\\Gamma_{2}')).toEqual(['Subscript', 'Gamma', 2]);
    // `\gamma` maps to the EulerGamma constant, whose definition owns its
    // subscripts (the generalized γ_n family), so it never absorbs them.
    expect(raw('\\gamma_{2}')).toEqual(['Subscript', 'EulerGamma', 2]);
  });

  test('an indexed-collection base keeps the element-access reading', () => {
    ce.assign('a', ce.box(['List', 10, 20, 30]));
    ce.assign('eta', ce.box(['List', 10, 20, 30]));
    expect(raw('a_{1}')).toEqual(['At', 'a', 1]);
    expect(raw('\\eta_{1}')).toEqual(['At', 'eta', 1]);
    expect(ce.parse('\\eta_{1}').evaluate().json).toEqual(10);
  });

  test('a declared joined name wins over the element-access reading', () => {
    // The consumer-item-196 protection: `eta_w` declared while `eta` is a
    // collection must still resolve to the symbol, or the serializer's own
    // spelling of `eta_w` stops round-tripping.
    ce.assign('eta', ce.box(['List', 10, 20, 30]));
    ce.declare('eta_w', 'number');
    expect(raw('\\eta_{w}')).toEqual('eta_w');
  });

  test('dictionary-claimed unbraced constants are untouched', () => {
    // `\mu_0` (unbraced) is claimed whole by the physical-constant dictionary
    // entry before subscript absorption ever runs.
    expect(raw('\\mu_0')).toEqual('Mu0');
  });

  test('canonical form is unchanged: both scripts still fold', () => {
    expect(ce.parse('a_{0}').json).toEqual('a_0');
    expect(ce.parse('\\eta_{w}').json).toEqual('eta_w');
  });

  test('an expression subscript stays structural on both scripts', () => {
    // A subscript that is an expression, not a name fragment, is not folded
    // into a symbol on either script.
    expect(raw('a_{i+1}')).toEqual(['Subscript', 'a', ['Add', 'i', 1]]);
    expect(raw('\\eta_{i+1}')).toEqual(['Subscript', 'eta', ['Add', 'i', 1]]);
  });
});
