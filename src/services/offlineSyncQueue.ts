import * as SQLite from 'expo-sqlite';
import * as FileSystem from 'expo-file-system';
import NetInfo from '@react-native-community/netinfo';
import { ExtractedTBRecord } from '../utils/tbRegisterParser';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.easeafrica.org.et';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (dbInstance) return dbInstance;
  dbInstance = await SQLite.openDatabaseAsync('smartcare_adhere_et.db');
  await dbInstance.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS enrollment_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idempotency_key TEXT UNIQUE NOT NULL,
      payload_json TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_outbox_status ON enrollment_outbox(sync_status);
  `);
  return dbInstance;
}

export async function purgeTemporaryPhoto(photoUri: string | null): Promise<void> {
  if (!photoUri) return;
  try {
    const info = await FileSystem.getInfoAsync(photoUri);
    if (info.exists) {
      await FileSystem.deleteAsync(photoUri, { idempotent: true });
    }
  } catch (err) {
    console.warn('Temporary photo purge warning:', err);
  }
}

export async function enqueueVerifiedEnrollment(
  record: ExtractedTBRecord,
  tempPhotoUri: string | null,
  editedByUser: boolean
): Promise<{ syncedImmediately: boolean; queueCount: number }> {
  await purgeTemporaryPhoto(tempPhotoUri);

  const db = await getDb();
  const payload = JSON.stringify({
    ...record,
    ocrEditedByUser: editedByUser,
    capturedAt: new Date().toISOString(),
  });

  await db.runAsync(
    `INSERT OR REPLACE INTO enrollment_outbox (idempotency_key, payload_json, sync_status, created_at)
     VALUES (?, ?, 'PENDING', ?)`,
    [record.idempotencyKey, payload, new Date().toISOString()]
  );

  const net = await NetInfo.fetch();
  let syncedImmediately = false;
  if (net.isConnected && net.isInternetReachable !== false) {
    const res = await flushOutboxToServer();
    syncedImmediately = res.uploaded > 0;
  }

  const counts = await getQueueCounts();
  return { syncedImmediately, queueCount: counts.pending };
}

export async function flushOutboxToServer(): Promise<{ uploaded: number; failed: number }> {
  const db = await getDb();
  const pendingRows = await db.getAllAsync<{
    id: number;
    idempotency_key: string;
    payload_json: string;
    attempt_count: number;
  }>(`SELECT id, idempotency_key, payload_json, attempt_count FROM enrollment_outbox WHERE sync_status = 'PENDING' ORDER BY id ASC LIMIT 25`);

  if (pendingRows.length === 0) return { uploaded: 0, failed: 0 };

  let uploaded = 0;
  let failed = 0;

  for (const row of pendingRows) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/v1/sync/enrollments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': row.idempotency_key,
        },
        body: row.payload_json,
      });

      if (response.ok || response.status === 409) {
        await db.runAsync(
          `UPDATE enrollment_outbox SET sync_status = 'SYNCED', synced_at = ? WHERE id = ?`,
          [new Date().toISOString(), row.id]
        );
        uploaded += 1;
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err: any) {
      failed += 1;
      await db.runAsync(
        `UPDATE enrollment_outbox SET attempt_count = ?, last_error = ? WHERE id = ?`,
        [row.attempt_count + 1, String(err?.message || err), row.id]
      );
    }
  }

  return { uploaded, failed };
}

export async function getQueueCounts(): Promise<{ pending: number; synced: number }> {
  const db = await getDb();
  const pendingRow = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM enrollment_outbox WHERE sync_status = 'PENDING'`
  );
  const syncedRow = await db.getFirstAsync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM enrollment_outbox WHERE sync_status = 'SYNCED'`
  );
  return {
    pending: pendingRow?.cnt ?? 0,
    synced: syncedRow?.cnt ?? 0,
  };
}
