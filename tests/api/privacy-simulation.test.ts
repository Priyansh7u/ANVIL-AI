import { describe, expect, it } from "vitest";
import { hashToken, newGroupCode, newMemberToken, publicMembers, tokenMatches } from "@/lib/family";
import { familyCodeSchema } from "@/lib/validation";

describe("family check-in privacy", () => {
  it("issues codes that pass validation and avoid ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = newGroupCode();
      expect(familyCodeSchema.safeParse(code).success).toBe(true);
      expect(/[IO01]/.test(code)).toBe(false);
    }
  });
  it("stores only token hashes and never exposes them", () => {
    const t = newMemberToken();
    expect(t.tokenHash).toBe(hashToken(t.token));
    expect(tokenMatches(t.token, t.tokenHash)).toBe(true);
    expect(tokenMatches("wrong-token-value-xxxxxxxx", t.tokenHash)).toBe(false);
    const pub = publicMembers([
      { memberId: t.memberId, tokenHash: t.tokenHash, displayName: "Asha", status: "SAFE", note: "", consentAt: "x", updatedAt: "y" },
    ]);
    expect(JSON.stringify(pub)).not.toContain(t.tokenHash);
  });
});

describe("simulated vs live data separation", () => {
  it("simulator API always marks responses as simulated and stores them in their own collection", async () => {
    delete process.env.MONGODB_URI;
    const { POST } = await import("@/app/api/simulator/route");
    const res = await POST(
      new Request("http://localhost/api/simulator", {
        method: "POST",
        body: JSON.stringify({ scenarioId: "riverbend-flood-v1", closedShelterIds: ["S1"], demandMultiplier: 1.5 }),
      }) as never,
    );
    const body = (await res.json()) as { isSimulated: boolean; plan: { isSimulated: boolean } };
    expect(body.isSimulated).toBe(true);
    expect(body.plan.isSimulated).toBe(true);
    const repo = await import("@/lib/repo");
    expect((await repo.find("DisasterAlert", {})).length).toBe(0); // nothing simulated leaks into live alerts
    expect((await repo.find("SimulationSession", {}))[0]?.isSimulated).toBe(true);
  });
});
