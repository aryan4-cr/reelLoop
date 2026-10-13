import {
  useState,
  useEffect,
  useRef,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  Clock,
  Film,
  History,
  Camera as Instagram,
  LockKeyhole,
  LoaderCircle,
  Play,
  Pause,
  Repeat2,
  Settings2,
  ShieldCheck,
  X,
  AlertCircle,
} from "lucide-react";
import {
  api,
  bytes,
  type Dashboard,
  type PublicVideo,
  type PublicJob,
} from "./api";
export const fmt = (
  n: number | null,
  tz: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
) =>
  n !== null
    ? new Intl.DateTimeFormat("en-IN", { timeZone: tz, ...options }).format(n)
    : "Not scheduled";
export function Status({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`status ${tone}`}>
      <span />
      {children}
    </span>
  );
}
export function Button({
  children,
  onClick,
  disabled = false,
  variant = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button ${variant}`}
    >
      {children}
    </button>
  );
}
export function Empty({
  icon: Icon = Film,
  title,
  children,
  action,
}: {
  icon?: typeof Film;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon size={26} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal">
      <header>
        <h2>{title}</h2>
        <button
          className="icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export function Login({ onLogin }: { onLogin: (csrf: string) => void }) {
  const [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = await api<{ csrf: string }>("/auth/login", "POST", {
        password,
      });
      onLogin(data.csrf);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-art">
        <div className="brand">
          <span className="brand-icon">
            <Repeat2 />
          </span>
          ReelLoop
        </div>
        <div>
          <span className="eyebrow">CREATE ONCE. KEEP SHOWING UP.</span>
          <h1>
            Your content.
            <br />A little more
            <br />
            <em>momentum.</em>
          </h1>
          <p>
            A private space to organize your Reels and let your publishing
            rhythm run in the cloud.
          </p>
          <div className="login-orbit">
            <Repeat2 size={90} />
            <span className="orbit-point one">
              <Film />
            </span>
            <span className="orbit-point two">
              <Instagram />
            </span>
            <span className="orbit-point three">
              <Clock />
            </span>
          </div>
        </div>
        <small>
          <ShieldCheck size={15} /> Official Instagram API · Private video
          storage
        </small>
      </div>
      <main className="login-panel">
        <div className="login-card">
          <span className="empty-icon">
            <LockKeyhole size={25} />
          </span>
          <span className="eyebrow">YOUR PRIVATE WORKSPACE</span>
          <h2>Welcome to ReelLoop</h2>
          <p>Sign in to manage your library and publishing schedule.</p>
          <form onSubmit={submit}>
            <label>
              Owner password
              <input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={256}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary full" disabled={busy}>
              {busy ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <LockKeyhole size={17} />
              )}
              Sign in
            </Button>
          </form>
          <div className="login-note">
            <ShieldCheck size={18} />
            <p>
              First time here? Follow <code>SETUP.md</code> to set your owner
              password. Publishing stays paused until you enable it.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
export function Stat({
  label,
  value,
  icon: Icon,
  detail,
  warning = false,
  storage,
}: {
  label: string;
  value: string;
  icon: typeof Film;
  detail: string;
  warning?: boolean;
  storage?: number;
}) {
  return (
    <section className="stat panel">
      <div>
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong className={warning ? "warn" : ""}>{value}</strong>
      {storage !== undefined && (
        <div className="progress-track">
          <span style={{ width: `${Math.min(100, storage * 100)}%` }} />
        </div>
      )}
      <small>{detail}</small>
    </section>
  );
}
export function EditVideo({
  video,
  onClose,
  onSave,
  busy,
}: {
  video: PublicVideo;
  onClose: () => void;
  onSave: (v: unknown) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(video.name),
    [caption, setCaption] = useState(video.caption),
    [hashtags, setHashtags] = useState(video.hashtags),
    [enabled, setEnabled] = useState(Boolean(video.enabled));
  return (
    <Modal title="Make this Reel yours" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ name, caption, hashtags, enabled });
        }}
      >
        <label>
          Video name
          <input
            value={name}
            required
            maxLength={160}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          Caption
          <textarea
            value={caption}
            maxLength={2200}
            rows={5}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Tell the story behind this Reel…"
          />
        </label>
        <label>
          Hashtags
          <input
            value={hashtags}
            maxLength={1000}
            onChange={(e) => setHashtags(e.target.value)}
            placeholder="#reels #yourstory"
          />
        </label>
        <small className="muted">
          {[caption, hashtags].filter(Boolean).join("\n\n").length}/2,200
          characters including hashtags
        </small>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Include this video in the publishing queue
        </label>
        <div className="modal-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function TestPublish({
  video,
  onClose,
  onConfirm,
  disabled,
}: {
  video: PublicVideo;
  onClose: () => void;
  onConfirm: () => void;
  disabled: boolean;
}) {
  const [checked, setChecked] = useState(false);
  return (
    <Modal title="Publish one real Reel?" onClose={onClose}>
      <div className="publish-warning">
        <Instagram size={25} />
        <p>
          This will create a real public post on your connected Instagram
          account. It is not a simulation.
        </p>
      </div>
      <div className="test-video">
        <Film size={22} />
        <strong>{video.name}</strong>
      </div>
      <p className="muted">
        Pause automation and resolve any active job first. The video stays in
        your library after publishing.
      </p>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I authorize publishing this Reel to my Instagram account.
      </label>
      <div className="modal-actions">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          disabled={disabled || !checked}
          onClick={onConfirm}
        >
          <Play size={15} />
          Publish one Reel
        </Button>
      </div>
    </Modal>
  );
}
type Run = (fn: () => Promise<unknown>, message: string) => Promise<void>;
export function Scheduling({
  data,
  busy,
  run,
  tz,
}: {
  data: Dashboard;
  busy: boolean;
  run: Run;
  tz: string;
}) {
  const [minutes, setMinutes] = useState(
      String(data.settings.interval_minutes),
    ),
    [timezone, setTimezone] = useState(tz),
    [mode, setMode] = useState(data.settings.mode),
    [cooldown, setCooldown] = useState(
      String(data.settings.cooldown_minutes / 60),
    ),
    [start, setStart] = useState("");
  return (
    <div className="schedule-grid">
      <section className="panel padded">
        <div className="section-label">
          <Settings2 size={18} />
          Publishing settings
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                api("/settings", "PATCH", {
                  interval_minutes: Number(minutes),
                  timezone,
                  mode,
                  cooldown_minutes: Math.round(Number(cooldown) * 60),
                }),
              "Settings saved. The current next publication time is preserved.",
            );
          }}
        >
          <label>
            Publishing interval
            <div className="input-suffix">
              <input
                type="number"
                min="60"
                max="10080"
                step="1"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                required
              />
              <span>minutes</span>
            </div>
            <small>
              {Number(minutes) / 60} hours · Default 180 minutes (3 hours).
              Minimum 1 hour.
            </small>
          </label>
          <label>
            Timezone
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
            >
              {Array.from(
                new Set([tz, ...Intl.supportedValuesOf("timeZone")]),
              ).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <small>
              Times display in your selected timezone. Intervals are elapsed
              hours.
            </small>
          </label>
          <label>
            Queue behavior
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "loop" | "once")}
            >
              <option value="loop">Continuous loop</option>
              <option value="once">Publish each video once</option>
            </select>
          </label>
          <label>
            Minimum repeat cooldown
            <div className="input-suffix">
              <input
                type="number"
                min="0"
                max="8760"
                step="1"
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
                required
              />
              <span>hours</span>
            </div>
            <small>
              Prevents a video from being repeated too soon. Publish-once skips
              previously published videos, including manual tests.
            </small>
          </label>
          <Button type="submit" variant="primary" disabled={busy}>
            <Check size={16} />
            Save settings
          </Button>
        </form>
      </section>
      <div>
        <section className="panel padded">
          <div className="panel-heading no-padding">
            <span className="section-label">
              <Play size={17} />
              Automation controls
            </span>
            <Status tone={data.settings.enabled ? "teal" : "muted"}>
              {data.settings.enabled ? "Running" : "Paused"}
            </Status>
          </div>
          <p className="muted">
            {data.settings.pause_reason ??
              "Set an optional first publication time or resume your existing schedule."}
          </p>
          <label>
            Optional start time{" "}
            <span className="muted">(your device timezone)</span>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
            <small>
              Your browser interprets this input in its local timezone. The
              preview uses {tz}.
            </small>
          </label>
          <div className="rhythm-actions">
            <Button
              variant="primary"
              disabled={busy || !!data.settings.enabled}
              onClick={() =>
                run(
                  () =>
                    api(
                      "/schedule/start",
                      "POST",
                      start ? { start_at: new Date(start).getTime() } : {},
                    ),
                  "Automation started.",
                )
              }
            >
              <Play size={15} />
              Start / resume
            </Button>
            <Button
              disabled={busy || !data.settings.enabled}
              onClick={() =>
                run(
                  () => api("/schedule/pause", "POST", {}),
                  "Automation paused. Already submitted requests may complete.",
                )
              }
            >
              <Pause size={15} />
              Pause
            </Button>
          </div>
          <div className="info-note">
            <ShieldCheck size={17} />
            <p>
              Only one job can run at a time. Uncertain publish outcomes pause
              the schedule for your review.
            </p>
          </div>
        </section>
        <section className="panel schedule-preview">
          <div className="panel-heading">
            <strong>Upcoming times</strong>
            <Clock size={17} />
          </div>
          {data.upcoming.slice(0, 6).map((v, i) => (
            <div className="preview-slot" key={i}>
              <span className="order">{i + 1}</span>
              <div>
                <strong>{v.name}</strong>
                <small>{fmt(v.at, tz)}</small>
              </div>
            </div>
          ))}
          {!data.upcoming.length && (
            <p className="padded muted">
              Add an enabled video to preview your schedule.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
export function JobDetails({
  job,
  tz,
  onClose,
  run,
  busy,
}: {
  job: PublicJob;
  tz: string;
  onClose: () => void;
  run: Run;
  busy: boolean;
}) {
  const [events, setEvents] = useState<
      Array<{ at: number; kind: string; detail: string }>
    >([]),
    [media, setMedia] = useState(""),
    [verified, setVerified] = useState(false),
    [recent, setRecent] = useState<
      Array<{
        id: string;
        timestamp: string;
        permalink?: string;
        caption?: string;
      }>
    >([]);
  useEffect(() => {
    api<typeof events>(`/jobs/${job.id}/events`)
      .then(setEvents)
      .catch(() => {});
  }, [job.id, job.state]);
  const uncertain = ["uncertain", "publishing"].includes(job.state),
    active = [
      "queued",
      "creating",
      "processing",
      "ready",
      "uncertain",
      "publishing",
    ].includes(job.state);
  return (
    <Modal title="Publication details" onClose={onClose}>
      <div className="job-title">
        <Film size={23} />
        <strong>{job.video_name}</strong>
        <Status
          tone={
            job.state === "succeeded" ? "teal" : uncertain ? "red" : "muted"
          }
        >
          {job.state}
        </Status>
      </div>
      <dl className="job-data">
        <dt>Scheduled</dt>
        <dd>{fmt(job.scheduled_at, tz)}</dd>
        <dt>Published</dt>
        <dd>{job.actual_at ? fmt(job.actual_at, tz) : "—"}</dd>
        <dt>Container ID</dt>
        <dd>{job.container_id ?? "—"}</dd>
        <dt>Media ID</dt>
        <dd>{job.media_id ?? "—"}</dd>
        <dt>Attempts</dt>
        <dd>{job.attempts}</dd>
        <dt>Next retry</dt>
        <dd>{job.retry_at ? fmt(job.retry_at, tz) : "—"}</dd>
      </dl>
      <label>
        Caption used
        <textarea readOnly value={job.caption} rows={3} />
      </label>
      {job.error && (
        <div className="notice error">
          <AlertCircle size={17} />
          <span>{job.error}</span>
        </div>
      )}
      {uncertain && (
        <div className="reconcile">
          <h3>Verify this outcome on Instagram</h3>
          <p>
            ReelLoop will not submit this job again. If it published, record the
            matching recent media ID below.
          </p>
          <Button
            disabled={busy}
            onClick={() =>
              run(
                async () =>
                  setRecent(await api<typeof recent>("/instagram/recent")),
                "Recent Instagram posts loaded.",
              )
            }
          >
            Load recent posts
          </Button>
          {recent.map((m) => (
            <div key={m.id} className="recent-media">
              <button className="text-button" onClick={() => setMedia(m.id)}>
                {m.id} · {fmt(Date.parse(m.timestamp), tz)}
              </button>
              {m.permalink &&
                /^https:\/\/(www\.)?instagram\.com\//.test(m.permalink) && (
                  <a href={m.permalink} target="_blank" rel="noreferrer">
                    View post
                    <ArrowUpRight size={14} />
                  </a>
                )}
              <small>{m.caption?.slice(0, 100)}</small>
            </div>
          ))}
          <label>
            Matching Instagram media ID
            <input
              value={media}
              onChange={(e) => setMedia(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            I checked my Instagram profile and verified the outcome of this job.
          </label>
          <Button
            variant="primary"
            disabled={busy || !verified || !/^\d+$/.test(media)}
            onClick={() =>
              run(async () => {
                await api(`/jobs/${job.id}/reconcile`, "POST", {
                  media_id: media,
                  confirmation: "I VERIFIED THIS REEL",
                });
                onClose();
              }, "Publication reconciled. Resume the schedule when ready.")
            }
          >
            Record confirmed publication
          </Button>
        </div>
      )}
      <div className="job-events">
        <h3>Job timeline</h3>
        {events.map((e, i) => (
          <div key={i}>
            <span className="timeline-dot" />
            <span>
              <strong>{e.kind}</strong>
              <small>
                {fmt(e.at, tz)} · {e.detail}
              </small>
            </span>
          </div>
        ))}
      </div>
      {active && (
        <div className="modal-actions">
          <Button
            disabled={busy || (uncertain && !verified)}
            variant="danger-button"
            onClick={() =>
              run(async () => {
                await api(`/jobs/${job.id}/cancel`, "POST", {
                  confirmation: uncertain
                    ? "I VERIFIED NO REEL WAS PUBLISHED"
                    : "CANCEL UNPUBLISHED JOB",
                });
                onClose();
              }, "Job cancelled. Automation remains paused.")
            }
          >
            {uncertain
              ? "Confirm no Reel was published & cancel"
              : "Cancel unpublished job"}
          </Button>
        </div>
      )}
    </Modal>
  );
}
