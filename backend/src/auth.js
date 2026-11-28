import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_only_change_in_plesk";

export function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString("hex");
  const dk = crypto.scryptSync(String(pin), salt, 32).toString("hex");
  return `${salt}:${dk}`;
}

export function verifyPin(pin, storedHash) {
  const [salt, keyHex] = String(storedHash).split(":");
  if (!salt || !keyHex) return false;
  const derived = crypto.scryptSync(String(pin), salt, 32);
  const keyBuf = Buffer.from(keyHex, "hex");
  return derived.length === keyBuf.length && crypto.timingSafeEqual(derived, keyBuf);
}

export function signUserToken(user) {
  return jwt.sign(
    { userId: user.id, restaurantId: user.restaurant_id, role: user.role, stationCode: user.station_code, name: user.name },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing Authorization Bearer token" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden: requires [${allowedRoles.join(", ")}]` });
    }
    next();
  };
}
