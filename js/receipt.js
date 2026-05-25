'use strict';
// ══════════════════════════════════════════════════════════
// receipt.js — генератор предчека
// Рисует предчек на <canvas>, показывает как JPG в модальном
// окне. Кнопки: Сохранить (в галерею/загрузки), Поделиться.
// Воспроизводит логику receipt_pdf.py на стороне браузера.
// ══════════════════════════════════════════════════════════

// ── Реквизиты ─────────────────────────────────────────────
const RECEIPT_CARD   = "1090081048967";
const RECEIPT_LOGO   = "icons/logo.jpg";

// ── Цвета (повторяют receipt_pdf.py) ─────────────────────
const RC = {
  ink:     "#1A1A1A",
  dark:    "#3D3D3D",
  hint:    "#777777",
  rule:    "#D0D0D0",
  rowAlt:  "#F8F8F8",
  accent:  "#D85A30",
  accentL: "#FDF1EC",
  white:   "#FFFFFF",
  labelBg: "#F0F0F0",
  discBg:  "#FFF0F0",
  discFg:  "#C62828",
  delivBg: "#F2F2F2",
};

// Текущий blob предчека — используется кнопками Сохранить/Поделиться
let _receiptBlob = null;
let _receiptFilename = "предчек.jpg";

// ══════════════════════════════════════════════════════════
// ТОЧКА ВХОДА — вызывается из render.js / app.js
// ══════════════════════════════════════════════════════════
async function showReceiptModal(row) {
  const order = findOrder(row);
  if (!order) { showToast("Заказ не найден"); return; }

  // Показываем модал сразу со спиннером
  const modal = document.getElementById("receipt-modal");
  const body  = document.getElementById("receipt-modal-body");
  body.innerHTML = `<div class="receipt-spinner"><div class="spin"></div><div style="margin-top:12px;color:var(--hint);font-size:13px">Генерируем предчек…</div></div>`;
  modal.classList.add("on");

  // Блокируем кнопки пока не готово
  document.getElementById("rb-save").disabled  = true;
  document.getElementById("rb-share").disabled = true;

  try {
    const blob = await generateReceiptBlob(order);
    if (!blob) { showToast("⚠️ Ошибка генерации предчека"); closeReceiptModal(); return; }

    _receiptBlob = blob;
    _receiptFilename = `предчек_${(order.client || "заказ").replace(/\s+/g, "_")}_${order.event_date || ""}.jpg`.replace(/[\\/:*?"<>|]/g, "");

    const url = URL.createObjectURL(blob);
    body.innerHTML = `<img id="receipt-img" src="${url}" alt="Предчек" style="width:100%;display:block;border-radius:4px"/>`;

    document.getElementById("rb-save").disabled  = false;
    document.getElementById("rb-share").disabled = false;

  } catch (e) {
    console.error("[receipt]", e);
    showToast("⚠️ Ошибка: " + e.message);
    closeReceiptModal();
  }
}

function closeReceiptModal() {
  const modal = document.getElementById("receipt-modal");
  modal.classList.remove("on");
  // Освобождаем blob URL
  const img = document.getElementById("receipt-img");
  if (img && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  _receiptBlob = null;
}

// ── Сохранить в галерею / загрузки ────────────────────────
async function receiptSave() {
  if (!_receiptBlob) return;
  const url = URL.createObjectURL(_receiptBlob);
  const a   = document.createElement("a");
  a.href     = url;
  a.download = _receiptFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("✓ Предчек сохранён");
}

// ── Поделиться через Web Share API ───────────────────────
async function receiptShare() {
  if (!_receiptBlob) return;
  const file = new File([_receiptBlob], _receiptFilename, { type: "image/jpeg" });

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({
        title: "Предчек — Slaŭnaya Eža",
        files: [file],
      });
    } catch (e) {
      if (e.name !== "AbortError") showToast("⚠️ Не удалось поделиться");
    }
  } else {
    // Fallback — скачать
    await receiptSave();
    showToast("Поделиться недоступно — файл сохранён");
  }
}

// ══════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ПРЕДЧЕКА НА CANVAS → BLOB
// ══════════════════════════════════════════════════════════
async function generateReceiptBlob(order) {
  // Загружаем логотип заранее
  const logo = await _loadImage(RECEIPT_LOGO).catch(() => null);

  // Создаём измерительный canvas для подсчёта высоты
  const measureCanvas  = document.createElement("canvas");
  measureCanvas.width  = 794; // ~A4 width at 96dpi
  const mCtx = measureCanvas.getContext("2d");

  const W  = measureCanvas.width;
  const ML = 40;
  const MR = 40;
  const CW = W - ML - MR;

  // Считаем высоту — рисуем на dummy canvas высотой 10000px
  measureCanvas.height = 10000;
  const usedH = _drawReceipt(mCtx, order, logo, W, ML, MR, CW, 10000);

  // Реальная высота — не меньше A4 (1123px при 96dpi)
  const realH = Math.max(usedH + 20, 1123);

  // Финальный canvas
  const canvas   = document.createElement("canvas");
  canvas.width   = W;
  canvas.height  = realH;
  const ctx = canvas.getContext("2d");

  // Белый фон
  ctx.fillStyle = RC.white;
  ctx.fillRect(0, 0, W, realH);

  _drawReceipt(ctx, order, logo, W, ML, MR, CW, realH);

  // Конвертируем в blob
  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.92);
  });
}

// ══════════════════════════════════════════════════════════
// РИСОВАНИЕ — основная функция
// Возвращает Y-позицию после последнего элемента (для измерения высоты)
// ══════════════════════════════════════════════════════════
function _drawReceipt(ctx, order, logo, W, ML, MR, CW, canvasH) {
  let y = 20; // отступ сверху

  // ── ЛОГОТИП / ШАПКА ──────────────────────────────────
  if (logo) {
    const logoH = 130;
    const logoW = logoH * (logo.width / logo.height);
    ctx.drawImage(logo, (W - logoW) / 2, y, logoW, logoH);
    y += logoH + 10;
  } else {
    ctx.fillStyle = RC.ink;
    ctx.font = "bold 28px serif";
    ctx.textAlign = "center";
    ctx.fillText("Slaŭnaya Eža", W / 2, y + 28);
    y += 38;
    ctx.fillStyle = RC.hint;
    ctx.font = "14px sans-serif";
    ctx.fillText("cooking with love", W / 2, y);
    y += 20;
  }
  ctx.textAlign = "left";

  // Линия под шапкой
  _hline(ctx, ML, y, W - MR, RC.ink, 2);
  y += 14;

  // ── БЛОК КЛИЕНТА ─────────────────────────────────────
  const LROW_H = 20; // высота строки-лейбла
  const VROW_H = 34; // высота строки-значения

  // Дата создания предчека
  const today = new Date();
  const dateStr = [
    String(today.getDate()).padStart(2,"0"),
    String(today.getMonth()+1).padStart(2,"0"),
    today.getFullYear()
  ].join(".") + " " + String(today.getHours()).padStart(2,"0") + ":" + String(today.getMinutes()).padStart(2,"0");

  y = _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, "ДАТА ПРЕДЧЕКА", dateStr);
  y = _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, "КЛИЕНТ",        order.client || "—");

  const eventStr = (order.event_date || "—") + (order.event_time ? " в " + order.event_time : "");
  y = _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, "ДАТА МЕРОПРИЯТИЯ", eventStr);

  if (order.delivery_type === "Доставка") {
    y = _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, "СПОСОБ ПОЛУЧЕНИЯ", "Доставка");
    if (order.address) {
      y = _infoRowMultiline(ctx, ML, y, CW, LROW_H, "АДРЕС", order.address);
    }
  } else {
    y = _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, "СПОСОБ ПОЛУЧЕНИЯ", "Самовывоз");
  }

  if (order.note && order.note.trim()) {
    y = _infoRowMultiline(ctx, ML, y, CW, LROW_H, "ПРИМЕЧАНИЕ", order.note.trim());
  }

  y += 8;
  _hline(ctx, ML, y, W - MR, RC.ink, 2);
  y += 16;

  // ── ТАБЛИЦА БЛЮД ─────────────────────────────────────
  const C_SUM_R   = ML + CW;
  const C_PRICE_R = C_SUM_R   - 80;
  const C_QTY_R   = C_PRICE_R - 72;
  const NAME_W    = C_QTY_R   - ML - 8 - 40;

  // Заголовок таблицы
  ctx.fillStyle = RC.dark;
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("НАИМЕНОВАНИЕ",      ML + 4,      y + 13);
  _rtxt(ctx, "КОЛ-ВО",  C_QTY_R,   y + 13, "bold 11px sans-serif", RC.dark);
  _rtxt(ctx, "ЦЕНА",    C_PRICE_R,  y + 13, "bold 11px sans-serif", RC.dark);
  _rtxt(ctx, "СУММА",   C_SUM_R,    y + 13, "bold 11px sans-serif", RC.dark);
  y += 18;
  _hline(ctx, ML, y, W - MR, RC.ink, 1);
  y += 2;

  const dishes   = order.dishes || [];
  let   subtotal = 0;

  dishes.forEach((dish, i) => {
    const name  = dish.name  || "";
    const unit  = dish.unit  || "шт";
    const qty   = parseFloat(dish.qty)   || 1;
    const price = parseFloat(dish.price) || 0;
    const lineT = qty * price;
    subtotal   += lineT;

    const nameLines = _wrapText(ctx, name, "13px sans-serif", NAME_W);
    const ROW_H = Math.max(34, nameLines.length * 18 + 10);

    // Чередование фона
    ctx.fillStyle = i % 2 === 0 ? RC.rowAlt : RC.white;
    ctx.fillRect(ML, y, CW, ROW_H);

    // Название (возможно многострочное)
    ctx.fillStyle = RC.ink;
    ctx.font = "13px sans-serif";
    const textTop = y + (ROW_H - nameLines.length * 18) / 2 + 14;
    nameLines.forEach((ln, li) => ctx.fillText(ln, ML + 4, textTop + li * 18));

    // Кол-во, цена, сумма
    const midY = y + ROW_H / 2 + 5;
    const qtyStr = (qty === Math.floor(qty)) ? String(Math.floor(qty)) : String(qty);
    _rtxt(ctx, `${qtyStr} ${unit}`,       C_QTY_R,   midY, "12px sans-serif",      RC.dark);
    _rtxt(ctx, price.toFixed(2),           C_PRICE_R, midY, "12px sans-serif",      RC.dark);
    _rtxt(ctx, lineT.toFixed(2),           C_SUM_R,   midY, "bold 12px sans-serif", RC.ink);

    y += ROW_H;
  });

  _hline(ctx, ML, y, W - MR, RC.ink, 1);
  y += 8;

  // ── ИТОГОВЫЕ СТРОКИ ───────────────────────────────────
  y = _sumRow(ctx, ML, CW, y, "Итого по блюдам:", subtotal.toFixed(2) + " BYN", true);

  const discP = parseFloat(order.discount_percent) || 0;
  const discA = parseFloat(order.discount_amount)  || (discP > 0 ? subtotal * discP / 100 : 0);
  if (discP > 0) {
    ctx.fillStyle = RC.discBg;
    ctx.fillRect(ML, y, CW, 28);
    y = _sumRow(ctx, ML, CW, y, `Скидка ${discP}%:`, "−" + discA.toFixed(2) + " BYN", false, RC.discFg);
  }

  const delivery = parseFloat(order.delivery) || 0;
  if (delivery > 0) {
    ctx.fillStyle = RC.delivBg;
    ctx.fillRect(ML, y, CW, 28);
    y = _sumRow(ctx, ML, CW, y, "Доставка:", delivery.toFixed(2) + " BYN");
  }

  y += 6;

  // Оранжевый блок ИТОГО
  const total  = parseFloat(order.total) || (subtotal + delivery - discA);
  const TOTAL_H = 44;
  _roundRect(ctx, ML, y, CW, TOTAL_H, 6, RC.accent);
  ctx.fillStyle = RC.white;
  ctx.font = "bold 14px sans-serif";
  ctx.fillText("ИТОГО К ОПЛАТЕ", ML + 12, y + TOTAL_H * 0.6);
  ctx.font = "bold 20px sans-serif";
  _rtxt(ctx, total.toFixed(2) + " BYN", W - MR, y + TOTAL_H * 0.6, "bold 20px sans-serif", RC.white);
  y += TOTAL_H + 14;

  // ── БЛОК ОПЛАТЫ ───────────────────────────────────────
  _hline(ctx, ML, y, W - MR, RC.rule, 1);
  y += 12;

  // Пилюля-лейбл ОПЛАТА
  _pill(ctx, ML, y, "ОПЛАТА");
  y += 28;

  const prepay = order.prepayment !== false;
  ctx.fillStyle = RC.ink;
  ctx.font = "13px sans-serif";
  if (prepay) {
    const prepaySum = (total / 2).toFixed(2);
    ctx.fillText(`Работа по предоплате — не менее 50% (${prepaySum} BYN).`, ML, y);
    y += 20;
    ctx.fillText("Заказ подтверждается после поступления предоплаты.", ML, y);
    y += 28;
  } else {
    ctx.fillText("Оплата по факту доставки — наличными или переводом.", ML, y);
    y += 28;
  }

  // Блок ЕРИП
  _pill(ctx, ML, y, "КАК ОПЛАТИТЬ ЧЕРЕЗ ЕРИП");
  y += 28;

  const eripSteps = [
    "1. Банковские, финансовые услуги",
    "2. Банки, НКФО  →  Приорбанк",
    "3. Пополнение карты",
  ];
  ctx.font = "13px sans-serif";
  ctx.fillStyle = RC.ink;
  eripSteps.forEach(step => {
    ctx.fillText(step, ML, y);
    y += 20;
  });

  // Строка с номером карты (жирный + подчёркивание)
  const prefix = "4. Номер карты:  ";
  ctx.font = "13px sans-serif";
  ctx.fillStyle = RC.ink;
  ctx.fillText(prefix, ML, y);
  const prefW = ctx.measureText(prefix).width;
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(RECEIPT_CARD, ML + prefW, y);
  const cardW = ctx.measureText(RECEIPT_CARD).width;
  ctx.strokeStyle = RC.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ML + prefW, y + 2);
  ctx.lineTo(ML + prefW + cardW, y + 2);
  ctx.stroke();
  y += 30;

  // ── ФУТЕР ────────────────────────────────────────────
  _hline(ctx, ML, y, W - MR, RC.rule, 1);
  y += 16;
  ctx.fillStyle = RC.dark;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Slaŭnaya Eža  ·  cooking with love  ·  Дзякуй за ваш заказ!", W / 2, y);
  ctx.textAlign = "left";
  y += 24;

  return y; // возвращаем итоговую Y для измерения высоты
}

// ══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ПРИМИТИВЫ CANVAS
// ══════════════════════════════════════════════════════════

// Горизонтальная линия
function _hline(ctx, x1, y, x2, color, lw) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = lw;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
  ctx.restore();
}

// Текст с выравниванием по правому краю
function _rtxt(ctx, text, x, y, font, color) {
  ctx.save();
  ctx.font      = font;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Перенос текста по ширине
function _wrapText(ctx, text, font, maxW) {
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

// Строка инфо-блока: лейбл + значение (однострочные)
function _infoRow(ctx, ML, y, CW, LROW_H, VROW_H, label, value) {
  ctx.fillStyle = RC.labelBg;
  ctx.fillRect(ML, y, CW, LROW_H);
  ctx.fillStyle = RC.dark;
  ctx.font = "bold 9px sans-serif";
  ctx.fillText(label, ML + 8, y + LROW_H * 0.7);
  y += LROW_H;

  ctx.fillStyle = RC.white;
  ctx.fillRect(ML, y, CW, VROW_H);
  ctx.fillStyle = RC.ink;
  ctx.font = "13px sans-serif";
  ctx.fillText(String(value || "—"), ML + 8, y + VROW_H * 0.62);
  y += VROW_H;
  return y;
}

// Строка инфо-блока: лейбл + многострочное значение
function _infoRowMultiline(ctx, ML, y, CW, LROW_H, label, value) {
  ctx.fillStyle = RC.labelBg;
  ctx.fillRect(ML, y, CW, LROW_H);
  ctx.fillStyle = RC.dark;
  ctx.font = "bold 9px sans-serif";
  ctx.fillText(label, ML + 8, y + LROW_H * 0.7);
  y += LROW_H;

  const lines = _wrapText(ctx, value, "13px sans-serif", CW - 16);
  const LINE_H = 18;
  const rowH   = Math.max(34, lines.length * LINE_H + 10);
  ctx.fillStyle = RC.white;
  ctx.fillRect(ML, y, CW, rowH);
  ctx.fillStyle = RC.ink;
  ctx.font = "13px sans-serif";
  const textTop = y + (rowH - lines.length * LINE_H) / 2 + LINE_H * 0.75;
  lines.forEach((ln, i) => ctx.fillText(ln, ML + 8, textTop + i * LINE_H));
  y += rowH;
  return y;
}

// Строка итогов
function _sumRow(ctx, ML, CW, y, label, value, bold = false, valueColor = null) {
  const H = 28;
  ctx.fillStyle = bold ? RC.dark : RC.hint;
  ctx.font = "12px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(label, ML + CW - 80, y + H * 0.62);
  ctx.fillStyle = valueColor || RC.ink;
  ctx.font = bold ? "bold 13px sans-serif" : "13px sans-serif";
  ctx.fillText(value, ML + CW, y + H * 0.62);
  ctx.textAlign = "left";
  return y + H;
}

// Скруглённый прямоугольник (заливка)
function _roundRect(ctx, x, y, w, h, r, fill) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y,         x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Пилюля-лейбл (серый фон, тёмный текст)
function _pill(ctx, x, y, text) {
  ctx.font = "bold 10px sans-serif";
  const tw  = ctx.measureText(text).width;
  const ph  = 18, pw = tw + 16, pr = 4;
  _roundRect(ctx, x, y - 14, pw, ph, pr, RC.labelBg);
  ctx.fillStyle = RC.dark;
  ctx.fillText(text, x + 8, y - 14 + ph * 0.68);
}

// Загрузка изображения (Promise)
function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить: " + src));
    img.src = src;
  });
}
