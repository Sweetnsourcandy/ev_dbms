-- ==============================================================================
-- POSTGRESQL ANALYTICAL QUERIES
-- Multi-Table Joins, Nested CTEs, Aggregates (COUNT, SUM, AVG) & Medians
-- ==============================================================================

-- QUERY 1: PRIMARY CALCULATION REPORT (10 Rows)
WITH model_medians AS (
    SELECT 
        cs.model_id,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cs.energy_consumed_kwh) AS median_energy_kwh,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY cs.charging_cost_usd) AS median_cost_usd,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tt.battery_temp_avg_c) AS median_battery_temp_c,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.predicted_soh_pct) AS median_soh_pct
    FROM charging_sessions cs
    INNER JOIN thermal_telemetry tt ON cs.session_id = tt.session_id
    INNER JOIN digital_twin_metrics dt ON cs.session_id = dt.session_id
    GROUP BY cs.model_id
),
model_charger_aggregates AS (
    SELECT 
        cs.model_id,
        cs.charger_type,
        COUNT(cs.session_id) AS total_sessions,
        SUM(cs.energy_consumed_kwh) AS sum_energy_consumed_kwh,
        AVG(cs.energy_consumed_kwh) AS avg_energy_consumed_kwh,
        SUM(cs.charging_cost_usd) AS sum_charging_cost_usd,
        AVG(cs.charging_cost_usd) AS avg_charging_cost_usd,
        AVG(cs.charging_duration_hours) AS avg_duration_hours,
        AVG(cs.charging_rate_kw) AS avg_charging_rate_kw,
        AVG(tt.battery_temp_avg_c) AS avg_battery_temp_c,
        AVG(dt.predicted_soh_pct) AS avg_predicted_soh
    FROM charging_sessions cs
    INNER JOIN thermal_telemetry tt ON cs.session_id = tt.session_id
    INNER JOIN digital_twin_metrics dt ON cs.session_id = dt.session_id
    WHERE cs.charger_type IN ('DC Fast Charger', 'Level 2')
    GROUP BY cs.model_id, cs.charger_type
)
SELECT 
    vm.model_name,
    agg.total_sessions::BIGINT AS count_sessions,
    ROUND(agg.sum_energy_consumed_kwh, 2) AS sum_energy_kwh,
    ROUND(agg.avg_energy_consumed_kwh, 2) AS avg_energy_kwh,
    ROUND(med.median_energy_kwh::NUMERIC, 2) AS median_energy_kwh,
    ROUND(agg.sum_charging_cost_usd, 2) AS sum_cost_usd,
    ROUND(agg.avg_cost_usd::NUMERIC, 2) AS avg_cost_usd,
    ROUND(med.median_cost_usd::NUMERIC, 2) AS median_cost_usd,
    ROUND(agg.avg_duration_hours, 2) AS avg_duration_hrs,
    ROUND(agg.avg_charging_rate_kw, 2) AS avg_rate_kw,
    ROUND(agg.avg_battery_temp_c, 2) AS avg_temp_c,
    ROUND(med.median_battery_temp_c::NUMERIC, 2) AS median_temp_c,
    ROUND(agg.avg_predicted_soh, 2) AS avg_soh_pct,
    ROUND(med.median_soh_pct::NUMERIC, 2) AS median_soh_pct
FROM vehicle_models vm
INNER JOIN model_charger_aggregates agg ON vm.model_id = agg.model_id
INNER JOIN model_medians med ON vm.model_id = med.model_id
ORDER BY vm.model_name ASC, agg.total_sessions DESC
LIMIT 10;

-- QUERY 2: OVERALL FLEET SUMMARY (Single KPI Row)
SELECT 
    COUNT(cs.session_id) AS total_charging_sessions,
    ROUND(SUM(cs.energy_consumed_kwh), 2) AS fleet_total_energy_kwh,
    ROUND(AVG(cs.energy_consumed_kwh), 2) AS fleet_avg_energy_kwh,
    ROUND(SUM(cs.charging_cost_usd), 2) AS fleet_total_revenue_usd,
    ROUND(AVG(cs.charging_duration_hours), 2) AS fleet_avg_duration_hours,
    ROUND(AVG(cs.charging_rate_kw), 2) AS fleet_avg_charging_rate_kw,
    ROUND(AVG(tt.battery_temp_avg_c), 2) AS fleet_avg_battery_temp_c,
    ROUND(AVG(dt.predicted_soh_pct), 2) AS fleet_avg_soh_pct
FROM charging_sessions cs
INNER JOIN thermal_telemetry tt ON cs.session_id = tt.session_id
INNER JOIN digital_twin_metrics dt ON cs.session_id = dt.session_id;

-- QUERY 3: THERMAL STRESS PROFILING
SELECT 
    vm.model_name,
    COUNT(tt.telemetry_id) AS sessions_analyzed,
    ROUND(MIN(tt.battery_temp_min_c), 2) AS min_observed_temp_c,
    ROUND(AVG(tt.battery_temp_avg_c), 2) AS avg_observed_temp_c,
    ROUND(MAX(tt.battery_temp_max_c), 2) AS max_observed_temp_c,
    ROUND(AVG(tt.coolant_flow_rate_lpm), 2) AS avg_coolant_flow_rate_lpm
FROM vehicle_models vm
INNER JOIN thermal_telemetry tt ON vm.model_id = tt.model_id
GROUP BY vm.model_name
ORDER BY avg_observed_temp_c DESC;

-- ==============================================================================
-- QUERY 4: PARAMETRIC MULTI-TABLE DATA INSERTION (Parent FK Validated)
-- Inserts a validated charging session, thermal reading, and digital twin metric
-- Strictly restricts model_id to existing rows in vehicle_models.
-- ==============================================================================
BEGIN;

-- Step 1: Insert new charging session bound to validated vehicle_models parent
INSERT INTO charging_sessions (
    model_id,
    user_id,
    charging_station_id,
    station_location,
    charger_type,
    user_type,
    start_time,
    end_time,
    charging_duration_hours,
    energy_consumed_kwh,
    charging_rate_kw,
    charging_cost_usd,
    time_of_day,
    day_of_week,
    soc_start_pct,
    soc_end_pct,
    distance_driven_km,
    ambient_temp_c,
    vehicle_age_years
) VALUES (
    (SELECT model_id FROM vehicle_models WHERE model_name = 'Tesla Model 3'),
    'USR-101321',
    'STN-089',
    'Metro Supercharge Hub',
    'DC Fast Charger',
    'Commuter',
    CURRENT_TIMESTAMP - INTERVAL '2 hours 15 minutes',
    CURRENT_TIMESTAMP,
    2.25,
    46.80,
    28.50,
    24.60,
    'Afternoon',
    'Friday',
    18.50,
    88.00,
    175.20,
    25.50,
    2.1
) RETURNING session_id;

-- Step 2: Insert 1-to-1 matching thermal telemetry for the newly created session
INSERT INTO thermal_telemetry (
    session_id,
    model_id,
    pack_voltage_v,
    battery_current_a,
    battery_temp_min_c,
    battery_temp_max_c,
    battery_temp_avg_c,
    coolant_flow_rate_lpm,
    coolant_inlet_temp_c,
    coolant_outlet_temp_c
) VALUES (
    currval('charging_sessions_session_id_seq'),
    (SELECT model_id FROM vehicle_models WHERE model_name = 'Tesla Model 3'),
    398.20,
    65.40,
    23.50,
    29.80,
    26.40,
    14.80,
    21.20,
    28.90
);

-- Step 3: Insert digital twin predictive metrics for the session
INSERT INTO digital_twin_metrics (
    session_id,
    model_id,
    sync_status,
    predicted_max_temp_c,
    predicted_soh_pct,
    sync_latency_ms
) VALUES (
    currval('charging_sessions_session_id_seq'),
    (SELECT model_id FROM vehicle_models WHERE model_name = 'Tesla Model 3'),
    'Synchronized',
    29.50,
    91.20,
    115.00
);

COMMIT;