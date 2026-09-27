import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col justify-between">
      {/* Top minimal bar */}
      <header className="px-6 py-4 border-b border-slate-200 bg-white shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-purple-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              <i className="fa-solid fa-flask-vial" aria-hidden="true"></i>
            </div>
            <span className="font-extrabold text-slate-900 text-lg tracking-tight">ThiranNexus LabSense</span>
          </div>
          <Link
            to="/simulation"
            className="text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3.5 py-1.5 rounded-lg transition-colors focus-visible:outline-orange-500 flex items-center gap-1.5"
          >
            <i className="fa-solid fa-gamepad" aria-hidden="true"></i>
            Hardware Simulator
          </Link>
        </div>
      </header>

      {/* Hero Content */}
      <main className="max-w-4xl mx-auto text-center px-6 py-12 md:py-16 my-auto">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200 mb-6">
          <i className="fa-solid fa-universal-access text-orange-600" aria-hidden="true"></i>
          Assistive IoT Laboratory Learning System
        </div>

        <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold text-purple-950 tracking-tight mb-4">
          Independent Science Learning for Visually Impaired Students
        </h1>

        <p className="text-lg md:text-xl text-slate-600 max-w-2xl mx-auto mb-10 leading-relaxed font-normal">
          Identifies apparatus via RFID, speaks purpose and safety precautions aloud, guides students through titration stages, and streams real-time sensor observations to teachers.
        </p>

        {/* Feature Badges */}
        <div className="grid sm:grid-cols-3 gap-4 mb-10 text-left max-w-3xl mx-auto">
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center text-lg mb-3">
              <i className="fa-solid fa-volume-high" aria-hidden="true"></i>
            </div>
            <h2 className="text-sm font-bold text-slate-900 mb-1">Spoken Instructions</h2>
            <p className="text-xs text-slate-500 leading-normal">
              Instant voice readout of equipment name, usage, and safety precautions.
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center text-lg mb-3">
              <i className="fa-solid fa-diagram-project" aria-hidden="true"></i>
            </div>
            <h2 className="text-sm font-bold text-slate-900 mb-1">Stage-Gated Titration</h2>
            <p className="text-xs text-slate-500 leading-normal">
              Colour sensor monitoring activates strictly during the titration endpoint stage.
            </p>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg mb-3">
              <i className="fa-solid fa-chalkboard-user" aria-hidden="true"></i>
            </div>
            <h2 className="text-sm font-bold text-slate-900 mb-1">Teacher Verification</h2>
            <p className="text-xs text-slate-500 leading-normal">
              Live multi-bench dashboard alerts instructors to verify observations in real time.
            </p>
          </div>
        </div>

        {/* Portal Entry Buttons */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
          <Link
            to="/student"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-orange-500"
            aria-label="Enter Student Dashboard"
          >
            <i className="fa-solid fa-graduation-cap" aria-hidden="true"></i>
            Enter Student Dashboard
          </Link>
          <Link
            to="/teacher"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-purple-700 hover:bg-purple-800 text-white font-extrabold text-lg px-8 py-4 rounded-xl shadow-md transition-transform hover:-translate-y-0.5 focus-visible:outline-orange-500"
            aria-label="Enter Teacher Dashboard"
          >
            <i className="fa-solid fa-chalkboard-user" aria-hidden="true"></i>
            Enter Teacher Dashboard
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-400">
        <p>Part of the ThiranNexus platform · Standalone accessible laboratory system</p>
      </footer>
    </div>
  );
}
