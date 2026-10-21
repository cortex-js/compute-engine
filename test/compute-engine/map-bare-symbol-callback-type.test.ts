import { ComputeEngine } from '../../src/compute-engine';
import { deriveApplicationType } from '../../src/compute-engine/boxed-expression/derive-application-type';
import { describe as describeOperand } from '../../src/compute-engine/boxed-expression/operand-descriptor';
import { typeToString } from '../../src/common/type/serialize';
import { parseEpsil, resolveLibraryNames } from '../../src/epsil';

/**
 * The type of `Map` when its callback is a BARE SYMBOL.
 *
 * A declared callback is bound during canonicalization, so subsequent type
 * reads use its lexical contract. Descriptor derivation also accepts a raw
 * symbol and reads its declaration without binding it. When no function
 * contract is known, the source type is retained.
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

describe('Map callback types follow lexical bindings', () => {
  test.each(['h', 'Sqrt', 'First', 'fresh', 'scalar'])(
    'a parameter named %s retains its own callback contract',
    (name) => {
      for (const [contract, result] of [
        ['(real) -> any', 'list<any^2>'],
        ['(real) -> real', 'vector<real^2>'],
        ['function', 'list<unknown^2>'],
      ]) {
        const ce = new ComputeEngine();
        if (name === 'h') ce.assign(name, ce.box(['Function', 7, 'u']));
        if (name === 'scalar') ce.assign(name, 7);
        const fn = ce.box([
          'Function',
          ['Map', name, ['List', 1, 2]],
          ['Typed', name, contract],
        ]);
        const map = fn.op1.op1;
        expect(map.type.toString()).toBe(result);
        expect(fn.type.toString()).toBe(`(${name}: ${contract}) -> ${result}`);
        const derived = deriveApplicationType(ce, 'Map', [
          describeOperand(map.op1),
          describeOperand(map.op2),
        ]);
        expect(derived === undefined ? '' : typeToString(derived)).toBe(result);
        // Re-reading after an unrelated global update must keep the binding.
        ce.assign('unrelated', 1);
        expect(map.type.toString()).toBe(result);
      }
    }
  );

  test.each(['(string) -> real', '(real, real) -> real'])(
    'a global %s contract does not validate a shadowing parameter',
    (globalType) => {
      const ce = new ComputeEngine();
      ce.declare('h', globalType);
      const fn = ce.box([
        'Function',
        ['Map', 'h', ['List', 1, 2]],
        ['Typed', 'h', '(real) -> real'],
      ]);
      expect(fn.isValid).toBe(true);
      expect(fn.type.toString()).toBe('(h: (real) -> real) -> vector<real^2>');
    }
  );

  test('a non-callable parameter cannot borrow a global function contract', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const fn = ce.box([
      'Function',
      ['Map', 'h', ['List', 1, 2]],
      ['Typed', 'h', 'integer'],
    ]);
    expect(fn.isValid).toBe(false);
    expect(fn.errors.length).toBeGreaterThan(0);
  });

  test('a callback parameter does not borrow library missing-cell behavior', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer | missing>');
    const fn = ce.box([
      'Function',
      ['Map', 'IsPrime', 'L'],
      ['Typed', 'IsPrime', '(integer | missing) -> boolean'],
    ]);
    expect(fn.isValid).toBe(true);
    expect(fn.op1.op1.type.toString()).toBe('list<boolean>');
  });

  test('a reducer parameter does not borrow the built-in arithmetic result', () => {
    const ce = new ComputeEngine();
    const fn = ce.box([
      'Function',
      ['Reduce', ['List', 1, 2], 'Add', 0],
      ['Typed', 'Add', '(integer, integer) -> string'],
    ]);
    expect(fn.isValid).toBe(true);
    expect(fn.op1.op1.type.toString()).toBe('string');
    const derived = ce._inScope(fn.op1.localScope!, () =>
      deriveApplicationType(
        ce,
        'Reduce',
        fn.op1.op1.ops.map((x) => describeOperand(x))
      )
    );
    expect(derived === undefined ? '' : typeToString(derived)).toBe('string');
  });

  test('a parsed callback parameter does not borrow a global result', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 7, 'u']));
    const source = '(h: (real) -> any) ↦ map(h, [1, 2])';
    const [program, diagnostics] = parseEpsil(source);
    expect(diagnostics).toEqual([]);
    const parsed = ce.box(resolveLibraryNames(program, source, ce));
    expect(parsed.type.toString()).toBe('(h: (real) -> any) -> list<any^2>');
  });

  test('a shadowed global returning Nothing cannot add omission to a local contract', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 'Nothing', 'u']));
    const fn = ce.box([
      'Function',
      ['Map', 'h', ['List', 1, 2]],
      ['Typed', 'h', '(real) -> real'],
    ]);
    expect(fn.op1.op1.type.toString()).toBe('vector<real^2>');
  });

  test('an unshadowed named callback still specializes its result from source elements', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', 'u', 'u']));
    expect(ce.box(['Map', 'h', ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
  });
});
