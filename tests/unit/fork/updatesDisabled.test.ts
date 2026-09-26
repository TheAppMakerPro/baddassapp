/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// BaddAssApp fork: every update path — automatic or from the Settings button —
// must make NO network request. Upstream's updater is wired to the
// FerroxLabs/wayland GitHub releases, and this fork is not published anywhere,
// so any check would contact GitHub for the wrong product.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@office-ai/platform', () => ({
  bridge: {
    buildProvider: vi.fn(() => ({ provider: vi.fn(() => vi.fn()), invoke: vi.fn() })),
    buildEmitter: vi.fn(() => ({ emit: vi.fn(), on: vi.fn() })),
  },
  storage: {
    buildStorage: () => ({
      getSync: () => undefined,
      setSync: () => {},
      get: () => Promise.resolve(undefined),
      set: () => Promise.resolve(),
    }),
  },
}));

vi.mock('electron', () => ({
  app: { getVersion: vi.fn(() => '0.11.3'), getPath: vi.fn(() => '/test/path'), isPackaged: true },
}));

const updater = vi.hoisted(() => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  checkForUpdatesAndNotify: vi.fn(),
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    on: vi.fn(),
    removeListener: vi.fn(),
    quitAndInstall: vi.fn(),
    ...updater,
  },
}));

vi.mock('electron-log', () => ({
  default: { transports: { file: { level: 'info' } }, info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

// Mocked so that, with the policy off, the handlers would reach it; the real
// service returns early when it was never initialised and hides a regression.
const service = vi.hoisted(() => ({
  setAllowPrerelease: vi.fn(),
  checkForUpdates: vi.fn(async () => ({ success: true, updateInfo: { version: '9.9.9' } })),
  downloadUpdate: vi.fn(async () => ({ success: true })),
  quitAndInstall: vi.fn(),
}));
vi.mock('@process/services/autoUpdaterService', () => ({ autoUpdaterService: service }));

const ijfw = vi.hoisted(() => ({ detectLocalInstall: vi.fn(), getLatestPublished: vi.fn() }));
vi.mock('@/process/services/ijfwSystemService', () => ({ ijfwSystemService: ijfw }));

/** The handler registered on an IPC channel by initUpdateBridge(). */
async function handlers() {
  vi.resetModules();
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');
  initUpdateBridge();
  const last = (channel: { provider: unknown }) => {
    const call = vi.mocked(channel.provider as (h: unknown) => unknown).mock.calls.at(-1);
    if (!call) throw new Error('handler not registered');
    return call[0] as (params?: unknown) => Promise<Record<string, unknown>>;
  };
  return {
    check: last(ipcBridge.update.check),
    download: last(ipcBridge.update.download),
    autoCheck: last(ipcBridge.autoUpdate.check),
    autoDownload: last(ipcBridge.autoUpdate.download),
    status: last(ipcBridge.autoUpdate.getStatus),
  };
}

describe('BaddAssApp update policy', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is switched on in this build', async () => {
    const { UPDATES_DISABLED } = await import('@process/fork/updatePolicy');
    expect(UPDATES_DISABLED).toBe(true);
  });

  it('a manual check contacts nothing — no GitHub API, no IJFW registry lookup', async () => {
    const { check } = await handlers();
    const result = await check({ includePrerelease: false });

    expect(result.success).toBe(false);
    expect(String(result.msg)).toMatch(/turned off/i);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(ijfw.getLatestPublished).not.toHaveBeenCalled();
  });

  it('a download request is refused before any URL is touched', async () => {
    const { download } = await handlers();
    const result = await download({
      url: 'https://github.com/FerroxLabs/wayland/releases/download/v9.9.9/Wayland.dmg',
      tagName: 'v9.9.9',
    });

    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the electron-updater check and download never run', async () => {
    const { autoCheck, autoDownload } = await handlers();
    expect((await autoCheck({ includePrerelease: false })).success).toBe(false);
    expect((await autoDownload()).success).toBe(false);
    expect(service.checkForUpdates).not.toHaveBeenCalled();
    expect(service.downloadUpdate).not.toHaveBeenCalled();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.downloadUpdate).not.toHaveBeenCalled();
  });

  it('Settings is told updates are off, with the reason, rather than "available"', async () => {
    const { status } = await handlers();
    const result = await status();
    expect(result.available).toBe(false);
    expect(String(result.error)).toMatch(/installed by hand/i);
  });
});
