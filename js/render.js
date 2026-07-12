'use strict';
// ══════════════════════════════════════════════════════════
// render.js — отрисовка всех экранов
// Telegram убран: свайп "Выполнен" → changeStatus() → GAS
// ══════════════════════════════════════════════════════════

// ── Парсинг даты "дд.мм.гггг" или ISO "гггг-мм-дд" → число 20260522 ───────────
function parseDateNum(d) {
  if (!d) return 0;
  let p;
  if (d.includes("-")) {
    p = d.split("-");
    if (p.length === 3) {
      return parseInt(p[0] + p[1].padStart(2, "0") + p[2].padStart(2, "0"), 10);
    }
  } else if (d.includes(".")) {
    p = d.split(".");
    if (p.length === 3) {
      return parseInt(p[2] + p[1].padStart(2, "0") + p[0].padStart(2, "0"), 10);
    }
    if (p.length === 2) {
      return parseInt(new Date().getFullYear() + p[1].padStart(2, "0") + p[0].padStart(2, "0"), 10);
    }
  }
  return 0;
}

// ── HTML-экранирование ────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtQty(q) {
  q = parseFloat(q);
  return (q === Math.floor(q)) ? String(Math.floor(q)) : String(q);
}

function statusClass(st) {
  return ({
    "🆕 Новый":"st-new",
    "💰 Предоплачен":"st-prepaid",
    "✔️ Выполнен":"st-done",
    "❌ Отменён":"st-canc"
  })[st] || "st-new";
}

// "10.05" из "10.05.2026"
function shortDate(d) {
  if (!d) return "";
  const p = d.split(".");
  return p.length >= 2 ? p[0] + "." + p[1] : d;
}

// Срочность по дате мероприятия
function urgencyClass(eventDate) {
  if (!eventDate) return "";
  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const p        = eventDate.split(".");
  if (p.length < 3) return "";
  const ev = new Date(+p[2], +p[1]-1, +p[0]);
  if (ev <= today)    return "urgent";
  if (ev <= tomorrow) return "soon";
  return "";
}

// Группа для активных заказов
function dateGroup(eventDate) {
  if (!eventDate) return "Позже";
  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const p        = eventDate.split(".");
  if (p.length < 3) return "Позже";
  const ev = new Date(+p[2], +p[1]-1, +p[0]);
  if (+ev === +today)    return "Сегодня";
  if (+ev === +tomorrow) return "Завтра";
  if (ev < today)        return "Просрочено";
  return "Позже";
}

// ══════════════════════════════════════════════════════════
// SKELETON LOADING
// ══════════════════════════════════════════════════════════
function renderSkeletons(containerId, count = 3) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = Array.from({length: count}, () => `
    <div class="sk-card">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div style="flex:1">
          <div class="skeleton sk-line wide" style="margin-bottom:6px"></div>
          <div class="skeleton sk-line mid"></div>
        </div>
        <div class="skeleton sk-line short" style="width:70px;height:20px;margin:0 0 0 12px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <div class="skeleton sk-badge"></div>
        <div class="skeleton sk-badge" style="width:70px"></div>
      </div>
    </div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════
// СПИСОК ЗАКАЗОВ
// ══════════════════════════════════════════════════════════
function renderOrders(activeOrders, archiveOrders, currentTab, searchQuery) {
  const el  = document.getElementById('orders-list');
  const bdg = document.getElementById('bdg-orders');
  if (!el) return;

  // P3: обновляем теплокарту календаря свежими данными
  if (typeof renderCalendar === 'function') renderCalendar();

  bdg.textContent = activeOrders.length;
  bdg.classList.toggle('on', activeOrders.length > 0);

  // P3: фильтр по дню из календаря — показывает заказы за этот день из обоих списков
  if (calDayFilter) {
    let dayList = [...activeOrders, ...archiveOrders].filter(o => (o.event_date || '') === calDayFilter);
    if (!dayList.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-ico">🗓</div>
        <div class="empty-title">За ${calDayFilter} заказов нет</div>
        <div class="empty-sub">Выберите другой день в календаре</div>
      </div>`;
    } else {
      el.innerHTML = `<div class="search-results-badge">За ${calDayFilter} · ${dayList.length}</div>` +
        dayList.map(o => orderCardHTML(o, false)).join('');
      attachSwipeHandlers(el);
    }
    return;
  }

  let list = currentTab === 'active' ? activeOrders : archiveOrders;

  // Поиск по обоим спискам
  if (searchQuery && searchQuery.length >= 2) {
    const q = searchQuery.toLowerCase();
    list = [...activeOrders, ...archiveOrders].filter(o =>
      (o.client  || '').toLowerCase().includes(q) ||
      (o.address || '').toLowerCase().includes(q) ||
      (o.contact || '').toLowerCase().includes(q) ||
      (o.dishes  || []).some(d => (d.name || '').toLowerCase().includes(q))
    );
    renderSearchResults(el, list);
    return;
  }

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-ico">${currentTab === 'active' ? '📭' : '📦'}</div>
      <div class="empty-title">${currentTab === 'active' ? 'Активных заказов нет' : 'Архив пуст'}</div>
      <div class="empty-sub">Создайте новый заказ через вкладку ➕</div>
    </div>`;
    return;
  }

  if (currentTab === 'active') {
    renderActiveGrouped(el, list);
  } else {
    renderArchiveList(el, list);
  }
}

// ══════════════════════════════════════════════════════════
// P3: КАЛЕНДАРЬ-ТЕПЛОКАРТА
// ══════════════════════════════════════════════════════════
const CAL_MONTH_NAMES = ["","Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

function renderCalendar() {
  const grid  = document.getElementById('cal-grid');
  const label = document.getElementById('cal-month-label');
  if (!grid || !label) return;

  label.textContent = CAL_MONTH_NAMES[calMonth] + ' ' + calYear;

  // Считаем заказы по event_date за этот месяц (активные + архив, БЕЗ отменённых)
  const counts = {};
  [...ACTIVE_ORDERS, ...ARCHIVE_ORDERS].forEach(o => {
    if (o.status === '❌ Отменён') return; // #3: отменённые не считаем
    const d = o.event_date || '';
    if (!d) return;
    const parts = d.split('.');
    if (parts.length < 3) return;
    if (parts[1] !== String(calMonth).padStart(2,'0') || parts[2] !== String(calYear)) return;
    counts[d] = (counts[d] || 0) + 1;
  });

  const maxCount = Math.max(1, ...Object.values(counts));
  const pad = n => String(n).padStart(2,'0');
  const today = new Date();
  const todayStr = pad(today.getDate()) + '.' + pad(today.getMonth()+1) + '.' + today.getFullYear();

  // День недели первого числа (Пн=0 .. Вс=6)
  const firstDay = new Date(calYear, calMonth - 1, 1);
  const daysInMonth = new Date(calYear, calMonth, 0).getDate();
  let startWeekday = firstDay.getDay() - 1;
  if (startWeekday < 0) startWeekday = 6;

  let html = '';
  for (let i = 0; i < startWeekday; i++) {
    html += '<div class="cal-cell gap"></div>';
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = pad(day) + '.' + pad(calMonth) + '.' + calYear;
    const count = counts[dateStr] || 0;
    const intensity = count > 0 ? (0.15 + (count / maxCount) * 0.63) : 0;
    const bg = count > 0 ? ` style="background:rgba(216,90,48,${intensity})"` : '';
    const classes = ['cal-cell'];
    if (dateStr === todayStr) classes.push('today');
    if (dateStr === calDayFilter) classes.push('selected');
    html += `<div class="${classes.join(' ')}"${bg} onclick="selectCalDay('${dateStr}')">
      <span class="cal-num">${day}</span>
      ${count > 0 ? `<span class="cal-cnt">${count}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;

  // Инфо о фильтре
  const filterInfo = document.getElementById('cal-filter-info');
  const filterText = document.getElementById('cal-filter-text');
  if (filterInfo && filterText) {
    if (calDayFilter) {
      filterText.textContent = 'Фильтр: ' + calDayFilter;
      filterInfo.style.display = 'flex';
    } else {
      filterInfo.style.display = 'none';
    }
  }
}

function renderSearchResults(el, list) {
  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-ico">🔍</div>
      <div class="empty-title">Ничего не найдено</div>
      <div class="empty-sub">Попробуйте другой запрос</div>
    </div>`;
    return;
  }
  el.innerHTML = `<div class="search-results-badge">Найдено: ${list.length}</div>` +
    list.map(o => orderCardHTML(o, false)).join('');
  attachSwipeHandlers(el);
}

// Активные — группировка + сортировка внутри группы
function renderActiveGrouped(el, list) {
  const ORDER  = ["Просрочено", "Сегодня", "Завтра", "Позже"];
  const groups = {};

  list.forEach(o => {
    const g = dateGroup(o.event_date);
    if (!groups[g]) groups[g] = [];
    groups[g].push(o);
  });

  // P5: сортировка по дате доставки от ближайшей к поздней.
  // При равной дате — по времени доставки (HH:mm сравнивается лексикографически).
  // Если времени нет — заказ считается позже тех, у кого время есть (в конец группы).
  Object.values(groups).forEach(arr =>
    arr.sort((a, b) => {
      const da = parseDateNum(a.event_date);
      const db = parseDateNum(b.event_date);
      if (da !== db) return da - db;
      const ta = String(a.event_time || '').trim() || '99:99';
      const tb = String(b.event_time || '').trim() || '99:99';
      return ta.localeCompare(tb);
    })
  );

  let html = '';
  ORDER.forEach(g => {
    if (!groups[g]?.length) return;
    html += `<div class="date-group-hdr">${g} · ${groups[g].length}</div>`;
    html += groups[g].map(o => orderCardHTML(o, true)).join('');
  });

  el.innerHTML = html;
  attachSwipeHandlers(el);
}

// Архив — по дате убыванию
function renderArchiveList(el, list) {
  const sorted = [...list].sort((a, b) =>
    parseDateNum(b.date_order) - parseDateNum(a.date_order)
  );
  el.innerHTML = sorted.map(o => orderCardHTML(o, false)).join('');
  attachSwipeHandlers(el);
}

function orderCardHTML(o, withSwipe) {
  const sc       = statusClass(o.status);
  const urg      = urgencyClass(o.event_date);
  const isActive = ["🆕 Новый","✅ Подтверждён","🍳 Готовится"].includes(o.status);

  const urgBar = urg ? `<div class="urgency-bar ${urg}"></div>` : '';

  const dateCreated  = o.date_order
    ? `<div class="oc-d-create">📝 Создан ${shortDate(o.date_order)}</div>` : '';
  const dateDelivery = o.event_date
    ? `<div class="oc-d-deliv">📅 Доставка: <span class="hl">${shortDate(o.event_date)}${o.event_time ? ' в ' + esc(o.event_time) : ''}</span></div>` : '';
  const dateRow = `<div class="oc-dates">${dateCreated}${dateDelivery}</div>`;

  const swipeWrap = withSwipe && isActive
    ? `<div class="swipe-action" data-row="${o.row}"><span class="sa-ico">✔️</span>Готово</div>` : '';

  const cardInner = `<div class="order-card" data-row="${o.row}" onclick="openOrderDetail(${o.row})">
    ${urgBar}
    <div class="oc-top">
      <div class="oc-info">
        <div class="oc-client">${esc(o.client)}</div>
        ${dateRow}
      </div>
      <div class="oc-sum">${(+o.total||0).toFixed(2)} BYN</div>
    </div>
    <div class="oc-bot">
      <span class="oc-badge ${sc}">${esc(o.status)}</span>
      ${o.delivery_type ? `<span class="oc-tag oc-tag-deliv ${o.delivery_type === 'Доставка' ? 'deliv' : 'pickup'}"><span class="oc-tag-ico">${o.delivery_type === 'Доставка' ? '🚗' : '🏠'}</span>${esc(o.delivery_type)}</span>` : ''}
      ${o.dishes_count  ? `<span class="oc-tag">${o.dishes_count} поз.</span>` : ''}
      <span class="oc-arr">›</span>
    </div>
  </div>`;

  return `<div class="order-card-wrap">${swipeWrap}${cardInner}</div>`;
}

// ══════════════════════════════════════════════════════════
// СВАЙП ВЛЕВО → «ВЫПОЛНЕН»
// Вместо sendToBot — вызывает changeStatus() из app.js,
// который напрямую отправляет в GAS
// ══════════════════════════════════════════════════════════
function attachSwipeHandlers(container) {
  container.querySelectorAll('.order-card').forEach(card => {
    let startX = 0, startY = 0, dx = 0, swiping = false;
    const THRESHOLD = 70;

    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0; swiping = false;
    }, { passive: true });

    card.addEventListener('touchmove', e => {
      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;
      dx = startX - curX;
      const dy = Math.abs(startY - curY);
      if (dx > 35 && dy < dx * 0.45) {
        swiping = true;
        card.style.transform = `translateX(-${Math.min(dx, 90)}px)`;
        e.preventDefault();
      }
    }, { passive: false });

    card.addEventListener('touchend', () => {
      if (swiping && dx >= THRESHOLD) {
        const row = parseInt(card.dataset.row);
        // Вызываем changeStatus из app.js — он напрямую пишет в GAS
        changeStatus(row, '✔️ Выполнен');
        // Карточка вернётся на место через renderOrders после ответа GAS
      } else {
        card.style.transform = '';
      }
    });
  });
}

// ══════════════════════════════════════════════════════════
// ДЕТАЛЬНЫЙ ВИД ЗАКАЗА
// ══════════════════════════════════════════════════════════
function renderOrderDetail(order, isActive) {
  const sc      = statusClass(order.status);
  const dishes  = order.dishes || [];
  const sub     = dishes.reduce((s,d) => s + (+d.price||0)*(+d.qty||0), 0);
  const delivery= +order.delivery || 0;
  const discP   = +order.discount_percent || 0;
  const discA   = discP > 0 ? +(order.discount_amount || (sub * discP / 100).toFixed(2)) : 0;
  const total   = +order.total || (sub - discA + delivery);

  let html = '';

  // ══ HERO-блок: клиент + статус-пилюля (тапабельная) + ключевые данные ══
  const eventStr = (order.event_date || '—') + (order.event_time ? ' в ' + esc(order.event_time) : '');
  const delivLine = order.delivery_type === 'Доставка' && order.address
    ? '🚗 Доставка · ' + esc(order.address)
    : '🏠 ' + esc(order.delivery_type || 'Самовывоз');

  // #2: строка предоплаты в hero (если есть prepayment_amount)
  const prepAmt = +order.prepayment_amount || 0;
  const prepLine = prepAmt > 0
    ? (prepAmt >= total
        ? `<div class="od-hero-row od-prep-paid">✅ Оплачено полностью: ${prepAmt.toFixed(2)} BYN</div>`
        : `<div class="od-hero-row od-prep-line">💰 Предоплата: ${prepAmt.toFixed(2)} BYN</div>`)
    : '';

  html += `<div class="od-hero">
    <div class="od-hero-top">
      <div class="od-hero-client">${esc(order.client)}</div>
      ${isActive
        ? `<button class="od-status-pill ${sc}" onclick="openStatusModal(${order.row})">${esc(order.status)} <span class="od-pill-caret">▾</span></button>`
        : `<span class="od-status-pill ${sc}" style="cursor:default">${esc(order.status)}</span>`}
    </div>
    <div class="od-hero-row">📅 ${eventStr}</div>
    <div class="od-hero-row">${delivLine}</div>
    ${prepLine}
  </div>`;

  // ══ #2: Кнопки денег (предоплата / оплата полностью) + расход по заказу ══
  if (isActive) {
    html += `<div class="od-money-row">
      <button class="od-money-btn od-money-prep" onclick="addPrepayment(${order.row})">
        <span class="od-money-ico">💰</span>Внести предоплату
      </button>
      <button class="od-money-btn od-money-full" onclick="markPaidFull(${order.row})">
        <span class="od-money-ico">✅</span>Оплачен полностью
      </button>
    </div>`;
    html += `<div class="od-expense-row">
      <button class="od-expense-btn" onclick="addOrderExpense(${order.row})">
        <span class="od-money-ico">💸</span>Внести расходы по заказу
      </button>
    </div>`;
  }

  // ══ Кнопки действий — плитки сразу под hero ══
  const addrEnc = encodeURIComponent(order.address || '');
  if (isActive) {
    html += `<div class="actions cols2">
      <button class="act-btn ab-blue" onclick="genReceipt(${order.row})">
        <span class="act-ico">📄</span>Предчек
      </button>
      <button class="act-btn ab-grn" onclick="openMapChoice('${addrEnc}')">
        <span class="act-ico">🧭</span>Маршрут
      </button>
    </div>`;
  } else {
    html += `<div class="actions cols2">
      <button class="act-btn ab-blue" onclick="genReceipt(${order.row})">
        <span class="act-ico">📄</span>Предчек
      </button>
      <button class="act-btn ab-ghost" onclick="duplicateOrder(${order.row})">
        <span class="act-ico">📋</span>Повторить
      </button>
    </div>`;
  }

  // ══ Информация — компактная секция (без отдельного блока Статус) ══
  let infoRows = '';
  if (order.contact) infoRows += `
    <div class="row-item">
      <div class="ri-ico">📱</div>
      <div class="ri-body">
        <div class="ri-label">${esc(order.contact)}</div>
        <div class="ri-sub">Способ связи</div>
      </div>
    </div>`;
  if (order.date_order) infoRows += `
    <div class="row-item">
      <div class="ri-ico">📝</div>
      <div class="ri-body">
        <div class="ri-label">${esc(order.date_order)}</div>
        <div class="ri-sub">Дата создания</div>
      </div>
    </div>`;
  if (order.note && order.note.trim()) infoRows += `
    <div class="row-item" style="background:rgba(255,248,220,0.7)">
      <div class="ri-ico">💬</div>
      <div class="ri-body">
        <div class="ri-sub" style="margin-bottom:2px">Примечание</div>
        <div class="ri-label" style="font-size:13px;line-height:1.4;white-space:pre-wrap">${esc(order.note)}</div>
      </div>
    </div>`;

  if (infoRows) {
    html += `<div class="sec">
      <div class="sec-hdr">Информация</div>
      <div class="sec-body">${infoRows}</div>
    </div>`;
  }

  // Состав
  if (dishes.length) {
    html += `<div class="sec">
      <div class="sec-hdr">Состав (${dishes.length} позиций)</div>
      <div class="sec-body" style="padding:0">`;

    dishes.forEach(d => {
      const lt = ((+d.price||0) * (+d.qty||0)).toFixed(2);
      html += `<div class="dish-row">
        <div class="dr-name">${esc(d.name)}</div>
        <div class="dr-qty">×${fmtQty(d.qty)} ${esc(d.unit||'')}</div>
        <div class="dr-price">${lt} BYN</div>
      </div>`;
    });

    html += `<div class="total-block">
      <div class="total-line"><span>Блюда</span><span>${sub.toFixed(2)} BYN</span></div>`;
    if (discP > 0)
      html += `<div class="total-line"><span>Скидка ${discP}%</span><span>−${discA.toFixed(2)} BYN</span></div>`;
    if (delivery > 0)
      html += `<div class="total-line"><span>Доставка</span><span>${delivery.toFixed(2)} BYN</span></div>`;
    html += `<div class="total-line big"><span>Итого</span><span class="tv">${total.toFixed(2)} BYN</span></div>`;
    if (order.prepayment)
      html += `<div class="total-line" style="margin-top:4px"><span>Предоплата 50%</span><span>${(total/2).toFixed(2)} BYN</span></div>`;
    html += `</div></div></div>`;
  } else {
    html += `<div class="sec">
      <div class="sec-hdr">Состав</div>
      <div class="sec-body">
        <div class="row-item">
          <div class="ri-body">
            <div class="ri-label" style="color:var(--hint)">Обновите кеш кнопкой ↻</div>
          </div>
        </div>
      </div>
    </div>`;
  }

  html += `<div style="height:16px"></div>`;
  document.getElementById('order-detail-body').innerHTML = html;
}

// ══════════════════════════════════════════════════════════
// ЗАКУПКИ
// ══════════════════════════════════════════════════════════
function renderShopping(shopping) {
  const el  = document.getElementById('shopping-list');
  const bdg = document.getElementById('bdg-shop');
  if (!el) return;

  const rem = (shopping || []).filter(i => !i.bought).length;
  bdg.textContent = rem;
  bdg.classList.toggle('on', rem > 0);

  if (!shopping.length) {
    el.innerHTML = `<div class="sh-empty">
      <div style="font-size:44px;margin-bottom:8px">🛒</div>
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px">Список закупок пуст</div>
      <div>Напишите или надиктуйте список<br>и разберите через AI</div>
    </div>`;
    _updateConfirmBar(shopping);
    return;
  }

  const notBought = shopping.filter(i => !i.bought);
  const bought    = shopping.filter(i =>  i.bought);

  let html = '';

  // Некупленные — по категориям
  if (notBought.length) {
    const byCat = {};
    notBought.forEach(it => {
      const c = it.category || 'Разное';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(it);
    });
    Object.keys(byCat).sort().forEach(cat => {
      html += `<div class="sh-cat-hdr">${esc(cat)}</div>`;
      html += `<div class="sec" style="margin:0 12px 0;border-radius:0"><div style="padding:0">`;
      byCat[cat].forEach(it => { html += shoppingItemHTML(it); });
      html += `</div></div>`;
    });
  }

  // Купленные — в конце
  if (bought.length) {
    html += `<div class="sh-cat-hdr" style="margin-top:8px">✅ Куплено (${bought.length})</div>`;
    html += `<div class="sec" style="margin:0 12px 8px;border-radius:0"><div style="padding:0">`;
    bought.forEach(it => { html += shoppingItemHTML(it); });
    html += `</div></div>`;
  }

  html += `<div style="height:80px"></div>`;
  el.innerHTML = html;
  _updateConfirmBar(shopping);
}

function shoppingItemHTML(it) {
  const isUnrec = it.category === 'Нераспознанное';
  return `<div class="sh-item${isUnrec ? ' sh-unrec' : ''}" onclick="toggleBought('${esc(it.id)}')">
    <div class="sh-chk${it.bought ? ' on' : ''}"></div>
    <div class="sh-body">
      <div class="sh-name${it.bought ? ' done' : ''}">${esc(it.name)}</div>
      ${it.raw && it.raw !== it.name ? `<div class="sh-raw">${esc(it.raw)}</div>` : ''}
      <div class="sh-qty">${fmtQty(it.qty)} ${esc(it.unit||'')}</div>
    </div>
  </div>`;
}

function _updateConfirmBar(shopping) {
  const bar     = document.getElementById('sh-confirm-bar');
  if (!bar) return;
  const boughtN = (shopping || []).filter(i => i.bought).length;
  if (boughtN > 0) {
    bar.innerHTML = `<button class="sh-confirm-btn" onclick="confirmShoppingPurchase()">
      ✓ Подтвердить покупку (${boughtN} позиций)
    </button>`;
    bar.classList.add('on');
  } else {
    bar.classList.remove('on');
    bar.innerHTML = '';
  }
}

// ══════════════════════════════════════════════════════════
// МЕНЮ-РЕДАКТОР
// ══════════════════════════════════════════════════════════
function renderMenuEdit(menu, query, activeCat) {
  const sub = document.getElementById('menu-edit-sub');
  if (sub) sub.textContent = menu.length + ' блюд';

  const q   = (query || '').toLowerCase();
  const cat = activeCat || 'Все';
  const list = menu.filter(d =>
    (cat === 'Все' || d.cat === cat) &&
    (!q || d.name.toLowerCase().includes(q))
  );
  const el = document.getElementById('menu-edit-list');
  if (!el) return;
  el.innerHTML = list.map(d =>
    `<div class="menu-edit-row" onclick="openDishEdit('${esc(String(d.id))}')">
      <div class="me-info">
        <div class="me-name">${esc(d.name)}</div>
        <div class="me-cat">${esc(d.cat||'—')} · ${esc(d.unit||'порц.')}</div>
      </div>
      <div class="me-price">${(+d.price||0).toFixed(2)} BYN</div>
      <div class="me-arr">›</div>
    </div>`
  ).join('');
}

// ══════════════════════════════════════════════════════════
// P5: ЛИСТ КУХНИ — список активных заказов с составом + чекбоксы
// ══════════════════════════════════════════════════════════
function renderSheet() {
  const el  = document.getElementById('sheet-list');
  const sub = document.getElementById('sheet-sub');
  if (!el) return;

  // Сортируем активные по дате мероприятия (ближайшие сверху)
  const list = [...ACTIVE_ORDERS].sort((a, b) => {
    const da = parseDateNum(a.event_date);
    const db = parseDateNum(b.event_date);
    if (da !== db) return da - db;
    return String(a.event_time || '').localeCompare(String(b.event_time || ''));
  });

  if (sub) sub.textContent = list.length + ' заказ' + (list.length === 1 ? '' : 'ов');

  if (!list.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-ico">🧾</div>
      <div class="empty-title">Активных заказов нет</div>
      <div class="empty-sub">Создайте заказ во вкладке ➕</div>
    </div>`;
    updateSheetGenBar();
    return;
  }

  el.innerHTML = list.map(o => sheetCardHTML(o)).join('');
  updateSheetGenBar();
}

function sheetCardHTML(o) {
  const dishes = o.dishes || [];
  const sel = sheetSelected[o.row] ? ' on' : '';
  const dateStr = (o.event_date || '—') + (o.event_time ? ' в ' + esc(o.event_time) : '');
  const deliv = o.delivery_type === 'Доставка' && o.address
    ? '🚗 Доставка · ' + esc(o.address)
    : '🚗 ' + esc(o.delivery_type || 'Самовывоз');

  let dishesHtml = '';
  if (dishes.length) {
    dishesHtml = '<div class="sheet-cb-dishes">';
    dishes.forEach(d => {
      const qtyStr = fmtQty(d.qty) + ' ' + esc(d.unit || '');
      dishesHtml += `<div class="sheet-dish">
        <span class="sheet-dish-name">${esc(d.name)}</span>
        <span class="sheet-dish-qty">×${qtyStr}</span>
      </div>`;
    });
    dishesHtml += '</div>';
  } else {
    dishesHtml = '<div class="sheet-cb-dishes"><div class="sheet-dish" style="color:var(--hint)">Состав не загружен — обновите кеш</div></div>';
  }

  const noteHtml = (o.note && o.note.trim())
    ? `<div class="rev-o-note" style="margin-top:6px">💬 ${esc(o.note)}</div>`
    : '';

  return `<div class="sheet-card" data-row="${o.row}">
    <div class="sheet-check${sel}" onclick="toggleSheetOrder(${o.row})"></div>
    <div class="sheet-cb">
      <div class="sheet-cb-top">
        <div class="sheet-cb-client">${esc(o.client || '—')}</div>
        <div class="sheet-cb-date">📅 ${dateStr}</div>
      </div>
      <div class="sheet-cb-deliv">${deliv}</div>
      ${dishesHtml}
      ${noteHtml}
    </div>
  </div>`;
}

function updateSheetGenBar() {
  const bar   = document.getElementById('sheet-gen-bar');
  const count = document.getElementById('sheet-gen-count');
  const btn   = document.getElementById('sheet-gen-btn');
  const n = Object.keys(sheetSelected).filter(k => sheetSelected[k]).length;
  if (count) count.textContent = n;
  if (bar) bar.style.display = n > 0 ? 'block' : 'none';
  if (btn) btn.disabled = n === 0;
}

// ══════════════════════════════════════════════════════════
// P4: МОДАЛКА ВЫРУЧКИ — список заказов месяца
// ══════════════════════════════════════════════════════════
function renderRevenueModal(d) {
  const fmt = v => (+v || 0).toFixed(2).replace('.', ',');
  let html = '';

  // Сводка
  html += `<div class="rev-summary">
    <div class="rev-sum-row"><span>Заказов выполнено</span><span>${d.orders_count}</span></div>
    <div class="rev-sum-row"><span>Выручка по заказам</span><span>${fmt(d.revenue_orders)} BYN</span></div>
    ${d.revenue_extra > 0 ? `<div class="rev-sum-row"><span>Доход вне бота</span><span>+${fmt(d.revenue_extra)} BYN</span></div>` : ''}
    <div class="rev-sum-row rev-sum-total"><span>Итого выручка</span><span>${fmt(d.revenue_total)} BYN</span></div>
  </div>`;

  // Список заказов месяца (только те, что засчитал GAS — выполненные с event_date в месяце)
  // Сортировка по дате мероприятия от ранней к поздней (parseDateNum парсит dd.mm.yyyy → YYYYMMDD).
  const orders = (d.month_orders || []).slice().sort((a, b) => {
    const da = parseDateNum(a.event_date);
    const db = parseDateNum(b.event_date);
    if (da !== db) return da - db;
    // при равных датах — по времени
    return String(a.event_time || '').localeCompare(String(b.event_time || ''));
  });
  if (!orders.length) {
    html += `<div class="rev-empty">В этом месяце нет выполненных заказов</div>`;
  } else {
    html += `<div class="rev-orders-hdr">Заказы месяца (${orders.length})</div>`;
    html += `<div class="rev-orders">`;
    orders.forEach(o => {
      const dateStr = o.event_date + (o.event_time ? ' в ' + o.event_time : '');
      const deliv = o.delivery_type === 'Доставка' && o.address
        ? 'Доставка · ' + o.address
        : (o.delivery_type || 'Самовывоз');
      html += `<div class="rev-order">
        <div class="rev-o-top">
          <div class="rev-o-client">${esc(o.client || '—')}</div>
          <div class="rev-o-total">${fmt(o.total)} BYN</div>
        </div>
        <div class="rev-o-date">📅 ${esc(dateStr)}</div>
        <div class="rev-o-deliv">🚗 ${esc(deliv)}</div>
        ${o.dishes_count ? `<div class="rev-o-dishes">🍽 ${o.dishes_count} поз.</div>` : ''}
        ${o.note ? `<div class="rev-o-note">💬 ${esc(o.note)}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  // P5: Список доходов вне бота (из month_expenses фильтруем type === 'Доход вне бота')
  const incomeRows = (d.month_expenses || []).filter(r => r.type === 'Доход вне бота');
  if (incomeRows.length) {
    const sortedIncome = incomeRows.slice().sort((a, b) => {
      const da = String(a.date || '').split('.').reverse().join('');
      const db = String(b.date || '').split('.').reverse().join('');
      return db.localeCompare(da);
    });
    html += `<div class="rev-orders-hdr" style="margin-top:12px">Доход вне бота (${sortedIncome.length})</div>`;
    html += `<div class="rev-orders">`;
    sortedIncome.forEach(r => {
      const noteTxt = (r.note || '').trim();
      html += `<div class="rev-order">
        <div class="rev-o-top">
          <div class="rev-o-client">${esc(r.type)}</div>
          <div class="rev-o-total" style="color:var(--grn)">+${fmt(r.sum)} BYN</div>
        </div>
        <div class="rev-o-date">📅 ${esc(r.date || '—')}</div>
        ${noteTxt ? `<div class="rev-o-note">💬 ${esc(noteTxt)}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ══════════════════════════════════════════════════════════
// P5: МОДАЛКА РАСХОДОВ — ТОЛЬКО расходы (доходы вне бота — в модалке выручки)
// Ожидает d.month_expenses: [{date, type, sum, note}, ...]
// Группировка по note (столбец D). Пустой note → «Без категории».
// ══════════════════════════════════════════════════════════
function renderExpensesModal(d) {
  const fmt = v => (+v || 0).toFixed(2).replace('.', ',');
  let html = '';

  // #1: Расходы по заказам (из листа Расходы_заказов)
  const orderExp = d.order_expenses || [];
  const totalOrderExp = orderExp.reduce((s, r) => s + (+r.sum || 0), 0);

  if (orderExp.length) {
    // Группировка по заказам (client)
    const byOrder = {};
    orderExp.forEach(r => {
      const key = r.client || '—';
      if (!byOrder[key]) byOrder[key] = { sum: 0, count: 0, row: r.order_row, items: [] };
      byOrder[key].sum += +r.sum || 0;
      byOrder[key].count++;
      byOrder[key].items.push(r);
    });

    html += `<div class="rev-orders-hdr">💸 Расходы по заказам (${orderExp.length})</div>`;
    html += `<div class="rev-orders">`;
    Object.keys(byOrder).forEach(client => {
      const o = byOrder[client];
      html += `<div class="rev-order">
        <div class="rev-o-top">
          <div class="rev-o-client">${esc(client)}</div>
          <div class="rev-o-total" style="color:var(--red)">−${fmt(o.sum)} BYN</div>
        </div>`;
      o.items.forEach(it => {
        html += `<div class="rev-o-date">📅 ${esc(it.date || '—')}${it.note ? ' · ' + esc(it.note) : ''}</div>`;
      });
      html += `</div>`;
    });
    html += `</div>`;
    html += `<div class="rev-summary" style="margin-top:8px">
      <div class="rev-sum-total"><span>Итого по заказам</span><span>−${fmt(totalOrderExp)} BYN</span></div>
    </div>`;
  }

  // ТОЛЬКО расходы — доходы вне бота исключаем (они в модалке выручки)
  const allRows = d.month_expenses || [];
  const expRows = allRows.filter(r => r.type !== 'Доход вне бота');

  // Группировка расходов по note (столбец D). Пустой note → «Без категории».
  const byCat = {};
  expRows.forEach(r => {
    const cat = (r.note || '').trim() || 'Без категории';
    if (!byCat[cat]) byCat[cat] = { sum: 0, count: 0 };
    byCat[cat].sum += +r.sum || 0;
    byCat[cat].count++;
  });

  // Сортировка категорий по убыванию суммы
  const cats = Object.keys(byCat).sort((a, b) => byCat[b].sum - byCat[a].sum);
  const totalExpenses = expRows.reduce((s, r) => s + (+r.sum || 0), 0);

  // ── Сводка по категориям ──
  html += `<div class="rev-summary">`;
  if (!expRows.length) {
    html += `<div class="rev-sum-row"><span>Записей нет</span><span>—</span></div>`;
  } else {
    cats.forEach(cat => {
      html += `<div class="rev-sum-row"><span>${esc(cat)} <span style="color:var(--hint);font-weight:400">· ${byCat[cat].count} зап.</span></span><span>−${fmt(byCat[cat].sum)} BYN</span></div>`;
    });
    html += `<div class="rev-sum-total"><span>Итого расходов</span><span>−${fmt(totalExpenses)} BYN</span></div>`;
  }
  html += `</div>`;

  // ── Список всех записей расходов месяца ──
  if (!expRows.length) {
    html += `<div class="rev-empty">В этом месяце нет расходов</div>`;
  } else {
    // Сортировка: от новых к старым (по дате)
    const sorted = expRows.slice().sort((a, b) => {
      const da = String(a.date || '').split('.').reverse().join('');
      const db = String(b.date || '').split('.').reverse().join('');
      return db.localeCompare(da);
    });
    html += `<div class="rev-orders-hdr">Записи месяца (${sorted.length})</div>`;
    html += `<div class="rev-orders">`;
    sorted.forEach(r => {
      const noteTxt = (r.note || '').trim();
      html += `<div class="rev-order">
        <div class="rev-o-top">
          <div class="rev-o-client">${esc(r.type || '—')}</div>
          <div class="rev-o-total" style="color:var(--red)">−${fmt(r.sum)} BYN</div>
        </div>
        <div class="rev-o-date">📅 ${esc(r.date || '—')}</div>
        ${noteTxt ? `<div class="rev-o-note">💬 ${esc(noteTxt)}</div>` : ''}
      </div>`;
    });
    html += `</div>`;
  }

  return html;
}

// ══════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ══════════════════════════════════════════════════════════
let _confirmCallback = null;
let _cancelCallback  = null;

function showConfirm(title, text, okLabel, onOk, onCancel, danger = false, extra = null) {
  _confirmCallback = onOk;
  _cancelCallback  = onCancel || null;
  document.getElementById('cd-title').textContent = title;
  document.getElementById('cd-text').textContent  = text;
  const okBtn = document.getElementById('cd-ok');
  okBtn.textContent = okLabel;
  okBtn.className   = 'cd-btn cd-ok' + (danger ? ' danger' : '');

  // Дополнительная кнопка (напр. "Создать новый" vs "Добавить к списку")
  const btns     = document.querySelector('.cd-btns');
  const existing = document.getElementById('cd-second');
  if (existing) existing.remove();

  if (extra?.secondBtn) {
    const btn2 = document.createElement('button');
    btn2.id          = 'cd-second';
    btn2.className   = 'cd-btn';
    btn2.style.cssText = 'background:transparent;border:1px solid var(--urgent);color:var(--urgent);font-size:14px;font-weight:600';
    btn2.textContent = extra.secondBtn;
    btn2.onclick = () => {
      document.getElementById('confirm-dialog').classList.remove('on');
      extra.secondCb?.();
    };
    btns.insertBefore(btn2, okBtn);
  }

  document.getElementById('confirm-dialog').classList.add('on');
}

function confirmOk() {
  document.getElementById('confirm-dialog').classList.remove('on');
  if (_confirmCallback) { _confirmCallback(); _confirmCallback = null; }
}

function confirmCancel() {
  document.getElementById('confirm-dialog').classList.remove('on');
  if (_cancelCallback) { _cancelCallback(); _cancelCallback = null; }
}

// ══════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════
let _toastTimer;
function showToast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}
