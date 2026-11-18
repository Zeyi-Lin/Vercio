import { useCallback, useEffect, useRef, useState } from "react";

export function useEventStream(
  onEvent: (type: string, data: Record<string, unknown>) => void,
  enabled = true
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    const events = [
      "project.created",
      "project.updated",
      "project.deleted",
      "deployment.created",
      "deployment.updated",
      "note.changed",
      "comment.changed",
      "settings.updated",
    ];
    const source = new EventSource("/api/events");
    const listeners: { type: string; fn: (event: MessageEvent) => void }[] = [];
    for (const type of events) {
      const fn = (event: MessageEvent) => {
        try {
          handlerRef.current(type, JSON.parse(event.data));
        } catch {
          handlerRef.current(type, {});
        }
      };
      source.addEventListener(type, fn);
      listeners.push({ type, fn });
    }
    return () => {
      for (const listener of listeners) source.removeEventListener(listener.type, listener.fn);
      source.close();
    };
  }, [enabled]);
}

export function useDebouncedCallback<T extends (...args: never[]) => void>(fn: T, delay = 250) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef(fn);
  ref.current = fn;
  const callback = useCallback(
    (...args: Parameters<T>) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => ref.current(...args), delay);
    },
    [delay]
  );
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return callback;
}

export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active = true) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside, active]);
  return ref;
}

export function useLocalStorage(key: string, initial: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) ?? initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: string) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {}
    },
    [key]
  );
  return [value, update];
}

export function useInterval(callback: () => void, delay: number | null) {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (delay === null) return;
    const timer = setInterval(() => saved.current(), delay);
    return () => clearInterval(timer);
  }, [delay]);
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );
  useEffect(() => {
    const media = window.matchMedia(query);
    const listener = () => setMatches(media.matches);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [query]);
  return matches;
}
