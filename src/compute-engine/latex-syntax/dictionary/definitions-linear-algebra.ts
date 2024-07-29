import { Expression, op } from '../../../math-json';
import { stringValue, operands } from '../../../math-json/utils';
import { LatexDictionary, Parser, Serializer } from '../public';
import { joinLatex } from '../tokenizer';
import { DELIMITERS_SHORTHAND } from './definitions-core';

export const DEFINITIONS_LINEAR_ALGEBRA: LatexDictionary = [
  // The first argument is the matrix data.
  // The second, optional, argument are the delimiters.
  // The third, optional, argument is the column specification.
  {
    name: 'Matrix',
    serialize: (serializer: Serializer, expr: Expression): string => {
      const rows = operands(op(expr, 1));

      return serializeTabular(
        serializer,
        rows,
        stringValue(op(expr, 2)),
        stringValue(op(expr, 3))
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
        stringValue(op(expr, 2)),
        stringValue(op(expr, 3))
      );
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'pmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '()' }, { str: columns }] as Expression;

      // `pmatrix` is the default environment, so no need to specify the
      // delimiters
      return [head, cells] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'bmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '[]' }, { str: columns }] as Expression;

      return [head, cells, { str: '[]' }] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'Bmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '{}' }, { str: columns }] as Expression;

      return [head, cells, { str: '{}' }] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'vmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '||' }, { str: columns }] as Expression;

      return [head, cells, { str: '||' }] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'Vmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '‖‖' }, { str: columns }] as Expression;

      return [head, cells, { str: '‖‖' }] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'smallmatrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '()' }, { str: columns }] as Expression;

      return [head, cells] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'array',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser, false);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '..' }, { str: columns }] as Expression;

      return [head, cells, { str: '..' }] as Expression;
    },
  },

  {
    kind: 'environment',
    identifierTrigger: 'matrix',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '..' }, { str: columns }] as Expression;

      return [head, cells, { str: '..' }] as Expression;
    },
  },
  {
    kind: 'environment',
    identifierTrigger: 'matrix*',
    parse: (parser: Parser) => {
      const columns = parseColumnFormat(parser);
      const [head, cells] = parseCells(parser);

      if (columns)
        return [head, cells, { str: '..' }, { str: columns }] as Expression;

      return [head, cells, { str: '..' }] as Expression;
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
    name: 'Trace',
    kind: 'function',
    identifierTrigger: 'tr',
  },

  {
    name: 'Determinant',
    kind: 'function',
    identifierTrigger: 'det',
  },
];

function parseCells(parser: Parser): [head: string, cells: Expression | null] {
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

function serializeTabular(
  serializer: Serializer,
  rows: Expression[],
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
