import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  listClientCourses,
  renewClientCourse,
  type ClientCourse,
} from "@/lib/client-courses/repo";
import { courseStatusLabel } from "@/lib/client-courses/format";

const STORAGE_KEY = "panovapro_selected_course";

type ClientCourseContextValue = {
  courses: ClientCourse[];
  selectedCourseId: string | null;
  selectedCourse: ClientCourse | null;
  setSelectedCourseId: (id: string) => void;
  loading: boolean;
  reload: () => Promise<void>;
  renewCourse: () => Promise<ClientCourse | null>;
};

const ClientCourseContext = createContext<ClientCourseContextValue | null>(null);

export function ClientCourseProvider({
  clientId,
  children,
}: {
  clientId: string | null | undefined;
  children: ReactNode;
}) {
  const [courses, setCourses] = useState<ClientCourse[]>([]);
  const [selectedCourseId, setSelectedCourseIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!clientId) {
      setCourses([]);
      setSelectedCourseIdState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const list = await listClientCourses(clientId);
    setCourses(list);

    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem(`${STORAGE_KEY}:${clientId}`) : null;
    const active = list.find((c) => c.status === "active");
    const pick =
      (stored && list.some((c) => c.id === stored) ? stored : null) ??
      active?.id ??
      list[0]?.id ??
      null;
    setSelectedCourseIdState(pick);
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const setSelectedCourseId = useCallback(
    (id: string) => {
      setSelectedCourseIdState(id);
      if (clientId && typeof window !== "undefined") {
        window.localStorage.setItem(`${STORAGE_KEY}:${clientId}`, id);
      }
    },
    [clientId],
  );

  const renewCourse = useCallback(async () => {
    if (!clientId) return null;
    const created = await renewClientCourse(clientId);
    await reload();
    setSelectedCourseId(created.id);
    return created;
  }, [clientId, reload, setSelectedCourseId]);

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) ?? null,
    [courses, selectedCourseId],
  );

  const value = useMemo(
    () => ({
      courses,
      selectedCourseId,
      selectedCourse,
      setSelectedCourseId,
      loading,
      reload,
      renewCourse,
    }),
    [courses, selectedCourseId, selectedCourse, setSelectedCourseId, loading, reload, renewCourse],
  );

  return <ClientCourseContext.Provider value={value}>{children}</ClientCourseContext.Provider>;
}

export function useClientCourses() {
  const ctx = useContext(ClientCourseContext);
  if (!ctx) {
    throw new Error("useClientCourses must be used within ClientCourseProvider");
  }
  return ctx;
}

export { courseStatusLabel };
