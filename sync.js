/* ===== UpBek: облако (Supabase) и автоматика из «Команд» iPhone ===== */
'use strict';

const CLOUD = window.UPBEK_CONFIG || {};
// тестовый запуск на компьютере (localhost): без облака, рейтинга и пары, чтобы тестовые профили не попадали в базу.
// Включить сервер в тесте явно: добавить ?cloud=1 к адресу.
const DEV_MODE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && !/[?&]cloud=1\b/.test(location.search);
if (DEV_MODE) CLOUD.url = '';
const cloudReady = () => !!(CLOUD.url && CLOUD.key);
const shortcutUrl = () => `${CLOUD.url}/rest/v1/rpc/push_event?apikey=${CLOUD.key}`;

function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }
function newToken() {
  const a = new Uint8Array(24); crypto.getRandomValues(a);
  return toB64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function rpc(fn, args) {
  const r = await fetch(`${CLOUD.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: CLOUD.key },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t || 'HTTP ' + r.status);
  return t ? JSON.parse(t) : null;
}

/* ---- шифрование копии: ключ выводится из кода, сервер видит только шифр ---- */
async function encKey(token) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('upbek-enc:' + token));
  return crypto.subtle.importKey('raw', h, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function encryptState(token, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await encKey(token), new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function decryptState(token, p) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(p.iv) }, await encKey(token), fromB64(p.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---- копия в облако ---- */
let pushTimer = null, pushing = false;
function cloudSchedule() {
  if (!cloudReady() || !S.profile || !S.cloud || !S.cloud.token) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(cloudPush, 2500);
}
async function cloudPush() {
  if (pushing) { cloudSchedule(); return; }
  pushing = true;
  try {
    const { cloud, ...data } = S;
    await rpc('save_state', { p_token: S.cloud.token, p_data: await encryptState(S.cloud.token, data) });
    S.cloud.lastPush = Date.now(); S.cloud.err = null;
    if (typeof boardPush === 'function') boardPush(false).catch(() => {}); // рейтинг — не чаще раза в 10 минут
    if (typeof pairSync === 'function') pairSync(false).catch(() => {});
  } catch (e) {
    S.cloud.err = String(e.message || e).slice(0, 140);
  } finally {
    pushing = false; save(true);
    if (UI.tab === 'me' && !UI.sheetFn) render();
  }
}
async function cloudRestore(token) {
  const r = await rpc('load_state', { p_token: token });
  if (!r || !r.data) throw new Error('По этому коду ничего не найдено');
  const data = await decryptState(token, r.data);
  if (!validState(data)) throw new Error('Копия повреждена или подменена');
  S = Object.assign(fresh(), data, { cloud: { token, lastPush: Date.now() } });
  save(true); UI.tab = 'hero'; render();
}

/* ---- события из «Команд»: сон и SMS банков ---- */
const BANK_RE = [[/m-?bank|мбанк|м-банк/i, 'mbank'], [/demir|демир/i, 'demir'], [/bakai|бакай/i, 'bakai'], [/o!|о!|obank|обанк|o-bank/i, 'obank'], [/sim ?bank|симбанк/i, 'sim']];
function parseBankSms(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/ /g, ' ');
  const num = (x) => parseFloat(String(x).replace(/\s/g, '').replace(',', '.'));
  let balance = null, rest = s;
  const bm = s.match(/(остаток|доступно|баланс|бал\.|ост\.|balance|avail\w*)[^\d-]{0,15}(-?\d[\d\s]*(?:[.,]\d{1,2})?)/i);
  if (bm) { balance = num(bm[2]); rest = s.replace(bm[0], ' '); }
  const am = rest.match(/(\d[\d\s]*(?:[.,]\d{1,2})?)\s*(kgs|kgz|сом|som|с|c)(?![a-zа-я])/i)
    || rest.match(/(?:сумма|сумму|summa|amount)[^\d]{0,6}(\d[\d\s]*(?:[.,]\d{1,2})?)/i);
  if (!am) return null;
  const amount = Math.round(num(am[1]) * 100) / 100;
  if (!amount || amount <= 0) return null;
  const low = s.toLowerCase();
  const isInc = /(зачисл|пополн|поступ|получен|входящ|возврат|кэшбэк|cashback|credit)/.test(low) && !/(списан|оплат|покупк|debit)/.test(low);
  let acc = null;
  for (const [re, bank] of BANK_RE) if (re.test(s)) { const a = S.accounts.find((x) => x.bank === bank); if (a) { acc = a.id; break; } }
  const mm = s.match(/(?:\sв\s|\sat\s|merchant|магазин|тт)[:\s]*([^,.;\n]{3,40})/i);
  return { type: isInc ? 'inc' : 'exp', amount, balance, acc: acc || S.main || (S.accounts[0] && S.accounts[0].id), merchant: mm ? mm[1].trim() : '' };
}
function applyEvent(r, msgs) {
  const t = Date.parse(r.created_at) || Date.now();
  const h = new Date(t).getHours();
  if (r.kind === 'bed') {
    if (h >= 19 || h < 5) S.bedMarks = [...(S.bedMarks || []), t].slice(-20);
  } else if (r.kind === 'wake') {
    if (h < 4 || h >= 14) return;
    const key = dayKey(t);
    if (sleepOf(key)) return; // первый подъём за утро уже записан
    const marks = (S.bedMarks || []).filter((b) => t - b >= 2 * 36e5 && t - b <= 16 * 36e5);
    const usual = median(S.sleep.slice(-14).map(sleepH)) || 8;
    const bed = marks.length ? Math.min(...marks) : t - usual * 36e5;
    S.sleep.push({ id: uid(), bed, wake: t, auto: true, est: !marks.length });
    S.bedMarks = (S.bedMarks || []).filter((b) => b > t);
    msgs.push(`😴 Сон ${fmtH((t - bed) / 36e5)} записан сам`);
  } else if (r.kind === 'sms') {
    const p = parseBankSms(r.body);
    if (!p || !p.acc) return;
    const dup = S.tx.some((x) => x.sms && x.amount === p.amount && x.acc === p.acc && Math.abs(x.t - t) < 120000);
    if (dup) return;
    S.tx.push({ id: uid(), t, type: p.type, amount: p.amount, acc: p.acc, cat: p.type === 'inc' ? 'unknown_in' : 'unknown', note: p.merchant || 'Из SMS банка', sms: true });
    msgs.push(`📩 ${p.type === 'inc' ? '+' : '−'}${fmt(p.amount)} из SMS`);
    if (p.balance != null && !isNaN(p.balance)) {
      const diff = Math.round(p.balance - balances()[p.acc]);
      if (Math.abs(diff) >= 1) {
        S.tx.push({ id: uid(), t: t + 1, type: diff < 0 ? 'exp' : 'inc', amount: Math.abs(diff), acc: p.acc, cat: diff < 0 ? 'lost' : 'found', note: 'Авто-сверка по SMS', rec: true });
        msgs.push(`🧮 сверено (${diff > 0 ? '+' : ''}${fmt(diff)})`);
      }
    }
  }
}
let pulling = false;
async function cloudPull() {
  if (pulling || !cloudReady() || !S.profile || !S.cloud || !S.cloud.token) return;
  pulling = true;
  try {
    const rows = await rpc('pull_events', { p_token: S.cloud.token });
    if (rows && rows.length) {
      const msgs = [];
      rows.forEach((r) => applyEvent(r, msgs));
      S.cloud.lastPull = Date.now();
      save(); render();
      progress(game());
      if (msgs.length) toast(msgs.slice(0, 3).join(' · '));
      await rpc('ack_events', { p_token: S.cloud.token, p_ids: rows.map((r) => r.id) });
    } else { S.cloud.lastPull = Date.now(); save(true); }
  } catch (e) {
    S.cloud.err = String(e.message || e).slice(0, 140); save(true);
  } finally { pulling = false; }
}

/* ---- экран «Облако и автоматика» ---- */
async function copyText(text, label) {
  try { await navigator.clipboard.writeText(text); toast(`📋 ${label} скопирован`); }
  catch (e) { prompt('Скопируй вручную:', text); }
}
function openBackupSheet() {
  openSheet(() => {
    const c = S.cloud || {};
    const st = !cloudReady() ? 'Сервер не подключён' : c.err ? `<span class="red">⚠️ Нет связи: ${esc(c.err)}</span>` : c.lastPush ? `<span class="green">✓ Сохранено ${dayLabel(dayKey(c.lastPush)).toLowerCase()} в ${hhmm(c.lastPush)}</span>` : 'Сохраняю…';
    return `${sheetHead('💾 Резервное копирование')}
    <div class="card">
      <div class="row between"><b>☁️ Облачная копия</b>${cloudReady() ? '<button class="btn ghost sm" data-a="cloudNow">Синхр.</button>' : ''}</div>
      <div class="dim" style="margin-top:4px">${st}</div>
      <div class="note">Сохраняется сама после каждого изменения. Данные шифруются на телефоне — без твоего кода их никто не прочитает.</div>
      ${cloudReady() ? `<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-a="cloudCode">🔑 Мой код</button><button class="btn ghost sm" data-a="cloudRestoreAsk">♻️ Восстановить</button></div>` : ''}
    </div>
    <div class="card">
      <b>📁 Файл-копия</b>
      <div class="dim" style="margin:4px 0 10px">Можно сохранить в «Файлы» или Telegram</div>
      <div class="row"><button class="btn ghost" data-a="export">📤 Сохранить</button><button class="btn ghost" data-a="import">📥 Загрузить</button></div>
    </div>`;
  });
}
function copyRow(label, value, kind) {
  return `<div class="copyrow"><span class="grow"><span class="dim">${label}</span><code>${esc(value)}</code></span><button class="btn ghost sm" data-a="copy" data-k="${kind}">Копировать</button></div>`;
}
function shortcutSteps(kind, trigger) {
  return `<ol>
    ${trigger}
    <li>Выбери <b>«Запускать сразу»</b> и выключи «Уведомлять при запуске» → <b>Далее</b>.</li>
    <li><b>«Новая пустая команда»</b> → добавь действие <b>«Получить содержимое URL»</b>.</li>
    <li>Вставь <b>URL</b> (кнопка ниже). Нажми <b>«⌄»</b> рядом:<br>Метод: <b>POST</b><br>Тело запроса: <b>JSON</b> → ＋ Текст: <b>p_token</b> = твой код; ＋ Текст: <b>p_kind</b> = <b>${kind}</b>${kind === 'sms' ? '; ＋ Текст: <b>p_text</b> = переменная <b>«Ввод команды»</b> (текст SMS)' : ''}</li>
  </ol>`;
}
function openAutoHelp(which) {
  const c = S.cloud || {};
  const rows = copyRow('URL', shortcutUrl(), 'url') + copyRow('Твой код (p_token)', c.token || '', 'token');
  const body = {
    sleep: `${sheetHead('😴 Автозапись сна')}
      <div class="help">
      <p>Делаем 2 автоматизации в приложении <b>«Команды»</b> → вкладка <b>«Автоматизация»</b> → <b>＋</b>. Утром сон уже будет в UpBek.</p>
      <h3 style="font-size:15px">1. «Лёг спать»</h3>
      ${shortcutSteps('bed', '<li>Триггер <b>«Зарядное устройство»</b> → <b>«Подключено»</b> (или «Режим сна» → «Включается»). Дневные подключения UpBek игнорирует — считаются только с 19:00 до 5:00.</li>')}
      <h3 style="font-size:15px">2. «Проснулся»</h3>
      ${shortcutSteps('wake', '<li>Триггер <b>«Будильник»</b> → <b>«Остановлен»</b> (или «Режим сна» → «Выключается»). Считается только первое срабатывание с 4:00 до 14:00.</li>')}
      </div>${rows}
      <div class="note">Если автоматизация «лёг» не сработала, UpBek возьмёт твоё обычное время сна, и его можно поправить.</div>`,
    sms: `${sheetHead('📩 Траты из SMS банка')}
      <div class="help">
      <p>Работает, если банк присылает <b>SMS</b> (push-уведомления приложений iPhone никому не отдаёт). Каждая SMS → трата в «❓ Потом», а если в SMS есть остаток — UpBek сам сверит баланс.</p>
      ${shortcutSteps('sms', '<li>Триггер <b>«Сообщение»</b> → «Отправитель» — выбери номер/имя банка (или «Сообщение содержит»: <b>KGS</b>).</li>')}
      <p>Повтори для каждого банка, который шлёт SMS.</p>
      </div>${rows}`,
    rem: `${sheetHead('⏰ Напоминания о сверке')}
      <div class="help"><ol>
        <li><b>«Команды»</b> → <b>«Автоматизация»</b> → <b>＋</b> → <b>«Время суток»</b> → 21:00 → Ежедневно → <b>«Запускать сразу»</b>.</li>
        <li>Действие <b>«Показать уведомление»</b>: <i>UpBek: время сверки 🧮</i>.</li>
        <li>Повтори для 9:00.</li>
      </ol><p class="dim">Утром и вечером UpBek сам покажет карточку сверки на главной.</p></div>`,
  }[which];
  openSheet(() => body);
}
function openCloudCode() {
  const c = S.cloud || {};
  openSheet(() => `${sheetHead('🔑 Код восстановления')}
    <p class="muted" style="margin-top:0">Это ключ ко всем твоим данным в облаке. Сохрани его (например, в «Заметки» или «Избранное» Telegram). На новом телефоне введи его — и всё вернётся.</p>
    <div class="codebox">${esc(c.token || '—')}</div>
    <button class="btn gold" style="margin-top:10px" data-a="copy" data-k="token">Копировать код</button>
    <div class="note">⚠️ Не публикуй код: кто его знает, может прочитать твои записи.</div>`);
}
function openRestoreAsk() {
  openSheet(() => `${sheetHead('♻️ Восстановить из облака')}
    <p class="muted" style="margin-top:0">Введи код восстановления. Данные на этом устройстве заменятся данными из облака.</p>
    <input id="restoreCode" placeholder="Код из 32 символов" autocomplete="off" autocapitalize="off" spellcheck="false">
    <button class="btn gold" style="margin-top:10px" data-a="cloudRestoreGo">Восстановить</button>`);
}

Object.assign(A, {
  cloudNow: async () => { toast('☁️ Синхронизирую…'); await cloudPull(); await cloudPush(); toast(S.cloud && !S.cloud.err ? '✓ Синхронизировано' : '⚠️ Не получилось — проверь интернет'); render(); },
  cloudCode: openCloudCode,
  cloudRestoreAsk: openRestoreAsk,
  cloudRestoreGo: async () => {
    const code = ($('#restoreCode').value || '').trim();
    if (code.length < 20) { toast('Код слишком короткий'); return; }
    if (S.profile && !confirm('Заменить данные на этом устройстве данными из облака?')) return;
    try { await cloudRestore(code); closeSheet(); toast('✓ Данные восстановлены'); } catch (e) { toast('⚠️ ' + esc(e.message || 'Ошибка')); }
  },
  autoHelp: (el) => openAutoHelp(el.dataset.v),
  copy: (el) => {
    const k = el.dataset.k;
    if (k === 'url') copyText(shortcutUrl(), 'URL');
    else if (k === 'key') copyText(CLOUD.key, 'Ключ');
    else copyText((S.cloud && S.cloud.token) || '', 'Код');
  },
  obRestore: openRestoreAsk,
});

/* ---- старт ---- */
function cloudStart() {
  if (!cloudReady()) return;
  if (S.profile && (!S.cloud || !S.cloud.token)) { S.cloud = { token: newToken() }; save(); }
  else if (S.profile && S.cloud && !S.cloud.lastPush) cloudSchedule();
  cloudPull();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudPull(); });
window.addEventListener('online', () => { cloudPull(); cloudSchedule(); });
cloudStart();
