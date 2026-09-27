import { useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";

const BENCHES = ["01", "02", "03", "04", "05", "06"];

const EQUIPMENT_BUTTONS = [
  { label: "Scan Burette", tag_uid: "DEV-TAG-BURETTE", key: "burette", icon: "fa-vial" },
  { label: "Scan Conical Flask", tag_uid: "DEV-TAG-CONICAL-FLASK", key: "conical_flask", icon: "fa-flask" },
  { label: "Scan Pipette", tag_uid: "DEV-TAG-PIPETTE", key: "pipette", icon: "fa-eye-dropper" },
  { label: "Scan Beaker", tag_uid: "DEV-TAG-BEAKER", key: "beaker", icon: "fa-glass-water" },
];

const DEVICE_API_KEY = import.meta.env.VITE_DEVICE_API_KEY || "dev-local-testing-key-change-me";
const HEADERS = { "x-device-api-key": DEVICE_API_KEY };

// Target colour matches backend configuration (pink titration endpoint: 255, 105, 180)
const COLOUR_CHANGE_READING = { red: 255, green: 105, blue: 180 };
// Non-matching reading (clear solution before endpoint)
const NORMAL_READING = { red: 240, green: 240, blue: 245 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default function SimulationPage() {
  const [bench, setBench] = useState("01");
  const [log, setLog] = useState([]);
  const [chain, setChain] = useState({
    burette: false,
    conical_flask: false,
    experiment: false,
    monitoring: false,
  });
  const [running, setRunning] = useState(false);

  const resetChain = () => {
    setChain({ burette: false, conical_flask: false, experiment: false, monitoring: false });
    addLog(true, `Reset local simulation state for Bench ${bench}`);
  };

  const addLog = (ok, text) => {
    setLog((prev) => [
      { ok, text, time: new Date().toLocaleTimeString() },
      ...prev,
    ].slice(0, 30));
  };

  const post = async (path, body, successText, failLabel) => {
    try {
      const res = await api.post(
        path,
        { ...body, bench_number: bench, source: "simulation" },
        { headers: HEADERS }
      );
      addLog(true, successText(res.data));
      if (res.data.prerequisites_missing?.length) {
        addLog(
          false,
          `↳ Prerequisite Gated: Not in monitoring stage yet. Missing → ${res.data.prerequisites_missing.join(" · ")}`
        );
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
      (d) =>
        d.duplicate
          ? `${label} → Duplicate scan ignored (same tag at Bench ${bench})`
          : `${label} → Identified "${d.equipment.name}" at Bench ${bench} (log #${d.activity_log_id})`,
      label
    );
    if (data && !data.duplicate && key) {
      setChain((prev) => ({ ...prev, [key]: true }));
    }
  };

  const startExperiment = async () => {
    const data = await post(
      "/devices/experiment-start",
      {},
      (d) =>
        d.duplicate
          ? "Start Titration → Duplicate ignored"
          : `Start Titration → Logged for Bench ${bench}`,
      "Start Titration"
    );
    if (data && !data.duplicate) setChain((prev) => ({ ...prev, experiment: true }));
  };

  const startColourMonitoring = async () => {
    const data = await post(
      "/devices/colour-monitoring-start",
      {},
      (d) =>
        d.duplicate
          ? "Enable Colour Monitoring → Duplicate ignored"
          : `Enable Colour Monitoring → Logged for Bench ${bench}`,
      "Enable Colour Monitoring"
    );
    if (data && !data.duplicate) setChain((prev) => ({ ...prev, monitoring: true }));
  };

  const simulateColourChange = () =>
    post(
      "/devices/colour-reading",
      COLOUR_CHANGE_READING,
      (data) =>
        data.threshold_crossed
          ? `Simulate Colour Change → Threshold crossed${
              data.alert_created
                ? " (Stage 6 done, teacher alert generated + student audio instruction triggered)"
                : data.prerequisites_missing?.length
                ? " (IGNORED: colour monitoring stage not reached yet)"
                : " (Already logged for this session — duplicate suppressed)"
            }`
          : "Simulate Colour Change → Logged, threshold not crossed",
      "Simulate Colour Change"
    );

  const simulateNormalReading = () =>
    post(
      "/devices/colour-reading",
      NORMAL_READING,
      () => `Simulate Normal Reading → R:240 G:240 B:245 logged (no threshold crossed)`,
      "Simulate Normal Reading"
    );

  const simulateDisconnect = () =>
    post(
      "/devices/sensor-disconnect",
      {},
      () => `Simulate Sensor Disconnect → Alert raised for Bench ${bench}`,
      "Simulate Sensor Disconnect"
    );

  const runFullSequence = async () => {
    setRunning(true);
    addLog(true, `▶ Starting full automated titration sequence for Bench ${bench}...`);

    addLog(true, "1. Scanning Burette (Stage 1 & 2)...");
    await scan("DEV-TAG-BURETTE", "Scan Burette", "burette");
    await sleep(600);

    addLog(true, "2. Scanning Conical Flask (Stage 3 Preparation)...");
    await scan("DEV-TAG-CONICAL-FLASK", "Scan Conical Flask", "conical_flask");
    await sleep(600);

    addLog(true, "3. Starting Titration (Stage 4)...");
    await startExperiment();
    await sleep(600);

    addLog(true, "4. Activating Colour Monitoring (Stage 5)...");
    await startColourMonitoring();
    await sleep(600);

    addLog(true, "5. Simulating Colour Change Detection (Stage 6 & 7)...");
    await simulateColourChange();

    addLog(true, "✅ Automated sequence complete. Verify student audio and teacher alert.");
    setRunning(false);
  };

  const experimentReady = chain.burette && chain.conical_flask;
  const monitoringReady = experimentReady && chain.experiment;
  const colourReady = monitoringReady && chain.monitoring;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Simulation Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-800 text-white flex items-center justify-center font-bold text-xl shadow-md">
              <i className="fa-solid fa-gamepad" aria-hidden="true"></i>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold text-slate-900 tracking-tight">
                Developer & Testing Hardware Simulator
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Simulates real ESP32, RC522 RFID reader, and TCS3200 colour sensor API events
              </p>
            </div>
          </div>

          <Link
            to="/"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors focus-visible:outline-orange-500"
          >
            <i className="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
            Home
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        <div className="grid lg:grid-cols-2 gap-8 items-start">
          {/* Controls Panel */}
          <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <label htmlFor="sim-bench-select" className="block text-sm font-extrabold text-slate-800">
                  Target Laboratory Bench:
                </label>
                <button
                  onClick={resetChain}
                  className="text-xs text-purple-700 hover:text-purple-900 font-bold underline"
                >
                  Reset Sequence Gates
                </button>
              </div>
              <select
                id="sim-bench-select"
                value={bench}
                onChange={(e) => {
                  setBench(e.target.value);
                  resetChain();
                }}
                className="w-full bg-white border-2 border-slate-300 rounded-xl p-3 text-sm text-slate-900 font-bold focus:border-purple-600 focus-visible:outline-orange-500"
              >
                {BENCHES.map((b) => (
                  <option key={b} value={b}>
                    Laboratory Bench {b}
                  </option>
                ))}
              </select>
            </div>

            {/* Recommended Full Sequence Runner */}
            <div className="bg-purple-50 border-2 border-purple-200 rounded-xl p-4">
              <button
                onClick={runFullSequence}
                disabled={running}
                className="w-full bg-purple-700 hover:bg-purple-800 active:bg-purple-900 disabled:opacity-50 text-white font-extrabold py-3.5 px-4 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-orange-500 flex items-center justify-center gap-2 text-sm"
              >
                <i className={`fa-solid ${running ? "fa-spinner fa-spin" : "fa-forward-step"}`} aria-hidden="true"></i>
                {running ? "Executing Sequence..." : "▶ Run Recommended Sequence (Full Titration)"}
              </button>
              <p className="text-xs text-purple-900 font-medium mt-2.5 leading-relaxed">
                Automatically scans Burette & Conical Flask, starts titration, enables colour monitoring, and detects colour change. Use this for quick end-to-end demonstrations.
              </p>
            </div>

            {/* Event Category 1: Equipment Identification */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fa-solid fa-tags text-purple-600" aria-hidden="true"></i>
                  1. RFID Apparatus Scanning
                </h3>
                <span className="text-[11px] text-slate-400">RC522 Tag Simulation</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {EQUIPMENT_BUTTONS.map((btn) => (
                  <button
                    key={btn.tag_uid}
                    onClick={() => scan(btn.tag_uid, btn.label, btn.key)}
                    className="bg-slate-100 hover:bg-purple-50 hover:text-purple-900 hover:border-purple-300 border border-slate-200 text-slate-800 font-bold text-xs py-3 px-3 rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 focus-visible:outline-orange-500"
                  >
                    <i className={`fa-solid ${btn.icon} text-purple-600`} aria-hidden="true"></i>
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Event Category 2: Experiment Flow */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fa-solid fa-play text-emerald-600" aria-hidden="true"></i>
                  2. Experiment Stage Initiation
                </h3>
                {!experimentReady && (
                  <span className="text-[11px] text-amber-600 font-semibold">
                    Requires Burette & Flask
                  </span>
                )}
              </div>
              <button
                onClick={startExperiment}
                disabled={!experimentReady}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-xs py-3 px-4 rounded-xl shadow-sm transition-colors focus-visible:outline-orange-500 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-flask-vial" aria-hidden="true"></i>
                Start Titration Experiment (Stage 4)
              </button>
            </div>

            {/* Event Category 3: Colour Sensor Events */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <i className="fa-solid fa-palette text-orange-500" aria-hidden="true"></i>
                  3. TCS3200 Colour Sensor Telemetry
                </h3>
                {!colourReady && (
                  <span className="text-[11px] text-amber-600 font-semibold">
                    {!monitoringReady ? "Start experiment first" : "Enable monitoring first"}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  onClick={startColourMonitoring}
                  disabled={!monitoringReady}
                  className="bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs py-3 px-3 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-orange-500"
                >
                  <i className="fa-solid fa-eye" aria-hidden="true"></i>
                  Enable Monitoring (Stage 5)
                </button>

                <button
                  onClick={simulateColourChange}
                  disabled={!colourReady}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-xs py-3 px-3 rounded-xl shadow-sm transition-colors flex items-center justify-center gap-2 focus-visible:outline-orange-500"
                >
                  <i className="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
                  Simulate Colour Change
                </button>

                <button
                  onClick={simulateNormalReading}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs py-2.5 px-3 rounded-xl border border-slate-200 transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-orange-500"
                >
                  <i className="fa-solid fa-wave-square text-slate-500" aria-hidden="true"></i>
                  Simulate Normal Reading
                </button>

                <button
                  onClick={simulateDisconnect}
                  className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 font-bold text-xs py-2.5 px-3 rounded-xl transition-colors flex items-center justify-center gap-1.5 focus-visible:outline-orange-500"
                >
                  <i className="fa-solid fa-plug-circle-xmark text-red-600" aria-hidden="true"></i>
                  Sensor Disconnect Alert
                </button>
              </div>
            </div>
          </section>

          {/* Simulation Output Log */}
          <section className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-terminal text-slate-600" aria-hidden="true"></i>
                Simulation Event Log
              </h2>
              <button
                onClick={() => setLog([])}
                className="text-xs text-slate-400 hover:text-slate-600 font-semibold"
              >
                Clear Log
              </button>
            </div>

            {log.length === 0 ? (
              <div className="py-12 text-center text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                <i className="fa-solid fa-list-ul text-2xl mb-2" aria-hidden="true"></i>
                <p className="text-xs font-semibold">No simulation events dispatched yet.</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Click any button to send requests matching the ESP32 hardware protocol.
                </p>
              </div>
            ) : (
              <ul className="space-y-2 text-xs font-mono max-h-[540px] overflow-y-auto pr-1">
                {log.map((entry, idx) => (
                  <li
                    key={idx}
                    className={`p-2.5 rounded-lg border leading-relaxed ${
                      entry.ok
                        ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                        : "bg-red-50/70 border-red-200 text-red-950"
                    }`}
                  >
                    <span className="text-slate-400 font-semibold">[{entry.time}]</span>{" "}
                    <span>{entry.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
