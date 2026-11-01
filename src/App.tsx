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
    </div>
  );
}
