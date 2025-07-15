// Tracks and notifies listeners when a configuration change occurs.
// Uses WeakRef to avoid preventing garbage collection of listeners.
export class ConfigurationChangeTracker {
  // A list of weak references to registered listeners
  private _listeners: WeakRef<ConfigurationChangeListener>[] = new Array(300);
  private _pending = false;
  private _version = 0;

  /**
   * Registers a listener for configuration changes.
   * Returns a function to unsubscribe the listener.
   * Prevents duplicate subscriptions: if the listener is already registered,
   * returns the existing unsubscribe logic without adding a duplicate.
   */
  listen(listener: ConfigurationChangeListener): () => void {
    // Check if the listener is already registered
    for (const ref of this._listeners) {
      const l = ref.deref();
      if (l === listener) {
        // Already registered, return the unsubscribe logic
        return () => this._unsubscribe(listener);
      }
    }

    // Add new listener
    const ref = new WeakRef(listener);
    this._listeners.push(ref);

    return () => this._unsubscribe(listener);
  }

  private _unsubscribe(listener: ConfigurationChangeListener): void {
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
