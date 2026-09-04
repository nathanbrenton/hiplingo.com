import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appSource = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const configSource = await readFile(new URL("../src/siteConfig.ts", import.meta.url), "utf8");

test("public licensing routes distinguish retroactive and prospective Jam workflows", () => {
  assert.match(appSource, /\/licensing\/jam\/existing/);
  assert.match(appSource, /\/licensing\/jam\/future/);
  assert.match(appSource, /Retroactive catalog ratification/);
  assert.match(appSource, /Prospective participant joinder/);
  assert.match(appSource, /Master\s+Net Receipts participation/);
});

test("public Jam pages stay informational and point to the licensing contact", () => {
  assert.match(appSource, /this public page does not expose private rights/i);
  assert.match(appSource, /Signing is not available from this public page/);
  assert.match(appSource, /HIPLINGO_LICENSING_MAILTO/);
  assert.match(configSource, /licensing@hiplingo\.com/);
});

test("public site does not couple itself to private licensing admin endpoints", () => {
  assert.doesNotMatch(appSource, /127\.0\.0\.1:4175/);
  assert.doesNotMatch(appSource, /\/api\/participants/);
  assert.doesNotMatch(appSource, /\/api\/audit/);
  assert.doesNotMatch(appSource, /payment_contact/);
});
