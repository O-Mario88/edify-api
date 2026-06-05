import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from './permissions';

export const PERMISSIONS_KEY = 'required_permissions';

/** Declare the permission(s) a route requires. The PermissionsGuard enforces. */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);
