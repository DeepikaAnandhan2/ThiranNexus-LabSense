-- ThiranNexus LabSense - Phase 5 Schema
-- Run after phase3_schema.sql. Adds sensor_readings and teacher_alerts.
--
-- NOTE: Experiment-step progress is NOT stored as a separate column.
-- It's computed on the fly from activity_logs (equipment_scan for
-- burette/conical_flask, plus experiment_start / colour_monitoring_start /
-- colour_change_detected / teacher_verification_requested event types).
-- See backend/src/utils/experimentProgress.js for the single source of truth.

CREATE TABLE IF NOT EXISTS sensor_readings (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES lab_sessions(id) ON DELETE SET NULL,
    bench_id INTEGER NOT NULL REFERENCES laboratory_benches(id),
    red_value INTEGER NOT NULL,
    green_value INTEGER NOT NULL,
    blue_value INTEGER NOT NULL,
    threshold_crossed BOOLEAN NOT NULL DEFAULT FALSE,
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_bench ON sensor_readings(bench_id, created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_alerts (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES lab_sessions(id) ON DELETE SET NULL,
    bench_id INTEGER NOT NULL REFERENCES laboratory_benches(id),
    alert_type VARCHAR(50) NOT NULL,     -- 'colour_change' | 'sensor_disconnected'
    message TEXT NOT NULL,
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_teacher_alerts_ack ON teacher_alerts(acknowledged, created_at DESC);
