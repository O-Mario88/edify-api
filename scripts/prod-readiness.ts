/* eslint-disable no-console */
// Production-readiness gate (security Phase 5). Asserts the backend is safe to
// deploy WITHOUT booting it — suitable for CI / a pre-deploy step. Reuses the
// single source of truth (validateEnv) by evaluating the env AS production, so
// the same rails that guard boot are checked here, plus a few deploy-time
// extras. Exits non-zero on any hard failure.
//
//   npm run prod:check          # evaluate current env as production
//
// In development this is EXPECTED to fail (dev uses ENABLE_MOCK_DATA / a dev
// JWT_SECRET / AUTHZ_MODE=shadow) — that is the gate working. Run it in the
// deploy environment with the real production secrets.
import 'dotenv/config'; // load .env like the app does (CI supplies real env vars)
import { existsSync, accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { validateEnv } from '../src/config/env.validation';

const fails: string[] = [];
const warns: string[] = [];

// 1) Hard rails — reuse validateEnv, forcing NODE_ENV=production.
try {
  validateEnv({ ...process.env, NODE_ENV: 'production' });
} catch (e) {
  for (const line of (e as Error).message.split('\n')) {
    const m = line.trim();
    if (m && !m.endsWith(':')) fails.push(m); // skip the "...:" header line
  }
}

// 2) Deploy-time extras (warnings unless clearly unsafe).
if ((process.env.PARTNER_ROLE_BRIDGE ?? 'true').toLowerCase() !== 'false') {
  warns.push('PARTNER_ROLE_BRIDGE is on — disable it in production once real User<->Partner linkage exists.');
}
const evidenceDir = process.env.EVIDENCE_STORAGE_DIR;
if (!evidenceDir) {
  fails.push('EVIDENCE_STORAGE_DIR must be set in production (a persistent, non-public volume).');
} else {
  const abs = resolve(evidenceDir);
  if (!existsSync(abs)) {
    warns.push(`EVIDENCE_STORAGE_DIR (${abs}) does not exist yet — ensure the volume is mounted at deploy.`);
  } else {
    try { accessSync(abs, constants.W_OK); } catch { fails.push(`EVIDENCE_STORAGE_DIR (${abs}) is not writable.`); }
  }
}
if (/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) {
  warns.push('DATABASE_URL points at localhost — confirm this is the intended production database.');
}

// 3) Report.
console.log('\n  Backend production-readiness');
console.log('  ────────────────────────────');
for (const w of warns) console.log(`  ⚠  ${w}`);
for (const f of fails) console.log(`  ✗  ${f}`);
if (fails.length === 0) {
  console.log('  ✓  All hard production rails pass.\n');
  process.exit(0);
}
console.error(`\n  GATE FAILED: ${fails.length} blocking issue(s). Do not deploy.\n`);
process.exit(1);
