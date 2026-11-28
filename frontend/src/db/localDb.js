import Dexie from "dexie";

export const localDb = new Dexie("BonoAddisDB_v6");

localDb.version(1).stores({
  restaurants: "id, status",
  stations: "id, restaurantId, code, active",
  staffUsers: "id, restaurantId, name, role, stationCode",
  menuItems: "id, restaurantId, stationCode, active",
  bonoAllocations: "id, restaurantId, shiftDate, waiterName, menuItemId",
  bonoRequests: "id, restaurantId, shiftDate, waiterName, status, syncStatus",
  tableSessions: "id, tableNo, turnoverNo, status",
  receipts: "id, restaurantId, shiftDate, waiterName, tableNumber, turnoverNo, menuItemId, stationCode, stationStatus, syncStatus, createdAtMs"
});

export async function ensureDefaultData() {
  if ((await localDb.restaurants.count()) === 0) {
    await localDb.restaurants.add({ id: "rest-1", name: "Addis Taste Hotel & Restaurant", tinNumber: "0012345678", status: "ACTIVE" });
  }
  if ((await localDb.stations.count()) === 0) {
    await localDb.stations.bulkAdd([
      { id: "st-1", restaurantId: "rest-1", code: "KITCHEN", nameAm: "ወጥ ቤት", nameEn: "Kitchen", active: true },
      { id: "st-2", restaurantId: "rest-1", code: "BARISTA", nameAm: "ባሪስታ", nameEn: "Barista / Bar", active: true },
      { id: "st-3", restaurantId: "rest-1", code: "COFFEE", nameAm: "ቡና ቤት", nameEn: "Coffee", active: true },
      { id: "st-4", restaurantId: "rest-1", code: "SIGA_BET", nameAm: "ስጋ ቤት", nameEn: "Siga Bet (Butcher)", active: true },
      { id: "st-5", restaurantId: "rest-1", code: "ROOMS", nameAm: "ክፍል / ሆቴል", nameEn: "Hotel Rooms", active: true }
    ]);
  }
  if ((await localDb.menuItems.count()) === 0) {
    await localDb.menuItems.bulkAdd([
      { id: "m-1", restaurantId: "rest-1", nameEn: "Special Kitfo", nameAm: "ስፔሻል ክትፎ", stationCode: "KITCHEN", unitPrice: 650, active: true },
      { id: "m-2", restaurantId: "rest-1", nameEn: "Doro Wat", nameAm: "ዶሮ ወጥ", stationCode: "KITCHEN", unitPrice: 700, active: true },
      { id: "m-3", restaurantId: "rest-1", nameEn: "1kg Kurt", nameAm: "1 ኪሎ ቁርጥ", stationCode: "SIGA_BET", unitPrice: 1400, active: true },
      { id: "m-4", restaurantId: "rest-1", nameEn: "Shekla Tibs", nameAm: "ሸክላ ጥብስ", stationCode: "SIGA_BET", unitPrice: 850, active: true },
      { id: "m-5", restaurantId: "rest-1", nameEn: "Draft Beer", nameAm: "ድራፍት ቢራ", stationCode: "BARISTA", unitPrice: 120, active: true },
      { id: "m-6", restaurantId: "rest-1", nameEn: "Macchiato", nameAm: "ማኪያቶ", stationCode: "COFFEE", unitPrice: 75, active: true },
      { id: "m-7", restaurantId: "rest-1", nameEn: "Standard Room", nameAm: "መደበኛ ክፍል", stationCode: "ROOMS", unitPrice: 2500, active: true }
    ]);
  }
  if ((await localDb.bonoAllocations.count()) === 0) {
    const today = new Date().toISOString().slice(0, 10);
    await localDb.bonoAllocations.bulkAdd([
      { id: "ba-1", restaurantId: "rest-1", shiftDate: today, waiterName: "ትግስት", menuItemId: "m-5", itemName: "ድራፍት ቢራ", quantityIssued: 20, isExtra: false },
      { id: "ba-2", restaurantId: "rest-1", shiftDate: today, waiterName: "ትግስት", menuItemId: "m-1", itemName: "ስፔሻል ክትፎ", quantityIssued: 10, isExtra: false },
      { id: "ba-3", restaurantId: "rest-1", shiftDate: today, waiterName: "ትግስት", menuItemId: "m-6", itemName: "ማኪያቶ", quantityIssued: 15, isExtra: false }
    ]);
  }
  if ((await localDb.tableSessions.count()) === 0) {
    const tables = Array.from({ length: 8 }, (_, i) => ({
      id: `tbl-${i + 1}`,
      tableNo: String(i + 1),
      turnoverNo: 1,
      status: "FREE"
    }));
    await localDb.tableSessions.bulkAdd(tables);
  }
}
