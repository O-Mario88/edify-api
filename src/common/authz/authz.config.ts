// Enforcement mode for the object-level authorization layer.
//
//   shadow  — compute the decision; on DENY do NOT throw. Instead log
//             `authz.deny.shadow` and let the request through. This lets us
//             roll the new object-checks across every endpoint and observe
//             would-be denials against real seeded flows BEFORE blocking
//             anyone — so a mistaken rule surfaces as a log line, never a
//             broken screen.
//   enforce — on DENY, log `authz.deny` and throw ForbiddenException.
//
// Default is `shadow`. Production is required to run `enforce` (asserted by the
// prod-readiness gate, Phase 5, and the env rail in env.validation.ts). The
// flip is a single env var — instantly reversible if a false 403 appears.
export type AuthzMode = 'shadow' | 'enforce';

export function authzMode(): AuthzMode {
  return process.env.AUTHZ_MODE === 'enforce' ? 'enforce' : 'shadow';
}
