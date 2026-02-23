const API_KEY = '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';
const MODEL   = 'stepfun/step-3.5-flash:free';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ── state ──────────────────────────────────────────────
let pageText     = '';
let pageTitle    = '';
let pageUrl      = '';
let scanData     = null;   // { elements, count } from content script scan
let chatHistory  = [];
let busy         = false;
let permMode     = 'ask';  // 'ask' or 'full'
let labelsOn     = false;
let pendingActions = [];
let pendingIdx     = 0;

// ── refs ───────────────────────────────────────────────
const pip        = document.getElementById('pip');
const ctxLabel   = document.getElementById('ctxLabel');
const elemCount  = document.getElementById('elemCount');
const chat       = document.getElementById('chat');
const welcome    = document.getElementById('welcome');
const input      = document.getElementById('input');
const sendBtn    = document.getElementById('sendBtn');
const confirmBar = document.getElementById('confirmBar');
const confirmTxt = document.getElementById('confirmText');

// ── helpers ────────────────────────────────────────────
function trunc(s, n) { return s && s.length > n ? s.slice(0, n) + '…' : (s || ''); }

function setPip(state, label) {
  pip.className = 'pip ' + state;
  ctxLabel.textContent = label;
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function msgTab(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // Inject content script if not loaded
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['inject.css'] });
    return await chrome.tabs.sendMessage(tab.id, msg);
  }
}

// ── page context (study mode) ──────────────────────────
async function loadPage() {
  setPip('loading', 'Reading page…');
  sendBtn.disabled = true;
  scanData = null;
  elemCount.textContent = '';

  try {
    const tab = await getTab();
    if (!tab || tab.url?.startsWith('chrome://')) {
      setPip('err', 'Cannot read this page');
      return;
    }

    const result = await msgTab(tab, { type: 'readPage' });

    pageText  = result.text || '';
    pageTitle = result.title || tab.title || '';
    pageUrl   = result.url || tab.url || '';

    setPip('ok', trunc(pageTitle, 42));
    sendBtn.disabled = false;

  } catch (e) {
    setPip('err', 'Could not read page');
    console.error(e);
  }
}

// ── scan (agent mode) ──────────────────────────────────
async function scanPage(showLabels) {
  const tab = await getTab();
  if (!tab || tab.url?.startsWith('chrome://')) {
    addAction('cannot scan chrome:// pages');
    return;
  }

  setPip('loading', 'Scanning…');

  try {
    const data = await msgTab(tab, { type: 'scan', showLabels });
    scanData  = data;
    pageText  = data.text || pageText;
    pageTitle = data.title || pageTitle;
    pageUrl   = data.url || pageUrl;

    elemCount.textContent = `${data.count} elems`;
    setPip('ok', trunc(data.title, 36));
    addAction(`scanned ${data.count} interactive elements`);
  } catch (e) {
    setPip('err', 'Scan failed');
    addAction('scan failed: ' + e.message);
  }
}

// ── send message ───────────────────────────────────────
async function send() {
  const q = input.value.trim();
  if (!q || busy || !pageText) return;

  busy = true;
  sendBtn.disabled = true;
  input.value = '';
  autosize();
  hideWelcome();

  addMsg('user', q);
  chatHistory.push({ role: 'user', content: q });

  const thinkEl = addThinking();

  try {
    // Build system prompt
    let system = `You are SAHURRR, a focused study + page interaction assistant. The user is viewing "${pageTitle}".

PAGE TEXT:
${pageText.slice(0, 12000)}`;

    // If scanned, include interactive elements
    if (scanData && scanData.elements && scanData.elements.length > 0) {
      system += `

INTERACTIVE ELEMENTS ON PAGE:
${scanData.elements.join('\n')}

You can interact with the page using ACTION commands. Include them in your response when the user asks you to click, type, select, scroll, etc.

ACTION FORMAT (one per line, can use multiple):
  ACTION:CLICK:<id>
  ACTION:TYPE:<id>:<text to type>
  ACTION:SELECT:<id>:<option text>
  ACTION:CHECK:<id>
  ACTION:SCROLL:UP
  ACTION:SCROLL:DOWN
  ACTION:HIGHLIGHT:<id>

RULES:
- Only use element IDs from the list above
- Explain what you're doing before the ACTION lines
- If unsure which element, ask the user or suggest the closest match
- You can chain multiple actions in one response`;
    }

    system += `

INSTRUCTIONS:
- Answer questions about this page accurately and concisely
- Use plain text only. No markdown **, ##, or backticks
- Use short dashes (-) for lists. Keep answers tight
- If the answer isn't on the page, say so clearly`;

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'chrome-extension://studysahurr',
        'X-Title': 'study study sahurrr'
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: 'system', content: system },
          ...chatHistory.slice(-20)
        ],
        max_tokens: 1200
      })
    });

    thinkEl.remove();

    if (!res.ok) {
      const raw = await res.text();
      let msg = `Error ${res.status}`;
      try { msg = JSON.parse(raw)?.error?.message || msg; } catch {}
      addError(msg);
      chatHistory.pop();
    } else {
      const data  = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || 'No response.';

      // Parse actions out of reply
      const actions = parseActions(reply);
      const cleanReply = cleanResponse(reply);

      addMsg('ai', cleanReply || (actions.length > 0 ? '(executing actions)' : 'No response.'));
      chatHistory.push({ role: 'assistant', content: reply });

      // Execute any actions
      if (actions.length > 0) {
        await executeActions(actions);
      }
    }

  } catch (err) {
    thinkEl.remove();
    addError('Network error: ' + err.message);
    chatHistory.pop();
  }

  busy = false;
  sendBtn.disabled = !input.value.trim();
  input.focus();
}

// ── parse actions ──────────────────────────────────────
function parseActions(text) {
  const actions = [];
  const regex = /ACTION:(CLICK|TYPE|SELECT|CHECK|SCROLL|HIGHLIGHT):([^:\n]+)(?::([^\n]*))?/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const type = m[1].toLowerCase();
    const target = m[2].trim();
    const value = m[3] ? m[3].trim() : '';

    if (type === 'scroll') {
      actions.push({ type: 'scroll', elementId: 0, value: target.toLowerCase() });
    } else {
      const eid = parseInt(target);
      if (!isNaN(eid)) {
        actions.push({ type, elementId: eid, value });
      }
    }
  }
  return actions;
}

function cleanResponse(text) {
  return text.replace(/ACTION:(CLICK|TYPE|SELECT|CHECK|SCROLL|HIGHLIGHT):[^\n]*/gi, '').trim();
}

// ── execute actions ────────────────────────────────────
async function executeActions(actions) {
  if (actions.length === 0) return;

  const tab = await getTab();
  if (!tab) return;

  if (permMode === 'full') {
    // Auto-execute
    for (const action of actions) {
      addAction(`▶ ${action.type.toUpperCase()} ${action.elementId ? '[' + action.elementId + ']' : ''} ${action.value || ''}`);
      const result = await msgTab(tab, { type: 'execute', action });
      addAction(result.ok ? `✓ ${result.msg}` : `✗ ${result.msg}`);
      await new Promise(r => setTimeout(r, 400));
    }
    // Re-scan after actions
    setTimeout(() => rescanQuiet(), 1500);
  } else {
    // Ask mode
    pendingActions = actions;
    pendingIdx = 0;
    showNextConfirm();
  }
}

function showNextConfirm() {
  if (pendingIdx >= pendingActions.length) {
    confirmBar.classList.remove('visible');
    pendingActions = [];
    setTimeout(() => rescanQuiet(), 1500);
    return;
  }

  const a = pendingActions[pendingIdx];
  let desc = '';

  switch (a.type) {
    case 'click':     desc = `Click element <code>[${a.elementId}]</code>`; break;
    case 'type':      desc = `Type "<code>${a.value}</code>" into <code>[${a.elementId}]</code>`; break;
    case 'select':    desc = `Select "<code>${a.value}</code>" in <code>[${a.elementId}]</code>`; break;
    case 'check':     desc = `Toggle checkbox <code>[${a.elementId}]</code>`; break;
    case 'scroll':    desc = `Scroll <code>${a.value || 'down'}</code>`; break;
    case 'highlight': desc = `Highlight <code>[${a.elementId}]</code>`; break;
    default:          desc = `${a.type} on <code>[${a.elementId}]</code>`;
  }

  confirmTxt.innerHTML = `Allow: ${desc}?`;
  confirmBar.classList.add('visible');
  scrollBot();
}

document.getElementById('confirmYes').addEventListener('click', async () => {
  const a = pendingActions[pendingIdx];
  const tab = await getTab();

  addAction(`▶ ${a.type.toUpperCase()} ${a.elementId ? '[' + a.elementId + ']' : ''} ${a.value || ''}`);
  const result = await msgTab(tab, { type: 'execute', action: a });
  addAction(result.ok ? `✓ ${result.msg}` : `✗ ${result.msg}`);

  pendingIdx++;
  showNextConfirm();
});

document.getElementById('confirmNo').addEventListener('click', () => {
  addAction(`denied: ${pendingActions[pendingIdx].type}`);
  pendingIdx++;
  showNextConfirm();
});

// Quiet re-scan after actions
async function rescanQuiet() {
  try {
    const tab = await getTab();
    if (!tab || !scanData) return;
    const data = await msgTab(tab, { type: 'scan', showLabels: labelsOn });
    scanData = data;
    pageText = data.text || pageText;
    elemCount.textContent = `${data.count} elems`;
  } catch {}
}

// ── dom helpers ────────────────────────────────────────
function hideWelcome() {
  if (welcome) welcome.style.display = 'none';
}

function addMsg(role, text) {
  const wrap = el('div', 'msg ' + role);
  const who = el('div', 'msg-who');
  who.textContent = role === 'user' ? 'YOU' : 'SAHURRR';
  const bub = el('div', 'bubble');
  bub.textContent = text;
  wrap.append(who, bub);
  chat.appendChild(wrap);
  scrollBot();
  return wrap;
}

function addAction(text) {
  const wrap = el('div', 'msg action');
  const bub = el('div', 'bubble');
  bub.textContent = text;
  wrap.appendChild(bub);
  chat.appendChild(wrap);
  scrollBot();
  return wrap;
}

function addThinking() {
  const wrap = el('div', 'msg ai');
  const who = el('div', 'msg-who');
  who.textContent = 'SAHURRR';
  const bub = el('div', 'bubble thinking');
  bub.innerHTML = `<div class="dots"><span></span><span></span><span></span></div>`;
  wrap.append(who, bub);
  chat.appendChild(wrap);
  scrollBot();
  return wrap;
}

function addError(msg) {
  const div = el('div', 'err-row');
  div.textContent = '⚠ ' + msg;
  chat.appendChild(div);
  scrollBot();
}

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function scrollBot() { chat.scrollTop = chat.scrollHeight; }

// ── textarea ───────────────────────────────────────────
function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 110) + 'px';
}

input.addEventListener('input', () => {
  autosize();
  sendBtn.disabled = !input.value.trim() || busy || !pageText;
});

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
});

sendBtn.addEventListener('click', send);

// ── toolbar: scan ──────────────────────────────────────
document.getElementById('scanBtn').addEventListener('click', () => {
  hideWelcome();
  scanPage(labelsOn);
});

// ── toolbar: labels ────────────────────────────────────
document.getElementById('showLabels').addEventListener('click', async () => {
  labelsOn = !labelsOn;
  document.getElementById('showLabels').classList.toggle('active', labelsOn);

  const tab = await getTab();
  if (!tab) return;

  if (labelsOn && scanData) {
    await msgTab(tab, { type: 'scan', showLabels: true });
  } else if (labelsOn && !scanData) {
    await scanPage(true);
  } else {
    await msgTab(tab, { type: 'clearBadges' }).catch(() => {});
  }
});

// ── toolbar: labels header btn ─────────────────────────
document.getElementById('labelsBtn').addEventListener('click', async () => {
  labelsOn = !labelsOn;
  document.getElementById('labelsBtn').classList.toggle('active', labelsOn);
  document.getElementById('showLabels').classList.toggle('active', labelsOn);

  const tab = await getTab();
  if (!tab) return;

  if (labelsOn && scanData) {
    await msgTab(tab, { type: 'scan', showLabels: true });
  } else if (labelsOn && !scanData) {
    hideWelcome();
    await scanPage(true);
  } else {
    await msgTab(tab, { type: 'clearBadges' }).catch(() => {});
  }
});

// ── toolbar: permission ────────────────────────────────
document.querySelectorAll('.perm-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.perm-opt').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    permMode = btn.dataset.mode;
    addAction(permMode === 'full'
      ? '⚡ auto mode — actions execute automatically'
      : '🔒 ask mode — you approve each action');
    hideWelcome();
  });
});

// ── header buttons ─────────────────────────────────────
document.getElementById('clearBtn').addEventListener('click', async () => {
  chatHistory = [];
  chat.querySelectorAll('.msg, .err-row').forEach(m => m.remove());
  if (welcome) welcome.style.display = '';

  const tab = await getTab();
  if (tab) await msgTab(tab, { type: 'clearBadges' }).catch(() => {});
  labelsOn = false;
  document.getElementById('labelsBtn').classList.remove('active');
  document.getElementById('showLabels').classList.remove('active');
  scanData = null;
  elemCount.textContent = '';
});

document.getElementById('reloadCtx').addEventListener('click', () => {
  chatHistory = [];
  loadPage();
});

document.getElementById('ctxReload').addEventListener('click', () => {
  chatHistory = [];
  loadPage();
});

// ── chips ──────────────────────────────────────────────
document.querySelectorAll('.chip').forEach(c => {
  c.addEventListener('click', () => {
    input.value = c.dataset.q;
    autosize();
    send();
  });
});

// ── tab listeners ──────────────────────────────────────
chrome.tabs.onActivated.addListener(() => {
  scanData = null;
  elemCount.textContent = '';
  labelsOn = false;
  document.getElementById('labelsBtn').classList.remove('active');
  document.getElementById('showLabels').classList.remove('active');
  loadPage();
});

chrome.tabs.onUpdated.addListener((_, info) => {
  if (info.status === 'complete') {
    scanData = null;
    elemCount.textContent = '';
    loadPage();
  }
});

// ── init ───────────────────────────────────────────────
loadPage();
