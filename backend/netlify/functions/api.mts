// Deadlink API: аккаунты, общая база, полки, подарки, загрузки.
// Сайт живёт на GitHub Pages, сюда ходит только за данными.
import { getStore } from "@netlify/blobs"
import type { Config, Context } from "@netlify/functions"
import { pbkdf2Sync, randomBytes, timingSafeEqual, randomUUID } from "node:crypto"

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

type User = { id: string; login: string; salt: string; hash: string; admin?: boolean; created?: number }
type Me = { id: string; name: string; admin: boolean }

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
  return u ? { id: u.id, name: u.login, admin: !!u.admin } : null
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

async function route(req: Request, path: string, ctx: Context): Promise<Response> {
  const method = req.method
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) })

  // --- аккаунты ---
  if (path === "/api/me" && method === "GET") return json(req, { user: await me(req) })

  if ((path === "/api/register" || path === "/api/login") && method === "POST") {
    const q = await body(req)
    const login = String(q.login || "").trim(), pw = String(q.password || "")
    const key = login.toLowerCase()
    if (path === "/api/register") {
      if (!LOGIN_RE.test(login)) throw new HttpError(400, "Логин: от 3 до 20 символов, латиница, цифры, _ . -")
      if (pw.length < 6) throw new HttpError(400, "Пароль должен быть не короче 6 символов")
      const id = randomBytes(6).toString("hex")
      const u: User = { id, login, ...pwHash(pw), admin: false, created: Math.floor(Date.now() / 1000) }
      const r = await db().setJSON("users/" + key, u, { onlyIfNew: true })
      if (!r.modified) throw new HttpError(409, "Такой логин уже занят")
      await db().set("uids/" + id, key)
      return json(req, { ok: true, token: await newSession(id), user: { id, name: login, admin: false } })
    }
    const f = ((await db().get("fails/" + key, { type: "json" })) as [number, number]) || [0, 0]
    if (f[1] > Date.now()) throw new HttpError(429, "Слишком много попыток. Подожди пару минут.")
    const u = await getUserByLogin(login)
    if (!u || !pwOk(pw, u)) {
      f[0] += 1
      await db().setJSON("fails/" + key, f[0] >= 8 ? [0, Date.now() + 300000] : f)
      await sleep(700)
      throw new HttpError(401, "Неверный логин или пароль")
    }
    await db().delete("fails/" + key)
    return json(req, { ok: true, token: await newSession(u.id), user: { id: u.id, name: u.login, admin: !!u.admin } })
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
      return { id: u.id, login: u.login, admin: !!u.admin, created: u.created || 0, sa: g.sa ?? null, dr: g.dr ?? null,
        pending: [pend.reduce((s, x) => s + (+x?.sa || 0), 0), pend.reduce((s, x) => s + (+x?.dr || 0), 0)] }
    }))
    users.sort((a, b) => a.login.toLowerCase().localeCompare(b.login.toLowerCase()))
    return json(req, { users })
  }
  if (path === "/api/admin/gift" && method === "POST") {
    const m = await need(req, true), q = await body(req)
    const sa = Math.trunc(+q.sa || 0), dr = Math.trunc(+q.dr || 0)
    if (sa < 0 || dr < 0 || sa > 1e6 || dr > 1e5 || (!sa && !dr)) throw new HttpError(400, "Укажи, сколько выдать")
    const uid = String(q.uid || "")
    if (!(await getUserById(uid))) throw new HttpError(404, "Нет такого игрока")
    const g = { id: randomBytes(5).toString("hex"), sa, dr, from: m.name, note: String(q.note || "").slice(0, 120), at: Math.floor(Date.now() / 1000) }
    await db().setJSON("gifts/" + uid + "/" + g.id, g)
    return json(req, { ok: true, gift: g })
  }

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
