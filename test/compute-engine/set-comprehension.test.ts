import { ComputeEngine } from '../../src/compute-engine';

import '../utils'; // For snapshot serializers

// Set-builder (comprehension) expressions — REVIEW.md item G10.
//
// A `Set` whose second operand is an `Element`/`Condition` indexing-set form
// binding a variable of the body is a comprehension, not a 2-element literal
// set: its elements are the distinct substituted bodies over the (filtered)
// domain. Found via Fungrim entry 7b27cd (Count/Totient identity), where
// `Count({k ∈ 1..n : gcd(n,k) = 1})` returned 2 for every n.

function freshEngine(): ComputeEngine {
  return new ComputeEngine();
}

// The Fungrim 7b27cd shape: ["Set", k, ["Element", k, domain, cond?]]
function totientSet(n: number | string) {
  return [
    'Set',
    'k',
    ['Element', 'k', ['Range', 1, n], ['Equal', ['GCD', n, 'k'], 1]],
  ];
}

describe('Disambiguation: literal sets are unaffected', () => {
  const ce = freshEngine();

  test('{1, 2} is a 2-element literal set', () => {
    const s = ce.expr(['Set', 1, 2]);
    expect(s.count).toBe(2);
    expect(s.isEmptyCollection).toBe(false);
    expect(s.isFiniteCollection).toBe(true);
    expect([...s.each()].map((x) => x.toString())).toEqual(['1', '2']);
  });

  test('{x, y} (literal symbols) is a 2-element literal set', () => {
    const s = ce.expr(['Set', 'x', 'y']);
    expect(s.count).toBe(2);
    expect(s.evaluate().json).toEqual(['Set', 'x', 'y']);
  });

  test('literal sets deduplicate at canonicalization', () => {
    expect(ce.expr(['Set', 1, 2, 2]).count).toBe(2);
    expect(ce.expr(['Set', ['Add', 1, 1], 2]).count).toBe(1);
  });

  test('an Element proposition not binding a body variable stays literal', () => {
    // {x, k ∈ S}: `k` does not occur in the body `x`
    const s = ce.expr(['Set', 'x', ['Element', 'k', ['Range', 1, 5]]]);
    expect(s.count).toBe(2);
  });

  test('three-valued contains on literal sets', () => {
    const s = ce.expr(['Set', 1, 2]);
    expect(s.contains(ce.number(1))).toBe(true);
    expect(s.contains(ce.number(3))).toBe(false);
    // A symbolic target is indeterminate, not refuted
    expect(s.contains(ce.symbol('omega'))).toBeUndefined();
  });
});

describe('Count/Totient identity (Fungrim 7b27cd)', () => {
  const ce = freshEngine();

  test('Count({k ∈ 1..n : gcd(n,k) = 1}) = Totient(n) for n = 2..8', () => {
    for (let n = 2; n <= 8; n++) {
      const count = ce.expr(['Count', totientSet(n)]).evaluate();
      const totient = ce.expr(['Totient', n]).evaluate();
      expect(count.isSame(totient)).toBe(true);
    }
  });

  test('end-to-end with n declared integer and a literal substituted', () => {
    ce.pushScope();
    ce.declare('n', 'integer');
    const count = ce.expr(['Count', totientSet('n')]);
    for (let n = 2; n <= 8; n++) {
      const result = count.subs({ n }).evaluate();
      const totient = ce.expr(['Totient', n]).evaluate();
      expect(result.isSame(totient)).toBe(true);
    }
    ce.popScope();
  });
});

describe('Comprehension collection handlers', () => {
  const ce = freshEngine();

  test('count is the cardinality of the filtered domain', () => {
    expect(ce.expr(totientSet(5)).count).toBe(4);
  });

  test('each() iterates the filtered, substituted bodies', () => {
    const s = ce.expr(totientSet(5));
    expect([...s.each()].map((x) => x.toString())).toEqual([
      '1',
      '2',
      '3',
      '4',
    ]);
  });

  test('equal substituted bodies collapse (a set is a set)', () => {
    // {k mod 2 : k ∈ 1..4} = {1, 0}
    const s = ce.expr(['Set', ['Mod', 'k', 2], ['Element', 'k', ['Range', 1, 4]]]);
    expect(s.count).toBe(2);
    expect(s.evaluate().json).toEqual(['Set', 1, 0]);
  });

  test('empty comprehension', () => {
    const s = ce.expr([
      'Set',
      'k',
      ['Element', 'k', ['Range', 1, 5], ['Equal', 'k', 10]],
    ]);
    expect(s.count).toBe(0);
    expect(s.isEmptyCollection).toBe(true);
    expect(ce.expr(['Count', s]).evaluate().json).toEqual(0);
  });

  test('evaluate materializes small comprehensions as literal sets', () => {
    expect(ce.expr(totientSet(5)).evaluate().json).toEqual(['Set', 1, 2, 3, 4]);
  });

  test('large enumerable comprehensions count but stay symbolic on evaluate', () => {
    // 200 elements: above MAX_SIZE_EAGER_COLLECTION (100), below the
    // enumeration cap (1000)
    const s = ce.expr(['Set', 'k', ['Element', 'k', ['Range', 1, 200]]]);
    expect(s.count).toBe(200);
    expect(ce.expr(['Count', s]).evaluate().json).toEqual(200);
    const evaluated = s.evaluate();
    expect(evaluated.operator).toBe('Set');
    expect(evaluated.nops).toBe(2);
  });

  test('Sum over a comprehension uses the comprehension elements', () => {
    expect(
      ce.expr(['Sum', ['Set', 'k', ['Element', 'k', ['Range', 1, 5]]]])
        .evaluate()
        .json
    ).toEqual(15);
    // Deduplication applies before summing: {k mod 2 : k ∈ 1..4} = {1, 0}
    expect(
      ce.expr(['Sum', ['Set', ['Mod', 'k', 2], ['Element', 'k', ['Range', 1, 4]]]])
        .evaluate()
        .json
    ).toEqual(1);
  });
});

describe('Symbolic domains stay symbolic', () => {
  const ce = freshEngine();
  ce.declare('n', 'integer');

  test('count is undefined for a symbolic domain', () => {
    expect(ce.expr(totientSet('n')).count).toBeUndefined();
  });

  test('Count stays unevaluated — never the literal 2', () => {
    const count = ce.expr(['Count', totientSet('n')]).evaluate();
    expect(count.json).toEqual(['Count', totientSet('n')]);
  });

  test('evaluate returns the canonical comprehension unchanged', () => {
    const s = ce.expr(totientSet('n'));
    expect(s.evaluate().json).toEqual(totientSet('n'));
  });

  test('infinite domains are not enumerable', () => {
    const s = ce.expr(['Set', 'k', ['Element', 'k', 'Integers']]);
    expect(s.count).toBeUndefined();
    expect(s.evaluate().json).toEqual(['Set', 'k', ['Element', 'k', 'Integers']]);
  });
});

describe('Three-valued contains on comprehensions', () => {
  const ce = freshEngine();

  test('finite domains decide by enumeration', () => {
    const s = ce.expr(totientSet(5));
    expect(s.contains(ce.number(4))).toBe(true);
    expect(s.contains(ce.number(5))).toBe(false);
    // Symbolic target over a finite enumeration: indeterminate
    expect(s.contains(ce.symbol('omega'))).toBeUndefined();
  });

  test('infinite identity-body comprehensions decide via the domain', () => {
    // {k : k ∈ ℤ}
    const s = ce.expr(['Set', 'k', ['Element', 'k', 'Integers']]);
    expect(s.contains(ce.number(3))).toBe(true);
    expect(s.contains(ce.expr(['Rational', 1, 2]))).toBe(false);
    expect(s.contains(ce.symbol('x'))).toBeUndefined();
  });

  test('conditions filter literal candidates over infinite domains', () => {
    // {k ∈ ℤ : k > 0}
    const s = ce.expr([
      'Set',
      'k',
      ['Element', 'k', 'Integers', ['Greater', 'k', 0]],
    ]);
    expect(s.contains(ce.number(3))).toBe(true);
    expect(s.contains(ce.number(-3))).toBe(false);
    expect(s.contains(ce.expr(['Rational', 1, 2]))).toBe(false);
    // Symbolic target: the condition cannot be safely evaluated
    expect(s.contains(ce.symbol('x'))).toBeUndefined();
  });

  test('non-identity bodies over non-enumerable domains are indeterminate', () => {
    // {2k : k ∈ ℤ}: 3 is not in it, but we conservatively do not decide
    const s = ce.expr([
      'Set',
      ['Multiply', 2, 'k'],
      ['Element', 'k', 'Integers'],
    ]);
    expect(s.contains(ce.number(3))).toBeUndefined();
  });
});

describe('LaTeX-parsed set-builder forms', () => {
  const ce = freshEngine();

  test('\\{ k \\mid k \\in S \\} over a finite set enumerates', () => {
    const s = ce.parse('\\{ k \\mid k \\in \\{1,2,3\\} \\}');
    expect(s.count).toBe(3);
  });

  test('\\{ k \\mid k \\in \\Z \\} is not a 2-element set', () => {
    const s = ce.parse('\\{ k \\mid k \\in \\Z \\}');
    expect(s.count).toBeUndefined();
    expect(s.contains(ce.number(3))).toBe(true);
    expect(s.contains(ce.expr(['Rational', 1, 2]))).toBe(false);
  });

  test('\\{ k \\in \\Z \\mid k > 0 \\} is not a 2-element set', () => {
    const s = ce.parse('\\{ k \\in \\Z \\mid k > 0 \\}');
    expect(s.count).toBeUndefined();
    expect(s.contains(ce.number(3))).toBe(true);
    expect(s.contains(ce.number(-3))).toBe(false);
  });

  test('\\{ x \\mid x > 0 \\} (unknown domain) stays symbolic', () => {
    const s = ce.parse('\\{ x \\mid x > 0 \\}');
    expect(s.count).toBeUndefined();
    // The Condition operand is preserved, not treated as a literal element
    expect(s.evaluate().operator).toBe('Set');
    expect(s.evaluate().nops).toBe(2);
  });
});
