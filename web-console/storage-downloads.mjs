// @editedBy SherrySherry 2026-11-19
const repository = 'SherrySherry-1230/HaemaAI_SherrySherry';
const tag = 'console-installers';
const releaseApi = 'https://api.github.com/repos/' + repository + '/releases/tags/' + tag;
const downloadBase = 'https://github.com/' + repository + '/releases/download/' + tag + '/';
const platforms = ['windows', 'macos'];
const windowsTester = Object.freeze({
    url: 'https://drive.google.com/uc?export=download&id=1qLzS2410dYJuPD3Bw28BvNXtE3Xnp_9W',
    restricted: true,
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

    for (const platform of platforms) {
        const fileName = 'haema-ai-' + platform + '.zip';
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
    let release = { state: 'unavailable', downloads: {} };
    try {
        const response = await fetcher(releaseApi, {
            credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
            headers: { Accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(8000),
        });
        if (response.status === 404) release.state = 'unpublished';
        else if (response.ok) release = parseInstallerRelease(await response.json());
    } catch { /* The console remains available while downloads cannot be checked. */ }
    release.downloads.windows ??= windowsTester;
    return release;
}
