import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ subject: z.string().trim().min(4).max(160), message: z.string().trim().min(10).max(5000) });
export async function POST(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Dəstək müraciəti üçün giriş edin" }, { status: 401 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Yanlış JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Müraciət məlumatlarını yoxlayın", details: parsed.error.flatten() }, { status: 400 });
  const ticket = await prisma.supportTicket.create({ data: { userId: user.id, ...parsed.data } });
  return NextResponse.json({ ticket: { id: ticket.id, subject: ticket.subject, status: ticket.status, createdAt: ticket.createdAt } }, { status: 201 });
}
