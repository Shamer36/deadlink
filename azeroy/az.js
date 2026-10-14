/* Azeroy: «Письма Гехеды» (криптограммы на Azeroyska) и «Чистка» (аркада).
   Подключается после основного скрипта: пользуется GM, commit, toast, $. */
(function () {
  const AB = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const G = (l) => `azeroy/g/${l}.png`;
  const RED = ["Мерзость.", "Твой ребёнок скучает по тебе.", "Ты снова играешь в творца?", "Система очищена.", "Здесь нет никаких птиц."];
  const LETTERS = [
    { id: "gate", t: "Врата", c: "AZEROY", r: "Где-то за вратами есть Azeroy: место, где все счастливы и никто не ломает костей. Попасть туда можно только с ключом. Этот язык и есть ключ." },
    { id: "name", t: "Имя", c: "GEHEDA", r: "Его зовут Гехеда. Создатель, алхимик, хирург, почти бог. Он хочет только одного: создать жизнь." },
    { id: "stump", t: "Пень", c: "THE STUMP IS DEAD", r: "Первая попытка. Гехеда оживлял пень, но творение не выжило. Красный голос назвал его мерзостью. Гехеда унёс душу творения в Azeroy." },
    { id: "friend", t: "Velyyr", c: "VELYYR MY OLD FRIEND", r: "Поезд, рейв под открытым небом и воспоминание о друге по имени Velyyr. Гехеде стыдно за неудачу, но ему дают ещё один шанс." },
    { id: "clean", t: "Чистка", c: "YOUR SYSTEM WILL BE CLEANED", r: "Четыре звонка: Mr W, X, Y и Z. Один предупреждает, другой даёт код, третий говорит о птицах, четвёртый обещает, что систему почистят. Шампунь, клиника, пациент 85." },
    { id: "tai", t: "Tai-85", c: "I AM TAI EIGHTY FIVE", r: "После чистки от Гехеды остался Tai-85: сломанная версия, которая помнит не всё. Но воспоминания уже возвращаются." },
    { id: "lake", t: "Ледяное озеро", c: "THE FROZEN LAKE CALLS MY NAME", r: "Tai-85 видит замёрзшее озеро, которое зовёт его по имени. Красный голос смеётся: «Твой ребёнок скучает по тебе». Личность Гехеды собирается обратно." },
    { id: "yate", t: "Письмо матери", c: "MOTHER I MADE LIFE I AM NOT ALONE", r: "Гехеда пишет матери: он создал жизнь, её зовут Yate, и он больше не одинок. Он превзошёл ту, что называла его творения уродливыми. Число 1616 горит рядом с колыбелью." },
  ];
  const WORDS = ["AZEROY", "YATE", "GEHEDA", "VELYYR", "TAI", "KEY", "LAKE", "BIRDS", "SOUL", "LIFE", "MOTHER", "CLEAN", "GATE", "SWORD", "CLAW", "ANGEL"];
  const MAXMISS = 6, DAYDRIP = 3;

  let VIEW = "letters", OPEN = null, SEL = null, RUN = null;

  function S() {
    const a = (GM.az = GM.az && typeof GM.az === "object" ? GM.az : {});
    a.k = typeof a.k === "string" ? a.k : "";
    a.done = a.done && typeof a.done === "object" ? a.done : {};
    a.cnt = a.cnt && typeof a.cnt === "object" ? a.cnt : {};
    a.best = +a.best || 0;
    const d = new Date(), today = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    if (a.dd !== today) { a.dd = today; a.dg = 0 }
    return a;
  }
  const gi = (l, cls) => `<i class="azi${cls ? " " + cls : ""}" style="--m:url('${G(l)}')"></i>`;
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function shell(inner) {
    const a = S(), n = LETTERS.filter((L) => a.done[L.id]).length;
    return `<div class="azwin"><div class="azbar"><span>${gi("A")}${gi("Z")}${gi("E")}${gi("R")}${gi("O")}${gi("Y")}</span><b>AZEROY.exe</b><em>писем ${n}/${LETTERS.length}</em><button class="azx" aria-label="Закрыть">×</button></div>
<div class="aztabs">${[["letters", "Письма Гехеды"], ["clean", "Чистка"], ["dict", "Словарь"]].map(([k, t]) => `<button data-v="${k}" class="${VIEW === k ? "on" : ""}">${t}</button>`).join("")}</div>
<div class="azbody">${inner}</div></div><p class="hint" style="margin-top:10px">По мотивам мира Azeroy и алфавита Azeroyska из работ Yabujin, в пересказе фанатов.</p>`;
  }

  // ---------- Письма ----------
  function lettersList() {
    const a = S();
    return `<p class="azlead">Гехеда пишет письма на Azeroyska. Подставляй буквы под глифы, чтобы прочитать их. Все буквы есть в словаре, но в каждом письме их надо вспоминать заново.</p><div class="azlist">` +
      LETTERS.map((L, i) => {
        const open = i === 0 || a.done[LETTERS[i - 1].id], done = a.done[L.id];
        return `<button class="azcard${done ? " done" : ""}" data-l="${L.id}" ${open ? "" : "disabled"}><span class="azno">${String(i + 1).padStart(2, "0")}</span><span class="azct"><b>${open ? esc(L.t) : "???"}</b><small>${done ? "прочитано" : open ? "письмо запечатано" : "откроется после предыдущего"}</small></span><span class="azmini">${[...L.c.replace(/ /g, "")].slice(0, 6).map((l) => gi(l)).join("")}</span></button>`;
      }).join("") + `</div>`;
  }
  function cur(L) {
    const a = S();
    if (!a.cur || a.cur.id !== L.id) a.cur = { id: L.id, f: "", m: 0 };
    return a.cur;
  }
  const known = (a, c, l) => c.f.includes(l);
  function letterView(L) {
    const a = S(), c = cur(L), done = a.done[L.id];
    const need = [...new Set(L.c.replace(/ /g, ""))];
    if (!SEL || known(a, c, SEL)) SEL = need.find((l) => !known(a, c, l)) || null;
    const words = L.c.split(" ").map((w) => `<span class="azw">${[...w].map((l) => {
      const k = done || known(a, c, l);
      return `<button class="azg${k ? " k" : ""}${SEL === l && !k ? " sel" : ""}" data-g="${l}" ${k ? "disabled" : ""}>${gi(l)}<b>${k ? l : ""}</b></button>`;
    }).join("")}</span>`).join("");
    const miss = `<div class="azmiss" title="Ошибки">${[...Array(MAXMISS)].map((_, i) => `<i class="${i < c.m ? "x" : ""}"></i>`).join("")}<span>очистка ${Math.round((c.m / MAXMISS) * 100)}%</span></div>`;
    const kb = done ? "" : `<div class="azkb">${[...AB].map((l) => `<button data-k="${l}">${l}</button>`).join("")}</div>
<div class="azact"><button class="azhint" ${GM.dr < 1 ? "disabled" : ""}>Подсказка за 1 дрип</button></div>`;
    return `<button class="azback">← Все письма</button><h3 class="azh">${esc(L.t)}</h3>${done ? "" : miss}<div class="azcipher">${words}</div>${kb}${done ? `<div class="azread"><p class="azred">ПИСЬМО ПРОЧИТАНО</p><p>${esc(L.r)}</p><p class="azplain">${esc(L.c)}</p></div>` : ""}`;
  }
  function guess(L, l) {
    const a = S(), c = cur(L);
    if (!SEL || a.done[L.id]) return;
    if (l === SEL) { c.f += l; SEL = null }
    else {
      c.m++;
      if (c.m >= MAXMISS) {
        a.cur = null; commit(); draw();
        toast("Красный голос: «" + RED[Math.floor(Math.random() * RED.length)] + "» Система очищена, письмо снова запечатано.");
        return;
      }
      const el = document.querySelector(`.azg[data-g="${SEL}"]`); if (el) { el.classList.add("bad"); setTimeout(() => el.classList.remove("bad"), 400) }
    }
    const need = [...new Set(L.c.replace(/ /g, ""))];
    if (need.every((x) => known(a, c, x))) {
      const first = !a.done[L.id];
      a.done[L.id] = 1; a.cur = null;
      if (first) { GM.dr += 2; toast("Письмо прочитано. +2 дрипа") }
    }
    commit(); draw();
  }

  // ---------- Чистка ----------
  function cleanView() {
    const a = S();
    const left = Math.max(0, DAYDRIP - a.dg);
    if (!RUN) return `<p class="azlead">Систему Tai-85 чистят. Сверху падают глифы и слова: успей назвать их, пока они не долетели до низа. Каждая ошибка добавляет очистки. Подсмотреть буквы можно в словаре, но не во время сеанса.</p>
<div class="azstart"><div><b>${a.best}</b><span>рекорд</span></div><div><b>${left}</b><span>дрипа ещё можно получить сегодня</span></div></div>
<button class="azgo">Начать сеанс</button>`;
    return `<div class="azhud"><span>счёт <b id="azsc">${RUN.score}</b></span><div class="azclean"><i id="azcl" style="width:${RUN.clean}%"></i></div><span>очистка</span></div>
<div class="azarena" id="azar"><div class="azfall" id="azf"></div><div class="azscan"></div></div><div class="azopts" id="azo"></div>`;
  }
  function pickItem() {
    const a = S(), n = RUN.n++;
    if (n > 0 && n % 8 === 7) { const w = WORDS[Math.floor(Math.random() * WORDS.length)]; return { w } }
    const l = AB[Math.floor(Math.random() * 26)];
    return { l: l || "A" };
  }
  function opts(item) {
    if (item.w) { const o = new Set([item.w]); while (o.size < 4) o.add(WORDS[Math.floor(Math.random() * WORDS.length)]); return [...o].sort(() => Math.random() - 0.5) }
    const o = new Set([item.l]); while (o.size < 4) o.add(AB[Math.floor(Math.random() * 26)]); return [...o].sort(() => Math.random() - 0.5);
  }
  function nextItem() {
    const a = S(), it = pickItem(), f = $("#azf"), o = $("#azo"); if (!f || !o) return stopRun();
    RUN.item = it; RUN.t0 = performance.now();
    RUN.dur = Math.max(2200, (it.w ? 9000 : 6000) - RUN.score * 120);
    f.innerHTML = it.w ? `<span class="azfw">${[...it.w].map((l) => gi(l)).join("")}</span>` : `${gi(it.l, "big")}`;
    f.style.left = it.w ? "50%" : 15 + Math.random() * 70 + "%"; f.style.top = "0%";
    o.innerHTML = opts(it).map((x) => `<button data-o="${x}">${x}</button>`).join("");
    o.querySelectorAll("button").forEach((b) => (b.onclick = () => answer(b.dataset.o)));
  }
  function answer(x) {
    if (!RUN || !RUN.item) return;
    const a = S(), it = RUN.item, ok = it.w ? x === it.w : x === it.l;
    RUN.item = null;
    if (ok) {
      RUN.score++; RUN.clean = Math.max(0, RUN.clean - 5);
      flash("ok");
    } else { RUN.clean += 25; flash("bad") }
    const sc = $("#azsc"), cl = $("#azcl"); if (sc) sc.textContent = RUN.score; if (cl) cl.style.width = Math.min(100, RUN.clean) + "%";
    if (RUN.clean >= 100) return over();
    setTimeout(nextItem, 250);
  }
  function flash(k) { const ar = $("#azar"); if (ar) { ar.classList.remove("ok", "bad"); void ar.offsetWidth; ar.classList.add(k) } }
  function tick(t) {
    if (!RUN) return;
    if (!$("#azar")) return stopRun();
    if (RUN.item) {
      const p = (t - RUN.t0) / RUN.dur, f = $("#azf");
      if (f) f.style.top = Math.min(100, p * 100) + "%";
      if (p >= 1) answer("__timeout__");
    }
    RUN.raf = requestAnimationFrame(tick);
  }
  function startRun() { RUN = { score: 0, clean: 0, n: 0, item: null }; draw(); nextItem(); RUN.raf = requestAnimationFrame(tick) }
  function stopRun() { if (RUN) cancelAnimationFrame(RUN.raf); RUN = null }
  function over() {
    const a = S(), sc = RUN.score; stopRun();
    const best = sc > a.best; if (best) a.best = sc;
    const dr = Math.min(Math.floor(sc / 10), Math.max(0, DAYDRIP - a.dg)); a.dg += dr; GM.dr += dr; commit();
    const box = $("#azbox");
    box.innerHTML = shell(`<div class="azover"><p class="azred">СИСТЕМА ОЧИЩЕНА</p><p class="azvoice">«${RED[Math.floor(Math.random() * RED.length)]}»</p><div class="azstart"><div><b>${sc}</b><span>счёт${best ? ", новый рекорд" : ""}</span></div><div><b>+${dr}</b><span>дрипа</span></div></div><button class="azgo">Ещё сеанс</button></div>`);
    bind();
  }

  // ---------- Словарь ----------
  function dictView() {
    const a = S();
    return `<p class="azlead">Алфавит Azeroyska. Запоминай: в письмах и в «Чистке» буквы сами не подставляются.</p><div class="azdict">${[...AB].map((l) => {
      return `<div class="azd k">${gi(l)}<b>${l}</b></div>`;
    }).join("")}</div>`;
  }

  function draw() {
    const box = $("#azbox"); if (!box) return;
    if (VIEW !== "clean") stopRun();
    let inner = "";
    if (VIEW === "letters") { const L = OPEN && LETTERS.find((x) => x.id === OPEN); inner = L ? letterView(L) : lettersList() }
    else if (VIEW === "clean") inner = cleanView();
    else inner = dictView();
    box.innerHTML = shell(inner);
    bind();
  }
  function bind() {
    const box = $("#azbox");
    box.querySelectorAll(".aztabs button").forEach((b) => (b.onclick = () => { VIEW = b.dataset.v; SEL = null; if (VIEW !== "clean") stopRun(); draw() }));
    box.querySelectorAll(".azcard").forEach((b) => (b.onclick = () => { OPEN = b.dataset.l; SEL = null; draw() }));
    const bk = box.querySelector(".azback"); if (bk) bk.onclick = () => { OPEN = null; draw() };
    box.querySelectorAll(".azg").forEach((b) => (b.onclick = () => { SEL = b.dataset.g; draw() }));
    const L = OPEN && LETTERS.find((x) => x.id === OPEN);
    box.querySelectorAll(".azkb button").forEach((b) => (b.onclick = () => L && guess(L, b.dataset.k)));
    const h = box.querySelector(".azhint");
    if (h) h.onclick = () => { if (!L || GM.dr < 1) return; const a = S(), c = cur(L); const need = [...new Set(L.c.replace(/ /g, ""))].filter((x) => !known(a, c, x)); if (!need.length) return; GM.dr -= 1; SEL = need[0]; guess(L, need[0]) };
    const x = box.querySelector(".azx"); if (x) x.onclick = () => { stopRun(); goTab("sky") };
    const go = box.querySelector(".azgo"); if (go) go.onclick = startRun;
  }
  document.addEventListener("keydown", (e) => {
    if (typeof tabNow !== "function" || tabNow() !== "az" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    const k = (e.key || "").toUpperCase();
    if (!/^[A-Z]$/.test(k)) return;
    if (VIEW === "letters" && OPEN) { const L = LETTERS.find((x) => x.id === OPEN); if (L) { e.preventDefault(); guess(L, k) } }
    else if (VIEW === "clean" && RUN && RUN.item && RUN.item.l) { e.preventDefault(); answer(k) }
  });
  window.drawAz = draw;
})();
