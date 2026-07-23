import { describe, expect, it } from "vitest";
import { DEFAULT_COVERAGE_ANGLE, clampPoint, coverageSectorPath, isSimplePolygon, pointInPolygonInterior, shadowVolumes } from "./geometry";
import { normalizeLayout } from "./layout";
import { applyPowerResults } from "./power";
import { cameraDimensions, clampCamera, frameRoomCamera, zoomCameraAt } from "./viewport";
import type { InteriorShape, Point } from "../types";

const point = (id: string, x: number, y: number): Point => ({ id, x, y });

describe("viewport", () => {
  it("clamps zoom and camera coordinates to the planning canvas", () => {
    expect(clampCamera({ x: 99, y: -2, zoom: 9 })).toEqual({ x: 8, y: 0, zoom: 3 });
    expect(clampCamera({ x: 2, y: 2, zoom: 0.1 })).toEqual({ x: 0, y: 0, zoom: 0.5 });
  });

  it("keeps the pointer location stable while zooming", () => {
    const camera = zoomCameraAt({ x: 0, y: 0, zoom: 1 }, point("cursor", 6, 4), 2);
    expect(camera).toEqual({ x: 3, y: 2, zoom: 2 });
  });

  it("frames a completed room at its bounds center with breathing room", () => {
    const camera = frameRoomCamera([point("a", 2, 2), point("b", 6, 2), point("c", 6, 5), point("d", 2, 5)]);
    const dimensions = cameraDimensions(camera);

    expect(camera.zoom).toBeGreaterThan(1);
    expect(camera.x + dimensions.width / 2).toBeCloseTo(4);
    expect(camera.y + dimensions.height / 2).toBeCloseTo(3.5);
    expect(4 / dimensions.width).toBeLessThan(0.73);
    expect(3 / dimensions.height).toBeLessThan(0.73);
  });
});

describe("snapping", () => {
  it("uses the selected snap step for both coordinates", () => {
    expect(clampPoint(point("snap", 1.12, 2.37), 0.25)).toMatchObject({ x: 1, y: 2.25 });
  });
});

describe("coverage geometry", () => {
  it("uses the 160 degree horizontal SteamVR planning default", () => {
    expect(DEFAULT_COVERAGE_ANGLE).toBe(160);
    expect(coverageSectorPath(point("station", 1, 1), DEFAULT_COVERAGE_ANGLE, 0)).toContain("A 7 7 0 0 1");
  });

  it("projects shadows only for tall interior shapes", () => {
    const shape: InteriorShape = {
      id: "desk",
      name: "Desk",
      isTall: true,
      points: [point("a", 2, 2), point("b", 3, 2), point("c", 3, 3), point("d", 2, 3)],
    };
    expect(shadowVolumes(point("station", 0, 0), shape)).toHaveLength(4);
    expect(shadowVolumes(point("station", 0, 0), { ...shape, isTall: false })).toEqual([]);
  });

  it("rejects self-intersecting interior polygons", () => {
    expect(isSimplePolygon([point("a", 0, 0), point("b", 2, 2), point("c", 0, 2), point("d", 2, 0)])).toBe(false);
  });

  it("rejects object points on a room wall while allowing near-wall placement", () => {
    const room = [point("a", 0, 0), point("b", 4, 0), point("c", 4, 4), point("d", 0, 4)];
    expect(pointInPolygonInterior(point("wall", 2, 0), room)).toBe(false);
    expect(pointInPolygonInterior(point("near-wall", 2, 0.05), room)).toBe(true);
    expect(pointInPolygonInterior(point("boundary-tolerance", 2, 0.005), room)).toBe(false);
  });
});

describe("saved layout migration", () => {
  it("adds new room, coverage, and completion defaults to a legacy layout", () => {
    const state = normalizeLayout({
      room: { id: "room", name: "Legacy room", closed: true, points: [point("a", 0, 0), point("b", 4, 0), point("c", 4, 4)] },
      stations: [{ id: "station", bluetoothId: "AA:BB", bluetoothName: "LHB-01", name: "Base", poweredOn: true, icon: "tower", outlineColor: "#fff", position: point("pos", 0, 1) }],
    });

    expect(state.room.shapes).toEqual([]);
    expect(state.stations[0].coverageAngle).toBe(DEFAULT_COVERAGE_ANGLE);
    expect(state.stations[0].coverageRotation).toBeGreaterThanOrEqual(0);
    expect(state.setupComplete).toBe(false);
    expect(state.snapStep).toBe(0.1);
    expect(state.settings).toMatchObject({
      theme: "dark",
      api: { enabled: false, port: 7575 },
      statusRefresh: { enabled: false, intervalSeconds: 60 },
    });
  });
});

describe("confirmed power updates", () => {
  it("updates only stations with a confirmed result", () => {
    const stations = normalizeLayout({
      stations: [
        { id: "a", bluetoothId: "A", poweredOn: false },
        { id: "b", bluetoothId: "B", poweredOn: true },
      ],
    }).stations;

    const updated = applyPowerResults(stations, [
      { bluetoothId: "A", powerState: "on" },
      { bluetoothId: "B", powerState: "unknown", error: "unreachable" },
    ]);

    expect(updated.map((station) => station.poweredOn)).toEqual([true, true]);
    expect(updated.map((station) => station.powerState)).toEqual(["on", "unknown"]);
  });

  it("keeps a waking station out of active coverage until it reports on", () => {
    const stations = normalizeLayout({ stations: [{ id: "a", bluetoothId: "A", poweredOn: false }] }).stations;
    const updated = applyPowerResults(stations, [{ bluetoothId: "A", powerState: "booting" }]);

    expect(updated[0]).toMatchObject({ poweredOn: false, powerState: "booting" });
  });

  it("persists a resolved current Bluetooth address after a successful fallback", () => {
    const stations = normalizeLayout({ stations: [{ id: "a", bluetoothId: "STALE", bluetoothName: "LHB-01", poweredOn: false }] }).stations;
    const updated = applyPowerResults(stations, [{ bluetoothId: "STALE", resolvedBluetoothId: "CURRENT", powerState: "on" }]);

    expect(updated[0]).toMatchObject({ bluetoothId: "CURRENT", poweredOn: true, powerState: "on" });
  });
});
