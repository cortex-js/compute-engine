import type { Rule } from './types-evaluation.js';

/**
 * Internal holder for a rule array and its cache-staleness marker.
 *
 * Despite its name, this class is rule-agnostic and backs all three
 * engine rule stores: `ce.simplificationRules`, `ce.solveRules` and
 * `ce.harmonizationRules`.
 *
 * Note: mutation detection is length-based, so a same-length in-place
 * element replacement is not detected. Use the property setter (full
 * replacement) for that.
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
