/* Aeon Videos — vanilla JS, works from file://. Data: data.js (const VIDEOS).
   Favorites + watched marks live in localStorage; served by server.py they sync through /api/state;
   on the Netlify deploy a logged-in user (Netlify Identity) syncs them through a per-user Netlify Function. */
(function () {
  "use strict";

  var BATCH = 48;
  var LENGTHS = [
    { id: "short", label: "Under 10 min", phrase: "under 10 minutes", test: function (s) { return s < 600; } },
    { id: "mid", label: "10–30 min", phrase: "of 10–30 minutes", test: function (s) { return s >= 600 && s < 1800; } },
    { id: "long", label: "30 min +", phrase: "of 30 minutes or more", test: function (s) { return s >= 1800; } }
  ];
  var VIEWS = [
    { id: "", label: "All" },
    { id: "unwatched", label: "Unwatched" },
    { id: "watched", label: "Watched" },
    { id: "fav", label: "Favorites" }
  ];
  // Topic lenses: keyword families matched on title + abstract (a second axis across the 5 broad categories).
  var TOPICS = [
    { id: "space", label: "Space", re: /\b(space|universe|cosm|planet|galax|astronom|stars?\b|moon|solar|astronaut|black holes?)/ },
    { id: "animals", label: "Animals", re: /\b(animals?\b|birds?\b|insect|octop|whales?\b|dogs?\b|cats?\b|fish|bees?\b|wol(f|ves)|ants?\b|creature|species|wildlife|apes?\b|monkey|chimp|horse|elephant|spider|crows?\b)/ },
    { id: "nature", label: "Nature & climate", re: /\b(climate|forest|ocean|seas?\b|rivers?\b|trees?\b|glacier|ice\b|mountain|environment|wilderness|landscape|volcan)/ },
    { id: "mind", label: "Mind & brain", re: /\b(brain|minds?\b|conscious|memor|neuro|perception|dreams?\b|dreaming|cognit|emotion)/ },
    { id: "wellbeing", label: "Wellbeing", re: /\b(anxi|depress|grie|lonel|mental|trauma|therap|happiness|stress|meditat|addict)/ },
    { id: "music", label: "Music & dance", re: /\b(music|musician|songs?\b|sing(s|er|ers|ing)?\b|jazz|orchestra|compos(er|ers|ition)|piano|violin|danc)/ },
    { id: "art", label: "Art & writing", re: /\b(artists?\b|art\b|paint|sculpt|design|architect|photograph|poet|poem|novel|writer)/ },
    { id: "animation", label: "Animation", re: /\banimat/ },
    { id: "history", label: "History", re: /\b(histor|ancient|wars?\b|centur|empire|medieval|prehistor|archaeolog)/ },
    { id: "physics", label: "Physics & maths", re: /\b(physic|quantum|math|relativity|particle|infinit|einstein)/ },
    { id: "tech", label: "Technology & AI", re: /\b(technolog|robot|artificial intelligence|ai\b|computer|internet|algorithm|machines?\b|digital|smartphone)/ },
    { id: "family", label: "Childhood & family", re: /\b(child|kids?\b|family|families|parent|mother|father|babies|baby|grandm|grandf|brother|sister)/ },
    { id: "love", label: "Love", re: /\b(love|romanc|marri|friendship|relationship|intimac|lovers?\b)/ },
    { id: "death", label: "Death", re: /\b(death|dying|die\b|dies\b|mortal|afterlife|funeral|grave)/ },
    { id: "religion", label: "Faith & ritual", re: /\b(gods?\b|religio|faith|spiritual|buddh|christian|islam|muslim|monk|ritual|sacred|church|temple)/ },
    { id: "cities", label: "Cities", re: /\b(city|cities|urban|streets?\b|london|new york|paris)/ },
    { id: "food", label: "Food", re: /\b(food|cook|eating|chef|farm|bread|kitchen|recipe)/ },
    { id: "japan", label: "Japan", re: /\b(japan|tokyo|kyoto|osaka)/ },
    { id: "china", label: "China", re: /\b(china|chinese|beijing|shanghai|hong kong|tibet)/ }
  ];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var ICON_HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3l-1.2-1.1C6.4 15.2 3.5 12.6 3.5 9.3 3.5 6.7 5.5 4.7 8.1 4.7c1.5 0 2.9.7 3.9 1.8 1-1.1 2.4-1.8 3.9-1.8 2.6 0 4.6 2 4.6 4.6 0 3.3-2.9 5.9-7.3 9.9L12 20.3z"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.5l4.8 4.8L19.5 7"/></svg>';

  var $ = function (id) { return document.getElementById(id); };
  var grid = $("grid"), q = $("q"), chipsEl = $("chips"), lengthsEl = $("lengths"), topicsEl = $("topics"),
      yearEl = $("year"), viewsEl = $("views"), hideEl = $("hidew"),
      statusEl = $("status"), emptyEl = $("empty"), sentinel = $("sentinel"),
      groupEl = $("group"), toolbar = $("toolbar"), totop = $("totop"), toastEl = $("toast");

  // ── helpers ──────────────────────────────────────────
  function fold(s) { return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"'); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmtDate(iso) { var d = new Date(iso); return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear(); }
  function fmtDur(s) {
    var m = Math.round(s / 60);
    if (m < 1) return s + " seconds";
    if (m < 60) return m + (m === 1 ? " minute" : " minutes");
    var h = Math.floor(m / 60), r = m % 60;
    return h + (h === 1 ? " hour" : " hours") + (r ? " " + r + (r === 1 ? " minute" : " minutes") : "");
  }
  function fmtTotal(s) { var h = s / 3600; return h < 2 ? Math.round(s / 60) + " minutes" : Math.round(h).toLocaleString("en-US") + " hours"; }
  function fmtClock(s) { var m = Math.floor(s / 60), r = s % 60, h = Math.floor(m / 60); m = m % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(r).padStart(2, "0"); }
  function fmtN(n) { return n.toLocaleString("en-US"); }
  function thumb(u, w) { return u + (u.indexOf("?") < 0 ? "?" : "&") + "width=" + w + "&quality=75&format=webp"; }
  function source(p) {
    var m;
    if ((m = p.match(/youtube\.com\/embed\/([\w-]+)/))) return { name: "YouTube", url: "https://www.youtube.com/watch?v=" + m[1] };
    if ((m = p.match(/player\.vimeo\.com\/video\/(\d+)/))) return { name: "Vimeo", url: "https://vimeo.com/" + m[1] };
    if (/nfb\.ca/.test(p)) return { name: "NFB", url: p };
    return null;
  }
  function byId(arr, id) { for (var k = 0; k < arr.length; k++) if (arr[k].id === id) return arr[k]; return null; }
  function store() { // localStorage, or an in-memory stand-in when the browser refuses it (some file:// setups)
    try { var t = "__aeon"; localStorage.setItem(t, t); localStorage.removeItem(t); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = String(v); }, removeItem: function (k) { delete m[k]; } }; }
  }
  var LS = store();
  function readJSON(k) { try { return JSON.parse(LS.getItem(k) || "null"); } catch (e) { return null; } }
  function writeJSON(k, v) { try { LS.setItem(k, JSON.stringify(v)); } catch (e) { /* quota: keep going in memory */ } }

  // ── favorites + watched: one UX, three backends ──
  //   1. Netlify deploy, logged in  -> per-user state via the Netlify Function (Identity JWT)
  //   2. served by server.py        -> shared /api/state, exactly as before
  //   3. file:// or logged out      -> this browser's localStorage only
  // The page always starts in mode 2 when served over http(s): GET api/state. server.py answers with
  // the saved state; the Netlify Function answers {"auth":"identity"}, which switches to mode 3 and
  // loads the Identity widget. A missing /api is not an error: marks simply stay in this browser.
  var Marks = (function () {
    var BASE_KEY = "aeon-videos:marks:v1";
    var KEY = BASE_KEY, videos = {}, dirty = {};
    var device = LS.getItem("aeon-videos:device");
    if (!device) {
      device = "d-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
      LS.setItem("aeon-videos:device", device);
    }
    var api = /^https?:$/.test(location.protocol) ? "api/state" : null;
    var token = null;      // fn -> Promise<jwt> while logged in on the Netlify deploy
    var account = null;    // {id, email} while logged in
    var identity = false;  // the deploy offers accounts (learned from the first /api/state answer)
    var gen = 0;           // bumps on every login/logout so late answers from the old scope are dropped
    var online = false, pushTimer = null, inflight = false, lastSync = 0, listeners = [], identityHooks = [];

    function load(key) {
      var saved = readJSON(key) || {};
      KEY = key; videos = saved.videos || {}; dirty = saved.dirty || {};
    }
    load(BASE_KEY);
    function persist() { writeJSON(KEY, { videos: videos, dirty: dirty }); }
    function get(url) { return videos[url] || null; }
    function isFav(url) { var e = videos[url]; return !!(e && e.favorite); }
    function isWatched(url) { var e = videos[url]; return !!(e && e.watched); }
    function set(url, field, val) {
      var o = videos[url] || { favorite: false, watched: false, updated_at: 0 };
      var e = { favorite: o.favorite, watched: o.watched, updated_at: Math.max(Date.now(), (o.updated_at || 0) + 1), device: device };
      e[field] = !!val;
      videos[url] = e; dirty[url] = 1;
      persist(); schedulePush(700);
    }
    function mergeRemote(remote) {
      var changed = [];
      Object.keys(remote || {}).forEach(function (url) {
        var r = remote[url], l = videos[url];
        if (!r || typeof r.updated_at !== "number") return;
        if (!l || r.updated_at > (l.updated_at || 0)) {
          if (!l || l.favorite !== r.favorite || l.watched !== r.watched) changed.push(url);
          videos[url] = { favorite: !!r.favorite, watched: !!r.watched, updated_at: r.updated_at, device: r.device || "" };
          delete dirty[url];
        } else if (l && r.updated_at === l.updated_at) {
          delete dirty[url];
        }
      });
      persist();
      return changed;
    }
    function emit(changed) { listeners.forEach(function (fn) { fn(changed); }); }
    function request(method, body) {
      var url = api;
      return (token ? token() : Promise.resolve(null)).then(function (jwt) {
        var h = body ? { "Content-Type": "application/json" } : {};
        if (jwt) h.Authorization = "Bearer " + jwt;
        return fetch(url, {
          method: method, cache: "no-store", keepalive: method === "PUT" && body.length < 60000,
          headers: h, body: body || undefined
        });
      }).then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    }
    function done(st) {
      if (st && st.auth === "identity" && !token) {
        // The Netlify deploy, nobody logged in: keep marks in this browser and offer accounts.
        api = null; online = false; inflight = false;
        if (!identity) { identity = true; identityHooks.forEach(function (fn) { fn(); }); }
        emit([]);
        return;
      }
      online = true; lastSync = Date.now();
      var changed = mergeRemote(st && st.videos);
      emit(changed);
      if (Object.keys(dirty).length) schedulePush(50);
    }
    function guard(g, fn) { return function (x) { if (g === gen) fn(x); }; }
    function pull() {
      if (!api || inflight) return;
      inflight = true;
      var g = gen;
      request("GET").then(guard(g, done), guard(g, function () { online = false; emit([]); }))
        .then(guard(g, function () { inflight = false; }));
    }
    function push() {
      pushTimer = null;
      if (!api) return;
      if (inflight) { schedulePush(400); return; }
      var keys = Object.keys(dirty);
      if (!keys.length) return;
      var body = { device: device, videos: {} };
      keys.forEach(function (k) { var e = videos[k]; if (e) body.videos[k] = { favorite: e.favorite, watched: e.watched, updated_at: e.updated_at }; });
      inflight = true;
      var g = gen;
      request("PUT", JSON.stringify(body)).then(guard(g, done), guard(g, function () { online = false; emit([]); schedulePush(30000); }))
        .then(guard(g, function () { inflight = false; }));
    }
    function schedulePush(ms) { if (!api) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, ms); }
    function counts() {
      var f = 0, w = 0;
      Object.keys(videos).forEach(function (k) { if (videos[k].favorite) f++; if (videos[k].watched) w++; });
      return { fav: f, watched: w };
    }
    function all() { return Object.keys(videos); }
    // Log in: switch to this user's own local cache, hand over anything marked while logged out
    // (newer entry wins), then sync with the user's server state.
    function useAccount(id, email, tokenFn) {
      if (account && account.id === id) { account.email = email; token = tokenFn; emit([]); return; }
      var before = all();
      var anon = readJSON(BASE_KEY) || {}, anonVideos = anon.videos || {};
      gen++; clearTimeout(pushTimer); inflight = false; online = false;
      load(BASE_KEY + ":user:" + id);
      Object.keys(anonVideos).forEach(function (u) {
        var a = anonVideos[u], l = videos[u];
        if (a && (!l || (a.updated_at || 0) > (l.updated_at || 0))) { videos[u] = a; dirty[u] = 1; }
      });
      persist();
      writeJSON(BASE_KEY, { videos: {}, dirty: {} }); // now held by the account
      account = { id: id, email: email }; token = tokenFn; api = "/.netlify/functions/state"; identity = true;
      emit(before.concat(all()));
      pull();
    }
    // Log out: back to an empty, browser-only scope (the account's marks stay on the server).
    function useAnonymous() {
      if (!account) { emit([]); return; }
      var before = all();
      gen++; clearTimeout(pushTimer); inflight = false; online = false;
      account = null; token = null; api = null;
      load(BASE_KEY);
      emit(before.concat(all()));
    }
    if (/^https?:$/.test(location.protocol)) {
      document.addEventListener("visibilitychange", function () {
        if (!api) return;
        if (document.visibilityState === "visible") { if (Date.now() - lastSync > 5000) pull(); }
        else if (Object.keys(dirty).length) push();
      });
      addEventListener("pagehide", function () { if (api && Object.keys(dirty).length) push(); });
      // Another device may toggle while this one sits open: a light poll while the page is visible.
      setInterval(function () { if (api && document.visibilityState === "visible" && Date.now() - lastSync > 50000) pull(); }, 60000);
    }
    return {
      get: get, isFav: isFav, isWatched: isWatched, set: set, pull: pull, counts: counts,
      useAccount: useAccount, useAnonymous: useAnonymous,
      onChange: function (fn) { listeners.push(fn); },
      onIdentity: function (fn) { identityHooks.push(fn); if (identity) fn(); },
      status: function () {
        return { api: !!api, online: online, pending: Object.keys(dirty).length, lastSync: lastSync,
                 identity: identity, account: account };
      }
    };
  })();

  // Pre-compute display + search fields once.
  var ALL = VIDEOS.map(function (v, i) {
    var hay = fold(v.title + " \u0001 " + v.description);
    return {
      v: v, i: i, hay: hay,
      date: fmtDate(v.publication_date),
      year: v.publication_date.slice(0, 4),
      topics: TOPICS.filter(function (t) { return t.re.test(hay); }).map(function (t) { return t.id; })
    };
  });
  var YEARS = (function () {
    var y = {}; ALL.forEach(function (x) { y[x.year] = 1; });
    return Object.keys(y).sort().reverse();
  })();
  var CATS = (function () {
    var c = {}; VIDEOS.forEach(function (v) { c[v.category] = (c[v.category] || 0) + 1; });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || a.localeCompare(b); });
  })();

  var RESUME_KEY = "aeon-videos:resume:v1";
  // Netlify Identity e-mail links (confirm signup, invite, recovery, email change) land as #..._token=…;
  // hold that hash for the widget instead of reading it as filters or overwriting it.
  var authHash = /(^|[#&])((confirmation|invite|recovery|email_change)_token|access_token)=|error=access_denied/.test(location.hash) ? location.hash : "";
  var state = authHash ? parseHash("") : readHash();
  var resume = readJSON(RESUME_KEY);
  if ((!location.hash || authHash) && resume && Date.now() - resume.t < 24 * 3600 * 1000 && resume.hash) {
    state = parseHash(resume.hash); // reopen where this device left off (within a day)
  }
  var list = [], shown = 0, items = [], pq = parseQuery("");

  // ── search: words are ANDed; "-word" excludes; "quoted phrases" match exactly ──
  function parseQuery(s) {
    var inc = [], exc = [], m, re = /(-?)"([^"]*)"?|(-?)(\S+)/g, f = fold(s);
    while ((m = re.exec(f))) {
      var neg = m[1] || m[3], t = (m[2] !== undefined ? m[2] : m[4]).trim();
      if (!t || t === "-") continue;
      (neg ? exc : inc).push(t);
    }
    return { inc: inc, exc: exc };
  }
  function hl(text, ts) {
    var s = esc(text);
    if (!ts.length) return s;
    var re = new RegExp("(" + ts.map(function (t) { return esc(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }).join("|") + ")", "gi");
    return s.replace(re, "<mark>$1</mark>");
  }

  // ── state <-> URL hash (so a refresh or bookmark keeps the view) ──
  function parseHash(h) {
    var p = new URLSearchParams(h.replace(/^#/, ""));
    return {
      q: p.get("q") || "",
      cat: p.get("cat") || "",
      len: byId(LENGTHS, p.get("len")) ? p.get("len") : "",
      year: p.get("year") || "",
      topic: byId(TOPICS, p.get("topic")) ? p.get("topic") : "",
      view: byId(VIEWS, p.get("view")) ? p.get("view") : "",
      hide: p.get("hide") === "1",
      sort: p.get("sort") === "asc" ? "asc" : "desc",
      group: p.get("group") === "1"
    };
  }
  function readHash() { return parseHash(location.hash); }
  function hashString() {
    var p = new URLSearchParams();
    if (state.q) p.set("q", state.q);
    if (state.view) p.set("view", state.view);
    if (state.hide) p.set("hide", "1");
    if (state.cat) p.set("cat", state.cat);
    if (state.len) p.set("len", state.len);
    if (state.year) p.set("year", state.year);
    if (state.topic) p.set("topic", state.topic);
    if (state.sort === "asc") p.set("sort", "asc");
    if (state.group) p.set("group", "1");
    return p.toString();
  }
  function writeHash() {
    if (authHash) return;
    var h = hashString();
    try { history.replaceState(null, "", h ? "#" + h : location.pathname + location.search); } catch (e) { /* file:// in some browsers */ }
  }

  // ── filtering: each axis is a test; counts for one axis honour all the others ──
  function viewOK(x, view, hide) {
    var u = x.v.url, w = Marks.isWatched(u);
    if (hide && w && view !== "watched") return false;
    if (view === "unwatched") return !w;
    if (view === "watched") return w;
    if (view === "fav") return Marks.isFav(u);
    return true;
  }
  function textOK(x) {
    for (var k = 0; k < pq.inc.length; k++) if (x.hay.indexOf(pq.inc[k]) < 0) return false;
    for (k = 0; k < pq.exc.length; k++) if (x.hay.indexOf(pq.exc[k]) >= 0) return false;
    return true;
  }
  // Returns the list of axis names x fails (stops at two — only 0 or 1 failures matter for counting).
  function fails(x, len) {
    var f = [];
    if (!textOK(x)) f.push("q");
    if (state.cat && x.v.category !== state.cat) f.push("cat");
    if (f.length > 1) return f;
    if (len && !len.test(x.v.duration)) f.push("len");
    if (f.length > 1) return f;
    if (state.year && x.year !== state.year) f.push("year");
    if (f.length > 1) return f;
    if (state.topic && x.topics.indexOf(state.topic) < 0) f.push("topic");
    if (f.length > 1) return f;
    if (!viewOK(x, state.view, state.hide)) f.push("view");
    return f;
  }

  var C; // counts per axis from the last pass
  function scan() {
    pq = parseQuery(state.q);
    var len = byId(LENGTHS, state.len), out = [];
    C = { cat: {}, len: {}, year: {}, topic: {}, view: { "": 0, unwatched: 0, watched: 0, fav: 0 }, catAll: 0, yearAll: 0, topicAll: 0 };
    ALL.forEach(function (x) {
      var f = fails(x, len);
      if (f.length > 1) return;
      var only = f[0];
      if (!only) out.push(x);
      if (!only || only === "cat") { C.cat[x.v.category] = (C.cat[x.v.category] || 0) + 1; C.catAll++; }
      if (!only || only === "len") LENGTHS.forEach(function (L) { if (L.test(x.v.duration)) C.len[L.id] = (C.len[L.id] || 0) + 1; });
      if (!only || only === "year") { C.year[x.year] = (C.year[x.year] || 0) + 1; C.yearAll++; }
      if (!only || only === "topic") { x.topics.forEach(function (t) { C.topic[t] = (C.topic[t] || 0) + 1; }); C.topicAll++; }
      if (!only || only === "view") {
        var w = Marks.isWatched(x.v.url);
        C.view[""]++;
        if (w) C.view.watched++; else C.view.unwatched++;
        if (Marks.isFav(x.v.url)) C.view.fav++;
      }
    });
    return out;
  }

  function compute() {
    list = scan();
    if (state.sort === "asc") list.reverse(); // data.js is already date-desc, title tie-break
    if (state.group) {
      var by = {};
      list.forEach(function (x) { (by[x.v.category] = by[x.v.category] || []).push(x); });
      var cats = Object.keys(by).sort(function (a, b) { return by[b].length - by[a].length || a.localeCompare(b); });
      items = [];
      cats.forEach(function (c) { items.push({ head: c, n: by[c].length }); by[c].forEach(function (x) { items.push(x); }); });
    } else {
      items = list;
    }
  }

  function renderControls() {
    chipsEl.innerHTML = chip("", "All", C.catAll, !state.cat, "cat") + CATS.map(function (c) { return chip(c, c, C.cat[c] || 0, state.cat === c, "cat"); }).join("");
    lengthsEl.innerHTML = LENGTHS.map(function (L) { return chip(L.id, L.label, C.len[L.id] || 0, state.len === L.id, "len"); }).join("");
    topicsEl.innerHTML = '<span class="row-label">Topics</span>' + TOPICS.map(function (t) {
      return chip(t.id, t.label, C.topic[t.id] || 0, state.topic === t.id, "topic");
    }).join("");
    yearEl.innerHTML = '<option value="">Any year</option>' + YEARS.map(function (y) {
      return '<option value="' + y + '"' + (state.year === y ? " selected" : "") + ">" + y + " (" + fmtN(C.year[y] || 0) + ")</option>";
    }).join("");
    yearEl.value = state.year;
    yearEl.classList.toggle("on", !!state.year);
    renderViews();
  }
  function renderViews() {
    var mc = Marks.counts();
    viewsEl.innerHTML = VIEWS.map(function (V) {
      var n = V.id === "fav" ? mc.fav : V.id === "watched" ? mc.watched : null;
      return '<button type="button" data-view="' + V.id + '" aria-pressed="' + (state.view === V.id) + '">' +
        (V.id === "fav" ? '<span class="vh">' + ICON_HEART + "</span>" : "") + esc(V.label) +
        (n !== null ? '<span class="n">' + fmtN(n) + "</span>" : "") + "</button>";
    }).join("");
    var off = state.view === "watched" || state.view === "unwatched";
    hideEl.checked = state.hide && !off;
    hideEl.disabled = off;
    hideEl.parentNode.classList.toggle("off", off);
  }
  function chip(val, label, n, on, kind) {
    return '<button type="button" class="chip" data-' + kind + '="' + esc(val) + '" aria-pressed="' + on + '"' + (n || on ? "" : " data-zero") + ">" +
      esc(label) + '<span class="n">' + fmtN(n) + "</span></button>";
  }

  // ── rendering (incremental: 48 cards at a time as you scroll) ──
  function markClasses(u) { return (Marks.isFav(u) ? " is-fav" : "") + (Marks.isWatched(u) ? " is-watched" : ""); }
  function actsHTML(u) {
    var f = Marks.isFav(u), w = Marks.isWatched(u);
    return '<div class="acts">' +
      '<button type="button" class="act fav" data-act="favorite" aria-pressed="' + f + '" aria-label="Favorite" title="Favorite">' + ICON_HEART + "</button>" +
      '<button type="button" class="act seen" data-act="watched" aria-pressed="' + w + '" aria-label="Watched" title="Mark as watched">' + ICON_CHECK + "</button>" +
      "</div>";
  }
  function cardHTML(x, lead) {
    var v = x.v, ts = pq.inc, s = source(v.player_loc);
    return '<article class="card' + (lead ? " lead" : "") + markClasses(v.url) + '" data-i="' + x.i + '">' +
      '<div class="media">' +
        '<a class="thumb" href="' + esc(v.url) + '" target="_blank" rel="noopener" tabindex="-1" aria-hidden="true">' +
          '<img loading="lazy" decoding="async" alt="" src="' + esc(thumb(v.thumbnail_loc, lead ? 960 : 640)) + '">' +
          '<span class="play"></span><span class="seen-badge">Watched</span><span class="dur">' + fmtClock(v.duration) + "</span></a>" +
        actsHTML(v.url) +
      "</div>" +
      '<div class="body">' +
        '<div class="meta"><button type="button" class="cat" data-cat="' + esc(v.category) + '">' + esc(v.category) + "</button>" +
          '<span class="dot"></span><time datetime="' + esc(v.publication_date) + '">' + x.date + "</time>" +
          '<span class="dot"></span><span>' + fmtDur(v.duration) + "</span></div>" +
        '<h3><a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + hl(v.title, ts) + "</a></h3>" +
        '<p class="abs">' + hl(v.description, ts) + "</p>" +
        (s ? '<p class="src">Also on <a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + s.name + "</a></p>" : "") +
      "</div></article>";
  }
  function isDefaultView() {
    return !state.q && !state.cat && !state.len && !state.year && !state.topic && !state.view && !state.hide && !state.group && state.sort === "desc";
  }
  function renderMore() {
    if (shown >= items.length) return;
    var end = Math.min(items.length, shown + BATCH), html = "";
    var leadable = isDefaultView();
    for (var k = shown; k < end; k++) {
      var it = items[k];
      html += it.head ? '<div class="group-head"><h2>' + esc(it.head) + "</h2><span>" + fmtN(it.n) + (it.n === 1 ? " film" : " films") + "</span></div>"
                      : cardHTML(it, leadable && k === 0);
    }
    grid.insertAdjacentHTML("beforeend", html);
    shown = end;
    // If the sentinel is still on screen (tall viewport), keep filling.
    if (shown < items.length && sentinel.getBoundingClientRect().top < innerHeight + 1200) requestAnimationFrame(renderMore);
  }
  function renderStatus() {
    var n = list.length, V = byId(VIEWS, state.view);
    var bits = ["<b>" + fmtN(n) + "</b> " + (state.view === "fav" ? (n === 1 ? "favorite" : "favorites") : state.view ? V.label.toLowerCase() + " " + (n === 1 ? "film" : "films") : (n === 1 ? "film" : "films"))];
    if (state.cat) bits.push("in " + esc(state.cat));
    if (state.topic) bits.push("on " + esc(byId(TOPICS, state.topic).label.replace(/^(?!Japan|China)./, function (c) { return c.toLowerCase(); })));
    if (state.year) bits.push("from " + esc(state.year));
    if (state.len) bits.push(esc(byId(LENGTHS, state.len).phrase));
    if (state.q.trim()) bits.push("matching “" + esc(state.q.trim()) + "”");
    if (state.hide && state.view !== "watched" && state.view !== "unwatched") bits.push("(watched hidden)");
    var secs = 0; list.forEach(function (x) { secs += x.v.duration; });
    statusEl.innerHTML = bits.join(" ") + (n ? " · " + fmtTotal(secs) + " of viewing" : "");
  }
  function render() {
    compute();
    renderControls();
    grid.innerHTML = "";
    shown = 0;
    emptyEl.hidden = list.length > 0;
    $("empty-hint").textContent = state.view === "fav" && !Marks.counts().fav ? "Tap the heart on any film to keep it here." :
      state.view === "watched" && !Marks.counts().watched ? "Tap the tick on a film once you have seen it." : "Try fewer words, or clear the filters.";
    renderStatus();
    document.querySelectorAll("#sort button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.sort === state.sort)); });
    groupEl.checked = state.group;
    if (q.value !== state.q) q.value = state.q;
    renderMore();
    writeHash();
    saveResumeSoon();
  }
  // Marks changed (a tap here, or another device): patch cards in place — no reflow, so a mis-tap is easy to undo.
  function refreshMarks() {
    grid.querySelectorAll(".card").forEach(function (el) {
      var u = ALL[+el.dataset.i].v.url, f = Marks.isFav(u), w = Marks.isWatched(u);
      el.classList.toggle("is-fav", f); el.classList.toggle("is-watched", w);
      el.querySelector(".act.fav").setAttribute("aria-pressed", String(f));
      el.querySelector(".act.seen").setAttribute("aria-pressed", String(w));
    });
    list = scan();
    if (state.sort === "asc") list.reverse();
    renderControls();
    renderStatus();
    renderSync();
  }
  function renderSync() {
    var s = Marks.status(), el = $("sync");
    el.textContent = s.account ?
        (s.online ? (s.pending ? "Saving…" : "Signed in — favorites and watched marks sync across your devices.") :
          "Favorites and watched marks are saved in this browser" + (s.pending ? " — will sync when the connection is back." : ".")) :
      s.identity ? "Favorites and watched marks are saved in this browser. Log in to keep them on every device." :
      !s.api ? "Favorites and watched marks are saved in this browser." :
      s.online ? (s.pending ? "Saving…" : "Favorites and watched marks sync across your devices.") :
      "Favorites and watched marks are saved in this browser" + (s.pending ? " — will sync when the server is back." : ".");
    renderAccount();
  }

  // ── accounts (Netlify deploy only): netlify-identity-widget, loaded once the deploy says it offers them ──
  var IDENTITY_SRC = "https://identity.netlify.com/v1/netlify-identity-widget.js";
  var acctEl = $("account"), identityWidget = null, identityState = "";
  var PERSON = '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5c1.3-3.4 4-5.1 7.2-5.1s5.9 1.7 7.2 5.1"/></svg>';
  function renderAccount() {
    var s = Marks.status();
    var key = !identityWidget ? "" : s.account ? "in:" + (s.account.email || "") : "out";
    if (key === identityState) return;
    identityState = key;
    acctEl.hidden = !key;
    if (!key) { acctEl.innerHTML = ""; return; }
    acctEl.innerHTML = PERSON + (s.account ?
      '<span class="who" title="Signed in">' + esc(s.account.email || "Signed in") + '</span>' +
      '<button type="button" data-acct="logout">Log out</button>' :
      '<button type="button" data-acct="login">Log in</button><button type="button" class="primary" data-acct="signup">Sign up</button>');
  }
  acctEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-acct]");
    if (!b || !identityWidget) return;
    if (b.dataset.acct === "logout") identityWidget.logout(); else identityWidget.open(b.dataset.acct);
  });
  function releaseAuthHash() { if (authHash) { authHash = ""; writeHash(); } }
  function loadIdentity() {
    if (loadIdentity.started) return;
    loadIdentity.started = true;
    // The widget reads the e-mail-link token from the hash as it starts: put it back first.
    if (authHash) { try { history.replaceState(null, "", location.pathname + location.search + authHash); } catch (e) { /* ignore */ } }
    var sc = document.createElement("script");
    sc.src = IDENTITY_SRC; sc.async = true;
    sc.onload = function () {
      var ni = window.netlifyIdentity;
      if (!ni) { releaseAuthHash(); return; }
      identityWidget = ni;
      function signedIn(u) {
        if (u) Marks.useAccount(u.id, u.email, function () { return u.jwt(); });
        else Marks.useAnonymous();
      }
      ni.on("init", signedIn);
      ni.on("login", function (u) { signedIn(u); ni.close(); });
      ni.on("logout", function () { Marks.useAnonymous(); });
      signedIn(ni.currentUser()); // the widget may already have initialised while this script loaded
      setTimeout(releaseAuthHash, 0);
      renderSync();
    };
    sc.onerror = function () { releaseAuthHash(); }; // no accounts today; marks stay in this browser
    document.head.appendChild(sc);
  }
  Marks.onIdentity(loadIdentity);

  // ── resume: remember this device's view and scroll position ──
  var resumeTimer;
  function anchorCard() {
    var top = toolbar.getBoundingClientRect().bottom, cards = grid.querySelectorAll(".card");
    for (var k = 0; k < cards.length; k++) {
      var r = cards[k].getBoundingClientRect();
      if (r.bottom > top + 8) return { i: +cards[k].dataset.i, off: Math.round(r.top) };
    }
    return null;
  }
  function saveResume() {
    var a = scrollY > 300 ? anchorCard() : null;
    writeJSON(RESUME_KEY, { t: Date.now(), hash: hashString(), anchor: a });
  }
  function saveResumeSoon() { clearTimeout(resumeTimer); resumeTimer = setTimeout(saveResume, 400); }
  function restoreScroll() {
    if (!resume || !resume.anchor || resume.hash !== hashString() || Date.now() - resume.t > 24 * 3600 * 1000) return;
    var idx = -1;
    for (var k = 0; k < items.length; k++) if (items[k].i === resume.anchor.i) { idx = k; break; }
    if (idx < 0) return;
    while (shown <= idx) renderMore();
    var el = grid.querySelector('.card[data-i="' + resume.anchor.i + '"]');
    if (el) scrollTo(0, el.getBoundingClientRect().top + scrollY - resume.anchor.off);
  }

  // ── "did you finish it?" — offered when you come back from a film you opened ──
  var opened = null, toastTimer;
  function showToast(x) {
    clearTimeout(toastTimer);
    toastEl.innerHTML = '<span>Finished <i>' + esc(x.v.title) + '</i>?</span><button type="button" data-tact="watch">Mark watched</button><button type="button" class="x" data-tact="close" aria-label="Dismiss">×</button>';
    toastEl.dataset.url = x.v.url;
    toastEl.hidden = false;
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 12000);
  }
  toastEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.tact === "watch") { Marks.set(toastEl.dataset.url, "watched", true); refreshMarks(); }
    toastEl.hidden = true;
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !opened) return;
    var o = opened; opened = null;
    if (Date.now() - o.t > 60000 && !Marks.isWatched(o.x.v.url)) showToast(o.x);
  });

  // ── events ───────────────────────────────────────────
  var tq;
  q.addEventListener("input", function () { clearTimeout(tq); tq = setTimeout(function () { state.q = q.value; render(); }, 120); });
  chipsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    state.cat = b.dataset.cat === state.cat ? "" : b.dataset.cat; render();
  });
  lengthsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    state.len = b.dataset.len === state.len ? "" : b.dataset.len; render();
  });
  topicsEl.addEventListener("click", function (e) {
    var b = e.target.closest(".chip"); if (!b) return;
    state.topic = b.dataset.topic === state.topic ? "" : b.dataset.topic; render();
  });
  yearEl.addEventListener("change", function () { state.year = yearEl.value; render(); });
  viewsEl.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    state.view = b.dataset.view; render();
  });
  hideEl.addEventListener("change", function () { state.hide = hideEl.checked; render(); });
  grid.addEventListener("click", function (e) {
    var a = e.target.closest(".act");
    if (a) {
      var u = ALL[+a.closest(".card").dataset.i].v.url, field = a.dataset.act;
      Marks.set(u, field, field === "favorite" ? !Marks.isFav(u) : !Marks.isWatched(u));
      refreshMarks();
      return;
    }
    var link = e.target.closest("a[href]");
    if (link && !link.closest(".src")) { opened = { x: ALL[+link.closest(".card").dataset.i], t: Date.now() }; return; }
    var b = e.target.closest(".cat"); if (!b) return;
    state.cat = b.dataset.cat; render();
    toolbar.scrollIntoView({ behavior: "smooth" });
  });
  grid.addEventListener("load", function (e) { if (e.target.tagName === "IMG") e.target.classList.add("ok"); }, true);
  grid.addEventListener("error", function (e) { if (e.target.tagName === "IMG") { e.target.removeAttribute("src"); } }, true);
  document.querySelectorAll("#sort button").forEach(function (b) {
    b.addEventListener("click", function () { state.sort = b.dataset.sort; render(); });
  });
  groupEl.addEventListener("change", function () { state.group = groupEl.checked; render(); });
  $("reset").addEventListener("click", function () {
    state.q = ""; state.cat = ""; state.len = ""; state.year = ""; state.topic = ""; state.view = ""; state.hide = false;
    render(); q.focus();
  });
  $("shuffle").addEventListener("click", function () {
    if (!list.length) return;
    var pool = list.filter(function (x) { return !Marks.isWatched(x.v.url); });
    if (!pool.length) pool = list;
    var x = pool[Math.floor(Math.random() * pool.length)];
    var idx = items.indexOf(x);
    while (shown <= idx) renderMore();
    var el = grid.querySelector('.card[data-i="' + x.i + '"]');
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    var t = el.querySelector(".thumb"); t.classList.remove("flash"); void t.offsetWidth; t.classList.add("flash");
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); q.select(); }
    else if (e.key === "Escape" && document.activeElement === q) { q.blur(); }
  });
  totop.addEventListener("click", function () { scrollTo({ top: 0, behavior: "smooth" }); });

  new IntersectionObserver(function (es) { if (es[0].isIntersecting) renderMore(); }, { rootMargin: "1200px 0px" }).observe(sentinel);
  // Belt and braces for fast flings: also top up on scroll when the sentinel is near.
  var ticking = false;
  addEventListener("scroll", function () {
    saveResumeSoon();
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () { ticking = false; if (sentinel.getBoundingClientRect().top < innerHeight + 1200) renderMore(); });
  }, { passive: true });
  addEventListener("pagehide", saveResume);
  var mast = document.querySelector(".masthead");
  new IntersectionObserver(function (es) {
    var past = !es[0].isIntersecting;
    toolbar.classList.toggle("stuck", past); totop.hidden = !past;
  }).observe(mast);

  // ── masthead copy from the data itself ──
  var first = VIDEOS[VIDEOS.length - 1], last = VIDEOS[0], hours = 0;
  VIDEOS.forEach(function (v) { hours += v.duration; });
  $("standfirst").textContent = fmtN(VIDEOS.length) + " short documentaries and animations on ideas, science and culture, curated by Aeon from " +
    new Date(first.publication_date).getUTCFullYear() + " to " + new Date(last.publication_date).getUTCFullYear() + " — about " + Math.round(hours / 3600) + " hours of viewing.";
  $("fine").textContent = "Archive current to " + fmtDate(last.publication_date) + ". Refresh with ./update.sh.";

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  Marks.onChange(function (changed) {
    // A remote change can remove cards from a mark-dependent view; only re-flow when nothing on screen would jump.
    if (changed.length && (state.view || state.hide) && scrollY < 200) render(); else refreshMarks();
  });
  render();
  restoreScroll();
  renderSync();
  if (authHash) loadIdentity();
  Marks.pull();
})();
