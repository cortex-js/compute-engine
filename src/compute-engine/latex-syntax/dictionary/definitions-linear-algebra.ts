import { Expression, op } from '../../../math-json';
import { stringValue, ops } from '../../../math-json/utils';
import { LatexDictionary, Serializer } from '../public';
import { joinLatex } from '../tokenizer';
import { DELIMITERS_SHORTHAND } from './definitions-core';

export const DEFINITIONS_LINEAR_ALGEBRA: LatexDictionary = [
  // The first argument is the matrix data.
  // The second, optional, argument are the delimiters.
  // The third, optional, argument is the column specification.
  {
    name: 'Matrix',
    // https://ctan.math.illinois.edu/macros/latex/required/tools/array.pdf
    serialize: (serializer: Serializer, expr: Expression): string => {
      const body = op(expr, 1);
      const delims = op(expr, 2) ?? '()';
      let columns = '';
      if (op(expr, 3) !== null) {
        const colsSpec = stringValue(op(expr, 3)) ?? '';
        for (const c of colsSpec) {
          if (c === '<') columns += 'l';
          else if (c === '>') columns += 'r';
          else if (c === '=') columns += 'c';
          else if (c === '|') columns += '|';
          else if (c === ':') columns += ':';
        }
      }

      let [open, close] = ['', ''];
      if (typeof delims === 'string' && delims.length === 2)
        [open, close] = delims;

      const rows: string[] = [];
      for (const row of ops(body) ?? []) {
        const cells: string[] = [];
        for (const cell of ops(row) ?? [])
          cells.push(serializer.serialize(cell));
        rows.push(cells.join(' & '));
      }

      const tabular = rows.join('\\\\\n');

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
        return joinLatex([
          '\\begin{dcases}',
          optColumns,
          tabular,
          '\\end{dcases}',
        ]);

      if (open === '.' && close === '}')
        return joinLatex([
          '\\begin{rcases}',
          optColumns,
          tabular,
          '\\end{rcases}',
        ]);

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
    },
  },
];
