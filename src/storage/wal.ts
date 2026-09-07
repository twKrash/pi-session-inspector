import { appendFile, mkdir, open } from "node:fs/promises";
import { join } from "node:path";

const ASCII_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_TOKEN_LENGTH = 128;

type WalEvent = {
  eventId: string;
  timestamp: string;
  kind: string;
};

type StoredWalEvent = WalEvent & {
  writerId: string;
  writerSequence: number;
};

type WalWriter = {
  append(event: WalEvent): void;
  flush(): Promise<void>;
};

function isAsciiToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_TOKEN_LENGTH &&
    ASCII_TOKEN.test(value)
  );
}

function isSupportedEvent(event: WalEvent): boolean {
  return (
    isAsciiToken(event.eventId) &&
    isAsciiToken(event.kind) &&
    typeof event.timestamp === "string" &&
    event.timestamp.length <= 64 &&
    !Number.isNaN(Date.parse(event.timestamp))
  );
}

export async function createWalWriter({
  root,
  writerId,
  now,
}: {
  root: string;
  writerId: string;
  now: () => Date;
}): Promise<WalWriter> {
  if (!isAsciiToken(writerId)) {
    throw new TypeError("writerId must be an ASCII token");
  }

  const shardDirectory = join(root, "wal", writerId);
  await mkdir(shardDirectory, { recursive: true });
  const owner = await open(join(shardDirectory, ".owner"), "wx");
  await owner.close();

  let disabled = false;
  let sequence = 0;
  let pending: StoredWalEvent[] = [];
  let flushing: Promise<void> | undefined;

  const flush = (): Promise<void> => {
    if (disabled || flushing) {
      return flushing ?? Promise.resolve();
    }

    flushing = (async () => {
      while (!disabled && pending.length > 0) {
        const events = pending;
        pending = [];
        const date = now().toISOString().slice(0, 10);
        const destination = join(shardDirectory, `${date}.jsonl`);

        try {
          await appendFile(
            destination,
            events.map((event) => `${JSON.stringify(event)}\n`).join(""),
            "utf8",
          );
        } catch {
          disabled = true;
          pending = [];
        }
      }
    })().finally(() => {
      flushing = undefined;
    });

    return flushing;
  };

  return {
    append(event): void {
      if (disabled || !isSupportedEvent(event)) {
        return;
      }

      sequence += 1;
      pending.push({
        eventId: event.eventId,
        timestamp: event.timestamp,
        kind: event.kind,
        writerId,
        writerSequence: sequence,
      });
    },
    flush,
  };
}
