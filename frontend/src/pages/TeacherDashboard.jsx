import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import socket from "../services/socket";

const ACTIVITY_TEXT = {
  equipment_scan: (p) => `${p.equipment_name || "Equipment"} scanned`,
  experiment_start: () => "Titration started",
  colour_monitoring_start: () => "Colour monitoring enabled",
  colour_change_detected: () => "Colour change detected",
  teacher_verification_requested: () => "Teacher verification requested",
  teacher_verified: () => "Observation verified by teacher",
};

function activityLabel(payload) {
  const build = ACTIVITY_TEXT[payload.type];
  const text = build ? build(payload) : payload.type;
  return `${text}${payload.is_simulated ? " (simulated)" : ""}`;
}

function statusFor(session) {
  if (!session.progress) return "Session started — waiting for first apparatus scan...";
  if (session.progress.complete) return "Experiment complete — observation verified ✅";
  const nextStep = session.progress.steps?.find((s) => !s.done);
  return nextStep ? `Stage ${session.progress.current_step} of 8: ${nextStep.text}` : "In Progress...";
}

export default function TeacherDashboard() {
  const [sessions, setSessions] = useState({});
  const [selectedId, setSelectedId] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [alertsError, setAlertsError] = useState("");
  const [timeline, setTimeline] = useState([]);
  const [connected, setConnected] = useState(socket.connected);
  const [loadError, setLoadError] = useState("");

  const pushTimeline = useCallback((text, icon = "fa-circle-info") => {
    setTimeline((prev) => [
      { time: new Date().toLocaleTimeString(), text, icon },
      ...prev,
    ].slice(0, 20));
  }, []);

  // Initial load: active sessions and open alerts
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/sessions/active");
        const map = {};
        res.data.sessions.forEach((s) => {
          map[s.id] = { ...s, recent_activity: [] };
        });
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
        setAlertsError("Could not fetch alerts from backend.");
      }
    })();
  }, []);

  // Socket.IO real-time event listeners
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
      pushTimeline(`Bench ${bench_number}: ${session.student_name} started a lab session`, "fa-user-plus");
    };

    const onSessionEnded = ({ session_id, bench_number }) => {
      setSessions((prev) => {
        const next = { ...prev };
        delete next[session_id];
        return next;
      });
      setSelectedId((prev) => (prev === session_id ? null : prev));
      pushTimeline(`Bench ${bench_number}: Student ended session`, "fa-power-off");
    };

    const onActivity = (payload) => {
      let icon = "fa-circle-dot";
      if (payload.type === "equipment_scan") icon = "fa-tag";
      else if (payload.type === "colour_change_detected") icon = "fa-bell";
      else if (payload.type === "teacher_verified") icon = "fa-clipboard-check";
      else if (payload.type === "teacher_verification_requested") icon = "fa-hand";

      pushTimeline(`Bench ${payload.bench_number}: ${activityLabel(payload)}`, icon);

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
      setSessions((prev) =>
        prev[session_id] ? { ...prev, [session_id]: { ...prev[session_id], progress } } : prev
      );
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

  const acknowledgeAlert = async (id) => {
    try {
      await api.post(`/alerts/${id}/acknowledge`);
    } catch {
      setAlertsError("Could not verify or acknowledge alert. Try again.");
    }
  };

  const studentCards = Object.values(sessions).sort(
    (a, b) => new Date(b.started_at) - new Date(a.started_at)
  );
  const selectedStudent = selectedId ? sessions[selectedId] : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Teacher Dashboard Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-700 text-white flex items-center justify-center font-bold text-xl shadow-md">
              <i className="fa-solid fa-chalkboard-user" aria-hidden="true"></i>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold text-purple-900 tracking-tight">
                Teacher Lab Monitoring Dashboard
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                ThiranNexus LabSense · Real-Time Multi-Bench Assistive Laboratory Supervision
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                connected
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-red-100 text-red-800 border-red-300"
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500 animate-pulse"}`}
              ></span>
              {connected ? "Socket Connected (Live)" : "Reconnecting Socket..."}
            </span>
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors focus-visible:outline-orange-500"
            >
              <i className="fa-solid fa-arrow-left text-xs" aria-hidden="true"></i>
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8">
        {loadError && (
          <div role="alert" className="p-4 mb-6 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
            <i className="fa-solid fa-triangle-exclamation mr-2" aria-hidden="true"></i>
            {loadError}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6 items-start">
          {/* Active Laboratory Bench Cards */}
          <section aria-labelledby="bench-grid-heading" className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between">
              <h2 id="bench-grid-heading" className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                <i className="fa-solid fa-microscope text-purple-600" aria-hidden="true"></i>
                Active Laboratory Benches ({studentCards.length})
              </h2>
              <span className="text-xs text-slate-500 font-medium">Click a card to inspect live telemetry</span>
            </div>

            {studentCards.length === 0 ? (
              <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center shadow-sm">
                <div className="w-14 h-14 mx-auto rounded-full bg-slate-100 text-slate-400 flex items-center justify-center text-2xl mb-3">
                  <i className="fa-solid fa-users-slash" aria-hidden="true"></i>
                </div>
                <h3 className="text-base font-bold text-slate-700 mb-1">No Active Student Sessions</h3>
                <p className="text-sm text-slate-400 max-w-sm mx-auto">
                  Student cards will appear here immediately in real time when students check into their assigned laboratory bench.
                </p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {studentCards.map((s) => {
                  const isSelected = selectedId === s.id;
                  const completedSteps = s.progress?.steps?.filter((st) => st.done).length || 0;
                  const currentStep = s.progress?.current_step || 1;
                  const isComplete = s.progress?.complete;

                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedId(s.id)}
                      className={`text-left bg-white rounded-2xl p-5 shadow-sm border-2 transition-all hover:shadow-md focus-visible:outline-orange-500 ${
                        isSelected
                          ? "border-purple-600 ring-2 ring-purple-600/30"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                      aria-pressed={isSelected}
                    >
                      {/* Bench & Student Info */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div>
                          <p className="font-extrabold text-lg text-slate-900 leading-tight">
                            {s.student_name}
                          </p>
                          <p className="text-xs text-slate-400 font-medium">Session #{s.id}</p>
                        </div>
                        <span className="px-2.5 py-1 text-xs font-extrabold bg-purple-100 text-purple-800 border border-purple-200 rounded-full shrink-0">
                          Bench {s.bench_number}
                        </span>
                      </div>

                      {/* Experiment Info Fields */}
                      <dl className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3 mb-3">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-400 font-semibold flex items-center gap-1">
                            <i className="fa-solid fa-flask text-slate-400" aria-hidden="true"></i>
                            Apparatus:
                          </dt>
                          <dd className="font-bold text-slate-900 text-right">
                            {s.current_equipment || "Waiting for scan"}
                          </dd>
                        </div>

                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-400 font-semibold flex items-center gap-1">
                            <i className="fa-solid fa-bars-progress text-slate-400" aria-hidden="true"></i>
                            Stage Progress:
                          </dt>
                          <dd className="font-bold text-slate-900 text-right">
                            {completedSteps} / 8 stages
                          </dd>
                        </div>

                        <div className="flex justify-between items-center gap-2">
                          <dt className="text-slate-400 font-semibold flex items-center gap-1">
                            <i className="fa-solid fa-palette text-slate-400" aria-hidden="true"></i>
                            Sensor RGB:
                          </dt>
                          <dd className="font-mono text-slate-800 text-right flex items-center gap-1.5">
                            {s.latest_sensor ? (
                              <>
                                <span
                                  className="w-3 h-3 rounded-full border border-slate-300 inline-block shadow-inner"
                                  style={{
                                    backgroundColor: `rgb(${s.latest_sensor.red}, ${s.latest_sensor.green}, ${s.latest_sensor.blue})`,
                                  }}
                                  title={`RGB: ${s.latest_sensor.red}, ${s.latest_sensor.green}, ${s.latest_sensor.blue}`}
                                ></span>
                                <span>
                                  ({s.latest_sensor.red}, {s.latest_sensor.green}, {s.latest_sensor.blue})
                                </span>
                              </>
                            ) : (
                              <span className="text-slate-400 font-sans">No reading yet</span>
                            )}
                          </dd>
                        </div>
                      </dl>

                      {/* Progress Bar & Status */}
                      <div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full transition-all duration-500 ${
                              isComplete ? "bg-emerald-600" : "bg-purple-600"
                            }`}
                            style={{ width: `${(completedSteps / 8) * 100}%` }}
                          ></div>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-500 truncate">
                          {statusFor(s)}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Right Aside: Alerts, Camera Inspection, Activity Timeline */}
          <aside className="space-y-6">
            {/* Teacher Alerts Panel */}
            <section
              aria-labelledby="alerts-heading"
              className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="alerts-heading" className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-bell text-red-600" aria-hidden="true"></i>
                  Teacher Alerts
                </h2>
                {alerts.length > 0 && (
                  <span className="px-2 py-0.5 text-xs font-bold bg-red-100 text-red-700 rounded-full">
                    {alerts.length} Pending
                  </span>
                )}
              </div>

              {alertsError && (
                <p className="text-xs text-red-600 mb-3 bg-red-50 p-2 rounded-lg">{alertsError}</p>
              )}

              {alerts.length === 0 ? (
                <div className="text-center py-6 text-slate-400 bg-slate-50 rounded-xl border border-slate-100">
                  <i className="fa-solid fa-circle-check text-emerald-500 text-xl mb-1.5" aria-hidden="true"></i>
                  <p className="text-xs font-bold text-slate-600">No Unacknowledged Alerts</p>
                  <p className="text-[11px] text-slate-400">All sensor events and student requests are clear.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {alerts.map((a) => (
                    <li
                      key={a.id}
                      className="p-3.5 bg-red-50/80 border border-red-200 rounded-xl text-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-extrabold text-red-900 bg-red-100 px-2 py-0.5 rounded text-[11px]">
                          Bench {a.bench_number}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {new Date(a.created_at).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-slate-800 font-medium leading-relaxed">{a.message}</p>
                      <button
                        onClick={() => acknowledgeAlert(a.id)}
                        className="w-full bg-red-600 hover:bg-red-700 text-white font-extrabold py-2 px-3 rounded-lg shadow-sm transition-colors focus-visible:outline-orange-500 flex items-center justify-center gap-1.5"
                      >
                        <i className="fa-solid fa-check text-xs" aria-hidden="true"></i>
                        Verify Observation & Acknowledge
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Bench Camera Placeholder */}
            <section
              aria-labelledby="camera-heading"
              className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 id="camera-heading" className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-video text-slate-600" aria-hidden="true"></i>
                  Bench Camera
                </h2>
                {selectedStudent && (
                  <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full">
                    Bench {selectedStudent.bench_number}
                  </span>
                )}
              </div>

              {selectedStudent ? (
                <div className="aspect-video w-full bg-slate-900 rounded-xl flex flex-col items-center justify-center text-center p-4 shadow-inner">
                  <i className="fa-solid fa-camera text-slate-500 text-3xl mb-2" aria-hidden="true"></i>
                  <p className="text-slate-200 text-xs font-bold">No Live Video Stream</p>
                  <p className="text-slate-500 text-[11px] max-w-xs mt-1">
                    Bench {selectedStudent.bench_number} hardware camera module not connected.
                  </p>
                </div>
              ) : (
                <div className="aspect-video w-full bg-slate-100 rounded-xl border border-slate-200 flex flex-col items-center justify-center text-center p-4 text-slate-400">
                  <i className="fa-solid fa-arrow-pointer text-slate-300 text-2xl mb-1.5" aria-hidden="true"></i>
                  <p className="text-xs font-semibold">Select a student card above to inspect bench camera</p>
                </div>
              )}
            </section>

            {/* Live Activity Timeline */}
            <section
              aria-labelledby="timeline-heading"
              className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
            >
              <div className="flex items-center justify-between mb-3">
                <h2 id="timeline-heading" className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                  <i className="fa-solid fa-clock-rotate-left text-slate-600" aria-hidden="true"></i>
                  Live Activity Timeline
                </h2>
                <span className="text-[11px] text-slate-400">Real-time Socket</span>
              </div>

              {timeline.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4 bg-slate-50 rounded-xl">
                  No activity events recorded yet.
                </p>
              ) : (
                <ol className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {timeline.map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-xs">
                      <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5 text-[10px]">
                        <i className={`fa-solid ${t.icon}`} aria-hidden="true"></i>
                      </span>
                      <div className="flex-1">
                        <span className="font-semibold text-slate-800">{t.text}</span>
                        <span className="text-[10px] text-slate-400 block">{t.time}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}
