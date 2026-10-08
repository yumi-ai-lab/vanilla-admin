(() => {
  'use strict';
  const config = window.VIBAdminConfig || {};
  const remote = typeof config.endpoint === 'string' && config.endpoint.startsWith('https://')
    ? config.endpoint.replace(/\/$/, '') : '';
  const key = 'vib-admin-session-v1';
  let memory = null;
  function readSession() {
    let session = memory;
    try { session = JSON.parse(sessionStorage.getItem(key) || 'null') || session; } catch {}
    if (!session || typeof session.token !== 'string' || !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) return null;
    return session;
  }
  function clear() {
    memory = null;
    try { sessionStorage.removeItem(key); } catch {}
  }
  function save(session) {
    if (!session || typeof session.token !== 'string' || !Number.isFinite(Date.parse(session.expiresAt))) throw new Error('ログインの応答を確認できませんでした。');
    memory = { token: session.token, expiresAt: session.expiresAt };
    try { sessionStorage.setItem(key, JSON.stringify(memory)); } catch {}
  }
  async function request(url, options = {}) {
    if (!remote) return fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    if (!url.startsWith('/api/admin/')) throw new Error('管理画面の接続先が正しくありません。');
    const headers = new Headers(options.headers || {});
    const session = readSession();
    if (session) headers.set('Authorization', `Bearer ${session.token}`);
    const response = await fetch(remote + url, { ...options, headers, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (response.status === 401) clear();
    return response;
  }
  const homePath = remote && /^\/[a-zA-Z0-9/_-]*\/$/.test(config.basePath || '') ? config.basePath : '/admin/';
  const loginPath = remote ? `${homePath}login/` : '/admin/login';
  window.VIBAdminAPI = Object.freeze({ request, save, clear, loginPath, homePath, remote: Boolean(remote) });
  if (remote && location.pathname === homePath && !readSession()) location.replace(loginPath);
})();
