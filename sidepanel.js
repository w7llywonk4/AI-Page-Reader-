const API_KEY = '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';
const MODEL   = 'stepfun/step-3.5-flash:free';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

let pageText = '';
let pageTitle = '';
let pageUrl = '';
let chatHistory = [];
let busy = false;

const pip = document.getElementById('pip');
const ctxLabel = document.getElementById('ctxLabel');
const elemCount = document.getElementById('elemCount');
const chat = document.getElementById('chat');
const welcome = document.getElementById('welcome');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');

function trunc(s, n) {
  return s && s.length > n ? s.slice(0, n) + '…' : (s || '');
}

function setPip(state, label) {
  pip.className = 'pip ' + state;
  ctxLabel.textContent = label;
}

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function msgTab(tab, msg) {
  return await chrome.tabs.sendMessage(tab.id, msg);
}

async function loadPage() {
  setPip('loading', 'Reading page…');
  sendBtn.disabled = true;
  elemCount.textContent = '';

  try {
    const tab = await getTab();
    if (!tab || tab.url?.startsWith('chrome://')) {
      setPip('err', 'Cannot read this page');
      return;
    }

    const result = await msgTab(tab, { type: 'readPage' });
    pageText = result.text || '';
    pageTitle = result.title || tab.title || '';
    pageUrl = result.url || tab.url || '';

    setPip('ok', trunc(pageTitle, 42));
    sendBtn.disabled = !input.value.trim();
  } catch (e) {
    setPip('err', 'Could not read page');
    console.error(e);
  }
}

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
    const system = `You are SAHURRR, a focused page-reading assistant.\nThe user is currently viewing:\n- Title: ${pageTitle}\n- URL: ${pageUrl}\n\nPAGE TEXT:\n${pageText.slice(0, 12000)}\n\nINSTRUCTIONS:\n- ONLY answer questions about the page content provided above\n- Do not suggest clicking, typing, navigating, or taking any actions on the page\n- If the answer is not in the page text, clearly say it is not present\n- Use plain text only (no markdown), concise and accurate`;

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
      try {
        msg = JSON.parse(raw)?.error?.message || msg;
      } catch {}
      addError(msg);
      chatHistory.pop();
    } else {
      const data = await res.json();
      const reply = data.choices?.[0]?.message?.content?.trim() || 'No response.';
      addMsg('ai', reply);
      chatHistory.push({ role: 'assistant', content: reply });
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

function hideWelcome() {
  if (welcome) welcome.style.display = 'none';
}

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
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
}

function addError(text) {
  const wrap = el('div', 'msg ai');
  const who = el('div', 'msg-who');
  who.textContent = 'SYSTEM';
  const bub = el('div', 'bubble');
  bub.style.borderColor = 'rgba(224,53,69,.5)';
  bub.textContent = text;
  wrap.append(who, bub);
  chat.appendChild(wrap);
  scrollBot();
}

function addThinking() {
  const wrap = el('div', 'msg ai thinking');
  const who = el('div', 'msg-who');
  who.textContent = 'SAHURRR';
  const bub = el('div', 'bubble');
  bub.textContent = 'Thinking…';
  wrap.append(who, bub);
  chat.appendChild(wrap);
  scrollBot();
  return wrap;
}

function scrollBot() {
  chat.scrollTop = chat.scrollHeight;
}

function autosize() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 140) + 'px';
}

document.getElementById('sendBtn').addEventListener('click', send);

document.getElementById('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});

document.getElementById('input').addEventListener('input', () => {
  autosize();
  sendBtn.disabled = !input.value.trim() || busy;
});

document.getElementById('reloadCtx')?.addEventListener('click', loadPage);
document.getElementById('ctxReload')?.addEventListener('click', loadPage);

document.getElementById('clearBtn')?.addEventListener('click', () => {
  chat.innerHTML = '';
  if (welcome) welcome.style.display = '';
  chatHistory = [];
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    input.value = chip.dataset.q || '';
    autosize();
    sendBtn.disabled = !input.value.trim() || busy;
    input.focus();
  });
});

autosize();
loadPage();
