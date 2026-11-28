import { localDb } from "../db/localDb";
import { getAuthHeaders } from "./authService";
import { apiUrl, CURRENT_APP_VERSION } from "./apiConfig";

export async function checkForSoftwareUpdate() {
  try {
    const res = await fetch(apiUrl("/api/app/version"));
    if (!res.ok) return null;
    const data = await res.json();
    if (data.version && data.version !== CURRENT_APP_VERSION) {
      return data;
    }
  } catch {
    // Offline
  }
  return null;
}

export async function syncPendingData(restaurantId = "rest-1") {
  const headers = { "Content-Type": "application/json", ...getAuthHeaders() };
  let synced = 0;

  // 1. Sync pending sales receipts
  const pendingReceipts = await localDb.receipts.where("syncStatus").equals("PENDING").toArray();
  if (pendingReceipts.length > 0) {
    const res = await fetch(apiUrl("/api/sync/sales"), {
      method: "POST",
      headers,
      body: JSON.stringify({ receipts: pendingReceipts })
    });
    if (!res.ok) throw new Error("Sync failed — sign in online first");
    const data = await res.json();
    await localDb.receipts.where("id").anyOf(data.syncedIds).modify({ syncStatus: "SYNCED" });
    synced = data.count;
  }

  // 2. Sync pending Waitress bono requests
  const pendingReqs = await localDb.bonoRequests.where("syncStatus").equals("PENDING").toArray();
  if (pendingReqs.length > 0) {
    const reqRes = await fetch(apiUrl("/api/bono/requests"), {
      method: "POST",
      headers,
      body: JSON.stringify({ requests: pendingReqs })
    });
    if (reqRes.ok) {
      await localDb.bonoRequests.where("id").anyOf(pendingReqs.map((r) => r.id)).modify({ syncStatus: "SYNCED" });
    }
  }

  // 3. Pull latest menu, stations, and bono requests
  const [menuRes, stRes, reqListRes] = await Promise.all([
    fetch(apiUrl("/api/menu"), { headers }),
    fetch(apiUrl("/api/stations"), { headers }),
    fetch(apiUrl("/api/bono/requests"), { headers })
  ]);
  if (menuRes.ok) {
    const items = await menuRes.json();
    if (items.length > 0) {
      await localDb.menuItems.where("restaurantId").equals(restaurantId).delete();
      await localDb.menuItems.bulkAdd(items);
    }
  }
  if (stRes.ok) {
    const sts = await stRes.json();
    if (sts.length > 0) {
      await localDb.stations.where("restaurantId").equals(restaurantId).delete();
      await localDb.stations.bulkAdd(sts);
    }
  }
  if (reqListRes.ok) {
    const remoteReqs = await reqListRes.json();
    for (const rr of remoteReqs) {
      await localDb.bonoRequests.put({ ...rr, syncStatus: "SYNCED" });
    }
  }
  return { synced };
}
