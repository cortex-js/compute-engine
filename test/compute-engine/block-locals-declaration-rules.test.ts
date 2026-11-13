import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { explainErrorCode } from '../../src/epsil/error-explanations';

// The rules of block locals (`docs/ERROR-MODEL.md`): a declaration has a
// value, a local is declared at the own level of a block and an assignment
// writes a declared variable, an assignment is a statement and not an
// operand, and a reassignment keeps the type of the local. Each broken rule
// is a static error in place in the canonical form.

function run(expr: MathJsonExpression): {
  canonical: string;
  type: string;
  value: string;
} {
  const ce = new ComputeEngine();
  const e = ce.box(expr);
  return {
    canonical: e.toString().replace(/\s+/g, ' '),
    type: e.type.toString(),
    value: e.evaluate().toString(),
  };
}

describe('A DECLARATION HAS A VALUE', () => {
  test('a declaration with a value, then an assignment', () => {
    const r = run([
      'Block',
      ['Declare', 'a', "'integer'", 1],
      ['Declare', 'b', "'unknown'", ['Add', 'a', 1]],
      'b',
    ]);
    expect(r.value).toBe('2');
    expect(r.type).toBe('integer');
  });

  test('`Declare(x, type)` then `Assign(x, v)` is not a pair', () => {
    const r = run([
      'Block',
      ['Declare', 'a', "'integer'"],
      ['Assign', 'a', 5],
      'a',
    ]);
    expect(r.type).toBe('error');
    expect(r.value).toBe(
      'Error(ErrorCode("declaration-without-value", "a"))'
    );
  });

  test('a `Declare` with no value at the top level', () => {
    expect(run(['Declare', 'zz']).value).toBe(
      'Error(ErrorCode("declaration-without-value", "zz"))'
    );
  });

  test('the signature of a function defined at the top level of a program needs no value', () => {
    // In a block, the function statement declares the local a second time.
    const r = run([
      'Block',
      ['Declare', 'f', "'(integer) -> integer'"],
      ['DefineFunction', 'f', ['Function', ['Add', 'x', 1], 'x']],
      ['f', 2],
    ]);
    expect(r.type).toBe('error');
    expect(r.canonical).toContain('variable-redeclaration');
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let f: (integer) -> integer; function f(x) { x + 1 }; f(2)'
      ).value.toString()
    ).toBe('3');
  });

  test('a function type with no function definition in the same block', () => {
    // No definition of `f` in the block.
    expect(
      run([
        'Block',
        ['Declare', 'f', "'(integer) -> integer'"],
        ['Assign', 'f', ['Function', ['Add', 'x', 1], 'x']],
        ['f', 2],
      ]).canonical
    ).toContain('ErrorCode("declaration-without-value", "f", "function")');
    // A definition in an enclosing block does not pair with the declaration.
    expect(
      run([
        'Block',
        ['DefineFunction', 'f', ['Function', 'x', 'x']],
        ['Block', ['Declare', 'f', "'(integer) -> integer'"], ['f', 2]],
      ]).canonical
    ).toContain('ErrorCode("declaration-without-value", "f", "function")');
    // The Epsil message names the fix.
    const { diagnostics } = executeEpsil(
      new ComputeEngine(),
      'let f: (integer) -> integer\nf(2)'
    );
    expect(diagnostics.map((d) => d.message[1])).toEqual([
      '`f` is declared without a value: define `f` with a function statement in the same block, or give the declaration a value',
    ]);
    // A declaration of a type that is not a function type stays an error.
    expect(
      executeEpsil(
        new ComputeEngine(),
        'let g: integer\ng = 2'
      ).diagnostics.map((d) => d.message[3])
    ).toEqual(['declaration-without-value']);
  });

  test('the three-operand `Declare` of the `where` clause and of `;`', () => {
    const r = run([
      'Block',
      ['Declare', 'xs', "'unknown'", ['List']],
      ['Assign', 'xs', ['List', 1, 2]],
      'xs',
    ]);
    expect(r.value).toBe('[1,2]');
    expect(r.type).toBe('list<integer>');
  });

  test('the LaTeX `let` declares the local with its value', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\operatorname{let} k \\coloneq 2; k+1', { form: 'raw' }).json
    ).toEqual(['Block', ['Declare', 'k', "'unknown'", 2], ['Add', 'k', 1]]);
    expect(ce.parse('\\operatorname{let} k; k').evaluate().toString()).toBe(
      'Error(ErrorCode("declaration-without-value", "k"))'
    );
  });
});

describe('A LOCAL IS DECLARED AT THE OWN LEVEL OF A BLOCK', () => {
  test('an accumulator declared before a loop', () => {
    const r = run([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ]);
    expect(r.value).toBe('6');
  });

  test('a reassignment in a branch', () => {
    const r = run([
      'Block',
      ['Declare', 'a', "'unknown'", 1],
      ['If', 'True', ['Assign', 'a', 2]],
      'a',
    ]);
    expect(r.value).toBe('2');
  });

  test('an assignment in a branch to a name that is not declared', () => {
    const r = run(['Block', ['If', 'True', ['Assign', 'a', 1]], 'a']);
    expect(r.canonical).toContain(
      'Error(ErrorCode("assignment-to-undeclared-variable", "a"))'
    );
    // A declaration in a branch is below a statement.
    const d = run([
      'Block',
      ['If', 'True', ['Declare', 'a', "'unknown'", 1]],
      'a',
    ]);
    expect(d.canonical).toContain(
      'Error(ErrorCode("declaration-below-statement", "a"))'
    );
  });

  test('a case of a `Match` is a branch', () => {
    const run = (source: string) =>
      executeEpsil(new ComputeEngine(), source).diagnostics.map(
        (d) => d.message[3]
      );
    // An assignment in a case to a name that is not declared.
    expect(
      run('function f(v) {\n match v {\n 1 => do { t = 1 }\n _ => 0\n }\n t\n}\nf(1)')
    ).toEqual(['assignment-to-undeclared-variable']);
    // A reassignment of a local declared before the `Match`, a `let` local
    // of the case, a capture of the pattern, and a local of a function
    // literal in the case are valid.
    for (const source of [
      'function f(v) {\n let t = 0\n match v {\n 1 => do { t = 1 }\n _ => 0\n }\n t\n}\nf(1)',
      'function f(v) {\n match v {\n 1 => do { let u = 2\n u = u + 1\n u }\n _ => 0\n }\n}\nf(1)',
      'function f(v) {\n match v {\n n => do { n = n + 1\n n }\n }\n}\nf(4)',
      'function f(v) {\n let g = (x) => x\n match v {\n 1 => do { g = (x) => do { let w = x\n w }\n g(2) }\n _ => 0\n }\n}\nf(1)',
    ])
      expect(run(source)).toEqual([]);
  });

  test('an assignment in a block of a branch to a name that is not declared', () => {
    const r = run([
      'Block',
      ['If', 'True', ['Block', ['Assign', 'a', 1]]],
      'a',
    ]);
    expect(r.canonical).toContain(
      'Error(ErrorCode("assignment-to-undeclared-variable", "a"))'
    );
    // A declaration at the own level of a block of a branch is valid.
    expect(
      run([
        'Block',
        ['If', 'True', ['Block', ['Declare', 'a', "'unknown'", 1]]],
        'a',
      ]).canonical
    ).not.toContain('Error');
  });

  test('an assignment in a branch at the top level, in MathJSON', () => {
    const error = 'Error(ErrorCode("assignment-to-undeclared-variable", "a"))';
    for (const expr of [
      ['If', 'True', ['Assign', 'a', 1]],
      ['Which', 'True', ['Assign', 'a', 1]],
      ['Loop', ['Assign', 'a', 'i'], ['Element', 'i', ['Range', 1, 3]]],
      ['If', 'True', ['Block', ['Assign', 'a', 1]]],
      ['Match', 1, ['MatchCase', 1, ['Block', ['Assign', 'a', 1]]]],
    ] as MathJsonExpression[]) {
      const r = run(expr);
      expect(r.canonical).toContain(error);
      expect(r.value).toBe(error);
    }
    // An assignment in a branch writes a name that the engine declares.
    for (const declare of [
      (ce: ComputeEngine) => ce.declare('a', 'integer'),
      (ce: ComputeEngine) => ce.assign('a', 5),
      (ce: ComputeEngine) => ce.box(['Assign', 'a', 5]).evaluate(),
    ]) {
      const ce = new ComputeEngine();
      declare(ce);
      const e = ce.box(['If', 'True', ['Assign', 'a', 1]]);
      expect(e.toString()).not.toContain('Error');
      e.evaluate();
      expect(ce.box('a').evaluate().toString()).toBe('1');
    }
    // An assignment in a function literal writes its parameter.
    expect(
      run([
        'Function',
        ['If', ['Greater', 'x', 0], ['Assign', 'x', 1], 'x'],
        'x',
      ]).canonical
    ).not.toContain('Error');
  });

  test('an assignment in a branch at the top level, in Epsil', () => {
    const codes = (source: string) =>
      executeEpsil(new ComputeEngine(), source).diagnostics.map(
        (d) => d.message[3]
      );
    for (const source of [
      'if 1 < 2 { a = 1 }\na',
      'for i in 1..3 { s = i }\ns',
      'while false { w = 1 }\n0',
      'match 1 {\n 1 => do { t = 1 }\n _ => 0\n}\nt',
    ])
      expect(codes(source)).toEqual(['assignment-to-undeclared-variable']);
    // A name declared by an earlier top-level statement is written by an
    // assignment in a branch. A reassignment at the top level keeps the
    // interpreter rules and can change the type.
    for (const [source, value] of [
      ['let c = true\nlet a = 1\nif c { a = 2 }\na', '2'],
      ['let c = false\nlet a = 1\nif c { a = 2 }\na', '1'],
      ['let a = 1\na = "x"\na', '"x"'],
    ]) {
      const r = executeEpsil(new ComputeEngine(), source);
      expect(r.diagnostics).toEqual([]);
      expect(r.value.toString()).toBe(value);
    }
  });

  test('a read before the declaration', () => {
    const r = run([
      'Block',
      ['Declare', 'b', "'unknown'", 'k'],
      ['Declare', 'k', "'integer'", 2],
      'b',
    ]);
    expect(r.value).toBe('Error(ErrorCode("read-before-declaration", "k"))');
  });

  test('the value of a declaration reads the name outside the block', () => {
    // An `Assign` does not declare a local: with no `x` in scope it is an
    // error. The first `:=` of a LaTeX block is a `Declare`, so its value
    // reads the name outside the block.
    const assign = run([
      'Block',
      ['Assign', 'x', ['Add', 'x', 1]],
      ['Multiply', 2, 'x'],
    ]);
    const declare = run([
      'Block',
      ['Declare', 'x', "'unknown'", ['Add', 'x', 1]],
      ['Multiply', 2, 'x'],
    ]);
    expect(assign.canonical).toContain(
      'Error(ErrorCode("assignment-to-undeclared-variable", "x"))'
    );
    expect(declare.canonical).not.toContain('Error');
    const ce = new ComputeEngine();
    expect(ce.parse('x \\coloneq x+1; 2x').evaluate().toString()).toBe(
      declare.value
    );
  });

  test('a read in a function body before the declaration', () => {
    const r = run([
      'Function',
      [
        'Block',
        ['Declare', 'u', "'unknown'", 't'],
        ['Declare', 't', "'unknown'", 'k'],
        'u',
      ],
      'k',
    ]);
    expect(r.canonical).toContain(
      'Error(ErrorCode("read-before-declaration", "t"))'
    );
  });
});

describe('AN ASSIGNMENT IS A STATEMENT', () => {
  test('an assignment as an operand', () => {
    const r = run([
      'Block',
      ['Declare', 'w', "'unknown'", 0],
      ['Declare', 'a', "'unknown'", ['Add', 'q', ['Assign', 'w', 2]]],
      'a',
    ]);
    expect(r.value).toBe('Error(ErrorCode("assignment-in-operand", "w"))');
  });

  test('an assignment as an argument of a call', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('f(a \\coloneq 2)').toString()).toBe(
      'f(Error(ErrorCode("assignment-in-operand", "a")))'
    );
  });

  test('an assignment as the condition of an `If` or a `Which`', () => {
    const ifCondition = run([
      'Block',
      ['Declare', 'flag', "'unknown'", 'False'],
      ['If', ['Assign', 'flag', ['Greater', 'x', 0]], 1, 2],
    ]);
    expect(ifCondition.canonical).toContain(
      'If(Error(ErrorCode("assignment-in-operand", "flag")), 1, 2)'
    );
    const whichCondition = run([
      'Block',
      ['Declare', 'a', "'unknown'", 'False'],
      ['Which', ['Assign', 'a', ['Greater', 'x', 0]], 1, 'True', 2],
    ]);
    expect(whichCondition.canonical).toContain(
      'Which(Error(ErrorCode("assignment-in-operand", "a")), 1'
    );
    // A branch of an `If` and a value of a `Which` are statement positions.
    expect(
      run([
        'Block',
        ['Declare', 'a', "'unknown'", 0],
        ['If', ['Greater', 'x', 0], ['Assign', 'a', 1], ['Assign', 'a', 2]],
        ['Which', ['Greater', 'x', 1], ['Assign', 'a', 3], 'True', 0],
        'a',
      ]).canonical
    ).not.toContain('Error');
  });

  test('an assignment as the indexing set of a `Loop`', () => {
    const r = run([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      ['Declare', 'r', "'unknown'", ['Range', 1, 2]],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'i']],
        ['Element', 'i', ['Assign', 'r', ['Range', 1, 3]]],
      ],
      's',
    ]);
    expect(r.canonical).toContain(
      'Element(i, Error(ErrorCode("assignment-in-operand", "r")))'
    );
  });

  test('a chained assignment is a syntax error', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('a \\coloneq b \\coloneq 3', { form: 'raw' }).json).toEqual(
      ['Assign', 'a', ['Error', "'chained-assignment'"]]
    );
  });

  test('a block whose last statement is an assignment is `Nothing`', () => {
    const r = run([
      'Block',
      ['Declare', 'b', "'unknown'", 0],
      ['Assign', 'b', 2],
    ]);
    expect(r.type).toBe('nothing');
    expect(r.value).toBe('"Nothing"');
  });

  test('the value `Nothing` is kept in a list', () => {
    expect(
      run([
        'List',
        1,
        ['Block', ['Declare', 'b', "'unknown'", 0], ['Assign', 'b', 2]],
      ]).value
    ).toBe('[1,"Nothing"]');
  });

  test('a top-level assignment keeps its value', () => {
    expect(run(['Assign', 'tt', 3]).value).toBe('3');
  });
});

describe('A REASSIGNMENT KEEPS THE TYPE OF THE LOCAL', () => {
  test('a value of another type is a static error', () => {
    const r = run([
      'Block',
      ['Declare', 'a', "'unknown'", 1],
      ['Assign', 'a', "'x'"],
      'a',
    ]);
    expect(r.type).toBe('error');
    expect(r.value).toBe(
      'Error(ErrorCode("assignment-type-mismatch", "a", "number", "string"))'
    );
  });

  test('a number local accepts a real and an expression of type number', () => {
    expect(
      run([
        'Block',
        ['Declare', 's', "'unknown'", 0],
        ['Assign', 's', ['Add', 's', 0.5]],
        's',
      ])
        .value
    ).toBe('0.5');
    expect(
      run([
        'Block',
        ['Declare', 's', "'unknown'", 0],
        ['Assign', 's', ['Add', 's', ['Sqrt', 'x']]],
        's',
      ]).type
    ).toBe('number');
  });

  test('a declared type is the contract', () => {
    const r = run([
      'Block',
      ['Declare', 'n', "'integer'", 0],
      ['Assign', 'n', 0.5],
      'n',
    ]);
    expect(r.value).toBe(
      'Error(ErrorCode("assignment-type-mismatch", "n", "integer", "0.5"))'
    );
  });
});

describe('REVIEW FIXES OF THE RULES OF BLOCK LOCALS', () => {
  const epsil = (source: string) => {
    const r = executeEpsil(new ComputeEngine(), source);
    return {
      value: r.value?.toString(),
      codes: r.diagnostics.map((d) =>
        String(
          d.message[0] === 'static-type-error' ? d.message[3] : d.message[0]
        )
      ),
    };
  };

  test('a value whose type can be the type of the local is accepted', () => {
    // `s + sqrt(x)` is `complex`, which can be real; `m / 2` is `rational`,
    // which can be an integer. Only a disjoint type is refused.
    expect(
      epsil('function h2(x: real) { let s: real = 0; s = s + sqrt(x); s }\nh2(4)')
    ).toEqual({ value: '2', codes: [] });
    expect(
      epsil('function h3(n: integer) { let m: integer = n; m = m / 2; m }\nh3(4)')
    ).toEqual({ value: '2', codes: [] });
    expect(
      run([
        'Block',
        ['Declare', 'a', "'unknown'", 1],
        ['Assign', 'a', "'x'"],
        'a',
      ]).type
    ).toBe('error');
  });

  test('a value of type `unknown` after a declaration with a type does not turn off the check', () => {
    const r = run([
      'Block',
      ['Declare', 'n', "'integer'", 0],
      ['Assign', 'n', ['gg', 'x']],
      ['Assign', 'n', "'x'"],
      'n',
    ]);
    expect(r.type).toBe('error');
    expect(r.canonical).toContain(
      'Error(ErrorCode("assignment-type-mismatch", "n", "integer", "string"))'
    );
  });

  test('an error of a statement under a return type is kept', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    expect(
      ce.box(['Typed', ['Assign', 'n', "'x'"], "'nothing'"]).evaluate().toString()
    ).toBe('Error(ErrorCode("incompatible-type", "integer", "string"), "n")');
  });

  test('each leaf of a destructuring assignment is checked', () => {
    expect(
      epsil('do { let a = 0; let b = 0; (a, b) := ("x", 1); a }').codes
    ).toEqual(['assignment-type-mismatch']);
    expect(
      epsil('do { let a = 0; let b = 0; (a, b) := (2, 1.5); a + b }')
    ).toEqual({ value: '3.5', codes: [] });
  });

  test('a function value is checked against the type of the local', () => {
    expect(
      run([
        'Block',
        ['Declare', 'a', "'unknown'", 1],
        ['Assign', 'a', ['Function', 'x', 'x']],
        'a',
      ])
        .canonical
    ).toContain(
      'Error(ErrorCode("assignment-type-mismatch", "a", "number", "function"))'
    );
    expect(
      epsil('do { let g = (x) => x + 1; g = (x) => x + 2; g(1) }')
    ).toEqual({ value: '3', codes: [] });
  });

  test('a block in a comprehension term or a `Sum` body in a branch declares its locals', () => {
    const comprehension = run([
      'Block',
      ['Declare', 'ys', "'unknown'", ['List']],
      [
        'If',
        'True',
        [
          'Block',
          [
            'Assign',
            'ys',
            [
              'Comprehension',
              [
                'Block',
                ['Declare', 't', "'unknown'", ['Power', 'x', 2]],
                ['Add', 't', 1],
              ],
              ['Element', 'x', ['List', 1, 2, 3]],
            ],
          ],
        ],
      ],
      'ys',
    ]);
    expect(comprehension.canonical).not.toContain('Error');
    expect(comprehension.value).toBe('[2,5,10]');
    const sum = run([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'If',
        'True',
        [
          'Block',
          [
            'Assign',
            's',
            [
              'Sum',
              [
                'Block',
                ['Declare', 't', "'unknown'", ['Power', 'k', 2]],
                ['Add', 't', 1],
              ],
              ['Limits', 'k', 1, 3],
            ],
          ],
        ],
      ],
      's',
    ]);
    expect(sum.canonical).not.toContain('Error');
    expect(sum.value).toBe('17');
  });

  test('a function body that ends in a declaration is typed `nothing`', () => {
    expect(
      run([
        'Apply',
        ['Function', ['Block', ['Declare', 'y', "'unknown'", ['Add', 'k', 1]]], 'k'],
        1,
      ]).type
    ).toBe('nothing');
    // An assignment does not declare a local of the body.
    const assigned = run([
      'Apply',
      ['Function', ['Block', ['Assign', 'y', ['Add', 'k', 1]]], 'k'],
      1,
    ]);
    expect(assigned.type).toBe('error');
    expect(assigned.canonical).toContain(
      'Error(ErrorCode("assignment-to-undeclared-variable", "y"))'
    );
  });

  test('the explanation keeps the initial value of a declaration valid', () => {
    const text = explainErrorCode('read-before-declaration') ?? '';
    expect(text).not.toContain('before it has a value');
    expect(text).toContain('The initializer of a `let` is not such a use');
    expect(epsil('function g(k) { let t = t + 1; t }\ng(1)').codes).toEqual(
      []
    );
  });

  test('a static error does not hide a run-time error with the same code in another statement', () => {
    expect(
      epsil(
        'do { let a = 1; a = "x"; a }\nError(ErrorCode("assignment-type-mismatch", "b", "number", "string"))\n1'
      ).codes
    ).toEqual(['assignment-type-mismatch', 'runtime-error']);
  });
});
