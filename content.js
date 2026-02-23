(() => {
  function readPageText() {
    const clone = document.documentElement.cloneNode(true);
    ['script', 'style', 'svg', 'noscript', 'iframe', 'head'].forEach((tag) => {
      clone.querySelectorAll(tag).forEach((el) => el.remove());
    });

    return (clone.innerText || clone.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 28000);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg.type === 'readPage') {
      reply({
        text: readPageText(),
        title: document.title,
        url: location.href
      });
      return true;
    }

    reply({ ok: false, msg: 'unsupported message type' });
    return true;
  });
})();
