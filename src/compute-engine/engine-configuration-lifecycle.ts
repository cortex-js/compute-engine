import {
  ConfigurationChangeTracker,
  type ConfigurationChangeListener,
} from '../common/configuration-change';

type ResetHooks = {
  refreshNumericConstants: () => void;
  resetCommonSymbols: () => void;
  purgeCaches: () => void;
};

export class EngineConfigurationLifecycle {
  private _generation = 0;
  private _tracker = new ConfigurationChangeTracker();

  get generation(): number {
    return this._generation;
  }

  set generation(value: number) {
    this._generation = value;
  }

  reset(hooks: ResetHooks): void {
    this._generation += 1;
    hooks.refreshNumericConstants();
    hooks.resetCommonSymbols();
    hooks.purgeCaches();
    this._tracker.notifyNow();
  }

  listen(listener: ConfigurationChangeListener): () => void {
    return this._tracker.listen(listener);
  }
}
