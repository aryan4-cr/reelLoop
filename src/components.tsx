import { coverPreview } from "./covers";
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
  defaultCaption,
  coverEditor,
}: {
  video: PublicVideo;
  onClose: () => void;
  onSave: (v: unknown) => void;
  busy: boolean;
  defaultCaption: string;
  coverEditor: ReactNode;
}) {
  const [name, setName] = useState(video.name),
    [captionMode, setCaptionMode] = useState("keep"),
    [caption, setCaption] = useState(video.caption),
    [hashtags, setHashtags] = useState(video.hashtags),
    [enabled, setEnabled] = useState(Boolean(video.enabled));
  return (
    <Modal title="Make this Reel yours" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave({
            name,
            caption,
            hashtags,
            enabled,
            caption_mode: captionMode,
          });
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
            maxLength={8800}
            rows={5}
            onChange={(e) => {
              setCaption(e.target.value);
              setCaptionMode("override");
            }}
            placeholder="Tell the story behind this Reel…"
          />
        </label>
        <label>
          Hashtags
          <input
            value={hashtags}
            maxLength={1000}
            onChange={(e) => {
              setHashtags(e.target.value);
              setCaptionMode("override");
            }}
            placeholder="#reels #yourstory"
          />
        </label>
        <small className="muted">
          {[caption, hashtags].filter(Boolean).join("\n\n").length}/2,200
          characters including hashtags
        </small>
        <Button
          onClick={() => {
            setCaption(defaultCaption);
            setHashtags("");
            setCaptionMode("default");
          }}
        >
          Reset caption to global default
        </Button>
        <div className="caption-preview">
          <strong>Final Instagram caption preview</strong>
          <p>
            {[caption, hashtags].filter(Boolean).join("\n\n") || "No caption"}
          </p>
        </div>
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
      {coverEditor}
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
      {video.cover_id && (
        <img
          className="publish-cover-preview"
          src={coverPreview(video.cover_id)}
          alt="Cover snapshot preview"
        />
      )}
      <div className="caption-preview">
        <strong>Final caption</strong>
        <p>
          {[video.caption, video.hashtags].filter(Boolean).join("\n\n") ||
            "No caption"}
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
    [mode, setMode] = useState<"loop" | "once" | "batch">(
      data.settings.batch_enabled ? "batch" : data.settings.mode,
    ),
    [batchSize, setBatchSize] = useState(String(data.settings.batch_size || 0)),
    [confirmed, setConfirmed] = useState(false),
    [quota, setQuota] = useState<{
      used: number;
      total: number;
      windowSeconds?: number;
    } | null>(null),
    [cooldown, setCooldown] = useState(
      String(data.settings.cooldown_minutes / 60),
    ),
    [start, setStart] = useState("");
  const enabledCount = data.videos.filter(
    (v) => v.enabled && v.status === "ready",
  ).length;
  const unsaved =
    Number(minutes) !== data.settings.interval_minutes ||
    timezone !== data.settings.timezone ||
    mode !== (data.settings.batch_enabled ? "batch" : data.settings.mode) ||
    Number(batchSize) !== data.settings.batch_size ||
    Math.round(Number(cooldown) * 60) !== data.settings.cooldown_minutes;
  useEffect(
    () => setConfirmed(false),
    [minutes, timezone, mode, batchSize, cooldown, enabledCount],
  );
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
                  batch_size: Number(batchSize),
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
              {Number(minutes) / 60} hours · Batch Loop defaults to 300 minutes
              (5 hours). Minimum 1 hour.
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
            Publishing Mode
            <select
              value={mode}
              onChange={(e) => {
                const next = e.target.value as "loop" | "once" | "batch";
                setMode(next);
                setConfirmed(false);
                if (next === "batch" && mode !== "batch") setMinutes("300");
              }}
            >
              <option value="loop">Single Reel Loop</option>
              <option value="batch">Batch Loop</option>
              <option value="once">Publish Once</option>
            </select>
          </label>
          {mode === "batch" && (
            <div className="info-note">
              <div>
                <label>
                  Batch size (0 = all enabled, maximum 20)
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={batchSize}
                    onChange={(e) => {
                      setBatchSize(e.target.value);
                      setConfirmed(false);
                    }}
                  />
                </label>
                <p>
                  {
                    data.videos.filter((v) => v.enabled && v.status === "ready")
                      .length
                  }{" "}
                  enabled videos. Estimated{" "}
                  {(
                    (Math.min(
                      Number(batchSize) || 20,
                      data.videos.filter(
                        (v) => v.enabled && v.status === "ready",
                      ).length,
                    ) *
                      1440) /
                    Number(minutes)
                  ).toFixed(1)}{" "}
                  Reels/day on average; up to{" "}
                  {Math.min(
                    Number(batchSize) || 20,
                    data.videos.filter((v) => v.enabled && v.status === "ready")
                      .length,
                  ) * Math.ceil(1440 / Number(minutes))}{" "}
                  in 24 hours.
                </p>
                <p>
                  Repeated content and frequent posting may trigger spam
                  enforcement or account restrictions. Quota availability is not
                  approval of content. Each batch runs sequentially; processing
                  can delay these estimates.
                </p>
                {Number(cooldown) * 60 > Number(minutes) && (
                  <p role="alert">
                    Cooldown exceeds interval. This schedule cannot start.
                  </p>
                )}
              </div>
            </div>
          )}
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
          {Boolean(data.settings.batch_enabled) && (
            <div className="info-note">
              <div>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run(
                      async () => setQuota(await api("/instagram/quota")),
                      "Live quota checked.",
                    )
                  }
                >
                  Check live Instagram quota
                </Button>
                {quota && (
                  <p>
                    {quota.used} used / {quota.total} allowed in{" "}
                    {quota.windowSeconds
                      ? quota.windowSeconds / 3600
                      : "unknown"}{" "}
                    hours. Start rechecks the live quota.
                  </p>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  I confirm the saved Batch Loop frequency and understand
                  repeated-content risks.
                </label>
                <p>
                  Next batch: {fmt(data.settings.next_publish_at, tz)}.
                  Estimated first Reel: about 2 minutes after batch start;
                  subsequent Reels about 3 minutes apart. Actual timing depends
                  on Instagram.
                </p>
              </div>
            </div>
          )}
          {unsaved && (
            <p role="status">
              Save your changed scheduling settings before starting.
            </p>
          )}
          <div className="rhythm-actions">
            <Button
              variant="primary"
              disabled={
                busy ||
                unsaved ||
                !!data.settings.enabled ||
                Boolean(data.settings.batch_enabled && !confirmed)
              }
              onClick={() =>
                run(
                  () =>
                    api("/schedule/start", "POST", {
                      ...(start ? { start_at: new Date(start).getTime() } : {}),
                      ...(data.settings.batch_enabled && confirmed
                        ? { batch_confirmation: "START BATCH LOOP" }
                        : {}),
                    }),
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
        <BatchProgress data={data} run={run} busy={busy} tz={tz} />
        <section className="panel schedule-preview">
          <div className="panel-heading">
            <strong>Upcoming times</strong>
            <Clock size={17} />
          </div>
          {data.settings.batch_enabled ? (
            <BatchPreview data={data} tz={tz} />
          ) : (
            data.upcoming.slice(0, 6).map((v, i) => (
              <div className="preview-slot" key={i}>
                <span className="order">{i + 1}</span>
                <div>
                  <strong>{v.name}</strong>
                  <small>{fmt(v.at, tz)}</small>
                </div>
              </div>
            ))
          )}
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
export function BatchPreview({ data, tz }: { data: Dashboard; tz: string }) {
  const groups = Array.from(
    new Set(
      data.upcoming
        .map((v) => v.batch_at)
        .filter((t): t is number => t !== undefined),
    ),
  );
  return (
    <div>
      {groups.map((at, i) => (
        <div className="padded" key={at}>
          <strong>
            Batch {i + 1} — {fmt(at, tz)}
          </strong>
          <p className="muted">
            Estimated completion:{" "}
            {fmt(
              Math.max(
                ...data.upcoming
                  .filter((v) => v.batch_at === at)
                  .map((v) => v.at),
              ),
              tz,
            )}
            . Times are estimates, not simultaneous posts.
          </p>
          {data.upcoming
            .filter((v) => v.batch_at === at)
            .map((v, j) => (
              <div className="preview-slot" key={`${at}-${v.id}`}>
                <span>{j + 1}</span>
                <strong>{v.name}</strong>
                <small>Estimated {fmt(v.at, tz)}</small>
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
export function BatchProgress({
  data,
  run,
  busy,
  tz,
}: {
  data: Dashboard;
  run: Run;
  busy: boolean;
  tz: string;
}) {
  const batch =
    data.batches?.find((b) => b.state === "active") ?? data.batches?.[0];
  if (!batch) return null;
  const items = data.batch_items.filter((i) => i.batch_id === batch.id);
  return (
    <section className="panel padded">
      <h3>Batch progress — {batch.state}</h3>
      <p>
        {batch.succeeded} published, {batch.failed} failed / {batch.total}{" "}
        videos. Started {fmt(batch.scheduled_at, tz)}.
      </p>
      {items.map((i) => (
        <p key={i.id}>
          {i.ordinal + 1}. {i.video_name} — {i.job_state ?? i.state}
          {i.actual_at ? ` · Published ${fmt(i.actual_at, tz)}` : ""}
        </p>
      ))}
      {batch.state === "active" && (
        <Button
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                "Cancel all remaining unpublished batch items? Published results and your library will be kept. Uncertain outcomes must be reconciled first.",
              )
            )
              void run(
                () =>
                  api("/batches/cancel", "POST", {
                    confirmation: "CANCEL UNPUBLISHED BATCH",
                  }),
                "Batch cancelled; automation paused.",
              );
          }}
        >
          Cancel unpublished batch items
        </Button>
      )}
    </section>
  );
}
