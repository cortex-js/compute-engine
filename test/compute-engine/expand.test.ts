import { ComputeEngine } from '../../src/compute-engine';
import { checkJson, engine } from '../utils';

function checkExpand(s: string): string {
  return checkJson(engine.expr(['Expand', engine.parse(s)]));
}

describe('EXPAND POWER', () => {
  test(`Power`, () =>
    expect(checkExpand(`(a+b)^6`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Power", ["Add", "a", "b"], 6]]
      eval-auto = a^6 + b^6 + 6b * a^5 + 6a * b^5 + 15b^4 * a^2 + 15a^4 * b^2 + 20a^3 * b^3
    `));

  // 64*a**6 + 768*a**5*b**2 + 3840*a**4*b**4 + 10240*a**3*b**6 + 15360*a**2*b**8 + 12288*a*b**10 + 4096*b**12
  test(`Power`, () =>
    expect(checkExpand(`(2a+4b^2)^6`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Power",
          ["Add", ["Multiply", 4, ["Square", "b"]], ["Multiply", 2, "a"]],
          6
        ]
      ]
      eval-auto = 4096b^(12) + 12288a * b^(10) + 15360b^8 * a^2 + 10240b^6 * a^3 + 3840a^4 * b^4 + 768a^5 * b^2 + 64a^6
    `));
});

describe('EXPAND PRODUCT', () => {
  test(`Expand 4x(x+2)`, () =>
    expect(checkExpand(`4x(x+2)`)).toMatchInlineSnapshot(`
      box       = ["Expand", ["Multiply", 4, "x", ["Add", "x", 2]]]
      eval-auto = 4x^2 + 8x
    `));

  test(`Expand 4x(3x+2)-5(5x-4)`, () =>
    expect(checkExpand(`4x(3x+2)-5(5x-4)`)).toMatchInlineSnapshot(`
      box       = [
        "Expand",
        [
          "Add",
          ["Multiply", 4, "x", ["Add", ["Multiply", 3, "x"], 2]],
          ["Multiply", -5, ["Subtract", ["Multiply", 5, "x"], 4]]
        ]
      ]
      eval-auto = 12x^2 - 17x + 20
    `));
});

// The expression transformers (`Expand`, `ExpandAll`, `Factor`, `Together`,
// `Distribute`, `Simplify`) are `lazy` and used to take only `.canonical` of
// their held operand. A `ReplaceAll` operand therefore reached `expand()` as
// an unevaluated function call with no polynomial structure, and was silently
// returned unchanged — `Expand(ReplaceAll(x^2 + x, x -> a + 1))` gave back the
// `ReplaceAll` instead of `a^2 + 3a + 2`.
describe('transformers reduce a producer head in their operand', () => {
  const ce2 = new ComputeEngine();
  const inner = '\\mathrm{ReplaceAll}(x^2 + x, x \\to a + 1)';

  test.each([
    ['Expand', 'a^2 + 3a + 2'],
    ['Simplify', 'a^2 + 3a + 2'],
  ])('%s(ReplaceAll(..))', (head, expected) => {
    const r = ce2.parse(`\\mathrm{${head}}(${inner})`).evaluate();
    expect(r.toString()).toBe(expected);
  });

  test('Factor(ReplaceAll(..))', () => {
    const r = ce2.parse(`\\mathrm{Factor}(${inner})`).evaluate();
    expect(r.toString()).toBe('(a + 1) * (a + 2)');
  });

  // A producer head is just as likely to appear *inside* the operand as at
  // its root, so the reduction is recursive.
  test('nested: Expand(ReplaceAll(..) - ReplaceAll(..))', () => {
    const f = '(1 + x y)^3 z';
    const a = `\\mathrm{ReplaceAll}(${f}, x \\to 0, y \\to y, z \\to 1)`;
    const b = `\\mathrm{ReplaceAll}(${f}, x \\to 0, y \\to y, z \\to 2)`;
    const r = ce2.parse(`\\mathrm{Expand}(${a} - ${b})`).evaluate().simplify();
    expect(r.isSame(-1)).toBe(true);
  });

  // A transformer resolves symbols bound to a value in its operand — an
  // operator normally evaluates its arguments, and these are `lazy` only to
  // keep the operand's *structure* from being rewritten early.
  test('resolves an assigned value in the operand', () => {
    const ce3 = new ComputeEngine();
    ce3.assign('b', 5);
    const r = ce3.parse('\\mathrm{Expand}((b + 1)^2)').evaluate();
    expect(r.toString()).toBe('36');
  });
});

// `distribute()` recombined the branches of a distributed sum with `f`
// (`Multiply`) instead of `g` (`Add`), so `(a + b)·c` became `(a·c)·(b·c)`.
// Every input it acted on came back with a different value. The operator had
// no test coverage, so the whole suite stayed green.
describe('Distribute is value-preserving', () => {
  const ce4 = new ComputeEngine();

  test.each([
    ['(a + b) c', 'a * c + b * c'],
    ['(a + b)(c + d)', 'a * c + b * c + a * d + b * d'],
    ['2(a + b)', '2a + 2b'],
    ['(a + b) c d', 'a * c * d + b * c * d'],
    ['(a - b) c', 'a * c - b * c'],
    ['(a + b + c) d', 'a * d + b * d + c * d'],
  ])('Distribute(%s) = %s', (src, expected) => {
    expect(
      ce4.function('Distribute', [ce4.parse(src)]).evaluate().toString()
    ).toBe(expected);
  });

  test('numeric oracle: distributing does not change the value', () => {
    const vals = { a: 2, b: 3, c: 5, d: 7, x: 2, y: 3, z: 5 };
    const at = (e: any) =>
      e.subs(
        Object.fromEntries(
          Object.entries(vals).map(([k, v]) => [k, ce4.box(v)])
        )
      ).N().re;
    for (const src of [
      '(a + b) c',
      '(a + b)(c + d)',
      '(a + b + c) d',
      '(\\frac{1}{x} + y) z',
      '(-\\frac{3y}{x} + \\frac{2}{x^2})(1+xy)^3',
    ]) {
      const e = ce4.parse(src);
      const d = ce4.function('Distribute', [e]).evaluate();
      expect(at(d)).toBeCloseTo(at(e), 9);
    }
  });

  test('a product with no sum operand is unchanged', () => {
    const e = ce4.parse('a b c');
    expect(ce4.function('Distribute', [e]).evaluate().isSame(e)).toBe(true);
  });
});

// Same root cause as the `ReplaceAll` case above, for user-defined functions:
// a lazy transformer took only `.canonical` of its held operand, so a call to
// a user function stayed opaque and the transformer returned it unchanged.
describe('transformers inline user-defined functions', () => {
  const ce5 = new ComputeEngine();
  ce5.assign('g', ce5.parse('t \\mapsto t^2 - 4'));

  test.each([
    ['Simplify', 'a^2 - 4'],
    ['Expand', 'a^2 - 4'],
    ['Together', 'a^2 - 4'],
    ['Distribute', 'a^2 - 4'],
  ])('%s(g(a)) = %s', (head, expected) => {
    expect(ce5.box([head, ['g', 'a']]).evaluate().toString()).toBe(expected);
  });

  test('Factor(g(a)) factors the inlined body', () => {
    expect(ce5.box(['Factor', ['g', 'a']]).evaluate().toString()).toBe(
      '(a - 2) * (a + 2)'
    );
  });

  // A transformer resolves symbols bound to a value in its operand: an
  // operator normally evaluates its arguments, and these are `lazy` only to
  // protect the operand's structure from premature rewriting.
  test('resolves assigned symbol values in the operand', () => {
    const ce6 = new ComputeEngine();
    ce6.assign('g', ce6.parse('t \\mapsto t^2'));
    ce6.assign('b', 5);
    expect(ce6.box(['Expand', ['g', ['Add', 'b', 1]]]).evaluate().toString()).toBe(
      '36'
    );
  });

  // …but `.simplify()` on an expression stays value-blind. Only the operand
  // handed to the operator is resolved.
  test('simplify() itself does not substitute values', () => {
    const ce7 = new ComputeEngine();
    ce7.assign('a', 5);
    expect(ce7.parse('a + 2').simplify().toString()).toBe('a + 2');
    expect(ce7.parse('a + 2').evaluate().toString()).toBe('7');
  });

  test('Simplify(v) simplifies the bound value', () => {
    const ce8 = new ComputeEngine();
    ce8.assign('v', ce8.parse('\\frac{x^2-1}{x-1}'));
    expect(ce8.box(['Simplify', 'v']).evaluate().toString()).toBe('x + 1');
  });
});
