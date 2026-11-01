import { useEffect } from "react";
import { runStartup } from "../lib/startup";

export function useStartup() {
  useEffect(() => {
    void runStartup();
  }, []);
}
