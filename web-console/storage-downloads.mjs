// @editedBy SherrySherry 2026-11-22
const repository = 'SherrySherry-1230/HaemaAI_SherrySherry';
const tag = 'console-installers';
const releaseApi = 'https://api.github.com/repos/' + repository + '/releases/tags/' + tag;
const downloadBase = 'https://github.com/' + repository + '/releases/download/' + tag + '/';
const installerNames = Object.freeze({
    windows: 'haema-ai-windows-20261122.zip',
    macos: 'haema-ai-macos.zip',
});
// Use these fixed hrefs on a user gesture. The registered Windows app confirms the target folder.
export const windowsLauncherHandles = Object.freeze({
    aiStart: 'haema-ai://ai-start',
    start: 'haema-ai://start',
    stop: 'haema-ai://stop',
});
const windowsDownload = Object.freeze({
    url: downloadBase + installerNames.windows,
    fileName: installerNames.windows,
});

export function detectDownloadPlatform(navigator = globalThis.navigator) {
    const platform = navigator?.userAgentData?.platform || navigator?.platform || navigator?.userAgent || '';
    if (/Windows|Win32|Win64|WinCE/i.test(platform)) return 'windows';
    if (/mac/i.test(platform) && !(navigator?.maxTouchPoints > 1 && platform === 'MacIntel')) return 'macos';
    return '';
}

export function parseInstallerRelease(release) {
    const downloads = {};
    if (!release || release.tag_name !== tag || release.draft !== false || release.prerelease !== false ||
        !Array.isArray(release.assets)) return { state: 'unavailable', downloads };

    for (const [platform, fileName] of Object.entries(installerNames)) {
        const matches = release.assets.filter(asset => asset?.name === fileName);
        if (matches.length !== 1) continue;
        const [asset] = matches;
        const url = downloadBase + fileName;
        if (asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0 &&
            asset.browser_download_url === url) downloads[platform] = { url, fileName };
    }
    return { state: Object.keys(downloads).length ? 'available' : 'unpublished', downloads };
}

export async function loadDownloads(fetcher = globalThis.fetch) {
    try {
        const response = await fetcher(releaseApi, {
            credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(8000),
        });
        if (response.status === 404) return { state: 'unpublished', downloads: {} };
        if (response.ok) return parseInstallerRelease(await response.json());
    } catch { /* The published Windows asset also has a stable download URL. */ }
    // GitHub limits anonymous metadata requests independently of release downloads.
    return { state: 'unavailable', downloads: { windows: windowsDownload } };
}
