import type { Rule } from './types-evaluation';

/**
 * Internal holder for simplification rules and their cache-staleness marker.
 *
 * @internal
 */
export class SimplificationRuleStore {
  private _rules: Rule[];
  private _cachedLength = -1;

  constructor(initialRules: Rule[]) {
    this._rules = initialRules;
  }

  get rules(): Rule[] {
    return this._rules;
  }

  set rules(rules: Rule[]) {
    this._rules = rules;
    this._cachedLength = -1;
  }

  hasMutatedSinceLastCache(): boolean {
    return this._cachedLength >= 0 && this._rules.length !== this._cachedLength;
  }

  markCached(): void {
    this._cachedLength = this._rules.length;
  }
}

