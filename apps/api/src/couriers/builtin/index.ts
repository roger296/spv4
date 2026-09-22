/**
 * Built-in courier profiles. They use exactly the same definition format as user-built
 * profiles, which is how we prove the format is enough. Seeded into courier_profiles with
 * origin=builtin, review=published, account_id=null; re-seeding bumps the version when the
 * definition changed so shipments keep pointing at the version they used.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../../config/database.js';
import { courierProfiles, type CredentialField, type ServiceDefinition } from '../../db/schema/index.js';
import { parseDefinition, type ProfileDefinitionInput } from '../profile-schema.js';
import { royalMailClickAndDrop } from './royal-mail-click-and-drop.js';
import { dpdUk } from './dpd-uk.js';
import { royalMailProShipping } from './royal-mail-pro-shipping.js';

export interface BuiltinProfile {
  key: string;
  name: string;
  credentialSchema: CredentialField[];
  services: ServiceDefinition[];
  definition: ProfileDefinitionInput;
}

export const BUILTIN_PROFILES: BuiltinProfile[] = [royalMailClickAndDrop, royalMailProShipping, dpdUk];

export async function seedBuiltinProfiles(): Promise<void> {
  const db = getDb();
  for (const p of BUILTIN_PROFILES) {
    const def = parseDefinition(p.definition);
    const [existing] = await db.select().from(courierProfiles).where(and(eq(courierProfiles.key, p.key), eq(courierProfiles.origin, 'builtin'), isNull(courierProfiles.accountId))).limit(1);
    if (!existing) {
      await db.insert(courierProfiles).values({ key: p.key, name: p.name, origin: 'builtin', review: 'published', version: 1, definition: def, credentialSchema: p.credentialSchema, services: p.services, contributorName: 'Smooth Parcel' });
      continue;
    }
    const changed = JSON.stringify(existing.definition) !== JSON.stringify(def) || JSON.stringify(existing.services) !== JSON.stringify(p.services) || JSON.stringify(existing.credentialSchema) !== JSON.stringify(p.credentialSchema) || existing.name !== p.name;
    if (changed) {
      await db.update(courierProfiles).set({ name: p.name, definition: def, services: p.services, credentialSchema: p.credentialSchema, version: existing.version + 1, updatedAt: new Date() }).where(eq(courierProfiles.id, existing.id));
    }
  }
}
