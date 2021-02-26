export type CortexErrorCode = 'syntax-error';

export type CortexErrorMessage = {
  code: CortexErrorCode;
  pos: number;
  detail?: string;
};
export type CortexErrorListener = (err: CortexErrorMessage) => void;
