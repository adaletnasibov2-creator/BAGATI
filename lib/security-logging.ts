const prismaCodes = new Set(["P1000", "P1001", "P1002", "P1008", "P1017", "P2002", "P2024", "P2025"]);

export function logSecurityOperationFailure(stage: string, error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: unknown; name?: unknown } : {};
  const code = typeof value.code === "string"
    ? value.code.startsWith("P") && prismaCodes.has(value.code) ? `PRISMA_${value.code}` : "NON_PRISMA"
    : "NO_CODE";
  const errorType = typeof value.name === "string" && /^[A-Za-z]+Error$/.test(value.name) ? value.name : "UnknownError";
  console.error("Security operation failed.", { stage, code, errorType });
}
