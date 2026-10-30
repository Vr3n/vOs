// Herdr subagent journal — the source of truth for the Herdr sidebar's
// subagent tree (see the `my-agents` Herdr mod).
//
// Problem it solves: `opencode api session.list` is an eventually-consistent
// index — entries linger after their data files are gone (session.get then
// 404s) and it carries no live status, so the sidebar had to guess liveness
// from `outcome` and map sessions via terminal titles.
//
// Instead this plugin watches the server event bus (every session the server
// hosts, including TUI children) and maintains one tiny single-line JSON
// file per session:
//
//   <home>/.local/share/opencode/herdr-subagents/<sessionID>.json
//   {"id":"...","parentID":"...","title":"...","agent":"...","status":"working","updatedAt":123}
//
// `status` is one of working | blocked | idle, straight from session.status /
// execution / permission events — no heuristics. A `session.created` payload
// already carries id, parentID, title and agent, so nodes are complete at
// birth. A file per session (rather than one shared file) keeps concurrent
// servers from clobbering each other; the mod reads them all with a single
// `type *.json`. Heartbeat file writes are throttled to 1/s per session; the
// mod additionally treats working/blocked nodes older than 2 minutes as
// stale (dead servers leave files behind).
// Override the directory with HERDR_SUBAGENTS_DIR. Dependency-free; event
// handlers never throw into the host loop.

// managed by us; reinstalling or updating the integration overwrites this file.
// HERDR_INTEGRATION_ID=herdr.subagents
// HERDR_INTEGRATION_VERSION=2

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HEARTBEAT_MS = 1000;

function journalDir() {
  const d =
    process.env.HERDR_SUBAGENTS_DIR ||
    path.join(os.homedir(), ".local", "share", "opencode", "herdr-subagents");
  try {
    fs.mkdirSync(d, { recursive: true });
  } catch {
    /* read-only home or racing mkdir; writes below fail silently */
  }
  return d;
}

function fileFor(id) {
  return path.join(journalDir(), `${id}.json`);
}

// This server's session nodes.
const nodes = new Map();
// sessionID -> last file write (ms), for heartbeat throttling.
const lastWrite = new Map();

function writeNode(node, force) {
  const now = Date.now();
  if (!force && now - (lastWrite.get(node.id) ?? 0) < HEARTBEAT_MS) return;
  lastWrite.set(node.id, now);
  try {
    const p = fileFor(node.id);
    const tmp = `${p}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(node));
    fs.renameSync(tmp, p);
  } catch {
    /* journal is best-effort; the sidebar falls back to session.list */
  }
}

function dropNode(id) {
  nodes.delete(id);
  lastWrite.delete(id);
  try {
    fs.unlinkSync(fileFor(id));
  } catch {
    /* already gone */
  }
}

function touch(id, patch, force) {
  const prev = nodes.get(id) ?? {
    id,
    parentID: null,
    title: null,
    agent: null,
    status: "working",
    updatedAt: 0,
  };
  const next = { ...prev, id, updatedAt: Date.now() };
  if (patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null) next[k] = v;
    }
  }
  nodes.set(id, next);
  writeNode(next, force);
  return next;
}

// V2 server events decode to `{ type, data }`; V1 plugin events arrive as
// `{ type, properties }`. Accept both shapes.
function eventData(event) {
  const d = event?.data ?? event?.properties ?? {};
  return d && typeof d === "object" ? d : {};
}

function sessionIDFromData(data) {
  for (const key of ["sessionID", "sessionId"]) {
    if (typeof data[key] === "string" && data[key]) return data[key];
  }
  return undefined;
}

// session.created carries the new session: V2 flat
// `{ sessionID, parentID, title, agent, ... }`, V1 `info: { id, ... }`.
// The flat V2 shape already includes title and agent at birth.
function createdInfo(data) {
  if (typeof data.sessionID === "string" && data.sessionID) {
    return {
      id: data.sessionID,
      parentID: data.parentID ?? null,
      title: data.title,
      agent: data.agent,
    };
  }
  const info = data.info;
  if (info && typeof info.id === "string" && info.id) {
    return { id: info.id, parentID: info.parentID ?? null, title: info.title, agent: info.agent };
  }
  return undefined;
}

// session.updated carries the session record (`info`, per the SDK types).
function recordInfo(data) {
  const info = data.info ?? data.session ?? {};
  return info && typeof info === "object" ? info : {};
}

const STATUS_BY_STATUS = new Map([
  ["idle", "idle"],
  ["active", "working"],
  ["busy", "working"],
  ["pending", "working"],
  ["retry", "working"],
  ["running", "working"],
  ["streaming", "working"],
  ["working", "working"],
]);

function statusFromSessionStatus(status) {
  const kind = typeof status === "string" ? status : status?.type;
  if (typeof kind !== "string") return null;
  return STATUS_BY_STATUS.get(kind.toLowerCase()) ?? null;
}

// Task-tool progress on the parent names the child session in metadata with
// its live status — a second opinion on the child's state.
function statusFromTaskStatus(status) {
  if (typeof status !== "string") return null;
  const s = status.toLowerCase();
  if (/fail|error/.test(s)) return "blocked";
  if (/complet|succeed|done|idle/.test(s)) return "idle";
  if (/run|work|progress|start|pending/.test(s)) return "working";
  return null;
}

async function onEvent(event) {
  try {
    const type = event?.type;
    if (typeof type !== "string") return;
    const data = eventData(event);
    const sessionID = sessionIDFromData(data);

    switch (type) {
      case "session.created": {
        const created = createdInfo(data);
        if (created) {
          touch(created.id, {
            parentID: created.parentID,
            title: created.title,
            agent: created.agent,
            status: "working",
          }, true);
        } else if (sessionID) {
          touch(sessionID, {}, true);
        }
        break;
      }
      case "session.updated": {
        if (!sessionID) break;
        const info = recordInfo(data);
        touch(sessionID, {
          parentID: info.parentID,
          title: info.title,
          agent: info.agent,
        }, true);
        break;
      }
      case "session.status": {
        if (!sessionID) break;
        const state = statusFromSessionStatus(data.status);
        touch(sessionID, state ? { status: state } : {}, true);
        break;
      }
      case "tool.execute.before":
      case "tool.execute.after":
      case "session.execution.started":
      case "session.compaction.started":
      case "session.compaction.ended":
        if (sessionID) touch(sessionID, { status: "working" }, true);
        break;
      case "session.execution.succeeded":
      case "session.execution.interrupted":
      case "session.idle":
        if (sessionID) touch(sessionID, { status: "idle" }, true);
        break;
      case "session.execution.failed":
      case "session.error":
      case "permission.asked":
      case "question.asked":
      case "form.created":
        if (sessionID) touch(sessionID, { status: "blocked" }, true);
        break;
      case "permission.replied":
      case "question.replied":
      case "question.rejected":
      case "form.replied":
      case "form.cancelled":
        if (sessionID) touch(sessionID, { status: "working" }, true);
        break;
      case "session.deleted":
        if (sessionID) dropNode(sessionID);
        break;
      case "session.tool.progress":
      case "session.tool.success": {
        // Parent-side task progress names the child: metadata.sessionID.
        const meta = data.metadata ?? {};
        const child = meta.sessionID;
        if (child) {
          const state = statusFromTaskStatus(meta.status);
          touch(child, state ? { status: state } : {}, true);
        }
        if (sessionID) touch(sessionID, {}, false);
        break;
      }
      default:
        // Heartbeat for any other event carrying a known session: keeps
        // working nodes fresh without a file write storm (throttled).
        if (sessionID && nodes.has(sessionID)) touch(sessionID, {}, false);
        break;
    }
  } catch {
    // Journaling must never break the host event loop.
  }
}

// --- V1 entrypoint -----------------------------------------------------------
export const HerdrSubagentsPlugin = async () => ({
  event: async ({ event }) => {
    await onEvent(event);
  },
});

// --- V2 entrypoint -----------------------------------------------------------
async function setup(ctx) {
  const controller = new AbortController();
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        await onEvent(event);
      }
    } catch {
      // Subscription aborted on unload; ignore.
    }
  })();
  return () => controller.abort();
}

export default {
  id: "herdr.subagents",
  server: HerdrSubagentsPlugin,
  setup,
};
