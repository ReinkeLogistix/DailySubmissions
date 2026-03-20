const SUPABASE_URL = "https://yisupzgtgvcvdzqlahux.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Hjhv7-h_zUlW0k-h0sqIWQ_Mqhgwkkl";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/*
  Add the driver_code values that are allowed to use the admin page.
  Example: ["ADMIN", "DR001"]
*/
const ALLOWED_ADMIN_CODES = ["ADMIN"];

let currentAdmin = null;

function $(id) {
  return document.getElementById(id);
}

function showAdminMessage(text, isError = false) {
  const el = $("adminMessage");
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#166534";
}

function showUploadMessage(text, isError = false) {
  const el = $("uploadMessage");
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#166534";
}

function setAdminPanelsLoggedIn(isLoggedIn) {
  $("adminLoginPanel").classList.toggle("hidden", isLoggedIn);
  $("adminInfoPanel").classList.toggle("hidden", !isLoggedIn);
  $("adminDashboardCard").classList.toggle("hidden", !isLoggedIn);
  $("uploadCard").classList.toggle("hidden", !isLoggedIn);
  $("notesCard").classList.toggle("hidden", !isLoggedIn);
  $("adminLogoutBtn").classList.toggle("hidden", !isLoggedIn);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return false;
  const v = String(value).trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y";
}

function parseCSV(text) {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const headers = lines[0].split(",").map(h => h.trim());

  return lines.slice(1).map(line => {
    const values = line.split(",").map(v => v.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

async function adminLogin() {
  const driverCode = $("adminDriverCodeInput").value.trim().toUpperCase();
  const pin = $("adminPinInput").value.trim();

  if (!driverCode || !pin) {
    showAdminMessage("Enter admin driver code and PIN.", true);
    return;
  }

  const { data, error } = await supabaseClient.rpc("verify_driver_login", {
    p_driver_code: driverCode,
    p_pin: pin
  });

  if (error || !data || data.length === 0) {
    showAdminMessage("Invalid driver code or PIN.", true);
    return;
  }

  const adminUser = data[0];

  if (!ALLOWED_ADMIN_CODES.includes(String(adminUser.driver_code).toUpperCase())) {
    showAdminMessage("This driver code does not have admin access.", true);
    return;
  }

  currentAdmin = adminUser;
  sessionStorage.setItem("currentAdmin", JSON.stringify(currentAdmin));

  $("adminSignedIn").textContent = `${adminUser.driver_name} (${adminUser.driver_code})`;

  setAdminPanelsLoggedIn(true);
  await loadCounts();
  showAdminMessage("Admin login successful.", false);
}

function adminLogout() {
  currentAdmin = null;
  sessionStorage.removeItem("currentAdmin");

  $("adminDriverCodeInput").value = "";
  $("adminPinInput").value = "";
  $("adminSignedIn").textContent = "-";
  $("driverCount").textContent = "0";
  $("truckCount").textContent = "0";
  $("trailerCount").textContent = "0";
  $("shiftCount").textContent = "0";
  $("csvFileInput").value = "";
  $("uploadMessage").textContent = "";
  setAdminPanelsLoggedIn(false);
  showAdminMessage("Logged out.", false);
}

async function loadCounts() {
  const { count: driversCount } = await supabaseClient
    .from("drivers")
    .select("*", { count: "exact", head: true });

  const { count: trucksCount } = await supabaseClient
    .from("trucks")
    .select("*", { count: "exact", head: true });

  const { count: trailersCount } = await supabaseClient
    .from("trailers")
    .select("*", { count: "exact", head: true });

  const { count: shiftsCount } = await supabaseClient
    .from("shifts")
    .select("*", { count: "exact", head: true });

  $("driverCount").textContent = driversCount ?? 0;
  $("truckCount").textContent = trucksCount ?? 0;
  $("trailerCount").textContent = trailersCount ?? 0;
  $("shiftCount").textContent = shiftsCount ?? 0;
}

async function uploadMasterData() {
  if (!currentAdmin) {
    showUploadMessage("Login as admin first.", true);
    return;
  }

  const uploadType = $("uploadType").value;
  const file = $("csvFileInput").files[0];

  if (!file) {
    showUploadMessage("Choose a CSV file first.", true);
    return;
  }

  const text = await file.text();
  const rawRows = parseCSV(text);

  if (!rawRows.length) {
    showUploadMessage("No rows found in CSV.", true);
    return;
  }

  let tableName = "";
  let onConflict = "";
  let uploadRows = [];

  if (uploadType === "drivers") {
    tableName = "drivers";
    onConflict = "driver_code";
    uploadRows = rawRows.map(r => ({
      driver_code: r.driver_code,
      driver_name: r.driver_name,
      pin_hash: r.pin_hash,
      is_active: parseBoolean(r.is_active),
      default_shift_code: r.default_shift_code || "N/A"
    }));
  }

  if (uploadType === "trucks") {
    tableName = "trucks";
    onConflict = "truck_code";
    uploadRows = rawRows.map(r => ({
      truck_code: r.truck_code,
      registration: r.registration || null,
      division: r.division || null,
      is_active: parseBoolean(r.is_active)
    }));
  }

  if (uploadType === "trailers") {
    tableName = "trailers";
    onConflict = "trailer_code";
    uploadRows = rawRows.map(r => ({
      trailer_code: r.trailer_code,
      registration: r.registration || null,
      is_active: parseBoolean(r.is_active)
    }));
  }

  if (uploadType === "shifts") {
    tableName = "shifts";
    onConflict = "shift_code";
    uploadRows = rawRows.map(r => ({
      shift_code: r.shift_code,
      shift_name: r.shift_name || r.shift_code,
      is_active: parseBoolean(r.is_active)
    }));
  }

  const { error } = await supabaseClient
    .from(tableName)
    .upsert(uploadRows, { onConflict });

  if (error) {
    showUploadMessage(error.message, true);
    return;
  }

  $("csvFileInput").value = "";
  await loadCounts();
  showUploadMessage(`${uploadRows.length} ${uploadType} row(s) uploaded successfully.`, false);
}

window.addEventListener("load", async () => {
  const storedAdmin = sessionStorage.getItem("currentAdmin");

  if (storedAdmin) {
    currentAdmin = JSON.parse(storedAdmin);
    $("adminSignedIn").textContent = `${currentAdmin.driver_name} (${currentAdmin.driver_code})`;
    setAdminPanelsLoggedIn(true);
    await loadCounts();
  } else {
    setAdminPanelsLoggedIn(false);
  }
});
function downloadTemplate() {
  const type = $("uploadType").value;

  let headers = "";

  if (type === "drivers") {
    headers = "action,driver_code,driver_name,pin_hash,is_active,default_shift_code\n";
  }

  if (type === "trucks") {
    headers = "action,truck_code,registration,division,is_active\n";
  }

  if (type === "trailers") {
    headers = "action,trailer_code,registration,is_active\n";
  }

  if (type === "shifts") {
    headers = "action,shift_code,shift_name,is_active\n";
  }

  const blob = new Blob([headers], { type: "text/csv" });
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${type}_template.csv`;
  a.click();

  window.URL.revokeObjectURL(url);
}