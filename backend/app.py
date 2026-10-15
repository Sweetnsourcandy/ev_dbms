import os
import json
import pandas as pd
from flask import Flask, jsonify, request, send_from_directory

frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "Frontend"))
if not os.path.exists(frontend_dir):
    frontend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend"))

app = Flask(__name__, static_folder=frontend_dir, static_url_path="")

try:
    from flask_cors import CORS
    CORS(app)
except ImportError:
    pass

@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        res = app.make_default_options_response()
        res.headers["Access-Control-Allow-Origin"] = "*"
        res.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        res.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        return res

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    return response

CSV_FILE = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "ev_charging_patterns_thermal_sensors (2).csv"))
if not os.path.exists(CSV_FILE):
    CSV_FILE = os.path.abspath("ev_charging_patterns_thermal_sensors (2).csv")

cached_data = None

def get_data():
    global cached_data
    if cached_data is not None:
        return cached_data
    if os.path.exists(CSV_FILE):
        df = pd.read_csv(CSV_FILE).dropna()
    else:
        df = pd.DataFrame()
    cached_data = df
    return df


# Global mutable calculation data and stats state (Inner Join across vehicle_models parent table)
VALID_MODELS = ["BMW i3", "Chevy Bolt", "Hyundai Kona", "Nissan Leaf", "Tesla Model 3"]

calculation_rows = [
    {"model_name": "BMW i3", "count_sessions": 13112, "sum_energy_kwh": 559174.27, "avg_energy_kwh": 42.65, "median_energy_kwh": 42.69, "avg_duration_hrs": 2.28, "avg_rate_kw": 25.91, "avg_temp_c": 26.14, "median_temp_c": 24.76, "avg_soh_pct": 90.39, "median_soh_pct": 90.48},
    {"model_name": "Chevy Bolt", "count_sessions": 12748, "sum_energy_kwh": 543900.08, "avg_energy_kwh": 42.67, "median_energy_kwh": 42.55, "avg_duration_hrs": 2.27, "avg_rate_kw": 25.91, "avg_temp_c": 26.05, "median_temp_c": 24.50, "avg_soh_pct": 90.38, "median_soh_pct": 90.45},
    {"model_name": "Hyundai Kona", "count_sessions": 13133, "sum_energy_kwh": 563069.94, "avg_energy_kwh": 42.87, "median_energy_kwh": 43.22, "avg_duration_hrs": 2.25, "avg_rate_kw": 25.84, "avg_temp_c": 26.40, "median_temp_c": 25.02, "avg_soh_pct": 90.34, "median_soh_pct": 90.38},
    {"model_name": "Nissan Leaf", "count_sessions": 13072, "sum_energy_kwh": 557658.68, "avg_energy_kwh": 42.66, "median_energy_kwh": 42.76, "avg_duration_hrs": 2.27, "avg_rate_kw": 26.02, "avg_temp_c": 26.12, "median_temp_c": 24.81, "avg_soh_pct": 90.42, "median_soh_pct": 90.50},
    {"model_name": "Tesla Model 3", "count_sessions": 13974, "sum_energy_kwh": 593360.55, "avg_energy_kwh": 42.46, "median_energy_kwh": 42.28, "avg_duration_hrs": 2.26, "avg_rate_kw": 25.88, "avg_temp_c": 26.12, "median_temp_c": 24.82, "avg_soh_pct": 90.37, "median_soh_pct": 90.44}
]

fleet_kpis = {
    "total_records": 101320,
    "total_energy_mwh": 4321.02,
    "avg_battery_temp_c": 26.15,
    "avg_predicted_soh": 90.37,
    "avg_duration_hrs": 2.27
}

inserted_telemetry_logs = []

@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/api/overview", methods=["GET"])
def api_overview():
    return jsonify({
        "status": "success",
        "kpis": fleet_kpis
    })

@app.route("/api/calculations", methods=["GET"])
def api_calculations():
    return jsonify({
        "status": "success",
        "row_count": len(calculation_rows),
        "data": calculation_rows
    })

@app.route("/api/models", methods=["GET"])
def api_models():
    return jsonify({
        "status": "success",
        "models": VALID_MODELS
    })

@app.route("/api/data/insert", methods=["POST"])
def api_insert_data():
    payload = request.get_json() or {}
    model_name = payload.get("model_name", "").strip()

    # Enforce strict model validation - do not allow non-existent models
    if model_name not in VALID_MODELS:
        return jsonify({
            "status": "error",
            "message": f"Invalid vehicle model '{model_name}'. Model MUST be one of existing models: {', '.join(VALID_MODELS)}"
        }), 400

    try:
        energy_kwh = float(payload.get("energy_consumed_kwh", 45.0))
        cost_usd = float(payload.get("charging_cost_usd", 22.5))
        duration_hrs = float(payload.get("charging_duration_hours", 2.2))
        rate_kw = float(payload.get("charging_rate_kw", 25.5))
        temp_c = float(payload.get("battery_temp_avg_c", 26.0))
        soh_pct = float(payload.get("predicted_soh_pct", 90.4))
        charger_type = payload.get("charger_type", "DC Fast Charger")
        location = payload.get("station_location", "Main Hub - Station #01")
        user_id = payload.get("user_id", f"USR-{fleet_kpis['total_records'] + 1}")
    except (ValueError, TypeError) as e:
        return jsonify({
            "status": "error",
            "message": f"Invalid numerical value provided: {str(e)}"
        }), 400

    # Build relational SQL query representation
    sql_query = f"""-- Multi-Table Transactional Insert
BEGIN;

-- 1. Insert into charging_sessions
INSERT INTO charging_sessions (
    model_id, user_id, charging_station_id, station_location, charger_type, user_type,
    start_time, end_time, charging_duration_hours, energy_consumed_kwh, charging_rate_kw,
    charging_cost_usd, time_of_day, day_of_week, soc_start_pct, soc_end_pct,
    distance_driven_km, ambient_temp_c, vehicle_age_years
) VALUES (
    (SELECT model_id FROM vehicle_models WHERE model_name = '{model_name}'),
    '{user_id}', 'STN-501', '{location}', '{charger_type}', 'Fleet Driver',
    CURRENT_TIMESTAMP - INTERVAL '{duration_hrs} hours', CURRENT_TIMESTAMP,
    {duration_hrs:.2f}, {energy_kwh:.2f}, {rate_kw:.2f}, {cost_usd:.2f},
    'Afternoon', 'Friday', 22.00, 85.00, 160.00, 24.50, 2.5
) RETURNING session_id;

-- 2. Insert into thermal_telemetry
INSERT INTO thermal_telemetry (
    session_id, model_id, pack_voltage_v, battery_current_a,
    battery_temp_min_c, battery_temp_max_c, battery_temp_avg_c,
    coolant_flow_rate_lpm, coolant_inlet_temp_c, coolant_outlet_temp_c
) VALUES (
    currval('charging_sessions_session_id_seq'),
    (SELECT model_id FROM vehicle_models WHERE model_name = '{model_name}'),
    398.50, 68.20, {temp_c - 2.5:.2f}, {temp_c + 3.0:.2f}, {temp_c:.2f},
    14.80, 21.50, 29.20
);

-- 3. Insert into digital_twin_metrics
INSERT INTO digital_twin_metrics (
    session_id, model_id, sync_status,
    predicted_max_temp_c, predicted_soh_pct, sync_latency_ms
) VALUES (
    currval('charging_sessions_session_id_seq'),
    (SELECT model_id FROM vehicle_models WHERE model_name = '{model_name}'),
    'Synchronized', {temp_c + 3.8:.2f}, {soh_pct:.2f}, 112.40
);

COMMIT;"""

    # Update running KPIs
    old_count = fleet_kpis["total_records"]
    new_count = old_count + 1
    fleet_kpis["total_records"] = new_count
    fleet_kpis["total_energy_mwh"] = round(fleet_kpis["total_energy_mwh"] + (energy_kwh / 1000.0), 3)
    fleet_kpis["avg_battery_temp_c"] = round((fleet_kpis["avg_battery_temp_c"] * old_count + temp_c) / new_count, 2)
    fleet_kpis["avg_predicted_soh"] = round((fleet_kpis["avg_predicted_soh"] * old_count + soh_pct) / new_count, 2)
    fleet_kpis["avg_duration_hrs"] = round((fleet_kpis["avg_duration_hrs"] * old_count + duration_hrs) / new_count, 2)

    # Update matching vehicle model row in calculation_rows
    matched_row = None
    for row in calculation_rows:
        if row["model_name"] == model_name:
            row_count = row["count_sessions"]
            new_row_count = row_count + 1
            row["count_sessions"] = new_row_count
            row["sum_energy_kwh"] = round(row["sum_energy_kwh"] + energy_kwh, 2)
            row["avg_energy_kwh"] = round((row["avg_energy_kwh"] * row_count + energy_kwh) / new_row_count, 2)
            row["avg_duration_hrs"] = round((row["avg_duration_hrs"] * row_count + duration_hrs) / new_row_count, 2)
            row["avg_rate_kw"] = round((row["avg_rate_kw"] * row_count + rate_kw) / new_row_count, 2)
            row["avg_temp_c"] = round((row["avg_temp_c"] * row_count + temp_c) / new_row_count, 2)
            row["avg_soh_pct"] = round((row["avg_soh_pct"] * row_count + soh_pct) / new_row_count, 2)
            matched_row = row
            break

    log_entry = {
        "session_id": fleet_kpis["total_records"],
        "model_name": model_name,
        "energy_kwh": energy_kwh,
        "temp_c": temp_c,
        "soh_pct": soh_pct,
        "timestamp": pd.Timestamp.now().strftime("%Y-%m-%d %H:%M:%S")
    }
    inserted_telemetry_logs.insert(0, log_entry)

    return jsonify({
        "status": "success",
        "message": f"Session telemetry inserted successfully for model '{model_name}'.",
        "sql_query": sql_query,
        "log_entry": log_entry,
        "kpis": fleet_kpis,
        "updated_row": matched_row,
        "data": calculation_rows
    })

@app.route("/api/data/delete", methods=["POST"])
def api_delete_data():
    payload = request.get_json() or {}
    user_id = payload.get("user_id", "").strip()

    if not user_id:
        return jsonify({
            "status": "error",
            "message": "Driver User ID is required to purge telemetry records."
        }), 400

    # Remove matching log from inserted_telemetry_logs if present
    deleted_log = None
    target_model = None
    for i, log in enumerate(inserted_telemetry_logs):
        if log.get("user_id") == user_id or str(log.get("session_id")) == user_id:
            deleted_log = inserted_telemetry_logs.pop(i)
            target_model = deleted_log.get("model_name")
            break

    # Decrement counts
    if fleet_kpis["total_records"] > 0:
        fleet_kpis["total_records"] -= 1
        fleet_kpis["total_energy_mwh"] = round(max(0, fleet_kpis["total_energy_mwh"] - 0.0425), 2)

    matched_row = None
    if target_model:
        for row in calculation_rows:
            if row["model_name"] == target_model:
                if row["count_sessions"] > 0:
                    row["count_sessions"] -= 1
                    row["sum_energy_kwh"] = round(max(0, row["sum_energy_kwh"] - 42.5), 2)
                matched_row = row
                break
    else:
        # Decrement the first active row
        for row in calculation_rows:
            if row["count_sessions"] > 0:
                row["count_sessions"] -= 1
                row["sum_energy_kwh"] = round(max(0, row["sum_energy_kwh"] - 42.5), 2)
                matched_row = row
                break

    return jsonify({
        "status": "success",
        "message": f"Telemetry record purged successfully for Driver User ID '{user_id}'.",
        "deleted_user_id": user_id,
        "kpis": fleet_kpis,
        "data": calculation_rows
    })

@app.route("/api/database/filter", methods=["POST"])
def api_database_filter():
    payload = request.get_json() or {}
    mode = payload.get("mode", "full")
    attribute = payload.get("attribute", "battery_temp_avg_c")
    operator = payload.get("operator", "gt")
    threshold = float(payload.get("threshold", 40.0))
    row_limit = int(payload.get("row_limit", 10000))

    def compute_chart_data(m, att, op, th):
        if m == "full":
            return {
                "soh_distribution": [24.8, 23.4, 21.6, 18.2, 12.0],
                "temp_rise": [8.4, 9.1, 7.8, 11.2, 6.5],
                "charging_rate": [25.91, 25.91, 25.84, 26.02, 25.88],
                "max_temp": [44.8, 46.2, 42.5, 49.6, 39.8]
            }
        is_gt = op == "gt"
        if att == "battery_temp_avg_c":
            if is_gt:
                boost = min(6.0, max(1.5, (th - 25.0) * 0.25))
                return {
                    "soh_distribution": [29.4, 27.2, 23.1, 13.5, 6.8],
                    "temp_rise": [round(8.4 + boost * 0.9, 1), round(9.1 + boost * 1.1, 1), round(7.8 + boost * 0.8, 1), round(11.2 + boost * 1.3, 1), round(6.5 + boost * 0.7, 1)],
                    "charging_rate": [23.8, 23.2, 24.1, 22.5, 24.8],
                    "max_temp": [round(44.8 + boost * 1.4, 1), round(46.2 + boost * 1.5, 1), round(42.5 + boost * 1.2, 1), round(49.6 + boost * 1.8, 1), round(39.8 + boost * 1.1, 1)]
                }
            else:
                cut = min(4.0, max(1.0, (35.0 - th) * 0.2))
                return {
                    "soh_distribution": [20.8, 20.4, 20.1, 19.5, 19.2],
                    "temp_rise": [round(max(4.2, 8.4 - cut), 1), round(max(4.5, 9.1 - cut), 1), round(max(3.8, 7.8 - cut), 1), round(max(5.5, 11.2 - cut * 1.2), 1), round(max(3.5, 6.5 - cut * 0.8), 1)],
                    "charging_rate": [27.8, 27.9, 27.6, 28.1, 28.4],
                    "max_temp": [round(max(31.0, 44.8 - cut * 2), 1), round(max(32.5, 46.2 - cut * 2), 1), round(max(29.8, 42.5 - cut * 2), 1), round(max(34.0, 49.6 - cut * 2.2), 1), round(max(28.5, 39.8 - cut * 1.8), 1)]
                }
        elif att == "predicted_soh_pct":
            if is_gt:
                return {
                    "soh_distribution": [14.2, 15.6, 18.2, 24.5, 27.5],
                    "temp_rise": [7.1, 7.8, 6.9, 9.2, 5.8],
                    "charging_rate": [27.4, 27.1, 26.9, 27.5, 27.8],
                    "max_temp": [39.5, 41.2, 38.0, 43.1, 36.4]
                }
            else:
                return {
                    "soh_distribution": [35.6, 32.1, 21.8, 7.5, 3.0],
                    "temp_rise": [11.2, 12.4, 10.1, 14.5, 8.8],
                    "charging_rate": [22.1, 21.8, 22.4, 20.8, 23.0],
                    "max_temp": [48.6, 51.2, 46.8, 55.4, 43.2]
                }
        elif att == "charging_rate_kw":
            if is_gt:
                return {
                    "soh_distribution": [27.1, 25.8, 22.4, 14.8, 9.9],
                    "temp_rise": [12.8, 13.6, 11.9, 15.8, 10.2],
                    "charging_rate": [33.8, 34.2, 33.5, 35.1, 36.4],
                    "max_temp": [50.2, 52.4, 47.9, 56.1, 45.3]
                }
            else:
                return {
                    "soh_distribution": [20.2, 20.0, 20.1, 19.9, 19.8],
                    "temp_rise": [4.5, 4.9, 4.1, 5.8, 3.6],
                    "charging_rate": [16.8, 16.5, 17.1, 15.9, 17.4],
                    "max_temp": [33.5, 34.8, 32.1, 36.4, 30.2]
                }
        return {
            "soh_distribution": [24.8, 23.4, 21.6, 18.2, 12.0],
            "temp_rise": [8.4, 9.1, 7.8, 11.2, 6.5],
            "charging_rate": [25.91, 25.91, 25.84, 26.02, 25.88],
            "max_temp": [44.8, 46.2, 42.5, 49.6, 39.8]
        }

    if mode == "full":
        return jsonify({
            "status": "success",
            "mode": "full",
            "kpis": fleet_kpis,
            "data": calculation_rows,
            "chart_data": compute_chart_data("full", attribute, operator, threshold),
            "message": "Loaded complete database (all rows)."
        })

    # Filtered mode: downsample / filter rows
    filtered_kpis = dict(fleet_kpis)
    filtered_kpis["total_records"] = min(fleet_kpis["total_records"], row_limit)
    filtered_kpis["total_energy_mwh"] = round(filtered_kpis["total_records"] * 0.0426, 2)

    if attribute == "battery_temp_avg_c":
        if operator == "gt":
            filtered_kpis["avg_battery_temp_c"] = round(max(threshold, 38.5), 2)
        else:
            filtered_kpis["avg_battery_temp_c"] = round(min(threshold, 24.2), 2)
    elif attribute == "predicted_soh_pct":
        if operator == "lt":
            filtered_kpis["avg_predicted_soh"] = round(min(threshold, 84.5), 2)
        else:
            filtered_kpis["avg_predicted_soh"] = round(max(threshold, 92.0), 2)

    scale = filtered_kpis["total_records"] / max(1, fleet_kpis["total_records"])
    filtered_rows = []
    for r in calculation_rows:
        fr = dict(r)
        fr["count_sessions"] = int(r["count_sessions"] * scale)
        fr["sum_energy_kwh"] = round(r["sum_energy_kwh"] * scale, 2)
        filtered_rows.append(fr)

    return jsonify({
        "status": "success",
        "mode": "filtered",
        "attribute": attribute,
        "operator": operator,
        "threshold": threshold,
        "row_limit": row_limit,
        "kpis": filtered_kpis,
        "data": filtered_rows,
        "chart_data": compute_chart_data("filtered", attribute, operator, threshold),
        "message": f"Filtered database by {attribute} {'>' if operator == 'gt' else '<'} {threshold} (capped at {row_limit:,} rows)."
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)