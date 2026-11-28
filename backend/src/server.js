import express from "express";
import cors from "cors";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
import { hashPin, verifyPin, signUserToken, requireAuth, requireRole } from "./auth.js";

const app = express();
app.use(cors());
app.use(express.json());

let appRelease = {
  version: process.env.APP_VERSION || "2.6.0",
  apkUrl: process.env.APK_DOWNLOAD_URL || "https://bono.korcha.com.et/bono-addis-latest.apk",
  notes: process.env.UPDATE_NOTES || "Latest weekly release"
};

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// 1. WEEKLY SOFTWARE UPDATE ENDPOINT
app.get("/api/app/version", (_req, res) => res.json(appRelease));

app.post("/api/admin/release", requireAuth, requireRole("ADMIN"), (req, res) => {
  const { version, apkUrl, notes } = req.body;
  if (version) appRelease.version = version;
  if (apkUrl) appRelease.apkUrl = apkUrl;
  if (notes) appRelease.notes = notes;
  res.json(appRelease);
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { name, pin } = req.body;
    const [rows] = await pool.query(
      "SELECT id, restaurant_id, name, role, station_code, pin_hash, active FROM bono_users WHERE name = ? LIMIT 1",
      [(name || "").trim()]
    );
    const user = rows[0];
    if (!user || !user.active || !verifyPin(pin, user.pin_hash)) {
      return res.status(401).json({ error: "Invalid name or PIN" });
    }
    const token = signUserToken(user);
    res.json({
      token,
      user: { id: user.id, restaurantId: user.restaurant_id, name: user.name, role: user.role, stationCode: user.station_code }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/admin/restaurants", requireAuth, requireRole("ADMIN"), async (_req, res) => {
  const [rows] = await pool.query("SELECT * FROM bono_restaurants ORDER BY created_at DESC");
  res.json(rows);
});

app.post("/api/admin/restaurants", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const { name, tinNumber = "", phone = "", ownerName = "Owner", ownerPin = "1234" } = req.body;
  const restId = crypto.randomUUID();
  await pool.query("INSERT INTO bono_restaurants (id, name, tin_number, phone, status) VALUES (?, ?, ?, ?, 'ACTIVE')", [restId, name, tinNumber, phone]);
  await pool.query("INSERT INTO bono_users (id, restaurant_id, name, role, pin_hash, active) VALUES (?, ?, ?, 'OWNER', ?, TRUE)", [crypto.randomUUID(), restId, ownerName, hashPin(ownerPin)]);
  res.status(201).json({ id: restId, name, status: "ACTIVE" });
});

app.get("/api/stations", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, restaurant_id AS restaurantId, code, name_am AS nameAm, name_en AS nameEn, active FROM bono_service_stations WHERE restaurant_id = ? AND active = TRUE",
    [req.user.restaurantId]
  );
  res.json(rows);
});

app.post("/api/stations", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { nameAm, nameEn = "", staffPin = "8888" } = req.body;
  const id = crypto.randomUUID();
  const code = (nameEn || nameAm).toUpperCase().replace(/[^A-Z0-9]+/g, "_") || `ST_${Date.now()}`;
  await pool.query("INSERT INTO bono_service_stations (id, restaurant_id, code, name_am, name_en, active) VALUES (?, ?, ?, ?, ?, TRUE)", [id, req.user.restaurantId, code, nameAm, nameEn || nameAm]);
  await pool.query("INSERT INTO bono_users (id, restaurant_id, name, role, station_code, pin_hash, active) VALUES (?, ?, ?, 'STATION', ?, ?, TRUE)", [crypto.randomUUID(), req.user.restaurantId, nameAm, code, hashPin(staffPin)]);
  res.status(201).json({ id, restaurantId: req.user.restaurantId, code, nameAm, nameEn: nameEn || nameAm, active: true });
});

app.get("/api/menu", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, restaurant_id AS restaurantId, name_en AS nameEn, name_am AS nameAm, station_code AS stationCode, unit_price AS unitPrice, active FROM bono_menu_items WHERE restaurant_id = ? ORDER BY station_code, name_am",
    [req.user.restaurantId]
  );
  res.json(rows);
});

app.post("/api/menu", requireAuth, requireRole("OWNER"), async (req, res) => {
  const { nameEn = "", nameAm, stationCode = "KITCHEN", unitPrice } = req.body;
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO bono_menu_items (id, restaurant_id, name_en, name_am, station_code, unit_price, active) VALUES (?, ?, ?, ?, ?, ?, TRUE)",
    [id, req.user.restaurantId, nameEn || nameAm, nameAm, stationCode, Number(unitPrice).toFixed(2)]
  );
  res.status(201).json({ id, restaurantId: req.user.restaurantId, nameEn: nameEn || nameAm, nameAm, stationCode, unitPrice: Number(unitPrice), active: true });
});

app.post("/api/bono/allocate", requireAuth, requireRole("OWNER", "CASHIER"), async (req, res) => {
  const { shiftDate, waiterName, menuItemId, itemName, quantityIssued, isExtra = false } = req.body;
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO bono_allocations (id, restaurant_id, shift_date, waiter_name, menu_item_id, item_name, quantity_issued, is_extra, issued_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, req.user.restaurantId, shiftDate, waiterName, menuItemId, itemName, Number(quantityIssued), Boolean(isExtra), req.user.name]
  );
  res.status(201).json({ id, shiftDate, waiterName, menuItemId, itemName, quantityIssued: Number(quantityIssued), isExtra: Boolean(isExtra) });
});

// WAITRESS REQUEST FOR MORE BONO -> OWNER/CASHIER APPROVAL
app.get("/api/bono/requests", requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    "SELECT id, restaurant_id AS restaurantId, shift_date AS shiftDate, waiter_name AS waiterName, menu_item_id AS menuItemId, item_name AS itemName, quantity_requested AS quantityRequested, status, created_at_ms AS createdAtMs FROM bono_requests WHERE restaurant_id = ? ORDER BY created_at_ms DESC",
    [req.user.restaurantId]
  );
  res.json(rows);
});

app.post("/api/bono/requests", requireAuth, async (req, res) => {
  const { requests = [] } = req.body;
  for (const r of requests) {
    await pool.query(
      "INSERT IGNORE INTO bono_requests (id, restaurant_id, shift_date, waiter_name, menu_item_id, item_name, quantity_requested, status, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [r.id, req.user.restaurantId, r.shiftDate, r.waiterName || req.user.name, r.menuItemId, r.itemName, Number(r.quantityRequested), r.status || "PENDING", Number(r.createdAtMs || Date.now())]
    );
  }
  res.json({ ok: true });
});

app.post("/api/bono/requests/:id/approve", requireAuth, requireRole("OWNER", "CASHIER"), async (req, res) => {
  await pool.query("UPDATE bono_requests SET status = 'APPROVED' WHERE id = ? AND restaurant_id = ?", [req.params.id, req.user.restaurantId]);
  res.json({ id: req.params.id, status: "APPROVED" });
});

app.post("/api/sync/sales", requireAuth, async (req, res) => {
  const { receipts = [] } = req.body;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const syncedIds = [];
    for (const r of receipts) {
      await conn.query(
        `INSERT INTO bono_sales_receipts
         (id, restaurant_id, shift_date, waiter_id, waiter_name, table_number, turnover_no, menu_item_id, item_label, order_note, quantity, station_code, station_status, payment_method, channel, unit_price, service_amount, total_amount, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE station_status = VALUES(station_status)`,
        [
          r.id, req.user.restaurantId, r.shiftDate, r.waiterId || req.user.userId, r.waiterName || req.user.name,
          r.tableNumber || "", Number(r.turnoverNo || 1), r.menuItemId || "", r.itemLabel || "", r.orderNote || "",
          Number(r.quantity || 1), r.stationCode || "KITCHEN", r.stationStatus || "PENDING", r.paymentMethod || "CASH",
          r.channel || "WEB", Number(r.unitPrice || 0).toFixed(2), Number(r.serviceAmount || 0).toFixed(2), Number(r.totalAmount).toFixed(2),
          Number(r.createdAtMs || Date.now())
        ]
      );
      syncedIds.push(r.id);
    }
    await conn.commit();
    res.json({ syncedIds, count: syncedIds.length });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDist = path.resolve(__dirname, "../public");
app.use(express.static(frontendDist));
app.get("*", (_req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`Bono Addis v2.6 running on port ${port}`));
