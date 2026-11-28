import React, { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb, ensureDefaultData } from "./db/localDb";
import { calculateTotal } from "./utils/taxMath";
import { playOrderAlarm } from "./utils/alarmSound";
import { syncPendingData, checkForSoftwareUpdate } from "./services/syncService";
import { getSavedSession, loginWithPin, logoutSession, getAuthHeaders } from "./services/authService";
import { apiUrl, CURRENT_APP_VERSION } from "./services/apiConfig";
import { isTelegramMiniApp, initTelegramMiniApp, triggerTelegramHaptic } from "./services/telegramBridge";
import { STRINGS } from "./i18n/strings";

const TODAY = () => new Date().toISOString().slice(0, 10);

export default function App() {
  const [lang, setLang] = useState("am");
  const t = STRINGS[lang];

  const [session, setSession] = useState(() => getSavedSession());
  const [loginName, setLoginName] = useState("ትግስት");
  const [loginPin, setLoginPin] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [updateInfo, setUpdateInfo] = useState(null);

  // Waitress tables & order form
  const [selectedTableNo, setSelectedTableNo] = useState("1");
  const [selectedItemId, setSelectedItemId] = useState("m-5");
  const [saleQty, setSaleQty] = useState("1");
  const [orderNote, setOrderNote] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("CASH");
  const [includesService, setIncludesService] = useState(false);
  const [reqItemId, setReqItemId] = useState("m-5");
  const [reqQty, setReqQty] = useState("15");
  const [statusMsg, setStatusMsg] = useState("");

  // Station alarm toggle
  const [alarmEnabled, setAlarmEnabled] = useState(true);
  const prevPendingStationRef = useRef(0);

  // Owner & Admin forms
  const [newStationAm, setNewStationAm] = useState("");
  const [newStationPin, setNewStationPin] = useState("8888");
  const [newDish, setNewDish] = useState("");
  const [newDishStation, setNewDishStation] = useState("KITCHEN");
  const [newPrice, setNewPrice] = useState("");
  const [waiterTarget, setWaiterTarget] = useState("ትግስት");
  const [allocItemId, setAllocItemId] = useState("m-5");
  const [allocQty, setAllocQty] = useState("10");
  const [newRestName, setNewRestName] = useState("");
  const [newRestTin, setNewRestTin] = useState("");

  const user = session?.user;
  const role = user?.role;
  const restaurantId = user?.restaurantId || "rest-1";

  useEffect(() => {
    initTelegramMiniApp();
    ensureDefaultData();
    checkForSoftwareUpdate().then(setUpdateInfo);

    const handleOnline = () => {
      setIsOnline(true);
      if (getSavedSession()?.token) {
        syncPendingData(getSavedSession()?.user?.restaurantId || "rest-1").catch(() => {});
      }
      checkForSoftwareUpdate().then(setUpdateInfo);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const stations = useLiveQuery(() => localDb.stations.toArray(), []) || [];
  const menuItems = useLiveQuery(() => localDb.menuItems.toArray(), []) || [];
  const allocations = useLiveQuery(() => localDb.bonoAllocations.toArray(), []) || [];
  const bonoRequests = useLiveQuery(() => localDb.bonoRequests.reverse().toArray(), []) || [];
  const tableSessions = useLiveQuery(() => localDb.tableSessions.toArray(), []) || [];
  const receipts = useLiveQuery(() => localDb.receipts.reverse().toArray(), []) || [];
  const restaurants = useLiveQuery(() => localDb.restaurants.toArray(), []) || [];

  // Trigger audio alarm on Station screen when new PENDING orders arrive
  const stationQueue = receipts.filter((r) => r.stationCode === user?.stationCode);
  const pendingStationCount = stationQueue.filter((r) => r.stationStatus === "PENDING").length;
  useEffect(() => {
    if (role === "STATION" && alarmEnabled && pendingStationCount > prevPendingStationRef.current) {
      playOrderAlarm();
    }
    prevPendingStationRef.current = pendingStationCount;
  }, [role, alarmEnabled, pendingStationCount]);

  const stationLabel = (code) => {
    const found = stations.find((s) => s.code === code);
    return found ? (lang === "am" ? found.nameAm : found.nameEn) : code;
  };

  const activeTableObj = tableSessions.find((tb) => tb.tableNo === selectedTableNo) || { tableNo: selectedTableNo, turnoverNo: 1, status: "FREE" };
  const selectedItem = menuItems.find((m) => m.id === selectedItemId) || menuItems[0];
  const calc = calculateTotal({ unitPrice: selectedItem?.unitPrice || 0, quantity: Number(saleQty || 1), includesService });
  const pendingCount = receipts.filter((r) => r.syncStatus === "PENDING").length + bonoRequests.filter((q) => q.syncStatus === "PENDING").length;
  const activeChannel = isTelegramMiniApp() ? "TELEGRAM" : "WEB";

  async function handleLogin(e) {
    e.preventDefault();
    setLoginError("");
    try {
      const auth = await loginWithPin(loginName, loginPin);
      setSession(auth);
      setLoginPin("");
      triggerTelegramHaptic("success");
    } catch {
      setLoginError(t.authFailed);
    }
  }

  function handleLogout() {
    logoutSession();
    setSession(null);
    setStatusMsg("");
  }

  async function saveOfflineSale(e) {
    e.preventDefault();
    if (!selectedItem || Number(saleQty) <= 0) return;
    await localDb.receipts.add({
      id: crypto.randomUUID(),
      restaurantId,
      shiftDate: TODAY(),
      waiterId: user.id,
      waiterName: user.name,
      tableNumber: selectedTableNo,
      turnoverNo: activeTableObj.turnoverNo || 1,
      menuItemId: selectedItem.id,
      itemLabel: lang === "am" ? selectedItem.nameAm : selectedItem.nameEn,
      orderNote: orderNote.trim(),
      quantity: Number(saleQty),
      unitPrice: selectedItem.unitPrice,
      stationCode: selectedItem.stationCode,
      stationStatus: "PENDING",
      paymentMethod,
      channel: activeChannel,
      ...calc,
      syncStatus: "PENDING",
      createdAtMs: Date.now()
    });
    if (activeTableObj.id) {
      await localDb.tableSessions.update(activeTableObj.id, { status: "OCCUPIED" });
    }
    setSaleQty("1");
    setOrderNote("");
    setStatusMsg(t.savedOffline);
    triggerTelegramHaptic("success");
  }

  async function closeTableTurnover() {
    if (!activeTableObj.id) return;
    const nextTurn = (activeTableObj.turnoverNo || 1) + 1;
    await localDb.tableSessions.update(activeTableObj.id, { status: "FREE", turnoverNo: nextTurn });
    setStatusMsg(`${t.tableLabel} ${selectedTableNo} → ${t.turnoverLabel} #${nextTurn}`);
  }

  async function handleRequestMoreBono(e) {
    e.preventDefault();
    const item = menuItems.find((m) => m.id === reqItemId) || menuItems[0];
    if (!item || Number(reqQty) <= 0) return;
    await localDb.bonoRequests.add({
      id: crypto.randomUUID(),
      restaurantId,
      shiftDate: TODAY(),
      waiterName: user.name,
      menuItemId: item.id,
      itemName: lang === "am" ? item.nameAm : item.nameEn,
      quantityRequested: Number(reqQty),
      status: "PENDING",
      syncStatus: "PENDING",
      createdAtMs: Date.now()
    });
    setStatusMsg(`${t.requestBonoTitle}: ${lang === "am" ? item.nameAm : item.nameEn} (+${reqQty})`);
    triggerTelegramHaptic("success");
  }

  async function approveBonoRequest(req) {
    await localDb.bonoAllocations.add({
      id: crypto.randomUUID(),
      restaurantId,
      shiftDate: TODAY(),
      waiterName: req.waiterName,
      menuItemId: req.menuItemId,
      itemName: req.itemName,
      quantityIssued: Number(req.quantityRequested),
      isExtra: true
    });
    await localDb.bonoRequests.update(req.id, { status: "APPROVED", syncStatus: "SYNCED" });
    fetch(apiUrl(`/api/bono/requests/${req.id}/approve`), { method: "POST", headers: getAuthHeaders() }).catch(() => {});
    fetch(apiUrl("/api/bono/allocate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ shiftDate: TODAY(), waiterName: req.waiterName, menuItemId: req.menuItemId, itemName: req.itemName, quantityIssued: req.quantityRequested, isExtra: true })
    }).catch(() => {});
    setStatusMsg(`${t.approveIssueBtn}: ${req.waiterName} (${req.itemName} +${req.quantityRequested})`);
  }

  async function markStationDone(id) {
    await localDb.receipts.update(id, { stationStatus: "DONE", syncStatus: "PENDING" });
    triggerTelegramHaptic("success");
  }

  async function handleSync() {
    try {
      const res = await syncPendingData(restaurantId);
      setStatusMsg(`${t.statusSynced}: ${res.synced}`);
      triggerTelegramHaptic("success");
    } catch (err) {
      setStatusMsg(err.message);
    }
  }

  async function handleAllocateBono(isExtra) {
    if ((role !== "OWNER" && role !== "CASHIER") || Number(allocQty) <= 0) return;
    const item = menuItems.find((m) => m.id === allocItemId) || menuItems[0];
    if (!item) return;
    const payload = {
      id: crypto.randomUUID(),
      restaurantId,
      shiftDate: TODAY(),
      waiterName: waiterTarget.trim(),
      menuItemId: item.id,
      itemName: lang === "am" ? item.nameAm : item.nameEn,
      quantityIssued: Number(allocQty),
      isExtra
    };
    await localDb.bonoAllocations.add(payload);
    fetch(apiUrl("/api/bono/allocate"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(payload)
    }).catch(() => {});
    setStatusMsg(`${isExtra ? t.addExtraBonoBtn : t.issueBonoBtn}: ${payload.itemName} (+${payload.quantityIssued})`);
  }

  async function handleAddStation(e) {
    e.preventDefault();
    if (role !== "OWNER" || !newStationAm.trim()) return;
    const cleanName = newStationAm.trim();
    const code = `ST_${Date.now()}`;
    await localDb.stations.add({ id: crypto.randomUUID(), restaurantId, code, nameAm: cleanName, nameEn: cleanName, active: true });
    await localDb.staffUsers.add({ id: crypto.randomUUID(), restaurantId, name: cleanName, role: "STATION", stationCode: code, pin: newStationPin || "8888" });
    fetch(apiUrl("/api/stations"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify({ nameAm: cleanName, nameEn: cleanName, staffPin: newStationPin || "8888" })
    }).catch(() => {});
    setNewStationAm("");
  }

  async function handleAddMenuItem(e) {
    e.preventDefault();
    if (role !== "OWNER" || !newDish || Number(newPrice) <= 0) return;
    const item = { id: crypto.randomUUID(), restaurantId, nameEn: newDish, nameAm: newDish, stationCode: newDishStation, unitPrice: Number(newPrice), active: true };
    await localDb.menuItems.add(item);
    fetch(apiUrl("/api/menu"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getAuthHeaders() },
      body: JSON.stringify(item)
    }).catch(() => {});
    setNewDish("");
    setNewPrice("");
  }

  async function handleAddRestaurant(e) {
    e.preventDefault();
    if (role !== "ADMIN" || !newRestName) return;
    await localDb.restaurants.add({ id: crypto.randomUUID(), name: newRestName, tinNumber: newRestTin, status: "ACTIVE" });
    setNewRestName("");
    setNewRestTin("");
  }

  if (!user) {
    return (
      <main className="container" style={{ maxWidth: 440, marginTop: 28 }}>
        <div className="card">
          <div className="row space-between" style={{ marginBottom: 12 }}>
            <div className="row">
              <img src="/logo.png" alt="Bono Addis" className="logo-img" />
              <h2 style={{ margin: 0 }}>{t.appTitle}</h2>
            </div>
            <button className="btn-chip" onClick={() => setLang(lang === "am" ? "en" : "am")}>
              {lang === "am" ? "English" : "አማርኛ"}
            </button>
          </div>
          <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>{t.loginTitle}</p>
          <form onSubmit={handleLogin} className="row">
            <input placeholder={t.userName} value={loginName} onChange={(e) => setLoginName(e.target.value)} />
            <input type="password" inputMode="numeric" placeholder={t.pinCode} value={loginPin} onChange={(e) => setLoginPin(e.target.value)} />
            {loginError && <small style={{ color: "var(--tertiary)", width: "100%" }}>{loginError}</small>}
            <button type="submit" className="btn-primary" style={{ width: "100%" }}>{t.loginBtn}</button>
          </form>
          <small style={{ display: "block", marginTop: 12, color: "var(--text-secondary)" }}>
            Demo PINs — ትግስት: 0001 | ወጥ ቤት: 3333 | ባሪስታ: 4444 | ቡና ቤት: 5555 | ስጋ ቤት: 6666 | ክፍል: 7777 | Cashier: 2222 | Owner: 1234 | Admin: 9999
          </small>
        </div>
      </main>
    );
  }

  const isStationRole = role === "STATION";
  const pendingBonoReqs = bonoRequests.filter((q) => q.status === "PENDING");
  const targetWaiter = role === "WAITRESS" ? user.name : waiterTarget;
  const waiterAllocItems = menuItems.map((m) => {
    const issued = allocations.filter((a) => a.waiterName === targetWaiter && a.menuItemId === m.id).reduce((s, a) => s + Number(a.quantityIssued), 0);
    const sold = receipts.filter((r) => r.waiterName === targetWaiter && r.menuItemId === m.id).reduce((s, r) => s + Number(r.quantity || 1), 0);
    return { item: m, issued, sold, remaining: issued - sold };
  }).filter((row) => row.issued > 0 || row.sold > 0);

  return (
    <>
      <header className="app-header">
        <div className="container row space-between" style={{ padding: 0 }}>
          <div className="row">
            <img src="/logo.png" alt="Bono Addis" className="logo-img" />
            <div>
              <h2 style={{ margin: 0, fontSize: "18px" }}>{t.appTitle} <small style={{ fontSize: "11px", color: "var(--text-secondary)" }}>v{CURRENT_APP_VERSION}</small></h2>
              <small style={{ color: "var(--text-secondary)" }}>{user.name} • {t.roles[role]} • {isOnline ? t.onlineLabel : t.offlineLabel}</small>
            </div>
          </div>
          <div className="row">
            <button className="btn-chip" onClick={() => setLang(lang === "am" ? "en" : "am")}>{lang === "am" ? "EN" : "አማ"}</button>
            <button className="btn-accent" onClick={handleSync}>{t.syncNow} ({pendingCount})</button>
            <button className="btn-chip" onClick={handleLogout}>{t.logoutBtn}</button>
          </div>
        </div>
      </header>

      <main className="container">
        {updateInfo && (
          <div className="update-banner row space-between">
            <div>
              <strong>{t.updateAvailable} (v{updateInfo.version})</strong>
              <div style={{ fontSize: "12.5px" }}>{updateInfo.notes}</div>
            </div>
            {isTelegramMiniApp() ? (
              <button className="btn-primary" onClick={() => window.location.reload()}>{t.updateNowBtn}</button>
            ) : (
              <a href={updateInfo.apkUrl} target="_blank" rel="noreferrer" className="btn-primary" style={{ textDecoration: "none", padding: "8px 12px", borderRadius: "10px" }}>{t.updateNowBtn}</a>
            )}
          </div>
        )}

        {statusMsg && <div className="card" style={{ padding: "10px 14px" }}>{statusMsg}</div>}

        {role === "ADMIN" && (
          <div className="card">
            <h3>{t.adminTitle}</h3>
            <form onSubmit={handleAddRestaurant} className="row">
              <input placeholder={t.restaurantName} value={newRestName} onChange={(e) => setNewRestName(e.target.value)} />
              <input placeholder={t.tinNo} value={newRestTin} onChange={(e) => setNewRestTin(e.target.value)} />
              <button type="submit" className="btn-primary">{t.addRestaurantBtn}</button>
            </form>
            <ul>
              {restaurants.map((r) => <li key={r.id}><strong>{r.name}</strong> (TIN: {r.tinNumber || "-"}) — {r.status}</li>)}
            </ul>
          </div>
        )}

        {isStationRole && (
          <div className="card">
            <div className="row space-between">
              <h3 style={{ margin: 0 }}>{stationLabel(user.stationCode)} — {t.stationQueueTitle}</h3>
              <button className="btn-chip" onClick={() => setAlarmEnabled(!alarmEnabled)}>{alarmEnabled ? t.soundOn : t.soundOff}</button>
            </div>
            <table>
              <thead>
                <tr><th>{t.tableLabel}</th><th>{t.dishName}</th><th>{t.qtyLabel}</th><th></th></tr>
              </thead>
              <tbody>
                {stationQueue.map((r) => (
                  <tr key={r.id}>
                    <td>{t.tableLabel} {r.tableNumber} ({t.turnoverLabel} #{r.turnoverNo || 1})<br /><small>{r.waiterName}</small></td>
                    <td>
                      <strong>{r.itemLabel}</strong>
                      {r.orderNote && <div style={{ color: "var(--primary)", fontSize: "12.5px" }}>({r.orderNote})</div>}
                    </td>
                    <td><strong>{r.quantity || 1}</strong></td>
                    <td>
                      {r.stationStatus === "DONE" ? (
                        <span className="badge-synced">{t.doneLabel}</span>
                      ) : (
                        <button className="btn-primary" onClick={() => markStationDone(r.id)}>{t.markDone}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {role === "WAITRESS" && (
          <>
            <div className="card">
              <div className="row space-between">
                <h3 style={{ margin: 0 }}>{t.tablesTitle}</h3>
                {activeTableObj.status === "OCCUPIED" && (
                  <button className="btn-danger" onClick={closeTableTurnover}>{t.closeTableBtn}</button>
                )}
              </div>
              <div className="table-grid">
                {tableSessions.map((tb) => {
                  const tableTotal = receipts
                    .filter((r) => r.tableNumber === tb.tableNo && (r.turnoverNo || 1) === (tb.turnoverNo || 1))
                    .reduce((s, r) => s + r.totalAmount, 0);
                  return (
                    <button
                      key={tb.id}
                      type="button"
                      className={`table-tile ${tb.status === "OCCUPIED" ? "occupied" : ""} ${selectedTableNo === tb.tableNo ? "selected" : ""}`}
                      onClick={() => setSelectedTableNo(tb.tableNo)}
                    >
                      <div><strong>{t.tableLabel} {tb.tableNo}</strong></div>
                      <small style={{ color: "var(--text-secondary)" }}>{t.turnoverLabel} #{tb.turnoverNo || 1}</small>
                      <div style={{ fontSize: "12.5px", color: tb.status === "OCCUPIED" ? "var(--primary)" : "var(--secondary)" }}>
                        {tb.status === "OCCUPIED" ? `${tableTotal.toFixed(0)} ETB` : t.freeLabel}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t.waiterPos} — {t.tableLabel} {selectedTableNo} ({t.turnoverLabel} #{activeTableObj.turnoverNo || 1})</h3>
              <form onSubmit={saveOfflineSale} className="row">
                <select value={selectedItemId} onChange={(e) => setSelectedItemId(e.target.value)}>
                  {menuItems.filter((m) => m.active).map((m) => (
                    <option key={m.id} value={m.id}>{lang === "am" ? m.nameAm : m.nameEn} ({m.unitPrice} ETB)</option>
                  ))}
                </select>
                <input type="number" min="1" placeholder={t.qtyLabel} value={saleQty} onChange={(e) => setSaleQty(e.target.value)} />
                <input placeholder={t.orderNotePlaceholder} value={orderNote} onChange={(e) => setOrderNote(e.target.value)} style={{ flex: "1 1 100%" }} />
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="CASH">{t.payments.CASH}</option>
                  <option value="TELEBIRR">{t.payments.TELEBIRR}</option>
                  <option value="CBE_BIRR">{t.payments.CBE_BIRR}</option>
                </select>
                <label className="row" style={{ fontSize: "13.5px" }}>
                  <input type="checkbox" checked={includesService} onChange={(e) => setIncludesService(e.target.checked)} style={{ flex: "none" }} /> {t.serviceCharge}
                </label>
                <button type="submit" className="btn-primary" style={{ width: "100%" }}>{t.saveSale} — {calc.totalAmount.toFixed(2)} ETB</button>
              </form>
            </div>

            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t.myBonoBalance}</h3>
              <table>
                <thead><tr><th>{t.dishName}</th><th>{t.issuedCol}</th><th>{t.soldCol}</th><th>{t.remainingCol}</th></tr></thead>
                <tbody>
                  {waiterAllocItems.map(({ item, issued, sold, remaining }) => (
                    <tr key={item.id}>
                      <td>{lang === "am" ? item.nameAm : item.nameEn}</td>
                      <td>{issued}</td>
                      <td>{sold}</td>
                      <td><strong style={{ color: remaining <= 2 ? "var(--tertiary)" : "var(--secondary)" }}>{remaining}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <form onSubmit={handleRequestMoreBono} className="row" style={{ marginTop: 12 }}>
                <select value={reqItemId} onChange={(e) => setReqItemId(e.target.value)}>
                  {menuItems.filter((m) => m.active).map((m) => (
                    <option key={m.id} value={m.id}>{lang === "am" ? itemName(m, lang) : m.nameEn}</option>
                  ))}
                </select>
                <input type="number" min="1" value={reqQty} onChange={(e) => setReqQty(e.target.value)} />
                <button type="submit" className="btn-accent">{t.requestBonoTitle}</button>
              </form>
            </div>
          </>
        )}

        {(role === "CASHIER" || role === "OWNER") && (
          <>
            {pendingBonoReqs.length > 0 && (
              <div className="card" style={{ borderColor: "var(--primary)" }}>
                <h3 style={{ marginTop: 0, color: "var(--primary)" }}>{t.pendingRequestsTitle} ({pendingBonoReqs.length})</h3>
                {pendingBonoReqs.map((rq) => (
                  <div key={rq.id} className="row space-between" style={{ padding: "6px 0", borderBottom: "1px dashed var(--receipt-dotted)" }}>
                    <span><strong>{rq.waiterName}</strong> → {rq.itemName} (+{rq.quantityRequested})</span>
                    <button className="btn-primary" onClick={() => approveBonoRequest(rq)}>{t.approveIssueBtn}</button>
                  </div>
                ))}
              </div>
            )}

            <div className="card">
              <h3>{t.issueBonoTitle}</h3>
              <div className="row">
                <input placeholder={t.roles.WAITRESS} value={waiterTarget} onChange={(e) => setWaiterTarget(e.target.value)} />
                <select value={allocItemId} onChange={(e) => setAllocItemId(e.target.value)}>
                  {menuItems.filter((m) => m.active).map((m) => (
                    <option key={m.id} value={m.id}>{lang === "am" ? m.nameAm : m.nameEn}</option>
                  ))}
                </select>
                <input type="number" min="1" placeholder={t.bonoQty} value={allocQty} onChange={(e) => setAllocQty(e.target.value)} />
                <button type="button" className="btn-primary" onClick={() => handleAllocateBono(false)}>{t.issueBonoBtn}</button>
                <button type="button" className="btn-accent" onClick={() => handleAllocateBono(true)}>{t.addExtraBonoBtn}</button>
              </div>
            </div>

            <div className="card">
              <h3>{t.reconcileTitle}</h3>
              <table>
                <thead><tr><th>{t.roles.STATION}</th><th>{t.qtyLabel}</th><th>{t.doneLabel}</th><th>{t.totalBill}</th></tr></thead>
                <tbody>
                  {stations.filter((s) => s.active).map((st) => {
                    const list = receipts.filter((r) => r.stationCode === st.code);
                    const totalQty = list.reduce((s, r) => s + Number(r.quantity || 1), 0);
                    const doneQty = list.filter((r) => r.stationStatus === "DONE").reduce((s, r) => s + Number(r.quantity || 1), 0);
                    const sum = list.reduce((s, r) => s + r.totalAmount, 0);
                    return (
                      <tr key={st.code}>
                        <td><strong>{lang === "am" ? st.nameAm : st.nameEn}</strong></td>
                        <td>{totalQty}</td>
                        <td>{doneQty} / {totalQty}</td>
                        <td><strong>{sum.toFixed(2)} ETB</strong></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {role === "OWNER" && (
          <>
            <div className="card">
              <h3>{t.ownerStationsTitle}</h3>
              <form onSubmit={handleAddStation} className="row">
                <input placeholder={t.stationNameAm} value={newStationAm} onChange={(e) => setNewStationAm(e.target.value)} />
                <input placeholder={t.stationPin} value={newStationPin} onChange={(e) => setNewStationPin(e.target.value)} />
                <button type="submit" className="btn-primary">{t.addStationBtn}</button>
              </form>
            </div>

            <div className="card">
              <h3>{t.ownerMenuTitle}</h3>
              <form onSubmit={handleAddMenuItem} className="row">
                <input placeholder={t.dishName} value={newDish} onChange={(e) => setNewDish(e.target.value)} />
                <select value={newDishStation} onChange={(e) => setNewDishStation(e.target.value)}>
                  {stations.filter((s) => s.active).map((s) => (
                    <option key={s.code} value={s.code}>{lang === "am" ? s.nameAm : s.nameEn}</option>
                  ))}
                </select>
                <input type="number" step="0.01" placeholder={t.priceBirr} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                <button type="submit" className="btn-accent">{t.addMenuBtn}</button>
              </form>
            </div>
          </>
        )}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>{t.receiptsLog}</h3>
          <table>
            <thead><tr><th>{t.tableLabel}</th><th>{t.dishName}</th><th>{t.qtyLabel}</th><th>{t.totalBill}</th><th>{t.syncNow}</th></tr></thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id}>
                  <td>{t.tableLabel} {r.tableNumber} (#{r.turnoverNo || 1})</td>
                  <td>{r.itemLabel}{r.orderNote ? ` (${r.orderNote})` : ""}</td>
                  <td>{r.quantity || 1}</td>
                  <td><strong>{r.totalAmount.toFixed(2)}</strong></td>
                  <td><span className={r.syncStatus === "PENDING" ? "badge-pending" : "badge-synced"}>{r.syncStatus === "PENDING" ? t.statusPending : t.statusSynced}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}

function itemName(m, lang) {
  return lang === "am" ? m.nameAm : m.nameEn;
}
