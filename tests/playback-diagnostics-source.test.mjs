import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const [appSource, playerSource, diagnosticsSource, css] = await Promise.all([
  readFile(path.join(projectRoot, "src/App.tsx"), "utf8"),
  readFile(path.join(projectRoot, "src/components/AudioPlayer.tsx"), "utf8"),
  readFile(
    path.join(projectRoot, "src/components/PlaybackDiagnostics.tsx"),
    "utf8",
  ),
  readFile(path.join(projectRoot, "src/index.css"), "utf8"),
]);

test("playback diagnostics can be opened by URL or six-second hamburger hold", () => {
  assert.match(
    appSource,
    /currentLocation\.searchParams\.get\("diagnostics"\) === "playback"/,
  );
  assert.match(appSource, /const PLAYBACK_DIAGNOSTICS_HOLD_MS = 6000;/);
  assert.match(
    appSource,
    /window\.setTimeout\(\(\) => \{[\s\S]*?onOpenPlaybackDiagnostics\(\);[\s\S]*?\}, PLAYBACK_DIAGNOSTICS_HOLD_MS\);/,
  );
  assert.match(appSource, /suppressMenuClickRef\.current = true;/);
  assert.match(appSource, /playbackDiagnosticsRequested=\{playbackDiagnosticsRequested\}/);

  assert.match(playerSource, /openPlaybackDiagnostics: \(\) => void;/);
  assert.match(playerSource, /setIsPlaybackDiagnosticsOpen\(true\)/);
  assert.match(
    playerSource,
    /if \(playbackDiagnosticsRequested\) \{[\s\S]*?setIsPlaybackDiagnosticsOpen\(true\);/,
  );
});

test("diagnostics collect bounded media events without automatic submission", () => {
  assert.match(diagnosticsSource, /const MAX_EVENTS = 250;/);
  assert.match(diagnosticsSource, /const DISPLAY_REFRESH_MS = 250;/);
  assert.match(diagnosticsSource, /const STALL_CHECK_MS = 500;/);
  assert.match(diagnosticsSource, /const MAIN_THREAD_STALL_MS = 250;/);
  assert.match(diagnosticsSource, /"waiting"/);
  assert.match(diagnosticsSource, /"stalled"/);
  assert.match(diagnosticsSource, /"progress"/);
  assert.match(diagnosticsSource, /"USER_MARKED_SKIP"/);
  assert.match(diagnosticsSource, /"MAIN_THREAD_STALL"/);
  assert.match(diagnosticsSource, /navigator\.clipboard\?\.writeText/);
  assert.doesNotMatch(diagnosticsSource, /fetch\(/);
  assert.doesNotMatch(diagnosticsSource, /XMLHttpRequest/);
  assert.doesNotMatch(diagnosticsSource, /sendBeacon/);
});

test("diagnostics expose buffer state and visual-load A/B testing", () => {
  assert.match(diagnosticsSource, /getBufferAhead/);
  assert.match(diagnosticsSource, /formatTimeRanges\(audio\.buffered\)/);
  assert.match(diagnosticsSource, /formatTimeRanges\(audio\.seekable\)/);
  assert.match(diagnosticsSource, /Disable animated background/);
  assert.match(
    playerSource,
    /displayMode === "full" && !diagnosticsReduceVisualLoad/,
  );
  assert.match(css, /\.playback-diagnostics \{/);
  assert.match(css, /z-index: 5000;/);
});
