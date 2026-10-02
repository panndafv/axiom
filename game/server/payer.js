// Automatic payouts. With POOL_SECRET_KEY set, the server sends each payout from the pool wallet
// itself, so a player who cashes in a fish gets the SOL (and a Solscan link) straight away.
//
// Never paying twice is the whole job. The transaction's signature, and the last block height
// its blockhash is good for, are saved *before* it is broadcast. A payout is only sent again
// once that transaction can no longer land: the chain is past that height and has no record of
// the signature. Run one server instance (the lobbies need that anyway).

import { config } from './config.js';
import * as pool from './pool.js';
import * as solana from './solana.js';
import { buildTransfer } from './transfer.js';

const CHECK_EVERY_MS = 4_000;
const MAX_ATTEMPTS = 5;

const busy = new Set(); // payout ids being sent right now
let timer = null;
let checking = null;

export function enabled() {
  return config.autoPayouts;
}

// Sends one pending payout. Resolves once the transaction has been handed to the RPC (not once it
// is confirmed) with the payout as players see it. Never throws: anything that goes wrong leaves
// the payout pending, sent or failed for check() to carry on with.
export async function send(id) {
  if (!enabled() || busy.has(id)) return pool.publicPayout(id);
  busy.add(id);
  try {
    const row = pool.getPayout(id);
    if (row?.status !== 'pending') return pool.publicPayout(id);
    if (row.attempts >= MAX_ATTEMPTS) {
      pool.fail(id, `Gave up after ${row.attempts} tries. Send it again from the reward pool.`);
      return pool.publicPayout(id);
    }
    const { blockhash, lastValidBlockHeight } = await solana.latestBlockhash();
    const { signature, wire } = buildTransfer({
      secretKey: config.poolSecretKey,
      to: row.wallet,
      lamports: row.lamports,
      blockhash,
      priorityMicroLamports: config.priorityFeeMicroLamports,
    });
    if (!pool.markSent(id, signature, lastValidBlockHeight)) return pool.publicPayout(id);
    try {
      await solana.sendTransaction(wire);
    } catch (err) {
      rejected(id, signature, err);
    }
  } catch (err) {
    console.warn(`[payer] payout ${id}: ${err.message}`); // e.g. no blockhash: still pending, retried
  } finally {
    busy.delete(id);
  }
  return pool.publicPayout(id);
}

// sendTransaction threw. Only a failed simulation (-32002) proves the transaction never left the
// RPC node; anything else (a timeout, say) may still land, so check() decides later.
function rejected(id, signature, err) {
  if (err.code !== -32002) {
    console.warn(`[payer] payout ${id}: ${err.message} (will check whether it landed)`);
    return;
  }
  const why = err.data?.err;
  if (why === 'BlockhashNotFound') return pool.requeue(id, signature); // the node was behind; try again
  if (why === 'AlreadyProcessed') return; // it is on chain already
  console.warn(`[payer] payout ${id} refused: ${JSON.stringify(why) || err.message}`);
  pool.fail(id, friendlyError(why));
}

function friendlyError(err) {
  const text = JSON.stringify(err) || '';
  if (/InsufficientFundsForRent/.test(text) && /"account_index":1\b/.test(text)) {
    return 'Your wallet needs a little SOL in it (about 0.001) before it can receive a payout this small.';
  }
  if (/InsufficientFunds|Custom":1\b/.test(text)) return 'The reward pool wallet is short of SOL right now. Try again later.';
  return `The network refused the payout (${text.slice(0, 120)}).`;
}

// Moves every unfinished payout along: sends the pending ones, settles the ones that landed, and
// re-queues the ones whose transaction expired without landing.
export function check() {
  if (!enabled()) return Promise.resolve();
  // .finally() always runs after the assignment, even when there is nothing to do.
  checking ||= checkOnce().finally(() => { checking = null; });
  return checking;
}

async function checkOnce() {
  try {
    for (const r of pool.payoutsWithStatus('pending', 20)) await send(r.id);
    const sent = pool.payoutsWithStatus('sent', 100);
    if (!sent.length) return;
    const statuses = await solana.signatureStatuses(sent.map((r) => r.tx));
    let height = null;
    for (const [i, r] of sent.entries()) {
      if (settled(r, statuses[i])) continue;
      if (statuses[i]) continue; // seen but not confirmed yet
      height ??= await solana.blockHeight();
      if (height <= r.last_valid) continue; // can still land
      // Expired. Look further back before sending again, in case it landed right at the end.
      const [old] = await solana.signatureStatuses([r.tx], true);
      if (settled(r, old) || old) continue;
      pool.requeue(r.id, r.tx);
      await send(r.id);
    }
  } catch (err) {
    console.warn(`[payer] check: ${err.message}`);
  }
}

function settled(r, status) {
  const done = status && (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized');
  if (!done) return false;
  if (status.err) {
    pool.fail(r.id, friendlyError(status.err));
  } else if (pool.confirmSent(r.id, r.tx)) {
    solana.forgetSolBalance(config.poolWallet);
  }
  return true;
}

export function start() {
  if (!enabled() || timer) return;
  timer = setInterval(check, CHECK_EVERY_MS);
  timer.unref();
  check();
}

export function stop() {
  clearInterval(timer);
  timer = null;
}
