-- ThiranNexus LabSense - Phase 3 Schema
-- Run this against labsense_db AFTER phase1_init.sql.
-- Adds: laboratory_benches, equipment, rfid_tags, lab_sessions, activity_logs

-- ---------- Laboratory benches ----------
CREATE TABLE IF NOT EXISTS laboratory_benches (
    id SERIAL PRIMARY KEY,
    bench_number VARCHAR(10) UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO laboratory_benches (bench_number)
VALUES ('01'), ('02'), ('03'), ('04'), ('05'), ('06')
ON CONFLICT (bench_number) DO NOTHING;

-- ---------- Equipment ----------
CREATE TABLE IF NOT EXISTS equipment (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,       -- e.g. 'burette'
    name VARCHAR(100) NOT NULL,             -- e.g. 'Burette'
    description TEXT NOT NULL,              -- spoken explanation
    usage_instructions TEXT,
    safety_instructions TEXT
);

INSERT INTO equipment (code, name, description, usage_instructions, safety_instructions) VALUES
('burette', 'Burette',
 'This is a burette. It is used to accurately measure and dispense liquids during titration.',
 'Hold the burette vertically in its stand. Open the stopcock slowly to release liquid drop by drop while swirling the receiving flask.',
 'Keep fingers away from the stopcock tip. Do not tilt or shake the burette while it is filled.'),
('pipette', 'Pipette',
 'This is a pipette. It is used to transfer a precise, measured volume of liquid from one container to another.',
 'Use the pipette bulb or pump to draw liquid up to the calibration mark, then release it steadily into the target container.',
 'Never draw liquid into a pipette by mouth. Hold it upright when full.'),
('beaker', 'Beaker',
 'This is a beaker. It is used to hold, mix, or heat liquids during an experiment.',
 'Place the beaker on a flat, stable surface. Pour liquids in slowly along the inner wall to avoid splashing.',
 'Do not overfill. Use tongs or a heat-resistant holder if the beaker has been heated.'),
('conical_flask', 'Conical Flask',
 'This is a conical flask. It is used to mix, swirl, and hold liquids, and is commonly the receiving vessel in a titration.',
 'Place the conical flask under the burette. Swirl it gently in a circular motion while liquid is added.',
 'Keep the flask on a flat surface when not swirling. Do not swirl so hard that liquid splashes out.')
ON CONFLICT (code) DO NOTHING;

-- ---------- RFID tag mappings ----------
-- tag_uid values below are placeholders for development/simulation.
-- Your teammate should replace/add the REAL RFID UIDs their RC522 reader
-- reports for each physical tag (see HARDWARE_INTEGRATION.md, Phase 8).
CREATE TABLE IF NOT EXISTS rfid_tags (
    id SERIAL PRIMARY KEY,
    tag_uid VARCHAR(100) UNIQUE NOT NULL,
    equipment_id INTEGER NOT NULL REFERENCES equipment(id) ON DELETE CASCADE
);

INSERT INTO rfid_tags (tag_uid, equipment_id)
SELECT 'DEV-TAG-BURETTE', id FROM equipment WHERE code = 'burette'
ON CONFLICT (tag_uid) DO NOTHING;

INSERT INTO rfid_tags (tag_uid, equipment_id)
SELECT 'DEV-TAG-PIPETTE', id FROM equipment WHERE code = 'pipette'
ON CONFLICT (tag_uid) DO NOTHING;

INSERT INTO rfid_tags (tag_uid, equipment_id)
SELECT 'DEV-TAG-BEAKER', id FROM equipment WHERE code = 'beaker'
ON CONFLICT (tag_uid) DO NOTHING;

INSERT INTO rfid_tags (tag_uid, equipment_id)
SELECT 'DEV-TAG-CONICAL-FLASK', id FROM equipment WHERE code = 'conical_flask'
ON CONFLICT (tag_uid) DO NOTHING;

-- ---------- Laboratory sessions ----------
CREATE TABLE IF NOT EXISTS lab_sessions (
    id SERIAL PRIMARY KEY,
    student_name VARCHAR(150) NOT NULL,
    bench_id INTEGER NOT NULL REFERENCES laboratory_benches(id),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ
);

-- ---------- Activity logs ----------
-- One row per meaningful event: equipment scan, experiment step, etc.
-- (colour-sensor events get their own table in Phase 5).
CREATE TABLE IF NOT EXISTS activity_logs (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES lab_sessions(id) ON DELETE SET NULL,
    bench_id INTEGER NOT NULL REFERENCES laboratory_benches(id),
    event_type VARCHAR(50) NOT NULL,          -- 'equipment_scan', etc.
    equipment_id INTEGER REFERENCES equipment(id),
    is_simulated BOOLEAN NOT NULL DEFAULT FALSE,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_bench ON activity_logs(bench_id, created_at DESC);
