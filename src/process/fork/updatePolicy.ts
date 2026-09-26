/**
 * BaddAssApp fork policy: this build never checks for, or downloads, updates.
 *
 * Upstream's updater is wired to the FerroxLabs/wayland GitHub releases —
 * `DEFAULT_REPO` in process/bridge/updateBridge.ts and `owner`/`repo` in the
 * generated app-update.yml. Left as-is in this fork, every launch contacted
 * GitHub three seconds after start-up to look for UPSTREAM releases, and the
 * Settings "Check for updates" button did the same through the GitHub API. Any
 * update it offered would have been the un-rebranded Wayland app, not this one.
 *
 * BaddAssApp is not published anywhere, so there is no feed to point it at:
 * new versions are built and installed by hand. The honest behaviour is to make
 * no update requests at all and to say so in Settings.
 *
 * This lives in its own file so an upstream merge conflicts at the few call
 * sites that read it, where the change is one line each, rather than inside
 * upstream's updater code.
 */

/** When true, no automatic or manual update check or download runs. */
export const UPDATES_DISABLED = true;

/** Shown in Settings and returned to the update dialog instead of a result. */
export const UPDATES_DISABLED_REASON =
  'Updates are turned off in BaddAssApp. New versions are built and installed by hand, so it never contacts an update server.';
