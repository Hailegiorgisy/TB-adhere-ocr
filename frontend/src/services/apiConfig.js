export const CURRENT_APP_VERSION = "2.6.0";
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const apiUrl = (path) => `${API_BASE}${path}`;
