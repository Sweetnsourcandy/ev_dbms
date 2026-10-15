-- ==============================================================================
-- DATABASE SCHEMA DEFINITION: EV CHARGING & THERMAL TELEMETRY
-- Dialect: PostgreSQL 14+
-- Parent Table: vehicle_models
-- Child Tables: charging_sessions, thermal_telemetry, digital_twin_metrics
-- ==============================================================================

DROP TABLE IF EXISTS digital_twin_metrics CASCADE;
DROP TABLE IF EXISTS thermal_telemetry CASCADE;
DROP TABLE IF EXISTS charging_sessions CASCADE;
DROP TABLE IF EXISTS vehicle_models CASCADE;

-- 1. PARENT TABLE: Vehicle Models
CREATE TABLE vehicle_models (
    model_id SERIAL PRIMARY KEY,
    model_name VARCHAR(100) NOT NULL UNIQUE,
    default_battery_capacity_kwh NUMERIC(8, 2) NOT NULL,
    vehicle_class VARCHAR(50) DEFAULT 'Passenger EV',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO vehicle_models (model_name, default_battery_capacity_kwh) VALUES
    ('BMW i3', 108.46),
    ('Chevy Bolt', 75.00),
    ('Hyundai Kona', 100.00),
    ('Nissan Leaf', 50.00),
    ('Tesla Model 3', 82.00)
ON CONFLICT (model_name) DO NOTHING;

-- 2. CHILD TABLE: Charging Sessions
CREATE TABLE charging_sessions (
    session_id SERIAL PRIMARY KEY,
    model_id INT NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    charging_station_id VARCHAR(50) NOT NULL,
    station_location VARCHAR(100) NOT NULL,
    charger_type VARCHAR(50) NOT NULL,
    user_type VARCHAR(50) NOT NULL,
    start_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    end_time TIMESTAMP WITHOUT TIME ZONE NOT NULL,
    charging_duration_hours NUMERIC(6, 3) NOT NULL,
    energy_consumed_kwh NUMERIC(8, 3) NOT NULL,
    charging_rate_kw NUMERIC(6, 3) NOT NULL,
    charging_cost_usd NUMERIC(8, 3) NOT NULL,
    time_of_day VARCHAR(30),
    day_of_week VARCHAR(30),
    soc_start_pct NUMERIC(5, 2) NOT NULL,
    soc_end_pct NUMERIC(5, 2) NOT NULL,
    distance_driven_km NUMERIC(8, 2) NOT NULL,
    ambient_temp_c NUMERIC(5, 2) NOT NULL,
    vehicle_age_years NUMERIC(4, 1) NOT NULL,
    CONSTRAINT fk_sessions_model
        FOREIGN KEY (model_id)
        REFERENCES vehicle_models(model_id)
        ON DELETE CASCADE
);

-- 3. CHILD TABLE: Thermal Telemetry
CREATE TABLE thermal_telemetry (
    telemetry_id SERIAL PRIMARY KEY,
    session_id INT UNIQUE NOT NULL,
    model_id INT NOT NULL,
    pack_voltage_v NUMERIC(6, 2) NOT NULL,
    battery_current_a NUMERIC(6, 2) NOT NULL,
    battery_temp_min_c NUMERIC(5, 2) NOT NULL,
    battery_temp_max_c NUMERIC(5, 2) NOT NULL,
    battery_temp_avg_c NUMERIC(5, 2) NOT NULL,
    coolant_flow_rate_lpm NUMERIC(5, 2) NOT NULL,
    coolant_inlet_temp_c NUMERIC(5, 2) NOT NULL,
    coolant_outlet_temp_c NUMERIC(5, 2) NOT NULL,
    CONSTRAINT fk_telemetry_session
        FOREIGN KEY (session_id)
        REFERENCES charging_sessions(session_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_telemetry_model
        FOREIGN KEY (model_id)
        REFERENCES vehicle_models(model_id)
        ON DELETE CASCADE
);

-- 4. CHILD TABLE: Digital Twin Metrics
CREATE TABLE digital_twin_metrics (
    twin_id SERIAL PRIMARY KEY,
    session_id INT UNIQUE NOT NULL,
    model_id INT NOT NULL,
    sync_status VARCHAR(50) NOT NULL,
    predicted_max_temp_c NUMERIC(5, 2) NOT NULL,
    predicted_soh_pct NUMERIC(5, 2) NOT NULL,
    sync_latency_ms NUMERIC(6, 2) NOT NULL,
    CONSTRAINT fk_twin_session
        FOREIGN KEY (session_id)
        REFERENCES charging_sessions(session_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_twin_model
        FOREIGN KEY (model_id)
        REFERENCES vehicle_models(model_id)
        ON DELETE CASCADE
);

-- Performance Indexes
CREATE INDEX idx_sessions_model_id ON charging_sessions(model_id);
CREATE INDEX idx_sessions_charger_type ON charging_sessions(charger_type);
CREATE INDEX idx_telemetry_session_id ON thermal_telemetry(session_id);
CREATE INDEX idx_telemetry_model_id ON thermal_telemetry(model_id);
CREATE INDEX idx_twin_session_id ON digital_twin_metrics(session_id);
CREATE INDEX idx_twin_model_id ON digital_twin_metrics(model_id);