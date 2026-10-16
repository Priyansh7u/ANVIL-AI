import "server-only";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newGroupCode(): string {
  return Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function newMemberToken(): { token: string; tokenHash: string; memberId: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, tokenHash: hashToken(token), memberId: randomUUID() };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, hash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface FamilyMember {
  memberId: string;
  tokenHash: string;
  displayName: string;
  status: "SAFE" | "NEED_ASSISTANCE" | "NOT_CONFIRMED";
  note: string;
  consentAt: string;
  updatedAt: string;
}

/** Public view: never returns token hashes. */
export function publicMembers(members: FamilyMember[]) {
  return members.map(({ memberId, displayName, status, note, updatedAt }) => ({ memberId, displayName, status, note, updatedAt }));
}
