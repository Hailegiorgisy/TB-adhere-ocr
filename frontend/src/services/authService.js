import { localDb } from "../db/localDb";
import { apiUrl } from "./apiConfig";

const STORAGE_KEY = "bonoaddis_auth_session_v6";

const OFFLINE_DEMO_USERS = [
  { id: "u-admin-1", restaurantId: null, name: "Admin", role: "ADMIN", stationCode: null, pin: "9999" },
  { id: "u-owner-1", restaurantId: "rest-1", name: "Owner", role: "OWNER", stationCode: null, pin: "1234" },
  { id: "u-cashier-1", restaurantId: "rest-1", name: "Cashier", role: "CASHIER", stationCode: null, pin: "2222" },
  { id: "u-waiter-1", restaurantId: "rest-1", name: "ትግስት", role: "WAITRESS", stationCode: null, pin: "0001" },
  { id: "u-st-kitchen", restaurantId: "rest-1", name: "ወጥ ቤት", role: "STATION", stationCode: "KITCHEN", pin: "3333" },
  { id: "u-st-barista", restaurantId: "rest-1", name: "ባሪስታ", role: "STATION", stationCode: "BARISTA", pin: "4444" },
  { id: "u-st-coffee", restaurantId: "rest-1", name: "ቡና ቤት", role: "STATION", stationCode: "COFFEE", pin: "5555" },
  { id: "u-st-siga", restaurantId: "rest-1", name: "ስጋ ቤት", role: "STATION", stationCode: "SIGA_BET", pin: "6666" },
  { id: "u-st-rooms", restaurantId: "rest-1", name: "ክፍል", role: "STATION", stationCode: "ROOMS", pin: "7777" }
];

export function getSavedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function getAuthHeaders() {
  const session = getSavedSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

export async function loginWithPin(name, pin) {
  const cleanName = name.trim();
  const cleanPin = pin.trim();
  try {
    const res = await fetch(apiUrl("/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName, pin: cleanPin })
    });
    if (res.ok) {
      const data = await res.json();
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, lastPin: cleanPin }));
      return data;
    }
    if (res.status === 401 || res.status === 403) throw new Error("AUTH_FAILED");
  } catch (err) {
    if (err.message === "AUTH_FAILED") throw err;
    const cached = getSavedSession();
    if (cached && cached.user?.name === cleanName && cached.lastPin === cleanPin) return cached;

    const customUser = await localDb.staffUsers.where("name").equals(cleanName).first();
    if (customUser && customUser.pin === cleanPin) {
      const s = { token: null, user: { id: customUser.id, restaurantId: customUser.restaurantId, name: customUser.name, role: customUser.role, stationCode: customUser.stationCode }, lastPin: cleanPin };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
      return s;
    }

    const demo = OFFLINE_DEMO_USERS.find((u) => u.name === cleanName && u.pin === cleanPin);
    if (demo) {
      const offlineSession = { token: null, user: { id: demo.id, restaurantId: demo.restaurantId, name: demo.name, role: demo.role, stationCode: demo.stationCode }, lastPin: cleanPin };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(offlineSession));
      return offlineSession;
    }
    throw new Error("AUTH_FAILED");
  }
  throw new Error("AUTH_FAILED");
}

export function logoutSession() {
  localStorage.removeItem(STORAGE_KEY);
}
