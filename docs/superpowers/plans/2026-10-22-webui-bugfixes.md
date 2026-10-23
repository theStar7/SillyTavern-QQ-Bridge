# WebUI Bug Fix Implementation Plan

**Goal:** Repair the ten confirmed interaction and authentication defects without redesigning the WebUI or contacting real QQ/SillyTavern services.
**Architecture:** Keep the existing Express, WebSocket and Puppeteer clients. Fix text rendering, form synchronization and connection state at their current boundaries. Reset means creating a new active chat while preserving saved chat files.
**Tech Stack:** Node.js, node:test, Express, ws, Puppeteer.

## Execution

- [x] Add failing browser regression tests for toast injection, profile form synchronization, zero delays, chat refresh, nested errors, disconnected status and authenticated WebSocket URLs.
- [x] Add failing service tests for delay calculation, awaited configuration reconnects, reset-result propagation, WebSocket authentication and intentional NapCat disconnect.
- [x] Implement the frontend corrections in public/js/app.js; update reset wording in public/index.html.
- [x] Make configuration saves await SillyTavern reopening and restart NapCat when connection parameters change. Report reconnect failures explicitly.
- [x] Implement reset through the actual new-chat action, confirm the popup, and wait for chat identity to change before reporting success.
- [x] Authenticate WebSocket upgrades and close subscribers when their token becomes invalid.
- [x] Run node --test tests/*.test.js and inspect the resulting failures before each related implementation.
- [x] Run all regression tests after implementation, including desktop/mobile navigation, logs and theme persistence.
- [x] Review the final diff against the pre-fix snapshot; preserve all unrelated existing changes. Do not commit or deploy.

## Verification boundaries

Tests serve project files through a temporary 127.0.0.1 fixture, replace APIs and external icon assets, and use synthetic credentials. Service tests substitute external browser/network dependencies only. They never read config/config.yaml or send real messages. Real SillyTavern/QQ end-to-end validation remains outside this run.

## Results

- Initial regression run: 1 passed, 20 failed, confirming the reviewed failure paths.
- Independent review found an early queue-resume race during new-chat loading. A delayed-load fixture reproduced it; reset now waits for CHAT_CHANGED and changed chat identity before releasing queued messages.
- Final npm test: 21 passed, 0 failed. JavaScript syntax checks passed.
- Compared all changed production files with the pre-fix snapshot. Existing CSS was byte-for-byte unchanged. The only git diff --check finding is the pre-existing blank line at CSS EOF.
- No real QQ/SillyTavern connection, commit or deployment was performed.
