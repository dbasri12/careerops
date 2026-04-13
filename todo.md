# TODO

## Product improvements

- Add a demo mode with seeded sample CV, profile, and tracker data so the app is easier to evaluate and screenshot.
- Let users import/export all local data as JSON, not just the tracker TSV, so they can back up and migrate their setup.
- Add saved application kits per company or role so users can keep tailored CVs, outreach drafts, and interview notes together.
- Improve portal scanning with vendor-specific adapters for Greenhouse, Ashby, Lever, and Workday instead of only generic link scraping.

## Codebase improvements

- Split `index.html` into `index.html`, `app.js`, and `styles.css` to make the app easier to maintain.
- Add lightweight tests around prompt loading, tracker logic, markdown rendering, and scraper response handling.
- Move reusable prompt and workflow config into structured metadata so prompts, labels, and UI modes stay in sync.
- Add a small prompt preview/debug panel in the UI so prompt changes can be inspected without editing source files blindly.

## Reliability and security

- Stop storing the raw Anthropic API key in browser `localStorage`; prefer a local server-side env var option.
- Add retry, timeout, and clearer error states for Anthropic requests and Playwright scraping failures.
- Sanitize rendered markdown before inserting it into the CV preview and report views.
- Add a basic CI workflow for linting, smoke tests, and a startup check of the local server.
