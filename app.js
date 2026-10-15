// Disk Dourado Artes — aplicativo principal
import { auth, db, firebaseConfig } from "./firebase-config.js";
import {
  onAuthStateChanged, signInWithEmailAndPassword, signInAnonymously, signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy, writeBatch,
  serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// false = abre direto na tela inicial (acesso anônimo do Firebase, sem tela de login).
// true  = exige e-mail/senha de administrador (veja README, seção "Voltar a exigir login").
const REQUIRE_LOGIN = false;

/* =========================================================
 * Utilidades
 * ======================================================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : typeof t === "number" ? t : 0);
const fmtDate = (t) => (ms(t) ? new Date(ms(t)).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtSize = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const safeName = (s) => (String(s || "arte").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim().slice(0, 80) || "arte");
const MAX_BYTES = 10 * 1024 * 1024;
// O PNG original é guardado no Firestore em partes (limite de 1 MiB por documento).
// 570 000 bytes (múltiplo de 3) viram 760 000 caracteres base64 por parte.
const CHUNK = 570000;
const chunkId = (i) => String(i).padStart(4, "0");
const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

function toast(msg, type = "info", time = 4200) {
  const t = document.createElement("div");
  t.className = "toast " + type;
  t.textContent = msg;
  $("#toasts").append(t);
  setTimeout(() => t.remove(), time);
}

function friendly(e) {
  const c = e?.code || "";
  if (c === "permission-denied")
    return "Sem permissão. Publique as regras do Firestore do README e confirme que o login Anônimo está ativado no Firebase Authentication.";
  if (c === "unavailable" || !navigator.onLine)
    return "Sem conexão com a internet. Tente novamente quando estiver online.";
  if (c === "app/upload-stalled")
    return "O envio demorou demais e foi interrompido. Verifique a internet e tente de novo. Se persistir, confira se as regras novas do Firestore foram publicadas.";
  if (c === "resource-exhausted")
    return "A cota gratuita diária do Firestore foi atingida. Tente de novo amanhã ou veja o uso no console do Firebase.";
  return e?.message || "Erro inesperado.";
}

/* =========================================================
 * Modais
 * ======================================================= */
function modal(title, body, { wide = false, onClose } = {}) {
  const bd = document.createElement("div");
  bd.className = "modal-backdrop";
  bd.innerHTML = `<div class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-body">${body}</div></div>`;
  document.body.append(bd);
  document.body.classList.add("no-scroll");
  const api = {
    el: bd,
    body: $(".modal-body", bd),
    close() {
      if (!bd.isConnected) return;
      bd.remove();
      if (!$(".modal-backdrop")) document.body.classList.remove("no-scroll");
      onClose?.();
    },
  };
  bd.addEventListener("click", (e) => {
    if (e.target === bd || e.target.closest("[data-close]")) api.close();
  });
  return api;
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const all = $$(".modal-backdrop");
    all[all.length - 1]?.querySelector("[data-close]")?.click();
  }
});

function confirmDialog({ title, message, confirmLabel = "Confirmar", danger = false }) {
  return new Promise((resolve) => {
    const m = modal(title, `<p>${message}</p><div class="modal-actions">
      <button class="btn ghost" data-close>Cancelar</button>
      <button class="btn ${danger ? "danger solid" : "gold"}" data-ok>${esc(confirmLabel)}</button></div>`, { onClose: () => resolve(false) });
    $("[data-ok]", m.el).onclick = () => { resolve(true); m.close(); };
  });
}

function formModal({ title, fields, submitLabel = "Salvar", onSubmit }) {
  const inputs = fields.map((f) => {
    let control;
    if (f.type === "select") {
      control = `<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value)}" ${o.value === f.value ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>`;
    } else if (f.type === "textarea") {
      control = `<textarea name="${f.name}" rows="3" maxlength="${f.max || 300}" placeholder="${esc(f.placeholder || "")}">${esc(f.value || "")}</textarea>`;
    } else {
      control = `<input name="${f.name}" type="text" value="${esc(f.value || "")}" maxlength="${f.max || 80}" placeholder="${esc(f.placeholder || "")}" autocomplete="off" ${f.required ? "required" : ""}>`;
    }
    return `<label class="field"><span>${esc(f.label)}</span>${control}</label>`;
  }).join("");
  const m = modal(title, `<form class="form" novalidate>${inputs}<p class="form-error" hidden></p>
    <div class="modal-actions"><button type="button" class="btn ghost" data-close>Cancelar</button>
    <button type="submit" class="btn gold">${esc(submitLabel)}</button></div></form>`);
  const form = $("form", m.el);
  const err = $(".form-error", m.el);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    for (const f of fields) {
      if (typeof values[f.name] === "string") values[f.name] = values[f.name].trim();
      if (f.required && !values[f.name]) { err.textContent = `Preencha: ${f.label}.`; err.hidden = false; return; }
    }
    const btn = $("[type=submit]", form);
    btn.disabled = true; err.hidden = true;
    try { await onSubmit(values); m.close(); }
    catch (ex) { err.textContent = friendly(ex); err.hidden = false; btn.disabled = false; }
  });
  setTimeout(() => $("input,textarea", m.el)?.focus(), 50);
  return m;
}

function progressModal(title) {
  const m = modal(title, `<p id="pmText">Preparando…</p><div class="bar"><i id="pmBar"></i></div>`);
  return {
    set(text, pct) {
      if (!m.el.isConnected) return;
      $("#pmText", m.el).textContent = text;
      if (pct != null) $("#pmBar", m.el).style.width = Math.round(pct * 100) + "%";
    },
    close: m.close,
  };
}

/* =========================================================
 * IndexedDB — artes salvas para uso offline
 * ======================================================= */
const idb = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const r = indexedDB.open("dda-offline", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("blobs");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return this._db;
  },
  async tx(mode, fn) {
    const d = await this.open();
    return new Promise((res, rej) => {
      const t = d.transaction("blobs", mode);
      const req = fn(t.objectStore("blobs"));
      t.oncomplete = () => res(req?.result);
      t.onerror = () => rej(t.error);
    });
  },
  get: (k) => idb.tx("readonly", (s) => s.get(k)),
  set: (k, v) => idb.tx("readwrite", (s) => s.put(v, k)),
  del: (k) => idb.tx("readwrite", (s) => s.delete(k)),
  keys: () => idb.tx("readonly", (s) => s.getAllKeys()),
};
const offlineIds = new Set();

/* =========================================================
 * Estado e dados em tempo real
 * ======================================================= */
const state = {
  user: null,
  cats: [], prods: [], arts: [],
  loaded: { c: false, p: false, a: false },
  sort: { prod: "name-asc", art: "date-desc" },
  loadError: null,
};
const idx = { cats: new Map(), prods: new Map(), arts: new Map() };
const byProd = new Map();
const byCat = new Map();
const artsOf = (pid) => byProd.get(pid) || [];
const prodsOf = (cid) => byCat.get(cid) || [];

const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
const sorters = {
  "name-asc": (a, b) => collator.compare(a.name, b.name),
  "name-desc": (a, b) => collator.compare(b.name, a.name),
  "date-desc": (a, b) => ms(b.createdAt) - ms(a.createdAt),
  "date-asc": (a, b) => ms(a.createdAt) - ms(b.createdAt),
};
const sorted = (list, key) => [...list].sort(sorters[key] || sorters["name-asc"]);

function recompute() {
  idx.cats = new Map(state.cats.map((c) => [c.id, c]));
  idx.prods = new Map(state.prods.map((p) => [p.id, p]));
  idx.arts = new Map(state.arts.map((a) => [a.id, a]));
  byProd.clear(); byCat.clear();
  state.arts.forEach((a) => { if (!byProd.has(a.productId)) byProd.set(a.productId, []); byProd.get(a.productId).push(a); });
  state.prods.forEach((p) => { if (!byCat.has(p.categoryId)) byCat.set(p.categoryId, []); byCat.get(p.categoryId).push(p); });
}

let unsubs = [];
let seeding = false;
let activeRefresh = null;

const DEFAULT_CATS = [["Bebidas", "🍹"], ["Salgadinhos", "🍿"], ["Destilados", "🥃"], ["Cervejas", "🍺"], ["Energéticos", "⚡"], ["Refrigerantes", "🥤"], ["Doces", "🍬"], ["Outros", "📦"]];

async function seedIfNeeded() {
  if (seeding) return;
  seeding = true;
  try {
    const meta = await getDoc(doc(db, "meta", "settings"));
    if (meta.exists()) return;
    const b = writeBatch(db);
    DEFAULT_CATS.forEach(([name, icon], i) =>
      b.set(doc(collection(db, "categories")), { name, description: "", icon, sortOrder: i, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    b.set(doc(db, "meta", "settings"), { seededAt: serverTimestamp() });
    await b.commit();
    toast("Categorias iniciais criadas.", "success");
  } catch (e) { console.warn("seed", e); } finally { seeding = false; }
}

function startListeners() {
  stopListeners();
  const mk = (name, key, flag, after) =>
    onSnapshot(collection(db, name), (snap) => {
      state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }));
      if (key === "cats") state.cats.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      state.loaded[flag] = true;
      state.loadError = null;
      recompute();
      after?.(snap);
      scheduleRender();
    }, (err) => { console.error(name, err); state.loadError = err; scheduleRender(); });
  unsubs = [
    mk("categories", "cats", "c", (snap) => { if (!snap.metadata.fromCache && snap.empty) seedIfNeeded(); }),
    mk("products", "prods", "p"),
    mk("artworks", "arts", "a"),
  ];
}
function stopListeners() {
  unsubs.forEach((u) => u());
  unsubs = [];
  state.cats = []; state.prods = []; state.arts = [];
  state.loaded = { c: false, p: false, a: false };
  recompute();
}

/* =========================================================
 * Imagens — tudo no Firestore (sem Firebase Storage):
 *  - miniatura leve (WebP/PNG em data URL) dentro do próprio documento da arte;
 *  - PNG original dividido em partes na subcoleção artworks/{id}/chunks.
 * ======================================================= */
const hydrate = () => {};
const blobToB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = () => rej(r.error || new Error("Falha ao ler o arquivo."));
  r.readAsDataURL(blob);
});
function b64ToBytes(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const withTimeout = (p, t = 40000) => Promise.race([
  p,
  new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("O envio demorou demais."), { code: "app/upload-stalled" })), t)),
]);

async function fetchOriginal(a) {
  const n = a.chunkCount || 0;
  if (!n) throw new Error("Esta arte não tem arquivo original salvo.");
  const snap = await getDocs(query(collection(db, "artworks", a.id, "chunks"), orderBy("i")));
  if (snap.size !== n) throw new Error(`A arte está incompleta no banco (${snap.size} de ${n} partes). Exclua e envie de novo.`);
  return new Blob(snap.docs.map((d) => b64ToBytes(d.data().data)), { type: "image/png" });
}

/* Arquivo PNG original (para exibir, compartilhar, baixar, backup) */
const fileCache = new Map();
async function getFile(a) {
  if (fileCache.has(a.id)) return fileCache.get(a.id);
  let blob = null;
  try { blob = (await idb.get(a.id))?.blob || null; } catch { /* sem IDB */ }
  if (!blob) blob = await fetchOriginal(a);
  const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (!PNG_SIG.every((b, i) => head[i] === b)) throw new Error("O arquivo recebido não é um PNG válido.");
  const file = new File([blob], safeName(a.name) + ".png", { type: "image/png" });
  fileCache.set(a.id, file);
  if (fileCache.size > 4) fileCache.delete(fileCache.keys().next().value);
  return file;
}

/* =========================================================
 * Roteamento e renderização
 * ======================================================= */
let renderQueued = false;
let lastHash = null;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); activeRefresh?.(); });
}
const nav = (h) => { location.hash = h; };

function chips(activeId = null) {
  return `<nav class="chips" aria-label="Categorias">
    <a class="chip ${activeId ? "" : "active"}" href="#/">Todas</a>
    ${state.cats.map((c) => `<a class="chip ${c.id === activeId ? "active" : ""}" href="#/cat/${c.id}">${esc(c.name)} ${esc(c.icon || "")}</a>`).join("")}
  </nav>`;
}
const secTitle = (t, extra = "") => `<h2 class="sec-title">${esc(t)} <i class="rule"></i>${extra}</h2>`;

const artCard = (a) => `<article class="card" data-act="open-art" data-id="${a.id}">
  <div class="thumb">${a.thumb ? `<img src="${esc(a.thumb)}" alt="${esc(a.name)}" decoding="async">` : `<div class="ph">🖼️</div>`}
  <button class="fav ${a.isFavorite ? "on" : ""}" data-act="fav" data-id="${a.id}" aria-label="${a.isFavorite ? "Desfavoritar" : "Favoritar"}">${a.isFavorite ? "★" : "☆"}</button></div>
  <div class="card-body"><h3>${esc(a.name)}</h3><p>${fmtDate(a.createdAt)}</p></div></article>`;

const prodCard = (p) => {
  const n = artsOf(p.id).length;
  const c = idx.cats.get(p.categoryId);
  const cover = idx.arts.get(p.coverArtId) || artsOf(p.id)[0];
  return `<article class="card" data-act="open-prod" data-id="${p.id}">
  <div class="thumb">${cover?.thumb ? `<img src="${esc(cover.thumb)}" alt="" decoding="async">` : `<div class="ph">${esc(c?.icon || "📦")}</div>`}</div>
  <div class="card-body"><h3>${esc(p.name)}</h3><p>${esc(p.description || c?.name || "")}</p>
  <div class="price">${n} ${n === 1 ? "arte" : "artes"}</div>
  <button class="plus" data-act="add-art" data-id="${p.id}" aria-label="Adicionar arte PNG a ${esc(p.name)}">+</button></div></article>`;
};

const catCard = (c) => {
  const n = prodsOf(c.id).length;
  return `<a class="card cat-card" href="#/cat/${c.id}"><span class="cat-ico">${esc(c.icon || "📦")}</span><h3>${esc(c.name)}</h3><p>${n} ${n === 1 ? "produto" : "produtos"}</p></a>`;
};

const sortSelect = (kind, withDate = true) => `<div class="sortbar"><span>Ordenar</span>
  <select class="select" data-change="sort-${kind}" aria-label="Ordenar">
  <option value="name-asc" ${state.sort[kind] === "name-asc" ? "selected" : ""}>Nome (A–Z)</option>
  <option value="name-desc" ${state.sort[kind] === "name-desc" ? "selected" : ""}>Nome (Z–A)</option>
  ${withDate ? `<option value="date-desc" ${state.sort[kind] === "date-desc" ? "selected" : ""}>Mais recentes</option>
  <option value="date-asc" ${state.sort[kind] === "date-asc" ? "selected" : ""}>Mais antigas</option>` : ""}
  </select></div>`;

const missing = (t) => `<div class="empty"><div class="empty-ico">🔎</div><h3>${esc(t)}</h3><a class="btn gold" href="#/">Voltar ao início</a></div>`;

function viewHome() {
  const recent = sorted(state.arts, "date-desc").slice(0, 8);
  const favs = sorted(state.arts.filter((a) => a.isFavorite), "date-desc").slice(0, 8);
  return `${chips()}
  <div class="actions">
    <button class="btn gold" data-act="new-cat">+ Categoria</button>
    <button class="btn ghost" data-act="new-prod">+ Produto</button>
  </div>
  ${secTitle("Categorias", `<button class="link" data-act="manage-cats">Gerenciar</button>`)}
  ${state.cats.length ? `<div class="grid">${state.cats.map(catCard).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">🗂️</div><h3>Nenhuma categoria</h3><p>Crie sua primeira categoria para começar a organizar as artes.</p><button class="btn gold" data-act="new-cat">+ Nova categoria</button></div>`}
  ${secTitle("Adicionadas recentemente")}
  ${recent.length ? `<div class="grid">${recent.map(artCard).join("")}</div>` : `<p class="muted">Nenhuma arte cadastrada ainda. Abra um produto e toque em “+ ADICIONAR ARTE PNG”.</p>`}
  ${secTitle("Favoritas", favs.length ? `<a href="#/favs">Ver todas</a>` : "")}
  ${favs.length ? `<div class="grid">${favs.map(artCard).join("")}</div>` : `<p class="muted">Toque na estrela de uma arte para marcá-la como favorita.</p>`}`;
}

function viewCat(id) {
  const c = idx.cats.get(id);
  if (!c) return missing("Categoria não encontrada");
  const ps = sorted(prodsOf(id), state.sort.prod);
  return `${chips(id)}
  <div class="page-head"><h1 class="serif">${esc(c.icon || "")} ${esc(c.name)}</h1>
    <div class="head-actions">
      <button class="btn sm ghost" data-act="edit-cat" data-id="${id}">✎ Editar</button>
      <button class="btn sm gold" data-act="new-prod" data-cat="${id}">+ Produto</button></div></div>
  ${c.description ? `<p class="page-desc">${esc(c.description)}</p>` : ""}
  ${ps.length ? sortSelect("prod") + `<div class="grid">${ps.map(prodCard).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">${esc(c.icon || "📦")}</div><h3>Nenhum produto em ${esc(c.name)}</h3><p>Cadastre o primeiro produto desta categoria.</p><button class="btn gold" data-act="new-prod" data-cat="${id}">+ Novo produto</button></div>`}`;
}

function viewProd(id) {
  const p = idx.prods.get(id);
  if (!p) return missing("Produto não encontrado");
  const c = idx.cats.get(p.categoryId);
  const arts = sorted(artsOf(id), state.sort.art);
  return `<div class="crumbs"><a href="#/">Início</a> › <a href="#/cat/${p.categoryId}">${esc(c?.name || "Categoria")}</a> › <span>${esc(p.name)}</span></div>
  <div class="page-head"><h1 class="serif">${esc(p.name)}</h1>
    <div class="head-actions">
      <button class="btn sm ghost" data-act="edit-prod" data-id="${id}">✎ Editar</button>
      <button class="btn sm danger" data-act="del-prod" data-id="${id}">🗑 Excluir</button></div></div>
  ${p.description ? `<p class="page-desc">${esc(p.description)}</p>` : ""}
  <div class="actions"><button class="btn gold big" data-act="add-art" data-id="${id}">+ ADICIONAR ARTE PNG</button></div>
  ${arts.length ? sortSelect("art") + `<div class="grid">${arts.map(artCard).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">🖼️</div><h3>Nenhuma arte neste produto</h3><p>Envie imagens PNG: o arquivo original é preservado, com transparência e resolução.</p></div>`}`;
}

function viewFavs() {
  const arts = sorted(state.arts.filter((a) => a.isFavorite), state.sort.art);
  return `${secTitle("Artes favoritas")}
  ${arts.length ? sortSelect("art") + `<div class="grid">${arts.map(artCard).join("")}</div>`
    : `<div class="empty"><div class="empty-ico">☆</div><h3>Sem favoritas</h3><p>Toque na estrela de uma arte para vê-la aqui.</p></div>`}`;
}

function viewSearch(q) {
  const toks = norm(q).split(/\s+/).filter(Boolean);
  if (!toks.length) return viewHome();
  const hit = (txt) => toks.every((t) => norm(txt).includes(t));
  const cats = state.cats.filter((c) => hit(c.name));
  const prods = state.prods.filter((p) => hit(`${p.name} ${p.description || ""} ${idx.cats.get(p.categoryId)?.name || ""}`));
  const arts = state.arts.filter((a) => hit(`${a.name} ${idx.prods.get(a.productId)?.name || ""} ${idx.cats.get(a.categoryId)?.name || ""}`));
  const total = cats.length + prods.length + arts.length;
  return `${secTitle(`Resultados para “${q}”`)}
  ${total === 0 ? `<div class="empty"><div class="empty-ico">🔎</div><h3>Nada encontrado</h3><p>Tente outro nome de arte, produto ou categoria.</p></div>` : ""}
  ${cats.length ? `<h3 class="serif gold" style="margin:14px 0 10px">Categorias</h3><div class="grid">${cats.map(catCard).join("")}</div>` : ""}
  ${prods.length ? `<h3 class="serif gold" style="margin:18px 0 10px">Produtos</h3><div class="grid">${sorted(prods, "name-asc").map(prodCard).join("")}</div>` : ""}
  ${arts.length ? `<h3 class="serif gold" style="margin:18px 0 10px">Artes</h3><div class="grid">${sorted(arts, "name-asc").map(artCard).join("")}</div>` : ""}`;
}

function viewArt(id) {
  const a = idx.arts.get(id);
  if (!a) return missing("Arte não encontrada");
  const p = idx.prods.get(a.productId);
  const c = idx.cats.get(a.categoryId);
  const list = sorted(artsOf(a.productId), state.sort.art);
  const i = list.findIndex((x) => x.id === id);
  const prev = list[i - 1], next = list[i + 1];
  const saved = offlineIds.has(id);
  return `<div class="viewer-top">
    <a class="icon-btn" href="#/prod/${a.productId}" aria-label="Voltar">‹</a>
    <div><h1>${esc(a.name)}</h1>
    <div class="crumbs" style="margin:0"><a href="#/cat/${a.categoryId}">${esc(c?.name || "Categoria")}</a> › <a href="#/prod/${a.productId}">${esc(p?.name || "Produto")}</a></div></div></div>
  <div class="stage" id="stage">
    <img id="artImg" data-id="${id}" alt="${esc(a.name)}" hidden>
    <div class="stage-msg" id="stageMsg"><div class="spin"></div></div>
    <button class="stage-nav prev" data-act="goto" data-id="${prev?.id || ""}" ${prev ? "" : "disabled"} aria-label="Arte anterior">‹</button>
    <button class="stage-nav next" data-act="goto" data-id="${next?.id || ""}" ${next ? "" : "disabled"} aria-label="Próxima arte">›</button>
  </div>
  <div class="meta"><span>${a.width}×${a.height}px</span><span>${fmtSize(a.sizeBytes || 0)}</span><span>PNG original</span><span>${fmtDate(a.createdAt)}</span><span>${i + 1} de ${list.length}</span>${saved ? "<span>✔ salva offline</span>" : ""}</div>
  <div class="v-actions">
    <button class="btn gold big primary" data-act="share" data-id="${id}">📤 Compartilhar PNG</button>
    <button class="btn" data-act="download" data-id="${id}">⬇ Baixar PNG original</button>
    <button class="btn" data-act="print" data-id="${id}">🖨 Imprimir</button>
    <button class="btn" data-act="fav" data-id="${id}">${a.isFavorite ? "★ Favorita" : "☆ Favoritar"}</button>
    <button class="btn" data-act="rename" data-id="${id}">✎ Renomear</button>
    <button class="btn" data-act="cover" data-id="${id}">🖼 Usar como capa</button>
    <button class="btn" data-act="offline" data-id="${id}">${saved ? "Remover do offline" : "💾 Salvar offline"}</button>
    <button class="btn danger" data-act="del-art" data-id="${id}">🗑 Excluir</button>
  </div>`;
}

function viewBackup() {
  return `${secTitle("Backup e restauração")}
  <div class="panel"><h3>Exportar backup</h3>
    <p>Gera um arquivo com categorias, produtos e metadados das artes. Se marcar a opção abaixo, inclui também os PNG originais (arquivo .zip).</p>
    <label class="check"><input type="checkbox" id="bkImages" checked> Incluir imagens PNG originais</label>
    <button class="btn gold big" data-act="export">⬇ Exportar backup</button>
    <p class="muted">Bibliotecas grandes usam bastante memória e dados móveis ao incluir imagens. Prefira Wi-Fi.</p></div>
  <div class="panel"><h3>Restaurar backup</h3>
    <p>Aceita o .zip (ou .json) gerado aqui. Itens que já existem são ignorados — nada é duplicado nem sobrescrito. Antes de começar, você verá um resumo para confirmar.</p>
    <button class="btn big" data-act="restore">⬆ Escolher arquivo de backup</button></div>
  <div class="panel"><h3>Entenda as diferenças</h3>
    <ul>
      <li><b>Armazenamento permanente (Firebase):</b> é onde as artes vivem de verdade (Firestore). Já é a sua cópia principal na nuvem.</li>
      <li><b>Backup dos arquivos (.zip com imagens):</b> cópia completa fora do Firebase, útil contra exclusão acidental ou troca de projeto.</li>
      <li><b>Backup local só de metadados (.json):</b> guarda nomes e organização, mas <u>não</u> as imagens; só serve de índice.</li>
    </ul>
    <p class="muted">“Salvar offline” em cada arte é outra coisa: guarda uma cópia só neste aparelho para uso sem internet.</p></div>`;
}

function render() {
  if (!state.user) return;
  const view = $("#view");
  const hash = location.hash || "#/";
  const routeChanged = hash !== lastHash;
  lastHash = hash;
  const [, route = "", rawArg = ""] = hash.slice(1).split("/");
  const arg = decodeURIComponent(rawArg);

  document.title = "Disk Dourado Artes";
  $$(".bottom-nav [data-nav]").forEach((a) => a.classList.toggle("active",
    (a.dataset.nav === "home" && ["", "cat", "prod", "art", "search"].includes(route)) ||
    (a.dataset.nav === "favs" && route === "favs") || (a.dataset.nav === "backup" && route === "backup")));
  $("#qClear").hidden = !$("#q").value;

  if (state.loadError) {
    view.innerHTML = `<div class="empty"><div class="empty-ico">🔒</div><h3>Não foi possível carregar a biblioteca</h3>
      <p>${esc(friendly(state.loadError))}</p><button class="btn gold" onclick="location.reload()">Tentar novamente</button></div>`;
    return;
  }
  if (!(state.loaded.c && state.loaded.p && state.loaded.a)) {
    view.innerHTML = `<div class="loader"><div class="spin"></div><span>Carregando biblioteca…</span></div>`;
    return;
  }

  const scrollY = window.scrollY;
  const views = {
    "": viewHome, cat: () => viewCat(arg), prod: () => viewProd(arg), art: () => viewArt(arg),
    favs: viewFavs, search: () => viewSearch(arg), backup: viewBackup,
  };
  view.innerHTML = (views[route] || (() => missing("Página não encontrada")))();
  hydrate(view);
  if (route === "art") loadViewerImage(idx.arts.get(arg));
  if (routeChanged) window.scrollTo(0, 0); else window.scrollTo(0, scrollY);
}
window.addEventListener("hashchange", () => {
  const route = (location.hash || "#/").slice(2).split("/")[0];
  if (route !== "search" && $("#q").value) $("#q").value = "";
  render();
});

/* =========================================================
 * Visualizador de arte
 * ======================================================= */
const objUrls = new Map();
function objUrl(id, blob) {
  if (objUrls.has(id)) URL.revokeObjectURL(objUrls.get(id));
  const u = URL.createObjectURL(blob);
  objUrls.set(id, u);
  return u;
}
async function loadViewerImage(a) {
  const img = $("#artImg"), msg = $("#stageMsg");
  if (!img || !a) return;
  const still = () => $("#artImg")?.dataset.id === a.id;
  img.dataset.full = "0";
  // 1) miniatura na hora, enquanto o original é montado
  if (a.thumb) { img.src = a.thumb; img.hidden = false; msg.hidden = true; }
  // 2) PNG original
  try {
    let src = null;
    if (offlineIds.has(a.id)) { const r = await idb.get(a.id); if (r?.blob) src = objUrl(a.id, r.blob); }
    if (!src) src = objUrl(a.id, await getFile(a));
    if (!still()) return;
    img.onload = () => { img.dataset.full = "1"; img.hidden = false; msg.hidden = true; };
    img.onerror = () => { msg.hidden = false; msg.innerHTML = `<div>Imagem indisponível.</div>`; };
    img.src = src;
  } catch (e) {
    if (!still()) return;
    if (a.thumb) toast(`Mostrando só a prévia: ${friendly(e)}`, "error", 6000);
    else { msg.hidden = false; msg.innerHTML = `<div>Não foi possível carregar a imagem.<br><small class="muted">${esc(friendly(e))}</small></div>`; }
  }
}
function stepArt(dir) {
  const a = idx.arts.get(decodeURIComponent((location.hash.split("/")[2]) || ""));
  if (!a) return;
  const list = sorted(artsOf(a.productId), state.sort.art);
  const n = list[list.findIndex((x) => x.id === a.id) + dir];
  if (n) nav(`#/art/${n.id}`);
}
document.addEventListener("keydown", (e) => {
  if (!location.hash.startsWith("#/art/") || $(".modal-backdrop") || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === "ArrowLeft") stepArt(-1);
  if (e.key === "ArrowRight") stepArt(1);
});
let touchX = null;
document.addEventListener("touchstart", (e) => { touchX = e.target.closest("#stage") ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (touchX == null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 70) stepArt(dx < 0 ? 1 : -1);
}, { passive: true });

/* =========================================================
 * Categorias
 * ======================================================= */
function categoryForm(c) {
  formModal({
    title: c ? "Editar categoria" : "Nova categoria",
    fields: [
      { name: "name", label: "Nome", value: c?.name, required: true, max: 40 },
      { name: "icon", label: "Ícone (emoji)", value: c?.icon || "📦", max: 4, placeholder: "🍿" },
      { name: "description", label: "Descrição (opcional)", type: "textarea", value: c?.description, max: 200 },
    ],
    onSubmit: async (v) => {
      const dup = state.cats.find((x) => norm(x.name) === norm(v.name) && x.id !== c?.id);
      if (dup) throw new Error("Já existe uma categoria com esse nome.");
      const data = { name: v.name, icon: v.icon || "📦", description: v.description, updatedAt: serverTimestamp() };
      if (c) await updateDoc(doc(db, "categories", c.id), data);
      else {
        const order = state.cats.reduce((m, x) => Math.max(m, x.sortOrder ?? 0), -1) + 1;
        await setDoc(doc(collection(db, "categories")), { ...data, sortOrder: order, createdAt: serverTimestamp() });
      }
      toast(c ? "Categoria atualizada." : "Categoria criada.", "success");
    },
  });
}

async function deleteCategory(c) {
  const n = prodsOf(c.id).length;
  if (n) { toast(`“${c.name}” tem ${n} produto(s). Mova ou exclua os produtos antes de excluir a categoria.`, "error", 6000); return; }
  if (!(await confirmDialog({ title: "Excluir categoria", message: `Excluir a categoria <b>${esc(c.name)}</b>?`, confirmLabel: "Excluir", danger: true }))) return;
  try { await deleteDoc(doc(db, "categories", c.id)); toast("Categoria excluída.", "success"); if (location.hash === `#/cat/${c.id}`) nav("#/"); }
  catch (e) { toast(friendly(e), "error"); }
}

async function moveCategory(id, dir) {
  const list = [...state.cats];
  const i = list.findIndex((c) => c.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  try {
    const b = writeBatch(db);
    list.forEach((c, k) => b.update(doc(db, "categories", c.id), { sortOrder: k, updatedAt: serverTimestamp() }));
    await b.commit();
  } catch (e) { toast(friendly(e), "error"); }
}

function manageCategories() {
  const m = modal("Gerenciar categorias", `<div id="catList"></div>
    <div class="modal-actions"><button class="btn gold" data-new>+ Nova categoria</button><button class="btn ghost" data-close>Fechar</button></div>`, { onClose: () => { activeRefresh = null; } });
  const draw = () => {
    $("#catList", m.el).innerHTML = state.cats.map((c, i) => `<div class="row">
      <span style="font-size:26px">${esc(c.icon || "📦")}</span>
      <div class="grow"><b>${esc(c.name)}</b><br><small class="muted">${prodsOf(c.id).length} produto(s)</small></div>
      <button class="btn sm" data-up="${c.id}" ${i === 0 ? "disabled" : ""} aria-label="Subir">▲</button>
      <button class="btn sm" data-down="${c.id}" ${i === state.cats.length - 1 ? "disabled" : ""} aria-label="Descer">▼</button>
      <button class="btn sm" data-edit="${c.id}" aria-label="Editar">✎</button>
      <button class="btn sm danger" data-del="${c.id}" aria-label="Excluir">🗑</button></div>`).join("") || `<p class="muted">Nenhuma categoria.</p>`;
  };
  draw();
  activeRefresh = () => { if (m.el.isConnected) draw(); };
  m.el.addEventListener("click", (e) => {
    const t = e.target.closest("button"); if (!t) return;
    if (t.dataset.up) moveCategory(t.dataset.up, -1);
    else if (t.dataset.down) moveCategory(t.dataset.down, 1);
    else if (t.dataset.edit) categoryForm(idx.cats.get(t.dataset.edit));
    else if (t.dataset.del) deleteCategory(idx.cats.get(t.dataset.del));
    else if (t.hasAttribute("data-new")) categoryForm(null);
  });
}

/* =========================================================
 * Produtos
 * ======================================================= */
function productForm(p, presetCat) {
  if (!state.cats.length) { toast("Crie uma categoria antes de cadastrar produtos.", "error"); return; }
  formModal({
    title: p ? "Editar produto" : "Novo produto",
    fields: [
      { name: "name", label: "Nome do produto", value: p?.name, required: true, max: 80, placeholder: "Ex.: Jack Daniel's" },
      { name: "categoryId", label: "Categoria", type: "select", value: p?.categoryId || presetCat || state.cats[0].id, options: state.cats.map((c) => ({ value: c.id, label: `${c.icon || ""} ${c.name}` })) },
      { name: "description", label: "Descrição (opcional)", type: "textarea", value: p?.description, max: 300 },
    ],
    onSubmit: async (v) => {
      const data = { name: v.name, description: v.description, categoryId: v.categoryId, updatedAt: serverTimestamp() };
      if (!p) {
        await setDoc(doc(collection(db, "products")), { ...data, coverArtId: null, createdAt: serverTimestamp() });
        toast("Produto criado.", "success");
        return;
      }
      const b = writeBatch(db);
      b.update(doc(db, "products", p.id), data);
      if (v.categoryId !== p.categoryId) artsOf(p.id).forEach((a) => b.update(doc(db, "artworks", a.id), { categoryId: v.categoryId, updatedAt: serverTimestamp() }));
      await b.commit();
      toast("Produto atualizado.", "success");
    },
  });
}

// Agrupa num lote a exclusão da arte e de todas as partes do PNG (tudo ou nada).
function artDeleteOps(b, a) {
  for (let i = 0; i < (a.chunkCount || 0); i++) b.delete(doc(db, "artworks", a.id, "chunks", chunkId(i)));
  b.delete(doc(db, "artworks", a.id));
}
function forgetArt(a) {
  fileCache.delete(a.id); offlineIds.delete(a.id); idb.del(a.id).catch(() => {});
  if (objUrls.has(a.id)) { URL.revokeObjectURL(objUrls.get(a.id)); objUrls.delete(a.id); }
}

async function deleteProduct(p) {
  const arts = artsOf(p.id);
  const ok = await confirmDialog({
    title: "Excluir produto",
    message: `Excluir <b>${esc(p.name)}</b> e ${arts.length ? `suas <b>${arts.length}</b> arte(s), incluindo os arquivos PNG` : "todo o seu conteúdo"}? Esta ação não pode ser desfeita.`,
    confirmLabel: "Excluir tudo", danger: true,
  });
  if (!ok) return;
  const pm = progressModal("Excluindo produto…");
  try {
    for (let i = 0; i < arts.length; i++) {
      pm.set(`Removendo arte ${i + 1} de ${arts.length}…`, i / Math.max(1, arts.length));
      const lote = writeBatch(db);
      artDeleteOps(lote, arts[i]);          // arte + partes do PNG, de uma vez
      await lote.commit();
      forgetArt(arts[i]);
    }
    await deleteDoc(doc(db, "products", p.id));
    pm.close();
    toast("Produto excluído.", "success");
    nav(`#/cat/${p.categoryId}`);
  } catch (e) {
    pm.close();
    toast(`A exclusão parou: ${friendly(e)} Nada ficou quebrado; tente novamente.`, "error", 7000);
  }
}

/* =========================================================
 * Artes: upload
 * ======================================================= */
async function validatePng(file) {
  if (!file.size) throw new Error("O arquivo está vazio.");
  if (file.size > MAX_BYTES) throw new Error(`Arquivo muito grande (${fmtSize(file.size)}). Limite: ${MAX_BYTES / 1048576} MB.`);
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!PNG_SIG.every((b, i) => head[i] === b)) throw new Error("Não é um PNG válido (o conteúdo não corresponde a um arquivo PNG).");
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("O PNG está corrompido ou não pôde ser lido."); }
  return bmp;
}
// Miniatura leve (vai dentro do documento da arte). WebP mantém a transparência; cai para PNG se preciso.
async function makeThumbUrl(bmp) {
  let url = "";
  for (const max of [360, 260, 180]) {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(bmp.width * k)); cv.height = Math.max(1, Math.round(bmp.height * k));
    cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
    url = cv.toDataURL("image/webp", 0.8);
    if (!url.startsWith("data:image/webp")) url = cv.toDataURL("image/png");
    if (url.length <= 150000) return url;
  }
  return url;
}
// Grava o PNG original em partes; `written` guarda as já gravadas para desfazer em caso de erro.
async function writeChunks(artId, file, onProgress, written) {
  const n = Math.ceil(file.size / CHUNK);
  for (let i = 0; i < n; i++) {
    const data = await blobToB64(file.slice(i * CHUNK, (i + 1) * CHUNK));
    await withTimeout(setDoc(doc(db, "artworks", artId, "chunks", chunkId(i)), { i, data }));
    written.push(i);
    onProgress?.((i + 1) / n);
  }
  return n;
}
const undoChunks = (artId, written) =>
  Promise.allSettled(written.map((i) => deleteDoc(doc(db, "artworks", artId, "chunks", chunkId(i)))));

function pickAndUpload(productId) {
  if (!idx.prods.get(productId)) return;
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "image/png"; inp.multiple = true;
  inp.onchange = () => { if (inp.files.length) startUploads(productId, [...inp.files]); };
  inp.click();
}

function startUploads(productId, files) {
  const jobs = files.map((file) => ({
    file, productId, id: doc(collection(db, "artworks")).id, status: "queued", pct: 0, error: null, written: [],
  }));
  const m = modal("Enviando artes", `<div id="jobs"></div><div class="modal-actions"><button class="btn gold" data-close>Fechar</button></div>
    <p class="muted" style="margin-top:10px">Pode fechar esta janela: os envios continuam.</p>`);
  const draw = () => {
    const box = $("#jobs", m.el); if (!box) return;
    box.innerHTML = jobs.map((j, i) => `<div class="row job ${j.status}"><div class="grow"><b>${esc(j.file.name)}</b>
      <small>${j.status === "queued" ? "Na fila…" : j.status === "uploading" ? `Enviando… ${Math.round(j.pct * 100)}%` : j.status === "done" ? "Concluído" : esc(j.error)}</small>
      <div class="bar"><i style="width:${Math.round((j.status === "done" ? 1 : j.pct) * 100)}%"></i></div></div>
      ${j.status === "error" ? `<button class="btn sm" data-retry="${i}">Tentar de novo</button>` : ""}</div>`).join("");
  };
  m.el.addEventListener("click", (e) => { const r = e.target.closest("[data-retry]"); if (r) runJob(jobs[+r.dataset.retry]); });

  async function runJob(job) {
    job.status = "uploading"; job.error = null; job.pct = 0; job.written = []; draw();
    try {
      const prod = idx.prods.get(job.productId);
      if (!prod) throw new Error("O produto não existe mais.");
      const bmp = await validatePng(job.file);
      const width = bmp.width, height = bmp.height;
      const thumb = await makeThumbUrl(bmp);
      bmp.close?.();
      const n = await writeChunks(job.id, job.file, (p) => { job.pct = p * 0.95; draw(); }, job.written);
      job.pct = 0.97; draw();
      const b = writeBatch(db);
      b.set(doc(db, "artworks", job.id), {
        name: safeName(job.file.name.replace(/\.png$/i, "")), productId: prod.id, categoryId: prod.categoryId,
        thumb, chunkCount: n, contentType: "image/png", sizeBytes: job.file.size, width, height,
        isFavorite: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      if (!idx.prods.get(prod.id)?.coverArtId) b.update(doc(db, "products", prod.id), { coverArtId: job.id, updatedAt: serverTimestamp() });
      await withTimeout(b.commit());
      job.status = "done"; job.pct = 1;
    } catch (e) {
      await undoChunks(job.id, job.written); // não deixa partes soltas no banco
      job.written = [];
      job.status = "error"; job.error = friendly(e) + (e?.code ? ` [${e.code}]` : "");
    }
    draw();
    if (jobs.every((j) => j.status === "done")) toast(`${jobs.length} arte(s) enviada(s).`, "success");
  }

  draw();
  (async () => { // 2 envios em paralelo
    const queue = [...jobs];
    await Promise.all([0, 1].map(async () => { while (queue.length) await runJob(queue.shift()); }));
  })();
}

/* =========================================================
 * Artes: ações
 * ======================================================= */
async function toggleFav(id) {
  const a = idx.arts.get(id); if (!a) return;
  try { await updateDoc(doc(db, "artworks", id), { isFavorite: !a.isFavorite, updatedAt: serverTimestamp() }); }
  catch (e) { toast(friendly(e), "error"); }
}
function renameArt(a) {
  formModal({
    title: "Renomear arte", fields: [{ name: "name", label: "Nome da arte", value: a.name, required: true, max: 80 }],
    onSubmit: async (v) => { await updateDoc(doc(db, "artworks", a.id), { name: safeName(v.name), updatedAt: serverTimestamp() }); toast("Arte renomeada.", "success"); },
  });
}
async function deleteArt(a) {
  if (!(await confirmDialog({ title: "Excluir arte", message: `Excluir <b>${esc(a.name)}</b>? O arquivo PNG será removido.`, confirmLabel: "Excluir", danger: true }))) return;
  const list = sorted(artsOf(a.productId), state.sort.art);
  const i = list.findIndex((x) => x.id === a.id);
  const goto = list[i + 1] || list[i - 1];
  try {
    const b = writeBatch(db);
    artDeleteOps(b, a);
    const p = idx.prods.get(a.productId);
    if (p && p.coverArtId === a.id) b.update(doc(db, "products", p.id), { coverArtId: null, updatedAt: serverTimestamp() });
    await b.commit();
    forgetArt(a);
    toast("Arte excluída.", "success");
    nav(goto ? `#/art/${goto.id}` : `#/prod/${a.productId}`);
  } catch (e) { toast(`Não foi possível excluir: ${friendly(e)}`, "error", 6000); }
}
async function setCover(a) {
  try {
    await updateDoc(doc(db, "products", a.productId), { coverArtId: a.id, updatedAt: serverTimestamp() });
    toast("Capa do produto atualizada.", "success");
  } catch (e) { toast(friendly(e), "error"); }
}
async function toggleOffline(a) {
  try {
    if (offlineIds.has(a.id)) { await idb.del(a.id); offlineIds.delete(a.id); toast("Removida do armazenamento offline.", "success"); }
    else {
      toast("Baixando para uso offline…");
      const file = await getFile(a);
      await idb.set(a.id, { blob: file, name: a.name, savedAt: Date.now() });
      offlineIds.add(a.id);
      toast("Arte salva neste aparelho para uso offline.", "success");
    }
    scheduleRender();
  } catch (e) { toast(`Falha: ${friendly(e)}`, "error"); }
}

function triggerDownload(file) {
  const u = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = u; link.download = file.name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
}
async function downloadArt(a) {
  try {
    const file = await getFile(a);
    triggerDownload(file);
    toast("Download solicitado ao navegador. Procure o arquivo em Downloads.", "success");
  } catch (e) { toast(`Falha no download: ${friendly(e)}${e.code ? "" : ""} Tente de novo com internet estável.`, "error", 7000); }
}

function shareFallback(a, reason) {
  const m = modal("Compartilhar manualmente", `<p>${esc(reason)}</p>
    <p>Você ainda pode enviar a arte assim:</p>
    <ol><li>Toque em <b>Baixar PNG original</b>.</li>
    <li>Abra o arquivo na Galeria ou em Meus Arquivos.</li>
    <li>Use <b>Compartilhar</b> do próprio Android e escolha Bluetooth ou o aplicativo da impressora.</li></ol>
    <div class="modal-actions"><button class="btn ghost" data-close>Fechar</button><button class="btn gold" data-dl>⬇ Baixar PNG</button></div>`);
  $("[data-dl]", m.el).onclick = () => { m.close(); downloadArt(a); };
}

let sharing = false;
async function shareArt(a) {
  if (sharing) return;
  sharing = true;
  try {
    let file;
    try { file = await getFile(a); }
    catch (e) { toast(`Não foi possível obter o PNG: ${friendly(e)} Verifique a conexão.`, "error", 7000); return; }
    const data = { files: [file], title: a.name };
    if (!navigator.share || !navigator.canShare || !navigator.canShare(data)) {
      shareFallback(a, "Este navegador/aparelho não permite compartilhar arquivos diretamente."); return;
    }
    try {
      await navigator.share(data);
      toast("Arquivo entregue ao Android. A conclusão do envio depende do aplicativo escolhido.", "success", 5500);
    } catch (e) {
      if (e.name === "AbortError") toast("Compartilhamento cancelado.");
      else if (e.name === "NotAllowedError") toast("O Android exigiu um novo toque. A arte já está pronta: toque em Compartilhar PNG de novo.", "error", 6500);
      else shareFallback(a, `O compartilhamento falhou (${e.name || "erro"}).`);
    }
  } finally { sharing = false; }
}

function printArt(a) {
  const img = $("#artImg");
  const src = img?.dataset.id === a.id && img.src;
  if (!src || img.dataset.full !== "1") { toast("Aguarde o PNG original terminar de carregar para imprimir.", "error"); return; }
  const f = document.createElement("iframe");
  f.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
  f.srcdoc = `<!doctype html><html><head><title>${esc(a.name)}</title><style>@page{margin:6mm}html,body{margin:0}img{display:block;max-width:100%;max-height:96vh;margin:0 auto}</style></head><body><img src="${esc(src)}"></body></html>`;
  f.onload = () => {
    const w = f.contentWindow, im = w.document.querySelector("img");
    const go = () => { try { w.focus(); w.print(); } catch { toast("Este navegador não abriu o diálogo de impressão.", "error"); } };
    im.complete ? go() : (im.onload = go);
    setTimeout(() => f.remove(), 120000);
  };
  document.body.append(f);
  toast("Abrindo o diálogo de impressão do navegador. Impressoras Bluetooth só aparecem se o Android tiver um serviço de impressão compatível.", "info", 6500);
}

/* =========================================================
 * Backup e restauração
 * ======================================================= */
const ser = (o) => ({ ...o, createdAt: ms(o.createdAt), updatedAt: ms(o.updatedAt) });
const stamp = () => new Date().toISOString().slice(0, 10);

async function exportBackup() {
  const withImages = $("#bkImages")?.checked;
  const payload = {
    app: "disk-dourado-artes", version: 1, exportedAt: new Date().toISOString(),
    categories: state.cats.map(ser), products: state.prods.map(ser), artworks: state.arts.map(ser),
  };
  if (!withImages) {
    triggerDownload(new File([JSON.stringify(payload, null, 2)], `backup-disk-dourado-${stamp()}.json`, { type: "application/json" }));
    toast("Backup de metadados gerado (sem imagens).", "success");
    return;
  }
  if (!window.JSZip) { toast("A biblioteca de ZIP não carregou (precisa de internet na primeira vez).", "error"); return; }
  const pm = progressModal("Gerando backup…");
  const failed = [];
  try {
    const zip = new window.JSZip();
    const arts = state.arts;
    for (let i = 0; i < arts.length; i++) {
      pm.set(`Baixando imagem ${i + 1} de ${arts.length}…`, i / Math.max(1, arts.length));
      try { zip.file(`images/${arts[i].id}.png`, await getFile(arts[i])); }
      catch { failed.push(arts[i].name); }
    }
    payload.imagesIncluded = arts.filter((a) => !failed.includes(a.name)).map((a) => a.id);
    zip.file("backup.json", JSON.stringify(payload, null, 2));
    pm.set("Compactando…", 0.98);
    const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
    triggerDownload(new File([blob], `backup-disk-dourado-${stamp()}.zip`, { type: "application/zip" }));
    pm.close();
    toast(failed.length ? `Backup gerado, mas ${failed.length} imagem(ns) não puderam ser incluídas: ${failed.slice(0, 3).join(", ")}…` : "Backup completo gerado.", failed.length ? "error" : "success", 7000);
  } catch (e) { pm.close(); toast(`Falha ao gerar backup: ${friendly(e)}`, "error", 7000); }
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
function validateBackup(d) {
  const bad = (m) => { throw new Error("Backup inválido: " + m); };
  if (!d || d.app !== "disk-dourado-artes") bad("não é um backup do Disk Dourado Artes.");
  if (d.version !== 1) bad("versão não suportada.");
  for (const k of ["categories", "products", "artworks"]) if (!Array.isArray(d[k])) bad(`campo “${k}” ausente.`);
  const cs = new Set(), ps = new Set();
  d.categories.forEach((c) => { if (!ID_RE.test(c.id) || typeof c.name !== "string" || !c.name || c.name.length > 120) bad("categoria com dados incorretos."); cs.add(c.id); });
  d.products.forEach((p) => { if (!ID_RE.test(p.id) || typeof p.name !== "string" || !p.name || !(cs.has(p.categoryId) || idx.cats.has(p.categoryId))) bad(`produto “${p.name || "?"}” sem categoria válida.`); ps.add(p.id); });
  d.artworks.forEach((a) => {
    if (!ID_RE.test(a.id) || typeof a.name !== "string" || !(ps.has(a.productId) || idx.prods.has(a.productId))) bad(`arte “${a.name || "?"}” com dados incorretos.`);
  });
}

function pickBackup() {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".zip,.json,application/zip,application/json";
  inp.onchange = () => inp.files[0] && restoreBackup(inp.files[0]);
  inp.click();
}

async function restoreBackup(file) {
  let data, zip = null;
  try {
    const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
    if (head[0] === 0x50 && head[1] === 0x4b) {
      if (!window.JSZip) throw new Error("Biblioteca de ZIP indisponível (conecte à internet).");
      zip = await window.JSZip.loadAsync(file);
      const j = zip.file("backup.json");
      if (!j) throw new Error("Backup inválido: backup.json não encontrado no ZIP.");
      data = JSON.parse(await j.async("string"));
    } else data = JSON.parse(await file.text());
    validateBackup(data);
  } catch (e) { toast(e instanceof SyntaxError ? "Arquivo ilegível (JSON inválido)." : e.message, "error", 7000); return; }

  // Mapeia categorias/produtos já existentes (por ID ou por nome) para evitar duplicação.
  const catMap = new Map(), newCats = [];
  data.categories.forEach((c) => {
    if (idx.cats.has(c.id)) catMap.set(c.id, c.id);
    else { const ex = state.cats.find((x) => norm(x.name) === norm(c.name)); if (ex) catMap.set(c.id, ex.id); else { catMap.set(c.id, c.id); newCats.push(c); } }
  });
  const mapCat = (id) => catMap.get(id) || id;
  const prodMap = new Map(), newProds = [];
  data.products.forEach((p) => {
    const cid = mapCat(p.categoryId);
    if (idx.prods.has(p.id)) prodMap.set(p.id, p.id);
    else { const ex = state.prods.find((x) => x.categoryId === cid && norm(x.name) === norm(p.name)); if (ex) prodMap.set(p.id, ex.id); else { prodMap.set(p.id, p.id); newProds.push(p); } }
  });
  const newArts = data.artworks.filter((a) => !idx.arts.has(a.id));
  const inZip = (a) => !!zip?.file(`images/${a.id}.png`);
  const summary = `<ul><li>Categorias novas: <b>${newCats.length}</b> (existentes: ${data.categories.length - newCats.length})</li>
    <li>Produtos novos: <b>${newProds.length}</b> (existentes: ${data.products.length - newProds.length})</li>
    <li>Artes novas: <b>${newArts.length}</b> (já existentes, ignoradas: ${data.artworks.length - newArts.length})</li>
    <li>Imagens no arquivo: <b>${newArts.filter(inZip).length}</b></li></ul>
    <p class="muted">Artes sem imagem no arquivo não podem ser restauradas: o PNG original só existe dentro do .zip com imagens.</p>`;
  if (!newCats.length && !newProds.length && !newArts.length) { toast("Nada a restaurar: tudo deste backup já existe na biblioteca."); return; }
  if (!(await confirmDialog({ title: "Restaurar backup", message: summary, confirmLabel: "Restaurar" }))) return;

  const pm = progressModal("Restaurando…");
  const report = { done: 0, skipped: [] };
  const fromMs = (n) => (n ? Timestamp.fromMillis(n) : serverTimestamp());
  try {
    const b = writeBatch(db);
    newCats.forEach((c) => b.set(doc(db, "categories", c.id), { name: c.name, description: c.description || "", icon: c.icon || "📦", sortOrder: c.sortOrder ?? 999, createdAt: fromMs(c.createdAt), updatedAt: serverTimestamp() }));
    newProds.forEach((p) => b.set(doc(db, "products", p.id), { name: p.name, description: p.description || "", categoryId: mapCat(p.categoryId), coverArtId: null, createdAt: fromMs(p.createdAt), updatedAt: serverTimestamp() }));
    await b.commit();

    const restored = new Map(); // productId -> ids das artes restauradas
    for (let i = 0; i < newArts.length; i++) {
      const a = newArts[i];
      const label = `Restaurando arte ${i + 1} de ${newArts.length}…`;
      pm.set(label, i / newArts.length);
      const written = [];
      try {
        const entry = zip?.file(`images/${a.id}.png`);
        if (!entry) { report.skipped.push(`${a.name} (sem imagem no backup)`); continue; }
        const f = new File([new Blob([await entry.async("arraybuffer")], { type: "image/png" })], "x.png", { type: "image/png" });
        const bmp = await validatePng(f);
        const width = bmp.width, height = bmp.height;
        const thumb = await makeThumbUrl(bmp);
        bmp.close?.();
        const n = await writeChunks(a.id, f, (p) => pm.set(label, (i + p) / newArts.length), written);
        const pid = prodMap.get(a.productId) || a.productId;
        await withTimeout(setDoc(doc(db, "artworks", a.id), {
          name: safeName(a.name), productId: pid, categoryId: mapCat(a.categoryId), thumb, chunkCount: n,
          contentType: "image/png", sizeBytes: f.size, width, height, isFavorite: !!a.isFavorite,
          createdAt: fromMs(a.createdAt), updatedAt: serverTimestamp(),
        }));
        if (!restored.has(pid)) restored.set(pid, []);
        restored.get(pid).push(a.id);
        report.done++;
      } catch (e) { await undoChunks(a.id, written); report.skipped.push(`${a.name} (${friendly(e)})`); }
    }
    // Capas: só se apontarem para uma arte realmente restaurada.
    const cb = writeBatch(db); let cn = 0;
    newProds.forEach((p) => {
      const ids = restored.get(p.id);
      if (ids?.length) { cb.update(doc(db, "products", p.id), { coverArtId: ids.includes(p.coverArtId) ? p.coverArtId : ids[0] }); cn++; }
    });
    if (cn) await cb.commit();
    pm.close();
    toast(`Restauração concluída: ${newCats.length} categoria(s), ${newProds.length} produto(s), ${report.done} arte(s).${report.skipped.length ? ` Ignoradas: ${report.skipped.length}.` : ""}`, report.skipped.length ? "error" : "success", 8000);
    if (report.skipped.length) modal("Artes não restauradas", `<ul>${report.skipped.map((s) => `<li>${esc(s)}</li>`).join("")}</ul><div class="modal-actions"><button class="btn gold" data-close>OK</button></div>`);
  } catch (e) { pm.close(); toast(`Restauração interrompida: ${friendly(e)} Itens já criados foram mantidos; rode a restauração de novo (sem duplicar).`, "error", 8000); }
}

/* =========================================================
 * Eventos de interface
 * ======================================================= */
const actions = {
  "open-art": (el) => nav(`#/art/${el.dataset.id}`),
  "open-prod": (el) => nav(`#/prod/${el.dataset.id}`),
  goto: (el) => el.dataset.id && nav(`#/art/${el.dataset.id}`),
  fav: (el) => toggleFav(el.dataset.id),
  "add-art": (el) => pickAndUpload(el.dataset.id),
  "new-cat": () => categoryForm(null),
  "edit-cat": (el) => categoryForm(idx.cats.get(el.dataset.id)),
  "manage-cats": manageCategories,
  "new-prod": (el) => productForm(null, el.dataset.cat),
  "edit-prod": (el) => productForm(idx.prods.get(el.dataset.id)),
  "del-prod": (el) => deleteProduct(idx.prods.get(el.dataset.id)),
  share: (el) => shareArt(idx.arts.get(el.dataset.id)),
  download: (el) => downloadArt(idx.arts.get(el.dataset.id)),
  print: (el) => printArt(idx.arts.get(el.dataset.id)),
  rename: (el) => renameArt(idx.arts.get(el.dataset.id)),
  "del-art": (el) => deleteArt(idx.arts.get(el.dataset.id)),
  cover: (el) => setCover(idx.arts.get(el.dataset.id)),
  offline: (el) => toggleOffline(idx.arts.get(el.dataset.id)),
  export: exportBackup,
  restore: pickBackup,
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el || el.closest(".modal-backdrop")) return;
  e.stopPropagation();
  actions[el.dataset.act]?.(el);
});
document.addEventListener("change", (e) => {
  const s = e.target.closest("[data-change]");
  if (!s) return;
  const [, kind] = s.dataset.change.split("-");
  state.sort[kind] = s.value;
  render();
});

// Pesquisa global
let qTimer;
$("#q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const v = $("#q").value.trim();
    location.replace(v ? `#/search/${encodeURIComponent(v)}` : "#/");
    if (!v) render();
  }, 200);
  $("#qClear").hidden = !$("#q").value;
});
$("#qClear").addEventListener("click", () => { $("#q").value = ""; $("#qClear").hidden = true; nav("#/"); $("#q").focus(); });
$("#navSearch").addEventListener("click", () => { window.scrollTo(0, 0); $("#q").focus(); });

/* =========================================================
 * Autenticação
 * ======================================================= */
let pendingLoginError = null;
function showLogin() {
  $("#appShell").hidden = true; $("#loginScreen").hidden = false;
  const err = $("#loginError");
  err.hidden = !pendingLoginError; err.textContent = pendingLoginError || "";
  pendingLoginError = null;
  $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Entrar";
}
function showApp() { $("#loginScreen").hidden = true; $("#appShell").hidden = false; $("#logoutBtn").hidden = !REQUIRE_LOGIN; }

const authMsg = (e) => ({
  "auth/invalid-credential": "E-mail ou senha incorretos.",
  "auth/invalid-email": "E-mail inválido.",
  "auth/user-disabled": "Esta conta foi desativada.",
  "auth/too-many-requests": "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem conexão com a internet.",
}[e.code] || "Não foi possível entrar. Tente novamente.");

$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#loginEmail").value.trim(), pass = $("#loginPass").value;
  const err = $("#loginError"); err.hidden = true;
  if (!email || !pass) { err.textContent = "Informe e-mail e senha."; err.hidden = false; return; }
  $("#loginBtn").disabled = true; $("#loginBtn").textContent = "Entrando…";
  try { await signInWithEmailAndPassword(auth, email, pass); }
  catch (ex) { err.textContent = authMsg(ex); err.hidden = false; $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Entrar"; }
});
$("#logoutBtn").addEventListener("click", async () => {
  if (await confirmDialog({ title: "Sair", message: "Deseja sair da sua conta?", confirmLabel: "Sair" })) signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  stopListeners();
  state.user = null;
  if (!user) {
    if (REQUIRE_LOGIN) { showLogin(); return; }
    showApp();
    $("#view").innerHTML = `<div class="loader"><div class="spin"></div><span>Abrindo biblioteca…</span></div>`;
    try { await signInAnonymously(auth); }
    catch (e) {
      const hints = {
        "auth/network-request-failed": "Sem conexão com a internet.",
        "auth/unauthorized-domain": `Este site (${location.hostname}) não está autorizado. No Firebase: Authentication → Configurações → Domínios autorizados → Adicionar domínio → ${location.hostname}`,
        "auth/operation-not-allowed": "O login Anônimo está desativado. Ative em Authentication → Sign-in method → Anônimo.",
        "auth/admin-restricted-operation": "O login Anônimo está desativado ou restrito. Ative em Authentication → Sign-in method → Anônimo.",
        "auth/api-key-not-valid.-please-pass-a-valid-api-key.": `Chave de API inválida. Trecho da chave em uso neste site: ${firebaseConfig.apiKey.slice(8, 24)} (o correto é YBVwu1_YryRGcK06). Se estiver diferente, o arquivo antigo ainda está publicado ou em cache.`,
        ["auth/requests-from-referer-" + location.origin + "-are-blocked."]: "A chave de API do Google Cloud bloqueia este site. Libere o domínio em APIs e serviços → Credenciais → chave de navegador → Restrições de sites.",
      };
      const hint = hints[e.code] || "Não foi possível iniciar a sessão. Veja o código abaixo e o README.";
      $("#view").innerHTML = `<div class="empty"><div class="empty-ico">🔒</div><h3>Não foi possível abrir</h3><p>${esc(hint)}</p><p class="muted">Código: ${esc(e.code || e.message || "desconhecido")}</p><button class="btn gold" onclick="location.reload()">Tentar novamente</button></div>`;
    }
    return;
  }
  if (REQUIRE_LOGIN) try {
    const tok = await user.getIdTokenResult();
    if (tok.claims.admin !== true) {
      pendingLoginError = "Esta conta não tem permissão de administrador. Veja no README como conceder o acesso (custom claim).";
      await signOut(auth);
      return;
    }
  } catch (e) { pendingLoginError = authMsg(e); await signOut(auth); return; }
  state.user = user;
  showApp();
  idb.keys().then((k) => { k.forEach((x) => offlineIds.add(x)); scheduleRender(); }).catch(() => {});
  startListeners();
  render();
});

/* =========================================================
 * PWA: service worker, atualização e estado de rede
 * ======================================================= */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("service-worker.js").then((reg) => {
    const offerUpdate = (w) => {
      $("#updateBar").hidden = false;
      $("#updateBtn").onclick = () => w.postMessage({ type: "SKIP_WAITING" });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offerUpdate(w); });
    });
  }).catch((e) => console.warn("SW", e));
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
const netUpdate = () => { $("#netBar").hidden = navigator.onLine; };
window.addEventListener("online", netUpdate);
window.addEventListener("offline", netUpdate);
netUpdate();
