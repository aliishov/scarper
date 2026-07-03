# Parallel Scraping Capability

## Conclusion

True parallel scraping is not reliable for the current social scraper architecture inside a pure Chrome Extension.

News scraping can be parallel inside the extension when it avoids human-like UI automation:

- direct search URLs;
- content script DOM parsing after page load;
- article tabs opened in the background;
- per-source state and serialized result writes;
- CONTENT_READY handshake after every navigation.

Social scraping should be treated as sequential or focus-scheduled in the extension. Facebook, Instagram, TikTok, and X/Twitter use focus, caret, hover, click, scroll, and synthetic keyboard/mouse events. Chrome has only one focused window at a time, and synthetic DOM events do not have real user activation.

For true parallel social scraping, use an external automation engine such as Playwright/CDP/native helper.

## Evidence Sources

- Chrome extension service workers can stop after 30 seconds of inactivity and lose globals; state must be persisted: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- Chrome windows `focused: true` brings one window to the front; it is not a multi-focus model: https://developer.chrome.com/docs/extensions/reference/api/windows
- Chrome content scripts run in web pages, but in isolated worlds: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome messaging is asynchronous and requires explicit response handling: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
- Chrome hidden pages can throttle chained timers heavily: https://developer.chrome.com/blog/timer-throttling-in-chrome-88/
- MDN: events dispatched through `dispatchEvent()` are not trusted; `HTMLElement.click()` produces an untrusted click: https://developer.mozilla.org/en-US/docs/Web/API/Event/isTrusted
- MDN: user activation requires trusted input events: https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation
- Playwright pages behave like focused active pages without bringing each to front, which is different from ordinary Chrome extension tabs: https://playwright.dev/docs/pages
- Playwright achieves parallelism through independent worker processes: https://playwright.dev/docs/test-parallel
- Chrome Debugger API exposes CDP power but is a different architecture and permission/security tradeoff: https://developer.chrome.com/docs/extensions/reference/api/debugger

## Current Code Root Causes

- Social mode is explicitly sequential: `background.js` has `runSocialSourcesSequentially()` and logs `Social focus queue enabled concurrency=1`.
- Social scrapers require focus/caret/UI events:
  - `core/navigation.js` checks `document.activeElement`, caret, synthetic key/mouse events.
  - `scrapers/facebook.js` has Facebook-specific focus/caret typing, hover date parsing, and visible scrolling.
  - `scrapers/twitter.js`, `scrapers/tiktok.js`, and news UI flows also use typing/Enter/scroll paths.
- State-machine locks are per source run now, not global for the parent run, but the UI automation dependency remains.
- MV3 service worker globals are not durable; background orchestration must persist state and use messages/alarms.

## Diagnostic Mode

Run from an extension context:

```js
chrome.runtime.sendMessage({
  action: 'RUN_PARALLEL_CAPABILITY_TEST',
  keyword: 'Məhkəmə'
});
```

The response contains:

- `testAContentScriptParallelDom`
- `testBParallelNewsNavigation`
- `testCParallelSocialUiEvents`
- `testDWindowFocusReality`

Expected interpretation:

- If Test A has heartbeat counts from 5 news tabs, parallel content scripts are alive.
- If Test B has cards from several news sources, direct URL DOM scraping can run in parallel.
- If Test C shows only one focused/active social page and unreliable Enter acceptance, true parallel social UI automation is not reliable.
- If Test D shows only one actual focused window after focus requests, Chrome confirms the focus bottleneck.

## Decision Matrix

| Approach | News parallel | Social parallel | Reliability | Complexity | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Pure Chrome Extension tabs | Yes for DOM/direct URL | No, not reliably | Medium for news, low for social | Medium | Use for news only |
| Chrome Extension separate windows | Yes for DOM/direct URL | No, focus bottleneck remains | Medium for news, low for social | Medium | Current best extension-only model |
| Extension + focus scheduler | News parallel, social sequential | Sequential social only | High honesty, medium throughput | Medium | Recommended in extension |
| Extension + chrome.debugger/CDP | Possible | Possibly better | Medium, intrusive permissions | High | Experimental |
| Native messaging + Playwright | Yes | Yes, with isolated contexts/workers | High | High | Best for real parallel social |
| External backend scraper | Yes | Yes, if using browser automation or APIs | High | High | Best long-term scale |

## Recommendation

Use Option A now: news parallel inside the extension, social sequential/focus-scheduled with clear UI wording.

Use Option B later if true parallel social is required: keep the extension as UI/control plane and move social browser automation into Playwright/CDP/native helper.
