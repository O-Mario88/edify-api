import { EdifyRole } from '@prisma/client';

// The authenticated principal attached to every request by the JWT strategy.
export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  roles: EdifyRole[];
  activeRole: EdifyRole;
  staffProfileId?: string;
}
