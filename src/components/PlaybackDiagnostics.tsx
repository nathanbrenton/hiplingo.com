import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

type PlaybackDiagnosticsTrack = {
  key: string;
  title: string;
  artist: string;
  releaseTitle: string;
  sourceUrl: string | null;
  protocol: string | null;
};

type PlaybackDiagnosticsProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  appVersion: string;
  track: PlaybackDiagnosticsTrack | null;
  getPlaybackEngine: () => string;
  reduceVisualLoad: boolean;
  onReduceVisualLoadChange: (enabled: boolean) => void;
  onClose: () => void;
};

type DiagnosticsEvent = {
  offsetMs: number;
  name: string;
  mediaTime: number;
  bufferAhead: number;
  readyState: number;
  networkState: number;
  detail: string | null;
};

type NetworkInformationLike = {
  effectiveType?: string;
  downlink?: number;
  rtt?: number;
  saveData?: boolean;
};

const MAX_EVENTS = 250;
const DISPLAY_REFRESH_MS = 250;
const STALL_CHECK_MS = 500;
const MAIN_THREAD_STALL_MS = 250;

const MEDIA_EVENTS = [
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "durationchange",
  "progress",
  "canplay",
  "canplaythrough",
  "play",
  "playing",
  "pause",
  "waiting",
  "stalled",
  "suspend",
  "seeking",
  "seeked",
  "emptied",
  "abort",
  "error",
  "ended",
  "ratechange",
] as const;

function formatNumber(value: number, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function getReadyStateLabel(value: number) {
  return [
    "HAVE_NOTHING",
    "HAVE_METADATA",
    "HAVE_CURRENT_DATA",
    "HAVE_FUTURE_DATA",
    "HAVE_ENOUGH_DATA",
  ][value] ?? "UNKNOWN";
}

function getNetworkStateLabel(value: number) {
  return [
    "NETWORK_EMPTY",
    "NETWORK_IDLE",
    "NETWORK_LOADING",
    "NETWORK_NO_SOURCE",
  ][value] ?? "UNKNOWN";
}

function formatTimeRanges(ranges: TimeRanges) {
  const values: string[] = [];

  for (let index = 0; index < ranges.length; index += 1) {
    values.push(
      `${formatNumber(ranges.start(index))}-${formatNumber(ranges.end(index))}`,
    );
  }

  return values.length > 0 ? values.join(", ") : "none";
}

function getBufferAhead(audio: HTMLAudioElement | null) {
  if (!audio || !Number.isFinite(audio.currentTime)) {
    return 0;
  }

  for (let index = 0; index < audio.buffered.length; index += 1) {
    const start = audio.buffered.start(index);
    const end = audio.buffered.end(index);

    if (
      audio.currentTime >= start - 0.05 &&
      audio.currentTime <= end + 0.05
    ) {
      return Math.max(0, end - audio.currentTime);
    }
  }

  return 0;
}

function sanitizeMediaPath(sourceUrl: string | null) {
  if (!sourceUrl) {
    return "none";
  }

  try {
    return new URL(sourceUrl, window.location.origin).pathname;
  } catch {
    return sourceUrl.split("?")[0] || "unknown";
  }
}

function getMediaErrorDetail(audio: HTMLAudioElement | null) {
  if (!audio?.error) {
    return null;
  }

  return `code=${audio.error.code}; message=${audio.error.message || "unavailable"}`;
}

function getConnectionSummary() {
  const navigatorWithConnection = navigator as Navigator & {
    connection?: NetworkInformationLike;
  };
  const connection = navigatorWithConnection.connection;

  if (!connection) {
    return "not exposed by browser";
  }

  return [
    connection.effectiveType
      ? `effectiveType=${connection.effectiveType}`
      : null,
    typeof connection.downlink === "number"
      ? `downlink=${connection.downlink}Mbps`
      : null,
    typeof connection.rtt === "number"
      ? `rtt=${connection.rtt}ms`
      : null,
    typeof connection.saveData === "boolean"
      ? `saveData=${connection.saveData}`
      : null,
  ]
    .filter(Boolean)
    .join("; ") || "available without detailed values";
}

function copyTextFallback(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy command was rejected.");
  }
}

export default function PlaybackDiagnostics({
  audioRef,
  appVersion,
  track,
  getPlaybackEngine,
  reduceVisualLoad,
  onReduceVisualLoadChange,
  onClose,
}: PlaybackDiagnosticsProps) {
  const sessionStartedAtRef = useRef(new Date());
  const sessionStartedPerformanceRef = useRef(performance.now());
  const eventsRef = useRef<DiagnosticsEvent[]>([]);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [displayTick, setDisplayTick] = useState(0);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  function captureEvent(name: string, detail: string | null = null) {
    const audio = audioRef.current;
    const event: DiagnosticsEvent = {
      offsetMs: performance.now() - sessionStartedPerformanceRef.current,
      name,
      mediaTime: audio?.currentTime ?? 0,
      bufferAhead: getBufferAhead(audio),
      readyState: audio?.readyState ?? 0,
      networkState: audio?.networkState ?? 0,
      detail,
    };

    eventsRef.current.push(event);

    if (eventsRef.current.length > MAX_EVENTS) {
      eventsRef.current.splice(0, eventsRef.current.length - MAX_EVENTS);
    }
  }

  useEffect(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    const eventHandlers = MEDIA_EVENTS.map((eventName) => {
      const handler = () => {
        captureEvent(
          eventName,
          eventName === "error" ? getMediaErrorDetail(audio) : null,
        );
      };

      audio.addEventListener(eventName, handler);
      return [eventName, handler] as const;
    });

    captureEvent("DIAGNOSTICS_STARTED");

    return () => {
      eventHandlers.forEach(([eventName, handler]) => {
        audio.removeEventListener(eventName, handler);
      });
    };
  }, [audioRef]);

  useEffect(() => {
    captureEvent(
      "TRACK_CHANGED",
      track
        ? `trackKey=${track.key}; title=${track.title}`
        : "trackKey=none",
    );
  }, [track?.key]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      captureEvent(
        "VISIBILITY_CHANGE",
        `visibility=${document.visibilityState}`,
      );
    };
    const handleOnline = () => captureEvent("ONLINE");
    const handleOffline = () => captureEvent("OFFLINE");

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => {
      setDisplayTick((tick) => tick + 1);
    }, DISPLAY_REFRESH_MS);

    return () => window.clearInterval(refreshTimer);
  }, []);

  useEffect(() => {
    let expected = performance.now() + STALL_CHECK_MS;

    const stallTimer = window.setInterval(() => {
      const now = performance.now();
      const drift = now - expected;
      expected = now + STALL_CHECK_MS;

      if (
        document.visibilityState === "visible" &&
        drift >= MAIN_THREAD_STALL_MS
      ) {
        captureEvent(
          "MAIN_THREAD_STALL",
          `timerDriftMs=${Math.round(drift)}`,
        );
      }
    }, STALL_CHECK_MS);

    return () => window.clearInterval(stallTimer);
  }, []);

  const snapshot = useMemo(() => {
    const audio = audioRef.current;

    return {
      currentTime: audio?.currentTime ?? 0,
      duration: audio?.duration ?? 0,
      paused: audio?.paused ?? true,
      ended: audio?.ended ?? false,
      seeking: audio?.seeking ?? false,
      playbackRate: audio?.playbackRate ?? 1,
      readyState: audio?.readyState ?? 0,
      networkState: audio?.networkState ?? 0,
      bufferAhead: getBufferAhead(audio),
      buffered: audio ? formatTimeRanges(audio.buffered) : "none",
      seekable: audio ? formatTimeRanges(audio.seekable) : "none",
      mediaError: getMediaErrorDetail(audio),
      playbackEngine: getPlaybackEngine(),
    };
  }, [audioRef, displayTick, getPlaybackEngine]);

  function buildReport() {
    const screenSummary = `${window.screen.width}x${window.screen.height}`;
    const viewportSummary = `${window.innerWidth}x${window.innerHeight}`;
    const events = eventsRef.current
      .map((event) => {
        const detail = event.detail ? ` | ${event.detail}` : "";

        return [
          `+${formatNumber(event.offsetMs / 1000, 3)}s`,
          event.name,
          `media=${formatNumber(event.mediaTime, 3)}s`,
          `bufferAhead=${formatNumber(event.bufferAhead, 3)}s`,
          `ready=${event.readyState}/${getReadyStateLabel(event.readyState)}`,
          `network=${event.networkState}/${getNetworkStateLabel(event.networkState)}`,
        ].join(" | ") + detail;
      })
      .join("\n");

    return [
      "HIPLINGO PLAYBACK DIAGNOSTICS",
      `diagnosticsVersion: 1`,
      `appVersion: ${appVersion}`,
      `sessionStarted: ${sessionStartedAtRef.current.toISOString()}`,
      `reportCreated: ${new Date().toISOString()}`,
      `page: ${window.location.pathname}`,
      `online: ${navigator.onLine}`,
      `visibility: ${document.visibilityState}`,
      `userAgent: ${navigator.userAgent}`,
      `screen: ${screenSummary}`,
      `viewport: ${viewportSummary}`,
      `devicePixelRatio: ${window.devicePixelRatio}`,
      `connection: ${getConnectionSummary()}`,
      "",
      "TRACK",
      `trackKey: ${track?.key ?? "none"}`,
      `title: ${track?.title ?? "none"}`,
      `artist: ${track?.artist ?? "none"}`,
      `release: ${track?.releaseTitle ?? "none"}`,
      `protocol: ${track?.protocol ?? "none"}`,
      `mediaPath: ${sanitizeMediaPath(track?.sourceUrl ?? null)}`,
      `playbackEngine: ${snapshot.playbackEngine}`,
      `reduceVisualLoad: ${reduceVisualLoad}`,
      "",
      "CURRENT MEDIA STATE",
      `currentTime: ${formatNumber(snapshot.currentTime, 3)}s`,
      `duration: ${formatNumber(snapshot.duration, 3)}s`,
      `paused: ${snapshot.paused}`,
      `ended: ${snapshot.ended}`,
      `seeking: ${snapshot.seeking}`,
      `playbackRate: ${snapshot.playbackRate}`,
      `readyState: ${snapshot.readyState} ${getReadyStateLabel(snapshot.readyState)}`,
      `networkState: ${snapshot.networkState} ${getNetworkStateLabel(snapshot.networkState)}`,
      `bufferAhead: ${formatNumber(snapshot.bufferAhead, 3)}s`,
      `buffered: ${snapshot.buffered}`,
      `seekable: ${snapshot.seekable}`,
      `mediaError: ${snapshot.mediaError ?? "none"}`,
      "",
      `EVENTS (${eventsRef.current.length}/${MAX_EVENTS} retained)`,
      events || "none",
    ].join("\n");
  }

  async function copyReport() {
    const report = buildReport();

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(report);
      } else {
        copyTextFallback(report);
      }

      setCopyStatus("Report copied");
    } catch (error) {
      console.error("Unable to copy playback diagnostics report:", error);
      setCopyStatus("Copy failed");
    }
  }

  function markSkip() {
    captureEvent("USER_MARKED_SKIP");
    setDisplayTick((tick) => tick + 1);
  }

  function clearEvents() {
    eventsRef.current = [];
    captureEvent("EVENT_LOG_CLEARED");
    setDisplayTick((tick) => tick + 1);
  }

  return (
    <aside
      className="playback-diagnostics"
      aria-label="Playback diagnostics"
      data-details-open={detailsOpen ? "true" : "false"}
    >
      <div className="playback-diagnostics__bar">
        <div className="playback-diagnostics__bar-status">
          <strong>Playback diagnostics</strong>
          <small>
            {snapshot.playbackEngine} · buffer {formatNumber(snapshot.bufferAhead)}s
          </small>
        </div>

        <div className="playback-diagnostics__bar-actions">
          <button type="button" onClick={markSkip}>
            Mark Skip
          </button>
          <button
            type="button"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? "Hide" : "Details"}
          </button>
          <button
            type="button"
            className="playback-diagnostics__end"
            onClick={onClose}
          >
            End
          </button>
        </div>
      </div>

      {detailsOpen ? (
        <div className="playback-diagnostics__panel">
          <div className="playback-diagnostics__grid">
            <span>Track</span>
            <strong>{track?.title ?? "No track selected"}</strong>

            <span>Artist</span>
            <strong>{track?.artist ?? "—"}</strong>

            <span>Release</span>
            <strong>{track?.releaseTitle ?? "—"}</strong>

            <span>Playback</span>
            <strong>{snapshot.playbackEngine}</strong>

            <span>Media time</span>
            <strong>{formatNumber(snapshot.currentTime, 3)}s</strong>

            <span>Buffer ahead</span>
            <strong>{formatNumber(snapshot.bufferAhead, 3)}s</strong>

            <span>Ready state</span>
            <strong>{getReadyStateLabel(snapshot.readyState)}</strong>

            <span>Network state</span>
            <strong>{getNetworkStateLabel(snapshot.networkState)}</strong>
          </div>

          <label className="playback-diagnostics__visual-toggle">
            <span>
              <strong>Disable animated background</strong>
              <small>A/B test visual processing without changing audio.</small>
            </span>
            <input
              type="checkbox"
              checked={reduceVisualLoad}
              onChange={(event) => {
                const enabled = event.currentTarget.checked;
                onReduceVisualLoadChange(enabled);
                captureEvent(
                  "VISUAL_LOAD_MODE_CHANGED",
                  `disabledAnimatedBackground=${enabled}`,
                );
              }}
            />
          </label>

          <div className="playback-diagnostics__actions">
            <button type="button" onClick={markSkip}>
              Mark audible skip
            </button>
            <button type="button" onClick={() => void copyReport()}>
              Copy report
            </button>
            <button type="button" onClick={clearEvents}>
              Clear events
            </button>
          </div>

          {copyStatus ? (
            <p className="playback-diagnostics__copy-status" role="status">
              {copyStatus}
            </p>
          ) : null}

          <div className="playback-diagnostics__event-heading">
            <strong>Recent events</strong>
            <small>{eventsRef.current.length}/{MAX_EVENTS}</small>
          </div>

          <ol className="playback-diagnostics__events">
            {eventsRef.current.length > 0 ? (
              [...eventsRef.current]
                .reverse()
                .slice(0, 40)
                .map((event, index) => (
                  <li key={`${event.offsetMs}-${event.name}-${index}`}>
                    <code>
                      +{formatNumber(event.offsetMs / 1000, 3)}s {event.name}
                    </code>
                    <small>
                      media {formatNumber(event.mediaTime, 3)}s · buffer {formatNumber(event.bufferAhead, 3)}s
                    </small>
                    {event.detail ? <small>{event.detail}</small> : null}
                  </li>
                ))
            ) : (
              <li>No events captured yet.</li>
            )}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}
