import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { Box, Edit3, Eye, Grid3X3, MapPin, Minus, Move, Plus, Power, Radio, RadioTower, RefreshCw, RotateCcw, Trash2, Triangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { BaseStation, EditorStage, InteriorShape, Point, Room, StationIcon } from "../types";
import {
  COVERAGE_RANGE_METERS,
  SNAP_STEPS,
  GRID_STEP_METERS,
  VIEW_HEIGHT_METERS,
  VIEW_WIDTH_METERS,
  clampPoint,
  coverageSectorPath,
  createId,
  distance,
  formatMeters,
  isSimplePolygon,
  midpoint,
  pointInPolygon,
  pointInPolygonInterior,
  polygonArea,
  roomCentroid,
  shadowVolumes,
} from "../lib/geometry";
import { cameraDimensions, clampCamera, frameRoomCamera, type Camera, zoomCameraAt } from "../lib/viewport";
import { AppSelect } from "./AppSelect";

type Props = {
  stage: EditorStage;
  room: Room;
  stations: BaseStation[];
  snapStep: number;
  placingStationId: string | null;
  selectedPointId: string | null;
  selectedShapeId: string | null;
  drawingShape: boolean;
  busyStationIds: string[];
  poweringAll: boolean;
  refreshingStates: boolean;
  onRoomChange: (room: Room) => void;
  onStationsChange: (stations: BaseStation[]) => void;
  onSelectPoint: (pointId: string | null) => void;
  onSelectShape: (shapeId: string | null) => void;
  onShapeDrawingChange: (active: boolean) => void;
  onPlacementComplete: () => void;
  onEditStation: (station: BaseStation) => void;
  onToggleStation: (station: BaseStation) => void;
  onPowerAll: (poweredOn: boolean) => void;
  onRefreshStates: () => void;
  onSnapStepChange: (snapStep: number) => void;
};

type ContextMenuState = { stationId: string; x: number; y: number };
type DragTarget =
  | { type: "room"; id: string }
  | { type: "shape"; shapeId: string; pointId: string }
  | { type: "station"; id: string }
  | { type: "rotation"; id: string }
  | null;

const ICONS: Record<StationIcon, LucideIcon> = { tower: RadioTower, radio: Radio, box: Box, triangle: Triangle };
export function RoomCanvas({
  stage,
  room,
  stations,
  snapStep,
  placingStationId,
  selectedPointId,
  selectedShapeId,
  drawingShape,
  busyStationIds,
  poweringAll,
  refreshingStates,
  onRoomChange,
  onStationsChange,
  onSelectPoint,
  onSelectShape,
  onShapeDrawingChange,
  onPlacementComplete,
  onEditStation,
  onToggleStation,
  onPowerAll,
  onRefreshStates,
  onSnapStepChange,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const panStartRef = useRef<{ clientX: number; clientY: number; camera: Camera } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragMovedRef = useRef(false);
  const spacePressedRef = useRef(false);
  const framedRoomRef = useRef<string | null>(null);
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [cursor, setCursor] = useState<Point | null>(null);
  const [dragging, setDragging] = useState<DragTarget>(null);
  const [draftShape, setDraftShape] = useState<Point[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const cameraSize = cameraDimensions(camera);
  const viewBox = `${camera.x} ${camera.y} ${cameraSize.width} ${cameraSize.height}`;
  const roomArea = polygonArea(room.points);
  const placedCount = stations.filter((station) => station.position).length;
  const selectedShape = room.shapes.find((shape) => shape.id === selectedShapeId) ?? null;
  const busyStationSet = useMemo(() => new Set(busyStationIds), [busyStationIds]);

  const roomSegments = useMemo(() => {
    const output: { start: Point; end: Point; insertIndex: number }[] = [];
    for (let index = 0; index < room.points.length - 1; index += 1) {
      output.push({ start: room.points[index], end: room.points[index + 1], insertIndex: index + 1 });
    }
    if (room.closed && room.points.length > 2) output.push({ start: room.points.at(-1)!, end: room.points[0], insertIndex: room.points.length });
    return output;
  }, [room.closed, room.points]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.code === "Space") spacePressedRef.current = true; };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === "Space") spacePressedRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!drawingShape) setDraftShape([]);
  }, [drawingShape]);

  useEffect(() => {
    if (!room.closed || room.points.length < 3) {
      framedRoomRef.current = null;
      return;
    }
    if (framedRoomRef.current === room.id) return;

    setCamera(frameRoomCamera(room.points));
    framedRoomRef.current = room.id;
  }, [room.closed, room.id, room.points]);

  function eventPoint(event: Pick<ReactPointerEvent<SVGElement> | ReactWheelEvent<SVGElement>, "clientX" | "clientY">): Point {
    const svg = svgRef.current;
    if (!svg) return { id: "cursor", x: 0, y: 0 };
    const screenPoint = svg.createSVGPoint();
    screenPoint.x = event.clientX;
    screenPoint.y = event.clientY;
    const matrix = svg.getScreenCTM()?.inverse();
    const local = matrix ? screenPoint.matrixTransform(matrix) : screenPoint;
    return clampPoint({ id: "cursor", x: local.x, y: local.y }, snapStep);
  }

  function startPan(event: ReactPointerEvent<SVGSVGElement>) {
	    event.preventDefault();
    panStartRef.current = { clientX: event.clientX, clientY: event.clientY, camera };
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function updatePan(event: ReactPointerEvent<SVGSVGElement>) {
    if (!panStartRef.current) return;
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const { width, height } = cameraDimensions(panStartRef.current.camera);
    const dx = ((event.clientX - panStartRef.current.clientX) / bounds.width) * width;
    const dy = ((event.clientY - panStartRef.current.clientY) / bounds.height) * height;
    setCamera(clampCamera({ ...panStartRef.current.camera, x: panStartRef.current.camera.x - dx, y: panStartRef.current.camera.y - dy }));
  }

  function zoomAt(point: Point, nextZoom: number) {
    setCamera((current) => zoomCameraAt(current, point, nextZoom));
  }

  function handleWheel(event: ReactWheelEvent<SVGSVGElement>) {
    event.preventDefault();
    zoomAt(eventPoint(event), camera.zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  function updateRoomPoint(id: string, point: Point) {
    onRoomChange({ ...room, points: room.points.map((item) => item.id === id ? { ...item, x: point.x, y: point.y } : item) });
  }

  function updateShapePoint(shapeId: string, pointId: string, point: Point) {
    const shapes = room.shapes.map((shape) => shape.id !== shapeId ? shape : {
      ...shape,
      points: shape.points.map((item) => item.id === pointId ? { ...item, x: point.x, y: point.y } : item),
    });
    const updated = shapes.find((shape) => shape.id === shapeId);
    if (updated && (!updated.points.every((item) => pointInPolygonInterior(item, room.points)) || !isSimplePolygon(updated.points))) return;
    onRoomChange({ ...room, shapes });
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button === 1 || (event.button === 0 && spacePressedRef.current)) {
      event.preventDefault();
      startPan(event);
      return;
    }
    if (event.button !== 0) return;
    event.preventDefault();
    setContextMenu(null);
    const point = eventPoint(event);

    if (stage === "room") {
      onSelectPoint(null);
      onSelectShape(null);
      if (drawingShape) {
        if (room.closed && pointInPolygonInterior(point, room.points)) setDraftShape((current) => [...current, { ...point, id: createId("shape-corner") }]);
        return;
      }
      if (!room.closed) onRoomChange({ ...room, points: [...room.points, { ...point, id: createId("corner") }] });
      return;
    }

    if (stage === "stations" && placingStationId && room.closed && pointInPolygon(point, room.points)) {
      const center = roomCentroid(room.points);
      onStationsChange(stations.map((station) => station.id === placingStationId ? {
        ...station,
        position: { ...point, id: `position-${station.id}` },
        coverageRotation: station.position ? station.coverageRotation : angleTo(point, center),
      } : station));
      onPlacementComplete();
    }
  }

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const point = eventPoint(event);
    setCursor(point);
    if (panStartRef.current) {
      updatePan(event);
      return;
    }
    if (dragStartRef.current) {
      const movement = Math.hypot(event.clientX - dragStartRef.current.x, event.clientY - dragStartRef.current.y);
      if (movement > 3) dragMovedRef.current = true;
    }
    if (dragging?.type === "room") updateRoomPoint(dragging.id, point);
    if (dragging?.type === "shape") updateShapePoint(dragging.shapeId, dragging.pointId, point);
    if (dragging?.type === "station" && room.closed && pointInPolygon(point, room.points)) {
      onStationsChange(stations.map((station) => station.id === dragging.id ? { ...station, position: { ...point, id: `position-${station.id}` } } : station));
    }
    if (dragging?.type === "rotation") {
      const station = stations.find((item) => item.id === dragging.id);
      if (station?.position) {
        onStationsChange(stations.map((item) => item.id === station.id ? { ...item, coverageRotation: angleTo(station.position!, point) } : item));
      }
    }
  }

  function finishDrag(event: ReactPointerEvent<SVGSVGElement>) {
    if (dragging?.type === "station" && !dragMovedRef.current) {
      const station = stations.find((item) => item.id === dragging.id);
      if (station) onToggleStation(station);
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId);
    panStartRef.current = null;
    setDragging(null);
    dragStartRef.current = null;
    dragMovedRef.current = false;
  }

  function startRoomPointDrag(event: ReactPointerEvent<SVGGElement>, point: Point, index: number) {
    event.stopPropagation();
    if (stage !== "room" || event.button !== 0 || drawingShape) return;
    event.preventDefault();
    if (!room.closed && index === 0 && room.points.length >= 3) {
      onRoomChange({ ...room, closed: true });
      onSelectPoint(point.id);
      return;
    }
    onSelectPoint(point.id);
    onSelectShape(null);
    setDragging({ type: "room", id: point.id });
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function insertRoomPoint(event: ReactPointerEvent<SVGLineElement>, insertIndex: number) {
    event.stopPropagation();
    if (stage !== "room" || !room.closed || event.button !== 0 || drawingShape) return;
    event.preventDefault();
    const inserted = { ...eventPoint(event), id: createId("corner") };
    const points = [...room.points];
    points.splice(insertIndex, 0, inserted);
    onRoomChange({ ...room, points });
    onSelectPoint(inserted.id);
  }

  function closeDraftShape(event: ReactPointerEvent<SVGGElement>) {
    event.stopPropagation();
    if (draftShape.length < 3 || !isSimplePolygon(draftShape)) return;
    const shape: InteriorShape = { id: createId("shape"), name: `Object ${room.shapes.length + 1}`, points: draftShape, isTall: false };
    onRoomChange({ ...room, shapes: [...room.shapes, shape] });
    onSelectShape(shape.id);
    onShapeDrawingChange(false);
  }

  function startShapePointDrag(event: ReactPointerEvent<SVGGElement>, shapeId: string, point: Point) {
    event.stopPropagation();
    if (stage !== "room" || event.button !== 0 || drawingShape) return;
    event.preventDefault();
    onSelectShape(shapeId);
    onSelectPoint(null);
    setDragging({ type: "shape", shapeId, pointId: point.id });
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function insertShapePoint(event: ReactPointerEvent<SVGLineElement>, shape: InteriorShape, index: number) {
    event.stopPropagation();
    if (stage !== "room" || selectedShapeId !== shape.id || drawingShape || event.button !== 0) return;
    event.preventDefault();
    const point = { ...eventPoint(event), id: createId("shape-corner") };
    if (!pointInPolygonInterior(point, room.points)) return;
    const points = [...shape.points];
    points.splice(index + 1, 0, point);
    if (!isSimplePolygon(points)) return;
    onRoomChange({ ...room, shapes: room.shapes.map((item) => item.id === shape.id ? { ...item, points } : item) });
  }

  function startStationDrag(event: ReactPointerEvent<SVGGElement>, station: BaseStation) {
    event.stopPropagation();
    if (event.button !== 0 || busyStationSet.has(station.id)) return;
    event.preventDefault();
    setContextMenu(null);
    if (stage === "overview") {
      onToggleStation(station);
      return;
    }
    if (stage !== "stations") return;
    setDragging({ type: "station", id: station.id });
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function startStationRotation(event: ReactPointerEvent<SVGGElement>, station: BaseStation) {
    event.stopPropagation();
    if (stage !== "stations" || event.button !== 0 || busyStationSet.has(station.id)) return;
    event.preventDefault();
    setContextMenu(null);
    setDragging({ type: "rotation", id: station.id });
    dragStartRef.current = { x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    svgRef.current?.setPointerCapture(event.pointerId);
  }

  function openStationMenu(event: ReactMouseEvent<SVGGElement>, station: BaseStation) {
    if (stage !== "stations") return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = canvasRef.current?.getBoundingClientRect();
    setContextMenu({ stationId: station.id, x: event.clientX - (bounds?.left ?? 0), y: event.clientY - (bounds?.top ?? 0) });
  }

  const menuStation = contextMenu ? stations.find((station) => station.id === contextMenu.stationId) : undefined;
  const roomCentroidPoint = roomCentroid(room.points);

  return (
    <div className={`room-canvas ${placingStationId ? "placement-mode" : ""} ${stage === "overview" ? "overview-canvas" : ""}`} ref={canvasRef} onContextMenu={(event) => event.preventDefault()}>
      <div className="canvas-toolbar">
        <div className="canvas-mode">
          {stage === "overview" ? <Eye size={16} /> : stage === "room" ? <Move size={16} /> : <MapPin size={16} />}
          <span><strong>{stage === "overview" ? "Room overview" : stage === "room" ? drawingShape ? "Draw interior shape" : "Room editor" : placingStationId ? "Place base station" : "Base-station setup"}</strong><small>{stage === "room" ? `${snapStep} m snapping` : `${placedCount} stations placed`}</small></span>
        </div>
        <div className="canvas-toolbar-actions">
          {stage === "overview" && <div className="overview-power-actions"><button className="button button-ghost" onClick={onRefreshStates} disabled={poweringAll || refreshingStates || stations.length === 0}><RefreshCw size={15} className={refreshingStates ? "spin-icon" : undefined} /> {refreshingStates ? "Refreshing…" : "Refresh states"}</button><div className="bulk-power-actions"><button className="button button-primary" onClick={() => onPowerAll(true)} disabled={poweringAll || refreshingStates || stations.length === 0}><Power size={15} /> On all</button><button className="button button-ghost" onClick={() => onPowerAll(false)} disabled={poweringAll || refreshingStates || stations.length === 0}><Power size={15} /> Off all</button></div></div>}
          {stage !== "overview" && <div className="snap-control" title="Point snapping distance"><Grid3X3 size={14} /><span>Snap</span><AppSelect className="snap-select" value={snapStep} options={SNAP_STEPS.map((step) => ({ value: step, label: `${step} m` }))} ariaLabel="Point snapping distance" onChange={onSnapStepChange} /></div>}
          <div className="canvas-metrics"><span><small>Area</small><strong>{room.closed ? `${roomArea.toFixed(2)} m²` : "—"}</strong></span><span><small>Grid</small><strong>{GRID_STEP_METERS} m</strong></span></div>
          <div className="zoom-controls"><button className="icon-button" onClick={() => zoomAt(roomCentroidPoint, camera.zoom / 1.25)} title="Zoom out" aria-label="Zoom out"><Minus size={15} /></button><button className="zoom-label" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} title="Reset view">{Math.round(camera.zoom * 100)}%</button><button className="icon-button" onClick={() => zoomAt(roomCentroidPoint, camera.zoom * 1.25)} title="Zoom in" aria-label="Zoom in"><Plus size={15} /></button><button className="icon-button" onClick={() => setCamera({ x: 0, y: 0, zoom: 1 })} title="Reset view" aria-label="Reset view"><RotateCcw size={15} /></button></div>
        </div>
      </div>

      <svg ref={svgRef} className="editor-svg" viewBox={viewBox} preserveAspectRatio="xMidYMid meet" onPointerDown={handleCanvasPointerDown} onPointerMove={handlePointerMove} onPointerUp={finishDrag} onPointerCancel={finishDrag} onPointerLeave={() => !dragging && !panStartRef.current && setCursor(null)} onWheel={handleWheel} onDragStart={(event) => event.preventDefault()}>
        <defs>
          <pattern id="minor-grid" width="0.1" height="0.1" patternUnits="userSpaceOnUse"><path d="M .1 0 L 0 0 0 .1" fill="none" stroke="rgba(255,255,255,.022)" strokeWidth=".012" /></pattern>
          <pattern id="major-grid" width={GRID_STEP_METERS} height={GRID_STEP_METERS} patternUnits="userSpaceOnUse"><rect width={GRID_STEP_METERS} height={GRID_STEP_METERS} fill="url(#minor-grid)" /><path d={`M ${GRID_STEP_METERS} 0 L 0 0 0 ${GRID_STEP_METERS}`} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth=".014" /></pattern>
          <filter id="station-shadow" x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="0" dy=".05" stdDeviation=".08" floodColor="#000" floodOpacity=".65" /></filter>
          {room.closed && <clipPath id="room-clip"><polygon points={room.points.map((point) => `${point.x},${point.y}`).join(" ")} /></clipPath>}
          {stations.filter((station) => station.position && station.poweredOn).map((station) => <CoverageDefinitions key={station.id} station={station} />)}
        </defs>
        <rect width={VIEW_WIDTH_METERS} height={VIEW_HEIGHT_METERS} className="canvas-hit-area" fill="url(#major-grid)" />
        {room.points.length >= 3 && room.closed && <polygon points={room.points.map((point) => `${point.x},${point.y}`).join(" ")} className="room-fill" />}

        {room.closed && <g clipPath="url(#room-clip)">{stations.filter((station) => station.position && station.poweredOn).map((station) => <CoverageLayer key={station.id} station={station} shapes={room.shapes} />)}</g>}

        {roomSegments.map((segment) => <g key={`${segment.start.id}-${segment.end.id}`}><line x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} className="wall-line-hit" pointerEvents={drawingShape ? "none" : undefined} onPointerDown={(event) => insertRoomPoint(event, segment.insertIndex)} /><line x1={segment.start.x} y1={segment.start.y} x2={segment.end.x} y2={segment.end.y} className={`wall-line ${room.closed ? "closed" : ""}`} pointerEvents="none" />{stage === "room" && <SegmentMeasurement start={segment.start} end={segment.end} />}</g>)}

        {!room.closed && room.points.length > 0 && cursor && <g pointerEvents="none"><line x1={room.points.at(-1)!.x} y1={room.points.at(-1)!.y} x2={cursor.x} y2={cursor.y} className="preview-line" />{stage === "room" && <SegmentMeasurement start={room.points.at(-1)!} end={cursor} preview />}</g>}

        {room.shapes.map((shape) => <InteriorShapeLayer key={shape.id} shape={shape} selected={stage === "room" && selectedShapeId === shape.id} editable={stage === "room" && selectedShapeId === shape.id && !drawingShape} onSelect={(event) => { event.stopPropagation(); if (stage === "room" && !drawingShape) { onSelectShape(shape.id); onSelectPoint(null); } }} onInsert={(event, index) => insertShapePoint(event, shape, index)} onPointDown={(event, point) => startShapePointDrag(event, shape.id, point)} />)}

        {stage === "room" && room.points.map((point, index) => <g key={point.id} className={`corner-point ${selectedPointId === point.id ? "selected" : ""} ${!room.closed && index === 0 && room.points.length >= 3 ? "closable" : ""}`} transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => startRoomPointDrag(event, point, index)}>{!room.closed && index === 0 && room.points.length >= 3 && <circle className="close-halo" r=".25" />}<circle className="point-outer" r=".14" /><circle className="point-inner" r=".065" />{!room.closed && index === 0 && room.points.length >= 3 && <g className="close-point-label" pointerEvents="none"><rect x="-.44" y="-.54" width=".88" height=".28" rx=".08" /><text y="-.355">Close room</text></g>}</g>)}

        {drawingShape && draftShape.length > 0 && <DraftShape points={draftShape} cursor={cursor} onClose={closeDraftShape} />}
        {stations.filter((station) => station.position).map((station) => <StationMarker key={station.id} station={station} busy={busyStationSet.has(station.id)} canRotate={stage === "stations"} onPointerDown={(event) => startStationDrag(event, station)} onRotateStart={(event) => startStationRotation(event, station)} onContextMenu={(event) => openStationMenu(event, station)} />)}
        {stage === "stations" && placingStationId && cursor && room.closed && <g transform={`translate(${cursor.x} ${cursor.y})`} className={`placement-cursor ${pointInPolygon(cursor, room.points) ? "valid" : "invalid"}`} pointerEvents="none"><circle r=".3" /><path d="M-.12 0h.24M0-.12v.24" /></g>}
      </svg>

      {room.points.length === 0 && stage === "room" && <div className="canvas-empty-instruction"><span><Move size={22} /></span><strong>Click to place the first corner</strong><p>Trace the room clockwise or counter-clockwise. Distances are measured in meters.</p></div>}
      {stage === "stations" && room.closed && stations.length === 0 && <div className="canvas-empty-instruction compact"><span><MapPin size={22} /></span><strong>Discover a base station</strong><p>Nearby devices will appear in the panel on the right.</p></div>}

      {contextMenu && menuStation && <div className="canvas-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}><div className="context-menu-title"><span style={{ background: menuStation.outlineColor }} />{menuStation.name}</div><button onClick={() => { onEditStation(menuStation); setContextMenu(null); }}><Edit3 size={15} /> Edit station</button><button onClick={() => { onToggleStation(menuStation); setContextMenu(null); }}><Power size={15} /> Turn {menuStation.poweredOn ? "off" : "on"}</button><div className="context-separator" /><button className="danger" onClick={() => { onStationsChange(stations.map((station) => station.id === menuStation.id ? { ...station, position: undefined } : station)); setContextMenu(null); }}><Trash2 size={15} /> Remove from room</button></div>}

      {stage !== "overview" && <div className="canvas-footer-hint">{stage === "room" ? <><Move size={14} /> {drawingShape ? "Click inside the room, away from walls · Click its first corner to finish" : "Drag corners or object vertices · Click an edge to add a point"}</> : placingStationId ? <><MapPin size={14} /> Click inside the polygon to place · Esc to cancel</> : <><Power size={14} /> Click toggles power · Drag repositions · Right-click edits</>}</div>}
    </div>
  );
}

function angleTo(from: Point, to: Point): number {
  return ((Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI) + 360) % 360;
}

function CoverageDefinitions({ station }: { station: BaseStation }) {
  const position = station.position!;
  const id = station.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const sector = coverageSectorPath(position, station.coverageAngle, station.coverageRotation);
  return <><radialGradient id={`coverage-gradient-${id}`} gradientUnits="userSpaceOnUse" cx={position.x} cy={position.y} r={COVERAGE_RANGE_METERS}><stop offset="0%" stopColor={station.outlineColor} stopOpacity=".34" /><stop offset="62%" stopColor={station.outlineColor} stopOpacity=".16" /><stop offset="100%" stopColor={station.outlineColor} stopOpacity="0" /></radialGradient><clipPath id={`coverage-sector-${id}`}><path d={sector} /></clipPath></>;
}

function CoverageLayer({ station, shapes }: { station: BaseStation; shapes: InteriorShape[] }) {
  const id = station.id.replace(/[^a-zA-Z0-9_-]/g, "-");
  const sector = coverageSectorPath(station.position!, station.coverageAngle, station.coverageRotation);
  return <g clipPath={`url(#coverage-sector-${id})`} className="coverage-layer"><path d={sector} fill={`url(#coverage-gradient-${id})`} />{shapes.filter((shape) => shape.isTall).flatMap((shape) => shadowVolumes(station.position!, shape).map((volume, index) => <path key={`${shape.id}-${index}`} d={volume} className="coverage-shadow" />))}</g>;
}

function InteriorShapeLayer({ shape, selected, editable, onSelect, onInsert, onPointDown }: { shape: InteriorShape; selected: boolean; editable: boolean; onSelect: (event: ReactPointerEvent<SVGPolygonElement>) => void; onInsert: (event: ReactPointerEvent<SVGLineElement>, index: number) => void; onPointDown: (event: ReactPointerEvent<SVGGElement>, point: Point) => void }) {
  const label = roomCentroid(shape.points);
  return <g className={`interior-shape ${shape.isTall ? "tall" : ""} ${selected ? "selected" : ""}`}><polygon points={shape.points.map((point) => `${point.x},${point.y}`).join(" ")} onPointerDown={onSelect} />{editable && shape.points.map((point, index) => { const end = shape.points[(index + 1) % shape.points.length]; return <g key={point.id}><line className="shape-line-hit" x1={point.x} y1={point.y} x2={end.x} y2={end.y} onPointerDown={(event) => onInsert(event, index)} /><g className="shape-point" transform={`translate(${point.x} ${point.y})`} onPointerDown={(event) => onPointDown(event, point)}><circle r=".095" /></g></g>; })}<g className="shape-label" pointerEvents="none" transform={`translate(${label.x} ${label.y})`}><text y=".025">{shape.name}</text>{shape.isTall && <text className="shape-height-label" y=".12">tall</text>}</g></g>;
}

function DraftShape({ points, cursor, onClose }: { points: Point[]; cursor: Point | null; onClose: (event: ReactPointerEvent<SVGGElement>) => void }) {
  const lines = points.map((point, index) => ({ point, next: points[index + 1] })).filter((item): item is { point: Point; next: Point } => Boolean(item.next));
  return <g className="draft-shape" pointerEvents="none">{lines.map(({ point, next }) => <line key={point.id} x1={point.x} y1={point.y} x2={next.x} y2={next.y} />)}{cursor && <line x1={points.at(-1)!.x} y1={points.at(-1)!.y} x2={cursor.x} y2={cursor.y} />}{points.map((point, index) => <g key={point.id} transform={`translate(${point.x} ${point.y})`} pointerEvents={index === 0 && points.length >= 3 ? "all" : "none"} onPointerDown={index === 0 ? onClose : undefined}><circle className={index === 0 && points.length >= 3 ? "draft-close-point" : "draft-point"} r=".11" /></g>)}</g>;
}

function SegmentMeasurement({ start, end, preview = false }: { start: Point; end: Point; preview?: boolean }) {
  const center = midpoint(start, end);
  return <g className={`measurement-label ${preview ? "preview" : ""}`} transform={`translate(${center.x} ${center.y})`} pointerEvents="none"><rect x="-.43" y="-.16" width=".86" height=".32" rx=".09" /><text y=".045">{formatMeters(distance(start, end))}</text></g>;
}

function StationMarker({ station, busy, canRotate, onPointerDown, onRotateStart, onContextMenu }: { station: BaseStation; busy: boolean; canRotate: boolean; onPointerDown: (event: ReactPointerEvent<SVGGElement>) => void; onRotateStart: (event: ReactPointerEvent<SVGGElement>) => void; onContextMenu: (event: ReactMouseEvent<SVGGElement>) => void }) {
  const position = station.position!;
  const Icon = ICONS[station.icon];
  const status = station.powerState;
  const headingRadians = (station.coverageRotation * Math.PI) / 180;
  const headingEnd = { x: Math.cos(headingRadians) * .32, y: Math.sin(headingRadians) * .32 };
  const handlePosition = { x: Math.cos(headingRadians) * .39, y: Math.sin(headingRadians) * .39 };
  return <g className={`station-marker ${status} ${busy ? "busy" : ""}`} transform={`translate(${position.x} ${position.y})`} onPointerDown={onPointerDown} onContextMenu={onContextMenu} filter="url(#station-shadow)"><circle className="station-body" r=".235" style={{ stroke: station.outlineColor }} /><line className="station-heading" x1="0" y1="0" x2={headingEnd.x} y2={headingEnd.y} style={{ stroke: station.outlineColor }} />{canRotate && <g className="station-rotation-handle" transform={`translate(${handlePosition.x} ${handlePosition.y})`} onPointerDown={onRotateStart}><circle r=".075" style={{ stroke: station.outlineColor }} /><path d="M-.026 0h.052M0-.026v.052" /></g>}<Icon x="-.125" y="-.125" width=".25" height=".25" className="station-glyph" strokeWidth={2.2} /><circle className="station-power-dot" cx=".17" cy="-.17" r=".055" /><g className="station-canvas-label" pointerEvents="none"><rect x="-.56" y=".34" width="1.12" height=".31" rx=".08" /><text y=".54">{station.powerState === "booting" ? "Starting…" : station.name.length > 17 ? `${station.name.slice(0, 16)}…` : station.name}</text></g></g>;
}
