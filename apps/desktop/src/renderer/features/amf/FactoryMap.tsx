/** AMF base map: the factory as a building cross-section. A click zooms into a room and shows its
 * interior; the room's Enter button or a double click opens its page. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@vua/design-system";
import { useGateway, type AmfProductionList, type AmfProductionRun } from "../../gateway/index.ts";
import type { PageId } from "../../app/nav-model.ts";
import { strings, format, formatShortDateTime } from "../../i18n/index.ts";
import { currentStation, lineBusy, lineLabels, lineStations, lineStatus, phaseStatus, STATIONS, type LineStatus } from "./factory-model.ts";
import { RoomCanvas, token, useEffectsOn } from "./RoomCanvas.tsx";
import type { SceneFacts } from "./factory-scenes.ts";
import { between, cameraOn, neighbors, OVERVIEW, transformOf, type Camera, type Direction } from "./factory-camera.ts";
import "./factory.css";

const copy = strings.factory;
export type Room = "materials" | "workshop" | "control" | "release";
export const ROOM_PAGES: Record<Room, PageId> = { materials: "warehouse", workshop: "workshop", control: "recipe", release: "release" };
const ROOM_ICONS = { materials: "folder", workshop: "avatar", control: "edit", release: "anim" } as const;
const FLOORS: readonly (readonly [Room, Room])[] = [["control", "materials"], ["release", "workshop"]];
const DIRECTION_ICONS = { left: "arrow-left", right: "arrow-right", up: "arrow-up", down: "chevron-down" } as const;
const PRIORITY: readonly LineStatus[] = ["running", "waiting", "attention", "finished", "stopped", "idle"];
const lineName = (names: readonly string[]) => [...new Set(names.map(name => name.replace(/\.zip$/iu, "")))].join(" + ");

export function FactoryMap({ navigate, initialRoom = null }: { navigate: (page: PageId) => void; initialRoom?: Room | null }) {
  const port = useGateway().amfProduction;
  const [list, setList] = useState<AmfProductionList | null>(null);
  const [recipes, setRecipes] = useState<number | null>(null);
  const [line, setLine] = useState<AmfProductionRun | null>(null);
  const [stage, setStage] = useState<HTMLImageElement | null>(null);
  const [zoomed, setZoomed] = useState<Room | null>(initialRoom);
  const [zoom, setZoom] = useState(1);
  const animated = useEffectsOn();
  const camera = useRef<Camera>(OVERVIEW);
  const flight = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const building = useRef<HTMLDivElement>(null);
  const rooms = useRef(new Map<Room, HTMLDivElement>());
  const statuses = useMemo(() => (list?.runs ?? []).map(run => ({ run, status: phaseStatus(run.phase) })), [list]);
  const lineId = useMemo(() => [...statuses].sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status))[0]?.run.runId ?? null, [statuses]);
  const finished = statuses.filter(item => item.status === "finished");
  const latestFinished = finished[0]?.run.runId ?? null;

  useEffect(() => {
    if (!port) return;
    let alive = true; let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const [observed, saved] = await Promise.all([port.list(), port.listRecipes().catch(() => null)]);
        if (!alive) return;
        setList(observed); if (saved) setRecipes(saved.length);
      } catch { /* The rooms keep their last facts. */ }
      if (alive) timer = setTimeout(() => { void load(); }, 4000);
    };
    void load();
    return () => { alive = false; if (timer !== undefined) clearTimeout(timer); };
  }, [port]);
  useEffect(() => {
    if (!port || !lineId) { setLine(null); return; }
    let alive = true;
    void port.get(lineId).then(run => { if (alive) setLine(run); }).catch(() => { if (alive) setLine(null); });
    return () => { alive = false; };
  }, [port, lineId, list]);
  // The release stage shows the latest finished Avatar from the front.
  useEffect(() => {
    if (!port || !latestFinished) { setStage(null); return; }
    let alive = true;
    void port.get(latestFinished).then(run => {
      const front = run.result?.facts?.previews?.find(view => view.view === "front");
      return front ? port.previewImage(run.runId, front.path) : null;
    }).then(source => {
      if (!alive) return;
      if (!source) { setStage(null); return; }
      const image = new Image(); image.onload = () => { if (alive) setStage(image); }; image.src = source;
    }).catch(() => { if (alive) setStage(null); });
    return () => { alive = false; };
  }, [port, latestFinished]);

  // The camera flies between the overview and rooms with an eased, scripted move. CSS transitions
  // would be flattened when Windows turns animations off; resource-saving mode cuts straight to the view.
  const place = (next: Camera) => { camera.current = next; if (building.current) building.current.style.transform = transformOf(next); };
  const aim = useCallback((instant = false) => {
    const frame = viewport.current; const target = zoomed ? rooms.current.get(zoomed) : null;
    let goal = OVERVIEW;
    if (frame && target && building.current) {
      // Layout offsets are unaffected by the current transform; sum them up to the building.
      let left = 0; let top = 0;
      for (let node: HTMLElement | null = target; node && node !== building.current; node = node.offsetParent as HTMLElement | null) { left += node.offsetLeft; top += node.offsetTop; }
      goal = cameraOn({ left, top, width: target.offsetWidth, height: target.offsetHeight }, { width: frame.clientWidth, height: frame.clientHeight });
    }
    setZoom(goal.scale);
    cancelAnimationFrame(flight.current);
    if (instant || !animated) { place(goal); return; }
    const from = camera.current; const start = performance.now(); const duration = token("--vua-motion-camera", 650);
    const step = (now: number) => {
      const t = (now - start) / duration; place(between(from, goal, t));
      if (t < 1) flight.current = requestAnimationFrame(step);
    };
    flight.current = requestAnimationFrame(step);
  }, [zoomed, animated]);
  useEffect(() => () => cancelAnimationFrame(flight.current), []);
  useLayoutEffect(() => { aim(); }, [aim]);
  useEffect(() => {
    const frame = viewport.current; if (!frame) return;
    const observer = new ResizeObserver(() => aim(true)); observer.observe(frame);
    return () => observer.disconnect();
  }, [aim]);
  useEffect(() => {
    if (!zoomed) return;
    const back = (event: KeyboardEvent) => { if (event.key === "Escape") setZoomed(null); };
    window.addEventListener("keydown", back); return () => window.removeEventListener("keydown", back);
  }, [zoomed]);

  // A reinspection keeps the run's previous phase; the busiest line's steps say what it is doing now.
  const count = (status: LineStatus) => statuses.filter(item => (item.run.runId === line?.runId ? lineStatus(line) : item.status) === status).length;
  const running = count("running"); const waiting = count("waiting"); const attention = count("attention");
  const stations = line ? lineStations(line) : null;
  const labels = lineLabels(list?.runs ?? [], date => formatShortDateTime(date));
  const label = (runId: string, fallback: string) => { const found = labels.get(runId); return found ? (found.extra ? `${found.name} · ${found.extra}` : found.name) : fallback; };
  const facts: SceneFacts = {
    recipes: recipes ?? 0, packages: list?.sources.length ?? 0, image: stage, running: line !== null && lineBusy(line),
    stations: stations ? STATIONS.map(key => ({ key, label: copy.stations[key], state: stations[key] })) : null,
  };
  const around = zoomed ? neighbors(FLOORS, zoomed) : {};

  const bodies: Record<Room, { status: ReactNode; interior: ReactNode }> = {
    control: { status: <span>{recipes === null ? "—" : format(copy.recipesCount, { count: recipes })}</span>, interior: <RoomCanvas room="control" facts={facts} zoom={zoomed === "control" ? zoom : 1}/> },
    materials: { status: <span>{list === null ? "—" : format(copy.materialsCount, { count: list.sources.length })}</span>, interior: <RoomCanvas room="materials" facts={facts} zoom={zoomed === "materials" ? zoom : 1}/> },
    release: {
      status: <><span>{format(copy.finishedCount, { count: finished.length })}</span>
        {finished[0] && <span className="vua-factory__muted">{format(copy.latestFinished, { name: label(finished[0].run.runId, lineName(finished[0].run.sourceNames)) })}</span>}</>,
      interior: <RoomCanvas room="release" facts={facts} zoom={zoomed === "release" ? zoom : 1}/>,
    },
    workshop: {
      status: <>
        <span className="vua-factory__counts">
          {running > 0 && <span data-tone="running">{format(copy.linesRunning, { count: running })}</span>}
          {waiting > 0 && <span data-tone="waiting">{format(copy.linesWaiting, { count: waiting })}</span>}
          {attention > 0 && <span data-tone="attention">{format(copy.linesAttention, { count: attention })}</span>}
          {running + waiting + attention === 0 && <span className="vua-factory__muted">{copy.linesIdle}</span>}
        </span>
        {line && stations && <span className="vua-factory__line">
          <span className="vua-factory__line-name">{label(line.runId, lineName(line.sources.map(source => source.itemName)))}</span>
          <span className="vua-factory__stations" aria-label={copy.stations[currentStation(stations)]}>
            {STATIONS.map(key => <span key={key} data-state={stations[key]} data-current={currentStation(stations) === key || undefined}>{copy.stations[key]}</span>)}
          </span>
        </span>}
      </>,
      interior: <RoomCanvas room="workshop" facts={facts} zoom={zoomed === "workshop" ? zoom : 1}/>,
    },
  };
  const room = (id: Room, wide: boolean) => <div key={id} ref={element => { if (element) rooms.current.set(id, element); else rooms.current.delete(id); }}
    className="vua-factory__room" data-room={id} data-wide={wide || undefined} data-zoomed={zoomed === id || undefined}
    onClick={() => setZoomed(id)} onDoubleClick={() => navigate(ROOM_PAGES[id])}>
    <div className="vua-factory__scene">{bodies[id].interior}</div>
    <div className="vua-factory__label">
    <span className="vua-factory__plate"><span className="vua-factory__tag">{copy.rooms[id].tag}</span><Icon name={ROOM_ICONS[id]} size={20}/></span>
    <button type="button" className="vua-factory__name" data-nav-id={`room-${id}`} aria-expanded={zoomed === id}
      onClick={event => { event.stopPropagation(); setZoomed(zoomed === id ? null : id); }}>{copy.rooms[id].name}</button>
    <span className="vua-factory__hint">{copy.rooms[id].hint}</span>
    <span className="vua-factory__body">{bodies[id].status}</span>
    <button type="button" className="vua-factory__enter" data-nav-id={`enter-${id}`} onClick={event => { event.stopPropagation(); navigate(ROOM_PAGES[id]); }}>
      {copy.enter}<Icon name="arrow-right" size={16}/></button>
    </div>
  </div>;

  return <div className="vua-page vua-factory" data-focus-scope>
    <header className="vua-factory__command">
      <div><h1 className="vua-title">{copy.mapTitle}</h1><p className="vua-text-secondary">{zoomed ? copy.rooms[zoomed].hint : copy.mapIntro}</p></div>
      <div className="vua-factory__alerts" role="status">
        {zoomed && <button type="button" className="vua-factory__alert" data-nav-id="map-overview" onClick={() => setZoomed(null)}><Icon name="arrow-left" size={16}/>{copy.overview}</button>}
        {waiting > 0 && <button type="button" className="vua-factory__alert" data-tone="waiting" onClick={() => navigate("workshop")}><Icon name="bell" size={16}/>{format(copy.waitingBanner, { count: waiting })}</button>}
        {attention > 0 && <button type="button" className="vua-factory__alert" data-tone="attention" onClick={() => navigate("workshop")}><Icon name="warning" size={16}/>{format(copy.attentionBanner, { count: attention })}</button>}
        {!zoomed && waiting === 0 && attention === 0 && <span className="vua-factory__alert" data-tone="clear"><Icon name="check" size={16}/>{copy.allClear}</span>}
      </div>
    </header>
    <div className="vua-factory__viewport" ref={viewport} data-zoomed={zoomed ?? undefined} onClick={event => { if (event.target === event.currentTarget) setZoomed(null); }}>
      <div className="vua-factory__building" ref={building}>
        {FLOORS.map(([left, right], index) => <div key={left} className="vua-factory__floor" data-floor={FLOORS.length - index}>
          {room(left, false)}{room(right, true)}
        </div>)}
      </div>
      {zoomed && (Object.entries(around) as [Direction, Room][]).map(([direction, next]) => <button type="button" key={direction} className="vua-factory__door"
        data-direction={direction} data-room={next} data-nav-id={`door-${next}`} onClick={() => setZoomed(next)}>
        <Icon name={DIRECTION_ICONS[direction]} size={16}/>{copy.rooms[next].name}</button>)}
      {zoomed && <div className="vua-factory__panel" data-room={zoomed} key={zoomed}>
        <span className="vua-factory__panel-title">
          <span className="vua-factory__plate"><Icon name={ROOM_ICONS[zoomed]} size={16}/><span className="vua-factory__tag">{copy.rooms[zoomed].tag}</span></span>
          <h2>{copy.rooms[zoomed].name}</h2>
        </span>
        <span className="vua-factory__body">{bodies[zoomed].status}</span>
        <button type="button" className="vua-factory__enter" data-nav-id="enter-zoomed" onClick={() => navigate(ROOM_PAGES[zoomed])}>{copy.enter}<Icon name="arrow-right" size={16}/></button>
      </div>}
    </div>
    <p className="vua-caption vua-text-secondary vua-factory__tip">{copy.mapTip}</p>
  </div>;
}
