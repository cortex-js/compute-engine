import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change.js';
import {
  CACHE_STATS,
  recordBump,
  bumpShadowCallable,
} from '../common/cache-stats.js';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

export class EngineConfigurationLifecycle {
  private _anyVersion = 0;
  private _semanticVersion = 0;
  private _worldVersion = 0;
  private _ephemeralWriteDepth = 0;
  private _tracker = new ConfigurationChangeTracker();

  get anyVersion(): number {
    return this._anyVersion;
  }

  set anyVersion(value: number) {
    if (CACHE_STATS && value > this._anyVersion) recordBump('generation');
    this._anyVersion = value;
  }

  get semanticVersion(): number {
    return this._semanticVersion;
  }

  set semanticVersion(value: number) {
    if (CACHE_STATS && value > this._semanticVersion)
      recordBump('mutationGeneration');
    this._semanticVersion = value;
  }

  get worldVersion(): number {
    return this._worldVersion;
  }

  set worldVersion(value: number) {
    if (CACHE_STATS && value > this._worldVersion) {
      recordBump('semanticEpoch');
      // Shadow 'callable' axis: every epoch event (assumption, inference,
      // redefine, config, dirty pop) is in its predicate.
      bumpShadowCallable();
    }
    this._worldVersion = value;
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
      bumpShadowCallable();
    }
    this._anyVersion += 1;
    this._semanticVersion += 1;
    this._worldVersion += 1;
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
