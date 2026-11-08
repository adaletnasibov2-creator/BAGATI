import type { SecurityEventPayload } from "@/lib/security-event-ingestion";

export type TemporaryIpBlock = {
  id: string;
  ip: string;
  createdAt: string;
  expiresAt: string;
  status: "ACTIVE" | "EXPIRED";
  providerRuleId: string;
};

export interface CloudflareSecurityAdapter {
  listSecurityEvents(input: { cursor?: string; limit: number }): Promise<{
    events: SecurityEventPayload[];
    nextCursor: string | null;
  }>;
  listTemporaryIpBlocks(): Promise<TemporaryIpBlock[]>;
  createTemporaryIpBlock(input: {
    ip: string;
    expiresAt: Date;
    reason: string;
    actorId: string;
  }): Promise<TemporaryIpBlock>;
  removeIpBlock(input: { controlId: string; actorId: string }): Promise<void>;
}

export function getCloudflareSecurityAdapter(): CloudflareSecurityAdapter | null {
  return null;
}

export function securityIntegrationConfiguration() {
  const apacheSecret = process.env.BAGATI_APACHE_INGEST_SECRET;
  const cloudflareRelaySecret = process.env.BAGATI_CLOUDFLARE_INGEST_SECRET;
  return {
    cloudflareApiCredentialsConfigured: Boolean(
      process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN,
    ),
    cloudflareRelaySecretConfigured: Boolean(cloudflareRelaySecret && cloudflareRelaySecret.length >= 32),
    apacheIngestSecretConfigured: Boolean(apacheSecret && apacheSecret.length >= 32),
  };
}
