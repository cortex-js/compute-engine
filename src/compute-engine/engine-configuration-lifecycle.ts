import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import { CACHE_STATS, recordBump } from '../common/cache-stats.js';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

export class EngineConfigurationLifecycle {
  private _generation = 0;
  private _mutationGeneration = 0;
  private _semanticEpoch = 0;
  private _ephemeralWriteDepth = 0;
  private _tracker = new ConfigurationChangeTracker();

  get generation(): number {
    return this._generation;
  }

  set generation(value: number) {
    if (CACHE_STATS && value > this._generation) recordBump('generation');
    this._generation = value;
  }

  get mutationGeneration(): number {
    return this._mutationGeneration;
  }

  set mutationGeneration(value: number) {
    if (CACHE_STATS && value > this._mutationGeneration)
      recordBump('mutationGeneration');
    this._mutationGeneration = value;
  }

  get semanticEpoch(): number {
    return this._semanticEpoch;
  }

  set semanticEpoch(value: number) {
    if (CACHE_STATS && value > this._semanticEpoch)
      recordBump('semanticEpoch');
    this._semanticEpoch = value;
  }

  get ephemeralWriteDepth(): number {
    return this._ephemeralWriteDepth;
  }

  set ephemeralWriteDepth(value: number) {
    this._ephemeralWriteDepth = value;
  }

  reset(hooks: ResetHooks): void {
    if (CACHE_STATS) {
      recordBump('generation');
      recordBump('mutationGeneration');
      recordBump('semanticEpoch');
    }
    this._generation += 1;
    this._mutationGeneration += 1;
    this._semanticEpoch += 1;
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
