const SUPABASE_URL = "https://yisupzgtgvcvdzqlahux.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_Hjhv7-h_zUlW0k-h0sqIWQ_Mqhgwkkl";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentDriver = null;
let closeMode = false;
let currentMonthRecords = [];
let selectedEditRecord = null;

function $(id) {
  return document.getElementById(id);
}

function showMessage(text, isError = false) {
  const el = $("message");
  el.textContent = text;
  el.style.color = isError ? "#b91c1c" : "#166534";
}

function clearCaptureInputs() {
  $("odoInput").value = "";
  $("trailerHoursInput").value = "";
}

function setTodayDateDefault() {
  const today = new Date();
  $("captureDateInput").value = today.toISOString().slice(0, 10);
}

function setDriverPanelsLoggedIn(isLoggedIn) {
  $("loginPanel").classList.toggle("hidden", isLoggedIn);
  $("driverInfoPanel").classList.toggle("hidden", !isLoggedIn);
}

function fillSelect(selectId, rows, valueField, textField, includeBlank = false, blankText = "-- Select --") {
  const el = $(selectId);
  el.innerHTML = "";

  if (includeBlank) {
    const blankOption = document.createElement("option");
    blankOption.value = "";
    blankOption.textContent = blankText;
    el.appendChild(blankOption);
  }

  rows.forEach(row => {
    const option = document.createElement("option");
    option.value = row[valueField];
    option.textContent = row[textField];
    el.appendChild(option);
  });
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("en-ZA", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDate(value) {
  if (!value) return "Active";
  return new Date(value).toLocaleDateString();
}

function toCaptureDateTime(dateValue) {
  const now = new Date();
  const [year, month, day] = dateValue.split("-").map(Number);

  const localDate = new Date(
    year,
    month - 1,
    day,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
    0
  );

  return localDate.toISOString();
}

function monthRange(monthValue) {
  const base = monthValue
    ? new Date(`${monthValue}-01T00:00:00`)
    : new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const start = new Date(base.getFullYear(), base.getMonth(), 1, 0, 0, 0, 0);
  const end = new Date(base.getFullYear(), base.getMonth() + 1, 1, 0, 0, 0, 0);

  return {
    startIso: start.toISOString(),
    endIso: end.toISOString()
  };
}

function defaultHistoryMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function trailerRequiresHours(trailerCode) {
  return trailerCode && trailerCode.toUpperCase().startsWith("F");
}

async function loginDriver() {
  const driverCode = $("driverCodeInput").value.trim();
  const pin = $("pinInput").value.trim();

  if (!driverCode || !pin) {
    showMessage("Enter driver code and PIN.", true);
    return;
  }

  const { data, error } = await supabaseClient.rpc("verify_driver_login", {
    p_driver_code: driverCode,
    p_pin: pin
  });

  if (error || !data || data.length === 0) {
    showMessage("Invalid driver code or PIN.", true);
    return;
  }

  currentDriver = data[0];
  closeMode = false;
  selectedEditRecord = null;

  sessionStorage.setItem("currentDriver", JSON.stringify(currentDriver));

  if ($("rememberDevice").checked) {
    localStorage.setItem("rememberedDriver", JSON.stringify(currentDriver));
  } else {
    localStorage.removeItem("rememberedDriver");
  }

  await loadMasterData();
  await refreshAll();
  showMessage(`Welcome ${currentDriver.driver_name}`, false);
}

function switchDriver() {
  currentDriver = null;
  closeMode = false;
  selectedEditRecord = null;
  currentMonthRecords = [];

  sessionStorage.removeItem("currentDriver");
  localStorage.removeItem("rememberedDriver");

  $("driverCodeInput").value = "";
  $("pinInput").value = "";
  $("signedInDriver").textContent = "-";
  $("activeTruckInfo").textContent = "-";
  $("modeInfo").textContent = "Normal Capture";
  $("monthTotal").textContent = "0";
  $("monthSessionCount").textContent = "0";
  $("monthSessionsList").innerHTML = "";
  $("activeMonthRecords").innerHTML = "";
  $("editRecordSelect").innerHTML = "";
  cancelRecordEdit();
  setDriverPanelsLoggedIn(false);
  setTodayDateDefault();

  $("odoInput").placeholder = "Enter odometer reading";
  $("trailerHoursInput").placeholder = "Enter trailer hours if required";

  showMessage("Driver cleared on this phone.", false);
}

async function loadMasterData() {
  const { data: trucks } = await supabaseClient
    .from("trucks")
    .select("id, truck_code")
    .eq("is_active", true)
    .order("truck_code");

  const { data: trailers } = await supabaseClient
    .from("trailers")
    .select("id, trailer_code")
    .eq("is_active", true)
    .order("trailer_code");

  const { data: shifts } = await supabaseClient
    .from("shifts")
    .select("shift_code")
    .eq("is_active", true)
    .order("shift_code");

  fillSelect("truckSelect", trucks || [], "truck_code", "truck_code", true, "-- Select Truck --");
  fillSelect("trailerSelect", trailers || [], "id", "trailer_code", true, "-- No Trailer --");
  fillSelect("shiftSelect", shifts || [], "shift_code", "shift_code");

  fillSelect("editTrailerSelect", trailers || [], "id", "trailer_code", true, "-- No Trailer --");
  fillSelect("editShiftSelect", shifts || [], "shift_code", "shift_code");

  $("shiftSelect").value = currentDriver?.default_shift_code || "N/A";
  $("editShiftSelect").value = currentDriver?.default_shift_code || "N/A";
}

async function getActiveSession() {
  if (!currentDriver) return null;

  const { data } = await supabaseClient
    .from("truck_sessions")
    .select("id, truck_id, status, start_datetime, end_datetime, trucks(truck_code)")
    .eq("driver_id", currentDriver.driver_id)
    .eq("status", "Active")
    .order("id", { ascending: false })
    .limit(1);

  return data && data.length ? data[0] : null;
}

async function getLastTruckCaptureBefore(truckId, captureDateTime) {
  const { data, error } = await supabaseClient
    .from("captures")
    .select("*")
    .eq("truck_id", truckId)
    .lt("capture_datetime", captureDateTime)
    .order("capture_datetime", { ascending: false })
    .limit(1);

  if (error || !data || !data.length) return null;
  return data[0];
}

async function getLastTrailerCaptureBefore(trailerId, captureDateTime) {
  if (!trailerId) return null;

  const { data, error } = await supabaseClient
    .from("captures")
    .select("id, trailer_id, trailer_hours, capture_datetime")
    .eq("trailer_id", trailerId)
    .lt("capture_datetime", captureDateTime)
    .order("capture_datetime", { ascending: false })
    .limit(1);

  if (error || !data || !data.length) return null;
  return data[0];
}

async function getLastSessionCapture(sessionId) {
  const { data } = await supabaseClient
    .from("captures")
    .select("id, trailer_id, shift_code, trailers(trailer_code)")
    .eq("session_id", sessionId)
    .order("capture_datetime", { ascending: false })
    .limit(1);

  return data && data.length ? data[0] : null;
}

async function getPreviousTruckCaptureBefore(truckId, captureDateTime, currentCaptureId) {
  const { data } = await supabaseClient
    .from("captures")
    .select("*")
    .eq("truck_id", truckId)
    .lt("capture_datetime", captureDateTime)
    .neq("id", currentCaptureId)
    .order("capture_datetime", { ascending: false })
    .limit(1);

  return data && data.length ? data[0] : null;
}

function validateOdoReading(previousCapture, odoReading, kmsStatus) {
  if (!previousCapture) {
    return { valid: true, kms: kmsStatus === "Start KMS" ? 0 : 0 };
  }

  const previousOdo = Number(previousCapture.odo_reading);
  const currentOdo = Number(odoReading);

  if (currentOdo < previousOdo) {
    return { valid: false, message: "ODO may not be less than previous truck reading before this date." };
  }

  if (currentOdo > previousOdo + 1000) {
    return { valid: false, message: "ODO increase cannot exceed 1000 km from previous truck reading." };
  }

  if (kmsStatus === "Start KMS") {
    return { valid: true, kms: 0 };
  }

  return { valid: true, kms: currentOdo - previousOdo };
}

function validateTrailerHours(previousTrailerCapture, trailerHours, trailerCode) {
  if (!trailerRequiresHours(trailerCode)) {
    return { valid: true };
  }

  if (trailerHours === null || Number.isNaN(trailerHours)) {
    return { valid: false, message: "Trailer Hours are required for trailers starting with F." };
  }

  if (!previousTrailerCapture || previousTrailerCapture.trailer_hours === null) {
    return { valid: true };
  }

  const previousHours = Number(previousTrailerCapture.trailer_hours);
  const currentHours = Number(trailerHours);

  if (currentHours < previousHours) {
    return { valid: false, message: "Trailer Hours may not be less than previous trailer hours before this date." };
  }

  if (currentHours > previousHours + 40) {
    return { valid: false, message: "Trailer Hours increase cannot exceed 40 hours from previous trailer reading." };
  }

  return { valid: true };
}

async function updateReadingPlaceholders() {
  const captureDate = $("captureDateInput").value;
  const truckCode = $("truckSelect").value;
  const trailerId = $("trailerSelect").value ? Number($("trailerSelect").value) : null;

  $("odoInput").placeholder = "Enter odometer reading";
  $("trailerHoursInput").placeholder = "Enter trailer hours if required";

  if (!captureDate) return;

  const captureDateTime = toCaptureDateTime(captureDate);

  if (truckCode) {
    const { data: truckRow } = await supabaseClient
      .from("trucks")
      .select("id")
      .eq("truck_code", truckCode)
      .single();

    if (truckRow?.id) {
      const prevTruck = await getLastTruckCaptureBefore(truckRow.id, captureDateTime);
      if (prevTruck) {
        $("odoInput").placeholder = `Enter odometer reading (prev reading - ${prevTruck.odo_reading})`;
      } else {
        $("odoInput").placeholder = "Enter odometer reading (prev reading - none)";
      }
    }
  }

  if (trailerId) {
    const selectedTrailerOption = $("trailerSelect").selectedOptions[0];
    const trailerCode = selectedTrailerOption ? selectedTrailerOption.textContent : "";

    const prevTrailer = await getLastTrailerCaptureBefore(trailerId, captureDateTime);

    if (prevTrailer && prevTrailer.trailer_hours !== null) {
      $("trailerHoursInput").placeholder = `Enter trailer hours${trailerRequiresHours(trailerCode) ? "" : " if required"} (prev reading - ${prevTrailer.trailer_hours})`;
    } else {
      $("trailerHoursInput").placeholder = `Enter trailer hours${trailerRequiresHours(trailerCode) ? "" : " if required"} (prev reading - none)`;
    }
  }
}

function refreshModeUI() {
  if (closeMode) {
    $("modeInfo").textContent = "Close-Off Truck Session";
    $("saveButton").textContent = "Confirm End KMS";
    $("closeButton").classList.add("hidden");
    $("cancelCloseButton").classList.remove("hidden");
  } else {
    $("modeInfo").textContent = "Normal Capture";
    $("saveButton").textContent = "Save Capture";
    $("closeButton").classList.remove("hidden");
    $("cancelCloseButton").classList.add("hidden");
  }
}

function startCloseTruck() {
  if (!currentDriver) {
    showMessage("Login first.", true);
    return;
  }
  closeMode = true;
  clearCaptureInputs();
  refreshModeUI();
  showMessage("Close-off mode started. Enter final ODO and trailer hours, then confirm End KMS.", false);
  updateReadingPlaceholders();
}

function cancelCloseTruck() {
  closeMode = false;
  clearCaptureInputs();
  refreshModeUI();
  showMessage("Close-off cancelled.", false);
  updateReadingPlaceholders();
}

async function saveCapture() {
  if (!currentDriver) {
    showMessage("Login first.", true);
    return;
  }

  if (closeMode) {
    await confirmCloseTruck();
    return;
  }

  const captureDate = $("captureDateInput").value;
  const truckCode = $("truckSelect").value;
  const trailerId = $("trailerSelect").value ? Number($("trailerSelect").value) : null;
  const shiftCode = $("shiftSelect").value || "N/A";
  const odo = Number($("odoInput").value);
  const trailerHoursValue = $("trailerHoursInput").value;
  const trailerHours = trailerHoursValue === "" ? null : Number(trailerHoursValue);

  if (!captureDate) {
    showMessage("Please select a capture date.", true);
    return;
  }

  if (!truckCode) {
    showMessage("Please select a truck.", true);
    return;
  }

  if (!odo) {
    showMessage("Please enter ODO.", true);
    return;
  }

  const { data: truckRow, error: truckError } = await supabaseClient
    .from("trucks")
    .select("id, truck_code")
    .eq("truck_code", truckCode)
    .single();

  if (truckError || !truckRow) {
    showMessage("Truck not found.", true);
    return;
  }

  const captureDateTime = toCaptureDateTime(captureDate);
  const activeSession = await getActiveSession();

  if (activeSession && activeSession.truck_id !== truckRow.id) {
    showMessage(`You already have an active truck session on ${activeSession.trucks.truck_code}. Close it first.`, true);
    return;
  }

  let kmsStatus = "Start KMS";
  let kmsDelta = 0;
  let sessionId = null;

  const previousTruckCapture = await getLastTruckCaptureBefore(truckRow.id, captureDateTime);

  if (!activeSession) {
    const { data: newSession, error: sessionError } = await supabaseClient
      .from("truck_sessions")
      .insert([{
        driver_id: currentDriver.driver_id,
        truck_id: truckRow.id,
        status: "Active",
        start_datetime: captureDateTime
      }])
      .select()
      .single();

    if (sessionError) {
      showMessage(sessionError.message, true);
      return;
    }

    sessionId = newSession.id;
    kmsStatus = "Start KMS";
  } else {
    sessionId = activeSession.id;
    kmsStatus = "Daily KMS";
  }

  const odoValidation = validateOdoReading(previousTruckCapture, odo, kmsStatus);
  if (!odoValidation.valid) {
    showMessage(odoValidation.message, true);
    return;
  }
  kmsDelta = odoValidation.kms;

  let selectedTrailerCode = "";
  if (trailerId) {
    const selectedTrailerOption = $("trailerSelect").selectedOptions[0];
    selectedTrailerCode = selectedTrailerOption ? selectedTrailerOption.textContent : "";
  }

  const previousTrailerCapture = await getLastTrailerCaptureBefore(trailerId, captureDateTime);
  const trailerValidation = validateTrailerHours(previousTrailerCapture, trailerHours, selectedTrailerCode);

  if (!trailerValidation.valid) {
    showMessage(trailerValidation.message, true);
    return;
  }

  const { error } = await supabaseClient
    .from("captures")
    .insert([{
      capture_datetime: captureDateTime,
      driver_id: currentDriver.driver_id,
      truck_id: truckRow.id,
      trailer_id: trailerId,
      shift_code: shiftCode,
      odo_reading: odo,
      trailer_hours: trailerHours,
      kms_delta: kmsDelta,
      kms_status: kmsStatus,
      session_id: sessionId
    }]);

  if (error) {
    showMessage(error.message, true);
    return;
  }

  clearCaptureInputs();
  await refreshAll();
  showMessage(`Capture saved. Status: ${kmsStatus}. KMS: ${kmsDelta}`, false);
}

async function confirmCloseTruck() {
  const activeSession = await getActiveSession();

  if (!activeSession) {
    closeMode = false;
    refreshModeUI();
    showMessage("No active truck session to close.", true);
    return;
  }

  const captureDate = $("captureDateInput").value;
  const trailerId = $("trailerSelect").value ? Number($("trailerSelect").value) : null;
  const shiftCode = $("shiftSelect").value || "N/A";
  const odo = Number($("odoInput").value);
  const trailerHoursValue = $("trailerHoursInput").value;
  const trailerHours = trailerHoursValue === "" ? null : Number(trailerHoursValue);

  if (!captureDate) {
    showMessage("Please select a capture date.", true);
    return;
  }

  if (!odo) {
    showMessage("Enter final ODO.", true);
    return;
  }

  const captureDateTime = toCaptureDateTime(captureDate);
  const previousTruckCapture = await getLastTruckCaptureBefore(activeSession.truck_id, captureDateTime);
  const odoValidation = validateOdoReading(previousTruckCapture, odo, "End KMS");

  if (!odoValidation.valid) {
    showMessage(odoValidation.message, true);
    return;
  }

  let selectedTrailerCode = "";
  if (trailerId) {
    const selectedTrailerOption = $("trailerSelect").selectedOptions[0];
    selectedTrailerCode = selectedTrailerOption ? selectedTrailerOption.textContent : "";
  }

  const previousTrailerCapture = await getLastTrailerCaptureBefore(trailerId, captureDateTime);
  const trailerValidation = validateTrailerHours(previousTrailerCapture, trailerHours, selectedTrailerCode);

  if (!trailerValidation.valid) {
    showMessage(trailerValidation.message, true);
    return;
  }

  const { error: captureError } = await supabaseClient
    .from("captures")
    .insert([{
      capture_datetime: captureDateTime,
      driver_id: currentDriver.driver_id,
      truck_id: activeSession.truck_id,
      trailer_id: trailerId,
      shift_code: shiftCode,
      odo_reading: odo,
      trailer_hours: trailerHours,
      kms_delta: odoValidation.kms,
      kms_status: "End KMS",
      session_id: activeSession.id
    }]);

  if (captureError) {
    showMessage(captureError.message, true);
    return;
  }

  const { error: updateError } = await supabaseClient
    .from("truck_sessions")
    .update({
      status: "Closed",
      end_datetime: captureDateTime
    })
    .eq("id", activeSession.id);

  if (updateError) {
    showMessage(updateError.message, true);
    return;
  }

  closeMode = false;
  clearCaptureInputs();
  await refreshAll();
  showMessage(`Truck ${activeSession.trucks.truck_code} closed. End KMS saved. KMS: ${odoValidation.kms}`, false);
}

function groupRowsBySession(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = row.session_id || `no-session-${row.id}`;

    if (!map.has(key)) {
      map.set(key, {
        sessionId: row.session_id,
        truck: row.trucks?.truck_code || "-",
        trailer: row.trailers?.trailer_code || "",
        startDate: row.capture_datetime,
        endDate: row.kms_status === "End KMS" ? row.capture_datetime : null,
        totalKms: 0,
        status: row.kms_status === "End KMS" ? "Closed" : "Active",
        rows: []
      });
    }

    const group = map.get(key);
    group.rows.push(row);
    group.totalKms += Number(row.kms_delta || 0);

    if (!group.trailer && row.trailers?.trailer_code) {
      group.trailer = row.trailers.trailer_code;
    }

    if (new Date(row.capture_datetime) < new Date(group.startDate)) {
      group.startDate = row.capture_datetime;
    }

    if (!group.endDate || new Date(row.capture_datetime) > new Date(group.endDate)) {
      group.endDate = row.capture_datetime;
    }

    if (row.kms_status === "End KMS") {
      group.status = "Closed";
    }
  });

  return [...map.values()].sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
}

function renderSessionCards(targetId, groups) {
  const target = $(targetId);
  target.innerHTML = "";

  if (!groups.length) {
    target.innerHTML = `<div class="session-card"><div>No sessions found for this month.</div></div>`;
    return;
  }

  groups.forEach(group => {
    const div = document.createElement("div");
    div.className = "session-card";
    div.innerHTML = `
      <h3>${group.truck} ${group.trailer ? " | " + group.trailer : ""}</h3>
      <div class="session-grid">
        <div><strong>Start Date</strong><br>${formatDate(group.startDate)}</div>
        <div><strong>End Date</strong><br>${group.status === "Closed" ? formatDate(group.endDate) : "Active / Open"}</div>
        <div><strong>Status</strong><br>${group.status}</div>
        <div><strong>Total KMS</strong><br>${group.totalKms}</div>
      </div>
    `;
    target.appendChild(div);
  });
}

function renderActiveMonthRecords(groups) {
  const target = $("activeMonthRecords");
  target.innerHTML = "";

  if (!groups.length) {
    target.innerHTML = `<div class="record-group">No current-month records yet.</div>`;
    return;
  }

  groups.forEach(group => {
    const wrap = document.createElement("div");
    wrap.className = "record-group";

    let html = `
      <h3>${group.truck} ${group.trailer ? " | " + group.trailer : ""}</h3>
      <div class="record-line"><strong>Session:</strong> ${formatDate(group.startDate)} to ${group.status === "Closed" ? formatDate(group.endDate) : "Active / Open"} | <strong>Total KMS:</strong> ${group.totalKms}</div>
    `;

    group.rows
      .sort((a, b) => new Date(b.capture_datetime) - new Date(a.capture_datetime))
      .forEach(row => {
        html += `
          <div class="record-line">
            ${formatDateTime(row.capture_datetime)} |
            ${row.kms_status} |
            Shift ${row.shift_code} |
            ODO ${row.odo_reading} |
            Hours ${row.trailer_hours ?? ""} |
            KMS ${row.kms_delta}
          </div>
        `;
      });

    wrap.innerHTML = html;
    target.appendChild(wrap);
  });
}

function populateEditRecordDropdown(rows) {
  const select = $("editRecordSelect");
  select.innerHTML = "";

  if (!rows.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No current-month records";
    select.appendChild(option);
    return;
  }

  rows
    .sort((a, b) => new Date(b.capture_datetime) - new Date(a.capture_datetime))
    .forEach(row => {
      const option = document.createElement("option");
      option.value = row.id;
      option.textContent = `${formatDateTime(row.capture_datetime)} | ${row.trucks?.truck_code || "-"} | ${row.kms_status} | Shift ${row.shift_code} | ODO ${row.odo_reading}`;
      select.appendChild(option);
    });
}

function loadSelectedRecordForEdit() {
  const selectedId = Number($("editRecordSelect").value);
  const row = currentMonthRecords.find(r => r.id === selectedId);

  if (!row) {
    showMessage("Select a record first.", true);
    return;
  }

  selectedEditRecord = row;
  $("editPanel").classList.remove("hidden");
  $("editTruckLabel").textContent = row.trucks?.truck_code || "-";
  $("editStatusLabel").textContent = row.kms_status || "-";
  $("editTrailerSelect").value = row.trailer_id ? String(row.trailer_id) : "";
  $("editShiftSelect").value = row.shift_code || "N/A";
  $("editOdoInput").value = row.odo_reading ?? "";
  $("editTrailerHoursInput").value = row.trailer_hours ?? "";
  showMessage("Record loaded for edit. Only the latest current-month record should be edited in this MVP.", false);
}

function cancelRecordEdit() {
  selectedEditRecord = null;
  $("editPanel").classList.add("hidden");
  $("editTruckLabel").textContent = "-";
  $("editStatusLabel").textContent = "-";
  $("editOdoInput").value = "";
  $("editTrailerHoursInput").value = "";
}

async function saveRecordEdit() {
  if (!selectedEditRecord) {
    showMessage("Load a record first.", true);
    return;
  }

  const sortedRows = [...currentMonthRecords].sort((a, b) => new Date(b.capture_datetime) - new Date(a.capture_datetime));
  const latestRow = sortedRows[0];

  if (!latestRow || latestRow.id !== selectedEditRecord.id) {
    showMessage("For this MVP, only the latest current-month record can be edited.", true);
    return;
  }

  const newTrailerId = $("editTrailerSelect").value ? Number($("editTrailerSelect").value) : null;
  const newShiftCode = $("editShiftSelect").value || "N/A";
  const newOdo = Number($("editOdoInput").value);
  const newTrailerHoursValue = $("editTrailerHoursInput").value;
  const newTrailerHours = newTrailerHoursValue === "" ? null : Number(newTrailerHoursValue);

  if (!newOdo) {
    showMessage("Enter ODO for the edit.", true);
    return;
  }

  const previousCapture = await getPreviousTruckCaptureBefore(
    selectedEditRecord.truck_id,
    selectedEditRecord.capture_datetime,
    selectedEditRecord.id
  );

  const odoValidation = validateOdoReading(previousCapture, newOdo, selectedEditRecord.kms_status);
  if (!odoValidation.valid) {
    showMessage(odoValidation.message, true);
    return;
  }

  let selectedTrailerCode = "";
  if (newTrailerId) {
    const selectedOption = $("editTrailerSelect").selectedOptions[0];
    selectedTrailerCode = selectedOption ? selectedOption.textContent : "";
  }

  const previousTrailerCapture = await getLastTrailerCaptureBefore(newTrailerId, selectedEditRecord.capture_datetime);
  const trailerValidation = validateTrailerHours(previousTrailerCapture, newTrailerHours, selectedTrailerCode);

  if (!trailerValidation.valid) {
    showMessage(trailerValidation.message, true);
    return;
  }

  const { error } = await supabaseClient
    .from("captures")
    .update({
      trailer_id: newTrailerId,
      shift_code: newShiftCode,
      odo_reading: newOdo,
      trailer_hours: newTrailerHours,
      kms_delta: odoValidation.kms
    })
    .eq("id", selectedEditRecord.id);

  if (error) {
    showMessage(error.message, true);
    return;
  }

  cancelRecordEdit();
  await refreshAll();
  showMessage("Latest record updated.", false);
}

async function loadCurrentMonthSummary() {
  if (!currentDriver) return;

  const currentMonth = defaultHistoryMonth();
  const range = monthRange(currentMonth);

  const { data: rows, error } = await supabaseClient
    .from("captures")
    .select(`
      id,
      capture_datetime,
      driver_id,
      truck_id,
      trailer_id,
      shift_code,
      odo_reading,
      trailer_hours,
      kms_delta,
      kms_status,
      session_id,
      trucks(truck_code),
      trailers(trailer_code)
    `)
    .eq("driver_id", currentDriver.driver_id)
    .gte("capture_datetime", range.startIso)
    .lt("capture_datetime", range.endIso)
    .order("capture_datetime", { ascending: false });

  if (error) {
    showMessage(error.message, true);
    return;
  }

  currentMonthRecords = rows || [];

  const monthTotal = currentMonthRecords.reduce((sum, row) => sum + Number(row.kms_delta || 0), 0);
  $("monthTotal").textContent = String(monthTotal);

  const sessionGroups = groupRowsBySession(currentMonthRecords);
  $("monthSessionCount").textContent = String(sessionGroups.length);

  renderSessionCards("monthSessionsList", sessionGroups);
  renderActiveMonthRecords(sessionGroups);
  populateEditRecordDropdown(currentMonthRecords);
}

async function loadHistoryMonth() {
  if (!currentDriver) {
    showMessage("Login first.", true);
    return;
  }

  const selectedMonth = $("historyMonth").value;
  if (!selectedMonth) {
    showMessage("Select a month first.", true);
    return;
  }

  const range = monthRange(selectedMonth);

  const { data: rows, error } = await supabaseClient
    .from("captures")
    .select(`
      id,
      capture_datetime,
      driver_id,
      truck_id,
      trailer_id,
      shift_code,
      odo_reading,
      trailer_hours,
      kms_delta,
      kms_status,
      session_id,
      trucks(truck_code),
      trailers(trailer_code)
    `)
    .eq("driver_id", currentDriver.driver_id)
    .gte("capture_datetime", range.startIso)
    .lt("capture_datetime", range.endIso)
    .order("capture_datetime", { ascending: false });

  if (error) {
    showMessage(error.message, true);
    return;
  }

  const historyRows = rows || [];
  const totalKms = historyRows.reduce((sum, row) => sum + Number(row.kms_delta || 0), 0);
  const groups = groupRowsBySession(historyRows);

  $("historyTotalKms").textContent = String(totalKms);
  $("historySessionCount").textContent = String(groups.length);
  renderSessionCards("historySessionsList", groups);
}

async function refreshDriverHeader() {
  setDriverPanelsLoggedIn(!!currentDriver);

  if (!currentDriver) {
    $("signedInDriver").textContent = "-";
    $("activeTruckInfo").textContent = "-";
    refreshModeUI();
    return;
  }

  $("signedInDriver").textContent = currentDriver.driver_name;

  const activeSession = await getActiveSession();

  $("activeTruckInfo").textContent =
    activeSession ? activeSession.trucks?.truck_code || "Active" : "No active truck";

  if (activeSession) {
    $("truckSelect").value = activeSession.trucks.truck_code;
    $("truckSelect").disabled = true;

    const lastSessionCapture = await getLastSessionCapture(activeSession.id);
    if (lastSessionCapture) {
      $("trailerSelect").value = lastSessionCapture.trailer_id ? String(lastSessionCapture.trailer_id) : "";
      $("shiftSelect").value = lastSessionCapture.shift_code || currentDriver.default_shift_code || "N/A";
    }
  } else {
    $("truckSelect").disabled = false;
  }

  refreshModeUI();
  await updateReadingPlaceholders();
}

async function refreshAll() {
  await refreshDriverHeader();
  await loadCurrentMonthSummary();
}

window.addEventListener("load", async () => {
  $("historyMonth").value = defaultHistoryMonth();
  setTodayDateDefault();

  const remembered = localStorage.getItem("rememberedDriver");
  const sessionDriver = sessionStorage.getItem("currentDriver");

  if (sessionDriver) {
    currentDriver = JSON.parse(sessionDriver);
  } else if (remembered) {
    currentDriver = JSON.parse(remembered);
    sessionStorage.setItem("currentDriver", remembered);
  }

  if (currentDriver) {
    await loadMasterData();
  }

  $("captureDateInput").addEventListener("change", updateReadingPlaceholders);
  $("truckSelect").addEventListener("change", updateReadingPlaceholders);
  $("trailerSelect").addEventListener("change", updateReadingPlaceholders);

  await refreshAll();
});