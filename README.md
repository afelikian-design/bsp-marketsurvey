# BSP Market Tearsheet

Competitive market survey dashboard for ApartmentIQ exports. Upload a property's
market export and it renders the subject against its comp set: pricing ribbon,
unit-level scatter with OLS trend lines, drill-down by property, a concessions
board, and AI-written observations.

Surveys are stored server-side on **Netlify Blobs**, so one deploy covers the
whole portfolio and everyone with access sees the same data — load each
property's export once and switch between them from the header. Because surveys
are shared, turn on access control before circulating the URL.

---

## Deploy

**1. Push to GitHub**

```bash
git init
git add .
git commit -m "BSP market tearsheet"
git remote add origin git@github.com:afelikian-design/bsp-market-tearsheet.git
git push -u origin main
```

**2. Connect the site on Netlify**

Add new site → Import an existing project → pick the repo. Leave the build
command empty and the publish directory as `.` — `netlify.toml` already sets
both, along with the functions directory.

**3. Set the API key**

Site configuration → Environment variables → Add:

| Key | Value |
| --- | --- |
| `ANTHROPIC_API_KEY` | your key from console.anthropic.com |
| `ANTHROPIC_MODEL` | *(optional)* defaults to `claude-sonnet-4-6` |

Redeploy after adding it. Without the key everything works except the AI
observations, which fall back to a computed read.

**4. Restrict access — do this before sharing the URL**

The dashboard exposes rent and concession data for properties you own, and
surveys are now shared rather than per-browser. Site configuration → Access
control → set a site password, or enable Identity for per-user logins.
`noindex` is already set, but that only discourages crawlers; it is not access
control.

Blobs storage is provisioned automatically on first write — nothing to create.

---

## Local development

```bash
npm install -g netlify-cli
cp .env.example .env        # add your key
netlify link                # required: Blobs needs a linked site
netlify dev                 # http://localhost:8888
```

`netlify dev` is required rather than a plain static server, because both
`/api/insights` and `/api/surveys` only exist as functions. `netlify link` is
required too — Blobs resolves its store from the linked site, and without it
`/api/surveys` returns 503 and the dashboard drops to session-only mode.

---

## Using it

1. In the PMC's ApartmentIQ portal, run the market export for a property. It
   must be the full multi-tab workbook — the parser needs the **Unit Level
   Data** tab.
2. Click **Load export** or drag the `.xlsx` onto the page.
3. The subject is detected automatically (the property at 0.0 miles) and the
   survey is saved under that name.
4. Repeat per property. The header dropdown becomes the portfolio; the gear icon
   manages saved surveys.

The survey you viewed last reloads on your next visit.

### Reading the controls

| Control | Behavior |
| --- | --- |
| **Window** | Applies to *Leased* and *Newly listed* only. *On market* is a point-in-time state, so the window does not narrow it — the hint line says which is in effect. |
| **Units** | *On market* is current exposure; *Leased* is what actually signed and is the honest read on achievable rent. |
| **View** | *Property* compares against comps; *Floor plan* breaks the subject into its own plans. |
| **Trend** | OLS fits. Slope and R² are printed under the chart. |

Click a row in the competitive set for unit-level detail; click the property
**name** to exclude it from the analysis. Escape backs out.

### Two concession measures, deliberately separate

**Concession rate** is ApartmentIQ's trailing thirty-day leasing average.
**Listed spread** is asking less effective rent on units posted right now. They
diverge when a property has just added or withdrawn a special — a competitor
testing a pullback shows a high trailing rate with nothing in current listings,
flagged as *Not in current listings*. Do not average them.

---

## Structure

```
index.html                       markup only
css/app.css                      all styling
js/core.js                       parsing, stats, OLS, scatter renderer
js/storage.js                    saved surveys (client for /api/surveys)
js/app.js                        UI wiring, picker, drill-down, specials
assets/sample.json               bundled demo survey (see below)
assets/logo-*.png                BSP wordmarks
netlify/functions/surveys.mjs    Netlify Blobs CRUD for saved surveys
netlify/functions/geocode.mjs    address -> coordinates, cached in Blobs
netlify/functions/insights.mjs   Anthropic call; owns the prompt and the key
```

### Location map

ApartmentIQ exports carry a street line but no city, state, or coordinates, so
the first time you open a survey the map asks for a city ("Colorado Springs,
CO") and geocodes from there. Addresses resolve through the US Census geocoder,
with Nominatim as a fallback, and results are cached in a `geocache` blob store
keyed by normalized address — a comp shared between two surveys is geocoded
once, ever. Coordinates are written back into the survey, so the prompt appears
only on first view.

The subject is a gold star, comps are dots, and dots dim when a property is
excluded. Clicking a marker shows its pricing and opens unit detail.

### /api/surveys

| Method | Path | Result |
| --- | --- | --- |
| GET | `/api/surveys` | list of saved surveys with metadata |
| GET | `/api/surveys?key=slug` | one survey payload |
| POST | `/api/surveys` | create or replace |
| DELETE | `/api/surveys?key=slug` | remove |

There is deliberately no index blob. The listing is rebuilt from the store's own
metadata on every call, so two people saving different properties at the same
moment cannot clobber a shared index. Re-saving a property replaces it in place,
so a weekly refresh overwrites rather than duplicates.

The API key never reaches the browser. The prompt lives server-side so the
endpoint cannot be reused as a general-purpose proxy — a caller only controls
the brief, which is shape-checked and size-capped at 60 KB.

### The bundled sample

`assets/sample.json` is a real Creekside at Palmer Park survey included so the
dashboard renders on first load. It disappears from the picker as soon as you
save a real survey. To ship without it, delete the file — the app falls back to
an empty state prompting an upload.

---

## Notes and limits

- **Storage is shared, not per-user.** Anyone who can reach the site sees and can
  delete every saved survey. Access control is the only thing gating it.
- **Only "last survey viewed" is local**, kept in `localStorage` as a ~40 byte
  preference so each person returns to their own property.
- **Surveys run ~290 KB each**; eight properties is roughly 2.3 MB, far inside
  Blobs limits.
- **Each export is one subject.** Comp sets differ between properties, so surveys
  are independent. There is no cross-portfolio ranking view yet.
- **Parsing is client-side.** The spreadsheet is read in the browser; only the
  parsed payload goes to your own Blobs store. The insights function receives a
  small statistical brief (~4 KB) — no unit-level rows or unit numbers.
- **Effective rent** is net of advertised concessions as reported by ApartmentIQ,
  not a lease-level calculation.

## Roadmap

- Cross-portfolio tab ranking all subjects by variance from expected pricing
- Subject-property context (vintage, location, renovation status) so the model
  can separate a pricing problem from a product problem
- Google Sheets or ApartmentIQ API ingestion to replace manual uploads
