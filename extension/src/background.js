// Background worker: resolves token addresses and drives the Padre / GMGN tabs.
importScripts('config.js');

const TR = globalThis.TR;
// Quote tokens: when a pool pairs a memecoin with one of these, the other side is the memecoin.
const QUOTES = new Set([
  'So11111111111111111111111111111111111111112', // wSOL
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = { 'tr-buy': buy, 'tr-resolve': resolveMint, 'tr-warm': warmTabs }[msg?.type];
  if (!handler) return false;
  handler(msg).then(reply, (err) => reply({ ok: false, message: err?.message || String(err) }));
  return true;
});

// Pair (pool) address -> token mint, via DexScreener. Returns null when unknown.
async function resolveMint({ pair }) {
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pair}`);
    const data = await res.json();
    const p = data.pairs?.[0] ?? data.pair;
    const mint = p && [p.baseToken?.address, p.quoteToken?.address].find((a) => a && !QUOTES.has(a));
    if (mint) return mint;

    // The address in Axiom's URL may already be the mint itself.
    const tokens = await (await fetch(`https://api.dexscreener.com/tokens/v1/solana/${pair}`)).json();
    if (Array.isArray(tokens) && tokens.length) return pair;
  } catch {
    // Fall through: the Axiom page scans its own links instead.
  }
  return null;
}

async function buy({ route, amount, index, pair, mint }) {
  if (!TR.SITES[route]) throw new Error(`Unknown terminal: ${route}`);
  const settings = await TR.getSettings();
  const url = settings[`${route}Url`].replaceAll('{pair}', pair).replaceAll('{mint}', mint);
  const { tabId, stale } = await terminalTab(route, url);
  await whenReady(tabId, stale);
  const res = await chrome.tabs.sendMessage(tabId, {
    type: 'tr-exec',
    amount,
    index,
    mint,
    dryRun: settings.dryRun,
    matchByPosition: settings.matchByPosition,
  });
  return res ?? { ok: false, message: `${TR.SITES[route].label} tab did not answer.` };
}

// One dedicated pinned tab per terminal, so the extension never hijacks a tab you are using.
async function terminalTab(route, url) {
  const tabKey = `tab_${route}`;
  const urlKey = `url_${route}`;
  const saved = await chrome.storage.session.get([tabKey, urlKey]);
  const tab = saved[tabKey] != null ? await chrome.tabs.get(saved[tabKey]).catch(() => null) : null;

  if (!tab) {
    const created = await chrome.tabs.create({ url, active: false, pinned: true });
    await chrome.storage.session.set({ [tabKey]: created.id, [urlKey]: url });
    return { tabId: created.id, stale: null };
  }
  if (saved[urlKey] === url) return { tabId: tab.id, stale: null };

  const stale = (await ping(tab.id))?.pageId ?? null;
  await chrome.tabs.update(tab.id, { url });
  await chrome.storage.session.set({ [urlKey]: url });
  return { tabId: tab.id, stale };
}

const ping = (tabId) => chrome.tabs.sendMessage(tabId, { type: 'tr-ping' }).catch(() => null);

// Wait until the buyer script answers from the new page (not the page we navigated away from).
async function whenReady(tabId, stale) {
  const end = Date.now() + 25000;
  while (Date.now() < end) {
    const pong = await ping(tabId);
    if (pong && pong.pageId !== stale) return;
    await sleep(150);
  }
  throw new Error('Terminal tab did not load in time. Is it open and logged in?');
}

// Popup button: open the terminal tabs ahead of time so you can check you are logged in.
async function warmTabs() {
  const opened = [];
  for (const [route, site] of Object.entries(TR.SITES)) {
    const tabKey = `tab_${route}`;
    const saved = await chrome.storage.session.get(tabKey);
    const tab = saved[tabKey] != null ? await chrome.tabs.get(saved[tabKey]).catch(() => null) : null;
    if (tab) continue;
    const created = await chrome.tabs.create({ url: site.home, active: false, pinned: true });
    await chrome.storage.session.set({ [tabKey]: created.id, [`url_${route}`]: site.home });
    opened.push(site.label);
  }
  return { ok: true, message: opened.length ? `Opened ${opened.join(' and ')}.` : 'Terminal tabs are already open.' };
}
