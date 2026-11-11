import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/*
 * src/index.css is an ordered list of @imports (see src/styles/). Tests
 * that assert on the site's CSS read the parts inlined in cascade order,
 * which is what the browser receives.
 */
const sourceRoot = fileURLToPath(new URL("../../src/", import.meta.url));

export async function readSiteStyles() {
  const entry = await readFile(
    path.join(sourceRoot, "index.css"),
    "utf8",
  );
  const parts = [...entry.matchAll(/^@import "(.+)";$/gm)].map(
    (match) => match[1],
  );

  if (parts.length === 0) {
    return entry;
  }

  return (
    await Promise.all(
      parts.map((part) =>
        readFile(path.join(sourceRoot, part), "utf8"),
      ),
    )
  ).join("");
}
