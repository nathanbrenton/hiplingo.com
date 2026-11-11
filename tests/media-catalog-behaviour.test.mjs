import assert from "node:assert/strict";
import test from "node:test";

/*
 * Behaviour test: runs the real catalog loader against an in-memory
 * published-media tree served through a stubbed fetch.
 */
const {
  fetchMediaCatalog,
  getReleaseProvenance,
  getTrackProvenance,
} = await import("../src/lib/mediaCatalog.ts");

const releaseId = "2026-01-01_example";
const releaseDocument = {
  schema: { name: "audio-player-release", version: 2 },
  id: releaseId,
  metadata: {
    id: releaseId,
    title: "Example",
    primary_artist: { id: "artist_x", name: "X" },
    dates: { release: "2026-01-01" },
    provenance: { origin: "human" },
  },
  artwork: { front: { href: "artwork/front/artwork.png" } },
  tracks: [
    { id: "x_01_one", href: "tracks/x_01_one/track.json" },
    { id: "x_02_two", href: "tracks/x_02_two/track.json" },
  ],
};
const trackDocument = (id, number, provenance) => ({
  schema: { name: "audio-player-track", version: 2 },
  id,
  releaseId,
  metadata: {
    id,
    title: `Track ${number}`,
    numbering: { track_number: number },
    ...(provenance ? { provenance } : {}),
  },
  credits: { primary_artist: { name: "X" } },
  stream: { href: "stream/index.m3u8", protocol: "hls", codec: "aac" },
  waveform: { href: "waveform-peaks.wfp" },
});
const tracks = {
  x_01_one: trackDocument("x_01_one", 1),
  x_02_two: trackDocument("x_02_two", 2, { origin: "ai-generated" }),
};
const catalogEntry = {
  id: releaseId,
  href: `releases/${releaseId}/release.json`,
  title: "Example",
  primaryArtist: "X",
};

async function loadWith(files) {
  const requested = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const path = String(url);
    requested.push(path);

    return path in files
      ? Response.json(files[path])
      : new Response("missing", { status: 404 });
  };

  try {
    return { catalog: await fetchMediaCatalog(), requested };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function assertCatalogShape(catalog) {
  assert.equal(catalog.releaseCount, 1);
  assert.equal(catalog.trackCount, 2);
  assert.equal(catalog.playableTrackCount, 2);

  const [release] = catalog.releases;
  assert.equal(release.title, "Example");
  assert.deepEqual(
    release.tracks.map((track) => [track.trackNumber, track.title]),
    [[1, "Track 1"], [2, "Track 2"]],
  );
  assert.equal(
    release.tracks[0].assets.stream.path,
    `releases/${releaseId}/tracks/x_01_one/stream/index.m3u8`,
  );
  assert.equal(
    getTrackProvenance(release, release.tracks[0]).tier,
    "human",
  );
  assert.equal(
    getTrackProvenance(release, release.tracks[1]).tier,
    "ai",
  );
  assert.equal(getReleaseProvenance(release).tier, "some-ai");
}

test("a catalog with embedded documents loads in one request", async () => {
  const { catalog, requested } = await loadWith({
    "/media/catalog.json": {
      schema: { name: "audio-player-catalog", version: 1 },
      generatedAt: "2026-01-01T00:00:00.000Z",
      releases: [
        {
          ...catalogEntry,
          documents: { release: releaseDocument, tracks },
        },
      ],
    },
  });

  assert.deepEqual(requested, ["/media/catalog.json"]);
  assertCatalogShape(catalog);
});

test("a catalog without embedded documents falls back to per-release files", async () => {
  const { catalog, requested } = await loadWith({
    "/media/catalog.json": {
      schema: { name: "audio-player-catalog", version: 1 },
      generatedAt: "2026-01-01T00:00:00.000Z",
      releases: [catalogEntry],
    },
    [`/media/releases/${releaseId}/release.json`]: releaseDocument,
    [`/media/releases/${releaseId}/tracks/x_01_one/track.json`]:
      tracks.x_01_one,
    [`/media/releases/${releaseId}/tracks/x_02_two/track.json`]:
      tracks.x_02_two,
  });

  assert.equal(requested.length, 4);
  assertCatalogShape(catalog);
});

test("a partially embedded entry fetches only the missing track", async () => {
  const { catalog, requested } = await loadWith({
    "/media/catalog.json": {
      schema: { name: "audio-player-catalog", version: 1 },
      generatedAt: "2026-01-01T00:00:00.000Z",
      releases: [
        {
          ...catalogEntry,
          documents: {
            release: releaseDocument,
            tracks: { x_01_one: tracks.x_01_one },
          },
        },
      ],
    },
    [`/media/releases/${releaseId}/tracks/x_02_two/track.json`]:
      tracks.x_02_two,
  });

  assert.deepEqual(requested, [
    "/media/catalog.json",
    `/media/releases/${releaseId}/tracks/x_02_two/track.json`,
  ]);
  assertCatalogShape(catalog);
});
