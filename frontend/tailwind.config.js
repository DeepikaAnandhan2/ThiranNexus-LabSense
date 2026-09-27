/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Shared lab-monitoring brand palette (used by both dashboards)
        lab: {
          primary: "#7C3AED",   // purple - headers, primary actions
          primaryDark: "#5B21B6",
          secondary: "#16A34A", // green - success/active states, start actions
          secondaryDark: "#15803D",
          accent: "#F97316",    // orange - highlights, key CTAs, focus rings
          accentDark: "#C2410C",
          alert: "#DC2626",     // red - sensor/teacher alerts
          warning: "#D97706",   // amber - caution states
          surface: "#FFFFFF",   // page background
          surfaceAlt: "#F8FAFC",// card background
          ink: "#1E1B2E",       // primary text on white
        },
      },
      fontSize: {
        // Larger base sizes to support the accessible student interface
        "student-base": "1.25rem",
        "student-lg": "1.75rem",
        "student-xl": "2.5rem",
      },
    },
  },
  plugins: [],
};
