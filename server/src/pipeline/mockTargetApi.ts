// Simulates the client's new platform's bulk-employee-create endpoint.
// Deliberately fails a configurable percentage of pushes at random so the
// retry path in the UI/pipeline is exercising real logic, not decoration.

const FAILURE_RATE = Number(process.env.MOCK_API_FAILURE_RATE ?? 12) / 100;

export interface PushResult {
  success: boolean;
  remoteId?: string;
  error?: string;
}

const failureReasons = [
  "Target API timeout",
  "Duplicate key conflict on remote system",
  "Transient 503 from target service",
  "Rate limited by target API",
];

/** Simulates pushing one record to the target system. Not a real network
 * call — this stands in for the client's actual platform API, which in a
 * real engagement would be whatever REST/SOAP/SFTP interface they expose. */
export async function pushRecordToTarget(record: Record<string, unknown>): Promise<PushResult> {
  // Simulate latency.
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));

  if (Math.random() < FAILURE_RATE) {
    const reason = failureReasons[Math.floor(Math.random() * failureReasons.length)];
    return { success: false, error: reason };
  }

  return { success: true, remoteId: `tgt_${Math.random().toString(36).slice(2, 10)}` };
}
