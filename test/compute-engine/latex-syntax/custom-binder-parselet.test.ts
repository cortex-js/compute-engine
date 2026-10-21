/**
 * A custom LaTeX dictionary entry that binds a name, written with the public
 * parser methods `binderSymbol()` and `rebindSubscripts()`.
 *
 * Since 0.160.0 a subscripted name in a binder position is a new name also
 * when its base is declared as a list: with `n: list<number>`, `n_{0}` is
 * `At(n, 0)` everywhere else, and a sum index, a comprehension variable or a
 * `where` local spelled `n_{0}` is the symbol `n_0`. The built-in binders use
 * two parser methods for that, which were internal, so a custom clause could
 * not follow the rule (Tycho ledger row 410, the `with` clause of the Desmos
 * importer: with `n` a list, `n_{0} + 1 \operatorname{with} n_{0} = 2` was
 * a parse error, because the clause read its binder with `parseSymbol()`,
 * which cannot read `n_{0}` as a new name).
 *
 * The entry below is the shape of that importer clause: an infix entry whose
 * body is parsed BEFORE the clause, so the body already holds `At(n, 0)`
 * when the binder is read, and `rebindSubscripts()` rewrites it.
 */

import { ComputeEngine } from '../../../src/compute-engine';
import { LatexSyntax, LATEX_DICTIONARY } from '../../../src/latex-syntax';
import type {
  LatexDictionaryEntry,
  Parser,
  Terminator,
} from '../../../src/compute-engine/latex-syntax/types';
import type { MathJsonExpression } from '../../../src/math-json/types';
import { operator, operand } from '../../../src/math-json/utils';

const WITH_PRECEDENCE = 21;

/** `expr \operatorname{with} a = v_1, b = v_2` parses to
 * `Block(Declare(a), Assign(a, v_1), Declare(b), Assign(b, v_2), expr)`. */
const withEntry: LatexDictionaryEntry = {
  symbolTrigger: 'with',
  kind: 'infix',
  associativity: 'none',
  precedence: WITH_PRECEDENCE,
  parse: (
    parser: Parser,
    lhs: MathJsonExpression,
    until: Readonly<Terminator>
  ): MathJsonExpression | null => {
    const bindingTerminator: Terminator = {
      minPrec: WITH_PRECEDENCE,
      condition: (p) => {
        if (until.condition?.(p)) return true;
        const saved = p.index;
        p.skipVisualSpace();
        const isComma = p.peek === ',';
        p.index = saved;
        return isComma;
      },
    };
    const names = new Set<string>();
    const block: MathJsonExpression[] = [];
    do {
      parser.skipVisualSpace();
      // The binding is read as an expression (`Equal(name, value)`): with
      // `n` a list, its left-hand side is the element access `At(n, 0)`,
      // which `binderSymbol()` reads as the new name `n_0`.
      let binding = parser.parseExpression(bindingTerminator);
      if (binding === null || operator(binding) !== 'Equal') return null;
      binding = parser.rebindSubscripts(binding, names);
      const name = parser.binderSymbol(operand(binding, 1));
      const value = operand(binding, 2);
      if (name === null || value === null) return null;
      names.add(name);
      block.push(['Declare', name], ['Assign', name, value]);
      parser.skipVisualSpace();
    } while (parser.match(','));
    if (block.length === 0) return null;
    // The body was parsed before the clause: its `n_{0}` is `At(n, 0)`
    // until it is rebound to the local.
    block.push(parser.rebindSubscripts(lhs, names));
    return ['Block', ...block];
  },
};

function engine(declareList: boolean): ComputeEngine {
  const ce = new ComputeEngine({
    latexSyntax: new LatexSyntax({ dictionary: [...LATEX_DICTIONARY, withEntry] }),
  });
  if (declareList) ce.declare('n', 'list<number>');
  return ce;
}

const LATEX = 'n_{0}+1\\operatorname{with}n_{0}=2';
const EXPECTED = ['Block', ['Declare', 'n_0'], ['Assign', 'n_0', 2], ['Add', 'n_0', 1]];

describe('a custom binder entry with the public parser methods', () => {
  test('the binder is a new name when its base is undeclared', () => {
    const ce = engine(false);
    expect(ce.parse(LATEX, { form: 'raw' }).json).toEqual(EXPECTED);
    expect(ce.parse(LATEX).evaluate().toString()).toBe('3');
  });

  test('the binder is a new name when its base is a list', () => {
    const ce = engine(true);
    expect(ce.parse(LATEX, { form: 'raw' }).json).toEqual(EXPECTED);
    expect(ce.parse(LATEX).evaluate().toString()).toBe('3');
  });

  test('two bindings, the second reading the first', () => {
    const ce = engine(true);
    expect(
      ce
        .parse('n_{0}+n_{1}\\operatorname{with}n_{0}=2,n_{1}=n_{0}+1')
        .evaluate()
        .toString()
    ).toBe('5');
  });

  test('a subscript on the list outside the clause is still an element', () => {
    const ce = engine(true);
    ce.assign('n', ce.parse('[10, 20]'));
    // Indices start at 1: `n_{1}` is the first element.
    expect(ce.parse('n_{1}').evaluate().toString()).toBe('10');
    // `n_0` is the local; `n_{1}` in the body is still the element.
    expect(
      ce.parse('n_{0}+n_{1}\\operatorname{with}n_{0}=2').evaluate().toString()
    ).toBe('12');
  });
});
