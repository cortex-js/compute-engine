import { Expression } from '../../../math-json';
import { stringValue, operands, operand, operator } from '../../../math-json/utils';
import { LatexDictionary, Parser, Serializer } from '../types';
import { joinLatex } from '../tokenizer';
import { DELIMITERS_SHORTHAND } from './definitions-core';

export const DEFINITIONS_LINEAR_ALGEBRA: LatexDictionary = [
  // The first argument is the matrix data.
  // The second, optional, argument are the delimiters.
  // The third, optional, argument is the column specification.
  {
    name: 'Matrix',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const rows = operands(operand(expr, 1));

      return serializeTabular(
        serializer,
        rows,
        stringValue(operand(expr, 2)),
        stringValue(operand(expr, 3))
      );
    },
  },

  // Vector is a specialized collection to represent a column vector.
  {
    name: 'Vector',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const columns = operands(expr);

      // Flip the columns into rows
      return serializeTabular(
        serializer,
        columns.map((column) => ['List', column]),
        stringValue(operand(expr, 2)),
        stringValue(operand(expr, 3))
      );
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'pmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '()' }, { str: columns }] as Expression;

      // `pmatrix` is the default environment, so no need to specify the
      // delimiters
      return [operator, cells] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'bmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '[]' }, { str: columns }] as Expression;

      return [operator, cells, { str: '[]' }] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'Bmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '{}' }, { str: columns }] as Expression;

      return [operator, cells, { str: '{}' }] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'vmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [op, cells] = parseCells(parser);

      if (columns)
        return ['Determinant', [op, cells, { str: columns }]] as Expression;

      return ['Determinant', [op, cells]] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'Vmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [op, cells] = parseCells(parser);

      if (columns)
        return ['Norm', [op, cells, { str: columns }]] as Expression;

      return ['Norm', [op, cells]] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'smallmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '()' }, { str: columns }] as Expression;

      return [operator, cells] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'array',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser, false);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '..' }, { str: columns }] as Expression;

      return [operator, cells, { str: '..' }] as Expression;
    },
  },

  {
    kind: 'environment',
    symbolTrigger: 'matrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '..' }, { str: columns }] as Expression;

      return [operator, cells, { str: '..' }] as Expression;
    },
  },
  {
    kind: 'environment',
    symbolTrigger: 'matrix*',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [operator, cells] = parseCells(parser);

      if (columns)
        return [operator, cells, { str: '..' }, { str: columns }] as Expression;

      return [operator, cells, { str: '..' }] as Expression;
    },
  },

  {
    name: 'ConjugateTranspose',
    kind: 'postfix',
    latexTrigger: ['^', '\\star'],
  },

  {
    kind: 'postfix',
    latexTrigger: ['^', '\\H'],
    parse: 'ConjugateTranspose',
  },

  {
    kind: 'postfix',
    latexTrigger: ['^', '\\dagger'],
    parse: (_parser: Parser, lhs): Expression => {
      return ['ConjugateTranspose', lhs];
    },
  },

  {
    kind: 'postfix',
    latexTrigger: ['^', '\\ast'],
    parse: (_parser: Parser, lhs): Expression => {
      return ['ConjugateTranspose', lhs];
    },
  },

  {
    kind: 'postfix',
    latexTrigger: ['^', '\\top'],
    parse: (parser: Parser, lhs: Expression): Expression => {
      return ['Transpose', lhs];
    },
  },

  {
    kind: 'postfix',
    latexTrigger: ['^', '\\intercal'],
    parse: (parser: Parser, lhs: Expression): Expression => {
      return ['Transpose', lhs];
    },
  },

  {
    name: 'Transpose',
    kind: 'postfix',
    latexTrigger: ['^', 'T'],
  },

  {
    name: 'PseudoInverse',
    kind: 'postfix',
    latexTrigger: ['^', '+'],
  },

  {
    name: 'Inverse',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializer.serialize(operand(expr, 1)) + '^{-1}',
  },

  {
    name: 'Trace',
    kind: 'function',
    latexTrigger: '\\tr',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializeImplicitOperator(serializer, expr, '\\tr'),
  },

  // Also support plain text: tr(A)
  { symbolTrigger: 'tr', kind: 'function', parse: 'Trace', arguments: 'implicit' },

  {
    name: 'Kernel',
    kind: 'function',
    latexTrigger: '\\ker',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializeImplicitOperator(serializer, expr, '\\ker'),
  },
  { symbolTrigger: 'ker', kind: 'function', parse: 'Kernel', arguments: 'implicit' },

  {
    name: 'Dimension',
    kind: 'function',
    latexTrigger: '\\dim',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializeImplicitOperator(serializer, expr, '\\dim'),
  },
  {
    symbolTrigger: 'dim',
    kind: 'function',
    parse: 'Dimension',
    arguments: 'implicit',
  },

  {
    name: 'Degree',
    kind: 'function',
    latexTrigger: '\\deg',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializeImplicitOperator(serializer, expr, '\\deg'),
  },
  { symbolTrigger: 'deg', kind: 'function', parse: 'Degree', arguments: 'implicit' },

  {
    name: 'Hom',
    kind: 'function',
    latexTrigger: '\\hom',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string =>
      serializeImplicitOperator(serializer, expr, '\\hom'),
  },
  { symbolTrigger: 'hom', kind: 'function', parse: 'Hom', arguments: 'implicit' },

  {
    name: 'Determinant',
    kind: 'function',
    latexTrigger: '\\det',
    arguments: 'implicit',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const arg = operand(expr, 1);
      if (operator(arg) === 'Matrix') {
        // Serialize as vmatrix environment
        const rows = operands(operand(arg, 1));
        return serializeTabular(
          serializer,
          rows,
          '||',
          stringValue(operand(arg, 2))
        );
      }
      return serializeImplicitOperator(serializer, expr, '\\det');
    },
  },

  // Also support plain text: det(A)
  { symbolTrigger: 'det', kind: 'function', parse: 'Determinant', arguments: 'implicit' },

  // MatrixMultiply serializes as multiplication with \cdot
  {
    name: 'MatrixMultiply',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const lhs = serializer.serialize(operand(expr, 1));
      const rhs = serializer.serialize(operand(expr, 2));
      return `${lhs} \\cdot ${rhs}`;
    },
  },
];

function parseCells(
  parser: Parser
): [operator: string, cells: Expression | null] {
  const tabular: Expression[][] | null = parser.parseTabular();
  // @todo tensor: check if it's a vector, Victor.
  if (!tabular) return ['', null];
  return [
    'Matrix',
    [
      'List',
      ...tabular.map((row) => ['List', ...row] as Expression),
    ] as Expression,
  ];
}

function parseColumnFormat(parser: Parser, optional = true): string {
  const colFormat = parser.parseStringGroup(optional)?.trim();
  if (!colFormat) return '';
  let result = '';
  for (const c of colFormat) {
    if (c === 'c') result += '=';
    if (c === 'l') result += '<';
    if (c === 'r') result += '>';
    if (c === '|') result += '|';
    if (c === ':') result += ':';
  }

  return result;
}

function serializeImplicitOperator(
  serializer: Serializer,
  expr: Expression,
  command: string
): string {
  const args = operands(expr);
  if (args.length !== 1) return `${command}${serializer.wrapArguments(expr)}`;
  const arg = operand(expr, 1);
  const argLatex = serializer.serialize(arg);
  // Use \foo A for simple args, \foo\left(...\right) for complex ones
  if (typeof arg === 'string' || typeof arg === 'number')
    return `${command} ${argLatex}`;
  return `${command}\\left(${argLatex}\\right)`;
}

function serializeTabular(
  serializer: Serializer,
  rows: ReadonlyArray<Expression>,
  delims: string | undefined | null,
  colSpec: string | undefined | null
): string {
  delims ??= '()';
  let [open, close] = ['', ''];
  if (typeof delims === 'string' && delims.length === 2) [open, close] = delims;

  let columns = '';
  if (colSpec) {
    for (const c of colSpec) {
      if (c === '<') columns += 'l';
      else if (c === '>') columns += 'r';
      else if (c === '=') columns += 'c';
      else if (c === '|') columns += '|';
      else if (c === ':') columns += ':';
    }
  }

  const serializedRows: string[] = [];
  for (const row of rows ?? []) {
    const cells: string[] = [];
    for (const cell of operands(row)) cells.push(serializer.serialize(cell));
    serializedRows.push(cells.join(' & '));
  }

  const tabular = serializedRows.join('\\\\\n');

  const optColumns = columns.length > 0 ? `[${columns}]` : '';

  if (open === '(' && close === ')')
    return joinLatex([
      '\\begin{pmatrix}',
      optColumns,
      tabular,
      '\\end{pmatrix}',
    ]);

  if (open === '[' && close === ']')
    return joinLatex([
      '\\begin{bmatrix}',
      optColumns,
      tabular,
      '\\end{bmatrix}',
    ]);

  if (open === '{' && close === '}')
    return joinLatex([
      '\\begin{Bmatrix}',
      optColumns,
      tabular,
      '\\end{Bmatrix}',
    ]);

  if (open === '|' && close === '|')
    return joinLatex([
      '\\begin{vmatrix}',
      optColumns,
      tabular,
      '\\end{vmatrix}',
    ]);

  if (open === '‖' && close === '‖')
    return joinLatex([
      '\\begin{Vmatrix}',
      optColumns,
      tabular,
      '\\end{Vmatrix}',
    ]);

  if (open === '{' && close === '.')
    return joinLatex(['\\begin{dcases}', optColumns, tabular, '\\end{dcases}']);

  if (open === '.' && close === '}')
    return joinLatex(['\\begin{rcases}', optColumns, tabular, '\\end{rcases}']);

  if (columns || open !== '.' || close !== '.') {
    return joinLatex([
      '\\left',
      DELIMITERS_SHORTHAND[open] ?? open,
      '\\begin{array}',
      `{${columns}}`,
      tabular,
      '\\end{array}',
      '\\right',
      DELIMITERS_SHORTHAND[close] ?? close,
    ]);
  }

  return joinLatex(['\\begin{matrix}', tabular, '\\end{matrix}']);
}
