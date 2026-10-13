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
    // scalar argument, does not describe the value. The declared result of
    // a function whose BODY makes such a call is still computed at its
    // definition with open parameters and can read the signature result
    // (`ROADMAP.md`, "A declared result computed through a numeric-tuple
    // argument to a scalar parameter").
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

  test('an untyped (undeclared) argument still reads unknown: no promise is made', () => {
    const ce = rotationChain();
    expect(ce.parse('R_{Z2}(u,u,u,0,0,18)').type.toString()).toBe(
      'broadcastable<unknown>'
    );
  });
});
