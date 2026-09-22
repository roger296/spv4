/**
 * Development seed: one account with an owner, a complete warehouse, a few products, an
 * address-book entry and a Royal Mail courier account with placeholder credentials.
 * Idempotent by email. Usage: npx tsx scripts/seed-dev.ts
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDatabase, getDb } from '../src/config/database.js';
import { accounts, addressBook, courierProfiles, users, warehouses } from '../src/db/schema/index.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { ProductsService } from '../src/modules/products/products.service.js';
import { CourierService } from '../src/modules/couriers/courier.service.js';
import { MethodsService } from '../src/modules/methods/methods.service.js';
import { seedBuiltinProfiles } from '../src/couriers/builtin/index.js';
import type { Ctx } from '../src/shared/context.js';

const db = getDb();
await seedBuiltinProfiles();
const email = 'dev@example.test';
let [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
if (!user) {
  const r = await new AuthService().signUp({ companyName: 'Dev Filament Store', name: 'Dev Owner', email, password: 'dev-password-1', country: 'GB' });
  user = r.user;
  console.log(`Created account ${r.account.name} — sign in as ${email} / dev-password-1`);
}
const ctx: Ctx = { accountId: user.accountId, actorKind: 'user', actorId: user.id, actorName: user.name, clientName: 'seed', role: 'OWNER', scopes: ['*'] };
const [w] = await db.select().from(warehouses).where(eq(warehouses.accountId, ctx.accountId)).limit(1);
if (w && !w.line1) await db.update(warehouses).set({ company: 'Dev Filament Store', contactName: 'Dev Owner', line1: '33 Arlington Crescent', city: 'Wilmslow', postCode: 'SK9 6BH', country: 'GB', phone: '01625000000', email, eori: 'GB000000000000' }).where(eq(warehouses.id, w.id));
const products = new ProductsService();
await products.bulkUpsert(ctx, [
  { stockCode: 'PLA-BLK-1KG', name: 'PLA Basic 1.75mm 1kg Black', weight: 1.25, length: 21, width: 21, height: 7, hsCode: '39169090', countryOfOrigin: 'CN', customsDescription: '3D printer filament', unitValue: 18 },
  { stockCode: 'PETG-RED-1KG', name: 'PETG 1.75mm 1kg Red', weight: 1.25, length: 21, width: 21, height: 7, hsCode: '39169090', countryOfOrigin: 'CN', customsDescription: '3D printer filament', unitValue: 21 },
  { stockCode: 'NOZZLE-04', name: 'Brass nozzle 0.4mm' },
]);
const existingAddr = await db.select().from(addressBook).where(eq(addressBook.accountId, ctx.accountId)).limit(1);
if (!existingAddr.length) await db.insert(addressBook).values({ accountId: ctx.accountId, label: 'Mum', contactName: 'Margaret Butterworth', line1: '1 Example Lane', city: 'Macclesfield', postCode: 'SK10 1AA', country: 'GB', phone: '01625111111' });
const couriers = new CourierService();
const existingCa = await couriers.listAccounts(ctx);
if (!existingCa.length) {
  const [rm] = await db.select().from(courierProfiles).where(eq(courierProfiles.key, 'royal-mail-click-and-drop')).limit(1);
  const ca = await couriers.createAccount(ctx, { profileId: rm!.id, name: 'Royal Mail', credentials: { apiKey: 'replace-me' }, sandbox: false });
  const methods = new MethodsService();
  const created = await methods.fromServices(ctx, ca.id, ['TPS', 'TPN']);
  for (const m of created) await methods.setBands(ctx, m.id, [{ minWeightKg: 0, maxWeightKg: 1, cost: m.serviceCode === 'TPN' ? 4.2 : 3.2 }, { minWeightKg: 1, maxWeightKg: 2, cost: m.serviceCode === 'TPN' ? 4.7 : 3.6 }, { minWeightKg: 2, maxWeightKg: 20, cost: m.serviceCode === 'TPN' ? 7.9 : 6.5 }]);
  console.log('Created Royal Mail courier account with placeholder API key and two methods');
}
console.log('Seed complete');
await closeDatabase();
