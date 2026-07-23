import { VIEW_HEIGHT_METERS, VIEW_WIDTH_METERS } from "./geometry";
import type { Point } from "../types";

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const ROOM_FRAME_OCCUPANCY = 0.72;
const MIN_ROOM_DIMENSION = 0.25;

export type Camera = { x: number; y: number; zoom: number };

export function cameraDimensions(camera: Camera) {
  return { width: VIEW_WIDTH_METERS / camera.zoom, height: VIEW_HEIGHT_METERS / camera.zoom };
}

export function clampCamera(camera: Camera): Camera {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
  const { width, height } = cameraDimensions({ ...camera, zoom });
  const minX = Math.min(0, (VIEW_WIDTH_METERS - width) / 2);
  const maxX = Math.max(0, VIEW_WIDTH_METERS - width);
  const minY = Math.min(0, (VIEW_HEIGHT_METERS - height) / 2);
  const maxY = Math.max(0, VIEW_HEIGHT_METERS - height);
  return {
    zoom,
    x: Math.min(maxX, Math.max(minX, camera.x)),
    y: Math.min(maxY, Math.max(minY, camera.y)),
  };
}

export function zoomCameraAt(camera: Camera, point: Point, nextZoom: number): Camera {
  const oldSize = cameraDimensions(camera);
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoom));
  const nextSize = cameraDimensions({ ...camera, zoom });
  const relativeX = (point.x - camera.x) / oldSize.width;
  const relativeY = (point.y - camera.y) / oldSize.height;
  return clampCamera({ zoom, x: point.x - relativeX * nextSize.width, y: point.y - relativeY * nextSize.height });
}

/**
 * Fits a completed room into the planning viewport with deliberate breathing
 * room around it. Bounds, rather than a polygon centroid, keep irregular
 * rooms fully visible.
 */
export function frameRoomCamera(points: Point[]): Camera {
  if (points.length < 3) {
    return { x: 0, y: 0, zoom: 1 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  const roomWidth = Math.max(MIN_ROOM_DIMENSION, maxX - minX);
  const roomHeight = Math.max(MIN_ROOM_DIMENSION, maxY - minY);
  const zoom = Math.min(
    MAX_ZOOM,
    Math.max(
      MIN_ZOOM,
      Math.min(
        (VIEW_WIDTH_METERS * ROOM_FRAME_OCCUPANCY) / roomWidth,
        (VIEW_HEIGHT_METERS * ROOM_FRAME_OCCUPANCY) / roomHeight,
      ),
    ),
  );
  const dimensions = cameraDimensions({ x: 0, y: 0, zoom });

  return clampCamera({
    x: (minX + maxX) / 2 - dimensions.width / 2,
    y: (minY + maxY) / 2 - dimensions.height / 2,
    zoom,
  });
}
