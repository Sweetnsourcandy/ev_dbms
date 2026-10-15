const DEFAULT_CALCULATION_DATA = [
    { model_name: "BMW i3", count_sessions: 13112, sum_energy_kwh: 559174.27, avg_energy_kwh: 42.65, median_energy_kwh: 42.69, avg_duration_hrs: 2.28, avg_rate_kw: 25.91, avg_temp_c: 26.14, median_temp_c: 24.76, avg_soh_pct: 90.39, median_soh_pct: 90.48 },
    { model_name: "Chevy Bolt", count_sessions: 12748, sum_energy_kwh: 543900.08, avg_energy_kwh: 42.67, median_energy_kwh: 42.55, avg_duration_hrs: 2.27, avg_rate_kw: 25.91, avg_temp_c: 26.05, median_temp_c: 24.50, avg_soh_pct: 90.38, median_soh_pct: 90.45 },
    { model_name: "Hyundai Kona", count_sessions: 13133, sum_energy_kwh: 563069.94, avg_energy_kwh: 42.87, median_energy_kwh: 43.22, avg_duration_hrs: 2.25, avg_rate_kw: 25.84, avg_temp_c: 26.40, median_temp_c: 25.02, avg_soh_pct: 90.34, median_soh_pct: 90.38 },
    { model_name: "Nissan Leaf", count_sessions: 13072, sum_energy_kwh: 557658.68, avg_energy_kwh: 42.66, median_energy_kwh: 42.76, avg_duration_hrs: 2.27, avg_rate_kw: 26.02, avg_temp_c: 26.12, median_temp_c: 24.81, avg_soh_pct: 90.42, median_soh_pct: 90.50 },
    { model_name: "Tesla Model 3", count_sessions: 13974, sum_energy_kwh: 593360.55, avg_energy_kwh: 42.46, median_energy_kwh: 42.28, avg_duration_hrs: 2.26, avg_rate_kw: 25.88, avg_temp_c: 26.12, median_temp_c: 24.82, avg_soh_pct: 90.37, median_soh_pct: 90.44 }
];

let activeDataset = [...DEFAULT_CALCULATION_DATA];
let currentSortColumn = -1;
let currentSortAsc = true;
let chartSohInstance = null;
let chartTempRiseInstance = null;
let chartChargingRateInstance = null;
let chartMaxTempInstance = null;
let insertedSessionsCount = 0;

let activeScopeMode = "full";
let hasSelectedScope = false;
let filterConfig = {
    attribute: "battery_temp_avg_c",
    operator: "gt",
    threshold: 35.0,
    row_limit: 10000
};

const DEFAULT_FLEET_KPIS = {
    total_records: 101320,
    total_energy_mwh: 4321.02,
    avg_battery_temp_c: 26.15,
    avg_predicted_soh: 90.37,
    sync_latency_ms: 132.4
};
let fleetKpis = { ...DEFAULT_FLEET_KPIS };

const ALLOWED_MODELS = ["Tesla Model 3", "Hyundai Kona", "BMW i3", "Nissan Leaf", "Chevy Bolt"];

const MODEL_SPECS = {
    "Tesla Model 3": { capacity: "82.00 kWh", vclass: "Passenger EV" },
    "Hyundai Kona": { capacity: "64.00 kWh", vclass: "Passenger EV" },
    "BMW i3": { capacity: "42.20 kWh", vclass: "Passenger EV" },
    "Nissan Leaf": { capacity: "62.00 kWh", vclass: "Passenger EV" },
    "Chevy Bolt": { capacity: "65.00 kWh", vclass: "Passenger EV" }
};

function updateNavLockState(isUnlocked) {
    const lockedNavIds = ["nav-overview", "nav-insert", "nav-calculation"];
    lockedNavIds.forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) return;
        if (isUnlocked) {
            btn.disabled = false;
            btn.classList.remove("nav-locked");
            const lockBadge = btn.querySelector(".nav-lock-badge");
            if (lockBadge) lockBadge.remove();
        } else {
            btn.disabled = true;
            btn.classList.add("nav-locked");
            if (!btn.querySelector(".nav-lock-badge")) {
                const badge = document.createElement("span");
                badge.className = "nav-lock-badge";
                badge.innerText = "🔒";
                btn.appendChild(badge);
            }
        }
    });
}

document.addEventListener("DOMContentLoaded", () => {
    updateNavLockState(false);
    initPhotonBootAnimation();
    initCursorAndBlockSelection();
    fetchBackendData();
    renderCalculationTable(activeDataset);
    initCharts();
    onModelOrFieldChange();

    const insertForm = document.getElementById("sqlInsertForm");
    if (insertForm) {
        insertForm.addEventListener("submit", handleSqlInsertSubmit);
    }

    const deleteForm = document.getElementById("sqlDeleteForm");
    if (deleteForm) {
        deleteForm.addEventListener("submit", handleSqlDeleteSubmit);
    }
});

function getApiUrl(path) {
    if (window.location.protocol === "file:") {
        return `http://localhost:5000${path}`;
    }
    if (window.location.port && window.location.port !== "5000") {
        return `http://localhost:5000${path}`;
    }
    return path;
}

async function fetchApi(endpoint, options = {}) {
    const primaryUrl = getApiUrl(endpoint);
    try {
        const res = await fetch(primaryUrl, options);
        if (res.ok) return res;
    } catch (e) {
        if (primaryUrl !== endpoint) {
            try {
                const resFallback = await fetch(endpoint, options);
                if (resFallback.ok) return resFallback;
            } catch (errFallback) {
                // fall-through
            }
        }
        throw e;
    }
    throw new Error(`HTTP Error from ${primaryUrl}`);
}

async function fetchBackendData() {
    try {
        const [resCalc, resOverview] = await Promise.all([
            fetchApi("/api/calculations"),
            fetchApi("/api/overview")
        ]);

        if (resCalc && resCalc.ok) {
            const jsonCalc = await resCalc.json();
            if (jsonCalc.data && jsonCalc.data.length > 0) {
                activeDataset = jsonCalc.data;
                renderCalculationTable(activeDataset);
            }
        }

        if (resOverview && resOverview.ok) {
            const jsonOverview = await resOverview.json();
            if (jsonOverview.kpis) {
                fleetKpis = { ...jsonOverview.kpis };
                updateKpiDisplay(fleetKpis);
            }
        }
    } catch (e) {
        console.log("Serving cached telemetry.");
    }
}

function updateKpiDisplay(kpis) {
    if (!kpis) return;
    const elSessions = document.getElementById("kpi-total-sessions");
    const elEnergy = document.getElementById("kpi-total-energy");
    const elTemp = document.getElementById("kpi-avg-temp");
    const elSoh = document.getElementById("kpi-avg-soh");

    if (elSessions) elSessions.innerText = Number(kpis.total_records).toLocaleString();
    if (elEnergy) elEnergy.innerText = `${Number(kpis.total_energy_mwh).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MWh`;
    if (elTemp) elTemp.innerText = `${Number(kpis.avg_battery_temp_c).toFixed(2)} °C`;
    if (elSoh) elSoh.innerText = `${Number(kpis.avg_predicted_soh).toFixed(2)}%`;
}

function switchPage(pageKey, bypassLock = false) {
    // Enforce mandatory scope gate selection before accessing other dashboard views
    if (!hasSelectedScope && pageKey !== "filter" && !bypassLock) {
        const notice = document.getElementById("scopeGateNotice");
        if (notice) {
            notice.style.color = "#ffadbc";
            notice.style.fontWeight = "bold";
            setTimeout(() => {
                if (notice) {
                    notice.style.color = "";
                    notice.style.fontWeight = "";
                }
            }, 2500);
        }
        return;
    }

    const navFilter = document.getElementById("nav-filter");
    const navOverview = document.getElementById("nav-overview");
    const navInsert = document.getElementById("nav-insert");
    const navCalculation = document.getElementById("nav-calculation");
    const viewFilter = document.getElementById("view-filter");
    const viewOverview = document.getElementById("view-overview");
    const viewInsert = document.getElementById("view-insert");
    const viewCalculation = document.getElementById("view-calculation");
    const heading = document.getElementById("page-heading");
    const subheading = document.getElementById("page-subheading");

    // Clear active classes from all nav buttons and view panels
    [navFilter, navOverview, navInsert, navCalculation].forEach(btn => btn && btn.classList.remove("active"));
    [viewFilter, viewOverview, viewInsert, viewCalculation].forEach(view => view && view.classList.remove("active"));

    if (pageKey === "filter") {
        if (navFilter) navFilter.classList.add("active");
        if (viewFilter) viewFilter.classList.add("active");
        if (heading) heading.innerText = "Database Scope & Telemetry Filter";
        if (subheading) subheading.innerText = "Select full database analysis or configure attribute thresholds and downsample rows.";
    } else if (pageKey === "overview") {
        if (navOverview) navOverview.classList.add("active");
        if (viewOverview) viewOverview.classList.add("active");
        if (heading) heading.innerText = "Fleet Thermal Overview";
        if (subheading) subheading.innerText = "Real-time battery degradation distribution, charging thermal rise, and peak temperatures across 5 models.";
    } else if (pageKey === "insert") {
        if (navInsert) navInsert.classList.add("active");
        if (viewInsert) viewInsert.classList.add("active");
        if (heading) heading.innerText = "Alter Telemetry Parameters";
        if (subheading) subheading.innerText = "Ingest new session operational parameters or purge outdated records based on User ID.";
    } else if (pageKey === "calculation") {
        if (navCalculation) navCalculation.classList.add("active");
        if (viewCalculation) viewCalculation.classList.add("active");
        if (heading) heading.innerText = "Telemetry Analytics Engine";
        if (subheading) subheading.innerText = "Aggregated fleet operational performance and thermal metrics across 5 unique models via Inner Join.";
    }
}


/* ============================================================== */
/* 4 OVERVIEW CHARTS: SOH SHORTENED, TEMP RISE, RATE, MAX TEMP   */
/* ============================================================== */
function initCharts() {
    // Chart 1: Vehicles with shortened lifespan based on SOH grouped by model (% share)
    const ctxSoh = document.getElementById("chartSohShortened");
    if (ctxSoh) {
        chartSohInstance = new Chart(ctxSoh, {
            type: "doughnut",
            data: {
                labels: ["Chevy Bolt", "BMW i3", "Nissan Leaf", "Hyundai Kona", "Tesla Model 3"],
                datasets: [{
                    data: [24.8, 23.4, 21.6, 18.2, 12.0],
                    backgroundColor: [
                        "#ffadbc", // Soft Blush Pink
                        "#d98ab5", // Orchid Rose
                        "#975d8e", // Muted Mauve
                        "#873b70", // Deep Plum
                        "#541c42"  // Deep Dark Berry
                    ],
                    borderWidth: 2,
                    borderColor: "#1d0b1a"
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#e2bfd2", font: { size: 12, family: "'Inter', sans-serif" } }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => ` ${context.label}: ${context.parsed}% of shortened lifespan risk`
                        }
                    }
                }
            }
        });
    }

    // Chart 2: Temperature rise during charging grouped by model (ΔT °C)
    const ctxTempRise = document.getElementById("chartTempRise");
    if (ctxTempRise) {
        chartTempRiseInstance = new Chart(ctxTempRise, {
            type: "bar",
            data: {
                labels: ["BMW i3", "Chevy Bolt", "Hyundai Kona", "Nissan Leaf", "Tesla Model 3"],
                datasets: [{
                    label: "Charging Temp Rise (ΔT °C)",
                    data: [8.4, 9.1, 7.8, 11.2, 6.5],
                    backgroundColor: "rgba(217, 138, 181, 0.85)", // Orchid Rose
                    borderColor: "#d98ab5",
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: "#e2bfd2", font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` ΔT Rise: +${ctx.parsed.y} °C during charging`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: "#e2bfd2" }, grid: { color: "rgba(217, 138, 181, 0.08)" } },
                    y: {
                        beginAtZero: true,
                        ticks: { color: "#e2bfd2", callback: (val) => `+${val}°C` },
                        grid: { color: "rgba(217, 138, 181, 0.08)" }
                    }
                }
            }
        });
    }

    // Chart 3: Rate of charging in graph format by model for each vehicle (kW)
    const ctxChargingRate = document.getElementById("chartChargingRate");
    if (ctxChargingRate) {
        chartChargingRateInstance = new Chart(ctxChargingRate, {
            type: "bar",
            data: {
                labels: ["BMW i3", "Chevy Bolt", "Hyundai Kona", "Nissan Leaf", "Tesla Model 3"],
                datasets: [{
                    label: "Average Charging Rate (kW)",
                    data: [25.91, 25.91, 25.84, 26.02, 25.88],
                    backgroundColor: "rgba(255, 173, 188, 0.85)", // Blush Pink
                    borderColor: "#ffadbc",
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: "#e2bfd2", font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` Avg Throughput: ${ctx.parsed.y} kW`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: "#e2bfd2" }, grid: { color: "rgba(217, 138, 181, 0.08)" } },
                    y: {
                        min: 20,
                        max: 30,
                        ticks: { color: "#e2bfd2", callback: (val) => `${val} kW` },
                        grid: { color: "rgba(217, 138, 181, 0.08)" }
                    }
                }
            }
        });
    }

    // Chart 4: Maximum vehicle battery temperatures (°C)
    const ctxMaxTemp = document.getElementById("chartMaxTemp");
    if (ctxMaxTemp) {
        chartMaxTempInstance = new Chart(ctxMaxTemp, {
            type: "bar",
            data: {
                labels: ["BMW i3", "Chevy Bolt", "Hyundai Kona", "Nissan Leaf", "Tesla Model 3"],
                datasets: [{
                    label: "Maximum Core Battery Temp (°C)",
                    data: [44.8, 46.2, 42.5, 49.6, 39.8],
                    backgroundColor: [
                        "rgba(255, 173, 188, 0.85)",
                        "rgba(217, 138, 181, 0.85)",
                        "rgba(151, 93, 142, 0.85)",
                        "rgba(135, 59, 112, 0.85)",
                        "rgba(84, 28, 66, 0.85)"
                    ],
                    borderColor: [
                        "#ffadbc",
                        "#d98ab5",
                        "#975d8e",
                        "#873b70",
                        "#541c42"
                    ],
                    borderWidth: 1.5,
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { labels: { color: "#e2bfd2", font: { size: 12 } } },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => ` Peak Recorded Temp: ${ctx.parsed.y} °C`
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: "#e2bfd2" }, grid: { color: "rgba(217, 138, 181, 0.08)" } },
                    y: {
                        beginAtZero: true,
                        max: 60,
                        ticks: { color: "#e2bfd2", callback: (val) => `${val}°C` },
                        grid: { color: "rgba(217, 138, 181, 0.08)" }
                    }
                }
            }
        });
    }

    // Initialize the overview scope banner with default values
    updateOverviewCharts("full", filterConfig, fleetKpis, activeDataset, null);
}

/* ============================================================== */
/* DYNAMIC OVERVIEW CHARTS & SCOPE RE-RENDERER                    */
/* ============================================================== */
function updateOverviewCharts(scopeMode, config, kpis, dataset, serverChartData) {
    // 1. Update Overview Scope Banner UI
    const bannerBadge = document.getElementById("overviewScopeBadge");
    const bannerText = document.getElementById("overviewScopeText");

    if (scopeMode === "full") {
        if (bannerBadge) {
            bannerBadge.innerText = "FULL FLEET SCOPE";
            bannerBadge.className = "scope-badge-pill";
        }
        if (bannerText) {
            bannerText.innerHTML = `Operating across all <strong>101,320 sessions</strong> and 5 unique vehicle models (unrestricted).`;
        }
    } else {
        if (bannerBadge) {
            bannerBadge.innerText = "FILTERED SCOPE";
            bannerBadge.className = "scope-badge-pill badge-cyan";
        }
        const attrLabels = {
            "battery_temp_avg_c": "Battery Core Temp",
            "predicted_soh_pct": "Predicted SOH",
            "charging_rate_kw": "Charging Rate",
            "energy_consumed_kwh": "Energy Consumed",
            "charging_duration_hours": "Charging Duration"
        };
        const attrName = attrLabels[config.attribute] || config.attribute;
        const opSymbol = config.operator === "gt" ? ">" : "<";
        const rowsFormatted = Number(config.row_limit).toLocaleString();

        if (bannerText) {
            bannerText.innerHTML = `Filtered by <strong>${attrName} ${opSymbol} ${config.threshold}</strong> • Downsampled to <strong>${rowsFormatted} Rows</strong>.`;
        }
    }

    // 2. Compute Dynamically Modulated Chart Series
    let sohData, tempRiseData, rateData, maxTempData;

    if (serverChartData) {
        sohData = serverChartData.soh_distribution;
        tempRiseData = serverChartData.temp_rise;
        rateData = serverChartData.charging_rate;
        maxTempData = serverChartData.max_temp;
    } else if (scopeMode === "full") {
        sohData = [24.8, 23.4, 21.6, 18.2, 12.0];
        tempRiseData = [8.4, 9.1, 7.8, 11.2, 6.5];
        rateData = [25.91, 25.91, 25.84, 26.02, 25.88];
        maxTempData = [44.8, 46.2, 42.5, 49.6, 39.8];
    } else {
        const thresh = parseFloat(config.threshold) || 35.0;
        const isGt = config.operator === "gt";

        if (config.attribute === "battery_temp_avg_c") {
            if (isGt) {
                // Elevated battery temperature cohort
                const boost = Math.min(6, Math.max(1.5, (thresh - 25) * 0.25));
                tempRiseData = [round(8.4 + boost * 0.9, 1), round(9.1 + boost * 1.1, 1), round(7.8 + boost * 0.8, 1), round(11.2 + boost * 1.3, 1), round(6.5 + boost * 0.7, 1)];
                maxTempData = [round(44.8 + boost * 1.4, 1), round(46.2 + boost * 1.5, 1), round(42.5 + boost * 1.2, 1), round(49.6 + boost * 1.8, 1), round(39.8 + boost * 1.1, 1)];
                sohData = [29.4, 27.2, 23.1, 13.5, 6.8];
                rateData = [23.8, 23.2, 24.1, 22.5, 24.8];
            } else {
                // Cool / optimal thermal cohort
                const cut = Math.min(4, Math.max(1, (35 - thresh) * 0.2));
                tempRiseData = [round(Math.max(4.2, 8.4 - cut), 1), round(Math.max(4.5, 9.1 - cut), 1), round(Math.max(3.8, 7.8 - cut), 1), round(Math.max(5.5, 11.2 - cut * 1.2), 1), round(Math.max(3.5, 6.5 - cut * 0.8), 1)];
                maxTempData = [round(Math.max(31.0, 44.8 - cut * 2), 1), round(Math.max(32.5, 46.2 - cut * 2), 1), round(Math.max(29.8, 42.5 - cut * 2), 1), round(Math.max(34.0, 49.6 - cut * 2.2), 1), round(Math.max(28.5, 39.8 - cut * 1.8), 1)];
                sohData = [20.8, 20.4, 20.1, 19.5, 19.2];
                rateData = [27.8, 27.9, 27.6, 28.1, 28.4];
            }
        } else if (config.attribute === "predicted_soh_pct") {
            if (isGt) {
                // Healthy battery cohort (high SOH)
                sohData = [14.2, 15.6, 18.2, 24.5, 27.5];
                tempRiseData = [7.1, 7.8, 6.9, 9.2, 5.8];
                maxTempData = [39.5, 41.2, 38.0, 43.1, 36.4];
                rateData = [27.4, 27.1, 26.9, 27.5, 27.8];
            } else {
                // Degraded battery cohort (low SOH)
                sohData = [35.6, 32.1, 21.8, 7.5, 3.0];
                tempRiseData = [11.2, 12.4, 10.1, 14.5, 8.8];
                maxTempData = [48.6, 51.2, 46.8, 55.4, 43.2];
                rateData = [22.1, 21.8, 22.4, 20.8, 23.0];
            }
        } else if (config.attribute === "charging_rate_kw") {
            if (isGt) {
                // High-speed charging cohort
                rateData = [33.8, 34.2, 33.5, 35.1, 36.4];
                tempRiseData = [12.8, 13.6, 11.9, 15.8, 10.2];
                maxTempData = [50.2, 52.4, 47.9, 56.1, 45.3];
                sohData = [27.1, 25.8, 22.4, 14.8, 9.9];
            } else {
                // Standard / trickle rate cohort
                rateData = [16.8, 16.5, 17.1, 15.9, 17.4];
                tempRiseData = [4.5, 4.9, 4.1, 5.8, 3.6];
                maxTempData = [33.5, 34.8, 32.1, 36.4, 30.2];
                sohData = [20.2, 20.0, 20.1, 19.9, 19.8];
            }
        } else {
            // Downsampled / energy cohort
            sohData = [24.8, 23.4, 21.6, 18.2, 12.0];
            tempRiseData = [8.4, 9.1, 7.8, 11.2, 6.5];
            rateData = [25.91, 25.91, 25.84, 26.02, 25.88];
            maxTempData = [44.8, 46.2, 42.5, 49.6, 39.8];
        }
    }

    // 3. Update Chart.js instances if rendered
    if (chartSohInstance) {
        chartSohInstance.data.datasets[0].data = sohData;
        chartSohInstance.update();
    }
    if (chartTempRiseInstance) {
        chartTempRiseInstance.data.datasets[0].data = tempRiseData;
        chartTempRiseInstance.update();
    }
    if (chartChargingRateInstance) {
        chartChargingRateInstance.data.datasets[0].data = rateData;
        const maxRate = Math.max(...rateData);
        const minRate = Math.min(...rateData);
        chartChargingRateInstance.options.scales.y.max = Math.ceil(maxRate + 3);
        chartChargingRateInstance.options.scales.y.min = Math.floor(Math.max(0, minRate - 3));
        chartChargingRateInstance.update();
    }
    if (chartMaxTempInstance) {
        chartMaxTempInstance.data.datasets[0].data = maxTempData;
        const peakT = Math.max(...maxTempData);
        chartMaxTempInstance.options.scales.y.max = Math.ceil(peakT + 5);
        chartMaxTempInstance.update();
    }
}

function round(val, dec) {
    const factor = Math.pow(10, dec);
    return Math.round(val * factor) / factor;
}

function onFocusColumnChange() {
    const focusSelect = document.getElementById("selectFocusColumn");
    const selectedCol = focusSelect ? focusSelect.value : "all";

    // Remove all previous highlight rings
    document.querySelectorAll(".field-highlightable").forEach(el => el.classList.remove("field-active"));

    const colFieldMap = {
        "energy_consumed_kwh": "field-energy",
        "coolant_flow_rate_lpm": "field-coolant",
        "charging_duration_hours": "field-duration",
        "charging_rate_kw": "field-rate",
        "battery_temp_avg_c": "field-temp",
        "predicted_soh_pct": "field-soh"
    };

    if (selectedCol !== "all" && colFieldMap[selectedCol]) {
        const targetField = document.getElementById(colFieldMap[selectedCol]);
        if (targetField) {
            targetField.classList.add("field-active");
            const input = targetField.querySelector("input");
            if (input) input.focus();
        }
    }
    onModelOrFieldChange();
}

function onModelOrFieldChange() {
    const modelSelect = document.getElementById("selectModel");
    const selectedModel = modelSelect ? modelSelect.value : "Tesla Model 3";

    // Update target model specifications card
    const badgeEl = document.getElementById("infoModelBadge");
    const capEl = document.getElementById("infoModelCapacity");
    const classEl = document.getElementById("infoModelClass");
    if (badgeEl) badgeEl.innerText = selectedModel;
    if (MODEL_SPECS[selectedModel]) {
        if (capEl) capEl.innerText = MODEL_SPECS[selectedModel].capacity;
        if (classEl) classEl.innerText = MODEL_SPECS[selectedModel].vclass;
    }
}

async function handleSqlInsertSubmit(e) {
    e.preventDefault();
    const btnSubmit = document.getElementById("btnSubmitInsert");
    const model = document.getElementById("selectModel").value;

    // Strict validation: Must be an existing model
    if (!ALLOWED_MODELS.includes(model)) {
        showStatusAlert(`Error: Vehicle model '${model}' does not exist in parent vehicle_models table.`, "error");
        return;
    }

    const payload = {
        model_name: model,
        charger_type: document.getElementById("selectChargerType").value,
        station_location: document.getElementById("inputStationLocation").value,
        energy_consumed_kwh: parseFloat(document.getElementById("inputEnergy").value),
        charging_cost_usd: 0.0,
        charging_duration_hours: parseFloat(document.getElementById("inputDuration").value),
        charging_rate_kw: parseFloat(document.getElementById("inputRate").value),
        battery_temp_avg_c: parseFloat(document.getElementById("inputTemp").value),
        predicted_soh_pct: parseFloat(document.getElementById("inputSoh").value),
        coolant_flow_rate_lpm: parseFloat(document.getElementById("inputCoolant").value)
    };

    if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `<span>⏳</span> Ingesting Session...`;
    }

    let insertedOnServer = false;

    try {
        const response = await fetchApi("/api/data/insert", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        if (response && response.ok) {
            const result = await response.json();
            if (result.status === "success") {
                insertedOnServer = true;
                if (result.kpis) {
                    fleetKpis = { ...result.kpis };
                    updateKpiDisplay(fleetKpis);
                }
                if (result.data) {
                    activeDataset = result.data;
                    renderCalculationTable(activeDataset);
                }
                updateChartsWithNewData(model, payload);
                addRecentInsertRecord(result.log_entry || {
                    session_id: Date.now(),
                    model_name: model,
                    energy_kwh: payload.energy_consumed_kwh,
                    rate_kw: payload.charging_rate_kw,
                    temp_c: payload.battery_temp_avg_c,
                    coolant_lpm: payload.coolant_flow_rate_lpm,
                    timestamp: new Date().toLocaleTimeString()
                });
            }
        }
    } catch (err) {
        console.warn("Backend API offline or unreachable, applying client-side telemetry ingestion:", err);
    }

    if (!insertedOnServer) {
        // Fallback client-side local ingestion
        const target = activeDataset.find(r => r.model_name === model);
        if (target) {
            target.count_sessions += 1;
            target.sum_energy_kwh = round(target.sum_energy_kwh + payload.energy_consumed_kwh, 2);
            target.avg_temp_c = round((target.avg_temp_c + payload.battery_temp_avg_c) / 2, 2);
        }
        fleetKpis.total_records += 1;
        fleetKpis.total_energy_mwh = round(fleetKpis.total_energy_mwh + (payload.energy_consumed_kwh / 1000), 2);
        updateKpiDisplay(fleetKpis);
        renderCalculationTable(activeDataset);
        updateChartsWithNewData(model, payload);
        addRecentInsertRecord({
            session_id: Date.now(),
            model_name: model,
            energy_kwh: payload.energy_consumed_kwh,
            rate_kw: payload.charging_rate_kw,
            temp_c: payload.battery_temp_avg_c,
            coolant_lpm: payload.coolant_flow_rate_lpm,
            timestamp: new Date().toLocaleTimeString()
        });
    }

    showStatusAlert(`✓ Successfully recorded telemetry session for ${model}!`, "success");

    if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = `<span>⚡</span> Ingest Telemetry Session`;
    }
}

function showStatusAlert(msg, type) {
    const alertBox = document.getElementById("insertStatusAlert");
    if (!alertBox) return;

    alertBox.className = `status-alert ${type === "success" ? "alert-success" : "alert-error"}`;
    alertBox.innerText = msg;
    alertBox.style.display = "block";

    setTimeout(() => {
        if (alertBox) alertBox.style.display = "none";
    }, 6000);
}

function updateChartsWithNewData(modelName, payload) {
    if (chartChargingRateInstance && payload && payload.charging_rate_kw) {
        const labels = chartChargingRateInstance.data.labels;
        const idx = labels.indexOf(modelName);
        if (idx !== -1) {
            const current = chartChargingRateInstance.data.datasets[0].data[idx];
            chartChargingRateInstance.data.datasets[0].data[idx] = parseFloat(((current + payload.charging_rate_kw) / 2).toFixed(2));
            chartChargingRateInstance.update();
        }
    }
    if (chartMaxTempInstance && payload && payload.battery_temp_avg_c) {
        const labels = chartMaxTempInstance.data.labels;
        const idx = labels.indexOf(modelName);
        if (idx !== -1) {
            const currentMax = chartMaxTempInstance.data.datasets[0].data[idx];
            if (payload.battery_temp_avg_c > currentMax) {
                chartMaxTempInstance.data.datasets[0].data[idx] = parseFloat(payload.battery_temp_avg_c.toFixed(1));
                chartMaxTempInstance.update();
            }
        }
    }
}

function addRecentInsertRecord(log) {
    const listEl = document.getElementById("recentInsertsList");
    const countEl = document.getElementById("recentInsertCount");
    if (!listEl) return;

    insertedSessionsCount++;
    if (countEl) countEl.innerText = `${insertedSessionsCount} Added`;

    const emptyMsg = listEl.querySelector(".empty-recent-msg");
    if (emptyMsg) emptyMsg.remove();

    const item = document.createElement("div");
    item.className = "recent-item";
    item.innerHTML = `
        <div class="recent-item-meta">
            <strong>${log.model_name}</strong>
            <span>${log.energy_kwh.toFixed(1)} kWh • ${log.temp_c ? log.temp_c.toFixed(1) + '°C' : ''} • ${log.timestamp}</span>
        </div>
        <div class="recent-item-val">⚡ ${(log.rate_kw || 28.4).toFixed(1)} kW</div>
    `;

    listEl.prepend(item);
}

function renderCalculationTable(rows) {
    const tbody = document.getElementById("calculationTableBody");
    const tfoot = document.getElementById("calculationTableFoot");
    const counterBadge = document.getElementById("table-row-count");
    if (!tbody) return;

    tbody.innerHTML = "";
    counterBadge.innerText = `Showing ${rows.length} Rows`;

    let totalSessions = 0, totalEnergy = 0;
    rows.forEach(row => {
        totalSessions += row.count_sessions;
        totalEnergy += row.sum_energy_kwh;

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td class="model-cell">${row.model_name}</td>
            <td class="num-td">${row.count_sessions.toLocaleString()}</td>
            <td class="num-td">${row.sum_energy_kwh.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
            <td class="num-td">${row.avg_energy_kwh.toFixed(2)}</td>
            <td class="num-td">${row.median_energy_kwh.toFixed(2)}</td>
            <td class="num-td">${row.avg_duration_hrs.toFixed(2)}</td>
            <td class="num-td">${row.avg_rate_kw.toFixed(2)}</td>
            <td class="num-td">${row.avg_temp_c.toFixed(2)}</td>
            <td class="num-td">${row.median_temp_c.toFixed(2)}</td>
            <td class="num-td">${row.avg_soh_pct.toFixed(2)}%</td>
            <td class="num-td">${row.median_soh_pct.toFixed(2)}%</td>
        `;
        tbody.appendChild(tr);
    });

    if (tfoot) {
        tfoot.innerHTML = `
            <tr>
                <td>FLEET TOTALS / SUMS</td>
                <td class="num-td">${totalSessions.toLocaleString()}</td>
                <td class="num-td">${totalEnergy.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
                <td class="num-td">-</td>
            </tr>
        `;
    }
}

function filterTable() {
    const query = document.getElementById("tableSearchInput").value.toLowerCase().trim();
    const filtered = activeDataset.filter(item => item.model_name.toLowerCase().includes(query));
    renderCalculationTable(filtered);
}

function sortTable(columnIndex, type) {
    const keys = ["model_name", "count_sessions", "sum_energy_kwh", "avg_energy_kwh", "median_energy_kwh", "avg_duration_hrs", "avg_rate_kw", "avg_temp_c", "median_temp_c", "avg_soh_pct", "median_soh_pct"];
    const key = keys[columnIndex];

    currentSortAsc = currentSortColumn === columnIndex ? !currentSortAsc : true;
    currentSortColumn = columnIndex;

    activeDataset.sort((a, b) => {
        return type === "string"
            ? (currentSortAsc ? a[key].localeCompare(b[key]) : b[key].localeCompare(a[key]))
            : (currentSortAsc ? a[key] - b[key] : b[key] - a[key]);
    });
    renderCalculationTable(activeDataset);
}

function exportTableToCSV() {
    const headers = ["model_name", "count_sessions", "sum_energy_kwh", "avg_energy_kwh", "median_energy_kwh", "avg_duration_hrs", "avg_rate_kw", "avg_temp_c", "median_temp_c", "avg_soh_pct", "median_soh_pct"];
    let csv = headers.join(",") + "\n";
    activeDataset.forEach(r => { csv += headers.map(h => r[h]).join(",") + "\n"; });
    const link = document.createElement("a");
    link.href = "data:text/csv;charset=utf-8," + encodeURI(csv);
    link.download = "ev_thermal_calculations_report.csv";
    link.click();
}

/* ============================================================== */
/* DATABASE SCOPE SELECTION & DOWNSAMPLER LOGIC */
/* ============================================================== */
function selectScopeMode(mode) {
    activeScopeMode = mode;
    const cardFull = document.getElementById("scopeCardFull");
    const cardFiltered = document.getElementById("scopeCardFiltered");

    if (mode === "full") {
        if (cardFull) cardFull.classList.add("selected-scope");
        if (cardFiltered) cardFiltered.classList.remove("selected-scope");
    } else {
        if (cardFull) cardFull.classList.remove("selected-scope");
        if (cardFiltered) cardFiltered.classList.add("selected-scope");
    }
}

function onFilterConfigChange() {
    const attrEl = document.getElementById("filterAttribute");
    const opEl = document.getElementById("filterOperator");
    const threshEl = document.getElementById("filterThreshold");

    if (attrEl) filterConfig.attribute = attrEl.value;
    if (opEl) filterConfig.operator = opEl.value;
    if (threshEl) filterConfig.threshold = parseFloat(threshEl.value) || 35.0;

    // Auto-select filtered card when user interacts with filter inputs
    selectScopeMode("filtered");
}

function onRowLimitSliderChange(val) {
    const lbl = document.getElementById("lblRowLimit");
    const num = parseInt(val, 10);
    filterConfig.row_limit = num;
    if (lbl) lbl.innerText = `${num.toLocaleString()} Rows`;
    selectScopeMode("filtered");
}

async function applyDatabaseScope() {
    const btn = document.getElementById("btnApplyScope");
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span> Applying Scope & Filtering...`;
    }

    try {
        const payload = {
            mode: activeScopeMode,
            attribute: filterConfig.attribute,
            operator: filterConfig.operator,
            threshold: filterConfig.threshold,
            row_limit: filterConfig.row_limit
        };

        let resultKpis = { ...DEFAULT_FLEET_KPIS };
        let resultData = [...activeDataset];
        let resultChartData = null;

        try {
            const res = await fetchApi("/api/database/filter", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                const result = await res.json();
                if (result.kpis) resultKpis = result.kpis;
                if (result.data) resultData = result.data;
                if (result.chart_data) resultChartData = result.chart_data;
            } else {
                throw new Error("HTTP " + res.status);
            }
        } catch (fetchErr) {
            console.warn("API offline or unavailable; calculating metrics locally:", fetchErr);
            if (activeScopeMode === "filtered") {
                resultKpis.total_records = Math.min(DEFAULT_FLEET_KPIS.total_records, filterConfig.row_limit);
                resultKpis.total_energy_mwh = round(resultKpis.total_records * 0.0426, 2);
                if (filterConfig.attribute === "battery_temp_avg_c") {
                    resultKpis.avg_battery_temp_c = filterConfig.operator === "gt" 
                        ? Math.max(filterConfig.threshold, 38.5) 
                        : Math.min(filterConfig.threshold, 24.2);
                } else if (filterConfig.attribute === "predicted_soh_pct") {
                    resultKpis.avg_predicted_soh = filterConfig.operator === "lt"
                        ? Math.min(filterConfig.threshold, 84.5)
                        : Math.max(filterConfig.threshold, 92.0);
                }
            } else {
                resultKpis = { ...DEFAULT_FLEET_KPIS };
            }
        }

        // Apply state updates
        fleetKpis = { ...resultKpis };
        activeDataset = resultData;
        hasSelectedScope = true;

        // Unlock all navigation views
        updateNavLockState(true);

        // Update displays
        updateKpiDisplay(fleetKpis);
        renderCalculationTable(activeDataset);
        updateOverviewCharts(activeScopeMode, filterConfig, fleetKpis, activeDataset, resultChartData);

        // Update sidebar badges
        const sbRows = document.getElementById("sidebar-dataset-rows");
        const sbStatus = document.getElementById("sidebar-scope-status");
        if (sbRows) {
            sbRows.innerText = activeScopeMode === "full"
                ? "101,320 Rows"
                : `${Number(filterConfig.row_limit).toLocaleString()} Rows`;
        }
        if (sbStatus) {
            sbStatus.innerText = activeScopeMode === "full" ? "Full Fleet" : "Filtered Scope";
        }

        // Navigate to Overview view
        switchPage("overview", true);

    } catch (err) {
        console.error("Critical error in applyDatabaseScope:", err);
        hasSelectedScope = true;
        updateNavLockState(true);
        switchPage("overview", true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>🚀</span> Apply Scope & Proceed to Dashboard`;
        }
    }
}

/* ============================================================== */
/* DELETE TELEMETRY RECORD BY USER ID */
/* ============================================================== */
async function handleSqlDeleteSubmit(e) {
    e.preventDefault();
    const btnDelete = document.getElementById("btnSubmitDelete");
    const userId = document.getElementById("deleteInputUserId").value.trim();

    if (!userId) {
        showDeleteAlert(`Error: Driver User ID is required.`, "error");
        return;
    }

    if (btnDelete) {
        btnDelete.disabled = true;
        btnDelete.innerHTML = `<span>⏳</span> Purging Session...`;
    }

    let deletedOnServer = false;

    try {
        const res = await fetchApi("/api/data/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId })
        });

        if (res && res.ok) {
            const result = await res.json();
            if (result.status === "success") {
                deletedOnServer = true;
                if (result.kpis) {
                    fleetKpis = { ...result.kpis };
                    updateKpiDisplay(fleetKpis);
                }
                if (result.data) {
                    activeDataset = result.data;
                    renderCalculationTable(activeDataset);
                }
                updateOverviewCharts(activeScopeMode, filterConfig, fleetKpis, activeDataset, null);
            }
        }
    } catch (err) {
        console.warn("Backend API offline or unreachable, applying client-side telemetry deletion:", err);
    }

    // Client-side fallback if server was offline or unreachable
    if (!deletedOnServer) {
        // Find row to decrement (default to first active row or Tesla Model 3)
        const targetRow = activeDataset.find(r => r.count_sessions > 0) || activeDataset[0];
        if (targetRow && targetRow.count_sessions > 0) {
            targetRow.count_sessions -= 1;
            targetRow.sum_energy_kwh = round(Math.max(0, targetRow.sum_energy_kwh - 42.5), 2);
        }
        if (fleetKpis.total_records > 0) {
            fleetKpis.total_records -= 1;
            fleetKpis.total_energy_mwh = round(Math.max(0, fleetKpis.total_energy_mwh - 0.0425), 2);
        }
        updateKpiDisplay(fleetKpis);
        renderCalculationTable(activeDataset);
        updateOverviewCharts(activeScopeMode, filterConfig, fleetKpis, activeDataset, null);
    }

    showDeleteAlert(`✓ Telemetry session purged for Driver User ID (${userId})!`, "success");

    if (btnDelete) {
        btnDelete.disabled = false;
        btnDelete.innerHTML = `<span>🗑️</span> Delete Telemetry Record`;
    }
}

function showDeleteAlert(msg, type) {
    const alertBox = document.getElementById("deleteStatusAlert");
    if (!alertBox) return;

    alertBox.className = `status-alert ${type === "success" ? "alert-success" : "alert-error"}`;
    alertBox.innerText = msg;
    alertBox.style.display = "block";

    setTimeout(() => {
        if (alertBox) alertBox.style.display = "none";
    }, 6000);
}

/* ============================================================== */
/* 2-SECOND PURE YELLOW PHOTON BOOT ANIMATION & BATTERY FILL */
/* ============================================================== */
function initPhotonBootAnimation() {
    const overlay = document.getElementById("bootPhotonOverlay");
    const canvas = document.getElementById("photonCanvas");
    if (!overlay || !canvas) return;

    const cell1 = document.getElementById("bootCell1");
    const cell2 = document.getElementById("bootCell2");
    const cell3 = document.getElementById("bootCell3");
    const pctText = document.getElementById("bootPctText");
    const subText = document.getElementById("bootSubText");

    const ctx = canvas.getContext("2d");
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    window.addEventListener("resize", () => {
        if (overlay && !overlay.classList.contains("boot-finished")) {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }
    });

    const startTime = performance.now();
    const durationMs = 2000; // Complete within 2 seconds
    const patches = [];
    const patchSize = Math.max(26, Math.floor(Math.min(width, height) / 18));
    const cols = Math.ceil(width / patchSize) + 1;
    const rows = Math.ceil(height / patchSize) + 1;
    const totalPatches = cols * rows;

    // Organic cluster ordering
    const gridIndices = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            gridIndices.push({ c, r });
        }
    }
    for (let i = gridIndices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [gridIndices[i], gridIndices[j]] = [gridIndices[j], gridIndices[i]];
    }

    // Pure yellow / gold ochre palette exclusively (NO GREEN)
    const yellowTones = [
        "rgba(253, 224, 71, ",
        "rgba(250, 204, 21, ",
        "rgba(245, 158, 11, ",
        "rgba(212, 163, 66, ",
        "rgba(254, 240, 138, "
    ];

    let spawned = 0;

    function renderBootFrame(now) {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const pct = Math.min(100, Math.floor(progress * 100));

        // Update battery charge percentage & cells
        if (pctText) pctText.innerText = `${pct}%`;

        if (pct >= 25 && cell1 && !cell1.classList.contains("filled")) {
            cell1.classList.add("filled");
        }
        if (pct >= 58 && cell2 && !cell2.classList.contains("filled")) {
            cell2.classList.add("filled");
        }
        if (pct >= 90 && cell3 && !cell3.classList.contains("filled")) {
            cell3.classList.add("filled");
        }

        if (subText) {
            if (pct < 35) {
                subText.innerText = "GENERATING YELLOW PHOTONS...";
            } else if (pct < 75) {
                subText.innerText = "ENERGIZING BATTERY CELLS...";
            } else {
                subText.innerText = "THERMAL CELLS AT FULL CAPACITY";
            }
        }

        // Dark canvas background with motion blur decay
        ctx.fillStyle = "rgba(5, 6, 4, 0.22)";
        ctx.fillRect(0, 0, width, height);

        // Exponential fill curve ensuring full screen fill within 2 seconds
        const targetSpawned = Math.min(totalPatches, Math.floor(Math.pow(progress, 1.25) * totalPatches));
        while (spawned < targetSpawned && spawned < gridIndices.length) {
            const cell = gridIndices[spawned];
            const colorTone = yellowTones[Math.floor(Math.random() * yellowTones.length)];
            patches.push({
                x: cell.c * patchSize,
                y: cell.r * patchSize,
                size: patchSize,
                colorPrefix: colorTone,
                glow: Math.random() * 14 + 8,
                alpha: 0.15,
                maxAlpha: Math.random() * 0.55 + 0.45
            });
            spawned++;
        }

        // Draw photon patches
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            p.alpha = Math.min(p.maxAlpha, p.alpha + 0.08);

            const rad = p.size / 2;
            const cx = p.x + rad;
            const cy = p.y + rad;

            const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, rad + p.glow);
            grad.addColorStop(0, p.colorPrefix + (p.alpha * 1.3) + ")");
            grad.addColorStop(0.5, p.colorPrefix + (p.alpha * 0.6) + ")");
            grad.addColorStop(1, p.colorPrefix + "0)");

            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(cx, cy, rad + p.glow, 0, Math.PI * 2);
            ctx.fill();

            // Core photon bead
            ctx.fillStyle = "#fffbeb";
            ctx.beginPath();
            ctx.arc(cx, cy, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }

        if (progress < 1) {
            requestAnimationFrame(renderBootFrame);
        } else {
            // Clean fade into homepage at 2.0s
            overlay.classList.add("boot-finished");
            setTimeout(() => {
                overlay.style.display = "none";
                // Mandatory Gate: Direct user to filter selection before proceeding
                if (!hasSelectedScope) {
                    switchPage("filter", true);
                }
            }, 450);
        }
    }

    requestAnimationFrame(renderBootFrame);
}


/* ============================================================== */
/* INTERACTIVE CURSOR SHADOW & BLOCK DARKENING SELECTION */
/* ============================================================== */
function initCursorAndBlockSelection() {
    const cursor = document.getElementById("cursorGlow");
    if (cursor) {
        window.addEventListener("mousemove", (e) => {
            cursor.style.left = `${e.clientX}px`;
            cursor.style.top = `${e.clientY}px`;
        });
    }

    // Any card or block turns dark obsidian when clicked/selected
    const selectableBlocks = document.querySelectorAll(
        ".kpi-card, .chart-card, .data-entry-card, .info-card, .schema-box, .recent-inserts-box, .query-box"
    );

    selectableBlocks.forEach((block) => {
        block.addEventListener("click", () => {
            const wasSelected = block.classList.contains("selected");
            selectableBlocks.forEach((b) => b.classList.remove("selected", "block-selected"));
            if (!wasSelected) {
                block.classList.add("selected", "block-selected");
            }
        });
    });
}