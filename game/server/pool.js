// The SOL reward pool. All amounts are integer lamports.
//
// ledger mode (no POOL_WALLET): the admin records deposits by hand and `ledger` is what is left
//   to give out. Exchanges take from it.
// wallet mode (POOL_WALLET set): the pool is whatever that wallet holds on-chain, minus what we
//   already owe players (owed) and a small reserve for transaction fees.
//
// `owed` grows when a player exchanges fish and shrinks when an admin marks a payout as paid
// (by then the SOL has left the wallet, so the on-chain balance dropped by the same amount).

import { config } from './config.js';
import { stmt, tx } from './db.js';
import { solBalance } from './solana.js';
import { GameError } from '../shared/engine.js';
import { RARITIES, RARITY_IDS, poolPayout } from '../shared/rules.js';

let onchainLamports = 0; // last known balance of POOL_WALLET

export function mode() {
  return config.poolMode;
}

// Fetches the pool wallet's balance (wallet mode only). Call it before a request that needs
// available(); on failure the last known balance is kept.
export async function refresh() {
  if (mode() !== 'wallet') return;
  try {
    onchainLamports = await solBalance(config.poolWallet);
  } catch (err) {
    console.warn(`[pool] could not read pool wallet balance: ${err.message}`);
  }
}

function row() {
  return stmt('SELECT ledger, owed, paid FROM pool WHERE id = 1').get();
}

// Lamports that can still be handed out. Synchronous so it can run inside a transaction.
export function available() {
  const r = row();
  if (mode() === 'ledger') return Math.max(0, r.ledger);
  return Math.max(0, onchainLamports - r.owed - config.poolReserveLamports);
}

function logEvent(wallet, kind, lamports, meta, now) {
  stmt('INSERT INTO pool_events (at, wallet, kind, lamports, meta) VALUES (?, ?, ?, ?, ?)')
    .run(now, wallet, kind, lamports, meta ? JSON.stringify(meta) : null);
}

export function summary() {
  const r = row();
  const avail = available();
  return {
    mode: mode(),
    wallet: config.poolWallet || null,
    availableLamports: avail,
    owedLamports: r.owed,
    paidLamports: r.paid,
    dailyCapPct: config.poolDailyCapPct,
    minHoldUsd: config.minHoldUsd,
    earnGate: config.earnGate,
    rarities: RARITY_IDS.map((id) => ({
      id,
      label: RARITIES[id].label,
      color: RARITIES[id].color,
      poolPct: RARITIES[id].poolPct,
      lamportsPerFish: poolPayout(id, avail),
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Bookkeeping. These run inside the caller's transaction (the same one that changes the profile).

export function recordExchange(wallet, result, now = Date.now()) {
  const { total, items } = result;
  if (mode() === 'ledger') {
    stmt('UPDATE pool SET ledger = ledger - ?, owed = owed + ? WHERE id = 1').run(total, total);
  } else {
    stmt('UPDATE pool SET owed = owed + ? WHERE id = 1').run(total);
  }
  logEvent(wallet, 'exchange', total, { items }, now);
}

export function recordClaim(wallet, lamports, now = Date.now()) {
  const { lastInsertRowid } = stmt('INSERT INTO payouts (wallet, lamports, status, created) VALUES (?, ?, ?, ?)')
    .run(wallet, lamports, 'pending', now);
  const id = Number(lastInsertRowid);
  logEvent(wallet, 'claim', lamports, { payoutId: id }, now);
  return { id, lamports, status: 'pending' };
}

// ---------------------------------------------------------------------------------------------
// Payouts

function payoutJson(r) {
  return { id: r.id, lamports: r.lamports, status: r.status, created: r.created, paidAt: r.paid_at, tx: r.tx };
}

export function payoutsFor(wallet, limit = 20) {
  return stmt('SELECT * FROM payouts WHERE wallet = ? ORDER BY id DESC LIMIT ?').all(wallet, limit).map(payoutJson);
}

// ---------------------------------------------------------------------------------------------
// Admin

// Oldest first when filtering by status, so pending payouts come out in the order to pay them.
export function listPayouts(status, limit = 200) {
  const rows = status
    ? stmt('SELECT * FROM payouts WHERE status = ? ORDER BY id ASC LIMIT ?').all(status, limit)
    : stmt('SELECT * FROM payouts ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map((r) => ({ ...payoutJson(r), wallet: r.wallet }));
}

export function markPaid(id, txSig, now = Date.now()) {
  return tx(() => {
    const p = stmt('SELECT * FROM payouts WHERE id = ?').get(id);
    if (!p) throw new GameError('not_found', 'No such payout.', 404);
    if (p.status !== 'pending') throw new GameError('not_pending', `That payout is already ${p.status}.`, 409);
    stmt("UPDATE payouts SET status = 'paid', tx = ?, paid_at = ? WHERE id = ?").run(txSig, now, id);
    stmt('UPDATE pool SET owed = owed - ?, paid = paid + ? WHERE id = 1').run(p.lamports, p.lamports);
    logEvent(p.wallet, 'paid', p.lamports, { payoutId: id, tx: txSig }, now);
    return { ...payoutJson(stmt('SELECT * FROM payouts WHERE id = ?').get(id)), wallet: p.wallet };
  });
}

// Ledger mode only. A negative amount takes funds back out (to fix a mistake), but never below 0.
export function deposit(lamports, now = Date.now()) {
  if (mode() !== 'ledger') {
    throw new GameError('wallet_mode', 'The pool is funded on-chain (POOL_WALLET is set); send SOL to that wallet instead.', 409);
  }
  return tx(() => {
    const r = row();
    if (r.ledger + lamports < 0) throw new GameError('too_much', 'That would take the ledger below zero.', 400);
    stmt('UPDATE pool SET ledger = ledger + ? WHERE id = 1').run(lamports);
    logEvent(null, 'deposit', lamports, null, now);
  });
}

export function adminState() {
  const r = row();
  const pending = stmt("SELECT COUNT(*) AS count, COALESCE(SUM(lamports), 0) AS lamports FROM payouts WHERE status = 'pending'").get();
  const events = stmt('SELECT * FROM pool_events ORDER BY id DESC LIMIT 50').all()
    .map((e) => ({ ...e, meta: e.meta ? JSON.parse(e.meta) : null }));
  return {
    ...summary(),
    ledgerLamports: r.ledger,
    onchainLamports: mode() === 'wallet' ? onchainLamports : null,
    reserveLamports: mode() === 'wallet' ? config.poolReserveLamports : 0,
    pendingPayouts: { count: pending.count, lamports: pending.lamports },
    recentEvents: events,
  };
}
