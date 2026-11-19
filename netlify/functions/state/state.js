// Netlify Function: per-user favorites/watched state for the deployed site.
//
//   GET  /api/state                      (no login)  -> {"version":1,"auth":"identity","videos":{}}
//        Tells the page it is on the Netlify deploy, so it loads the Identity widget.
//   GET  /.netlify/functions/state       (Authorization: Bearer <Identity JWT>) -> the user's state
//   PUT  /.netlify/functions/state       (same auth) <- {"device":"..","videos":{url:{favorite,watched,updated_at}}}
//
// Same JSON contract and merge rule as server.py (last write wins per video on updated_at).
// Storage: Netlify Blobs, store "aeon-user-state", one JSON blob per Identity user id (JWT "sub").
// Netlify verifies the Identity JWT and passes the user in context.clientContext.user.
"use strict";

const { emptyState, normalise, cleanIncoming, merge } = require("./merge");

const STORE = "aeon-user-state";
const MAX_BODY = 4 * 1024 * 1024;
const HEADERS = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };

function reply(statusCode, obj) {
  return { statusCode, headers: HEADERS, body: JSON.stringify(obj) };
}

function netlifyStore(event) {
  const { connectLambda, getStore } = require("@netlify/blobs");
  connectLambda(event); // Lambda-compatible functions must hand the Blobs context over explicitly
  return getStore({ name: STORE, consistency: "strong" });
}

// makeHandler(storeFor) lets the local test harness swap Blobs for an in-memory store.
function makeHandler(storeFor) {
  return async function handler(event, context) {
    const method = event.httpMethod;
    const user = context && context.clientContext && context.clientContext.user;
    const hasAuth = !!(event.headers && (event.headers.authorization || event.headers.Authorization));

    if (!user) {
      // Anonymous discovery probe: answer 200 so the page never logs an error, and say how to log in.
      if (method === "GET" && !hasAuth) return reply(200, { version: 1, auth: "identity", videos: {} });
      return reply(401, { error: "log in to sync favorites and watched marks" });
    }
    const key = "u/" + String(user.sub).replace(/[^A-Za-z0-9_-]/g, "");
    if (key === "u/") return reply(401, { error: "token has no user id" });
    const store = storeFor(event);

    if (method === "GET") {
      const st = normalise(await store.get(key, { type: "json" }));
      return reply(200, st);
    }
    if (method !== "PUT") return reply(405, { error: "use GET or PUT" });

    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    if (Buffer.byteLength(raw) > MAX_BODY) return reply(413, { error: "body too large" });
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return reply(400, { error: "body is not JSON" }); }
    let device, incoming;
    try { ({ device, incoming } = cleanIncoming(parsed, Date.now())); } catch (e) { return reply(e.status || 400, { error: e.message }); }

    // Read-merge-write with an ETag guard so two devices saving at once cannot drop each other's marks.
    for (let attempt = 0; attempt < 5; attempt++) {
      const cur = await store.getWithMetadata(key, { type: "json" });
      const st = normalise(cur && cur.data);
      merge(st, device, incoming, Date.now());
      const opts = cur && cur.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true };
      const res = await store.setJSON(key, st, opts);
      if (res && res.modified !== false) return reply(200, st);
    }
    return reply(409, { error: "state changed underneath, retry" });
  };
}

module.exports = { handler: makeHandler(netlifyStore), makeHandler, emptyState };
