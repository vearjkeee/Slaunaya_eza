'use strict';
// ══════════════════════════════════════════════════════════
// api.js — общение с GAS
// Telegram WebApp полностью убран.
// Все запросы подписываются токеном APP_SECRET.
// ══════════════════════════════════════════════════════════

const GAS_URL   = "https://script.google.com/macros/s/AKfycbz3sodPD-Wj-6jyhqHon2vLx403H1ZDca3PrLRl1VokqezcChVHb1V_rj6yZqyAgk66/exec";
const CACHE_URL = "https://vearjkeee.github.io/Slaunaya_eza/menu_cache.json";

// ── Токен авторизации ─────────────────────────────────────
// Тот же токен должен быть прописан в GAS Script Properties
// как APP_SECRET = mX7kR2pQ9nL4
const APP_SECRET = "mX7kR2pQ9nL4";

// ── Регистрация Service Worker ────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/Slaunaya_eza/sw.js')
      .then(reg => {
        console.log('[SW] registered, scope:', reg.scope);
        
        // Проверяем наличие обновлений кода в фоне
        reg.onupdatefound = () => {
          const installingWorker = reg.installing;
          installingWorker.onstatechange = () => {
            if (installingWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                // Если новая версия скачалась, уведомляем и мягко перезагружаем страницу
                if (typeof showToast === 'function') {
                  showToast("✨ Приложение обновлено до новой версии!");
                }
                setTimeout(() => {
                  window.location.reload();
                }, 1500);
              }
            }
          };
        };
      })
      .catch(err => console.warn('[SW] registration failed:', err));
  });
}

// ══════════════════════════════════════════════════════════
// ЗАГРУЗКА ДАННЫХ
// GAS (приоритет) → GitHub cache (fallback)
// ══════════════════════════════════════════════════════════
async function fetchData(force = false) {

  // 1. GAS — свежие данные
  if (GAS_URL) {
    try {
      const url = GAS_URL
        + "?action=getData"
        + "&secret=" + APP_SECRET
        + (force ? "&t=" + Date.now() : "");
      const r = await fetch(url, { redirect: "follow" });
      if (r.ok) {
        const data = await r.json();
        if (!data.error) {
          return { data, source: data._cached ? "gas-cache" : "gas-live" };
        }
        // GAS вернул ошибку авторизации или другую — логируем
        console.warn("[api] GAS error response:", data.error);
      }
    } catch (e) {
      console.warn("[api] GAS fetch error:", e);
    }
  }

  // 2. GitHub Pages — обновляется ботом каждые 5 мин
  try {
    const url = CACHE_URL + "?t=" + (force ? Date.now() : Math.floor(Date.now() / 60000));
    const r   = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      return { data, source: "github" };
    }
  } catch (e) {
    console.warn("[api] GitHub cache error:", e);
  }

  return null;
}

function sourceLabel(source) {
  if (source === "gas-live")  return " · 🟢 онлайн";
  if (source === "gas-cache") return " · 🟡 кеш";
  return " · ⚪ GitHub";
}

// ══════════════════════════════════════════════════════════
// ДАШБОРД
// ══════════════════════════════════════════════════════════
async function fetchDashboard(month, year) {
  if (!GAS_URL) return null;
  try {
    const url = `${GAS_URL}?action=getDashboard&month=${month}&year=${year}&secret=${APP_SECRET}&t=${Date.now()}`;
    const r   = await fetch(url, { redirect: "follow" });
    if (r.ok) {
      const data = await r.json();
      if (!data.error) return data;
    }
  } catch (e) {
    console.warn("[api] dashboard error:", e);
  }
  return null;
}

// ══════════════════════════════════════════════════════════
// ОТПРАВКА ДЕЙСТВИЙ В GAS
// Фоновая отправка без закрытия приложения.
// Все POST-запросы включают secret-токен.
// ══════════════════════════════════════════════════════════
async function sendActionToGAS(data) {
  if (typeof showLoadingOverlay === "function") showLoadingOverlay("Сохранение изменений...");
  try {
    // Добавляем токен к каждому запросу
    const payload = { ...data, secret: APP_SECRET };

    const response = await fetch(GAS_URL, {
      method: "POST",
      redirect: "follow",
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const resData = await response.json();

      if (resData && !resData.error) {
        // Обновляем глобальные массивы свежими данными от GAS
        if (resData.menu)           MENU           = resData.menu;
        if (resData.clients)        CLIENTS        = resData.clients;
        if (resData.active_orders)  ACTIVE_ORDERS  = resData.active_orders;
        if (resData.archive_orders) ARCHIVE_ORDERS = resData.archive_orders;
        if (resData.shopping_list)  SHOPPING       = resData.shopping_list;

        // Переписываем локальный оффлайн-кэш
        if (typeof saveLocalCache === "function") saveLocalCache(resData);

        // Обновляем интерфейс
        if (typeof updateAllBadges    === "function") updateAllBadges();
        if (typeof renderCurrentTab   === "function") renderCurrentTab();

        return resData; // возвращаем весь объект, не просто true
      } else {
        if (typeof showToast === "function") showToast("⚠️ Ошибка: " + (resData.error || "неизвестно"));
      }
    } else {
      if (typeof showToast === "function") showToast("⚠️ Ошибка сервера: " + response.status);
    }
  } catch (e) {
    console.error("[sendActionToGAS] Error:", e);
    if (typeof showToast === "function") showToast("⚠️ Ошибка соединения");
  } finally {
    if (typeof hideLoadingOverlay === "function") hideLoadingOverlay();
  }
  return null;
}
