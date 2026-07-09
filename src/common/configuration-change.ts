// Tracks and notifies listeners when a configuration change occurs.
export class ConfigurationChangeTracker {
  // Strong references to registered listeners, kept enumerable so that
  // `notifyNow()` can walk them.
  //
  // NOTE: This deliberately does NOT use `WeakRef`. `new WeakRef(target)`
  // adds `target` to V8's per-job "kept alive" set (ECMAScript
  // AddToKeptObjects), which is only cleared at a microtask checkpoint.
  // Because `listen()` runs on the object-construction path (every constant
  // definition subscribes, and each definition references its engine),
  // wrapping listeners in `WeakRef` pinned every engine built within a single
  // synchronous burst until the job ended — constructing many engines in a
  // tight loop grew the heap by ~430 KB/engine. Holding listeners strongly
  // here is safe because the tracker is owned by the engine and forms a
  // self-contained cycle with it: when the engine becomes unreachable, the
  // tracker and its listeners are collected together.
  private _listeners: ConfigurationChangeListener[] = [];
  // Membership set for O(1) dedup. `listen()` runs on the object-construction
  // path (every new definition subscribes), so a linear "already registered?"
  // scan would make a burst of registrations O(n²).
  private _registered = new WeakSet<ConfigurationChangeListener>();
  private _pending = false;
  private _version = 0;

  /**
   * Registers a listener for configuration changes.
   * Returns a function to unsubscribe the listener.
   * Prevents duplicate subscriptions: if the listener is already registered,
   * returns the existing unsubscribe logic without adding a duplicate.
   */
  listen(listener: ConfigurationChangeListener): () => void {
    // O(1) dedup: only add a listener that is not already registered.
    if (!this._registered.has(listener)) {
      this._registered.add(listener);
      this._listeners.push(listener);
    }

    return () => this._unsubscribe(listener);
  }

  private _unsubscribe(listener: ConfigurationChangeListener): void {
    if (!this._registered.has(listener)) return;
    this._registered.delete(listener);
    this._listeners = this._listeners.filter((l) => l !== listener);
  }

  /**
   * Notifies all live listeners of a configuration change.
   * Also prunes any dead references from the list.
   * Prevents infinite loops from recursive notify() calls.
   */
  notify(): void {
    if (this._pending) return;
    this._pending = true;
    const currentVersion = this._version + 1;
    queueMicrotask(() => {
      // Prevent infinite loops from recursive notify() calls
      if (currentVersion !== this._version + 1) {
        this._pending = false;
        return;
      }
      this.notifyNow();
    });
  }

  /**
   * Immediately notifies all live listeners of a configuration change.
   * Also prunes any dead references from the list.
   * Increments the version and clears the pending flag.
   */
  notifyNow(): void {
    this._version++;
    for (const listener of this._listeners) {
      try {
        listener?.onConfigurationChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Listener error:', err);
      }
    }
    this._pending = false;
  }
}

// Defines an optional method that a listener can implement to respond to configuration changes
export interface ConfigurationChangeListener {
  onConfigurationChange?: () => void;
}
