import bs58 from 'bs58';
import { publicApi, ApiError } from './api.js';

// Solana wallet sign-in: connect → the server hands out a one-time message → the wallet signs it
// (free, no transaction) → the server checks the signature and returns a session token.

const SESSION_KEY = 'pp.session';

function providers() {
  const list = [];
  const w = window;
  if (w.phantom?.solana?.isPhantom) list.push({ name: 'Phantom', provider: w.phantom.solana });
  if (w.solflare?.isSolflare) list.push({ name: 'Solflare', provider: w.solflare });
  if (w.backpack?.isBackpack) list.push({ name: 'Backpack', provider: w.backpack });
  if (!list.length && w.solana) list.push({ name: 'Wallet', provider: w.solana });
  return list;
}

export function hasWallet() {
  return providers().length > 0;
}

export function walletNames() {
  return providers().map((p) => p.name);
}

export function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// Opens this page inside Phantom's in-app browser (mobile has no extension).
export function phantomDeepLink() {
  const url = encodeURIComponent(location.href);
  const ref = encodeURIComponent(location.origin);
  return `https://phantom.app/ul/browse/${url}?ref=${ref}`;
}

export function loadSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s?.token && s?.wallet ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* ignore */ }
}

export async function connectAndSignIn(preferred = null) {
  const list = providers();
  if (!list.length) throw new ApiError('No Solana wallet found.', 'no_wallet');
  const { provider } = list.find((p) => p.name === preferred) || list[0];

  let publicKey;
  try {
    const res = await provider.connect();
    publicKey = (res?.publicKey || provider.publicKey).toString();
  } catch (err) {
    console.warn('wallet connect failed', err);
    throw walletError(err, 'connect');
  }

  const { message } = await publicApi.nonce(publicKey);
  let signature;
  try {
    const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8');
    const bytes = signed?.signature || signed;
    signature = bs58.encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  } catch (err) {
    console.warn('wallet signMessage failed', err);
    throw walletError(err, 'sign');
  }

  const res = await publicApi.verify(publicKey, signature);
  const session = { token: res.token, wallet: publicKey };
  saveSession(session);
  return { ...res, session };
}

// Tells "you pressed cancel" apart from the wallet failing, and shows the wallet's own reason.
function walletError(err, step) {
  const msg = String(err?.message || err || '');
  if (err?.code === 4001 || /reject|cancel|denied|declined/i.test(msg)) {
    return new ApiError(step === 'connect' ? 'You cancelled the connection in your wallet.' : 'You cancelled the signature in your wallet.', 'cancelled');
  }
  return new ApiError(`Your wallet couldn't ${step === 'connect' ? 'connect' : 'sign'}: ${msg || 'unknown error'}. Unlock it and try again.`, 'wallet_error');
}

export async function disconnect(provider = providers()[0]?.provider) {
  saveSession(null);
  try { await provider?.disconnect?.(); } catch { /* ignore */ }
}

export function shortAddress(a) {
  return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
}
