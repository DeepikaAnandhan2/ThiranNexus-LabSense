import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";

const BENCHES = ["01", "02", "03", "04", "05", "06"];
const POLL_INTERVAL_MS = 2000;

/**
 * Audio queue: ensures only one instruction speaks at a time.
 */
function useAudioQueue() {
  const queueRef = useRef([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioActivated, setAudioActivated] = useState(false);
  const lastTextRef = useRef("");

  const playNext = () => {
    if (queueRef.current.length === 0) {
      setIsSpeaking(false);
      return;
    }
    const text = queueRef.current.shift();
    lastTextRef.current = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.onend = () => setTimeout(playNext, 150);
    utterance.onerror = () => setTimeout(playNext, 150);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const enqueue = (text) => {
    if (!audioActivated || !text) return;
    queueRef.current.push(text);
    if (!window.speechSynthesis.speaking) playNext();
  };

  const activateAudio = () => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance("Audio activated."));
    setAudioActivated(true);
  };

  const repeat = () => {
    if (lastTextRef.current) {
      queueRef.current.unshift(lastTextRef.current);
      if (!window.speechSynthesis.speaking) playNext();
    }
  };

  const stop = () => {
    queueRef.current = [];
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  };

  return { enqueue, repeat, stop, activateAudio, isSpeaking, audioActivated };
}

export default function StudentDashboard() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [studentName, setStudentName] = useState("");
  const [bench, setBench] = useState("");
  const [currentEquipment, setCurrentEquipment] = useState(null);
  const [progress, setProgress] = useState(null); // { steps, current_step }
  const [startError, setStartError] = useState("");

  const audio = useAudioQueue();
  const lastActivityLogId = useRef(null);
  const lastStep6Done = useRef(false);

  const startSession = async () => {
    if (!bench || !studentName.trim()) return;
    setStartError("");
    lastActivityLogId.current = null;
    lastStep6Done.current = false;
    setCurrentEquipment(null);
    setProgress(null);
    try {
      const res = await api.post("/sessions/start", {
        student_name: studentName.trim(),
        bench_number: bench,
      });
      setSessionId(res.data.session.id);
      setSessionActive(true);
      audio.enqueue(`Lab session started at bench ${bench}. Waiting for equipment to be scanned.`);
    } catch (err) {
      setStartError(err.response?.data?.message || "Could not start session. Is the backend running?");
    }
  };

  const endSession = async () => {
    audio.stop();
    if (sessionId) {
      try { await api.post(`/sessions/${sessionId}/end`); } catch { /* non-fatal */ }
    }
    setSessionActive(false);
    setSessionId(null);
    setBench("");
    setStudentName("");
    setCurrentEquipment(null);
    setProgress(null);
    lastActivityLogId.current = null;
    lastStep6Done.current = false;
  };

  const requestVerification = async () => {
    if (!sessionId) return;
    try {
      const res = await api.post(`/sessions/${sessionId}/request-verification`);
      setProgress(res.data);
      audio.enqueue("Teacher verification requested. Please wait for your teacher.");
    } catch {
      audio.enqueue("Could not reach the teacher just now. Please try again.");
    }
  };

  // Poll equipment scans + experiment progress while the session is active.
  useEffect(() => {
    if (!sessionActive || !bench || !sessionId) return undefined;

    const poll = async () => {
      try {
        const scanRes = await api.get(`/devices/latest-scan/${bench}`);
        const latest = scanRes.data.latest;
        if (latest && latest.activity_log_id !== lastActivityLogId.current) {
          lastActivityLogId.current = latest.activity_log_id;
          setCurrentEquipment(latest);
          const parts = [latest.description, latest.usage_instructions, latest.safety_instructions].filter(Boolean);
          audio.enqueue(parts.join(" "));
        }
      } catch { /* retry next tick */ }

      try {
        const progRes = await api.get(`/sessions/${sessionId}/progress`);
        setProgress(progRes.data);
        const step6 = progRes.data.steps?.[5];
        if (step6?.done && !lastStep6Done.current) {
          lastStep6Done.current = true;
          audio.enqueue("Colour change detected. Please pause and ask your teacher to verify the observation.");
        }
      } catch { /* retry next tick */ }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, bench, sessionId]);

  const step6Done = progress?.steps?.[5]?.done;
  const step7Done = progress?.steps?.[6]?.done;

  return (
    <main className="min-h-screen bg-white text-lab-ink p-6 md:p-10">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-student-lg font-extrabold text-lab-primary">Student Dashboard</h1>
          <p className="text-gray-500">ThiranNexus LabSense</p>
        </div>
        <Link to="/" className="text-sm text-lab-primary underline focus-visible:outline-4">
          ← Back to Home
        </Link>
      </header>

      {!audio.audioActivated && (
        <div
          role="alert"
          className="bg-orange-50 border-2 border-lab-accent rounded-xl p-6 mb-8 flex flex-col md:flex-row items-center justify-between gap-4"
        >
          <p className="text-student-base text-lab-ink">
            Audio is off. Activate it to hear equipment and experiment instructions.
          </p>
          <button
            onClick={audio.activateAudio}
            className="bg-lab-accent hover:bg-lab-accentDark text-white font-bold text-student-base px-8 py-4 rounded-xl focus-visible:outline-4"
          >
            🔊 Activate Audio
          </button>
        </div>
      )}

      {!sessionActive ? (
        <section
          aria-label="Start lab session"
          className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-2xl p-8 max-w-xl"
        >
          <h2 className="text-student-base font-bold mb-4 text-lab-primary">Start Lab Session</h2>
          <label htmlFor="student-name" className="block mb-2 text-gray-700">Your name:</label>
          <input
            id="student-name"
            type="text"
            value={studentName}
            onChange={(e) => setStudentName(e.target.value)}
            placeholder="e.g. Deepika"
            className="w-full bg-white border-2 border-gray-300 rounded-lg p-4 text-student-base mb-6 focus-visible:outline-4"
          />
          <label htmlFor="bench-select" className="block mb-2 text-gray-700">Select your laboratory bench:</label>
          <select
            id="bench-select"
            value={bench}
            onChange={(e) => setBench(e.target.value)}
            className="w-full bg-white border-2 border-gray-300 rounded-lg p-4 text-student-base mb-6 focus-visible:outline-4"
          >
            <option value="">-- Choose a bench --</option>
            {BENCHES.map((b) => (<option key={b} value={b}>Bench {b}</option>))}
          </select>
          {startError && <p role="alert" className="text-lab-alert mb-4">{startError}</p>}
          <button
            onClick={startSession}
            disabled={!bench || !studentName.trim()}
            className="w-full bg-lab-secondary hover:bg-lab-secondaryDark disabled:opacity-40 disabled:cursor-not-allowed text-white text-student-base font-bold px-8 py-5 rounded-xl focus-visible:outline-4"
          >
            ▶ Start Lab Session
          </button>
        </section>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Equipment card */}
          <section
            aria-label="Current equipment"
            className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-2xl p-6"
          >
            <h2 className="text-student-base font-bold mb-3 text-lab-primary">Current Equipment</h2>
            <p aria-live="polite" className="text-2xl font-bold mb-2 text-lab-ink">
              {currentEquipment ? currentEquipment.name : "Waiting for scan…"}
            </p>
            <h3 className="text-gray-500 mt-4 mb-1 font-semibold">Equipment Description</h3>
            <p aria-live="polite" className="text-gray-700 mb-3">
              {currentEquipment
                ? currentEquipment.description
                : "Equipment details will appear here automatically once an RFID tag is scanned at your bench."}
            </p>
            {currentEquipment && (
              <>
                {currentEquipment.usage_instructions && (
                  <p className="text-sm text-gray-600 mb-2">
                    <span className="font-semibold text-lab-secondary">Usage: </span>
                    {currentEquipment.usage_instructions}
                  </p>
                )}
                {currentEquipment.safety_instructions && (
                  <p className="text-sm text-lab-warning">
                    <span className="font-semibold">Safety: </span>
                    {currentEquipment.safety_instructions}
                  </p>
                )}
                {currentEquipment.is_simulated && (
                  <p className="text-xs text-gray-400 mt-3">(Simulated scan — not from real hardware)</p>
                )}
              </>
            )}
          </section>

          {/* Experiment card */}
          <section
            aria-label="Current experiment and progress"
            className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-2xl p-6"
          >
            <h2 className="text-student-base font-bold mb-3 text-lab-primary">Current Experiment</h2>
            <p className="text-xl font-bold mb-4 text-lab-ink">Simulated Titration</p>
            <h3 className="text-gray-500 mb-2 font-semibold">Experiment Progress</h3>
            <ol className="space-y-2">
              {(progress?.steps || Array.from({ length: 7 }, (_, i) => ({ step_number: i + 1, text: "", done: false }))).map((step, i) => {
                const isCurrent = !step.done && progress?.current_step === i + 1;
                return (
                  <li
                    key={i}
                    className={`flex items-start gap-2 p-2 rounded-lg ${
                      isCurrent ? "bg-orange-50 border-2 border-lab-accent" : ""
                    }`}
                  >
                    <span aria-hidden="true">{step.done ? "✅" : isCurrent ? "➡️" : "⬜"}</span>
                    <span className={step.done ? "text-gray-400 line-through" : "text-gray-700"}>
                      Step {i + 1}: {step.text || "…"}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-xs text-gray-400 mt-3">
              Steps advance automatically as experiment events occur — scanning equipment alone does not complete a step.
            </p>

            {step6Done && !step7Done && (
              <button
                onClick={requestVerification}
                className="mt-4 w-full bg-lab-primary hover:bg-lab-primaryDark text-white font-bold text-student-base px-6 py-4 rounded-xl focus-visible:outline-4"
              >
                🙋 Request Teacher Verification
              </button>
            )}
            {step7Done && (
              <p className="mt-4 text-lab-secondary font-semibold">
                ✅ Teacher verification requested — please wait for your teacher.
              </p>
            )}
          </section>

          {/* Audio controls */}
          <section
            aria-label="Audio controls"
            className="bg-lab-surfaceAlt border-2 border-gray-200 rounded-2xl p-6 md:col-span-2 flex flex-wrap gap-4"
          >
            <button
              onClick={audio.repeat}
              className="bg-lab-primary hover:bg-lab-primaryDark text-white font-bold text-student-base px-8 py-4 rounded-xl focus-visible:outline-4"
            >
              🔁 Repeat Audio
            </button>
            <button
              onClick={audio.stop}
              className="bg-lab-alert hover:bg-red-700 text-white font-bold text-student-base px-8 py-4 rounded-xl focus-visible:outline-4"
            >
              ⏹ Stop Audio
            </button>
            <span aria-live="polite" className="self-center text-gray-600">
              {audio.isSpeaking ? "Speaking…" : "Silent"}
            </span>
            <button
              onClick={endSession}
              className="ml-auto bg-gray-200 hover:bg-gray-300 text-lab-ink font-bold text-student-base px-8 py-4 rounded-xl focus-visible:outline-4"
            >
              ⏻ End Session
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
