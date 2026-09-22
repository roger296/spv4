/**
 * Create a platform admin. Usage:
 *   npx tsx scripts/create-admin.ts --email you@example.com --name "Your Name" --password '<password>'
 */
import 'dotenv/config';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { closeDatabase } from '../src/config/database.js';

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i === -1 ? undefined : process.argv[i + 1]; };
const email = arg('email'); const name = arg('name'); const password = arg('password');
if (!email || !name || !password) { console.error('Usage: --email <e> --name <n> --password <p>'); process.exit(2); }
const a = await new AuthService().createAdmin(email, name, password);
console.log(a ? `Admin ${a.email} created` : `Admin ${email} already exists`);
await closeDatabase();
