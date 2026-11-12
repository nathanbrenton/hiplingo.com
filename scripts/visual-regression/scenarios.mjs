/*
 * What the visual-regression suite looks at.
 *
 * A scenario is a route plus the interaction that puts the page into one
 * state. Every scenario is captured at every viewport. Steps use
 * accessible names and stable class names; a step whose target is missing
 * fails the scenario loudly instead of silently capturing the wrong state.
 *
 * Add a scenario whenever a change touches a state that is not listed.
 */

export const viewports = [
  { name: "desktop", width: 1440, height: 900, touch: false },
  /* Mid-width desktop bands have their own artwork/waveform layout rules. */
  { name: "desktop-1280", width: 1280, height: 800, touch: false },
  { name: "desktop-1100", width: 1100, height: 768, touch: false },
  { name: "desktop-960", width: 960, height: 720, touch: false },
  { name: "tablet", width: 820, height: 1180, touch: true },
  { name: "phone-portrait", width: 390, height: 844, touch: true },
  { name: "phone-landscape", width: 844, height: 390, touch: true },
];

/*
 * Elements that scripts move continuously (playback position, the
 * audio-reactive and ambient backgrounds). They differ between any two
 * captures, so they are left out of comparisons — which also means an
 * `!important` that only affects one of these is not verified by the suite.
 * Matches a class exactly, or by prefix when it ends with "*".
 */
export const scriptDrivenClasses = [
  "shared-waveform__playhead",
  "listen-reactive-background*",
  "hiplingo-site-ambient-background__field",
];

const firstReleaseCard = ".hiplingo-release-card";
const firstPlayableTrack =
  ".hiplingo-release-track:not(.hiplingo-release-track--unavailable)";

async function openFirstRelease(page) {
  await page.locator(firstReleaseCard).first().click();
  await page.locator(".hiplingo-release-tracklist").waitFor();
}

async function selectFirstTrack(page) {
  await openFirstRelease(page);
  await page
    .locator(`${firstPlayableTrack} .hiplingo-release-track__action`)
    .first()
    .click();
  await page.locator(".hiplingo-now-playing-dock").first().waitFor();
}

async function openSettings(page) {
  await page.getByLabel("Open player settings").click();
  await page.getByRole("dialog", { name: "Player settings" }).waitFor();
}

/* Presses on the element and holds mid-drag so drag-only styles apply. */
async function holdDrag(page, selector, deltaX) {
  const box = await page.locator(selector).first().boundingBox();

  if (!box) {
    throw new Error(`Nothing to drag at ${selector}`);
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX / 2, y, { steps: 4 });
  await page.mouse.move(x + deltaX, y, { steps: 4 });
}

async function openListenWithTrack(page) {
  await selectFirstTrack(page);
  await page.getByRole("link", { name: "Listen" }).first().click();
  await page.locator(".artwork-stack").waitFor();
}

/*
 * The carousel's "committing" styles exist only for a moment after a swipe
 * is released. Freezing the page clock just before releasing holds the page
 * in that moment so it can be recorded.
 */
async function releaseSwipeAndFreeze(page, deltaX) {
  await openListenWithTrack(page);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(350);
  await holdDrag(page, ".artwork-stack", deltaX);
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  /*
   * Releasing selects the neighbouring track, which starts loading its
   * waveform and stream. Whether that finishes before the capture is a
   * race, so nothing new is allowed to load during the frozen moment.
   */
  await page.route("**/*", (route) => route.abort());
  await page.mouse.up();
  await page
    .locator('.artwork-stack[data-swipe-committing="true"]')
    .waitFor();
}

export const scenarios = [
  { name: "home", route: "/" },
  { name: "releases", route: "/releases" },
  {
    name: "releases-card-hover",
    route: "/releases",
    pointerOnly: true,
    run: (page) => page.locator(firstReleaseCard).first().hover(),
  },
  { name: "release-detail", route: "/releases", run: openFirstRelease },
  {
    name: "release-detail-track-hover",
    route: "/releases",
    pointerOnly: true,
    run: async (page) => {
      await openFirstRelease(page);
      await page.locator(firstPlayableTrack).nth(1).hover();
    },
  },
  {
    name: "release-detail-row-selected",
    route: "/releases",
    run: async (page) => {
      await openFirstRelease(page);
      await page
        .locator(`${firstPlayableTrack} .hiplingo-release-track__title`)
        .nth(1)
        .click();
    },
  },
  {
    name: "release-detail-track-started",
    route: "/releases",
    run: selectFirstTrack,
  },
  { name: "artists", route: "/artists" },
  {
    name: "artist-detail",
    route: "/artists",
    run: async (page) => {
      await page.locator(".hiplingo-artist-card").first().click();
      await page.locator(".hiplingo-artist-detail-page").waitFor();
    },
  },
  { name: "listen-idle", route: "/listen" },
  {
    name: "listen-track-started",
    route: "/releases",
    run: async (page) => {
      await selectFirstTrack(page);
      await page.getByRole("link", { name: "Listen" }).first().click();
      await page.locator(".artwork-stack").waitFor();
    },
  },
  {
    name: "listen-artwork-mid-drag",
    route: "/releases",
    run: async (page) => {
      await selectFirstTrack(page);
      await page.getByRole("link", { name: "Listen" }).first().click();
      await page.locator(".artwork-stack").waitFor();
      await holdDrag(page, ".artwork-stack", -90);
    },
    release: (page) => page.mouse.up(),
  },
  {
    name: "listen-artwork-mid-drag-previous",
    route: "/releases",
    run: async (page) => {
      await openListenWithTrack(page);
      await holdDrag(page, ".artwork-stack", 60);
    },
    release: (page) => page.mouse.up(),
  },
  {
    name: "listen-artwork-far-drag-next",
    route: "/releases",
    run: async (page) => {
      await openListenWithTrack(page);
      await holdDrag(page, ".artwork-stack", -260);
    },
    release: (page) => page.mouse.up(),
  },
  {
    name: "listen-artwork-far-drag-previous",
    route: "/releases",
    run: async (page) => {
      await openListenWithTrack(page);
      await holdDrag(page, ".artwork-stack", 260);
    },
    release: (page) => page.mouse.up(),
  },
  {
    name: "listen-artwork-committing-next",
    route: "/releases",
    frozenClock: true,
    run: (page) => releaseSwipeAndFreeze(page, -260),
  },
  {
    name: "listen-artwork-committing-previous",
    route: "/releases",
    frozenClock: true,
    run: (page) => releaseSwipeAndFreeze(page, 260),
  },
  {
    name: "listen-titles-mid-drag",
    /* Short landscape layouts do not show the title carousel. */
    exceptViewports: ["phone-landscape"],
    route: "/releases",
    run: async (page) => {
      await selectFirstTrack(page);
      await page.getByRole("link", { name: "Listen" }).first().click();
      await page.locator(".listen-track-queue__titles").waitFor();
      await holdDrag(page, ".listen-track-queue__titles", -70);
    },
    release: (page) => page.mouse.up(),
  },
  { name: "settings-open", route: "/", run: openSettings },
  {
    name: "settings-open-with-track",
    route: "/releases",
    run: async (page) => {
      await selectFirstTrack(page);
      await openSettings(page);
    },
  },
  {
    name: "track-metadata-open",
    route: "/releases",
    run: async (page) => {
      await selectFirstTrack(page);
      await page.getByLabel("View selected track metadata").click();
      await page.getByRole("dialog", { name: "Track metadata" }).waitFor();
    },
  },
  { name: "licensing", route: "/licensing" },
  { name: "licensing-inquiry", route: "/licensing/inquiry" },
  { name: "licensing-jam", route: "/licensing/jam" },
  { name: "about", route: "/about" },
];
