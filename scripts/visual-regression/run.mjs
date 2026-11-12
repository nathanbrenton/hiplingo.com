/*
 * Visual-regression suite for the Hiplingo public site.
 *
 *   node scripts/visual-regression/run.mjs baseline   record the reference
 *   node scripts/visual-regression/run.mjs compare    capture again and diff
 *
 * Options: --only=<scenario>[,<scenario>]  --viewport=<name>[,<name>]
 *
 * For every scenario and viewport it records
 *   - the computed styles and box of every element (the precise signal), and
 *   - a screenshot (for a person to look at).
 *
 * Each state is captured twice from scratch. Anything that differs between
 * those two runs is marked volatile and ignored, so remaining differences
 * against the baseline are real. It also reports which `!important`
 * declarations actually applied to an element in some captured state: only
 * those are vouched for by a clean comparison.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import { chromium } from "playwright-core";

import {
  scenarios,
  scriptDrivenClasses,
  viewports,
} from "./scenarios.mjs";

const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
const outputRoot = path.join(projectRoot, ".visual-regression");
const [command, ...flags] = process.argv.slice(2);
const flag = (name) =>
  flags
    .find((entry) => entry.startsWith(`--${name}=`))
    ?.slice(name.length + 3)
    .split(",") ?? null;
const onlyScenarios = flag("only");
const onlyViewports = flag("viewport");
/* Re-run the comparison on the last capture instead of capturing again. */
const reuseCapture = flags.includes("--reuse");

/* The preview server picks a free port, so asset URLs differ per run. */
const withoutOrigin = (value) =>
  typeof value === "string"
    ? value.replace(/https?:\/\/127\.0\.0\.1:\d+/g, "")
    : value;
const isScriptDriven = (label) =>
  label
    .split(/[.:#]/)
    .some((className) =>
      scriptDrivenClasses.some((pattern) =>
        pattern.endsWith("*")
          ? className.startsWith(pattern.slice(0, -1))
          : className === pattern,
      ),
    );

/* Styles that are recorded even when no !important rule mentions them. */
const baseProperties = [
  "display",
  "position",
  "visibility",
  "opacity",
  "z-index",
  "transform",
  "color",
  "background-color",
  "font-size",
  "pointer-events",
];

function findChromium() {
  if (process.env.VISUAL_CHROMIUM_PATH) {
    return process.env.VISUAL_CHROMIUM_PATH;
  }

  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) {
      return bundled;
    }
  } catch {
    // Fall through to the shared Playwright cache.
  }

  const cache = path.join(
    os.homedir(),
    process.platform === "darwin"
      ? "Library/Caches/ms-playwright"
      : ".cache/ms-playwright",
  );
  const candidates = existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium(_headless_shell)?-\d+$/.test(name))
        .sort()
        .reverse()
    : [];

  for (const name of candidates) {
    const root = path.join(cache, name);
    for (const folder of readdirSync(root)) {
      for (const binary of [
        "chrome-headless-shell",
        "Chromium.app/Contents/MacOS/Chromium",
        "chrome",
      ]) {
        const candidate = path.join(root, folder, binary);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }

  throw new Error(
    "No Chromium found. Run `npx playwright-core install chromium` or set VISUAL_CHROMIUM_PATH.",
  );
}

function run(commandName, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${commandName} ${args.join(" ")}\n${output}`)),
    );
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/* Serves the production build, the same code visitors receive. */
async function startSite() {
  await run("npx", ["vite", "build"]);
  const port = await freePort();
  const child = spawn(
    "npx",
    [
      "vite",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
    ],
    { cwd: projectRoot, stdio: "ignore" },
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;

  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${baseUrl}/media/catalog.json`)).ok) {
        return { baseUrl, stop: () => child.kill() };
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  child.kill();
  throw new Error("The preview server did not start.");
}

/* Runs in the page before any site code: makes randomness repeatable. */
function seedRandomness() {
  let state = 0x9e3779b9;
  Math.random = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/* Runs in the page: brings every animation and transition to a fixed frame. */
async function settlePage(waitForFrames) {
  /* With a frozen page clock, animation frames never arrive. */
  const frames = () =>
    waitForFrames
      ? new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        )
      : Promise.resolve();

  await document.fonts.ready;
  await frames();

  for (const animation of document.getAnimations()) {
    try {
      const timing = animation.effect?.getComputedTiming();
      if (timing && Number.isFinite(timing.endTime)) {
        animation.finish();
      } else {
        animation.currentTime = 0;
        animation.pause();
      }
    } catch {
      // An animation that cannot be controlled stays as it is.
    }
  }

  await frames();
}

/* Runs in the page: records styles, boxes, and !important usage. */
function snapshotPage(baseProps) {
  const important = [];
  const importantProps = new Set();

  const visit = (rules, conditions, active) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (const property of rule.style) {
          if (rule.style.getPropertyPriority(property) !== "important") {
            continue;
          }

          importantProps.add(property);
          let matched = 0;
          if (active) {
            const selector = rule.selectorText.replace(
              /::?(before|after|placeholder|selection|marker|-webkit-[\w-]+|-moz-[\w-]+)/g,
              "",
            );
            try {
              matched = document.querySelectorAll(selector).length;
            } catch {
              matched = 0;
            }
          }

          important.push({
            id: `${conditions.join(" && ") || "all"} | ${rule.selectorText} | ${property}`,
            value: rule.style.getPropertyValue(property),
            active,
            matched,
          });
        }
      } else if (rule.cssRules) {
        let condition = null;
        let nextActive = active;

        if (rule instanceof CSSMediaRule) {
          condition = `@media ${rule.conditionText}`;
          nextActive = active && matchMedia(rule.conditionText).matches;
        } else if (rule instanceof CSSSupportsRule) {
          condition = `@supports ${rule.conditionText}`;
          nextActive = active && CSS.supports(rule.conditionText);
        }

        visit(
          rule.cssRules,
          condition ? [...conditions, condition] : conditions,
          nextActive,
        );
      }
    }
  };

  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules, [], true);
    } catch {
      // Cross-origin stylesheets cannot be read.
    }
  }

  const properties = [...new Set([...baseProps, ...importantProps])].sort();
  const elements = {};
  const pathOf = (element) => {
    const segments = [];
    for (
      let node = element;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const index =
        Array.prototype.indexOf.call(node.parentElement.children, node) + 1;
      segments.unshift(`${node.localName}:${index}`);
    }
    return segments.join(">");
  };
  const read = (element, pseudo) => {
    const style = getComputedStyle(element, pseudo);
    return properties.map((property) => style.getPropertyValue(property));
  };

  for (const element of document.body.querySelectorAll("*")) {
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(element.tagName)) {
      continue;
    }

    const key = pathOf(element);
    const rect = element.getBoundingClientRect();
    elements[key] = {
      label:
        element.localName +
        (element.id ? `#${element.id}` : "") +
        [...element.classList].map((name) => `.${name}`).join(""),
      box: [rect.x, rect.y, rect.width, rect.height].map(
        (value) => Math.round(value * 2) / 2,
      ),
      styles: read(element),
    };

    for (const pseudo of ["::before", "::after"]) {
      const content = getComputedStyle(element, pseudo).content;
      if (content && content !== "none" && content !== "normal") {
        elements[`${key}${pseudo}`] = {
          label: `${elements[key].label}${pseudo}`,
          box: null,
          styles: read(element, pseudo),
        };
      }
    }
  }

  return {
    properties,
    elements,
    important,
    scroll: [scrollX, scrollY],
    title: document.title,
    location: location.pathname,
  };
}

async function captureOnce(browser, baseUrl, viewport, scenario) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    hasTouch: viewport.touch,
    reducedMotion: "no-preference",
    colorScheme: "dark",
  });
  await context.addInitScript(seedRandomness);
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  try {
    await page.goto(`${baseUrl}${scenario.route}`, {
      waitUntil: "networkidle",
    });
    await scenario.run?.(page);
    if (!scenario.frozenClock) {
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(350);
    }
    await page.evaluate(settlePage, !scenario.frozenClock);

    const snapshot = await page.evaluate(snapshotPage, baseProperties);
    const screenshot = await page.screenshot({
      animations: "disabled",
      caret: "hide",
    });
    await scenario.release?.(page);

    return { snapshot, screenshot, consoleErrors };
  } finally {
    await context.close();
  }
}

/* Entries that differ between two captures of the same state. */
function volatileKeys(first, second) {
  const volatile = new Set();
  const keys = new Set([
    ...Object.keys(first.elements),
    ...Object.keys(second.elements),
  ]);

  for (const key of keys) {
    const a = first.elements[key];
    const b = second.elements[key];

    if (!a || !b) {
      volatile.add(`${key}|*`);
      continue;
    }

    if (JSON.stringify(a.box) !== JSON.stringify(b.box)) {
      volatile.add(`${key}|box`);
    }

    a.styles.forEach((value, index) => {
      if (value !== b.styles[index]) {
        volatile.add(`${key}|${first.properties[index]}`);
      }
    });
  }

  return [...volatile].sort();
}

async function captureAll(targetDirectory, onlyStateIds = null) {
  rmSync(targetDirectory, { recursive: true, force: true });
  mkdirSync(targetDirectory, { recursive: true });

  const site = await startSite();
  const browser = await chromium.launch({
    executablePath: findChromium(),
  });
  const manifest = {
    capturedAt: new Date().toISOString(),
    browser: browser.version(),
    catalogGeneratedAt: (
      await (await fetch(`${site.baseUrl}/media/catalog.json`)).json()
    ).generatedAt,
    states: [],
    failed: [],
  };
  const importantUsage = new Map();

  try {
    for (const viewport of viewports) {
      if (onlyViewports && !onlyViewports.includes(viewport.name)) {
        continue;
      }

      for (const scenario of scenarios) {
        if (onlyScenarios && !onlyScenarios.includes(scenario.name)) {
          continue;
        }

        if (
          (scenario.pointerOnly && viewport.touch) ||
          scenario.exceptViewports?.includes(viewport.name)
        ) {
          continue;
        }

        const id = `${viewport.name}__${scenario.name}`;

        if (onlyStateIds && !onlyStateIds.includes(id)) {
          continue;
        }

        process.stdout.write(`  ${id} … `);

        let first;
        let second;

        try {
          first = await captureOnce(
            browser,
            site.baseUrl,
            viewport,
            scenario,
          );
          second = await captureOnce(
            browser,
            site.baseUrl,
            viewport,
            scenario,
          );
        } catch (error) {
          /* A state that cannot be reached is a failure, never a skip. */
          const reason = String(error?.message ?? error).split("\n")[0];
          manifest.failed.push({ id, reason });
          console.log(`FAILED: ${reason}`);
          continue;
        }
        const volatile = volatileKeys(first.snapshot, second.snapshot);
        const elementCount = Object.keys(first.snapshot.elements).length;

        for (const entry of first.snapshot.important) {
          const usage = importantUsage.get(entry.id) ?? {
            value: entry.value,
            states: 0,
            elements: 0,
          };
          if (entry.active && entry.matched > 0) {
            usage.states += 1;
            usage.elements = Math.max(usage.elements, entry.matched);
          }
          importantUsage.set(entry.id, usage);
        }

        writeFileSync(
          path.join(targetDirectory, `${id}.json.gz`),
          gzipSync(
            JSON.stringify({
              properties: first.snapshot.properties,
              elements: first.snapshot.elements,
              volatile,
            }),
          ),
        );
        writeFileSync(
          path.join(targetDirectory, `${id}.png`),
          first.screenshot,
        );
        manifest.states.push({
          id,
          location: first.snapshot.location,
          elements: elementCount,
          volatile: volatile.length,
          pageErrors: first.consoleErrors,
        });
        console.log(
          `${elementCount} elements, ${volatile.length} volatile values` +
            (first.consoleErrors.length
              ? `, ${first.consoleErrors.length} page errors`
              : ""),
        );
      }
    }
  } finally {
    await browser.close();
    site.stop();
  }

  manifest.important = [...importantUsage]
    .map(([id, usage]) => ({ id, ...usage }))
    .sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(
    path.join(targetDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  if (manifest.failed.length > 0) {
    throw new Error(
      `${manifest.failed.length} state(s) could not be captured: ` +
        manifest.failed.map((entry) => entry.id).join(", "),
    );
  }

  return manifest;
}

function loadState(directory, id) {
  return JSON.parse(
    gunzipSync(readFileSync(path.join(directory, `${id}.json.gz`))),
  );
}

function compareState(baseline, current) {
  const ignored = new Set([...baseline.volatile, ...current.volatile]);
  const differences = [];
  const keys = new Set([
    ...Object.keys(baseline.elements),
    ...Object.keys(current.elements),
  ]);

  for (const key of keys) {
    if (ignored.has(`${key}|*`)) {
      continue;
    }

    const before = baseline.elements[key];
    const after = current.elements[key];

    if (isScriptDriven((before ?? after).label)) {
      continue;
    }

    if (!before || !after) {
      differences.push({
        element: (before ?? after).label,
        path: key,
        property: before ? "(element removed)" : "(element added)",
        before: before ? "present" : "absent",
        after: after ? "present" : "absent",
      });
      continue;
    }

    if (
      !ignored.has(`${key}|box`) &&
      JSON.stringify(before.box) !== JSON.stringify(after.box)
    ) {
      differences.push({
        element: before.label,
        path: key,
        property: "box (x, y, width, height)",
        before: JSON.stringify(before.box),
        after: JSON.stringify(after.box),
      });
    }

    const boxUnchanged =
      JSON.stringify(before.box) === JSON.stringify(after.box);

    baseline.properties.forEach((property, index) => {
      const currentIndex = current.properties.indexOf(property);
      const afterValue =
        currentIndex === -1 ? "(not recorded)" : after.styles[currentIndex];

      /*
       * Chromium reports the computed value of an `auto` margin
       * inconsistently between loads of an identical layout. A margin that
       * really changed moves this element or its neighbours, which the box
       * comparison catches, so a margin-only difference on an unmoved
       * element is not reported.
       */
      if (property.startsWith("margin-") && boxUnchanged) {
        return;
      }

      if (
        currentIndex !== -1 &&
        !ignored.has(`${key}|${property}`) &&
        withoutOrigin(before.styles[index]) !== withoutOrigin(afterValue)
      ) {
        differences.push({
          element: before.label,
          path: key,
          property,
          before: before.styles[index],
          after: afterValue,
        });
      }
    });
  }

  return differences;
}

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"]/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
  );

function writeReport(directory, results, usage) {
  const changed = results.filter((result) => result.differences.length > 0);
  const rows = changed
    .map(
      (result) => `
<section>
  <h2>${escapeHtml(result.id)} — ${result.differences.length} differences</h2>
  <div class="shots">
    <figure><img src="../baseline/${result.id}.png"><figcaption>baseline</figcaption></figure>
    <figure><img src="../current/${result.id}.png"><figcaption>current</figcaption></figure>
  </div>
  <table>
    <tr><th>element</th><th>property</th><th>baseline</th><th>current</th></tr>
    ${result.differences
      .slice(0, 200)
      .map(
        (difference) =>
          `<tr><td title="${escapeHtml(difference.path)}">${escapeHtml(difference.element)}</td><td>${escapeHtml(difference.property)}</td><td>${escapeHtml(difference.before)}</td><td>${escapeHtml(difference.after)}</td></tr>`,
      )
      .join("\n")}
  </table>
  ${result.differences.length > 200 ? `<p>… ${result.differences.length - 200} more</p>` : ""}
</section>`,
    )
    .join("\n");

  writeFileSync(
    path.join(directory, "index.html"),
    `<!doctype html><meta charset="utf-8"><title>Visual regression report</title>
<style>
  body{font:14px system-ui;margin:24px;background:#14121a;color:#eee}
  h1{font-size:20px} h2{font-size:15px;margin-top:32px}
  .shots{display:flex;gap:12px;flex-wrap:wrap} img{max-width:440px;border:1px solid #444}
  table{border-collapse:collapse;margin-top:10px;font:12px ui-monospace,monospace}
  td,th{border:1px solid #3a3644;padding:3px 8px;text-align:left;vertical-align:top;max-width:420px;overflow-wrap:anywhere}
  .ok{color:#7fd6a4} .bad{color:#ef8bc5}
</style>
<h1>Visual regression report</h1>
<p class="${changed.length ? "bad" : "ok"}">${results.length} states compared, ${changed.length} with differences.</p>
<p>${usage.exercised} of ${usage.total} <code>!important</code> declarations applied to an element in at least one captured state; the other ${usage.total - usage.exercised} are not covered by this suite.</p>
${rows}`,
  );
}

function importantCoverage(manifest) {
  const exercised = manifest.important.filter(
    (entry) => entry.states > 0,
  ).length;
  return { total: manifest.important.length, exercised };
}

if (command === "baseline") {
  console.log("Recording baseline…");
  const manifest = await captureAll(path.join(outputRoot, "baseline"));
  const usage = importantCoverage(manifest);
  console.log(
    `\nBaseline: ${manifest.states.length} states. ` +
      `${usage.exercised} of ${usage.total} !important declarations are exercised.`,
  );
} else if (command === "compare") {
  const baselineDirectory = path.join(outputRoot, "baseline");
  if (!existsSync(path.join(baselineDirectory, "manifest.json"))) {
    throw new Error("No baseline yet. Run the baseline command first.");
  }

  const baselineManifest = JSON.parse(
    readFileSync(path.join(baselineDirectory, "manifest.json"), "utf8"),
  );
  const currentDirectory = path.join(outputRoot, "current");
  let currentManifest;

  if (reuseCapture) {
    currentManifest = JSON.parse(
      readFileSync(path.join(currentDirectory, "manifest.json"), "utf8"),
    );
  } else {
    console.log("Capturing current state…");
    currentManifest = await captureAll(currentDirectory);
  }

  if (
    currentManifest.catalogGeneratedAt !==
    baselineManifest.catalogGeneratedAt
  ) {
    console.warn(
      "\nWarning: published media changed since the baseline was recorded; content differences are expected.",
    );
  }

  const compareCapture = (directory, manifest) =>
    manifest.states.map(({ id }) => ({
      id,
      differences: existsSync(path.join(baselineDirectory, `${id}.json.gz`))
        ? compareState(
            loadState(baselineDirectory, id),
            loadState(directory, id),
          )
        : [
            {
              element: "(state)",
              path: id,
              property: "(state missing from baseline)",
              before: "absent",
              after: "present",
            },
          ],
    }));
  let captured = compareCapture(currentDirectory, currentManifest);
  const suspects = captured
    .filter((result) => result.differences.length > 0)
    .map((result) => result.id);

  /*
   * A real regression reproduces. Capture the differing states once more
   * and keep only differences present in both captures, which removes
   * one-off timing flukes.
   */
  if (suspects.length > 0 && !reuseCapture) {
    console.log(`\nConfirming ${suspects.length} differing state(s)…`);
    const confirmDirectory = path.join(outputRoot, "current-confirm");
    const confirmManifest = await captureAll(confirmDirectory, suspects);
    const confirmed = new Map(
      compareCapture(confirmDirectory, confirmManifest).map((result) => [
        result.id,
        new Set(
          result.differences.map(
            (difference) => `${difference.path}|${difference.property}`,
          ),
        ),
      ]),
    );

    captured = captured.map((result) => ({
      id: result.id,
      differences: result.differences.filter((difference) =>
        confirmed
          .get(result.id)
          ?.has(`${difference.path}|${difference.property}`),
      ),
    }));
  }

  const missingStates = baselineManifest.states
    .map((state) => state.id)
    .filter(
      (id) =>
        !currentManifest.states.some((state) => state.id === id) &&
        !onlyScenarios &&
        !onlyViewports,
    );
  const results = [
    ...missingStates.map((id) => ({
      id,
      differences: [
        {
          element: "(state)",
          path: id,
          property: "(state no longer captured)",
          before: "present",
          after: "absent",
        },
      ],
    })),
    ...captured,
  ];
  const reportDirectory = path.join(outputRoot, "report");
  rmSync(reportDirectory, { recursive: true, force: true });
  mkdirSync(reportDirectory, { recursive: true });
  writeReport(reportDirectory, results, importantCoverage(currentManifest));

  const changed = results.filter((result) => result.differences.length > 0);
  console.log(
    `\n${results.length} states compared, ${changed.length} with differences.`,
  );
  for (const result of changed.slice(0, 20)) {
    console.log(`  ${result.id}: ${result.differences.length}`);
    for (const difference of result.differences.slice(0, 3)) {
      console.log(
        `    ${difference.element} { ${difference.property}: ${difference.before} → ${difference.after} }`,
      );
    }
  }
  console.log(
    `Report: ${path.relative(projectRoot, path.join(reportDirectory, "index.html"))}`,
  );
  process.exitCode = changed.length > 0 ? 1 : 0;
} else {
  console.error(
    "Usage: node scripts/visual-regression/run.mjs <baseline|compare> [--only=…] [--viewport=…] [--reuse]",
  );
  process.exitCode = 2;
}
