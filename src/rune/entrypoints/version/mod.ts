import { RUNE_COMMIT, RUNE_VERSION } from "@core/dto/version.gen.ts";

const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const REPO = "mrg-keystone/rune";

// `rune -v` (aliases: --version, -V, version) — report this build's version and
// check whether a newer rune has been released.
//
// rune ships as a ROLLING `latest` GitHub release (the binary carries no semver
// tag of its own), so "am I stale?" can't be answered by comparing semvers — a
// keep-only auto-bump would false-nag. The honest signal is the COMMIT: the
// binary bakes the commit it was built from (RUNE_COMMIT, see gen-version.ts),
// and the release moves the `latest` tag to that same commit. So if the commit
// `latest` points at differs from the baked one, a newer rune is out.

const LATEST_REF = `https://api.github.com/repos/${REPO}/git/refs/tags/latest`;

// Pure: given the baked commit and whatever the `latest` tag resolves to,
// decide if a newer build is available. Unknown/missing data => no nag (never
// cry wolf): a dev build (RUNE_COMMIT "unknown") or an unreachable API both
// fall through to false.
export function isNewer(
  baked: string | undefined,
  latest: string | undefined,
): boolean {
  if (!baked || baked === "unknown") return false;
  if (!latest) return false;
  return baked !== latest;
}

// Fetch the commit sha the `latest` release tag points at. Returns undefined on
// any failure (offline, rate-limited, shape change) — `rune -v` stays useful
// offline and simply skips the update check.
export async function fetchLatestCommit(): Promise<string | undefined> {
  try {
    const res = await fetch(LATEST_REF, {
      headers: { "Accept": "application/vnd.github+json" },
    });
    if (!res.ok) return undefined;
    const body = await res.json();
    const sha = body?.object?.sha;
    return typeof sha === "string" ? sha : undefined;
  } catch {
    return undefined;
  }
}

export async function runVersion(_args: string[]): Promise<number> {
  const short = RUNE_COMMIT === "unknown" ? "dev" : RUNE_COMMIT.slice(0, 7);
  console.log(`rune ${RUNE_VERSION} ${DIM}(${short})${RESET}`);

  const latest = await fetchLatestCommit();
  if (isNewer(RUNE_COMMIT, latest)) {
    console.log(
      `${YELLOW}${BOLD}there is a new version of rune${RESET}${YELLOW} — run \`rune update\`${RESET}`,
    );
  }
  return 0;
}
