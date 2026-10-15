import sys
import os
import argparse
import pandas as pd
from sqlalchemy import create_engine, text

def run_etl(csv_path="ev_charging_patterns_thermal_sensors (2).csv",
            db_url="postgresql://postgres:postgres@localhost:5432/ev_telemetry_db",
            create_tables=True):
    print("=" * 60)
    print("EV FLEET TELEMETRY ETL PIPELINE")
    print("=" * 60)
    
    if not os.path.exists(csv_path):
        print(f"[!] CSV file not found at: {csv_path}")
        return False
        
    print(f"[*] Reading dataset from: {csv_path}")
    df = pd.read_csv(csv_path)
    df_clean = df.dropna().copy()
    print(f"[*] Clean records after dropping nulls: {len(df_clean):,}")
    
    print(f"[*] Connecting to database: {db_url.split('@')[-1]}")
    try:
        engine = create_engine(db_url)
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("[✓] Connected to PostgreSQL successfully.")
    except Exception as e:
        print(f"[!] Database connection failed: {e}")
        return False

    if create_tables:
        schema_path = os.path.join(os.path.dirname(__file__), "schema.sql")
        if os.path.exists(schema_path):
            print(f"[*] Executing schema definitions from: {schema_path}")
            with open(schema_path, "r") as f:
                schema_ddl = f.read()
            with engine.begin() as conn:
                for statement in schema_ddl.split(";"):
                    stmt = statement.strip()
                    if stmt:
                        conn.execute(text(stmt))
            print("[✓] Schema and indexes created.")
            
    print("[*] Normalizing data for vehicle_models (Parent table)...")
    models_df = df_clean.groupby('Vehicle Model').agg(
        default_battery_capacity_kwh=('Battery Capacity (kWh)', 'median')
    ).reset_index().rename(columns={'Vehicle Model': 'model_name'})
    
    with engine.begin() as conn:
        for _, row in models_df.iterrows():
            conn.execute(text("""
                INSERT INTO vehicle_models (model_name, default_battery_capacity_kwh)
                VALUES (:name, :cap)
                ON CONFLICT (model_name) DO UPDATE
                SET default_battery_capacity_kwh = EXCLUDED.default_battery_capacity_kwh;
            """), {"name": row['model_name'], "cap": float(row['default_battery_capacity_kwh'])})
            
    with engine.connect() as conn:
        models_map = dict(conn.execute(text("SELECT model_name, model_id FROM vehicle_models")).fetchall())
    print(f"[✓] Synced parent vehicle models: {models_map}")
    
    df_clean['model_id'] = df_clean['Vehicle Model'].map(models_map)
    
    print("[*] Preparing charging_sessions table...")
    sessions_df = pd.DataFrame({
        'model_id': df_clean['model_id'],
        'user_id': df_clean['User ID'],
        'charging_station_id': df_clean['Charging Station ID'],
        'station_location': df_clean['Charging Station Location'],
        'charger_type': df_clean['Charger Type'],
        'user_type': df_clean['User Type'],
        'start_time': pd.to_datetime(df_clean['Charging Start Time']),
        'end_time': pd.to_datetime(df_clean['Charging End Time']),
        'charging_duration_hours': df_clean['Charging Duration (hours)'],
        'energy_consumed_kwh': df_clean['Energy Consumed (kWh)'],
        'charging_rate_kw': df_clean['Charging Rate (kW)'],
        'charging_cost_usd': df_clean['Charging Cost (USD)'],
        'time_of_day': df_clean['Time of Day'],
        'day_of_week': df_clean['Day of Week'],
        'soc_start_pct': df_clean['State of Charge (Start %)'],
        'soc_end_pct': df_clean['State of Charge (End %)'],
        'distance_driven_km': df_clean['Distance Driven (since last charge) (km)'],
        'ambient_temp_c': df_clean['Temperature (°C)'],
        'vehicle_age_years': df_clean['Vehicle Age (years)']
    })
    sessions_df.to_sql('charging_sessions', engine, if_exists='append', index=False, chunksize=10000)
    print(f"[✓] Inserted {len(sessions_df):,} sessions.")
    
    with engine.connect() as conn:
        session_ids = [row[0] for row in conn.execute(text("SELECT session_id FROM charging_sessions ORDER BY session_id ASC")).fetchall()]
        
    print("[*] Preparing thermal_telemetry child table...")
    telemetry_df = pd.DataFrame({
        'session_id': session_ids[:len(df_clean)],
        'model_id': df_clean['model_id'],
        'pack_voltage_v': df_clean['Battery Pack Voltage (V)'],
        'battery_current_a': df_clean['Battery Current (A)'],
        'battery_temp_min_c': df_clean['Battery Temp - Min (°C)'],
        'battery_temp_max_c': df_clean['Battery Temp - Max (°C)'],
        'battery_temp_avg_c': df_clean['Battery Temp - Avg (°C)'],
        'coolant_flow_rate_lpm': df_clean['Coolant Flow Rate (L/min)'],
        'coolant_inlet_temp_c': df_clean['Coolant Inlet Temp (°C)'],
        'coolant_outlet_temp_c': df_clean['Coolant Outlet Temp (°C)']
    })
    telemetry_df.to_sql('thermal_telemetry', engine, if_exists='append', index=False, chunksize=10000)
    print(f"[✓] Inserted {len(telemetry_df):,} thermal telemetry records.")
    
    print("[*] Preparing digital_twin_metrics child table...")
    twin_df = pd.DataFrame({
        'session_id': session_ids[:len(df_clean)],
        'model_id': df_clean['model_id'],
        'sync_status': df_clean['Digital Twin Sync Status'],
        'predicted_max_temp_c': df_clean['Digital Twin Predicted Max Temp (°C)'],
        'predicted_soh_pct': df_clean['Digital Twin Predicted SOH (%)'],
        'sync_latency_ms': df_clean['Digital Twin Sync Latency (ms)']
    })
    twin_df.to_sql('digital_twin_metrics', engine, if_exists='append', index=False, chunksize=10000)
    print(f"[✓] Inserted {len(twin_df):,} digital twin records.")
    
    print("[🎉] ETL Pipeline Completed Successfully!")
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ETL script for EV Fleet Telemetry")
    parser.add_argument("--csv", default="ev_charging_patterns_thermal_sensors (2).csv", help="Path to input CSV")
    parser.add_argument("--db", default="postgresql://postgres:postgres@localhost:5432/ev_telemetry_db", help="PostgreSQL connection string")
    args = parser.parse_args()
    run_etl(csv_path=args.csv, db_url=args.db)