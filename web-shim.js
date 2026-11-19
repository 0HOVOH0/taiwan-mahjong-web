// 青竹十六張網頁版轉接層：把頁面對 /api/... 的請求轉給背景執行的 Python 牌桌（worker.js）。
// 舊版介面（app.js / study.js / style.css）與新版介面（v2/）共用同一份 shim 與 worker。
// - worker 路徑以本檔所在位置解析，所以 v2/ 子資料夾載入 ../web-shim.js 也能找到 ../worker.js。
// - 新版在 <html data-qz-boot="custom"> 時自己畫載入畫面，shim 只送出 qingzhu:boot 事件。
(() => {
  'use strict';
  const realFetch = window.fetch.bind(window);
  const here = document.currentScript && document.currentScript.src ? new URL('.', document.currentScript.src) : new URL('.', location.href);
  const qz = (window.qingzhu = window.qingzhu || {});
  qz.web = true;
  let worker = null, seq = 0, readyResolve, readyReject;
  const pending = new Map();
  const ready = new Promise((res, rej) => { readyResolve = res; readyReject = rej; });
  ready.catch(() => {});
  qz.webReady = ready;

  const customBoot = () => document.documentElement.dataset.qzBoot === 'custom';
  const emit = (detail) => { qz.bootState = detail; window.dispatchEvent(new CustomEvent('qingzhu:boot', { detail })); };

  function el(tag, attrs = {}, html = '') { const e = document.createElement(tag); Object.assign(e, attrs); if (html) e.innerHTML = html; return e; }
  function bootCard() {
    if (customBoot()) return null;
    let card = document.getElementById('boot');
    if (card || !document.getElementById('board')) return card;
    card = el('div', { id: 'boot', className: 'result-overlay boot' },
      '<div class="result-banner"><div class="result-title">青竹 · 十六張</div><p id="boot-text" class="start-sub">準備中…</p>' +
      '<div class="boot-bar"><i id="boot-fill"></i></div><p class="boot-note">第一次開啟約下載 15 MB，之後會快很多。<br>牌局與 AI 都在你的瀏覽器裡運算，不會上傳。</p></div>');
    document.getElementById('board').append(card);
    return card;
  }
  function progress(text, pct) {
    emit({ phase: 'progress', text, pct });
    const c = bootCard(); if (!c) return;
    c.querySelector('#boot-text').textContent = text; c.querySelector('#boot-fill').style.width = Math.max(4, pct || 0) + '%';
  }
  function done(info) {
    emit({ phase: 'ready', info });
    const c = bootCard(); if (c) c.hidden = true;
    if (info && !info.model_loaded) {
      const say = (typeof qz.toast === 'function' && qz.toast) || (typeof toast === 'function' && toast);
      if (say) say('AI 模型沒有載入成功，改用規則教師建議。');
    }
  }
  function fail(message) {
    emit({ phase: 'fatal', text: message });
    const c = bootCard(); if (c) { c.hidden = false; c.classList.add('failed'); c.querySelector('#boot-text').textContent = '載入失敗：' + message; }
    const s = document.getElementById('status'); if (s) { s.textContent = '網頁牌桌載入失敗。請重新整理，或改用最新版 Chrome、Edge、Safari。'; s.classList.add('error'); }
  }

  try { worker = new Worker(new URL('worker.js', here), { type: 'module' }); }
  catch (error) { const m = '這個瀏覽器不支援背景執行，請改用最新版 Chrome、Edge 或 Safari。'; fail(m); readyReject(new Error(m)); }
  if (worker) {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') return progress(m.text, m.pct);
      if (m.type === 'ready') { done(m.boot); return readyResolve(m.boot); }
      if (m.type === 'fatal') { fail(m.message); return readyReject(new Error(m.message)); }
      const resolve = pending.get(m.id); if (resolve) { pending.delete(m.id); resolve(m); }
    };
    worker.onerror = (e) => { const msg = e.message || '背景程式載入失敗'; fail(msg); readyReject(new Error(msg)); };
  }

  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    const i = url.pathname.indexOf('/api/');
    if (i < 0) return realFetch(input, init);
    const path = url.pathname.slice(i);
    const method = (init.method || 'GET').toUpperCase();
    await ready;
    const m = await new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); worker.postMessage({ id, method, path, body: init.body ?? null }); });
    return new Response(m.text, { status: m.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  };

  document.addEventListener('DOMContentLoaded', () => {
    bootCard();
    if (customBoot()) return;
    const tag = document.querySelector('.local-tag'); if (tag) tag.textContent = '網頁版 · 在你的瀏覽器裡運算';
    const foot = document.querySelector('footer'); if (foot && foot.firstChild) foot.firstChild.textContent = '公開牌況分析 · 隱藏資訊隔離 · 重新整理會結束目前牌局 ';
    const s = document.getElementById('status'); if (s) s.textContent = '正在瀏覽器裡準備牌桌（第一次約下載 15 MB）…';
  });
  window.addEventListener('beforeunload', (e) => {
    let unfinished = false;
    try { unfinished = typeof qz.hasUnfinishedGame === 'function' ? !!qz.hasUnfinishedGame() : !!(state && !state.finished); } catch { /* app not ready */ }
    if (unfinished) { e.preventDefault(); e.returnValue = ''; }
  });
})();
