// Token-holding check and pool wallet balance, via plain JSON-RPC and public price APIs.
// Everything is cached briefly so a busy server does not hammer the RPC.

import { config } from './config.js';

const TIMEOUT_MS = 8_000;
const PRICE_TTL_MS = 60_000;
const HOLDING_TTL_MS = 60_000;
const HOLDING_ERROR_TTL_MS = 15_000; // retry sooner after a failed check
const FORCE_MIN_MS = 15_000;         // a forced re-check still waits this long between RPC calls
const SOL_TTL_MS = 30_000;

async function getJson(url, init = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  // Only the host goes in the message: RPC URLs often carry an API key.
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

let rpcId = 0;
async function rpc(method, params) {
  const body = await getJson(config.solanaRpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  if (body.error) {
    const err = new Error(`RPC ${method}: ${body.error.message || body.error.code}`);
    err.code = body.error.code;
    err.data = body.error.data;
    throw err;
  }
  return body.result;
}

// Sum of the owner's balance in TOKEN_MINT across all token accounts. Filtering by mint works
// for both the SPL Token and Token-2022 programs.
export async function tokenBalance(owner) {
  const result = await rpc('getTokenAccountsByOwner', [
    owner,
    { mint: config.tokenMint },
    { encoding: 'jsonParsed', commitment: 'confirmed' },
  ]);
  let total = 0;
  for (const { account } of result?.value || []) {
    const amount = account?.data?.parsed?.info?.tokenAmount;
    total += Number(amount?.uiAmountString ?? amount?.uiAmount ?? 0) || 0;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------
// USD price

async function fetchPrice(mint) {
  const problems = [];
  try {
    const data = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
    // A pair's priceUsd is the price of its base token, so skip pairs where ours is the quote.
    const pairs = (data?.pairs || [])
      .filter((p) => p.baseToken?.address === mint && Number(p.priceUsd) > 0)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0));
    if (pairs.length) return Number(pairs[0].priceUsd);
    problems.push('DexScreener has no pairs');
  } catch (err) {
    problems.push(`DexScreener: ${err.message}`);
  }
  try {
    const data = await getJson(`https://lite-api.jup.ag/price/v3?ids=${mint}`);
    const price = Number(data?.[mint]?.usdPrice);
    if (price > 0) return price;
    problems.push('Jupiter has no price');
  } catch (err) {
    problems.push(`Jupiter: ${err.message}`);
  }
  throw new Error(problems.join('; '));
}

let price = { value: 0, at: 0 };
let pricePending = null;

export async function priceUsd() {
  if (Date.now() - price.at < PRICE_TTL_MS) return price.value;
  // Share one lookup between everyone asking at the same moment.
  pricePending ||= fetchPrice(config.tokenMint)
    .then((value) => {
      price = { value, at: Date.now() };
      return value;
    })
    .finally(() => {
      pricePending = null;
    });
  return pricePending;
}

// ---------------------------------------------------------------------------------------------
// Holding check: does this wallet hold at least MIN_HOLD_USD of the token?

const holdings = new Map(); // wallet -> last result
const holdingPending = new Map();

async function checkHolding(wallet) {
  const minUsd = config.minHoldUsd;
  const [bal, px] = await Promise.allSettled([tokenBalance(wallet), priceUsd()]);
  const checkedAt = Date.now();
  if (bal.status === 'rejected' || px.status === 'rejected') {
    const why = bal.status === 'rejected' ? bal.reason : px.reason;
    console.warn(`[holding] ${wallet}: ${why?.message || why}`);
    return {
      ok: false,
      balance: bal.status === 'fulfilled' ? bal.value : null,
      priceUsd: px.status === 'fulfilled' ? px.value : null,
      usd: null,
      minUsd,
      checkedAt,
      error: bal.status === 'rejected'
        ? /could not find mint/i.test(String(bal.reason?.message))
          ? `$${config.tokenSymbol} is not on-chain yet, so balances can't be checked until it launches.`
          : 'Could not read your token balance right now. Try again in a moment.'
        : `Could not get a price for $${config.tokenSymbol} right now. Try again in a moment.`,
    };
  }
  const usd = Math.round(bal.value * px.value * 100) / 100;
  return { ok: usd >= minUsd, balance: bal.value, priceUsd: px.value, usd, minUsd, checkedAt };
}

function forgetOldHoldings(now) {
  if (holdings.size < 5_000) return;
  for (const [wallet, h] of holdings) {
    if (now - h.checkedAt > 10 * 60_000) holdings.delete(wallet);
  }
}

// Never throws: failures come back as { ok: false, error }.
// force skips the cache, but at most once per FORCE_MIN_MS per wallet.
export async function holding(wallet, { force = false } = {}) {
  const now = Date.now();
  if (config.dev) {
    return { ok: true, dev: true, balance: 0, priceUsd: 0, usd: 0, minUsd: config.minHoldUsd, checkedAt: now };
  }
  if (config.testWallets.has(wallet)) {
    return { ok: true, test: true, balance: 0, priceUsd: 0, usd: 0, minUsd: config.minHoldUsd, checkedAt: now };
  }
  const last = holdings.get(wallet);
  if (last) {
    const ttl = force ? FORCE_MIN_MS : last.error ? HOLDING_ERROR_TTL_MS : HOLDING_TTL_MS;
    if (now - last.checkedAt < ttl) return last;
  }
  if (!holdingPending.has(wallet)) {
    const pending = checkHolding(wallet)
      .catch((err) => ({ ok: false, minUsd: config.minHoldUsd, checkedAt: Date.now(), error: String(err?.message || err) }))
      .then((result) => {
        holdings.set(wallet, result);
        forgetOldHoldings(Date.now());
        return result;
      })
      .finally(() => holdingPending.delete(wallet));
    holdingPending.set(wallet, pending);
  }
  return holdingPending.get(wallet);
}

// ---------------------------------------------------------------------------------------------
// SOL balance (pool wallet mode). Throws on failure; the caller decides what to fall back to.

const solBalances = new Map(); // address -> { lamports, at }

export async function solBalance(address) {
  const cached = solBalances.get(address);
  if (cached && Date.now() - cached.at < SOL_TTL_MS) return cached.lamports;
  const result = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
  const lamports = Number(result?.value);
  if (!Number.isSafeInteger(lamports) || lamports < 0) throw new Error('getBalance returned no value');
  solBalances.set(address, { lamports, at: Date.now() });
  return lamports;
}

// After a payout leaves the pool wallet, so the next pool figure is read fresh.
export function forgetSolBalance(address) {
  solBalances.delete(address);
}

// ---------------------------------------------------------------------------------------------
// Sending payouts (payer.js)

export async function latestBlockhash() {
  const result = await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const { blockhash, lastValidBlockHeight } = result?.value || {};
  if (!blockhash || !Number.isSafeInteger(lastValidBlockHeight)) throw new Error('getLatestBlockhash returned no blockhash');
  return { blockhash, lastValidBlockHeight };
}

// Throws with err.code -32002 when the node's simulation rejected it: then it was never sent.
export async function sendTransaction(base64) {
  return rpc('sendTransaction', [base64, { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 10 }]);
}

// One entry per signature: null if the cluster has no record of it, else { confirmationStatus, err }.
// searchHistory also looks beyond the last couple of minutes.
export async function signatureStatuses(signatures, searchHistory = false) {
  const result = await rpc('getSignatureStatuses', [signatures, { searchTransactionHistory: searchHistory }]);
  return result?.value || signatures.map(() => null);
}

export async function blockHeight() {
  const h = await rpc('getBlockHeight', [{ commitment: 'confirmed' }]);
  if (!Number.isSafeInteger(h)) throw new Error('getBlockHeight returned no height');
  return h;
}
