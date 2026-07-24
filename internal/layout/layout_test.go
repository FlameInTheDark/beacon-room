package layout

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestFileStoreLoadMigratesLegacyLayout(t *testing.T) {
	t.Parallel()

	path := filepath.Join(t.TempDir(), "layout.json")
	legacy := `{
  "room": {
    "id": "room", "name": "Room", "closed": true,
    "points": [{"id":"a","x":0,"y":0},{"id":"b","x":4,"y":0},{"id":"c","x":4,"y":4}]
  },
  "stations": [{
    "id":"station", "bluetoothId":"AA:BB", "position":{"id":"pos","x":0,"y":1}
  }]
}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("write legacy state: %v", err)
	}

	state, err := NewFileStore(path).Load(context.Background())
	if err != nil {
		t.Fatalf("load legacy state: %v", err)
	}
	if state.Room.Shapes == nil || len(state.Room.Shapes) != 0 {
		t.Fatalf("shapes = %#v, want empty non-nil slice", state.Room.Shapes)
	}
	if state.Stations[0].CoverageAngle != defaultCoverageAngle {
		t.Errorf("coverage angle = %v, want %v", state.Stations[0].CoverageAngle, defaultCoverageAngle)
	}
	if state.Stations[0].CoverageRotation == 0 {
		t.Error("legacy positioned station rotation was not aimed toward room centroid")
	}
	if state.SetupComplete {
		t.Error("legacy layout should be incomplete")
	}
	if state.SnapStep != defaultSnapStep {
		t.Errorf("snap step = %v, want %v", state.SnapStep, defaultSnapStep)
	}
	if state.Settings.Theme != ThemeDark {
		t.Errorf("theme = %q, want %q", state.Settings.Theme, ThemeDark)
	}
	if state.Settings.API.Port != defaultAPIPort {
		t.Errorf("API port = %d, want %d", state.Settings.API.Port, defaultAPIPort)
	}
	if state.Settings.StatusRefresh.IntervalSeconds != defaultRefreshSeconds {
		t.Errorf("refresh interval = %d, want %d", state.Settings.StatusRefresh.IntervalSeconds, defaultRefreshSeconds)
	}
	if state.Settings.StationControl.Mode != StationControlBluetooth {
		t.Errorf("station control mode = %q, want %q", state.Settings.StationControl.Mode, StationControlBluetooth)
	}
}

func TestNormalizeAppSettings(t *testing.T) {
	t.Parallel()

	settings := NormalizeAppSettings(AppSettings{
		Theme:         ThemeSystem,
		API:           APISettings{Port: 8080},
		StatusRefresh: StatusRefreshSettings{Enabled: true, IntervalSeconds: 15},
	})
	if settings.Theme != ThemeSystem || settings.API.Port != 8080 || settings.StatusRefresh.IntervalSeconds != 15 {
		t.Fatalf("settings were unexpectedly changed: %#v", settings)
	}

	invalid := NormalizeAppSettings(AppSettings{Theme: "violet", API: APISettings{Port: 0}, StatusRefresh: StatusRefreshSettings{IntervalSeconds: 1}})
	if invalid.Theme != ThemeDark || invalid.API.Port != defaultAPIPort || invalid.StatusRefresh.IntervalSeconds != defaultRefreshSeconds {
		t.Errorf("invalid settings = %#v, want defaults", invalid)
	}

	dongle := NormalizeAppSettings(AppSettings{StationControl: StationControlSettings{Mode: StationControlDongle, DonglePort: " COM12 "}})
	if dongle.StationControl.Mode != StationControlDongle || dongle.StationControl.DonglePort != "COM12" {
		t.Errorf("dongle settings = %#v, want normalized dongle configuration", dongle.StationControl)
	}
}

func TestFileStoreSaveRoomPreservesStations(t *testing.T) {
	t.Parallel()

	store := NewFileStore(filepath.Join(t.TempDir(), "layout.json"))
	original := State{Stations: []BaseStation{{ID: "station", BluetoothID: "AA:BB"}}}
	if err := store.Save(context.Background(), original); err != nil {
		t.Fatalf("save original state: %v", err)
	}
	if err := store.SaveRoom(context.Background(), Room{ID: "room", Shapes: []InteriorShape{}}); err != nil {
		t.Fatalf("save room: %v", err)
	}
	loaded, err := store.Load(context.Background())
	if err != nil {
		t.Fatalf("load saved state: %v", err)
	}
	if len(loaded.Stations) != 1 || loaded.Stations[0].ID != "station" {
		t.Errorf("stations = %#v, want preserved station", loaded.Stations)
	}
}
