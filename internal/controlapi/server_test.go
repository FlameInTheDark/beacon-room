package controlapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"steamvr-room-planner/internal/layout"
	"steamvr-room-planner/internal/lighthouse"
)

type fakeStations struct {
	stations       []layout.BaseStation
	discoverCalls  int
	refreshCalls   int
	allPower       *bool
	stationPowerID string
	stationPowerOn bool
}

func (f *fakeStations) ListStations(context.Context) ([]layout.BaseStation, error) {
	return f.stations, nil
}

func (f *fakeStations) DiscoverStations(context.Context) ([]layout.BaseStation, error) {
	f.discoverCalls++
	return f.stations, nil
}

func (f *fakeStations) RefreshStations(context.Context) ([]lighthouse.PowerResult, error) {
	f.refreshCalls++
	return []lighthouse.PowerResult{{BluetoothID: "AA", PowerState: lighthouse.PowerStateOn}}, nil
}

func (f *fakeStations) SetAllStationsPower(_ context.Context, poweredOn bool) ([]lighthouse.PowerResult, error) {
	f.allPower = &poweredOn
	return []lighthouse.PowerResult{{BluetoothID: "AA", PowerState: lighthouse.PowerStateOn}}, nil
}

func (f *fakeStations) SetStationPowerByID(_ context.Context, id string, poweredOn bool) (lighthouse.PowerResult, error) {
	if id != "station-a" {
		return lighthouse.PowerResult{}, ErrStationNotFound
	}
	f.stationPowerID = id
	f.stationPowerOn = poweredOn
	return lighthouse.PowerResult{BluetoothID: "AA", PowerState: lighthouse.PowerStateOn}, nil
}

func TestServerRoutes(t *testing.T) {
	t.Parallel()

	stations := &fakeStations{stations: []layout.BaseStation{{ID: "station-a", Name: "Desk station", BluetoothID: "AA", PowerState: "on", PoweredOn: true}}}
	server := httptest.NewServer(NewServer(stations).Handler())
	defer server.Close()

	tests := []struct {
		name       string
		method     string
		path       string
		wantStatus int
	}{
		{name: "lists saved stations", method: http.MethodGet, path: "/api/v1/stations", wantStatus: http.StatusOK},
		{name: "discovers stations", method: http.MethodPost, path: "/api/v1/stations/discover", wantStatus: http.StatusOK},
		{name: "refreshes statuses", method: http.MethodPost, path: "/api/v1/stations/refresh", wantStatus: http.StatusOK},
		{name: "turns all on", method: http.MethodPost, path: "/api/v1/stations/on", wantStatus: http.StatusOK},
		{name: "turns one off", method: http.MethodPost, path: "/api/v1/stations/station-a/off", wantStatus: http.StatusOK},
		{name: "returns missing station", method: http.MethodPost, path: "/api/v1/stations/missing/on", wantStatus: http.StatusNotFound},
		{name: "rejects unknown route", method: http.MethodGet, path: "/api/v1/unknown", wantStatus: http.StatusNotFound},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request, err := http.NewRequest(test.method, server.URL+test.path, nil)
			if err != nil {
				t.Fatalf("create request: %v", err)
			}
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatalf("send request: %v", err)
			}
			defer func() {
				if closeErr := response.Body.Close(); closeErr != nil {
					t.Errorf("close response body: %v", closeErr)
				}
			}()
			if response.StatusCode != test.wantStatus {
				t.Errorf("status = %d, want %d", response.StatusCode, test.wantStatus)
			}
		})
	}

	if stations.discoverCalls != 1 || stations.refreshCalls != 1 {
		t.Errorf("discover/refresh calls = %d/%d, want 1/1", stations.discoverCalls, stations.refreshCalls)
	}
	if stations.allPower == nil || !*stations.allPower {
		t.Error("all-on route did not request power on")
	}
	if stations.stationPowerID != "station-a" || stations.stationPowerOn {
		t.Errorf("single-station power request = %q/%t, want station-a/false", stations.stationPowerID, stations.stationPowerOn)
	}
}

func TestServerListsStationFields(t *testing.T) {
	t.Parallel()

	controller := &fakeStations{stations: []layout.BaseStation{{ID: "station-a", Name: "Living room", BluetoothID: "AA:BB", PowerState: "off", PoweredOn: false}}}
	request := httptest.NewRequest(http.MethodGet, "/api/v1/stations", nil)
	response := httptest.NewRecorder()
	NewServer(controller).Handler().ServeHTTP(response, request)

	var payload struct {
		Stations []layout.BaseStation `json:"stations"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode station response: %v", err)
	}
	if len(payload.Stations) != 1 || payload.Stations[0].Name != "Living room" || payload.Stations[0].BluetoothID != "AA:BB" || payload.Stations[0].PowerState != "off" {
		t.Errorf("station payload = %#v", payload.Stations)
	}
}
