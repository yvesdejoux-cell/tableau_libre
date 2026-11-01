import { useWidgetStore } from "../../store/useWidgetStore";
import CompassView from "./CompassView";
import ProtractorView from "./ProtractorView";
import RulerView from "./RulerView";
import ShadeView from "./ShadeView";
import SquareView from "./SquareView";

export default function WidgetsLayer() {
  const widgets = useWidgetStore((s) => s.widgets);
  return (
    // La couche ne capte rien : seuls les widgets (pointer-events-auto) interceptent les pointeurs
    <div className="pointer-events-none fixed inset-0 z-30 overflow-hidden">
      {widgets.map((w) => {
        switch (w.type) {
          case "ruler":
            return <RulerView key={w.id} w={w} />;
          case "square":
            return <SquareView key={w.id} w={w} />;
          case "protractor":
            return <ProtractorView key={w.id} w={w} />;
          case "compass":
            return <CompassView key={w.id} w={w} />;
          case "shade":
            return <ShadeView key={w.id} w={w} />;
        }
      })}
    </div>
  );
}
