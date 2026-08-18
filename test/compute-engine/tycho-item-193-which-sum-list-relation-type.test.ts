import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Equal`/`NotEqual` broadcast element-wise ONLY in the list-vs-scalar case; a
 * comparison of two collections is a single whole-collection boolean. When one
 * operand is definitely a collection and the other is top-typed (`At(U, 1)`
 * with `U` declared bare `indexed_collection`), which of the two applies is
 * only settled once that operand evaluates — so the honest static type is
 * `broadcastable<boolean>`, the union `boolean | indexed_collection<boolean>`.
 *
 * The declared type used to be the scalar `boolean` while the value broadcast
 * to a list, and `Which` and `Sum` inherited the disagreement: the whole chain
 * `\sum_i Which(C = U_i, i, 0)` typed `number` and evaluated to `[1, 2, 1]`.
 *
 * Each row below pins the `.type` and the `.evaluate()` TOGETHER, so a
 * regression in either direction fails: the value's own type must be a subtype
 * of the declared one.
 */

/** The value an expression evaluates to must inhabit its declared type. */
function expectAgrees(expr: ReturnType<ComputeEngine['parse']>, type: string) {
  expect(expr.type.toString()).toBe(type);
  const value = expr.evaluate();
  expect(value.type.matches(type)).toBe(true);
  return value;
}

describe('Which/Sum over a list-valued relation: type follows evaluation', () => {
  /**
   * The witness shape: symbols are DECLARED and the expressions are parsed and
   * typed while they are still valueless (that is how a document is typed
   * before its rows are computed), then assigned and evaluated.
   */
  function witness(uType: string) {
    const ce = new ComputeEngine();
    ce.declare('C', 'indexed_collection');
    ce.declare('U', uType as any);
    const rows = {
      relation: ce.parse('C=U_1'),
      which: ce.parse('\\{C=U_1: 1, 0\\}'),
      sum: ce.parse('\\sum_{i=1}^{2}\\{C=U_i: i, 0\\}'),
      wholeCompare: ce.parse('C=U'),
      control: ce.parse('\\sum_{i=1}^{3} C'),
    };
    const assign = () => {
      ce.assign('C', ce.box(['List', 2, 3, 2]));
      ce.assign('U', ce.box(['List', 2, 3]));
    };
    return { ce, rows, assign };
  }

  describe('bare `indexed_collection` (element type unknown)', () => {
    // `U_1` types `unknown` here, so the comparison MIGHT be a whole-collection
    // compare (if `U_1` is itself a collection) and MIGHT broadcast (if it is a
    // scalar). `broadcastable<T>` is the type that admits both outcomes.
    test('relation, Which and Sum all type broadcastable and evaluate to lists', () => {
      const { rows, assign } = witness('indexed_collection');

      expect(rows.relation.type.toString()).toBe('broadcastable<boolean>');
      expect(rows.which.type.toString()).toBe('broadcastable<finite_integer>');
      expect(rows.sum.type.toString()).toBe('broadcastable<integer>');

      assign();

      expect(rows.relation.evaluate().toString()).toBe(
        '["True","False","True"]'
      );
      expect(rows.which.evaluate().toString()).toBe('[1,0,1]');
      expect(rows.sum.evaluate().toString()).toBe('[1,2,1]');

      // The values inhabit the types declared BEFORE any assignment.
      expect(
        rows.relation.evaluate().type.matches('broadcastable<boolean>')
      ).toBe(true);
      expect(
        rows.which.evaluate().type.matches('broadcastable<finite_integer>')
      ).toBe(true);
      expect(rows.sum.evaluate().type.matches('broadcastable<integer>')).toBe(
        true
      );
    });

    test('assignment refines the placeholder, and re-parses see the sharper types', () => {
      // HISTORY: this test used to pin "types do not depend on the symbols
      // having values". Since the Phase 1 placeholder-refinement ruling
      // (2026-08-18, `docs/INFERENCE_ROADMAP.md`), that invariant is
      // deliberately GONE for a symbol declared with a BARE constructor:
      // the assignment refines the element slot (`C: indexed_collection`
      // becomes `indexed_collection<finite_integer>`), so a re-parse lands
      // exactly where the concrete `list<number>` declaration leg has
      // always landed — the sharper, provable `list<…>` types. The
      // PRE-assignment types (the previous test) are unchanged: a valueless
      // placeholder still reads `broadcastable<…>`.
      const { ce, rows, assign } = witness('indexed_collection');
      expect(rows.relation.type.toString()).toBe('broadcastable<boolean>');
      assign();
      expect(ce.parse('C=U_1').type.toString()).toBe('list<boolean>');
      expect(ce.parse('\\{C=U_1: 1, 0\\}').type.toString()).toBe(
        'list<finite_integer>'
      );
      expect(ce.parse('\\sum_{i=1}^{2}\\{C=U_i: i, 0\\}').type.toString()).toBe(
        'list<integer>'
      );
    });
  });

  describe('concrete `list<number>` element type (regression guard)', () => {
    // `U_1` types `number` here — definitely a scalar — so the comparison
    // definitely broadcasts and the whole chain is a definite `list<…>`. This
    // path already worked; it must keep working.
    test('relation, Which and Sum all type list and evaluate to lists', () => {
      const { rows, assign } = witness('list<number>');

      expect(rows.relation.type.toString()).toBe('list<boolean>');
      expect(rows.which.type.toString()).toBe('list<finite_integer>');
      expect(rows.sum.type.toString()).toBe('list<integer>');

      assign();

      expect(rows.relation.evaluate().toString()).toBe(
        '["True","False","True"]'
      );
      expect(rows.which.evaluate().toString()).toBe('[1,0,1]');
      expect(rows.sum.evaluate().toString()).toBe('[1,2,1]');
    });
  });

  describe('controls: the outcomes that are statically decidable', () => {
    test('two definite collections compare as a whole: scalar boolean', () => {
      for (const uType of ['indexed_collection', 'list<number>']) {
        const { rows, assign } = witness(uType);
        expect(rows.wholeCompare.type.toString()).toBe('boolean');
        assign();
        expect(rows.wholeCompare.evaluate().toString()).toBe('"False"');
      }
    });

    test('a collection body under Sum stays an indexed collection', () => {
      const { rows, assign } = witness('indexed_collection');
      expect(rows.control.type.toString()).toBe('indexed_collection');
      assign();
      expect(rows.control.evaluate().toString()).toBe('[6,9,6]');
    });

    test('scalar vs scalar stays a scalar boolean', () => {
      const ce = new ComputeEngine();
      ce.declare('a', 'number');
      ce.declare('b', 'number');
      expectAgrees(ce.parse('a=b'), 'boolean');
      expect(ce.box(['Equal', 1, 1]).type.toString()).toBe('boolean');
      expect(ce.box(['NotEqual', 1, 2]).type.toString()).toBe('boolean');
    });

    test('a definite collection vs a definite scalar is a definite mask', () => {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      ce.declare('n', 'number');
      expect(ce.box(['Equal', 'L', 'n']).type.toString()).toBe('list<boolean>');
      expect(ce.box(['NotEqual', 'L', 'n']).type.toString()).toBe(
        'list<boolean>'
      );
      expect(
        ce.box(['Equal', ['List', 1, 2, 3], 2]).evaluate().toString()
      ).toBe('["False","True","False"]');
    });
  });

  describe('NotEqual follows Equal', () => {
    test('collection vs top-typed operand', () => {
      const ce = new ComputeEngine();
      ce.declare('C', 'indexed_collection');
      ce.declare('U', 'indexed_collection');
      const e = ce.box(['NotEqual', 'C', ['At', 'U', 1]]);
      expect(e.type.toString()).toBe('broadcastable<boolean>');
      ce.assign('C', ce.box(['List', 2, 3, 2]));
      ce.assign('U', ce.box(['List', 2, 3]));
      const value = e.evaluate();
      expect(value.toString()).toBe('["False","True","False"]');
      expect(value.type.matches('broadcastable<boolean>')).toBe(true);
    });
  });

  describe('the ordering comparisons are unaffected', () => {
    // `Less`/`Greater`/… broadcast element-wise in EVERY collection case (a
    // collection-vs-collection ordering is the element-wise zip, not a whole
    // compare), so they never have an undecidable outcome and already typed
    // the definite `list<boolean>`. Pinned so the `Equal` change does not
    // silently drag them to `broadcastable`.
    test.each(['Less', 'Greater', 'LessEqual', 'GreaterEqual'])(
      '%s over a collection stays list<boolean>',
      (operator) => {
        const ce = new ComputeEngine();
        ce.declare('C', 'indexed_collection');
        ce.declare('U', 'indexed_collection');
        ce.declare('n', 'number');
        expect(ce.box([operator, 'C', 'n']).type.toString()).toBe(
          'list<boolean>'
        );
        expect(ce.box([operator, 'C', ['At', 'U', 1]]).type.toString()).toBe(
          'list<boolean>'
        );
      }
    );
  });

  describe('If with a possibly-broadcast condition', () => {
    test('with an else branch: broadcastable of the arm join', () => {
      const ce = new ComputeEngine();
      ce.declare('C', 'indexed_collection');
      ce.declare('U', 'indexed_collection');
      const e = ce.box(['If', ['Equal', 'C', ['At', 'U', 1]], 1, 0]);
      expect(e.type.toString()).toBe('broadcastable<finite_integer>');
      ce.assign('C', ce.box(['List', 2, 3, 2]));
      ce.assign('U', ce.box(['List', 2, 3]));
      const value = e.evaluate();
      expect(value.toString()).toBe('[1,0,1]');
      expect(value.type.matches('broadcastable<finite_integer>')).toBe(true);
    });
  });
});
