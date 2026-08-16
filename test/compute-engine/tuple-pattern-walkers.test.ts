import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// The walkers that must all agree about a tuple PATTERN in an index position
// (`for (p, q) in pairs`, lowered to `Element(Tuple(p, q), pairs)`):
//
//  - the comprehension classifiers in `library/control-structures.ts`
//    (`comprehensionIsDependent`, `comprehensionIsEnumerable`) must count a
//    pattern's LEAVES as bound names, or a later clause whose domain mentions
//    a leaf is misjudged independent — and then the clause counts are read
//    with the leaf unbound;
//  - the binding-site selectors in `boxed-expression/binding-sites.ts` must
//    all DROP the `_` slot, which discards its component instead of naming
//    it. `_` is the pipe placeholder (`xs |> Map(f, _)`), so a binding for it
//    in the loop scope would shadow the placeholder in the body.
//

describe('TUPLE PATTERN INDEX — comprehension clause classifiers', () => {
  test('a later clause depending on a pattern LEAF is dependent', () => {
    const ce = new ComputeEngine();
    // (p, q) walks [(1,2), (3,3)]; k walks 1..q — so q, a pattern leaf, is
    // the bound name the second clause depends on.
    //   p=1, q=2 → 1+1, 1+2
    //   p=3, q=3 → 3+1, 3+2, 3+3
    const expr = ce.box([
      'Comprehension',
      ['Add', 'p', 'k'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 3]],
      ],
      ['Element', 'k', ['Range', 1, 'q']],
    ]);
    expect(expr.evaluate().toString()).toBe('[2,3,4,5,6]');
    expect(expr.count).toBe(5);
    expect(expr.isFiniteCollection).toBe(true);
  });

  test('the pattern index matches its bare-symbol equivalent', () => {
    const ce = new ComputeEngine();
    const pattern = ce.box([
      'Comprehension',
      ['Add', 'p', 'k'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 3]],
      ],
      ['Element', 'k', ['Range', 1, 'p']],
    ]);
    const symbols = ce.box([
      'Comprehension',
      ['Add', 'p', 'k'],
      ['Element', 'p', ['List', 1, 3]],
      ['Element', 'k', ['Range', 1, 'p']],
    ]);
    expect(pattern.evaluate().toString()).toBe('[2,4,5,6]');
    expect(pattern.count).toBe(4);
    expect(symbols.evaluate().toString()).toBe(pattern.evaluate().toString());
    expect(symbols.count).toBe(pattern.count);
  });

  test('a domain depending on a pattern leaf is unjudgeable, not un-enumerable', () => {
    const ce = new ComputeEngine();
    // `Range(1, q)` with a FREE `q` reports `isEnumerableCollection: false`.
    // That verdict is only correct when the comprehension does not bind `q` —
    // here the pattern does, so the domain is dependent and the answer is
    // "unknown".
    expect(ce.box(['Range', 1, 'q']).isEnumerableCollection).toBe(false);
    const expr = ce.box([
      'Comprehension',
      ['Add', 'p', 'k'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 3]],
      ],
      ['Element', 'k', ['Range', 1, 'q']],
    ]);
    expect(expr.isEnumerableCollection).toBeUndefined();
  });

  test('an independent pattern comprehension is still enumerable', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Comprehension',
      ['Add', 'p', 'q'],
      [
        'Element',
        ['Tuple', 'p', 'q'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ]);
    expect(expr.isEnumerableCollection).toBe(true);
    expect(expr.evaluate().toString()).toBe('[3,7]');
  });
});

describe('TUPLE PATTERN INDEX — binding sites', () => {
  /** The names the binder hook declared in the expression's own scope. */
  function scopeNames(expr: any): string[] {
    return expr.localScope ? [...expr.localScope.bindings.keys()] : [];
  }

  test('a `_` slot binds nothing in a loop scope', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Loop',
      ['Add', 'p', 1],
      [
        'Element',
        ['Tuple', 'p', '_'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ]);
    expect(scopeNames(expr)).toEqual(['p']);
  });

  test('a `_` slot binds nothing in a comprehension scope', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Comprehension',
      ['Add', 'p', 1],
      [
        'Element',
        ['Tuple', 'p', '_'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ],
    ]);
    expect(scopeNames(expr)).toEqual(['p']);
    expect(expr.evaluate().toString()).toBe('[2,4]');
  });

  test('a nested pattern binds every named leaf and no `_`', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Loop',
      ['Add', 'p', 'q'],
      [
        'Element',
        ['Tuple', 'p', ['Tuple', 'q', '_']],
        ['List', ['Tuple', 1, ['Tuple', 2, 3]]],
      ],
    ]);
    expect(scopeNames(expr)).toEqual(['p', 'q']);
  });
});

describe('TUPLE PATTERN INDEX — Epsil loop bodies', () => {
  test('`_` in the body is still the pipe placeholder', () => {
    // p=1 → (10+1)+(20+1) = 32; p=3 → 13+23 = 36.
    const { value, diagnostics } = executeEpsil(
      new ComputeEngine(),
      [
        'acc := 0',
        'for (p, _) in [(1, 2), (3, 4)] {',
        '  acc := acc + ([10, 20] |> Map(_ + p, _) |> Sum)',
        '}',
        'acc',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(68);
  });

  test('a loop body reads both pattern leaves', () => {
    const { value, diagnostics } = executeEpsil(
      new ComputeEngine(),
      [
        'acc := 0',
        'for (p, q) in [(1, 2), (3, 4)] {',
        '  acc := acc + p * q',
        '}',
        'acc',
      ].join('\n')
    );
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(14);
  });
});
