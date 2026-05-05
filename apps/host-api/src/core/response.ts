export function ok<T>(data: T, traceId: string | null) {
  return {
    ok: true,
    data,
    error: null,
    traceId
  };
}

export function fail(code: string, message: string, traceId: string | null) {
  return {
    ok: false,
    data: null,
    error: { code, message },
    traceId
  };
}
