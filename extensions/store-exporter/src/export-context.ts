/** Lets an adapter run a self-contained reader inside an open tab of the store's own origin. */
import { TabRequiredError, type ExportContext } from './adapters/types';

/** Firefox defines `browser` (promise-based); Chrome (and Firefox's own compat alias) define `chrome`. */
const ext: WebExtensionApi = typeof browser !== 'undefined' ? browser : chrome;

export const exportContext: ExportContext = {
	async runInTab(origin, func, args) {
		const tabs = await ext.tabs.query({ url: `${origin}/*` });
		const target = tabs.find((candidate) => typeof candidate.id === 'number');
		if (!target || typeof target.id !== 'number') throw new TabRequiredError();
		const results = await ext.scripting.executeScript({ target: { tabId: target.id }, func, args });
		return results?.[0]?.result;
	},
};
