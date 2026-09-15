export type HiplingoTheme = "purple" | "gray" | "blue";

const THEME_STORAGE_KEY = "hiplingo-theme";
const LEGACY_SIGNER_THEME_STORAGE_KEY = "hiplingo-signer-theme";

function parseTheme(value: string | null | undefined): HiplingoTheme | null {
  const normalized = value?.trim().toLowerCase();

  if (normalized === "purple" || normalized === "blue") {
    return normalized;
  }

  if (normalized === "gray" || normalized === "grey") {
    return "gray";
  }

  return null;
}

export function getInitialHiplingoTheme(): HiplingoTheme {
  const queryTheme = parseTheme(new URLSearchParams(window.location.search).get("theme"));

  if (queryTheme) {
    return queryTheme;
  }

  const storedTheme = parseTheme(window.localStorage.getItem(THEME_STORAGE_KEY));

  if (storedTheme) {
    return storedTheme;
  }

  const legacySignerTheme = parseTheme(
    window.localStorage.getItem(LEGACY_SIGNER_THEME_STORAGE_KEY),
  );

  return legacySignerTheme || "purple";
}

export function rememberHiplingoTheme(theme: HiplingoTheme) {
  window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  // Keep the local Rights signer in sync during the transition to the public route.
  window.localStorage.setItem(LEGACY_SIGNER_THEME_STORAGE_KEY, theme);
}
