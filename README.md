# Aeon Videos

A fast, searchable screening room for the video archive of [Aeon](https://aeon.co/videos):
2,000+ short documentaries and animations with search, category / topic / year / length filters,
favorites and watched marks. Plain HTML, CSS and JavaScript — no framework, no build step.

## Run it

| Where | How | Favorites + watched marks |
|---|---|---|
| Netlify | deploy this folder (see `netlify.toml`) | per user, after **Sign up / Log in** (Netlify Identity); synced across every device that user logs in on. Logged out: kept in that browser only. |
| Your own machine / tailnet | `python3 server.py --port 7781` (Python 3 standard library only) | shared by everyone using that server, stored in `state.json` next to it |
| Just the file | open `index.html` | kept in that browser only (localStorage) |

The page decides by itself: served over http(s) it asks `GET /api/state`. `server.py` answers with its saved
state; on Netlify the function answers `{"auth":"identity"}`, so the page loads the Identity widget and shows
**Log in / Sign up**. If neither answers, the marks simply stay in the browser — no error.

### Netlify pieces

- `netlify-identity-widget` (loaded from `identity.netlify.com`, only on the Netlify deploy) — sign-up, log-in,
  e-mail confirmation, password reset.
- `netlify/functions/state/` — one small function. It reads the logged-in user from the Identity JWT that
  Netlify verifies, and keeps that user's marks in **Netlify Blobs** (store `aeon-user-state`, one JSON blob
  per user id). Same JSON contract and merge rule as `server.py`: last write wins per video. Writes use an
  ETag check, so two devices saving at once do not drop each other's marks.
- `package.json` only lists `@netlify/blobs`, which Netlify installs for the function. There is no build
  command and nothing to configure: no secrets, no environment variables.

Site settings needed once: **Identity → Enable**, **Registration → Open**. E-mail confirmation stays at
Netlify's default.

## Data source

- Aeon's public video sitemap: <https://assets.aeon.co/sitemaps/aeon/video.xml>
- `./update.sh` fetches it and regenerates `data.js` (or `./update.sh file.xml` parses a saved copy).
  The output is deterministic: the same sitemap always produces a byte-identical `data.js`.
- Each record keeps the sitemap's own fields: page URL, title, abstract, publication date, category,
  duration, thumbnail URL and player URL.

## Attribution

Data and abstracts © Aeon Media Group, quoted for non-commercial personal use. The films are hosted on
YouTube and Vimeo by their creators and embedded from there; nothing is re-hosted here. Every card links to
its original page on [aeon.co](https://aeon.co) — watch and read the originals there. This project is not
affiliated with Aeon.

## Licence

The code is MIT-licensed (see `LICENSE`). The licence covers the code only, not Aeon's data or the films.
