import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function source(relativePath) {
  return readFile(
    path.join(root, relativePath),
    "utf8",
  );
}

test("public Artist detail reads authored bio from artist.json", async () => {
  const model = await source("src/lib/publicArtists.ts");
  const detail = await source("src/components/ArtistDetail.tsx");

  assert.match(model, /bio:\s*stringValue\(raw\.bio\)/);
  assert.match(detail, /artist\.bio/);
  assert.match(detail, /hiplingo-kicker">About/);
  assert.doesNotMatch(detail, /Artist bio/);
});

test("public Release detail reads authored release.description", async () => {
  const catalog = await source("src/lib/mediaCatalog.ts");
  const detail = await source("src/components/ReleaseDetail.tsx");

  assert.match(catalog, /getReleaseDescription/);
  assert.match(catalog, /resolved\.release\?\.description/);
  assert.match(detail, /getReleaseDescription\(release\)/);
  assert.match(detail, /Release notes/);
});

test("Journal is removed and Licensing is the public rights entry point", async () => {
  const app = await source("src/App.tsx");
  const readme = await source("README.md");

  assert.doesNotMatch(app, /["']\/journal["']/);
  assert.doesNotMatch(readme, /\/journal/);
  assert.doesNotMatch(app, />\s*Journal\s*</);

  assert.match(app, /route="\/licensing"/);
  assert.match(app, /function JamParticipantPage\(\)/);
  assert.match(app, /<h1>Jam agreements<\/h1>/);
  assert.match(app, /route="\/licensing\/jam\/existing"/);
  assert.match(app, /route="\/licensing\/jam\/future"/);
  assert.match(app, /title="Retroactive catalog ratification"/);
  assert.match(app, /title="Prospective participant joinder"/);
  assert.match(app, /HIPLINGO_LICENSING_MAILTO/);

  assert.doesNotMatch(app, /title="Jam participant agreement"/);
  assert.doesNotMatch(app, /Coming soon\. The participant flow/);
});

test("compact site player uses the shared Now Playing visual layout", async () => {
  const css = await source("src/index.css");
  const hostCss = await source("src/components/compact-now-playing-host.css");
  const sharedCss = await source(
    "../packages/media-player/src/compact-now-playing-bar.css",
  );

  assert.match(css, /Hiplingo compact shared Now Playing host/);
  assert.doesNotMatch(css, /Hiplingo compact player canonical layout/);
  assert.doesNotMatch(css, /hiplingo-compact-player__/);
  assert.match(
    css,
    /width:\s*min\(92rem, 100%\)/,
  );
  assert.match(
    css,
    /> :not\(\.hiplingo-now-playing-dock\):not\(\.audio-player__settings-backdrop\)/,
  );
  assert.match(hostCss, /\.hiplingo-now-playing-dock\s*\{/);
  assert.match(
    hostCss,
    /audio-player\[data-display-mode="compact"\][\s\S]*?> \.hiplingo-now-playing-dock[\s\S]*?width:\s*100%/,
  );
  assert.match(sharedCss, /"artwork identity time waveform transport volume"/);
  assert.match(sharedCss, /\.shared-now-playing__waveform-region/);
  assert.match(sharedCss, /\.shared-volume-control__button/);
});
