import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import socket from "../services/socket";

const ACTIVITY_TEXT = {
  equipment_scan: (p) => `${p.equipment_name || "Equipment"} scanned`,
  experiment_start: () => "Experiment started",
  colour_monitoring_start: () => "Colour monitoring started",
  colour_change_detected: () => "Colour change detected",
  teacher_verification_requested: () => "Teacher verification requested",
};

function activityLabel(payload) {
  const build = ACTIVITY_TEXT[payload.type];
  const text = build ? build(payload) : payload.type;
  return `${text}${payload.is_simulated ? " (simulated)" : ""}`;
}

function statusFor(session) {
  if (!session.progress) return "Session started — waiting for first event…";
  if (session.progress.complete) return "Experiment complete ✅";
  const nextStep = session.progress.steps?.find((s) => !s.done);
  return nextStep ? `Current: ${nextStep.text}` : "…";
}

function sensorLabel(latest) {
  if (!latest) return "No sensor data yet";
  const crossed = latest.threshold_crossed ? " ⚠ threshold crossed" : "";
  return `R ${latest.red} G ${latest.green} B ${latest.blue}${crossed}`;
}

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState({}); // keyed by session id
  const [selectedId, setSelectedId] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState("");
  const [timeline, setTimeline] = useState([]);
  const [connected, setConnected] = useState(socket.connected);
  const [loadError, setLoadError] = useState("");

  const pushTimeline = useCallback((text) => {
    setTimeline((prev) => [{ time: new Date().toLocaleTimeString(), text }, ...prev].slice(0, 15));
  }, []);

  // Initial load: active sessions (with current equipment/progress/sensor
  // already computed server-side) and any outstanding alerts. Everything
  // after this point arrives live via Socket.IO - no polling.
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/sessions/active");
        const map = {};
        res.data.sessions.forEach((s) => { map[s.id] = { ...s, recent_activity: [] }; });
        setSessions(map);
        setLoadError("");
      } catch {
        setLoadError("Could not load active sessions. Is the backend running?");
      }
      try {
        const res = await api.get("/alerts");
        setAlerts(res.data.alerts);
        setAlertsError("");
      } catch {
        setAlertsError("Could not reach backend for alerts.");
      }
    })();
  }, []);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    const onSessionStarted = ({ session, bench_number }) => {
      setSessions((prev) => ({
        ...prev,
        [session.id]: {
          id: session.id,
          student_name: session.student_name,
          bench_number,
          started_at: session.started_at,
          current_equipment: null,
          progress: null,
          latest_sensor: null,
          recent_activity: [],
        },
      }));
      pushTimeline(`Bench ${bench_number}: ${session.student_name} started a session`);
    };

    const onSessionEnded = ({ session_id, bench_number }) => {
      setSessions((prev) => {
        const next = { ...prev };
        delete next[session_id];
        return next;
      });
      setSelectedId((prev) => (prev === session_id ? null : prev));
      pushTimeline(`Bench ${bench_number}: session ended`);
    };

    const onActivity = (payload) => {
      pushTimeline(`Bench ${payload.bench_number}: ${activityLabel(payload)}`);
      if (!payload.session_id) return;
      setSessions((prev) => {
        const existing = prev[payload.session_id];
        if (!existing) return prev;
        const updated = { ...existing };
        if (payload.type === "equipment_scan") updated.current_equipment = payload.equipment_name;
        updated.recent_activity = [activityLabel(payload), ...existing.recent_activity].slice(0, 5);
        return { ...prev, [payload.session_id]: updated };
      });
    };

    const onProgress = ({ session_id, progress }) => {
      setSessions((prev) => (prev[session_id] ? { ...prev, [session_id]: { ...prev[session_id], progress } } : prev));
    };

    const onSensorReading = (payload) => {
      if (!payload.session_id) return;
      setSessions((prev) =>
        prev[payload.session_id]
          ? { ...prev, [payload.session_id]: { ...prev[payload.session_id], latest_sensor: payload } }
          : prev
      );
    };

    const onAlert = (alert) => {
      setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev]));
    };

    const onAlertAcknowledged = ({ id }) => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("lab:session_started", onSessionStarted);
    socket.on("lab:session_ended", onSessionEnded);
    socket.on("lab:activity", onActivity);
    socket.on("lab:progress", onProgress);
    socket.on("lab:sensor_reading", onSensorReading);
    socket.on("lab:alert", onAlert);
    socket.on("lab:alert_acknowledged", onAlertAcknowledged);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("lab:session_started", onSessionStarted);
      socket.off("lab:session_ended", onSessionEnded);
      socket.off("lab:activity", onActivity);
      socket.off("lab:progress", onProgress);
      socket.off("lab:sensor_reading", onSensorReading);
      socket.off("lab:alert", onAlert);
      socket.off("lab:alert_acknowledged", onAlertAcknowledged);
    };
  }, [pushTimeline]);

  const acknowledge = async (id) => {
    try {
      await api.post(`/alerts/${id}/acknowledge`);
      // No local removal here - the "lab:alert_acknowledged" socket event
      // (which the same request triggers server-side) does that, so every
      // connected teacher's view stays in sync, not just this tab's.
    } catch {
      setAlertsError("Could not acknowledge alert. Try again.");
    }
  };

  const studentCards = Object.values(sessions).sort(
    (a, b) => new Date(b.started_at) - new Date(a.started_at)
  );
  const selectedStudent = selectedId ? sessions[selectedId] : null;

  return (
    <main className="min-h-screen bg-white text-lab-ink p-6 md:p-10">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-lab-primary">Teacher Dashboard</h1>
          <p className="text-gray-500 text-sm">ThiranNexus LabSense · Live lab monitoring</p>
        </div>
        <div className="flex items-center gap-4">
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${connected ? "bg-green-100 text-green-700" : "bg-red-100 text-lab-alert"}`}>
            {connected ? "🟢 Live" : "🔴 Reconnecting…"}
          </span>
          <Link to="/" className="text-sm text-lab-primary underline">← Back to Home</Link>
        </div>
      </header>

      {loadError && <p role="alert" className="text-sm text-lab-alert mb-4">{loadError}</p>}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Student cards - live */}
        <section className="lg:col-span-2 grid sm:grid-cols-2 gap-4 content-start">
          {studentCards.length === 0 && (
            <p className="text-sm text-gray-500 sm:col-span-2">
              No active lab sessions right now. Cards appear here the moment a student starts a session.
            </p>
          )}
          {studentCards.map((s) => (
            <button
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              className={`text-left bg-lab-surfaceAlt rounded-xl shadow-sm border-2 p-5 hover:shadow-md transition-shadow focus-visible:outline-4 ${
                selectedId === s.id ? "border-lab-primary ring-2 ring-lab-primary" : "border-gray-200"
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-bold text-lg">{s.student_name}</p>
                  <p className="text-xs text-gray-500">Session #{s.id}</p>
                </div>
                <span className="text-xs font-semibold bg-purple-100 text-lab-primary rounded-full px-3 py-1">
                  Bench {s.bench_number}
                </span>
              </div>
              <dl className="text-sm space-y-1 text-gray-700">
                <Row label="Equipment" value={s.current_equipment || "No equipment scanned"} />
                <Row label="Experiment" value="Simulated titration" />
                <Row
                  label="Progress"
                  value={s.progress ? `${s.progress.steps.filter((st) => st.done).length} / ${s.progress.steps.length} steps` : "0 / 7 steps"}
                />
                <Row label="Latest reading" value={sensorLabel(s.latest_sensor)} />
                <Row label="Status" value={statusFor(s)} />
              </dl>
            </button>
          ))}
        </section>

        {/* Side panel: alerts + camera + timeline */}
        <aside className="space-y-6">
          <section className="bg-lab-surfaceAlt rounded-xl shadow-sm border-2 border-gray-200 p-5">
            <h2 className="font-bold mb-3 text-lab-primary">Teacher Alerts</h2>
            {alertsError && <p className="text-xs text-lab-alert mb-2">{alertsError}</p>}
            {alerts.length === 0 && !alertsError && (
              <p className="text-sm text-gray-500">No unacknowledged alerts right now.</p>
            )}
            <ul className="space-y-2">
              {alerts.map((a) => (
                <li
                  key={a.id}
                  className="text-xs rounded-lg px-3 py-2 flex items-center justify-between gap-2 bg-red-50 text-lab-alert border border-red-200"
                >
                  <span>
                    ⚠ {a.message}{" "}
                    <span className="text-gray-500">
                      ({new Date(a.created_at).toLocaleTimeString()})
                    </span>
                  </span>
                  <button
                    onClick={() => acknowledge(a.id)}
                    className="underline font-semibold cursor-pointer shrink-0"
                  >
                    Acknowledge
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section className="bg-lab-surfaceAlt rounded-xl shadow-sm border-2 border-gray-200 p-5">
            <h2 className="font-bold mb-3 text-lab-primary">Bench Camera</h2>
            {selectedStudent ? (
              <CameraPlaceholder bench={selectedStudent.bench_number} />
            ) : (
              <p className="text-sm text-gray-500">Select a student card to view their bench camera.</p>
            )}
          </section>

          <section className="bg-lab-surfaceAlt rounded-xl shadow-sm border-2 border-gray-200 p-5">
            <h2 className="font-bold mb-3 text-lab-primary">Activity Timeline</h2>
            {timeline.length === 0 && <p className="text-sm text-gray-500">No activity yet this session.</p>}
            <ol className="space-y-2 text-sm">
              {timeline.map((t, i) => (
                <li key={i} className="flex gap-3">
                  <span className="text-lab-secondary font-semibold shrink-0">{t.time}</span>
                  <span className="text-gray-700">{t.text}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

/**
 * Clearly-labelled placeholder - never presents as a real live feed.
 * Real camera integration (Phase 7) renders an actual stream here.
 */
function CameraPlaceholder({ bench }) {
  return (
    <div className="aspect-video w-full bg-gray-900 rounded-lg flex flex-col items-center justify-center text-center px-4">
      <p className="text-gray-300 text-sm mb-1">📷 No live camera connected</p>
      <p className="text-gray-500 text-xs">Bench {bench} camera module not yet configured (added in Phase 7)</p>
    </div>
  );
}
