'use strict';
// ══════════════════════════════════════════════════════════
// sheet.js — Генератор «Листа кухни» (JPG)
// Для каждого выбранного заказа: клиент/дата/доставка + таблица блюд (без цен).
// Несколько заказов — стопкой на одном canvas.
// Показ через модалку #receipt-modal (переиспользуем сохранение/шаринг).
// ══════════════════════════════════════════════════════════

const SHEET_LOGO = "icons/logo.png";

// Коэффициенты перевода (как в receipt.js)
const SH_PT_MM = 2.834645; // 1 мм в пунктах
const SH_W     = 595.27;    // Ширина A4 в пунктах
const SH_ML    = 14 * SH_PT_MM; // поле слева
const SH_MR    = 14 * SH_PT_MM; // поле справа
const SH_CW    = SH_W - SH_ML - SH_MR; // ширина контента

// Палитра (мягче, чем предчек — рабочий документ кухни)
const SHC = {
  ink:    "#1A1A1A",
  dark:   "#3D3D3D",
  hint:   "#777777",
  rule:   "#D0D0D0",
  rowAlt: "#F8F8F8",
  accent: "#D85A30",
  accentL:"#FDF1EC",
  white:  "#FFFFFF",
  labelBg:"#F2F2F2",
};

let _sheetBlob = null;
let _sheetFilename = "лист_кухни.jpg";
let _sheetURL = null; // #6: активный blob URL — revoke перед каждым новым createObjectURL

// ══════════════════════════════════════════════════════════
// ТОЧКА ВХОДА — открыть модалку с листом
// ══════════════════════════════════════════════════════════
async function showSheetModal(orders) {
  const modal = document.getElementById("receipt-modal");
  const body  = document.getElementById("receipt-modal-body");
  // Подменим заголовок модалки
  const titleEl = modal.querySelector(".receipt-modal-title");
  if (titleEl) titleEl.textContent = "Лист кухни";

  body.innerHTML = `<div class="receipt-spinner"><div class="spin"></div><div style="margin-top:12px;color:var(--hint);font-size:13px">Генерируем лист кухни…</div></div>`;
  modal.classList.add("on");

  // P5: подменяем обработчики кнопок на sheet-версии (восстанавливаются в showReceiptModal)
  const saveBtn  = document.getElementById("rb-save");
  const shareBtn = document.getElementById("rb-share");
  saveBtn.onclick  = sheetSave;
  shareBtn.onclick = sheetShare;
  saveBtn.disabled  = true;
  shareBtn.disabled = true;

  setTimeout(async () => {
    try {
      const blob = await generateSheetBlob(orders);
      if (!blob) { showToast("⚠️ Ошибка генерации листа"); closeReceiptModal(); return; }

      _sheetBlob = blob;
      const datePart = new Date().toISOString().slice(0,10);
      _sheetFilename = `лист_кухни_${datePart}_${orders.length}заказ(ов).jpg`.replace(/\s+/g,"_");

      // #6: освобождаем предыдущий blob URL перед созданием нового
      if (_sheetURL) { URL.revokeObjectURL(_sheetURL); _sheetURL = null; }
      const url = URL.createObjectURL(blob);
      _sheetURL = url;
      body.innerHTML = `<img id="receipt-img" src="${url}" alt="Лист кухни" style="width:100%;display:block;border-radius:4px"/>`;

      document.getElementById("rb-save").disabled  = false;
      document.getElementById("rb-share").disabled = false;
    } catch (e) {
      console.error("[sheet]", e);
      showToast("⚠️ Ошибка: " + e.message);
      closeReceiptModal();
    }
  }, 150);
}

// ══════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ВЫСОКОГО РАЗРЕШЕНИЯ (3x scale)
// ══════════════════════════════════════════════════════════
async function generateSheetBlob(orders) {
  const logo = await _sheetLoadImage(SHEET_LOGO).catch(() => null);

  // 1. Измеряем высоту
  const measureCanvas = document.createElement("canvas");
  measureCanvas.width = SH_W;
  const mCtx = measureCanvas.getContext("2d");
  const usedH = _drawSheet(mCtx, orders, logo, 100000);
  const realLogicalH = Math.max(usedH + 10, 841.89);

  // 2. Рисуем в высоком разрешении
  const SCALE = 3;
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(SH_W * SCALE);
  canvas.height = Math.round(realLogicalH * SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(SCALE, SCALE);

  ctx.fillStyle = SHC.white;
  ctx.fillRect(0, 0, SH_W, realLogicalH);

  _drawSheet(ctx, orders, logo, realLogicalH);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.95);
  });
}

// ══════════════════════════════════════════════════════════
// СИНХРОННАЯ ОТРИСОВКА
// ══════════════════════════════════════════════════════════
function _drawSheet(ctx, orders, logo, canvasH) {
  let y = 14 * SH_PT_MM;

  // ── Логотип (маленький, слева) + заголовок справа ──
  if (logo) {
    const logoH = 16 * SH_PT_MM;
    const logoW = logoH * (logo.width / logo.height);
    ctx.drawImage(logo, SH_ML, y, logoW, logoH);
  }
  ctx.fillStyle = SHC.ink;
  ctx.font = "bold 18pt Georgia, serif";
  ctx.textAlign = "right";
  ctx.fillText("Лист кухни", SH_W - SH_MR, y + 16 * SH_PT_MM - 4);
  ctx.textAlign = "left";
  y += 20 * SH_PT_MM;

  // Дата генерации
  const today = new Date();
  const dateStr = [
    String(today.getDate()).padStart(2, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    today.getFullYear()
  ].join(".");
  ctx.fillStyle = SHC.hint;
  ctx.font = "8pt sans-serif";
  ctx.fillText("Сформирован: " + dateStr + "  ·  заказов: " + orders.length, SH_ML, y);
  y += 6 * SH_PT_MM;

  // Тонкая линия
  _shHairline(ctx, SH_ML, y, SH_W - SH_MR, 0.8, SHC.ink);
  y += 6 * SH_PT_MM;

  // ── Блоки заказов ──
  orders.forEach((order, idx) => {
    y = _drawSheetOrderBlock(ctx, order, y, idx, orders.length);
  });

  // Подвал
  y += 4 * SH_PT_MM;
  _shHairline(ctx, SH_ML, y, SH_W - SH_MR, 0.4, SHC.rule);
  y += 6 * SH_PT_MM;
  ctx.fillStyle = SHC.hint;
  ctx.font = "8pt sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Slaŭnaya eža  ·  лист кухни  ·  Дзякуй за работу!", SH_W / 2, y);
  ctx.textAlign = "left";

  return y;
}

// ── Один блок заказа ──
function _drawSheetOrderBlock(ctx, order, y, idx, total) {
  const pad = 3 * SH_PT_MM;

  // Номер заказа
  ctx.fillStyle = SHC.accent;
  ctx.font = "bold 9pt sans-serif";
  ctx.fillText("ЗАКАЗ " + (idx + 1) + " / " + total, SH_ML, y + 4 * SH_PT_MM);
  y += 7 * SH_PT_MM;

  // Шапка: клиент (крупно) + дата/время справа
  ctx.fillStyle = SHC.ink;
  ctx.font = "bold 13pt sans-serif";
  ctx.textAlign = "left";
  const clientLines = _shWrap(ctx, order.client || "—", "bold 13pt sans-serif", SH_CW * 0.6);
  clientLines.forEach((ln, i) => {
    ctx.fillText(ln, SH_ML, y + 4 * SH_PT_MM + i * 5 * SH_PT_MM);
  });

  ctx.textAlign = "right";
  ctx.fillStyle = SHC.dark;
  ctx.font = "10pt sans-serif";
  const evDate = order.event_date || "—";
  const evTime = order.event_time || "";
  const dateLine = evDate + (evTime ? " в " + evTime : "");
  ctx.fillText("📅 " + dateLine, SH_W - SH_MR, y + 4 * SH_PT_MM);
  ctx.textAlign = "left";
  y += 8 * SH_PT_MM;

  // Доставка / адрес
  ctx.fillStyle = SHC.dark;
  ctx.font = "9pt sans-serif";
  const deliv = order.delivery_type === "Доставка" && order.address
    ? "🚗 Доставка · " + order.address
    : "🚗 " + (order.delivery_type || "Самовывоз");
  const delivLines = _shWrap(ctx, deliv, "9pt sans-serif", SH_CW);
  delivLines.forEach(ln => {
    ctx.fillText(ln, SH_ML, y + 4 * SH_PT_MM);
    y += 5 * SH_PT_MM;
  });
  y += 2 * SH_PT_MM;

  // Примечание (если есть) — перед таблицей, чтобы повар видел сразу
  const note = (order.note || "").trim();
  if (note) {
    ctx.fillStyle = SHC.labelBg;
    ctx.fillRect(SH_ML, y, SH_CW, 6 * SH_PT_MM);
    ctx.fillStyle = SHC.dark;
    ctx.font = "bold 7.5pt sans-serif";
    ctx.fillText("ПРИМЕЧАНИЕ", SH_ML + pad, y + 4 * SH_PT_MM);
    y += 6 * SH_PT_MM;
    ctx.fillStyle = SHC.ink;
    ctx.font = "9pt sans-serif";
    const noteLines = _shWrap(ctx, note, "9pt sans-serif", SH_CW - pad * 2);
    noteLines.forEach(ln => {
      ctx.fillText(ln, SH_ML + pad, y + 4 * SH_PT_MM);
      y += 5 * SH_PT_MM;
    });
    y += 3 * SH_PT_MM;
  }

  // Таблица блюд (без цен — кухня не нужна)
  const dishes = order.dishes || [];
  // Заголовок таблицы
  const thH = 6 * SH_PT_MM;
  ctx.fillStyle = SHC.labelBg;
  ctx.fillRect(SH_ML, y, SH_CW, thH);
  ctx.fillStyle = SHC.dark;
  ctx.font = "bold 8pt sans-serif";
  ctx.fillText("№", SH_ML + pad, y + thH * 0.65);
  ctx.fillText("НАИМЕНОВАНИЕ", SH_ML + pad + 8 * SH_PT_MM, y + thH * 0.65);
  _shRtxt(ctx, "КОЛ-ВО", SH_W - SH_MR, y + thH * 0.65, "bold 8pt sans-serif", SHC.dark);
  y += thH;

  if (!dishes.length) {
    ctx.fillStyle = SHC.white;
    ctx.fillRect(SH_ML, y, SH_CW, 7 * SH_PT_MM);
    ctx.fillStyle = SHC.hint;
    ctx.font = "9pt sans-serif";
    ctx.fillText("Состав не загружен", SH_ML + pad, y + 5 * SH_PT_MM);
    y += 7 * SH_PT_MM;
  } else {
    const nameW = SH_CW - 8 * SH_PT_MM - 30 * SH_PT_MM - pad; // № + колонка кол-во + отступы
    dishes.forEach((d, i) => {
      const name  = d.name || "";
      const unit  = d.unit || "";
      const qty   = parseFloat(d.qty) || 1;
      const qtyStr = (qty === Math.floor(qty)) ? String(Math.floor(qty)) : String(qty);
      const nameLines = _shWrap(ctx, name, "9.5pt sans-serif", nameW);
      const rowH = Math.max(6.5 * SH_PT_MM, nameLines.length * 4.5 * SH_PT_MM + 2 * SH_PT_MM);

      ctx.fillStyle = (i % 2 === 0) ? SHC.rowAlt : SHC.white;
      ctx.fillRect(SH_ML, y, SH_CW, rowH);

      const textBlockH = nameLines.length * 4.5 * SH_PT_MM;
      const textTop = y + (rowH - textBlockH) / 2 + 4.5 * SH_PT_MM * 0.72;

      ctx.fillStyle = SHC.hint;
      ctx.font = "8pt sans-serif";
      ctx.fillText(String(i + 1), SH_ML + pad, textTop);

      ctx.fillStyle = SHC.ink;
      ctx.font = "9.5pt sans-serif";
      nameLines.forEach((ln, li) => {
        ctx.fillText(ln, SH_ML + pad + 8 * SH_PT_MM, textTop + li * 4.5 * SH_PT_MM);
      });

      _shRtxt(ctx, qtyStr + " " + unit, SH_W - SH_MR, y + rowH / 2, "9pt sans-serif", SHC.dark);
      y += rowH;
    });
  }

  // Разделитель между заказами
  y += 4 * SH_PT_MM;
  if (idx < total - 1) {
    _shHairline(ctx, SH_ML, y, SH_W - SH_MR, 1.2, SHC.accent);
    y += 8 * SH_PT_MM;
  }

  return y;
}

// ══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ
// ══════════════════════════════════════════════════════════
function _shHairline(ctx, x1, y, x2, lw, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

function _shRtxt(ctx, text, x, y, font, color) {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.textBaseline = "alphabetic";
  ctx.restore();
}

function _shWrap(ctx, text, font, maxW) {
  ctx.font = font;
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const word of words) {
    const test = cur ? cur + " " + word : word;
    if (ctx.measureText(test).width <= maxW) {
      cur = test;
    } else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [String(text)];
}

function _sheetLoadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить логотип: " + src));
    img.src = src;
  });
}

// ══════════════════════════════════════════════════════════
// СОХРАНЕНИЕ / ШАРИНГ (аналог receiptSave/receiptShare, но для листа)
// ══════════════════════════════════════════════════════════
async function sheetSave() {
  if (!_sheetBlob) return;
  const url = URL.createObjectURL(_sheetBlob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = _sheetFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("✓ Лист кухни сохранён");
}

async function sheetShare() {
  if (!_sheetBlob) return;
  const file = new File([_sheetBlob], _sheetFilename, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: "Лист кухни — Slaŭnaya Eža",
        text: "Лист кухни на " + new Date().toLocaleDateString("ru-RU"),
        files: [file],
      });
    } catch (e) {
      if (e.name !== "AbortError") showToast("⚠️ Не удалось поделиться");
    }
  } else {
    await sheetSave();
    showToast("Поделиться недоступно — файл сохранён");
  }
}
