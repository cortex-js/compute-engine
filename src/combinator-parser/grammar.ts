import { Combinator } from './combinators';
import { Parser, Result } from './parsers';

export class Grammar<T> {
  private rules: { [name: string]: Combinator<T> } = {};
  constructor() {
    return;
  }
  //   rule(name: string, def: Combinator<T>): Combinator<T>;
  rule(name: string, def: Combinator<T> | string): Combinator<T> {
    // if (typeof def === 'function') {
    //   this.rules[name] = [name, def];
    //   return [name, def];
    // }
    if (typeof def === 'string') {
      this.rules[name] = [def, undefined];
      return undefined;
    }
    this.rules[name] = def;
    return [`_${name}_`, def[1]];
  }
  toString(): string {
    return Object.keys(this.rules)
      .map((x) => `_${x}_ → ${this.rules[x][0]}`)
      .join('\n\n');
  }
  parse(source: string, rule: string): Result<T> {
    if (!rule || !this.rules[rule] || !this.rules[rule][1]) {
      throw new Error('Unexpected rule');
    }
    return this.rules[rule][1](new Parser(source));
  }
}
