import Board from "./components/Board/Board";
import FileMenu from "./components/FileMenu/FileMenu";
import FloatingToolbar from "./components/Toolbar/FloatingToolbar";
import PageArrows from "./components/PageSorter/PageArrows";
import PageSorter from "./components/PageSorter/PageSorter";
import TextEditor from "./components/Text/TextEditor";
import WidgetsLayer from "./components/Widgets/WidgetsLayer";
import ZoomControls from "./components/Zoom/ZoomControls";
import { useAutosave } from "./hooks/useAutosave";
import { useFileShortcuts } from "./hooks/useFileShortcuts";
import { useSessionLifecycle } from "./hooks/useSessionLifecycle";
import { useStartup } from "./hooks/useStartup";
import { APP_NAME, APP_VERSION } from "./lib/app";

export default function App() {
  useSessionLifecycle();
  useFileShortcuts();
  useAutosave();
  useStartup();

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-100">
      <Board />
      <WidgetsLayer />
      <PageArrows />
      <PageSorter />
      <FileMenu />
      <ZoomControls />
      <FloatingToolbar />
      <TextEditor />
      {/* En haut au milieu, là où aucune boîte d'outils ne s'ouvre ; sans capter les clics : on peut dessiner dessous */}
      <div className="pointer-events-none fixed left-1/2 top-2 z-30 -translate-x-1/2 select-none rounded-md bg-white/80 px-2 py-1 text-sm font-semibold text-slate-700 shadow">
        {APP_NAME} v{APP_VERSION}
      </div>
    </div>
  );
}
