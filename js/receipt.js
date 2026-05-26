'use strict';
// ══════════════════════════════════════════════════════════
// receipt.js — Генератор предчека (Рендеринг под оригинал PDF)
// Точное соответствие шрифтов, цветов, двухколоночной верстки и размеров из receipt_pdf.py.
// Рендерится в высоком разрешении (High-DPI / 300 DPI)
// ══════════════════════════════════════════════════════════

const RECEIPT_CARD   = "1090081048967";
const RECEIPT_LOGO   = "icons/logo.png";

// Коэффициенты перевода ReportLab (points)
const PT_MM = 2.834645; // 1 мм в пунктах
const W     = 595.27;    // Ширина A4 в пунктах
const ML    = 14 * PT_MM; // Поля слева (39.68pt)
const MR    = 14 * PT_MM; // Поля справа
const CW    = W - ML - MR; // Ширина контента (515.9pt)

// Оригинальная палитра цветов из receipt_pdf.py
const RC = {
  ink:     "#1A1A1A",
  dark:    "#3D3D3D",
  hint:    "#777777",
  rule:    "#D0D0D0",
  rowAlt:  "#F8F8F8",
  accent:  "#D85A30",
  accentL: "#FDF1EC",
  white:   "#FFFFFF",
  labelBg: "#F2F2F2",
  discBg:  "#FFF0F0",
  discFg:  "#C62828",
  delivBg: "#F2F2F2",
};

let _receiptBlob = null;
let _receiptFilename = "предчек.jpg";

// ══════════════════════════════════════════════════════════
// ТОЧКА ВХОДА — Открытие модального окна
// ══════════════════════════════════════════════════════════
async function showReceiptModal(row) {
  const order = findOrder(row);
  if (!order) { showToast("Заказ не найден"); return; }

  const modal = document.getElementById("receipt-modal");
  const body  = document.getElementById("receipt-modal-body");
  body.innerHTML = `<div class="receipt-spinner"><div class="spin"></div><div style="margin-top:12px;color:var(--hint);font-size:13px">Генерируем предчек высокого качества…</div></div>`;
  modal.classList.add("on");

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
  const img = document.getElementById("receipt-img");
  if (img && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
  _receiptBlob = null;
}

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
    await receiptSave();
    showToast("Поделиться недоступно — файл сохранён");
  }
}

// ══════════════════════════════════════════════════════════
// ГЕНЕРАЦИЯ ВЫСОКОГО РАЗРЕШЕНИЯ (High-DPI / 3x Scale)
// ══════════════════════════════════════════════════════════
async function generateReceiptBlob(order) {
  const logo = await _loadImage(RECEIPT_LOGO).catch(() => null);

  // Измерительный холст (работает в оригинальных поинтах)
  const measureCanvas  = document.createElement("canvas");
  measureCanvas.width  = W;
  const mCtx = measureCanvas.getContext("2d");

  // Замеряем итоговую высоту контента
  const usedH = _drawReceipt(mCtx, order, logo, 10000);
  const realLogicalH = Math.max(usedH + 10, 841.89); // Минимальная высота — стандартный A4 лист

  // Результирующий холст с коэффициентом резкости 3x (300 DPI)
  const SCALE = 3; 
  const canvas   = document.createElement("canvas");
  canvas.width   = Math.round(W * SCALE);
  canvas.height  = Math.round(realLogicalH * SCALE);
  const ctx = canvas.getContext("2d");

  // Масштабируем контекст, чтобы писать код в исходных ReportLab-координатах
  ctx.scale(SCALE, SCALE);

  // Заливка белым фоном
  ctx.fillStyle = RC.white;
  ctx.fillRect(0, 0, W, realLogicalH);

  _drawReceipt(ctx, order, logo, realLogicalH);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.95);
  });
}

// ══════════════════════════════════════════════════════════
// СИНХРОННАЯ ОТРИСОВКА ЧЕКА (Сверху вниз)
// ══════════════════════════════════════════════════════════
function _drawReceipt(ctx, order, logo, canvasH) {
  let y = 14 * PT_MM; // Стартовый отступ сверху

  // ── 1. ЛОГОТИП ИЛИ ШАПКА ТЕКСТОМ ──
  if (logo) {
    const logoH = 52 * PT_MM;
    const logoW = logoH * (logo.width / logo.height);
    ctx.drawImage(logo, (W - logoW) / 2, y, logoW, logoH);
    y += logoH + 4 * PT_MM;
  } else {
    ctx.fillStyle = RC.ink;
    ctx.font = "bold 22pt Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("Slaŭnaya eža", W / 2, y + 22);
    y += 29;
    ctx.fillStyle = RC.hint;
    ctx.font = "8pt sans-serif";
    ctx.fillText("cooking with love", W / 2, y);
    y += 12;
  }
  ctx.textAlign = "left";

  _hline(ctx, ML, y, W - MR, RC.ink, 0.8);
  y += 5 * PT_MM;

  // Информационная плашка даты и статуса документа
  ctx.fillStyle = RC.dark;
  ctx.font = "7.5pt sans-serif";
  const today = new Date();
  const dateStr = [
    String(today.getDate()).padStart(2, "0"),
    String(today.getMonth() + 1).padStart(2, "0"),
    today.getFullYear()
  ].join(".");
  ctx.fillText(dateStr, ML, y);
  ctx.textAlign = "right";
  ctx.fillText("ПРЕДЧЕК · ПРЕДВАРИТЕЛЬНЫЙ СЧЁТ", W - MR, y);
  ctx.textAlign = "left";
  y += 8 * PT_MM;

  // ── 2. БЛОК КЛИЕНТА (ОРИГИНАЛЬНАЯ ВЕРСТКА В ДВА СТОЛБЦА) ──
  const eventDate = order.event_date || "";
  const eventTime = order.event_time || "";
  const eventStr  = eventDate + (eventTime ? " в " + eventTime : "");

  y = _clientRow(ctx, "Клиент", order.client || "—", "Способ связи", order.contact || "—", y);
  y = _clientRow(ctx, "Дата доставки", eventStr, "Способ получения", order.delivery_type || "Самовывоз", y);

  // Поле Адреса (на всю ширину с динамическим переносом строк)
  const addr = (order.delivery_type === "Самовывоз") ? "Самовывоз" : (order.address || "—");
  y = _clientRowMultiline(ctx, "АДРЕС", addr, y, 9.5);

  // Примечание (если есть)
  const note = (order.note || "").trim();
  if (note) {
    y = _clientRowMultiline(ctx, "ПРИМЕЧАНИЕ", note, y, 9.0);
  }

  y += 3 * PT_MM;
  _hline(ctx, ML, y, W - MR, RC.ink, 0.8);
  y += 7 * PT_MM;

  // ── 3. ТАБЛИЦА БЛЮД ──
  const thH = 6.5 * PT_MM;
  const pad = 2 * PT_MM;
  
  // Координаты колонок в поинтах
  const cSumR   = ML + CW;
  const cPriceR = cSumR - 24 * PT_MM;
  const cQtyR   = cPriceR - 20 * PT_MM;
  const nameW   = cQtyR - ML - pad - 16 * PT_MM;

  ctx.fillStyle = RC.dark;
  ctx.font = "bold 8.5pt sans-serif";
  ctx.fillText("НАИМЕНОВАНИЕ", ML + pad, y + thH * 0.6);
  _rtxt(ctx, "КОЛ-ВО", cQtyR, y + thH * 0.6, "bold 8.5pt sans-serif", RC.dark);
  _rtxt(ctx, "ЦЕНА", cPriceR, y + thH * 0.6, "bold 8.5pt sans-serif", RC.dark);
  _rtxt(ctx, "СУММА", cSumR, y + thH * 0.6, "bold 8.5pt sans-serif", RC.dark);
  
  _hairline(ctx, ML, y + thH, W - MR, 0.6, RC.ink);
  y += thH + 1;

  const dishes = order.dishes || [];
  let subtotal = 0;

  dishes.forEach((dish, i) => {
    const name  = dish.name || "";
    const unit  = dish.unit || "шт";
    const qty   = parseFloat(dish.qty) || 1;
    const price = parseFloat(dish.price) || 0;
    const lineTotal = qty * price;
    subtotal += lineTotal;

    const nameLines = _wrapText(ctx, name, "9.5pt sans-serif", nameW);
    const nLines    = nameLines.length;
    const rowH      = Math.max(7 * PT_MM, nLines * 4.8 * PT_MM + 2 * PT_MM);

    // Чередование строк таблицы
    ctx.fillStyle = (i % 2 === 0) ? RC.rowAlt : RC.white;
    ctx.fillRect(ML, y, CW, rowH);

    // Вертикальное центрирование многострочного наименования
    const textBlockH = nLines * 4.8 * PT_MM;
    const textTop = y + (rowH - textBlockH) / 2 + 4.8 * PT_MM * 0.72;
    ctx.fillStyle = RC.ink;
    ctx.font = "9.5pt sans-serif";
    ctx.textAlign = "left";
    nameLines.forEach((ln, li) => {
      ctx.fillText(ln, ML + pad, textTop + li * 4.8 * PT_MM);
    });

    // Отрисовка количеств, цены и сумм
    const midY = y + rowH / 2;
    ctx.textBaseline = "middle";
    
    const qtyStr = (qty === Math.floor(qty)) ? String(Math.floor(qty)) : String(qty);
    _rtxt(ctx, `${qtyStr} ${unit}`, cQtyR, midY, "9pt sans-serif", RC.dark);
    _rtxt(ctx, price.toFixed(2), cPriceR, midY, "9pt sans-serif", RC.dark);
    _rtxt(ctx, lineTotal.toFixed(2), cSumR, midY, "bold 9pt sans-serif", RC.ink);
    
    ctx.textBaseline = "alphabetic";
    y += rowH;
  });

  _hairline(ctx, ML, y, W - MR, 0.4, RC.ink);
  y += 3 * PT_MM;

  // ── 4. ИТОГИ ──
  _sumRow(ctx, "Итого по блюдам:", subtotal.toFixed(2) + " BYN", cPriceR, cSumR, y, true);
  y += 7 * PT_MM;

  const discP = parseFloat(order.discount_percent) || 0;
  const discA = parseFloat(order.discount_amount)  || (discP > 0 ? subtotal * discP / 100 : 0);
  if (discP > 0) {
    ctx.fillStyle = RC.discBg;
    ctx.fillRect(ML, y, CW, 7 * PT_MM);
    _sumRow(ctx, `Скидка ${discP}%:`, `−${discA.toFixed(2)} BYN`, cPriceR, cSumR, y, false, RC.discFg);
    y += 7 * PT_MM;
  }

  const delivery = parseFloat(order.delivery) || 0;
  if (delivery > 0) {
    ctx.fillStyle = RC.delivBg;
    ctx.fillRect(ML, y, CW, 7 * PT_MM);
    _sumRow(ctx, "Доставка:", delivery.toFixed(2) + " BYN", cPriceR, cSumR, y);
    y += 7 * PT_MM;
  }

  y += 2 * PT_MM;

  // Главный оранжевый прямоугольник «ИТОГО К ОПЛАТЕ»
  const total   = parseFloat(order.total) || (subtotal + delivery - discA);
  const prepay  = total / 2;
  const totalH  = 14 * PT_MM;

  _roundRect(ctx, ML, y, CW, totalH, 2 * PT_MM, RC.accent);

  ctx.fillStyle = RC.white;
  ctx.font = "bold 10pt sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText("ИТОГО К ОПЛАТЕ", ML + 4 * PT_MM, y + totalH / 2);
  _rtxt(ctx, total.toFixed(2) + " BYN", W - MR, y + totalH / 2, "bold 15pt sans-serif", RC.white);
  ctx.textBaseline = "alphabetic";
  
  y += totalH + 5 * PT_MM;

  // ── 5. БЛОК ОПЛАТЫ ──
  _hairline(ctx, ML, y, W - MR, 0.4, RC.rule);
  y += 6 * PT_MM;

  y = _drawPillLabel(ctx, ML, y, "ОПЛАТА");
  y += 10 * PT_MM;

  ctx.fillStyle = RC.ink;
  ctx.font = "9.2pt sans-serif";

  const hasPrepay = order.prepayment !== false;
  if (hasPrepay) {
    ctx.fillText(`Работа по предоплате — не менее 50% (${prepay.toFixed(2)} BYN).`, ML, y);
    y += 5.5 * PT_MM;
    ctx.fillText("Заказ подтверждается после поступления предоплаты.", ML, y);
    y += 9 * PT_MM;
  } else {
    ctx.fillText("Оплата по факту доставки — наличными или переводом.", ML, y);
    y += 9 * PT_MM;
  }

  // Блок ЕРИП
  y = _drawPillLabel(ctx, ML, y, "КАК ОПЛАТИТЬ ЧЕРЕЗ ЕРИП");
  y += 10 * PT_MM;

  const eripSteps = [
    "1. Банковские, финансовые услуги",
    "2. Банки, НКФО  →  Приорбанк",
    "3. Пополнение карты",
  ];
  ctx.font = "9pt sans-serif";
  ctx.fillStyle = RC.ink;
  eripSteps.forEach(step => {
    ctx.fillText(step, ML, y);
    y += 5.5 * PT_MM;
  });

  // Строка пополнения номера карты (жирный + подчёркивание в стиле ReportLab)
  const prefix = "4. Номер карты:  ";
  ctx.font = "9pt sans-serif";
  ctx.fillText(prefix, ML, y);
  const prefixW = ctx.measureText(prefix).width;

  ctx.font = "bold 9.5pt sans-serif";
  ctx.fillText(RECEIPT_CARD, ML + prefixW, y);
  const cardW = ctx.measureText(RECEIPT_CARD).width;

  ctx.strokeStyle = RC.ink;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(ML + prefixW, y + 1.5);
  ctx.lineTo(ML + prefixW + cardW, y + 1.5);
  ctx.stroke();

  y += 8 * PT_MM;

  // ── 6. ПОДВАЛ ──
  y += 5 * PT_MM;
  _hairline(ctx, ML, y, W - MR, 0.4, RC.rule);
  y += 6 * PT_MM;

  ctx.fillStyle = RC.dark;
  ctx.font = "8pt sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Slaŭnaya eža  ·  cooking with love  ·  Дзякуй за ваш заказ!", W / 2, y);
  ctx.textAlign = "left";
  y += 10 * PT_MM;

  return y;
}

// ══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ РИСОВАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════

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

function _rtxt(ctx, text, x, y, font, color) {
  ctx.save();
  ctx.font      = font;
  ctx.fillStyle = color;
  ctx.textAlign = "right";
  ctx.fillText(text, x, y);
  ctx.restore();
}

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

// Рендеринг строки клиента (Строго 2 колонки)
function _clientRow(ctx, labelL, valL, labelR, valR, y) {
  const lRowH = 5 * PT_MM;
  const vRowH = 6.5 * PT_MM;
  const ipad  = 2.5 * PT_MM;
  const colR  = ML + CW / 2;

  // Лейблы
  ctx.fillStyle = RC.labelBg;
  ctx.fillRect(ML, y, CW, lRowH);
  ctx.fillStyle = RC.dark;
  ctx.font = "bold 6.5pt sans-serif";
  ctx.fillText(labelL.toUpperCase(), ML + ipad, y + lRowH * 0.65);
  if (labelR) {
    ctx.fillText(labelR.toUpperCase(), colR + ipad, y + lRowH * 0.65);
  }
  y += lRowH;

  // Значения
  ctx.fillStyle = RC.white;
  ctx.fillRect(ML, y, CW, vRowH);
  ctx.fillStyle = RC.ink;
  ctx.font = "9.5pt sans-serif";
  ctx.fillText(String(valL || ""), ML + ipad, y + vRowH * 0.65);
  if (labelR) {
    ctx.fillText(String(valR || ""), colR + ipad, y + vRowH * 0.65);
  }
  y += vRowH;

  return y;
}

// Многострочный блок информации (Адрес, Примечание)
function _clientRowMultiline(ctx, label, value, y, fontSizeVal) {
  const lRowH = 5 * PT_MM;
  const vRowH = 6.5 * PT_MM;
  const ipad  = 2.5 * PT_MM;
  const lineH = 5 * PT_MM;

  // Лейбл
  ctx.fillStyle = RC.labelBg;
  ctx.fillRect(ML, y, CW, lRowH);
  ctx.fillStyle = RC.dark;
  ctx.font = "bold 6.5pt sans-serif";
  ctx.fillText(label.toUpperCase(), ML + ipad, y + lRowH * 0.65);
  y += lRowH;

  // Вычисление высоты блока и перенос текста
  const lines = _wrapText(ctx, value || "—", `${fontSizeVal}pt sans-serif`, CW - ipad * 2);
  const nLines = lines.length;
  const addrH  = Math.max(vRowH, nLines * lineH + 3 * PT_MM);

  ctx.fillStyle = RC.white;
  ctx.fillRect(ML, y, CW, addrH);
  ctx.fillStyle = RC.ink;
  ctx.font = `${fontSizeVal}pt sans-serif`;

  const textBlockH = nLines * lineH;
  const textTop = y + (addrH - textBlockH) / 2 + lineH * 0.72;

  lines.forEach((ln, li) => {
    ctx.fillText(ln, ML + ipad, textTop + li * lineH);
  });

  return y + addrH;
}

// Отрисовка строки промежуточных итогов
function _sumRow(ctx, label, value, cPriceR, cSumR, y, bold = false, valueColor = null) {
  const h = 7 * PT_MM;
  ctx.fillStyle = RC.dark;
  ctx.font = "8.5pt sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(label, cPriceR, y + h * 0.62);

  ctx.fillStyle = valueColor || RC.ink;
  ctx.font = bold ? "bold 9.5pt sans-serif" : "9pt sans-serif";
  ctx.fillText(value, cSumR, y + h * 0.62);
  ctx.textAlign = "left";
}

// Лейбл-пилюля для блоков оплаты
function _drawPillLabel(ctx, x, y, text) {
  const fontSize = 8.5;
  const padH     = 3 * PT_MM;
  
  ctx.font = "bold 8.5pt sans-serif";
  const tw = ctx.measureText(text).width;
  const w  = tw + padH * 2;
  const h  = fontSize * 1.6;

  _roundRect(ctx, x, y, w, h, 1.2 * PT_MM, RC.labelBg);
  
  ctx.fillStyle = RC.dark;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + padH, y + h / 2);
  ctx.textBaseline = "alphabetic";

  return y + h;
}

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

function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось загрузить логотип: " + src));
    img.src = src;
  });
}
