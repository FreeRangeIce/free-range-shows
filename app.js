/* FreeRangeShows — separate from FreeRangeMedia.
   Library key is freerangeshows-v1 only.
   Backup app id is free-range-shows. Media-shelf files are refused.
   Restore asks before replace-all.
   API keys live in freerangeshows-keys and are never written into a backup. */
(() => {
  "use strict";

  const STORAGE_KEY = "freerangeshows-v1";
  const KEYS_KEY = "freerangeshows-keys";
  const SETLIST_RELAY = "https://frs-setlist.freerangeice.workers.dev/setlists";
  const BACKUP_APP = "free-range-shows";
  const BACKUP_VERSION = 1;
  const KINDS = ["Concert", "Comedy", "Festival", "Musical", "Screening", "Other"];
  const app = document.querySelector("#app");

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function localToday() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function norm(name) {
    return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function emptyStore() {
    return { nights: [], acts: {}, rev: 0 };
  }

  function readStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.nights)) return emptyStore();
      data.acts = data.acts && typeof data.acts === "object" ? data.acts : {};
      data.rev = Number(data.rev) || 0;
      return data;
    } catch {
      return emptyStore();
    }
  }

  function currentRev() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return 0;
      return Number(JSON.parse(raw).rev) || 0;
    } catch {
      return 0;
    }
  }

  /* Write only if rev is still the one we read. A second tab that wrote
     in between makes this return false so the caller can re-read and merge. */
  function writeStore(data, basedOnRev) {
    if (currentRev() !== basedOnRev) return false;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      nights: data.nights,
      acts: data.acts || {},
      rev: basedOnRev + 1,
    }));
    return true;
  }

  function commitStore(mutator) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = readStore();
      const next = {
        nights: before.nights.map((n) => ({ ...n })),
        acts: { ...before.acts },
        rev: before.rev,
      };
      mutator(next);
      if (writeStore(next, before.rev)) return true;
    }
    return false;
  }

  function readKeys() {
    try {
      const raw = localStorage.getItem(KEYS_KEY);
      const data = raw ? JSON.parse(raw) : {};
      return {
        ticketmaster: String(data.ticketmaster || ""),
        seatgeek: String(data.seatgeek || ""),
      };
    } catch {
      return { ticketmaster: "", seatgeek: "" };
    }
  }

  /* v3 kept a setlist.fm key here. The relay holds it now, so drop it on load. */
  function dropOldSetlistKey() {
    try {
      const raw = localStorage.getItem(KEYS_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && typeof data === "object" && "setlist" in data) {
        delete data.setlist;
        localStorage.setItem(KEYS_KEY, JSON.stringify(data));
      }
    } catch {
      /* unreadable keys stay as they are */
    }
  }
  dropOldSetlistKey();

  function writeKeys(keys) {
    localStorage.setItem(KEYS_KEY, JSON.stringify({
      ticketmaster: keys.ticketmaster || "",
      seatgeek: keys.seatgeek || "",
    }));
  }

  function parseLines(text) {
    return String(text || "").split(/\n/).map((s) => s.trim()).filter(Boolean);
  }

  function parseBill(text) {
    const lines = parseLines(text);
    if (lines.length === 1 && lines[0].includes(",")) {
      return lines[0].split(",").map((s) => s.trim()).filter(Boolean);
    }
    return lines;
  }

  function defaultStatus(date) {
    if (!date || date <= localToday()) return "Attended";
    return "Want";
  }

  function nightById(store, id) {
    return store.nights.find((n) => n.id === id) || null;
  }

  function upsertNight(night) {
    return commitStore((store) => {
      const idx = store.nights.findIndex((n) => n.id === night.id);
      if (idx >= 0) store.nights[idx] = night;
      else store.nights.push(night);
    });
  }

  function actStillHasNights(store, actKey) {
    return store.nights.some((n) => (n.bill || []).some((name) => norm(name) === actKey));
  }

  function deleteNight(id) {
    return commitStore((store) => {
      const doomed = store.nights.find((n) => n.id === id);
      store.nights = store.nights.filter((n) => n.id !== id);
      if (!doomed) return;
      const seen = new Set();
      for (const name of doomed.bill || []) {
        const key = norm(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        if (!actStillHasNights(store, key) && store.acts && key in store.acts) {
          delete store.acts[key];
        }
      }
    });
  }

  function actStats(store) {
    const map = new Map();
    for (const night of store.nights) {
      if (night.status !== "Attended") continue;
      const seen = new Set();
      for (const name of night.bill || []) {
        const key = norm(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const row = map.get(key) || { key, name, nights: 0, last: "", kind: night.kind };
        row.nights += 1;
        if (!row.last || (night.date && night.date >= row.last)) {
          row.last = night.date || row.last;
          row.name = name;
          row.kind = night.kind || row.kind;
        }
        map.set(key, row);
      }
    }
    return [...map.values()].sort((a, b) => b.nights - a.nights || (b.last || "").localeCompare(a.last || "") || a.name.localeCompare(b.name));
  }

  function initials(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function route() {
    const hash = location.hash || "#/";
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length) return { name: "home" };
    if (parts[0] === "night") return { name: "night", id: decodeURIComponent(parts[1] || "new") };
    if (parts[0] === "act") return { name: "act", key: decodeURIComponent(parts[1] || "") };
    if (parts[0] === "settings") return { name: "settings" };
    return { name: "home" };
  }

  function go(hash) {
    location.hash = hash;
  }


  function markNav() {
    const name = route().name;
    const current = name === "settings" ? "#/settings" : name === "night" ? "#/night/new" : name === "home" ? "#/" : "";
    document.querySelectorAll(".top-nav a").forEach((link) => {
      if (current && link.getAttribute("href") === current) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function render() {
    markNav();
    const r = route();
    if (r.name === "night") renderNight(r.id);
    else if (r.name === "act") renderAct(r.key);
    else if (r.name === "settings") renderSettings();
    else renderHome();
  }

  function renderHome() {
    const store = readStore();
    const stats = actStats(store).slice(0, 6);
    const max = stats.length ? stats[0].nights : 1;
    const nights = [...store.nights].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const chart = stats.length
      ? `<ol class="chart">${stats.map((row) => {
          const width = Math.max(8, Math.round((row.nights / max) * 100));
          return `<li><button type="button" data-act="${esc(row.key)}">
            <span class="chart-top"><span>${esc(row.name)}</span><span>${row.nights}</span></span>
            <span class="chart-track"><span class="chart-bar" style="width:${width}%"></span></span>
          </button></li>`;
        }).join("")}</ol>`
      : `<p class="quiet">No attended nights yet. Want does not count.</p>`;
    const list = nights.length
      ? `<ul class="night-list">${nights.map((n) => `<li><a href="#/night/${encodeURIComponent(n.id)}">
          <strong>${esc(n.date || "No date")}</strong> ${esc(n.city || "")} ${esc(n.venue || "")}
          <small>${esc(n.status)} · ${esc((n.bill || []).join(", ") || n.kind)}</small>
        </a></li>`).join("")}</ul>`
      : `<p class="quiet">No nights saved.</p>`;
    app.innerHTML = `<h1>Nights</h1>${chart}<h2>All nights</h2>${list}`;
    app.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => go("#/act/" + encodeURIComponent(btn.dataset.act)));
    });
  }

  function blankNight() {
    return {
      id: uid(),
      kind: "Concert",
      status: "Attended",
      date: "",
      city: "",
      venue: "",
      bill: [],
      tour: "",
      rating: "",
      notes: "",
      with: "",
      songs: [],
      encore: [],
      bits: [],
      setlistId: "",
      setlistUrl: "",
      updatedAt: "",
    };
  }

  function renderNight(id) {
    const store = readStore();
    const existing = id !== "new" ? nightById(store, id) : null;
    const night = existing ? { ...existing } : blankNight();
    const isNew = !existing;
    app.innerHTML = `
      <h1>${isNew ? "Add a night" : "Edit night"}</h1>
      <form id="night-form">
        <label for="kind">Kind</label>
        <select id="kind">${KINDS.map((k) => `<option${k === night.kind ? " selected" : ""}>${esc(k)}</option>`).join("")}</select>
        <label for="status">Status</label>
        <select id="status">
          <option${night.status === "Attended" ? " selected" : ""}>Attended</option>
          <option${night.status === "Want" ? " selected" : ""}>Want</option>
        </select>
        <label for="date">Date</label>
        <input id="date" type="date" value="${esc(night.date)}">
        <label for="city">City</label>
        <input id="city" value="${esc(night.city)}">
        <label for="venue">Venue</label>
        <input id="venue" value="${esc(night.venue)}">
        <label for="bill">Bill</label>
        <textarea id="bill">${esc((night.bill || []).join("\n"))}</textarea>
        <p class="hint">One act per line. A single line may use commas.</p>
        <label for="tour">Tour or event name</label>
        <input id="tour" value="${esc(night.tour)}">
        <label for="rating">Rating</label>
        <select id="rating">
          <option value="">None</option>
          ${[1, 2, 3, 4, 5].map((n) => `<option value="${n}"${String(night.rating) === String(n) ? " selected" : ""}>${n}</option>`).join("")}
        </select>
        <label for="with">Who you went with</label>
        <input id="with" value="${esc(night.with)}">
        <label for="notes">Notes</label>
        <textarea id="notes">${esc(night.notes)}</textarea>
        <label for="songs">Songs</label>
        <textarea id="songs">${esc((night.songs || []).join("\n"))}</textarea>
        <label for="encore">Encore</label>
        <textarea id="encore">${esc((night.encore || []).join("\n"))}</textarea>
        <label for="bits">Bits</label>
        <textarea id="bits">${esc((night.bits || []).join("\n"))}</textarea>
        <p class="hint">Comedy lookup does not fill bits.</p>
        <div class="btn-row">
          <button class="btn" type="button" id="lookup">Lookup</button>
          <button class="btn btn-primary" type="submit">Save</button>
          ${isNew ? "" : `<button class="btn" type="button" id="delete">Delete</button>`}
        </div>
        <p id="lookup-status" class="status" role="status"></p>
        <div id="lookup-choices" class="choices"></div>
        ${sourceLine(night)}
      </form>`;

    const form = document.querySelector("#night-form");
    const statusEl = document.querySelector("#lookup-status");
    const choices = document.querySelector("#lookup-choices");
    const dateInput = form.querySelector("#date");
    if (isNew) {
      dateInput.addEventListener("change", () => {
        form.querySelector("#status").value = defaultStatus(dateInput.value);
      });
    }

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const date = form.querySelector("#date").value;
      if (!date) {
        statusEl.textContent = "Add a date.";
        statusEl.className = "status error";
        return;
      }
      const next = {
        ...night,
        kind: form.querySelector("#kind").value,
        status: form.querySelector("#status").value,
        date,
        city: form.querySelector("#city").value.trim(),
        venue: form.querySelector("#venue").value.trim(),
        bill: parseBill(form.querySelector("#bill").value),
        tour: form.querySelector("#tour").value.trim(),
        rating: form.querySelector("#rating").value,
        with: form.querySelector("#with").value.trim(),
        notes: form.querySelector("#notes").value.trim(),
        songs: parseLines(form.querySelector("#songs").value),
        encore: parseLines(form.querySelector("#encore").value),
        bits: parseLines(form.querySelector("#bits").value),
        updatedAt: new Date().toISOString(),
      };
      if (!isNew && next.status === night.status) {
        /* status left as the user set it */
      }
      if (isNew && form.querySelector("#status").value === night.status && date) {
        /* user may have left the default; change handler already set it */
      }
      const dup = readStore().nights.some((n) =>
        n.id !== next.id && n.date === next.date && norm(n.venue) && norm(n.venue) === norm(next.venue)
      );
      if (dup) {
        statusEl.textContent = "Another night is already saved for this date and venue. Saving anyway.";
        statusEl.className = "status";
      }
      upsertNight(next);
      go("#/");
    });

    const del = document.querySelector("#delete");
    if (del) {
      del.addEventListener("click", () => {
        const store = readStore();
        const bill = night.bill || [];
        const lastForAct = bill.some((name) => {
          const key = norm(name);
          if (!key || !(store.acts && key in store.acts)) return false;
          const others = store.nights.some((n) =>
            n.id !== night.id && (n.bill || []).some((b) => norm(b) === key)
          );
          return !others;
        });
        const msg = lastForAct
          ? "Delete this night? It is the last night for this act, so its photo is deleted too."
          : "Delete this night?";
        if (!window.confirm(msg)) return;
        deleteNight(night.id);
        go("#/");
      });
    }

    document.querySelector("#lookup").addEventListener("click", () => {
      runLookup(form, night, statusEl, choices);
    });
  }

  function setField(form, id, value) {
    const el = form.querySelector("#" + id);
    if (el && value != null) el.value = value;
  }

  async function runLookup(form, night, statusEl, choices) {
    choices.innerHTML = "";
    statusEl.className = "status";
    const kind = form.querySelector("#kind").value;
    const city = form.querySelector("#city").value.trim();
    const date = form.querySelector("#date").value;
    const bill = parseBill(form.querySelector("#bill").value);
    const act = bill[0] || "";
    const keys = readKeys();
    if (kind === "Concert") {
      if (!act || (!city && !date)) {
        statusEl.textContent = "Enter an act and a city or a date, then look up.";
        return;
      }
      statusEl.textContent = "Looking up setlist.fm…";
      try {
        const rows = await searchSetlist(act, city, date);
        if (!rows.length) {
          statusEl.textContent = "No match. What you typed stays.";
          return;
        }
        showChoices(choices, rows, (row) => applySetlist(form, night, row));
        statusEl.textContent = "Pick the night.";
      } catch (err) {
        statusEl.textContent = "setlist.fm did not answer. What you typed stays.";
        statusEl.className = "status error";
      }
      return;
    }
    const query = act || form.querySelector("#tour").value.trim();
    if (!query) {
      statusEl.textContent = "Enter an act or an event name, then look up.";
      return;
    }
    statusEl.textContent = "Looking up…";
    let tmError = false;
    if (keys.ticketmaster) {
      try {
        const rows = await searchTicketmaster(keys.ticketmaster, query, city, date);
        if (rows.length) {
          showChoices(choices, rows, (row) => applyEvent(form, row));
          statusEl.textContent = "Pick the night.";
          return;
        }
      } catch {
        tmError = true;
      }
    }
    if (keys.seatgeek) {
      try {
        const rows = await searchSeatGeek(keys.seatgeek, query, city);
        if (rows.length) {
          showChoices(choices, rows, (row) => applyEvent(form, row));
          statusEl.textContent = "Pick the night.";
          return;
        }
      } catch {
        statusEl.textContent = "No match. What you typed stays.";
        return;
      }
    }
    if (!keys.ticketmaster && !keys.seatgeek) {
      statusEl.textContent = "Add a Ticketmaster or SeatGeek key in Settings. The night stays as typed.";
      return;
    }
    statusEl.textContent = tmError
      ? "No match. What you typed stays."
      : "No match. What you typed stays.";
  }

  function showChoices(choices, rows, onPick) {
    choices.innerHTML = rows.slice(0, 8).map((row, i) =>
      `<button type="button" class="choice" data-i="${i}">${esc(row.label)}</button>`
    ).join("");
    choices.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = rows[Number(btn.dataset.i)];
        choices.innerHTML = "";
        const status = document.querySelector("#lookup-status");
        if (status) status.textContent = "";
        onPick(row);
      });
    });
  }

  function applySetlist(form, night, row) {
    setField(form, "date", row.date);
    setField(form, "city", row.city);
    setField(form, "venue", row.venue);
    setField(form, "tour", row.tour);
    setField(form, "bill", row.bill.join("\n"));
    setField(form, "songs", row.songs.join("\n"));
    setField(form, "encore", row.encore.join("\n"));
    night.setlistId = row.id;
    night.setlistUrl = row.url || "";
    form.querySelector("#status").value = defaultStatus(row.date);
    showSource(form, night);
  }

  function setlistHref(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      if (u.protocol === "https:" && (host === "setlist.fm" || host.endsWith(".setlist.fm"))) return u.href;
    } catch {
      /* homepage */
    }
    return "https://www.setlist.fm/";
  }

  function sourceLine(night) {
    if (!night.setlistId && !night.setlistUrl) return "";
    const href = setlistHref(night.setlistUrl);
    return `<p class="quiet" id="source-line">Source: <a href="${esc(href)}">setlist on setlist.fm</a></p>`;
  }

  function showSource(form, night) {
    const html = sourceLine(night);
    const existing = form.querySelector("#source-line");
    if (!html) {
      if (existing) existing.remove();
      return;
    }
    if (existing) {
      existing.outerHTML = html;
      return;
    }
    form.insertAdjacentHTML("beforeend", html);
  }

  function applyEvent(form, row) {
    setField(form, "date", row.date);
    setField(form, "city", row.city);
    setField(form, "venue", row.venue);
    setField(form, "tour", row.tour);
    if (row.bill && row.bill.length) setField(form, "bill", row.bill.join("\n"));
    form.querySelector("#status").value = defaultStatus(row.date);
  }

  function setlistDateToIso(d) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d || ""));
    if (!m) return "";
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  function isoToSetlistDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return "";
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  async function searchSetlist(act, city, date) {
    const params = new URLSearchParams({ artistName: act });
    if (city) params.set("cityName", city);
    const sd = isoToSetlistDate(date);
    if (sd) params.set("date", sd);
    const res = await fetch(SETLIST_RELAY + "?" + params.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("setlist");
    const data = await res.json();
    const list = data.setlist || [];
    return list.map((item) => {
      const sets = (item.sets && item.sets.set) || [];
      const songs = [];
      const encore = [];
      for (const set of sets) {
        const names = (set.song || []).map((s) => s.name).filter(Boolean);
        if (set.encore != null) encore.push(...names);
        else songs.push(...names);
      }
      const venue = item.venue || {};
      const cityName = venue.city && venue.city.name || "";
      const artist = item.artist && item.artist.name || act;
      const when = setlistDateToIso(item.eventDate);
      return {
        id: item.id || "",
        url: item.url || "",
        date: when,
        city: cityName,
        venue: venue.name || "",
        tour: (item.tour && item.tour.name) || "",
        bill: [artist],
        songs,
        encore,
        label: `${when || item.eventDate || "Date unknown"} · ${venue.name || "Venue unknown"} · ${cityName}`,
      };
    });
  }

  async function searchTicketmaster(key, query, city, date) {
    const params = new URLSearchParams({ apikey: key, keyword: query, size: "8" });
    if (city) params.set("city", city);
    if (date) params.set("startDateTime", date + "T00:00:00Z");
    const res = await fetch("https://app.ticketmaster.com/discovery/v2/events.json?" + params.toString());
    if (!res.ok) throw new Error("ticketmaster");
    const data = await res.json();
    const events = (data._embedded && data._embedded.events) || [];
    return events.map((event) => {
      const venue = event._embedded && event._embedded.venues && event._embedded.venues[0] || {};
      const attractions = (event._embedded && event._embedded.attractions || []).map((a) => a.name).filter(Boolean);
      const when = event.dates && event.dates.start && event.dates.start.localDate || "";
      return {
        date: when,
        city: (venue.city && venue.city.name) || "",
        venue: venue.name || "",
        tour: event.name || "",
        bill: attractions,
        label: `${when || "Date unknown"} · ${event.name || "Event"} · ${venue.name || ""}`,
      };
    });
  }

  async function searchSeatGeek(clientId, query, city) {
    const params = new URLSearchParams({ client_id: clientId, q: query, per_page: "8" });
    if (city) params.set("venue.city", city);
    const res = await fetch("https://api.seatgeek.com/2/events?" + params.toString());
    if (!res.ok) throw new Error("seatgeek");
    const data = await res.json();
    return (data.events || []).map((event) => {
      const venue = event.venue || {};
      const when = String(event.datetime_local || "").slice(0, 10);
      const performers = (event.performers || []).map((p) => p.name).filter(Boolean);
      return {
        date: when,
        city: venue.city || "",
        venue: venue.name || "",
        tour: event.title || "",
        bill: performers,
        label: `${when || "Date unknown"} · ${event.title || "Event"} · ${venue.name || ""}`,
      };
    });
  }

  function renderAct(key) {
    const store = readStore();
    const stats = actStats(store).find((row) => row.key === key);
    const saved = store.acts[key] || {};
    const name = (stats && stats.name) || saved.name || key;
    const kind = (stats && stats.kind) || saved.kind || "Other";
    const photo = saved.photoSource === "paste" ? (saved.photoUrl || "") : "";
    const photoBlock = photo
      ? `<img class="act-photo" alt="${esc(name)}" src="${esc(photo)}">`
      : `<div class="act-initials" aria-hidden="true">${esc(initials(name))}</div>`;
    app.innerHTML = `
      <h1>${esc(name)}</h1>
      ${photoBlock}
      <p>${esc(kind)}</p>
      <p>${stats ? `${stats.nights} attended night${stats.nights === 1 ? "" : "s"}` : "No attended nights"}</p>
      <p>${stats && stats.last ? `Last seen ${esc(stats.last)}` : "Not seen yet"}</p>
      <form id="photo-form">
        <label for="photo">Photo URL</label>
        <input id="photo" type="url" placeholder="https://" value="${esc(saved.photoUrl || "")}">
        <div class="btn-row"><button class="btn btn-primary" type="submit">Save photo</button></div>
        <p id="photo-status" class="status" role="status"></p>
      </form>`;
    document.querySelector("#photo-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const url = document.querySelector("#photo").value.trim();
      const note = document.querySelector("#photo-status");
      if (url && !/^https:\/\//i.test(url)) {
        note.textContent = "Photo URL must start with https.";
        note.className = "status error";
        return;
      }
      commitStore((latest) => {
        if (!url) delete latest.acts[key];
        else latest.acts[key] = { name, photoUrl: url, photoSource: "paste" };
      });
      renderAct(key);
    });
  }

  function renderSettings() {
    const keys = readKeys();
    app.innerHTML = `
      <h1>Settings</h1>
      <p>Concert lookup goes through a FreeRangeShows relay on Cloudflare. The relay holds the setlist.fm key, so it is not in this browser or the backup file. Ticketmaster and SeatGeek keys stay in this browser and are not in the backup file. A lookup sends those keys to Ticketmaster or SeatGeek.</p>
      <form id="keys-form">
        <label for="ticketmaster">Ticketmaster Discovery key</label>
        <input id="ticketmaster" type="password" autocomplete="off" value="${esc(keys.ticketmaster)}">
        <label for="seatgeek">SeatGeek client id</label>
        <input id="seatgeek" type="password" autocomplete="off" value="${esc(keys.seatgeek)}">
        <div class="btn-row"><button class="btn btn-primary" type="submit">Save keys</button></div>
        <p id="keys-status" class="status" role="status"></p>
      </form>
      <h2>Backup</h2>
      <p>This file is only a FreeRangeShows backup. A FreeRangeMedia file will not load.</p>
      <div class="btn-row">
        <button class="btn" type="button" id="backup">Back up</button>
        <label class="btn" for="restore-file">Restore</label>
      </div>
      <input id="restore-file" type="file" accept="application/json,.json" hidden>
      <p id="backup-status" class="status" role="status"></p>
      <dialog class="dialog" id="restore-dialog">
        <p>Replace all nights on this device with this file?</p>
        <div class="btn-row">
          <button class="btn btn-primary" type="button" id="restore-yes">Replace</button>
          <button class="btn" type="button" id="restore-no">Cancel</button>
        </div>
      </dialog>`;

    document.querySelector("#keys-form").addEventListener("submit", (event) => {
      event.preventDefault();
      writeKeys({
        ticketmaster: document.querySelector("#ticketmaster").value.trim(),
        seatgeek: document.querySelector("#seatgeek").value.trim(),
      });
      document.querySelector("#keys-status").textContent = "Keys saved in this browser.";
    });

    document.querySelector("#backup").addEventListener("click", downloadBackup);
    document.querySelector("#restore-file").addEventListener("change", (event) => {
      const file = event.target.files && event.target.files[0];
      event.target.value = "";
      if (file) prepareRestore(file);
    });
  }

  function backupPayload() {
    const store = readStore();
    return {
      app: BACKUP_APP,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      nights: store.nights,
      acts: store.acts,
    };
  }

  function downloadBackup() {
    const text = JSON.stringify(backupPayload(), null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const a = document.createElement("a");
    const stamp = localToday();
    a.href = URL.createObjectURL(blob);
    a.download = `freerangeshows-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    const status = document.querySelector("#backup-status");
    if (status) status.textContent = "Backup file created. It has no API keys.";
  }

  function backupAppAllowed(data) {
    if (!data || Array.isArray(data) || typeof data !== "object") return false;
    return String(data.app || "").trim().toLowerCase() === BACKUP_APP;
  }

  async function prepareRestore(file) {
    const status = document.querySelector("#backup-status");
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      status.textContent = "That file is not JSON. Nothing changed.";
      status.className = "status error";
      return;
    }
    if (!backupAppAllowed(data)) {
      status.textContent = "This is not a FreeRangeShows backup. Nothing changed.";
      status.className = "status error";
      return;
    }
    if (!Array.isArray(data.nights)) {
      status.textContent = "This backup has no nights list. Nothing changed.";
      status.className = "status error";
      return;
    }
    const dialog = document.querySelector("#restore-dialog");
    const yes = document.querySelector("#restore-yes");
    const no = document.querySelector("#restore-no");
    const close = () => dialog.close();
    no.onclick = close;
    yes.onclick = () => {
      const nights = data.nights.map(cleanNight).filter((n) => n.id && n.date);
      const acts = data.acts && typeof data.acts === "object" ? data.acts : {};
      commitStore((store) => {
        store.nights = nights;
        store.acts = acts;
      });
      close();
      const line = document.querySelector("#backup-status");
      if (line) {
        line.className = "status";
        line.textContent = `Restored ${nights.length} nights.`;
      }
    };
    dialog.showModal();
  }

  function cleanNight(raw) {
    const kind = KINDS.includes(raw.kind) ? raw.kind : "Other";
    const status = raw.status === "Want" ? "Want" : "Attended";
    return {
      id: String(raw.id || uid()),
      kind,
      status,
      date: String(raw.date || ""),
      city: String(raw.city || ""),
      venue: String(raw.venue || ""),
      bill: Array.isArray(raw.bill) ? raw.bill.map((s) => String(s)).filter(Boolean) : [],
      tour: String(raw.tour || ""),
      rating: ["", "1", "2", "3", "4", "5"].includes(String(raw.rating)) ? String(raw.rating) : "",
      notes: String(raw.notes || ""),
      with: String(raw.with || ""),
      songs: Array.isArray(raw.songs) ? raw.songs.map(String) : [],
      encore: Array.isArray(raw.encore) ? raw.encore.map(String) : [],
      bits: Array.isArray(raw.bits) ? raw.bits.map(String) : [],
      setlistId: String(raw.setlistId || ""),
      setlistUrl: String(raw.setlistUrl || ""),
      updatedAt: String(raw.updatedAt || ""),
    };
  }

  window.addEventListener("hashchange", render);
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const name = route().name;
    if (name === "night" || name === "settings") return;
    render();
  });
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
