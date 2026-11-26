/**
 * ADMIN-3-TODAY-1 (fix of the bug found in ADMIN-3-SAFETY-1): the city status control on /admin/cities.
 * Before, an active city showed an unticked "Deaktiv et" checkbox: saving it unticked deactivated the city and ticking
 * it kept the city active (the form sent the ticked state as isActive). Now one button does exactly what its label says:
 * it sends the opposite of the current state, as a real boolean (the API schema expects z.boolean()).
 * Labels and texts are existing wording; the deactivation question is the owner-approved text of ADMIN-3-SAFETY-1.
 */
export const CITY_STATUS_TEXT = {
  deactivate: "Deaktiv et",
  activate: "Aktiv et",
  deactivateConfirm: "Şəhəri deaktiv etsəniz, bu şəhərdəki bütün mağazalar saytda görünməyəcək. Davam edək?",
} as const;

/** The button label for a city that is currently active / inactive. */
export function cityStatusButtonLabel(isActive: boolean): string {
  return isActive ? CITY_STATUS_TEXT.deactivate : CITY_STATUS_TEXT.activate;
}

/** The PATCH /api/admin/cities body: the opposite of the current state, as a boolean. */
export function cityStatusPayload(id: string, isActive: boolean): { id: string; isActive: boolean } {
  return { id, isActive: !isActive };
}

/** The question asked first: only when the click deactivates an active city (activating is not asked). */
export function cityStatusConfirm(isActive: boolean): string | null {
  return isActive ? CITY_STATUS_TEXT.deactivateConfirm : null;
}
