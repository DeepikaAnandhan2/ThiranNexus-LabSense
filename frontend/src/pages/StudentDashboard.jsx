import { useState, useRef, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import socket from "../services/socket";

const BENCHES = ["01", "02", "03", "04", "05", "06"];
const POLL_INTERVAL_MS = 2500;

/**
 * Accessible Audio Queue:
 * - Uses Web Speech API with FIFO queue to prevent overlapping speech.
 * - Speeds instruction sequence cleanly.
 * - Allows pausing, stopping, muting, and manual repeat.
 * - Automatic repeat mode is completely removed.
 */
function useAudioQueue() {
  const queueRef = useRef([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [audioActivated, setAudioActivated] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef = useRef(false);
  const audioActivatedRef = useRef(false);
  const lastInstructionRef = useRef("");
  const currentUtteranceRef = useRef(null);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    audioActivatedRef.current = audioActivated;
  }, [audioActivated]);

  const playNext = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    if (queueRef.current.length === 0) {
      setIsSpeaking(false);
      currentUtteranceRef.current = null;
      return;
    }

    if (isMutedRef.current) {
      queueRef.current = [];
      setIsSpeaking(false);
      currentUtteranceRef.current = null;
      return;
    }

    const item = queueRef.current.shift();
    if (!item) {
      playNext();
      return;
    }

    if (item.isInstruction) {
      lastInstructionRef.current = item.text;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    currentUtteranceRef.current = utterance;

    utterance.onstart = () => {
      setIsSpeaking(true);
    };

    utterance.onend = () => {
      currentUtteranceRef.current = null;
      setTimeout(() => {
        playNext();
      }, 140);
    };

    utterance.onerror = (e) => {
      if (e.error !== "canceled" && e.error !== "interrupted") {
        console.warn("[Speech] Utterance error:", e.error);
      }
      currentUtteranceRef.current = null;
      setTimeout(() => {
        playNext();
      }, 140);
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.error("[Speech] Speak failed:", err);
      setIsSpeaking(false);
    }
  }, []);

  const enqueue = useCallback((text, isInstruction = true) => {
    if (!text) return;
    const cleanText = text.trim();
    if (!cleanText) return;

    queueRef.current.push({ text: cleanText, isInstruction });
    if (audioActivatedRef.current && !isMutedRef.current) {
      if (!window.speechSynthesis.speaking && !currentUtteranceRef.current) {
        playNext();
      }
    }
  }, [playNext]);

  const activateAudio = useCallback(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setAudioActivated(true);
    audioActivatedRef.current = true;

    const welcome = new SpeechSynthesisUtterance("Audio guidance enabled. ThiranNexus LabSense is ready.");
    welcome.rate = 0.95;
    welcome.onend = () => {
      if (queueRef.current.length > 0) {
        playNext();
      } else {
        setIsSpeaking(false);
      }
    };
    setIsSpeaking(true);
    window.speechSynthesis.speak(welcome);
  }, [playNext]);

  const repeat = useCallback(() => {
    if (!lastInstructionRef.current) {
      enqueue("No previous instruction to repeat.", false);
      return;
    }
    enqueue(`Repeating: ${lastInstructionRef.current}`, false);
  }, [enqueue]);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (next) {
        queueRef.current = [];
        if (typeof window !== "undefined" && window.speechSynthesis) {
          window.speechSynthesis.cancel();
        }
        setIsSpeaking(false);
      }
      return next;
    });
  }, []);

  const stop = useCallback(() => {
    queueRef.current = [];
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    currentUtteranceRef.current = null;
  }, []);

  return {
    enqueue,
    repeat,
    stop,
    toggleMute,
    activateAudio,
    isSpeaking,
    audioActivated,
    isMuted,
    lastInstruction: lastInstructionRef.current,
  };
}

export default function StudentDashboard() {
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const [studentName, setStudentName] = useState("");
  const [bench, setBench] = useState("");
  const [currentEquipment, setCurrentEquipment] = useState(null);
  const [progress, setProgress] = useState(null);
  const [startError, setStartError] = useState("");
  const [verificationPending, setVerificationPending] = useState(false);

  const audio = useAudioQueue();
  const lastActivityLogId = useRef(null);
  const lastSpokenEquipmentCode = useRef(null);
  const hasSpokenColourChange = useRef(false);
  const hasSpokenTeacherVerified = useRef(false);

  const announceEquipment = useCallback((equip) => {
    if (!equip) return;
    if (equip.code === lastSpokenEquipmentCode.current) {
      // Deduplicate: same equipment already announced
      return;
    }
    lastSpokenEquipmentCode.current = equip.code;
    setCurrentEquipment(equip);

    const speechParts = [
      `Equipment identified: ${equip.name}.`,
      equip.description,
      equip.usage_instructions ? `Usage instructions: ${equip.usage_instructions}` : null,
      equip.safety_instructions ? `Safety precautions: ${equip.safety_instructions}` : null,
    ].filter(Boolean);

    audio.enqueue(speechParts.join(" "), true);
  }, [audio]);

  const checkProgressAudio = useCallback((prog) => {
    if (!prog || !prog.steps) return;

    // Stage 6: Colour change detected (index 5)
    const step6 = prog.steps[5];
    if (step6?.done && !hasSpokenColourChange.current) {
      hasSpokenColourChange.current = true;
      audio.enqueue(
        "Colour change detected. Please pause and ask your teacher to verify the observation.",
        true
      );
    }

    // Stage 8: Teacher verification or experiment completion (index 7)
    const step8 = prog.steps[7];
    if (step8?.done && !hasSpokenTeacherVerified.current) {
      hasSpokenTeacherVerified.current = true;
      setVerificationPending(false);
      audio.enqueue(
        "Teacher verification complete. Observation verified.",
        true
      );
    }
  }, [audio]);

  const startSession = async () => {
    if (!bench || !studentName.trim()) return;
    setStartError("");

    // Reset experiment & speech tracking state
    lastActivityLogId.current = null;
    lastSpokenEquipmentCode.current = null;
    hasSpokenColourChange.current = false;
    hasSpokenTeacherVerified.current = false;
    setVerificationPending(false);
    setCurrentEquipment(null);
    setProgress(null);

    try {
      const res = await api.post("/sessions/start", {
        student_name: studentName.trim(),
        bench_number: bench,
      });
      setSessionId(res.data.session.id);
      setSessionActive(true);
      audio.enqueue(`Lab session started for ${studentName.trim()} at Bench ${bench}. Please bring laboratory apparatus near the reader to identify.`, true);
    } catch (err) {
      setStartError(err.response?.data?.message || "Could not start session. Is the backend running?");
    }
  };

  const endSession = async () => {
    audio.stop();
    if (sessionId) {
      try {
        await api.post(`/sessions/${sessionId}/end`);
      } catch {
        /* non-fatal */
      }
    }
    setSessionActive(false);
    setSessionId(null);
    setBench("");
    setStudentName("");
    setCurrentEquipment(null);
    setProgress(null);
    setVerificationPending(false);
    lastActivityLogId.current = null;
    lastSpokenEquipmentCode.current = null;
    hasSpokenColourChange.current = false;
    hasSpokenTeacherVerified.current = false;
  };

  const requestVerification = async () => {
    if (!sessionId) return;
    try {
      setVerificationPending(true);
      const res = await api.post(`/sessions/${sessionId}/request-verification`);
      setProgress(res.data);
      audio.enqueue("Teacher verification requested. Please pause and wait for your teacher to verify the observation.", true);
    } catch {
      audio.enqueue("Could not notify the teacher. Please notify your teacher directly.", false);
    }
  };

  // Socket.IO real-time event listener for instant push updates
  useEffect(() => {
    if (!sessionActive || !bench || !sessionId) return;

    const onActivity = (payload) => {
      if (payload.bench_number !== bench) return;

      if (payload.type === "equipment_scan" && payload.equipment) {
        announceEquipment(payload.equipment);
      } else if (payload.type === "colour_change_detected") {
        if (!hasSpokenColourChange.current) {
          hasSpokenColourChange.current = true;
          audio.enqueue("Colour change detected. Please pause and ask your teacher to verify the observation.", true);
        }
      } else if (payload.type === "teacher_verified") {
        if (!hasSpokenTeacherVerified.current) {
          hasSpokenTeacherVerified.current = true;
          setVerificationPending(false);
          audio.enqueue("Teacher verification complete. Observation verified.", true);
        }
      }
    };

    const onProgress = (payload) => {
      if (payload.bench_number === bench && payload.session_id === sessionId) {
        setProgress(payload.progress);
        checkProgressAudio(payload.progress);
      }
    };

    socket.on("lab:activity", onActivity);
    socket.on("lab:progress", onProgress);

    return () => {
      socket.off("lab:activity", onActivity);
      socket.off("lab:progress", onProgress);
    };
  }, [sessionActive, bench, sessionId, announceEquipment, checkProgressAudio, audio]);

  // Polling fallback to guarantee state synchronization
  useEffect(() => {
    if (!sessionActive || !bench || !sessionId) return undefined;

    const poll = async () => {
      try {
        const scanRes = await api.get(`/devices/latest-scan/${bench}`);
        const latest = scanRes.data.latest;
        if (latest && latest.activity_log_id !== lastActivityLogId.current) {
          lastActivityLogId.current = latest.activity_log_id;
          announceEquipment(latest);
        }
      } catch {
        /* retry next tick */
      }

      try {
        const progRes = await api.get(`/sessions/${sessionId}/progress`);
        setProgress(progRes.data);
        checkProgressAudio(progRes.data);
      } catch {
        /* retry next tick */
      }
    };

    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [sessionActive, bench, sessionId, announceEquipment, checkProgressAudio]);

  const step6Done = progress?.steps?.[5]?.done;
  const step7Done = progress?.steps?.[6]?.done;
  const step8Done = progress?.steps?.[7]?.done;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center font-bold text-xl shadow-md">
              <i className="fa-solid fa-flask-vial" aria-hidden="true"></i>
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-extrabold text-purple-900 tracking-tight">
                ThiranNexus LabSense
              </h1>
              <p className="text-xs text-slate-500 font-medium">
                Assistive Laboratory Guidance for Visually Impaired Students
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {sessionActive && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200">
                <i className="fa-solid fa-microscope text-purple-600" aria-hidden="true"></i>
                Bench {bench} · {studentName}
              </span>
            )}
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
        {/* Audio Activation Alert Banner */}
        {!audio.audioActivated && (
          <div
            role="alert"
            className="mb-8 bg-gradient-to-r from-orange-50 to-amber-50 border-2 border-orange-400 rounded-2xl p-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-6"
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-orange-500 text-white flex items-center justify-center text-2xl shrink-0 shadow-md">
                <i className="fa-solid fa-volume-high" aria-hidden="true"></i>
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900 mb-1">Spoken Audio Instructions Are Disabled</h2>
                <p className="text-sm md:text-base text-slate-700">
                  Click the button below to turn on audio guidance. The system will automatically speak apparatus details, safety instructions, and experiment milestones aloud.
                </p>
              </div>
            </div>
            <button
              onClick={audio.activateAudio}
              className="w-full md:w-auto shrink-0 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white font-extrabold text-base md:text-lg px-8 py-4 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-orange-500"
              aria-label="Enable Spoken Audio Guidance"
            >
              <i className="fa-solid fa-volume-high mr-2" aria-hidden="true"></i>
              Enable Audio
            </button>
          </div>
        )}

        {/* Audio Active Control Bar */}
        {audio.audioActivated && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-3 px-5 shadow-sm flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span
                role="status"
                aria-live="polite"
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold ${
                  audio.isSpeaking
                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300 animate-audio-pulse"
                    : audio.isMuted
                    ? "bg-slate-200 text-slate-700"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                <i
                  className={`fa-solid ${
                    audio.isSpeaking
                      ? "fa-waveform text-emerald-600"
                      : audio.isMuted
                      ? "fa-volume-xmark text-slate-500"
                      : "fa-check text-slate-500"
                  }`}
                  aria-hidden="true"
                ></i>
                {audio.isSpeaking ? "Speaking Audio..." : audio.isMuted ? "Audio Muted" : "Audio Active"}
              </span>
              <span className="text-xs text-slate-500 hidden sm:inline">
                Instructions speak automatically on apparatus detection and colour changes.
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={audio.repeat}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors focus-visible:outline-orange-500"
                title="Repeat the last instruction"
                aria-label="Repeat Last Spoken Instruction"
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true"></i>
                Repeat Instruction
              </button>
              <button
                onClick={audio.toggleMute}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border transition-colors focus-visible:outline-orange-500 ${
                  audio.isMuted
                    ? "bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200"
                    : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
                }`}
                aria-label={audio.isMuted ? "Unmute Audio" : "Mute Audio"}
              >
                <i
                  className={`fa-solid ${audio.isMuted ? "fa-volume-high" : "fa-volume-xmark"}`}
                  aria-hidden="true"
                ></i>
                {audio.isMuted ? "Unmute" : "Mute"}
              </button>
              <button
                onClick={audio.stop}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors focus-visible:outline-orange-500"
                title="Stop current speech"
                aria-label="Stop Speaking"
              >
                <i className="fa-solid fa-stop" aria-hidden="true"></i>
                Stop
              </button>
            </div>
          </div>
        )}

        {!sessionActive ? (
          /* Start Lab Session Panel */
          <section
            aria-labelledby="start-session-heading"
            className="max-w-xl mx-auto bg-white border border-slate-200 rounded-2xl p-6 md:p-8 shadow-sm"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-lg">
                <i className="fa-solid fa-id-badge" aria-hidden="true"></i>
              </div>
              <div>
                <h2 id="start-session-heading" className="text-2xl font-extrabold text-slate-900">
                  Student Session Check-In
                </h2>
                <p className="text-sm text-slate-500">
                  Enter your name and choose your assigned laboratory bench.
                </p>
              </div>
            </div>

            <div className="space-y-5">
              <div>
                <label htmlFor="student-name" className="block text-sm font-bold text-slate-700 mb-1.5">
                  Your Full Name:
                </label>
                <input
                  id="student-name"
                  type="text"
                  value={studentName}
                  onChange={(e) => setStudentName(e.target.value)}
                  placeholder="e.g. Deepika Anandhan"
                  className="w-full bg-white border-2 border-slate-300 rounded-xl p-3.5 text-base text-slate-900 placeholder:text-slate-400 focus:border-purple-600 focus-visible:outline-orange-500 font-medium"
                />
              </div>

              <div>
                <label htmlFor="bench-select" className="block text-sm font-bold text-slate-700 mb-1.5">
                  Assigned Bench Number:
                </label>
                <select
                  id="bench-select"
                  value={bench}
                  onChange={(e) => setBench(e.target.value)}
                  className="w-full bg-white border-2 border-slate-300 rounded-xl p-3.5 text-base text-slate-900 focus:border-purple-600 focus-visible:outline-orange-500 font-medium"
                >
                  <option value="">-- Select Laboratory Bench --</option>
                  {BENCHES.map((b) => (
                    <option key={b} value={b}>
                      Laboratory Bench {b}
                    </option>
                  ))}
                </select>
              </div>

              {startError && (
                <div role="alert" className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                  <i className="fa-solid fa-circle-exclamation mr-1.5" aria-hidden="true"></i>
                  {startError}
                </div>
              )}

              <button
                onClick={startSession}
                disabled={!bench || !studentName.trim()}
                className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-extrabold text-lg py-4 px-6 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-orange-500 flex items-center justify-center gap-2"
              >
                <i className="fa-solid fa-play" aria-hidden="true"></i>
                Start Laboratory Session
              </button>
            </div>
          </section>
        ) : (
          /* Active Session View: Equipment + Experiment Progress + Controls */
          <div className="space-y-6">
            <div className="grid lg:grid-cols-2 gap-6 items-start">
              {/* Equipment Identification Card */}
              <section
                aria-labelledby="equipment-heading"
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center text-sm">
                        <i className="fa-solid fa-tags" aria-hidden="true"></i>
                      </div>
                      <h2 id="equipment-heading" className="text-base font-bold text-slate-700 uppercase tracking-wider">
                        Apparatus Identification
                      </h2>
                    </div>
                    <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">
                      RFID Auto-Detection
                    </span>
                  </div>

                  <div className="mb-6">
                    <p className="text-xs font-semibold uppercase text-purple-600 mb-1">Current Apparatus</p>
                    <h3
                      aria-live="polite"
                      className="text-3xl md:text-4xl font-extrabold text-slate-900 tracking-tight"
                    >
                      {currentEquipment ? currentEquipment.name : "Waiting for apparatus scan..."}
                    </h3>
                  </div>

                  {currentEquipment ? (
                    <div className="space-y-4">
                      {/* Description */}
                      <div>
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">
                          Apparatus Purpose & Description
                        </h4>
                        <p aria-live="polite" className="text-base text-slate-700 leading-relaxed font-normal">
                          {currentEquipment.description}
                        </p>
                      </div>

                      {/* Usage Instructions */}
                      {currentEquipment.usage_instructions && (
                        <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-xl">
                          <h4 className="text-xs font-bold text-emerald-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="fa-solid fa-hand-holding-droplet text-emerald-600" aria-hidden="true"></i>
                            Usage Instructions
                          </h4>
                          <p className="text-sm text-emerald-950 font-medium">
                            {currentEquipment.usage_instructions}
                          </p>
                        </div>
                      )}

                      {/* Safety Precautions */}
                      {currentEquipment.safety_instructions && (
                        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-xl">
                          <h4 className="text-xs font-bold text-amber-800 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                            <i className="fa-solid fa-triangle-exclamation text-amber-600" aria-hidden="true"></i>
                            Safety Precautions
                          </h4>
                          <p className="text-sm text-amber-950 font-medium">
                            {currentEquipment.safety_instructions}
                          </p>
                        </div>
                      )}

                      {currentEquipment.is_simulated && (
                        <p className="text-xs text-slate-400 font-medium">
                          <i className="fa-solid fa-flask mr-1" aria-hidden="true"></i>
                          Event triggered via software simulation button
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="py-12 px-4 text-center border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                      <div className="w-12 h-12 mx-auto rounded-full bg-slate-200 text-slate-500 flex items-center justify-center text-xl mb-3">
                        <i className="fa-solid fa-barcode" aria-hidden="true"></i>
                      </div>
                      <p className="text-slate-600 font-semibold mb-1">
                        Hold an RFID-tagged apparatus near the bench scanner
                      </p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Burette, pipette, conical flask, or beaker tags will be detected and instructions will be announced automatically.
                      </p>
                    </div>
                  )}
                </div>
              </section>

              {/* Experiment Stage Guidance (8 Stages) */}
              <section
                aria-labelledby="experiment-heading"
                className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm"
              >
                <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm">
                      <i className="fa-solid fa-list-check" aria-hidden="true"></i>
                    </div>
                    <h2 id="experiment-heading" className="text-base font-bold text-slate-700 uppercase tracking-wider">
                      Titration Experiment Stages
                    </h2>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-800">
                    Stage {progress?.current_step ? Math.min(progress.current_step, 8) : 1} of 8
                  </span>
                </div>

                <div className="mb-4">
                  <h3 className="text-2xl font-extrabold text-slate-900">Acid-Base Titration</h3>
                  <p className="text-xs text-slate-500">
                    Follow spoken instructions step-by-step. Stages advance automatically as valid events occur.
                  </p>
                </div>

                {/* 8-Stage Stepper List */}
                <ol className="space-y-2 mb-6" aria-label="Experiment step progress">
                  {(
                    progress?.steps ||
                    Array.from({ length: 8 }, (_, i) => ({
                      step_number: i + 1,
                      text: [
                        "Equipment identification",
                        "Equipment instructions",
                        "Experiment preparation",
                        "Titration started",
                        "Colour monitoring enabled",
                        "Colour change detected",
                        "Audio instruction and teacher notification",
                        "Teacher verification or experiment completion",
                      ][i],
                      done: false,
                    }))
                  ).map((step, idx) => {
                    const stepNum = idx + 1;
                    const isDone = step.done;
                    const isCurrent = !isDone && (progress?.current_step === stepNum || (!progress && stepNum === 1));

                    return (
                      <li
                        key={stepNum}
                        className={`flex items-center justify-between p-3 rounded-xl border text-sm transition-colors ${
                          isDone
                            ? "bg-slate-50/80 border-slate-200 text-slate-500"
                            : isCurrent
                            ? "bg-orange-50/80 border-2 border-orange-400 font-bold text-slate-900 shadow-sm"
                            : "bg-white border-slate-200 text-slate-400"
                        }`}
                        aria-current={isCurrent ? "step" : undefined}
                      >
                        <div className="flex items-center gap-3">
                          <span
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0 ${
                              isDone
                                ? "bg-emerald-600 text-white"
                                : isCurrent
                                ? "bg-orange-500 text-white"
                                : "bg-slate-200 text-slate-500"
                            }`}
                            aria-hidden="true"
                          >
                            {isDone ? (
                              <i className="fa-solid fa-check text-xs"></i>
                            ) : (
                              <span>{stepNum}</span>
                            )}
                          </span>
                          <span className={isDone ? "line-through text-slate-500" : ""}>
                            {step.text}
                          </span>
                        </div>

                        <div>
                          {isDone ? (
                            <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              Completed
                            </span>
                          ) : isCurrent ? (
                            <span className="text-xs font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded-full">
                              In Progress
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-slate-400">
                              Pending
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>

                {/* Stage 6 & 7 Alert Guidance */}
                {step6Done && !step8Done && (
                  <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 mb-4">
                    <div className="flex items-start gap-3">
                      <i className="fa-solid fa-bell text-amber-600 text-lg mt-0.5" aria-hidden="true"></i>
                      <div>
                        <h4 className="text-sm font-bold text-amber-950 mb-0.5">
                          Colour Change Detected – Verification Required
                        </h4>
                        <p className="text-xs text-amber-900 mb-3 leading-relaxed">
                          Please pause your experiment. Detecting a colour change does not conclusively prove titration endpoint; your teacher must verify the observation.
                        </p>
                        {!verificationPending ? (
                          <button
                            onClick={requestVerification}
                            className="w-full bg-purple-700 hover:bg-purple-800 text-white font-bold text-sm py-3 px-4 rounded-lg shadow-sm focus-visible:outline-orange-500 flex items-center justify-center gap-2"
                          >
                            <i className="fa-solid fa-hand text-sm" aria-hidden="true"></i>
                            Request Teacher Verification
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 text-xs font-bold text-purple-900 bg-purple-100 p-2.5 rounded-lg">
                            <i className="fa-solid fa-hourglass-half text-purple-600 animate-spin" aria-hidden="true"></i>
                            Verification request sent. Please wait for your teacher to inspect Bench {bench}.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Stage 8 Completed State */}
                {step8Done && (
                  <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-4 text-emerald-950 flex items-center gap-3">
                    <i className="fa-solid fa-circle-check text-emerald-600 text-xl" aria-hidden="true"></i>
                    <div>
                      <p className="font-bold text-sm">Teacher Verification Completed</p>
                      <p className="text-xs text-emerald-800">
                        The titration observation has been verified. You have completed the experiment!
                      </p>
                    </div>
                  </div>
                )}
              </section>
            </div>

            {/* Bottom Session Management Bar */}
            <div className="bg-white border border-slate-200 rounded-xl p-4 px-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <i className="fa-solid fa-circle-info text-slate-400" aria-hidden="true"></i>
                <span>Visually impaired students can use keyboard navigation and screen-reader shortcuts anytime.</span>
              </div>
              <button
                onClick={endSession}
                className="bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-sm px-6 py-2.5 rounded-lg transition-colors focus-visible:outline-orange-500 flex items-center gap-2"
                aria-label="End Laboratory Session"
              >
                <i className="fa-solid fa-power-off text-xs" aria-hidden="true"></i>
                End Session
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
