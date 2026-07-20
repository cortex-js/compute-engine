import { Expression } from '../../src/math-json/types.ts';
import { ComputeEngine } from '../../src/compute-engine/index.ts';
import { engine } from '../utils';

const ce = engine;

function parse(latex: string): Expression {
  return ce.parse(latex).json;
}

describe('Parser: for-comprehensions', () => {
  describe('basic comprehension', () => {
    test('`x for x = [1...3]` → Comprehension with single Element', () => {
      const ast = parse('x \\operatorname{for} x = \\left[1...3\\right]');
      expect(ast).toEqual([
        'Comprehension', 'x', ['Element', 'x', ['Range', 1, 3]],
      ]);
    });

    test('tuple body: `(x, y) for x=L_1, y=L_2`', () => {
      const ast = parse(
        '(x, y) \\operatorname{for} x = \\left[1...2\\right], y = \\left[3...4\\right]'
      );
      expect(ast).toEqual([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ]);
    });
  });

  describe('evaluation: independent bindings produce Cartesian product', () => {
    test('(x,y) for x=[1..2], y=[1..2] → 4 tuples', () => {
      const result = ce.parse(
        '(x, y) \\operatorname{for} x = \\left[1...2\\right], y = \\left[1...2\\right]'
      ).evaluate();
      // A comprehension is a lazy collection: materialize to count its tuples.
      const items = [...result.each()];
      expect(items.length).toBe(4);
    });
  });

  describe('evaluation: later bindings see earlier', () => {
    test('(x,y) for x=[1..3], y=[1..x] → triangle', () => {
      const result = ce.parse(
        '(x, y) \\operatorname{for} x = \\left[1...3\\right], y = \\left[1...x\\right]'
      ).evaluate();
      const items = [...result.each()];
      // 1+2+3 = 6 tuples: (1,1), (2,1), (2,2), (3,1), (3,2), (3,3)
      expect(items.length).toBe(6);
    });
  });

  describe('scope hygiene', () => {
    test('bound names do not leak to enclosing scope', () => {
      const ce2 = new (ce.constructor as any)();
      ce2.parse(
        'x \\operatorname{for} x = \\left[1...3\\right]'
      ).evaluate();
      // The for-clause's `x` should not leak. Re-parsing 'x' should not pick up the binding.
      const fresh = ce2.parse('x').json;
      expect(fresh).toBe('x');
    });
  });

  describe('precedence', () => {
    test('`(x + y) for x = L1, y = L2` — body is the sum, not just y', () => {
      ce.declare('L_1', 'list<number>');
      ce.declare('L_2', 'list<number>');
      const ast = parse(
        '(x + y) \\operatorname{for} x = L_1, y = L_2'
      );
      expect(ast).toEqual([
        'Comprehension',
        ['Add', 'x', 'y'],
        ['Element', 'x', 'L_1'],
        ['Element', 'y', 'L_2'],
      ]);
    });
  });

  describe('round-trip', () => {
    test('concrete finite comprehension round-trips as a Comprehension', () => {
      // Round-trip fidelity wins over the "finite comprehensions enumerate like
      // `Range`/`Map`" convention (Tycho item 22): a CONCRETE finite
      // comprehension serializes through the faithful `body \operatorname{for}
      // var = domain` surface form and reparses to a STRUCTURALLY IDENTICAL
      // Comprehension — never the elided `\dots` list form that silently
      // reparses to a corrupt List.
      const expr = ce.expr([
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', ['Range', 1, 2]],
        ['Element', 'y', ['Range', 3, 4]],
      ]);
      const latex = expr.toLatex();
      expect(latex).toContain('\\operatorname{for}');
      const reparsed = ce.parse(latex);
      expect(reparsed.operator).toBe('Comprehension');
      expect(reparsed.count).toBe(expr.count);
      expect(reparsed.isSame(expr)).toBe(true);
    });

    test('multi-Element for-comprehension round-trips', () => {
      // A comprehension over CONCRETE finite ranges enumerates its elements on
      // serialize (like `Range`/`Map`); to round-trip the `\operatorname{for}`
      // surface form the clauses must be over non-enumerable (symbolic)
      // collections.
      if (!ce.context.lexicalScope.bindings.has('L_1'))
        ce.declare('L_1', 'list<number>');
      if (!ce.context.lexicalScope.bindings.has('L_2'))
        ce.declare('L_2', 'list<number>');
      const ast: any = [
        'Comprehension',
        ['Tuple', 'x', 'y'],
        ['Element', 'x', 'L_1'],
        ['Element', 'y', 'L_2'],
      ];
      const expr = ce.expr(ast);
      const latex = expr.toLatex();
      expect(latex).toContain('\\operatorname{for}');
      const reparsed = ce.parse(latex).json;
      expect(reparsed).toEqual(ast);
    });

    test('single-Element non-Range comprehension round-trips', () => {
      // L_1 may already be declared by the precedence test — only declare if needed
      if (!ce.context.lexicalScope.bindings.has('L_1'))
        ce.declare('L_1', 'list<number>');
      const ast: any = ['Comprehension', ['Power', 'x', 2], ['Element', 'x', 'L_1']];
      const expr = ce.expr(ast);
      const latex = expr.toLatex();
      expect(latex).toContain('\\operatorname{for}');
      const reparsed = ce.parse(latex).json;
      expect(reparsed).toEqual(ast);
    });
  });

  describe('per-walk isolation and capture (regressions)', () => {
    // C1: two iterators over the same comprehension must not share the loop
    // scope. A naive shared scope lets the second walk clobber the first
    // walk's index, so the paused first walk resumes with a corrupted `i`.
    test('interleaved iterators do not corrupt each other (C1)', () => {
      const cc = ce
        .expr([
          'Comprehension',
          ['Tuple', 'i', 'j'],
          ['Element', 'i', ['Range', 1, 2]],
          ['Element', 'j', ['Range', 1, 2]],
        ])
        .evaluate();
      const itA = cc.each()[Symbol.iterator]();
      itA.next(); // (1, 1)
      itA.next(); // (1, 2)
      itA.next(); // (2, 1)  — A is now at i = 2
      const itB = cc.each()[Symbol.iterator]();
      itB.next(); // (1, 1)  — B would reset i to 1 in a shared scope
      // A must resume at i = 2, not the value B just wrote.
      expect(itA.next().value?.toString()).toBe('(2, 2)');
    });

    // C1: reading `.count` (a full domain enumeration for a dependent
    // comprehension) mid-iteration must not corrupt a paused iterator.
    test('reading .count mid-iteration does not corrupt the iterator (C1)', () => {
      const cc = ce
        .expr([
          'Comprehension',
          ['Tuple', 'i', 'j'],
          ['Element', 'i', ['Range', 1, 3]],
          ['Element', 'j', ['Range', 1, 'i']],
        ])
        .evaluate();
      const it = cc.each()[Symbol.iterator]();
      expect(it.next().value?.toString()).toBe('(1, 1)');
      expect(it.next().value?.toString()).toBe('(2, 1)');
      expect(cc.count).toBe(6); // enumerates the domain mid-iteration
      expect(it.next().value?.toString()).toBe('(2, 2)');
      expect(it.next().value?.toString()).toBe('(3, 1)');
    });

    // C2: each materialized closure must capture its own value of the loop
    // variable, not a single shared `i` (classic loop-variable capture bug).
    test('closures capture the loop variable by value (C2)', () => {
      const lams = ce
        .expr([
          'Comprehension',
          ['Function', ['Add', 'x', 'i'], 'x'],
          ['Element', 'i', ['Range', 1, 3]],
        ])
        .evaluate();
      const applied = [...lams.each()].map((l) =>
        ce.function('Apply', [l, 10]).evaluate().toString()
      );
      expect(applied).toEqual(['11', '12', '13']);
    });

    // C3: `IndexOf` over an infinite collection with no match must abort
    // within the time budget rather than hang. Use a fresh engine and bound
    // the work in a labelled span so the shared engine's limit is untouched.
    test('IndexOf on an infinite Range aborts within a time-limited span (C3)', () => {
      const ce2 = new ComputeEngine();
      const t0 = Date.now();
      expect(() =>
        ce2.withTimeLimit({ ms: 300, label: 'test:indexof-infinite-range' }, () =>
          ce2.expr(['IndexOf', ['Range', 1, Infinity], 0.5]).evaluate()
        )
      ).toThrow();
      // Aborts promptly, not after minutes.
      expect(Date.now() - t0).toBeLessThan(5000);
    });
  });
});
