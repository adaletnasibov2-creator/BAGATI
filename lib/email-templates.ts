import type { SendMailOptions } from "nodemailer";

export const EMAIL_TEMPLATES = [
  "EMAIL_VERIFICATION",
  "PASSWORD_RESET",
  "WELCOME_CUSTOMER",
  "WELCOME_SELLER",
  "SELLER_APPLICATION_SUBMITTED",
  "SELLER_APPLICATION_APPROVED",
  "SELLER_APPLICATION_REJECTED",
  "STORE_REVIEW",
  "SELLER_NEW_ORDER",
  "CUSTOMER_ORDER_CONFIRMED",
  "ORDER_STATUS",
  "SHIPMENT_UPDATE",
  "SELLER_RETURN_REQUEST",
  "RETURN_STATUS",
  "SELLER_RETURN_STATUS",
  "SUBSCRIPTION_STATUS",
  "ACCOUNT_SECURITY",
  "STORE_INQUIRY",
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];
export type EmailPayload = Record<string, string | number | boolean | null>;

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

const value = (payload: EmailPayload, key: string, fallback = "") => String(payload[key] ?? fallback);
const azn = (payload: EmailPayload, key: string) => {
  const amount = Number(payload[key]);
  return Number.isFinite(amount) ? `${amount.toFixed(2)} AZN` : "—";
};
const orderStatus = (raw: string) => ({
  NEW: "Yeni", PENDING: "Gözləyir", CONFIRMED: "Təsdiqlənib", PREPARING: "Hazırlanır", READY: "Hazırdır",
  HANDED_TO_COURIER: "Kuryerə verilib", PROCESSING: "Emal olunur", SHIPPED: "Göndərilib", DELIVERED: "Çatdırılıb",
  CANCELLED: "Ləğv edilib", RETURNED: "Qaytarılıb",
} as Record<string, string>)[raw] || "Yenilənib";
const returnStatus = (raw: string) => ({
  REQUESTED: "Sorğu yaradılıb", APPROVED: "Təsdiqlənib", REJECTED: "Rədd edilib", ITEM_RECEIVED: "Məhsul qəbul edilib",
  REFUND_PENDING: "Geri ödəniş gözləyir", REFUNDED: "Geri ödəniş tamamlanıb", EXCHANGE_PENDING: "Dəyişdirilmə gözləyir",
  EXCHANGED: "Məhsul dəyişdirilib", CANCELLED: "Ləğv edilib",
} as Record<string, string>)[raw] || "Yenilənib";

function senderDomain(from: string) {
  const address = (from.match(/<([^<>]+)>/)?.[1] ?? from).trim();
  const at = address.lastIndexOf("@");
  const domain = address.slice(at + 1).toLowerCase();
  if (at <= 0 || !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw new Error("Email sender must use a fully qualified domain.");
  }
  return domain;
}

/** A single plain address safe for the Reply-To header (no display name, no CR/LF, no list), or undefined. */
export function safeReplyTo(raw: string): string | undefined {
  const address = raw.trim();
  if (!address || address.length > 254) return undefined;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(address)) return undefined;
  return address;
}

export function buildTransactionalEmail(template: EmailTemplate, payload: EmailPayload, from: string, to: string, messageId: string): SendMailOptions {
  let subject = "BAGATI hesab yeniləməsi";
  let lines: string[] = ["BAGATI marketplace hesabınızda yenilik var."];
  let verificationCode: string | undefined;
  let passwordResetUrl: string | undefined;
  let trackingUrl: string | undefined;
  let replyTo: string | undefined;
  switch (template) {
    case "EMAIL_VERIFICATION":
      verificationCode = value(payload, "code");
      if (!/^\d{6}$/.test(verificationCode)) throw new Error("Invalid verification message payload.");
      subject = "BAGATI — Email təsdiq kodunuz";
      lines = [`Hesabınızı təsdiqləmək üçün kod: ${verificationCode}`, "Kod 10 dəqiqə ərzində qüvvədədir. Təhlükəsizliyiniz üçün bu kodu heç kimlə paylaşmayın."];
      break;
    case "PASSWORD_RESET": {
      passwordResetUrl = value(payload, "resetUrl");
      let parsed: URL;
      try { parsed = new URL(passwordResetUrl); }
      catch { throw new Error("Invalid password reset message payload."); }
      if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
        throw new Error("Invalid password reset message payload.");
      }
      subject = "BAGATI — Şifrənin yenilənməsi";
      lines = ["BAGATI hesabınız üçün şifrə yeniləmə sorğusu aldıq.", "Şifrənizi yeniləmək üçün aşağıdakı keçidi açın. Keçid 30 dəqiqə ərzində yalnız bir dəfə istifadə edilə bilər.", "Bu sorğunu siz etməmisinizsə, məktubu nəzərə almayın."];
      break;
    }
    case "WELCOME_CUSTOMER": subject = "BAGATI-ya xoş gəlmisiniz"; lines = [`Salam ${value(payload, "name", "")},`, "BAGATI hesabınız yaradıldı. Alış-verişinizdə xoş təcrübə arzulayırıq."]; break;
    case "WELCOME_SELLER": subject = "BAGATI satıcı platformasına xoş gəlmisiniz"; lines = [`Salam ${value(payload, "name", "")},`, "Satıcı profiliniz yaradıldı. Mağazanız təsdiqlənənədək satış üçün aktiv olmayacaq."]; break;
    case "SELLER_APPLICATION_SUBMITTED": subject = "Satıcı müraciətiniz qeydə alındı"; lines = ["Satıcı müraciətiniz BAGATI-da qeydə alındı və admin tərəfindən yoxlanılacaq.", "Yoxlama bitənədək hesabınız müştəri hesabı olaraq qalır. Müraciətin statusunu hesabınızda “Satıcı müraciəti” bölməsində görə bilərsiniz."]; break;
    case "SELLER_APPLICATION_APPROVED": subject = "Satıcı müraciətiniz təsdiqləndi"; lines = [`Salam ${value(payload, "displayName", "")},`.replace(" ,", ","), "Satıcı müraciətiniz təsdiqləndi. Hesabınız artıq satıcı hesabıdır.", "Satıcı girişindən daxil olub mağaza qaralamasını yarada bilərsiniz. Mağaza ictimai satış üçün ayrıca admin yoxlamasından keçir."]; break;
    case "SELLER_APPLICATION_REJECTED": subject = "Satıcı müraciəti barədə qərar"; lines = ["Satıcı müraciətiniz rədd edildi.", `Səbəb: ${value(payload, "reason", "Qeyd göstərilməyib")}`, "Hesabınız müştəri hesabı olaraq qalır. Səbəbi aradan qaldırdıqdan sonra yeni müraciət göndərə bilərsiniz."]; break;
    case "STORE_REVIEW": {
      const status = value(payload, "status");
      if (status === "ACTIVE") { subject = "Mağazanız təsdiqləndi"; lines = [`${value(payload, "storeName", "Mağaza")} admin tərəfindən təsdiqləndi.`, "Satış üçün aktiv abunəlik də tələb olunur."]; }
      else if (status === "REJECTED") { subject = "Mağaza müraciəti barədə qərar"; lines = [`${value(payload, "storeName", "Mağaza")} müraciəti rədd edildi.`, `Səbəb: ${value(payload, "reason", "Qeyd göstərilməyib")}`]; }
      else if (status === "SUSPENDED") { subject = "Mağaza fəaliyyəti dayandırıldı"; lines = [`${value(payload, "storeName", "Mağaza")} fəaliyyəti dayandırıldı.`, `Səbəb: ${value(payload, "reason", "Qeyd göstərilməyib")}`]; }
      else { subject = "Mağaza fəaliyyəti bərpa edildi"; lines = [`${value(payload, "storeName", "Mağaza")} yenidən aktivləşdirildi.`]; }
      break;
    }
    case "SELLER_NEW_ORDER": subject = "Mağazanıza yeni sifariş daxil oldu"; lines = [`${value(payload, "storeName", "Mağaza")}: yeni sifariş #${value(payload, "orderRef")}.`, `Mağaza sifarişi: #${value(payload, "storeOrderRef")}`, `Məbləğ: ${azn(payload, "total")}`, "Sifarişə vendor panelindən baxın."]; break;
    case "CUSTOMER_ORDER_CONFIRMED": subject = "Sifarişiniz BAGATI-da qeydə alındı"; lines = [`Sifariş #${value(payload, "orderRef")} yaradıldı.`, `Məbləğ: ${azn(payload, "total")}`, "Sifarişinizin statusu dəyişdikdə sizə məlumat göndəriləcək."]; break;
    case "ORDER_STATUS": subject = "Sifariş statusu yeniləndi"; lines = [`Sifariş #${value(payload, "orderRef")} — ${value(payload, "storeName", "Mağaza")}.`, `Yeni status: ${orderStatus(value(payload, "status"))}.`]; break;
    case "SHIPMENT_UPDATE":
      subject = "Sifarişinizin çatdırılma məlumatı yeniləndi";
      lines = [`Sifariş #${value(payload, "orderRef")} — ${value(payload, "storeName", "Mağaza")}.`, `Göndəriş statusu: ${value(payload, "statusLabel", "Yenilənib")}.`, ...(value(payload, "carrier") ? [`Daşıyıcı: ${value(payload, "carrier")}`] : []), ...(value(payload, "trackingCode") ? [`İzləmə kodu: ${value(payload, "trackingCode")}`] : [])];
      trackingUrl = value(payload, "trackingUrl") || undefined;
      if (trackingUrl && !/^https:\/\//i.test(trackingUrl)) trackingUrl = undefined;
      break;
    case "SELLER_RETURN_REQUEST": subject = "Mağazanıza qaytarılma sorğusu daxil oldu"; lines = [`${value(payload, "productName", "Məhsul")} üçün ${value(payload, "resolution") === "EXCHANGE" ? "dəyişdirilmə" : "geri ödəniş"} sorğusu yaradılıb.`, `Sifariş: #${value(payload, "orderRef")}`, "Sorğunu vendor panelində nəzərdən keçirin."]; break;
    case "RETURN_STATUS": subject = "Qaytarılma sorğusu yeniləndi"; lines = [`${value(payload, "productName", "Məhsul")} sorğusu: ${returnStatus(value(payload, "status"))}.`, ...(value(payload, "resolution") === "REFUND" ? [`Geri ödəniş məbləği: ${azn(payload, "refundAmount")}`] : [])]; break;
    case "SELLER_RETURN_STATUS": subject = "Mağaza qaytarılma sorğusu yeniləndi"; lines = [`${value(payload, "storeName", "Mağaza")} üçün ${value(payload, "productName", "məhsul")} sorğusu: ${returnStatus(value(payload, "status"))}.`, `Sifariş: #${value(payload, "orderRef")}`, ...(value(payload, "resolution") === "REFUND" ? [`Geri ödəniş məbləği: ${azn(payload, "refundAmount")}`] : [])]; break;
    case "SUBSCRIPTION_STATUS": subject = "Mağaza abunəliyinin statusu yeniləndi"; lines = [`${value(payload, "storeName", "Mağaza")} üçün ${value(payload, "planName", "abunəlik")} planının statusu: ${value(payload, "status")}.`, "Abunəlik statusu ödəniş provayderinin təsdiqi kimi qəbul edilmir."]; break;
    case "ACCOUNT_SECURITY": subject = "BAGATI hesabınızda təhlükəsizlik dəyişikliyi"; lines = ["Hesabınızın şifrəsi yeniləndi.", "Bu əməliyyatı siz etməmisinizsə, hesabınıza daxil olun və dəstək xidməti ilə əlaqə saxlayın."]; break;
    case "STORE_INQUIRY": {
      // Buyer text is plain text: every line is HTML-escaped below, and nothing from the buyer reaches a header except a validated Reply-To.
      const storeName = value(payload, "storeName", "Mağaza").slice(0, 120);
      const senderEmail = value(payload, "senderEmail");
      const senderPhone = value(payload, "senderPhone");
      subject = `BAGATI — "${storeName}" mağazası üçün yeni mesaj`.replace(/[\r\n]+/g, " ");
      lines = [
        `"${storeName}" mağazanıza BAGATI-da yeni mesaj gəlib.`,
        `Göndərən: ${value(payload, "senderName", "Alıcı")}`,
        ...(senderEmail ? [`E-poçt: ${senderEmail}`] : []),
        ...(senderPhone ? [`Telefon: ${senderPhone}`] : []),
        "Mesaj:",
        ...value(payload, "message").split(/\r?\n/),
        ...(value(payload, "inboxUrl") ? [`Bütün mesajlar: ${value(payload, "inboxUrl")}`] : []),
        senderEmail ? "Bu məktuba cavab versəniz, cavabınız birbaşa alıcıya gedəcək." : "Alıcı e-poçt qeyd etməyib; telefonla əlaqə saxlayın.",
      ];
      replyTo = safeReplyTo(senderEmail);
      break;
    }
  }
  const htmlLines = lines.map((line) => `<p style="margin:12px 0;font-size:15px;line-height:1.65;color:#344254">${escapeHtml(line)}</p>`).join("");
  const link = trackingUrl ? `<p style="margin:18px 0"><a href="${escapeHtml(trackingUrl)}" rel="noopener noreferrer" style="color:#176b63">Göndərişi izləyin</a></p>` : "";
  const codeHtml = verificationCode ? `<p style="margin:24px 0;padding:18px;text-align:center;border-radius:12px;background:#f7f5ef;color:#0b1726;font-size:32px;font-weight:bold;letter-spacing:8px">${escapeHtml(verificationCode)}</p>` : "";
  const resetLink = passwordResetUrl ? `<p style="margin:18px 0"><a href="${escapeHtml(passwordResetUrl)}" rel="noopener noreferrer" style="color:#176b63">Şifrəni yenilə</a></p>` : "";
  return {
    from, to, subject, text: [...lines, ...(passwordResetUrl ? [passwordResetUrl] : []), ...(trackingUrl ? [trackingUrl] : [])].join("\n\n"),
    html: `<!doctype html><html lang="az"><body style="margin:0;background:#f7f5ef;font-family:Arial,sans-serif;color:#16202c"><main style="max-width:560px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e8e7e2;border-radius:20px"><p style="margin:0;color:#9a701e;font-size:12px;font-weight:bold;letter-spacing:3px">BAGATI</p><h1 style="font-size:23px;margin:24px 0 16px">${escapeHtml(subject)}</h1>${htmlLines}${codeHtml}${resetLink}${link}<p style="margin-top:28px;border-top:1px solid #eee;padding-top:18px;font-size:12px;color:#718096">Bu, BAGATI marketplace tərəfindən göndərilən avtomatik məlumat məktubudur.</p></main></body></html>`,
    messageId: `<${messageId}@${senderDomain(from)}>`,
    ...(replyTo ? { replyTo } : {}),
  };
}
