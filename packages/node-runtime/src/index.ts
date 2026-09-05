import {
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
  unlinkSync,
  realpathSync,
  existsSync,
} from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { canonicalRevision } from "../../canonical-json/src/index.js";
import { PpteSession } from "../../core/src/index.js";
import { AgentToolServer } from "../../agent-tools/src/index.js";
import {
  openCheckpoint,
  writeCheckpoint,
} from "../../file-format/src/index.js";
import { inferCompatibilityProfile } from "../../compatibility/src/index.js";
import {
  RecoveryJournal,
  readJournal,
} from "../../recovery-journal/src/index.js";
import { readCheckpointResources } from "./delivery.js";
import type { TransactionScope } from "../../schema/src/index.js";

/** Serialize writers across short-lived CLI processes. Readers never take a write lock. */
export function withProjectLock<T>(
  path: string,
  work: (absolute: string) => T,
): T {
  const absolute = existsSync(path)
    ? realpathSync(path)
    : join(realpathSync(dirname(resolve(path))), basename(path));
  const lock = `${absolute}.lock`;
  let fd: number;
  try {
    fd = openSync(lock, "wx", 0o600);
  } catch {
    throw new Error(
      `PROJECT_BUSY: ${absolute} is being edited. Retry after the other writer exits. If it crashed, inspect ${lock} before removing it.`,
    );
  }
  const token = crypto.randomUUID();
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }),
    );
    return work(absolute);
  } finally {
    closeSync(fd);
    try {
      if (JSON.parse(readFileSync(lock, "utf8")).token === token)
        unlinkSync(lock);
    } catch {}
  }
}
export function openFileSession(
  path: string,
  options: { readonly?: boolean; scope?: TransactionScope } = {},
) {
  const target = resolve(path);
  const opened = openCheckpoint(target, {
    recovery: options.readonly ? "ignore" : "recover",
    journalPath: `${target}.journal`,
  });
  if (
    opened.recovery?.status === "rejected" ||
    opened.recovery?.status === "ambiguous"
  )
    throw new Error(
      "RECOVERY_REJECTED: " +
        opened.recovery.issues.map((i) => i.message).join("; "),
    );
  const resources = readCheckpointResources(target, opened.document);
  if (options.readonly) {
    const session = new PpteSession(opened.document);
    return {
      session,
      agent: new AgentToolServer(session, { grantedScope: options.scope }),
      resources,
      path: target,
    };
  }
  const journalPath = `${target}.journal`;
  const existing = readJournal(journalPath);
  const journal = new RecoveryJournal(
    journalPath,
    existing.header ?? {
      journalVersion: "1",
      documentId: opened.document.documentId,
      baseCheckpointRevision: canonicalRevision(opened.document),
      sessionId: `cli-${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      compatibilityProfile: inferCompatibilityProfile(opened.document),
    },
  );
  const session: PpteSession = new PpteSession(opened.document, {
    journal,
    checkpoint: {
      write: (document, destination, _, recent) =>
        writeCheckpoint(document, String(destination), {
          ...resources,
          redoHistory: [...session.getRedoHistory()],
          recentTransactions: recent ? [...recent] : [],
          compatibilityProfile: inferCompatibilityProfile(document),
          timestamp: new Date().toISOString(),
        }),
      clearRecovery: () => journal.clear(),
    },
  });
  return {
    session,
    agent: new AgentToolServer(session, { grantedScope: options.scope }),
    resources,
    path: target,
  };
}
