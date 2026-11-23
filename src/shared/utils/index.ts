export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Pages Chrome never lets extensions script (internal pages, Web Store, other extensions). */
export function isScannableUrl(url: string | undefined): boolean {
  if (!url) return false
  if (!/^(https?|file):/.test(url)) return false
  return !/^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(url)
}

/** Turns Chrome's tab/scripting/messaging errors into actionable messages. */
export function friendlyTabError(err: unknown): string {
  const msg = errorMessage(err)
  if (/Cannot access|cannot be scripted|chrome:\/\/|extensions gallery/i.test(msg))
    return 'This page cannot be scanned (browser or store pages are restricted).'
  if (/activeTab|permission/i.test(msg))
    return 'Permission expired. Reopen Locator Studio from the toolbar on this tab and scan again.'
  if (/No tab with id/i.test(msg)) return 'The scanned tab has been closed. Scan a page again.'
  if (/Receiving end does not exist|message port closed/i.test(msg))
    return 'Locator Studio is no longer connected to the scanned page: it reloaded or navigated, or the extension was reloaded, after the scan. Go back to that tab, click the Locator Studio toolbar icon and press Scan page.'
  if (/QUOTA_BYTES|quota/i.test(msg))
    return 'The scan result is too large to store locally. Try scanning a smaller page.'
  return msg
}
