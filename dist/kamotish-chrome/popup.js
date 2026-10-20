(function () {
  const $ = id => document.getElementById(id);
  let host = null;
  function status(msg) { $('st').textContent = msg; }
  function ask(type, cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return cb(null);
      chrome.tabs.sendMessage(tabs[0].id, { type }, r => { void chrome.runtime.lastError; cb(r || null); });
    });
  }
  function refresh() {
    chrome.storage.local.get({ enabled: true, disabledHosts: [] }, v => {
      $('on').checked = v.enabled;
      ask('status', r => {
        if (!r) { $('site').disabled = true; $('rescan').disabled = true; status('此页面不能使用（浏览器内部页面或尚未加载）。'); return; }
        host = r.host; $('host').textContent = host || '本站';
        $('site').checked = v.disabledHosts.indexOf(host) < 0;
        status(v.enabled && v.disabledHosts.indexOf(host) < 0 ? '本页已渲染 ' + r.count + ' 处。' : '已关闭。');
      });
    });
  }
  $('on').addEventListener('change', () => chrome.storage.local.set({ enabled: $('on').checked }, () => setTimeout(refresh, 120)));
  $('site').addEventListener('change', () => chrome.storage.local.get({ disabledHosts: [] }, v => {
    const set = new Set(v.disabledHosts); if ($('site').checked) set.delete(host); else set.add(host);
    chrome.storage.local.set({ disabledHosts: Array.from(set) }, () => setTimeout(refresh, 120));
  }));
  $('rescan').addEventListener('click', () => ask('rescan', () => setTimeout(refresh, 150)));
  refresh();
})();
