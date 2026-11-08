const fieldLabels: Record<string, string> = {
  email: "E-poçt ünvanını düzgün daxil edin.",
  password: "Şifrə 12–128 simvol olmalıdır.",
  firstName: "Adı yoxlayın.",
  lastName: "Soyadı yoxlayın.",
};

export function registrationErrorMessage(data: unknown, fallback: string) {
  if (!data || typeof data !== "object" || !("details" in data)) return fallback;
  const details = data.details;
  if (!details || typeof details !== "object" || !("fieldErrors" in details)) return fallback;
  const fieldErrors = details.fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== "object") return fallback;
  const errors = Object.keys(fieldErrors).map((field) => fieldLabels[field]).filter(Boolean);
  return errors.length ? errors.join(" ") : fallback;
}
