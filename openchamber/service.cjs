"use strict";

// src/gui/service.ts
var import_node_http2 = require("node:http");
var import_node_path6 = require("node:path");
var import_node_os2 = require("node:os");

// src/gui/bridge.ts
var import_node_fs2 = require("node:fs");
var import_node_path3 = require("node:path");

// src/storage/backend-registry.ts
var import_node_path = require("node:path");
function projectKey(directory) {
  const path = (0, import_node_path.resolve)(directory);
  return process.platform === "win32" ? path.toLowerCase() : path;
}
var BackendRegistry = class _BackendRegistry {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS backend_descriptors (path_key TEXT PRIMARY KEY,directory TEXT NOT NULL,path TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS backend_descriptors_project ON backend_descriptors(directory,path_key);`);
  }
  db;
  static candidateLimit = 8;
  register(directory, descriptorPath) {
    if (!(0, import_node_path.isAbsolute)(directory) || !(0, import_node_path.isAbsolute)(descriptorPath)) throw new Error("Backend registration requires absolute project and descriptor paths");
    this.db.prepare("INSERT INTO backend_descriptors VALUES(?,?,?) ON CONFLICT(path_key) DO UPDATE SET directory=excluded.directory,path=excluded.path").run(projectKey(descriptorPath), projectKey(directory), (0, import_node_path.resolve)(descriptorPath));
  }
  publish(directory, descriptorPath, write, restore) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      write();
      this.register(directory, descriptorPath);
      this.db.exec("COMMIT");
    } catch (error) {
      try {
        restore();
      } finally {
        this.db.exec("ROLLBACK");
      }
      throw error;
    }
  }
  paths(directory) {
    return this.db.prepare("SELECT path FROM backend_descriptors WHERE directory=? ORDER BY path_key LIMIT ?").all(projectKey(directory), _BackendRegistry.candidateLimit + 1).map((row) => row.path);
  }
};

// src/reports/descriptor.ts
var import_node_fs = require("node:fs");
var import_node_path2 = require("node:path");
var import_node_http = require("node:http");
var DescriptorFiles = class {
  static bytes(path) {
    let fd;
    try {
      fd = (0, import_node_fs.openSync)(path, "r");
    } catch (error) {
      if (error.code === "ENOENT") return void 0;
      throw error;
    }
    try {
      if (!(0, import_node_fs.fstatSync)(fd).isFile()) throw new Error("Not a descriptor file");
      const buffer = Buffer.alloc(16385);
      let size = 0, count;
      while (size < buffer.length && (count = (0, import_node_fs.readSync)(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
      if (size > 16384) throw new Error("Backend descriptor exceeds 16 KiB");
      return buffer.subarray(0, size);
    } finally {
      (0, import_node_fs.closeSync)(fd);
    }
  }
  static validate(value, directory) {
    const d = value;
    if (!d || d.version !== 1 || typeof d.url !== "string" || typeof d.token !== "string" || d.token.length < 32 || typeof d.instance !== "string" || !d.instance || typeof d.directory !== "string" || !(0, import_node_path2.isAbsolute)(d.directory)) throw new Error("Invalid backend descriptor");
    const url = new URL(d.url);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("Backend must be an explicit loopback origin");
    if (projectKey(directory) !== projectKey(d.directory)) throw new Error("Backend directory does not match this project");
    return { version: 1, url: url.origin, token: d.token, instance: d.instance, directory: d.directory };
  }
  static async publish(directory, selectedPath, descriptor, registry) {
    const path = (0, import_node_path2.resolve)(selectedPath), previous = this.bytes(path);
    if (previous) await this.checkRetired(this.validate(JSON.parse(previous.toString("utf8")), directory));
    (0, import_node_fs.mkdirSync)((0, import_node_path2.dirname)(path), { recursive: true, mode: 448 });
    const next = Buffer.from(JSON.stringify(descriptor));
    const write = () => {
      const current = this.bytes(path);
      if (previous ? !current?.equals(previous) : current !== void 0) throw new Error("Backend descriptor ownership changed during publication; retry initialization with a separate data directory if another backend is active.");
      (0, import_node_fs.writeFileSync)(path, next, { mode: 384 });
    };
    const restore = () => {
      if (previous && this.bytes(path)?.equals(next)) (0, import_node_fs.writeFileSync)(path, previous, { mode: 384 });
    };
    if (registry?.publish) registry.publish(directory, path, write, restore);
    else {
      try {
        write();
        registry?.register(directory, path);
      } catch (error) {
        restore();
        throw error;
      }
    }
  }
  static async checkRetired(previous) {
    let health;
    try {
      health = await this.health(previous);
    } catch (error) {
      const codes = [error?.code, error?.cause?.code];
      if (codes.some((code) => code === "ECONNREFUSED" || code === "ConnectionRefused")) return;
      throw new Error("Cannot establish that the existing backend descriptor is retired; publication was not changed.", { cause: error });
    }
    if (health.status === 401 || health.status === 409) return;
    if (health.instance === previous.instance && typeof health.directory === "string" && projectKey(health.directory) === projectKey(previous.directory)) throw new Error("Backend descriptor is already owned by an active backend. Use a separate data directory for another host instance.");
  }
  static health(previous) {
    return new Promise((resolve4, reject) => {
      let completed = false;
      const finish = (error, value) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve4(value);
      };
      const request = (0, import_node_http.request)(previous.url + "/health", { agent: false, headers: { Authorization: `Bearer ${previous.token}`, "X-Context-Monitor-Instance": previous.instance } }, (response) => {
        const status = response.statusCode ?? 0;
        response.once("error", (error) => finish(error));
        if (status === 401 || status === 409) {
          finish(void 0, { status });
          response.destroy();
          return;
        }
        const chunks = [];
        let size = 0;
        response.on("data", (part) => {
          const chunk = Buffer.from(part);
          size += chunk.length;
          if (size > 16384) request.destroy(new Error("Backend ownership response exceeds 16 KiB"));
          else chunks.push(chunk);
        });
        response.once("end", () => {
          try {
            const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            finish(void 0, { status, instance: value?.instance, directory: value?.directory });
          } catch (error) {
            finish(error);
          }
        });
      });
      const timer = setTimeout(() => request.destroy(new Error("Backend ownership check timed out")), 2500);
      request.once("error", (error) => finish(error));
      request.end();
    });
  }
};

// src/gui/bridge.ts
var Bridge = class {
  constructor(path, registry) {
    this.path = path;
    this.registry = registry;
    const saved = (0, import_node_fs2.existsSync)(path) ? JSON.parse((0, import_node_fs2.readFileSync)(path, "utf8")) : {};
    for (const [directory, pairing] of Object.entries(saved)) {
      const key = this.projectKey(directory);
      if (!this.pairs[key]?.descriptorPath || pairing.descriptorPath) this.pairs[key] = pairing;
    }
  }
  path;
  registry;
  pairs = /* @__PURE__ */ Object.create(null);
  async pair(directory, path) {
    const d = this.readDescriptor(directory, path);
    await this.verify(d, directory);
    this.pairs[this.projectKey(directory)] = { ...d, descriptorPath: path };
    (0, import_node_fs2.mkdirSync)((0, import_node_path3.dirname)(this.path), { recursive: true, mode: 448 });
    (0, import_node_fs2.writeFileSync)(this.path, JSON.stringify(this.pairs), { mode: 384 });
  }
  projectKey(directory) {
    return projectKey(directory);
  }
  readDescriptor(directory, path) {
    if (typeof path !== "string" || !(0, import_node_path3.isAbsolute)(path)) throw new Error("Choose an absolute backend descriptor path");
    let value;
    try {
      const bytes = DescriptorFiles.bytes(path);
      if (!bytes) throw new Error("Descriptor is unavailable");
      value = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new Error("Backend descriptor is unavailable, malformed or exceeds 16 KiB. Start the backend and check the selected descriptor path.");
    }
    return this.validate(value, directory);
  }
  validate(value, directory) {
    return DescriptorFiles.validate(value, directory);
  }
  async verify(d, directory) {
    const result = await this.call(d, "/health", "GET", void 0, 2500);
    if (!result || result.instance !== d.instance || typeof result.directory !== "string" || this.projectKey(result.directory) !== this.projectKey(directory)) throw new Error("Backend identity mismatch");
  }
  async request(directory, path, method, data) {
    const pairing = this.pairs[this.projectKey(directory)];
    if (!pairing) {
      if (!this.registry) throw new Error("Pair this project with its backend descriptor first");
      return this.call(await this.discover(directory), path, method, data);
    }
    let descriptor;
    try {
      descriptor = pairing.descriptorPath !== void 0 ? this.readDescriptor(directory, pairing.descriptorPath) : this.validate(pairing, directory);
      await this.verify(descriptor, directory);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Backend validation failed";
      throw new Error(pairing.descriptorPath !== void 0 ? detail : `${detail} Legacy pairing: pair this project again with its current backend descriptor.`, { cause: error });
    }
    return this.call(descriptor, path, method, data);
  }
  async discover(directory) {
    const paths = this.registry.paths(directory);
    if (paths.length > BackendRegistry.candidateLimit) throw new Error("Too many registered backends for this project. Select a manual backend descriptor.");
    const candidates = await Promise.all(paths.map(async (path) => {
      try {
        const descriptor = this.readDescriptor(directory, path);
        await this.verify(descriptor, directory);
        return descriptor;
      } catch {
        return void 0;
      }
    }));
    const healthy = candidates.filter((descriptor) => descriptor !== void 0);
    if (healthy.length > 1) throw new Error("Multiple healthy backends are registered for this project. Select a manual backend descriptor.");
    if (!healthy.length) throw new Error("No healthy registered backend is available for this project. Start or reload its Context Churn Monitor backend, or select a manual descriptor.");
    return healthy[0];
  }
  async call(d, path, method, data, timeout = 18e3) {
    const url = new URL(path, d.url);
    if (!path.startsWith("/") || url.origin !== d.url || !["GET", "POST"].includes(method)) throw new Error("Invalid backend route");
    const body2 = data === void 0 ? void 0 : JSON.stringify(data);
    let response, result;
    try {
      response = await fetch(url, { method, headers: { Authorization: `Bearer ${d.token}`, "X-Context-Monitor-Instance": d.instance, "Content-Type": "application/json" }, body: body2, redirect: "error", signal: AbortSignal.timeout(timeout) });
      result = await response.json();
    } catch (error) {
      throw new Error(method === "POST" ? "Backend connection lost; outcome unknown. Request was not retried. Check the result before preparing a new action." : "Backend unavailable. Start the backend; monitoring will reconnect through the selected descriptor on its next poll.", { cause: error });
    }
    if (!response.ok) throw new Error(result.error ?? "Backend request failed");
    return result;
  }
};

// src/reports/http.ts
var import_node_crypto = require("node:crypto");
function authorized(request, token2) {
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token2}`);
  return actual.length === expected.length && (0, import_node_crypto.timingSafeEqual)(actual, expected);
}
async function body(request, limit = 128e3) {
  const parts = [];
  let size = 0;
  for await (const part of request) {
    size += part.length;
    if (size > limit) throw new Error("Request exceeds size limit");
    parts.push(Buffer.from(part));
  }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {};
}
function respond(response, status, data) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(data));
}

// src/storage/alerts.ts
var import_node_crypto2 = require("node:crypto");
var import_node_os = require("node:os");
var import_node_path5 = require("node:path");

// src/core/alerts.ts
var emptyEma = () => ({ growth: null, compactions: null, growthSamples: 0, compactionSamples: 0 });
var guards = () => ({ growth: { armed: true, lastTurn: -1e6, below: 0, recoveredTurn: 0 }, compactions: { armed: true, lastTurn: -1e6, below: 0, recoveredTurn: 0 } });
var copyGuards = (value) => ({ growth: { ...value.growth }, compactions: { ...value.compactions } });
var AlertPolicy = class {
  constructor(settings, previous) {
    this.settings = settings;
    this.state = previous?.minimum === settings.minContextWindow ? previous : { minimum: settings.minContextWindow, count: 0, ema: emptyEma(), guards: guards(), skipTurn: previous?.current?.id };
  }
  settings;
  state;
  accept(event, metrics2) {
    const s = this.state, source = metrics2.turn, c = this.settings;
    if (!source) return [];
    if (s.current?.id !== source.id) {
      if (s.current && !s.current.ended) this.complete();
      s.current = { id: source.id, number: source.number, growth: source.growth, compactions: source.compactions, quality: source.quality, gaps: [], eligible: s.skipTurn !== source.id, hasModel: c.minContextWindow === 0, ended: false, before: { ...s.ema }, countBefore: s.count };
    }
    const t = s.current;
    if (t.ended && (source.ended === void 0 || ["observe", "gap", "compact", "evidence"].includes(event.type))) this.reopen();
    if (event.type === "step") {
      t.hasModel = true;
      t.model = event.model;
      t.capacity = event.capacity;
      t.eligible &&= c.minContextWindow === 0 || typeof event.capacity === "number" && Number.isFinite(event.capacity) && event.capacity >= c.minContextWindow;
    }
    t.growth = source.growth;
    t.compactions = source.compactions;
    t.quality = source.quality;
    if (source.ended !== void 0 && !t.ended) this.complete();
    if (!t.eligible || !t.hasModel) {
      t.hits = [];
      return [];
    }
    const hits = this.thresholds();
    t.hits ??= [];
    for (const hit of hits) {
      if (hit.kind === "ema" && !t.ended) continue;
      if (!t.hits.some((old) => old.metric === hit.metric && old.kind === hit.kind)) t.hits.push(hit);
    }
    if (!c.warnings) return [];
    const result = [], index = t.countBefore + 1;
    for (const metric of ["growth", "compactions"]) {
      const guard = s.guards[metric];
      if (!guard.armed || index - guard.lastTurn < c.cooldownTurns) continue;
      const hit = hits.find((hit2) => hit2.metric === metric);
      if (!hit) continue;
      result.push({ ...hit, id: `${t.id}:${metric}`, turn: t.number, model: t.model, capacity: t.capacity, at: event.at });
      guard.armed = false;
      guard.lastTurn = index;
      guard.below = 0;
    }
    return result;
  }
  /** Evaluate once for both marks and delivery; only delivery observes warnings/cooldown/rearm guards. */
  thresholds() {
    const s = this.state, t = s.current, c = this.settings, hits = [];
    for (const metric of ["growth", "compactions"]) {
      const live = t[metric], average = s.ema[metric];
      const liveThreshold = metric === "growth" ? c.liveGrowth : c.liveCompactions;
      const threshold = metric === "growth" ? c.growthThreshold : c.compactionThreshold;
      const samples = metric === "growth" ? s.ema.growthSamples : s.ema.compactionSamples;
      if (live !== null && live >= liveThreshold) hits.push({ metric, kind: "live", value: live, threshold: liveThreshold });
      if (samples >= c.minSamples && average !== null && average >= threshold) hits.push({ metric, kind: "ema", value: average, threshold });
    }
    return hits;
  }
  reopen() {
    const s = this.state, t = s.current;
    s.ema = { ...t.before };
    s.count = t.countBefore;
    t.ended = false;
    if (t.recoveryBefore) for (const metric of ["growth", "compactions"]) {
      const before = t.recoveryBefore[metric], current = s.guards[metric];
      if (current.lastTurn === before.lastTurn) s.guards[metric] = { ...before };
      else current.recoveredTurn = before.recoveredTurn;
    }
  }
  complete() {
    const s = this.state, t = s.current, c = this.settings;
    t.ended = true;
    if (!t.eligible || !t.hasModel) return;
    const index = t.countBefore + 1, alpha = 2 / (c.span + 1);
    s.ema = { ...t.before };
    s.count = index;
    t.recoveryBefore = copyGuards(s.guards);
    for (const metric of ["growth", "compactions"]) {
      const value = t[metric], samples = metric === "growth" ? "growthSamples" : "compactionSamples";
      if (value !== null) {
        s.ema[metric] = s.ema[metric] === null ? value : value * alpha + s.ema[metric] * (1 - alpha);
        s.ema[samples]++;
      }
      const guard = s.guards[metric];
      if (guard.recoveredTurn === index) continue;
      guard.recoveredTurn = index;
      const reliable = metric === "compactions" || t.quality === "reported" || t.quality === "estimated";
      const threshold = metric === "growth" ? c.growthThreshold : c.compactionThreshold;
      guard.below = reliable && s.ema[metric] !== null && s.ema[metric] < threshold * c.rearmRatio ? guard.below + 1 : 0;
      if (guard.below >= c.rearmTurns) guard.armed = true;
    }
  }
};

// src/core/monitor.ts
var defaults = {
  span: 5,
  minSamples: 3,
  growthThreshold: 40,
  compactionThreshold: 0.3,
  liveGrowth: 80,
  liveCompactions: 2,
  minContextWindow: 32e3,
  cooldownTurns: 5,
  rearmTurns: 2,
  rearmRatio: 0.8,
  warnings: true,
  lookback: 5,
  inputBudget: 12e3,
  outputBudget: 3e3
};
function configure(input = {}) {
  const config = { ...defaults, ...input };
  for (const [key, value] of Object.entries(config)) {
    if (key === "warnings") {
      if (typeof value !== "boolean") throw new Error("warnings must be boolean");
    } else if (typeof value !== "number" || !Number.isFinite(value) || (key === "minContextWindow" ? !Number.isSafeInteger(value) || value < 0 : value <= 0)) {
      throw new Error(`${key} must be a positive finite number`);
    }
  }
  for (const key of ["span", "minSamples", "cooldownTurns", "rearmTurns", "lookback", "inputBudget", "outputBudget"]) {
    if (!Number.isInteger(config[key])) throw new Error(`${key} must be an integer`);
  }
  if (config.rearmRatio >= 1) throw new Error("rearmRatio must be below 1");
  return config;
}
var emptyEma2 = () => ({ growth: null, compactions: null, growthSamples: 0, compactionSamples: 0 });
var metrics = () => ({ growth: null, compactions: 0, quality: "unavailable", gaps: [], provenance: { estimated: false, methods: [] } });
var Monitor = class {
  config;
  state;
  constructor(config = {}, state) {
    this.config = configure(config);
    this.state = state ?? {
      version: 1,
      turn: null,
      step: null,
      baseline: null,
      rebase: false,
      ema: emptyEma2(),
      revision: 0,
      alerts: [],
      guards: {
        growth: { armed: true, lastTurn: -1e6, below: 0, recoveredTurn: 0 },
        compactions: { armed: true, lastTurn: -1e6, below: 0, recoveredTurn: 0 }
      }
    };
  }
  accept(event) {
    const s = this.state;
    s.revision++;
    const completedAt = ["observe", "gap", "compact", "evidence"].includes(event.type) ? s.turn?.ended : void 0;
    if (event.type === "compact" && s.turn?.checkpoints.includes(event.checkpointId)) return;
    if (completedAt !== void 0) this.reopen();
    if (event.type === "turn") {
      if (s.turn?.id === event.turnId) return;
      this.complete(event.at);
      s.turn = { ...metrics(), id: event.turnId, number: (s.turn?.number ?? 0) + 1, at: event.at, steps: 0, manual: 0, automatic: 0, checkpoints: [], interrupted: false, emaBefore: { ...s.ema } };
      s.step = null;
    } else if (event.type === "step") {
      if (!s.turn || s.step?.id === event.stepId) return;
      this.reopen();
      s.step = { ...metrics(), id: event.stepId, turnId: s.turn.id, turnNumber: s.turn.number, number: ++s.turn.steps, at: event.at, model: event.model, capacity: event.capacity, evidence: [] };
    } else if (event.type === "observe") {
      this.observe(event);
    } else if (event.type === "gap") {
      this.gap(event.reason);
    } else if (event.type === "compact") {
      if (!s.turn || s.turn.checkpoints.includes(event.checkpointId)) return;
      this.reopen();
      s.turn.checkpoints.push(event.checkpointId);
      s.turn.compactions++;
      if (s.step) s.step.compactions++;
      if (event.trigger === "auto") s.turn.automatic++;
      if (event.trigger === "manual") s.turn.manual++;
      if (!event.beforeKnown) this.gap("Pre-compaction occupancy unavailable; growth is a lower bound.");
      s.rebase = true;
    } else if (event.type === "complete") {
      if (s.turn) s.turn.interrupted ||= event.interrupted ?? false;
      this.complete(event.at);
    } else if (event.type === "attempt" && s.step) {
      s.step.attempt = event.attempt;
    } else if (event.type === "evidence" && s.step) {
      if (s.step.evidence.length < 32) s.step.evidence.push({ ...event.evidence, label: event.evidence.label.slice(0, 200), excerpt: event.evidence.excerpt?.slice(0, 1e3) });
      else this.gap("Additional tool evidence omitted from compact step metadata.");
    }
    if (completedAt !== void 0) this.complete(completedAt);
    const policy = new AlertPolicy(this.config, s.alerting);
    s.alerts = [...s.alerts, ...policy.accept(event, s)].slice(-20);
    s.alerting = policy.state;
    s.guards = { growth: { ...policy.state.guards.growth }, compactions: { ...policy.state.guards.compactions } };
  }
  reopen() {
    const t = this.state.turn;
    if (t?.ended !== void 0) {
      this.state.ema = { ...t.emaBefore };
      delete t.ended;
    }
  }
  gap(reason) {
    for (const record of [this.state.turn, this.state.step]) {
      if (!record) continue;
      if (record.gaps.length < 32 && !record.gaps.includes(reason)) record.gaps.push(reason);
      record.quality = record.growth === null ? "unavailable" : "partial";
    }
  }
  observe(observation) {
    const s = this.state;
    if (![observation.tokens, observation.capacity].every(Number.isFinite) || observation.tokens < 0 || observation.capacity <= 0) {
      this.gap("Invalid occupancy or context capacity.");
      return;
    }
    const previous = s.baseline;
    const comparable = previous && previous.capacity === observation.capacity && previous.model === observation.model && previous.method === observation.method;
    if (s.turn) {
      for (const record of [s.turn, s.step]) {
        if (!record) continue;
        const provenance = record.provenance ??= { estimated: record.quality !== "reported", methods: ["legacy-unspecified"] };
        provenance.estimated ||= observation.quality === "estimated" || comparable && previous.quality === "estimated" || false;
        if (provenance.methods.length < 32 && !provenance.methods.includes(observation.method)) provenance.methods.push(observation.method);
      }
      if (!s.rebase && comparable) {
        const growth = Math.max(0, observation.tokens - previous.tokens) / observation.capacity * 100;
        for (const record of [s.turn, s.step]) {
          if (!record) continue;
          record.growth = (record.growth ?? 0) + growth;
          record.quality = record.gaps.length ? "partial" : record.provenance?.estimated ? "estimated" : "reported";
        }
      } else if (!s.rebase) {
        this.gap(previous ? "Model, capacity or measurement method changed; baseline reset." : "First occupancy establishes baseline; earlier growth is unknown.");
      }
    }
    s.baseline = { tokens: observation.tokens, capacity: observation.capacity, model: observation.model, method: observation.method, quality: observation.quality };
    s.rebase = false;
  }
  complete(at) {
    const s = this.state, t = s.turn;
    if (!t || t.ended !== void 0) return;
    t.ended = at;
    const alpha = 2 / (this.config.span + 1);
    const next = (before, value) => before === null ? value : value * alpha + before * (1 - alpha);
    s.ema = { ...t.emaBefore };
    if (t.growth !== null) {
      s.ema.growth = next(s.ema.growth, t.growth);
      s.ema.growthSamples++;
    }
    s.ema.compactions = next(s.ema.compactions, t.compactions);
    s.ema.compactionSamples++;
  }
};

// src/storage/database.ts
var import_node_fs3 = require("node:fs");
var import_node_path4 = require("node:path");
async function openDatabase(path, readOnly = false) {
  if (path !== ":memory:" && !readOnly) (0, import_node_fs3.mkdirSync)((0, import_node_path4.dirname)(path), { recursive: true, mode: 448 });
  const name = typeof globalThis.Bun === "object" ? "bun:sqlite" : "node:sqlite";
  const sqlite = await import(name);
  return name === "bun:sqlite" ? new sqlite.Database(path, readOnly ? { readonly: true } : { create: true }) : new sqlite.DatabaseSync(path, { readOnly });
}

// src/storage/alerts.ts
var alertSource = (path, directory) => {
  const absolute = (0, import_node_path5.resolve)(path), identity = process.platform === "win32" ? absolute.toLowerCase() : absolute;
  return { id: (0, import_node_crypto2.createHash)("sha256").update(identity).digest("hex"), directory, path: absolute };
};
var alertsPath = () => process.env.CONTEXT_MONITOR_ALERTS_PATH ?? (0, import_node_path5.join)((0, import_node_os.homedir)(), ".local", "share", "context-churn-monitor", "alerts.sqlite");
var keys = ["liveGrowth", "liveCompactions", "growthThreshold", "compactionThreshold", "minContextWindow"];
var selectSettings = (value) => Object.fromEntries(keys.map((key) => [key, value[key]]));
var rank = { recorded: 0, attempted: 1, "host-accepted": 2, unconfirmed: 2, unavailable: 2 };
var AlertHistory = class _AlertHistory {
  constructor(db) {
    this.db = db;
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS alert_settings (id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS threshold_events (id TEXT PRIMARY KEY,at INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS threshold_events_order ON threshold_events(at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS alert_sources (id TEXT PRIMARY KEY,directory TEXT NOT NULL,path TEXT NOT NULL);`);
    this.backends = new BackendRegistry(db);
  }
  db;
  backends;
  static async open(path = alertsPath()) {
    return new _AlertHistory(await openDatabase(path));
  }
  settings() {
    const saved = this.db.prepare("SELECT data FROM alert_settings WHERE id=1").get();
    return selectSettings(configure({ ...selectSettings(defaults), ...saved ? JSON.parse(saved.data) : {} }));
  }
  setSettings(input) {
    if (!input || typeof input !== "object" || Object.keys(input).some((key) => !keys.includes(key))) throw new Error("Invalid global alert settings");
    return this.atomic(() => {
      const next = selectSettings(configure({ ...this.settings(), ...input }));
      this.db.prepare("INSERT OR REPLACE INTO alert_settings VALUES(1,?)").run(JSON.stringify(next));
      return next;
    });
  }
  registerSource(source) {
    if (!(0, import_node_path5.isAbsolute)(source.path) || !source.directory || source.id !== alertSource(source.path, source.directory).id) throw new Error("Invalid alert source");
    this.db.prepare("INSERT INTO alert_sources VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET directory=excluded.directory,path=excluded.path").run(source.id, source.directory, source.path);
  }
  sources(after = "") {
    return this.db.prepare("SELECT id,directory,path FROM alert_sources WHERE id>? ORDER BY id LIMIT 20").all(after);
  }
  insert(events) {
    this.atomic(() => {
      for (const event of events) {
        if (!event.id || !event.sessionId || !event.directory || !Number.isFinite(event.at) || !Number.isFinite(event.value) || !Number.isFinite(event.threshold) || !(event.delivery in rank)) throw new Error("Invalid threshold event");
        const bounded = { ...event, title: event.title?.slice(0, 200), model: event.model?.slice(0, 500) };
        const old = this.db.prepare("SELECT data FROM threshold_events WHERE id=?").get(event.id);
        const previous = old && JSON.parse(old.data);
        const next = previous ? { ...previous, title: bounded.title ?? previous.title, delivery: rank[bounded.delivery] > rank[previous.delivery] ? bounded.delivery : previous.delivery } : bounded;
        this.db.prepare("INSERT INTO threshold_events VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data").run(next.id, next.at, JSON.stringify(next));
      }
      this.db.exec("DELETE FROM threshold_events WHERE id NOT IN (SELECT id FROM threshold_events ORDER BY at DESC,id DESC LIMIT 100)");
    });
  }
  update(id, detail) {
    this.atomic(() => {
      const row = this.db.prepare("SELECT data FROM threshold_events WHERE id=?").get(id);
      if (!row) return;
      const event = JSON.parse(row.data);
      if (detail.title !== void 0) event.title = detail.title.slice(0, 200);
      if (detail.delivery && rank[detail.delivery] > rank[event.delivery]) event.delivery = detail.delivery;
      this.db.prepare("UPDATE threshold_events SET data=? WHERE id=?").run(JSON.stringify(event), id);
    });
  }
  contains(id) {
    return Boolean(this.db.prepare("SELECT 1 FROM threshold_events WHERE id=?").get(id));
  }
  list(limit = 100) {
    return this.db.prepare("SELECT data FROM threshold_events ORDER BY at DESC,id DESC LIMIT ?").all(Math.max(1, Math.min(100, Math.trunc(limit)))).map((row) => JSON.parse(row.data));
  }
  atomic(operation) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
};

// src/alerts/pipeline.ts
var import_node_fs4 = require("node:fs");

// src/storage/store.ts
var import_node_crypto3 = require("node:crypto");

// src/storage/activities.ts
var ActivityStore = class {
  constructor(db, snapshot, readOnly = false) {
    this.db = db;
    this.snapshot = snapshot;
    if (readOnly) return;
    db.exec(`CREATE TABLE IF NOT EXISTS activities (seq INTEGER PRIMARY KEY AUTOINCREMENT, session TEXT NOT NULL, id TEXT NOT NULL, turn_number INTEGER NOT NULL, message TEXT, kind TEXT NOT NULL, status TEXT NOT NULL, search TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(session,id));
      CREATE INDEX IF NOT EXISTS activities_order ON activities(session,seq);
      CREATE INDEX IF NOT EXISTS activities_turn ON activities(session,turn_number,seq);
      CREATE INDEX IF NOT EXISTS activities_message ON activities(session,message,seq);
      CREATE TABLE IF NOT EXISTS activity_channels (session TEXT NOT NULL,id TEXT NOT NULL,channel TEXT NOT NULL,total INTEGER NOT NULL,PRIMARY KEY(session,id,channel));
      CREATE TABLE IF NOT EXISTS activity_chunks (session TEXT NOT NULL,id TEXT NOT NULL,channel TEXT NOT NULL,start INTEGER NOT NULL,size INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(session,id,channel,start));`);
  }
  db;
  snapshot;
  get(session, id) {
    const row = this.db.prepare("SELECT seq,data FROM activities WHERE session=? AND id=?").get(session, id);
    return row ? { ...JSON.parse(row.data), order: row.seq } : void 0;
  }
  update(session, activity) {
    const old = this.get(session, activity.id);
    const next = { ...old, ...activity, at: old?.at ?? activity.at, turnId: old?.turnId ?? activity.turnId, turnNumber: old?.turnNumber ?? activity.turnNumber };
    const search = [next.label, next.title, next.tool, next.preview, next.callId].filter(Boolean).join(" ");
    this.db.prepare(`INSERT INTO activities(session,id,turn_number,message,kind,status,search,data) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(session,id) DO UPDATE SET status=excluded.status,search=excluded.search,data=excluded.data`).run(session, next.id, next.turnNumber, next.messageId ?? null, next.kind, next.status, search, JSON.stringify(next));
    const state = this.snapshot(session);
    if (state) {
      state.revision++;
      this.db.prepare("UPDATE sessions SET state=? WHERE id=?").run(JSON.stringify(state), session);
    }
    return this.get(session, next.id);
  }
  write(session, id, channel, text, append = false) {
    if (!append) {
      this.db.prepare("DELETE FROM activity_chunks WHERE session=? AND id=? AND channel=?").run(session, id, channel);
      this.db.prepare("DELETE FROM activity_channels WHERE session=? AND id=? AND channel=?").run(session, id, channel);
    }
    let start2 = this.db.prepare("SELECT total FROM activity_channels WHERE session=? AND id=? AND channel=?").get(session, id, channel)?.total ?? 0;
    const insert = this.db.prepare("INSERT INTO activity_chunks VALUES(?,?,?,?,?,?)");
    let chunk = "", size = 0;
    const flush = () => {
      if (size) insert.run(session, id, channel, start2, size, chunk);
      start2 += size;
      chunk = "";
      size = 0;
    };
    for (const point of text) {
      chunk += point;
      if (++size === 16e3) flush();
    }
    flush();
    this.db.prepare("INSERT OR REPLACE INTO activity_channels VALUES(?,?,?,?)").run(session, id, channel, start2);
  }
  channels(session, id) {
    return this.db.prepare("SELECT channel,total FROM activity_channels WHERE session=? AND id=? ORDER BY channel").all(session, id);
  }
  detail(session, id, channel, offset = 0, limit = 16e3) {
    if (!this.get(session, id)) throw new Error("Activity not found in this session");
    if (!["input", "output", "progress", "error", "metadata"].includes(channel)) throw new Error("Invalid activity channel");
    offset = Math.max(0, Math.trunc(offset));
    limit = Math.max(1, Math.min(32e3, Math.trunc(limit)));
    const total = this.db.prepare("SELECT total FROM activity_channels WHERE session=? AND id=? AND channel=?").get(session, id, channel)?.total ?? 0;
    const end = Math.min(total, offset + limit);
    const first = this.db.prepare("SELECT start FROM activity_chunks WHERE session=? AND id=? AND channel=? AND start<=? ORDER BY start DESC LIMIT 1").get(session, id, channel, offset)?.start ?? offset;
    const rows = this.db.prepare(`SELECT start,text FROM activity_chunks
      WHERE session=? AND id=? AND channel=? AND start>=? AND start<? ORDER BY start`).all(session, id, channel, first, end);
    return { text: rows.map((row) => Array.from(row.text).slice(Math.max(0, offset - row.start), end - row.start).join("")).join(""), offset, next: end < total ? end : null, total };
  }
  list(session, query = {}) {
    const limit = Math.max(1, Math.min(200, Math.trunc(query.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const last = query.maxTurn ?? this.snapshot(session)?.turn?.number ?? 0;
    const first = query.scope === "current" ? last : query.scope === "recent" ? Math.max(0, last - (query.lookback ?? 5) + 1) : 0;
    const conditions = ["session=?", "turn_number>=?", "turn_number<=?"], values = [session, first, last];
    if (query.after !== void 0) {
      conditions.push("seq>?");
      values.push(query.after);
    }
    if (query.kind && query.kind !== "all") {
      conditions.push(query.kind === "tools" ? "kind IN ('tool','shell','skill')" : "kind=?");
      if (query.kind !== "tools") values.push(query.kind);
    }
    if (query.q) {
      conditions.push("instr(lower(search),lower(?))>0");
      values.push(query.q.slice(0, 500));
    }
    if (query.messageId) {
      conditions.push("message=?");
      values.push(query.messageId);
    }
    const rows = this.db.prepare(`SELECT seq,data FROM activities WHERE ${conditions.join(" AND ")} ORDER BY seq LIMIT ? OFFSET ?`).all(...values, limit + 1, offset);
    return { items: rows.slice(0, limit).map((row) => ({ ...JSON.parse(row.data), order: row.seq })), next: rows.length > limit ? offset + limit : null };
  }
  interrupt(session, at, reason) {
    const rows = this.db.prepare("SELECT data FROM activities WHERE session=? AND status IN ('running','streaming')").all(session);
    for (const row of rows) this.update(session, { ...JSON.parse(row.data), status: "interrupted", ended: at, detail: reason });
  }
};

// src/storage/store.ts
var Store = class _Store {
  constructor(db, config, path, readOnly = false, alertContext) {
    this.db = db;
    this.config = config;
    this.path = path;
    this.alertContext = alertContext;
    if (readOnly) {
      db.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=3000;");
      this.activities = new ActivityStore(db, (session) => this.snapshot(session), true);
      return;
    }
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE TABLE IF NOT EXISTS turns (session TEXT NOT NULL, id TEXT NOT NULL, number INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS turns_order ON turns(session,number);
      CREATE TABLE IF NOT EXISTS steps (session TEXT NOT NULL, id TEXT NOT NULL, turn_number INTEGER NOT NULL, number INTEGER NOT NULL, growth REAL, data TEXT NOT NULL, PRIMARY KEY(session,id));
      CREATE INDEX IF NOT EXISTS steps_order ON steps(session,turn_number,number);
      CREATE INDEX IF NOT EXISTS steps_growth ON steps(session,growth DESC,turn_number,number);
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS alert_outbox (id TEXT PRIMARY KEY,at INTEGER NOT NULL,acked INTEGER NOT NULL DEFAULT 0,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS alert_outbox_order ON alert_outbox(at DESC,id DESC);
      CREATE TABLE IF NOT EXISTS threshold_marks (session TEXT PRIMARY KEY,at INTEGER NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS threshold_marks_order ON threshold_marks(at DESC,session) WHERE json_array_length(data,'$.hits')>0;`);
    this.activities = new ActivityStore(db, (session) => this.snapshot(session));
  }
  db;
  config;
  path;
  alertContext;
  activities;
  depth = 0;
  static async open(path, config = {}, readOnly = false, alertContext) {
    configure(config);
    return new _Store(await openDatabase(path, readOnly), config, path, readOnly, alertContext);
  }
  /** Deferred read transaction pins a WAL snapshot without reserving the writer. Use on a separate read-only connection, never around monitoring ingestion. */
  readSnapshot(operation) {
    this.db.exec("BEGIN");
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  atomic(operation) {
    if (this.depth) return operation();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const value = operation();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.depth--;
    }
  }
  ingest(session, events) {
    return this.atomic(() => {
      const monitor = new Monitor(this.settings(session), this.snapshot(session) ?? void 0);
      for (const event of events) {
        if (this.db.prepare("SELECT 1 FROM events WHERE session=? AND id=?").get(session, event.id)) continue;
        const beforeAlerts = new Set(monitor.state.alerts.map((alert) => alert.id));
        if (event.type === "turn" && monitor.state.turn && monitor.state.turn.id !== event.turnId) {
          monitor.accept({ type: "complete", id: `${event.id}:previous`, at: event.at });
          this.saveRecords(session, monitor.state);
        }
        monitor.accept(event);
        if (this.alertContext) for (const alert of monitor.state.alerts) {
          if (beforeAlerts.has(alert.id)) continue;
          const marker = `threshold:${alert.id}`;
          if (this.db.prepare("SELECT 1 FROM events WHERE session=? AND id=?").get(session, marker)) continue;
          const source = alertSource(this.path, this.alertContext.directory);
          const id = (0, import_node_crypto3.createHash)("sha256").update(source.id).update("\0").update(session).update("\0").update(alert.id).digest("hex");
          const record = { id, at: alert.at, sessionId: session, directory: source.directory, metric: alert.metric, value: alert.value, threshold: alert.threshold, kind: alert.kind, model: alert.model?.slice(0, 500), capacity: alert.capacity, delivery: "recorded" };
          this.db.prepare("INSERT OR IGNORE INTO alert_outbox(id,at,data) VALUES(?,?,?)").run(id, record.at, JSON.stringify(record));
          this.db.prepare("INSERT INTO events VALUES(?,?)").run(session, marker);
          this.db.exec("DELETE FROM alert_outbox WHERE id NOT IN (SELECT id FROM alert_outbox ORDER BY at DESC,id DESC LIMIT 100)");
        }
        this.saveRecords(session, monitor.state);
        this.db.prepare("INSERT INTO events VALUES (?,?)").run(session, event.id);
      }
      this.db.prepare("INSERT OR REPLACE INTO sessions VALUES (?,?)").run(session, JSON.stringify(monitor.state));
      const turn = monitor.state.turn, current = monitor.state.alerting?.current;
      const hits = current?.eligible && current.hasModel ? current.hits ?? [] : [];
      const previous = this.markState(session);
      if (!previous?.deleted) {
        const updated = events.reduce((at, event) => Math.max(at, event.at), previous?.updated ?? turn?.at ?? 0);
        const record = { sessionId: session, turn: turn?.number ?? 0, at: turn?.at ?? updated, updated, hits };
        this.db.prepare("INSERT OR REPLACE INTO threshold_marks VALUES(?,?,?)").run(session, record.at, JSON.stringify(record));
      }
      return monitor.state;
    });
  }
  saveRecords(session, state) {
    const t = state.turn, step = state.step;
    if (t) this.db.prepare("INSERT OR REPLACE INTO turns VALUES (?,?,?,?)").run(session, t.id, t.number, JSON.stringify(t));
    if (step) this.db.prepare("INSERT OR REPLACE INTO steps VALUES (?,?,?,?,?,?)").run(session, step.id, step.turnNumber, step.number, step.growth, JSON.stringify(step));
  }
  snapshot(session) {
    const row = this.db.prepare("SELECT state FROM sessions WHERE id=?").get(session);
    return row ? JSON.parse(row.state) : null;
  }
  sessions() {
    return this.db.prepare("SELECT id FROM sessions ORDER BY id").all().map((row) => row.id);
  }
  hasMarks() {
    return !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='threshold_marks'").get();
  }
  markState(session) {
    if (!this.hasMarks()) return void 0;
    const row = this.db.prepare("SELECT data FROM threshold_marks WHERE session=?").get(session);
    return row ? JSON.parse(row.data) : void 0;
  }
  clearMark(session, at) {
    const record = { sessionId: session, turn: this.snapshot(session)?.turn?.number ?? 0, at, updated: at, hits: [], deleted: true };
    this.db.prepare("INSERT OR REPLACE INTO threshold_marks VALUES(?,?,?)").run(session, at, JSON.stringify(record));
  }
  marks(limit = 200, after) {
    if (!this.hasMarks()) return [];
    const size = Math.max(1, Math.min(200, Math.trunc(limit)));
    const cursor = after ? " AND (at<? OR (at=? AND session>?))" : "";
    return this.db.prepare(`SELECT data FROM threshold_marks WHERE json_array_length(data,'$.hits')>0${cursor} ORDER BY at DESC,session LIMIT ?`).all(...after ? [after.at, after.at, after.sessionId] : [], size).map((row) => JSON.parse(row.data));
  }
  settings(session) {
    return configure({ ...this.config, ...this.get(`settings:${session}`), ...this.alertContext?.settings() });
  }
  setSettings(session, input) {
    return this.atomic(() => {
      const next = configure({ ...this.settings(session), ...input });
      this.set(`settings:${session}`, next);
      return next;
    });
  }
  get(key) {
    const row = this.db.prepare("SELECT value FROM kv WHERE key=?").get(key);
    return row ? JSON.parse(row.value) : void 0;
  }
  set(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO kv VALUES (?,?)").run(key, JSON.stringify(value));
  }
  pendingAlerts(limit = 100) {
    return this.db.prepare("SELECT data FROM alert_outbox WHERE acked=0 ORDER BY at,id LIMIT ?").all(Math.max(1, Math.min(100, Math.trunc(limit)))).map((row) => JSON.parse(row.data));
  }
  unclaimedAlerts() {
    return this.db.prepare("SELECT a.data FROM alert_outbox a LEFT JOIN kv k ON k.key='delivery:'||a.id WHERE k.key IS NULL ORDER BY a.at,a.id LIMIT 100").all().map((row) => JSON.parse(row.data)).filter((event) => event.delivery === "recorded");
  }
  acknowledgeAlerts(ids) {
    this.atomic(() => {
      for (const id of ids) this.db.prepare("UPDATE alert_outbox SET acked=1 WHERE id=?").run(id);
    });
  }
  updateAlert(id, detail) {
    this.atomic(() => {
      const row = this.db.prepare("SELECT data FROM alert_outbox WHERE id=?").get(id);
      if (row) this.db.prepare("UPDATE alert_outbox SET acked=0,data=? WHERE id=?").run(JSON.stringify({ ...JSON.parse(row.data), ...detail, title: detail.title?.slice(0, 200) ?? JSON.parse(row.data).title }), id);
    });
  }
  claimAlertDelivery(id) {
    return this.atomic(() => {
      if (this.get(`delivery:${id}`)) return false;
      this.set(`delivery:${id}`, "attempted");
      this.updateAlert(id, { delivery: "attempted" });
      return true;
    });
  }
  steps(session, query = {}) {
    const limit = Math.max(1, Math.min(200, Math.trunc(query.limit ?? 100)));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const last = query.maxTurn ?? this.snapshot(session)?.turn?.number ?? 0;
    const first = query.scope === "current" ? last : query.scope === "recent" ? Math.max(1, last - (query.lookback ?? this.settings(session).lookback) + 1) : 0;
    const order = query.sort === "growth" ? "growth DESC,turn_number,number" : "turn_number,number";
    const rows = this.db.prepare(`SELECT data FROM steps WHERE session=? AND turn_number>=? AND turn_number<=? ORDER BY ${order} LIMIT ? OFFSET ?`).all(session, first, last, limit + 1, offset);
    return { items: rows.slice(0, limit).map((row) => JSON.parse(row.data)), next: rows.length > limit ? offset + limit : null };
  }
  turns(session, limit = 5) {
    return this.db.prepare("SELECT data FROM turns WHERE session=? ORDER BY number DESC LIMIT ?").all(session, Math.max(1, Math.min(200, limit))).reverse().map((row) => JSON.parse(row.data));
  }
  /** An assistant message can contain multiple physical attempts. Prefix range lookup keeps activity pages independent of total session history. */
  requestSteps(session, messageId) {
    return this.db.prepare("SELECT data FROM steps WHERE session=? AND (id=? OR (id>=? AND id<?)) ORDER BY number LIMIT 200").all(session, messageId, `${messageId}:`, `${messageId};`).map((row) => JSON.parse(row.data));
  }
  /** Late usage cannot be replayed through an incremental reducer without corrupting intervening turns/EMAs. Preserve its original coverage gap and break the next occupancy comparison instead. */
  requestGap(session, messageId, reason) {
    for (const step of this.requestSteps(session, messageId)) {
      if (!step.gaps.includes(reason) && step.gaps.length < 32) step.gaps.push(reason);
      step.quality = step.growth === null ? "unavailable" : "partial";
      this.db.prepare("UPDATE steps SET data=? WHERE session=? AND id=?").run(JSON.stringify(step), session, step.id);
    }
    const state = this.snapshot(session);
    if (state) {
      state.rebase = true;
      state.revision++;
      this.db.prepare("UPDATE sessions SET state=? WHERE id=?").run(JSON.stringify(state), session);
    }
  }
  /** Indexed keyset traversal is linear in exported rows; OFFSET would rescan all preceding pages. */
  stepBatch(session, after = [-1, -1]) {
    return this.db.prepare("SELECT data FROM steps WHERE session=? AND (turn_number,number)>(?,?) ORDER BY turn_number,number LIMIT 200").all(session, ...after).map((row) => JSON.parse(row.data));
  }
  close() {
    this.db.close();
  }
};

// src/alerts/pipeline.ts
var AlertPipeline = class _AlertPipeline {
  constructor(history, source, directory, send) {
    this.history = history;
    this.source = source;
    this.send = send;
    history.registerSource(alertSource(source.path, directory));
  }
  history;
  source;
  send;
  /** Only fresh runtime processing calls this. Recovery itself never invokes the sender. */
  async publishPending() {
    const ready = this.send ? this.source.unclaimedAlerts() : [];
    const pending = this.source.pendingAlerts();
    this.history.insert(pending);
    this.source.acknowledgeAlerts(pending.map((event) => event.id));
    if (!this.send) return;
    for (const event of ready) {
      if (event.delivery !== "recorded" || !this.source.claimAlertDelivery(event.id)) continue;
      if (!this.history.contains(event.id)) {
        this.source.updateAlert(event.id, { delivery: "unavailable" });
        this.source.acknowledgeAlerts([event.id]);
        continue;
      }
      this.history.update(event.id, { delivery: "attempted" });
      let detail;
      try {
        detail = await this.send(event);
      } catch {
        detail = { delivery: "unconfirmed" };
      }
      this.source.updateAlert(event.id, detail);
      this.history.update(event.id, detail);
      this.source.acknowledgeAlerts([event.id]);
    }
  }
  async reconcile() {
    return _AlertPipeline.reconcile(this.history);
  }
  static async reconcile(history) {
    let after = "", recovered = 0, omittedLimitations = 0;
    const limitations = [];
    for (; ; ) {
      const sources = history.sources(after);
      if (!sources.length) break;
      for (const source of sources) {
        let store;
        try {
          if (!(0, import_node_fs4.existsSync)(source.path)) throw new Error("Recorded backend store is unavailable");
          store = await Store.open(source.path);
          const pending = store.pendingAlerts();
          history.insert(pending);
          store.acknowledgeAlerts(pending.map((event) => event.id));
          recovered += pending.length;
        } catch {
          if (limitations.length < 20) limitations.push(`History recovery unavailable for ${source.directory.slice(0, 200)}.`);
          else omittedLimitations++;
        } finally {
          store?.close();
        }
      }
      after = sources.at(-1).id;
    }
    return { recovered, limitations, omittedLimitations };
  }
};

// src/gui/alert-service.ts
var GlobalAlertService = class {
  constructor(history) {
    this.history = history;
  }
  history;
  lastRecovery = 0;
  running;
  recovery = { recovered: 0, limitations: [], omittedLimitations: 0 };
  async handle(url, method, input) {
    if (url.pathname === "/notification-settings") {
      if (method === "GET") return this.history.settings();
      if (method === "POST") return this.history.setSettings(input);
      throw new Error("Unsupported global settings method");
    }
    if (url.pathname !== "/notifications") return void 0;
    if (method !== "GET") throw new Error("History is read-only");
    if (this.running || url.searchParams.get("refresh") === "1" || Date.now() - this.lastRecovery > 5e3) {
      this.running ??= AlertPipeline.reconcile(this.history).then((result) => {
        this.recovery = result;
        this.lastRecovery = Date.now();
        return result;
      }).finally(() => {
        this.running = void 0;
      });
      await this.running;
    }
    return { items: this.history.list(), ...this.recovery };
  }
};

// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = /* @__PURE__ */ new WeakMap();
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== void 0)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1e3));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;

// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);

// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_IDLE_MS = 10 * 6e4;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);

// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_MARK_TEXT_MAX = 200;
var SERVICE_MARKS_MAX = 200;
var SERVICE_MARK_RATE_MAX = 60;
var SERVICE_HOST_TIMEOUT_MS = 3e4;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
var MENTIONS_IDLE_MS = 10 * 6e4;
var ServiceHostError = class extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
};
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token2 = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token2)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token2}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body2 = await response.json().catch(() => null);
    if (response.ok && body2?.result !== void 0)
      return body2.result;
    throw new ServiceHostError(body2?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body2?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === void 0 ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};

// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);

// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 6e4;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 6e4;
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 6e4;
var TRACKER_PROVIDER_IDLE_MS = 10 * 6e4;
var QUOTA_PROVIDER_IDLE_MS = 10 * 6e4;

// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);

// src/gui/marks.ts
var SessionMarks = class _SessionMarks {
  constructor(history, host, clock = Date.now) {
    this.history = history;
    this.host = host;
    this.clock = clock;
  }
  history;
  host;
  clock;
  published = /* @__PURE__ */ new Map();
  uncertain = /* @__PURE__ */ new Set();
  attempts = [];
  running;
  timer;
  started = false;
  stopped = false;
  failedSources = /* @__PURE__ */ new Set();
  callbackFailed = false;
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    void this.poll();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }
  refresh() {
    if (this.stopped) return Promise.resolve();
    return this.running ??= this.reconcile().finally(() => {
      this.running = void 0;
    });
  }
  async poll() {
    try {
      await this.refresh();
    } catch {
      console.warn("[context-monitor] Sidebar mark reconciliation unavailable; retrying on the next poll.");
    } finally {
      if (!this.stopped) this.timer = setTimeout(() => void this.poll(), 5e3);
    }
  }
  async read() {
    const stores = [];
    let afterSource = "", candidates = /* @__PURE__ */ new Map();
    try {
      for (; ; ) {
        const sources = this.history.sources(afterSource);
        if (!sources.length || this.stopped) break;
        for (const source of sources) {
          let store;
          try {
            store = await Store.open(source.path, {}, true);
            store.marks(1);
            stores.push(store);
            this.failedSources.delete(source.id);
          } catch {
            store?.close();
            if (!this.failedSources.has(source.id)) console.warn("[context-monitor] Sidebar marks could not read a registered store; its unverified marks will be removed.");
            this.failedSources.add(source.id);
          }
        }
        afterSource = sources.at(-1).id;
      }
      for (const store of stores) {
        let after;
        for (; ; ) {
          if (this.stopped) return [];
          const page = store.marks(SERVICE_MARKS_MAX, after);
          for (const record of page) {
            let latest = record;
            for (const other of stores) {
              const state = other.markState(record.sessionId);
              if (state && (state.deleted || !latest.deleted && (state.at > latest.at || state.at === latest.at && (state.updated ?? state.at) > (latest.updated ?? latest.at)))) latest = state;
            }
            if (!latest.deleted && latest.hits.length) candidates.set(latest.sessionId, latest);
            else candidates.delete(record.sessionId);
          }
          candidates = new Map([...candidates.values()].sort(_SessionMarks.newest).slice(0, SERVICE_MARKS_MAX).map((record) => [record.sessionId, record]));
          after = page.at(-1);
          if (page.length < SERVICE_MARKS_MAX || candidates.size === SERVICE_MARKS_MAX && after.at < [...candidates.values()].at(-1).at) break;
        }
      }
      return [...candidates.values()].sort(_SessionMarks.newest);
    } finally {
      for (const store of stores) store.close();
    }
  }
  static newest(a, b) {
    return b.at - a.at || a.sessionId.localeCompare(b.sessionId);
  }
  mark(record) {
    const number = (value) => Number(value.toFixed(2)).toString();
    const reasons = record.hits.map((hit) => {
      const units = hit.metric === "growth" ? hit.kind === "live" ? " pp" : " pp/turn" : hit.kind === "ema" ? "/turn" : "";
      return `${hit.metric} ${hit.kind === "live" ? "live" : "EMA"} ${number(hit.value)} \u2265 ${number(hit.threshold)}${units}`;
    });
    return { icon: "pulse", tone: "warning", text: `Turn ${record.turn}: ${reasons.join("; ")}`.slice(0, SERVICE_MARK_TEXT_MAX) };
  }
  async reconcile() {
    const desired = new Map((await this.read()).map((record) => [record.sessionId, this.mark(record)]));
    const changes = [];
    for (const session of /* @__PURE__ */ new Set([...this.published.keys(), ...this.uncertain])) if (!desired.has(session)) changes.push([session, null]);
    for (const [session, mark] of desired) if (this.uncertain.has(session) || this.published.get(session) !== JSON.stringify(mark)) changes.push([session, mark]);
    for (const [sessionId, mark] of changes) {
      const now = this.clock();
      this.attempts = this.attempts.filter((at) => now - at < 6e4);
      if (this.stopped || this.attempts.length >= SERVICE_MARK_RATE_MAX) break;
      this.attempts.push(now);
      this.uncertain.add(sessionId);
      try {
        await this.host.setMark({ sessionId }, mark);
        if (mark) this.published.set(sessionId, JSON.stringify(mark));
        else this.published.delete(sessionId);
        this.uncertain.delete(sessionId);
        this.callbackFailed = false;
      } catch {
        if (!this.callbackFailed) console.warn("[context-monitor] Sidebar mark callback unavailable; retrying later.");
        this.callbackFailed = true;
        break;
      }
    }
  }
};

// src/gui/service.ts
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
if (!token || !Number.isInteger(port) || port <= 0) throw new Error("Start this service through OpenChamber");
async function start(token2) {
  const history = await AlertHistory.open();
  const bridge = new Bridge((0, import_node_path6.join)((0, import_node_os2.homedir)(), ".local", "share", "context-churn-monitor", "gui-pairings.json"), history.backends);
  const globals = new GlobalAlertService(history);
  const marks = new SessionMarks(history, createServiceHost({ env: process.env }));
  const server = (0, import_node_http2.createServer)(async (request, response) => {
    if (!authorized(request, token2)) return respond(response, 401, { error: "Authentication required" });
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/health") return respond(response, 200, { ok: true });
      const input = request.method === "POST" ? await body(request) : void 0;
      const globalResult = await globals.handle(url, request.method ?? "GET", input);
      if (globalResult !== void 0) return respond(response, 200, globalResult);
      const directory = url.searchParams.get("directory") ?? "";
      if (!directory) throw new Error("Select a project first");
      url.searchParams.delete("directory");
      if (url.pathname === "/pair" && request.method === "POST") {
        await bridge.pair(directory, input.path);
        return respond(response, 200, { paired: true });
      }
      const allowed = ["/sessions", "/snapshot", "/steps", "/activities", "/activity", "/settings", "/export", "/analysis/prepare", "/analysis/run", "/analysis/claim", "/analysis/result", "/analysis/read"];
      if (!allowed.includes(url.pathname)) return respond(response, 404, { error: "Unknown route" });
      respond(response, 200, await bridge.request(directory, url.pathname + url.search, request.method ?? "GET", input));
    } catch (error) {
      respond(response, 400, { error: error instanceof Error ? error.message : "Request failed" });
    }
  });
  server.listen(port, "127.0.0.1");
  marks.start();
  process.once("SIGTERM", () => {
    void marks.stop().then(() => server.close(() => history.close()));
  });
}
void start(token).catch((error) => {
  console.error("[context-monitor] GUI service could not start", error);
  process.exitCode = 1;
});
