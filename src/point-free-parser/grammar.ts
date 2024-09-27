import { Combinator, Parser, Result, Rules } from './parsers.ts';
import { parseShebang } from './whitespace-parsers.ts';

export class Grammar<IR> implements Rules {
  private rules: { [name: string]: (Parser) => Result } = {};
  private ruleDescription: { [name: string]: string } = {};
  constructor() {
    this.rule(
      'quoted-text-item',
      'U+0000-U+0009 U+000B-U+000C U+000E-U+0021 U+0023-U+2027 U+202A-U+D7FF | U+E000-U+10FFFF'
    );

    this.rule('linebreak', '(U+000A \\[U+000D\\]) | U+000D | U+2028 | U+2029');

    this.rule('unicode-char', '_quoted-text-item_ | _linebreak_ | U+0022');

    this.rule(
      'pattern-syntax',
      'U+0021-U+002F | U+003A-U+0040 | U+005b-U+005E | U+0060 | U+007b-U+007e | U+00A1-U+00A7 | U+00A9 | U+00AB-U+00AC | U+00AE | U+00B0-U+00B1 | U+00B6 | U+00BB | U+00BF | U+00D7 | U+00F7 | U+2010-U+203E | U+2041-U+2053 | U+2190-U+2775 | U+2794-U+27EF | U+3001-U+3003 | U+3008-U+3020 | U+3030 | U+FD3E | U+FD3F | U+FE45 | U+FE46'
    );

    this.rule('inline-space', 'U+0009 | U+0020');

    this.rule(
      'pattern-whitespace',
      '_inline-space_ | U+000A | U+000B | U+000C | U+000D | U+0085 | U+200E | U+200F | U+2028 | U+2029'
    );

    this.rule(
      'whitespace',
      '_pattern-whitespace_ | U+0000 | U+00A0 | U+1680 | U+180E | U+2000-U+200A | U+202f | U+205f | U+3000'
    );

    this.rule('line-comment', '**`//`** (_unicode-char_)* _linebreak_)');

    this.rule(
      'block-comment',
      '**`/*`** (((_unicode-char_)\\* _linebreak_)) | _block-comment_) **`*/`**'
    );

    this.rule('digit', 'U+0030-U+0039 | U+FF10-U+FF19');

    this.rule(
      'hex-digit',
      '_digit_ | U+0041-U+0046 | U+0061-U+0066 | U+FF21-FF26 | U+FF41-U+FF46'
    );

    this.rule('binary-digit', 'U+0030 | U+0031 | U+FF10 | U+FF11');

    this.rule(
      'numeric-constant',
      '**`NaN`** | **`Infinity`** | **`+Infinity`** | **`-Infinity`**'
    );

    this.rule('base-10-exponent', '(**`e`** | **`E`**) \\[_sign_\\](_digit_)+');
    this.rule('base-2-exponent', '(**`p`** | **`P`**) \\[_sign_\\](_digit_)+');

    this.rule(
      'binary-number',
      '**`0b`** (_binary-digit_)+ \\[**`.`** (_binary-digit_)+ \\]\\[_exponent_\\]'
    );

    this.rule(
      'hexadecimal-number',
      '**`0x`** (_hex-digit_)+ \\[**`.`** (_hex-digit_)+ \\]\\[_exponent_\\]'
    );

    this.rule(
      'decimal-number',
      '(_digit_)+ \\[**`.`** (_digit_)+ \\]\\[_exponent_\\]'
    );

    this.rule('sign', '**`+`** | **`-`**');

    this.rule('symbol', '_verbatim-symbol_ | _inline-symbol_');
    this.rule(
      'verbatim-symbol',
      '**``` ` ```** (_escape-sequence_ | _symbol_start_) (_escape-sequence_ | _symbol_continue_)* **``` ` ```**'
    );
    this.rule('inline-symbol', '_symbol-start_ (_symbol_continue_)*');

    this.rule('escape-expression', '**`\\(`** _expression_ **`)`**');
    this.rule(
      'single-line-string',
      '**`"`** (_escape-sequence_ | _escape-expression_ | _quoted-text-item_)* **`"`**'
    );
    this.rule(
      'multiline-string',
      '**`"""`** _multiline-string-line_ **`"""`**'
    );
    this.rule('extended-string', '...');

    this.rule('shebang', '**`#!`** (unicode-char)* (_linebreak | _eof_)');
    this.rule('shebang', parseShebang);
  }

  /** Define a new rule or a rule description */
  rule<T = IR>(
    name: string,
    def: ((Parser) => Result<T>) | string | Combinator<T>
  ): void {
    if (typeof def === 'string') {
      this.ruleDescription[name] = def;
    } else if (typeof def === 'function') {
      if (!this.ruleDescription[name]) this.ruleDescription[name] = `_${name}_`;
      this.rules[name] = def;
    } else {
      this.ruleDescription[name] = def[0];
      this.rules[name] = def[1];
    }
  }

  toString(): string {
    return Object.keys(this.ruleDescription)
      .map((x) => `_${x}_ → ${this.ruleDescription[x]}`)
      .join('\n\n');
  }

  parse<T = IR>(
    rule: string,
    parser: string | Parser,
    url?: string
  ): Result<T> {
    if (typeof parser === 'string') {
      // We're parsing some new source: create a parser
      parser = new Parser(this, parser, url ?? '');
    }

    // We have a parsing in progress. Return a result of
    // applying the rule to the current state of the parser

    if (!this.has(rule)) throw new Error('Unexpected rule ' + rule);

    return this.rules[rule](parser);
  }
  has(rule: string): boolean {
    return typeof this.rules[rule] === 'function';
  }
  get(rule: string): (Parser) => Result<IR> {
    return this.rules[rule];
  }
}
