export type SnapshotMeta = {
  snapshot_id: string;
  created_at?: string | null;
  profile?: string | null;
  benchmark?: string | null;
  file?: string | null;
};

export type SnapshotListResponse = {
  ok: boolean;
  snapshots: SnapshotMeta[];
};

export type SnapshotSaveResponse = {
  ok: boolean;
  snapshot_id?: string;
  error?: string;
};

export async function snapshotList(): Promise<SnapshotListResponse> {
  const r = await fetch("/api/backend/api/kpis_overlay/snapshot/list");
  if (!r.ok) throw new Error(`snapshot/list failed: ${r.status}`);
  return r.json();
}

export async function snapshotSave(profile: string, benchmark: string): Promise<SnapshotSaveResponse> {
  const r = await fetch("/api/backend/api/kpis_overlay/snapshot/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile, benchmark }),
  });
  if (!r.ok) throw new Error(`snapshot/save failed: ${r.status}`);
  return r.json();
}

export async function snapshotLoad(snapshotId: string): Promise<any> {
  const safe = encodeURIComponent(snapshotId);
  const r = await fetch(`/api/backend/api/kpis_overlay/snapshot/${safe}`);
  if (!r.ok) throw new Error(`snapshot/get failed: ${r.status}`);
  return r.json();
}