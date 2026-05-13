'use strict';
// ══════════════════════════════════════════════════════════
// app.js — логика навигации, заказов, корзины, черновиков
// ══════════════════════════════════════════════════════════

const WEBAPP_URL = "https://vearjkeee.github.io/Slaunaya_eza/index.html";

const ST = {
  NEW:  "🆕 Новый",  CONF: "✅ Подтверждён",
  COOK: "🍳 Готовится", DONE: "✔️ Выполнен", CANC: "❌ Отменён",
};

// ══════════════════════════════════════════════════════════
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ══════════════════════════════════════════════════════════
let MENU    = [], CLIENTS = [];
let ACTIVE_ORDERS = [], ARCHIVE_ORDERS = [], SHOPPING = [];

let cart       = {};
let delivType  = 'Самовывоз';
let prepay     = true;
let manualId   = 1000;
let editingRow = null;

let screenStack      = [];
let currentTab       = 'orders';
let orderTab         = 'active';
let currentOrderRow  = null;
let editingDishId    = null;
let searchQuery      = '';
let menuEditQuery    = '';
let menuEditCat      = 'Все';

// ── Черновик ────────────────────────────────────────────
const DRAFT_KEY = 'order_draft_v1';

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
    discount:  document.getElementById('c-discount')?.value || '',
    note:      document.getElementById('c-note')?.value    || '',
    cart,
    editingRow,
    ts: Date.now(),
  };
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch(e) {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}

function applyDraft(d) {
  if (!d) return;
  document.getElementById('o-client').value  = d.client  || '';
  document.getElementById('o-contact').value = d.contact || '';
  document.getElementById('o-date').value    = d.date    || '';
  document.getElementById('o-time').value    = d.time    || '';
  document.getElementById('o-addr').value    = d.addr    || '';
  document.getElementById('o-dcost').value   = d.dcost   || '';
  setDeliv(d.delivType || 'Самовывоз', null, true);
  setPay(!!d.prepay, null, true);
  cart       = d.cart       || {};
  editingRow = d.editingRow || null;
}

// ══════════════════════════════════════════════════════════
// ЗАГРУЗКА ДАННЫХ
// ══════════════════════════════════════════════════════════
async function loadCache(force = false) {
  const result = await fetchData(force);
  if (!result) { showToast("⚠️ Нет соединения"); return; }

  MENU           = result.data.menu           || [];
  CLIENTS        = result.data.clients        || [];
  ACTIVE_ORDERS  = result.data.active_orders  || [];
  ARCHIVE_ORDERS = result.data.archive_orders || [];
  SHOPPING       = result.data.shopping_list  || [];

  const upd   = result.data.updated || '';
  const label = (upd ? 'Обновлено: ' + upd : '') + sourceLabel(result.source);
  document.getElementById('cache-time').textContent  = label;
  document.getElementById('cache-time2').textContent = label;
}

async function forceReload() {
  showToast('⟳ Обновляю…');
  renderSkeletons('orders-list', 4);
  await loadCache(true);
  renderCurrentTab();
  showToast('✓ Данные обновлены');
}

// ══════════════════════════════════════════════════════════
// НАВИГАЦИЯ
// ══════════════════════════════════════════════════════════
function tabRoots() {
  return { orders:'s-orders', new:'s-new-details', shopping:'s-shopping', dashboard: 's-dashboard', menu:'s-menu' };
}

function switchTab(tab, btn) {
  screenStack = [];
  currentTab  = tab;
  document.querySelectorAll('.tb').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.querySelectorAll('.scr').forEach(s => {
    s.classList.remove('on','back'); s.style.transform = 'translateX(100%)';
  });
  const el = document.getElementById(tabRoots()[tab]);
  el.style.transform = '';
  el.classList.add('on');

  if (tab === 'new') {
    const draft = loadDraft();
    if (draft && (draft.client || Object.keys(draft.cart || {}).length > 0)) {
      showConfirm(
        'Незавершённый заказ',
        `Продолжить оформление заказа${draft.client ? ' для ' + draft.client : ''}?`,
        'Продолжить',
        () => { applyDraft(draft); renderCurrentTab(); },
        () => { clearDraft(); initNewOrder(); }
      );
      return;
    }
    initNewOrder();
  }
  renderCurrentTab();
}

function pushScreen(id) {
  const cur = document.querySelector('.scr.on');
  if (cur) { cur.classList.remove('on'); cur.classList.add('back'); }
  screenStack.push(cur ? cur.id : tabRoots()[currentTab]);
  const next = document.getElementById(id);
  next.style.transform = 'translateX(100%)';
  next.classList.remove('back');
  next.getBoundingClientRect();
  next.style.transform = '';
  next.classList.add('on');
}

function goBack() {
  if (!screenStack.length) return;
  const prev  = screenStack.pop();
  const cur   = document.querySelector('.scr.on');
  if (cur) { cur.classList.remove('on'); cur.style.transform = 'translateX(100%)'; }
  const prevEl = document.getElementById(prev);
  prevEl.classList.remove('back');
  prevEl.classList.add('on');
}

function renderCurrentTab() {
  if (currentTab === 'orders')   renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
  if (currentTab === 'shopping') renderShopping(SHOPPING);
  if (currentTab === 'menu')     { renderMenuChips(); renderMenuEdit(MENU, menuEditQuery, menuEditCat); }
  if (currentTab === 'dashboard') { /* заглушка, ничего не рендерим */ }
}

// ══════════════════════════════════════════════════════════
// ЗАКАЗЫ
// ══════════════════════════════════════════════════════════
function setOrderTab(tab, btn) {
  orderTab = tab;
  document.querySelectorAll('#s-orders .f-tgl-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  // Если есть активный поиск — не сбрасываем его при переключении вкладки
  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
}

function onOrderSearch() {
  searchQuery = (document.getElementById('order-srch')?.value || '').trim();
  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
}

function openOrderDetail(row) {
  currentOrderRow = row;
  const order     = findOrder(row);
  if (!order) { showToast('Заказ не найден'); return; }

  const isActive = ACTIVE_ORDERS.some(o => o.row == row);
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
  const order    = findOrder(row);
  const statuses = [ST.NEW, ST.CONF, ST.COOK, ST.DONE, ST.CANC];
  let html = '<div class="status-grid">';
  statuses.forEach(s => {
    const sc  = ({[ST.NEW]:"st-new",[ST.CONF]:"st-conf",[ST.COOK]:"st-cook",[ST.DONE]:"st-done",[ST.CANC]:"st-canc"})[s] || '';
    const on  = order?.status === s ? ' on' : '';
    html += `<button class="st-btn ${sc}${on}" onclick="changeStatus(${row},'${s}')">${s}</button>`;
  });
  html += '</div>';
  document.getElementById('modal-title').textContent = 'Изменить статус';
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal').classList.add('on');
}

function closeModal() { document.getElementById('modal').classList.remove('on'); }

function changeStatus(row, status) {
  closeModal();
  const isDone = [ST.DONE, ST.CANC].includes(status);
  const msg    = isDone
    ? `Перевести в «${status}»? Заказ уйдёт в архив.`
    : `Изменить статус на «${status}»?`;

  showConfirm('Изменить статус', msg, 'Подтвердить', () => {
    sendToBot({ action: 'change_status', order_row: row, status });
    // Оптимистичное обновление локально
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
    showToast('Статус обновлён');
    if (twa) setTimeout(() => twa.close(), 600);
  });
}

// ══════════════════════════════════════════════════════════
// ПРЕДЧЕК / КАРТЫ / ДУБЛИРОВАНИЕ
// ══════════════════════════════════════════════════════════
function genReceipt(row) {
  sendToBot({ action: 'get_receipt', order_row: row });
  showToast('📄 Запрос отправлен боту');
  if (twa) setTimeout(() => twa.close(), 600);
}

function openMapChoice(encodedAddr) {
  const address = decodeURIComponent(encodedAddr || '');
  if (!address || address === 'Самовывоз') { showToast('Адрес не указан'); return; }
  const q = encodeURIComponent(address);
  const apps = [
    { name: 'Google Карты',     url: `https://maps.google.com/?q=${q}` },
    { name: 'Яндекс Карты',     url: `https://maps.yandex.ru/?text=${q}` },
    { name: 'Яндекс Навигатор', url: `https://yandex.ru/maps/?rtext=~${q}&rtt=auto` },
  ];
  const body = document.getElementById('modal-body');
  body.innerHTML = '<div style="padding:0 0 8px;display:flex;flex-direction:column;gap:8px">' +
    apps.map(a =>
      `<button onclick="window.open('${a.url}','_blank');closeModal()"
        style="height:46px;border:1px solid var(--border);border-radius:var(--rad-s);
               background:var(--bg);font-size:15px;font-family:inherit;color:var(--text);
               cursor:pointer;text-align:left;padding:0 16px">${a.name}</button>`
    ).join('') + '</div>';
  document.getElementById('modal-title').textContent = 'Маршрут'; // <--- ДОБАВИТЬ
  document.getElementById('modal').classList.add('on');
}

function duplicateOrder(row) {
  const order = findOrder(row);
  if (!order) return;

  // 1. Сначала переключаем вкладку (это вызовет очистку или вопрос про старый драфт,
  // но мы это проигнорируем, так как дальше принудительно перезапишем форму)
  const newBtn = document.querySelector('.tb:nth-child(2)');
  switchTab('new', newBtn);

  // 2. Теперь заполняем данные
  editingRow = null;
  cart = {};
  (order.dishes ||[]).forEach((d, i) => {
    const menuDish = MENU.find(m => m.name === d.name);
    const id = menuDish ? String(menuDish.id) : ('dup' + i);
    cart[id] = {
      d: { id, name: d.name, cat: menuDish?.cat || '' },
      q: +d.qty || 1,
      p: +d.price || 0,
      manual: !menuDish,
    };
  });

  document.getElementById('o-client').value  = order.client || '';
  document.getElementById('o-contact').value = order.contact || '';
  document.getElementById('o-date').value    = ''; 
  document.getElementById('o-time').value    = order.event_time || '';
  setDeliv(order.delivery_type || 'Самовывоз', null, true);
  document.getElementById('o-addr').value   = order.address  || '';
  document.getElementById('o-dcost').value  = order.delivery || '';
  setPay(!!order.prepayment, null, true);

  // 3. Сохраняем это как новый черновик
  saveDraft();
  showToast('📋 Заказ скопирован — укажите дату');
}

// ══════════════════════════════════════════════════════════
// РЕДАКТИРОВАНИЕ ЗАКАЗА
// ══════════════════════════════════════════════════════════
function openEditOrder() {
  const order = findOrder(currentOrderRow);
  if (!order) return;
  editingRow = order.row;

  document.getElementById('o-client').value  = order.client || '';
  document.getElementById('o-contact').value = order.contact || '';
  document.getElementById('o-date').value    = dateToISO(order.event_date || '');
  document.getElementById('o-time').value    = order.event_time || '';
  setDeliv(order.delivery_type || 'Самовывоз', null, true);
  document.getElementById('o-addr').value   = order.address  || '';
  document.getElementById('o-dcost').value  = order.delivery || '';
  setPay(!!order.prepayment, null, true);

  cart = {};
  const dishes = order.dishes || [];
  if (dishes.length) {
    dishes.forEach((d, i) => {
      const menuDish = MENU.find(m => m.name === d.name);
      const id = menuDish ? String(menuDish.id) : ('e' + i);
      cart[id] = {
        d: { id, name: d.name, cat: menuDish?.cat || '' },
        q: +d.qty || 1,
        p: +d.price || 0,
        manual: !menuDish,
      };
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
  cart = {};
  ['o-client','o-contact','o-date','o-time','o-addr','o-dcost'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const aiTxt = document.getElementById('ai-txt');
  if (aiTxt) aiTxt.value = '';
  setDeliv('Самовывоз', null, true);
  setPay(true, null, true);
}

function setDeliv(v, btn, silent) {
  delivType = v;
  document.querySelectorAll('#tg-deliv .f-tgl-btn').forEach((b, i) =>
    b.classList.toggle('on', i === (v === 'Доставка' ? 1 : 0))
  );
  document.getElementById('deliv-extra').style.display = v === 'Доставка' ? 'block' : 'none';
  if (!silent) updCart();
}

function setPay(v, btn, silent) {
  prepay = v;
  document.querySelectorAll('#tg-pay .f-tgl-btn').forEach((b, i) =>
    b.classList.toggle('on', v ? i === 0 : i === 1)
  );
}

// ── Автодополнение клиента ───────────────────────────────
function onClientInput() {
  saveDraft();
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
}

function pickClient(i) {
  const c = document.getElementById('c-drop')._hits[i];
  document.getElementById('o-client').value  = c.name;
  document.getElementById('o-contact').value = c.contact || '';
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

// ── AI импорт ────────────────────────────────────────────
function runAI() {
  const txt = document.getElementById('ai-txt').value.trim();
  if (!txt) { showToast('Вставьте сообщение клиента'); return; }
  const request_id = 'ai_' + Date.now();
  sessionStorage.setItem('pending_ai_id', request_id);
  sendToBot({ action: 'ai_request', text: txt, request_id });
  showToast('🤖 Отправлено боту');
  if (twa) setTimeout(() => twa.close(), 600);
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
    ch.className = 'chip' + (i === 0 ? ' on' : '');
    ch.textContent = c;
    ch.onclick = () => {
      el.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
      ch.classList.add('on');
      filterFn();
    };
    el.appendChild(ch);
  });
}

function filterMenu() {
  const q   = (document.getElementById('srch')?.value || '').toLowerCase();
  const cat = document.querySelector('#chips .chip.on')?.textContent || 'Все';
  const list = MENU.filter(d =>
    (cat === 'Все' || d.cat === cat) && (!q || d.name.toLowerCase().includes(q))
  );
  const el = document.getElementById('menu-list');
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
}

function addToCart(id) {
  const d = MENU.find(m => String(m.id) === id);
  if (!d) return;
  if (!cart[id]) cart[id] = { d:{id,name:d.name,cat:d.cat||''}, q:0, p:+d.price||0 };
  cart[id].q++;
  saveDraft(); updCart(); filterMenu();
}

function chQ(id, delta) {
  if (!cart[id]) return;
  cart[id].q += delta;
  if (cart[id].q <= 0) delete cart[id];
  saveDraft(); updCart(); filterMenu();
}

// ── Ручное добавление ────────────────────────────────────
function addManual() {
  const name  = document.getElementById('m-name').value.trim();
  const price = parseFloat(document.getElementById('m-price').value) || 0;
  const qty   = parseInt(document.getElementById('m-qty').value)   || 1;
  if (!name)    { showToast('Укажите название'); return; }
  if (price <= 0) { showToast('Укажите цену'); return; }
  const id = 'm' + (manualId++);
  cart[id] = { d:{id,name,cat:'Вручную'}, q:qty, p:price, manual:true };
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
  const keys  = Object.keys(cart);
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

  const discount = parseFloat(document.getElementById('c-discount')?.value || 0) || 0;

  items.innerHTML = `<div class="discount-wrap">
    <span class="dw-l">Скидка</span>
    <input class="dw-inp" type="number" id="c-discount" value="${discount||''}"
      placeholder="0" min="0" max="100" step="1" oninput="updCart();saveDraft()"/>
    <span class="dw-pct">%</span>
  </div>` +
  keys.map(k => {
    const it = cart[k];
    return `<div class="ci" id="ci-${k}">
      <div class="ci-top">
        <div class="ci-name">${esc(it.d.name)}${it.manual?'<br><span style="font-size:11px;color:var(--hint)">вручную</span>':''}</div>
        <button class="ci-del" onclick="removeFromCart('${k}')">✕</button>
      </div>
      <div class="ci-bot">
        <div class="ci-pe">
          <div class="qc">
            <button class="qb" onclick="chCartQ('${k}',-1)">−</button>
            <div class="qv">${it.q}</div>
            <button class="qb" onclick="chCartQ('${k}',1)">+</button>
          </div>
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
}

function removeFromCart(id) {
  delete cart[id];
  saveDraft(); renderCartFull();
}

function chCartQ(id, d) {
  if (!cart[id]) return;
  cart[id].q += d;
  if (cart[id].q <= 0) { delete cart[id]; saveDraft(); renderCartFull(); return; }
  document.querySelector(`#ci-${CSS.escape(id)} .qv`).textContent = cart[id].q;
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  saveDraft(); updCart();
}

function chCartPrice(id, v) {
  if (!cart[id]) return;
  cart[id].p = parseFloat(v) || 0;
  const t = document.getElementById('cit-' + id);
  if (t) t.textContent = '= ' + (cart[id].q * cart[id].p).toFixed(2) + ' BYN';
  saveDraft(); updCart();
}

function updCart() {
  const keys  = Object.keys(cart);
  const qty   = keys.reduce((s, k) => s + cart[k].q, 0);
  const sub   = keys.reduce((s, k) => s + cart[k].q * cart[k].p, 0);
  const disc  = parseFloat(document.getElementById('c-discount')?.value || 0) || 0;
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
function saveOrder() {
  const client = document.getElementById('o-client').value.trim();
  const date   = document.getElementById('o-date').value;
  const keys   = Object.keys(cart);
  if (!client)      { showToast('Укажите клиента'); return; }
  if (!date)        { showToast('Укажите дату'); return; }
  if (!keys.length) { showToast('Корзина пуста'); return; }

  const dcost = delivType === 'Доставка' ? (parseFloat(document.getElementById('o-dcost').value) || 0) : 0;
  const disc  = parseFloat(document.getElementById('c-discount')?.value || 0) || 0;

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
    discount_percent: disc,
    note:             document.getElementById('c-note')?.value || '',
    dishes:           keys.map(k => ({
      name:  cart[k].d.name,
      qty:   cart[k].q,
      price: cart[k].p,
      cost:  0,
      unit:  'порц.',
    })),
  };

  sendToBot(payload);
  clearDraft();
  showToast(editingRow ? '✓ Заказ обновлён' : '✓ Заказ создан');
  if (twa) setTimeout(() => twa.close(), 800);
}

// ══════════════════════════════════════════════════════════
// ЗАКУПКИ
// ══════════════════════════════════════════════════════════

// ── Web Speech API ────────────────────────────────────────
let speechRecognition = null;
let isListening = false;

function toggleSpeech() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('⚠️ Браузер не поддерживает голосовой ввод');
    return;
  }

  if (isListening) {
    speechRecognition?.stop();
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = 'ru-RU';
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;

  const ta  = document.getElementById('sh-text');
  const btn = document.getElementById('sh-mic');
  const baseText = ta.value;

  speechRecognition.onstart = () => {
    isListening = true;
    btn.classList.add('on');
    ta.classList.add('listening');
    showToast('🎤 Говорите…');
  };

  speechRecognition.onresult = (e) => {
    let interim = '';
    let final   = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final   += e.results[i][0].transcript;
      else                       interim += e.results[i][0].transcript;
    }
    ta.value = (baseText + (baseText ? ' ' : '') + final + interim).trim();
  };

  speechRecognition.onend = () => {
    isListening = false;
    btn.classList.remove('on');
    ta.classList.remove('listening');
  };

  speechRecognition.onerror = (e) => {
    isListening = false;
    btn.classList.remove('on');
    ta.classList.remove('listening');
    if (e.error !== 'aborted') showToast('⚠️ Ошибка распознавания: ' + e.error);
  };

  speechRecognition.start();
}

// ── Отправка текста в бот ─────────────────────────────────
function submitShopping() {
  // Останавливаем запись если идёт
  if (isListening) speechRecognition?.stop();

  const text = (document.getElementById('sh-text')?.value || '').trim();
  if (!text) { showToast('Введите или надиктуйте список'); return; }

  // Проверяем есть ли уже позиции в списке
  const hasShopping = SHOPPING && SHOPPING.length > 0;

  if (hasShopping) {
    // Показываем диалог merge/replace
    showConfirm(
      'Список не пустой',
      `В списке уже ${SHOPPING.length} позиций. Что сделать с новым списком?`,
      'Добавить к списку',
      () => _sendShoppingToBot(text, true),
      null,
      'Создать новый',
      () => _sendShoppingToBot(text, false),
    );
  } else {
    _sendShoppingToBot(text, false);
  }
}

function _sendShoppingToBot(text, merge) {
  sendToBot({ action: 'ai_shopping', text, merge });
  document.getElementById('sh-text').value = '';
  showToast('🤖 Отправлено боту…');
  if (twa) setTimeout(() => twa.close(), 600);
}

// ── Очистка ───────────────────────────────────────────────
function clearBoughtShopping() {
  const bought = (SHOPPING || []).filter(it => it.bought);
  if (!bought.length) { showToast('Нет отмеченных позиций'); return; }
  showConfirm(
    'Очистить купленные',
    `Удалить ${bought.length} отмеченных позиций?`,
    'Удалить',
    () => {
      sendToBot({ action: 'shopping_clear_bought' });
      SHOPPING = SHOPPING.filter(it => !it.bought);
      renderShopping(SHOPPING);
      showToast('✅ Купленные удалены');
      if (twa) setTimeout(() => twa.close(), 600);
    }
  );
}

function clearAllShopping() {
  if (!SHOPPING?.length) { showToast('Список уже пустой'); return; }
  showConfirm(
    'Очистить всё',
    `Удалить все ${SHOPPING.length} позиций из списка закупок?`,
    'Удалить всё',
    () => {
      sendToBot({ action: 'shopping_clear_all' });
      SHOPPING = [];
      renderShopping(SHOPPING);
      showToast('🗑 Список очищен');
      if (twa) setTimeout(() => twa.close(), 600);
    },
    null, null, null,
    true // danger
  );
}

// ── Отметка купленного ────────────────────────────────────
function toggleBought(itemId) {
  const it = (SHOPPING || []).find(x => x.id === itemId);
  if (!it) return;
  it.bought = !it.bought;
  sendToBot({ action: 'shopping_mark', item_id: it.id, bought: it.bought });
  renderShopping(SHOPPING);
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
  document.getElementById('de-unit').value  = d?.unit  || 'порц.';

  const dl = document.getElementById('cat-list');
  dl.innerHTML = [...new Set(MENU.map(m => m.cat).filter(Boolean))]
    .map(c => `<option value="${esc(c)}">`).join('');

  pushScreen('s-dish-edit');
}

function openNewDishForm() { openDishEdit(null); }

function saveDishEdit() {
  const name  = document.getElementById('de-name').value.trim();
  const cat   = document.getElementById('de-cat').value.trim();
  const price = parseFloat(document.getElementById('de-price').value) || 0;
  const cost  = parseFloat(document.getElementById('de-cost').value)  || 0;
  const unit  = document.getElementById('de-unit').value;
  if (!name) { showToast('Укажите название'); return; }

  sendToBot({ action: editingDishId ? 'edit_dish' : 'create_dish', dish_id: editingDishId, name, cat, price, cost, unit });

  if (editingDishId) {
    const d = MENU.find(m => String(m.id) === String(editingDishId));
    if (d) { d.name=name; d.cat=cat; d.price=price; d.cost=cost; d.unit=unit; }
  } else {
    MENU.push({ id:'new_'+Date.now(), name, cat, price, cost, unit });
  }

  showToast(editingDishId ? '✓ Блюдо обновлено' : '✓ Блюдо добавлено');
  goBack();
  renderMenuEdit(MENU, menuEditQuery, menuEditCat);
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
  const aiResult = params.get('ai_result');

  if (tabParam === 'shopping') {
    switchTab('shopping', document.querySelector('.tb:nth-child(3)'));
    return;
  }
  if (editRow) {
    setTimeout(() => {
      const row = parseInt(editRow);
      currentOrderRow = row;
      if (findOrder(row)) { openOrderDetail(row); setTimeout(openEditOrder, 100); }
    }, 300);
    return;
  }
  if (aiResult) {
    switchTab('new', document.querySelector('.tb:nth-child(2)'));
    showToast('🤖 AI обработал запрос — добавьте блюда вручную');
  }
}

// ══════════════════════════════════════════════════════════
// ЗАПУСК
// ══════════════════════════════════════════════════════════
async function init() {
  renderSkeletons('orders-list', 4);
  await loadCache();

  document.getElementById('loader').style.display = 'none';
  document.getElementById('app').style.display    = 'flex';

  renderOrders(ACTIVE_ORDERS, ARCHIVE_ORDERS, orderTab, searchQuery);
  handleURLParams();

  // Автосохранение черновика каждые 10 сек
  setInterval(saveDraft, 10000);
}

init();
