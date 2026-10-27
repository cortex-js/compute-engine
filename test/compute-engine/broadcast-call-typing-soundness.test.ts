import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

// The static type of an application must hold its value. Each block below
// types an application whose value is a point, a list or a nested list, and
// checks that the type holds the evaluated value.

describe('a Map over an opaque tuple with an inferred callback', () => {
  // `g := x ↦ x + 10` has the inferred signature `(unknown) -> number`. The
  // parameter is not typed, and `g([1, 2])` is `[11, 12]`. So the elements
  // of the `Map` are read from the call of `g` on each element, not from the
  // inferred result. Before, the type was `list<number>` (ROADMAP CE-5).
  for (const declared of [false, true])
    test(`g ${declared ? 'declared function' : 'undeclared'}`, () => {
      const ce = new ComputeEngine();
      if (declared) ce.declare('g', 'function');
      ce.assign('g', ce.parse('x \\mapsto x + 10'));
      ce.declare('t', 'tuple');
      ce.assign('t', ce.box(['Tuple', ['List', 1, 2], 3]));
      const map = ce.box(['Map', 'g', 't']);
      const value = map.evaluate();
      expect(value.toString()).toBe('[[11,12],13]');
      expect(map.type.toString()).toBe('list<number | vector<2>>');
      expect(isSubtype(value.type.type, map.type.type)).toBe(true);
    });
});

test('a Map over a list<any> with an inferred callback', () => {
  // An element of `L` can be a list of any depth, and `g` maps over it.
  const ce = new ComputeEngine();
  ce.assign('g', ce.parse('x \\mapsto x + 10'));
  ce.declare('L', 'list<any>');
  const map = ce.box(['Map', 'g', 'L']);
  expect(map.type.toString()).toBe(
    'list<indexed_collection<any> | nothing | number>'
  );
  ce.assign('L', ce.box(['List', ['List', 1, 2], 3]));
  expect(map.evaluate().toString()).toBe('[[11,12],13]');
});

describe('a function literal over a list<any>', () => {
  // The first element of `A` is a list, and the literal maps it at its
  // leaves too. So an element of the result can be a list. Before, the type
  // was `list<tuple<…>>` (ROADMAP CE-16).
  test.each([
    [['Function', ['Tuple', 'x', 'x'], 'x'], 'list<list<any> | tuple<any, any>>'],
  ])('%j', (literal, expected) => {
    const ce = new ComputeEngine();
    ce.declare('A', 'list<any>');
    ce.assign('A', ce.box(['List', ['List', 1, 2], 3]));
    const call = ce.box([literal, 'A'] as never);
    expect(call.type.toString()).toBe(expected);
    const value = call.evaluate();
    expect(value.toString()).toBe('[[(1, 1),(2, 2)],(3, 3)]');
    expect(isSubtype(value.type.type, call.type.type)).toBe(true);
  });

  test('an assigned literal with no signature', () => {
    const ce = new ComputeEngine();
    ce.declare('A', 'list<any>');
    ce.assign('A', ce.box(['List', ['List', 1, 2], 3]));
    ce.assign('h', ce.parse('(x) \\mapsto (x, x)'));
    expect(ce.box(['h', 'A']).type.toString()).toBe(
      'list<list<any> | tuple<unknown, unknown>>'
    );
  });
});

describe('a point beside an operand whose number type is not stated', () => {
  // The other operand can hold a point with components of any number type,
  // or a number, so the components of the result are `number`. Before, the
  // integer components of the point were kept (ROADMAP CE-373).
  test('a sum with an operand typed unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'unknown');
    const sum = ce.box(['Add', ['Tuple', 1, 2], 'q']);
    expect(sum.type.toString()).toBe('number | tuple<number, number>');
    ce.assign('q', ce.box(['Tuple', 0.5, 0.5]));
    const value = sum.evaluate();
    expect(value.toString()).toBe('(1.5, 2.5)');
    expect(isSubtype(value.type.type, sum.type.type)).toBe(true);
  });

  test('a sum of broadcastable operands', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'broadcastable<tuple<integer, integer>>');
    ce.declare('u', 'broadcastable<unknown>');
    expect(ce.box(['Add', 'p', 'u']).type.toString()).toBe(
      'broadcastable<tuple<number, number>>'
    );
  });

  test('a product with an operand typed unknown', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'unknown');
    const product = ce.box(['Multiply', ['Tuple', 1, 2], 'q']);
    expect(product.type.toString()).toBe('tuple<number, number>');
    ce.assign('q', 0.5);
    const value = product.evaluate();
    expect(value.toString()).toBe('(0.5, 1)');
    expect(isSubtype(value.type.type, product.type.type)).toBe(true);
  });
});

describe('a structural expression boxed from MathJSON', () => {
  // The structural route binds each symbol to its definition, so the type
  // handler reads the declared types, as on the `ce.function()` route.
  // Before, the symbols were unbound and typed `unknown` (ROADMAP CE-29).
  test.each([
    [['Add', 't', 't'], 'tuple<integer, integer>'],
    [['Multiply', 't', 2], 'tuple<integer, integer>'],
    [['Sqrt', 't'], 'tuple<number, number>'],
    [['Add', 'L', 'L'], 'list<integer>'],
    [['Multiply', 'L', 2], 'list<integer>'],
  ])('%j', (expr, expected) => {
    const ce = new ComputeEngine();
    ce.declare('t', 'tuple<integer, integer>');
    ce.declare('L', 'list<integer>');
    const boxed = ce.box(expr as never, { form: 'structural' });
    expect(boxed.isStructural).toBe(true);
    expect(boxed.type.toString()).toBe(expected);
    const built = ce.function(
      expr[0] as string,
      (expr.slice(1) as never[]).map((x) => ce.box(x)),
      { form: 'structural' }
    );
    expect(boxed.type.toString()).toBe(built.type.toString());
  });

  test('an undeclared symbol is not declared', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'zz', 1], { form: 'structural' });
    expect(ce.lookupDefinition('zz')).toBeUndefined();
  });

  // The structural form keeps the written name of a symbol whose canonical
  // form is another expression (`i` is the complex literal `0 + 1i`, `e` the
  // symbol `ExponentialE`). A host reads `M(i) = i^2` as a definition with the
  // parameter `i`. Tycho row 448.
  test.each([
    [
      ['Equal', ['M', 'i'], ['Power', 'i', 2]],
      '["Equal",["M","i"],["Power","i",2]]',
    ],
    [['Add', ['Power', 'e', 'x'], 'e'], '["Add",["Power","e","x"],"e"]'],
    [['Add', 'ImaginaryUnit', 'Half'], '["Add","ImaginaryUnit","Half"]'],
    [{ sym: 'i' }, '"i"'],
  ])('keeps the written constant name in %j', (expr, expected) => {
    const ce = new ComputeEngine();
    const boxed = ce.box(expr as never, { form: 'structural' });
    expect(JSON.stringify(boxed.json)).toBe(expected);
  });

  test('a name that is not in NFC binds to the definition of its NFC form', () => {
    // `\u212B` (ANGSTROM SIGN) normalizes to `\u00C5`: it is not a name that
    // resolved to another expression.
    const ce = new ComputeEngine();
    ce.declare('\u00C5', 'integer');
    const boxed = ce.box({ sym: '\u212B' }, { form: 'structural' });
    expect(boxed.type.toString()).toBe('integer');
  });

  // A declared symbol of a structural expression is bound, and a bound
  // symbol reports `isCanonical`. Its replacement by `subs()` is still boxed
  // in the structural form, so a constant name in it is kept. Tycho row 449.
  test.each(['real', 'unknown', undefined])(
    'subs() keeps a constant name in the replacement of x: %s',
    (type) => {
      const ce = new ComputeEngine();
      if (type !== undefined) ce.declare('x', type);
      const body = ce.box(['Add', 'x', 1], { form: 'structural' });
      const arg = ce.box(['Add', 'X', 'i'], { form: 'structural' });
      const result = body.subs({ x: arg });
      expect(JSON.stringify(result.json)).toBe('["Add",["Add","X","i"],1]');
      expect(result.isStructural).toBe(true);
    }
  );

  // The same for a structural expression that is the lone symbol: the body of
  // `f(x) = x`. With `X = [1, 2, 3]`, `Σ_{i=1}^{3} f(X + i)` inlined this way
  // gave `[3+3i, 6+3i, 9+3i]`. Tycho row 451.
  test.each(['real', 'unknown', undefined])(
    'subs() on the lone structural x keeps a constant name: %s',
    (type) => {
      const ce = new ComputeEngine();
      if (type !== undefined) ce.declare('x', type);
      const body = ce.box('x', { form: 'structural' });
      const arg = ce.box(['Add', 'X', 'i'], { form: 'structural' });
      expect(JSON.stringify(body.subs({ x: arg }).json)).toBe(
        '["Add","X","i"]'
      );
      // A requested form is still honored.
      expect(body.subs({ x: arg }, { canonical: true }).isCanonical).toBe(true);
    }
  );

  test('every route to a structural x keeps it, the canonical form drops it', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const arg = ce.box(['Add', 'X', 'i'], { form: 'structural' });
    const kept = '["Add","X","i"]';
    // A parse with diagnostics copies the result (`_unshared()`).
    const parsed = ce.parse('x', { form: 'structural', diagnostics: true });
    expect(JSON.stringify(parsed.subs({ x: arg }).json)).toBe(kept);
    // A symbol boxed before, then asked for in the structural form.
    const preboxed = ce.box(ce.symbol('x'), { form: 'structural' });
    expect(JSON.stringify(preboxed.subs({ x: arg }).json)).toBe(kept);
    // The canonical form of a structural symbol substitutes canonically.
    const canonical = ce.box('x', { form: 'structural' }).canonical;
    expect(canonical.subs({ x: ['Add', 1, 2] }).toString()).toBe('3');
    // The canonical symbol itself is not changed by the structural route.
    const plain = ce.symbol('x');
    expect(plain.subs({ x: ['Add', 1, 2] }).toString()).toBe('3');
  });

  test('the sum of an inlined identity over an index named i', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const inlined = ce
      .box('x', { form: 'structural' })
      .subs({ x: ce.box(['Add', 'X', 'i'], { form: 'structural' }) });
    ce.assign('X', ce.box(['List', 1, 2, 3]));
    const sum = ce.box(['Sum', inlined.json, ['Tuple', 'i', 1, 3]]);
    expect(sum.evaluate().toString()).toBe('[9,12,15]');
  });

  test('a library symbol boxed structurally is the shared instance', () => {
    // Code compares these by identity (`=== ce.Nothing`).
    const ce = new ComputeEngine();
    for (const name of [
      'Pi',
      'True',
      'False',
      'Nothing',
      'Missing',
      'None',
      'Undefined',
      'ExponentialE',
    ])
      expect(ce.box(name, { form: 'structural' })).toBe(ce.symbol(name));
  });

  test('a kept constant name is still the constant once canonical', () => {
    const ce = new ComputeEngine();
    const boxed = ce.box(['Power', 'i', 2], { form: 'structural' });
    expect(boxed.canonical.toString()).toBe('-1');
    expect(boxed.evaluate().toString()).toBe('-1');
  });
});

describe('an element-wise head over a union of a point and a vector', () => {
  // The value is a point or a vector, and the application has the shape of
  // that value. Before, it was typed `number` (ROADMAP CE-7.4).
  test.each([
    [['Sin', 'tv']],
    [['Sqrt', 'tv']],
    [['Power', 'tv', 2]],
  ])('%j', (expr) => {
    for (const v of [
      ['Tuple', 1, 2],
      ['List', 1, 2],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('tv', 'tuple<number, number> | vector<number^2>');
      const e = ce.box(expr as never);
      const type = e.type.type;
      ce.assign('tv', ce.box(v as never));
      const value = ce.box(expr as never).evaluate();
      expect(isSubtype(value.type.type, type)).toBe(true);
    }
  });

  test('the type of Sin', () => {
    const ce = new ComputeEngine();
    ce.declare('tv', 'tuple<number, number> | vector<number^2>');
    expect(ce.box(['Sin', 'tv']).type.toString()).toBe(
      'tuple<number, number> | vector<2>'
    );
  });

  test('Abs is the norm of a point and maps over a vector', () => {
    // `|(1, 2)|` is `√5`, and `|[1, 2]|` is `[1, 2]`.
    const ce = new ComputeEngine();
    ce.declare('tv', 'tuple<number, number> | vector<number^2>');
    expect(ce.box(['Abs', 'tv']).type.toString()).toBe(
      'list<real<0..> | signed_infinity^2> | real<0..> | signed_infinity'
    );
  });
});
