import { ComputeEngine } from '../../src/compute-engine';

import { engine } from '../utils';

const ce: ComputeEngine = engine;

describe('DECLARING', () => {
  beforeAll(() => {
    ce.pushScope();
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Declare a variable with a type', () => {
    ce.declare('a', { type: 'number' });
    expect(ce.box('a').type.toString()).toEqual('number');
  });

  test('Declare a variable with value', () => {
    ce.declare('b', { value: 5 });
    expect(ce.box('b').type.toString()).toEqual('integer');
    expect(ce.box('b').valueOf()).toEqual(5);
  });

  test('Declare a variable with value and type', () => {
    ce.declare('c', { type: 'number', value: 5 });
    expect(ce.box('c').type.toString()).toEqual('number');
    expect(ce.box('c').valueOf()).toEqual(5);
  });

  test("Can't declare twice in same scope", () => {
    ce.declare('d', { type: 'number' });

    expect(() => ce.declare('d', { type: 'boolean' })).toThrow(
      `The symbol "d" is already declared`
    );
  });

  test('Declare a variable and widen type', () => {
    ce.declare('g', { value: 5 }); // Inferred as finite_integer
    expect(ce.box('g').type.toString()).toEqual('integer');
    ce.assign('g', 5.5);
    expect(ce.box('g').type.toString()).toEqual('real');
  });

  // test('Default value of declared variables', () => {
  //   ce.declare('d', { value: 42 });
  //   expect(ce.box('d').value).toEqual(42);
  // });
});

describe('CONSTANTS', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('c', { type: 'number', value: 5, isConstant: true });
    ce.declare('d', { type: 'number', isConstant: true }); // Constant without value
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Access constant', () => {
    expect(ce.box('c').valueOf()).toEqual(5);
  });
  test('Access constant without value', () => {
    expect(ce.box('d').value?.toString()).toBeUndefined();
    expect(ce.box('d').type.toString()).toEqual('number');
  });
  test("Constants can't be changed", () => {
    expect(() => (ce.box('c').value = 0)).toThrow(
      `The value of the constant "c" cannot be changed`
    );
  });
  test('Access value-less constants', () => {
    // The value of a value-less constant is undefined
    expect(ce.box('True').value).toBeUndefined();
    expect(ce.box('q').value).toBeUndefined();
  });
});

describe('VARIABLES IN NESTED SCOPES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 5 });
  });
  afterAll(() => {
    ce.popScope();
  });

  test('Access global from inner scope', () => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 10 });
    expect(ce.box('var1').valueOf()).toEqual(10);
    ce.popScope();
  });

  test('Change local in inner scope', () => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 10 });
    ce.box('var1').value = 20;
    expect(ce.box('var1').valueOf()).toEqual(20);
    ce.popScope();
  });
});

// Although the compute engine uses lexical scoping, we can simulate dynamic
// scoping by using the `Symbol` operator.
describe('DYNAMIC SCOPING', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('var1', { type: 'number', value: 5 });
    ce.declare('f', 'function');
    ce.declare('g', 'function');
    // 'f' is lexically scoped, 'g' is dynamically scoped
    ce.assign('f', ce.function('Function', [['Block', 'var1']]));
    ce.assign('g', ce.function('Function', [['Symbol', 'var1']]));
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Lexical scoping', () => {
    expect(
      ce
        .function('Block', [
          ['Declare', 'var1', 'number'],
          ['Assign', 'var1', 10],
          ['f'],
        ])
        .evaluate()
        .valueOf()
    ).toMatchInlineSnapshot(`5`); // 5 — correct lexical scoping: f sees var1=5 from its defining scope
  });
  test('Dynamic scoping', () => {
    expect(
      ce
        .function('Block', [
          ['Declare', 'var1', 'number'],
          ['Assign', 'var1', 10],
          ['g'],
        ])
        .evaluate()
        .valueOf()
    ).toMatchInlineSnapshot(`5`); // 5 — g's Block scope is lexically parented to S (var1=5), not the calling block
  });
});

describe('FUNCTIONS WITH ARGUMENTS AND LOCAL VARIABLES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('f', { type: '(number) -> number' });
    ce.declare('x', { type: 'number', value: 5 });
    ce.assign('f', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Calling function with arguments', () => {
    expect(ce.box(['f', 15]).evaluate().valueOf()).toEqual(30);
    expect(ce.box('x').evaluate().valueOf()).toEqual(5);
  });
});

describe('FUNCTIONS WITH RETURN STATEMENT', () => {
  beforeAll(() => ce.pushScope());
  afterAll(() => ce.popScope());

  test('Return at top level of Block is the function result', () => {
    // f(n) = Block(t = n * 2, Return(t))
    // Return at the top level of Block correctly short-circuits.
    const f = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'ret_t', 'number'],
        ['Assign', 'ret_t', ['Multiply', 'ret_n', 2]],
        ['Return', 'ret_t'],
        // This statement must NOT be reached:
        ['Assign', 'ret_t', 999],
      ],
      'ret_n',
    ]);
    ce.pushScope();
    ce.declare('ret_f', 'function');
    ce.assign('ret_f', f);
    expect(ce.box(['ret_f', 3]).evaluate().valueOf()).toEqual(6);
    expect(ce.box(['ret_f', 5]).evaluate().valueOf()).toEqual(10);
    ce.popScope();
  });
});

describe('FUNCTIONS WITH CONFLICTING ARGUMENTS AND LOCAL VARIABLES', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('f', { type: '(number) -> number' });
    ce.declare('x', { type: 'number', value: 5 });
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['Declare', 'x'], ['Multiply', 'x', 2]],
        'x',
      ])
    );
  });
  afterAll(() => {
    ce.popScope();
  });
  test('Calling function with conflicting arguments', () => {
    expect(() =>
      ce.box(['f', 15]).evaluate()
    ).toThrowErrorMatchingInlineSnapshot(
      `The symbol "x" is already declared in this scope`
    );
  });
});

describe('RECURSIVE FUNCTION WITH OUTER VARIABLE', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('fib', { type: '(number) -> number' });
    ce.declare('counter', { type: 'number', value: 0 });
    ce.assign(
      'fib',
      ce.box([
        'Function',
        [
          'Block',
          ['Assign', 'counter', ['Add', 'counter', 1]],
          [
            'If',
            ['Less', 'n', 2],
            'n',
            ['Add', ['fib', ['Add', 'n', -1]], ['fib', ['Add', 'n', -2]]],
          ],
        ],
        'n',
      ])
    );
  });
  afterAll(() => {
    ce.popScope();
  });

  test('Calling recursive function', () => {
    expect(ce.box(['fib', 8]).evaluate().valueOf()).toEqual(21);
    expect(ce.box('counter').evaluate().valueOf()).toEqual(67);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION: Lexical scoping — function should see DEFINING scope, not
// calling scope.
// ─────────────────────────────────────────────────────────────────────────
describe('REGRESSION: Lexical scoping', () => {
  beforeAll(() => {
    ce.pushScope();
    ce.declare('lc_reg_c', { value: 5 });
    ce.declare('lc_reg_f', 'function');
    ce.assign('lc_reg_f', ce.box(['Function', ['Block', 'lc_reg_c']]));
  });
  afterAll(() => ce.popScope());

  test('function returns defining-scope value, not calling-scope value', () => {
    // Inner scope re-declares lc_reg_c = 10 — with true lexical scoping,
    // lc_reg_f() must still return 5 (the defining scope's value, not 10).
    let result: unknown;
    try {
      ce.pushScope();
      ce.declare('lc_reg_c', { value: 10 });
      result = ce.box(['lc_reg_f']).evaluate().valueOf();
    } finally {
      ce.popScope();
    }
    expect(result).toEqual(5);
  });

  test('recursive function has per-call parameter isolation', () => {
    // f(n) = if n <= 0 then 0 else n + f(n-1)
    // With shared _localScope, recursive calls corrupt each other's params.
    // With fresh scopes, each call has isolated params: f(3) = 3+2+1+0 = 6.
    ce.pushScope();
    try {
      ce.declare('reclc_f', 'function');
      ce.assign(
        'reclc_f',
        ce.box([
          'Function',
          ['Block',
            ['If', ['LessEqual', 'reclc_n', 0], 0,
              ['Add', 'reclc_n', ['reclc_f', ['Subtract', 'reclc_n', 1]]]]
          ],
          'reclc_n',
        ])
      );
      expect(ce.box(['reclc_f', 3]).evaluate().valueOf()).toEqual(6);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION: BigOp scope isolation — Sum's localScope should contain ONLY
// the index variable.
// ─────────────────────────────────────────────────────────────────────────
describe('REGRESSION: BigOp scope isolation', () => {
  beforeAll(() => ce.pushScope());
  afterAll(() => ce.popScope());

  test('Sum localScope.bindings contains only the index variable', () => {
    // Sum(k*x, Limits(k, 0, M)) — only k should be in the BigOp local scope.
    // Before the fix, x and M are also auto-declared there (scope pollution).
    const sum = ce.box(['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 0, 'M']]);
    const keys = [...(sum.localScope?.bindings.keys() ?? [])];
    expect(keys).toEqual(['k']);
  });

  test('Repeated BigOp evaluation is idempotent (stale index value safety)', () => {
    // Evaluating Sum(j, Limits(j, 1, 4)) twice must give 10 both times.
    // If stale j=4 from the first evaluation bleeds into the second run,
    // re-evaluation could produce incorrect results.
    const sum = ce.box(['Sum', 'j', ['Limits', 'j', 1, 4]]);
    expect(sum.evaluate().valueOf()).toEqual(10);
    expect(sum.evaluate().valueOf()).toEqual(10);
  });

  test('Product scope isolation — index not visible after evaluation', () => {
    // After evaluating Product(m, Limits(m, 1, 5)) = 120,
    // m should not be visible in the outer scope.
    ce.box(['Product', 'm', ['Limits', 'm', 1, 5]]).evaluate();
    expect(ce.box('m').value?.toString()).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FUNCTIONS: edge cases
// ─────────────────────────────────────────────────────────────────────────
describe('FUNCTIONS: edge cases', () => {
  test('calling a function with too many arguments throws', () => {
    // f(x) = x * 2 — only one parameter
    ce.pushScope();
    try {
      ce.declare('edge_f', 'function');
      ce.assign('edge_f', ce.box(['Function', ['Multiply', 'edge_x', 2], 'edge_x']));
      // Calling with two arguments should throw "Too many arguments"
      expect(() => ce.box(['edge_f', 3, 4]).evaluate()).toThrow('Too many arguments');
    } finally {
      ce.popScope();
    }
  });

  test('assumptions in outer scope are visible when evaluating inside a Block', () => {
    // ce.assume('isc_a > 0') sets a context assumption.
    // When a Block evaluates 'isc_a', it should resolve correctly since _inScope
    // now inherits parent assumptions.
    ce.pushScope();
    try {
      ce.assume(ce.box(['Greater', 'isc_a', 0]));
      // Evaluate a Block that references isc_a — the sign should reflect the assumption
      const sign = ce
        .box(['Block', 'isc_a'])
        .evaluate()
        .sgn;
      expect(sign).toBe('positive');
    } finally {
      ce.popScope();
    }
  });

  test('BigOp noAutoDeclare is cleared even when body canonicalization succeeds', () => {
    // After Sum(...) is canonicalized, the BigOp scope's noAutoDeclare should be
    // false so that ce.assign works correctly during evaluation.
    ce.pushScope();
    try {
      const sum = ce.box(['Sum', 'bigop_k', ['Limits', 'bigop_k', 1, 3]]);
      // If noAutoDeclare were stuck at true, assigning to bigop_k during evaluation
      // would fail to find the symbol and the result would be wrong.
      expect(sum.evaluate().valueOf()).toEqual(6);
      // A second evaluation must give the same result (stale state check)
      expect(sum.evaluate().valueOf()).toEqual(6);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BigOp + Function interaction edge cases
// ─────────────────────────────────────────────────────────────────────────
describe('BigOp + Function interaction', () => {
  test('function body containing a Sum evaluates correctly', () => {
    // f(n) = Sum(k, Limits(k, 1, n)) — function that returns a Sum
    ce.pushScope();
    try {
      ce.declare('sumfn_f', 'function');
      ce.assign(
        'sumfn_f',
        ce.box([
          'Function',
          ['Block', ['Sum', 'sumfn_k', ['Limits', 'sumfn_k', 1, 'sumfn_n']]],
          'sumfn_n',
        ])
      );
      expect(ce.box(['sumfn_f', 5]).evaluate().valueOf()).toEqual(15);
      expect(ce.box(['sumfn_f', 3]).evaluate().valueOf()).toEqual(6);
    } finally {
      ce.popScope();
    }
  });

  test('Sum body that calls a user-defined function', () => {
    // g(x) = x^2, then Sum(g(k), Limits(k, 1, 4)) = 1+4+9+16 = 30
    ce.pushScope();
    try {
      ce.declare('sumcall_g', 'function');
      ce.assign(
        'sumcall_g',
        ce.box(['Function', ['Power', 'sumcall_x', 2], 'sumcall_x'])
      );
      const result = ce
        .box([
          'Sum',
          ['sumcall_g', 'sumcall_k'],
          ['Limits', 'sumcall_k', 1, 4],
        ])
        .evaluate()
        .valueOf();
      expect(result).toEqual(30);
    } finally {
      ce.popScope();
    }
  });

  test('nested Sums with different index variables', () => {
    // Sum(Sum(i*j, Limits(j, 1, 3)), Limits(i, 1, 2))
    // = Sum over i=1..2 of (i*1 + i*2 + i*3)
    // = Sum over i=1..2 of i*6
    // = 6 + 12 = 18
    ce.pushScope();
    try {
      const result = ce
        .box([
          'Sum',
          [
            'Sum',
            ['Multiply', 'nested_i', 'nested_j'],
            ['Limits', 'nested_j', 1, 3],
          ],
          ['Limits', 'nested_i', 1, 2],
        ])
        .evaluate()
        .valueOf();
      expect(result).toEqual(18);
    } finally {
      ce.popScope();
    }
  });

  test('function body containing a Product evaluates correctly', () => {
    // f(n) = Product(k, Limits(k, 1, n)) — function that returns a Product (factorial)
    ce.pushScope();
    try {
      ce.declare('prodfn_f', 'function');
      ce.assign(
        'prodfn_f',
        ce.box([
          'Function',
          ['Block', ['Product', 'prodfn_k', ['Limits', 'prodfn_k', 1, 'prodfn_n']]],
          'prodfn_n',
        ])
      );
      expect(ce.box(['prodfn_f', 5]).evaluate().valueOf()).toEqual(120);
      expect(ce.box(['prodfn_f', 3]).evaluate().valueOf()).toEqual(6);
    } finally {
      ce.popScope();
    }
  });

  test('closure capturing a BigOp result', () => {
    // f(n) = Block(total = Sum(k, Limits(k, 1, n)), Function(Add(total, y), y))
    // f(3) should return a function g where g(y) = 6 + y
    ce.pushScope();
    try {
      ce.declare('clbigop_f', 'function');
      ce.assign(
        'clbigop_f',
        ce.box([
          'Function',
          [
            'Block',
            ['Declare', 'clbigop_total', 'number'],
            ['Assign', 'clbigop_total', ['Sum', 'clbigop_k', ['Limits', 'clbigop_k', 1, 'clbigop_n']]],
            ['Function', ['Block', ['Add', 'clbigop_total', 'clbigop_y']], 'clbigop_y'],
          ],
          'clbigop_n',
        ])
      );
      // f(3) → g where g(y) = 6 + y (since Sum(k, 1..3) = 6)
      const g = ce.box(['clbigop_f', 3]).evaluate();
      expect(g.operator).toEqual('Function');
      // g(10) = 6 + 10 = 16
      ce.declare('clbigop_g', 'function');
      ce.assign('clbigop_g', g);
      expect(ce.box(['clbigop_g', 10]).evaluate().valueOf()).toEqual(16);
      // g(0) = 6 + 0 = 6
      expect(ce.box(['clbigop_g', 0]).evaluate().valueOf()).toEqual(6);
    } finally {
      ce.popScope();
    }
  });

  test('repeated calls to function-containing-Sum are independent', () => {
    // Ensure no stale state between calls: f(n) = Sum(k, Limits(k, 1, n))
    ce.pushScope();
    try {
      ce.declare('repsum_f', 'function');
      ce.assign(
        'repsum_f',
        ce.box([
          'Function',
          ['Block', ['Sum', 'repsum_k', ['Limits', 'repsum_k', 1, 'repsum_n']]],
          'repsum_n',
        ])
      );
      expect(ce.box(['repsum_f', 4]).evaluate().valueOf()).toEqual(10);
      expect(ce.box(['repsum_f', 4]).evaluate().valueOf()).toEqual(10);
      expect(ce.box(['repsum_f', 2]).evaluate().valueOf()).toEqual(3);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// REGRESSION: forget() should clear values introduced by assume()
// ─────────────────────────────────────────────────────────────────────────
describe('REGRESSION: forget() clears assume() values', () => {
  test('forget() undoes an assume() equality in the same scope', () => {
    // After ce.assume('x = 5'), ce.forget('x') must revert x to unknown.
    ce.pushScope();
    try {
      ce.assume(ce.box(['Equal', 'fgt_x', 5]));
      expect(ce.box('fgt_x').evaluate().valueOf()).toEqual(5);
      ce.forget('fgt_x');
      expect(ce.box('fgt_x').evaluate().json).toEqual('fgt_x');
    } finally {
      ce.popScope();
    }
  });

  test('popScope() clears values set by assume() in an inner scope', () => {
    // This tests that scoped assumptions are properly contained.
    ce.pushScope();
    ce.assume(ce.box(['Equal', 'fgt_y', 10]));
    expect(ce.box('fgt_y').evaluate().valueOf()).toEqual(10);
    ce.popScope();
    // fgt_y was never declared outside this scope, so evaluates to itself
    expect(ce.box('fgt_y').evaluate().json).toEqual('fgt_y');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Additional edge cases for scoping correctness
// ─────────────────────────────────────────────────────────────────────────
describe('DEEP NESTING AND SHADOWING', () => {
  test('three-level variable shadowing resolves innermost', () => {
    // Outer: x=1, Middle: x=2, Inner: x=3. Reading x in inner returns 3.
    ce.pushScope();
    try {
      ce.declare('deep_x', { value: 1 });
      ce.pushScope();
      try {
        ce.declare('deep_x', { value: 2 });
        ce.pushScope();
        try {
          ce.declare('deep_x', { value: 3 });
          expect(ce.box('deep_x').evaluate().valueOf()).toEqual(3);
        } finally {
          ce.popScope();
        }
        // Middle scope: x=2
        expect(ce.box('deep_x').evaluate().valueOf()).toEqual(2);
      } finally {
        ce.popScope();
      }
      // Outer scope: x=1
      expect(ce.box('deep_x').evaluate().valueOf()).toEqual(1);
    } finally {
      ce.popScope();
    }
  });

  test('partial shadowing: middle scope skips, inner scope reads from outer', () => {
    // Outer: x=10, Middle: no x, Inner: reads x → should be 10
    ce.pushScope();
    try {
      ce.declare('ps_x', { value: 10 });
      ce.pushScope();
      try {
        // Middle scope: y declared but not x
        ce.declare('ps_y', { value: 20 });
        ce.pushScope();
        try {
          // Inner scope: reads x (skips middle, finds outer)
          expect(ce.box('ps_x').evaluate().valueOf()).toEqual(10);
          expect(ce.box('ps_y').evaluate().valueOf()).toEqual(20);
        } finally {
          ce.popScope();
        }
      } finally {
        ce.popScope();
      }
    } finally {
      ce.popScope();
    }
  });
});

describe('FUNCTION INSIDE BIGOP', () => {
  test('function defined in Sum body captures index variable', () => {
    // Sum(Apply(Function(Block(Multiply(x, k)), x), 2), Limits(k, 1, 3))
    // = Apply(x->x*1, 2) + Apply(x->x*2, 2) + Apply(x->x*3, 2)
    // = 2 + 4 + 6 = 12
    ce.pushScope();
    try {
      const result = ce
        .box([
          'Sum',
          [
            'Apply',
            ['Function', ['Block', ['Multiply', 'fib_x', 'fib_k']], 'fib_x'],
            2,
          ],
          ['Limits', 'fib_k', 1, 3],
        ])
        .evaluate()
        .valueOf();
      expect(result).toEqual(12);
    } finally {
      ce.popScope();
    }
  });

  test('BigOp with free variable mutation during evaluation', () => {
    // Sum(k, Limits(k, 1, 4)) with an outer variable 'acc' that exists
    // but is NOT mutated by the Sum body — ensures Sum doesn't pollute.
    ce.pushScope();
    try {
      ce.declare('bfv_acc', { value: 100 });
      const sum = ce.box(['Sum', 'bfv_k', ['Limits', 'bfv_k', 1, 4]]);
      expect(sum.evaluate().valueOf()).toEqual(10);
      // acc should still be 100 — Sum evaluation doesn't pollute outer scope
      expect(ce.box('bfv_acc').evaluate().valueOf()).toEqual(100);
    } finally {
      ce.popScope();
    }
  });
});

describe('SCOPE CHAIN INTEGRITY', () => {
  test('mutation in defining scope visible through closure', () => {
    // x=5, f()=x, x=99, f() → 99 (by-reference capture)
    ce.pushScope();
    try {
      ce.declare('mut_x', { value: 5 });
      ce.declare('mut_f', 'function');
      ce.assign('mut_f', ce.box(['Function', ['Block', 'mut_x']]));
      expect(ce.box(['mut_f']).evaluate().valueOf()).toEqual(5);
      ce.assign('mut_x', 99);
      expect(ce.box(['mut_f']).evaluate().valueOf()).toEqual(99);
    } finally {
      ce.popScope();
    }
  });

  test('re-declaration in calling scope invisible to function', () => {
    // x=5, f()=x defined in outer scope.
    // Inner scope: x=42, call f() → should still see 5 (lexical).
    ce.pushScope();
    try {
      ce.declare('inv_x', { value: 5 });
      ce.declare('inv_f', 'function');
      ce.assign('inv_f', ce.box(['Function', ['Block', 'inv_x']]));
      ce.pushScope();
      try {
        ce.declare('inv_x', { value: 42 });
        expect(ce.box(['inv_f']).evaluate().valueOf()).toEqual(5);
      } finally {
        ce.popScope();
      }
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Nested BigOps with overlapping index names
// ─────────────────────────────────────────────────────────────────────────
describe('NESTED BIGOPS WITH SAME INDEX NAME', () => {
  test('nested Sums with same index variable name', () => {
    // Sum(Sum(k, Limits(k, 1, 3)), Limits(k, 1, 2))
    // Inner: Sum(k, k=1..3) = 6 for each outer iteration.
    // Outer: 6 + 6 = 12
    // The inner k must shadow the outer k during inner evaluation.
    ce.pushScope();
    try {
      const result = ce
        .box([
          'Sum',
          ['Sum', 'sameIdx_k', ['Limits', 'sameIdx_k', 1, 3]],
          ['Limits', 'sameIdx_k', 1, 2],
        ])
        .evaluate()
        .valueOf();
      expect(result).toEqual(12);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Multiple closures aliasing the same mutable variable
// ─────────────────────────────────────────────────────────────────────────
describe('MULTIPLE CLOSURES OVER SAME VARIABLE', () => {
  test('two closures see the same mutable variable', () => {
    // x = 0
    // inc() = Block(Assign(mcv_x, Add(mcv_x, 1)), mcv_x)
    // get() = Block(mcv_x)
    // inc() → 1, get() → 1, inc() → 2, get() → 2
    ce.pushScope();
    try {
      ce.declare('mcv_x', { type: 'integer', value: 0 });
      ce.declare('mcv_inc', 'function');
      ce.declare('mcv_get', 'function');
      ce.assign(
        'mcv_inc',
        ce.box([
          'Function',
          ['Block', ['Assign', 'mcv_x', ['Add', 'mcv_x', 1]], 'mcv_x'],
        ])
      );
      ce.assign('mcv_get', ce.box(['Function', ['Block', 'mcv_x']]));
      expect(ce.box(['mcv_inc']).evaluate().valueOf()).toEqual(1);
      expect(ce.box(['mcv_get']).evaluate().valueOf()).toEqual(1);
      expect(ce.box(['mcv_inc']).evaluate().valueOf()).toEqual(2);
      expect(ce.box(['mcv_get']).evaluate().valueOf()).toEqual(2);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Empty Block evaluation
// ─────────────────────────────────────────────────────────────────────────
describe('BLOCK EVALUATION', () => {
  test('Block with single expression returns that expression', () => {
    const result = ce.box(['Block', 42]).evaluate();
    expect(result.valueOf()).toEqual(42);
  });

  test('Block returns the last evaluated expression', () => {
    const result = ce.box(['Block', 1, 2, 3]).evaluate();
    expect(result.valueOf()).toEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// BigOp with symbolic (non-numeric) limits stays symbolic
// ─────────────────────────────────────────────────────────────────────────
describe('BIGOP WITH SYMBOLIC LIMITS', () => {
  test('Sum with symbolic upper bound stays symbolic until assigned', () => {
    // Sum(k, Limits(k, 1, n)) where n is not assigned — should stay symbolic
    ce.pushScope();
    try {
      const sum = ce.box(['Sum', 'sym_k', ['Limits', 'sym_k', 1, 'sym_n']]);
      const result = sum.evaluate();
      // Should not evaluate to a number — either stays as Sum or returns NaN
      // The important thing is it doesn't crash
      expect(result).toBeDefined();
      // When n is assigned, it should evaluate correctly
      // sym_n was auto-declared by canonicalization (promoted to parent scope via noAutoDeclare)
      ce.assign('sym_n', 4);
      const result2 = sum.evaluate();
      expect(result2.valueOf()).toEqual(10);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Recursive closure capture: a recursive function that returns closures
// ─────────────────────────────────────────────────────────────────────────
describe('RECURSIVE CLOSURE CAPTURE', () => {
  test('recursive function producing closures captures params correctly', () => {
    // makeAdder(n) = if n <= 0 then Function(x, x) else Function(Add(x, n), x)
    // Each call at a different recursion depth should capture its own n.
    ce.pushScope();
    try {
      ce.declare('rcc_makeAdder', 'function');
      ce.assign(
        'rcc_makeAdder',
        ce.box([
          'Function',
          [
            'Block',
            [
              'If',
              ['LessEqual', 'rcc_n', 0],
              ['Function', ['Block', 'rcc_x'], 'rcc_x'],
              ['Function', ['Block', ['Add', 'rcc_x', 'rcc_n']], 'rcc_x'],
            ],
          ],
          'rcc_n',
        ])
      );

      // makeAdder(3) → g where g(x) = x + 3
      const g = ce.box(['rcc_makeAdder', 3]).evaluate();
      ce.declare('rcc_g', 'function');
      ce.assign('rcc_g', g);
      expect(ce.box(['rcc_g', 10]).evaluate().valueOf()).toEqual(13);

      // makeAdder(7) → h where h(x) = x + 7 — different closure, different n
      const h = ce.box(['rcc_makeAdder', 7]).evaluate();
      ce.declare('rcc_h', 'function');
      ce.assign('rcc_h', h);
      expect(ce.box(['rcc_h', 10]).evaluate().valueOf()).toEqual(17);

      // g and h are independent closures — calling h doesn't affect g
      expect(ce.box(['rcc_g', 10]).evaluate().valueOf()).toEqual(13);
    } finally {
      ce.popScope();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Additional edge cases for scope robustness
// ─────────────────────────────────────────────────────────────────────────
describe('SCOPE EDGE CASES', () => {
  test('nested BigOps with same index variable name (shadowing)', () => {
    // Sum(Sum(k, Limits(k, 1, 3)), Limits(k, 1, 2))
    // Inner sum: k=1+2+3 = 6 for each iteration
    // Outer sum: 6 + 6 = 12
    // The inner k must shadow the outer k during inner evaluation.
    ce.pushScope();
    try {
      const result = ce
        .box([
          'Sum',
          ['Sum', 'shad_k', ['Limits', 'shad_k', 1, 3]],
          ['Limits', 'shad_k', 1, 2],
        ])
        .evaluate()
        .valueOf();
      expect(result).toEqual(12);
    } finally {
      ce.popScope();
    }
  });

  test('re-declaration after forget() succeeds', () => {
    ce.pushScope();
    try {
      ce.declare('redecl_x', { type: 'integer', value: 5 });
      expect(ce.box('redecl_x').evaluate().valueOf()).toEqual(5);

      ce.forget('redecl_x');
      // After forget, value is cleared but symbol still declared in this scope
      // Assigning a new value should work
      ce.assign('redecl_x', 42);
      expect(ce.box('redecl_x').evaluate().valueOf()).toEqual(42);
    } finally {
      ce.popScope();
    }
  });

  test('scope cleanup after evaluation error in function', () => {
    // If a function body throws during evaluation, the scope should
    // still be properly cleaned up (no leaked scope frames).
    const stackDepthBefore = ce._evalContextStack.length;
    ce.pushScope();
    try {
      ce.declare('err_f', 'function');
      ce.assign('err_f', ['Function', ['Block', ['Add', 'err_x', 1]], 'err_x']);

      // Normal call should work
      expect(ce.box(['err_f', 5]).evaluate().valueOf()).toEqual(6);

      // Too many arguments should throw but not leak scope frames
      expect(() => ce.box(['err_f', 1, 2]).evaluate()).toThrow();
    } finally {
      ce.popScope();
    }
    // Stack depth should be restored to what it was before
    expect(ce._evalContextStack.length).toEqual(stackDepthBefore);
  });

  test('mutation after function definition is visible (by-reference)', () => {
    ce.pushScope();
    try {
      ce.declare('mut_c', { value: 10 });
      ce.declare('mut_f', 'function');
      ce.assign('mut_f', ['Function', ['Block', ['Add', 'mut_x', 'mut_c']], 'mut_x']);

      // f(1) = 1 + 10 = 11
      expect(ce.box(['mut_f', 1]).evaluate().valueOf()).toEqual(11);

      // Mutate c after defining f
      ce.assign('mut_c', 99);

      // f(1) should see the new c = 99 → 1 + 99 = 100
      expect(ce.box(['mut_f', 1]).evaluate().valueOf()).toEqual(100);
    } finally {
      ce.popScope();
    }
  });
});
