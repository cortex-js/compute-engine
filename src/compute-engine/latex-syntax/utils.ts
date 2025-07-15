import { joinLatex } from './tokenizer';
import { DEFINITIONS_INEQUALITIES } from './dictionary/definitions-relational-operators';

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function asLatexString(s: unknown): string | null {
  if (typeof s === 'number') return s.toString();
  if (typeof s === 'string') {
    const str = s.trim();

    if (str.startsWith('$$') && str.endsWith('$$')) return str.slice(2, -2);
    if (str.startsWith('$') && str.endsWith('$')) return str.slice(1, -1);
  }
  if (Array.isArray(s)) {
    // Check after 'string', since a string is also an array...
    return asLatexString(joinLatex(s));
  }
  return null;
}

export function isRelationalOperator(name: string | undefined): boolean {
  if (typeof name !== 'string') return false;
  return DEFINITIONS_INEQUALITIES.some((x) => x.name === name);
}

export function isInequalityOperator(operator: string | undefined): boolean {
  if (typeof operator !== 'string') return false;
  return ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(operator);
}

export function isEquationOperator(operator: string | undefined): boolean {
  if (typeof operator !== 'string') return false;
  return ['Equal', 'NotEqual'].includes(operator);
}
