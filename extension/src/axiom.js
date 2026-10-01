// Axiom side: terminal picker beside the Instant Trade panel, and routing of its buy buttons.
(() => {
  const TR = globalThis.TR;
  const PANEL = '#instant-trade';
  const RAIL_GAP = 6;
  const B58 = '[1-9A-HJ-NP-Za-km-z]{32,44}';
  // Links on the token page that carry the token's mint (contract) address.
  const MINT_LINKS = [
    new RegExp(`pump\\.fun/(?:coin/)?(${B58})`),
    new RegExp(`solscan\\.io/token/(${B58})`),
    new RegExp(`gmgn\\.ai/sol/token/(?:\\w+_)?(${B58})`),
    new RegExp(`birdeye\\.so/token/(${B58})`),
  ];

  let settings = { ...TR.DEFAULTS };
  let lastFire = 0;
  const tokenCache = new Map();

  // ---------- settings ----------

  TR.getSettings().then((s) => {
    settings = s;
    render();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue;
    render();
  });

  function setRoute(route) {
    try {
      chrome.storage.sync.set({ route });
    } catch {
      toast('error', 'Extension was reloaded. Refresh this Axiom page.');
    }
  }

  function send(msg) {
    try {
      return chrome.runtime.sendMessage(msg);
    } catch {
      return Promise.reject(new Error('Extension was reloaded. Refresh this Axiom page.'));
    }
  }

  // ---------- terminal picker rail ----------

  const rail = document.createElement('div');
  rail.id = 'tr-rail';
  for (const [route, t] of Object.entries(TR.TERMINALS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tr-term';
    b.dataset.route = route;
    b.title = `Buy through ${t.label} (Alt+${t.key})`;
    b.innerHTML = `<span class="tr-dot"></span><span class="tr-name">${t.label}</span>`;
    b.addEventListener('click', () => setRoute(route));
    rail.appendChild(b);
  }
  const testBadge = document.createElement('div');
  testBadge.className = 'tr-test';
  testBadge.textContent = 'TEST MODE';
  testBadge.title = 'Padre/GMGN orders are filled in but Buy is not pressed. Turn off in the extension popup.';
  rail.appendChild(testBadge);
  document.documentElement.appendChild(rail);

  function render() {
    for (const b of rail.querySelectorAll('.tr-term')) {
      b.classList.toggle('tr-active', b.dataset.route === settings.route);
    }
    rail.classList.toggle('tr-dry', Boolean(settings.dryRun) && settings.route !== 'axiom');
  }

  // Follow the panel around: it is draggable, resizable and can be closed.
  function place() {
    const panel = document.querySelector(PANEL);
    const r = panel?.getBoundingClientRect();
    if (!r || r.width === 0) {
      rail.style.display = 'none';
    } else {
      rail.style.display = 'flex';
      const w = rail.offsetWidth;
      const left = r.left - w - RAIL_GAP >= 0 ? r.left - w - RAIL_GAP : r.right + RAIL_GAP;
      rail.style.transform = `translate(${Math.round(left)}px, ${Math.round(r.top)}px)`;
      if (panel.dataset.trRoute !== settings.route) panel.dataset.trRoute = settings.route;
    }
    requestAnimationFrame(place);
  }
  requestAnimationFrame(place);

  // ---------- buy-click interception ----------

  // Buy presets are the green (text-increase) pills; sell presets are text-decrease.
  function buyButtonFrom(target) {
    if (!(target instanceof Element)) return null;
    const panel = target.closest(PANEL);
    const btn = panel && target.closest('.rounded-full.cursor-pointer');
    return btn && panel.contains(btn) && btn.classList.contains('text-increase') ? btn : null;
  }

  // Window capture listeners run before React's, so Axiom never sees the click.
  function intercept(e) {
    if (settings.route === 'axiom') return;
    const btn = buyButtonFrom(e.target);
    if (!btn) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.type === 'click') routeBuy(btn);
  }
  for (const type of ['pointerdown', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend', 'click', 'dblclick']) {
    window.addEventListener(type, intercept, { capture: true, passive: false });
  }

  async function routeBuy(btn) {
    // Guard against an accidental double click sending two orders.
    const now = Date.now();
    if (now - lastFire < 400) return toast('info', 'Ignored a double click. Click again to place another order.');
    lastFire = now;

    const route = settings.route;
    const name = TR.TERMINALS[route].label;
    const text = btn.textContent.trim();
    const amount = Number(text);
    if (!(amount > 0)) return toast('error', `"${text}" is not a SOL amount.`);
    const unit = btn.closest(PANEL).querySelector('.buy-click-container button span')?.textContent.trim();
    if (unit && unit !== 'SOL') return toast('error', `Switch Axiom's Buy unit to SOL first (it is ${unit}).`);

    try {
      toast('pending', 'Finding token address…');
      const { mint } = await resolveToken();
      if (settings.confirm && !window.confirm(`Buy ${amount} SOL of ${mint} through ${name}?`)) {
        return toast('info', 'Cancelled.');
      }
      toast('pending', `${settings.dryRun ? 'TEST: ' : ''}Buying ${amount} SOL through ${name}…`);
      const res = await send({ type: 'tr-buy', route, amount, mint });
      toast(res?.ok ? 'ok' : 'error', res?.message || 'No response from the extension.');
    } catch (err) {
      toast('error', err.message);
    }
  }

  // Axiom's URL holds the pair (pool) address; Padre and GMGN need the token mint.
  async function resolveToken() {
    const pair = location.pathname.match(new RegExp(`/meme/(${B58})`))?.[1];
    if (!pair) throw new Error('Open a token page on Axiom first (axiom.trade/meme/…).');
    if (tokenCache.has(pair)) return tokenCache.get(pair);

    let mint = await send({ type: 'tr-resolve', pair }).catch(() => null);
    if (typeof mint !== 'string') {
      const found = new Set();
      for (const a of document.querySelectorAll('a[href]')) {
        for (const re of MINT_LINKS) {
          const m = a.href.match(re);
          if (m && m[1] !== pair) found.add(m[1]);
        }
      }
      if (found.size > 1) throw new Error(`Found ${found.size} different token addresses on the page. Not buying, to be safe.`);
      mint = [...found][0];
    }
    if (!mint) throw new Error("Could not find this token's contract address.");

    const token = { pair, mint };
    tokenCache.set(pair, token);
    return token;
  }

  // ---------- shortcuts ----------

  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const hit = Object.entries(TR.TERMINALS).find(([, t]) => e.code === `Digit${t.key}`);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setRoute(hit[0]);
      toast('info', `Buying through ${hit[1].label}`);
    },
    true,
  );

  // ---------- toast ----------

  const toastEl = document.createElement('div');
  toastEl.id = 'tr-toast';
  document.documentElement.appendChild(toastEl);
  let toastTimer;

  function toast(kind, text) {
    toastEl.className = `tr-show tr-${kind}`;
    toastEl.textContent = text;
    clearTimeout(toastTimer);
    if (kind !== 'pending') toastTimer = setTimeout(() => (toastEl.className = ''), kind === 'error' ? 7000 : 4000);
  }
})();
