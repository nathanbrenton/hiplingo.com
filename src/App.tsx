import { hiplingoLogoUrl } from "@hiplingo/brand";
import { useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";

import ArtistCatalog from "./components/ArtistCatalog";
import ArtistDetail from "./components/ArtistDetail";
import AudioPlayer, {
  type AudioPlayerHandle,
  type PlaybackStateSnapshot,
} from "./components/AudioPlayer";
import SiteAmbientBackground from "./components/SiteAmbientBackground";
import LandingHeroBanner from "./components/LandingHeroBanner";
import ReleaseCatalog from "./components/ReleaseCatalog";
import ReleaseDetail from "./components/ReleaseDetail";
import {
  fetchMediaCatalog,
} from "./lib/mediaCatalog";
import { getArtistSlug } from "./lib/publicArtists";
import { HIPLINGO_CONTACT_MAILTO, HIPLINGO_LICENSING_MAILTO } from "./siteConfig";
import type { MediaCatalog } from "./types/MediaCatalog";

type SiteRoute =
  | "/"
  | "/listen"
  | "/releases"
  | "/artists"
  | "/licensing"
  | "/licensing/inquiry"
  | "/licensing/jam"
  | "/licensing/jam/existing"
  | "/licensing/jam/future"
  | "/about";

type ParsedRoute = {
  section: SiteRoute;
  releaseId: string | null;
  artistSlug: string | null;
};

const PLAYBACK_DIAGNOSTICS_HOLD_MS = 6000;

const SITE_ROUTES = new Set<SiteRoute>([
  "/",
  "/listen",
  "/releases",
  "/artists",
  "/licensing",
  "/licensing/inquiry",
  "/licensing/jam",
  "/licensing/jam/existing",
  "/licensing/jam/future",
  "/about",
]);

function parseRoute(pathname: string): ParsedRoute {
  const route = pathname.replace(/\/+$/, "") || "/";

  if (SITE_ROUTES.has(route as SiteRoute)) {
    return {
      section: route as SiteRoute,
      releaseId: null,
      artistSlug: null,
    };
  }

  const releaseMatch = route.match(/^\/releases\/([^/]+)$/);

  if (releaseMatch) {
    try {
      return {
        section: "/releases",
        releaseId: decodeURIComponent(releaseMatch[1]),
        artistSlug: null,
      };
    } catch {
      return {
        section: "/releases",
        releaseId: releaseMatch[1],
        artistSlug: null,
      };
    }
  }

  const artistMatch = route.match(/^\/artists\/([^/]+)$/);

  if (artistMatch) {
    try {
      return {
        section: "/artists",
        releaseId: null,
        artistSlug: decodeURIComponent(artistMatch[1]),
      };
    } catch {
      return {
        section: "/artists",
        releaseId: null,
        artistSlug: artistMatch[1],
      };
    }
  }

  return {
    section: "/",
    releaseId: null,
    artistSlug: null,
  };
}

function getLocationKey() {
  return `${window.location.pathname}${window.location.search}`;
}

function navigateTo(route: string) {
  if (getLocationKey() !== route) {
    window.history.pushState({}, "", route);
  }

  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

type SiteLinkProps = {
  route: string;
  children: ReactNode;
  className?: string;
  currentRoute?: SiteRoute;
};

function SiteLink({
  route,
  children,
  className,
  currentRoute,
}: SiteLinkProps) {
  const isCurrent =
    currentRoute === route ||
    (route === "/licensing" && currentRoute?.startsWith("/licensing/"));

  return (
    <a
      href={route}
      className={className}
      aria-current={isCurrent ? "page" : undefined}
      onClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }

        event.preventDefault();
        navigateTo(route);
      }}
    >
      {children}
    </a>
  );
}

function SiteHeader({
  currentRoute,
  onTogglePlayerMenu,
  onOpenPlaybackDiagnostics,
  playerMenuButtonRef,
}: {
  currentRoute: SiteRoute;
  onTogglePlayerMenu: () => void;
  onOpenPlaybackDiagnostics: () => void;
  playerMenuButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const headerRef = useRef<HTMLElement | null>(null);
  const menuHoldTimerRef = useRef<number | null>(null);
  const menuHoldPointerRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const suppressMenuClickRef = useRef(false);

  function clearMenuHoldTimer() {
    if (menuHoldTimerRef.current !== null) {
      window.clearTimeout(menuHoldTimerRef.current);
      menuHoldTimerRef.current = null;
    }
  }

  function handleMenuPointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    event.stopPropagation();
    clearMenuHoldTimer();
    suppressMenuClickRef.current = false;
    menuHoldPointerRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };

    menuHoldTimerRef.current = window.setTimeout(() => {
      const heldPointer = menuHoldPointerRef.current;

      if (
        !heldPointer ||
        heldPointer.pointerId !== event.pointerId
      ) {
        return;
      }

      suppressMenuClickRef.current = true;
      menuHoldPointerRef.current = null;
      clearMenuHoldTimer();
      onOpenPlaybackDiagnostics();
    }, PLAYBACK_DIAGNOSTICS_HOLD_MS);
  }

  function handleMenuPointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    const heldPointer = menuHoldPointerRef.current;

    if (
      !heldPointer ||
      heldPointer.pointerId !== event.pointerId
    ) {
      return;
    }

    const movedX = Math.abs(event.clientX - heldPointer.startX);
    const movedY = Math.abs(event.clientY - heldPointer.startY);

    if (movedX > 10 || movedY > 10) {
      menuHoldPointerRef.current = null;
      clearMenuHoldTimer();
    }
  }

  function finishMenuPointer(
    event: ReactPointerEvent<HTMLButtonElement>,
  ) {
    if (
      menuHoldPointerRef.current?.pointerId === event.pointerId
    ) {
      menuHoldPointerRef.current = null;
    }

    clearMenuHoldTimer();
  }

  useEffect(() => {
    return () => clearMenuHoldTimer();
  }, []);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) {
      return;
    }

    const syncHeaderBottom = () => {
      document.documentElement.style.setProperty(
        "--hiplingo-site-header-bottom",
        `${Math.ceil(header.getBoundingClientRect().bottom)}px`,
      );
    };

    syncHeaderBottom();
    window.addEventListener("resize", syncHeaderBottom);

    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(syncHeaderBottom);
    observer?.observe(header);

    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", syncHeaderBottom);
    };
  }, []);

  return (
    <header ref={headerRef} className="hiplingo-site-header">
      <SiteLink
        route="/"
        currentRoute={currentRoute}
        className="hiplingo-site-brand"
      >
        <img
          src={hiplingoLogoUrl}
          alt=""
          aria-hidden="true"
        />
        <span>Hiplingo</span>
      </SiteLink>

      <nav className="hiplingo-site-nav" aria-label="Main navigation">
        <SiteLink route="/listen" currentRoute={currentRoute}>
          Listen
        </SiteLink>
        <SiteLink route="/releases" currentRoute={currentRoute}>
          Releases
        </SiteLink>
        <SiteLink route="/artists" currentRoute={currentRoute}>
          Artists
        </SiteLink>
        <SiteLink route="/licensing" currentRoute={currentRoute}>
          Licensing
        </SiteLink>
      </nav>

      <div className="hiplingo-site-actions">

        <button
          ref={playerMenuButtonRef}
          type="button"
          className="hiplingo-site-menu"
          onPointerDown={handleMenuPointerDown}
          onPointerMove={handleMenuPointerMove}
          onPointerUp={finishMenuPointer}
          onPointerCancel={finishMenuPointer}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") {
              finishMenuPointer(event);
            }
          }}
          onContextMenu={(event) => event.preventDefault()}
          onClick={(event) => {
            if (suppressMenuClickRef.current) {
              event.preventDefault();
              event.stopPropagation();
              suppressMenuClickRef.current = false;
              return;
            }

            onTogglePlayerMenu();
          }}
          aria-label="Open player settings"
          aria-haspopup="dialog"
          aria-controls="app-menu-panel"
        >
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function HomePage({
  currentRoute,
  catalog,
  onShuffleListen,
}: {
  currentRoute: SiteRoute;
  catalog: MediaCatalog | null;
  onShuffleListen: () => void;
}) {
  const hasPlayableTracks = Boolean(
    catalog?.releases.some((release) =>
      release.tracks.some((track) => track.playable),
    ),
  );

  return (
    <main className="hiplingo-page hiplingo-home">
      <section className="hiplingo-hero">
        <LandingHeroBanner />
        <div className="hiplingo-hero__identity">
          <div className="hiplingo-hero__logo" aria-hidden="true">
            <img src={hiplingoLogoUrl} alt="" />
          </div>

          <div className="hiplingo-hero__copy">
            <span className="hiplingo-kicker">Independent record label</span>
            <h1>Music first. Context included.</h1>
            <p>
              Releases, artists, and the context around them—built around a
              focused listening experience.
            </p>

            <div className="hiplingo-hero__actions">
              <SiteLink
                route="/releases"
                currentRoute={currentRoute}
                className="hiplingo-button"
              >
                Browse releases
              </SiteLink>
            </div>
          </div>
        </div>
      </section>

      <section
        className="hiplingo-home-shuffle"
        aria-label="Start listening"
      >
        <button
          type="button"
          className="hiplingo-home-shuffle__button"
          onClick={onShuffleListen}
          disabled={!hasPlayableTracks}
          aria-label="Shuffle the Hiplingo library and open Listen"
          title="Start listening"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h3.4c2.2 0 3.3 1.1 4.6 3.2l.4.7" />
            <path d="M16 5l4 2-4 2" />
            <path d="M4 17h3.4c2.2 0 3.3-1.1 4.6-3.2l.4-.7" />
            <path d="M15.4 17H20" />
            <path d="M16 15l4 2-4 2" />
          </svg>
          <span>Start listening</span>
        </button>
      </section>

      <section className="hiplingo-feature-grid" aria-label="Explore Hiplingo">
        <SiteLink route="/artists" className="hiplingo-feature-card">
          <span>Artists</span>
          <strong>Artist presentations</strong>
          <p>Profiles, releases, credits, media, and long-form context.</p>
        </SiteLink>
        <SiteLink route="/licensing" className="hiplingo-feature-card">
          <span>Rights &amp; permissions</span>
          <strong>Licensing</strong>
          <p>Licensing inquiries and Jam participant agreements.</p>
        </SiteLink>
      </section>
    </main>
  );
}

function LicensingPage() {
  return (
    <main className="hiplingo-page hiplingo-placeholder-page">
      <section className="hiplingo-placeholder-card">
        <span className="hiplingo-kicker">Rights &amp; permissions</span>
        <h1>Licensing</h1>
        <div className="hiplingo-placeholder-copy">
          <p>
            Request permission to use Hiplingo music or enter the participant
            workflow for a recorded Jam.
          </p>
        </div>

        <div
          className="hiplingo-feature-grid"
          aria-label="Licensing options"
        >
          <SiteLink
            route="/licensing/inquiry"
            className="hiplingo-feature-card"
          >
            <span>Music licensing</span>
            <strong>General licensing inquiry</strong>
            <p>
              Ask about synchronization, master use, excerpts, or other
              permissions.
            </p>
          </SiteLink>

          <SiteLink
            route="/licensing/jam"
            className="hiplingo-feature-card"
          >
            <span>Participants</span>
            <strong>Jam participant agreement</strong>
            <p>
              Review the applicable terms and record participation acceptance.
            </p>
          </SiteLink>
        </div>
      </section>
    </main>
  );
}

function JamParticipantPage() {
  return (
    <main className="hiplingo-page hiplingo-placeholder-page">
      <section className="hiplingo-placeholder-card">
        <span className="hiplingo-kicker">Participants</span>
        <h1>Jam agreements</h1>
        <div className="hiplingo-placeholder-copy">
          <p>
            Hiplingo uses different paperwork for historical recordings and for
            jams happening now or in the future. Participant access is
            invitation-based; this public page does not expose private rights
            records or accept signatures.
          </p>
        </div>

        <div className="hiplingo-feature-grid" aria-label="Jam agreement workflows">
          <SiteLink route="/licensing/jam/existing" className="hiplingo-feature-card">
            <span>Existing recordings</span>
            <strong>Retroactive catalog ratification</strong>
            <p>
              Identify the historical recording, confirm contributions and
              splits, disclose third-party material, and document a present
              rights grant for that specific material.
            </p>
          </SiteLink>

          <SiteLink route="/licensing/jam/future" className="hiplingo-feature-card">
            <span>Upcoming / current jams</span>
            <strong>Prospective participant joinder</strong>
            <p>
              Join the current Master Jam Agreement before participating, then
              confirm asset-specific credits, ownership, and revenue splits
              after material is created.
            </p>
          </SiteLink>
        </div>
      </section>
    </main>
  );
}

function PlaceholderPage({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main className="hiplingo-page hiplingo-placeholder-page">
      <section className="hiplingo-placeholder-card">
        <span className="hiplingo-kicker">{eyebrow}</span>
        <h1>{title}</h1>
        <div className="hiplingo-placeholder-copy">{children}</div>
        {action ? <div className="hiplingo-placeholder-action">{action}</div> : null}
      </section>
    </main>
  );
}

function SiteFooter() {
  return (
    <footer className="hiplingo-site-footer">
      <span>© {new Date().getFullYear()} Hiplingo</span>
      <span className="hiplingo-site-footer__links">
        <a href={HIPLINGO_CONTACT_MAILTO}>Contact</a>
      </span>
    </footer>
  );
}

export default function App() {
  const [locationKey, setLocationKey] = useState(getLocationKey);
  const [catalog, setCatalog] = useState<MediaCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [playbackState, setPlaybackState] = useState<PlaybackStateSnapshot>({
    trackKey: null,
    isPlaying: false,
    hasSelection: false,
  });
  const [
    releaseWaveformHost,
    setReleaseWaveformHost,
  ] = useState<HTMLDivElement | null>(null);
  const audioPlayerRef = useRef<AudioPlayerHandle | null>(null);
  const playerMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  const currentLocation = new URL(
    locationKey,
    window.location.origin,
  );
  const route = parseRoute(currentLocation.pathname);
  const requestedTrackKey = currentLocation.searchParams.get(
    "track",
  );
  const playbackDiagnosticsRequested =
    currentLocation.searchParams.get("diagnostics") === "playback";

  useEffect(() => {
    const handleNavigation = () => {
      setLocationKey(getLocationKey());
    };

    window.addEventListener("popstate", handleNavigation);

    return () => {
      window.removeEventListener("popstate", handleNavigation);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCatalog() {
      setCatalogLoading(true);

      try {
        const loadedCatalog = await fetchMediaCatalog(controller.signal);
        setCatalog(loadedCatalog);
        setCatalogError(null);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setCatalog(null);
        setCatalogError(
          error instanceof Error
            ? error.message
            : "Failed to load media catalog.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setCatalogLoading(false);
        }
      }
    }

    void loadCatalog();

    return () => {
      controller.abort();
    };
  }, []);

  function requestPlayback(
    trackKey: string,
    queueTrackKeys: string[],
  ) {
    audioPlayerRef.current?.playQueue({
      trackKey,
      queueTrackKeys,
      autoplay: true,
    });
  }

  function requestTogglePlayback() {
    audioPlayerRef.current?.togglePlayback();
  }

  function requestShuffleListen() {
    audioPlayerRef.current?.shuffleLibrary();
    navigateTo("/listen");
  }

  function requestTogglePlayerMenu() {
    audioPlayerRef.current?.toggleSettings();
  }

  function requestOpenPlaybackDiagnostics() {
    audioPlayerRef.current?.openPlaybackDiagnostics();
  }

  let content: ReactNode;

  switch (route.section) {
    case "/listen":
      content = null;
      break;

    case "/releases":
      content = route.releaseId ? (
        <ReleaseDetail
          catalog={catalog}
          releaseId={route.releaseId}
          loading={catalogLoading}
          error={catalogError}
          onBack={() => navigateTo("/releases")}
          onOpenArtist={(artistName) => {
            navigateTo(
              `/artists/${encodeURIComponent(getArtistSlug(artistName))}`,
            );
          }}
          playbackState={playbackState}
          onPlayQueue={requestPlayback}
          onTogglePlayback={requestTogglePlayback}
          onNowPlayingWaveformHostChange={setReleaseWaveformHost}
        />
      ) : (
        <ReleaseCatalog
          catalog={catalog}
          loading={catalogLoading}
          error={catalogError}
          onOpenRelease={(releaseId) => {
            navigateTo(`/releases/${encodeURIComponent(releaseId)}`);
          }}
        />
      );
      break;

    case "/artists":
      content = route.artistSlug ? (
        <ArtistDetail
          catalog={catalog}
          artistSlug={route.artistSlug}
          loading={catalogLoading}
          error={catalogError}
          onBack={() => navigateTo("/artists")}
          onOpenRelease={(releaseId) => {
            navigateTo(`/releases/${encodeURIComponent(releaseId)}`);
          }}
        />
      ) : (
        <ArtistCatalog
          catalog={catalog}
          loading={catalogLoading}
          error={catalogError}
          onOpenArtist={(artistSlug) => {
            navigateTo(`/artists/${encodeURIComponent(artistSlug)}`);
          }}
        />
      );
      break;

    case "/licensing":
      content = <LicensingPage />;
      break;

    case "/licensing/inquiry":
      content = (
        <PlaceholderPage
          eyebrow="Licensing"
          title="General licensing inquiry"
          action={
            <a
              className="hiplingo-button hiplingo-button--primary"
              href={HIPLINGO_CONTACT_MAILTO}
            >
              Contact Hiplingo
            </a>
          }
        >
          <p>
            For synchronization, master-use, excerpt, or other music licensing
            inquiries, contact Hiplingo with the release or track, intended use,
            project or media type, timing, and any known territory or term.
          </p>
        </PlaceholderPage>
      );
      break;

    case "/licensing/jam":
      content = <JamParticipantPage />;
      break;

    case "/licensing/jam/existing":
      content = (
        <PlaceholderPage
          eyebrow="Existing recordings"
          title="Retroactive catalog ratification"
          action={
            <a
              className="hiplingo-button hiplingo-button--primary"
              href={HIPLINGO_LICENSING_MAILTO}
            >
              Contact Hiplingo Licensing
            </a>
          }
        >
          <p>
            This workflow is for recordings or compositions created before a
            complete written Hiplingo agreement was in place. Hiplingo identifies
            the exact historical assets, records each participant's contribution,
            separates master ownership from royalty participation and composition
            ownership, and documents any third-party material before commercial
            clearance.
          </p>
          <p>
            Signing is not available from this public page. Participants receive
            a private, asset-specific agreement package once the catalog record is
            prepared.
          </p>
        </PlaceholderPage>
      );
      break;

    case "/licensing/jam/future":
      content = (
        <PlaceholderPage
          eyebrow="Upcoming / current jams"
          title="Prospective participant joinder"
          action={
            <a
              className="hiplingo-button hiplingo-button--primary"
              href={HIPLINGO_LICENSING_MAILTO}
            >
              Contact Hiplingo Licensing
            </a>
          }
        >
          <p>
            Before participating, a creator reviews and joins an exact published
            version of Hiplingo's Master Jam Agreement. Being present at a session
            does not by itself create ownership or a royalty share.
          </p>
          <p>
            After a recording or composition is created, the actual contributors
            confirm an asset-specific split sheet covering master ownership, Master
            Net Receipts participation, composition ownership, credits, and any
            publishing-administration authority.
          </p>
        </PlaceholderPage>
      );
      break;

    case "/about":
      content = (
        <PlaceholderPage eyebrow="Label" title="About Hiplingo">
          <p>
            Hiplingo is an independent record-label and media project centered
            on recorded music, collaborative creation, provenance, and durable
            presentation of the work around each release.
          </p>
        </PlaceholderPage>
      );
      break;

    default:
      content = (
        <HomePage
          currentRoute={route.section}
          catalog={catalog}
          onShuffleListen={requestShuffleListen}
        />
      );
      break;
  }

  const playerDisplayMode =
    route.section === "/listen" ? "full" : "compact";

  return (
    <div
      className={`hiplingo-site-shell${
        route.section === "/listen" ? " hiplingo-site-shell--listen" : ""
      }`}
    >
      {route.section !== "/listen" ? <SiteAmbientBackground /> : null}

      <SiteHeader
        currentRoute={route.section}
        onTogglePlayerMenu={requestTogglePlayerMenu}
        onOpenPlaybackDiagnostics={requestOpenPlaybackDiagnostics}
        playerMenuButtonRef={playerMenuButtonRef}
      />

      <div className="hiplingo-route-content">
        {content}
      </div>

      <div
        className={`hiplingo-player-page hiplingo-player-host--${playerDisplayMode}`}
        role={playerDisplayMode === "full" ? "main" : undefined}
      >
        <AudioPlayer
          ref={audioPlayerRef}
          catalog={catalog}
          catalogError={catalogError}
          initialTrackKey={requestedTrackKey}
          displayMode={playerDisplayMode}
          onOpenFullPlayer={() => navigateTo("/listen")}
          onOpenRelease={(releaseId) => {
            navigateTo(`/releases/${encodeURIComponent(releaseId)}`);
          }}
          onOpenArtist={(artistName) => {
            navigateTo(
              `/artists/${encodeURIComponent(getArtistSlug(artistName))}`,
            );
          }}
          onPlaybackStateChange={setPlaybackState}
          releaseWaveformHost={releaseWaveformHost}
          menuToggleButtonRef={playerMenuButtonRef}
          playbackDiagnosticsRequested={playbackDiagnosticsRequested}
        />
      </div>

      <SiteFooter />
    </div>
  );
}
