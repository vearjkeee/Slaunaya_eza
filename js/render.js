'use strict';
// ══════════════════════════════════════════════════════════
// render.js — отрисовка всех списков и карточек (PWA версия)
// ══════════════════════════════════════════════════════════

function parseDateNum(d) {
  if (!d) return 0;
  const p = d.split(".");
  if (p.length === 3) return parseInt(p[2] + p[1] + p[0], 10);
  if (p.length === 2) {
    const yr = new Date().getFullYear(); 
    return parseInt(yr + p[1] + p[0], 10);
  }
  return 0;
}

// ── Вспомогательные ──────────────────────────────────────
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
  const map = {
    "🆕 Новый":"st-new","✅ Подтверждён":"st-conf",
    "🍳 Готовится":"st-cook","✔️ Выполнен":"st-done","❌ Отменён":"st-canc"
  };
  return map[st] || "st-new";
}

function shortDate(d) {
  if (!d) return "";
  const parts = d.split(".");
  return parts.length >= 2 ? parts[0] + "." + parts[1] : d;
}

function urgencyClass(eventDate) {
  if (!eventDate) return "";
  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const parts    = eventDate.split(".");
  if (parts.length < 3) return "";
  const ev = new Date(+parts[2], +parts[1]-1, +parts[0]);
  if (ev <= today)    return "urgent";
  if (ev <= tomorrow) return "soon";
  return "";
}

function dateGroup(eventDate) {
  if (!eventDate) return "Позже";
  const today    = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
  const parts    = eventDate.split(".");
  if (parts.length < 3) return "Позже";
  const ev = new Date(+parts[2], +parts[1]-1, +parts[0]);
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
// СПИСОК ЗАКАЗОВ (с группировкой и свайпом)
// ══════════════════════════════════════════════════════════
function renderOrders(activeOrders, archiveOrders, currentTab, searchQuery) {
  const el    = document.getElementById('orders-list');
  const badge = document.getElementById('bdg-orders');

  badge.textContent = activeOrders.length;
  badge.classList.toggle('on', activeOrders.length > 0);

  let list = currentTab === 'active' ? activeOrders : archiveOrders;

  if (searchQuery && searchQuery.length >= 2) {
    const q = searchQuery.toLowerCase();
    const searchIn = [...activeOrders, ...archiveOrders];
    list = searchIn.filter(o =>
      (o.client || '').toLowerCase().includes(q) ||
      (o.address || '').toLowerCase().includes(q) ||
      (o.contact || '').toLowerCase().includes(q) ||
      (o.dishes || []).some(d => (d.name || '').toLowerCase().includes(q))
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

function renderActiveGrouped(el, list) {
  const groups = {};
  const ORDER  = ["Просрочено", "Сегодня", "Завтра", "Позже"];

  list.forEach(o => {
    const g = dateGroup(o.event_date);
    if (!groups[g]) groups[g] = [];
    groups[g].push(o);
  });

  Object.values(groups).forEach(arr =>
    arr.sort((a, b) => parseDateNum(b.date_order) - parseDateNum(a.date_order))
  );

  let html = '';
  ORDER.forEach(g => {
    if (!groups[g] || !groups[g].length) return;
    html += `<div class="date-group-hdr">${g} · ${groups[g].length}</div>`;
    html += groups[g].map(o => orderCardHTML(o, true)).join('');
  });

  el.innerHTML = html;
  attachSwipeHandlers(el);
}

function renderArchiveList(el, list) {
  const sorted = [...list].sort((a, b) =>
    parseDateNum(b.date_order) - parseDateNum(a.date_order)
  );
  el.innerHTML = sorted.map(o => orderCardHTML(o, false)).join('');
  attachSwipeHandlers(el);
}

function orderCardHTML(o, withSwipe) {
  const sc  = statusClass(o.status);
  const urg = urgencyClass(o.event_date);
  const isActive = ["🆕 Новый","✅ Подтверждён","🍳 Готовится"].includes(o.status);

  const urgBar  = urg ? `<div class="urgency-bar ${urg}"></div>` : '';
  
  const dateCreated = o.date_order 
    ? `<div class="oc-d-create">📝 Создан ${shortDate(o.date_order)}</div>` 
    : '';
    
  const dateDelivery = o.event_date 
    ? `<div class="oc-d-deliv">📅 Доставка: <span class="hl">${shortDate(o.event_date)}${o.event_time ? ' в ' + esc(o.event_time) : ''}</span></div>` 
    : '';
    
  const dateRow = `<div class="oc-dates">${dateCreated}${dateDelivery}</div>`;

  const swipeWrap  = withSwipe && isActive ? `<div class="swipe-action" data-row="${o.row}"><span class="sa-ico">✔️</span>Готово</div>` : '';
  const cardInner  = `<div class="order-card" data-row="${o.row}" onclick="openOrderDetail(${o.row})">
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
      ${o.delivery_type ? `<span class="oc-tag">${esc(o.delivery_type)}</span>` : ''}
      ${o.dishes_count ? `<span class="oc-tag">${o.dishes_count} поз.</span>` : ''}
      <span class="oc-arr">›</span>
    </div>
  </div>`;

  return `<div class="order-card-wrap">${swipeWrap}${cardInner}</div>`;
}

// ══════════════════════════════════════════════════════════
// СВАЙП КАРТОЧКИ (прямая отправка в GAS вместо Telegram бота)
// ══════════════════════════════════════════════════════════
function attachSwipeHandlers(container) {
  container.querySelectorAll('.order-card').forEach(card => {
    let startX = 0, startY = 0, dx = 0;
    let swiping = false;
    const THRESHOLD = 70;

    card.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dx = 0; swiping = false;
    }, {passive: true});

    card.addEventListener('touchmove', e => {
      const curX = e.touches[0].clientX;
      const curY = e.touches[0].clientY;
      dx = startX - curX;
      const dy = Math.abs(startY - curY);
      if (dx > 35 && dy < dx * 0.45) {
        swiping = true;
        const shift = Math.min(dx, 90);
        card.style.transform = `translateX(-${shift}px)`;
        e.preventDefault();
      }
    }, {passive: false});

    card.addEventListener('touchend', () => {
      if (swiping && dx >= THRESHOLD) {
        const row = parseInt(card.dataset.row);
        showConfirm(
          "Выполнен?",
          `Перевести заказ в статус «✔️ Выполнен»?`,
          "Да, выполнен",
          async () => {
            card.style.transform = '';
            // Отправляем изменения в фоновом режиме напрямую на GAS
            await sendActionToGAS({ action: 'change_status', order_row: row, status: '✔️ Выполнен' });
            showToast('✔️ Статус обновлён');
          },
          () => { card.style.transform = ''; }
        );
      } else {
        card.style.transform = '';
      }
    });
  });
}

// ══════════════════════════════════════════════════════════
// ДЕТАЛИ ЗАКАЗА (Кнопка "Предчек" вызывает Canvas-модал)
// ══════════════════════════════════════════════════════════
function renderOrderDetail(order, isActive) {
  const sc      = statusClass(order.status);
  const dishes  = order.dishes || [];
  const sub     = dishes.reduce((s,d) => s + (+d.price||0)*(+d.qty||0), 0);
  const delivery= +order.delivery || 0;
  const discP   = +order.discount_percent || 0;
  const discA   = discP > 0 ? +(order.discount_amount || (sub*discP/100).toFixed(2)) : 0;
  const total   = +order.total || (sub - discA + delivery);

  let html = '';

  html += `<div class="sec" style="margin-top:12px">
    <div class="sec-hdr">Статус</div>
    <div class="sec-body">
      <div class="row-item">
        <div class="ri-ico">📌</div>
        <div class="ri-body"><div class="ri-label"><span class="oc-badge ${sc}">${esc(order.status)}</span></div></div>
        ${isActive ? `<button class="hdr-btn ghost" onclick="openStatusModal(${order.row})">Изменить</button>` : ''}
      </div>
    </div>
  </div>`;

  if (isActive) {
    const addrEnc = encodeURIComponent(order.address || '');
    html += `<div class="actions cols2">
      <button class="act-btn ab-blue" onclick="genReceipt(${order.row})">
        <span class="act-ico">📄</span>Предчек
      </button>
      <button class="act-btn ab-grn" onclick="openMapChoice('${addrEnc}')">
        <span class="act-ico">🗺</span>Маршрут
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

  html += `<div class="sec">
    <div class="sec-hdr">Информация</div>
    <div class="sec-body">
      <div class="row-item">
        <div class="ri-ico">👤</div>
        <div class="ri-body"><div class="ri-label">${esc(order.client)}</div><div class="ri-sub">Клиент</div></div>
      </div>
      ${order.contact ? `<div class="row-item"><div class="ri-ico">📱</div><div class="ri-body"><div class="ri-label">${esc(order.contact)}</div><div class="ri-sub">Способ связи</div></div></div>` : ''}
      ${order.date_order ? `<div class="row-item"><div class="ri-ico">📝</div><div class="ri-body"><div class="ri-label">${esc(order.date_order)}</div><div class="ri-sub">Дата создания</div></div></div>` : ''}
      <div class="row-item">
        <div class="ri-ico">📅</div>
        <div class="ri-body">
          <div class="ri-label">${esc(order.event_date||'—')}${order.event_time?' в '+esc(order.event_time):''}</div>
          <div class="ri-sub">Дата доставки</div>
        </div>
      </div>
      <div class="row-item">
        <div class="ri-ico">🚗</div>
        <div class="ri-body">
          <div class="ri-label">${esc(order.delivery_type||'—')}</div>
          ${order.address ? `<div class="ri-sub">${esc(order.address)}</div>` : ''}
        </div>
      </div>
      ${(order.note && order.note.trim()) ? `
      <div class="row-item" style="background:rgba(255,248,220,0.3)">
        <div class="ri-ico">💬</div>
        <div class="ri-body">
          <div class="ri-sub" style="margin-bottom:2px">Примечание</div>
          <div class="ri-label" style="font-size:13px;line-height:1.4;white-space:pre-wrap">${esc(order.note)}</div>
        </div>
      </div>` : ''}
    </div>
  </div>`;

  if (dishes.length) {
    html += `<div class="sec">
      <div class="sec-hdr">Состав (${dishes.length} позиций)</div>
      <div class="sec-body" style="padding:0">`;
    dishes.forEach(d => {
      const lt = ((+d.price||0)*(+d.qty||0)).toFixed(2);
      html += `<div class="dish-row">
        <div class="dr-name">${esc(d.name)}</div>
        <div class="dr-qty">×${fmtQty(d.qty)} ${esc(d.unit||'')}</div>
        <div class="dr-price">${lt} BYN</div>
      </div>`;
    });
    html += `<div class="total-block">
      <div class="total-line"><span>Блюда</span><span>${sub.toFixed(2)} BYN</span></div>`;
    if (discP > 0) html += `<div class="total-line"><span>Скидка ${discP}%</span><span>−${discA.toFixed(2)} BYN</span></div>`;
    if (delivery > 0) html += `<div class="total-line"><span>Доставка</span><span>${delivery.toFixed(2)} BYN</span></div>`;
    html += `<div class="total-line big"><span>Итого</span><span class="tv">${total.toFixed(2)} BYN</span></div>`;
    if (order.prepayment) html += `<div class="total-line" style="margin-top:4px"><span>Предоплата 50%</span><span>${(total/2).toFixed(2)} BYN</span></div>`;
    html += `</div></div></div>`;
  } else {
    html += `<div class="sec"><div class="sec-hdr">Состав</div><div class="sec-body">
      <div class="row-item"><div class="ri-body"><div class="ri-label" style="color:var(--hint)">Обновите кеш кнопкой ↻</div></div></div>
    </div></div>`;
  }

  html += `<div style="height:16px"></div>`;
  document.getElementById('order-detail-body').innerHTML = html;
}

// ══════════════════════════════════════════════════════════
// ЗАКУПКИ
// ══════════════════════════════════════════════════════════
function renderShopping(shopping) {
  const el  = document.getElementById('shopping-list');
  const rem = shopping.filter(i => !i.bought).length;
  const bdg = document.getElementById('bdg-shop');
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
  const bought    = shopping.filter(i => i.bought);

  let html = '';

  if (notBought.length) {
    const byCat = {};
    notBought.forEach(it => {
      const c = it.category || 'Разное';
      if (!byCat[c]) byCat[c] = [];
      byCat[c].push(it);
    });
    Object.keys(byCat).sort().forEach(cat => {
      html += `<div class="sh-cat-hdr">${esc(cat)}</div>`;
      html += `<div class="sec" style="margin:0 12px 0;border-radius:0">
        <div style="padding:0">`;
      byCat[cat].forEach(it => { html += shoppingItemHTML(it); });
      html += `</div></div>`;
    });
  }

  if (bought.length) {
    html += `<div class="sh-cat-hdr" style="margin-top:8px">✅ Куплено (${bought.length})</div>`;
    html += `<div class="sec" style="margin:0 12px 8px;border-radius:0">
      <div style="padding:0">`;
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
      <div class="sh-qty">${fmtQty(it.qty)} ${esc(it.unit || '')}</div>
    </div>
  </div>`;
}

function _updateConfirmBar(shopping) {
  const bar     = document.getElementById('sh-confirm-bar');
  const boughtN = (shopping || []).filter(i => i.bought).length;
  if (!bar) return;
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
  document.getElementById('menu-edit-sub').textContent = menu.length + ' блюд';
  const q   = (query || '').toLowerCase();
  const cat = activeCat || 'Все';
  const list = menu.filter(d =>
    (cat === 'Все' || d.cat === cat) &&
    (!q || d.name.toLowerCase().includes(q))
  );
  const el = document.getElementById('menu-edit-list');
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

  const btns = document.querySelector('.cd-btns');
  const existing2 = document.getElementById('cd-second');
  if (existing2) existing2.remove();
  
  if (extra?.secondBtn) {
    const btn2 = document.createElement('button');
    btn2.id        = 'cd-second';
    btn2.className = 'cd-btn';
    btn2.style.background = 'transparent';
    btn2.style.border = '1px solid var(--urgent)';
    btn2.style.color = 'var(--urgent)';
    btn2.style.fontSize = '14px';
    btn2.style.fontWeight = '600';
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
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}
