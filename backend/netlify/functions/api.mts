// Deadlink API: аккаунты, общая база, полки, подарки, клуб, загрузки.
// Сайт живёт на GitHub Pages, сюда ходит только за данными.
import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"
import { pbkdf2Sync, randomBytes, timingSafeEqual, randomUUID, createHash, randomInt } from "node:crypto"
import nodemailer from "nodemailer"

const ORIGINS = ["https://shamer36.github.io", "http://localhost:8765", "http://127.0.0.1:8765"]
const COLS = ["places", "artists", "releases", "links", "groups", "edits", "config"]
const LOGIN_RE = /^[A-Za-z0-9_.\-]{3,20}$/
const SESSION_DAYS = 365
const MEDIA_TYPES: Record<string, string> = {
  "image/jpeg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp", "image/gif": "image/gif",
  "video/mp4": "audio/mp4", "audio/mp4": "audio/mp4", "video/webm": "video/webm",
}

const db = () => getStore({ name: "deadlink", consistency: "strong" })
const media = () => getStore({ name: "deadlink-media", consistency: "strong" })

type User = { id: string; login: string; salt: string; hash: string; admin?: boolean; created?: number; email?: string }
type Me = { id: string; name: string; admin: boolean; email: string }

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg) } }

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || ""
  return ORIGINS.includes(o)
    ? { "Access-Control-Allow-Origin": o, "Vary": "Origin", "Access-Control-Allow-Headers": "Authorization, Content-Type, Range", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS", "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length", "Access-Control-Max-Age": "86400" }
    : { "Vary": "Origin" }
}
const json = (req: Request, obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors(req), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } })

function pwHash(pw: string, salt?: string) {
  const s = salt || randomBytes(16).toString("hex")
  return { salt: s, hash: pbkdf2Sync(pw, Buffer.from(s, "hex"), 200000, 32, "sha256").toString("hex") }
}
function pwOk(pw: string, u: User) {
  const a = Buffer.from(pwHash(pw, u.salt).hash, "hex"), b = Buffer.from(u.hash, "hex")
  return a.length === b.length && timingSafeEqual(a, b)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function getUserByLogin(login: string) { return (await db().get("users/" + login.toLowerCase(), { type: "json" })) as User | null }
async function getUserById(id: string) {
  const lo = await db().get("uids/" + id, { type: "text" })
  return lo ? getUserByLogin(lo) : null
}
async function newSession(uid: string) {
  const t = randomBytes(32).toString("base64url")
  await db().setJSON("sess/" + t, { uid, exp: Date.now() + SESSION_DAYS * 864e5 })
  return t
}
function token(req: Request) {
  const m = /^Bearer\s+([A-Za-z0-9_\-]+)$/.exec(req.headers.get("authorization") || "")
  return m ? m[1] : null
}
async function me(req: Request): Promise<Me | null> {
  const t = token(req); if (!t) return null
  const s = (await db().get("sess/" + t, { type: "json" })) as { uid: string; exp: number } | null
  if (!s || s.exp < Date.now()) return null
  const u = await getUserById(s.uid)
  return u ? { id: u.id, name: u.login, admin: !!u.admin, email: u.email || "" } : null
}
async function need(req: Request, admin = false) {
  const m = await me(req)
  if (!m) throw new HttpError(401, "login")
  if (admin && !m.admin) throw new HttpError(403, "Менять общую базу могут только администраторы")
  return m
}
const body = async (req: Request) => { try { return await req.json() } catch { return {} } }

async function readCol(c: string) { return ((await db().get("col/" + c, { type: "json" })) as Record<string, unknown>) || {} }
async function readShelf(uid: string) { return await db().get("shelf/" + uid, { type: "json" }) }

function applyOp(col: Record<string, any>, op: string, id: string, d: any) {
  if (op === "set") col[id] = d
  else if (op === "update") {
    const cur = col[id] || {}
    for (const [k, v] of Object.entries(d || {})) {
      if (v && typeof v === "object" && (v as any).__delete__) delete cur[k]
      else cur[k] = v
    }
    col[id] = cur
  } else if (op === "delete") delete col[id]
  else throw new HttpError(400, "bad op")
}


// ===== Клуб =====
type Item = { a: string; k: string; c: number; t?: string; y?: string; r?: number }
type Listing = { id: string; uid: string; login: string; item: Item; price: number; at: number }
type Trade = { id: string; from: string; fromLogin: string; to: string; toLogin: string; give: Item[]; want: Item[]; sa: number; at: number }
type Fr = { f: string[]; i: string[]; o: string[] }
const now = () => Date.now()
const dayId = (t = now()) => new Date(t + 3 * 36e5).toISOString().slice(0, 10) // сутки по Москве
function weekId(t = now()) {
  const d = new Date(t), u = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())), day = u.getUTCDay() || 7
  u.setUTCDate(u.getUTCDate() + 4 - day)
  const y = u.getUTCFullYear(), w = Math.ceil(((+u - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7)
  return y + "-W" + String(w).padStart(2, "0")
}
const newId = () => randomBytes(6).toString("hex")
const MAX_SET = 5, BATTLES_DAY = 5, FEE = 0.1, MAX_LIST = 10
const PARTY_TIERS: [number, number][] = [[50, 2], [150, 5], [400, 10]]
const TOP_PRIZES: [number, string][] = [[20, "Король сета"], [12, "Второй за пультом"], [6, "Третий за пультом"]]

function cleanItem(x: any): Item | null {
  if (!x || typeof x !== "object") return null
  const a = String(x.a || "").slice(0, 80), k = String(x.k || "").slice(0, 160), c = Math.trunc(+x.c)
  if (!a || !k || !(c >= 0 && c <= 4)) return null
  const it: Item = { a, k, c }
  if (x.t) it.t = String(x.t).slice(0, 120)
  if (x.y) it.y = String(x.y).slice(0, 12)
  const r = Math.trunc(+x.r); if (r >= 0 && r <= 6) it.r = r
  return it
}
const cleanItems = (x: any, max: number) => (Array.isArray(x) ? x : []).slice(0, max).map(cleanItem).filter(Boolean) as Item[]
async function sendGift(uid: string, g: Record<string, unknown>) {
  const id = newId()
  await db().setJSON("gifts/" + uid + "/" + id, { id, sa: 0, dr: 0, at: Math.floor(now() / 1000), ...g })
}
async function lock(key: string) { const r = await db().setJSON("lock/" + key, { at: now() }, { onlyIfNew: true }); return !!(r && (r as any).modified !== false) }
async function listJSON<T>(prefix: string): Promise<T[]> {
  const { blobs } = await db().list({ prefix })
  return ((await Promise.all(blobs.map((b) => db().get(b.key, { type: "json" })))) as T[]).filter(Boolean)
}
async function readFr(uid: string): Promise<Fr> {
  const f = ((await db().get("fr/" + uid, { type: "json" })) as Fr | null) || { f: [], i: [], o: [] }
  return { f: f.f || [], i: f.i || [], o: f.o || [] }
}
const without = (a: string[], x: string) => a.filter((y) => y !== x)
async function likes7(uid: string) {
  const d = ((await db().get("lk/" + uid, { type: "json" })) as Record<string, string> | null) || {}
  const from = dayId(now() - 6 * 864e5)
  return Object.values(d).filter((x) => x >= from).length
}
async function userOr404(login: string) {
  const u = await getUserByLogin(String(login || ""))
  if (!u) throw new HttpError(404, "Нет такого игрока")
  return u
}
async function shelfBalance(uid: string) { const sh = (await readShelf(uid)) as any; return +(sh?.g?.sa) || 0 }

// подводим итоги прошлой недели один раз: призы топу баттлов и участникам вечеринки
async function finalizeWeek() {
  const prev = weekId(now() - 7 * 864e5)
  if (!(await lock("week/" + prev))) return
  const rates = (await listJSON<any>("rate/" + prev + "/")).filter((x) => x.r > 0).sort((a, b) => b.r - a.r || b.w - a.w)
  for (let k = 0; k < Math.min(TOP_PRIZES.length, rates.length); k++) {
    const [dr, title] = TOP_PRIZES[k]
    await sendGift(rates[k].uid, { dr, from: "Клуб", note: `${k + 1} место в баттлах недели ${prev}: «${title}»` })
    await db().setJSON("title/" + rates[k].uid, { t: title, w: prev })
  }
  const party = await listJSON<any>("party/" + prev + "/"), total = party.reduce((s, x) => s + (+x.pw || 0), 0)
  let prize = 0; for (const [need, dr] of PARTY_TIERS) if (total >= need) prize = dr
  if (prize) for (const x of party) await sendGift(x.uid, { dr: prize, from: "Клуб", note: `Вечеринка недели ${prev} набрала ${Math.round(total)} силы` })
}

async function club(req: Request, path: string, method: string): Promise<Response> {
  const m = await need(req)
  const seg = path.slice("/api/club/".length)

  if (seg === "me" && method === "GET") {
    const fr = await readFr(m.id)
    const names = async (ids: string[]) => (await Promise.all(ids.map(getUserById))).filter(Boolean).map((u) => (u as User).login)
    const trades = await listJSON<Trade>("tr/")
    const title = (await db().get("title/" + m.id, { type: "json" })) as any
    return json(req, { login: m.name, friends: await names(fr.f), in: await names(fr.i), out: await names(fr.o), likes7: await likes7(m.id),
      tradesIn: trades.filter((t) => t.to === m.id).length, title: title && title.w === weekId(now() - 7 * 864e5) ? title.t : "", week: weekId() })
  }

  if (seg === "players" && method === "GET") {
    const fr = await readFr(m.id)
    const users = await listJSON<User>("users/")
    const out = await Promise.all(users.map(async (u) => {
      const sh = ((await readShelf(u.id)) || {}) as any, g = sh.g || {}
      const set = (await db().get("bset/" + u.id, { type: "json" })) as any
      return { login: u.login, arts: (sh.b || []).length, rels: Object.keys(g.cp || {}).length, likes7: await likes7(u.id), pw: set ? set.pw : 0,
        st: u.id === m.id ? "self" : fr.f.includes(u.id) ? "friend" : fr.o.includes(u.id) ? "out" : fr.i.includes(u.id) ? "in" : "none" }
    }))
    out.sort((a, b) => b.likes7 - a.likes7 || a.login.toLowerCase().localeCompare(b.login.toLowerCase()))
    return json(req, { players: out })
  }

  let mm = /^u\/([A-Za-z0-9_.\-]{3,20})$/.exec(seg)
  if (mm && method === "GET") {
    const u = await userOr404(mm[1]), sh = ((await readShelf(u.id)) || {}) as any, g = sh.g || {}, fr = await readFr(m.id)
    const lk = ((await db().get("lk/" + u.id, { type: "json" })) as Record<string, string> | null) || {}
    const title = (await db().get("title/" + u.id, { type: "json" })) as any
    const bd: Record<string, unknown> = {}
    Object.entries<any>(g.dist?.b || {}).forEach(([id, b]) => { bd[id] = { cell: b.cell, lv: b.lv || 0, tgt: b.tgt || 0, bt: b.bt || 0, last: 0 } })
    return json(req, { login: u.login, created: u.created || 0, b: sh.b || [], cp: g.cp || {}, rl: g.rl || {}, sh: g.dist?.sh || [], bd,
      likes7: await likes7(u.id), liked: lk[m.id] === dayId(), bset: await db().get("bset/" + u.id, { type: "json" }),
      title: title && title.w === weekId(now() - 7 * 864e5) ? title.t : "",
      st: u.id === m.id ? "self" : fr.f.includes(u.id) ? "friend" : fr.o.includes(u.id) ? "out" : fr.i.includes(u.id) ? "in" : "none" })
  }

  if (seg === "friend" && method === "POST") {
    const q = await body(req), u = await userOr404(q.login), act = String(q.act || "")
    if (u.id === m.id) throw new HttpError(400, "Это ты")
    const a = await readFr(m.id), b = await readFr(u.id)
    if (act === "add") {
      if (a.f.includes(u.id)) return json(req, { st: "friend" })
      if (a.i.includes(u.id)) { a.i = without(a.i, u.id); b.o = without(b.o, m.id); a.f.push(u.id); b.f.push(m.id) }
      else { if (!a.o.includes(u.id)) a.o.push(u.id); if (!b.i.includes(m.id)) b.i.push(m.id) }
    } else if (act === "remove") {
      a.f = without(a.f, u.id); a.i = without(a.i, u.id); a.o = without(a.o, u.id)
      b.f = without(b.f, m.id); b.i = without(b.i, m.id); b.o = without(b.o, m.id)
    } else throw new HttpError(400, "bad act")
    await db().setJSON("fr/" + m.id, a); await db().setJSON("fr/" + u.id, b)
    return json(req, { st: a.f.includes(u.id) ? "friend" : a.o.includes(u.id) ? "out" : "none" })
  }

  if (seg === "like" && method === "POST") {
    const q = await body(req), u = await userOr404(q.login)
    if (u.id === m.id) throw new HttpError(400, "Себя лайкать нельзя")
    const d = ((await db().get("lk/" + u.id, { type: "json" })) as Record<string, string> | null) || {}
    if (d[m.id] === dayId()) throw new HttpError(409, "Сегодня ты уже лайкал этот блок")
    d[m.id] = dayId(); await db().setJSON("lk/" + u.id, d)
    return json(req, { likes7: await likes7(u.id) })
  }

  // барахолка
  if (seg === "market" && method === "GET") {
    const L = await listJSON<Listing>("mk/"); L.sort((a, b) => b.at - a.at)
    return json(req, { listings: L, fee: FEE })
  }
  if (seg === "market/list" && method === "POST") {
    const q = await body(req), item = cleanItem(q.item), price = Math.trunc(+q.price)
    if (!item) throw new HttpError(400, "Не та пластинка")
    if (!(price >= 1 && price <= 1e6)) throw new HttpError(400, "Цена от 1 до 1 000 000 соуса")
    const mine = (await listJSON<Listing>("mk/")).filter((x) => x.uid === m.id)
    if (mine.length >= MAX_LIST) throw new HttpError(400, "На барахолке можно держать не больше " + MAX_LIST + " пластинок")
    const L: Listing = { id: newId(), uid: m.id, login: m.name, item, price, at: now() }
    await db().setJSON("mk/" + L.id, L)
    return json(req, { listing: L })
  }
  if ((seg === "market/buy" || seg === "market/cancel") && method === "POST") {
    const q = await body(req), id = String(q.id || "").replace(/[^0-9a-f]/g, "")
    const L = (await db().get("mk/" + id, { type: "json" })) as Listing | null
    if (!L) throw new HttpError(404, "Лот уже снят или продан")
    if (seg === "market/buy") {
      if (L.uid === m.id) throw new HttpError(400, "Это твой лот")
      if ((await shelfBalance(m.id)) < L.price) throw new HttpError(400, "Не хватает соуса")
    } else if (L.uid !== m.id && !m.admin) throw new HttpError(403, "Это не твой лот")
    if (!(await lock("mk/" + id))) throw new HttpError(409, "Лот уже снят или продан")
    await db().delete("mk/" + id)
    const name = (L.item.t ? L.item.t + " - " : "") + L.item.a
    if (seg === "market/buy") {
      const fee = Math.ceil(L.price * FEE)
      await sendGift(m.id, { sa: -L.price, rec: [L.item], from: "Барахолка", note: `покупка у ${L.login}: ${name}` })
      await sendGift(L.uid, { sa: L.price - fee, from: "Барахолка", note: `${m.name} купил ${name} за ${L.price}, комиссия ${fee}` })
    } else await sendGift(L.uid, { rec: [L.item], from: "Барахолка", note: `снято с продажи: ${name}` })
    return json(req, { ok: true })
  }

  // обмен с друзьями
  if (seg === "trades" && method === "GET") {
    const T = (await listJSON<Trade>("tr/")).filter((t) => t.from === m.id || t.to === m.id); T.sort((a, b) => b.at - a.at)
    return json(req, { trades: T })
  }
  if (seg === "trade" && method === "POST") {
    const q = await body(req), u = await userOr404(q.to), give = cleanItems(q.give, MAX_SET), want = cleanItems(q.want, MAX_SET), sa = Math.max(0, Math.trunc(+q.sa || 0))
    if (u.id === m.id) throw new HttpError(400, "Это ты")
    if (!(await readFr(m.id)).f.includes(u.id)) throw new HttpError(403, "Меняться можно только с друзьями")
    if (!give.length && !sa) throw new HttpError(400, "Предложи что-нибудь взамен")
    if (!want.length) throw new HttpError(400, "Выбери, что хочешь получить")
    if (sa > 1e6 || (sa && (await shelfBalance(m.id)) < sa)) throw new HttpError(400, "Не хватает соуса")
    const t: Trade = { id: newId(), from: m.id, fromLogin: m.name, to: u.id, toLogin: u.login, give, want, sa, at: now() }
    await db().setJSON("tr/" + t.id, t)
    return json(req, { trade: t })
  }
  if ((seg === "trade/accept" || seg === "trade/cancel") && method === "POST") {
    const q = await body(req), id = String(q.id || "").replace(/[^0-9a-f]/g, "")
    const t = (await db().get("tr/" + id, { type: "json" })) as Trade | null
    if (!t) throw new HttpError(404, "Обмен уже закрыт")
    if (seg === "trade/accept" ? t.to !== m.id : t.to !== m.id && t.from !== m.id) throw new HttpError(403, "Это не твой обмен")
    if (!(await lock("tr/" + id))) throw new HttpError(409, "Обмен уже закрыт")
    await db().delete("tr/" + id)
    if (seg === "trade/accept") {
      await sendGift(t.to, { rec: t.give, sa: t.sa, from: t.fromLogin, note: "обмен состоялся" })
      await sendGift(t.from, { rec: t.want, from: t.toLogin, note: "обмен состоялся" })
    } else await sendGift(t.from, { rec: t.give, sa: t.sa, from: "Клуб", note: t.from === m.id ? "ты отменил обмен" : `${t.toLogin} отказался от обмена` })
    return json(req, { ok: true })
  }

  // DJ-баттлы
  if (seg === "set" && method === "POST") {
    const q = await body(req), items = cleanItems(q.items, MAX_SET), pw = Math.max(0, Math.min(2000, +q.pw || 0))
    if (items.length < MAX_SET) throw new HttpError(400, "В сете должно быть 5 пластинок")
    const s = { uid: m.id, login: m.name, items, pw: Math.round(pw * 10) / 10, at: now() }
    await db().setJSON("bset/" + m.id, s)
    return json(req, { set: s })
  }
  if (seg === "battle" && method === "GET") {
    await finalizeWeek()
    const w = weekId(), sets = await listJSON<any>("bset/"), rates = await listJSON<any>("rate/" + w + "/")
    const mr = rates.find((x) => x.uid === m.id) || { r: 0, w: 0, l: 0, day: "", n: 0 }
    rates.sort((a, b) => b.r - a.r || b.w - a.w)
    return json(req, { week: w, mine: sets.find((x) => x.uid === m.id) || null, opps: sets.filter((x) => x.uid !== m.id).map((x) => ({ login: x.login, pw: x.pw, items: x.items })),
      rate: mr, left: BATTLES_DAY - (mr.day === dayId() ? mr.n : 0), top: rates.slice(0, 10).map((x) => ({ login: x.login, r: x.r, w: x.w, l: x.l })), prizes: TOP_PRIZES })
  }
  if (seg === "battle" && method === "POST") {
    const q = await body(req), u = await userOr404(q.login)
    if (u.id === m.id) throw new HttpError(400, "С собой не баттлят")
    const a = (await db().get("bset/" + m.id, { type: "json" })) as any, b = (await db().get("bset/" + u.id, { type: "json" })) as any
    if (!a) throw new HttpError(400, "Сначала собери свой сет")
    if (!b) throw new HttpError(400, "У соперника нет сета")
    const w = weekId(), key = "rate/" + w + "/" + m.id
    const r = ((await db().get(key, { type: "json" })) as any) || { uid: m.id, login: m.name, r: 0, w: 0, l: 0, day: "", n: 0 }
    if (r.day !== dayId()) { r.day = dayId(); r.n = 0 }
    if (r.n >= BATTLES_DAY) throw new HttpError(429, "На сегодня баттлы кончились, приходи завтра")
    const ra = Math.round(a.pw * (0.85 + Math.random() * 0.3) * 10) / 10, rb = Math.round(b.pw * (0.85 + Math.random() * 0.3) * 10) / 10
    const win = ra >= rb, delta = win ? 20 + Math.max(0, Math.min(20, Math.round((b.pw - a.pw) / 10))) : -10
    r.r = Math.max(0, r.r + delta); r.n++; if (win) r.w++; else r.l++; r.login = m.name
    await db().setJSON(key, r)
    return json(req, { win, me: ra, them: rb, delta, rate: r, left: BATTLES_DAY - r.n, opp: { login: u.login, items: b.items, pw: b.pw } })
  }

  // вечеринка недели
  if (seg === "party" && method === "GET") {
    await finalizeWeek()
    const w = weekId(), L = await listJSON<any>("party/" + w + "/")
    return json(req, { week: w, total: Math.round(L.reduce((s, x) => s + (+x.pw || 0), 0) * 10) / 10, list: L.map((x) => ({ login: x.login, item: x.item, pw: x.pw })),
      mine: L.find((x) => x.uid === m.id) || null, tiers: PARTY_TIERS })
  }
  if (seg === "party" && method === "POST") {
    const q = await body(req), item = cleanItem(q.item), pw = Math.max(0, Math.min(200, +q.pw || 0))
    if (!item) throw new HttpError(400, "Не та пластинка")
    const w = weekId(), r = await db().setJSON("party/" + w + "/" + m.id, { uid: m.id, login: m.name, item, pw: Math.round(pw * 10) / 10, at: now() }, { onlyIfNew: true })
    if ((r as any)?.modified === false) throw new HttpError(409, "На этой неделе ты уже принёс пластинку")
    return json(req, { ok: true })
  }

  throw new HttpError(404, "not found")
}


// ===== Почта и коды =====
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/
const normEmail = (e: unknown) => String(e || "").trim().toLowerCase()
const pub = (u: User) => ({ id: u.id, name: u.login, admin: !!u.admin, email: u.email || "" })
const codeHash = (email: string, code: string) => createHash("sha256").update(email + ":" + code).digest("hex")
async function getUserByEmail(email: string) {
  const lo = await db().get("emails/" + email, { type: "text" })
  return lo ? getUserByLogin(lo) : null
}
async function sendMail(to: string, subject: string, text: string) {
  const user = Netlify.env.get("GMAIL_USER"), pass = Netlify.env.get("GMAIL_APP_PASSWORD")
  if (!user || !pass) {
    if (Netlify.env.get("DEV_MAIL_LOG")) { console.log("MAIL to " + to + ": " + text); return }
    throw new HttpError(503, "Отправка писем ещё не настроена")
  }
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user, pass: pass.replace(/\s+/g, "") } })
  await t.sendMail({ from: `"Deadlink" <${user}>`, to, subject, text })
}
// purpose: reg — регистрация, reset — новый пароль, link — добавить почту к аккаунту
async function issueCode(email: string, p: string) {
  const k = "codes/" + email, now = Date.now()
  const old = (await db().get(k, { type: "json" })) as any
  const hw = old && now - old.hw < 36e5 ? old.hw : now, n = old && hw === old.hw ? old.n : 0
  if (old && now - old.sent < 60e3) throw new HttpError(429, "Код уже отправлен. Новый можно запросить через минуту.")
  if (n >= 6) throw new HttpError(429, "Слишком много кодов за час. Попробуй позже.")
  const code = String(randomInt(0, 1e6)).padStart(6, "0")
  await db().setJSON(k, { h: codeHash(email, code), p, exp: now + 15 * 60e3, tries: 0, sent: now, hw, n: n + 1 })
  const what = p === "reg" ? "регистрации" : p === "reset" ? "смены пароля" : "подтверждения почты"
  await sendMail(email, `Deadlink: код ${code}`, `Твой код для ${what} на Deadlink: ${code}\n\nОн действует 15 минут. Если ты ничего не запрашивал, просто удали это письмо.\n\nhttps://shamer36.github.io/deadlink/`)
}
async function useCode(email: string, p: string, code: string) {
  const k = "codes/" + email, c = (await db().get(k, { type: "json" })) as any
  if (!c || c.p !== p || c.exp < Date.now()) throw new HttpError(400, "Код устарел. Запроси новый.")
  if (c.tries >= 5) throw new HttpError(429, "Слишком много неверных попыток. Запроси новый код.")
  const a = Buffer.from(c.h, "hex"), b = Buffer.from(codeHash(email, String(code || "").replace(/\D/g, "")), "hex")
  if (a.length !== b.length || !timingSafeEqual(a, b)) { c.tries++; await db().setJSON(k, c); await sleep(500); throw new HttpError(400, "Неверный код") }
  await db().delete(k)
}

async function route(req: Request, path: string, ctx: Context): Promise<Response> {
  const method = req.method
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) })

  // --- аккаунты ---
  if (path === "/api/me" && method === "GET") return json(req, { user: await me(req) })

  if (path === "/api/auth/code" && method === "POST") {
    const q = await body(req), email = normEmail(q.email), p = String(q.p || "")
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Проверь адрес почты")
    if (!["reg", "reset", "link"].includes(p)) throw new HttpError(400, "bad purpose")
    const owner = await getUserByEmail(email)
    if (p === "link") { const m = await need(req); if (owner && owner.id !== m.id) throw new HttpError(409, "Эта почта уже привязана к другому аккаунту") }
    if (p === "reg" && owner) throw new HttpError(409, "Эта почта уже зарегистрирована. Войди или восстанови пароль.")
    if (p === "reset" && !owner) { await sleep(400); return json(req, { ok: true }) } // не выдаём, есть ли такая почта
    await issueCode(email, p)
    return json(req, { ok: true })
  }

  if (path === "/api/register" && method === "POST") {
    const q = await body(req), email = normEmail(q.email), login = String(q.login || "").trim(), pw = String(q.password || "")
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Проверь адрес почты")
    if (!LOGIN_RE.test(login)) throw new HttpError(400, "Ник: от 3 до 20 символов, латиница, цифры, _ . -")
    if (pw.length < 6) throw new HttpError(400, "Пароль должен быть не короче 6 символов")
    if (await getUserByEmail(email)) throw new HttpError(409, "Эта почта уже зарегистрирована")
    if (await getUserByLogin(login)) throw new HttpError(409, "Такой ник уже занят")
    await useCode(email, "reg", q.code)
    const id = randomBytes(6).toString("hex"), key = login.toLowerCase()
    const u: User = { id, login, ...pwHash(pw), admin: false, created: Math.floor(Date.now() / 1000), email }
    const r = await db().setJSON("users/" + key, u, { onlyIfNew: true })
    if (!r.modified) throw new HttpError(409, "Такой ник уже занят")
    await db().set("uids/" + id, key); await db().set("emails/" + email, key)
    return json(req, { ok: true, token: await newSession(id), user: pub(u) })
  }

  if (path === "/api/login" && method === "POST") {
    const q = await body(req), ident = String(q.login || q.email || "").trim(), pw = String(q.password || "")
    const key = ident.toLowerCase()
    const f = ((await db().get("fails/" + key, { type: "json" })) as [number, number]) || [0, 0]
    if (f[1] > Date.now()) throw new HttpError(429, "Слишком много попыток. Подожди пару минут.")
    const u = ident.includes("@") ? await getUserByEmail(normEmail(ident)) : await getUserByLogin(ident)
    if (!u || !pwOk(pw, u)) {
      f[0] += 1
      await db().setJSON("fails/" + key, f[0] >= 8 ? [0, Date.now() + 300000] : f)
      await sleep(700)
      throw new HttpError(401, "Неверная почта или пароль")
    }
    await db().delete("fails/" + key)
    return json(req, { ok: true, token: await newSession(u.id), user: pub(u) })
  }

  if (path === "/api/auth/reset" && method === "POST") {
    const q = await body(req), email = normEmail(q.email), pw = String(q.password || "")
    if (pw.length < 6) throw new HttpError(400, "Пароль должен быть не короче 6 символов")
    const u = await getUserByEmail(email)
    if (!u) throw new HttpError(400, "Неверный код")
    await useCode(email, "reset", q.code)
    Object.assign(u, pwHash(pw)); await db().setJSON("users/" + u.login.toLowerCase(), u)
    await db().delete("fails/" + email); await db().delete("fails/" + u.login.toLowerCase())
    return json(req, { ok: true, token: await newSession(u.id), user: pub(u) })
  }

  if (path === "/api/auth/email" && method === "POST") {
    const m = await need(req), q = await body(req), email = normEmail(q.email)
    if (!EMAIL_RE.test(email)) throw new HttpError(400, "Проверь адрес почты")
    const owner = await getUserByEmail(email)
    if (owner && owner.id !== m.id) throw new HttpError(409, "Эта почта уже привязана к другому аккаунту")
    await useCode(email, "link", q.code)
    const u = (await getUserById(m.id))!, key = u.login.toLowerCase()
    if (u.email && u.email !== email) await db().delete("emails/" + u.email)
    u.email = email; await db().setJSON("users/" + key, u); await db().set("emails/" + email, key)
    return json(req, { ok: true, user: pub(u) })
  }

  if (path === "/api/logout" && method === "POST") {
    const t = token(req); if (t) await db().delete("sess/" + t)
    return json(req, { ok: true })
  }

  if (path === "/api/password" && method === "POST") {
    const m = await need(req), q = await body(req)
    const u = (await getUserById(m.id))!
    if (!pwOk(String(q.old || ""), u)) { await sleep(700); throw new HttpError(401, "Старый пароль неверный") }
    const nw = String(q.new || "")
    if (nw.length < 6) throw new HttpError(400, "Новый пароль должен быть не короче 6 символов")
    Object.assign(u, pwHash(nw))
    await db().setJSON("users/" + u.login.toLowerCase(), u)
    return json(req, { ok: true })
  }

  // --- база ---
  if (path === "/api/db" && method === "GET") {
    const m = await need(req)
    const out: Record<string, unknown> = {}
    const cols = await Promise.all(COLS.map(readCol))
    COLS.forEach((c, i) => (out[c] = cols[i]))
    const sh = await readShelf(m.id)
    out["data/users/" + m.id] = sh ? { shelf: sh } : {}
    return json(req, out)
  }

  if (path === "/api/db" && method === "POST") {
    const q = await body(req), c = String(q.c || ""), id = String(q.id || ""), op = String(q.op || "")
    if (!c || !id) throw new HttpError(400, "bad op")
    if (c.startsWith("data/users/")) {
      const m = await need(req)
      if (c !== "data/users/" + m.id || id !== "shelf") throw new HttpError(403, "forbidden")
      const doc: Record<string, any> = { shelf: (await readShelf(m.id)) || {} }
      applyOp(doc, op, "shelf", q.d)
      if (doc.shelf === undefined) await db().delete("shelf/" + m.id)
      else await db().setJSON("shelf/" + m.id, doc.shelf)
      return json(req, { ok: true })
    }
    if (!COLS.includes(c)) throw new HttpError(400, "unknown collection")
    await need(req, true)
    const col = await readCol(c)
    applyOp(col, op, id, q.d)
    await db().setJSON("col/" + c, col)
    return json(req, { ok: true })
  }

  // --- подарки ---
  if (path === "/api/gifts" && method === "GET") {
    const m = await need(req)
    const { blobs } = await db().list({ prefix: "gifts/" + m.id + "/" })
    const gifts = (await Promise.all(blobs.map((b) => db().get(b.key, { type: "json" })))).filter(Boolean)
    return json(req, { gifts })
  }
  if (path === "/api/gifts/claim" && method === "POST") {
    const m = await need(req), q = await body(req)
    const ids: string[] = Array.isArray(q.ids) ? q.ids.map(String) : []
    const got = []
    for (const gid of ids) {
      const k = "gifts/" + m.id + "/" + gid
      const g = await db().get(k, { type: "json" })
      if (g) { await db().delete(k); got.push(g) }
    }
    return json(req, { gifts: got })
  }
  if (path === "/api/admin/users" && method === "GET") {
    await need(req, true)
    const { blobs } = await db().list({ prefix: "users/" })
    const users = await Promise.all(blobs.map(async (b) => {
      const u = (await db().get(b.key, { type: "json" })) as User
      const sh = ((await readShelf(u.id)) || {}) as any, g = sh.g || {}
      const { blobs: gb } = await db().list({ prefix: "gifts/" + u.id + "/" })
      const pend = (await Promise.all(gb.map((x) => db().get(x.key, { type: "json" })))) as any[]
      return { id: u.id, login: u.login, email: u.email || "", admin: !!u.admin, created: u.created || 0, sa: g.sa ?? null, dr: g.dr ?? null,
        pending: [pend.reduce((s, x) => s + (+x?.sa || 0), 0), pend.reduce((s, x) => s + (+x?.dr || 0), 0)] }
    }))
    users.sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()))
    return json(req, { users })
  }
  if (path === "/api/admin/gift" && method === "POST") {
    const m = await need(req, true), q = await body(req)
    const sa = Math.trunc(+q.sa || 0), dr = Math.trunc(+q.dr || 0)
    const fin = Array.isArray(q.fin) ? q.fin.map(String).filter((x: string) => /^[a-z]{2,12}$/.test(x)).slice(0, 20) : []
    if (sa < 0 || dr < 0 || sa > 1e6 || dr > 1e5 || (!sa && !dr && !fin.length)) throw new HttpError(400, "Укажи, что выдать")
    const uid = String(q.uid || "")
    if (!(await getUserById(uid))) throw new HttpError(404, "Нет такого игрока")
    const g: Record<string, unknown> = { id: randomBytes(5).toString("hex"), sa, dr, from: m.name, note: String(q.note || "").slice(0, 120), at: Math.floor(Date.now() / 1000) }
    if (fin.length) g.fin = fin
    await db().setJSON("gifts/" + uid + "/" + g.id, g)
    return json(req, { ok: true, gift: g })
  }

  // --- клуб: профили, друзья, лайки, барахолка, обмен, баттлы, вечеринки ---
  if (path.startsWith("/api/club/")) return await club(req, path, method)

  // --- загрузки ---
  if (path === "/api/upload" && method === "POST") {
    await need(req, true)
    const type = new URL(req.url).searchParams.get("type") || ""
    const ct = MEDIA_TYPES[type]
    if (!ct) throw new HttpError(400, "unsupported type")
    const buf = await req.arrayBuffer()
    if (buf.byteLength > 4 * 1048576) throw new HttpError(413, "Файл больше 4 МБ")
    const id = randomUUID().replace(/-/g, "")
    await media().set(id, buf, { metadata: { type: ct } })
    return json(req, { id, url: "/_blob/" + id })
  }
  let mm = /^\/api\/asset\/([0-9a-f]{32})$/.exec(path)
  if (mm && method === "DELETE") { await need(req, true); await media().delete(mm[1]); return json(req, { ok: true }) }
  mm = /^\/api\/blob\/([0-9a-f]{32})$/.exec(path)
  if (mm && method === "GET") {
    const r = await media().getWithMetadata(mm[1], { type: "arrayBuffer" })
    if (!r) return new Response("not found", { status: 404, headers: cors(req) })
    const data = new Uint8Array(r.data as ArrayBuffer), size = data.byteLength
    const h: Record<string, string> = { ...cors(req), "Content-Type": String((r.metadata as any)?.type || "application/octet-stream"), "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=86400" }
    const rg = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") || "")
    if (rg && (rg[1] || rg[2])) {
      let s = rg[1] ? +rg[1] : size - +rg[2], e = rg[1] && rg[2] ? Math.min(+rg[2], size - 1) : size - 1
      if (s >= size) return new Response(null, { status: 416, headers: { ...h, "Content-Range": `bytes */${size}` } })
      return new Response(data.slice(s, e + 1), { status: 206, headers: { ...h, "Content-Range": `bytes ${s}-${e}/${size}` } })
    }
    return new Response(data, { headers: h })
  }

  // --- одноразовый перенос данных с компа ---
  if (path === "/api/admin/import" && method === "POST") {
    const secret = Netlify.env.get("IMPORT_TOKEN")
    if (!secret || req.headers.get("x-import-token") !== secret) throw new HttpError(403, "forbidden")
    const q = await body(req)
    const dbj = q.db || {}, acc = q.accounts || { users: {} }
    let n = 0
    for (const c of COLS) if (dbj[c]) { await db().setJSON("col/" + c, dbj[c]); n++ }
    for (const [uid, u] of Object.entries<any>(acc.users || {})) {
      const key = String(u.login).toLowerCase()
      await db().setJSON("users/" + key, { id: uid, login: u.login, salt: u.salt, hash: u.hash, admin: !!u.admin, created: u.created || 0 })
      await db().set("uids/" + uid, key)
      const sh = dbj["data/users/" + uid]?.shelf
      if (sh) await db().setJSON("shelf/" + uid, sh)
      n++
    }
    for (const [uid, list] of Object.entries<any>(dbj.gifts || {}))
      for (const g of list) await db().setJSON("gifts/" + uid + "/" + g.id, g)
    return json(req, { ok: true, written: n })
  }

  return json(req, { error: "not found" }, 404)
}

export default async (req: Request, context: Context) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, "")
  try {
    return await route(req, path, context)
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status)
    console.error(e)
    return json(req, { error: "Ошибка сервера" }, 500)
  }
}

export const config: Config = { path: "/api/*" }
