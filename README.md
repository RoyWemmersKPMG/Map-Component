# Leaflet Map — ServiceNow UI Builder Component

A UI Builder custom component that renders a [Leaflet](https://leafletjs.com/) map and
plots points from a JSON coordinates property. Leaflet is bundled via npm (no runtime
CDN dependency for the JS/CSS); map *tiles* still load from OpenStreetMap's tile
servers over the network, so the browser needs outbound access to
`*.tile.openstreetmap.org` (or whatever `tileLayerUrl` you configure).

This structure and every import in `src/leaflet-map/index.js` were verified against a
real `now-cli project` scaffold and built end-to-end with
`now-cli generate-update-set --offline` (ServiceNow CLI 29.0.2 / `@servicenow/ui-core`
24.1.1) — the component compiles cleanly with no errors.

## Project layout

```
now-ui.json                component registration + UI Builder metadata
now-cli.json                local dev server / proxy config
package.json                 dependencies (leaflet, @servicenow/ui-core, ...)
src/index.js                 entry point, imports the component
src/leaflet-map/index.js     component definition
src/leaflet-map/styles.scss  layout (Leaflet requires an explicit map height)
example/element.js           local dev harness (used by `now-cli develop`)
tile-icon/generic-tile-icon.svg   placeholder UI Builder palette icon
```

## Setup

```bash
npm install
```

Component builds/deploys go through the **ServiceNow CLI** (`snc`), a standalone
tool (not an npm package) — install it from
https://developer.servicenow.com/dev.do#!/reference/next-experience/latest/cli/getting-started,
then add the extension that knows how to build and deploy UI Builder components:

```bash
snc extension add --name ui-component
```

### One thing you must change before deploying

Open `now-ui.json` and replace `"scopeName": "x_yourscope"` with your actual
application scope name. ServiceNow enforces a **hard 18-character limit** on
`scopeName` — the CLI will silently truncate it (and warn) if you exceed that,
which is confirmed behavior, not a guess.

## Authenticating the CLI

`snc` uses saved connection profiles rather than per-command credentials:

```bash
snc configure profile set
```

This prompts for your instance URL and credentials once and stores them as the
`default` profile (list/inspect with `snc configure profile list`). Every
`snc ui-component` command below picks that profile up automatically — no
credentials need to be typed per-command or committed anywhere in this repo.

## Build & push to your instance

```bash
npm run deploy                # snc ui-component deploy — builds and pushes the component directly
# or, if you'd rather review/import manually:
npm run generate-update-set   # snc ui-component generate-update-set — builds and emits an update-set XML instead
```

For local iteration without touching the instance:

```bash
npm run develop                # snc ui-component develop — local dev server using example/element.js as the harness
```

## Using it in UI Builder

1. Open your page in UI Builder and drag in the **Leaflet Map** component (the
   `uiBuilder.label` in `now-ui.json`).
2. In the component's property panel, set:
   - **points** — bind to a Data Resource, Script Include/REST call, or a static
     JSON value. Shape:
     ```json
     [
       { "lat": 52.3676, "lng": 4.9041, "label": "Amsterdam" },
       { "lat": 51.5074, "lng": -0.1278, "label": "London" }
     ]
     ```
     `label` is shown in a popup on click. You can pass `popupHtml` instead of
     `label` if you need richer popup markup.
   - **centerLat** / **centerLng** / **zoomLevel** — initial view before points load
     (ignored once points render, if `autoFit` is true).
   - **autoFit** — when true (default), the map zooms/pans to fit all supplied
     points automatically. Set false to keep a fixed view.
   - **tileLayerUrl** / **attribution** — override to use a different tile
     provider (e.g. an internal tile server, Mapbox, etc.).
   - **enableAreaSelect** — when true (default), shows a **Draw area** control
     in the top-right corner of the map.
3. Give the component a height in the page's layout (or a CSS class) — Leaflet
   collapses to a gray box if its container has 0 height. `styles.scss` sets a
   `min-height: 320px` fallback, but a real layout height is recommended.

### Selecting points inside a drawn area

Click **Draw area**, then click the map to place polygon vertices (3+), then
click **Finish area** (or press `Esc` to cancel mid-draw). On finish, the
component dispatches an `AREA_SELECTED` event with:

```js
{
  points: [ /* the point objects from `points` that fall inside the drawn shape */ ],
  polygon: [ { lat, lng }, /* ... the vertices you drew */ ]
}
```

Wire this up in UI Builder's **Events** tab (bind "Area selected" to update a
page variable, trigger a Data Resource, etc.), or listen for it directly from
a client script:

```js
document
  .querySelector('[data-component-id="..."]') // or however you locate the element
  .addEventListener('AREA_SELECTED', (e) => console.log(e.detail.payload));
```

## Notes on things that were non-obvious while building this

- The component renders in a **shadow root**, so Leaflet's CSS can't rely on a
  bare `import 'leaflet/dist/leaflet.css'` side-effect import — that would land
  in `document.head` via the framework's build pipeline and never reach the
  shadow DOM. Instead, `index.js` imports the CSS as a string and concatenates
  it into the `styles` value passed to `createCustomElement`, which *is* the
  sanctioned shadow-DOM-scoped injection point.
- Default marker icon images are re-pointed to their bundled webpack asset URLs
  (a well-known Leaflet + webpack integration fix) — no extra action needed.
- The `view` function deliberately renders the map canvas `<div>` with no
  children in its virtual DOM node. Snabbdom (the renderer) leaves a vnode's
  real DOM subtree untouched when the vnode declares no children of its own,
  which is what lets Leaflet own that div's contents imperatively without the
  renderer wiping it out on every unrelated state/property change.
- The registered custom element tag name (`leaflet-map` in `index.js`), the
  `src/leaflet-map` folder name, and the `now-ui.json` component key must all
  match exactly — the CLI applies your app's scope prefix automatically at
  deploy time.
- If your instance's CSP blocks OpenStreetMap's tile domain, either allowlist
  `*.tile.openstreetmap.org` or point `tileLayerUrl` at a self-hosted/approved
  tile server.
