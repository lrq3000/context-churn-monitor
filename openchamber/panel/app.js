"use strict";
(() => {
  // node_modules/@openchamber/sdk/dist/api-version.js
  var OPENCHAMBER_SDK_CHANNEL = "openchamber.sdk";
  var OPENCHAMBER_SDK_API_VERSION = 1;

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

  // node_modules/@openchamber/sdk/dist/workspace.js
  var GUEST_STORAGE_KEY_MAX = 128;
  var GUEST_STORAGE_VALUE_BYTES = 65536;

  // node_modules/@openchamber/sdk/dist/shells.js
  var GUEST_SHELL_ID_MAX = 128;
  var GUEST_SHELL_OUTPUT_TAIL_MAX = 65536;

  // node_modules/@openchamber/sdk/dist/status-controls.js
  var GUEST_STATUS_CONTROLS_MAX = 4;
  var GUEST_STATUS_CONTROL_ID = /^[a-z][a-z0-9-]{0,39}$/;
  var GUEST_STATUS_CONTROL_LABEL_MAX = 60;
  var GUEST_STATUS_CONTROL_OPTIONS_MAX = 16;
  var GUEST_STATUS_CONTROL_VALUE_MAX = 80;
  var isControlObject = (value) => Object(value) === value && !Array.isArray(value);
  var hasOnlyKeys = (value, keys) => Object.keys(value).every((key) => keys.includes(key));
  var isLabel = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_LABEL_MAX;
  var isValue = (value) => String(value) === value && value.length >= 1 && value.length <= GUEST_STATUS_CONTROL_VALUE_MAX;
  var isGuestStatusControls = (controls) => {
    if (!Array.isArray(controls) || controls.length > GUEST_STATUS_CONTROLS_MAX)
      return false;
    const ids = /* @__PURE__ */ new Set();
    for (const control of controls) {
      if (!isControlObject(control) || !GUEST_STATUS_CONTROL_ID.test(control.id) || !isLabel(control.label))
        return false;
      if (control.disabled !== void 0 && control.disabled !== true && control.disabled !== false)
        return false;
      if (ids.has(control.id))
        return false;
      ids.add(control.id);
      if (control.kind === "button") {
        if (!hasOnlyKeys(control, ["kind", "id", "label", "disabled"]))
          return false;
        continue;
      }
      if (control.kind !== "select" || !hasOnlyKeys(control, ["kind", "id", "label", "value", "options", "disabled"]))
        return false;
      if (!isValue(control.value) || !Array.isArray(control.options) || control.options.length < 1 || control.options.length > GUEST_STATUS_CONTROL_OPTIONS_MAX)
        return false;
      const values = /* @__PURE__ */ new Set();
      for (const option of control.options) {
        if (!isControlObject(option) || !hasOnlyKeys(option, ["value", "label"]) || !isValue(option.value) || !isLabel(option.label) || values.has(option.value))
          return false;
        values.add(option.value);
      }
      if (!values.has(control.value))
        return false;
    }
    return true;
  };

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
  var SERVICE_SCHEDULE_IDLE_MS = 10 * 6e4;
  var MENTIONS_IDLE_MS = 10 * 6e4;

  // node_modules/@openchamber/sdk/dist/file-editor.js
  var GUEST_FILE_EDITOR_CONTENT_MAX = 2e7;
  var GUEST_FILE_EDITOR_VERSION_MAX = 256;
  var fileEditorPayloadSize = (value) => "bytes" in value ? value.bytes.byteLength : value.content.length;
  var sameFileEditorDocument = (left, right) => {
    if (left.path !== right.path || left.readOnly !== right.readOnly)
      return false;
    if (left.encoding === "text" || right.encoding === "text") {
      return left.encoding === "text" && right.encoding === "text" && left.content === right.content;
    }
    if (left.bytes.byteLength !== right.bytes.byteLength)
      return false;
    for (let index = 0; index < left.bytes.byteLength; index += 1) {
      if (left.bytes[index] !== right.bytes[index])
        return false;
    }
    return true;
  };

  // node_modules/@openchamber/sdk/dist/popover.js
  var GUEST_POPOVER_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var GUEST_POPOVER_COORDINATE_MAX = 1e5;
  var GUEST_POPOVER_WIDTH_MIN = 160;
  var GUEST_POPOVER_WIDTH_MAX = 640;
  var GUEST_POPOVER_HEIGHT_MIN = 48;
  var GUEST_POPOVER_HEIGHT_MAX = 480;
  var GUEST_POPOVER_DATA_MAX = 16e3;
  var GUEST_POPOVER_DATA_DEPTH_MAX = 32;
  var GUEST_POPOVER_SIDES = ["left", "right", "top", "bottom"];
  var hasBoundedJsonTree = (value, depth = 0, budget = { remaining: GUEST_POPOVER_DATA_MAX }) => {
    if (--budget.remaining < 0 || depth >= GUEST_POPOVER_DATA_DEPTH_MAX)
      return false;
    if (value === null)
      return true;
    const children = Array.isArray(value) ? value : Object(value) === value ? Object.values(value) : [];
    for (const item of children) {
      if (!hasBoundedJsonTree(item, depth + 1, budget))
        return false;
    }
    return true;
  };
  var isFiniteJson = (value) => {
    if (value === null || value === true || value === false)
      return true;
    if (Array.isArray(value))
      return Object.keys(value).every((key) => /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length) && value.every(isFiniteJson);
    if (Object(value) === value) {
      const prototype = Object.getPrototypeOf(value);
      return (prototype === null || prototype === Object.prototype) && Object.values(value).every(isFiniteJson);
    }
    return String(value) === value || Number.isFinite(value);
  };
  var isGuestPopoverRequest = (request) => {
    try {
      if (String(request.id) !== request.id || !GUEST_POPOVER_ID.test(request.id) || !Number.isFinite(request.anchor.x) || Math.abs(request.anchor.x) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.y) || Math.abs(request.anchor.y) > GUEST_POPOVER_COORDINATE_MAX || !Number.isFinite(request.anchor.width) || !Number.isFinite(request.anchor.height) || request.anchor.width <= 0 || request.anchor.height <= 0 || request.anchor.width > GUEST_POPOVER_COORDINATE_MAX || request.anchor.height > GUEST_POPOVER_COORDINATE_MAX || !Number.isInteger(request.width) || request.width < GUEST_POPOVER_WIDTH_MIN || request.width > GUEST_POPOVER_WIDTH_MAX || !Number.isInteger(request.height) || request.height < GUEST_POPOVER_HEIGHT_MIN || request.height > GUEST_POPOVER_HEIGHT_MAX || request.side !== void 0 && !GUEST_POPOVER_SIDES.includes(request.side) || request.focus !== void 0 && request.focus !== true && request.focus !== false || !hasBoundedJsonTree(request.data) || !isFiniteJson(request.data))
        return false;
      return JSON.stringify(request.data).length <= GUEST_POPOVER_DATA_MAX;
    } catch {
      return false;
    }
  };

  // node_modules/@openchamber/sdk/dist/contract.js
  var GUEST_BLOCK_ANSWER_MAX = 2e3;
  var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
  var isStartSessionResult = (value) => Boolean(value && "sessionId" in value);
  var isPromptResult = (value) => Boolean(value && "sent" in value && !("sessionId" in value));
  var GUEST_COMMIT_SHA = /^[0-9a-f]{7,64}$/i;
  var isGuestCommitSha = (value) => GUEST_COMMIT_SHA.test(value);
  var GUEST_TOAST_MAX = 500;
  var GUEST_CLIPBOARD_TEXT_MAX = 32e3;
  var GUEST_COMPOSE_TEXT_MAX = 16e3;
  var GUEST_ATTACH_ID_MAX = 128;
  var GUEST_ATTACH_TITLE_MAX = 200;
  var GUEST_ATTACH_URL_MAX = 2e3;
  var GUEST_ATTACH_TEXT_MAX = 16e3;
  var GUEST_ATTACH_AUTHOR_MAX = 80;
  var GUEST_ATTACH_BRANCH_MAX = 200;
  var GUEST_ATTACH_DATA_MAX = 16e3;
  var GUEST_REQUEST_PATH_MAX = 2e3;
  var GUEST_REQUEST_TIMEOUT_MS = 2e4;
  var GUEST_FILE_PATH_MAX = 1024;
  var GUEST_FILE_CONTENT_MAX = 2e6;
  var GUEST_GENERATE_PROMPT_MAX = 64e3;
  var GUEST_GENERATE_SYSTEM_MAX = 8e3;
  var GUEST_GENERATE_OUTPUT_TOKENS_MAX = 4e3;
  var GUEST_GENERATE_TIMEOUT_MS = 96e4;
  var GUEST_GENERATE_LATE_KEEP_MS = 60 * 6e4;
  var GUEST_BADGE_MAX = 999;
  var GUEST_FRAME_HEIGHT_MAX = 1e4;
  var GUEST_RESOLVE_ERROR_MAX = 500;
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
  var isHostRequestErrorCode = (value) => hostRequestErrorCodeSet.has(value);
  var resolveHostRequestErrorCode = (value) => value && isHostRequestErrorCode(value) ? value : "HOST_REJECTED";
  var isJsonValue = (value) => {
    if (value === void 0)
      return false;
    if (value === null || value === true || value === false)
      return true;
    if (String(value) === value)
      return true;
    if (Number(value) === value)
      return Number.isFinite(value);
    if (Array.isArray(value))
      return value.every(isJsonValue);
    if (Object(value) === value)
      return Object.values(value).every(isJsonValue);
    return false;
  };
  var isAttachData = (value) => isJsonValue(value) && JSON.stringify(value).length <= GUEST_ATTACH_DATA_MAX;
  var clampBranch = (value) => value?.trim().slice(0, GUEST_ATTACH_BRANCH_MAX) ?? "";
  var clampAttachRequest = (request) => {
    const id = request.id.trim().slice(0, GUEST_ATTACH_ID_MAX);
    const title = request.title.trim().slice(0, GUEST_ATTACH_TITLE_MAX);
    const url = request.url.trim().slice(0, GUEST_ATTACH_URL_MAX);
    const text = request.text?.trim().slice(0, GUEST_ATTACH_TEXT_MAX);
    const author = request.author?.trim().slice(0, GUEST_ATTACH_AUTHOR_MAX);
    const kind = request.kind === "pull" ? "pull" : "issue";
    const next = {
      providerId: request.providerId.trim(),
      id,
      title: title || id,
      url,
      kind
    };
    if (text) {
      next.text = text;
    }
    if (author) {
      next.author = author;
    }
    if (kind === "pull") {
      const head = clampBranch(request.branches?.head);
      const base = clampBranch(request.branches?.base);
      if (head && base) {
        next.branches = { head, base };
      }
    }
    if (isAttachData(request.data)) {
      next.data = request.data;
    }
    return next;
  };
  var clampStartSessionRequest = (request) => {
    const next = clampAttachRequest(request);
    if (request.projectId)
      next.projectId = request.projectId;
    if (request.navigation)
      next.navigation = request.navigation;
    if (request.worktree) {
      next.worktree = request.worktree;
    }
    return next;
  };
  var clampPromptRequest = (request) => {
    const next = {
      text: request.text.trim().slice(0, GUEST_COMPOSE_TEXT_MAX)
    };
    if (request.send) {
      next.send = true;
    }
    return next;
  };
  var clampBadgeCount = (count) => {
    if (count === null || !Number.isFinite(count))
      return null;
    return Math.min(GUEST_BADGE_MAX, Math.max(0, Math.round(count)));
  };
  var clampFrameHeight = (height) => {
    if (!Number.isFinite(height))
      return 0;
    return Math.min(GUEST_FRAME_HEIGHT_MAX, Math.max(0, Math.ceil(height)));
  };
  var isGuestFilePath = (value) => value.length > 0 && value.length <= GUEST_FILE_PATH_MAX && !value.includes("\0") && !value.includes("\\");
  var isGuestRequestPath = (value) => {
    if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.includes("://")) {
      return false;
    }
    if (value.length > GUEST_REQUEST_PATH_MAX) {
      return false;
    }
    const segments = value.split("/");
    return !segments.some((segment) => segment === "." || segment === "..");
  };
  var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
  var isServiceStatusResult = (value) => Boolean(value && "status" in value && serviceStatusSet.has(String(value.status)) && !("body" in value));
  var isGuestRequestResult = (value) => Boolean(value && "status" in value && "body" in value && Number.isInteger(value.status));
  var isFileReadResult = (value) => Boolean(value && "content" in value && String(value.content) === value.content);
  var isFileWriteResult = (value) => Boolean(value && "written" in value && value.written === true);
  var isFileListResult = (value) => Boolean(value && "entries" in value && Array.isArray(value.entries));
  var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
  var isFileStatResult = (value) => Boolean(value && "kind" in value && "size" in value && fileStatKindSet.has(String(value.kind)) && Number.isFinite(value.size));
  var isGenerateResult = (value) => Boolean(value && "text" in value && String(value.text) === value.text && !("status" in value));
  var HOST_PUSH_TYPES = /* @__PURE__ */ new Set([
    "workspace",
    "shells",
    "ready",
    "directory",
    "session",
    "connection",
    "settings",
    "session-lifecycle",
    "item",
    "resolve",
    "action",
    "service-event",
    "status-control-event",
    "popover-closed",
    "file-open",
    "file-snapshot",
    "file-saved",
    "generate-late"
  ]);
  var asWireRecord = (data) => Object(data) === data ? data : null;
  var isNonEmptyString = (value) => String(value) === value && value.length > 0;
  var readResultMessage = (wire) => {
    if (!isNonEmptyString(wire.id))
      return null;
    if (wire.ok === true) {
      const message = {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: true
      };
      if (Object(wire.payload) === wire.payload) {
        message.payload = wire.payload;
      }
      return message;
    }
    if (wire.ok === false && isNonEmptyString(wire.error)) {
      return {
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "result",
        id: wire.id,
        ok: false,
        error: wire.error,
        code: resolveHostRequestErrorCode(isNonEmptyString(wire.code) ? wire.code : void 0)
      };
    }
    return null;
  };
  var readHostMessage = (data) => {
    const wire = asWireRecord(data);
    if (!wire || wire.channel !== OPENCHAMBER_SDK_CHANNEL || wire.v !== OPENCHAMBER_SDK_API_VERSION)
      return null;
    if (wire.type === "result")
      return readResultMessage(wire);
    if (!HOST_PUSH_TYPES.has(String(wire.type)) || Object(wire.payload) !== wire.payload)
      return null;
    return wire;
  };

  // node_modules/@openchamber/sdk/dist/host.js
  var isKeyEvent = (event) => "key" in event && "metaKey" in event && "ctrlKey" in event;
  var isSaveShortcut = (event) => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s";
  var HostRequestError = class extends Error {
    code;
    constructor(code, message) {
      super(message);
      this.name = "HostRequestError";
      this.code = code;
    }
  };
  var rejectBadPath = () => Promise.reject(new HostRequestError("BAD_PATH", 'Request path must start with "/" and stay on the declared origin.'));
  var rejectBadFilePath = () => Promise.reject(new HostRequestError("BAD_PATH", `File path must be 1 to ${GUEST_FILE_PATH_MAX} characters without NUL or backslash.`));
  var deviceStorageScope = (options) => {
    if (options === void 0)
      return void 0;
    if (Object(options) !== options || Array.isArray(options) || options.scope !== void 0 && options.scope !== "instance" && options.scope !== "device") {
      throw new HostRequestError("HOST_REJECTED", 'Storage scope must be "instance" or "device".');
    }
    return options.scope === "device" ? "device" : void 0;
  };
  var nextId = (n) => {
    n.value += 1;
    return `oc-${n.value}`;
  };
  var connectHost = (options = {}) => {
    const target = options.target ?? ("window" in globalThis ? window : null);
    if (!target) {
      throw new HostRequestError("HOST_UNAVAILABLE", "No window. connectHost runs in a browser frame.");
    }
    const acceptSource = options.acceptSource ?? ((source) => source === target.parent);
    const requestTimeoutMs = options.requestTimeoutMs ?? GUEST_REQUEST_TIMEOUT_MS;
    const readyListeners = /* @__PURE__ */ new Set();
    const directoryListeners = /* @__PURE__ */ new Set();
    const sessionListeners = /* @__PURE__ */ new Set();
    const lifecycleListeners = /* @__PURE__ */ new Set();
    const connectionListeners = /* @__PURE__ */ new Set();
    const settingsListeners = /* @__PURE__ */ new Set();
    const itemListeners = /* @__PURE__ */ new Set();
    const blockListeners = /* @__PURE__ */ new Set();
    const serviceEventListeners = /* @__PURE__ */ new Set();
    const statusControlListeners = /* @__PURE__ */ new Set();
    const popoverClosedListeners = /* @__PURE__ */ new Set();
    const lateGenerateListeners = /* @__PURE__ */ new Set();
    const unclaimedLateGenerate = [];
    let resolveHandler = null;
    let actionHandler = null;
    const fileOpenListeners = /* @__PURE__ */ new Set();
    const fileSavedListeners = /* @__PURE__ */ new Set();
    let fileSnapshotHandler = null;
    let lastFile = null;
    let saveShortcutInstalled = false;
    const pending = /* @__PURE__ */ new Map();
    const workspaceListeners = /* @__PURE__ */ new Map();
    const shellsListeners = /* @__PURE__ */ new Map();
    let disposed = false;
    const ids = { value: 0 };
    let lastReady = null;
    let lastLifecycle = null;
    let popoverPointerActive = false;
    let popoverFocusActive = false;
    let popoverActivityReported = null;
    const lifecycleFromSession = (session) => {
      if (!session)
        return null;
      return {
        sessionId: session.id,
        phase: session.busy ? "started" : "completed"
      };
    };
    const post = (message) => {
      target.parent.postMessage(message, "*");
    };
    const listenForLateGenerate = () => {
      if (disposed || target.parent === target || lateGenerateListeners.size === 0 || lastReady?.features?.lateGenerateResults !== true)
        return;
      post({ channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION, type: "generate-late-listen" });
    };
    const emit = (listeners, value) => {
      for (const listener of listeners) {
        try {
          listener(value);
        } catch (error) {
          console.error(error);
        }
      }
    };
    const onMessage = (event) => {
      if (!(event instanceof MessageEvent))
        return;
      if (!acceptSource(event.source))
        return;
      const message = readHostMessage(event.data);
      if (!message)
        return;
      if (message.type === "workspace") {
        const listener = workspaceListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "shells") {
        const listener = shellsListeners.get(message.payload.subscriptionId);
        if (listener)
          emit([listener], message.payload.snapshot);
        return;
      }
      if (message.type === "ready") {
        lastReady = message.payload;
        lastLifecycle = lifecycleFromSession(message.payload.session);
        emit(readyListeners, message.payload);
        emit(directoryListeners, message.payload.directory);
        emit(sessionListeners, message.payload.session);
        if (lastLifecycle) {
          emit(lifecycleListeners, lastLifecycle);
        }
        emit(connectionListeners, message.payload.connection);
        emit(settingsListeners, message.payload.settings);
        emit(itemListeners, message.payload.item);
        if (message.payload.block)
          emit(blockListeners, message.payload.block);
        listenForLateGenerate();
        return;
      }
      if (message.type === "service-event") {
        emit(serviceEventListeners, message.payload);
        return;
      }
      if (message.type === "generate-late") {
        if (lateGenerateListeners.size === 0)
          unclaimedLateGenerate.push(message.payload);
        else
          emit(lateGenerateListeners, message.payload);
        return;
      }
      if (message.type === "directory") {
        if (lastReady) {
          lastReady = { ...lastReady, directory: message.payload.directory };
        }
        emit(directoryListeners, message.payload.directory);
        return;
      }
      if (message.type === "session") {
        if (lastReady) {
          lastReady = { ...lastReady, session: message.payload.session };
        }
        if (!message.payload.session) {
          lastLifecycle = null;
        } else if (lastLifecycle?.sessionId !== message.payload.session.id) {
          lastLifecycle = lifecycleFromSession(message.payload.session);
        }
        emit(sessionListeners, message.payload.session);
        return;
      }
      if (message.type === "session-lifecycle") {
        lastLifecycle = message.payload;
        emit(lifecycleListeners, message.payload);
        return;
      }
      if (message.type === "connection") {
        if (lastReady) {
          lastReady = { ...lastReady, connection: message.payload.connection };
        }
        emit(connectionListeners, message.payload.connection);
        return;
      }
      if (message.type === "settings") {
        if (lastReady) {
          lastReady = { ...lastReady, settings: message.payload.settings };
        }
        emit(settingsListeners, message.payload.settings);
        return;
      }
      if (message.type === "item") {
        if (lastReady) {
          lastReady = { ...lastReady, item: message.payload.item };
        }
        emit(itemListeners, message.payload.item);
        return;
      }
      if (message.type === "status-control-event") {
        emit(statusControlListeners, message.payload);
        return;
      }
      if (message.type === "popover-closed") {
        emit(popoverClosedListeners, message.payload);
        return;
      }
      if (message.type === "action") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "action-result",
              id: message.id,
              payload
            });
        };
        const handler = actionHandler;
        if (!handler) {
          answer({ ok: false, error: "This extension does not handle background actions." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then(() => answer({ ok: true }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ ok: false, error: (text || "Action failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      if (message.type === "file-open") {
        const next = message.payload;
        if (lastFile && sameFileEditorDocument(lastFile, next))
          return;
        lastFile = next;
        emit(fileOpenListeners, message.payload);
        return;
      }
      if (message.type === "file-saved") {
        emit(fileSavedListeners, message.payload.version);
        return;
      }
      if (message.type === "file-snapshot") {
        const answer = (payload) => {
          if (!disposed)
            post({
              channel: OPENCHAMBER_SDK_CHANNEL,
              v: OPENCHAMBER_SDK_API_VERSION,
              type: "file-snapshot-result",
              id: message.id,
              payload
            });
        };
        const fail = (text) => answer({ error: (text.trim() || "Could not read the edited file.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        const handler = fileSnapshotHandler;
        if (!handler) {
          fail("This extension does not edit files.");
          return;
        }
        Promise.resolve().then(() => handler(message.payload.purpose)).then((snapshot) => {
          if (fileEditorPayloadSize(snapshot) > GUEST_FILE_EDITOR_CONTENT_MAX) {
            fail(`The file is over ${GUEST_FILE_EDITOR_CONTENT_MAX} ${"bytes" in snapshot ? "bytes" : "characters"}.`);
            return;
          }
          if (snapshot.version.length > GUEST_FILE_EDITOR_VERSION_MAX) {
            fail(`The snapshot version is over ${GUEST_FILE_EDITOR_VERSION_MAX} characters.`);
            return;
          }
          answer({ snapshot: "bytes" in snapshot ? { bytes: snapshot.bytes, version: snapshot.version } : { content: snapshot.content, version: snapshot.version } });
        }, (error) => fail(error instanceof Error ? error.message : String(error)));
        return;
      }
      if (message.type === "resolve") {
        const answer = (payload) => {
          post({
            channel: OPENCHAMBER_SDK_CHANNEL,
            v: OPENCHAMBER_SDK_API_VERSION,
            type: "resolve-result",
            id: message.id,
            payload
          });
        };
        const handler = resolveHandler;
        if (!handler) {
          answer({ error: "This extension does not resolve commands." });
          return;
        }
        Promise.resolve().then(() => handler(message.payload)).then((item) => answer({ item: item ? clampAttachRequest(item) : null }), (error) => {
          const text = (error instanceof Error ? error.message : String(error)).trim();
          answer({ error: (text || "Command failed.").slice(0, GUEST_RESOLVE_ERROR_MAX) });
        });
        return;
      }
      const waiter = pending.get(message.id);
      if (!waiter)
        return;
      clearTimeout(waiter.timer);
      pending.delete(message.id);
      if (message.ok) {
        waiter.resolve(message.payload);
        return;
      }
      waiter.reject(new HostRequestError(message.code, message.error));
    };
    target.addEventListener("message", onMessage);
    post({
      channel: OPENCHAMBER_SDK_CHANNEL,
      v: OPENCHAMBER_SDK_API_VERSION,
      type: "hello"
    });
    const send = (message, timeoutMs = requestTimeoutMs) => {
      if (disposed || target.parent === target) {
        return Promise.reject(new HostRequestError("HOST_UNAVAILABLE", "No host frame. This page is not in an iframe."));
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(message.id);
          reject(new HostRequestError("HOST_TIMEOUT", "Host did not answer in time."));
        }, timeoutMs);
        pending.set(message.id, { resolve, reject, timer });
        post(message);
      });
    };
    const request = (message) => send(message).then(() => void 0);
    const envelope = { channel: OPENCHAMBER_SDK_CHANNEL, v: OPENCHAMBER_SDK_API_VERSION };
    const notify = (message) => {
      if (!disposed && target.parent !== target)
        post(message);
    };
    const requestFileSave = () => notify({ ...envelope, type: "file-save" });
    const onSaveShortcut = (event) => {
      if (!isKeyEvent(event) || !isSaveShortcut(event))
        return;
      event.preventDefault();
      requestFileSave();
    };
    const onPopoverEscape = (event) => {
      if (!isKeyEvent(event) || event.key !== "Escape" || lastReady?.surface !== "popover" || !lastReady.popover)
        return;
      event.preventDefault();
      void closePopover(lastReady.popover.id, "escape").catch(() => void 0);
    };
    const reportPopoverActivity = () => {
      const popover = lastReady?.surface === "popover" ? lastReady.popover : void 0;
      if (!popover)
        return;
      const active2 = popoverPointerActive || popoverFocusActive;
      if (popoverActivityReported === active2)
        return;
      popoverActivityReported = active2;
      void setPopoverAnchorActive(popover.id, active2).catch(() => void 0);
    };
    const onPopoverPointerOver = () => {
      if (lastReady?.surface !== "popover" || popoverPointerActive)
        return;
      popoverPointerActive = true;
      reportPopoverActivity();
    };
    const onPopoverPointerOut = (event) => {
      if (lastReady?.surface !== "popover" || event.relatedTarget !== null || !popoverPointerActive)
        return;
      popoverPointerActive = false;
      reportPopoverActivity();
    };
    const onPopoverFocus = () => {
      if (lastReady?.surface !== "popover" || popoverFocusActive)
        return;
      popoverFocusActive = true;
      reportPopoverActivity();
    };
    const onPopoverBlur = () => {
      if (lastReady?.surface !== "popover" || !popoverFocusActive)
        return;
      popoverFocusActive = false;
      reportPopoverActivity();
    };
    const requireIdentity = (value, maximum = 1024) => {
      if (!value.trim() || value.length > maximum)
        throw new HostRequestError("HOST_REJECTED", `Identity must contain 1 to ${maximum} characters.`);
    };
    const readWorkspace = async (query) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const result = await send({ ...envelope, type: "workspace-read", id: nextId(ids), payload: query });
      if (!result || !("kind" in result) || !("state" in result) || result.kind !== query.kind) {
        throw new HostRequestError("HOST_REJECTED", "Host did not return workspace data.");
      }
      return result;
    };
    const subscribeWorkspace = async (query, listener) => {
      if (query.kind !== "projects")
        requireIdentity(query.projectId);
      const subscriptionId = nextId(ids);
      workspaceListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "workspace-subscribe", id: nextId(ids), payload: { subscriptionId, query } });
      } catch (error) {
        workspaceListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!workspaceListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const subscribeShells = async (scope, listener) => {
      if (scope.kind === "session")
        requireIdentity(scope.sessionId);
      if (scope.kind === "project")
        requireIdentity(scope.projectId);
      const subscriptionId = nextId(ids);
      shellsListeners.set(subscriptionId, listener);
      try {
        await request({ ...envelope, type: "shells-subscribe", id: nextId(ids), payload: { subscriptionId, scope } });
      } catch (error) {
        shellsListeners.delete(subscriptionId);
        if (!disposed)
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        throw error;
      }
      return () => {
        if (!shellsListeners.delete(subscriptionId) || disposed)
          return;
        post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
      };
    };
    const storage = async (payload) => {
      if ("key" in payload && (payload.key.length === 0 || payload.key.length > GUEST_STORAGE_KEY_MAX)) {
        throw new HostRequestError("HOST_REJECTED", "Storage key must contain 1 to 128 characters.");
      }
      if (payload.op === "set" && !isJsonValue(payload.value)) {
        throw new HostRequestError("HOST_REJECTED", "Storage values must be JSON.");
      }
      if (payload.op === "set" && new TextEncoder().encode(JSON.stringify(payload.value)).length > GUEST_STORAGE_VALUE_BYTES) {
        throw new HostRequestError("HOST_REJECTED", "Storage value exceeds 64 KiB.");
      }
      if (payload.scope === "device" && lastReady?.features?.deviceStorage !== true) {
        throw new HostRequestError("UNSUPPORTED", "This host does not support device storage.");
      }
      const result = await send({ ...envelope, type: "storage", id: nextId(ids), payload });
      if (!result || !("storage" in result) || result.op !== payload.op)
        throw new HostRequestError("HOST_REJECTED", "Host did not return storage data.");
      return result;
    };
    const closePopover = (id, reason) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-close", id: nextId(ids), payload: reason ? { id, reason } : { id } });
    const setPopoverAnchorActive = (id, active2) => lastReady?.features?.popovers !== true && !(lastReady?.surface === "popover" && lastReady.popover?.id === id) ? Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers.")) : request({ ...envelope, type: "popover-anchor", id: nextId(ids), payload: { id, active: active2 } });
    target.addEventListener("keydown", onPopoverEscape, true);
    target.addEventListener("pointerover", onPopoverPointerOver);
    target.addEventListener("pointermove", onPopoverPointerOver);
    target.addEventListener("pointerout", onPopoverPointerOut);
    target.addEventListener("focus", onPopoverFocus);
    target.addEventListener("blur", onPopoverBlur);
    return {
      onAction: (handler) => {
        actionHandler = handler;
        return () => {
          if (actionHandler === handler)
            actionHandler = null;
        };
      },
      listProjects: async () => {
        const result = await readWorkspace({ kind: "projects" });
        if (result.kind !== "projects")
          throw new HostRequestError("HOST_REJECTED", "Expected projects.");
        return result;
      },
      listWorktrees: async (projectId) => {
        const result = await readWorkspace({ kind: "worktrees", projectId });
        if (result.kind !== "worktrees")
          throw new HostRequestError("HOST_REJECTED", "Expected worktrees.");
        return result;
      },
      listSessions: async (projectId) => {
        const result = await readWorkspace({ kind: "sessions", projectId });
        if (result.kind !== "sessions")
          throw new HostRequestError("HOST_REJECTED", "Expected sessions.");
        return result;
      },
      onProjects: (listener) => subscribeWorkspace({ kind: "projects" }, (snapshot) => {
        if (snapshot.kind === "projects")
          listener(snapshot);
      }),
      onWorktrees: (projectId, listener) => subscribeWorkspace({ kind: "worktrees", projectId }, (snapshot) => {
        if (snapshot.kind === "worktrees")
          listener(snapshot);
      }),
      onSessions: (projectId, listener) => subscribeWorkspace({ kind: "sessions", projectId }, (snapshot) => {
        if (snapshot.kind === "sessions")
          listener(snapshot);
      }),
      onRunningShells: (scope, listener) => subscribeShells(scope, listener),
      readShellOutput: async (shellId, options2) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const cursor = options2?.cursor;
        if (cursor !== void 0 && (!Number.isInteger(cursor) || cursor < 0)) {
          throw new HostRequestError("HOST_REJECTED", "Shell output cursor must be a non-negative integer.");
        }
        const tailBytes = options2?.tailBytes;
        if (tailBytes !== void 0 && (!Number.isInteger(tailBytes) || tailBytes < 1 || tailBytes > GUEST_SHELL_OUTPUT_TAIL_MAX)) {
          throw new HostRequestError("HOST_REJECTED", `Shell output tailBytes must be an integer between 1 and ${GUEST_SHELL_OUTPUT_TAIL_MAX}.`);
        }
        const result = await send({ ...envelope, type: "shell-output", id: nextId(ids), payload: { shellId, cursor, tailBytes } });
        const output = result;
        if (!output || typeof output.output !== "string" || !Number.isFinite(output.cursor)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return shell output.");
        }
        return output;
      },
      stopShell: async (shellId) => {
        requireIdentity(shellId, GUEST_SHELL_ID_MAX);
        const result = await send({ ...envelope, type: "shell-stop", id: nextId(ids), payload: { shellId } });
        if (result?.stopped !== true)
          throw new HostRequestError("HOST_REJECTED", "Host did not stop the shell.");
        return { stopped: true };
      },
      openSession: async (sessionId) => {
        requireIdentity(sessionId);
        await request({ ...envelope, type: "open-session", id: nextId(ids), payload: { sessionId } });
      },
      storage: {
        get: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "get", key };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          return result.op === "get" && result.found ? result.value : void 0;
        },
        set: async (key, value, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "set", key, value };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        delete: async (key, options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "delete", key };
          if (scope)
            payload.scope = scope;
          await storage(payload);
        },
        keys: async (options2) => {
          const scope = deviceStorageScope(options2);
          const payload = { op: "keys" };
          if (scope)
            payload.scope = scope;
          const result = await storage(payload);
          if (result.op !== "keys")
            throw new HostRequestError("HOST_REJECTED", "Expected storage keys.");
          return result.keys;
        }
      },
      onReady: (listener) => {
        readyListeners.add(listener);
        if (lastReady)
          listener(lastReady);
        return () => {
          readyListeners.delete(listener);
        };
      },
      onDirectory: (listener) => {
        directoryListeners.add(listener);
        if (lastReady)
          listener(lastReady.directory);
        return () => {
          directoryListeners.delete(listener);
        };
      },
      onSession: (listener) => {
        sessionListeners.add(listener);
        if (lastReady)
          listener(lastReady.session);
        return () => {
          sessionListeners.delete(listener);
        };
      },
      onSessionLifecycle: (listener) => {
        lifecycleListeners.add(listener);
        if (lastLifecycle)
          listener(lastLifecycle);
        return () => {
          lifecycleListeners.delete(listener);
        };
      },
      onConnection: (listener) => {
        connectionListeners.add(listener);
        if (lastReady)
          listener(lastReady.connection);
        return () => {
          connectionListeners.delete(listener);
        };
      },
      onSettings: (listener) => {
        settingsListeners.add(listener);
        if (lastReady)
          listener(lastReady.settings);
        return () => {
          settingsListeners.delete(listener);
        };
      },
      onItem: (listener) => {
        itemListeners.add(listener);
        if (lastReady)
          listener(lastReady.item);
        return () => {
          itemListeners.delete(listener);
        };
      },
      onBlock: (listener) => {
        blockListeners.add(listener);
        if (lastReady?.block)
          listener(lastReady.block);
        return () => {
          blockListeners.delete(listener);
        };
      },
      onServiceEvent: (listener) => {
        serviceEventListeners.add(listener);
        return () => {
          serviceEventListeners.delete(listener);
        };
      },
      onStatusControl: (listener) => {
        statusControlListeners.add(listener);
        return () => {
          statusControlListeners.delete(listener);
        };
      },
      onPopoverClosed: (listener) => {
        popoverClosedListeners.add(listener);
        return () => {
          popoverClosedListeners.delete(listener);
        };
      },
      setStatusControls: (controls) => {
        if (lastReady?.features?.statusControls !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support status controls."));
        }
        if (!isGuestStatusControls(controls)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Status controls must have unique bounded ids and valid selected options."));
        }
        return request({ ...envelope, type: "status-controls", id: nextId(ids), payload: { controls } });
      },
      openPopover: (payload) => {
        if (lastReady?.features?.popovers !== true) {
          return Promise.reject(new HostRequestError("UNSUPPORTED", "This host does not support popovers."));
        }
        if (!isGuestPopoverRequest(payload)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "Popover requests need bounded geometry and JSON data."));
        }
        return request({ ...envelope, type: "popover-open", id: nextId(ids), payload });
      },
      closePopover,
      setPopoverAnchorActive,
      onResolve: (handler) => {
        resolveHandler = handler;
        return () => {
          if (resolveHandler === handler)
            resolveHandler = null;
        };
      },
      toast: (payload) => {
        const message = payload.message.trim();
        if (!message || message.length > GUEST_TOAST_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast message must contain 1 to ${GUEST_TOAST_MAX} characters.`));
        }
        if (payload.copy && payload.copy !== true && (!payload.copy.text.length || payload.copy.text.length > GUEST_CLIPBOARD_TEXT_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Toast copy text must contain 1 to ${GUEST_CLIPBOARD_TEXT_MAX} characters.`));
        }
        return request({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "toast",
          id: nextId(ids),
          payload: { ...payload, message }
        });
      },
      openUrl: (url) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-url",
        id: nextId(ids),
        payload: { url }
      }),
      openCommit: (sha) => isGuestCommitSha(sha) ? request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-commit",
        id: nextId(ids),
        payload: { sha }
      }) : Promise.reject(new HostRequestError("HOST_REJECTED", "Commit id must be 7 to 64 hex characters.")),
      answerBlock: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "block-answer",
        id: nextId(ids),
        payload: { text: text.trim().slice(0, GUEST_BLOCK_ANSWER_MAX) }
      }),
      openSurface: (surfaceId) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "open-surface",
        id: nextId(ids),
        payload: { surfaceId }
      }),
      writeClipboard: (text) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "clipboard-write",
        id: nextId(ids),
        payload: { text }
      }),
      compose: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "compose",
        id: nextId(ids),
        payload
      }),
      attach: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "attach",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      startSession: async (payload) => {
        if (payload.projectId !== void 0)
          requireIdentity(payload.projectId);
        const worktree = payload.worktree;
        if (worktree && worktree !== true) {
          if (worktree.kind === "existing")
            requireIdentity(worktree.directory);
          else {
            if (worktree.name !== void 0)
              requireIdentity(worktree.name, 200);
            if (worktree.baseBranch !== void 0)
              requireIdentity(worktree.baseBranch, 200);
          }
        }
        const result = await send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "start-session",
          id: nextId(ids),
          payload: clampStartSessionRequest(payload)
        }, options.requestTimeoutMs ?? 18e4);
        if (!isStartSessionResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a session.");
        }
        return result;
      },
      prompt: (payload) => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "prompt",
        id: nextId(ids),
        payload: clampPromptRequest(payload)
      }).then((result) => {
        if (!isPromptResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return a prompt result.");
        }
        return result;
      }),
      sessionLink: (payload) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "session-link",
        id: nextId(ids),
        payload: clampAttachRequest(payload)
      }),
      close: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "close",
        id: nextId(ids)
      }),
      oauthStart: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-start",
        id: nextId(ids)
      }),
      oauthDisconnect: () => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "oauth-disconnect",
        id: nextId(ids)
      }),
      request: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host request result was empty.");
        }
        return result;
      }),
      serviceRequest: (payload) => (isGuestRequestPath(payload.path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-request",
        id: nextId(ids),
        payload
      }) : rejectBadPath()).then((result) => {
        if (!isGuestRequestResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host service request result was empty.");
        }
        return result;
      }),
      serviceStatus: () => send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "service-status",
        id: nextId(ids)
      }).then((result) => {
        if (!isServiceStatusResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return service status.");
        }
        return result;
      }),
      readFile: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-read",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileReadResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file content.");
        }
        return result;
      }),
      writeFile: (path, content) => {
        if (!isGuestFilePath(path)) {
          return rejectBadFilePath();
        }
        if (content.length > GUEST_FILE_CONTENT_MAX) {
          return Promise.reject(new HostRequestError("FILE_TOO_LARGE", `Content is over ${GUEST_FILE_CONTENT_MAX} characters.`));
        }
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "file-write",
          id: nextId(ids),
          payload: { path, content }
        }).then((result) => {
          if (!isFileWriteResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not confirm the write.");
          }
          return result;
        });
      },
      listDir: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-list",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileListResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return directory entries.");
        }
        return result;
      }),
      stat: (path) => (isGuestFilePath(path) ? send({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "file-stat",
        id: nextId(ids),
        payload: { path }
      }) : rejectBadFilePath()).then((result) => {
        if (!isFileStatResult(result)) {
          throw new HostRequestError("HOST_REJECTED", "Host did not return file status.");
        }
        return result;
      }),
      generate: (input) => {
        const prompt = input.prompt.trim();
        const system = input.system?.trim();
        if (prompt.length === 0 || prompt.length > GUEST_GENERATE_PROMPT_MAX) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `Prompt must be 1 to ${GUEST_GENERATE_PROMPT_MAX} characters.`));
        }
        if (system !== void 0 && (system.length === 0 || system.length > GUEST_GENERATE_SYSTEM_MAX)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", `System prompt must be 1 to ${GUEST_GENERATE_SYSTEM_MAX} characters.`));
        }
        const maxOutputTokens = input.maxOutputTokens === void 0 ? void 0 : Math.min(GUEST_GENERATE_OUTPUT_TOKENS_MAX, Math.max(1, Math.floor(input.maxOutputTokens)));
        if (maxOutputTokens !== void 0 && !Number.isFinite(maxOutputTokens)) {
          return Promise.reject(new HostRequestError("HOST_REJECTED", "maxOutputTokens must be a number."));
        }
        const payload = { prompt };
        if (system !== void 0)
          payload.system = system;
        if (maxOutputTokens !== void 0)
          payload.maxOutputTokens = maxOutputTokens;
        return send({
          channel: OPENCHAMBER_SDK_CHANNEL,
          v: OPENCHAMBER_SDK_API_VERSION,
          type: "generate",
          id: nextId(ids),
          payload
        }, options.requestTimeoutMs ?? GUEST_GENERATE_TIMEOUT_MS).then((result) => {
          if (!isGenerateResult(result)) {
            throw new HostRequestError("HOST_REJECTED", "Host did not return generated text.");
          }
          return result;
        });
      },
      onLateGenerateResult: (listener) => {
        lateGenerateListeners.add(listener);
        for (const result of unclaimedLateGenerate.splice(0))
          emit([listener], result);
        listenForLateGenerate();
        return () => {
          lateGenerateListeners.delete(listener);
        };
      },
      setBadge: (count) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "badge",
        id: nextId(ids),
        payload: { count: clampBadgeCount(count) }
      }),
      setHeight: (height) => request({
        channel: OPENCHAMBER_SDK_CHANNEL,
        v: OPENCHAMBER_SDK_API_VERSION,
        type: "resize",
        id: nextId(ids),
        payload: { height: clampFrameHeight(height) }
      }),
      onFileOpen: (listener) => {
        fileOpenListeners.add(listener);
        if (!saveShortcutInstalled) {
          saveShortcutInstalled = true;
          target.addEventListener("keydown", onSaveShortcut, true);
        }
        if (lastFile)
          listener(lastFile);
        return () => {
          fileOpenListeners.delete(listener);
        };
      },
      onFileSnapshot: (handler) => {
        fileSnapshotHandler = handler;
        return () => {
          if (fileSnapshotHandler === handler)
            fileSnapshotHandler = null;
        };
      },
      onFileSaved: (listener) => {
        fileSavedListeners.add(listener);
        return () => {
          fileSavedListeners.delete(listener);
        };
      },
      reportFileChange: (change) => notify({ ...envelope, type: "file-change", payload: { dirty: change.dirty, edited: change.edited } }),
      requestFileSave,
      reportFileUnsupported: () => notify({ ...envelope, type: "file-unsupported" }),
      dispose: () => {
        for (const subscriptionId of workspaceListeners.keys()) {
          post({ ...envelope, type: "workspace-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        workspaceListeners.clear();
        for (const subscriptionId of shellsListeners.keys()) {
          post({ ...envelope, type: "shells-unsubscribe", id: nextId(ids), payload: { subscriptionId } });
        }
        shellsListeners.clear();
        disposed = true;
        resolveHandler = null;
        actionHandler = null;
        fileSnapshotHandler = null;
        fileOpenListeners.clear();
        fileSavedListeners.clear();
        if (saveShortcutInstalled)
          target.removeEventListener("keydown", onSaveShortcut, true);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("keydown", onPopoverEscape, true);
        target.removeEventListener("pointerover", onPopoverPointerOver);
        target.removeEventListener("pointermove", onPopoverPointerOver);
        target.removeEventListener("pointerout", onPopoverPointerOut);
        target.removeEventListener("focus", onPopoverFocus);
        target.removeEventListener("blur", onPopoverBlur);
        for (const waiter of pending.values()) {
          clearTimeout(waiter.timer);
          waiter.reject(new HostRequestError("HOST_UNAVAILABLE", "Host client was disposed."));
        }
        pending.clear();
        readyListeners.clear();
        directoryListeners.clear();
        sessionListeners.clear();
        lifecycleListeners.clear();
        connectionListeners.clear();
        settingsListeners.clear();
        itemListeners.clear();
        blockListeners.clear();
        serviceEventListeners.clear();
        statusControlListeners.clear();
        popoverClosedListeners.clear();
        lateGenerateListeners.clear();
        unclaimedLateGenerate.length = 0;
      }
    };
  };

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

  // node_modules/@openchamber/sdk/dist/ui/theme.js
  var TOKEN_VARS = [
    ["--oc-bg", "background"],
    ["--oc-elevated", "elevated"],
    ["--oc-fg", "foreground"],
    ["--oc-muted", "muted"],
    ["--oc-subtle", "subtle"],
    ["--oc-border", "border"],
    ["--oc-hover", "hover"],
    ["--oc-selection", "selection"],
    ["--oc-focus", "focus"],
    ["--oc-primary", "primary"],
    ["--oc-muted-surface", "mutedSurface"],
    ["--oc-elevated-fg", "elevatedForeground"],
    ["--oc-active", "active"],
    ["--oc-selection-fg", "selectionForeground"],
    ["--oc-primary-fg", "primaryForeground"],
    ["--oc-primary-text", "primaryText"],
    ["--oc-success-text", "successText"],
    ["--oc-warning-text", "warningText"],
    ["--oc-error-text", "errorText"],
    ["--oc-info-text", "infoText"],
    ["--oc-success", "success"],
    ["--oc-warning", "warning"],
    ["--oc-error", "error"],
    ["--oc-info", "info"],
    ["--oc-font", "font"],
    ["--oc-mono", "mono"],
    ["--oc-radius", "radius"],
    ["--surface-background", "background"],
    ["--surface-elevated", "elevated"],
    ["--surface-foreground", "foreground"],
    ["--surface-muted-foreground", "muted"],
    ["--surface-subtle", "subtle"],
    ["--interactive-border", "border"],
    ["--interactive-hover", "hover"],
    ["--interactive-selection", "selection"],
    ["--interactive-focus-ring", "focus"],
    ["--primary", "primary"],
    ["--surface-muted", "mutedSurface"],
    ["--surface-elevated-foreground", "elevatedForeground"],
    ["--interactive-active", "active"],
    ["--interactive-selection-foreground", "selectionForeground"],
    ["--primary-foreground", "primaryForeground"],
    ["--primary-text", "primaryText"],
    ["--success-text", "successText"],
    ["--warning-text", "warningText"],
    ["--error-text", "errorText"],
    ["--info-text", "infoText"],
    ["--status-success", "success"],
    ["--status-warning", "warning"],
    ["--status-error", "error"],
    ["--status-info", "info"],
    ["--font-sans", "font"],
    ["--font-mono", "mono"],
    ["--radius", "radius"]
  ];
  var SYNTAX_TOKEN_VARS = [
    ["--oc-syntax-keyword", "--syntax-keyword", "syntaxKeyword"],
    ["--oc-syntax-string", "--syntax-string", "syntaxString"],
    ["--oc-syntax-number", "--syntax-number", "syntaxNumber"],
    ["--oc-syntax-function", "--syntax-function", "syntaxFunction"],
    ["--oc-syntax-type", "--syntax-type", "syntaxType"],
    ["--oc-syntax-comment", "--syntax-comment", "syntaxComment"],
    ["--oc-syntax-variable", "--syntax-variable", "syntaxVariable"],
    ["--oc-syntax-operator", "--syntax-operator", "syntaxOperator"]
  ];
  var applyHostTheme = (theme, root) => {
    root.style.colorScheme = theme.mode;
    for (const [name, key] of TOKEN_VARS) {
      root.style.setProperty(name, theme.tokens[key]);
    }
    for (const [alias, hostName, key] of SYNTAX_TOKEN_VARS) {
      const value = theme.tokens[key] ?? "";
      root.style.setProperty(alias, value);
      root.style.setProperty(hostName, value);
    }
    root.style.setProperty("font-family", theme.tokens.font);
    root.style.setProperty("font-size", theme.tokens.fontSize ?? "0.875rem");
    root.style.setProperty("line-height", "1.45");
    root.style.setProperty("color", theme.tokens.foreground);
  };
  var applyHostReady = (ctx, root) => {
    applyHostTheme(ctx.theme, root);
    if (root.dataset) {
      root.dataset.ocSurface = ctx.surface;
      root.dataset.ocTheme = ctx.theme.mode;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/style.js
  var OC_ALIAS = {
    "surface-background": "bg",
    "surface-elevated": "elevated",
    "surface-elevated-foreground": "elevated-fg",
    "surface-foreground": "fg",
    "surface-muted-foreground": "muted",
    "surface-muted": "muted-surface",
    "surface-subtle": "subtle",
    "interactive-border": "border",
    "interactive-hover": "hover",
    "interactive-active": "active",
    "interactive-selection": "selection",
    "interactive-selection-foreground": "selection-fg",
    "interactive-focus-ring": "focus",
    "primary": "primary",
    "primary-foreground": "primary-fg",
    "primary-text": "primary-text",
    "success-text": "success-text",
    "warning-text": "warning-text",
    "error-text": "error-text",
    "info-text": "info-text",
    "status-success": "success",
    "status-warning": "warning",
    "status-error": "error",
    "status-info": "info",
    "font-sans": "font",
    "font-mono": "mono",
    "radius": "radius"
  };
  var v = (name, fallback) => `var(--${name}, var(--oc-${OC_ALIAS[name]}, ${fallback}))`;
  var bg = v("surface-background", "transparent");
  var elevated = v("surface-elevated", "transparent");
  var elevatedFg = v("surface-elevated-foreground", "inherit");
  var fg = v("surface-foreground", "inherit");
  var muted = v("surface-muted-foreground", "gray");
  var secondary = v("surface-muted", "transparent");
  var border = v("interactive-border", "currentColor");
  var hover = v("interactive-hover", "transparent");
  var active = v("interactive-active", "transparent");
  var selection = v("interactive-selection", "transparent");
  var selectionFg = v("interactive-selection-foreground", "inherit");
  var primary = v("primary", "currentColor");
  var primaryText = v("primary-text", "inherit");
  var errorText = v("error-text", "inherit");
  var font = v("font-sans", "inherit");
  var mono = v("font-mono", "monospace");
  var radius = v("radius", "9px");
  var controlRadius = `calc(${radius} - 2px)`;
  var smallRadius = `calc(${radius} - 4px)`;
  var mix = (color, pct, base = "transparent") => `color-mix(in srgb, ${color} ${pct}%, ${base})`;
  var focusFill = `background-image: linear-gradient(${hover}, ${hover});`;
  var field = (edge, width = "0.5px") => `box-shadow: inset 0 0 0 ${width} ${edge}, var(--oc-sdk-field-lift);`;
  var raised = "border-color: var(--oc-sdk-edge); box-shadow: var(--oc-sdk-raised-lift);";
  var litButton = "box-shadow: var(--oc-sdk-lit);";
  var darkLift = `inset 0 0.5px 0 0 ${mix(fg, 8)}, 0 1px 2px 0 rgb(0 0 0 / 0.4)`;
  var THEME_VARS = `
:root {
  --oc-sdk-edge: ${mix(fg, 16)};
  --oc-sdk-field-bg: ${elevated};
  --oc-sdk-raised-bg: ${bg};
  --oc-sdk-field-lift: inset 0 1px 2px 0 rgb(0 0 0 / 0.04);
  --oc-sdk-raised-lift: 0 1px 1.5px 0 rgb(0 0 0 / 0.08);
  --oc-sdk-lit: inset 0 1px 0 0 rgb(255 255 255 / 0.2), 0 1px 1.5px 0 rgb(0 0 0 / 0.1);
  --oc-sdk-float-edge: rgb(0 0 0 / 0.14);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.7), 0 1px 2px -0.5px rgb(0 0 0 / 0.06), 0 4px 8px -2px rgb(0 0 0 / 0.08), 0 12px 20px -4px rgb(0 0 0 / 0.06);
}
:root[data-oc-theme="dark"] {
  --oc-sdk-edge: ${mix(fg, 14)};
  --oc-sdk-field-bg: ${mix(bg, 50, elevated)};
  --oc-sdk-raised-bg: ${elevated};
  --oc-sdk-field-lift: ${darkLift};
  --oc-sdk-raised-lift: ${darkLift};
  --oc-sdk-lit: ${darkLift};
  --oc-sdk-float-edge: rgb(0 0 0 / 0.55);
  --oc-sdk-float: inset 0 1px 0 0 rgb(255 255 255 / 0.04), inset 0 0 0 0.5px rgb(255 255 255 / 0.08), 0 8px 16px 0 rgb(0 0 0 / 0.25), 0 4px 8px 0 rgb(0 0 0 / 0.25);
}`;
  var tone = (name) => {
    const color = v(`status-${name}`, "currentColor");
    return `
.oc-sdk[data-tone="${name}"], .oc-sdk [data-tone="${name}"] { --oc-sdk-tone: ${color}; --oc-sdk-tone-text: ${v(`${name}-text`, "inherit")}; }`;
  };
  var len = (px) => `calc(${px}rem / 14)`;
  var UI_SIZE_CSS = `
.oc-sdk { box-sizing: border-box; font-size: 0.875rem; line-height: 1.45; }
.oc-sdk *, .oc-sdk *::before, .oc-sdk *::after { box-sizing: border-box; }
/* :where() keeps the reset at zero specificity so every primitive class below overrides it. */
:where(.oc-sdk) :where(button, input, textarea), :where(button.oc-sdk, input.oc-sdk, textarea.oc-sdk) { font: inherit; color: inherit; margin: 0; }
:where(.oc-sdk) :where(button), :where(button.oc-sdk) { cursor: pointer; background: none; border: 0; padding: 0; }
.oc-sdk button:disabled, button.oc-sdk:disabled, .oc-sdk[aria-disabled="true"], .oc-sdk [aria-disabled="true"] { opacity: .5; pointer-events: none; }

.oc-sdk-btn { display: inline-flex; align-items: center; justify-content: center; gap: ${len(8)}; height: ${len(32)}; padding: 0 ${len(12)}; border: 1px solid transparent; font-size: 0.875rem; font-weight: 500; line-height: 1; white-space: nowrap; }
.oc-sdk-btn[data-size="sm"] { gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; font-size: 0.8125rem; }
.oc-sdk-btn[data-size="xs"] { gap: ${len(4)}; height: ${len(24)}; padding: 0 ${len(8)}; font-size: 0.75rem; }
.oc-sdk-btn[data-loading="true"] { opacity: .5; pointer-events: none; }
.oc-sdk-btn > .oc-sdk-spinner-ring { width: ${len(14)}; height: ${len(14)}; }

.oc-sdk-field { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-field-label { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-field-note { font-size: 0.75rem; }
.oc-sdk-input { display: block; width: 100%; min-width: 0; height: ${len(32)}; padding: 0 ${len(10)}; border: 0; font-size: 0.875rem; line-height: 1.45; appearance: none; }
textarea.oc-sdk-input { height: auto; padding: ${len(8)} ${len(10)}; resize: vertical; }

.oc-sdk-search { position: relative; min-width: 0; }
.oc-sdk-search .oc-sdk-input { padding-left: ${len(34)}; padding-right: ${len(34)}; }
.oc-sdk-search-icon { position: absolute; left: ${len(11)}; top: 50%; transform: translateY(-50%); pointer-events: none; }
.oc-sdk-search-clear { position: absolute; right: ${len(6)}; top: 50%; transform: translateY(-50%); display: none; align-items: center; justify-content: center; width: ${len(24)}; height: ${len(24)}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-clear { display: inline-flex; }

.oc-sdk-select { position: relative; display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-trigger { display: inline-flex; align-items: center; gap: ${len(6)}; align-self: flex-start; width: auto; max-width: 100%; min-width: 0; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; text-align: left; }
.oc-sdk-trigger-value { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-trigger-chevron { flex: 0 0 auto; }
.oc-sdk-popup { position: fixed; z-index: 50; display: flex; flex-direction: column; gap: ${len(2)}; min-width: ${len(160)}; max-width: calc(100vw - ${len(16)}); max-height: min(${len(320)}, calc(100vh - ${len(16)})); overflow: auto; padding: ${len(4)}; border: 1px solid transparent; }
.oc-sdk-popup-search { flex: 0 0 auto; padding: ${len(2)} ${len(2)} ${len(4)}; }
.oc-sdk-popup-search .oc-sdk-input { height: ${len(28)}; font-size: 0.8125rem; }
.oc-sdk-option { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; font-size: 0.8125rem; text-align: left; }
.oc-sdk-option-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-option-hint { flex: 0 0 auto; font-size: 0.75rem; }
.oc-sdk-option-check { flex: 0 0 auto; display: inline-flex; width: ${len(14)}; visibility: hidden; }
.oc-sdk-option[aria-selected="true"] > .oc-sdk-option-check { visibility: visible; }
.oc-sdk-popup-empty { padding: ${len(8)}; font-size: 0.8125rem; }

.oc-sdk-check { display: inline-flex; align-items: flex-start; gap: ${len(8)}; width: 100%; text-align: left; }
.oc-sdk-check-box { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: ${len(14)}; height: ${len(14)}; margin-top: ${len(3)}; border: 1px solid transparent; }
.oc-sdk-check-box > svg { display: none; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box > svg { display: block; }
.oc-sdk-check-thumb { flex: 0 0 auto; position: relative; width: ${len(36)}; height: ${len(20)}; --oc-sdk-thumb-travel: ${len(16)}; }
.oc-sdk-check-thumb::after { content: ""; position: absolute; top: ${len(2)}; left: ${len(2)}; width: ${len(16)}; height: ${len(16)}; }
.oc-sdk-check-text { display: flex; flex-direction: column; min-width: 0; }
.oc-sdk-check-label { font-size: 0.875rem; }
.oc-sdk-check-desc { font-size: 0.75rem; }

.oc-sdk-tabs { display: inline-flex; gap: ${len(2)}; padding: ${len(2)}; max-width: 100%; overflow: auto; }
.oc-sdk-tab { display: inline-flex; align-items: center; gap: ${len(6)}; height: ${len(28)}; padding: 0 ${len(10)}; border: 1px solid transparent; font-size: 0.8125rem; font-weight: 500; white-space: nowrap; }
.oc-sdk-tab-count { font-size: 0.75rem; font-variant-numeric: tabular-nums; }

.oc-sdk-badge { display: inline-flex; align-items: center; padding: ${len(1)} ${len(6)}; font-size: ${len(11)}; font-weight: 500; line-height: ${len(16)}; white-space: nowrap; }

.oc-sdk-list { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.oc-sdk-row { display: flex; align-items: center; gap: ${len(8)}; width: 100%; padding: ${len(6)} ${len(8)}; text-align: left; }
.oc-sdk-row-lead { flex: 0 0 auto; width: ${len(64)}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
.oc-sdk-row-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oc-sdk-row-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.75rem; }
.oc-sdk-row-meta { flex: 0 0 auto; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-list-empty { padding: ${len(16)} ${len(8)}; text-align: center; font-size: 0.8125rem; }

.oc-sdk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: ${len(4)}; padding: ${len(40)} ${len(16)}; text-align: center; }
.oc-sdk-empty-title { margin: 0; font-size: 0.8125rem; font-weight: 600; }
.oc-sdk-empty-body { margin: 0; max-width: 32rem; font-size: 0.8125rem; }
.oc-sdk-empty-action { margin-top: ${len(12)}; }

@keyframes oc-sdk-spin { to { transform: rotate(360deg); } }
.oc-sdk-spinner { display: inline-flex; align-items: center; gap: ${len(8)}; font-size: 0.8125rem; }
.oc-sdk-spinner-ring { width: ${len(16)}; height: ${len(16)}; border: 2px solid transparent; animation: oc-sdk-spin .8s linear infinite; }
.oc-sdk-spinner[data-size="sm"] .oc-sdk-spinner-ring { width: ${len(12)}; height: ${len(12)}; }

.oc-sdk-banner { display: flex; align-items: flex-start; gap: ${len(12)}; padding: ${len(8)} ${len(12)}; border: 1px solid transparent; }
.oc-sdk-banner-text { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: ${len(2)}; }
.oc-sdk-banner-title { font-size: 0.8125rem; font-weight: 500; }
.oc-sdk-banner-body { font-size: 0.8125rem; }
.oc-sdk-banner-action { flex: 0 0 auto; }

.oc-sdk-separator { display: flex; align-items: center; gap: ${len(8)}; width: 100%; margin: ${len(8)} 0; font-size: 0.75rem; }
.oc-sdk-separator::before, .oc-sdk-separator::after { content: ""; flex: 1 1 auto; height: 1px; }
.oc-sdk-separator[data-labeled="false"]::after { display: none; }
.oc-sdk-popup > .oc-sdk-separator { margin: ${len(4)} 0; }

.oc-sdk-progress { display: flex; flex-direction: column; gap: ${len(4)}; min-width: 0; }
.oc-sdk-progress-label { display: flex; justify-content: space-between; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
.oc-sdk-progress-track { height: ${len(6)}; overflow: hidden; }
.oc-sdk-progress-fill { height: 100%; transform-origin: left; transition: transform 200ms ease-out; }
.oc-sdk-progress-value { display: inline-flex; align-items: center; gap: ${len(2)}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { font-weight: 600; }

.oc-sdk-menu { position: relative; display: inline-flex; }

.oc-sdk-text { white-space: pre-wrap; overflow-wrap: anywhere; }
.oc-sdk-text img { display: block; max-width: 100%; margin: ${len(8)} 0; }

/* Under a finger the controls reach the app's touch sizes: rows and options 44px like its sheets, every other
   control at least 36px. Inputs keep 16px text, below which iOS zooms the page on focus. */
@media (pointer: coarse) {
  .oc-sdk-btn, .oc-sdk-input { height: ${len(40)}; }
  .oc-sdk-btn[data-size="sm"], .oc-sdk-btn[data-size="xs"], .oc-sdk-trigger, .oc-sdk-tab, .oc-sdk-popup-search .oc-sdk-input { height: ${len(36)}; }
  .oc-sdk-input, .oc-sdk-popup-search .oc-sdk-input { font-size: max(16px, 0.875rem); }
  .oc-sdk-search-clear { width: ${len(36)}; height: ${len(36)}; right: 0; }
  .oc-sdk-row, .oc-sdk-option { min-height: ${len(44)}; }
  .oc-sdk-check { min-height: ${len(36)}; padding: ${len(8)} 0; }
}
`;
  var GUEST_UI_LOOK_CSS = `${THEME_VARS}
.oc-sdk { color: ${fg}; font-family: ${font}; }
.oc-sdk :focus-visible, .oc-sdk:focus-visible { outline: none; }
.oc-sdk :where(button, a[href], [role="button"], [role="tab"], [role="option"]):focus-visible, button.oc-sdk:focus-visible { ${focusFill} }
.oc-sdk-mono { font-family: ${mono}; }
.oc-sdk-muted { color: ${muted}; }
${tone("success")}${tone("warning")}${tone("error")}${tone("info")}
.oc-sdk[data-tone="primary"], .oc-sdk [data-tone="primary"] { --oc-sdk-tone: ${primary}; --oc-sdk-tone-text: ${primaryText}; }

.oc-sdk-btn { border-radius: ${controlRadius}; transition: background 150ms ease-out, color 150ms ease-out; }
.oc-sdk-btn[data-size="xs"] { border-radius: ${smallRadius}; }
.oc-sdk-btn[data-variant="default"] { color: ${primaryText}; background: ${mix(primary, 10, bg)}; border-color: ${mix(primary, 12)}; ${litButton} }
.oc-sdk-btn[data-variant="default"]:hover { background: ${mix(primary, 16, bg)}; }
.oc-sdk-btn[data-variant="default"]:active { background: ${mix(primary, 22, bg)}; box-shadow: none; }
.oc-sdk-btn[data-variant="secondary"] { background: ${secondary}; color: var(--oc-fg); }
.oc-sdk-btn[data-variant="secondary"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="secondary"]:active { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-btn[data-variant="outline"] { background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} }
.oc-sdk-btn[data-variant="outline"]:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-btn[data-variant="outline"]:active { background-image: linear-gradient(${active}, ${active}); box-shadow: none; }
.oc-sdk-btn[data-variant="ghost"] { background: transparent; }
.oc-sdk-btn[data-variant="ghost"]:hover { background: ${hover}; }
.oc-sdk-btn[data-variant="ghost"]:active { background: ${active}; }
.oc-sdk-btn[data-variant="destructive"] { --oc-sdk-tone: ${v("status-error", "red")}; color: ${errorText}; background: ${mix("var(--oc-sdk-tone)", 7, bg)}; border-color: ${mix("var(--oc-sdk-tone)", 12)}; ${litButton} }
.oc-sdk-btn[data-variant="destructive"]:hover { background: ${mix("var(--oc-sdk-tone)", 9, bg)}; }
.oc-sdk-btn[data-variant="destructive"]:active { background: ${mix("var(--oc-sdk-tone)", 11, bg)}; box-shadow: none; }

.oc-sdk-field-note { color: ${muted}; }
.oc-sdk-field[data-invalid="true"] .oc-sdk-field-note { color: ${errorText}; }
.oc-sdk-input { border-radius: ${controlRadius}; background: var(--oc-sdk-field-bg); color: ${elevatedFg}; ${field("var(--oc-sdk-edge)")} transition: background 150ms ease-out; }
.oc-sdk-input::placeholder { color: ${muted}; }
.oc-sdk-input:hover:not(:focus) { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-input:focus, .oc-sdk-input:focus-visible { ${field(mix(fg, 26), "1px")} }
.oc-sdk-field[data-invalid="true"] .oc-sdk-input, .oc-sdk-field[data-invalid="true"] .oc-sdk-input:focus { ${field(v("status-error", "red"), "1px")} }
.oc-sdk-input[data-mono="true"] { font-family: ${mono}; }

.oc-sdk-search-icon { color: ${muted}; }
.oc-sdk-search[data-active="true"] .oc-sdk-search-icon { color: ${primary}; }
.oc-sdk-search-clear { border-radius: ${smallRadius}; color: ${muted}; }
.oc-sdk-search-clear:hover { background: ${hover}; color: ${fg}; }

.oc-sdk-trigger { border-radius: ${controlRadius}; background: var(--oc-sdk-raised-bg); color: ${elevatedFg}; ${raised} transition: background 150ms ease-out; }
.oc-sdk-trigger:hover { background-image: linear-gradient(${hover}, ${hover}); }
.oc-sdk-trigger[aria-expanded="true"] { background-image: linear-gradient(${active}, ${active}); }
.oc-sdk-trigger-value[data-empty="true"] { color: ${muted}; }
.oc-sdk-trigger-chevron { color: ${muted}; }
/* The app's floating level: the glass edge (a hairline ring and a lit top line, dark outside and light inside in dark themes) over soft shadows. The outer ring is the border, over the page like the app's. */
.oc-sdk-popup { --surface-foreground: ${elevatedFg}; border-color: var(--oc-sdk-float-edge); border-radius: 12px; background: ${elevated}; background-clip: padding-box; color: ${elevatedFg}; box-shadow: var(--oc-sdk-float); }
.oc-sdk-option { border-radius: 8px; }
.oc-sdk-option[data-active="true"] { background: ${hover}; }
/* A selected option shows a check mark in the text colour, like the app's own pickers. Options without the mark come
   from bundles built before it existed and keep the selection fill as their only sign of the choice. */
.oc-sdk-option[aria-selected="true"]:not([data-mark]) { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-option-check { color: ${fg}; }
.oc-sdk-option[data-destructive="true"] { color: ${errorText}; }
.oc-sdk-option[data-destructive="true"][data-active="true"] { background: ${mix(v("status-error", "red"), 10)}; }
.oc-sdk-option-hint { color: ${muted}; }
.oc-sdk-popup-empty { color: ${muted}; }

/* Checked stays neutral: the mark carries the state, and the primary colour stays with primary actions. */
.oc-sdk-check-box { border-color: ${border}; border-radius: 4px; color: ${fg}; transition: border-color 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-box { border-color: ${mix(fg, 60, border)}; }
.oc-sdk-check-thumb { border-radius: 9999px; background: ${border}; transition: background 150ms ease-out; }
.oc-sdk-check-thumb::after { border-radius: 9999px; background: ${bg}; transition: transform 150ms ease-out; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb { background: ${primary}; }
.oc-sdk-check[aria-checked="true"] .oc-sdk-check-thumb::after { transform: translateX(var(--oc-sdk-thumb-travel, 16px)); }
.oc-sdk-check:focus-visible { box-shadow: none; }
.oc-sdk-check:focus-visible .oc-sdk-check-box, .oc-sdk-check:focus-visible .oc-sdk-check-thumb { ${focusFill} }
.oc-sdk-check-desc { color: ${muted}; }

.oc-sdk-tabs { border-radius: 10px; }
.oc-sdk-tabs[data-track="true"] { background: ${mix(fg, 4)}; box-shadow: inset 0 1px 2px 0 rgb(0 0 0 / 0.16); }
.oc-sdk-tab { border-radius: 8px; color: ${muted}; transition: color 150ms ease-out, background 150ms ease-out; }
.oc-sdk-tab:hover { color: ${fg}; }
.oc-sdk-tab[aria-selected="true"] { color: ${selectionFg}; background: ${selection}; border-color: ${border}; }
.oc-sdk-tabs[data-track="true"] .oc-sdk-tab[aria-selected="true"] { color: ${elevatedFg}; background: var(--oc-sdk-raised-bg); ${raised} }
.oc-sdk-tab-count { color: ${muted}; }

/* The app's neutral badge: a step of the text colour, the same in every theme. */
.oc-sdk-badge { border-radius: 9999px; background: ${mix(fg, 6)}; color: ${muted}; }
.oc-sdk-badge[data-tone] { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); background: ${mix("var(--oc-sdk-tone)", 15)}; }

.oc-sdk-row { border-radius: 6px; transition: background 120ms ease-out; }
.oc-sdk-row:hover, .oc-sdk-row[data-active="true"] { background: ${hover}; }
.oc-sdk-row[aria-selected="true"] { background: ${selection}; color: ${selectionFg}; }
.oc-sdk-row-lead { font-family: ${mono}; color: ${muted}; }
.oc-sdk-row-sub { color: ${muted}; }
.oc-sdk-row-meta { color: ${muted}; }
.oc-sdk-row[aria-selected="true"] .oc-sdk-row-lead, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-sub, .oc-sdk-row[aria-selected="true"] .oc-sdk-row-meta { color: inherit; opacity: .75; }
.oc-sdk-list-empty { color: ${muted}; }

.oc-sdk-empty-body { color: ${muted}; }

.oc-sdk-spinner { color: ${muted}; }
.oc-sdk-spinner-ring { border-color: ${border}; border-top-color: ${primary}; border-radius: 9999px; }

/* Set apart by its tint alone, like the app's banners. */
.oc-sdk-banner { border-color: transparent; border-radius: 8px; background: ${mix("var(--oc-sdk-tone)", 10)}; }
.oc-sdk-banner-title { color: var(--oc-sdk-tone-text, var(--oc-sdk-tone)); }
.oc-sdk-banner-body { color: ${muted}; }

.oc-sdk-separator { color: ${muted}; }
.oc-sdk-separator::before, .oc-sdk-separator::after { background: ${mix(border, 40)}; }

.oc-sdk-progress-label { color: ${muted}; }
/* The app's progress: a groove a step of the text colour, green once done. Older bundles mark done only through aria-valuenow. */
.oc-sdk-progress-track { border-radius: 9999px; background: ${mix(fg, 6)}; }
.oc-sdk-progress-fill { border-radius: 9999px; background: var(--oc-sdk-tone, ${primary}); }
.oc-sdk-progress-track[aria-valuenow="100"] > .oc-sdk-progress-fill:not([data-tone]) { background: ${v("status-success", "currentColor")}; }
.oc-sdk-progress[data-done="true"] .oc-sdk-progress-value { color: ${v("success-text", "inherit")}; }

.oc-sdk-text a { color: ${primaryText}; text-decoration: underline; text-underline-offset: 2px; }
.oc-sdk-text img { border-radius: 8px; border: 1px solid ${mix(border, 60)}; }
`;
  var UI_CSS = `
${GUEST_SCROLLBAR_CSS}
${UI_SIZE_CSS}
${GUEST_UI_LOOK_CSS}`;

  // node_modules/@openchamber/sdk/dist/ui/dom.js
  var STYLE_ID = "oc-sdk-ui-style";
  var ensureStyle = (css) => {
    const existing = document.getElementById(STYLE_ID);
    if (existing instanceof HTMLStyleElement) {
      if (existing.textContent !== css) {
        existing.textContent = css;
      }
      return;
    }
    installGuestScrollbarActivity(document);
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = css;
    document.head.appendChild(style);
  };
  var el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    return node;
  };
  var button = (className) => {
    const node = el("button", className);
    node.type = "button";
    return node;
  };
  var setText = (node, text) => {
    const next = text ?? "";
    if (node.textContent !== next) {
      node.textContent = next;
    }
  };

  // node_modules/@openchamber/sdk/dist/ui/button.js
  var ring = () => {
    const spinner = document.createElement("span");
    spinner.className = "oc-sdk-spinner-ring";
    spinner.setAttribute("aria-hidden", "true");
    return spinner;
  };
  var mountButton = (root, initial) => {
    ensureStyle(UI_CSS);
    let props = initial;
    const node = button("oc-sdk oc-sdk-btn");
    const spinner = ring();
    const label = document.createElement("span");
    node.append(label);
    root.append(node);
    const paint = () => {
      node.dataset.variant = props.variant ?? "default";
      node.dataset.size = props.size ?? "default";
      node.disabled = Boolean(props.disabled) || Boolean(props.loading);
      node.dataset.loading = props.loading ? "true" : "false";
      node.setAttribute("aria-busy", props.loading ? "true" : "false");
      if (props.loading && spinner.parentNode !== node) {
        node.prepend(spinner);
      } else if (!props.loading && spinner.parentNode === node) {
        spinner.remove();
      }
      setText(label, props.label);
    };
    const onClick = () => {
      if (props.disabled || props.loading) {
        return;
      }
      props.onClick();
    };
    node.addEventListener("click", onClick);
    paint();
    return {
      update: (next) => {
        props = { ...props, ...next };
        paint();
      },
      dispose: () => {
        node.removeEventListener("click", onClick);
        node.remove();
      }
    };
  };

  // src/reports/view.ts
  var escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  var metric = (value, suffix = "") => value == null ? "\u2014" : `${value.toFixed(2)}${suffix}`;
  var coverage = (record) => `${record.quality}${record.provenance?.estimated && record.quality !== "estimated" ? " estimated" : ""}${!record.provenance && record.quality === "partial" ? " (provenance unavailable)" : ""}`;
  var growthMetric = (record) => `${record.growth === null ? "" : record.provenance?.estimated || record.quality === "estimated" ? "~" : record.quality === "partial" && record.provenance ? "\u2265" : ""}${metric(record.growth, " pp")}`;
  var reportStyle = `
html{font-family:var(--font-sans,system-ui);color:var(--primary-text,#222);background:var(--surface-background,#fff)}body{margin:0;padding:14px;font-size:.875rem}*{box-sizing:border-box}main{max-width:1200px;margin:auto}h1{font-size:1.15rem;margin:0 0 4px}h2{font-size:1rem}p{line-height:1.5}small,.muted{color:var(--muted-text,#6b7280);font-size:.8rem}.toolbar,.buttons{display:flex;flex-wrap:wrap;gap:8px;align-items:end;margin:12px 0}.toolbar label{display:grid;gap:4px}input,select,textarea{font:inherit;color:inherit;background:var(--surface-elevated,#f5f5f5);border:1px solid var(--border,#ccc);border-radius:5px;padding:6px;max-width:100%}input[type=checkbox]{width:auto}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:12px 0}.metric{padding:10px;background:var(--surface-muted,#f3f4f6);border-radius:6px}.metric strong{display:block;font-variant-numeric:tabular-nums;font-size:1.2rem;margin-top:4px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{padding:9px 6px;text-align:left;vertical-align:top;border-bottom:1px solid var(--border,#ddd)}th{font-size:.75rem;color:var(--muted-text,#666);font-weight:500}td:first-child{white-space:nowrap}td:nth-child(3),td:nth-child(4){text-align:right;white-space:nowrap}tr[data-step]{background:color-mix(in srgb,var(--info-text,#3575c9) var(--heat),transparent)}.growth{color:var(--info-text,#245fae);font-variant-numeric:tabular-nums}.compactions{color:var(--success-text,#15754a);font-variant-numeric:tabular-nums}summary{cursor:pointer;overflow-wrap:anywhere}summary:focus-visible{outline:2px solid var(--focus,#2584d8)}.detail{font-size:.8rem;max-width:600px;overflow-wrap:anywhere}.detail pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;background:var(--surface-muted,#f5f5f5);padding:8px}.gap{color:var(--warning-text,#8a5b13)}#error{color:var(--error-text,#a43a3a);overflow-wrap:anywhere}#analysis-result{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.55}#pairing input{width:100%}[hidden]{display:none!important}body.compact{padding:4px 0}.compact h1,.compact .report-only{display:none}.compact .metrics{margin:4px 0;gap:4px}.compact .metric{padding:5px}.compact .metric strong{font-size:1rem}.spark{width:100%;height:34px}.pair-note{overflow-wrap:anywhere}@media(max-width:440px){body{padding:8px}.toolbar{align-items:stretch}.toolbar label{flex:1}th,td{padding:7px 4px;font-size:.78rem}.metric strong{font-size:1.05rem}}
`;

  // src/reports/activity.ts
  var paths = {
    thinking: '<path d="M6 14c-2-1-3-3-2-6 0-3 3-5 6-5 4 0 6 3 6 6 0 2-1 4-3 5v3H7v-3M7 10l2 2 4-5"/>',
    file: '<path d="M5 2h6l4 4v12H5zM11 2v5h4M8 10h4M8 13h4"/>',
    shell: '<rect x="2" y="3" width="16" height="14" rx="2"/><path d="m5 7 3 3-3 3m6 0h4"/>',
    patch: '<path d="M5 2h6l4 4v12H5zM11 2v5h4M8 11h4m-2-2v4"/>',
    compaction: '<path d="M3 3h14M3 17h14m2-11 5 4 5-4m-5-4v8M5 14l5-4 5 4m-5-4v8"/>',
    skill: '<path d="m10 2 2 5 5 3-5 2-2 6-2-6-5-2 5-3z"/>',
    subagent: '<circle cx="7" cy="6" r="3"/><path d="M2 17v-2c0-3 2-5 5-5 2 0 4 1 5 3m1 1 2 2 4-5"/>',
    text: '<path d="M3 3h14v11H8l-4 3v-3H3zM6 7h8M6 10h5"/>'
  };
  var icon2 = (a) => {
    const key = a.kind === "tool" ? { "Shell command": "shell", "Read file": "file", Patch: "patch", "Load skill": "skill", Subagent: "subagent" }[a.label] ?? "file" : a.kind;
    return `<span class="activity-icon" aria-hidden="true"><svg viewBox="0 0 20 20">${paths[key] ?? paths.text}</svg></span>`;
  };
  var measurementNotice = `<details class="measurement"><summary>About growth and request diagnostics</summary><p>Growth is measured at model-request boundaries, not separately for each tool or thinking entry. A measured increase is not proof that one activity alone caused it. \u201C\u2265\u201D is a partial lower bound, \u201C~\u201D is estimated, and \u201C\u2014\u201D is unavailable. Successful transport status stays in technical details; failures remain visible. IDs, measurement methods and coverage gaps remain available to analysis.</p></details>`;
  function activityOpen(a) {
    const status = a.status === "failed" || a.status === "interrupted" ? `<span class="activity-status ${a.status}">${escapeHtml(a.status)}</span>` : a.status === "running" || a.status === "streaming" ? `<span class="activity-status live">${escapeHtml(a.status)}</span>` : "";
    const duration = a.ended === void 0 ? "" : `<span class="duration">${Math.max(0, (a.ended - a.at) / 1e3).toFixed(1)} s</span>`;
    return `<details class="activity ${escapeHtml(a.kind)}" data-activity="${escapeHtml(a.id)}" data-kind="${escapeHtml(a.kind)}" data-status="${escapeHtml(a.status)}"><summary>${icon2(a)}<span class="activity-words"><span class="kind">${escapeHtml(a.label)}</span><span class="activity-title${["tool", "shell"].includes(a.kind) ? " code-title" : ""}">${escapeHtml(a.title)}</span></span><span class="activity-tail">${status}${duration}<span class="chevron">\u203A</span></span></summary><div class="activity-detail">${a.detail ? `<p class="gap">${escapeHtml(a.detail)}</p>` : ""}<div class="activity-body">`;
  }
  function activityClose(a) {
    return `</div><details class="technical"><summary>Technical details</summary><p>Activity ${escapeHtml(a.id)}${a.callId ? `<br>Call ${escapeHtml(a.callId)}` : ""}${a.messageId ? `<br>Request ${escapeHtml(a.messageId)}` : ""}<br>Turn ${a.turnNumber} \xB7 ${escapeHtml(a.status)}<br>${escapeHtml(new Date(a.at).toISOString())}</p></details></div></details>`;
  }
  var activityRow = (a) => activityOpen(a) + '<span class="muted">Expand to load captured content.</span>' + activityClose(a);
  function requestHeader(a, steps = []) {
    const last = steps.at(-1);
    const heading = steps.length ? `Request ${steps[0].turnNumber}.${steps[0].number}` : `Turn ${a.turnNumber}`;
    const diagnostics = steps.map((step) => `<p>${escapeHtml(step.id)} \xB7 ${escapeHtml(step.model)} \xB7 ${escapeHtml(coverage(step))}${step.attempt ? `<br>${escapeHtml(step.attempt.transport)} \xB7 ${escapeHtml(step.attempt.outcome)}${step.attempt.status ? ` \xB7 HTTP ${step.attempt.status}` : ""}` : ""}${step.gaps.map((g) => `<br>${escapeHtml(g)}`).join("")}</p>`).join("");
    const failed = steps.some((step) => step.attempt?.outcome === "failed");
    return `<div class="request-head"><strong>${heading}</strong>${failed ? '<span class="activity-status failed">Failed attempt</span>' : ""}<span class="growth">${last ? growthMetric(last) : ""}</span>${diagnostics ? `<details class="request-tech"><summary>Request details${steps.length > 1 ? ` \xB7 ${steps.length} attempts` : ""}</summary>${diagnostics}</details>` : ""}</div>`;
  }
  function replayRows(items, requests) {
    let group = "";
    return items.map((a) => {
      const key = `${a.turnNumber}:${a.messageId ?? "between"}`;
      const header = key === group ? "" : requestHeader(a, requests[a.messageId ?? ""]);
      group = key;
      return header + activityRow(a);
    }).join("");
  }
  var activityStyle = `
#analysis-run button{background:var(--info-text,#245fae);border-color:var(--info-text,#245fae);color:var(--primary-foreground,#fff)}#analysis-run button:disabled{opacity:.5}
.replay-heading{display:flex;gap:12px;align-items:start;justify-content:space-between;margin-top:18px}.replay-heading h2{font-size:1.15rem;font-weight:600;margin:0 0 4px}.replay-heading p{margin:0}.activity-toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 10px}.activity-toolbar input{flex:1 1 200px;min-width:0}.activity-toolbar select{max-width:160px}.timeline{max-height:520px;overflow:auto;scrollbar-width:thin;padding-right:2px}.request-head{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:7px 9px;border-radius:5px;background:color-mix(in srgb,var(--info-text,#245fae) 7%,var(--surface-background,#fff));font-size:.74rem;color:var(--muted-text,#6b7280);margin:8px 0 0}.request-head strong{color:var(--primary-text,#222)}.request-head .growth{margin-left:auto;font-weight:600}.request-tech{flex-basis:100%;font-size:.7rem}.request-tech summary{font-size:.7rem}.request-tech p{overflow-wrap:anywhere}.activity{margin-left:10px;border-left:1px solid var(--border,#e2e4e8);padding-left:10px}.activity>summary{display:flex;gap:9px;align-items:center;list-style:none;padding:10px 2px;min-width:0}.activity>summary::-webkit-details-marker{display:none}.activity-icon{flex:0 0 18px;width:18px;height:18px;color:var(--muted-text,#6b7280)}.activity-icon svg{width:100%;height:100%;fill:none;stroke:currentColor;stroke-width:1.55;stroke-linecap:round;stroke-linejoin:round}.activity.compaction .activity-icon,.compaction .kind{color:var(--success-text,#15754a)}.activity-words{min-width:0;flex:1;font-size:.82rem;line-height:1.5}.kind{font-weight:550;margin-right:8px}.activity-title{color:var(--muted-text,#6b7280);overflow-wrap:anywhere}.code-title{font-family:var(--font-mono,monospace);font-size:.77rem}.activity-tail{display:flex;gap:8px;align-items:center;font-size:.7rem;color:var(--muted-text,#6b7280);flex-shrink:0}.chevron{font-size:.75rem;transition:transform .15s}.activity[open]>summary .chevron{transform:rotate(90deg)}.activity-status{border-radius:4px;padding:2px 5px;font-size:.69rem}.activity-status.failed,.activity-status.interrupted{color:var(--error-text,#a43a3a);background:color-mix(in srgb,var(--error-text,#a43a3a) 10%,transparent)}.activity-status.live{color:var(--info-text,#245fae)}.activity-detail{margin:0 0 9px 27px;padding:10px;background:var(--surface-muted,#f3f4f6);border-radius:5px;font-size:.79rem;line-height:1.6;overflow-wrap:anywhere}.activity-detail pre{margin:5px 0;white-space:pre-wrap;word-break:break-word;font-size:.75rem;font-family:var(--font-mono,monospace);max-height:280px;overflow:auto}.technical{margin-top:8px;font-size:.7rem;color:var(--muted-text,#6b7280)}.technical p{margin:5px 0}.measurement{margin:10px 0;color:var(--muted-text,#6b7280);font-size:.74rem;line-height:1.55}.measurement p{padding:8px;background:var(--surface-muted,#f3f4f6);border-radius:4px}#action-error{color:var(--error-text,#a43a3a);overflow-wrap:anywhere}.activity-body button,.activity-toolbar button{font:inherit;color:var(--primary-text,#222);background:var(--surface-background,#fff);border:1px solid var(--border,#e2e4e8);border-radius:5px;padding:6px 9px;cursor:pointer;font-size:.8rem}.activity-body section+section{margin-top:10px}#analysis{margin-top:12px;background:var(--surface-muted,#f3f4f6);padding:14px;border-radius:6px}#analysis h2{font-size:.95rem;font-weight:600}.standalone .timeline{max-height:none}.activity-search{width:100%;max-width:400px;margin:10px 0}.standalone .request-accounting{margin-top:20px}@media(max-width:450px){.activity{margin-left:5px;padding-left:7px}.activity>summary{align-items:start;gap:7px}.kind{display:block}.duration{display:none}.activity-toolbar input{flex-basis:100%}.timeline{max-height:470px}.activity-detail{margin-left:0}}@media(prefers-reduced-motion:reduce){.chevron{transition:none}}`;

  // src/gui/analysis.ts
  var AnalysisPanel = class {
    constructor(host, capture) {
      this.host = host;
      this.capture = capture;
      document.querySelector("#analysis").innerHTML = `<h2>Analyze this activity</h2><div class="toolbar"><label>Analysis model<select id="analysis-mode"><option value="small" selected>OpenChamber Small Model</option><option value="configured">Configured smaller model</option><option value="session">Session model</option></select></label><div id="analysis-prepare"></div></div><div id="analysis-preview" class="muted">Prepare a preview of the frozen evidence and request limits.</div><details><summary>Frozen evidence sent to the model</summary><pre id="analysis-evidence" style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto"></pre></details><div id="analysis-run" class="buttons"></div><p class="muted">Clicking Run authorizes this prepared analysis. Monitoring, exports and preparation do not invoke a model.</p><pre id="analysis-result" role="status"></pre>`;
      mountButton(document.querySelector("#analysis-prepare"), { label: "Prepare analysis", variant: "outline", size: "sm", onClick: () => void this.prepare() });
      this.runButton = mountButton(document.querySelector("#analysis-run"), { label: "Run analysis (1 model invocation)", variant: "outline", size: "sm", disabled: true, onClick: () => void this.run() });
      document.querySelector("#analysis-mode").addEventListener("change", () => this.reset());
    }
    host;
    capture;
    job;
    request;
    epoch = 0;
    running = false;
    runButton;
    text(id, text) {
      document.querySelector(`#${id}`).textContent = text;
    }
    update() {
      this.runButton.update({ disabled: this.running || !this.job || this.job.status !== "prepared" });
    }
    reset() {
      this.epoch++;
      this.job = void 0;
      this.request = void 0;
      for (const id of ["analysis-preview", "analysis-result", "analysis-evidence"]) this.text(id, "");
      this.update();
    }
    async prepare() {
      this.reset();
      const epoch = this.epoch, request = this.capture();
      try {
        const mode = document.querySelector("#analysis-mode").value;
        if (!mode) throw new Error("Choose a model before preparing evidence");
        const job = await request("/analysis/prepare", { mode });
        if (epoch !== this.epoch) return;
        this.job = job;
        this.request = request;
        this.text("analysis-preview", `Frozen turns ${job.firstTurn}\u2013${job.lastTurn} \xB7 revision ${job.revision} \xB7 ${job.model.id}. Input allowance ${job.inputBudget} (conservative UTF-8 byte bound including envelope reserve); output cap ${job.outputBudget} tokens.${job.omitted ? " Some evidence was omitted to fit the allowance." : ""}${job.model.route === "openchamber" ? " Consent permits one host generation invocation. The host selects its Small Model/fallback; exact model, capacity and internal provider retries are unavailable to this extension." : ""}`);
        this.text("analysis-evidence", job.prompt);
      } catch (error) {
        if (epoch === this.epoch) this.text("analysis-result", String(error));
      }
      this.update();
    }
    async run() {
      if (!this.job || !this.request || this.running || this.job.status !== "prepared") return;
      const job = this.job, request = this.request, epoch = this.epoch;
      this.running = true;
      job.status = "consumed";
      this.update();
      this.text("analysis-result", "One analysis invocation authorized. Waiting for the result\u2026");
      try {
        const input = { id: job.id, digest: job.digest, consent: true };
        let outcome;
        if (job.model.route === "openchamber") {
          const claimed = await request("/analysis/claim", input);
          let result, error;
          try {
            result = (await this.host.generate({ prompt: claimed.prompt, maxOutputTokens: claimed.outputBudget })).text;
          } catch (failure) {
            error = String(failure);
          }
          outcome = await request("/analysis/result", { id: job.id, receipt: claimed.receipt, result, error });
        } else {
          outcome = await request("/analysis/run", input);
          for (let tries = 0; outcome.status === "consumed" && tries < 60; tries++) {
            await new Promise((resolve) => setTimeout(resolve, 1e3));
            outcome = await request("/analysis/read", { id: job.id });
          }
        }
        if (epoch === this.epoch) {
          this.job = outcome;
          this.text("analysis-result", outcome.status === "complete" ? outcome.result : `Outcome uncertain: ${outcome.error ?? "the request is still running or its result was not received"}. Prepare a new preview and give fresh consent before another request.`);
        }
      } catch (error) {
        if (epoch === this.epoch) this.text("analysis-result", `Outcome uncertain: ${String(error)}. No automatic retry; fresh consent is required.`);
      } finally {
        this.running = false;
        this.update();
      }
    }
  };

  // src/gui/alerts.ts
  var fields = [
    { key: "liveGrowth", label: "Current-turn growth threshold (pp)", min: 0.1, step: 0.1 },
    { key: "liveCompactions", label: "Current-turn compaction threshold", min: 1, step: 1 },
    { key: "growthThreshold", label: "Growth average threshold (pp/turn)", min: 0.1, step: 0.1 },
    { key: "compactionThreshold", label: "Compaction average threshold (per turn)", min: 0.01, step: 0.01 },
    { key: "minContextWindow", label: "Minimum model context window (tokens)", min: 0, step: 1e3 }
  ];
  var delivery = { recorded: "Recorded", attempted: "Delivery attempted", "host-accepted": "Host accepted", unconfirmed: "Delivery unconfirmed", unavailable: "Notification unavailable" };
  var AlertsPanel = class {
    constructor(container, host, request) {
      this.container = container;
      this.host = host;
      this.request = request;
      container.innerHTML = `<style>
      .global-alert-box{margin:16px 0;padding:12px;background:var(--surface-muted,#f3f4f6);border-radius:6px;min-width:0}
      .global-alert-box h2{margin:0 0 6px}.alert-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}.alert-config-grid label{display:grid;gap:4px;font-size:.8rem}
      .alert-list{max-height:320px;overflow:auto;overscroll-behavior:contain}.alert-entry{padding:9px 4px;border-top:1px solid var(--border,#ddd);overflow-wrap:anywhere}.alert-entry label{display:flex;align-items:start;gap:8px;cursor:pointer}.alert-entry input{flex:none;margin-top:3px}.alert-entry .alert-copy{min-width:0;flex:1}.alert-entry strong,.alert-entry small{display:block}.alert-entry details{font-size:.76rem;margin:5px 0 0 24px}.alert-entry time{font-variant-numeric:tabular-nums}.alert-error{color:var(--error-text,#a43a3a);overflow-wrap:anywhere}
      </style><div class="global-alert-box"><details id="alert-settings"><summary>Notification settings \u2014 all projects</summary>
      <p class="muted">Existing growth and compaction alerts only. Averages and cooldowns include eligible turns, not small-model churn. Ordinary monitoring remains unchanged.</p>
      <div class="alert-config-grid">${fields.map((field2) => `<label>${field2.label}<input data-alert-setting="${field2.key}" type="number" min="${field2.min}" step="${field2.step}" disabled></label>`).join("")}</div>
      <p class="muted">The minimum is inclusive; 0 disables the window filter. Unknown or mixed small-model turns do not qualify while filtering is enabled. Changing the minimum resets alert-specific averages/recovery, not monitoring history.</p><div id="save-global-alert-settings"></div></details>
      <h2 style="margin-top:14px">Notification history \u2014 all projects</h2><p class="muted">Latest 100 eligible threshold events, retained across restarts. Host acceptance does not prove a notification was displayed or read.</p>
      <div id="alerts-load-error" class="alert-error" role="alert"></div><div id="alerts-error" class="alert-error" role="alert"></div><p id="alerts-feedback" class="muted" role="status"></p><p id="alerts-recovery" class="muted"></p>
      <div id="alert-list" class="alert-list" role="radiogroup" aria-label="Notification history"></div>
      <div class="buttons"><div id="go-alert-session"></div><div id="refresh-alerts"></div><small id="alert-count"></small></div></div>`;
      for (const input of container.querySelectorAll("[data-alert-setting]")) input.addEventListener("input", () => {
        this.dirty = true;
        this.edits++;
      });
      this.button("save-global-alert-settings", "Save global alert settings", () => void this.save());
      this.container.querySelector("#save-global-alert-settings button").disabled = true;
      this.button("go-alert-session", "Go to the session", () => void this.go());
      this.button("refresh-alerts", "Refresh notifications", () => void this.refresh(true));
      this.goButton.disabled = true;
      container.querySelector("#alert-list").addEventListener("change", (event) => {
        const input = event.target;
        if (input.name !== "alert-selection") return;
        this.selected = input.value;
        this.goButton.disabled = !this.items.some((item) => item.id === this.selected);
      });
    }
    container;
    host;
    request;
    items = [];
    selected = "";
    busy = false;
    queued = false;
    epoch = 0;
    action = 0;
    edits = 0;
    dirty = false;
    loaded = false;
    text(id, text) {
      this.container.querySelector(`#${id}`).textContent = text;
    }
    get goButton() {
      return this.container.querySelector("#go-alert-session button");
    }
    button(id, label, onClick) {
      mountButton(this.container.querySelector(`#${id}`), { label, variant: "outline", size: "sm", onClick });
    }
    values(settings) {
      for (const field2 of fields) this.container.querySelector(`[data-alert-setting="${field2.key}"]`).value = String(settings[field2.key]);
    }
    async refresh(force = false) {
      if (this.busy) {
        this.queued ||= force;
        return;
      }
      this.busy = true;
      const epoch = ++this.epoch;
      try {
        const [settings, history] = await Promise.all([this.request("/notification-settings"), this.request(`/notifications${force ? "?refresh=1" : ""}`)]);
        if (epoch !== this.epoch) return;
        if (!this.dirty || !this.loaded) this.values(settings);
        this.loaded = true;
        for (const input of this.container.querySelectorAll("[data-alert-setting]")) input.disabled = false;
        this.container.querySelector("#save-global-alert-settings button").disabled = false;
        this.items = history.items.slice(0, 100);
        if (!this.items.some((item) => item.id === this.selected)) this.selected = "";
        this.draw();
        const limitations = history.limitations ?? [];
        this.text("alerts-recovery", [...limitations, history.omittedLimitations ? `${history.omittedLimitations} further recovery limitations.` : ""].filter(Boolean).join(" "));
        this.text("alerts-load-error", "");
      } catch (error) {
        if (epoch === this.epoch) this.text("alerts-load-error", String(error));
      } finally {
        this.busy = false;
        if (this.queued) {
          this.queued = false;
          void this.refresh(true);
        }
      }
    }
    draw() {
      this.container.querySelector("#alert-list").innerHTML = this.items.map((item) => {
        const title = item.title || item.sessionId, project = item.directory.replace(/[\\/]+$/, "").split(/[\\/]/).at(-1) || item.directory;
        const name = item.metric === "growth" ? "Growth" : "Compactions";
        const units = item.metric === "growth" ? item.kind === "live" ? " pp" : " pp/turn" : item.kind === "ema" ? "/turn" : "";
        return `<div class="alert-entry" data-alert="${escapeHtml(item.id)}"><label><input type="radio" name="alert-selection" value="${escapeHtml(item.id)}" aria-label="Select ${escapeHtml(title)}"${item.id === this.selected ? " checked" : ""}><span class="alert-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(project)} \xB7 <time>${escapeHtml(new Date(item.at).toLocaleString())}</time></small><span>${name} (${item.kind === "live" ? "current turn" : "average"}): ${item.value.toFixed(2)}${units} \u2265 ${item.threshold.toFixed(2)}${units}</span><small>${delivery[item.delivery] ?? "Unknown delivery"}</small></span></label><details><summary>Model and event details</summary>${escapeHtml(item.model || "Unknown model")} \xB7 window ${item.capacity?.toLocaleString() ?? "unknown"} tokens<br>${escapeHtml(item.directory)}<br>Session: ${escapeHtml(item.sessionId)}</details></div>`;
      }).join("") || '<p class="muted">No eligible threshold events recorded yet.</p>';
      this.goButton.disabled = !this.selected;
      this.text("alert-count", `${this.items.length} / 100 events`);
    }
    async save() {
      if (!this.loaded) return;
      const action = ++this.action, edits = this.edits;
      this.epoch++;
      const input = Object.fromEntries(fields.map((field2) => [field2.key, Number(this.container.querySelector(`[data-alert-setting="${field2.key}"]`).value)]));
      try {
        const settings = await this.request("/notification-settings", "POST", input);
        if (action !== this.action) return;
        if (edits === this.edits) {
          this.dirty = false;
          this.values(settings);
        }
        this.text("alerts-error", "");
        this.text("alerts-feedback", "Saved global alert settings. Applies to subsequent monitoring updates across projects.");
        void this.refresh(true);
      } catch (error) {
        if (action === this.action) this.text("alerts-error", String(error));
      }
    }
    async go() {
      const item = this.items.find((item2) => item2.id === this.selected);
      if (!item) return;
      const action = ++this.action, selected = item.id;
      try {
        await this.host.openSession(item.sessionId);
        if (action === this.action && selected === this.selected) this.text("alerts-error", "");
      } catch (error) {
        if (action === this.action) this.text("alerts-error", `Cannot open session ${item.sessionId}: ${String(error)}`);
      }
    }
  };

  // src/gui/panel.ts
  var ReportPanel = class {
    constructor(host) {
      this.host = host;
      const style = document.createElement("style");
      style.textContent = reportStyle + activityStyle;
      document.head.append(style);
      document.querySelector("#app").innerHTML = `
      <h1>Context Churn Monitor</h1><p class="muted report-only">Context growth and compactions \xB7 deterministic monitoring</p>
      <div id="error" role="alert"></div><div id="action-error" role="alert"></div><div id="notice" class="muted" role="status"></div>
      <details id="pairing" class="report-only"><summary>Connection settings (advanced)</summary><p class="pair-note muted">Connects automatically to this project's registered backend. Use a manual descriptor only to override the connection or select between multiple backends. Credentials remain in the local service.</p><label>Manual backend descriptor path<input id="descriptor" placeholder="Absolute path to \u2026.backend.json"></label><div id="pair-button" class="buttons"></div></details>
      <div id="metrics" class="metrics"></div><div id="chart"></div><p id="quality" class="muted"></p>
      <div class="toolbar"><label><span><input id="warnings" type="checkbox" checked> Automatic warnings</span></label><label><span><input id="details-toggle" type="checkbox" checked> Step details</span></label><div id="view-button"></div></div>
      <section id="global-alerts" class="report-only"></section>
      <div id="report" class="report-only">
        <div class="replay-heading"><div><h2>Activity replay</h2><p class="muted">The conversation\u2019s activity, in the order it happened.</p></div></div>
        <div class="toolbar"><label>Scope<select id="scope"><option value="all">All recorded activities</option><option value="current">Current turn</option><option value="recent">Recent turns</option></select></label><div id="refresh"></div></div>
        <div class="activity-toolbar"><input id="activity-search" type="search" aria-label="Search activities" placeholder="Find a command, file or activity\u2026"><select id="activity-filter" aria-label="Activity type"><option value="all">All activities</option><option value="tools">Tools</option><option value="thinking">Thinking</option><option value="compaction">Compactions</option><option value="text">Responses</option><option value="user">User input</option><option value="system">Conversation updates</option><option value="retry">Retries</option></select><button id="expand-activities" type="button">Expand all</button></div>
        <div class="timeline" id="rows" aria-label="Chronological activity replay"></div>
        <div class="buttons"><div id="previous"></div><span id="page-label" class="muted"></span><div id="next"></div></div>
        <div class="buttons"><div id="export-html"></div><div id="export-json"></div></div>
        ${measurementNotice}
        <details><summary>Monitor settings \u2014 current session</summary><div class="toolbar"><label>EMA span (turns)<input id="span" type="number" min="1" value="5"></label><label>Analysis lookback (turns)<input id="lookback" type="number" min="1" value="5"></label><div id="save-settings"></div></div></details>
        <section id="analysis" class="report-only"></section>
      </div>`;
      this.alerts = new AlertsPanel(document.querySelector("#global-alerts"), host, (path, method, input) => this.request(path, method, input));
      this.analysis = new AnalysisPanel(host, () => {
        const directory = this.directory, session = this.session;
        return (path, input) => this.request(path, "POST", input, { directory, session });
      });
      this.button("pair-button", "Pair backend", async (current) => {
        await this.request("/pair", "POST", { path: this.input("descriptor").value });
        if (!current()) return;
        document.querySelector("#pairing").open = false;
        this.reset();
      });
      this.button("view-button", "View steps", () => this.host.openSurface("plugin:context-churn-monitor"));
      this.button("refresh", "Refresh", () => this.reset(), false);
      this.button("previous", "Previous", () => {
        this.offset = Math.max(0, this.offset - 50);
        this.reset(false);
      }, false);
      this.button("next", "Next", () => {
        if (this.next !== null) {
          this.offset = this.next;
          this.reset(false);
        }
      }, false);
      for (const format of ["html", "json"]) this.button(`export-${format}`, `Export ${format.toUpperCase()}`, async (current) => {
        const result = await this.request("/export", "POST", { format });
        if (current()) this.text("notice", `Saved ${result.path}`);
      });
      this.button("save-settings", "Save settings", async (current) => {
        await this.request("/settings", "POST", { span: Number(this.input("span").value), lookback: Number(this.input("lookback").value) });
        if (current()) this.reset();
      });
      this.input("warnings").onchange = () => void this.run(async (current) => {
        await this.request("/settings", "POST", { warnings: this.input("warnings").checked });
        if (current()) this.reset();
      });
      this.input("details-toggle").onchange = () => {
        document.querySelector("#report").toggleAttribute("hidden", !this.input("details-toggle").checked);
      };
      for (const id of ["scope", "activity-filter"]) document.querySelector(`#${id}`).addEventListener("change", () => this.reset());
      this.input("activity-search").addEventListener("input", () => this.reset());
      document.querySelector("#expand-activities").addEventListener("click", () => {
        const rows = [...document.querySelectorAll("details[data-activity]")];
        const expand = rows.some((row) => !row.open);
        rows.forEach((row) => {
          row.open = expand;
        });
        this.text("expand-activities", expand ? "Collapse all" : "Expand all");
      });
      host.onReady((ctx) => {
        applyHostReady(ctx, document.documentElement);
        this.compact = ctx.surface === "status";
        document.body.classList.toggle("compact", this.compact);
        if (this.directory !== (ctx.directory ?? "") || this.session !== (ctx.session?.id ?? "")) this.clearContext();
        this.directory = ctx.directory ?? "";
        this.session = ctx.session?.id ?? "";
        this.reset();
        if (this.compact) {
          void host.setHeight(250);
          void host.setStatusControls([{ kind: "button", id: "view-steps", label: "View steps" }]).catch(() => {
          });
        }
      });
      host.onDirectory((directory) => {
        if (this.directory !== (directory ?? "")) this.clearContext();
        this.directory = directory ?? "";
        this.reset();
      });
      host.onSession((session) => {
        if (this.session !== (session?.id ?? "")) this.clearContext();
        this.session = session?.id ?? "";
        this.reset();
      });
      host.onStatusControl((control) => {
        if (control.id === "view-steps") void this.run(() => host.openSurface("plugin:context-churn-monitor"));
      });
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) this.reset(false);
      });
    }
    host;
    directory = "";
    session = "";
    offset = 0;
    next = null;
    epoch = 0;
    context = 0;
    action = 0;
    revision = -1;
    busy = false;
    compact = false;
    timer;
    settings;
    snapshot = null;
    analysis;
    alerts;
    input(id) {
      return document.querySelector(`#${id}`);
    }
    clearContext() {
      this.context++;
      this.snapshot = null;
      this.settings = void 0;
      this.next = null;
      this.analysis.reset();
      for (const id of ["rows", "notice", "error", "action-error", "page-label"]) this.text(id, "");
      this.drawMetrics(null, []);
    }
    text(id, value) {
      document.querySelector(`#${id}`).textContent = value;
    }
    button(id, label, action, feedback = true) {
      mountButton(document.querySelector(`#${id}`), { label, variant: "outline", size: "sm", onClick: () => void this.run(action, feedback) });
    }
    async run(action, feedback = true) {
      const context = this.context, generation = feedback ? ++this.action : this.action;
      const current = () => context === this.context && generation === this.action;
      try {
        await action(current);
        if (feedback && current()) this.text("action-error", "");
      } catch (error) {
        if (current()) this.text("action-error", error instanceof Error ? error.message : String(error));
      }
    }
    async request(path, method = "GET", data, query = {}) {
      const response = await this.host.serviceRequest({ method, path, query: { directory: this.directory, session: this.session, ...query }, ...data === void 0 ? {} : { body: JSON.stringify(data) } });
      const result = JSON.parse(response.body);
      if (response.status < 200 || response.status >= 300) throw new Error(result?.error ?? "Monitoring backend unavailable");
      return result;
    }
    reset(firstPage = true) {
      if (firstPage) this.offset = 0;
      this.revision = -1;
      this.epoch++;
      if (this.timer) clearTimeout(this.timer);
      if (!this.busy) void this.refresh();
    }
    async refresh() {
      if (document.hidden) return;
      this.busy = true;
      const epoch = this.epoch;
      try {
        if (!this.compact) await this.alerts.refresh();
        if (epoch !== this.epoch) return;
        if (!this.directory || !this.session) {
          this.text("quality", "Select a monitored conversation to see its metrics.");
          return;
        }
        const result = await this.request("/snapshot");
        if (epoch !== this.epoch) return;
        this.settings = result.settings;
        this.snapshot = result.state;
        this.drawMetrics(result.state, result.turns);
        this.input("warnings").checked = result.settings.warnings;
        if (document.activeElement?.tagName !== "INPUT") {
          this.input("span").value = String(result.settings.span);
          this.input("lookback").value = String(result.settings.lookback);
        }
        if (!this.compact && this.revision !== (result.state?.revision ?? 0)) {
          const page = await this.request("/activities", "GET", void 0, { limit: "50", offset: String(this.offset), scope: this.input("scope").value, kind: this.input("activity-filter").value, q: this.input("activity-search").value });
          if (epoch !== this.epoch) return;
          this.drawActivities(page.items, page.requests);
          this.next = page.next;
          this.text("page-label", page.items.length ? `Activities ${this.offset + 1}\u2013${this.offset + page.items.length}` : "No activities");
          document.querySelector("#previous button").disabled = this.offset === 0;
          document.querySelector("#next button").disabled = page.next === null;
          this.revision = result.state?.revision ?? 0;
        }
        this.text("error", "");
      } catch (error) {
        if (epoch === this.epoch) this.text("error", error instanceof Error ? error.message : String(error));
      } finally {
        this.busy = false;
        this.timer = setTimeout(() => void this.refresh(), epoch === this.epoch ? 2e3 : 0);
      }
    }
    drawActivities(items, requests) {
      const container = document.querySelector("#rows"), scroll = container.scrollTop;
      const old = new Map([...container.querySelectorAll("details[data-activity]")].map((row) => [row.dataset.activity, { open: row.open, technical: row.querySelector(".technical")?.open, status: row.dataset.status, body: row.querySelector(".activity-body") }]));
      container.innerHTML = replayRows(items, requests) || '<p class="muted">No recorded activities match this scope and filter.</p>';
      for (const row of container.querySelectorAll("details[data-activity]")) {
        const previous = old.get(row.dataset.activity);
        if (previous && previous.status === row.dataset.status && ["completed", "failed"].includes(previous.status)) row.querySelector(".activity-body").replaceWith(previous.body);
        if (previous?.technical) row.querySelector(".technical").open = true;
        row.addEventListener("toggle", () => {
          if (row.open) void this.loadActivity(row);
        });
        if (previous?.open) row.open = true;
      }
      container.scrollTop = scroll;
    }
    /** Large bodies are fetched only for an expanded activity. Every response remains bound to the originating view and DOM node. */
    async loadActivity(row) {
      const target = row.querySelector(".activity-body");
      if (target.dataset.loaded || target.dataset.loading) return;
      target.dataset.loading = "true";
      const context = this.context, id = row.dataset.activity, query = { directory: this.directory, session: this.session, id };
      const valid = () => context === this.context && target.isConnected;
      try {
        const details = await this.request("/activity", "GET", void 0, query);
        if (!valid()) return;
        target.replaceChildren();
        for (const channel of details.channels) {
          if (!channel.total) continue;
          const section = document.createElement(channel.channel === "metadata" ? "details" : "section");
          const title = document.createElement(channel.channel === "metadata" ? "summary" : "strong");
          title.textContent = channel.channel[0].toUpperCase() + channel.channel.slice(1);
          const pre = document.createElement("pre"), more = document.createElement("button");
          more.type = "button";
          more.textContent = "Load more";
          section.append(title, pre, more);
          target.append(section);
          let offset = 0;
          const load = async () => {
            more.disabled = true;
            try {
              const page = await this.request("/activity", "GET", void 0, { ...query, channel: channel.channel, offset: String(offset), limit: "16000" });
              if (!valid()) return;
              pre.textContent += page.text;
              more.hidden = page.next === null;
              offset = page.next ?? page.total;
              more.textContent = `Load more (${offset.toLocaleString()} / ${page.total.toLocaleString()} characters)`;
            } catch (error) {
              if (valid()) more.textContent = `Retry loading: ${String(error)}`;
            } finally {
              more.disabled = false;
            }
          };
          more.addEventListener("click", () => void load());
          await load();
          if (!valid()) return;
        }
        if (!target.children.length) target.textContent = "No visible text was supplied by the host.";
        target.dataset.loaded = "true";
      } catch (error) {
        if (valid()) target.textContent = String(error);
      } finally {
        delete target.dataset.loading;
      }
    }
    drawMetrics(state, turns) {
      const values = [["Growth EMA", metric(state?.ema.growth, " pp/turn")], ["Compaction EMA", metric(state?.ema.compactions, "/turn")], ["Current turn growth", state?.turn ? growthMetric(state.turn) : "\u2014"], ["Current turn compactions", state?.turn ? String(state.turn.compactions) : "\u2014"]];
      document.querySelector("#metrics").innerHTML = values.map(([label, value]) => `<div class="metric"><small>${label}</small><strong>${value}</strong></div>`).join("");
      this.text("quality", state?.turn ? `Turn ${state.turn.number} \xB7 ${state.turn.ended === void 0 ? "live" : "completed"} \xB7 ${coverage(state.turn)}${state.turn.gaps.length ? " \u2014 partial coverage; expand step evidence" : ""}` : "No measurements yet. Historical steps before installation are unavailable.");
      const points = turns.filter((t) => t.growth !== null).map((t) => t.growth);
      const max = Math.max(1, ...points);
      const coords = points.map((v2, i) => `${points.length === 1 ? 50 : i / (points.length - 1) * 100},${30 - v2 / max * 27}`).join(" ");
      document.querySelector("#chart").innerHTML = `<svg class="spark" viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Recent turn growth"><polyline points="${escapeHtml(coords)}" fill="none" stroke="var(--info-text,#3575c9)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`;
    }
  };
  new ReportPanel(connectHost());
})();
