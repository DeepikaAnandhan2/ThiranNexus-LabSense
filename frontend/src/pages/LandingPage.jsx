import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-white text-lab-ink flex flex-col items-center justify-center p-6">
      <div className="max-w-3xl text-center">
        <p className="uppercase tracking-widest text-lab-accent text-sm font-bold mb-3">
          ThiranNexus Platform
        </p>
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4 text-lab-primary">
          LabSense
        </h1>
        <p className="text-lg md:text-xl text-gray-700 mb-2">
          An IoT-Based Assistive Laboratory Learning and Monitoring System
        </p>
        <p className="text-base md:text-lg text-lab-secondary font-semibold mb-10">
          for Visually Impaired Students
        </p>

        <p className="text-gray-600 mb-10 leading-relaxed">
          LabSense identifies laboratory apparatus automatically using RFID
          tags, speaks equipment descriptions and safety instructions aloud,
          guides students step by step through experiments, and gives
          teachers a real-time view of every active bench — including
          colour-change sensor alerts that need verification.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link
            to="/student"
            className="bg-lab-secondary hover:bg-lab-secondaryDark focus-visible:outline-4 text-white text-xl font-semibold px-10 py-5 rounded-xl transition-colors shadow-md shadow-green-200"
            aria-label="Enter Student Dashboard"
          >
            🎓 Student Dashboard
          </Link>
          <Link
            to="/teacher"
            className="bg-lab-primary hover:bg-lab-primaryDark focus-visible:outline-4 text-white text-xl font-semibold px-10 py-5 rounded-xl transition-colors shadow-md shadow-purple-200"
            aria-label="Enter Teacher Dashboard"
          >
            🧑‍🏫 Teacher Dashboard
          </Link>
        </div>
      </div>

      <footer className="mt-16 text-xs text-gray-400 text-center">
        Part of the ThiranNexus platform · No separate sign-in required
        <br />
        <Link to="/simulation" className="underline hover:text-lab-accent">
          🛠 Developer Simulation (test hardware events without an ESP32)
        </Link>
      </footer>
    </main>
  );
}
