export interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  releaseName: string;
  changelog: string;
  publishedAt: string;
  releaseUrl: string;
  asset?: ReleaseAsset;
  allAssets: ReleaseAsset[];
}

const GITHUB_REPO = "thecapibara/RDX";
const DISMISSED_KEY = "rdx_dismissed_update";
const POSTPONED_KEY = "rdx_postponed_until";

/**
 * Compare two semver-like version strings: "1.0.5" vs "1.0.6"
 * Returns > 0 if v1 > v2, < 0 if v1 < v2, 0 if equal.
 */
export function compareVersions(v1: string, v2: string): number {
  const clean1 = v1.replace(/^v/i, "").trim().split(".").map(Number);
  const clean2 = v2.replace(/^v/i, "").trim().split(".").map(Number);
  const len = Math.max(clean1.length, clean2.length);

  for (let i = 0; i < len; i++) {
    const num1 = clean1[i] || 0;
    const num2 = clean2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
}

function detectPlatformAsset(assets: any[]): ReleaseAsset | undefined {
  if (!assets || !Array.isArray(assets) || assets.length === 0) return undefined;
  
  const ua = (navigator.userAgent || "").toLowerCase();
  const isLinux = ua.includes("linux");
  const isWin = ua.includes("win");
  const isMac = ua.includes("mac");

  let match: any;
  if (isLinux) {
    match = assets.find((a) => a.name.endsWith(".AppImage")) ||
            assets.find((a) => a.name.endsWith(".deb")) ||
            assets.find((a) => a.name.endsWith(".tar.gz"));
  } else if (isWin) {
    match = assets.find((a) => a.name.endsWith(".exe") || a.name.endsWith(".msi"));
  } else if (isMac) {
    match = assets.find((a) => a.name.endsWith(".dmg") || a.name.endsWith(".app.tar.gz"));
  }

  if (!match && assets.length > 0) {
    match = assets[0];
  }

  if (match) {
    return {
      name: match.name,
      size: match.size,
      browser_download_url: match.browser_download_url,
    };
  }
  return undefined;
}

export async function checkForUpdates(
  currentVersion: string = "1.0.6",
  force: boolean = false
): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      {
        headers: {
          Accept: "application/vnd.github.v3+json",
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`GitHub API returned status ${response.status}`);
    }

    const data = await response.json();
    const latestTag = (data.tag_name || "").replace(/^v/i, "").trim();

    if (!latestTag) return null;

    // Check if latest version is strictly greater than current
    if (compareVersions(latestTag, currentVersion) <= 0) {
      return null;
    }

    // Check if dismissed or postponed (unless force requested from settings)
    if (!force) {
      const dismissed = localStorage.getItem(DISMISSED_KEY);
      if (dismissed === latestTag) {
        return null;
      }

      const postponedUntil = localStorage.getItem(POSTPONED_KEY);
      if (postponedUntil && Date.now() < Number(postponedUntil)) {
        return null;
      }
    }

    const rawAssets: any[] = Array.isArray(data.assets) ? data.assets : [];
    const allAssets: ReleaseAsset[] = rawAssets.map((a) => ({
      name: a.name,
      size: a.size,
      browser_download_url: a.browser_download_url,
    }));
    const platformAsset = detectPlatformAsset(rawAssets);

    return {
      version: latestTag,
      currentVersion,
      releaseName: data.name || `RDX v${latestTag}`,
      changelog: data.body || "Оновлення містить покращення стабільності та виправлення помилок.",
      publishedAt: data.published_at ? new Date(data.published_at).toLocaleDateString("uk-UA") : "",
      releaseUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases/latest`,
      asset: platformAsset,
      allAssets,
    };
  } catch (err) {
    console.warn("OTA update check failed:", err);
    return null;
  }
}

export function postponeUpdate(hours: number = 24): void {
  const expiry = Date.now() + hours * 60 * 60 * 1000;
  localStorage.setItem(POSTPONED_KEY, String(expiry));
}

export function dismissUpdate(version: string): void {
  localStorage.setItem(DISMISSED_KEY, version);
}
