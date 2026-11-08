import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

// CE-1150 (user decision 2026-11-08, option (b) (a separate accessor) of
// `docs/plans/2026-11-08-ce1150-static-shape-of-an-application.md`):
// `staticShape` answers the collection shape that an expression promises
// before it is evaluated. A collection value answers from its collection
// facets. A symbol with no collection value answers from its declared type.
// An application whose head is bound (a library operator, an assigned
// function literal, a declared signature) answers from its static type; a
// call of an undeclared name promises nothing (its type is the lift of a
// vacuous binding, Tycho item 169). A selection (`If` with an else branch,
// `Which`) answers the shape its arms agree on.
//
// The collection getters (`isCollection`, `count`, ...) keep their meaning:
// "is a collection value present that I can walk now".

/** The expression evaluates to a collection, and its value names the same
 * count as the promise. Every caller passes an expression whose value is a
 * list or a tuple, so the count of the value must be defined. */
function expectValueAgrees(expr: Expression): void {
  const promised = expr.staticShape?.count;
  const value = expr.evaluate().staticShape?.count;
  expect(value).toBeDefined();
  if (promised !== undefined) expect(value).toBe(promised);
}

describe('CE-1150: staticShape', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a call of an assigned lambda that returns a list', () => {
    ce.assign('f', ce.parse('(n) \\mapsto [n, n+1, n+2, \\frac{n}{2}]'));
    const call = ce.parse('f(3)');
    expect(call.type.toString()).toBe('vector<rational^4>');
    expect(call.staticShape).toEqual({
      indexed: true,
      count: 4,
      elementType: 'rational',
    });
    // The getters keep their meaning: nothing to walk before evaluation.
    expect(call.isCollection).toBe(false);
    expect(call.count).toBe(undefined);
    expectValueAgrees(call);
  });

  test('a call of a declared signature with no length in its type', () => {
    ce.declare('g', '(integer) -> list<real>');
    const shape = ce.parse('g(3)').staticShape;
    expect(shape?.indexed).toBe(true);
    expect(shape?.count).toBe(undefined);
    expect(shape?.elementType).toBe('real');
  });

  // CE-1157: a head declared through a transparent type alias of a signature
  // is typed, checked and broadcast as under the written-out signature. The
  // symbol itself keeps the alias as its type.
  test('a call of a head declared through a type alias of a signature', () => {
    ce.declareType('Fn', '(integer) -> list<real>', { alias: true });
    ce.declare('g', 'Fn');
    ce.declare('h', '(integer) -> list<real>');
    expect(ce.box('g').type.toString()).toBe('Fn');
    const call = ce.parse('g(3)');
    expect(call.type.toString()).toBe('list<real>');
    const shape = call.staticShape;
    expect(shape?.indexed).toBe(true);
    expect(shape?.count).toBe(undefined);
    expect(shape?.elementType).toBe('real');
    // The argument check and the broadcast read the same signature as the
    // written-out declaration.
    expect(ce.box(['g', "'a'"]).type.toString()).toBe('error');
    expect(ce.box(['g', ['List', 1, 2]]).type.toString()).toBe(
      ce.box(['h', ['List', 1, 2]]).type.toString()
    );
  });

  test('a call that returns a point names two elements', () => {
    ce.assign('h', ce.parse('(n) \\mapsto (n, n+1)'));
    const call = ce.parse('h(3)');
    expect(call.type.toString()).toBe('tuple<integer, integer>');
    expect(call.staticShape?.count).toBe(2);
    expectValueAgrees(call);
  });

  test('a `nothing` arm is an absence, not another shape', () => {
    ce.declare('g', '(integer) -> list<real> | nothing');
    const shape = ce.parse('g(3)').staticShape;
    expect(shape?.indexed).toBe(true);
    expect(shape?.count).toBe(undefined);
  });

  test('a union of two shapes, or a scalar type, promises nothing', () => {
    ce.declare('g', '(integer) -> list<real> | integer');
    expect(ce.parse('g(3)').staticShape).toBe(undefined);
    ce.declare('k', '(integer) -> color');
    expect(ce.parse('k(3)').staticShape).toBe(undefined);
  });

  test('a broadcast of a library operator', () => {
    const expr = ce.parse('[1,2]+x');
    expect(expr.type.toString()).toBe('vector<2>');
    expect(expr.staticShape?.indexed).toBe(true);
    expect(expr.staticShape?.count).toBe(2);
    expect(expr.isCollection).toBe(false);
    expect(expr.count).toBe(2);

    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const abs = ce.box(['Abs', 'L']);
    expect(abs.staticShape?.count).toBe(3);
    expectValueAgrees(abs);
  });

  test('a broadcastable operator whose own result is a collection', () => {
    // `AbsArg` and `ComplexRoots` are broadcastable, but their signatures
    // name a collection result: the shape is intrinsic to the head, not a
    // lift over a collection operand.
    const absArg = ce.box(['AbsArg', 2]);
    expect(absArg.staticShape?.count).toBe(2);
    expectValueAgrees(absArg);
    // The type is `list<number>`, which names no length, so the promise is
    // an indexed collection with no count.
    const roots = ce.box(['ComplexRoots', 8, 3]);
    expect(roots.type.toString()).toBe('list<number>');
    expect(roots.staticShape?.indexed).toBe(true);
    expect(roots.staticShape?.count).toBe(undefined);
    expectValueAgrees(roots);
  });

  test('a generic head whose result is a collection type', () => {
    // The type variables of the arm are read as their bounds to test the
    // result; the shape is read from the instantiated type.
    ce.declare('wrap', '(T) -> list<T> where T');
    const call = ce.box(['wrap', 3]);
    expect(call.type.toString()).toBe('list<integer>');
    expect(call.staticShape).toEqual({
      indexed: true,
      count: undefined,
      elementType: 'integer',
    });
    // `PlusMinus` is `(T, U) -> tuple<T, U> where T: value, U: value`.
    const pm = ce.box(['PlusMinus', 1, 0.1]);
    expect(pm.type.toString()).toBe('tuple<integer, real>');
    expect(pm.staticShape?.count).toBe(2);
    expectValueAgrees(pm);
  });

  test('a head whose own result is a collection, over an undeclared call, promises nothing', () => {
    ce.assign('f', ce.parse('(n) \\mapsto [n, n+1, n+2, \\frac{n}{2}]'));
    // `foo([1, 2])` evaluates to itself, so no broadcast happens: the value
    // is one list of 4 elements.
    expect(ce.box(['f', ['foo', ['List', 1, 2]]]).staticShape).toBe(
      undefined
    );
    expect(ce.box(['AbsArg', ['foo', ['List', 1, 2]]]).staticShape).toBe(
      undefined
    );
    expect(ce.box(['f', 3]).staticShape?.count).toBe(4);
    ce.assign('L', ce.box(['List', 1, 2]));
    const call = ce.box(['f', 'L']);
    expect(call.staticShape?.count).toBe(2);
    expectValueAgrees(call);
  });

  test('a call of an overload set declared on a value definition', () => {
    ce.declare('g', '((integer) -> vector<2>) & ((string) -> vector<3>)');
    expect(ce.box(['g', 3]).staticShape?.count).toBe(2);
    expect(ce.box(['g', "'a'"]).staticShape?.count).toBe(3);
  });

  test('a call of a union of signatures', () => {
    // A union of signatures is "one of these functions": the call types the
    // union of the results, `vector<2> | vector<3>`, which is a union of two
    // shapes and promises nothing.
    ce.declare('u', '((integer) -> vector<2>) | ((integer) -> vector<3>)');
    const call = ce.box(['u', 3]);
    expect(call.type.toString()).toBe('vector<2> | vector<3>');
    expect(call.staticShape).toBe(undefined);
  });

  test('a scalar function literal lifted over an undeclared call promises nothing', () => {
    ce.assign('g', ce.parse('(x) \\mapsto x^2+1'));
    expect(ce.box(['g', ['foo', ['List', 1, 2]]]).staticShape).toBe(
      undefined
    );
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const call = ce.box(['g', 'L']);
    expect(call.staticShape?.count).toBe(3);
    expectValueAgrees(call);
  });

  test('an undeclared head promises nothing (item 169)', () => {
    const expr = ce.parse(
      '\\operatorname{foo}\\left(\\left[1,2\\right]\\right)'
    );
    expect(expr.type.toString()).toBe('list<unknown^2>');
    expect(expr.staticShape).toBe(undefined);
    expect(expr.isCollection).toBe(false);
    expect(expr.count).toBe(undefined);
  });

  test('a broadcast over a call of an undeclared head promises nothing', () => {
    const expr = ce.box(['Add', 'x', ['Total', ['List', 1, 2]]]);
    expect(expr.staticShape).toBe(undefined);
  });

  test('a call whose type is `never` promises nothing', () => {
    expect(ce.box(['RuntimeError', "'x'"]).staticShape).toBe(undefined);
  });

  test('a scalar application promises nothing', () => {
    expect(ce.parse('\\sin(x)').staticShape).toBe(undefined);
    expect(ce.box(['Add', 1, 2]).staticShape).toBe(undefined);
  });

  test('a string-typed application promises nothing, a string value is a collection', () => {
    expect(ce.box(['StringJoin', "'a'", "'b'"]).staticShape).toBe(undefined);
    const shape = ce.box({ str: 'ab' }).staticShape;
    expect(shape?.indexed).toBe(true);
    expect(shape?.count).toBe(2);
  });

  test('a symbol: declared with no value, and holding a list', () => {
    ce.declare('V', 'vector<2>');
    const v = ce.box('V');
    expect(v.isCollection).toBe(false);
    expect(v.staticShape?.indexed).toBe(true);
    expect(v.staticShape?.count).toBe(2);

    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const l = ce.box('L');
    expect(l.isCollection).toBe(true);
    expect(l.staticShape?.count).toBe(3);
    expectValueAgrees(l);
  });

  describe('a selection answers the shape its arms agree on', () => {
    test('If with an else branch, arms of the same length', () => {
      const sel = ce.box(['If', 'c', ['List', 1, 2], ['List', 3, 4]]);
      expect(sel.staticShape?.indexed).toBe(true);
      expect(sel.staticShape?.count).toBe(2);
      expect(sel.staticShape?.elementType).toBe('integer');
    });

    test('arms of different lengths: no count', () => {
      const sel = ce.box(['If', 'c', ['List', 1, 2], ['List', 3, 4, 5]]);
      expect(sel.staticShape?.indexed).toBe(true);
      expect(sel.staticShape?.count).toBe(undefined);
      // The element type is read from the arms, not from the type of the
      // selection, which is `list<integer | list<any>>`.
      expect(sel.staticShape?.elementType).toBe('integer');
    });

    test('Which with no default: the absence is set aside', () => {
      ce.declare('c', 'boolean');
      const sel = ce.box(['Which', 'c', ['List', 1, 2]]);
      expect(sel.staticShape?.count).toBe(2);
      expect(sel.staticShape?.elementType).toBe('integer');
    });

    test('a `never` arm gives no value and is skipped', () => {
      const sel = ce.box([
        'If',
        'c',
        ['List', 1, 2],
        ['RuntimeError', "'neg'"],
      ]);
      expect(sel.staticShape?.count).toBe(2);
    });

    test('a user definition named If is not a selection', () => {
      ce.pushScope();
      ce.declare('If', '(boolean, list<integer>, list<integer>) -> integer');
      const call = ce.box(['If', 'True', ['List', 1, 2], ['List', 3, 4]]);
      expect(call.staticShape).toBe(undefined);
      ce.popScope();
    });

    test('Which with a True default', () => {
      const sel = ce.box([
        'Which',
        'c',
        ['List', 1, 2],
        'True',
        ['List', 3, 4],
      ]);
      expect(sel.staticShape?.count).toBe(2);
      expect(sel.staticShape?.elementType).toBe('integer');
    });

    test('arms that are calls of user functions', () => {
      ce.assign('f', ce.parse('(n) \\mapsto [n, n+1, n+2, \\frac{n}{2}]'));
      const sel = ce.box(['If', 'c', ['f', 1], ['f', 2]]);
      expect(sel.staticShape?.count).toBe(4);
    });

    test('a scalar arm, or a point arm, promises nothing', () => {
      expect(ce.box(['If', 'c', ['List', 1, 2], 3]).staticShape).toBe(
        undefined
      );
      expect(
        ce.box(['If', 'c', ['Tuple', 1, 2], ['Tuple', 3, 4]]).staticShape
      ).toBe(undefined);
    });

    test('a restricted point promises nothing', () => {
      expect(ce.box(['If', 'c', ['Tuple', 1, 2]]).staticShape).toBe(
        undefined
      );
    });

    test('a mask condition answers from the type, which admits NaN cells', () => {
      // An element-wise selection gives `NaN` for an unmatched cell: the
      // value is `[1, NaN]`, so the element type is not the `integer` of the
      // arm.
      const sel = ce.box(['Which', ['List', 'True', 'False'], ['List', 1, 2]]);
      expect(sel.staticShape).toEqual({
        indexed: true,
        count: 2,
        elementType: 'number',
      });
      expect(sel.evaluate().toString()).toBe('[1,NaN]');
    });

    test('a boolean condition still answers from the arms', () => {
      ce.declare('c', 'boolean');
      const sel = ce.box(['If', 'c', ['List', 1, 2], ['List', 3, 4]]);
      expect(sel.staticShape?.count).toBe(2);
      expect(sel.staticShape?.elementType).toBe('integer');
    });

    test('a selection is not walked before it is evaluated', () => {
      // This is the documented limitation of `staticShape`
      // (`docs/COLLECTIONS-MODEL.md`, "The shape of an unevaluated
      // application"): the handlers of `If` opt out of the collection facets
      // for three operands, so the unevaluated selection gives no elements
      // although its static shape promises 2.
      const sel = ce.box(['If', 'True', ['List', 1, 2], ['List', 3, 4]]);
      expect(sel.staticShape?.count).toBe(2);
      expect([...sel.each()].length).toBe(0);
      expect(sel.at(1)).toBe(undefined);
      expect([...sel.evaluate().each()].length).toBe(2);
    });

    test('the value agrees with the promise', () => {
      ce.assign('c', true);
      expectValueAgrees(ce.box(['If', 'c', ['List', 1, 2], ['List', 3, 4]]));
    });
  });

  test('the collection getters are unchanged', () => {
    ce.assign('f', ce.parse('(n) \\mapsto [n, n+1, n+2, \\frac{n}{2}]'));
    const call = ce.parse('f(3)');
    expect(call.isCollection).toBe(false);
    expect(call.count).toBe(undefined);
    expect(ce.box(['Sum', ['Sort', ['List', 2, 1]]]).evaluate().json).toBe(3);
  });
});
