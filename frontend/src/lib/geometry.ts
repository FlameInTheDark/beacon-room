import type { InteriorShape, Point } from "../types";

export const VIEW_WIDTH_METERS = 12;
export const VIEW_HEIGHT_METERS = 8;
export const GRID_STEP_METERS = 0.5;
export const COVERAGE_RANGE_METERS = 7;
export const DEFAULT_COVERAGE_ANGLE = 160;
export const SNAP_STEPS = [0.05, 0.1, 0.25, 0.5, 1] as const;
export const DEFAULT_SNAP_STEP = 0.1;
// Keep vertices off the boundary without creating a visible placement gap.
export const OBJECT_WALL_CLEARANCE_METERS = 0.005;

export function createId(prefix = "id"): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function midpoint(a: Point, b: Point): Point {
  return {
    id: "midpoint",
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

export function snap(value: number, step = DEFAULT_SNAP_STEP): number {
  return Math.round(value / step) * step;
}

export function clampPoint(point: Point, step = DEFAULT_SNAP_STEP): Point {
  return {
    ...point,
    x: Math.min(VIEW_WIDTH_METERS, Math.max(0, snap(point.x, step))),
    y: Math.min(VIEW_HEIGHT_METERS, Math.max(0, snap(point.y, step))),
  };
}

export function normalizeSnapStep(value: number | undefined): number {
  return SNAP_STEPS.includes(value as (typeof SNAP_STEPS)[number]) ? value! : DEFAULT_SNAP_STEP;
}

export function polygonArea(points: Point[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    sum += current.x * next.y - next.x * current.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: Point[], closed: boolean): number {
  if (points.length < 2) return 0;
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    total += distance(points[index], points[index + 1]);
  }
  if (closed && points.length > 2) total += distance(points.at(-1)!, points[0]);
  return total;
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function pointInPolygonInterior(point: Point, polygon: Point[], clearance = OBJECT_WALL_CLEARANCE_METERS): boolean {
  return pointInPolygon(point, polygon) && !pointOnPolygonBoundary(point, polygon, clearance);
}

export function pointOnPolygonBoundary(point: Point, polygon: Point[], tolerance = 1e-9): boolean {
  if (polygon.length < 2) return false;
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return pointToSegmentDistance(point, start, end) <= tolerance;
  });
}

function pointToSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const progress = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + progress * dx), point.y - (start.y + progress * dy));
}

export function formatMeters(value: number): string {
  return `${value.toFixed(value < 10 ? 2 : 1)} m`;
}

export function roomCentroid(points: Point[]): Point {
  if (points.length === 0) return { id: "center", x: VIEW_WIDTH_METERS / 2, y: VIEW_HEIGHT_METERS / 2 };
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { id: "center", x: total.x / points.length, y: total.y / points.length };
}

export function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function coverageSectorPath(position: Point, angle: number, rotation: number, radius = COVERAGE_RANGE_METERS): string {
  const safeAngle = Math.min(360, Math.max(1, angle));
  const startAngle = radians(rotation - safeAngle / 2);
  const endAngle = radians(rotation + safeAngle / 2);
  const start = { x: position.x + Math.cos(startAngle) * radius, y: position.y + Math.sin(startAngle) * radius };
  const end = { x: position.x + Math.cos(endAngle) * radius, y: position.y + Math.sin(endAngle) * radius };
  const largeArc = safeAngle > 180 ? 1 : 0;
  return `M ${position.x} ${position.y} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

export function projectFrom(source: Point, target: Point, distanceMeters: number): Point {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    id: `projection-${target.id}`,
    x: source.x + (dx / length) * distanceMeters,
    y: source.y + (dy / length) * distanceMeters,
  };
}

export function shadowVolumes(source: Point, shape: InteriorShape, range = COVERAGE_RANGE_METERS): string[] {
  if (!shape.isTall || shape.points.length < 3) return [];
  return shape.points.map((start, index) => {
    const end = shape.points[(index + 1) % shape.points.length];
    const farStart = projectFrom(source, start, range);
    const farEnd = projectFrom(source, end, range);
    return `M ${start.x} ${start.y} L ${end.x} ${end.y} L ${farEnd.x} ${farEnd.y} L ${farStart.x} ${farStart.y} Z`;
  });
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const epsilon = 1e-9;
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  const onSegment = (start: Point, point: Point, end: Point) =>
    point.x >= Math.min(start.x, end.x) - epsilon && point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon && point.y <= Math.max(start.y, end.y) + epsilon;

  if (Math.abs(abC) < epsilon && onSegment(a, c, b)) return true;
  if (Math.abs(abD) < epsilon && onSegment(a, d, b)) return true;
  if (Math.abs(cdA) < epsilon && onSegment(c, a, d)) return true;
  if (Math.abs(cdB) < epsilon && onSegment(c, b, d)) return true;
  return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

export function isSimplePolygon(points: Point[]): boolean {
  if (points.length < 3) return false;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j += 1) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % points.length];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}
