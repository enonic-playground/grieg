export type ApiResponse<T> = {
  data: T;
};

export type ApiError = {
  status: number;
  message: string;
  code?: string;
};
