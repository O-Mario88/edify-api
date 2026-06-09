import { describe, it, expect } from "vitest";
import { isValidSalesforceId, salesforcePrefixFor } from "./salesforce-id.util";

describe("Salesforce-ID rules — visits = SV-, trainings = TS-", () => {
  it("accepts a valid SV- id for a visit", () => {
    expect(isValidSalesforceId("SV-401181", "visit")).toBe(true);
  });
  it("accepts a valid TS- id for a training", () => {
    expect(isValidSalesforceId("TS-401181", "training")).toBe(true);
  });
  it("rejects a TS- id submitted as a visit (wrong prefix)", () => {
    expect(isValidSalesforceId("TS-401181", "visit")).toBe(false);
  });
  it("rejects a SV- id submitted as a training", () => {
    expect(isValidSalesforceId("SV-401181", "training")).toBe(false);
  });
  it("rejects an unprefixed / malformed id", () => {
    expect(isValidSalesforceId("401181", "visit")).toBe(false);
    expect(isValidSalesforceId("SV-", "visit")).toBe(false);
  });
  it("exposes the correct prefix per kind", () => {
    expect(salesforcePrefixFor("visit")).toBe("SV-");
    expect(salesforcePrefixFor("training")).toBe("TS-");
  });
});
