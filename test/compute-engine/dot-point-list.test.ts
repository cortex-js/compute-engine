import { expectTypeBetween } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `Dot` over a POINT LIST written as a tuple of coordinate lists — `(1, L)`
 * with `L` a list of numbers.
 *
 * Two claims are pinned here. The static type of such an inner product is
 * `broadcastable<number>` (a number for a point, a list of numbers for a point
 * list) instead of the wide `value` it used to be, and the operator now
 * COMPUTES the product instead of staying symbolic. A tuple whose components
 * are all provably numbers keeps its existing sharper type and its existing
 * `MatrixMultiply` route, and a tuple with a component the engine cannot prove
 * numeric still types `value` and still stays symbolic.
 *
 * NOTE: declaring a symbol retypes it for the engine's lifetime, so each block
 * builds a FRESH engine rather than share one.
 */
describe('Dot over a tuple with collection components', () => {
  describe('typing', () => {
    function engine() {
      const ce = new ComputeEngine();
      ce.declare('a', 'tuple<broadcastable<number>, broadcastable<number>>');
      ce.declare('b', 'tuple<broadcastable<number>, broadcastable<number>>');
      ce.declare('c', 'tuple<real, real>');
      ce.declare('d', 'tuple<real, real>');
      ce.declare('L', 'list<number>');
      return ce;
    }

    test('two broadcastable tuples → broadcastable<number> (was `value`)', () => {
      const e = engine().parse('\\operatorname{Dot}(a,b)');
      expect(e.isValid).toBe(true);
      expect(e.type.toString()).toBe('broadcastable<number>');
    });

    test('two declared real points sharpen to `real` (was `number`)', () => {
      // A declared point carries no operands, so the inner product used to
      // stay at the operator's declared `number`. Its components are in its
      // TYPE, and the sum of the products of two reals is a real — the same
      // sharpening a literal point already had. It matters because `number`
      // admits a complex value, so no `real`-declared slot accepted the
      // inner product of two points declared real.
      const e = engine().parse('\\operatorname{Dot}(c,d)');
      expect(e.type.toString()).toBe('real');
      expect(e.type.matches('number')).toBe(true);
    });

    test('a list component sharpens to a list of numbers (was `value`)', () => {
      const e = engine().parse('\\operatorname{Dot}((1,L),(3,4))');
      expect(e.type.toString()).toBe('list<number>');
      expect(e.type.matches('broadcastable<number>')).toBe(true);
    });

    test('two integer tuples still → integer', () => {
      const e = engine().parse('\\operatorname{Dot}((1,2),(3,4))');
      expect(e.type.toString()).toBe('integer');
    });

    test('an unprovable component keeps `value`', () => {
      // `x` and `y` are undeclared, so each is `unknown` — it could be a
      // string or a nested tuple, and no numeric claim is sound.
      const e = new ComputeEngine().parse('\\operatorname{Dot}((x,y),(1,2))');
      expect(e.type.toString()).toBe('value');
    });

    test('unequal component counts keep `value`', () => {
      const e = engine().parse('\\operatorname{Dot}((1,L),(3,4,5))');
      expect(e.type.toString()).toBe('value');
    });

    test('a vector paired with a broadcastable tuple keeps `value`', () => {
      const e = engine().parse('\\operatorname{Dot}(a,L)');
      expect(e.type.toString()).toBe('value');
    });

    test('the enumerability facet declines on a broadcastable result', () => {
      // The value is a number for a point and a list for a point list, so a
      // definite `false` would be wrong.
      expect(
        engine().parse('\\operatorname{Dot}(a,b)').isEnumerableCollection
      ).toBe(undefined);
      // A sharpened SCALAR result has nothing to walk: still a definite
      // `false`.
      expect(
        engine().parse('\\operatorname{Dot}(c,d)').isEnumerableCollection
      ).toBe(false);
    });
  });

  describe('typing through a chain of user functions', () => {
    // The shape the Tycho heat-map shader produces: a unit vector `p` whose
    // components are `broadcastable`, dotted with an offset point.
    function engine() {
      const ce = new ComputeEngine();
      ce.declare('p_rand', {
        type: '(unknown) -> unknown',
        value: ce.parse(
          '(p)\\mapsto \\operatorname{mod}(\\sin(\\operatorname{Dot}(p, (12.9898,78.233,45.164)))\\cdot 43758.5453, 1)'
        ),
      });
      ce.declare('theta_0', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse(
          '(x,y)\\mapsto 2\\pi\\cdot p_{rand}((\\lfloor x\\rfloor,\\lfloor y\\rfloor,2.41))+2.855'
        ),
      });
      ce.declare('p', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse(
          '(x,y)\\mapsto (\\cos(\\theta_0(x,y)), \\sin(\\theta_0(x,y)))'
        ),
      });
      ce.declare('s_x', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(x,1)'),
      });
      ce.declare('s_y', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse('(x,y)\\mapsto \\operatorname{mod}(y,1)'),
      });
      ce.declare('S', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse('(x,y)\\mapsto (-s_x(x,y), -s_y(x,y))'),
      });
      ce.declare('d_00', {
        type: '(unknown, unknown) -> unknown',
        value: ce.parse(
          '(x,y)\\mapsto \\operatorname{Dot}(p(x,y), S(x,y)+(0,0))'
        ),
      });
      return ce;
    }

    test('`p` carries numeric shape through its function chain', () => {
      expectTypeBetween(engine().parse('p(x,y)'), {
        atMost: 'tuple<number, number>',
      });
    });

    test('the dot product carries the scalar shape', () => {
      const e = engine().parse('\\operatorname{Dot}(p(x,y),S(x,y)+(0,0))');
      expectTypeBetween(e, { atMost: 'number' });
    });

    test('the reconciled declaration of `d_00` narrows (was `-> value`)', () => {
      expect(engine().box('d_00').type.toString()).toBe(
        '(unknown, unknown) -> number'
      );
    });
  });

  describe('evaluation', () => {
    function engine() {
      const ce = new ComputeEngine();
      ce.assign('L', ce.parse('[1,2]'));
      return ce;
    }

    /** Evaluate and check the value stays inside the declared type. */
    function evaluated(latex: string) {
      const expr = engine().parse(latex);
      const result = expr.evaluate();
      expect(result.type.matches(expr.type)).toBe(true);
      return result;
    }

    test('a list in one operand broadcasts: (1, L)·(3, 4)', () => {
      expect(evaluated('\\operatorname{Dot}((1,L),(3,4))').toString()).toBe(
        '[7,11]'
      );
    });

    test('a list in both operands: (1, L)·(3, L)', () => {
      expect(evaluated('\\operatorname{Dot}((1,L),(3,L))').toString()).toBe(
        '[4,7]'
      );
    });

    test('a literal list component behaves the same', () => {
      expect(evaluated('\\operatorname{Dot}((1,[1,2]),(3,4))').toString()).toBe(
        '[7,11]'
      );
    });

    test('.N() of a point list gives the same list', () => {
      expect(
        engine().parse('\\operatorname{Dot}((1,L),(3,4))').N().toString()
      ).toBe('[7,11]');
    });

    test('an all-number point keeps the existing inner product', () => {
      expect(evaluated('\\operatorname{Dot}((1,2),(3,4))').toString()).toBe(
        '11'
      );
    });

    test('two vectors keep the existing inner product', () => {
      expect(evaluated('\\operatorname{Dot}([1,2],[3,4])').toString()).toBe(
        '11'
      );
    });

    test('two matrices keep the existing matrix product', () => {
      expect(
        evaluated('\\operatorname{Dot}([[1,2],[3,4]],[[5,6],[7,8]])').toString()
      ).toBe('[[19,22],[43,50]]');
    });

    test('a symbolic non-collection component stays symbolic', () => {
      expect(evaluated('\\operatorname{Dot}((x,2),(3,4))').toString()).toBe(
        'Dot((x, 2), (3, 4))'
      );
    });

    test('unequal component counts stay symbolic without throwing', () => {
      expect(evaluated('\\operatorname{Dot}((1,L),(3,4,5))').toString()).toBe(
        'Dot((1, [1,2]), (3, 4, 5))'
      );
    });
  });

  describe('the evaluate route admits what the type route admits', () => {
    // The point-list route reads a POINT operand and nothing else, so a list
    // value is produced only where the static type is `broadcastable<number>`.
    // A `List` operand on that route would answer a list under the wide type
    // `value`, and the enumerability facet — which reads the type — would then
    // describe a list as something else.
    function engine() {
      const ce = new ComputeEngine();
      ce.assign('L', ce.parse('[1,2]'));
      return ce;
    }

    test('a list-valued inner product keeps a facet that admits a list', () => {
      const e = engine().parse('\\operatorname{Dot}((1,L),(3,4))');
      expect(e.evaluate().type.matches('list<number>')).toBe(true);
      // A definite `false` would deny an enumerable collection that IS one.
      expect(e.isEnumerableCollection).not.toBe(false);
    });

    test('a point dotted with a vector stays symbolic', () => {
      // The `type` handler has no tier for a tuple paired with a list, so this
      // shape types the wide `value`. The evaluate route refuses it for the
      // same reason, instead of answering a list the type does not describe.
      const e = engine().parse('\\operatorname{Dot}((1,L),[2,3])');
      expect(e.type.toString()).toBe('value');
      expect(e.evaluate().toString()).toBe('Dot((1, [1,2]), [2,3])');
    });
  });

  describe('the compiled route agrees with the interpreter', () => {
    // A point with a collection component broadcasts in the interpreter and
    // has no lowering in the JavaScript target — `_SYS.matmul` multiplies the
    // nested array whole. The compile fails closed (D6) and the fallback
    // answers through the interpreter, so no wrong value is ever returned
    // behind `success: true`.
    function engine() {
      const ce = new ComputeEngine();
      ce.declare('L', 'list<number>');
      return ce;
    }

    test('`Dot((1, L), (3, 4))` answers the interpreter value, not NaN', () => {
      const r = compile(engine().parse('\\operatorname{Dot}((1,L),(3,4))'), {
        constantFold: false,
      });
      expect(r.success).toBe(false);
      expect(r.run!({ L: [1, 2] })).toEqual([7, 11]);
    });

    test('an all-number point still compiles to the written-out product', () => {
      const r = compile(engine().parse('\\operatorname{Dot}((1,2),(3,4))'), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.run!({})).toBe(11);
    });

    test('a matrix written as a list of rows still compiles', () => {
      const ce = new ComputeEngine();
      ce.declare('r', 'list<number>');
      ce.declare('s', 'list<number>');
      const r = compile(ce.parse('\\operatorname{Dot}([r,s],[[1,0],[0,1]])'), {
        fallback: false,
        constantFold: false,
      });
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.matmul');
    });
  });
});
