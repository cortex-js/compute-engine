import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import type { Type } from '../../src/common/type/types';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describeType } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { BoxedType } from '../../src/common/type/boxed-type';

/**
 * Tycho ledger row 373: a user-function call whose argument is a LIST was
 * typed from the function's declared result, in which a pass-through
 * parameter reads `unknown`.
 *
 * A parameter that flows into the result unchanged (`r_zz(x, y, z, θ) := z`)
 * is never narrowed by a use, so the declared result of the function is
 * `unknown`, and every caller's declared result inherits it. A call with
 * scalar arguments is typed from the body with each parameter typed as its
 * argument (`callResultType`), which repairs it. A call that BROADCASTS over
 * a list argument was lifted from the declared per-element result instead,
 * so `F_1(x, y, z) := (−y, z, x)` over three lists typed
 * `list<tuple<number, unknown, unknown>>` while its value is a list of
 * number triples, and a chain of rotation helpers whose innermost one is a
 * pass-through typed `list<tuple<broadcastable<number>,
 * broadcastable<number>, broadcastable<unknown>>>` over a list of angles.
 * The lifted per-element result is now derived from the body with each
 * mapped argument typed as the cell the broadcast maps over
 * (`derivedBroadcastElementResult`, `boxed-function.ts`).
 *
 * The chain below is the one of the Tycho document `art/n7uhaaoq1q`, as
 * imported (angle unit aside). Row 373's instrument reads
 * `R_{Z2}(1,2,3,0,0,18)`, `R(1,2,3,0,0,18)` and `F_1([1,2],[3,4],[5,6])`.
 */

function expectAtMost(ce: ComputeEngine, latex: string, bound: string): void {
  const t = ce.parse(latex).type.type as Type;
  const ok = isSubtype(t, ce.type(bound).type);
  if (!ok)
    throw new Error(
      `expected the type of ${latex} to be at most ${bound}, got ${ce.parse(latex).type}`
    );
  expect(`${t}`).not.toContain('unknown');
}

function rotationChain(): ComputeEngine {
  const ce = new ComputeEngine();
  const def = (s: string) => ce.parse(s).evaluate();
  def(
    'R_{2D}(x,y,\\theta) := (x \\sin\\theta - y \\cos\\theta, x \\cos\\theta + y \\sin\\theta)'
  );
  def('r_{xx}(x,y,z,\\theta) := x');
  def('r_{xy}(x,y,z,\\theta) := \\operatorname{PointX}(R_{2D}(y,z,\\theta))');
  def('r_{xz}(x,y,z,\\theta) := \\operatorname{PointY}(R_{2D}(y,z,\\theta))');
  def('r_{yy}(x,y,z,\\theta) := y');
  def('r_{yx}(x,y,z,\\theta) := \\operatorname{PointX}(R_{2D}(x,z,\\theta))');
  def('r_{yz}(x,y,z,\\theta) := \\operatorname{PointY}(R_{2D}(x,z,\\theta))');
  def('r_{zz}(x,y,z,\\theta) := z');
  def('r_{zx}(x,y,z,\\theta) := \\operatorname{PointX}(R_{2D}(x,y,\\theta))');
  def('r_{zy}(x,y,z,\\theta) := \\operatorname{PointY}(R_{2D}(x,y,\\theta))');
  const inner =
    'r_{xx}(x,y,z,\\theta_x), r_{xy}(x,y,z,\\theta_x), r_{xz}(x,y,z,\\theta_x), \\theta_y';
  def(`R_{X}(x,y,z,\\theta_x,\\theta_y) := r_{yx}(${inner})`);
  def(`R_{Y}(x,y,z,\\theta_x,\\theta_y) := r_{yy}(${inner})`);
  def(`R_{Z}(x,y,z,\\theta_x,\\theta_y) := r_{yz}(${inner})`);
  const mid =
    'R_{X}(x,y,z,\\theta_x,\\theta_y), R_{Z}(x,y,z,\\theta_x,\\theta_y), R_{Y}(x,y,z,\\theta_x,\\theta_y), \\theta_z';
  def(`R_{X2}(x,y,z,\\theta_x,\\theta_y,\\theta_z) := r_{zx}(${mid})`);
  def(`R_{Y2}(x,y,z,\\theta_x,\\theta_y,\\theta_z) := r_{zy}(${mid})`);
  def(`R_{Z2}(x,y,z,\\theta_x,\\theta_y,\\theta_z) := r_{zz}(${mid})`);
  def(
    'R(x,y,z,\\theta_x,\\theta_y,\\theta_z) := (R_{X2}(x,y,z,\\theta_x,\\theta_y,\\theta_z), R_{Y2}(x,y,z,\\theta_x,\\theta_y,\\theta_z), R_{Z2}(x,y,z,\\theta_x,\\theta_y,\\theta_z))'
  );
  return ce;
}

describe('Tycho 373 — a pass-through parameter under list broadcast', () => {
  test('the declared results carry the unknown of the pass-through (by design)', () => {
    const ce = rotationChain();
    expect(ce.box('r_zz').type.toString()).toBe(
      '(unknown, unknown, unknown, unknown) -> unknown'
    );
    expect(ce.box('R_Z2').type.toString()).toContain('broadcastable<unknown>');
  });

  test('scalar calls type from the body (unchanged)', () => {
    const ce = rotationChain();
    expectAtMost(ce, 'R_{Z2}(1,2,3,0,0,18)', 'number');
    expectAtMost(ce, 'R(1,2,3,0,0,18)', 'tuple<number, number, number>');
    ce.declare('n', 'number');
    expectAtMost(ce, 'R(n,n,n,0,0,18)', 'tuple<number, number, number>');
  });

  test('a list of angles: the lifted element is typed from the body', () => {
    const ce = rotationChain();
    ce.assign('L', ce.parse('[1,2,3]'));
    expectAtMost(ce, 'R_{Z2}(1,2,3,0,0,L)', 'list<number>');
    expectAtMost(ce, 'R(1,2,3,0,0,L)', 'list<tuple<number, number, number>>');
    // The value agrees with the type.
    const v = ce.parse('R(1,2,3,0,0,L)').evaluate();
    expect(v.type.toString()).not.toContain('unknown');
    expect(
      isSubtype(
        v.type.type,
        ce.type('list<tuple<number, number, number>>').type
      )
    ).toBe(true);
  });

  test('a declared, valueless list of angles lifts the same way', () => {
    const ce = rotationChain();
    ce.declare('A', 'list<number>');
    const t = ce.box(['R', 1, 2, 3, 0, 0, 'A']).type;
    expect(`${t}`).toBe('list<tuple<number, number, number>>');
  });

  test('F_1(x, y, z) := (−y, z, x) over three lists', () => {
    const ce = new ComputeEngine();
    ce.parse('F_1(x,y,z) := (-y, z, x)').evaluate();
    expect(ce.box('F_1').type.toString()).toBe(
      '(unknown, unknown, unknown) -> tuple<number, unknown, unknown>'
    );
    const call = ce.parse('F_1([1,2],[3,4],[5,6])');
    expect(call.type.toString()).toBe('list<tuple<integer, integer, integer>>');
    expect(call.evaluate().toString()).toBe('[(-3, 5, 1),(-4, 6, 2)]');
    // One list beside scalars broadcasts over the list alone.
    expect(ce.parse('F_1(1,[3,4],5)').type.toString()).toBe(
      'list<tuple<integer, integer, integer>>'
    );
    // A real list types its cells real.
    expect(ce.parse('F_1([1.5,2],[3,4],[5,6])').type.toString()).toBe(
      'list<tuple<integer, integer, real>>'
    );
  });

  test('the same on a function held as an assigned lambda value (the Tycho route)', () => {
    const ce = new ComputeEngine();
    ce.assign('F_1', [
      'Function',
      ['Block', ['Tuple', ['Negate', 'ceArg_1'], 'ceArg_2', 'ceArg_0']],
      'ceArg_0',
      'ceArg_1',
      'ceArg_2',
    ] as any);
    expect(
      ce
        .box(['F_1', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]])
        .type.toString()
    ).toBe('list<tuple<integer, integer, integer>>');
    const ce2 = new ComputeEngine();
    ce2.declare('F_1', 'function');
    ce2.assign('F_1', [
      'Function',
      ['Tuple', ['Negate', 'y'], 'z', 'x'],
      'x',
      'y',
      'z',
    ] as any);
    expect(ce2.lookupDefinition('F_1')).toHaveProperty('value');
    expect(
      ce2
        .box(['F_1', ['List', 1, 2], ['List', 3, 4], ['List', 5, 6]])
        .type.toString()
    ).toBe('list<tuple<integer, integer, integer>>');
  });

  test('a nested list is mapped at its leaves', () => {
    const ce = new ComputeEngine();
    ce.parse('F_1(x,y,z) := (-y, z, x)').evaluate();
    const call = ce.parse('F_1([[1,2],[3,4]], 5, 6)');
    expect(call.type.toString()).toBe(
      'list<list<tuple<integer, integer, integer>>>'
    );
    expect(call.evaluate().toString()).toBe(
      '[[(-5, 6, 1),(-5, 6, 2)],[(-5, 6, 3),(-5, 6, 4)]]'
    );
  });

  test('a declared broadcastable<T> slot plan maps one rank: a nested row binds whole', () => {
    // A declared slot plan maps exactly one rank, so a nested row is the
    // cell, not the leaf. Both definition routes.
    const ce = new ComputeEngine();
    ce.declare('pairUp', '(broadcastable<value>) -> unknown');
    ce.assign('pairUp', ['Function', ['Tuple', 'x', 'x'], 'x'] as any);
    const nested = ce.box(['pairUp', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(nested.type.toString()).toBe(
      'list<tuple<vector<integer^2>, vector<integer^2>>>'
    );
    const value = nested.evaluate();
    expect(value.toString()).toBe('[([1,2], [1,2]),([3,4], [3,4])]');
    expect(isSubtype(value.type.type, nested.type.type)).toBe(true);
    const flat = ce.box(['pairUp', ['List', 1, 2]]);
    expect(flat.type.toString()).toBe('list<tuple<integer, integer>>');
    const ce2 = new ComputeEngine();
    ce2.assign('pairUp', [
      'Function',
      ['Tuple', 'x', 'x'],
      ['Typed', 'x', { str: 'broadcastable<value>' }],
    ] as any);
    expect(ce2.lookupDefinition('pairUp')).toHaveProperty('operator');
    const op = ce2.box(['pairUp', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(op.type.toString()).toBe(
      'list<tuple<vector<integer^2>, vector<integer^2>>>'
    );
    expect(isSubtype(op.evaluate().type.type, op.type.type)).toBe(true);
  });

  test('mapped operands of different ranks: the type wraps to the deepest rank', () => {
    // The shape-aware lift gave one plain list level for a rank mismatch,
    // which the narrowed element made unsound (before, the element was
    // `unknown` and the value fitted by accident). A scalar-parameter
    // function maps the value to the deepest rank.
    const ce = new ComputeEngine();
    ce.assign('P', ['Function', 'x', 'x', 'y'] as any);
    ce.assign('S', ['Function', ['Add', 'x', 'y'], 'x', 'y'] as any);
    for (const f of ['P', 'S']) {
      const call = ce.box([
        f,
        ['List', ['List', 1, 2], ['List', 3, 4]],
        ['List', 5, 6],
      ]);
      const value = call.evaluate();
      expect(value.type.toString()).toBe('matrix<integer^(2x2)>');
      expect(isSubtype(value.type.type, call.type.type)).toBe(true);
    }
    expect(
      ce
        .box(['P', ['List', ['List', 1, 2], ['List', 3, 4]], ['List', 5, 6]])
        .type.toString()
    ).toBe('list<list<integer>>');
  });

  test('a generic literal keeps its one-level wrap and is not derived', () => {
    // The type solver binds the type parameter itself, and one list level
    // is the whole lift: the dimensioned encoding of the value makes it a
    // member of that type (`generic-function-literals.test.ts`).
    const ce = new ComputeEngine();
    ce.assign('g', [
      'Function',
      ['Typed', ['Tuple', 'x', 'x'], { str: '(x: T) -> tuple<T, T> where T' }],
      'x',
    ] as any);
    const call = ce.box(['g', ['List', ['List', 1, 2], ['List', 3, 4]]]);
    expect(call.type.toString()).toBe('list<tuple<integer, integer>>');
    const value = call.evaluate();
    expect(value.toString()).toBe('[[(1, 1),(2, 2)],[(3, 3),(4, 4)]]');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('the chain on the Tycho route: bare `function` declarations, Block lambdas', () => {
    // Tycho's document manager declares every function `function` and
    // assigns a `["Function", ["Block", body], "ceArg_0", …]` lambda. On
    // that route the declared type is not a signature, and the derivation
    // of a nested call inside a body answered nothing, so the outer call
    // fell back to the declared result even with literal arguments
    // (`deriveApplicationType` now reads the literal's own inferred
    // signature for a bare `function` declaration).
    const ce = new ComputeEngine();
    const fn = (name: string, body: unknown, arity: number) => {
      const params = Array.from({ length: arity }, (_, i) => `ceArg_${i}`);
      ce.declare(name, 'function');
      ce.assign(name, ['Function', ['Block', body], ...params] as any);
    };
    const a = (i: number) => `ceArg_${i}`;
    fn(
      'R_2D',
      [
        'PointList',
        [
          'Add',
          ['Multiply', a(0), ['Sin', a(2)]],
          ['Negate', ['Multiply', a(1), ['Cos', a(2)]]],
        ],
        [
          'Add',
          ['Multiply', a(0), ['Cos', a(2)]],
          ['Multiply', a(1), ['Sin', a(2)]],
        ],
      ],
      3
    );
    fn('r_xx', a(0), 4);
    fn('r_xy', ['PointX', ['R_2D', a(1), a(2), a(3)]], 4);
    fn('r_xz', ['PointY', ['R_2D', a(1), a(2), a(3)]], 4);
    fn('r_yy', a(1), 4);
    fn('r_yx', ['PointX', ['R_2D', a(0), a(2), a(3)]], 4);
    fn('r_yz', ['PointY', ['R_2D', a(0), a(2), a(3)]], 4);
    fn('r_zz', a(2), 4);
    fn('r_zx', ['PointX', ['R_2D', a(0), a(1), a(3)]], 4);
    fn('r_zy', ['PointY', ['R_2D', a(0), a(1), a(3)]], 4);
    const inner = (h: string) => [
      h,
      ['r_xx', a(0), a(1), a(2), a(3)],
      ['r_xy', a(0), a(1), a(2), a(3)],
      ['r_xz', a(0), a(1), a(2), a(3)],
      a(4),
    ];
    fn('R_X', inner('r_yx'), 5);
    fn('R_Y', inner('r_yy'), 5);
    fn('R_Z', inner('r_yz'), 5);
    const mid = (h: string) => [
      h,
      ['R_X', a(0), a(1), a(2), a(3), a(4)],
      ['R_Z', a(0), a(1), a(2), a(3), a(4)],
      ['R_Y', a(0), a(1), a(2), a(3), a(4)],
      a(5),
    ];
    fn('R_X2', mid('r_zx'), 6);
    fn('R_Y2', mid('r_zy'), 6);
    fn('R_Z2', mid('r_zz'), 6);
    const six = [a(0), a(1), a(2), a(3), a(4), a(5)];
    fn(
      'R',
      ['PointList', ['R_X2', ...six], ['R_Y2', ...six], ['R_Z2', ...six]],
      6
    );
    expect(ce.lookupDefinition('R_Y')).toHaveProperty('value');
    expect(`${ce.box(['R_Z2', 1, 2, 3, 0, 0, 18]).type}`).toBe('number');
    expect(`${ce.box(['R', 1, 2, 3, 0, 0, 18]).type}`).toBe(
      'tuple<number, number, number>'
    );
    const angles = ['Add', 18, ['Range', 36, 360, 36]];
    expect(`${ce.box(['R_Z2', 1, 2, 3, 0, 0, angles]).type}`).toBe(
      'list<number>'
    );
    expect(`${ce.box(['R', 1, 2, 3, 0, 0, angles]).type}`).toBe(
      'list<tuple<number, number, number>>'
    );
  });

  test('a declared slot plan with mapped operands of different ranks keeps one level', () => {
    // A declared `broadcastable<T>` slot maps one rank only, so the value
    // of a rank mismatch is NOT mapped to the deepest rank, and the type
    // must not be either.
    const ce = new ComputeEngine();
    ce.declare('k', '(broadcastable<value>, broadcastable<value>) -> unknown');
    ce.assign('k', ['Function', 'y', 'x', 'y'] as any);
    const call = ce.box([
      'k',
      ['List', ['List', 1, 2], ['List', 3, 4]],
      ['List', 5, 6],
    ]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[5,6]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  test('a call whose head is a function-valued parameter is not typed from a global of that name', () => {
    const ce = new ComputeEngine();
    ce.declare('h', 'function');
    ce.assign('h', ['Function', ['List', 'x', 'x', 'x'], 'x'] as any);
    ce.declare('k', 'function');
    ce.assign('k', ['Function', ['Tuple', 'x', 'x'], 'x'] as any);
    ce.declare('g', 'function');
    ce.assign('g', ['Function', ['h', 'a'], 'h', 'a'] as any);
    const call = ce.box(['g', 'k', 1]);
    const value = call.evaluate();
    expect(value.toString()).toBe('(1, 1)');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  test('one boxed operand in a mapped slot and in a whole-bound slot', () => {
    const ce = new ComputeEngine();
    ce.declare('f', '(broadcastable<number>, list<number>) -> unknown');
    ce.assign('f', ['Function', ['Tuple', 'x', 'y'], 'x', 'y'] as any);
    const L = ce.box(['List', 1, 2]);
    const call = ce.function('f', [L, L]);
    const value = call.evaluate();
    expect(value.toString()).toBe('[(1, [1,2]),(2, [1,2])]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  test('the descriptor route types a numeric tuple handed to a scalar parameter as any', () => {
    // A numeric tuple binds whole to a scalar parameter and the body's
    // arithmetic decides the shape, so the signature result, written for a
    // scalar argument, does not describe the value. The test below checks
    // the result inferred for a function whose BODY makes such a call.
    const ce = new ComputeEngine();
    ce.declare('f', 'function');
    ce.assign('f', ['Function', ['Tuple', ['Negate', 'x'], 'x'], 'x'] as any);
    const t = deriveApplicationType(ce as any, 'f', [
      describeType(ce.type('tuple<integer, integer>').type),
    ]);
    expect(t).toBe('any');
    const scalar = deriveApplicationType(ce as any, 'f', [
      describeType('integer'),
    ]);
    expect(`${new BoxedType(scalar!, ce._typeResolver)}`).toBe(
      'tuple<integer, integer>'
    );
  });

  // A function literal whose body hands a tuple built from its own open
  // parameter to a scalar parameter: `g := a ↦ f((a, a))`. When `g` is
  // defined, `a` is open and `(a, a)` is typed `tuple<unknown, unknown>`,
  // not yet a numeric tuple, and the inferred result of `g` was the
  // signature result of `f`, `tuple<number, number>`, which every call of
  // `g` inherited, while `g(1)` evaluates to a pair of pairs. A tuple whose
  // components are numbers or open is now read as a numeric tuple there
  // (`mayBeNumericTupleType`, `derive-application-type.ts`), and the result
  // is `any`. Both definition routes: a bare `function` declaration (a value
  // definition) and an undeclared assignment (an operator definition).
  describe('a tuple built from an open parameter, handed to a scalar parameter', () => {
    function engine(declared: boolean): ComputeEngine {
      const ce = new ComputeEngine();
      if (declared)
        for (const name of ['f', 'g', 'h', 'k', 'k_1', 'm'])
          ce.declare(name, 'function');
      const def = (s: string) => ce.parse(s).evaluate();
      def('f(x) := (-x, x)');
      def('g(a) := f((a, a))');
      def('h(a) := f([a, a])');
      def('k(a) := f(a)');
      def('k_1(a) := f(a + 1)');
      def('m(a) := f((a, u))');
      return ce;
    }

    function signature(ce: ComputeEngine, name: string): string {
      const def = ce.lookupDefinition(name)!;
      return 'value' in def
        ? `${def.value.value!.type}`
        : `${new BoxedType(def.operator.signature.type, ce._typeResolver)}`;
    }

    for (const declared of [true, false]) {
      const route = declared ? 'declared function' : 'undeclared';
      test(`${route}: the inferred result is any, and the value fits`, () => {
        const ce = engine(declared);
        expect(signature(ce, 'g')).toBe('(unknown) -> any');
        const call = ce.parse('g(1)');
        expect(call.type.toString()).toBe('any');
        expect(call.evaluate().toString()).toBe('((-1, -1), (1, 1))');
        // A tuple with a free symbol as a component reads the same way.
        expect(signature(ce, 'm')).toBe('(unknown) -> any');
        expect(ce.parse('m(1)').type.toString()).toBe('any');
        expect(ce.parse('m(1)').evaluate().toString()).toBe(
          '((-1, -u), (1, u))'
        );
        // A direct call with a numeric tuple, or with a tuple of free
        // symbols.
        expect(ce.parse('f((1, 1))').type.toString()).toBe('any');
        const free = ce.parse('f((v, v))');
        expect(free.type.toString()).toBe('any');
        expect(free.evaluate().toString()).toBe('((-v, -v), (v, v))');
      });

      test(`${route}: a scalar or a list argument keeps its type`, () => {
        const ce = engine(declared);
        expect(signature(ce, 'k')).toBe('(unknown) -> tuple<number, number>');
        expect(ce.parse('k(1)').type.toString()).toBe(
          'tuple<integer, integer>'
        );
        expect(signature(ce, 'k_1')).toBe('(unknown) -> tuple<number, number>');
        // A list broadcasts: each element is a scalar argument of `f`.
        expect(signature(ce, 'h')).toBe(
          '(unknown) -> list<tuple<number, number>>'
        );
        const h = ce.parse('h(1)');
        expect(h.type.toString()).toBe('list<tuple<number, number>>');
        expect(h.evaluate().toString()).toBe('[(-1, 1),(-1, 1)]');
        expect(ce.parse('f(1)').type.toString()).toBe(
          'tuple<integer, integer>'
        );
      });
    }

    test('a tuple at a parameter the body never reads keeps the signature result', () => {
      // The value of `outer` does not depend on its argument, so the
      // signature result describes it, and a `Dot` over the call compiles
      // (`compile-scalar-point-dot.test.ts` has the compiled form).
      for (const declared of [true, false]) {
        const ce = new ComputeEngine();
        ce.declare('x', 'real');
        ce.declare('P', 'list<tuple<real, real>>');
        if (declared) ce.declare('outer', 'function');
        ce.assign('outer', [
          'Function',
          ['Tuple', ['PointX', 'P'], ['PointY', 'P']],
          'u',
        ]);
        expect(ce.box(['outer', ['Tuple', 'x', 2]]).type.toString()).toBe(
          'tuple<list<number>, list<number>>'
        );
      }
    });

    test('a parameter declared as a tuple keeps the declared result', () => {
      const ce = new ComputeEngine();
      ce.declare('f2', '(tuple<number, number>) -> number');
      ce.assign('f2', [
        'Function',
        ['Add', ['At', 'x', 1], ['At', 'x', 2]],
        'x',
      ]);
      ce.declare('g2', 'function');
      ce.assign('g2', ['Function', ['f2', ['Tuple', 'a', 'a']], 'a']);
      expect(signature(ce, 'g2')).toBe('(unknown) -> number');
      const call = ce.box(['g2', 1]);
      expect(call.type.toString()).toBe('number');
      expect(call.evaluate().toString()).toBe('2');
    });

    test('a pass-through callee types the call from its body', () => {
      // The result of `p` is derived from its body with the parameter typed
      // as the tuple (`callResultType`), so the call of `q` is precise,
      // although the inferred result of `q` is `any`.
      const ce = new ComputeEngine();
      ce.assign('p', ['Function', 'x', 'x']);
      ce.assign('q', ['Function', ['p', ['Tuple', 'a', 'a']], 'a']);
      expect(signature(ce, 'q')).toBe('(unknown) -> any');
      expect(ce.box(['q', 1]).type.toString()).toBe('tuple<integer, integer>');
      expect(ce.box(['q', 1]).evaluate().toString()).toBe('(1, 1)');
    });
  });

  // Tycho ledger row 374: the index read `L[k]` of a declared point list is
  // typed `missing | tuple<number, number, number>` (the index may be out of
  // range). The call typing stopped at that union and fell back to the
  // declared signature result, with `broadcastable` components, while
  // `PointX(L[k])` already typed `number`. The body is now typed under the
  // present part of the argument, as for a plain `Missing` argument
  // (`presentPart`, `call-result-type.ts`).
  test('row 374: an argument typed `missing | tuple` is typed from the body, present and absent', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number, number, number>>');
    ce.declare('k', 'integer');
    ce.assign(
      'W',
      ce.parse(
        '(p, s) \\mapsto (s\\cdot\\operatorname{PointX}(p), s\\cdot\\operatorname{PointY}(p), s\\cdot\\operatorname{PointZ}(p))'
      )
    );
    expect(ce.parse('L[k]').type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    expect(ce.parse('\\operatorname{PointX}(L[k])').type.toString()).toBe(
      'number'
    );
    expect(ce.parse('W(L[k], 2)').type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    // A plain absent argument is the absent arm alone, and the two
    // literal-shaped readings of row 373 are unchanged.
    expect(ce.box(['W', 'Missing', 2]).type.toString()).toBe('missing');
    expect(ce.parse('W((1,2,3), 2)').type.toString()).toBe(
      'tuple<integer | nan, integer | nan, integer | nan>'
    );
    expect(ce.parse('W(L, 2)').type.toString()).toBe(
      'tuple<list<number>, list<number>, list<number>>'
    );
    // An in-range index gives the scaled point. An out-of-range one gives
    // `Missing`: inside the body `PointX(p)` is typed `unknown` (the
    // parameter is inferred `collection<any> | tuple`), so each coordinate
    // keeps the `Missing` marker, and a tuple whose every coordinate is
    // absent is the absent value (the `Tuple` evaluate handler; user
    // decision 2026-10-14). The value is in the type.
    ce.assign('L', ce.parse('[(1,2,3),(4,5,6)]'));
    ce.assign('k', 1);
    expect(ce.parse('W(L[k], 2)').evaluate().toString()).toBe('(2, 4, 6)');
    ce.assign('k', 5);
    const absent = ce.parse('W(L[k], 2)').evaluate();
    expect(absent.toString()).toBe('"Missing"');
    expect(isSubtype(absent.type.type, ce.parse('W(L[k], 2)').type.type)).toBe(
      true
    );
    expect(ce.box(['W', 'Missing', 2]).evaluate().toString()).toBe('"Missing"');
  });

  test('row 374: a body that passes the argument through keeps the absent case', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number, number, number>>');
    ce.declare('k', 'integer');
    ce.assign('f', ce.parse('p \\mapsto p'));
    ce.assign('g', ce.parse('(p, s) \\mapsto (p, s)'));
    ce.assign('V', ce.parse('(p) \\mapsto (\\operatorname{PointX}(p), 1)'));
    ce.assign('L', ce.parse('[(1,2,3),(4,5,6)]'));
    ce.assign('k', 5);
    // The derivation joins the present arm with the absent arm. A first
    // version typed the body under the present part alone and read
    // `f(L[k])` as a point. A tuple with one present coordinate stays a
    // tuple, so `g` and `V` carry the absent coordinate in a tuple arm.
    expect(ce.parse('f(L[k])').type.toString()).toBe(
      'missing | tuple<number, number, number>'
    );
    expect(ce.parse('g(L[k], 2)').type.toString()).toBe(
      'tuple<missing, integer> | tuple<tuple<number, number, number>, integer>'
    );
    expect(ce.parse('V(L[k])').type.toString()).toBe(
      'tuple<missing, integer> | tuple<number, integer>'
    );
    for (const call of ['f(L[k])', 'g(L[k], 2)', 'V(L[k])']) {
      const e = ce.parse(call);
      const v = e.evaluate();
      expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    }
    expect(ce.parse('f(L[k])').evaluate().toString()).toBe('"Missing"');
    expect(ce.parse('g(L[k], 2)').evaluate().toString()).toBe('("Missing", 2)');
    expect(ce.parse('V(L[k])').evaluate().toString()).toBe('("Missing", 1)');
  });

  test('row 374: two arguments that may be absent derive every presence combination', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number, number, number>>');
    ce.declare('k', 'integer');
    ce.declare('j', 'integer');
    ce.assign('F', ce.parse('(p, q) \\mapsto (p, q)'));
    const e = ce.parse('F(L[k], L[j])');
    expect(e.type.toString()).toBe(
      'missing | tuple<missing, tuple<number, number, number>> | tuple<tuple<number, number, number>, missing> | tuple<tuple<number, number, number>, tuple<number, number, number>>'
    );
    ce.assign('L', ce.parse('[(1,2,3),(4,5,6)]'));
    for (const [k, j] of [
      [5, 2],
      [2, 5],
      [5, 7],
      [1, 2],
    ]) {
      ce.assign('k', k);
      ce.assign('j', j);
      const v = ce.parse('F(L[k], L[j])').evaluate();
      expect(isSubtype(v.type.type, e.type.type)).toBe(true);
    }
  });

  test('row 374: the absent arm runs the handler at a position that keeps absence', () => {
    // `Contains(c, Missing)` is `False` (a search for an absent value finds
    // nothing): the operator keeps the absent operand at its needle
    // position, so the derivation types the body by the handler, not by the
    // absence marker.
    const ce = new ComputeEngine();
    ce.assign(
      'V',
      ce.box(['Function', ['Tuple', ['Contains', { str: 'abc' }, 'p'], 1], 'p'])
    );
    const e = ce.box(['V', 'Missing']);
    expect(e.type.toString()).toBe('tuple<boolean, integer>');
    const v = e.evaluate();
    expect(v.toString()).toBe('("False", 1)');
    expect(isSubtype(v.type.type, e.type.type)).toBe(true);
  });

  test('row 374: an absent point keeps the point rule outside a body', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<tuple<number, number, number>>');
    ce.declare('k', 'integer');
    ce.assign('L', ce.parse('[(1,2,3),(4,5,6)]'));
    ce.assign('k', 5);
    // The written type of these applications is a point: an absent point
    // scaled or negated is an absent point (`docs/ERROR-MODEL.md`), not
    // `NaN`.
    expect(ce.parse('-L[k]').evaluate().toString()).toBe('"Missing"');
    expect(ce.parse('2 L[k]').evaluate().toString()).toBe('"Missing"');
    expect(ce.parse('2 L[k] + (1,1,1)').evaluate().toString()).toBe(
      '"Missing"'
    );
  });

  test('an untyped (undeclared) argument still reads unknown: no promise is made', () => {
    const ce = rotationChain();
    expect(ce.parse('R_{Z2}(u,u,u,0,0,18)').type.toString()).toBe(
      'broadcastable<unknown>'
    );
  });
});
