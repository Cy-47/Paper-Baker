import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth";
import { DataProvider } from "./hooks/useData";
import { SavePanelProvider } from "./hooks/useSavePanel";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import LandingPage from "./pages/LandingPage";
import DevicePage from "./pages/DevicePage";
import HomePage from "./pages/HomePage";
import FindPage from "./pages/FindPage";
import LibraryPage from "./pages/LibraryPage";
import ProjectPage from "./pages/ProjectPage";
import CliSettingsPage from "./pages/CliSettingsPage";

function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center text-sm" style={{ color: "var(--muted)" }}>
      Loading…
    </div>
  );
}

function Protected() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <DataProvider>
      <SavePanelProvider>
        <AppShell />
      </SavePanelProvider>
    </DataProvider>
  );
}

// Root switches between the signed-in app and the public landing page.
function Root() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return <Navigate to={user ? "/home" : "/site"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Root />} />
      <Route path="/site" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/device" element={<DevicePage />} />
      <Route element={<Protected />}>
        <Route path="/home" element={<HomePage />} />
        <Route path="/find" element={<FindPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/projects/:id" element={<ProjectPage />} />
        <Route path="/clis" element={<CliSettingsPage />} />
      </Route>
    </Routes>
  );
}
