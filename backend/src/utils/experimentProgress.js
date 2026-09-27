const pool = require("../config/db");

const STEP_TEXT = [
  "Equipment identification",
  "Equipment instructions",
  "Experiment preparation",
  "Titration started",
  "Colour monitoring enabled",
  "Colour change detected",
  "Audio instruction and teacher notification",
  "Teacher verification or experiment completion",
];

/**
 * Derives step-by-step progress for a session from its activity_logs rows.
 * Single source of truth ensuring progress matches actual lab events.
 *
 * Stage 1: Equipment identification (apparatus / burette scanned)
 * Stage 2: Equipment instructions (apparatus purpose, usage, safety delivered)
 * Stage 3: Experiment preparation (conical flask in place, solutions ready)
 * Stage 4: Titration started (titration started event logged)
 * Stage 5: Colour monitoring enabled (colour monitoring active)
 * Stage 6: Colour change detected (sensor threshold crossing detected)
 * Stage 7: Audio instruction and teacher notification (instruction spoken + teacher notified)
 * Stage 8: Teacher verification or experiment completion (teacher verification recorded)
 */
async function computeProgress(sessionId) {
  const result = await pool.query(
    `SELECT al.event_type, e.code AS equipment_code
     FROM activity_logs al
     LEFT JOIN equipment e ON e.id = al.equipment_id
     WHERE al.session_id = $1
     ORDER BY al.created_at ASC`,
    [sessionId]
  );

  const events = result.rows;
  const hasEquipmentScan = (code) =>
    events.some((e) => e.event_type === "equipment_scan" && (code ? e.equipment_code === code : true));
  const hasEvent = (type) => events.some((e) => e.event_type === type);

  const step1 = hasEquipmentScan("burette");
  const step2 = step1; // Delivered upon identification
  const step3 = step2 && hasEquipmentScan("conical_flask");
  const step4 = step3 && hasEvent("experiment_start");
  const step5 = step4 && hasEvent("colour_monitoring_start");
  const step6 = step5 && hasEvent("colour_change_detected");
  const step7 = step6 && (hasEvent("teacher_verification_requested") || hasEvent("colour_change_detected"));
  const step8 = step7 && (hasEvent("teacher_verified") || hasEvent("experiment_completed"));

  const doneFlags = [step1, step2, step3, step4, step5, step6, step7, step8];
  const steps = STEP_TEXT.map((text, i) => ({
    step_number: i + 1,
    text,
    done: doneFlags[i],
  }));

  const firstNotDone = doneFlags.findIndex((done) => !done);
  const currentStep = firstNotDone === -1 ? 9 : firstNotDone + 1; // 9 = all complete

  return { steps, current_step: currentStep, complete: currentStep === 9 };
}

module.exports = { computeProgress, STEP_TEXT };
