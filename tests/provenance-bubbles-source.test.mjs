import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

const [catalog, main, releaseCatalog, releaseDetail, artistDetail, player] =
  await Promise.all([
    read("../src/lib/mediaCatalog.ts"),
    read("../src/main.tsx"),
    read("../src/components/ReleaseCatalog.tsx"),
    read("../src/components/ReleaseDetail.tsx"),
    read("../src/components/ArtistDetail.tsx"),
    read("../src/components/AudioPlayer.tsx"),
  ]);

test("provenance is resolved by the shared package, not reimplemented by the site", () => {
  assert.match(catalog, /resolveTrackProvenance,?\s[\s\S]*from "@hiplingo\/media-player\/provenance"/);
  assert.match(catalog, /export function getTrackProvenance\(/);
  assert.match(catalog, /export function getReleaseProvenance\(/);
  assert.doesNotMatch(catalog, /"ai-generated|"ai-assisted/);
  assert.match(main, /@hiplingo\/media-player\/provenance-badge\.css/);
});

test("release cards, release pages, track rows, and the now-playing dock show the bubble", () => {
  assert.match(releaseCatalog, /<ProvenanceBadge[\s\S]*getReleaseProvenance\(release\)/);
  assert.match(artistDetail, /<ProvenanceBadge[\s\S]*getReleaseProvenance\(release\)/);
  assert.match(releaseDetail, /provenance=\{releaseProvenance\}/);
  assert.match(releaseDetail, /getTrackProvenance\(release, track\)/);
  assert.match(player, /hiplingo-now-playing-dock__provenance/);
});
