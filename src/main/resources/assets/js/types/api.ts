export type ApiResponse<T> = {
  data: T;
};

export type ApiError = {
  status: number;
  message: string;
  code?: string;
  // Set on `INVALID_STEPS`: the step the message is about.
  step?: { index: number; id?: string };
};
