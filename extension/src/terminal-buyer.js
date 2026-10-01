// Padre / GMGN side: receives an order from the background worker and places it in this tab,
// using your normal logged-in session on that site.
(() => {
  if (globalThis.__trBuyer) return;
  globalThis.__trBuyer = true;

  const TR = globalThis.TR;
  const site = TR.SITES[location.hostname.endsWith('gmgn.ai') ? 'gmgn' : 'padre'];
  const pageId = Math.random().toString(36).slice(2);
  let busy = false;

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'tr-ping') {
      reply({ pageId, href: location.href });
      return false;
    }
    if (msg?.type !== 'tr-exec') return false;
    if (busy) {
      reply({ ok: false, message: `${site.label}: previous order is still in progress.` });
      return false;
    }
    busy = true;
    placeOrder(msg)
      .then(reply, (err) => reply({ ok: false, message: err.message }))
      .finally(() => (busy = false));
    return true;
  });

  async function placeOrder({ amount, dryRun }) {
    let form = await waitFor(findBuyForm, 20000, 'Buy box');
    const value = String(amount);
    setValue(form.input, value);
    await tick();
    await tick();
    if (form.input.value !== value) throw new Error(`${site.label}: could not type the amount.`);

    // React may re-render the form after the amount changes.
    form = findBuyForm() ?? form;
    if (dryRun) {
      mark(form.input);
      mark(form.button);
      return { ok: true, message: `TEST MODE: typed ${value} SOL on ${site.label} but did not press Buy.` };
    }

    const button = await waitFor(() => (form.button.disabled ? null : form.button), 3000, 'Enabled Buy button');
    const outcome = watchOutcome(10000);
    press(button);
    return outcome;
  }

  // ---------- finding the buy form ----------

  function bySelectors(list) {
    for (const sel of list) {
      const el = [...document.querySelectorAll(sel)].find(visible);
      if (el) return el;
    }
    return null;
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();

  // The Buy/Sell tab switch also says "Buy"; skip buttons sitting next to a "Sell" button.
  function isTabSwitch(btn) {
    return [...(btn.parentElement?.children ?? [])].some((sib) => sib !== btn && /^sell$/i.test(text(sib)));
  }

  function buyButtons() {
    const custom = bySelectors(site.buyButton);
    if (custom) return [custom];
    return [...document.querySelectorAll('button, [role="button"]')].filter(
      (b) => visible(b) && /^(quick\s*)?buy\b/i.test(text(b)) && !isTabSwitch(b),
    );
  }

  function amountInputs() {
    const custom = bySelectors(site.amountInput);
    if (custom) return [custom];
    return [...document.querySelectorAll('input')].filter((i) => {
      if (!visible(i) || i.disabled || i.readOnly || !['text', 'number', ''].includes(i.type)) return false;
      const hints = [i.placeholder, i.name, i.getAttribute('aria-label')].filter(Boolean);
      return hints.some((h) => /amount|sol|^0([.,]0*)?$/i.test(h.trim()));
    });
  }

  // How many levels up from `b` until we reach an ancestor of `a`.
  function distance(a, b) {
    const path = new Set();
    for (let n = a; n; n = n.parentElement) path.add(n);
    let d = 0;
    for (let n = b; n; n = n.parentElement, d++) if (path.has(n)) return d;
    return Infinity;
  }

  // Closest (amount input, buy button) pair on the page.
  function findBuyForm() {
    let best = null;
    for (const button of buyButtons()) {
      for (const input of amountInputs()) {
        const d = distance(input, button);
        if (!best || d < best.d) best = { input, button, d };
      }
    }
    return best && best.d < 12 ? best : null;
  }

  // ---------- acting on the page ----------

  // Set the value the way React expects, so its onChange fires.
  function setValue(input, value) {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function press(el) {
    const r = el.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      button: 0,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
    };
    const pointer = { ...opts, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', pointer));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', pointer));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function mark(el) {
    el.style.outline = '2px dashed #f5c542';
    setTimeout(() => (el.style.outline = ''), 4000);
  }

  // ---------- waiting ----------

  // Background tabs throttle timers, so wait on DOM changes and MessageChannel ticks instead.
  const tick = () =>
    new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => resolve();
      ch.port2.postMessage(0);
    });

  function waitFor(find, timeout, what) {
    return new Promise((resolve, reject) => {
      const hit = find();
      if (hit) return resolve(hit);
      const obs = new MutationObserver(() => {
        const found = find();
        if (found) {
          cleanup();
          resolve(found);
        }
      });
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${site.label}: ${what} not found. Is the tab logged in?`));
      }, timeout);
      const cleanup = () => {
        obs.disconnect();
        clearTimeout(timer);
      };
      obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    });
  }

  // Read the site's own toast/notification after pressing Buy.
  function watchOutcome(timeout) {
    const OK = /success|bought|confirmed|submitted|sent/i;
    const BAD = /fail|error|insufficient|rejected|not enough|expired|exceeds/i;
    const TOAST = '[role="alert"], [role="status"], [class*="toast" i], [class*="notif" i], [class*="message" i], [class*="snackbar" i]';
    return new Promise((resolve) => {
      const finish = (result) => {
        obs.disconnect();
        clearTimeout(timer);
        resolve(result);
      };
      const obs = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            const el = node instanceof Element ? node : node.parentElement;
            if (!el?.closest(TOAST)) continue;
            const msg = text(el).slice(0, 200);
            if (BAD.test(msg)) return finish({ ok: false, message: `${site.label}: ${msg}` });
            if (OK.test(msg)) return finish({ ok: true, message: `${site.label}: ${msg}` });
          }
        }
      });
      const timer = setTimeout(
        () => finish({ ok: true, message: `Pressed Buy on ${site.label}. No confirmation seen, so check the ${site.label} tab.` }),
        timeout,
      );
      obs.observe(document.documentElement, { childList: true, subtree: true });
    });
  }
})();
