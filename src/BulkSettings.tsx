import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Layers, Save, Sparkles } from "lucide-react";
import { api, type Dashboard } from "./api";
import { Button, Modal } from "./components";
import { coverPreview, uploadCover, type PublicCover } from "./covers";

export function BulkSettings({
  data,
  selected,
  onRefresh,
}: {
  data: Dashboard;
  selected: string[];
  onRefresh: () => Promise<void>;
}) {
  const [caption, setCaption] = useState(data.settings.default_caption);
  const [replacement, setReplacement] = useState("");
  const [covers, setCovers] = useState<PublicCover[]>([]);
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [overwrite, setOverwrite] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    label: string;
    action: () => Promise<unknown>;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(
    () => setCaption(data.settings.default_caption),
    [data.settings.default_caption],
  );
  async function refreshCovers() {
    setCovers(await api<PublicCover[]>("/covers"));
  }
  useEffect(() => {
    refreshCovers().catch(() =>
      setNotice("Could not load cover images. Refresh to retry."),
    );
  }, [data.settings.default_cover_id]);
  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      await onRefresh();
      await refreshCovers();
      setNotice(success);
    } catch (e) {
      setNotice((e as Error).message);
      await refreshCovers().catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  function apply(
    field: "caption" | "cover",
    all: boolean,
    replace = false,
    reset = false,
  ) {
    const payload = {
      ids: all ? undefined : selected,
      [field]: replace ? "replace" : "default",
      text: replace ? replacement : undefined,
      overwrite: overwrite || reset,
      confirm: true,
    };
    const action = () => api("/bulk/apply", "POST", payload);
    const label = `${replace ? "Replace" : reset ? "Reset" : "Apply saved default"} ${field} for ${all ? "all videos" : `${selected.length} selected videos`}? ${overwrite || reset || replace ? "Existing individual overrides will be overwritten." : "Individual overrides will be preserved."} Active jobs keep their original settings.`;
    setConfirmation({ label, action });
  }
  const ready = covers.filter((c) => c.status === "ready");
  return (
    <section className="panel bulk-settings">
      <div className="bulk-heading">
        <div>
          <span className="eyebrow">
            <Layers size={14} /> CREATE ONCE, REUSE EVERY LOOP
          </span>
          <h2>Bulk Reel Settings</h2>
          <p>
            Set your signature caption and cover. Apply them across your
            library.
          </p>
        </div>
        <span className="status teal">
          <Check size={14} /> Saved in your workspace
        </span>
      </div>
      <div className="bulk-columns">
        <div className="bulk-cover">
          <h3>Default Reel Cover</h3>
          <div className="cover-compose">
            <div className="cover-art">
              {data.settings.default_cover_id ? (
                <img
                  src={coverPreview(data.settings.default_cover_id)}
                  alt="Default Reel cover"
                />
              ) : (
                <div>
                  <ImagePlus size={32} />
                  <span>
                    Your cover
                    <br />
                    1080 × 1920
                  </span>
                </div>
              )}
            </div>
            <div className="cover-controls">
              <p>One shared image, every selected Reel.</p>
              <Button disabled={busy} onClick={() => input.current?.click()}>
                <ImagePlus size={16} />
                {data.settings.default_cover_id
                  ? "Replace image"
                  : "Upload image"}
              </Button>
              <input
                ref={input}
                type="file"
                accept="image/jpeg,image/png"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      const id = await uploadCover(file);
                      await api("/bulk/defaults", "PATCH", { cover_id: id });
                    }, "Default cover saved. Future uploads will use it.");
                  e.target.value = "";
                }}
              />
              <small>
                JPG or PNG up to 8 MB. Converted privately in your browser to
                JPEG. 9:16 recommended.
              </small>
              <label>
                Choose a saved cover
                <select
                  aria-label="Default cover"
                  value={data.settings.default_cover_id ?? ""}
                  disabled={busy}
                  onChange={(e) =>
                    void run(
                      () =>
                        api("/bulk/defaults", "PATCH", {
                          cover_id: e.target.value || null,
                        }),
                      "Default cover saved.",
                    )
                  }
                >
                  <option value="">Video frame / no custom cover</option>
                  {ready.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="bulk-actions">
            <Button disabled={busy} onClick={() => apply("cover", true)}>
              Apply cover to all
            </Button>
            <Button
              disabled={busy || !selected.length}
              onClick={() => apply("cover", false)}
            >
              Apply to selected ({selected.length})
            </Button>
            <Button
              disabled={busy || !data.settings.default_cover_id}
              onClick={() =>
                void run(
                  () => api("/bulk/defaults", "PATCH", { cover_id: null }),
                  "Default cleared. Existing video and job covers are preserved.",
                )
              }
            >
              Clear default
            </Button>
          </div>
        </div>
        <div className="bulk-caption">
          <h3>Default Instagram Caption</h3>
          <label className="sr-only" htmlFor="default-caption">
            Default caption, emojis and hashtags
          </label>
          <textarea
            id="default-caption"
            rows={7}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder={"Tell your story ✨\n\n#reels #yourstory"}
          />
          <div className="caption-count">
            <span>Emojis + hashtags together</span>
            <span>{[...caption].length.toLocaleString()}/2,200</span>
          </div>
          <div className="bulk-actions">
            <Button
              variant="primary"
              disabled={busy || [...caption].length > 2200}
              onClick={() =>
                void run(
                  () => api("/bulk/defaults", "PATCH", { caption }),
                  "Default caption saved. Future uploads will use it.",
                )
              }
            >
              <Save size={15} />
              Save default
            </Button>
            <Button disabled={busy} onClick={() => apply("caption", true)}>
              Apply saved to all
            </Button>
            <Button
              disabled={busy || !selected.length}
              onClick={() => apply("caption", false)}
            >
              Apply saved to selected
            </Button>
          </div>
          <small>
            Saving changes the default for future uploads. Use Apply to update
            existing videos.
          </small>
        </div>
      </div>
      <div className="bulk-footer">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
          />
          Overwrite individual overrides when applying defaults
        </label>
        <span>
          <Sparkles size={14} /> Processing jobs keep their snapshots
        </span>
      </div>
      <details className="bulk-advanced">
        <summary>Selected videos · replace or reset captions</summary>
        <label>
          Replacement caption
          <textarea
            rows={3}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="A new caption for the selected videos"
          />
        </label>
        <div className="bulk-actions">
          <Button
            disabled={busy || !selected.length}
            onClick={() => apply("caption", false, true)}
          >
            Replace selected captions
          </Button>
          <Button
            disabled={busy || !selected.length}
            onClick={() => apply("caption", false, false, true)}
          >
            Reset selected to default
          </Button>
          <Button
            disabled={busy || !selected.length}
            onClick={() => apply("cover", false, false, true)}
          >
            Reset selected covers
          </Button>
        </div>
      </details>
      <details className="bulk-advanced">
        <summary>Manage shared images ({covers.length})</summary>
        <p>
          Referenced covers are protected from deletion, including covers
          retained by publishing history.
        </p>
        <div className="saved-covers">
          {covers.map((c) => (
            <div key={c.id}>
              {c.status === "ready" ? (
                <img src={coverPreview(c.id)} alt={c.name} />
              ) : (
                <ImagePlus />
              )}
              <strong>{c.name}</strong>
              <small>{c.status}</small>
              {c.status === "uploading" && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => api(`/covers/${c.id}/complete`, "POST", {}),
                      "Cover verified. Choose it from saved covers.",
                    )
                  }
                >
                  Retry
                </Button>
              )}
              <Button
                disabled={busy}
                onClick={() =>
                  setConfirmation({
                    label: `Delete ${c.name}? Only unreferenced images can be removed.`,
                    action: () => api(`/covers/${c.id}`, "DELETE"),
                  })
                }
              >
                Delete unused
              </Button>
            </div>
          ))}
        </div>
      </details>
      {notice && (
        <p className="bulk-notice" role="status">
          {notice}
        </p>
      )}
      {confirmation && (
        <Modal
          title="Confirm bulk change"
          onClose={() => setConfirmation(null)}
        >
          <p>{confirmation.label}</p>
          <div className="modal-actions">
            <Button disabled={busy} onClick={() => setConfirmation(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await confirmation.action();
                  setConfirmation(null);
                }, "Bulk settings applied.")
              }
            >
              Confirm changes
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function VideoCoverEditor({
  id,
  coverId,
  defaultCoverId,
  offset,
  duration,
  onSaved,
}: {
  id: string;
  coverId: string | null;
  defaultCoverId: string | null;
  offset: number;
  duration: number;
  onSaved: () => Promise<void>;
}) {
  const [covers, setCovers] = useState<PublicCover[]>([]),
    [chosen, setChosen] = useState(coverId ?? ""),
    [seconds, setSeconds] = useState(offset / 1000);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api<PublicCover[]>("/covers")
      .then(setCovers)
      .catch(() => setError("Could not load saved covers."));
  }, []);
  async function save(mode: "default" | "override", file?: File) {
    setBusy(true);
    setError("");
    try {
      const value = file ? await uploadCover(file) : chosen;
      await api(`/videos/${id}/cover`, "PATCH", {
        mode,
        cover_id: value || null,
        thumb_offset_ms: Math.round(seconds * 1000),
      });
      await onSaved();
      if (mode === "default") {
        setChosen(defaultCoverId ?? "");
        setSeconds(0);
      }
      setError("Cover saved. Active jobs retain their original cover.");
      if (file) {
        setChosen(value);
        setCovers(await api<PublicCover[]>("/covers"));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="video-cover-editor">
      <h3>Individual Reel cover</h3>
      {chosen && <img src={coverPreview(chosen)} alt="Selected Reel cover" />}
      <label>
        Saved cover
        <select value={chosen} onChange={(e) => setChosen(e.target.value)}>
          <option value="">Use a frame from this video</option>
          {covers
            .filter((c) => c.status === "ready")
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </select>
      </label>
      {!chosen && (
        <label>
          Frame time (seconds)
          <input
            type="number"
            min={0}
            max={Math.max(0, duration - 0.001)}
            step="0.1"
            value={seconds}
            onChange={(e) => setSeconds(Number(e.target.value))}
          />
        </label>
      )}
      <div className="bulk-actions">
        <Button disabled={busy} onClick={() => void save("override")}>
          Save individual cover
        </Button>
        <Button disabled={busy} onClick={() => input.current?.click()}>
          Upload cover
        </Button>
        <Button disabled={busy} onClick={() => void save("default")}>
          Reset to global cover
        </Button>
      </div>
      <input
        hidden
        ref={input}
        type="file"
        accept="image/jpeg,image/png"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void save("override", file);
          e.target.value = "";
        }}
      />
      {error && <p role="status">{error}</p>}
    </div>
  );
}
