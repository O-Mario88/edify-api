import { plainToInstance } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, validateSync } from 'class-validator';

// Strongly-typed, validated environment. Boot fails fast if misconfigured.
export class EnvVars {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsInt()
  PORT = 4000;

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  JWT_SECRET!: string;

  @IsString()
  JWT_EXPIRES_IN = '12h';

  @IsBoolean()
  ENABLE_MOCK_DATA = false;

  @IsBoolean()
  ENABLE_DEV_ENDPOINTS = false;

  @IsBoolean()
  ENABLE_SALESFORCE_INTEGRATION = false;

  @IsBoolean()
  ENABLE_BACKGROUND_JOBS = false;

  // Object-level authorization enforcement (src/common/authz). `shadow` logs
  // would-be denials without throwing (safe rollout); `enforce` blocks. Prod
  // must run `enforce`.
  @IsIn(['shadow', 'enforce'])
  AUTHZ_MODE: string = 'shadow';

  // When true (default), partner users with no Partner.userId link are bridged
  // to the first active partner (demo seed). Disable in production once real
  // User↔Partner linkage exists.
  @IsBoolean()
  PARTNER_ROLE_BRIDGE = true;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;
}

const toBool = (v: unknown, fallback = false) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());

export function validateEnv(config: Record<string, unknown>) {
  const parsed = plainToInstance(EnvVars, {
    ...config,
    PORT: config.PORT ? Number(config.PORT) : 4000,
    ENABLE_MOCK_DATA: toBool(config.ENABLE_MOCK_DATA),
    ENABLE_DEV_ENDPOINTS: toBool(config.ENABLE_DEV_ENDPOINTS),
    ENABLE_SALESFORCE_INTEGRATION: toBool(config.ENABLE_SALESFORCE_INTEGRATION),
    ENABLE_BACKGROUND_JOBS: toBool(config.ENABLE_BACKGROUND_JOBS),
    AUTHZ_MODE: config.AUTHZ_MODE ?? 'shadow',
    PARTNER_ROLE_BRIDGE: toBool(config.PARTNER_ROLE_BRIDGE, true),
  });
  const errors = validateSync(parsed, { skipMissingProperties: false });
  if (errors.length) {
    throw new Error(`Invalid environment:\n${errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('\n')}`);
  }

  // Production safety rails — collect ALL violations so boot logs (and the
  // prod-readiness gate) report every blocker at once, not one at a time.
  if (parsed.NODE_ENV === 'production') {
    const issues: string[] = [];
    if (parsed.ENABLE_MOCK_DATA) issues.push('ENABLE_MOCK_DATA must be false in production.');
    if (parsed.ENABLE_DEV_ENDPOINTS) issues.push('ENABLE_DEV_ENDPOINTS must be false in production.');
    if (parsed.JWT_SECRET.length < 16 || parsed.JWT_SECRET.includes('change-me') || parsed.JWT_SECRET.includes('dev-only')) {
      issues.push('A strong JWT_SECRET is required in production.');
    }
    if (parsed.AUTHZ_MODE !== 'enforce') {
      issues.push('AUTHZ_MODE must be "enforce" in production (object-level authorization cannot run in shadow).');
    }
    if (issues.length) throw new Error(`Production environment is not safe:\n${issues.join('\n')}`);
  }
  return parsed;
}
