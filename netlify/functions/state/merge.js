// Pure state logic shared by the Netlify Function. Same contract as server.py's /api/state:
// per-video entries {favorite, watched, updated_at (epoch ms), device}, last write wins on updated_at.
"use strict";

const MAX_VIDEOS = 50000;
const MAX_KEY = 600;
const MAX_DEVICE = 64;
const FUTURE_SLACK_MS = 60 * 1000; // a device with a fast clock cannot win forever

function emptyState() {
  return { version: 1, updated_at: null, devices: {}, videos: {} };
}

function normalise(st) {
  if (!st || typeof st !== "object" || !st.videos || typeof st.videos !== "object") return emptyState();
  return { version: 1, updated_at: st.updated_at || null, devices: st.devices || {}, videos: st.videos };
}

function iso(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

// Validate a PUT body; returns {device, incoming} or throws an Error with .status = 400.
function cleanIncoming(body, now) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("body must be an object");
  const device = body.device;
  if (typeof device !== "string" || !device || device.length > MAX_DEVICE) {
    throw bad("device must be a non-empty string of at most " + MAX_DEVICE + " chars");
  }
  const videos = body.videos === undefined ? {} : body.videos;
  if (!videos || typeof videos !== "object" || Array.isArray(videos)) throw bad("videos must be an object");
  const keys = Object.keys(videos);
  if (keys.length > MAX_VIDEOS) throw bad("too many videos");
  const cap = now + FUTURE_SLACK_MS;
  const incoming = {};
  for (const key of keys) {
    const e = videos[key];
    if (!key || key.length > MAX_KEY || !e || typeof e !== "object") throw bad("bad entry for " + key.slice(0, 80));
    const fav = e.favorite === undefined ? false : e.favorite;
    const wat = e.watched === undefined ? false : e.watched;
    const ts = e.updated_at;
    if (typeof fav !== "boolean" || typeof wat !== "boolean") throw bad("favorite/watched must be booleans (" + key.slice(0, 80) + ")");
    if (!Number.isInteger(ts) || ts <= 0) throw bad("updated_at must be epoch milliseconds (" + key.slice(0, 80) + ")");
    incoming[key] = { favorite: fav, watched: wat, updated_at: Math.min(ts, cap), device };
  }
  return { device, incoming };
}

// Last write wins per video. Mutates st; returns the number of entries that changed.
function merge(st, device, incoming, now) {
  let changed = 0;
  for (const [key, e] of Object.entries(incoming)) {
    const cur = st.videos[key];
    if (!cur || e.updated_at > (cur.updated_at || 0)) {
      if (!cur || cur.favorite !== e.favorite || cur.watched !== e.watched || cur.updated_at !== e.updated_at) changed++;
      st.videos[key] = e;
    }
  }
  st.devices[device] = iso(now);
  if (changed) st.updated_at = iso(now);
  return changed;
}

module.exports = { emptyState, normalise, cleanIncoming, merge, MAX_VIDEOS };
