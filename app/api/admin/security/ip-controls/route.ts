import { NextRequest, NextResponse } from "next/server";
import { csrfRejection } from "@/lib/csrf";
import { isIP } from "node:net";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCloudflareSecurityAdapter } from "@/lib/security-integrations";
import { logSecurityOperationFailure } from "@/lib/security-logging";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  ip: z.string().max(45).refine((value) => isIP(value) !== 0),
  durationMinutes: z.number().int().min(1).max(30 * 24 * 60),
  reason: z.enum(["ABUSIVE_TRAFFIC", "CREDENTIAL_STUFFING", "SCANNER", "OTHER"]),
}).strict();

const removeSchema = z.object({ controlId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();

function unavailable() {
  return NextResponse.json(
    { error: "Cloudflare IP idarəetmə inteqrasiyası qoşulmayıb; trafik bloklanmayıb." },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET() {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur." }, { status: 403 });
  const adapter = getCloudflareSecurityAdapter();
  if (!adapter) return unavailable();

  try {
    return NextResponse.json({ items: await adapter.listTemporaryIpBlocks() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logSecurityOperationFailure("cloudflare_ip_controls_list", error);
    return NextResponse.json({ error: "Cloudflare IP qaydalarını oxumaq mümkün olmadı." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur." }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu formatı yanlışdır." }, { status: 400 }); }
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "IP və blok müddətini yoxlayın." }, { status: 422 });
  const adapter = getCloudflareSecurityAdapter();
  if (!adapter) return unavailable();

  const expiresAt = new Date(Date.now() + parsed.data.durationMinutes * 60_000);
  let item;
  try {
    item = await adapter.createTemporaryIpBlock({ ...parsed.data, expiresAt, actorId: admin.id });
  } catch (error) {
    logSecurityOperationFailure("cloudflare_ip_block_create", error);
    return NextResponse.json({ error: "Cloudflare müvəqqəti IP qaydasını yaratmaq mümkün olmadı." }, { status: 503 });
  }
  try {
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "SECURITY_IP_BLOCK_CREATE",
        entityType: "SecurityIpControl",
        entityId: item.id,
        metadata: { ip: item.ip, expiresAt: item.expiresAt, providerRuleId: item.providerRuleId, reasonCode: parsed.data.reason },
      },
    });
    return NextResponse.json({ item }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logSecurityOperationFailure("cloudflare_ip_block_audit", error);
    return NextResponse.json({ error: "Blok qaydası yaradıldı, lakin audit qeydi yazılmadı; Cloudflare qaydalarını yoxlayın." }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const admin = await requireRole("ADMIN");
  if (!admin) return NextResponse.json({ error: "İcazə yoxdur." }, { status: 403 });
  const crossSite = csrfRejection(request);
  if (crossSite) return crossSite;
  let raw: unknown;
  try { raw = await request.json(); } catch { return NextResponse.json({ error: "Sorğu formatı yanlışdır." }, { status: 400 }); }
  const parsed = removeSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "IP qaydası identifikatoru yanlışdır." }, { status: 422 });
  const adapter = getCloudflareSecurityAdapter();
  if (!adapter) return unavailable();

  try {
    await adapter.removeIpBlock({ controlId: parsed.data.controlId, actorId: admin.id });
  } catch (error) {
    logSecurityOperationFailure("cloudflare_ip_block_remove", error);
    return NextResponse.json({ error: "Cloudflare IP qaydasını ləğv etmək mümkün olmadı." }, { status: 503 });
  }
  try {
    await prisma.auditLog.create({
      data: {
        actorId: admin.id,
        action: "SECURITY_IP_BLOCK_REMOVE",
        entityType: "SecurityIpControl",
        entityId: parsed.data.controlId,
        metadata: { provider: "CLOUDFLARE" },
      },
    });
    return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logSecurityOperationFailure("cloudflare_ip_block_remove_audit", error);
    return NextResponse.json({ error: "Blok qaydası ləğv edildi, lakin audit qeydi yazılmadı; Cloudflare qaydalarını yoxlayın." }, { status: 503 });
  }
}
