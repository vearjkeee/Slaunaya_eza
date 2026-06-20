'use strict';
// ══════════════════════════════════════════════════════════
// app.js — логика навигации, заказов, корзины, черновиков
// Telegram WebApp полностью убран.
// saveOrder / changeStatus / genReceipt → напрямую в GAS.
// ══════════════════════════════════════════════════════════

const WEBAPP_URL = "https://vearjkeee.github.io/Slaunaya_eza/index.html";

const ST = {
  NEW:  "🆕 Новый",  CONF: "✅ Подтверждён",
  COOK: "🍳 Готовится", DONE: "✔️ Выполнен", CANC: "❌ Отменён",
};

// P6: Доступные единицы измерения в корзине и редакторе блюда.
const UNITS = ['порц.', 'шт', 'кг'];

// ══════════════════════════════════════════════════════════
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ══════════════════════════════════════════════════════════
let MENU    = [], CLIENTS = [];
let ACTIVE_ORDERS = [], ARCHIVE_ORDERS = [], SHOPPING = [];

let cart       = {};
let cartOrder  = [];
let delivType  = 'Самовывоз';
let prepay     = true;
let manualId   = 1000;
let editingRow = null;

let screenStack      = [];
let currentTab       = 'orders';
let orderTab         = 'active';
let currentOrderRow  = null;
let editingDishId    = null;
let draftDiscount    = 0;
let forceNewOrder    = false;
let isFinSubmitting  = false;
let searchQuery      = '';
let menuEditQuery    = '';
let menuEditCat      = 'Все';

// P3: состояние календаря-теплокарты
let calMonth         = new Date().getMonth() + 1;
let calYear          = new Date().getFullYear();
let calSpoilerOpen   = false;
let calDayFilter     = null; // "dd.mm.yyyy" или null

// P5: состояние листа кухни — выбранные заказы {row: bool}
let sheetSelected    = {};

// Ключи локального хранилища
const CACHE_KEY           = 'slaunaya_data_cache_v2';
const STATE_KEY           = 'slaunaya_screen_state_v2';
const DRAFT_KEY           = 'order_draft_v1';
const SHOPPING_BOUGHT_KEY = 'shopping_bought_v1';
const DASH_CACHE_KEY      = 'slaunaya_dash_cache_v2'; // P4+: кэш дашборда по месяцам. v2 — с month_orders.

// Переменная времени для ловушки кнопки «Назад»
let lastBackPress = 0;

// ══════════════════════════════════════════════════════════
// ПЕРЕКЛЮЧЕНИЕ ТЕМЫ (светлая/тёмная, с запоминанием)
// ══════════════════════════════════════════════════════════
function toggleTheme() {
  const root = document.documentElement;
  const cur  = root.getAttribute('data-theme') || 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('se_theme', next); } catch(e) {}
}

// Маркер анимации перехода: на 280мс отключаем backdrop-filter (главный виновник торможения)
let _animTimer = null;
function markAnimating() {
  document.body.classList.add('is-animating');
  clearTimeout(_animTimer);
  _animTimer = setTimeout(() => document.body.classList.remove('is-animating'), 280);
}

// ══════════════════════════════════════════════════════════
// СПОСОБ СВЯЗИ — чипы с SVG-иконками
// setContact — по клику на чип; setContactValue — программно
// ══════════════════════════════════════════════════════════
function setContact(value, btn) {
  setContactValue(value);
  saveDraft();
}

function setContactValue(val) {
  const v = val || '';
  const inp = document.getElementById('o-contact');
  if (inp) inp.value = v;
  document.querySelectorAll('#o-contact-chips .contact-chip').forEach(c => {
    c.classList.toggle('on', c.dataset.value === v);
  });
  const hint = document.getElementById('o-contact-hint');
  if (hint) hint.textContent = v ? '· ' + v : '';
}

// ══════════════════════════════════════════════════════════
// ЛОКАЛЬНЫЙ КЭШ
// ══════════════════════════════════════════════════════════
function loadLocalCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      MENU           = parsed.menu           || [];
      CLIENTS        = parsed.clients        || [];
      ACTIVE_ORDERS  = parsed.active_orders  || [];
      ARCHIVE_ORDERS = parsed.archive_orders || [];
      SHOPPING       = parsed.shopping_list  || [];
      return parsed.updated || '';
    }
  } catch (e) {
    console.warn("[cache] Ошибка чтения кэша", e);
  }
  return '';
}

function saveLocalCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn("[cache] Ошибка записи кэша", e);
  }
}

// ══════════════════════════════════════════════════════════
// СОХРАНЕНИЕ / ВОССТАНОВЛЕНИЕ СОСТОЯНИЯ ЭКРАНА
// ══════════════════════════════════════════════════════════
function saveLastScreen() {
  const state = {
    tab: currentTab,
    screenStack,
    activeScreenId: document.querySelector('.scr.on')?.id || null,
    currentOrderRow,
    editingRow
  };
  try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) {}
}

function restoreLastScreen() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) {
      switchTab('orders', document.querySelectorAll('.tab-bar .tb')[0]);
      return;
    }
    const state = JSON.parse(raw);
    currentTab      = state.tab || 'orders';
    screenStack     = state.screenStack || [];
    currentOrderRow = state.currentOrderRow || null;
    editingRow      = state.editingRow || null;

    const tabIndexMap = { orders:1, new:2, shopping:3, dashboard:4, menu:5, sheet:6 };
    const btnIdx = tabIndexMap[currentTab] || 1;
    const btn    = document.querySelectorAll('.tab-bar .tb')[btnIdx - 1];
    _silentSwitchTab(currentTab, btn, state.activeScreenId);
  } catch (e) {
    console.warn("[state] Ошибка восстановления экрана", e);
    switchTab('orders', document.querySelectorAll('.tab-bar .tb')[0]);
  }
}

function _silentSwitchTab(tab, btn, targetScreenId) {
  document.querySelectorAll('.tb').forEach(b => b?.classList.remove('on'));
  if (btn) btn.classList.add('on');

  // Синхронизируем маркер вкладки для палитры фоновых пятен
  document.body.dataset.tab = tab;

  document.querySelectorAll('.scr').forEach(s => {
    s.classList.remove('on', 'back');
    s.style.transform = 'translateX(100%)';
  });

  const screenId = targetScreenId || tabRoots()[tab];
  const el = document.getElementById(screenId);
  if (el) { el.style.transform = ''; el.classList.add('on'); }

  screenStack.forEach(sid => {
    const backEl = document.getElementById(sid);
    if (backEl) { backEl.classList.add('back'); backEl.classList.remove('on'); backEl.style.transform = ''; }
  });

  if (screenId === 's-order-detail' && currentOrderRow) {
    const order    = findOrder(currentOrderRow);
    const isActive = ACTIVE_ORDERS.some(o => o.row == currentOrderRow);
    if (order) {
      document.getElementById('od-title').textContent = order.client || 'Заказ';
      document.getElementById('od-sub').textContent =
        (order.event_date || '') + (order.event_time ? ' в ' + order.event_time : '');
      renderOrderDetail(order, isActive);
    }
  }
  updateBackButtonVisibility();
}

function updateBackButtonVisibility() {
  const btn = document.querySelector('#s-new-details .hdr-back');
  if (btn) btn.style.display = screenStack.length > 0 ? 'flex' : 'none';
}

// ══════════════════════════════════════════════════════════
// БАДЖИ / ОВЕРЛЕЙ
// ══════════════════════════════════════════════════════════
function updateAllBadges() {
  const activeCount = (ACTIVE_ORDERS || []).length;
  const oBdg = document.getElementById('bdg-orders');
  if (oBdg) { oBdg.textContent = activeCount; oBdg.classList.toggle('on', activeCount > 0); }

  const shopCount = (SHOPPING || []).filter(i => !i.bought).length;
  const sBdg = document.getElementById('bdg-shop');
  if (sBdg) { sBdg.textContent = shopCount; sBdg.classList.toggle('on', shopCount > 0); }
}

function showLoadingOverlay(text = "Загрузка...") {
  const l = document.getElementById('loader');
  const t = l.querySelector('.load-text');
  if (t) t.textContent = text;
  l.style.display = 'flex';
}

function hideLoadingOverlay() {
  document.getElementById('loader').style.display = 'none';
}

// ══════════════════════════════════════════════════════════
// ЧЕРНОВИК
// ══════════════════════════════════════════════════════════
function saveDraft() {
  const client = document.getElementById('o-client')?.value || '';
  if (!client && !Object.keys(cart).length) { clearDraft(); return; }
  const draft = {
    client,
    contact:   document.getElementById('o-contact')?.value || '',
    date:      document.getElementById('o-date')?.value    || '',
    time:      document.getElementById('o-time')?.value    || '',
    delivType,
    addr:      document.getElementById('o-addr')?.value    || '',
    dcost:     document.getElementById('o-dcost')?.value   || '',
    prepay,
    discount:  draftDiscount,
    note:      document.getElementById('c-note')?.value    || '',
    cart,
    cartOrder,
    editingRow,
    ts: Date.now(),
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
}

function applyDraft(d) {
  if (!d) return;
  draftDiscount = +d.discount || 0;
  document.getElementById('o-client').value  = d.client  || '';
  setContactValue(d.contact);
  document.getElementById('o-date').value    = d.date    || '';
  document.getElementById('o-time').value    = d.time    || '';
  document.getElementById('o-addr').value    = d.addr    || '';
  document.getElementById('o-dcost').value   = d.dcost   || '';
  document.getElementById('c-note').value    = d.note    || ''; // ИСПРАВЛЕНО (1.2)
  setDeliv(d.delivType || 'Самовывоз', null, true);
  setPay(!!d.prepay, null, true);
  cart      = d.cart      || {};
  cartOrder = d.cartOrder || Object.keys(d.cart || {});
  editingRow = d.editingRow || null;
  updateEditSaveBar();
}

// ══════════════════════════════════════════════════════════
// ЗАГРУЗКА ДАННЫХ
// ══════════════════════════════════════════════════════════
async function loadCache(force = false) {
  const result = await fetchData(force);
  if (!result) return false;

  MENU           = result.data.menu           || [];
  CLIENTS        = result.data.clients        || [];
  ACTIVE_ORDERS  = result.data.active_orders  || [];
  ARCHIVE_ORDERS = result.data.archive_orders || [];
  SHOPPING       = result.data.shopping_list  || [];

  saveLocalCache(result.data);

  const upd   = result.data.updated || '';
  const label = (upd ? 'Обновлено: ' + upd : '') + sourceLabel(result.source);
  document.getElementById('cache-time').textContent  = label;
  document.getElementById('cache-time2').textContent = label;

  updateAllBadges();
  return true;
}

async function forceReload() {
  showToast('⟳ Обновляю…');
  renderSkeletons('orders-list', 4);
  const success = await loadCache(true);
  if (success) {
    renderCurrentTab();
    showToast('✓ Данные обновлены');
  } else {
    showToast('⚠️ Ошибка соединения');
  }
}

// ══════════════════════════════════════════════════════════
// НАВИГАЦИЯ & СИНХРОНИЗАЦИЯ С HISTORY API
// ══════════════════════════════════════════════════════════
function tabRoots() {
  return { orders:'s-orders', new:'s-new-details', shopping:'s-shopping', dashboard:'s-dashboard', menu:'s-menu', sheet:'s-sheet' };
}

function switchTab(tab, btn) {
  screenStack = [];
  currentTab  = tab;

  // Маркер текущей вкладки для палитры фоновых пятен (только CSS, без логики)
  document.body.dataset.tab = tab;

  // #4: табы переключаются мгновенно (без слайда) — как нативные iOS/Android.
  // tab-switch убирает transition; убираем класс через 50мс, чтобы не сломать pushScreen.
  document.querySelectorAll('.scr').forEach(s => s.classList.add('tab-switch'));

  window.history.replaceState({ tab: tab, stackLength: 0 }, '');

  document.querySelectorAll('.tb').forEach(b => b.classList.remove('on'));

  if (btn) {
    btn.classList.add('on');
  } else {
    // Резервный выбор кнопки навигации, если объект не передан напрямую
    const tabIndexMap = { orders:1, new:2, shopping:3, dashboard:4, menu:5, sheet:6 };
    const btnIdx = tabIndexMap[currentTab] || 1;
    const backupBtn = document.querySelectorAll('.tab-bar .tb')[btnIdx - 1];
    if (backupBtn) backupBtn.classList.add('on');
  }

  document.querySelectorAll('.scr').forEach(s => {
    s.classList.remove('on', 'back'); s.style.transform = '';
  });

  const el = document.getElementById(tabRoots()[tab]);
  if (el) {
    el.classList.add('on');
  }

  if (tab === 'new') {
    const bypass = sessionStorage.getItem('bypass_draft');
    if (bypass) {
      sessionStorage.removeItem('bypass_draft');
      initNewOrder();
      updateBackButtonVisibility();
      saveLastScreen();
      setTimeout(() => document.querySelectorAll('.scr').forEach(s => s.classList.remove('tab-switch')), 50);
      return;
    }
    const draft = loadDraft();
    if (draft && (draft.client || Object.keys(draft.cart || {}).length > 0)) {
      showConfirm(
        'Незавершённый заказ',
        `Продолжить оформление заказа${draft.client ? ' для ' + draft.client : ''}?`,
        'Продолжить',
        () => { applyDraft(draft); updateBackButtonVisibility(); renderCurrentTab(); saveLastScreen(); setTimeout(() => document.querySelectorAll('.scr').forEach(s => s.classList.remove('tab-switch')), 50); },
        () => { clearDraft(); initNewOrder(); updateBackButtonVisibility(); saveLastScreen(); setTimeout(() => document.querySelectorAll('.scr').forEach(s => s.classList.remove('tab-switch')), 50); }
      );
      return;
    }
    initNewOrder();
  }

  updateBackButtonVisibility();
  renderCurrentTab();
  saveLastScreen();
  setTimeout(() => document.querySelectorAll('.scr').forEach(s => s.classList.remove('tab-switch')), 50);
}

function pushScreen(id) {
  // #2: двойной requestAnimationFrame — гарантирует, что is-animating
  // применён и отрисован ДО начала transform transition (без мерцания)
  markAnimating();
  const cur = document.querySelector('.scr.on');
  if (cur) { cur.classList.remove('on'); cur.classList.add('back'); }
  screenStack.push(cur ? cur.id : tabRoots()[currentTab]);

  window.history.pushState({ tab: currentTab, stackLength: screenStack.length }, '');

  const next = document.getElementById(id);
  if (next) {
    next.style.transform = 'translateX(100%)';
    next.classList.remove('back');
    next.getBoundingClientRect();
    next.style.transform = '';
    next.classList.add('on');
  }
  updateBackButtonVisibility();
  saveLastScreen();
}

function goBack() {
  if (screenStack.length > 0) {
    window.history.back();
  }
}

window.addEventListener('popstate', (event) => {
  const state = event.state;
  const targetStackLength = (state && typeof state.stackLength === 'number') ? state.stackLength : 0;

  if (screenStack.length > targetStackLength) {
    markAnimating();
    while (screenStack.length > targetStackLength) {
      const prev = screenStack.pop();
      const cur = document.querySelector('.scr.on');
      if (cur) {
        cur.classList.remove('on');
        cur.style.transform = 'translateX(100%)';
      }
      const prevEl = document.getElementById(prev);
      if (prevEl) {
        prevEl.classList.remove('back');
        prevEl.classList.add('on');
      }
    }
    updateBackButtonVisibility();
    saveLastScreen();
  } else if (state && state.rootBackIntercept) {
    const now = Date.now();
    if (now - lastBackPress < 2000) {
      window.history.back();
    } else {
      lastBackPress = now;
      showToast('Для закрытия приложения еще раз нажмите "Назад"');
      window.history.pushState({ tab: currentTab, stackLength: 0 }, '');
    }
  }
});

function renderCurrentTab() {
  if (currentTab === 'orders')    renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
  if (currentTab === 'shopping')  renderShopping(SHOPPING);
  if (currentTab === 'menu')      { renderMenuChips(); renderMenuEdit(MENU, menuEditQuery, menuEditCat); }
  if (currentTab === 'dashboard') loadDashboard();
  if (currentTab === 'sheet')     renderSheet();
}

// ══════════════════════════════════════════════════════════
// ЗАКАЗЫ
// ══════════════════════════════════════════════════════════
function setOrderTab(tab, btn) {
  orderTab = tab;
  document.querySelectorAll('#s-orders .f-tgl-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
}

// ══════════════════════════════════════════════════════════
// P3: КАЛЕНДАРЬ-ТЕПЛОКАРТА
// ══════════════════════════════════════════════════════════
function toggleCalendarSpoiler() {
  calSpoilerOpen = !calSpoilerOpen;
  document.getElementById('cal-spoiler').classList.toggle('open', calSpoilerOpen);
  if (calSpoilerOpen) renderCalendar();
}

function calShiftMonth(delta) {
  calMonth += delta;
  if (calMonth > 12) { calMonth = 1;  calYear++; }
  if (calMonth < 1)  { calMonth = 12; calYear--; }
  renderCalendar();
}

function selectCalDay(dateStr) {
  // Клик по тому же дню — сброс
  calDayFilter = (calDayFilter === dateStr) ? null : dateStr;
  renderCalendar();
  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
}

function clearCalDayFilter() {
  calDayFilter = null;
  renderCalendar();
  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
}

// ИСПРАВЛЕНО (5.3) - Оптимизированный поиск заказов с Debounce
let _orderSearchTimer;
function onOrderSearch() {
  clearTimeout(_orderSearchTimer);
  _orderSearchTimer = setTimeout(() => {
    searchQuery = (document.getElementById('order-srch')?.value || '').trim();
    renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
  }, 250);
}

function openOrderDetail(row) {
  currentOrderRow = row;
  const order = findOrder(row);
  if (!order) { showToast('Заказ не найден'); return; }
  const isActive  = ACTIVE_ORDERS.some(o => o.row == row);
  document.getElementById('od-title').textContent = order.client || 'Заказ';
  document.getElementById('od-sub').textContent =
    (order.event_date || '') + (order.event_time ? ' в ' + order.event_time : '');
  renderOrderDetail(order, isActive);
  pushScreen('s-order-detail');
}

function findOrder(row) {
  return ACTIVE_ORDERS.find(o => o.row == row) ||
         ARCHIVE_ORDERS.find(o => o.row == row);
}

// ══════════════════════════════════════════════════════════
// СМЕНА СТАТУСА
// ══════════════════════════════════════════════════════════
function openStatusModal(row) {
  const order = findOrder(row);
  const statuses = [ST.NEW, ST.CONF, ST.COOK, ST.DONE, ST.CANC];
  let html = '<div class="status-grid">';
  statuses.forEach(s => {
    const sc = ({ [ST.NEW]:"st-new",[ST.CONF]:"st-conf",[ST.COOK]:"st-cook",[ST.DONE]:"st-done",[ST.CANC]:"st-canc" })[s] || '';
    const on = order?.status === s ? ' on' : '';
    html += `<button class="st-btn ${sc}${on}" onclick="changeStatus(${row},'${s}')">${s}</button>`;
  });
  html += '</div>';
  document.getElementById('modal-title').textContent = 'Изменить статус';
  document.getElementById('modal-body').innerHTML    = html;
  document.getElementById('modal').classList.add('on');
}

function closeModal() { document.getElementById('modal').classList.remove('on'); }

function changeStatus(row, status) {
  closeModal();
  const isDone = [ST.DONE, ST.CANC].includes(status);
  const msg    = isDone
    ? `Перевести в «${status}»? Заказ уйдёт в архив.`
    : `Изменить статус на «${status}»?`;

  showConfirm('Изменить статус', msg, 'Подтвердить', async () => {
    const o = ACTIVE_ORDERS.find(o => o.row == row);
    if (o) {
      o.status = status;
      if (isDone) {
        ACTIVE_ORDERS  = ACTIVE_ORDERS.filter(x => x.row != row);
        ARCHIVE_ORDERS.unshift({ ...o, status });
      }
    }
    const updated = findOrder(row);
    if (updated) renderOrderDetail(updated, ACTIVE_ORDERS.some(o => o.row == row));
    renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
    updateAllBadges();

    await sendActionToGAS({ action: 'change_status', order_row: row, status });
  });
}

// ══════════════════════════════════════════════════════════
// ПРЕДЧЕК
// ══════════════════════════════════════════════════════════
function genReceipt(row) {
  showReceiptModal(row);
}

// ══════════════════════════════════════════════════════════
// КАРТА / МАРШРУТ
// ══════════════════════════════════════════════════════════
function openMapChoice(encodedAddr) {
  const address = decodeURIComponent(encodedAddr || '');
  if (!address || address === 'Самовывоз') { showToast('Адрес не указан'); return; }
  const q    = encodeURIComponent(address);
  const apps = [
    { name: 'Google Карты',     url: `https://maps.google.com/?q=${q}` },
    { name: 'Яндекс Карты',     url: `https://maps.yandex.ru/?text=${q}` },
  ];
  const body = document.getElementById('modal-body');
  body.innerHTML = '<div style="padding:0 0 8px;display:flex;flex-direction:column;gap:8px">' +
    apps.map(a =>
      `<button onclick="window.open('${a.url}','_blank');closeModal()"
        style="height:46px;border:1px solid var(--border);border-radius:var(--rad-s);
               background:var(--bg);font-size:15px;font-family:inherit;color:var(--text);
               cursor:pointer;text-align:left;padding:0 16px">${a.name}</button>`
    ).join('') + '</div>';
  document.getElementById('modal-title').textContent = 'Маршрут';
  document.getElementById('modal').classList.add('on');
}

// ══════════════════════════════════════════════════════════
// ДУБЛИРОВАНИЕ ЗАКАЗА
// ══════════════════════════════════════════════════════════
function duplicateOrder(row) {
  const order = findOrder(row);
  if (!order) return;

  sessionStorage.setItem('bypass_draft', 'true');
  const newBtn = document.querySelectorAll('.tab-bar .tb')[1];
  switchTab('new', newBtn);

  editingRow = null;
  cart = {};
  cartOrder = [];
  (order.dishes || []).forEach((d, i) => {
    const menuDish = MENU.find(m => m.name === d.name);
    const id = menuDish ? String(menuDish.id) : ('dup' + i);
    cart[id] = {
      d: { id, name: d.name, cat: menuDish?.cat || '' },
      q: +d.qty || 1,
      p: +d.price || 0,
      cost: +d.cost || (menuDish ? +menuDish.cost : 0), // ИСПРАВЛЕНО (1.1)
      unit: d.unit || menuDish?.unit || (!menuDish ? 'шт' : 'порц.'),
      manual: !menuDish,
    };
    cartOrder.push(id);
  });

  document.getElementById('o-client').value  = order.client || '';
  setContactValue(order.contact);
  document.getElementById('o-date').value    = '';
  document.getElementById('o-time').value    = order.event_time || '';
  setDeliv(order.delivery_type || 'Самовывоз', null, true);
  document.getElementById('o-addr').value  = order.address  || '';
  document.getElementById('o-dcost').value = order.delivery || '';
  document.getElementById('c-note').value  = order.note     || '';
  
  const hasPrepay = order.prepayment !== undefined && order.prepayment !== null
    ? (typeof order.prepayment === 'boolean' ? order.prepayment : String(order.prepayment).trim().toLowerCase() !== 'false' && String(order.prepayment).trim() !== '0')
    : true;
  setPay(hasPrepay, null, true);

  saveDraft();
  saveLastScreen();
  showToast('📋 Заказ скопирован — укажите дату');
}

// ══════════════════════════════════════════════════════════
// РЕДАКТИРОВАНИЕ ЗАКАЗА
// ══════════════════════════════════════════════════════════
// P2: показывать sticky-кнопку «Сохранить изменения» на Шаге 1 только при редактировании.
function updateEditSaveBar() {
  const bar = document.getElementById('edit-save-bar');
  if (bar) bar.style.display = editingRow ? 'block' : 'none';
}

function openEditOrder() {
  const order = findOrder(currentOrderRow);
  if (!order) return;
  editingRow = order.row;
  updateEditSaveBar();

  document.getElementById('o-client').value  = order.client || '';
  setContactValue(order.contact);
  document.getElementById('o-date').value    = dateToISO(order.event_date || '');
  document.getElementById('o-time').value    = order.event_time || '';
  setDeliv(order.delivery_type || 'Самовывоз', null, true);
  document.getElementById('o-addr').value  = order.address  || '';
  document.getElementById('o-dcost').value = order.delivery || '';
  document.getElementById('c-note').value  = order.note     || '';
  
  const hasPrepay = order.prepayment !== undefined && order.prepayment !== null
    ? (typeof order.prepayment === 'boolean' ? order.prepayment : String(order.prepayment).trim().toLowerCase() !== 'false' && String(order.prepayment).trim() !== '0')
    : true;
  setPay(hasPrepay, null, true);
  draftDiscount = +order.discount_percent || 0;

  cart = {};
  cartOrder = [];
  const dishes = order.dishes || [];
  if (dishes.length) {
    dishes.forEach((d, i) => {
      const menuDish = MENU.find(m => m.name === d.name);
      const id = menuDish ? String(menuDish.id) : ('e' + i);
      cart[id] = {
        d: { id, name: d.name, cat: menuDish?.cat || '' },
        q: +d.qty || 1,
        p: +d.price || 0,
        cost: +d.cost || (menuDish ? +menuDish.cost : 0), // ИСПРАВЛЕНО (1.1)
        unit: d.unit || menuDish?.unit || (!menuDish ? 'шт' : 'порц.'),
        manual: !menuDish,
      };
      cartOrder.push(id);
    });
    showToast('Редактирование #' + order.row + ' · ' + dishes.length + ' блюд');
  } else {
    showToast('⚠️ Состав не загружен — обновите кеш');
  }

  pushScreen('s-new-details');
}

// ══════════════════════════════════════════════════════════
// НОВЫЙ ЗАКАЗ — ДЕТАЛИ
// ══════════════════════════════════════════════════════════
function initNewOrder() {
  editingRow = null;
  updateEditSaveBar();
  cart = {};
  cartOrder = [];
  ['o-client','o-date','o-time','o-addr','o-dcost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  setContactValue('');
  const aiTxt = document.getElementById('ai-txt');
  if (aiTxt) aiTxt.value = '';
  
  const noteTxt = document.getElementById('c-note'); // ИСПРАВЛЕНО (1.2)
  if (noteTxt) noteTxt.value = '';
  
  setDeliv('Самовывоз', null, true);
  setPay(true, null, true);
}

function setDeliv(v, btn, silent) {
  const val = String(v || '').trim().toLowerCase();
  const isDelivery = val.includes('дост') || val.includes('dost');
  
  delivType = isDelivery ? 'Доставка' : 'Самовывоз';

  document.querySelectorAll('#tg-deliv .f-tgl-btn').forEach((b, i) =>
    b.classList.toggle('on', i === (isDelivery ? 1 : 0))
  );
  document.getElementById('deliv-extra').style.display = isDelivery ? 'block' : 'none';
  if (!silent) updCart();
}

function setPay(v, btn, silent) {
  prepay = v;
  document.querySelectorAll('#tg-pay .f-tgl-btn').forEach((b, i) =>
    b.classList.toggle('on', v ? i === 0 : i === 1)
  );
}

// ИСПРАВЛЕНО (5.3) - Оптимизированный поиск клиентов с Debounce
let _clientInputTimer;
function onClientInput() {
  saveDraft();
  clearTimeout(_clientInputTimer);
  _clientInputTimer = setTimeout(() => {
    const q  = document.getElementById('o-client').value.trim().toLowerCase();
    const dd = document.getElementById('c-drop');
    if (!q) { dd.classList.remove('on'); return; }
    const hits = CLIENTS.filter(c => c.name.toLowerCase().includes(q)).slice(0, 8);
    if (!hits.length) { dd.classList.remove('on'); return; }
    dd._hits = hits;
    dd.innerHTML = hits.map((c, i) => `
      <div class="c-opt" onclick="pickClient(${i})">
        <div class="c-opt-n">${esc(c.name)}</div>
        <div class="c-opt-s">${esc(c.contact||'')}${c.type?' · '+esc(c.type):''}${c.address?' · '+esc(c.address):''}</div>
      </div>`).join('');
    dd.classList.add('on');
  }, 250);
}

function pickClient(i) {
  const c = document.getElementById('c-drop')._hits[i];
  document.getElementById('o-client').value  = c.name;
  setContactValue(c.contact);
  setDeliv(c.type || 'Самовывоз', null, true);
  if (c.address) document.getElementById('o-addr').value = c.address;
  document.getElementById('c-drop').classList.remove('on');
  saveDraft();
}

function clearClient() {
  document.getElementById('o-client').value = '';
  document.getElementById('c-drop').classList.remove('on');
}

document.addEventListener('click', e => {
  if (!e.target.closest('.cw')) document.getElementById('c-drop').classList.remove('on');
});

// ИСПРАВЛЕНО (4.1) - AI Импорт с предупреждением о перезаписи товаров
async function runAI() {
  const txt = document.getElementById('ai-txt').value.trim();
  if (!txt) { showToast('Вставьте сообщение клиента'); return; }

  showLoadingOverlay("🤖 ИИ разбирает сообщение...");
  try {
    const response = await fetch(GAS_URL, {
      method: 'POST',
      redirect: 'follow',
      body: JSON.stringify({ action: 'ai_request', text: txt, secret: APP_SECRET })
    });
    if (response.ok) {
      const resData = await response.json();
      if (resData && !resData.error && resData.ai_result) {
        
        const applyAI = () => {
          applyAIResultToForm(resData.ai_result);
          showToast("🤖 Сообщение успешно распознано! Блюда в корзине");
        };

        if (Object.keys(cart).length > 0 && resData.ai_result.dishes?.length > 0) {
          showConfirm(
            'Внимание',
            'Новый ИИ-импорт заменит текущие блюда в корзине. Продолжить?',
            'Заменить',
            applyAI
          );
        } else {
          applyAI();
        }

      } else {
        showToast("⚠️ Ошибка: " + (resData?.error || "ИИ не распознал текст"));
      }
    } else {
      showToast("⚠️ Ошибка сети ИИ");
    }
  } catch (e) {
    console.error("[AI request error]", e);
    showToast("⚠️ Не удалось связаться с ИИ");
  } finally {
    hideLoadingOverlay();
  }
}

function applyAIResultToForm(res) {
  if (!res) return;
  if (res.client)        document.getElementById('o-client').value  = res.client;
  if (res.contact) setContactValue(res.contact);
  if (res.event_date)    document.getElementById('o-date').value    = dateToISO(res.event_date);
  if (res.event_time)    document.getElementById('o-time').value    = res.event_time;
  if (res.delivery_type) {
    setDeliv(res.delivery_type, null, true);
    if (res.delivery_type === 'Доставка' && res.address)
      document.getElementById('o-addr').value = res.address;
  }
  if (res.delivery_cost) document.getElementById('o-dcost').value = res.delivery_cost;
  if (res.note)          document.getElementById('c-note').value  = res.note;

  if (res.prepayment !== undefined) {
    setPay(!!res.prepayment, null, true);
  }

  if (res.dishes && res.dishes.length) {
    cart = {};
    cartOrder = [];
    res.dishes.forEach((d, i) => {
      const menuDish = MENU.find(m => m.name.toLowerCase() === d.name.toLowerCase());
      const id = menuDish ? String(menuDish.id) : ('ai' + i);
      cart[id] = {
        d: { id, name: d.name, cat: menuDish?.cat || 'ИИ-Импорт' },
        q: +d.qty || 1,
        p: +d.price || (menuDish ? +menuDish.price : 0),
        cost: +d.cost || (menuDish ? +menuDish.cost : 0), // ИСПРАВЛЕНО (1.1)
        unit: d.unit || menuDish?.unit || 'порц.',
        manual: !menuDish
      };
      cartOrder.push(id);
    });
  }
  saveDraft();
  renderCurrentTab();
}

// ══════════════════════════════════════════════════════════
// КАТАЛОГ
// ══════════════════════════════════════════════════════════
function goToCatalog() {
  saveDraft();
  buildChips('chips', MENU, filterMenu);
  filterMenu();
  pushScreen('s-catalog');
}

function buildChips(containerId, menu, filterFn) {
  const cats = ['Все', ...new Set(menu.map(d => d.cat).filter(Boolean))];
  const el   = document.getElementById(containerId);
  el.innerHTML = '';
  cats.forEach((c, i) => {
    const ch = document.createElement('div');
    ch.className  = 'chip' + (i === 0 ? ' on' : '');
    ch.textContent = c;
    ch.onclick = () => {
      el.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      ch.classList.add('on');
      filterFn();
    };
    el.appendChild(ch);
  });
}

// ИСПРАВЛЕНО (5.3) - Оптимизированный рендеринг меню с Debounce
let _menuSearchTimer;
function filterMenu() {
  clearTimeout(_menuSearchTimer);
  _menuSearchTimer = setTimeout(() => {
    const q   = (document.getElementById('srch')?.value || '').toLowerCase();
    const cat = document.querySelector('#chips .chip.on')?.textContent || 'Все';
    const list = MENU.filter(d =>
      (cat === 'Все' || d.cat === cat) && (!q || d.name.toLowerCase().includes(q))
    );
    const el = document.getElementById('menu-list');
    if (!el) return;
    el.innerHTML = '';
    list.forEach(d => {
      const id  = String(d.id);
      const qty = cart[id]?.q || 0;
      const row = document.createElement('div');
      row.className = 'd-row';
      row.innerHTML = `
        <div class="d-info">
          <div class="d-name">${esc(d.name)}</div>
          <div class="d-cat">${esc(d.cat||'')}</div>
        </div>
        <div class="d-price">${(+d.price).toFixed(2)} BYN</div>
        ${qty === 0
          ? `<button class="d-add" onclick="addToCart('${id}')">+</button>`
          : `<div class="qc">
               <button class="qb" onclick="chQ('${id}',-1)">−</button>
               <div class="qv" id="qv-${id}">${qty}</div>
               <button class="qb" onclick="chQ('${id}',1)">+</button>
             </div>`}`;
      el.appendChild(row);
    });
    document.getElementById('cat-sub').textContent = Object.keys(cart).length + ' в корзине';
  }, 200);
}

function addToCart(id) {
  const d = MENU.find(m => String(m.id) === id);
  if (!d) return;
  
  if (!cart[id]) {
    cart[id] = {
      d: { id, name: d.name, cat: d.cat || '' },
      q: 0,
      p: +d.price || 0,
      cost: +d.cost || 0, // ИСПРАВЛЕНО (1.1)
      unit: d.unit || 'порц.',
    };
    cartOrder.push(id);
  }
  
  const { step } = getUnitStepAndMin(cart[id].unit);
  cart[id].q = Math.round((cart[id].q + step) * 100) / 100;
  
  saveDraft();
  updCart();
  filterMenu();
}

function chQ(id, delta) {
  if (!cart[id]) return;
  const { step } = getUnitStepAndMin(cart[id].unit);
  let newQ = Math.round((cart[id].q + delta * step) * 100) / 100;
  
  if (newQ <= 0) {
    delete cart[id];
    cartOrder = cartOrder.filter(k => k !== id);
  } else {
    cart[id].q = newQ;
  }
  saveDraft();
  updCart();
  filterMenu();
}

function addManual() {
  const name  = document.getElementById('m-name').value.trim();
  const price = parseFloat(document.getElementById('m-price').value) || 0;
  const qty   = parseFloat(document.getElementById('m-qty').value)   || 1;
  if (!name)    { showToast('Укажите название'); return; }
  if (price <= 0) { showToast('Укажите цену'); return; }
  const id = 'm' + (manualId++);
  cart[id] = { d:{id, name, cat:'Вручную'}, q:qty, p:price, cost:0, manual:true, unit:'шт' }; // ИСПРАВЛЕНО (1.1)
  cartOrder.push(id);
  document.getElementById('m-name').value  = '';
  document.getElementById('m-price').value = '';
  document.getElementById('m-qty').value   = '';
  saveDraft(); updCart(); showToast('✓ ' + name);
}

// ══════════════════════════════════════════════════════════
// КОРЗИНА
// ══════════════════════════════════════════════════════════
function goToCart() {
  saveDraft();
  renderCartFull();
  pushScreen('s-cart');
}

function renderCartFull() {
  const keys = cartOrder.length ? cartOrder.filter(k => cart[k]) : Object.keys(cart);
  const empty = document.getElementById('cart-empty');
  const items = document.getElementById('cart-items');
  const noteW = document.getElementById('cart-note-wrap');
  const sv    = document.getElementById('sv-btn');

  if (!keys.length) {
    empty.style.display = 'flex';
    items.innerHTML     = '';
    if (noteW) noteW.style.display = 'none';
    sv.disabled = true;
    document.getElementById('cart-sub').textContent = 'Пусто';
    return;
  }

  empty.style.display = 'none';
  if (noteW) noteW.style.display = 'block';
  sv.disabled = false;

  const discount = draftDiscount; // ИСПРАВЛЕНО (1.3)

  items.innerHTML = `<div class="discount-wrap">
    <span class="dw-l">Скидка</span>
    <input class="dw-inp" type="number" id="c-discount" value="${discount||''}"
      placeholder="0" min="0" max="100" step="1" oninput="updCart();saveDraft()"/>
    <span class="dw-pct">%</span>
  </div>` +
  keys.map(k => {
    const it = cart[k];
    const { step } = getUnitStepAndMin(it.unit);
    // P6: если у позиции «наследственная» единица не из UNITS — показываем её тоже, чтобы не потерять.
    const opts = UNITS.includes(it.unit) ? UNITS : [it.unit, ...UNITS];

    return `<div class="ci" id="ci-${k}" draggable="false" data-key="${k}">
      <div class="ci-top">
        <div class="ci-drag" title="Перетащить">⠿</div>
        <div class="ci-name">${esc(it.d.name)}${it.manual?'<br><span style="font-size:11px;color:var(--hint)">вручную</span>':''}</div>
        <button class="ci-del" onclick="confirmRemoveFromCart('${k}')">🗑</button>
      </div>
      <div class="ci-bot">
        <div class="ci-pe">
          <div class="qc">
            <button class="qb" onclick="chCartQ('${k}',-1)">−</button>
            <input class="qv" type="number" value="${it.q}" step="${step}" min="${step}"
              oninput="chCartQInput('${k}', this.value)"/>
            <button class="qb" onclick="chCartQ('${k}',1)">+</button>
          </div>
          <select class="ci-unit-sel" onchange="chCartUnit('${k}', this.value)">
            ${opts.map(u => `<option value="${u}"${u===it.unit?' selected':''}>${u}</option>`).join('')}
          </select>
          <span class="ci-unit" style="margin:0 4px">×</span>
          <input class="ci-pi" type="number" value="${it.p.toFixed(2)}" step="0.5" min="0"
            onchange="chCartPrice('${k}',this.value)"/>
          <span class="ci-unit">BYN</span>
        </div>
        <div class="ci-total" id="cit-${k}">= ${(it.q*it.p).toFixed(2)} BYN</div>
      </div>
    </div>`;
  }).join('');

  updCart();
  _attachCartDrag();
}

function confirmRemoveFromCart(id) {
  if (!cart[id]) return;
  showConfirm(
    "Удалить блюдо?",
    `Хотите удалить блюдо «${cart[id].d.name}» из корзины?`,
    "Удалить",
    () => {
      removeFromCart(id);
      showToast("✓ Блюдо удалено");
    },
    null,
    true
  );
}

function _attachCartDrag() {
  const container = document.getElementById('cart-items');
  if (!container || container._dragAttached) return;
  container._dragAttached = true;

  let dragEl = null, ghostEl = null, startY = 0, offsetY = 0, dragKey = null;

  container.addEventListener('touchstart', e => {
    const handle = e.target.closest('.ci-drag');
    if (!handle) return;
    const ci = handle.closest('.ci');
    if (!ci) return;
    dragKey = ci.dataset.key;
    dragEl  = ci;
    const rect = ci.getBoundingClientRect();
    startY  = e.touches[0].clientY;
    offsetY = startY - rect.top;
    ghostEl = ci.cloneNode(true);
    ghostEl.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;opacity:0.85;z-index:9999;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,0.18);border-radius:var(--rad);background:var(--bg);transition:none;`;
    document.body.appendChild(ghostEl);
    ci.style.opacity = '0.3';
    e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', e => {
    if (!dragEl || !ghostEl) return;
    e.preventDefault();
    const y = e.touches[0].clientY;
    ghostEl.style.top = (y - offsetY) + 'px';
    ghostEl.style.display = 'none';
    const elBelow = document.elementFromPoint(e.touches[0].clientX, y);
    ghostEl.style.display = '';
    const targetCi = elBelow?.closest('.ci[data-key]');
    if (targetCi && targetCi !== dragEl) {
      const mid = targetCi.getBoundingClientRect().top + targetCi.getBoundingClientRect().height / 2;
      container.insertBefore(dragEl, y < mid ? targetCi : targetCi.nextSibling);
      _syncCartOrderFromDOM(container);
    }
  }, { passive: false });

  const _endDrag = () => {
    if (!dragEl) return;
    dragEl.style.opacity = '';
    ghostEl?.remove();
    ghostEl = dragEl = dragKey = null;
    saveDraft(); updCart();
  };
  document.addEventListener('touchend',    _endDrag, { once: false });
  document.addEventListener('touchcancel', _endDrag, { once: false });
}

function _syncCartOrderFromDOM(container) {
  const domKeys = [...container.querySelectorAll('.ci[data-key]')]
    .map(el => el.dataset.key).filter(k => cart[k]);
  cartOrder = domKeys;
  Object.keys(cart).forEach(k => { if (!cartOrder.includes(k)) cartOrder.push(k); });
}

function removeFromCart(id) {
  delete cart[id];
  cartOrder = cartOrder.filter(k => k !== id);
  saveDraft();
  renderCartFull();
  if (typeof filterMenu === 'function') filterMenu();
}

function getUnitStepAndMin(unit) {
  const u = (unit || '').toLowerCase().trim();
  const isWeight = ['кг','л','г','мл','кг.','л.','kg','l','g','ml'].includes(u);
  return {
    step: isWeight ? 0.1 : 1,
    min: isWeight ? 0.1 : 1,
    isWeight: isWeight
  };
}

function chCartQ(id, dir) {
  if (!cart[id]) return;
  const { step, min } = getUnitStepAndMin(cart[id].unit);
  // P6: dir — направление (±1); step берётся из текущей единицы, чтобы кнопки адаптировались при смене unit.
  let newQ = Math.round((cart[id].q + dir * step) * 100) / 100;
  if (newQ < min) {
    newQ = min;
  }
  
  cart[id].q = newQ;
  
  const qv = document.querySelector(`#ci-${CSS.escape(id)} .qv`);
  if (qv) {
    if (qv.tagName === 'INPUT') qv.value = cart[id].q;
    else qv.textContent = cart[id].q;
  }
  
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  
  saveDraft();
  updCart();
  
  if (typeof filterMenu === 'function') filterMenu();
}

function chCartUnit(id, newUnit) {
  if (!cart[id]) return;
  cart[id].unit = newUnit;
  const { step, min } = getUnitStepAndMin(newUnit);
  // P6: при смене весовой↔штучная — если qty меньше нового min, подтягиваем вверх.
  if (cart[id].q < min) cart[id].q = min;
  const qv = document.querySelector(`#ci-${CSS.escape(id)} .qv`);
  if (qv && qv.tagName === 'INPUT') {
    qv.step = String(step);
    qv.min = String(min);
    qv.value = cart[id].q;
  }
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  saveDraft();
  updCart();
  if (typeof filterMenu === 'function') filterMenu();
}

function chCartQInput(id, val) {
  if (!cart[id]) return;
  const { min } = getUnitStepAndMin(cart[id].unit);
  let q = parseFloat(val);
  if (isNaN(q)) return;
  if (q < min) q = min;
  
  cart[id].q = Math.round(q * 100) / 100;
  
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  
  saveDraft();
  updCart();
  
  if (typeof filterMenu === 'function') filterMenu();
}

function chCartPrice(id, v) {
  if (!cart[id]) return;
  cart[id].p = parseFloat(v) || 0;
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  saveDraft(); updCart();
}

function updCart() {
  const keys = Object.keys(cart);
  const qty  = keys.reduce((s, k) => s + cart[k].q, 0);
  const sub  = keys.reduce((s, k) => s + cart[k].q * cart[k].p, 0);

  const discEl = document.getElementById('c-discount');
  if (discEl) draftDiscount = parseFloat(discEl.value) || 0;

  const disc = draftDiscount;
  const discA = sub * disc / 100;
  const deliv = delivType === 'Доставка' ? (parseFloat(document.getElementById('o-dcost')?.value) || 0) : 0;
  const total = sub - discA + deliv;

  const cv = document.getElementById('c-total');
  if (cv) cv.textContent = total.toFixed(2).replace('.', ',');
  const cs = document.getElementById('cart-sub');
  if (cs) cs.textContent = keys.length + ' позиций, ' + qty + ' шт';

  const lines = document.getElementById('cart-footer-lines');
  if (lines) {
    let html = `<div class="cf-line"><span>Блюда (${keys.length} поз.)</span><span>${sub.toFixed(2)} BYN</span></div>`;
    if (disc > 0) html += `<div class="cf-line"><span>Скидка ${disc}%</span><span>−${discA.toFixed(2)} BYN</span></div>`;
    if (deliv > 0) html += `<div class="cf-line"><span>Доставка</span><span>${deliv.toFixed(2)} BYN</span></div>`;
    lines.innerHTML = html;
  }

  const sv = document.getElementById('sv-btn');
  if (sv) sv.disabled = keys.length === 0;
}

// ══════════════════════════════════════════════════════════
// СОХРАНЕНИЕ ЗАКАЗА
// ══════════════════════════════════════════════════════════
async function saveOrder() {
  const client = document.getElementById('o-client').value.trim();
  const date   = document.getElementById('o-date').value;
  const keys   = cartOrder.length ? cartOrder : Object.keys(cart);

  if (!client)      { showToast('Укажите клиента'); return; }
  if (!date)        { showToast('Укажите дату'); return; }
  if (!keys.length) { showToast('Корзина пуста'); return; }

  const [yy, mm, dd] = date.split('-').map(Number);
  const selectedDate  = new Date(yy, mm - 1, dd);
  selectedDate.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);

  if (isNaN(selectedDate.getTime())) { showToast('Неверный формат даты'); return; }
  if (!editingRow && selectedDate < today) { showToast('❌ Дата не может быть в прошлом'); return; }

  const dcost = delivType === 'Доставка' ? (parseFloat(document.getElementById('o-dcost').value) || 0) : 0;

  const payload = {
    action:           editingRow ? 'edit_order' : 'create_order',
    order_row:        editingRow || undefined,
    client,
    contact:          document.getElementById('o-contact').value || '',
    event_date:       date.split('-').reverse().join('.'),
    event_time:       document.getElementById('o-time').value || '',
    delivery_type:    delivType,
    address:          delivType === 'Доставка' ? (document.getElementById('o-addr').value || '') : '',
    delivery:         dcost,
    prepayment:       prepay,
    discount_percent: draftDiscount,
    note:             document.getElementById('c-note')?.value || '',
    dishes:           keys.filter(k => cart[k]).map(k => ({
      name:  cart[k].d.name,
      qty:   cart[k].q,
      price: cart[k].p,
      cost:  cart[k].cost || 0, // ИСПРАВЛЕНО (1.1)
      unit:  cart[k].unit || 'порц.',
    })),
  };

  const result = await sendActionToGAS(payload);

  if (result) {
    const isEditing = !!editingRow;
    clearDraft();
    
    cart = {};
    cartOrder = [];
    editingRow = null;

    showToast(isEditing ? '✓ Заказ обновлён' : '✓ Заказ создан');
    const ordersBtn = document.querySelectorAll('.tab-bar .tb')[0];
    switchTab('orders', ordersBtn);
  }
}

// ══════════════════════════════════════════════════════════
// ЗАКУПКИ
// ══════════════════════════════════════════════════════════
function submitShopping() {
  const text = (document.getElementById('sh-text')?.value || '').trim();
  if (!text) { showToast('Введите или надиктуйте список'); return; }

  if (SHOPPING && SHOPPING.length > 0) {
    showConfirm(
      'Список не пустой',
      `В списке уже ${SHOPPING.length} позиций. Что сделать с новым?`,
      'Добавить к списку',
      () => _sendShoppingToBot(text, true),
      null, false,
      { secondBtn: 'Создать новый', secondCb: () => _sendShoppingToBot(text, false) }
    );
  } else {
    _sendShoppingToBot(text, false);
  }
}

async function _sendShoppingToBot(text, merge) {
  document.getElementById('sh-text').value = '';
  showToast('🤖 ИИ анализирует закупки…');
  await sendActionToGAS({ action: 'ai_shopping', text, merge });
}

function toggleBought(itemId) {
  const it = (SHOPPING || []).find(x => x.id === itemId);
  if (!it) return;
  it.bought = !it.bought;
  const boughtMap = JSON.parse(localStorage.getItem(SHOPPING_BOUGHT_KEY) || '{}');
  boughtMap[itemId] = it.bought;
  localStorage.setItem(SHOPPING_BOUGHT_KEY, JSON.stringify(boughtMap));
  renderShopping(SHOPPING);
}

function confirmShoppingPurchase() {
  const bought = (SHOPPING || []).filter(i => i.bought);
  if (!bought.length) return;
  _showAmountDialog(bought.length);
}

function _showAmountDialog(count) {
  const body = document.getElementById('modal-body');
  body.innerHTML = `
    <div style="padding:0 4px 8px">
      <div style="font-size:14px;color:var(--hint);margin-bottom:14px;line-height:1.5">
        Отмечено ${count} позиций как купленные.<br>Укажите сумму расходов (необязательно).
      </div>
      <div class="f-group" style="padding:0;margin-bottom:16px">
        <div class="f-label">Сумма закупки (BYN)</div>
        <input class="f-input" type="number" id="sh-amount-input" placeholder="0.00" min="0" step="0.01" style="margin-top:6px"/>
      </div>
      <div style="display:flex;gap:10px">
        <button onclick="closeModal()" style="flex:1;height:42px;border:1px solid var(--border);border-radius:var(--rad-s);background:var(--bg2);font-size:14px;font-weight:600;font-family:inherit;cursor:pointer;color:var(--text)">Отмена</button>
        <button onclick="_submitConfirmedPurchase()" style="flex:2;height:42px;border:none;border-radius:var(--rad-s);background:var(--grn);color:#fff;font-size:14px;font-weight:600;font-family:inherit;cursor:pointer">Подтвердить</button>
      </div>
    </div>`;
  document.getElementById('modal-title').textContent = '✓ Покупка совершена';
  document.getElementById('modal').classList.add('on');
  setTimeout(() => document.getElementById('sh-amount-input')?.focus(), 200);
}

async function _submitConfirmedPurchase() {
  closeModal();
  const amount    = parseFloat(document.getElementById('sh-amount-input')?.value || '') || null;
  const boughtIds = (SHOPPING || []).filter(i => i.bought).map(i => i.id);
  
  try {
    const boughtMap = JSON.parse(localStorage.getItem(SHOPPING_BOUGHT_KEY) || '{}');
    boughtIds.forEach(id => delete boughtMap[id]);
    localStorage.setItem(SHOPPING_BOUGHT_KEY, JSON.stringify(boughtMap));
  } catch (e) {
    console.warn("[shopping] Ошибка очистки локального кэша закупки", e);
  }

  SHOPPING = SHOPPING.filter(i => !i.bought);
  renderShopping(SHOPPING);
  updateAllBadges();
  const result = await sendActionToGAS({ action: 'shopping_confirm', bought_ids: boughtIds, amount });
  if (result) showToast('✅ Покупка подтверждена' + (amount ? ` · ${amount} BYN` : ''));
}

function clearAllShopping() {
  if (!SHOPPING?.length) { showToast('Список уже пустой'); return; }
  showConfirm('Очистить всё', `Удалить все ${SHOPPING.length} позиций из списка закупок?`, 'Удалить всё',
    async () => {
      SHOPPING = [];
      localStorage.removeItem(SHOPPING_BOUGHT_KEY);
      renderShopping(SHOPPING);
      updateAllBadges();
      await sendActionToGAS({ action: 'shopping_clear_all' });
    }, null, true
  );
}

// ══════════════════════════════════════════════════════════
// МЕНЮ-РЕДАКТОР
// ══════════════════════════════════════════════════════════
function renderMenuChips() {
  buildChips('menu-chips', MENU, () => {
    menuEditCat = document.querySelector('#menu-chips .chip.on')?.textContent || 'Все';
    renderMenuEdit(MENU, menuEditQuery, menuEditCat);
  });
}

function filterMenuEdit() {
  menuEditQuery = document.getElementById('menu-srch')?.value || '';
  menuEditCat   = document.querySelector('#menu-chips .chip.on')?.textContent || 'Все';
  renderMenuEdit(MENU, menuEditQuery, menuEditCat);
}

function openDishEdit(id) {
  const d = id ? MENU.find(m => String(m.id) === String(id)) : null;
  editingDishId = id || null;
  document.getElementById('dish-edit-title').textContent = d ? 'Редактировать блюдо' : 'Новое блюдо';
  document.getElementById('de-name').value  = d?.name  || '';
  document.getElementById('de-cat').value   = d?.cat   || '';
  document.getElementById('de-price').value = d?.price || '';
  document.getElementById('de-cost').value  = d?.cost  || '';
  // P6: сохраняем «наследственную» единицу, если её нет в списке из 3 — добавляем опцию, чтобы не потерять молча.
  const unitSel = document.getElementById('de-unit');
  const wantUnit = d?.unit || 'порц.';
  unitSel.value = wantUnit;
  if (unitSel.value !== wantUnit) {
    const extra = document.createElement('option');
    extra.value = wantUnit;
    extra.textContent = wantUnit;
    extra.selected = true;
    unitSel.appendChild(extra);
  }
  const dl = document.getElementById('cat-list');
  dl.innerHTML = [...new Set(MENU.map(m => m.cat).filter(Boolean))]
    .map(c => `<option value="${esc(c)}">`).join('');
  pushScreen('s-dish-edit');
}

function openNewDishForm() { openDishEdit(null); }

async function saveDishEdit() {
  const name  = document.getElementById('de-name').value.trim();
  const cat   = document.getElementById('de-cat').value.trim();
  const price = parseFloat(document.getElementById('de-price').value) || 0;
  const cost  = parseFloat(document.getElementById('de-cost').value)  || 0;
  const unit  = document.getElementById('de-unit').value;
  if (!name) { showToast('Укажите название'); return; }

  if (editingDishId) {
    const d = MENU.find(m => String(m.id) === String(editingDishId));
    if (d) { d.name=name; d.cat=cat; d.price=price; d.cost=cost; d.unit=unit; }
  } else {
    MENU.push({ id:'new_'+Date.now(), name, cat, price, cost, unit });
  }
  goBack();
  renderMenuEdit(MENU, menuEditQuery, menuEditCat);
  await sendActionToGAS({ action: editingDishId ? 'edit_dish' : 'create_dish', dish_id: editingDishId, name, cat, price, cost, unit });
}

// ══════════════════════════════════════════════════════════
// P5: ЛИСТ КУХНИ — выбор заказов и генерация JPG
// ══════════════════════════════════════════════════════════
function toggleSheetOrder(row) {
  sheetSelected[row] = !sheetSelected[row];
  if (!sheetSelected[row]) delete sheetSelected[row];
  // обновляем чекбокс без полной перерисовки
  const card = document.querySelector(`.sheet-card[data-row="${row}"] .sheet-check`);
  if (card) card.classList.toggle('on', !!sheetSelected[row]);
  updateSheetGenBar();
}

function sheetSelectAll() {
  const allRows = ACTIVE_ORDERS.map(o => o.row);
  const allSelected = allRows.length > 0 && allRows.every(r => sheetSelected[r]);
  if (allSelected) {
    sheetSelected = {};
  } else {
    allRows.forEach(r => sheetSelected[r] = true);
  }
  renderSheet();
  const btn = document.getElementById('sheet-select-all');
  if (btn) btn.textContent = allSelected ? 'Все' : 'Снять';
}

function generateSheet() {
  const selectedRows = Object.keys(sheetSelected).filter(k => sheetSelected[k]).map(Number);
  const orders = selectedRows
    .map(r => findOrder(r))
    .filter(o => o)
    .sort((a, b) => {
      const da = parseDateNum(a.event_date);
      const db = parseDateNum(b.event_date);
      if (da !== db) return da - db;
      return String(a.event_time || '').localeCompare(String(b.event_time || ''));
    });
  if (!orders.length) { showToast('Выберите хотя бы один заказ'); return; }
  showSheetModal(orders);
}

// ══════════════════════════════════════════════════════════
// ДАШБОРД
// ══════════════════════════════════════════════════════════
let dashMonth = new Date().getMonth() + 1;
let dashYear  = new Date().getFullYear();
let lastDashData = null; // P4: последние данные дашборда для модалки выручки
let currentDashboardRequestId = 0; // P4+: защита от race conditions при быстром переключении месяцев

const MONTH_NAMES = ["","Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];

async function loadDashboard() {
  const now = new Date();
  const isCurrentOrFuture = (dashYear > now.getFullYear()) ||
    (dashYear === now.getFullYear() && dashMonth >= now.getMonth() + 1);

  const nextBtn = document.getElementById('db-month-next');
  if (nextBtn) nextBtn.disabled = isCurrentOrFuture;

  // Лейбл выставляем сразу — до любого запроса (исправляет "сначала Май, потом актуальный")
  const labelEl = document.getElementById('db-month-label');
  if (labelEl) labelEl.textContent = MONTH_NAMES[dashMonth] + ' ' + dashYear;

  const dbBody = document.getElementById('dashboard-body');

  // Пробуем показать кэш мгновенно
  const cacheKey = DASH_CACHE_KEY + '_' + dashYear + '_' + dashMonth;
  let hasCached = false;
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) {
      const cached = JSON.parse(raw);
      renderDashboard(cached); // внутри обновится lastDashData для модалки P4
      hasCached = true;
    }
  } catch (e) {
    console.warn("[dashboard] Ошибка чтения кэша", e);
  }

  // Если кэша нет — показываем спиннер
  if (!hasCached && dbBody) {
    dbBody.innerHTML =
      `<div class="empty-state">
        <div class="spin" style="width:28px;height:28px;border-width:2px"></div>
      </div>`;
  }

  // Увеличиваем ID текущего запроса для предотвращения race conditions
  const thisRequestId = ++currentDashboardRequestId;

  // Запрашиваем свежие данные в фоне
  const data = await fetchDashboard(dashMonth, dashYear);

  // Если за это время пользователь переключил месяц — прекращаем обработку
  if (thisRequestId !== currentDashboardRequestId) return;

  if (!data) {
    // Если сетевой запрос провалился и кэша нет — показываем ошибку
    if (!hasCached && dbBody) {
      dbBody.innerHTML =
        `<div class="empty-state">
          <div class="empty-ico">⚠️</div>
          <div class="empty-title">Нет данных</div>
          <div class="empty-sub">Проверьте подключение</div>
        </div>`;
    }
    return;
  }

  // Сохраняем свежие данные в кэш
  try {
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch (e) {
    console.warn("[dashboard] Ошибка записи в кэш", e);
  }

  // Перерисовываем экран с актуальными данными
  renderDashboard(data);
}

function dashShiftMonth(delta) {
  dashMonth += delta;
  if (dashMonth > 12) { dashMonth = 1;  dashYear++; }
  if (dashMonth < 1)  { dashMonth = 12; dashYear--; }
  const now = new Date();

  const nextBtn = document.getElementById('db-month-next');
  if (nextBtn) {
    nextBtn.disabled = dashMonth === now.getMonth() + 1 && dashYear === now.getFullYear();
  }

  const labelEl = document.getElementById('db-month-label');
  if (labelEl) {
    labelEl.textContent = MONTH_NAMES[dashMonth] + ' ' + dashYear;
  }

  loadDashboard();
}

function renderDashboard(d) {
  lastDashData = d; // P4: сохраняем для модалки выручки
  document.getElementById('db-month-label').textContent = MONTH_NAMES[d.month] + ' ' + d.year;
  const fmt = v => (+v || 0).toFixed(2).replace('.', ',');

  let html = `<div class="db-cards">
    <div class="db-card db-card-main db-card-clickable" onclick="openRevenueModal()">
      <div class="db-card-label">Выручка · нажмите для деталей</div>
      <div class="db-card-value">${fmt(d.revenue_total)} <span class="db-byn">BYN</span></div>
      <div class="db-card-sub">${d.orders_count} заказ(ов)${d.revenue_extra > 0 ? ' + ' + fmt(d.revenue_extra) + ' вне бота' : ''}</div>
    </div>
    <div class="db-card db-card-tax">
      <div class="db-card-label">Налог 10%</div>
      <div class="db-card-value">${fmt(d.tax)} <span class="db-byn">BYN</span></div>
      <div class="db-card-sub">от выручки ${fmt(d.revenue_total)}</div>
    </div>
    <div class="db-card db-card-exp">
      <div class="db-card-label">Расходы</div>
      <div class="db-card-value">${fmt(d.expenses_total)} <span class="db-byn">BYN</span></div>
      <div class="db-card-sub">закупки ${fmt(d.expenses_shopping)}${d.expenses_other > 0 ? ' + прочее ' + fmt(d.expenses_other) : ''}</div>
    </div>
    <div class="db-card ${d.net_profit >= 0 ? 'db-card-profit' : 'db-card-loss'}">
      <div class="db-card-label">Чистая прибыль</div>
      <div class="db-card-value">${fmt(d.net_profit)} <span class="db-byn">BYN</span></div>
      <div class="db-card-sub">выручка − налог − расходы</div>
    </div>
  </div>`;

  html += `<div class="sec" style="margin-top:4px">
    <div class="sec-hdr">💰 Доход вне бота</div>
    <div class="sec-body">
      <div class="f-group" style="padding-top:8px">
        <div class="f-label">Сумма (BYN)</div>
        <input class="f-input" type="number" id="db-income-amount" placeholder="0.00" min="0" step="0.01" style="margin-top:6px"/>
      </div>
      <div class="f-group">
        <div class="f-label">Примечание</div>
        <input class="f-input" type="text" id="db-income-note" placeholder="Наличные, перевод…" style="margin-top:6px"/>
      </div>
      <div style="padding:0 14px 12px">
        <button class="sv-btn sv-btn-grn" style="margin-top:0;height:40px;font-size:14px" onclick="submitFinance('income_extra')">Записать доход</button>
      </div>
    </div>
  </div>`;

  html += `<div class="sec">
    <div class="sec-hdr">💸 Прочий расход</div>
    <div class="sec-body">
      <div class="f-group" style="padding-top:8px">
        <div class="f-label">Сумма (BYN)</div>
        <input class="f-input" type="number" id="db-expense-amount" placeholder="0.00" min="0" step="0.01" style="margin-top:6px"/>
      </div>
      <div class="f-group">
        <div class="f-label">Примечание</div>
        <input class="f-input" type="text" id="db-expense-note" placeholder="Упаковка, транспорт…" style="margin-top:6px"/>
      </div>
      <div style="padding:0 14px 12px">
        <button class="sv-btn" style="margin-top:0;height:40px;font-size:14px;background:var(--red)" onclick="submitFinance('expense_other')">Записать расход</button>
      </div>
    </div>
  </div>`;

  if (d.recent_expenses && d.recent_expenses.length) {
    html += `<div class="sec"><div class="sec-hdr">Последние записи</div><div class="sec-body" style="padding:0">`;
    d.recent_expenses.forEach(r => {
      const isIncome = r.type === "Доход вне бота";
      html += `<div class="row-item">
        <div class="ri-ico">${isIncome ? '💰' : '💸'}</div>
        <div class="ri-body">
          <div class="ri-label">${esc(r.type)}</div>
          <div class="ri-sub">${esc(r.date)}${r.note ? ' · ' + esc(r.note) : ''}</div>
        </div>
        <div class="ri-right" style="color:${isIncome ? 'var(--grn)' : 'var(--red)'}">
          ${isIncome ? '+' : '−'}${(+r.sum || 0).toFixed(2)}
        </div>
      </div>`;
    });
    html += `</div></div>`;
  }

  html += `<div style="height:16px"></div>`;
  document.getElementById('dashboard-body').innerHTML = html;
}

// ══════════════════════════════════════════════════════════
// P4: МОДАЛКА ВЫРУЧКИ — список заказов месяца
// ══════════════════════════════════════════════════════════
function openRevenueModal() {
  const d = lastDashData;
  if (!d) { showToast('Данные ещё загружаются'); return; }

  const title = 'Выручка · ' + MONTH_NAMES[d.month] + ' ' + d.year;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = renderRevenueModal(d);
  document.getElementById('modal').classList.add('on');
}

function submitFinance(finType) {
  const isIncome = finType === 'income_extra';
  const amountEl = document.getElementById(isIncome ? 'db-income-amount'  : 'db-expense-amount');
  const noteEl   = document.getElementById(isIncome ? 'db-income-note'    : 'db-expense-note');
  const amount   = parseFloat(amountEl?.value || '') || 0;
  if (!amount || amount <= 0) { showToast('Укажите сумму'); amountEl?.focus(); return; }
  const note = noteEl?.value?.trim() || '';
  showConfirm(
    isIncome ? 'Записать доход' : 'Записать расход',
    `${isIncome ? 'Доход' : 'Расход'}: ${amount.toFixed(2)} BYN${note ? '\n' + note : ''}`,
    'Записать',
    async () => {
      const result = await sendActionToGAS({ action: 'add_finance', fin_type: finType, amount, note });
      if (result) {
        amountEl.value = '';
        if (noteEl) noteEl.value = '';
        showToast(isIncome ? '💰 Доход записан' : '💸 Расход записан');
        loadDashboard();
      }
    }
  );
}

// ══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ
// ══════════════════════════════════════════════════════════
function dateToISO(d) {
  if (!d || !d.includes('.')) return d;
  const [dd, mm, yy] = d.split('.');
  return `${yy}-${mm}-${dd}`;
}

// ══════════════════════════════════════════════════════════
// URL ПАРАМЕТРЫ
// ══════════════════════════════════════════════════════════
function handleURLParams() {
  const params   = new URLSearchParams(window.location.search);
  const editRow  = params.get('edit');
  const tabParam = params.get('tab');

  if (tabParam === 'dashboard') { switchTab('dashboard', document.querySelectorAll('.tab-bar .tb')[3]); return; }
  if (tabParam === 'shopping')  { switchTab('shopping',  document.querySelectorAll('.tab-bar .tb')[2]); return; }

  if (editRow) {
    setTimeout(() => {
      const order = findOrder(parseInt(editRow));
      if (order) {
        currentOrderRow = parseInt(editRow);
        openEditOrder();
      }
    }, 300);
  }
}

// ══════════════════════════════════════════════════════════
// ИНИЦИАЛИЗАЦИЯ
// ══════════════════════════════════════════════════════════
async function init() {
  try {
    if (window.history.state === null) {
      window.history.replaceState({ rootBackIntercept: true }, '');
      window.history.pushState({ tab: currentTab, stackLength: 0 }, '');
    }

    const cachedTime  = loadLocalCache();
    const hasLocalData = MENU.length > 0 || ACTIVE_ORDERS.length > 0;

    if (hasLocalData) {
      document.getElementById('loader').style.display = 'none';
      document.getElementById('app').style.display    = 'flex';
      restoreLastScreen();
      updateAllBadges();
      renderCurrentTab();
      handleURLParams();

      const label = cachedTime ? 'Кеш: ' + cachedTime + ' · обновляем…' : 'Обновляем…';
      document.getElementById('cache-time').textContent  = label;
      document.getElementById('cache-time2').textContent = label;
    }

    const success = await loadCache(false);

    if (!hasLocalData && !success) {
      document.getElementById('loader').innerHTML = `
        <div style="text-align:center;padding:20px;">
          <div style="font-size:40px;margin-bottom:12px;">⚠️</div>
          <div class="load-text" style="font-size:14px;color:var(--hint)">Не удалось загрузить данные.<br>Проверьте подключение к интернету.</div>
          <button onclick="location.reload()" class="hdr-btn acc" style="margin-top:16px;height:38px;padding:0 24px;">Повторить</button>
        </div>`;
      return;
    }

    if (!hasLocalData && success) {
      document.getElementById('loader').style.display = 'none';
      document.getElementById('app').style.display    = 'flex';
      restoreLastScreen();
    }

    updateAllBadges();
    renderCurrentTab();
    handleURLParams();
    updateBackButtonVisibility();

  } catch (globalErr) {
    console.error("[init critical fallback]", globalErr);
    // Резервный безотказный запуск приложения при непредвиденном JS-сбое
    document.getElementById('loader').style.display = 'none';
    document.getElementById('app').style.display    = 'flex';
    switchTab('orders', document.querySelectorAll('.tab-bar .tb')[0]);
  } finally {
    setInterval(saveDraft, 10000);
  }
}

init();
