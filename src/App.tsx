import { useState, useEffect, useRef } from "react";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  Check,
  ChevronRight,
  Clock,
  Cloud,
  Film,
  GripVertical,
  History,
  Camera as Instagram,
  LayoutDashboard,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Menu,
  Moon,
  Pause,
  Play,
  Plus,
  Repeat2,
  Settings2,
  ShieldCheck,
  Sun,
  Trash2,
  X,
  AlertCircle,
  CalendarDays,
  HardDrive,
  Link2,
  UploadCloud,
} from "lucide-react";
import {
  api,
  ApiError,
  setCsrf,
  bytes,
  uploadFile,
  type Dashboard,
  type PublicVideo,
  type PublicJob,
} from "./api";
import {
  fmt,
  Status,
  Button,
  Empty,
  Modal,
  Login,
  Stat,
  EditVideo,
  TestPublish,
  Scheduling,
  JobDetails,
} from "./components";
const tabs = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "library", label: "Video library", icon: Film },
  { id: "queue", label: "Publishing queue", icon: Repeat2 },
  { id: "schedule", label: "Scheduling", icon: CalendarDays },
  { id: "history", label: "Publishing history", icon: History },
];
export default function App() {
  const [session, setSession] = useState<boolean | null>(null),
    [data, setData] = useState<Dashboard | null>(null),
    [tab, setTab] = useState("overview"),
    [theme, setTheme] = useState(
      localStorage.getItem("reelloop-theme") ?? "dark",
    ),
    [menu, setMenu] = useState(false),
    [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<PublicVideo | null>(null),
    [test, setTest] = useState<PublicVideo | null>(null),
    [confirm, setConfirm] = useState<{
      title: string;
      text: string;
      action: () => Promise<unknown>;
    } | null>(null),
    [jobDetail, setJobDetail] = useState<PublicJob | null>(null),
    [progress, setProgress] = useState<
      Array<{ name: string; percent: number; error?: string }>
    >([]),
    [uploading, setUploading] = useState(false),
    [now, setNow] = useState(Date.now());
  const input = useRef<HTMLInputElement>(null),
    drag = useRef<string | null>(null);
  async function refresh() {
    try {
      setData(await api<Dashboard>("/dashboard"));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setSession(false);
      else setNotice({ text: (e as Error).message, error: true });
    }
  }
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("reelloop-theme", theme);
  }, [theme]);
  useEffect(() => {
    api<{ csrf: string }>("/auth/session")
      .then((r) => {
        setCsrf(r.csrf);
        setSession(true);
      })
      .catch(() => setSession(false));
  }, []);
  useEffect(() => {
    if (!session) return;
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [session]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const v = new URLSearchParams(location.search).get("connection");
    if (v) {
      setNotice({
        text:
          v === "success"
            ? "Instagram connected. Your schedule is paused until you enable it."
            : "Instagram authorization was declined.",
        error: v !== "success",
      });
      history.replaceState(null, "", location.pathname);
    }
  }, []);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await refresh();
      setNotice({ text: message, error: false });
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | File[] | null) {
    if (!files || uploading) return;
    if (!data?.configuration.uploads) {
      setNotice({
        text: "Configure R2 credentials and CORS first. See DEPLOYMENT.md.",
        error: true,
      });
      return;
    }
    const list = Array.from(files);
    setProgress(list.map((f) => ({ name: f.name, percent: 0 })));
    setUploading(true);
    setTab("library");
    for (let i = 0; i < list.length; i++) {
      try {
        await uploadFile(list[i], (percent) =>
          setProgress((p) =>
            p.map((v, j) => (j === i ? { ...v, percent } : v)),
          ),
        );
      } catch (e) {
        setProgress((p) =>
          p.map((v, j) =>
            j === i ? { ...v, error: (e as Error).message } : v,
          ),
        );
      }
      await refresh();
    }
    setUploading(false);
    if (input.current) input.current.value = "";
  }
  function switchTab(value: string) {
    setTab(value);
    setMenu(false);
  }
  const videos = data?.videos.filter((v) => v.status === "ready") ?? [],
    enabled = videos.filter((v) => v.enabled),
    tz = data?.settings.timezone ?? "Asia/Kolkata";
  async function reorder(id: string, target: string) {
    const ids = videos.map((v) => v.id),
      from = ids.indexOf(id),
      to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, id);
    await run(
      () => api("/videos/reorder", "POST", { ids }),
      "Queue order updated.",
    );
  }
  function deleteVideo(v: PublicVideo) {
    setConfirm({
      title: "Delete this video?",
      text: `“${v.name}” will be permanently removed from R2 and your library. Publication history will remain.`,
      action: () => api(`/videos/${v.id}`, "DELETE"),
    });
  }
  async function connect() {
    await run(async () => {
      const { url } = await api<{ url: string }>(
        "/instagram/connect",
        "POST",
        {},
      );
      location.assign(url);
    }, "Opening Instagram authorization…");
  }
  if (session === null)
    return (
      <div className="initial-loading">
        <Repeat2 className="spin" />
        <p>Opening your workspace…</p>
      </div>
    );
  if (!session)
    return (
      <Login
        onLogin={(csrf) => {
          setCsrf(csrf);
          setSession(true);
        }}
      />
    );
  const active = data?.jobs.find((j) =>
      [
        "queued",
        "creating",
        "processing",
        "ready",
        "publishing",
        "uncertain",
      ].includes(j.state),
    ),
    running = Boolean(data?.settings.enabled),
    next = data?.settings.next_publish_at ?? null,
    seconds = next ? Math.max(0, Math.floor((next - now) / 1000)) : 0,
    countdown = next
      ? `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ${seconds % 60}s`
      : "—";
  return (
    <div className="shell">
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            switchTab("overview");
          }}
        >
          <span className="brand-icon">
            <Repeat2 size={22} />
          </span>
          ReelLoop
          <span className="brand-dot" />
        </a>
        <span className="nav-caption">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => switchTab(t.id)}
              aria-current={tab === t.id ? "page" : undefined}
              className={`nav-item ${tab === t.id ? "active" : ""}`}
            >
              <t.icon size={19} />
              {t.label}
              {t.id === "library" && (
                <span className="nav-count">{videos.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="cloud-note">
            <span className="cloud-icon">
              <Cloud size={20} />
            </span>
            <strong>Always in the loop</strong>
            <p>Your cloud schedule keeps going, even when you log off.</p>
            <span>
              Cloudflare Workers <span className="dot-teal" />
            </span>
          </div>
          <button
            className="owner"
            onClick={() =>
              run(async () => {
                await api("/auth/logout", "POST");
                setSession(false);
                setData(null);
              }, "Signed out.")
            }
          >
            <span className="avatar">RL</span>
            <span>
              <strong>Owner workspace</strong>
              <small>Private access</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      {menu && (
        <button
          aria-label="Close navigation"
          className="menu-scrim"
          onClick={() => setMenu(false)}
        />
      )}
      <div className="workspace">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
          <span className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <strong>{tabs.find((t) => t.id === tab)?.label}</strong>
          </span>
          <div className="topbar-actions">
            <span className="private-badge">
              <ShieldCheck size={14} />
              Private dashboard
            </span>
            <button
              className="icon-button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <span className="avatar small">RL</span>
          </div>
        </header>
        <main className="content">
          <input
            hidden
            ref={input}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            multiple
            onChange={(e) => upload(e.target.files)}
          />
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {tab === "overview"
                  ? "YOUR PUBLISHING, AT A GLANCE"
                  : "YOUR CONTENT WORKSPACE"}
              </span>
              <h1>
                {tab === "overview"
                  ? "Keep your content in motion."
                  : tabs.find((t) => t.id === tab)?.label}
              </h1>
              <p>
                {tab === "overview"
                  ? "A clear view of your library, your rhythm, and what’s coming next."
                  : tab === "library"
                    ? "Upload once. Keep every original. Make each Reel ready to publish."
                    : tab === "queue"
                      ? "Set the order, then let your content come full circle."
                      : tab === "schedule"
                        ? "Choose a publishing rhythm that works for your audience."
                        : "Every attempt, every outcome, in one place."}
              </p>
            </div>
            <Button
              variant="primary"
              onClick={() => input.current?.click()}
              disabled={uploading || !data?.configuration.uploads}
            >
              <Plus size={18} />
              Upload videos
            </Button>
          </div>
          {notice && (
            <div
              role={notice.error ? "alert" : "status"}
              className={`notice ${notice.error ? "error" : ""}`}
            >
              <AlertCircle size={17} />
              <span>{notice.text}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!data ? (
            <div className="panel loading">
              <LoaderCircle className="spin" />
              Loading your dashboard…<Button onClick={refresh}>Retry</Button>
            </div>
          ) : (
            <>
              <div className="status-strip">
                <span>
                  <span className={`dot ${running ? "live" : ""}`} />
                  {running ? "Automation is running" : "Automation is paused"}
                </span>
                <span>
                  <Clock size={14} />
                  Every {data.settings.interval_minutes / 60} hours
                </span>
                <span>
                  <Repeat2 size={14} />
                  {data.settings.mode === "loop"
                    ? "Continuous loop"
                    : "Publish once"}
                </span>
                <span className="status-timezone">{tz}</span>
              </div>
              {(!data.configuration.uploads ||
                !data.configuration.instagram) && (
                <div className="setup-banner">
                  <Settings2 size={19} />
                  <div>
                    <strong>Finish connecting your workspace</strong>
                    <p>
                      {!data.configuration.uploads
                        ? "R2 uploads need bucket credentials and CORS. "
                        : ""}
                      {!data.configuration.instagram
                        ? "Instagram needs your Meta app configuration. "
                        : ""}
                      Follow SETUP.md and META_SETUP.md; real publishing has not
                      been verified.
                    </p>
                  </div>
                </div>
              )}
              {tab === "overview" && (
                <>
                  <div className="stats-grid">
                    <Stat
                      label="Stored videos"
                      value={String(videos.length).padStart(2, "0")}
                      icon={Film}
                      detail={`${enabled.length} enabled in your queue`}
                    />
                    <Stat
                      label="Successful publications"
                      value={String(data.stats.success ?? 0).padStart(2, "0")}
                      icon={Check}
                      detail="Confirmed Instagram media IDs"
                    />
                    <Stat
                      label="Publishing errors"
                      value={String(data.stats.errors ?? 0).padStart(2, "0")}
                      icon={Activity}
                      detail={
                        data.stats.errors
                          ? "Review publishing history"
                          : "No failed publications"
                      }
                      warning={!!data.stats.errors}
                    />
                    <Stat
                      label="Cloud storage"
                      value={bytes(data.storage.used)}
                      icon={HardDrive}
                      detail={`${bytes(data.storage.limit)} workspace limit`}
                      storage={data.storage.used / data.storage.limit}
                    />
                  </div>
                  <div className="overview-grid">
                    <section className="panel automation-card">
                      <div className="panel-heading">
                        <span className="section-label">
                          <Repeat2 size={18} />
                          Publishing rhythm
                        </span>
                        <Status tone={running ? "teal" : "muted"}>
                          {running ? "Running" : "Paused"}
                        </Status>
                      </div>
                      <div className="rhythm-body">
                        <div className="rhythm-orbit">
                          <div className="orbit-inner">
                            <Repeat2 size={42} />
                            <strong>
                              {data.settings.interval_minutes / 60}
                              <small>HOURS</small>
                            </strong>
                          </div>
                          <span className="orbit-dot" />
                        </div>
                        <div className="rhythm-info">
                          <span className="eyebrow">
                            {running
                              ? "NEXT PUBLICATION"
                              : "READY WHEN YOU ARE"}
                          </span>
                          <h2>
                            {running
                              ? fmt(next, tz, {
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : "Your next chapter starts here."}
                          </h2>
                          <p>
                            {running
                              ? `In ${countdown} · ${fmt(next, tz, { month: "short", day: "numeric" })}`
                              : (data.settings.pause_reason ??
                                "Add your videos, connect Instagram, and start your schedule.")}
                          </p>
                          <div className="rhythm-actions">
                            <Button
                              variant={running ? "" : "primary"}
                              disabled={busy}
                              onClick={() =>
                                run(
                                  () =>
                                    api(
                                      running
                                        ? "/schedule/pause"
                                        : "/schedule/start",
                                      "POST",
                                      {},
                                    ),
                                  running
                                    ? "Automation paused. An already submitted Reel may still finish."
                                    : "Automation enabled.",
                                )
                              }
                            >
                              {running ? (
                                <Pause size={16} />
                              ) : (
                                <Play size={16} />
                              )}{" "}
                              {running
                                ? "Pause automation"
                                : "Start automation"}
                            </Button>
                            <button
                              className="text-button"
                              onClick={() => switchTab("schedule")}
                            >
                              Edit schedule
                              <ArrowUpRight size={15} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <footer>
                        <Cloud size={15} />
                        Scheduled jobs run in the cloud. Your laptop can take a
                        break.
                      </footer>
                    </section>
                    <section className="panel account-card">
                      <div className="panel-heading">
                        <span className="section-label">
                          <Instagram size={18} />
                          Instagram account
                        </span>
                        <ShieldCheck size={17} />
                      </div>
                      <div className="instagram-avatar">
                        <Instagram size={28} />
                      </div>
                      <h3>
                        {data.account
                          ? `@${data.account.username}`
                          : "Connect your Creator account"}
                      </h3>
                      <p>
                        {data.account
                          ? "Your publishing destination."
                          : "Authorize ReelLoop through Instagram to publish your Reels."}
                      </p>
                      <Status
                        tone={
                          data.account?.status === "connected" &&
                          data.account.expires_at > now
                            ? "teal"
                            : "muted"
                        }
                      >
                        {data.account?.status === "connected" &&
                        data.account.expires_at > now
                          ? "Connected"
                          : "Connection required"}
                      </Status>
                      {data.account && (
                        <small>
                          Token expires{" "}
                          {fmt(data.account.expires_at, tz, {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </small>
                      )}
                      <Button
                        variant="full"
                        disabled={busy || !data.configuration.instagram}
                        onClick={connect}
                      >
                        <Link2 size={15} />
                        {data.account
                          ? "Reconnect Instagram"
                          : "Connect Instagram"}
                      </Button>
                      {data.account && (
                        <button
                          className="text-button"
                          onClick={() =>
                            setConfirm({
                              title: "Disconnect Instagram?",
                              text: "Your schedule will pause. Stored videos will remain in your library.",
                              action: () =>
                                api("/instagram/disconnect", "POST", {}),
                            })
                          }
                        >
                          Disconnect
                        </button>
                      )}
                    </section>
                  </div>
                  <div className="overview-grid lower">
                    <section className="panel">
                      <div className="panel-heading">
                        <span className="section-label">Up next</span>
                        <button
                          className="text-button"
                          onClick={() => switchTab("queue")}
                        >
                          View queue
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {!data.upcoming.length ? (
                        <Empty title="Your queue is a blank canvas">
                          Add a few videos to see your next publications here.
                        </Empty>
                      ) : (
                        <div className="upcoming-list">
                          {data.upcoming.slice(0, 4).map((v, i) => (
                            <div className="upcoming-row" key={v.id + i}>
                              <span
                                className={`order ${i === 0 ? "highlight" : ""}`}
                              >
                                {String(i + 1).padStart(2, "0")}
                              </span>
                              <span className="video-glyph">
                                <Film size={18} />
                              </span>
                              <div>
                                <strong>{v.name}</strong>
                                <small>
                                  {fmt(v.at, tz)} {!running ? "· Preview" : ""}
                                </small>
                              </div>
                              {i === 0 ? (
                                <span className="mini-pill">Next up</span>
                              ) : (
                                <ChevronRight size={16} />
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="panel-foot">
                        <Repeat2 size={15} />
                        {data.settings.mode === "loop"
                          ? "The queue loops after the last eligible video."
                          : "Each video publishes once."}
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-heading">
                        <span className="section-label">Recent activity</span>
                        <button
                          className="text-button"
                          onClick={() => switchTab("history")}
                        >
                          See all
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {!data.jobs.length ? (
                        <Empty icon={History} title="A fresh start">
                          Your publishing activity will appear here once you run
                          your first job.
                        </Empty>
                      ) : (
                        data.jobs.slice(0, 4).map((j) => (
                          <button
                            className="activity-row"
                            key={j.id}
                            onClick={() => setJobDetail(j)}
                          >
                            <span
                              className={`activity-icon ${j.state === "succeeded" ? "success" : ""}`}
                            >
                              {j.state === "succeeded" ? (
                                <Check size={16} />
                              ) : (
                                <Clock size={16} />
                              )}
                            </span>
                            <span>
                              <strong>{j.video_name}</strong>
                              <small>
                                {fmt(j.actual_at ?? j.created_at, tz)}
                              </small>
                            </span>
                            <Status
                              tone={
                                j.state === "succeeded"
                                  ? "teal"
                                  : j.state === "uncertain" ||
                                      j.state === "failed"
                                    ? "red"
                                    : "muted"
                              }
                            >
                              {j.state}
                            </Status>
                          </button>
                        ))
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === "library" && (
                <>
                  <div
                    className={`dropzone ${!data.configuration.uploads ? "disabled" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      upload(e.dataTransfer.files);
                    }}
                  >
                    <span className="upload-icon">
                      <UploadCloud size={26} />
                    </span>
                    <h3>Drop your next great Reels here</h3>
                    <p>
                      MP4 or MOV · Up to 1 GB each · 3 seconds to 15 minutes
                    </p>
                    <Button
                      disabled={uploading || !data.configuration.uploads}
                      onClick={() => input.current?.click()}
                    >
                      <Plus size={16} />
                      Browse files
                    </Button>
                    <small>
                      Originals stay in private cloud storage until you delete
                      them.
                    </small>
                  </div>
                  {progress.length > 0 && (
                    <section className="panel upload-progress">
                      <div className="panel-heading">
                        <strong>
                          {uploading
                            ? "Uploading your videos…"
                            : "Upload results"}
                        </strong>
                        {!uploading && (
                          <button
                            className="icon-button"
                            aria-label="Dismiss upload results"
                            onClick={() => setProgress([])}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                      {progress.map((v, i) => (
                        <div key={i} className="upload-progress-row">
                          <Film size={18} />
                          <div>
                            <strong>{v.name}</strong>
                            <div className="progress-track">
                              <span style={{ width: `${v.percent}%` }} />
                            </div>
                            {v.error && (
                              <small className="form-error">{v.error}</small>
                            )}
                          </div>
                          <span>
                            {v.error ? (
                              "Failed"
                            ) : v.percent === 100 ? (
                              <Check size={18} />
                            ) : (
                              v.percent + "%"
                            )}
                          </span>
                        </div>
                      ))}
                    </section>
                  )}
                  <div className="list-heading">
                    <h2>
                      All videos <span>{videos.length}</span>
                    </h2>
                    <span>
                      {bytes(data.storage.used)} used · Drag to reorder
                    </span>
                  </div>
                  {!videos.length ? (
                    <section className="panel">
                      <Empty title="Make room for your creativity">
                        Your uploaded videos will live here, ready for the next
                        loop.
                      </Empty>
                    </section>
                  ) : (
                    <div className="video-grid">
                      {videos.map((v, i) => (
                        <article
                          className="video-card"
                          draggable
                          key={v.id}
                          onDragStart={() => {
                            drag.current = v.id;
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (drag.current) reorder(drag.current, v.id);
                            drag.current = null;
                          }}
                        >
                          <div className="video-preview">
                            <video
                              controls
                              preload="metadata"
                              src={`/api/videos/${v.id}/preview#t=0.1`}
                              aria-label={`Preview ${v.name}`}
                            />
                            <span className="video-index">
                              {String(i + 1).padStart(2, "0")}
                            </span>
                          </div>
                          <div className="video-card-body">
                            <div className="video-title">
                              <h3>{v.name}</h3>
                              <button
                                className="icon-button"
                                aria-label={`Edit ${v.name}`}
                                onClick={() => setEdit(v)}
                              >
                                <Settings2 size={16} />
                              </button>
                            </div>
                            <p className="video-caption">
                              {v.caption || "Add a caption to tell your story."}
                            </p>
                            <div className="video-meta">
                              <span>
                                {Math.round(v.duration_seconds)}s ·{" "}
                                {bytes(v.size_bytes)}
                              </span>
                              <Status tone={v.enabled ? "teal" : "muted"}>
                                {v.enabled ? "In queue" : "Disabled"}
                              </Status>
                            </div>
                            <footer>
                              <div>
                                <button
                                  className="icon-button"
                                  aria-label={`Move ${v.name} earlier`}
                                  disabled={i === 0 || busy}
                                  onClick={() =>
                                    reorder(v.id, videos[i - 1].id)
                                  }
                                >
                                  <ArrowUp size={15} />
                                </button>
                                <button
                                  className="icon-button"
                                  aria-label={`Move ${v.name} later`}
                                  disabled={i === videos.length - 1 || busy}
                                  onClick={() =>
                                    reorder(v.id, videos[i + 1].id)
                                  }
                                >
                                  <ArrowDown size={15} />
                                </button>
                              </div>
                              <button
                                className="text-button"
                                onClick={() => setTest(v)}
                                disabled={busy || !v.enabled}
                              >
                                <Play size={14} />
                                Test publish
                              </button>
                              <button
                                className="icon-button danger"
                                aria-label={`Delete ${v.name}`}
                                onClick={() => deleteVideo(v)}
                              >
                                <Trash2 size={15} />
                              </button>
                            </footer>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {data.videos
                    .filter((v) => v.status !== "ready")
                    .map((v) => (
                      <div className="pending-row" key={v.id}>
                        <AlertCircle size={18} />
                        <span>
                          {v.name} ·{" "}
                          {v.status === "uploading"
                            ? "Incomplete upload"
                            : "Deletion pending"}{" "}
                          ({bytes(v.size_bytes)})
                        </span>
                        {v.status === "uploading" && (
                          <Button
                            disabled={busy}
                            onClick={() =>
                              run(
                                () => api(`/uploads/${v.id}`, "DELETE"),
                                "Incomplete upload discarded.",
                              )
                            }
                          >
                            Discard upload
                          </Button>
                        )}
                      </div>
                    ))}
                </>
              )}
              {tab === "queue" && (
                <>
                  <div className="queue-summary">
                    <div>
                      <span className="eyebrow">YOUR CONTENT LOOP</span>
                      <h2>{enabled.length} videos. Endless possibilities.</h2>
                      <p>
                        {data.settings.mode === "loop"
                          ? "Original videos are reused in order, with your repeat cooldown respected."
                          : "Each enabled video publishes once; the schedule then pauses."}
                      </p>
                    </div>
                    <span className="queue-symbol">
                      <Repeat2 size={48} />
                    </span>
                  </div>
                  {active && (
                    <div className="setup-banner">
                      <Activity size={18} />
                      <div>
                        <strong>Active job: {active.video_name}</strong>
                        <p>
                          {active.state}
                          {active.error ? ` · ${active.error}` : ""}
                        </p>
                      </div>
                      <Button onClick={() => setJobDetail(active)}>
                        Review job
                      </Button>
                    </div>
                  )}
                  <section className="panel">
                    <div className="panel-heading">
                      <strong>Queue order</strong>
                      <span className="muted">
                        Drag rows or use arrow buttons
                      </span>
                    </div>
                    {!videos.length ? (
                      <Empty icon={Repeat2} title="Build your first loop">
                        Upload videos and enable them to start building your
                        publishing queue.
                      </Empty>
                    ) : (
                      videos.map((v, i) => (
                        <div
                          className={`queue-row ${!v.enabled ? "disabled-row" : ""}`}
                          key={v.id}
                          draggable
                          onDragStart={() => {
                            drag.current = v.id;
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (drag.current) reorder(drag.current, v.id);
                            drag.current = null;
                          }}
                        >
                          <GripVertical size={18} className="muted" />
                          <span className="order">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className="video-glyph">
                            <Film size={20} />
                          </span>
                          <div className="queue-video">
                            <strong>{v.name}</strong>
                            <small>
                              {v.last_published_at
                                ? `Last published ${fmt(v.last_published_at, tz)}`
                                : "Not yet published"}{" "}
                              · {Math.round(v.duration_seconds)}s
                            </small>
                          </div>
                          <Status tone={v.enabled ? "teal" : "muted"}>
                            {v.enabled ? "Enabled" : "Disabled"}
                          </Status>
                          <button
                            className="icon-button"
                            disabled={i === 0 || busy}
                            aria-label={`Move ${v.name} earlier`}
                            onClick={() => reorder(v.id, videos[i - 1].id)}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            className="icon-button"
                            disabled={i === videos.length - 1 || busy}
                            aria-label={`Move ${v.name} later`}
                            onClick={() => reorder(v.id, videos[i + 1].id)}
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Edit ${v.name}`}
                            onClick={() => setEdit(v)}
                          >
                            <Settings2 size={16} />
                          </button>
                        </div>
                      ))
                    )}
                  </section>
                  <section className="panel schedule-preview">
                    <div className="panel-heading">
                      <strong>Expected publications</strong>
                      <span className="muted">
                        {running
                          ? "Schedule active"
                          : "Preview · automation paused"}
                      </span>
                    </div>
                    {data.upcoming.map((v, i) => (
                      <div className="preview-slot" key={i}>
                        <span className="order">{i + 1}</span>
                        <strong>{v.name}</strong>
                        <span>{fmt(v.at, tz)}</span>
                      </div>
                    ))}
                    {!data.upcoming.length && (
                      <p className="muted padded">
                        No eligible videos to preview.
                      </p>
                    )}
                  </section>
                </>
              )}
              {tab === "schedule" && (
                <Scheduling data={data} busy={busy} run={run} tz={tz} />
              )}
              {tab === "history" && (
                <section className="panel history-panel">
                  <div className="panel-heading">
                    <strong>Publication log</strong>
                    <span className="muted">
                      Latest 100 jobs · {data.stats.total ?? 0} total
                    </span>
                  </div>
                  {!data.jobs.length ? (
                    <Empty
                      icon={History}
                      title="Your story starts with a first Reel"
                    >
                      Confirmed publications and failed attempts appear here.
                      Container creation alone is never counted as success.
                    </Empty>
                  ) : (
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Video</th>
                            <th>Scheduled</th>
                            <th>Published</th>
                            <th>Status</th>
                            <th>Attempts</th>
                            <th>Media ID</th>
                            <th>
                              <span className="sr-only">Details</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.jobs.map((j) => (
                            <tr key={j.id}>
                              <td>
                                <strong>{j.video_name}</strong>
                                <small>
                                  {j.manual ? "Manual test" : "Scheduled"}
                                </small>
                              </td>
                              <td>{fmt(j.scheduled_at, tz)}</td>
                              <td>
                                {j.actual_at ? fmt(j.actual_at, tz) : "—"}
                              </td>
                              <td>
                                <Status
                                  tone={
                                    j.state === "succeeded"
                                      ? "teal"
                                      : ["failed", "uncertain"].includes(
                                            j.state,
                                          )
                                        ? "red"
                                        : "muted"
                                  }
                                >
                                  {j.state}
                                </Status>
                              </td>
                              <td>{j.attempts}</td>
                              <td className="mono">{j.media_id ?? "—"}</td>
                              <td>
                                <button
                                  className="icon-button"
                                  aria-label={`Job details for ${j.video_name}`}
                                  onClick={() => setJobDetail(j)}
                                >
                                  <ArrowUpRight size={17} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <Repeat2 size={14} />
              ReelLoop · Your content, on repeat.
            </span>
            <span>
              <LockKeyhole size={12} /> Private workspace
            </span>
          </footer>
        </main>
      </div>
      {edit && (
        <EditVideo
          video={edit}
          onClose={() => setEdit(null)}
          onSave={(v) =>
            run(async () => {
              await api(`/videos/${edit.id}`, "PATCH", v);
              setEdit(null);
            }, "Video details saved. Active jobs retain their original caption.")
          }
          busy={busy}
        />
      )}
      {test && (
        <TestPublish
          video={test}
          disabled={busy || running || !!active}
          onClose={() => setTest(null)}
          onConfirm={() =>
            run(async () => {
              await api("/publish/test", "POST", {
                video_id: test.id,
                confirmation: "PUBLISH ONE REEL",
              });
              setTest(null);
              setTab("history");
            }, "Manual test queued. The cloud scheduler will process it on its next tick.")
          }
        />
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p>{confirm.text}</p>
          <div className="modal-actions">
            <Button onClick={() => setConfirm(null)}>Cancel</Button>
            <Button
              variant="danger-button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await confirm.action();
                  setConfirm(null);
                }, "Operation completed.")
              }
            >
              Confirm
            </Button>
          </div>
        </Modal>
      )}
      {jobDetail && (
        <JobDetails
          job={data?.jobs.find((j) => j.id === jobDetail.id) ?? jobDetail}
          tz={tz}
          onClose={() => setJobDetail(null)}
          run={run}
          busy={busy}
        />
      )}
    </div>
  );
}
