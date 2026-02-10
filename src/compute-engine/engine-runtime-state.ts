export class EngineRuntimeState {
  private _timeLimit = 2000;
  private _iterationLimit = 1024;
  private _recursionLimit = 1024;
  private _deadline: number | undefined = undefined;
  private _isVerifying = false;

  get timeLimit(): number {
    return this._timeLimit;
  }

  set timeLimit(value: number) {
    this._timeLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  get iterationLimit(): number {
    return this._iterationLimit;
  }

  set iterationLimit(value: number) {
    this._iterationLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  get recursionLimit(): number {
    return this._recursionLimit;
  }

  set recursionLimit(value: number) {
    this._recursionLimit = value <= 0 ? Number.POSITIVE_INFINITY : value;
  }

  get deadline(): number | undefined {
    return this._deadline;
  }

  set deadline(value: number | undefined) {
    this._deadline = value;
  }

  get timeRemaining(): number {
    if (this._deadline === undefined) return Number.POSITIVE_INFINITY;
    return this._deadline - Date.now();
  }

  get isVerifying(): boolean {
    return this._isVerifying;
  }

  set isVerifying(value: boolean) {
    this._isVerifying = value;
  }

  shouldContinueExecution(): boolean {
    return this._deadline === undefined || this._deadline >= Date.now();
  }
}
