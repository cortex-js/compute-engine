import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';

/**
 * The type of `Map` when its callback is a BARE SYMBOL.
 *
 * `Map` is lazy, so on the parse route its callback operand stays unbound and
 * its own type reads `unknown`. The `Map` type handler then looks up the
 * symbol's definition (without binding it) and uses the declared signature's
 * result type as the element type. Only when the symbol has no definition, or
 * its definition has no function type, is the source type copied, element type
 * included (user decision 2026-09-27, option C of the ROADMAP entry "`Map`
 * with a bare symbol callback copies the source element type").
 *
 * Before the decision, `Map(\sin, [-1, 2])` was typed `vector<integer^2>`
 * while its values are reals.
 */

/** The type of `Map(f, [-1, 2])` on the three typing routes: the parse route,
 * the box route, and the descriptor route (`deriveApplicationType`, which a
 * type handler reaches as `context.derive`). The three must agree. */
function mapTypes(
  ce: ComputeEngine,
  latexCallback: string,
  name: string
): string[] {
  const parsed = ce
    .parse(`\\operatorname{Map}(${latexCallback}, [-1, 2])`)
    .type.toString();
  const derived = deriveApplicationType(ce, 'Map', [
    describeOperand(ce.box(name, { form: 'raw' })),
    describeOperand(ce.box(['List', -1, 2])),
  ]);
  const boxed = ce.box(['Map', name, ['List', -1, 2]]).type.toString();
  return [parsed, boxed, derived === undefined ? '' : typeToString(derived)];
}

describe('Map with a bare symbol callback', () => {
  test('a library function uses its declared signature', () => {
    const ce = new ComputeEngine();
    // `Sin` is declared `(number) -> number`: the kind and the dimensions of
    // the source are kept, the element type is the signature's result.
    expect(mapTypes(ce, '\\sin', 'Sin')).toEqual([
      'vector<2>',
      'vector<2>',
      'vector<2>',
    ]);
    expect(mapTypes(ce, '\\operatorname{Abs}', 'Abs')).toEqual([
      'vector<2>',
      'vector<2>',
      'vector<2>',
    ]);
  });

  test('a declared user function uses its declared result type', () => {
    const ce = new ComputeEngine();
    ce.declare('W', '(number) -> real');
    expect(mapTypes(ce, 'W', 'W')).toEqual([
      'vector<real^2>',
      'vector<real^2>',
      'vector<real^2>',
    ]);
  });

  test('an assigned lambda uses the result type of its inferred signature', () => {
    const ce = new ComputeEngine();
    ce.assign('W', ce.parse('x \\mapsto \\sin x'));
    expect(mapTypes(ce, 'W', 'W')).toEqual([
      'vector<2>',
      'vector<2>',
      'vector<2>',
    ]);

    // The same through an assigned source list.
    ce.assign('G', ce.parse('[-1, 0, 1]'));
    expect(ce.parse('\\operatorname{Map}(W, G)').type.toString()).toBe(
      'vector<3>'
    );
  });

  test('an undeclared symbol keeps the copied source type', () => {
    const ce = new ComputeEngine();
    // Nothing is known about `h`: the handler copies the source type, element
    // type included. The descriptor route is read first, so `h` has not been
    // declared by the box route yet.
    const derived = deriveApplicationType(ce, 'Map', [
      describeOperand(ce.box('h', { form: 'raw' })),
      describeOperand(ce.box(['List', -1, 2])),
    ]);
    expect(derived === undefined ? '' : typeToString(derived)).toBe(
      'vector<integer^2>'
    );
    expect(ce.parse('\\operatorname{Map}(f, [-1, 2])').type.toString()).toBe(
      'vector<integer^2>'
    );
    expect(ce.box(['Map', 'h', ['List', -1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });

  test('evaluate() keeps the exact sines; N() gives floats', () => {
    const ce = new ComputeEngine();
    for (const expr of [
      ce.parse('\\operatorname{Map}(\\sin, [-1, 2])'),
      ce.box(['Map', 'Sin', ['List', -1, 2]]),
    ]) {
      expect(expr.evaluate().toString()).toBe('[sin(-1),sin(2)]');
      // `.N()` of a bare-symbol callback rewraps it as `_1 ↦ N(Sin(_1))`
      // (`lazyMapNumericApproximation`), as it does for a function literal.
      for (const n of [expr.N(), expr.evaluate().N()]) {
        const floats = [...n.each()].map((x) => x.re);
        expect(floats).toHaveLength(2);
        expect(floats[0]).toBeCloseTo(Math.sin(-1), 12);
        expect(floats[1]).toBeCloseTo(Math.sin(2), 12);
        expect(n.toString()).not.toContain('sin');
      }
    }
  });

  test('N() of the zip form applies the callback to one element of each source', () => {
    const ce = new ComputeEngine();
    const add = ce.box(['Map', 'Add', ['List', 1, 2], ['List', 3, 4]]);
    expect(add.N().toString()).toBe('[4,6]');
    // An exact quotient becomes a float under `N()` only.
    const div = ce.box(['Map', 'Divide', ['List', 1, 2], ['List', 3, 4]]);
    expect(div.evaluate().toString()).toBe('[1/3,1/2]');
    const floats = [...div.N().each()].map((x) => x.re);
    expect(floats[0]).toBeCloseTo(1 / 3, 15);
    expect(floats[1]).toBeCloseTo(0.5, 15);
    expect(div.N().toString()).not.toContain('/');
  });
});
