# Isobar

A free, self-hosted multi-model weather map. It covers most of what the paid Weather Front app does, plus storm-chaser positions and live streams like MyRadar, using only free public data.

The app is one HTML file, `isobar.html`: no build step, no accounts, no API keys. An optional companion server, `isobar-relay.mjs`, runs on the Mac and adds storm chasers and live streams.

## What it does

**Model maps.** Nine forecast models, each drawn as a smooth color field over a dark basemap, with a time slider and a play button.

| Model | Coverage | Forecast length | Open-Meteo model id (fallbacks after) |
|---|---|---|---|
| HRRR | Continental US | 48 h | `ncep_hrrr_conus`, `gfs_hrrr` |
| NAM 3 km | Continental US | 60 h | `ncep_nam_conus` |
| NBM | Continental US | 240 h | `ncep_nbm_conus` (no sounding) |
| GFS | Global | 240 h | `ncep_gfs_seamless`, `gfs_seamless` |
| Euro (ECMWF IFS) | Global | 240 h | `ecmwf_ifs`, `ecmwf_ifs025` |
| Euro AI (ECMWF AIFS) | Global | 240 h | `ecmwf_aifs025_single`, `ecmwf_aifs025` |
| ICON | Global | 180 h | `icon_seamless`, `dwd_icon_seamless` |
| Canadian (GEM) | Global | 240 h | `gem_seamless`, `cmc_gem_seamless` |
| UKMO | Global | 168 h | `ukmo_seamless` |

Map fields: temperature, future radar (HRRR only), hourly precipitation, total precipitation, total snow, wind (with barbs), gusts, dew point, CAPE, cloud cover, and sea-level pressure (with isobars every 4 mb and H/L markers).

**Observed layers** (Layers button): live NEXRAD radar looping the last 50 minutes, active NWS warning polygons (tap for details, refreshed every 2 minutes), GOES-East infrared satellite, and MRMS 24-hour rain totals. Pressure lines and wind barbs can also be laid over any field.

**Tap any spot** to open the point panel:
- *Compare models* fetches all nine models for that spot. It shows a table (total precip, total snow, high, low, peak gust) and overlaid charts for temperature, precipitation, snow and gusts. Tap a model chip to hide or show its line. A white marker tracks the map's current time.
- *Sounding* draws a Skew-T for the selected model and hour from 21 pressure levels (1000 to 100 mb). It includes dry and moist adiabats, a lifted surface parcel, wind barbs, and stats for surface temp/dew point, CAPE, precipitable water and cloud base.
- The panel header links to that spot's American Weather forum.

**Storm chasers** (Layers, needs the companion server): live positions from Spotter Network, refreshed every minute.
- Moving chasers get a heading arrow. Positions older than 30 minutes are dimmed. Names appear once you zoom in.
- Tap a chaser for their status, when they last reported, their website if they list one, and a forecast for that spot.

**Chasers and forums** (speech-bubble button) has two tabs.
- *Live chasers* lists YouTube storm-chasing streams that are live now; tap one to watch it right in the panel. This needs a free YouTube API key on the companion server. Below that are reporting chasers, nearest the map center first; tap one to jump to them. Last are links to live chaser video sites: Severe Studios Live Chase, Live Storm Chasing, and Highways & Hailstones.
- *Forums* covers the nine regional boards on americanwx.com, described next.

**Regional forums:** the nine regional boards on americanwx.com. The board covering the map center, or the spot you tapped, is shown first. Split areas show both boards, for example southern Virginia (Southeastern States and Mid Atlantic) or southern Kentucky (Tennessee Valley and Lakes/Ohio Valley). Boards open in a new tab.

**Also:** place search, a "my location" button, a hover readout on desktop, and keyboard shortcuts (space to play or pause, left and right arrows to step, Esc to close panels). Model, field, opacity, detail level, layers, map view and hidden chart lines are remembered in the browser. The map reloads data every 20 minutes when it isn't playing.

## Running it

**It will not run inside the Claude app's file preview.** That viewer blocks outside scripts and data. Isobar detects this and says so rather than failing silently. Open it in a real browser.

### On the Mac

```sh
cd path/to/isobar
python3 -m http.server 8000
```

Then open <http://localhost:8000/isobar.html>. Serving from `localhost` keeps the location button working. Double-clicking the file also works; only the location button may not.

### From Home Assistant (best for the phone)

1. Copy `isobar.html` into Home Assistant's `www` folder, `/config/www/`. The SSH add-on may show the config folder as `/homeassistant`. If `www` doesn't exist, create it and restart Home Assistant once.
2. Open `http://homeassistant.local:8123/local/isobar.html`, or the same `/local/isobar.html` path on your remote address.
3. On the phone, use Share, then Add to Home Screen. It opens full screen like an app.

Notes:
- Files in `www` are served without login. Nothing in Isobar is private, so that's fine.
- The location button needs HTTPS, so it works through a remote HTTPS address but not over plain `http://homeassistant.local`.
- Home Assistant caches `/local/` files. After replacing the file, add a version to the URL (`isobar.html?v=2`) or clear the browser cache.

### Anywhere else

Any static host works: GitHub Pages, Netlify, Cloudflare Pages, nginx on the Mac mini. There's nothing to configure.

### Companion server (storm chasers and live streams)

Browsers only let a page read another site's data if that site allows it. Spotter Network and YouTube don't, so a small server on the Mac fetches the data for the app. It has no dependencies and needs Node 18 or newer (`node -v`).

1. Put `isobar-relay.mjs` in the same folder as `isobar.html`.
2. Test the live feeds: `node isobar-relay.mjs --check`. It fetches Spotter Network (and YouTube, if a key is set) once and prints what came back. On a quiet weather day there may be few or no chasers.
3. Start it: `node isobar-relay.mjs`. It prints the addresses to use, for example `http://Nates-Mac-mini.local:8787/`. If macOS asks whether to allow incoming connections for `node`, allow it.
4. Open Isobar **from that address**. The server also hosts the app, so chasers work with no setup. On the phone, add that address to the home screen.

A copy hosted on Home Assistant can use the server too. Enter the server's address in Layers, under Companion server. This only works while the page itself is on plain `http://`. A browser blocks an HTTPS page from calling an `http://` server, so over a remote HTTPS address, open Isobar from the companion server instead. Away from home, reaching the Mac needs something like a VPN (Tailscale, for example).

**Live YouTube streams (optional).**
1. In Google Cloud Console, create a project and enable **YouTube Data API v3**.
2. Create an API key and restrict it to that API.
3. Start the server with the key: `YT_API_KEY=your-key node isobar-relay.mjs`.

Each search uses 100 of the default 10,000 daily quota units. The server caches results for 20 minutes, so it stays under the quota even when left running all day. Change what it searches for with `YT_QUERY` (default `storm chasing live`).

**Other settings:**
- `PORT` (default 8787)
- `HOST` (default all interfaces)
- `CHASER_MAX_AGE_MIN`: how old a position can be and still show (default 120)

**Keep it running.** Save this as `~/Library/LaunchAgents/com.isobar.relay.plist`. Replace the node path with the output of `which node` and use your own folder and key. Then run `launchctl load ~/Library/LaunchAgents/com.isobar.relay.plist`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.isobar.relay</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/YOU/isobar/isobar-relay.mjs</string>
  </array>
  <key>EnvironmentVariables</key><dict><key>YT_API_KEY</key><string>YOUR-KEY</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/isobar-relay.log</string>
  <key>StandardErrorPath</key><string>/tmp/isobar-relay.log</string>
</dict></plist>
```

**Routes:**
- `/` serves `isobar.html`.
- `/isobar/health` reports what the server can do.
- `/isobar/chasers` returns positions as JSON, cached for 60 seconds.
- `/isobar/live` returns live streams, cached for 20 minutes.

Routes sit under `/isobar/`, not `/api/`, so a copy of the app hosted on Home Assistant never calls Home Assistant's own API. Failed requests there can trigger its IP ban.

## How it works

### External dependencies

Loaded at runtime:
- Leaflet 1.9.4 from cdnjs.
- topojson-client 3.1.0, `us-atlas@3` state shapes and `world-atlas@2` country shapes from jsDelivr.
- Barlow and Barlow Condensed from Google Fonts. It falls back to system fonts if they don't load.

### Data sources

| Source | Used for | Endpoint |
|---|---|---|
| Open-Meteo | Model grids, point forecasts, soundings | `api.open-meteo.com/v1/forecast` |
| Open-Meteo | Model run times | `api.open-meteo.com/data/{model}/static/meta.json` |
| Open-Meteo | Place search | `geocoding-api.open-meteo.com/v1/search` |
| Iowa Environmental Mesonet | Live radar tiles (`nexrad-n0q-900913`, 5-minute frames) | `mesonet.agron.iastate.edu/cache/tile.py/1.0.0/` |
| Iowa Environmental Mesonet | HRRR future radar tiles (`hrrr::REFP-F{min}-{YYYYMMDDHH00}`) | same tile service |
| Iowa Environmental Mesonet | Latest HRRR run for future radar | `mesonet.agron.iastate.edu/data/gis/images/4326/hrrr/refd_1080.json` |
| Iowa Environmental Mesonet | GOES-East IR (`conus_ch13`), MRMS 24 h (`mrms_p24h`) | WMS: `cgi-bin/wms/goes_east.cgi`, `cgi-bin/wms/us/mrms_nn.cgi` |
| National Weather Service | Warning polygons | `api.weather.gov/alerts/active?status=actual` |
| CARTO / OpenStreetMap | Basemap and labels | `basemaps.cartocdn.com` (`dark_nolabels`, `dark_only_labels`) |
| American Weather | Regional forum links | `americanwx.com/bb/forum/…` |
| Spotter Network | Chaser positions (companion server) | `spotternetwork.org/feeds/gr.txt` (GRLevelX placefile) |
| YouTube Data API v3 | Live storm-chasing streams (companion server, optional key) | `googleapis.com/youtube/v3/search?eventType=live` |
| YouTube | Embedded player | `youtube-nocookie.com/embed/{id}` |

### Model maps

Open-Meteo has no image tiles, so each map is built from point forecasts:

1. **Sample points.** Points are spread evenly in *screen pixels*, not in latitude and longitude, so the finished image lines up exactly with the Web Mercator basemap. The detail setting picks the number of points: Light 110, Standard 190, Sharp 320.
2. **Fetch.** One multi-location Open-Meteo request returns the whole forecast for every point.
3. **Draw.** Values are bilinearly interpolated onto a canvas at 16 pixels per grid cell and colored with that field's scale. The canvas is placed on the map as a Leaflet image overlay. Precipitation-type scales fade out just below their lowest value so light-rain edges don't look jagged.
4. **Reuse.** Grids are cached for 20 minutes. A grid is reused when the map moves or the model changes, as long as it still covers the view and zoom. Stale responses are dropped using a request counter (`loadSeq`).

Totals such as precipitation and snow are summed on the fly from hourly values. Isobars use marching squares on a 3× upsampled pressure grid. H and L markers mark strict local extremes more than 1 mb from their surroundings. Wind barbs are SVG icons in knots.

If a model id is rejected, the next id in its fallback list is tried, and the one that works is remembered. Run times come from Open-Meteo's `meta.json` files and appear in the dock as, for example, "HRRR 21z run".

### Soundings

Temperature, dew point and wind come from Open-Meteo's pressure-level variables, with the surface level taken from 2 m values. The lifted parcel rises dry-adiabatically to its LCL. It then follows a pseudo-adiabat, integrated with Bolton (1980) thermodynamics. CAPE and precipitable water are read directly from the model.

### Forum matching

The US state shapes already downloaded for the borders are kept as polygons. A point-in-polygon test finds the state, and a small rule table maps it to boards. The rules follow each board's published coverage, with latitude or longitude splits for states covered by two boards: VA, KY, AL, MS, NJ, PA, DE, NY, and IA/MO/MN.

### Storm chasers

The Spotter Network feed is a GRLevelX placefile: one `Object:` block per spotter, with a tooltip holding name, time, status and optional contact lines, and a separate arrow icon for heading when moving. The companion server turns it into JSON with only name, position, time, status, heading and website. **Phone numbers, email, IM handles and notes that some spotters publish are dropped on purpose** and never reach the app. Positions older than two hours are left out.

## Code map

The app lives in `isobar.html`: CSS in `<style>`, markup, then one script wrapped in an IIFE. `isobar-relay.mjs` is the separate companion server; `parseSpotterPlacefile` and `getLive` are exported for testing. The app script is divided by comment banners:

| Section | Contents |
|---|---|
| Models and fields | `MODELS`, `VARS`, `SCALES` (color stops and legend labels), `FIELDS`, `LEVELS`, `DETAIL` |
| State | App state and `localStorage` persistence (`isobar:` keys) |
| Map | Leaflet setup, panes, basemap, borders (and the state shapes kept for forums) |
| Status pill | `setStatus` and `clearBusy` |
| Open-Meteo | `omFetch` (model fallback, 429 handling), `fetchRun` |
| Model grid | Point sampling, `loadGrid`, `useGrid`, interpolation, rasterizing, isobars, H/L, barbs |
| Tile layers | Live radar loop, future radar, satellite, MRMS |
| NWS warnings | Polygon loading and popups |
| Render + UI | Legend, chips, time slider, day ticks, playback, hover readout |
| Sheets | Opening and closing the side and bottom panels |
| American Weather regional forums | `BOARDS`, `stateAt`, `boardsFor`, the forums tab |
| Storm chasers and live streams | `relayBase`, `relayJSON`, chaser markers, the Live chasers tab, video player, companion server setting |
| Point forecast | Compare fetch, summary table, `chartSVG` |
| Sounding | Skew-T drawing, parcel math |
| Search and location | Geocoding and geolocation |
| Wiring | Event listeners, keyboard, refresh timers |

To add a model, add an entry to `MODELS` with `key`, `name`, `ids` (fallback order), `meta` (run-time directories), `hours`, `color`, and `conus: true` if it's US-only. To add a map field, add an entry to `FIELDS` and a color scale to `SCALES`. Give the scale a sparse `labels` list so legend numbers don't collide.

## Limits

- **Resolution.** Maps are built from 110 to 320 sample points, not the models' native grids. They're accurate but softer than paid apps, especially for small features like individual storms. The HRRR future radar is the exception: it uses real HRRR imagery.
- **Future radar** only covers about 18 hours past the latest HRRR run.
- **US only:** HRRR, NAM and NBM. NBM has no sounding.
- **Open-Meteo's free tier** is for non-commercial use only and capped at 10,000 calls per day (5,000 per hour, 600 per minute). Long or variable-heavy requests count as more than one call, and each map load asks for 110 to 320 locations. If Isobar says the free limit is used up, switch to Light detail. Using it for clients or in a paid product needs an Open-Meteo subscription.
- **Compare totals** cover each model's full run, so HRRR's 48-hour total sits next to GFS's 10-day total. The note under the table says so.
- **Tapped spots show coordinates,** not a place name. There's no free reverse-geocoding source in use yet.
- **Forum threads aren't shown inside Isobar.** A web page can't read another site unless that site allows it, and forums generally don't. The companion server could add this (see below).
- **Chasers need the companion server,** and only chasers who share their position through Spotter Network appear.
- **Live streams aren't placed on the map.** YouTube streams carry no location, so they're listed rather than pinned. MyRadar's pinned chaser video comes from Severe Studios' licensed streaming API, which isn't free. The linked chaser sites show pinned video for free in a browser tab.
- **Spotter Network's terms.** Its feeds page asks developers who want to build its feed into an application to contact them. Using the public feed for your own map, the way GRLevelX users do, is personal use. Ask Spotter Network before putting it in anything for clients.

## Testing

Syntax check the script and unit-test the pure functions with Node:
- contouring accuracy
- LCL
- moist adiabats
- tick spacing
- barb markup
- color interpolation
- `boardsFor` against 40+ real cities, using the same `us-atlas` file

UI testing uses Playwright with headless Chromium. It intercepts every network request and answers with synthetic data:
- a moving storm field from the Open-Meteo mock
- a fake NWS polygon
- transparent tiles
- local copies of Leaflet, topojson and the atlases
- an intentional 400 for `ecmwf_ifs`, to exercise the model fallback

The page is served from a fake origin such as `http://isobar.test/`, not `file://`. Screenshots are taken at 390×844 (phone) and 1440×900 (desktop) for each field, the compare and sounding tabs, and the layers and forums panels. The suite also checks two failure cases: every CDN blocked, and a sandboxed iframe with outside data blocked.

Companion server tests:
- The placefile parser runs on a fixture copied from the real feed's format, in both multi-line and collapsed form. It checks stale positions, bad coordinates, `javascript:` links, and that no contact details or notes leak through.
- The YouTube mapping runs with a mocked API, including the quota-error path.
- Every route is exercised against a local copy of the feed, including `--check`.

Browser tests for chasers:
- the chaser layer, Live chasers tab, video player and jump-to-chaser, with mocked `/isobar/` routes
- a Home Assistant-style copy at `/local/isobar.html` with no server, confirming it shows setup guidance and never requests anything from Home Assistant but the page itself

**All testing so far has used mocked data.** Run `node isobar-relay.mjs --check` first to confirm the live feed still parses. When anything misbehaves against the live services, look first at how each service formats its responses.

## Development notes

- Keep it one self-contained file with no framework, no build step and no keys. That's what makes it drop-in hostable anywhere, including Home Assistant.
- Keep the global `[hidden]{display:none!important}` rule. Without it, component `display` rules override the `hidden` attribute and panels or spinners never disappear.
- Never name a local variable `L`; that's Leaflet.
- Borders and isobars need separate canvas renderers.
- Bump `loadSeq` on cache hits too, so an older in-flight request can't overwrite a newer model.
- Model-data errors outrank warning-feed errors in the status pill. Don't let a minor failure hide a major one.
- Keep companion server routes under `/isobar/`, and only have the app assume a same-origin server when it's served from `/` or `/isobar.html`. Both protect a Home Assistant-hosted copy.
- Never pass Spotter Network contact fields through the companion server.
- Re-run the screenshot suite after UI changes and look at the phone shots first. Most use is on the phone.

## Next up

- **Full-resolution model maps:** the biggest possible quality jump. NOAA publishes the raw HRRR, NAM and GFS files for free (NOMADS, and AWS Open Data). The companion server could download the fields Isobar uses after each run and render map tiles at the model's native resolution (3 km for HRRR). Isobar would show those tiles instead of point-sampled maps. This is a larger project: it needs a GRIB decoder (Python with `cfgrib`/`xarray`, or `wgrib2`), disk space, and a few minutes of processing per run.
- **Forum threads:** add a companion server route that fetches each board's latest topics for the Forums tab. First confirm the forum publishes a feed; Invision Community boards usually offer RSS, but it isn't verified here. Cache it for a few minutes to stay polite.

## Credits

- Model data: [Open-Meteo](https://open-meteo.com), CC BY 4.0. Attribution is required and is shown in the Layers panel.
- Radar, satellite, future radar and MRMS: [Iowa Environmental Mesonet](https://mesonet.agron.iastate.edu).
- Warnings: [National Weather Service](https://www.weather.gov).
- Basemap: © OpenStreetMap contributors, © CARTO.
- Forums: [American Weather](https://www.americanwx.com/bb/).
- Chaser positions: [Spotter Network](https://www.spotternetwork.org). Live streams via YouTube.
- Map library: [Leaflet](https://leafletjs.com).
