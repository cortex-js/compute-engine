import { ComputeEngine } from '../../../src/compute-engine';
import {
  CORE_DICTIONARY,
  LatexSyntax,
  LATEX_DICTIONARY,
} from '../../../src/latex-syntax';

// An authored `\mathrm{Nothing}` is an operand. The parser also uses the
// symbol `Nothing` as the result of presentational commands such as
// `\displaystyle`, which it skips; it must not skip the authored symbol.

const ce = new ComputeEngine();

function raw(latex: string) {
  return JSON.stringify(ce.parse(latex, { form: 'raw' }).json);
}

describe('AN AUTHORED NOTHING IN A LATEX ARGUMENT LIST', () => {
  test('a Nothing argument in the middle of an argument list is kept', () => {
    expect(raw('\\mathrm{If}(x>1, \\mathrm{Nothing}, x)')).toBe(
      '["If",["Greater","x",1],"Nothing","x"]'
    );
  });

  test('the box route and the parse route give the same expression', () => {
    const parsed = ce.parse('\\mathrm{If}(x>1, \\mathrm{Nothing}, x)');
    const boxed = ce.box(['If', ['Greater', 'x', 1], 'Nothing', 'x']);
    expect(parsed.isSame(boxed)).toBe(true);
  });

  test('a Nothing argument does not break the comma list', () => {
    expect(raw('f(a, \\mathrm{Nothing}, b)')).toBe(raw('f(a,,b)'));
    expect(raw('(a, \\mathrm{Nothing}, b)')).toBe(
      '["Delimiter",["Sequence","a","Nothing","b"],"\'(,)\'"]'
    );
    expect(raw('[a, \\mathrm{Nothing}, b]')).toBe('["List","a","Nothing","b"]');
  });

  test('a Nothing statement before a semicolon is kept', () => {
    expect(raw('\\mathrm{Nothing}; x')).toBe(
      '["Delimiter",["Sequence","Nothing","x"],"\';\'"]'
    );
  });

  test('a Nothing element of a list is erased in the canonical form', () => {
    expect(JSON.stringify(ce.parse('[1, \\mathrm{Nothing}, 2]').json)).toBe(
      '["List",1,2]'
    );
  });

  test('a presentational command is still skipped', () => {
    expect(JSON.stringify(ce.parse('\\displaystyle x + 1').json)).toBe(
      '["Annotated",["Add","x",1],{"dict":{"mathStyle":"normal"}}]'
    );
  });
});

describe('A STYLE SWITCH BEFORE AN INFIX OPERATOR', () => {
  // A style switch after an operand used to read the rest of the group as a
  // new factor: `x \displaystyle + 1` was the product `x·1`.
  test.each([
    ['x \\displaystyle + 1', '["Add","x",1]'],
    ['x \\displaystyle - 1', '["Add","x",-1]'],
    ['x \\large = 2', '["Equal","x",2]'],
    ['x\\textstyle\\times y', '["Multiply","x","y"]'],
  ])('%s', (latex, expected) => {
    expect(JSON.stringify(ce.parse(latex).json)).toBe(expected);
  });

  test('a switch before an operand keeps the style', () => {
    expect(JSON.stringify(ce.parse('x \\large y').json)).toBe(
      '["Multiply","x",["Annotated","y",{"dict":{"size":6}}]]'
    );
  });
});

describe('INVISIBLE BOXES, STRUTS AND SMASH', () => {
  test.each([
    // A phantom whose content spells `Nothing` is still decoration.
    ['\\phantom{\\mathrm{Nothing}} + 1', '1'],
    // The space after a skipped command was an `unexpected-token` error.
    ['\\phantom{y} x', '"x"'],
    ['\\vphantom{\\mathrm{Nothing}} x', '"x"'],
    // A decoration before an infix operator was read as a factor `x·1`.
    ['x\\vphantom{y} + 1', '["Add","x",1]'],
    ['y\\strut + 1', '["Add","y",1]'],
    // The content of `\smash` is part of the math; it was discarded.
    ['\\smash{x}+1', '["Add","x",1]'],
    ['\\smash[b]{x}+1', '["Add","x",1]'],
  ])('%s', (latex, expected) => {
    expect(raw(latex)).toBe(expected);
  });
});

describe('THE BODY OF A STYLE SWITCH', () => {
  test.each([
    // The body ends where the expression that holds the switch ends. Before,
    // it took the rest of the group: `x \displaystyle y + 1` was `x·(y + 1)`.
    [
      'x \\displaystyle y + 1',
      '["Add",["InvisibleOperator","x",["Annotated","y",{"dict":{"mathStyle":"normal"}}]],1]',
    ],
    [
      'f(a, \\displaystyle x, b)',
      '["InvisibleOperator","f",["Delimiter",["Sequence","a",["Annotated","x",{"dict":{"mathStyle":"normal"}}],"b"],"\'(,)\'"]]',
    ],
    // A switch at the start of a group still applies to the whole group.
    [
      '{\\displaystyle x+y}',
      '["Annotated",["Add","x","y"],{"dict":{"mathStyle":"normal"}}]',
    ],
    // Several decorations, `\color` and visual space before an operator.
    ['x \\color{red} + 1', '["Add","x",1]'],
    ['x \\displaystyle\\large + 1', '["Add","x",1]'],
    ['x \\displaystyle \\, + 1', '["Add","x",1]'],
    // An element that is only a decoration is an empty element.
    [
      'f(a, \\phantom{x}, b)',
      '["InvisibleOperator","f",["Delimiter",["Sequence","a","Nothing","b"],"\'(,)\'"]]',
    ],
    [
      'f(a, \\displaystyle, b)',
      '["InvisibleOperator","f",["Delimiter",["Sequence","a","Nothing","b"],"\'(,)\'"]]',
    ],
    // No infix operator after the switch: the style is kept.
    [
      'x \\large \\text{ cm}',
      '["InvisibleOperator","x",["Annotated",["__unit__","cm"],{"dict":{"size":6}}]]',
    ],
  ])('%s', (latex, expected) => {
    expect(raw(latex)).toBe(expected);
  });

  test('2 \\displaystyle \\frac{1}{2} + 1 is 2', () => {
    expect(
      ce.parse('2 \\displaystyle \\frac{1}{2} + 1').evaluate().toString()
    ).toBe('2');
  });
});

describe('THE LOOK-AHEAD OVER A DECORATION', () => {
  // The look-ahead does not parse the content of a phantom, so the left
  // operand context of the infix operator is the one before the phantom.
  test('[0,1]\\phantom{x+y}\\cup[2,3]', () => {
    expect(raw('[0,1]\\phantom{x+y}\\cup[2,3]')).toBe(raw('[0,1]\\cup[2,3]'));
  });

  test('nested phantoms parse in linear time', () => {
    let latex = 'x';
    for (let i = 0; i < 18; i++) latex = `x\\phantom{${latex}}y`;
    const start = Date.now();
    ce.parse(latex, { form: 'raw' });
    // The parse runs in every test run, so an exponential case fails on the
    // jest time limit; the wall-clock bound is checked only in a perf run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('DECORATIONS AND PRECEDENCE, AND IN A MATRIX CELL', () => {
  test.each([
    // The `+` ends the right operand of `\cdot`; the outer level reads it.
    ['a \\cdot b \\displaystyle + c', '["Add",["Multiply","a","b"],"c"]'],
    ['a \\cdot b \\displaystyle - c', '["Subtract",["Multiply","a","b"],"c"]'],
    [
      'x = a \\cdot b \\displaystyle + c',
      '["Equal","x",["Add",["Multiply","a","b"],"c"]]',
    ],
    // A `\text` infix keyword after a switch is an operator.
    ['A \\large \\text{ and } B', '["And","A","B"]'],
    // A cell that is only a phantom is empty, and the row break is kept.
    [
      '\\begin{pmatrix} a & \\phantom{x} \\\\ c & d\\end{pmatrix}',
      '["Matrix",["List",["List","a","Nothing"],["List","c","d"]]]',
    ],
    [
      '\\begin{pmatrix} \\strut & a \\\\ c & d\\end{pmatrix}',
      '["Matrix",["List",["List","Nothing","a"],["List","c","d"]]]',
    ],
  ])('%s', (latex, expected) => {
    expect(raw(latex)).toBe(expected);
  });
});

describe('A DECORATION AT A TERMINATOR, AND KEYWORD CHAINS', () => {
  test('a phantom before a connective does not move it into a quantifier', () => {
    expect(raw('\\forall x, P(x)\\phantom{y}\\land Q(x)')).toBe(
      raw('\\forall x, P(x)\\land Q(x)')
    );
  });

  test('a chain of decorated keywords parses in linear time', () => {
    let latex = 'A';
    for (let i = 0; i < 24; i++) latex += ` \\large \\text{and} A${i}`;
    const start = Date.now();
    ce.parse(latex, { form: 'raw' });
    // The parse runs in every test run, so an exponential case fails on the
    // jest time limit; the wall-clock bound is checked only in a perf run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('A GROUPED NOTHING AND A CUSTOM DICTIONARY', () => {
  test('a Nothing in braces is kept', () => {
    expect(raw('{\\mathrm{Nothing}}; x')).toBe(
      '["Delimiter",["Sequence","Nothing","x"],"\';\'"]'
    );
    expect(raw('f({\\mathrm{Nothing}}, b)')).toBe(
      raw('f(\\mathrm{Nothing}, b)')
    );
  });

  test('a Nothing inside a phantom in braces is still decoration', () => {
    expect(raw('{\\phantom{\\mathrm{Nothing}}} + 1')).toBe('1');
  });

  test('a decoration redefined by a custom dictionary is not skipped', () => {
    const syntax = new LatexSyntax({ dictionary: [...LATEX_DICTIONARY] });
    syntax.addEntries([{ latexTrigger: ['\\strut'], parse: 'S' }]);
    expect(JSON.stringify(syntax.parse('x\\strut+1'))).toBe(
      '["Add",["InvisibleOperator","x","S"],1]'
    );
  });
});

describe('THE MARK OF AN AUTHORED NOTHING, AND A CUSTOM OPERATOR', () => {
  test('a decoration after a Nothing in braces keeps it', () => {
    expect(raw('{\\mathrm{Nothing}\\strut}; x')).toBe(
      raw('{\\mathrm{Nothing}}; x')
    );
    expect(raw('{\\mathrm{Nothing}\\phantom{\\mathrm{Nothing}}}; x')).toBe(
      raw('{\\mathrm{Nothing}}; x')
    );
  });

  test('a decoration redefined as an infix operator is not skipped', () => {
    const syntax = new LatexSyntax({ dictionary: [...LATEX_DICTIONARY] });
    syntax.addEntries([
      {
        latexTrigger: ['\\strut'],
        kind: 'infix',
        precedence: 660,
        parse: 'Divide',
      },
    ]);
    expect(JSON.stringify(syntax.parse('x\\strut 2'))).toBe('["Divide","x",2]');
  });
});

describe('SMASH OF A NOTHING, AND KEYWORD CHAINS WITH PRODUCTS', () => {
  test('a Nothing in a smash is kept', () => {
    expect(raw('f(\\smash{\\mathrm{Nothing}}, b)')).toBe(
      raw('f(\\mathrm{Nothing}, b)')
    );
  });

  test.each([' ', ' \\large '])(
    'a chain of products joined by keywords parses in linear time (%s)',
    (decoration) => {
      let latex = 'a \\cdot b';
      for (let i = 0; i < 30; i++)
        latex += `${decoration}\\text{and} a \\cdot b`;
      const start = Date.now();
      ce.parse(latex, { form: 'raw' });
      // The parse runs in every test run, so an exponential case fails on the
      // jest time limit; the wall-clock bound is checked only in a perf run.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - start).toBeLessThan(2000);
    }
  );

  test('a keyword after a product is still an operator', () => {
    expect(raw('a \\cdot b \\text{ and } c')).toBe(
      '["And",["Multiply","a","b"],"c"]'
    );
  });
});

describe('DEEPLY NESTED PHANTOMS', () => {
  test('400 nested phantoms parse quickly', () => {
    let latex = 'x';
    for (let i = 0; i < 400; i++) latex = `x\\phantom{${latex}}y`;
    const start = Date.now();
    ce.parse(latex, { form: 'raw' });
    // The parse runs in every test run, so an exponential case fails on the
    // jest time limit; the wall-clock bound is checked only in a perf run.
    if (process.env.CE_PERF === '1')
      expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('A CUSTOM PRESENTATIONAL COMMAND', () => {
  test('a Nothing in an argument that a custom command discards is dropped', () => {
    const syntax = new LatexSyntax({ dictionary: [...LATEX_DICTIONARY] });
    syntax.addEntries([
      {
        latexTrigger: ['\\myphantom'],
        parse: (parser) => {
          parser.parseGroup();
          return 'Nothing';
        },
      },
    ]);
    expect(
      JSON.stringify(syntax.parse('\\myphantom{\\mathrm{Nothing}}x'))
    ).toBe('"x"');
  });
});

describe('A NOTHING IN A STYLE SWITCH, AND THE FOR KEYWORD', () => {
  test('a Nothing in the body of a style switch is kept', () => {
    expect(raw('{\\displaystyle\\mathrm{Nothing}}; x')).toBe(
      raw('{\\mathrm{Nothing}}; x')
    );
  });

  test('a switch alone is still decoration', () => {
    expect(raw('{\\displaystyle}; x')).toBe(raw('{}; x'));
  });

  test('the for keyword is read as before', () => {
    expect(raw('x^2 \\text{ for } x \\in S')).toBe(
      '["ForAll",["Element","x","S"],["Power","x",2]]'
    );
  });
});

describe('THE WHERE KEYWORD AND THE SMASH OPTION', () => {
  test('a trailing where without a binding keeps the style switch', () => {
    // The `where` handler declines, so the switch is read as before.
    expect(raw('x \\large \\text{where}')).toBe(
      '["InvisibleOperator","x",["Annotated","\'where\'",{"dict":{"size":6}}]]'
    );
  });

  test('the option of smash is not a symbol', () => {
    expect(raw('\\smash[b]{1}+x')).toBe('["Add",1,"x"]');
  });
});

describe('A DECLINED OPERATOR AFTER A DECORATION, AND A SYMBOL ENTRY', () => {
  test('a decoration before an operator whose handler declines is kept', () => {
    expect(raw('x \\large \\operatorname{where}')).toBe(
      '["InvisibleOperator","x",["Annotated","where",{"dict":{"size":6}}]]'
    );
  });

  test('a symbol entry that returns Nothing is still decoration', () => {
    const core = new LatexSyntax({ dictionary: CORE_DICTIONARY });
    expect(JSON.stringify(core.parse('\\placeholder{}x'))).toBe('"x"');
  });
});

describe('THE RESTORE CHECK AND A CUSTOM SYMBOL ENTRY', () => {
  test('an unrelated keyword entry does not restore a decoration', () => {
    expect(raw('A \\text{and} B \\large \\text{or} C')).toBe(
      raw('A \\text{and} B \\text{or} C')
    );
  });

  test('a custom symbol entry that discards its argument', () => {
    const syntax = new LatexSyntax({ dictionary: [...LATEX_DICTIONARY] });
    syntax.addEntries([
      {
        kind: 'symbol',
        symbolTrigger: 'myphantom',
        latexTrigger: ['\\myphantom'],
        parse: (parser) => {
          parser.parseGroup();
          return 'Nothing';
        },
      },
    ]);
    expect(
      JSON.stringify(syntax.parse('\\myphantom{\\mathrm{Nothing}}x'))
    ).toBe('"x"');
  });
});
