const pool = require("../config/db");

const STEP_TEXT = [
  "Identify the burette.",
  "Identify the conical flask.",
  "Listen to the experiment preparation instructions.",
  "Begin the simulated experiment.",
  "Activate colour monitoring.",
  "Receive a colour-change notification.",
  "Request teacher verification.",
];

/**
 * Derives step-by-step progress for a session from its activity_logs rows,
 * rather than storing a separate "current step" column. This keeps a single
 * source of truth and means progress is always consistent with the log.
 *
 * Step 1: an equipment_scan of the burette exists for this session
 * Step 2: an equipment_scan of the conical_flask exists for this session
 * Step 3: automatic, as soon as steps 1 and 2 are both done
 * Step 4: an 'experiment_start' event exists
 * Step 5: a 'colour_monitoring_start' event exists
 * Step 6: a 'colour_change_detected' event exists
 * Step 7: a 'teacher_verification_requested' event exists
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
    events.some((e) => e.event_type === "equipment_scan" && e.equipment_code === code);
  const hasEvent = (type) => events.some((e) => e.event_type === type);

  const step1 = hasEquipmentScan("burette");
  const step2 = hasEquipmentScan("conical_flask");
  const step3 = step1 && step2;
  const step4 = step3 && hasEvent("experiment_start");
  const step5 = step4 && hasEvent("colour_monitoring_start");
  const step6 = step5 && hasEvent("colour_change_detected");
  const step7 = step6 && hasEvent("teacher_verification_requested");

  const doneFlags = [step1, step2, step3, step4, step5, step6, step7];
  const steps = STEP_TEXT.map((text, i) => ({
    step_number: i + 1,
    text,
    done: doneFlags[i],
  }));

  const firstNotDone = doneFlags.findIndex((done) => !done);
  const currentStep = firstNotDone === -1 ? 8 : firstNotDone + 1; // 8 = all complete

  return { steps, current_step: currentStep, complete: currentStep === 8 };
}

module.exports = { computeProgress, STEP_TEXT };
