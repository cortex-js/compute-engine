// Tracks and notifies listeners when a configuration change occurs.
// Uses WeakRef to avoid preventing garbage collection of listeners.
export class ConfigurationChangeTracker {
  // Weak references to registered listeners. WeakRef lets a listener be
  // garbage-collected (and pruned on the next notification) even if it is
  // never explicitly unsubscribed. The list must stay enumerable so that
  // `notifyNow()` can walk it — a `WeakSet` alone would not work, as it is
  // not iterable.
  private _listeners: WeakRef<ConfigurationChangeListener>[] = [];
  // Membership set for O(1) dedup. `listen()` runs on the object-construction
  // path (every new definition subscribes), so a linear "already registered?"
  // scan would make a burst of registrations O(n²). The WeakSet holds
  // listeners weakly — it never keeps one alive, and a garbage-collected
  // listener drops out of both structures.
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
      this._listeners.push(new WeakRef(listener));
    }

    return () => this._unsubscribe(listener);
  }

  private _unsubscribe(listener: ConfigurationChangeListener): void {
    if (!this._registered.has(listener)) return;
    this._registered.delete(listener);
    this._listeners = this._listeners.filter((r) => {
      const l = r.deref();
      return l !== undefined && l !== listener;
    });
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
    this._listeners = this._listeners.filter((ref) => {
      const listener = ref.deref();
      try {
        listener?.onConfigurationChange?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('Listener error:', err);
      }
      return listener !== undefined;
    });
    this._pending = false;
  }
}

// Defines an optional method that a listener can implement to respond to configuration changes
export interface ConfigurationChangeListener {
  onConfigurationChange?: () => void;
}
