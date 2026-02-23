(() => {
  if (window.__sahAgentLoaded) return;
  window.__sahAgentLoaded = true;

  let elementMap = {};
  let badges = [];

  /* ── SCAN ─────────────────────────────────────────── */

  function scanPage(showLabels) {
    clearBadges();
    elementMap = {};

    const selectors = [
      'a[href]', 'button', 'input', 'textarea', 'select',
      '[role="button"]', '[role="link"]', '[role="tab"]',
      '[role="menuitem"]', '[role="checkbox"]', '[role="radio"]',
      '[role="switch"]', '[role="option"]', '[onclick]',
      'summary', '[contenteditable="true"]', 'label[for]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');

    const nodes = document.querySelectorAll(selectors);
    const elements = [];
    let id = 1;

    nodes.forEach(el => {
      if (!isVisible(el)) return;
      const desc = describe(el, id);
      if (!desc) return;
      elementMap[id] = el;
      elements.push(desc);
      if (showLabels) addBadge(el, id);
      id++;
    });

    // Page text (cleaned)
    const textClone = document.body.cloneNode(true);
    textClone.querySelectorAll('script,style,noscript,svg,iframe').forEach(e => e.remove());
    const pageText = (textClone.innerText || '').replace(/\n{3,}/g, '\n\n').trim();

    return {
      url: location.href,
      title: document.title,
      count: elements.length,
      elements: elements.slice(0, 200),
      text: pageText.slice(0, 10000)
    };
  }

  function isVisible(el) {
    if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
  }

  function describe(el, id) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const text = clean(el.textContent, 80);
    const aria = el.getAttribute('aria-label') || '';
    const ph = el.placeholder || '';
    const href = el.href || '';
    const val = el.value || '';
    const name = el.name || '';
    const title = el.title || '';
    const checked = el.checked;
    const type = el.type || '';
    let d = `[${id}]`;

    if (tag === 'a')                             d += ` Link: "${text || aria || title}" ${href ? '→ ' + href.slice(0, 100) : ''}`;
    else if (tag === 'button' || role === 'button') d += ` Button: "${text || aria || title}"`;
    else if (tag === 'input' && (type === 'checkbox' || type === 'radio'))
      d += ` ${type[0].toUpperCase() + type.slice(1)}: "${aria || name || text}" [${checked ? '✓' : '○'}]`;
    else if (tag === 'input' && type === 'submit')  d += ` Submit: "${val || text || 'Submit'}"`;
    else if (tag === 'input')                        d += ` Input(${type || 'text'}): "${aria || ph || name}" ${val ? '[val: "' + clean(val, 40) + '"]' : ''}`;
    else if (tag === 'textarea')                     d += ` Textarea: "${aria || ph || name}" ${val ? '[val: "' + clean(val, 40) + '"]' : ''}`;
    else if (tag === 'select') {
      const opt = el.options?.[el.selectedIndex];
      d += ` Dropdown: "${aria || name}" [selected: "${opt ? opt.text : ''}"]`;
    }
    else if (role === 'tab')                     d += ` Tab: "${text || aria}"`;
    else if (role === 'menuitem')                d += ` MenuItem: "${text || aria}"`;
    else if (tag === 'summary')                  d += ` Toggle: "${text}"`;
    else                                         d += ` Clickable(${tag}): "${text || aria || title}"`;

    if (el.disabled) d += ' [disabled]';

    // Skip empty entries
    const useful = text || aria || ph || name || href || val || title;
    if (!useful) return null;
    return d;
  }

  function clean(s, max) {
    return (s || '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  /* ── BADGES ───────────────────────────────────────── */

  function addBadge(el, id) {
    const rect = el.getBoundingClientRect();
    const b = document.createElement('div');
    b.className = '__sah-badge';
    b.textContent = id;
    b.style.left = (scrollX + rect.left - 2) + 'px';
    b.style.top  = (scrollY + rect.top - 16) + 'px';
    document.body.appendChild(b);
    badges.push(b);
  }

  function clearBadges() {
    badges.forEach(b => b.remove());
    badges = [];
    document.querySelectorAll('.__sah-highlight, .__sah-flash').forEach(el => {
      el.classList.remove('__sah-highlight', '__sah-flash');
    });
  }

  /* ── EXECUTE ──────────────────────────────────────── */

  function execute(action) {
    const { type, elementId, value } = action;

    // Scroll doesn't need an element
    if (type === 'scroll') {
      const dir = (value || 'down').toLowerCase();
      window.scrollBy({ top: dir === 'up' ? -500 : 500, behavior: 'smooth' });
      return { ok: true, msg: `Scrolled ${dir}` };
    }

    const el = elementMap[elementId];
    if (!el) return { ok: false, msg: `Element [${elementId}] not found — page may have changed, try re-scanning` };

    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      flash(el);

      switch (type) {
        case 'click':
          el.focus();
          el.click();
          return { ok: true, msg: `Clicked [${elementId}]: ${clean(el.textContent || el.tagName, 50)}` };

        case 'type':
          el.focus();
          // Clear existing then type
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          // Type char by char for realistic input
          for (const ch of (value || '')) {
            el.value += ch;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, msg: `Typed "${clean(value, 40)}" into [${elementId}]` };

        case 'select': {
          const opts = [...(el.options || [])];
          const match = opts.find(o =>
            o.text.toLowerCase().includes((value || '').toLowerCase()) ||
            o.value.toLowerCase().includes((value || '').toLowerCase())
          );
          if (!match) return { ok: false, msg: `Option "${value}" not found in dropdown [${elementId}]` };
          el.value = match.value;
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, msg: `Selected "${match.text}" in [${elementId}]` };
        }

        case 'check':
          if (el.type === 'checkbox' || el.type === 'radio') {
            el.click();
            return { ok: true, msg: `Toggled [${elementId}] → ${el.checked ? 'checked' : 'unchecked'}` };
          }
          return { ok: false, msg: `[${elementId}] is not a checkbox/radio` };

        case 'highlight':
          el.classList.add('__sah-highlight');
          return { ok: true, msg: `Highlighted [${elementId}]` };

        default:
          return { ok: false, msg: `Unknown action: ${type}` };
      }
    } catch (e) {
      return { ok: false, msg: `Error: ${e.message}` };
    }
  }

  function flash(el) {
    el.classList.add('__sah-flash');
    setTimeout(() => el.classList.remove('__sah-flash'), 1500);
  }

  /* ── TOAST ────────────────────────────────────────── */

  function toast(msg, success) {
    const old = document.querySelector('.__sah-toast');
    if (old) old.remove();
    const t = document.createElement('div');
    t.className = '__sah-toast ' + (success ? 'success' : 'error');
    t.textContent = (success ? '✓ ' : '✗ ') + msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  /* ── MESSAGE LISTENER ─────────────────────────────── */

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    switch (msg.type) {
      case 'scan':
        reply(scanPage(msg.showLabels || false));
        break;

      case 'execute': {
        const r = execute(msg.action);
        toast(r.msg, r.ok);
        reply(r);
        break;
      }

      case 'clearBadges':
        clearBadges();
        reply({ ok: true });
        break;

      case 'readPage': {
        // Simple text-only read (for study mode)
        const clone = document.documentElement.cloneNode(true);
        ['script','style','svg','noscript','iframe','head'].forEach(t =>
          clone.querySelectorAll(t).forEach(el => el.remove()));
        reply({
          text:  (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28000),
          title: document.title,
          url:   location.href
        });
        break;
      }

      default:
        reply({ ok: false, msg: 'unknown message type' });
    }
    return true;
  });
})();
