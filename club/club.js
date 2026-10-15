/* Клуб: игроки и друзья, барахолка, обмен, DJ-баттлы, вечеринка недели.
   Подключается после основного скрипта и пользуется его функциями (GM, A, cover, cps, addCopy, takeCopy, ridFind...). */
(function () {
  const API = (p, b) => DLF("/api/club/" + p, b ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) } : { cache: "no-store" })
    .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "Ошибка " + r.status); return j });
  const box = () => document.getElementById("clubbox");
  let FAIL = {}, V = "players", ME = null, PL = null, PROF = null, MK = null, TRS = null, BT = null, PARTY = null, PK = null, TR = null, SD = null, RES = null, ERR = "";
  window.CLUBLK = 0;

  // ---------- пластинки как предметы ----------
  const relOf = (i, ri) => A[i].rels[ri] || [A[i].t, A[i].y];
  const itemOf = (i, ri, c) => ({ a: A[i].a, k: ridK(i, ri), c, t: un(relOf(i, ri)[0] || ""), y: String(relOf(i, ri)[1] || ""), r: rr(i) });
  const itPow = (it) => { const f = ridFind(it.a, it.k); return f ? relPow(f[0], it.c) : Math.round(PW[+it.r || 0] * CM[it.c] * 10) / 10 };
  const itVal = (it) => { const f = ridFind(it.a, it.k); return f ? relVal(f[0], it.c) : Math.max(1, Math.round(RC.r[+it.r || 0].p * CM[it.c])) };
  const itName = (it) => { const f = ridFind(it.a, it.k); return (it.t || (f ? un(relOf(f[0], f[1])[0] || "") : "")) + " - " + un(it.a) };
  function itHtml(it, extra) {
    const f = ridFind(it.a, it.k), r = f ? rr(f[0]) : +it.r || 0, rc = RC.r[r] || RC.r[0];
    const t = it.t || (f ? un(relOf(f[0], f[1])[0] || "") : "");
    return `<div class="cit" style="--rc:${rc.c}"><span class="scv">${f ? cover(f[0], false, f[1]) : '<i class="ciq">?</i>'}</span><span class="cin"><b>${esc(t)}</b><small>${esc(un(it.a))}</small><span class="cim"><span class="cnd c${it.c}">${CN[it.c]}</span><span class="rbd" style="--rc:${rc.c}">${esc(rc.n)}</span><em>сила ${itPow(it)}</em></span></span>${extra || ""}</div>`;
  }
  const countOf = (list, it) => list.filter((x) => x.a === it.a && x.k === it.k && x.c === it.c).length;
  const ownedCnt = (it) => { const f = ridFind(it.a, it.k); return f ? cps(f[0], f[1]).filter((c) => c === it.c).length : 0 };
  const hasAll = (list) => list.every((it) => ownedCnt(it) >= countOf(list, it));
  function takeIt(it) { const f = ridFind(it.a, it.k); if (!f) return false; const ix = cps(f[0], f[1]).indexOf(it.c); if (ix < 0) return false; takeCopy(f[0], f[1], ix); return true }
  window.giveItem = function (it) {
    const f = ridFind(String(it.a || ""), String(it.k || "")), c = Math.max(0, Math.min(4, +it.c | 0));
    if (f) { addCopy(f[0], f[1], c); return true }
    GM.sa += Math.max(1, Math.round((RC.r[+it.r || 0] || RC.r[0]).p * CM[c])); return false;
  };
  function setPow(items) {
    const base = items.reduce((s, it) => s + itPow(it), 0), fs = items.map((it) => ridFind(it.a, it.k)).filter(Boolean);
    const gc = {}; fs.forEach(([i]) => gOf(i).forEach((g) => (gc[g.id] = (gc[g.id] || 0) + 1)));
    const grc = {}; new Set(fs.map(([i]) => i)).forEach((i) => (G[A[i].a] || []).forEach((g) => (grc[g] = (grc[g] || 0) + 1)));
    const gen = Object.values(gc).some((n) => n >= 3), grp = Object.values(grc).some((n) => n >= 2), bon = (gen ? 0.15 : 0) + (grp ? 0.15 : 0);
    return { base: Math.round(base * 10) / 10, gen, grp, bon, pw: Math.round(base * (1 + bon) * 10) / 10 };
  }

  // ---------- выбор своей пластинки ----------
  function pickHtml() {
    if (!PK) return "";
    const ai = PK.art != null ? IDX[PK.art] : null, used = PK.used || [];
    if (PK.item) return `<div class="cpk"><div class="cpkh"><button class="shback" data-pkx="back" type="button">← Назад</button><b>${PK.title}</b></div>${itHtml(PK.item)}
<label class="cprice">Цена в соусе <input id="cpr" type="number" min="1" max="1000000" value="${Math.max(1, Math.round(itVal(PK.item) * 1.2))}"></label><p class="hint2">Барахолка берёт 10% с продажи. Цена у Дяди Славы: ${itVal(PK.item)}.</p><button class="cgo" data-pkx="list" type="button">Выставить</button></div>`;
    if (ai != null && has(ai)) {
      return `<div class="cpk"><div class="cpkh"><button class="shback" data-pkx="arts" type="button">← Все исполнители</button><b>${esc(un(A[ai].a))}</b></div><div class="cml">${ownRels(ai).map((ri) => {
        const L = cps(ai, ri); return `<div class="cmr"><span>${esc(un(relOf(ai, ri)[0] || ""))}</span><span class="cpb">${L.map((c, k) => {
          const it = itemOf(ai, ri, c), left = L.filter((x) => x === c).length - countOf(used, it);
          return `<button class="sellb" data-pk="${ri}:${c}" ${left > 0 ? "" : "disabled"}><span class="cnd c${c}">${CN[c]}</span> сила ${relPow(ai, c)}</button>`;
        }).filter((x, k, arr) => arr.indexOf(x) === k).join("")}</span></div>`;
      }).join("")}</div></div>`;
    }
    const L = bag.slice().sort((x, y) => un(A[x].a).localeCompare(un(A[y].a)));
    return `<div class="cpk"><div class="cpkh"><b>${PK.title}</b><button class="shback" data-pkx="close" type="button">Закрыть</button></div><p class="hint2" style="margin:0 0 6px">Выбери исполнителя, потом копию.</p><div class="shl">${L.map((i) => `<button class="shc" data-pa="${esc(A[i].a)}" style="--rc:${RC.r[rr(i)].c}">${esc(un(A[i].a))}</button>`).join("")}</div></div>`;
  }
  function bindPick(el) {
    el.querySelectorAll("[data-pa]").forEach((b) => (b.onclick = () => { PK.art = b.getAttribute("data-pa"); draw() }));
    el.querySelectorAll("[data-pkx]").forEach((b) => (b.onclick = async () => {
      const x = b.dataset.pkx;
      if (x === "arts") PK.art = null; else if (x === "close") PK = null; else if (x === "back") PK.item = null;
      else if (x === "list") {
        const price = Math.trunc(+document.getElementById("cpr").value || 0), it = PK.item;
        if (!hasIt1(it)) return fail("Этой копии у тебя уже нет");
        try { await API("market/list", { item: it, price }); takeIt(it); commit(); PK = null; MK = null; toast("Пластинка на барахолке") } catch (e) { return fail(e.message) }
      }
      draw();
    }));
    el.querySelectorAll("[data-pk]").forEach((b) => (b.onclick = async () => {
      const ai = IDX[PK.art], [ri, c] = b.dataset.pk.split(":").map(Number), it = itemOf(ai, ri, c);
      if (PK.mode === "sell") { PK.item = it; return draw() }
      if (PK.mode === "set") { SD.push(it); if (SD.length >= 5) PK = null; return draw() }
      if (PK.mode === "give") { TR.give.push(it); if (TR.give.length >= 5) PK = null; return draw() }
      if (PK.mode === "party") {
        try { await API("party", { item: it, pw: itPow(it) }); PK = null; PARTY = null; toast("Пластинка играет на вечеринке") } catch (e) { return fail(e.message) }
        draw();
      }
    }));
  }
  const hasIt1 = (it) => ownedCnt(it) > 0;
  function fail(m) { ERR = m; toast(m); draw() }

  // ---------- экраны ----------
  const TABS = [["players", "Игроки"], ["market", "Барахолка"], ["trades", "Обмен"], ["battle", "Баттлы"], ["party", "Вечеринка"]];
  function shell(inner) {
    const v = V === "prof" || V === "trade" ? "players" : V;
    return `<div class="club"><div class="chead"><div><h2>Клуб</h2><p class="hint2">${ME ? `Ты ${esc(ME.login)}${ME.title ? ` · «${esc(ME.title)}»` : ""} · лайков за неделю ${ME.likes7}, это +${Math.min(15, ME.likes7)}% хайпа блока` : "загружаю…"}</p></div></div>
<div class="seg ctabs">${TABS.map(([k, t]) => `<button data-v="${k}" class="${v === k ? "on" : ""}">${t}${k === "players" && ME && ME.in.length ? ` <i class="cbadge">${ME.in.length}</i>` : ""}${k === "trades" && ME && ME.tradesIn ? ` <i class="cbadge">${ME.tradesIn}</i>` : ""}</button>`).join("")}</div>
${ERR ? `<p class="cerr">${esc(ERR)}</p>` : ""}${inner}</div>`;
  }
  const loading = () => `<p class="hint" style="text-align:center;margin:30px 0">Загружаю…</p>`;
  const st2btn = (p) => p.st === "self" ? '<span class="cst">это ты</span>' : p.st === "friend" ? `<button class="sellb" data-fr="remove:${esc(p.login)}">Друг ✓</button>` : p.st === "out" ? `<button class="sellb" data-fr="remove:${esc(p.login)}">Заявка отправлена</button>` : p.st === "in" ? `<button class="cgo" data-fr="add:${esc(p.login)}">Принять в друзья</button>` : `<button class="sellb" data-fr="add:${esc(p.login)}">В друзья</button>`;

  function viewPlayers() {
    if (!PL) { if (FAIL["players"]) return failed("players"); load("players", (j) => (PL = j.players)); return loading() }
    const inc = ME && ME.in.length ? `<div class="cbox"><b>Заявки в друзья</b>${ME.in.map((l) => `<div class="cmr"><span>${esc(l)}</span><span class="cpb"><button class="cgo" data-fr="add:${esc(l)}">Принять</button><button class="sellb" data-fr="remove:${esc(l)}">Отклонить</button></span></div>`).join("")}</div>` : "";
    return inc + `<div class="cbox"><b>Игроки</b><p class="hint2">Заходи в чужие блоки и лайкай их: каждый лайк за последние 7 дней даёт владельцу +1% хайпа, максимум +15%. Один лайк в день на блок. Обмениваться можно только с друзьями.</p>
${PL.map((p) => { let h = 0; for (const c of p.login) h = (h * 31 + c.charCodeAt(0)) % 360; return `<div class="cpl2"><button class="cpo" data-prof="${esc(p.login)}"><span class="av" style="--ah:${h}">${esc([...p.login][0] || "?")}</span><span><b>${esc(p.login)}</b><small>исполнителей ${p.arts} · релизов ${p.rels} · ♥ ${p.likes7}${p.pw ? " · сет " + p.pw : ""}</small></span></button>${st2btn(p)}</div>` }).join("")}</div>`;
  }

  function parseCp(cp) {
    const by = {};
    Object.entries(cp || {}).forEach(([key, L]) => { const p = key.indexOf("::"); if (p < 0 || !Array.isArray(L)) return; const a = key.slice(0, p), k = key.slice(p + 2); (by[a] = by[a] || []).push([k, L.map((c) => Math.max(0, Math.min(4, +c | 0)))]) });
    return by;
  }
  function visitBlock(P) {
    const saveD = GM.dist, s1 = DSEL, s2 = DMOVE;
    try { GM.dist = { b: JSON.parse(JSON.stringify(P.bd || {})), sh: [] }; DSEL = null; DMOVE = null; const byCell = {}; Object.keys(GM.dist.b).forEach((id) => (byCell[GM.dist.b[id].cell] = id)); return blockSvg(GM.dist, byCell) }
    catch (e) { return "" } finally { GM.dist = saveD; DSEL = s1; DMOVE = s2 }
  }
  function viewProf() {
    const P = PROF; if (!P) return loading();
    const by = parseCp(P.cp), arts = Object.keys(by).sort((x, y) => un(x).localeCompare(un(y))), tradeMode = TR && TR.to === P.login;
    const vit = (P.sh || []).map((n) => { const i = shI(n); if (i == null) return ""; const r = Math.max(0, shRi(n)); return `<span class="cvit" title="${esc(shName(n))}"><span class="scv">${cover(i, false, r)}</span></span>` }).join("");
    const rels = arts.map((a) => `<details class="cart"${tradeMode && arts.length < 12 ? " open" : ""}><summary>${esc(un(a))} <small>${by[a].reduce((s, x) => s + x[1].length, 0)}</small></summary>${by[a].map(([k, L]) => [...new Set(L)].map((c) => { const it = { a, k, c }; const f = ridFind(a, k); if (f) { it.t = un(relOf(f[0], f[1])[0] || ""); it.r = rr(f[0]) } return itHtml(it, tradeMode ? `<button class="sellb" data-want="${esc(JSON.stringify(it))}" ${TR.want.length >= 5 || countOf(TR.want, it) >= L.filter((x) => x === c).length ? "disabled" : ""}>Хочу</button>` : "") }).join("")).join("")}</details>`).join("");
    return `<button class="shback" data-back="players" type="button">← Все игроки</button><div class="cbox cprof"><div class="cph"><b>${esc(P.login)}${P.title ? ` <i class="ctitle">«${esc(P.title)}»</i>` : ""}</b><span class="cpb">${P.st !== "self" ? `<button class="cgo" data-like="${esc(P.login)}" ${P.liked ? "disabled" : ""}>${P.liked ? "♥ лайк сегодня есть" : "♥ Лайкнуть блок"}</button>` : ""}${P.st === "friend" ? `<button class="sellb" data-tradeto="${esc(P.login)}">${tradeMode ? "Обмен открыт ниже" : "Предложить обмен"}</button>` : ""}${st2btn(P)}</span></div>
<p class="hint2">Исполнителей ${(P.b || []).length} · релизов ${Object.keys(P.cp || {}).length} · ♥ ${P.likes7} за неделю${P.bset ? " · сила сета " + P.bset.pw : ""}</p></div>
${tradeMode ? viewTradeDraft() : ""}
<div class="cbox"><b>Блок</b><div class="cblk">${visitBlock(P)}</div>${vit ? `<b>Витрина</b><div class="cvits">${vit}</div>` : ""}</div>
<div class="cbox"><b>Пластинки</b>${tradeMode ? '<p class="hint2">Нажимай «Хочу» на том, что хочешь получить, до 5 штук.</p>' : ""}${rels || '<p class="hint2">Пока пусто.</p>'}</div>`;
  }
  function viewTradeDraft() {
    const g = TR.give, w = TR.want, sp = (l) => l.map((it, k) => itHtml(it, `<button class="sellb" data-rm="${k}">✕</button>`)).join("");
    return `<div class="cbox ctr"><b>Обмен с ${esc(TR.to)}</b><div class="ctrc"><div><span class="ck">Ты получаешь</span>${w.map((it, k) => itHtml(it, `<button class="sellb" data-rmw="${k}">✕</button>`)).join("") || '<p class="hint2">Выбери ниже кнопкой «Хочу».</p>'}</div>
<div><span class="ck">Ты отдаёшь</span>${sp(g) || '<p class="hint2">Пока ничего.</p>'}${g.length < 5 ? `<button class="sellb" data-give type="button">+ Добавить свою пластинку</button>` : ""}<label class="cprice">И соуса <input id="ctsa" type="number" min="0" value="${TR.sa || 0}"></label></div></div>
${PK && PK.mode === "give" ? pickHtml() : ""}<div class="acts"><button class="cgo" data-sendtr ${w.length && (g.length || TR.sa) ? "" : "disabled"}>Отправить предложение</button><button class="sellb" data-cancdr>Отмена</button></div>
<p class="hint2">Твои пластинки и соус уходят из коллекции сразу и ждут ответа. Если друг откажется или ты отменишь, всё вернётся.</p></div>`;
  }

  function viewMarket() {
    if (!MK) { if (FAIL["market"]) return failed("market"); load("market", (j) => (MK = j.listings)); return loading() }
    const me = ME ? ME.login : "";
    return `<div class="cbox"><div class="cph"><b>Барахолка</b>${!PK || PK.mode !== "sell" ? `<button class="cgo" data-sell type="button">Выставить пластинку</button>` : ""}</div><p class="hint2">Здесь можно продать любую свою пластинку другим игрокам, не только дубль. Деньги приходят посылкой, комиссия барахолки 10% сгорает. Пластинка уходит с полки сразу, снять лот можно в любой момент.</p>${PK && PK.mode === "sell" ? pickHtml() : ""}</div>
<div class="cbox">${MK.length ? MK.map((L) => itHtml(L.item, `<span class="cmk"><b>${L.price}</b><small>от ${esc(L.login)}</small>${L.login === me ? `<button class="sellb" data-mkc="${L.id}">Снять</button>` : `<button class="cgo" data-mkb="${L.id}" ${GM.sa >= L.price ? "" : "disabled"}>Купить</button>`}</span>`)).join("") : '<p class="hint2">Лотов пока нет. Будь первым.</p>'}</div>`;
  }

  function viewTrades() {
    if (!TRS) { if (FAIL["trades"]) return failed("trades"); load("trades", (j) => (TRS = j.trades)); return loading() }
    const me = ME ? ME.login : "", inc = TRS.filter((t) => t.toLogin === me), out = TRS.filter((t) => t.fromLogin === me);
    const card = (t, mine) => `<div class="cbox ctr"><b>${mine ? "Ты предлагаешь " + esc(t.toLogin) : esc(t.fromLogin) + " предлагает тебе"}</b><div class="ctrc"><div><span class="ck">${mine ? "Ты получишь" : "Ты отдашь"}</span>${t.want.map((it) => itHtml(it, !mine && !hasIt1(it) ? '<em class="cerr">нет у тебя</em>' : "")).join("")}</div><div><span class="ck">${mine ? "Ты отдаёшь" : "Ты получишь"}</span>${t.give.map((it) => itHtml(it)).join("")}${t.sa ? `<p>и ${t.sa} соуса</p>` : ""}</div></div>
<div class="acts">${mine ? `<button class="sellb" data-trc="${t.id}">Отменить</button>` : `<button class="cgo" data-tra="${t.id}" ${hasAll(t.want) ? "" : "disabled"}>Принять</button><button class="sellb" data-trc="${t.id}">Отказаться</button>`}</div></div>`;
    return `<p class="hint2">Обмен предлагается из профиля друга: Игроки → друг → «Предложить обмен».</p>${inc.map((t) => card(t, false)).join("")}${out.map((t) => card(t, true)).join("")}${!inc.length && !out.length ? '<div class="cbox"><p class="hint2">Открытых обменов нет.</p></div>' : ""}`;
  }

  function viewBattle() {
    if (!BT) { if (FAIL["battle"]) return failed("battle"); load("battle", (j) => { BT = j; if (!SD) SD = (j.mine && j.mine.items) || (Array.isArray(GM.bs) ? GM.bs : []).slice() }); return loading() }
    const sp = setPow(SD), saved = BT.mine, okOwn = hasAll(SD);
    const slots = [0, 1, 2, 3, 4].map((k) => SD[k] ? itHtml(SD[k], `<button class="sellb" data-srm="${k}">✕</button>`) : `<div class="cit empty"><span class="scv"><i class="ciq">+</i></span><span class="cin"><small>пустой слот</small></span></div>`).join("");
    const res = RES ? `<div class="cbox cres ${RES.win ? "win" : "lose"}"><b>${RES.win ? "Победа!" : "Поражение"}</b><p>Твой сет отыграл на <b>${RES.me}</b>, сет ${esc(RES.opp.login)} на <b>${RES.them}</b>. Рейтинг ${RES.delta > 0 ? "+" : ""}${RES.delta}, теперь ${RES.rate.r}.</p></div>` : "";
    return `${res}<div class="cbox"><div class="cph"><b>Твой сет</b><small>сила ${sp.pw}${sp.bon ? ` (база ${sp.base}, бонус +${Math.round(sp.bon * 100)}%)` : ""}</small></div>
<p class="hint2">5 пластинок. Сила зависит от редкости и состояния, жанр недели даёт ×2. Бонусы: +15%, если три пластинки одного жанра, и +15%, если два исполнителя из одного объединения. В баттле к силе добавляется удача ±15%.</p>
<div class="cset">${slots}</div>${!okOwn ? '<p class="cerr">Каких-то пластинок из сета у тебя уже нет. Убери их.</p>' : ""}
<div class="acts">${SD.length < 5 ? `<button class="sellb" data-spick>+ Выбрать пластинку</button>` : ""}<button class="sellb" data-sbest>Собрать самый сильный</button><button class="cgo" data-ssave ${SD.length === 5 && okOwn ? "" : "disabled"}>Сохранить сет</button></div>
${saved ? `<p class="hint2">На сервере сохранён сет силой ${saved.pw}. С ним ты дерёшься и с ним дерутся с тобой.</p>` : '<p class="hint2">Сохрани сет, чтобы баттлить.</p>'}${PK && PK.mode === "set" ? pickHtml() : ""}</div>
<div class="cbox"><div class="cph"><b>Соперники</b><small>баттлов сегодня осталось ${BT.left} · рейтинг недели ${BT.rate.r} (${BT.rate.w}–${BT.rate.l})</small></div>
${BT.opps.length ? BT.opps.map((o) => `<div class="cmr"><span><b>${esc(o.login)}</b> <small>сила ${o.pw}</small></span><button class="cgo" data-bt="${esc(o.login)}" ${saved && BT.left > 0 ? "" : "disabled"}>Баттл</button></div>`).join("") : '<p class="hint2">Пока никто не собрал сет.</p>'}</div>
<div class="cbox"><b>Топ недели ${esc(BT.week)}</b><p class="hint2">Победа даёт +20 рейтинга (больше, если соперник сильнее), поражение −10. В понедельник топ-3 получают дрип и титул: ${BT.prizes.map((p, k) => `${k + 1} место ${p[0]} дрипа, «${esc(p[1])}»`).join("; ")}.</p>
${BT.top.map((t, k) => `<div class="cmr"><span>${k + 1}. ${esc(t.login)}</span><small>${t.r} · ${t.w}–${t.l}</small></div>`).join("") || '<p class="hint2">На этой неделе ещё никто не играл.</p>'}</div>`;
  }

  function viewParty() {
    if (!PARTY) { if (FAIL["party"]) return failed("party"); load("party", (j) => (PARTY = j)); return loading() }
    const P = PARTY, max = P.tiers[P.tiers.length - 1][0];
    return `<div class="cbox"><div class="cph"><b>Вечеринка недели ${esc(P.week)}</b><small>сила ${P.total}</small></div>
<p class="hint2">Раз в неделю каждый приносит на общий сет одну пластинку. Она остаётся у тебя, на вечеринку идёт только её сила. В понедельник все, кто принёс пластинку, получают дрип по достигнутой ступени: ${P.tiers.map((t) => `${t[0]} силы → ${t[1]} дрипа`).join(", ")}.</p>
<div class="cpar"><i style="width:${Math.min(100, (P.total / max) * 100)}%"></i>${P.tiers.map((t) => `<span style="left:${(t[0] / max) * 100}%" class="${P.total >= t[0] ? "on" : ""}">${t[0]}: +${t[1]}</span>`).join("")}</div>
${P.mine ? `<p>Ты принёс: ${esc(itName(P.mine.item))} (сила ${P.mine.pw}).</p>` : PK && PK.mode === "party" ? pickHtml() : `<button class="cgo" data-party>Принести пластинку</button>`}</div>
<div class="cbox"><b>Кто пришёл</b>${P.list.map((x) => itHtml(x.item, `<small class="cby">${esc(x.login)}</small>`)).join("") || '<p class="hint2">Пока никого.</p>'}</div>`;
  }

  function load(what, set) { API(what).then((j) => { set(j); ERR = ""; draw() }).catch((e) => { ERR = e.message; FAIL[what] = 1; draw() }) }
  const failed = (w) => FAIL[w] ? '<div class="cbox"><p class="hint2">Не получилось загрузить. Переключи вкладку, чтобы попробовать ещё раз.</p></div>' : "";
  async function loadMe() { try { ME = await API("me"); window.CLUBLK = Math.min(15, ME.likes7 || 0) } catch (e) { } }

  function draw() {
    const el = box(); if (!el) return;
    if (!(lvOf("club") > 0)) { el.innerHTML = `<div class="club"><div class="cbox"><b>Клуб закрыт</b><p class="hint2">Построй здание «Клуб» в своём блоке (Моё → Блок, 8 дрипа). Тогда здесь откроются друзья, барахолка, обмен, DJ-баттлы и вечеринки.</p></div></div>`; return }
    if (!ME) { loadMe().then(() => draw()); el.innerHTML = shell(loading()); return }
    const inner = V === "players" ? viewPlayers() : V === "prof" ? viewProf() : V === "market" ? viewMarket() : V === "trades" ? viewTrades() : V === "battle" ? viewBattle() : viewParty();
    el.innerHTML = shell(inner); bind(el);
  }
  async function act(fn) { try { ERR = ""; await fn() } catch (e) { ERR = e.message; toast(e.message) } draw() }
  async function openProf(login) { V = "prof"; PROF = null; PK = null; draw(); try { PROF = await API("u/" + encodeURIComponent(login)) } catch (e) { ERR = e.message; V = "players" } draw() }
  function bind(el) {
    el.querySelectorAll(".ctabs button").forEach((b) => (b.onclick = () => { V = b.dataset.v; PK = null; RES = null; ERR = ""; FAIL = {}; if (V === "players") { PL = null; loadMe() } if (V === "market") MK = null; if (V === "trades") TRS = null; if (V === "battle") BT = null; if (V === "party") PARTY = null; draw() }));
    el.querySelectorAll("[data-prof]").forEach((b) => (b.onclick = () => openProf(b.getAttribute("data-prof"))));
    el.querySelectorAll("[data-back]").forEach((b) => (b.onclick = () => { V = "players"; PL = null; TR = null; PK = null; draw() }));
    el.querySelectorAll("[data-fr]").forEach((b) => (b.onclick = () => {
      const [a, login] = b.getAttribute("data-fr").split(/:(.*)/s);
      if (a === "remove" && !confirmFr(b)) return;
      act(async () => { await API("friend", { login, act: a }); await loadMe(); PL = null; if (PROF && PROF.login === login) PROF = await API("u/" + encodeURIComponent(login)) });
    }));
    el.querySelectorAll("[data-like]").forEach((b) => (b.onclick = () => act(async () => { const login = b.getAttribute("data-like"); const j = await API("like", { login }); PROF.liked = true; PROF.likes7 = j.likes7; toast("♥ отправлен") })));
    el.querySelectorAll("[data-tradeto]").forEach((b) => (b.onclick = () => { if (!TR || TR.to !== PROF.login) TR = { to: PROF.login, give: [], want: [], sa: 0 }; draw() }));
    el.querySelectorAll("[data-want]").forEach((b) => (b.onclick = () => { try { TR.want.push(JSON.parse(b.getAttribute("data-want"))) } catch (e) { } draw() }));
    el.querySelectorAll("[data-rmw]").forEach((b) => (b.onclick = () => { TR.want.splice(+b.dataset.rmw, 1); draw() }));
    el.querySelectorAll(".ctr [data-rm]").forEach((b) => (b.onclick = () => { TR.give.splice(+b.dataset.rm, 1); draw() }));
    el.querySelectorAll("[data-give]").forEach((b) => (b.onclick = () => { PK = { mode: "give", title: "Что отдаёшь", art: null, used: TR.give }; draw() }));
    const ts = el.querySelector("#ctsa"); if (ts) ts.onchange = () => { TR.sa = Math.max(0, Math.trunc(+ts.value || 0)); draw() };
    el.querySelectorAll("[data-cancdr]").forEach((b) => (b.onclick = () => { TR = null; PK = null; draw() }));
    el.querySelectorAll("[data-sendtr]").forEach((b) => (b.onclick = () => act(async () => {
      const sa = Math.max(0, Math.trunc(+(el.querySelector("#ctsa") || {}).value || 0));
      if (sa > GM.sa) throw new Error("Не хватает соуса");
      if (!hasAll(TR.give)) throw new Error("Каких-то твоих пластинок уже нет");
      await API("trade", { to: TR.to, give: TR.give, want: TR.want, sa });
      TR.give.forEach(takeIt); GM.sa -= sa; commit(); TR = null; PK = null; toast("Предложение отправлено"); await loadMe();
    })));
    el.querySelectorAll("[data-sell]").forEach((b) => (b.onclick = () => { PK = { mode: "sell", title: "Выставить на барахолку", art: null }; draw() }));
    el.querySelectorAll("[data-mkb]").forEach((b) => (b.onclick = () => act(async () => { await API("market/buy", { id: b.dataset.mkb }); MK = null; await window.checkGifts() })));
    el.querySelectorAll("[data-mkc]").forEach((b) => (b.onclick = () => act(async () => { await API("market/cancel", { id: b.dataset.mkc }); MK = null; await window.checkGifts() })));
    el.querySelectorAll("[data-tra]").forEach((b) => (b.onclick = () => act(async () => {
      const t = TRS.find((x) => x.id === b.dataset.tra); if (!t) return;
      if (!hasAll(t.want)) throw new Error("У тебя нет всех нужных пластинок");
      await API("trade/accept", { id: t.id }); t.want.forEach(takeIt); commit(); TRS = null; await window.checkGifts(); await loadMe();
    })));
    el.querySelectorAll("[data-trc]").forEach((b) => (b.onclick = () => act(async () => { await API("trade/cancel", { id: b.dataset.trc }); TRS = null; await window.checkGifts(); await loadMe() })));
    el.querySelectorAll("[data-srm]").forEach((b) => (b.onclick = () => { SD.splice(+b.dataset.srm, 1); draw() }));
    el.querySelectorAll("[data-spick]").forEach((b) => (b.onclick = () => { PK = { mode: "set", title: "Пластинка в сет", art: null, used: SD }; draw() }));
    el.querySelectorAll("[data-sbest]").forEach((b) => (b.onclick = () => {
      const all = []; bag.forEach((i) => ownRels(i).forEach((ri) => all.push(itemOf(i, ri, bestC(i, ri)))));
      all.sort((x, y) => itPow(y) - itPow(x)); SD = all.slice(0, 5); PK = null; draw();
    }));
    el.querySelectorAll("[data-ssave]").forEach((b) => (b.onclick = () => act(async () => { const sp = setPow(SD); await API("set", { items: SD, pw: sp.pw }); GM.bs = SD.slice(); commit(); BT = null; toast("Сет сохранён, сила " + sp.pw) })));
    el.querySelectorAll("[data-bt]").forEach((b) => (b.onclick = () => act(async () => { RES = await API("battle", { login: b.getAttribute("data-bt") }); BT = null })));
    el.querySelectorAll("[data-party]").forEach((b) => (b.onclick = () => { PK = { mode: "party", title: "Что принесёшь", art: null }; draw() }));
    bindPick(el);
  }
  function confirmFr(b) { if (b.dataset.sure) return true; b.dataset.sure = "1"; b.textContent = "Точно? Нажми ещё раз"; return false }

  window.drawClub = draw;
  setTimeout(loadMe, 3000);
})();
