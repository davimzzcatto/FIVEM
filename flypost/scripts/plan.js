// Troca o plano de um usuário: npm run plan -- email@dominio.com pro
import { loadConfig } from '../server/config.js';
import { openDb } from '../server/db.js';
import { PLANS } from '../server/plans.js';

const [email, plan] = process.argv.slice(2);
const db = openDb(loadConfig().dbFile);

if (!email) {
  console.log('Uso: npm run plan -- <email> [plano]\nPlanos:', Object.keys(PLANS).join(', '));
  for (const u of db.all('SELECT email, name, plan FROM users ORDER BY id')) console.log(`  ${u.email.padEnd(32)} ${u.plan.padEnd(8)} ${u.name}`);
  process.exit(0);
}
const user = db.get('SELECT * FROM users WHERE email = ?', email.toLowerCase());
if (!user) {
  console.error(`Usuário ${email} não encontrado.`);
  process.exit(1);
}
if (!plan) {
  console.log(`${user.email}: plano ${user.plan}`);
  process.exit(0);
}
if (!PLANS[plan]) {
  console.error(`Plano "${plan}" não existe. Use: ${Object.keys(PLANS).join(', ')}`);
  process.exit(1);
}
db.run('UPDATE users SET plan = ? WHERE id = ?', plan, user.id);
console.log(`${user.email}: ${user.plan} → ${plan}`);
