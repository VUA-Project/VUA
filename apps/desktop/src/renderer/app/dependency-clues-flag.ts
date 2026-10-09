import { useEffect, useState } from "react";
import { storageKeys } from "./storage-keys.ts";

const CHANGED_EVENT = "vua-dependency-clues-changed";
// Keep a working session preference even when persistent storage is unavailable.
let sessionPreference: boolean | undefined;

export function loadDependencyClues(): boolean {
  if (sessionPreference !== undefined) return sessionPreference;
  try {
    return localStorage.getItem(storageKeys.dependencyClues) === "on";
  } catch {
    return false;
  }
}

export function saveDependencyClues(on: boolean): void {
  sessionPreference = on;
  try {
    localStorage.setItem(storageKeys.dependencyClues, on ? "on" : "off");
  } catch {
    // The current window still receives the user's choice.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

export function useDependencyClues(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(loadDependencyClues);
  useEffect(() => {
    const sync = () => setOn(loadDependencyClues());
    const external = (event: StorageEvent) => {
      if (event.key !== null && event.key !== storageKeys.dependencyClues) return;
      sessionPreference = undefined;
      sync();
    };
    window.addEventListener(CHANGED_EVENT, sync);
    window.addEventListener("storage", external);
    sync();
    return () => {
      window.removeEventListener(CHANGED_EVENT, sync);
      window.removeEventListener("storage", external);
    };
  }, []);
  return [on, saveDependencyClues];
}
