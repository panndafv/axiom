// Puts test SOL into the reward pool of the game server running on this machine (ledger mode).
// Usage: node scripts/fund-pool.mjs [sol]    (default 5)
import { config } from '../server/config.js';

const sol = Number(process.argv[2] || 5);
if (!(sol > 0)) {
  console.error('Give the amount in SOL, e.g. node scripts/fund-pool.mjs 5');
  process.exit(1);
}
if (!config.adminKey) {
  console.error('Set ADMIN_KEY in game/.env first (start.bat does this for you), then restart the server.');
  process.exit(1);
}

let res;
try {
  res = await fetch(`http://localhost:${config.port}/api/admin/pool`, {
    method: 'POST',
    headers: { 'x-admin-key': config.adminKey, 'content-type': 'application/json' },
    body: JSON.stringify({ addLamports: Math.round(sol * 1e9) }),
  });
} catch {
  console.error(`The game server isn't running on port ${config.port}. Start it with start.bat (or npm start) first.`);
  process.exit(1);
}
const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`The server refused: ${data.message || res.status}`);
  process.exit(1);
}
console.log(`Added ${sol} SOL of test money. The pool now holds ${(data.availableLamports / 1e9).toFixed(3)} SOL.`);
