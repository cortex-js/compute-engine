/**
 * A subscripted name in a binder position is one new name, also when its
 * base is an indexed collection (Tycho ledger row 410).
 *
 * Outside a binder, a subscript on a symbol declared as an indexed collection
 * is an index: with `n: list<number>`, `n_{0}` is `At(n, 0)`. Before this
 * fix, the parser read a binder spelled that way the same way, so
 * `\sum_{n_{0}=1}^{3}n_{0}` was `Sum(At(n, 0), Tuple(Nothing, 1, 3))`: the
 * sum had no index, and it evaluated to `3·At(n, 0)` instead of `6`. Now a
 * sum or product index, a comprehension variable, a `where` local, a block
 * local, a function parameter, a loop index, a limit, quantifier,
 * integration or differentiation variable spelled `n_{0}` is the name `n_0`,
 * and so are its occurrences in the scope of the binder. The parse is the
 * parse of the same text with `n` undeclared.
 */

import { ComputeEngine } from '../../src/compute-engine';

function engine(declareN = true): ComputeEngine {
  const ce = new ComputeEngine();
  if (declareN) ce.declare('n', 'list<number>');
  return ce;
}

function raw(latex: string, declareN = true): string {
  return JSON.stringify(engine(declareN).parse(latex, { form: 'raw' }).json);
}

function value(latex: string): string {
  return JSON.stringify(engine().parse(latex).evaluate().json);
}

describe('Tycho row 410: a binder spelled as a subscript on a list', () => {
  test('a sum index', () => {
    expect(raw('\\sum_{n_{0}=1}^{3}n_{0}')).toBe(
      '["Sum","n_0",["Tuple","n_0",1,3]]'
    );
    expect(raw('\\sum_{n_0=1}^{3}n_0')).toBe(
      '["Sum","n_0",["Tuple","n_0",1,3]]'
    );
    expect(value('\\sum_{n_{0}=1}^{3}n_{0}')).toBe('6');
    expect(value('\\sum_{n_{0}=1}^{3}n_{0}^{2}')).toBe('14');
    // A subscript after a superscript joins the name, as before it
    expect(value('\\sum_{n_{0}=1}^{3}n^{2}_{0}')).toBe('14');
  });

  test('nested sums over two subscripts of the same list', () => {
    expect(raw('\\sum_{n_{0}=1}^{3}\\sum_{n_{1}=1}^{2}n_{0}n_{1}')).toBe(
      '["Sum",["Sum",["InvisibleOperator","n_0","n_1"],["Tuple","n_1",1,2]],["Tuple","n_0",1,3]]'
    );
    expect(value('\\sum_{n_{0}=1}^{3}\\sum_{n_{1}=1}^{2}n_{0}n_{1}')).toBe(
      '18'
    );
  });

  test('a Greek base', () => {
    const ce = new ComputeEngine();
    ce.declare('alpha', 'list<number>');
    expect(
      JSON.stringify(
        ce.parse('\\sum_{\\alpha_{0}=1}^{3}\\alpha_{0}', { form: 'raw' }).json
      )
    ).toBe('["Sum","alpha_0",["Tuple","alpha_0",1,3]]');
    expect(JSON.stringify(ce.parse('\\alpha_{0}', { form: 'raw' }).json)).toBe(
      '["At","alpha",0]'
    );
  });

  test('a sum index over a set', () => {
    expect(raw('\\sum_{n_{0}\\in\\{1,2\\}}n_{0}')).toBe(
      '["Sum","n_0",["Element","n_0",["Set",1,2]]]'
    );
    expect(value('\\sum_{n_{0}\\in\\{1,2\\}}n_{0}')).toBe('3');
  });

  test('a product index', () => {
    expect(raw('\\prod_{n_{0}=1}^{3}n_{0}')).toBe(
      '["Product","n_0",["Tuple","n_0",1,3]]'
    );
    expect(value('\\prod_{n_{0}=1}^{4}n_{0}')).toBe('24');
  });

  test('a comprehension variable', () => {
    expect(raw('[n_{0}^{2}\\operatorname{for}n_{0}=[1,2,3]]')).toBe(
      '["Comprehension",["Power","n_0",2],["Element","n_0",["List",1,2,3]]]'
    );
  });

  test('a `where` local', () => {
    expect(raw('n_{0}^2\\operatorname{where}n_{0}\\coloneq 3')).toBe(
      '["Block",["Declare","n_0"],["Assign","n_0",3],["Power","n_0",2]]'
    );
    expect(value('n_{0}^2\\operatorname{where}n_{0}\\coloneq 3')).toBe('9');
    // A later binding sees the local
    expect(
      raw('x\\operatorname{where}n_{0}\\coloneq 3, x\\coloneq n_{0}+1')
    ).toBe(
      '["Block",["Declare","n_0"],["Assign","n_0",3],["Declare","x"],["Assign","x",["Add","n_0",1]],"x"]'
    );
  });

  test('a block local', () => {
    expect(raw('n_{0}\\coloneq 3; n_{0}+1')).toBe(
      '["Block",["Declare","n_0"],["Assign","n_0",3],["Add","n_0",1]]'
    );
    expect(value('n_{0}\\coloneq 3; n_{0}+1')).toBe('4');
  });

  test('a function parameter', () => {
    expect(raw('n_{0}\\mapsto n_{0}^2')).toBe(
      '["Function",["Power","n_0",2],"n_0"]'
    );
    expect(raw('(n_{0}, x)\\mapsto n_{0}+x')).toBe(
      '["Function",["Add","n_0","x"],"n_0","x"]'
    );
    expect(raw('f(n_{0})\\coloneq n_{0}^2')).toBe(
      '["Assign","f",["Function",["Power","n_0",2],"n_0"]]'
    );
    expect(raw('f(n_{0}, x)\\coloneq n_{0}+x')).toBe(
      '["Assign","f",["Function",["Add","n_0","x"],"n_0","x"]]'
    );
  });

  test('a loop index', () => {
    expect(
      raw(
        '\\operatorname{for} n_{0} \\operatorname{from} 1 \\operatorname{to} 3 \\operatorname{do} n_{0}'
      )
    ).toBe('["Loop","n_0",["Element","n_0",["Range",1,3]]]');
  });

  test('a limit variable', () => {
    expect(raw('\\lim_{n_{0}\\to 0} n_{0}')).toBe(
      '["Limit",["Function","n_0","n_0"],0]'
    );
  });

  test('a quantified variable', () => {
    expect(raw('\\forall n_{0}, n_{0}>0')).toBe(
      '["ForAll","n_0",["Greater","n_0",0]]'
    );
    expect(raw('\\forall n_{0}\\in\\R, n_{0}^2\\ge 0')).toBe(
      '["ForAll",["Element","n_0","RealNumbers"],["GreaterEqual",["Power","n_0",2],0]]'
    );
  });

  test('an integration variable', () => {
    expect(raw('\\int_0^1 n_{0}\\,dn_{0}')).toBe(
      '["Integrate","n_0",["Tuple","n_0",0,1]]'
    );
    expect(value('\\int_0^1 n_{0}\\,dn_{0}')).toBe('["Rational",1,2]');
    // The differential inside the integrand
    expect(raw('\\int_0^1\\frac{dn_{0}}{n_{0}+1}')).toBe(
      '["Integrate",["Divide",1,["Add","n_0",1]],["Tuple","n_0",0,1]]'
    );
    expect(raw('\\int \\sin 2n_{0}dn_{0}')).toBe(
      '["Integrate",["Sin",["InvisibleOperator",2,"n_0"]],"n_0"]'
    );
  });

  test('a differentiation variable', () => {
    expect(raw('\\frac{d}{dn_{0}} n_{0}^2')).toBe(
      '["D",["Power","n_0",2],"n_0"]'
    );
    expect(raw('\\frac{\\partial}{\\partial n_{0}} n_{0}^2')).toBe(
      '["D",["Power","n_0",2],"n_0"]'
    );
    expect(raw('\\partial_{n_{0}} n_{0}^2')).toBe(
      '["D",["Power","n_0",2],"n_0"]'
    );
    expect(value('\\frac{d}{dn_{0}} n_{0}^2')).toBe('["Multiply",2,"n_0"]');
    // A variable after a `\partial` with an order and no subscript
    expect(raw('\\frac{\\partial^2}{\\partial^2 n_{0}} n_{0}^3')).toBe(
      '["D",["Power","n_0",3],"n_0","n_0"]'
    );
    expect(raw('\\frac{\\partial^3 f}{\\partial^2 n_{0}\\partial y}')).toBe(
      '["D","f","n_0","n_0","y"]'
    );
    // The numerator is the differentiand, not a variable: it is the element
    // `At(n, 0)` unless the denominator differentiates in `n_0`
    expect(raw('\\frac{\\partial n_{0}}{\\partial x}')).toBe(
      '["D",["At","n",0],"x"]'
    );
    expect(raw('\\frac{\\partial n_{0}}{\\partial n_{0}}')).toBe(
      '["D","n_0","n_0"]'
    );
  });

  test('a set-builder variable', () => {
    expect(raw('\\{n_{0} \\mid n_{0}>0\\}')).toBe(
      '["Set","n_0",["Condition",["Greater","n_0",0]]]'
    );
    expect(raw('\\{n_{0}\\in\\Z \\mid n_{0}>0\\}')).toBe(
      '["Set",["Element","n_0","Integers"],["Condition",["Greater","n_0",0]]]'
    );
    // A subscript in the condition on another variable is an index
    expect(raw('\\{x \\mid x>n_{0}\\}')).toBe(
      '["Set","x",["Condition",["Greater","x",["At","n",0]]]]'
    );
  });

  test('a quantifier with a parenthesized body', () => {
    expect(raw('\\forall n_{0}\\in\\R (n_{0}>0)')).toBe(
      '["ForAll",["Element","n_0","RealNumbers"],["Delimiter",["Greater","n_0",0]]]'
    );
  });

  test('an index whose subscript is the index of an inner sum', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'list<number>');
    ce.declare('n', 'list<number>');
    const latex = '\\sum_{m_{n_{0}}=1}^{3}\\sum_{n_{0}=1}^{2} m_{n_{0}}';
    const expected =
      '["Sum",["Sum","m_n_0",["Tuple","n_0",1,2]],["Tuple","m_n_0",1,3]]';
    expect(JSON.stringify(ce.parse(latex, { form: 'raw' }).json)).toBe(
      expected
    );
    expect(raw(latex, false)).toBe(expected);
  });

  test('the `resolveApplication` hook is called in the body of a binder', () => {
    for (const declareN of [true, false]) {
      const heads: string[] = [];
      const expr = engine(declareN).parse('\\sum_{n_{0}=1}^{3} a(n_{0})', {
        form: 'raw',
        resolveApplication: ({ head }) => {
          heads.push(head);
          return 'apply';
        },
      });
      expect(heads).toEqual(['a']);
      expect(JSON.stringify(expr.json)).toBe(
        '["Sum",["a","n_0"],["Tuple","n_0",1,3]]'
      );
    }
  });

  test('the parse is the parse with `n` undeclared', () => {
    for (const latex of [
      '\\sum_{n_{0}=1}^{3}n_{0}',
      '\\prod_{n_{0}=1}^{3}n_{0}',
      '[n_{0}^{2}\\operatorname{for}n_{0}=[1,2,3]]',
      'n_{0}^2\\operatorname{where}n_{0}\\coloneq 3',
      'n_{0}\\coloneq 3; n_{0}+1',
      '(n_{0}\\coloneq 3; n_{0}+1)',
      'n_{0}\\mapsto n_{0}^2',
      'f(n_{0})\\coloneq n_{0}^2',
      '\\lim_{n_{0}\\to 0} n_{0}',
      '\\forall n_{0}, n_{0}>0',
      '\\forall n_{0}\\in\\R (n_{0}>0)',
      '\\int_0^1 n_{0}\\,dn_{0}',
      '\\frac{d}{dn_{0}} n_{0}^2',
      '\\frac{\\partial^2}{\\partial^2 n_{0}} n_{0}^3',
      '\\{n_{0} \\mid n_{0}>0\\}',
      '\\{n_{0} : n_{0}>0\\}',
    ])
      expect(raw(latex)).toBe(raw(latex, false));
  });

  test('with `preserveLatex`, the binder is a symbol', () => {
    const ce = engine();
    const expr = ce.parse('\\sum_{n_{0}=1}^{3}n_{0}', { preserveLatex: true });
    expect(expr.evaluate().json).toBe(6);
  });
});

describe('Tycho row 410: a subscript on a list outside a binder is an index', () => {
  test('a subscript alone', () => {
    expect(raw('n_{0}')).toBe('["At","n",0]');
    expect(raw('n_{0}+1')).toBe('["Add",["At","n",0],1]');
  });

  test('a subscript in the body that is not the index', () => {
    expect(raw('\\sum_{n_{0}=1}^{3}n_{1}')).toBe(
      '["Sum",["At","n",1],["Tuple","n_0",1,3]]'
    );
    expect(raw('\\sum_{k=1}^{3}n_{k}')).toBe(
      '["Sum",["At","n","k"],["Tuple","k",1,3]]'
    );
  });

  test('a subscript in a bound of the index', () => {
    expect(raw('\\sum_{i=n_{0}}^{3}i')).toBe(
      '["Sum","i",["Tuple","i",["At","n",0],3]]'
    );
  });

  test('a subscript in the body of a quantifier over another variable', () => {
    expect(raw('\\forall x, n_{0}>x')).toBe(
      '["ForAll","x",["Greater",["At","n",0],"x"]]'
    );
  });

  test('an integrand with another integration variable', () => {
    expect(raw('\\int_0^1 n_{0}\\,dx')).toBe(
      '["Integrate",["At","n",0],["Tuple","x",0,1]]'
    );
  });

  test('a top-level assignment to a subscript on a list is an error', () => {
    // At the top level, the target of `\coloneq` is not a binder. Read as the
    // name `n_0`, the target would be the term `Subscript(n, 0)` of a
    // sequence definition on the list `n`, which evaluates to `Nothing` and
    // changes nothing. The error makes the failed assignment visible.
    const ce = engine();
    const expr = ce.parse('n_{0}\\coloneq 3');
    expect(JSON.stringify(expr.json)).toContain('expected-a-symbol');
    expect(JSON.stringify(expr.evaluate().json)).toContain('expected-a-symbol');
    expect(JSON.stringify(ce.parse('n_{0}', { form: 'raw' }).json)).toBe(
      '["At","n",0]'
    );

    const ce2 = new ComputeEngine();
    ce2.assign('n', ce2.box(['List', 1, 2, 3]));
    const expr2 = ce2.parse('n_{1}\\coloneq 7');
    expect(JSON.stringify(expr2.evaluate().json)).toContain(
      'expected-a-symbol'
    );
    expect(JSON.stringify(ce2.box('n').evaluate().json)).toBe('["List",1,2,3]');
  });

  test('a declared joined name is still that name', () => {
    const ce = engine();
    ce.declare('n_0', 'number');
    expect(JSON.stringify(ce.parse('n_{0}', { form: 'raw' }).json)).toBe(
      '"n_0"'
    );
  });
});
