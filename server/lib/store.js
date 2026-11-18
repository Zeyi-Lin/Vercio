import fs from "node:fs";
import path from "node:path";

const DEFAULT_STATE = () => ({
  version: 1,
  settings: { userName: "", defaultAuthor: "" },
  projects: [],
  deployments: [],
  notes: [],
  comments: [],
});

export class Store {
  constructor(file) {
    this.file = file;
    this.state = DEFAULT_STATE();
    this.dirty = false;
    this.timer = null;
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw);
      this.state = { ...DEFAULT_STATE(), ...parsed };
      this.state.settings = { ...DEFAULT_STATE().settings, ...(parsed.settings || {}) };
      for (const key of ["projects", "deployments", "notes", "comments"]) {
        if (!Array.isArray(this.state[key])) this.state[key] = [];
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("[vercio] could not read database, starting fresh:", error.message);
        try {
          fs.copyFileSync(this.file, this.file + ".corrupt-" + Date.now());
        } catch {}
      }
      this.state = DEFAULT_STATE();
    }
  }

  get() {
    return this.state;
  }

  markDirty() {
    this.dirty = true;
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.save();
      }, 80);
      if (typeof this.timer.unref === "function") this.timer.unref();
    }
  }

  save() {
    if (!this.dirty) return;
    this.dirty = false;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    const payload = JSON.stringify(this.state, null, 2);
    fs.writeFileSync(tmp, payload);
    fs.renameSync(tmp, this.file);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.save();
  }
}
