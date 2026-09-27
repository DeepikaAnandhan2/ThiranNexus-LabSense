-- ThiranNexus LabSense - Phase 1 Database Initialization
-- Run this once against a fresh PostgreSQL database (labsense_db).
-- Full schema (users, students, teachers, benches, equipment, rfid_tags,
-- experiments, experiment_steps, sessions, activity_logs, sensor_readings,
-- teacher_alerts, camera_configs) is introduced in Phase 3 and Phase 10.

-- Sanity-check table to confirm the app can read/write to this database.
CREATE TABLE IF NOT EXISTS system_status (
    id SERIAL PRIMARY KEY,
    component VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL,
    checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_status (component, status)
VALUES ('phase1_setup', 'ok');
