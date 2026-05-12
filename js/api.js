'use strict';
// ══════════════════════════════════════════════════════════
// api.js — общение с GAS, GitHub-кешем и Telegram-ботом
// ══════════════════════════════════════════════════════════

// ── Заполнить после деплоя GAS ────────────────────────────
const GAS_URL   = "https://script.google.com/macros/s/AKfycbz3sodPD-Wj-6jyhqHon2vLx403H1ZDca3PrLRl1VokqezcChVHb1V_rj6yZqyAgk66/exec";  // "https://script.google.com/macros/s/ВАШ_ID/exec"
const CACHE_URL = "https://vearjkeee.github.io/Slaunaya_eza/menu_cache.json";

// ── Telegram Web App ──────────────────────────────────────
const twa = window.Telegram?.WebApp;
if (twa) { twa.ready(); twa.expand(); }

function sendToBot(data) {
  if (twa) {
    twa.sendData(JSON.stringify(data));
  } else {
    console.log("[sendToBot]", data);
  }
}

// ══════════════════════════════════════════════════════════
// ЗАГРУЗКА ДАННЫХ
// GAS (приоритет, почти реальное время) → GitHub (fallback)
// ══════════════════════════════════════════════════════════
async function fetchData(force = false) {
  // 1. GAS — свежие данные
  if (GAS_URL) {
    try {
      const url = GAS_URL + "?action=getData" + (force ? "&t=" + Date.now() : "");
      const r   = await fetch(url, { redirect: "follow" });
      if (r.ok) {
        const data = await r.json();
        if (!data.error) {
          return { data, source: data._cached ? "gas-cache" : "gas-live" };
        }
      }
    } catch (e) {
      console.warn("[api] GAS error:", e);
    }
  }

  // 2. GitHub Pages — обновляется каждые 5 мин ботом
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
