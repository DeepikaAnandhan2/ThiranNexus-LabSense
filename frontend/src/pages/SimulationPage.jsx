import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";

const BENCHES = ["01", "02", "03", "04", "05", "06"];

const EQUIPMENT_BUTTONS = [
  { label: "Scan Burette", tag_uid: "DEV-TAG-BURETTE", key: "burette" },
  { label: "Scan Pipette", tag_uid: "DEV-TAG-PIPETTE", key: "pipette" },
  { label: "Scan Beaker", tag_uid: "DEV-TAG-BEAKER", key: "beaker" },
  { label: "Scan Conical Flask", tag_uid: "DEV-TAG-CONICAL-FLASK", key: "conical_flask" },
];

const DEVICE_API_KEY = import.meta.env.VITE_DEVICE_API_KEY;
const HEADERS = { "x-device-api-key": DEVICE_API_KEY };

// Matches the backend's default COLOUR_TARGET exactly, so this button
// reliably triggers the "colour change" alert.
const COLOUR_CHANGE_READING = { red: 255, green: 105, blue: 180 };
// Far from the target - just logs data, no alert.
const NORMAL_READING = { red: 240, green: 240, blue: 245 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The backend only marks "colour change detected" (step 6) done - and
 * therefore only plays the student's audio cue - once steps 1-5 have
 * actually happened for the session: burette scanned, conical flask
 * scanned, experiment started, colour monitoring started. Firing
 * "Simulate Colour Change" on its own skips that chain, so this page
 * tracks the same chain locally and disables buttons out of order instead
 * of letting a click silently do nothing useful.
 */
export default function SimulationPage() {
  const [bench, setBench] = useState("01");
  const [log, setLog] = useState([]);
  const [chain, setChain] = useState({ burette: false, conical_flask: false, experiment: false, monitoring: false });
  const [running, setRunning] = useState(false);

  const resetChain = () => setChain({ burette: false, conical_flask: false, experiment: false, monitoring: false });

  const addLog = (ok, text) => {
    setLog((prev) => [{ ok, text, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 25));
  };

  const post = async (path, body, successText, failLabel) => {
    try {
      const res = await api.post(path, { ...body, bench_number: bench, source: "simulation" }, { headers: HEADERS });
      addLog(true, successText(res.data));
      if (res.data.prerequisites_missing?.length) {
        addLog(false, `↳ Blocked: still missing → ${res.data.prerequisites_missing.join(" · ")}`);
      }
      return res.data;
    } catch (err) {
      addLog(false, `${failLabel} → FAILED: ${err.response?.data?.message || err.message}`);
      return null;
    }
  };

  const scan = async (tag_uid, label, key) => {
    const data = await post(
      "/devices/rfid-scan",
      { tag_uid },
      (d) => d.duplicate
        ? `${label} → duplicate ignored (Bench ${bench})`
        : `${label} → logged as "${d.equipment.name}" (Bench ${bench}, log #${d.activity_log_id})`,
      label
    );
    if (data && !data.duplicate && key) setChain((prev) => ({ ...prev, [key]: true }));
  };

  const startExperiment = async () => {
    const data = await post("/devices/experiment-start", {},
      (d) => d.duplicate ? "Start Experiment → duplicate ignored" : `Start Experiment → logged (Bench ${bench})`,
      "Start Experiment");
    if (data && !data.duplicate) setChain((prev) => ({ ...prev, experiment: true }));
  };

  const startColourMonitoring = async () => {
    const data = await post("/devices/colour-monitoring-start", {},
      (d) => d.duplicate ? "Start Colour Monitoring → duplicate ignored" : `Start Colour Monitoring → logged (Bench ${bench})`,
      "Start Colour Monitoring");
    if (data && !data.duplicate) setChain((prev) => ({ ...prev, monitoring: true }));
  };

  const simulateColourChange = () =>
    post("/devices/colour-reading", COLOUR_CHANGE_READING,
      (data) => data.threshold_crossed
        ? `Simulate Colour Change → threshold crossed${data.alert_created ? ", teacher alert raised + student audio should play" : " (alert already raised for this session)"}`
        : "Simulate Colour Change → reading logged, threshold NOT crossed",
      "Simulate Colour Change");

  const simulateNormalReading = () =>
    post("/devices/colour-reading", NORMAL_READING,
      () => "Simulate Normal Reading → logged, no threshold crossed",
      "Simulate Normal Reading");

  const simulateDisconnect = () =>
    post("/devices/sensor-disconnect", {},
      () => `Simulate Sensor Disconnection → teacher alert raised (Bench ${bench})`,
      "Simulate Sensor Disconnection");

  const runFullSequence = async () => {
    setRunning(true);
    addLog(true, `▶ Running full sequence on Bench ${bench}…`);
    await scan("DEV-TAG-BURETTE", "Scan Burette", "burette");
    await sleep(400);
    await scan("DEV-TAG-CONICAL-FLASK", "Scan Conical Flask", "conical_flask");
    await sleep(400);
    await startExperiment();
    await sleep(400);
    await startColourMonitoring();
    await sleep(400);
    await simulateColourChange();
    setRunning(false);
  };

  const scanReady = true;
  const experimentReady = chain.burette && chain.conical_flask;
  const monitoringReady = experimentReady && chain.experiment;
  const colourReady = monitoringReady && chain.monitoring;

  return (
    <main className="min-h-screen bg-white text-lab-ink p-6 md:p-10">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-lab-primary">🛠 Developer Simulation Mode</h1>
          <p className="text-gray-500 text-sm">
            Sends the exact same API requests the real ESP32 will send.
            Every event here logs as <code>is_simulated = true</code>.
          </p>
        </div>
        <Link to="/" className="text-sm text-lab-primary underline">← Back to Home</Link>
      </header>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-xl p-6">
          <label htmlFor="bench-select" className="block mb-2 text-gray-700 text-sm font-semibold">
            Target bench
          </label>
          <select
            id="bench-select"
            value={bench}
            onChange={(e) => { setBench(e.target.value); resetChain(); }}
            className="w-full bg-white border-2 border-gray-300 rounded-lg p-3 mb-4"
          >
            {BENCHES.map((b) => (<option key={b} value={b}>Bench {b}</option>))}
          </select>

          <button
            onClick={runFullSequence}
            disabled={running}
            className="w-full mb-6 bg-lab-primary hover:bg-lab-primaryDark disabled:opacity-50 text-white font-bold px-4 py-4 rounded-lg"
          >
            {running ? "Running…" : "▶ Run Recommended Sequence (scan → experiment → monitoring → colour change)"}
          </button>
          <p className="text-xs text-gray-500 -mt-4 mb-6">
            The buttons below are gated to match the same order the backend requires before it will
            mark "colour change detected" done and play the student's audio cue - a colour reading
            sent before scanning + starting the experiment is stored but won't raise an alert or
            complete step 6. Use this button for a guaranteed one-click demo, or click through
            manually to test the buttons themselves.
          </p>

          <h2 className="text-sm font-bold text-lab-secondary mb-3">Equipment (RFID)</h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {EQUIPMENT_BUTTONS.map((btn) => (
              <button
                key={btn.tag_uid}
                onClick={() => scan(btn.tag_uid, btn.label, btn.key)}
                disabled={!scanReady}
                className="bg-lab-secondary hover:bg-lab-secondaryDark disabled:opacity-40 text-white font-semibold px-4 py-4 rounded-lg"
              >
                {btn.label}
              </button>
            ))}
          </div>

          <h2 className="text-sm font-bold text-lab-primary mb-3">Experiment</h2>
          <div className="grid grid-cols-1 gap-3 mb-1">
            <button
              onClick={startExperiment}
              disabled={!experimentReady}
              className="bg-lab-primary hover:bg-lab-primaryDark disabled:opacity-40 text-white font-semibold px-4 py-4 rounded-lg"
            >
              Start Experiment
            </button>
          </div>
          {!experimentReady && (
            <p className="text-xs text-gray-500 mb-5">Scan the burette and conical flask first.</p>
          )}
          {experimentReady && <div className="mb-5" />}

          <h2 className="text-sm font-bold text-lab-accent mb-3">Colour Sensor</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={startColourMonitoring}
              disabled={!monitoringReady}
              className="bg-lab-accent hover:bg-lab-accentDark disabled:opacity-40 text-white font-semibold px-4 py-4 rounded-lg"
            >
              Start Colour Monitoring
            </button>
            <button
              onClick={simulateColourChange}
              disabled={!colourReady}
              className="bg-lab-accent hover:bg-lab-accentDark disabled:opacity-40 text-white font-semibold px-4 py-4 rounded-lg"
            >
              Simulate Colour Change
            </button>
            <button onClick={simulateNormalReading} className="bg-gray-200 hover:bg-gray-300 text-lab-ink font-semibold px-4 py-4 rounded-lg">
              Simulate Normal Reading
            </button>
            <button onClick={simulateDisconnect} className="bg-lab-alert hover:bg-red-700 text-white font-semibold px-4 py-4 rounded-lg">
              Simulate Sensor Disconnection
            </button>
          </div>
          {!monitoringReady && (
            <p className="text-xs text-gray-500 mt-2">Start the experiment before colour monitoring.</p>
          )}
          {monitoringReady && !colourReady && (
            <p className="text-xs text-gray-500 mt-2">Start colour monitoring before simulating a colour change.</p>
          )}
        </section>

        <section className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-xl p-6">
          <h2 className="text-sm font-bold text-gray-600 mb-3">Event log</h2>
          {log.length === 0 && (
            <p className="text-gray-500 text-sm">
              Click a button, then open the Student Dashboard for Bench {bench} in another tab to see it update live.
            </p>
          )}
          <ul className="space-y-2 text-sm font-mono">
            {log.map((entry, i) => (
              <li key={i} className={entry.ok ? "text-lab-secondary" : "text-lab-alert"}>
                [{entry.time}] {entry.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
