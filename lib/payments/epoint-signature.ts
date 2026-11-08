import { createHash, timingSafeEqual } from "node:crypto";

/** Official Epoint signature: base64(raw SHA1(private_key + data + private_key)). */
export function epointSignature(privateKey: string, data: string) {
  return createHash("sha1").update(`${privateKey}${data}${privateKey}`).digest("base64");
}

export function epointSignaturesMatch(privateKey: string, data: string, signature: string) {
  const expected = Buffer.from(epointSignature(privateKey, data));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function encodeEpointData(payload: string) {
  return Buffer.from(payload, "utf8").toString("base64");
}

export function decodeEpointData(data: string): unknown {
  const json = Buffer.from(data, "base64").toString("utf8");
  return JSON.parse(json);
}
