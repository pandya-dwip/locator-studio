# Locator Studio

A Chrome extension for QA engineers who write Playwright tests. Locator Studio scans the current page on demand, extracts the relevant elements, suggests Playwright locator strategies, checks that they are unique and robust, and generates Page Object Model code in TypeScript or JavaScript.

> **Status: M3, Locator Engine.** Scanning extracts real elements from the active page. Selecting one in the workspace **Elements** view shows ranked Playwright locator candidates with stability explanations and a preliminary recommendation. Validating candidates against the live page (M4) and the POM generator come next.

Everything runs locally. There is no backend, no account, no telemetry and no network calls. Data is kept in `chrome.storage.local`.

## Technology stack

| Area | Choice |
| --- | --- |
| Extension platform | Chrome Manifest V3 |
| UI | React 19 + TypeScript (strict) |
| Build | Vite 8 + [CRXJS](https://crxjs.dev) 3 (`@crxjs/vite-plugin`) |
| Icons | lucide-react |
| Tests | Vitest + jsdom |
| Styling | Plain CSS with design tokens, light and dark themes |

## Prerequisites

- **Node.js** `^22.12.0` or `>=24.0.0` (Node 20 is end-of-life, and Vitest requires 22.12+). The current LTS is recommended: <https://nodejs.org/en/download>
- **npm** (bundled with Node.js)
- **Google Chrome** (or another Chromium browser)
- Windows PowerShell 5.1+ or PowerShell 7+ for the helper scripts. On other platforms, use the npm scripts directly.

## Initial setup

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

The setup script checks Node.js and npm, installs dependencies from `package-lock.json` (`npm ci`) and verifies the result. It is safe to run again at any time: it skips the install when `node_modules` is already up to date and never touches source files.

If your execution policy already allows local scripts, you can run `.\scripts\setup.ps1` directly. Every script works from any working directory.

## Development mode

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1     # or: npm run dev
```

This starts Vite on **http://localhost:5180** and writes a development build to `dist\`. Load `dist\` as an unpacked extension (see below) and keep the terminal open. UI changes hot-reload, and background changes reload the extension automatically.

The port is fixed because the development build loads its modules from it. If something else is using port 5180, change `server.port` in `vite.config.ts`.

## Production build

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1     # or: npm run build
```

Output goes to `dist\`. The script then checks that the manifest, popup, workspace, background worker and content script are all present, and prints the absolute output path.

## Checks

```powershell
powershell -ExecutionPolicy Bypass -File scripts\check.ps1     # or: npm run check
```

Runs `tsc --noEmit` (strict), the unit tests, the production build, then the build-output checks. It exits non-zero on any failure, so it can be used in CI.

| npm script | Does |
| --- | --- |
| `npm run dev` | Vite dev server + CRXJS dev build in `dist/` |
| `npm run build` | Production build in `dist/` |
| `npm run typecheck` | TypeScript check, no output files |
| `npm run test` | Scanner, locator engine, escaping and explorer unit tests (Vitest, jsdom) |
| `npm run test:watch` | Tests in watch mode |
| `npm run check` | `typecheck`, `test`, then `build` |

## Loading the extension in Chrome

1. Run `scripts\build.ps1` (or `scripts\start.ps1` for development).
2. Open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project's `dist` folder.
5. Pin Locator Studio from the puzzle-piece menu in the toolbar.
6. Open any `http(s)` page, click the Locator Studio icon and press **Scan page**.
7. Click **Open workspace** and go to **Elements**. Select an element to see its **Locators**, copy one, or press **Highlight on page**.

After a production rebuild, click the reload icon on the extension's card in `chrome://extensions`.

To scan local `file://` pages, enable **Allow access to file URLs** on the extension's details page.

## How it fits together

```
Popup ──START_SCAN──▶ Background ──executeScript──▶ Content script ──▶ core/scanner (DOM → records)
                          │      ◀──SCAN_PAGE / ScanResult──┘   (keeps live element registry)
                          ▼
   chrome.storage.local: scanState (small, popup) + scanResult (full, workspace)
                          ▲
Workspace / Elements ─────┘    Workspace ──HIGHLIGHT_ELEMENT──▶ Content script (overlay)
        │
        └──▶ core/locator-engine (in the workspace, in memory) ──▶ Locators panel
```

- **Permissions:** only `activeTab`, `scripting` and `storage`. There are no host permissions and no content scripts that run automatically on every page. The content script is injected only into the tab where you clicked **Scan page**, using the temporary access Chrome grants when you click the toolbar icon.
- **Workspace:** the full-page workspace is registered as the extension's options page (opens in a tab). The popup's **Open workspace** button, or right-click icon → **Options**, opens it or focuses the existing tab.
- **No logic in React components:** components call small functions in `src/shared/messaging` and `src/storage`. The background worker and content script contain no UI code.

## DOM Scanner (v1)

The scanner (`src/core/scanner/`) is plain TypeScript with no React and no `chrome.*` calls. The content script runs it when you press **Scan page**. It reads the DOM **as it is at that moment**: it never clicks, types, submits, scrolls or waits for lazy content. To pick up later changes, scan again.

| File | Responsibility |
| --- | --- |
| `scanner.ts` | One pass over the document and its open shadow roots; builds records and the summary |
| `classify.ts` | Decides relevance, primary category, extra categories, hints and role (explicit or implicit) |
| `state.ts` | Visibility and enabled-state detection |
| `text.ts` | Bounded text previews and accessible-name approximation |
| `attributes.ts` | Allow-listed attributes and DOM properties |

### What is extracted

| Category | Elements |
| --- | --- |
| Interactive | `button`, `a`, `summary`, `details`; ARIA widget roles (button, link, checkbox, radio, switch, tab, menuitem*, option, combobox, slider, spinbutton, textbox, searchbox, listbox, treeitem); non-native elements made focusable with `tabindex≥0`; `contenteditable` hosts; elements with an `onclick` attribute (flagged as a hint, never given an invented role) |
| Form | `form`, `input` (except `type=hidden`), `textarea`, `select`, `option`, `optgroup`, `datalist`, `output`, `label`, `fieldset`, `legend` |
| Navigation | `nav`, and the navigation, menubar, menu, tablist and tree roles. Links inside a nav also get this as a second category. |
| Text | `h1`–`h6`, `p`, `blockquote`, `pre`, `figcaption`, heading/status/alert/tooltip/note roles, and childless elements with their own text (at least 2 characters) that no extracted ancestor already covers |
| Media | `img`, `svg` (plus links inside SVG; shapes are skipped), `video`, `audio`, `canvas`, `iframe`, `object`, `embed` |
| Table | `table`, `thead`, `tbody`, `tfoot`, `tr`, `th`, `td`, `caption`, grid/row/cell roles |
| List | `ul`, `ol`, `li`, `dl`, `dt`, `dd`, `menu`, list/listitem roles |
| Structural | `main`, `header`, `footer`, `aside`, `section`, `article`, `dialog`, `figure`, `search`, landmark roles. Also generic elements that carry a test id, `aria-label` or `title`. |
| Custom | Custom elements (tag contains `-`) without other semantics. They are not assumed to be interactive. |

Each DOM element produces **at most one record**. Its `category` is the primary one used for grouping, and `categories` lists everything it matched. For example, an `<input>` inside a form is `['form', 'interactive']`, and a link in a `<nav>` is `['interactive', 'navigation']`. Generic `div`s and `span`s are only extracted when they carry meaning (a role, test id, label, focusability or their own text), so the explorer isn't flooded.

Each record contains:
- tag, primary and extra categories, and hints (`tabindex`, `contenteditable`, `onclick-attribute`, `test-id`);
- allow-listed attributes (id, class, name, type, role, all `aria-*`, placeholder, title, alt, href, src, for, tabindex, autocomplete, required/disabled/readonly, and non-sensitive `data-*` such as `data-testid`);
- a text preview (at most 200 characters) and an approximate accessible name;
- explicit or implicit role, visibility, viewport and enabled state;
- DOM properties (input type, checked, selected, required, read-only, disabled, multiple, contenteditable);
- parent tag, nearest extracted ancestor, child count, depth, and whether the element is inside a shadow root.

Record ids (`el-1`, `el-2`, …) are handles valid within one scan only. The content script maps them back to the live elements through weak references. DOM nodes are never serialized.

The scanner produces **no CSS selectors, XPath or Playwright locators**. That is the Locator Engine's job in a later milestone, and a test enforces this.

### Visibility

Each element gets one `visibility` status and a `visibilityReason`:

| Status | Reason |
| --- | --- |
| `not-rendered` | `display: none` on the element, the `hidden` attribute, or an ancestor that isn't rendered (including closed `<details>` and `content-visibility: hidden`) |
| `hidden` | `visibility: hidden`/`collapse`, `opacity: 0` on the element or an ancestor, a 0×0 box, or a 1×1 px "screen-reader only" box |
| `obscured` | Rendered in the viewport, but the element's centre point is covered by another element (a hit test, so it's a hint: partial overlap isn't detected) |
| `visible` | Rendered. Off-screen elements stay `visible` with reason `outside-viewport` and `inViewport: false`, because the user can scroll to them. |
| `unknown` | Cannot be measured (for example, detached during the scan) |

`opacity: 0` is reported as `hidden`, separately from `display: none` (`not-rendered`). In Chrome the ancestor checks use `Element.checkVisibility()`. Each element's computed style is read once per scan, and layout is only measured for rendered elements. `<option>`s take the visibility of their `<select>`.

### Enabled state

| Status | Meaning |
| --- | --- |
| `disabled` | Native `:disabled` (including inheritance from `<fieldset disabled>`), `aria-disabled="true"` on the element or an ancestor, or inside an `inert` subtree |
| `readonly` | Native `readonly` on text-like inputs or textareas, or `aria-readonly="true"`. Reported separately from disabled. |
| `enabled` | Interactive or form element that is neither of the above |
| `not-applicable` | Non-interactive content such as headings, landmarks and lists. These are never reported as disabled. |

### Shadow DOM and iframes

- **Open shadow roots** are scanned recursively, right after their host, so document order is preserved. Records inside them have `inShadowRoot: true` and point to their host as `parentId`.
- **Closed shadow roots** cannot be seen from content scripts using standard DOM APIs, so their contents are **not scanned**. The host element itself is still recorded.
- **iframes** are recorded as media elements, but their documents are **not scanned** in v1, whether same- or cross-origin. The summary counts them as `framesNotScanned`. Scanning cross-origin frames would need broad host permissions, which this extension deliberately does not request. The scanner takes a `Document`, so per-frame scanning can be added later.

### Limits and performance

- Up to **5,000 elements** per scan (`SCAN_LIMITS` in `src/shared/constants`). This keeps the stored result under `chrome.storage.local`'s 10 MB quota. When the limit is hit, the explorer shows a warning.
- Measured in headless Chrome: a page of about 49,000 DOM nodes scanned in about 330 ms (stopping at the 5,000-element limit), producing a 2.2 MB result.
- If one element throws during inspection, it is skipped and counted (`skippedElements`). The rest of the scan continues.
- The explorer list uses `content-visibility: auto` and deferred search, so it stays responsive with thousands of rows.

### Privacy

- **Input values are never read:** no `.value`, no `value` attribute on text-like inputs, and no textarea contents. Passwords, typed text and prefilled data are therefore never collected. `value` is kept only where it is author markup: `<option>`, `<button>`, and button/checkbox/radio inputs.
- `type="hidden"` inputs (which often carry CSRF tokens) are skipped entirely.
- Text inside `contenteditable` regions (rich-text editors) is never collected.
- `data-*` attributes whose names suggest secrets or personal data (token, secret, csrf, auth, session, password, key, email, phone, user, account, card, …) are dropped. Attribute values are truncated, and `data:` URLs are summarised.
- Inline `onclick` code is replaced by the placeholder `(inline handler)`.
- Page text is untrusted. It is rendered only as React text, never as HTML, and the highlight label is set with `textContent`.
- Results stay in `chrome.storage.local`. There are no network requests and no telemetry, and permissions are unchanged.

### Highlighting

In **Elements**, **Highlight on page** brings the scanned tab to the front and outlines the element. The outline is a fixed-position overlay in its own closed shadow root, so the page's elements and styles are never modified. It is removed on <kbd>Esc</kbd>, on any click on the page, on the next highlight, or when the page is scanned again. If the element was removed or re-rendered since the scan, or the page reloaded, you are asked to scan again.

### Tests

```powershell
npm run test
```

`tests/unit/scanner.test.ts` runs the scanner against jsdom fixtures. It covers:
- buttons, links and ARIA widgets;
- labelled inputs, textareas, selects and options;
- test ids and duplicate ids;
- headings and text relevance, landmarks, tables, lists, and media/SVG;
- every visibility case, including obscured;
- disabled (native, fieldset, aria) and readonly states;
- custom elements, and open versus closed shadow roots;
- empty documents, malformed markup, elements that throw during inspection, and large DOMs with truncation;
- that sensitive values are never collected, and that no locators are generated.

`tests/unit/explorer-format.test.ts` covers the explorer's search and filter.

jsdom has no layout engine, so the tests stub `getBoundingClientRect` and exercise the scanner's fallback visibility path. The native `checkVisibility` path was checked separately by running the built content script in headless Chrome. See the limitations below.

### Known limitations (v1)

- Snapshot only. There is no automatic rescan on DOM changes, and lazy-loaded or virtualised content that isn't in the DOM yet is not seen. (`scanDocument` is a pure function of the DOM, so a MutationObserver-driven rescan can wrap it later.)
- No scanning inside iframes or closed shadow roots.
- The accessible name is an approximation of the accname algorithm. It covers aria-labelledby, aria-label, labels, alt, legend/caption, name-from-content, title and placeholder, but doesn't evaluate CSS-generated content or hidden-ness inside names.
- "Obscured" checks only the element's centre point. Clipping by `overflow`/`clip-path` containers is not detected, except for the 1 px "screen-reader only" pattern.
- Elements inside a `contenteditable` region are still listed, but without text.
- Visual hit-testing and the highlight overlay were tested in headless Chrome with a stubbed extension API. The full extension flow (toolbar click → scan → workspace → highlight) still needs a manual check in Chrome.

## Locator Engine (M3)

`src/core/locator-engine/` turns each `ScannedElement` into Playwright locator candidates. Like the scanner, it is plain TypeScript: no DOM access, no `chrome.*` calls and no React.

| File | Responsibility |
| --- | --- |
| `engine.ts` | Runs the strategies per element, then a batch step: duplicate detection across the scan, ordering and recommendation. Provides `generateLocators` (sync) and `generateLocatorsAsync` (chunked, abortable). |
| `strategies/semantic.ts` | `getByTestId`, `getByRole`, `getByLabel`, `getByPlaceholder`, `getByAltText`, `getByTitle`, `getByText` |
| `strategies/selectors.ts` | CSS and XPath from the element's own attributes, plus the structural fallback |
| `utils/escaping.ts` | JavaScript string, CSS identifier, CSS string and XPath literal escaping; expression building |
| `utils/stability.ts` | Detection of generated values, text-volatility checks and stability levels |

The workspace generates locators when a scan result loads, and again when the scan or the **Test ID attribute** setting changes. It works in chunks of 250 elements so the UI stays responsive. The results are derived data and are kept in memory only: about 13,000 candidates for 4,000 elements would not fit in storage, and regenerating them takes around 70 ms.

### Strategies

Each strategy produces a candidate only when the scanned data justifies it. Nothing is guessed from nearby text.

| Strategy | Generated when | Example |
| --- | --- | --- |
| Test ID | The element has the configured test-id attribute (default `data-testid`). Other test attributes (`data-test`, `data-cy`, `data-qa`, …) become CSS, with a note explaining that `getByTestId()` only reads the attribute set as `testIdAttribute` in `playwright.config`. | `page.getByTestId('login')`, `page.locator('[data-cy="login"]')` |
| Role | The role is a valid ARIA role (explicit, or implicit from the tag) and the element has a complete accessible name of 80 characters or less. Unnamed elements only get a role locator if they are landmarks (`main`, `banner`, `navigation`, …). Headings include `level`. Never for `presentation`/`none`/`generic`, `aria-hidden` elements, or elements with only an `onclick`. | `page.getByRole('button', { name: 'Log in' })` |
| Label | Form controls (or widget roles such as textbox or checkbox) whose accessible name comes from a `<label>`, `aria-label` or `aria-labelledby`. Never from placeholder, title or surrounding text. | `page.getByLabel('Email address')` |
| Placeholder | A meaningful `placeholder` attribute | `page.getByPlaceholder('Search products')` |
| Alt text | `img`/`area`/`input` with meaningful `alt` text (not a file name, and not generic like "image") | `page.getByAltText('Company logo')` |
| Title | A meaningful `title` attribute | `page.getByTitle('Close dialog')` |
| Text | The element's text content (not its accessible name) when it is 80 characters or less, complete, and contains letters or digits. Not used for form controls. | `page.getByText('Welcome back')` |
| CSS | Each at most once: `#id`; `tag[name="…"]` for form elements; one semantic attribute (`href`, `for`, `action`, `aria-label`, `type`, `role`); and up to two meaningful classes. State classes (`active`, `is-open`, `ng-dirty`), utility classes (Tailwind, Bootstrap), generic classes (`wrapper`, `item`) and generated classes are skipped. | `page.locator('#login-button')`, `page.locator('input[name="email"]')` |
| XPath | One attribute-based XPath (id → test id → name → aria-label → placeholder → title → alt → href → type), or an exact-text XPath. Never absolute paths, and never inside shadow DOM, which XPath cannot reach. | `page.locator('//button[@type="submit"]')` |
| Structural fallback | Only when **nothing else** was generated: the nearest scanned ancestor with a hand-written id or test id, plus the tag (CSS and XPath). Always `unstable` and never recommended. | `page.locator('#results li')` |

Expressions are built only through the escaping helpers (`jsString`, `cssIdent`, `cssString`, `xpathString`, `pageCall`). Quotes, backslashes, newlines, control characters and Unicode are all handled. XPath values that mix both quote types use `concat()`. Role and text matching use Playwright's default case-insensitive substring matching. The expression builder supports `exact: true`, which the validator can add once it can see whether a substring match is ambiguous.

### Stability

Stability describes **how likely a locator is to survive page changes**. It says nothing about uniqueness. Every candidate lists its reasons.

| Level | Typical sources |
| --- | --- |
| `stable` | Explicit test ids; role plus an accessible name from content, label or aria-label; associated labels; alt text; title; hand-written ids; form `name` attributes; `aria-label`/`for` selectors |
| `moderate` | Placeholders; visible text; class selectors; `href`/`action`/`type`/`role` selectors; names taken from `title` or `placeholder`; unnamed landmarks; values containing numbers (`item42`) |
| `unstable` | Generated values (UUIDs, React `:r1:`/`«r1»` ids, `ember1234`, `css-1x2y3z`, CSS-module hashes `Button__3xK9a`, styled-components `sc-bdVaJa`); text that is long, numeric or symbol-only after a downgrade; structural fallbacks |
| `unknown` | Reserved for cases without enough information |

Text concerns (numbers, more than 40 characters, no letters or digits) lower a candidate by one level. For example, `getByText('3 new messages')` drops from `moderate` to `unstable`.

### Recommendation

At most one candidate per element is recommended. Candidates are sorted by **stability first**, then by strategy preference:

1. Test ID
2. Role with a name
3. Label
4. Placeholder
5. Alt text
6. Title
7. CSS id, name or semantic attribute
8. Unnamed landmark role
9. Text
10. CSS class
11. XPath
12. Structural fallback

So a stable `#postcode` beats a moderate `getByPlaceholder`, while a stable `getByTitle('Close dialog')` beats a symbol-only `getByRole('button', { name: '×' })`.

A candidate is recommended only if it is `stable` or `moderate` **and** was not also generated for another scanned element. If the same expression is produced for two elements (duplicate ids, 700 rows each with an "Edit" button), it provably cannot be unique. Such candidates are marked **shared** and skipped. If nothing qualifies, the element gets **no recommendation**, with a reason: not enough information, every good candidate is shared, or only unstable candidates exist. All other candidates stay listed as alternatives, recommended one first.

### Why generation and validation are separate

A locator's real match count depends on the **live page**: elements the scanner didn't extract, Playwright's substring matching, hidden elements, and the page changing after the scan. The engine only sees scanned metadata, so it never reports a match count or claims uniqueness. `GeneratedLocator.validation` stays `undefined`, and the UI shows "Not validated yet". The one exception is negative evidence: two scanned elements receiving the identical expression proves the locator is *not* unique (`sharedWith`). The Locator Validator (M4) will run candidates against the page and fill in `validation`.

### Workspace

Select an element in **Elements** to see its **Locators**:
- every candidate with its strategy, a readable value, a stability badge, a ★ for the recommendation and a *shared* badge where it applies;
- for the selected candidate: the full expression with a **Copy** button, stability and its reasons, the attributes it was built from, notes, and its uniqueness status.

**Settings → Test ID attribute** must match `testIdAttribute` in your `playwright.config`.

### Tests

```powershell
npm run test
```

- `tests/unit/locator-escaping.test.ts`:
  - JavaScript literals round-trip through a real parser;
  - CSS identifiers and strings are checked with `querySelector`;
  - XPath literals are checked with `document.evaluate`;
  - expression formatting.
- `tests/unit/locator-engine.test.ts` runs realistic fixtures through the real scanner and engine. On every element of every fixture it checks that:
  - each expression parses as exactly one valid `page.*` call;
  - each CSS/XPath candidate selects its own element in the DOM;
  - each `getBy*` argument matches the element's actual attribute, text, role or name;
  - no validation data is present.

  It covers all 20 required cases, plus stability rules, ordering, recommendation, batch failure isolation, async/abort behaviour, non-mutation of the scan and a large table.

Separately, the built scanner and engine were run on a 4,200-element fixture in headless Chrome. All 13,394 expressions parsed, and all 2,134 CSS and 4,222 XPath candidates selected their target element, including emoji, quote-mixed and digit-leading ids.

### Known limitations

- Accessible names come from the scanner's approximation (see the DOM Scanner section). A wrong name produces a wrong `getByRole`/`getByLabel` until validation catches it.
- Role and text locators use substring matching, so `'Save'` also matches "Save draft". Duplicate detection only catches *identical* expressions; overlapping substrings need the validator.
- Duplicate detection only sees scanned elements. Elements the scanner skipped can still collide.
- No positional (`nth`) or chained/filtered locators (`getByRole(...).filter(...)`, `locator(...).getByText(...)`). Ancestor-anchored selectors are the only structural form.
- Stability is heuristic. Generated-value detection can miss unusual schemes or flag unusual hand-written names.
- Locators are regenerated on every workspace load and not stored.

## Project structure

```
locator-studio/
├── public/icons/            Extension icons (16, 32, 48, 128 px)
├── scripts/                 PowerShell helpers: setup, start, build, check (+ common.ps1)
├── src/
│   ├── background/          Service worker: message routing, on-demand injection, scan state
│   ├── content/             Content script: runs the scanner, element registry, highlight overlay
│   ├── popup/               Toolbar popup (React)
│   ├── workspace/           Full-page workspace shell, sidebar and routing (React)
│   ├── core/
│   │   ├── scanner/         DOM Scanner v1: traversal, classification, visibility, text
│   │   ├── locator-engine/  Locator Engine: strategies, escaping, stability, recommendation
│   │   └── validator/       Uniqueness and quality checks (next milestone)
│   ├── features/            Workspace pages: dashboard, explorer (Elements + Locators panel), inspector,
│   │                        pom-generator, settings, export
│   ├── generators/playwright/  POM code generation, TS + JS (next milestone)
│   ├── shared/
│   │   ├── types/           Message, scan and settings types
│   │   ├── constants/       Storage keys and defaults
│   │   ├── messaging/       Typed messaging helpers between contexts
│   │   ├── utils/           Small helpers (errors, URL checks, theme)
│   │   ├── ui/              Shared React components
│   │   ├── hooks.ts         React hooks over storage (scan state, settings)
│   │   └── mount.tsx        Common page bootstrap
│   ├── storage/             chrome.storage.local wrapper
│   └── styles/              Design tokens and base styles (light and dark)
├── tests/unit/            Vitest tests (scanner, locator engine, escaping, explorer search)
├── tests/integration/     (reserved)
├── index.html               Popup page
├── workspace.html           Workspace page
├── manifest.config.ts       Manifest V3 definition (CRXJS)
├── vite.config.ts
├── vitest.config.ts       Test config (jsdom; excludes the CRXJS plugin)
└── tsconfig.json
```

## Re-running the scripts

All scripts can be run repeatedly:

- `setup.ps1`: reinstalls only when `package.json` or `package-lock.json` is newer than the last install. To force a clean install, delete `node_modules` and run it again.
- `start.ps1`, `build.ps1`, `check.ps1`: check that Node.js and the dependencies are present first, and tell you to run `setup.ps1` if they are missing. `check.ps1` runs the unit tests too.

## Known notes

- CRXJS's content-script sub-build prints `WARN inlineDynamicImports option is ignored`. This comes from CRXJS and is harmless.
- `vite.config.ts` removes the `web_accessible_resources` entry that CRXJS adds for the injected content script. `chrome.scripting` doesn't need it, and leaving it in would let any website detect the extension.
- The background entry is `src/background/service-worker.ts`, not `index.ts`. CRXJS 3 confuses two entry points that share a filename and would load the content script as the service worker.
