export type LimitedJsonResult =
  | { ok: true; value: unknown }
  | {
    ok: false;
    status: 400 | 413;
    error: "INVALID_JSON" | "INVALID_UTF8" | "INVALID_CONTENT_LENGTH" | "CONTENT_LENGTH_MISMATCH" | "INCOMPLETE_BODY" | "BODY_READ_FAILED" | "BODY_TOO_LARGE";
  };

export async function readJsonBodyLimited(request: Request, maxBytes: number): Promise<LimitedJsonResult> {
  let declaredBytes: number | null = null;
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false, status: 400, error: "INVALID_CONTENT_LENGTH" };
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes)) {
      return { ok: false, status: 400, error: "INVALID_CONTENT_LENGTH" };
    }
    if (declaredBytes > maxBytes) return { ok: false, status: 413, error: "BODY_TOO_LARGE" };
  }

  if (!request.body) return { ok: false, status: 400, error: "INVALID_JSON" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        try {
          void reader.cancel().catch(() => undefined);
        } catch {
          // The oversize result remains authoritative even if stream cancellation fails.
        }
        return { ok: false, status: 413, error: "BODY_TOO_LARGE" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, error: "BODY_READ_FAILED" };
  } finally {
    reader.releaseLock();
  }

  if (declaredBytes !== null && bytesRead < declaredBytes) {
    return { ok: false, status: 400, error: "INCOMPLETE_BODY" };
  }
  if (declaredBytes !== null && bytesRead > declaredBytes) {
    return { ok: false, status: 400, error: "CONTENT_LENGTH_MISMATCH" };
  }

  const body = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return { ok: false, status: 400, error: "INVALID_UTF8" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status: 400, error: "INVALID_JSON" };
  }
}
