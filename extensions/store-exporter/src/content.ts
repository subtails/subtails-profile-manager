/**
 * The content script on subtails pages (spec-epic-ownership story 5). It does one thing: tell the
 * background worker that a subtails page was visited. It reads nothing from the page, holds no data and
 * fails silently. The worker decides everything else (sender check, daily cap, grant, session).
 */
const ext: WebExtensionApi = typeof browser !== 'undefined' ? browser : chrome;

try {
	ext.runtime.sendMessage({ kind: 'subtails-visit' }).catch(() => {
		// No worker listening (the extension reloaded): nothing to do.
	});
} catch {
	// The extension context is gone.
}
