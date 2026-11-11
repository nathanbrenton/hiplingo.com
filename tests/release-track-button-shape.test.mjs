import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { readSiteStyles } from "./support/site-styles.mjs";

const css = await readSiteStyles();

test("release track transport stays circular despite global button touch sizing", () => {
  assert.match(
    css,
    /\.hiplingo-release-track__action\s*\{[\s\S]*?width:\s*30px;[\s\S]*?height:\s*30px;[\s\S]*?min-width:\s*30px;[\s\S]*?min-height:\s*30px;[\s\S]*?aspect-ratio:\s*1;/,
  );
});
