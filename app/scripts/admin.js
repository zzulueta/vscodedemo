import 'dotenv/config';
import { configuredStore } from '../lib/store.js';
import { digest, emailAddress } from '../lib/domain.js';

const [emailInput, role = 'admin'] = process.argv.slice(2);
if (!emailInput || !['admin', 'member'].includes(role)) {
  console.error('Usage: npm run admin -- member@example.com [admin|member]');
  process.exit(1);
}
const store = configuredStore();
const email = emailAddress(emailInput);
const profile = await store.get('profiles', digest(email));
if (!profile) {
  console.error('No profile exists for that email. Create the account on the website first, then verify its owner before assigning a role.');
  process.exit(1);
}
await store.replace('profiles', { ...profile, role, sessionVersion: (profile.sessionVersion ?? 0) + 1 });
console.log(`Assigned ${role} role to ${email}. Sign in again to continue.`);