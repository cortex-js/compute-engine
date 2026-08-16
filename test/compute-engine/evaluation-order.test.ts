/**
 * EVALUATION ORDER — ruling B8 of Appendix B (`docs/TYPE_SYSTEM_ROADMAP.md`).
 *
 * Once a value can be mutated in place, the order in which the operands of an
 * expression are evaluated is observable: `"\(birthday(p).fullName) — \(p.age)"`
 * reads a different `age` depending on which segment ran first. Appendix B
 * therefore pins LEFT-TO-RIGHT as part of the language's meaning on every
 * interpreted route where operands evaluate — call arguments, string
 * interpolation segments, block statements, collection callbacks, the
 * receiver-then-value order of a store, and the short-circuit forms.
 *
 * Every test here is an ORDER WITNESS: each operand calls a function that
 * appends its digit to a shared `log` (`t1()` appends 1, `t2()` appends 2, …),
 * so the final `log` spells out the order in which the operands ran. Nothing
 * here measures time.
 *
 * Two rulings of 2026-08-15 shape what is asserted:
 *
 * - COMMUTATIVE operators are the documented exception. Canonicalization sorts
 *   the operands of `Add`, `Multiply` (and other commutative operators), and
 *   evaluation walks the SORTED list — so `t1() + t2()` may run `t2` first.
 *   That order is canonical, not source, and is unspecified for the purpose
 *   of B8: when the order of effects inside a sum matters, write them as
 *   separate statements. The tests below pin that the order is CANONICAL (the
 *   same whichever way the source was written), not that it is any particular
 *   permutation.
 * - NAMED arguments evaluate in the callee's DECLARATION order, not the order
 *   they were written at the call site: `O(b: t2(), a: t1())` runs `t1` first.
 *   Named arguments are reordered into positional form before evaluation, and
 *   Appendix B already says of them "their order does not matter".
 *
 * `And`/`Or` (`&&`/`||`) are SHORT-CIRCUIT forms: left to right, and the
 * right operand does not run when the left one decides. (Before 2026-08-15
 * they were declared commutative and non-lazy, which sorted AND ran every
 * operand; that was found by this audit and ruled a defect.)
 *
 * The compiled targets are Phase 4 of the plan and are not exercised here.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/** The witnesses. Each `tN()` appends its digit to `log` and returns N; each
 * `bN()` appends its digit and returns `true`; each `fN()` appends its digit
 * and returns `false`; `mark(x)` appends `x` and returns it (for callbacks,
 * where the element itself is the digit). Every one declares the `scope`
 * effect it needs to write the outer `log`. */
const PRELUDE = `let log = 0
function t1() scope -> integer { log = log * 10 + 1
  1 }
function t2() scope -> integer { log = log * 10 + 2
  2 }
function t3() scope -> integer { log = log * 10 + 3
  3 }
function b1() scope -> boolean { log = log * 10 + 1
  true }
function b2() scope -> boolean { log = log * 10 + 2
  true }
function f1() scope -> boolean { log = log * 10 + 1
  false }
function f2() scope -> boolean { log = log * 10 + 2
  false }
function mark(x) scope -> integer { log = log * 10 + x
  x }
`;

/** Run `body` after the prelude and return the final value as a string.
 * Diagnostics are asserted empty: an order test whose program failed to parse
 * would otherwise "pass" with `log` still at 0. */
function run(body: string, tail = '\nlog'): string {
  const { value, diagnostics } = executeEpsil(
    new ComputeEngine(),
    PRELUDE + body + tail
  );
  expect(diagnostics).toEqual([]);
  return String(value);
}

/** The order the witnesses ran in, as a string of digits. */
function order(body: string): string {
  return run(body);
}

describe('CALL ARGUMENTS evaluate left to right', () => {
  test('a user-defined function', () => {
    expect(order('function g(a, b, c) { a }\ng(t1(), t2(), t3())')).toBe(
      '123'
    );
  });

  test('a builtin', () => {
    expect(order('Max(t1(), t2(), t3())')).toBe('123');
    // Written the other way, they run the other way: the order is the
    // SOURCE order, not an order the callee imposes.
    expect(order('Max(t3(), t2(), t1())')).toBe('321');
  });

  test('an immediately-applied lambda', () => {
    expect(order('((a, b) => a)(t1(), t2())')).toBe('12');
  });

  test('the arguments run before the body', () => {
    expect(order('function h(a) scope { t2()\n a }\nh(t1())')).toBe('12');
  });

  test('a nested call inside an argument runs where the argument does', () => {
    expect(order('function g(a, b) { a }\ng(Max(t1(), t2()), t3())')).toBe(
      '123'
    );
  });

  test('a call in a pipe: the piped value first, then the stage', () => {
    expect(order('t1() |> ((x) => x + t2())')).toBe('12');
  });
});

describe('NAMED ARGUMENTS evaluate in DECLARATION order (ruled 2026-08-15)', () => {
  // The call site may list named arguments in any order — Appendix B: "their
  // order does not matter" — and the arguments are matched to parameters
  // before evaluation, so the parameter order is the evaluation order.
  test('an object constructor', () => {
    expect(
      order('type O = object{a: integer, b: integer}\nO(a: t1(), b: t2())')
    ).toBe('12');
    expect(
      order('type O = object{a: integer, b: integer}\nO(b: t2(), a: t1())')
    ).toBe('12');
  });

  test('…and the object still holds the right values', () => {
    expect(
      run(
        'type O = object{a: integer, b: integer}\nlet o = O(b: t2(), a: t1())\n(o.a, o.b, log)',
        ''
      )
    ).toBe('(1, 2, 12)');
  });

  test('a user function with named parameters', () => {
    expect(
      order(
        'function g(a: integer, b: integer) -> integer { a }\ng(b: t2(), a: t1())'
      )
    ).toBe('12');
  });
});

describe('LITERALS evaluate their elements left to right', () => {
  test('list', () => {
    expect(order('[t1(), t2(), t3()]')).toBe('123');
    expect(order('[t3(), t2(), t1()]')).toBe('321');
  });

  test('nested list', () => {
    expect(order('[[t1(), t2()], [t3()]]')).toBe('123');
  });

  test('tuple', () => {
    expect(order('(t2(), t1())')).toBe('21');
  });

  test('set', () => {
    expect(order('{t2(), t1()}')).toBe('21');
  });

  test('dictionary', () => {
    expect(order('{"a" -> t1(), "b" -> t2()}')).toBe('12');
  });
});

describe('STRING INTERPOLATION segments evaluate left to right', () => {
  test('three segments', () => {
    expect(order(String.raw`"\(t1()) and \(t2()) and \(t3())"`)).toBe('123');
  });

  test('the segments are the ORDER, whatever their text', () => {
    expect(order(String.raw`"\(t3())\(t1())\(t2())"`)).toBe('312');
  });

  test('a store in an earlier segment is visible in a later one', () => {
    // The appendix's own motivating example: `birthday(p)` mutates, and the
    // later segment reads the mutated value.
    expect(
      run(
        String.raw`type P = object{age: integer}
const p = P(age: 42)
function birthday(self: P) -> P { self.age = self.age + 1
  self }
"\(birthday(p).age) then \(p.age)"`,
        ''
      )
    ).toBe('"43 then 43"');
  });
});

describe('STATEMENTS run in order', () => {
  test('a function body', () => {
    expect(order('function h() scope { t1()\n t2()\n t3() }\nh()')).toBe(
      '123'
    );
  });

  test('top-level statements', () => {
    expect(order('let y = t1()\nlet z = t2()')).toBe('12');
  });

  test('a `for` loop: the collection first, then each iteration', () => {
    expect(order('for x in [t1(), t2()] { t3() }')).toBe('1233');
  });

  test('a `while` loop runs its body once per iteration, statements in order', () => {
    expect(order('let k = 0\nwhile k < 2 { k = k + 1; t1(); t2() }')).toBe(
      '1212'
    );
  });
});

describe('CONDITIONALS evaluate the condition first, then ONE branch', () => {
  test('`if … else`', () => {
    expect(order('if b1() { t2() } else { t3() }')).toBe('12');
    expect(order('if f1() { t2() } else { t3() }')).toBe('13');
  });

  test('`a if c else b`', () => {
    expect(order('t2() if b1() else t3()')).toBe('12');
    expect(order('t2() if f1() else t3()')).toBe('13');
  });

  test('`match`: the scrutinee, then the chosen arm', () => {
    expect(order('match t1() { 1 => t2()\n _ => t3() }')).toBe('12');
  });
});

describe('SHORT-CIRCUIT `&&` / `||`: left to right, and the right side may not run', () => {
  // Ruled 2026-08-15: `And`/`Or` are lazy, non-commutative short-circuit
  // forms (they had been declared commutative and eager, which sorted their
  // operands at canonicalization and ran all of them).
  test('`&&` runs the left operand first', () => {
    expect(order('b1() && b2()')).toBe('12');
    expect(order('b2() && b1()')).toBe('21');
  });

  test('`&&` does not run the right operand when the left is false', () => {
    expect(order('f1() && b2()')).toBe('1');
    expect(order('false && b2()')).toBe('0');
  });

  test('`||` runs the left operand first', () => {
    expect(order('f1() || f2()')).toBe('12');
    expect(order('f2() || f1()')).toBe('21');
  });

  test('`||` does not run the right operand when the left is true', () => {
    expect(order('b1() || b2()')).toBe('1');
    expect(order('true || b2()')).toBe('0');
  });

  test('a chain stops at the first deciding operand', () => {
    expect(order('b1() && f2() && b1()')).toBe('12');
    expect(order('f1() || b2() || f1()')).toBe('12');
  });

  test('…and as an `if` condition', () => {
    expect(order('if f1() && b2() { 1 } else { 2 }')).toBe('1');
  });

  test('the box route agrees', () => {
    expect(order('And(f1(), b2())')).toBe('1');
    expect(order('Or(b1(), b2())')).toBe('1');
  });

  test('`??` evaluates the right side only when the left is absent', () => {
    expect(order('let s = 5 ?? t1()')).toBe('0');
  });
});

describe('COMMUTATIVE operators evaluate in CANONICAL order (ruled 2026-08-15)', () => {
  // Canonicalization sorts the operands of a commutative operator, and
  // evaluation follows the sorted list. The resulting order is therefore a
  // property of the operands, not of how the source was written — the same
  // whichever way round the author put them — and B8 leaves it unspecified.
  // These tests pin exactly that: the two spellings agree with each other,
  // and neither is promised to be source order.
  test('`+`: both spellings evaluate in the same order', () => {
    const forward = order('t1() + t2() + t3()');
    const backward = order('t3() + t2() + t1()');
    expect(forward).toBe(backward);
    expect(forward).toHaveLength(3);
  });

  test('`*` likewise', () => {
    const forward = order('t1() * t2()');
    expect(forward).toBe(order('t2() * t1()'));
    // Both witnesses ran: the agreement above is not two empty logs.
    expect(forward).toHaveLength(2);
  });

  test('a constant operand does not change that', () => {
    const forward = order('5 + t1() + t2()');
    expect(forward).toBe(order('5 + t2() + t1()'));
    expect(forward).toHaveLength(2);
  });

  test('the sort reaches into a sum nested in an ordered context', () => {
    // The list keeps its own left-to-right order (`t3` last); the sum inside
    // its first element is sorted like any other sum.
    const inList = order('[t1() + t2(), t3()]');
    expect(inList.endsWith('3')).toBe(true);
    expect(inList.slice(0, 2)).toBe(order('t1() + t2()'));
  });

  test('when the order of effects matters, sequence the statements', () => {
    // The documented way to get source order out of a sum.
    expect(order('let a = t1()\nlet b = t2()\nlet s = a + b')).toBe('12');
  });

  test('NON-commutative arithmetic is left to right', () => {
    expect(order('t2() / t1()')).toBe('21');
    expect(order('t1() / t2()')).toBe('12');
    expect(order('t2() ^ t1()')).toBe('21');
    expect(order('t1() ^ t2()')).toBe('12');
    expect(order('t2() % t1()')).toBe('21');
  });

  test('comparisons are left to right', () => {
    expect(order('t1() == t2()')).toBe('12');
    expect(order('t2() == t1()')).toBe('21');
    expect(order('t1() < t2()')).toBe('12');
    expect(order('t1() < t2() < t3()')).toBe('123');
  });
});

describe('INDEXING and STORES: the receiver, then the index, then the value', () => {
  test('the list is built before the index is computed', () => {
    expect(order('[t1(), t2(), t3()][t1()]')).toBe('1231');
  });

  test('a field store evaluates the receiver before the value (B8)', () => {
    // Also pinned in `object-store.test.ts`; repeated here so this file is
    // the complete order inventory.
    expect(
      order(`type P = object{n: integer}
function receiver() scope state -> P { log = log * 10 + 1
  P(n: 0) }
receiver().n = t2()`)
    ).toBe('12');
  });

  test('a field read on a fresh construction, then the next operand', () => {
    expect(order('type O = object{a: integer}\nlet r = (O(a: t1()).a, t2())')).toBe(
      '12'
    );
  });
});

describe('COLLECTION CALLBACKS run in element order', () => {
  // `mark(x)` appends the element to the log, so the log spells out which
  // elements the callback ran for, in order. Callback COUNTS over lazy
  // collections (an effectful callback re-running on a second forcing) are
  // pinned separately in `lazy-callback-count.test.ts`; here each element is
  // forced once, in a single pass.
  test('`Map` (callback first) over an eager list, forced by a `for` loop', () => {
    expect(
      run(
        `let s = 0
for y in Map((x) => mark(x) * 10, [7, 8, 9]) { s = s + y }
(s, log)`,
        ''
      )
    ).toBe('(240, 789)');
  });

  test('`Filter` (collection first) tests elements in order', () => {
    expect(
      run(
        `let s = 0
for y in Filter([1, 2, 3], (x) => mark(x) > 1) { s = s * 10 + y }
(s, log)`,
        ''
      )
    ).toBe('(23, 123)');
  });

  test('`Reduce` (collection first) folds left to right', () => {
    // The fold itself proves the order: acc*10 + x reads 0→1→12→123 only if
    // the elements arrive as 1, 2, 3 — and the log agrees.
    expect(
      run('let s = Reduce([1, 2, 3], (a, x) => a * 10 + mark(x), 0)\n(s, log)', '')
    ).toBe('(123, 123)');
  });

  test('a LAZY `Map` only runs the callback for the elements that are forced', () => {
    expect(
      run(
        `let m = Map((x) => mark(x) + 1, [1, 2, 3])
let a = m[2]
(a, log)`,
        ''
      )
    ).toBe('(3, 2)');
  });

  test('`Take` of a lazy `Map` over a long range forces only the taken prefix', () => {
    expect(
      run(
        `let s = 0
for y in Take(Map((x) => mark(x) * 10, 1..100), 3) { s = s + y }
(s, log)`,
        ''
      )
    ).toBe('(60, 123)');
  });

  test('a big-operator body runs once per index, in index order', () => {
    expect(order('Sum(mark(k), k in 1..3)')).toBe('123');
  });
});
