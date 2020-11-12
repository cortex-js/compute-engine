import type { Expression, Form } from '../src/public';
import { parseLatex, emitLatex } from '../src/math-json';

export function expression(latex: string, options?: { form: Form }): Expression {
    let errors: string[] = [];
    const result = parseLatex(latex, {
        onError: (err) =>
            errors.push(err.code + (err.arg ? ' ' + err.arg : '')),
        form: options?.form ?? 'canonical',
    });
    errors = errors.filter((x) => !/^unknown-symbol /.test(x));
    if (errors.length !== 0) return [result, ...errors];
    return result;
}

export function latex(expr: Expression): string {
    let errors: string[] = [];
    const result = emitLatex(expr, {
        onError: (err) =>
            errors.push(err.code + (err.arg ? ' ' + err.arg : '')),
    });
    errors = errors.filter((x) => !/^unknown-symbol /.test(x));
    if (errors.length !== 0) return errors.join('\n');
    return result;
}

export function expressionError(latex: string): string | string[] {
    const errors: string[] = [];
    parseLatex(latex, {
        onError: (err) =>
            errors.push(err.code + (err.arg ? ' ' + err.arg : '')),
    });
    return errors.length === 1 ? errors[0] : errors;
}

export function rawExpression(latex: string): Expression {
    return JSON.stringify(
        parseLatex(latex, {
            form: 'full',
            invisibleOperator: '',
            parseArgumentsOfUnknownLatexCommands: false,
            invisiblePlusOperator: '',
            promoteUnknownSymbols: /./,
            dictionary: [],
        })
    );
}

export function printExpression(expr: Expression): string {
    if (Array.isArray(expr)) {
        return '[' + expr.map((x) => printExpression(x)).join(', ') + ']';
    }
    if (typeof expr === 'string') {
        if (!expr) return "''";
        return "'" + expr + "'";
    }
    if (typeof expr === 'object') {
        return (
            '{' +
            Object.keys(expr)
                .map((x) => x + ': ' + printExpression(expr[x]))
                .join(', ') +
            '}'
        );
    }
    return expr.toString();
}