'use strict';
// ══════════════════════════════════════════════════════════
// sw.js — Service Worker для Slaŭnaya Eža PWA
// Стратегия: App Shell кэшируется при установке,
// GAS-запросы идут network-first с fallback на cache.
// ══════════════════════════════════════════════════════════

const CACHE_VERSION = '1.7.0'; // v1.7: фикс AI-бага (applyAIResultToForm + GAS default "") + корректная бакингация ?v=
const CACHE_NAME    = 'slaunaya-shell-' + CACHE_VERSION;
const GAS_CACHE     = 'slaunaya-gas-'   + CACHE_VERSION;

// Файлы App Shell — кэшируются при установке SW.
// ВАЖНО: подключаем ТОЛЬКО shell-минимум (HTML + манифест + лого).
// JS/CSS НЕprefetch'им: они подключаются в index.html с ?v=12,
// и cacheFirstShell сам подтянет их при первом запросе под корректным
// cache-key (с учётом query). Prefetch без ?v= лёг бы мёртвым грузом —
// cache.match('/js/api.js?v=12') его не находил бы.
const SHELL_FILES = [
  '/Slaunaya_eza/',
  '/Slaunaya_eza/index.html',
  '/Slaunaya_eza/icons/logo.png',
  '/Slaunaya_eza/manifest.json',
];

// ── Установка: кэшируем App Shell ────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('[SW] Shell cache error:', err))
  );
});

// ── Активация: удаляем старые кэши ───────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME && k !== GAS_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: логика обработки запросов ─────────────────────
self.addEventListener('fetch', event => {
  const url    = event.request.url;
  const method = event.request.method;
  //-html-навигация (index.html) — network-first, чтобы новые версии
  // деплоя подхватывались мгновенно, а не «залипали» в кеше на 1.6.x:
  if (method === 'GET' && event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  // GAS-запросы: network-first, при ошибке — кэш
  if (url.includes('script.google.com') || url.includes('googleapis.com')) {
    event.respondWith(networkFirstGAS(event.request));
    return;
  }

  // GitHub Pages cache: cache-first для статики (но С УЧЕТОМ ?v= бьюстера)
  if (url.includes('vearjkeee.github.io') || url.includes('github.io')) {
    event.respondWith(cacheFirstShell(event.request));
    return;
  }
});

// ── Network-first для навигации (index.html) ──────────────
// Сеть жива → отдаём свежий HTML (с новыми ?v= на JS) и обновляем кеш.
// Offline → отдаём закешированный shell (install-заполняется при первом визите).
async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const fresh = await fetch(request, { redirect: 'follow' });
    if (fresh.ok) {
      // Кладём ПОД URL запроса — иначе.match(request) рубит офлайн.
      cache.put(request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    // Точная попытка → fallback на index.html под корень → под любой:
    const cached =
      (await cache.match(request)) ||
      (await cache.match(new Request('/Slaunaya_eza/index.html'))) ||
      (await cache.match(new Request('/Slaunaya_eza/'))) ||
      (await cache.match(new Request('/')));
    return cached || new Response('Offline', { status: 503 });
  }
}

// ── Network-first для GAS (данные) ───────────────────────
async function networkFirstGAS(request) {
  const cache = await caches.open(GAS_CACHE);
  try {
    const response = await fetch(request.clone(), { redirect: 'follow' });
    if (response.ok) {
      // Кэшируем только GET getData — основной дата-запрос
      if (request.method === 'GET' && request.url.includes('action=getData')) {
        cache.put(request, response.clone());
      }
    }
    return response;
  } catch (err) {
    // Сеть недоступна — пробуем кэш
    const cached = await cache.match(request);
    if (cached) return cached;
    // Совсем нет ничего — возвращаем офлайн-заглушку
    return new Response(
      JSON.stringify({ error: 'offline', _offline: true }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Cache-first для статических файлов ───────────────────
// ВАЖНО: НЕ используем ignoreSearch (старый баг). Раньше app.js?v=11 и
// app.js?v=12 попадали в ОДИН cache-slot — bump версии в index.html
// не освобождал пользователя от старой JS-копии. Теперь ?v= — часть ключа.
async function cacheFirstShell(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    // Последняя попытка: статика без query (на случай если первый заход был без ?v=).
    const fallback = await caches.match(request, { ignoreSearch: true });
    if (fallback) return fallback;
    return new Response('Offline', { status: 503 });
  }
}
