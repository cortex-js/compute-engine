import { ComputeEngine } from '../../src/compute-engine';

/**
 * `HoldValues` is a binder: it shields the assigned free symbols of its body
 * (all of them, or a listed subset), making them pure symbols — their declared
 * type and in-scope assumptions apply, their assigned value does NOT — then
 * evaluates the body. See §F of
 * `docs/plans/2026-07-23-simplify-together-scoping.md`.
 *
 * Every behavior is pinned on BOTH the `ce.box(['HoldValues', …])` route AND
 * the `ce.parse('\\operatorname{HoldValues}(…)')` route, because a lazy
 * operator with no `canonical`-side value substitution is inert on the
 * box/parse routes unless its evaluate handler canonicalizes each held operand.
 */

describe('HoldValues — all-symbols form', () => {
  test('Together shielded (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .box([
        'HoldValues',
        ['Together', ['Add', ['Divide', 1, 'x'], ['Divide', 'a', ['Power', 'x', 2]]]],
      ])
      .evaluate();
    expect(r.isSame(ce.parse('\\frac{a+x}{x^2}'))).toBe(true);
  });

  test('Together shielded (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .parse(
        '\\operatorname{HoldValues}(\\operatorname{Together}(\\frac{1}{x}+\\frac{a}{x^2}))'
      )
      .evaluate();
    expect(r.isSame(ce.parse('\\frac{a+x}{x^2}'))).toBe(true);
  });

  test('without the wrapper the values substitute (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .box([
        'Together',
        ['Add', ['Divide', 1, 'x'], ['Divide', 'a', ['Power', 'x', 2]]],
      ])
      .evaluate();
    expect(r.isSame(ce.parse('\\frac{8}{25}'))).toBe(true);
  });

  test('Simplify(Abs(w)) shielded stays symbolic (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    const r = ce.box(['HoldValues', ['Simplify', ['Abs', 'w']]]).evaluate();
    expect(r.isSame(ce.parse('|w|'))).toBe(true);
  });

  test('Simplify(Abs(w)) shielded stays symbolic (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    const r = ce
      .parse('\\operatorname{HoldValues}(\\operatorname{Simplify}(|w|))')
      .evaluate();
    expect(r.isSame(ce.parse('|w|'))).toBe(true);
  });

  test('without the wrapper Simplify(Abs(w)) folds to the value (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('w', 5);
    const r = ce.box(['Simplify', ['Abs', 'w']]).evaluate();
    expect(r.isSame(5)).toBe(true);
  });

  test('pass-through with no assigned symbols (box route)', () => {
    const ce = new ComputeEngine();
    const r = ce.box(['HoldValues', ['Add', 1, 2]]).evaluate();
    expect(r.isSame(3)).toBe(true);
  });

  test('pass-through with no assigned symbols (parse route)', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('\\operatorname{HoldValues}(1+2)').evaluate();
    expect(r.isSame(3)).toBe(true);
  });
});

describe('HoldValues — subset form', () => {
  test('shield only [a]; x still resolves (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .box(['HoldValues', ['Add', ['Power', 'x', 2], 'a'], ['List', 'a']])
      .evaluate();
    // x -> 5 folds to 25; a is shielded and stays symbolic.
    expect(r.isSame(ce.parse('25 + a'))).toBe(true);
  });

  test('shield only [a]; x still resolves (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .parse('\\operatorname{HoldValues}(x^2+a, \\lbrack a\\rbrack)')
      .evaluate();
    expect(r.isSame(ce.parse('25 + a'))).toBe(true);
  });

  test('single-symbol spec shields that symbol (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    // Shield x; a -> 3 resolves.
    const r = ce
      .box(['HoldValues', ['Add', ['Power', 'x', 2], 'a'], 'x'])
      .evaluate();
    expect(r.isSame(ce.parse('x^2 + 3'))).toBe(true);
  });
});

describe('HoldValues — assumptions survive the shield', () => {
  test('assume(w>0) with w:=5 → w (box route)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('w > 0'));
    ce.assign('w', 5);
    const r = ce.box(['HoldValues', ['Simplify', ['Abs', 'w']]]).evaluate();
    expect(r.isSame(ce.symbol('w'))).toBe(true);
  });

  test('assume(w>0) with w:=5 → w (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('w > 0'));
    ce.assign('w', 5);
    const r = ce
      .parse('\\operatorname{HoldValues}(\\operatorname{Simplify}(|w|))')
      .evaluate();
    expect(r.isSame(ce.symbol('w'))).toBe(true);
  });
});

describe('HoldValues — globals intact and nesting', () => {
  test('global value still evaluates afterwards (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.box(['HoldValues', ['Add', ['Power', 'x', 2], 1]]).evaluate();
    expect(ce.symbol('x').evaluate().isSame(5)).toBe(true);
  });

  test('global value still evaluates afterwards (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.parse('\\operatorname{HoldValues}(x^2+1)').evaluate();
    expect(ce.symbol('x').evaluate().isSame(5)).toBe(true);
  });

  test('nested HoldValues stays value-blind (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .box(['HoldValues', ['HoldValues', ['Add', ['Power', 'x', 2], 'a']]])
      .evaluate();
    expect(r.isSame(ce.parse('x^2 + a'))).toBe(true);
  });

  test('nested HoldValues stays value-blind (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .parse(
        '\\operatorname{HoldValues}(\\operatorname{HoldValues}(x^2+a))'
      )
      .evaluate();
    expect(r.isSame(ce.parse('x^2 + a'))).toBe(true);
  });
});

describe('HoldValues — interaction with the evaluate-first Simplify operator', () => {
  // The `Simplify` operator evaluates its argument first; inside a
  // `HoldValues`, the shielded symbol has no value, so the evaluation leaves
  // it symbolic and the simplification rules act on the symbolic form.
  test('Simplify(x^2 + x) shielded (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const shielded = ce
      .box(['HoldValues', ['Simplify', ['Add', ['Power', 'x', 2], 'x']]])
      .evaluate();
    expect(shielded.isSame(ce.parse('x^2 + x'))).toBe(true);
    // Contrast: the bare Simplify operator substitutes the value.
    const bare = ce
      .box(['Simplify', ['Add', ['Power', 'x', 2], 'x']])
      .evaluate();
    expect(bare.isSame(30)).toBe(true);
  });

  test('Simplify(x^2 + x) shielded (parse route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    const shielded = ce
      .parse('\\operatorname{HoldValues}(\\operatorname{Simplify}(x^2+x))')
      .evaluate();
    expect(shielded.isSame(ce.parse('x^2 + x'))).toBe(true);
    const bare = ce.parse('\\operatorname{Simplify}(x^2+x)').evaluate();
    expect(bare.isSame(30)).toBe(true);
  });
});

describe('HoldValues — .N() route leaves shielded symbols symbolic', () => {
  test('N() of a shielded Together stays symbolic (box route)', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 5);
    ce.assign('a', 3);
    const r = ce
      .box([
        'HoldValues',
        ['Together', ['Add', ['Divide', 1, 'x'], ['Divide', 'a', ['Power', 'x', 2]]]],
      ])
      .N();
    expect(r.isSame(ce.parse('\\frac{a+x}{x^2}'))).toBe(true);
  });
});
