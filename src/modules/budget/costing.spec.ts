import { describe, it, expect } from "vitest";
import { ActivityType, DeliveryType } from "@prisma/client";
import { costForActivity, type RateCard } from "./costing";

// The CD rate card used across these cases.
const RATES: RateCard = {
  staff_visit_transport_primary: 50000,
  staff_visit_transport_secondary: 30000,
  lunch: 15000,
  partner_visit_lump_sum: 120000,
  training_session_fee: 200000,
  venue: 150000,
  meals_per_participant: 12000,
  cluster_meeting_cost: 300000,
};

const act = (over: Partial<Parameters<typeof costForActivity>[0]>) => ({
  activityType: ActivityType.school_visit,
  deliveryType: DeliveryType.staff,
  ...over,
});

describe("costForActivity — the automatic costing engine", () => {
  it("staff visit = transport (primary) + lunch", () => {
    const c = costForActivity(act({ activityType: ActivityType.school_visit }), RATES);
    expect(c.amount).toBe(65000);
    expect(c.costMissing).toBe(false);
  });

  it("staff visit in a secondary district uses the secondary transport rate", () => {
    const c = costForActivity(act({ activityType: ActivityType.school_visit, districtType: "secondary" }), RATES);
    expect(c.amount).toBe(30000 + 15000);
  });

  it("partner-delivered work is a lump sum, regardless of activity type", () => {
    const c = costForActivity(act({ activityType: ActivityType.school_visit, deliveryType: DeliveryType.partner }), RATES);
    expect(c.amount).toBe(120000);
  });

  it("staff training = session + venue + meals × participants (default 25)", () => {
    const c = costForActivity(act({ activityType: ActivityType.training }), RATES);
    expect(c.amount).toBe(200000 + 150000 + 12000 * 25);
  });

  it("training meals scale with actual attendance when present", () => {
    const c = costForActivity(act({ activityType: ActivityType.training, teachersAttended: 8, leadersAttended: 2 }), RATES);
    expect(c.amount).toBe(200000 + 150000 + 12000 * 10);
  });

  it("a cluster meeting is the fixed cluster-meeting cost", () => {
    const c = costForActivity(act({ activityType: ActivityType.cluster_meeting }), RATES);
    expect(c.amount).toBe(300000);
  });

  it("a missing rate flags costMissing and contributes 0 (blocks the fund request)", () => {
    const c = costForActivity(act({ activityType: ActivityType.school_visit }), {});
    expect(c.costMissing).toBe(true);
    expect(c.amount).toBe(0);
    expect(c.lines.some((l) => l.missing)).toBe(true);
  });
});
