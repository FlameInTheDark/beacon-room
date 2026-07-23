package main

import (
	"context"
	"fmt"
	"strings"

	"steamvr-room-planner/internal/controlapi"
	"steamvr-room-planner/internal/layout"
	"steamvr-room-planner/internal/lighthouse"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// localAPIController adapts App's private station operations to the HTTP package.
// It is intentionally not bound to Wails, keeping context-bearing methods out of
// the JavaScript bridge.
type localAPIController struct {
	app *App
}

func (c *localAPIController) ListStations(ctx context.Context) ([]layout.BaseStation, error) {
	return c.app.listStations(ctx)
}

func (c *localAPIController) DiscoverStations(ctx context.Context) ([]layout.BaseStation, error) {
	return c.app.discoverAndPersistStations(ctx)
}

func (c *localAPIController) RefreshStations(ctx context.Context) ([]lighthouse.PowerResult, error) {
	return c.app.refreshSavedStations(ctx)
}

func (c *localAPIController) SetAllStationsPower(ctx context.Context, poweredOn bool) ([]lighthouse.PowerResult, error) {
	return c.app.setAllSavedStationsPower(ctx, poweredOn)
}

func (c *localAPIController) SetStationPowerByID(ctx context.Context, stationID string, poweredOn bool) (lighthouse.PowerResult, error) {
	return c.app.setSavedStationPowerByID(ctx, stationID, poweredOn)
}

func (a *App) listStations(ctx context.Context) ([]BaseStation, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	state, err := a.store.Load(ctx)
	if err != nil {
		return nil, err
	}
	return append([]BaseStation(nil), state.Stations...), nil
}

func (a *App) discoverAndPersistStations(ctx context.Context) ([]BaseStation, error) {
	discovered, err := a.discover(ctx)
	if err != nil {
		return nil, err
	}
	return a.mergeAndSaveDiscovered(ctx, discovered)
}

func (a *App) refreshSavedStations(ctx context.Context) ([]PowerResult, error) {
	stations, err := a.listStations(ctx)
	if err != nil {
		return nil, err
	}
	results := a.stations.RefreshPowerAll(ctx, stationTargets(stations))
	if err := a.persistPowerResults(ctx, results); err != nil {
		return nil, err
	}
	return results, nil
}

func (a *App) setAllSavedStationsPower(ctx context.Context, poweredOn bool) ([]PowerResult, error) {
	stations, err := a.listStations(ctx)
	if err != nil {
		return nil, err
	}
	results := a.stations.SetPowerAll(ctx, stationTargets(stations), poweredOn)
	if err := a.persistPowerResults(ctx, results); err != nil {
		return nil, err
	}
	return results, nil
}

func (a *App) setSavedStationPowerByID(ctx context.Context, stationID string, poweredOn bool) (PowerResult, error) {
	stations, err := a.listStations(ctx)
	if err != nil {
		return PowerResult{}, err
	}
	for _, station := range stations {
		if station.ID != stationID {
			continue
		}
		result := a.stations.SetPower(ctx, stationTarget(station), poweredOn)
		if err := a.persistPowerResults(ctx, []PowerResult{result}); err != nil {
			return PowerResult{}, err
		}
		return result, nil
	}
	return PowerResult{}, fmt.Errorf("%w: %s", controlapi.ErrStationNotFound, stationID)
}

func (a *App) discover(ctx context.Context) ([]BaseStation, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	discovered, err := a.stations.Discover(ctx)
	if err != nil {
		return nil, err
	}
	stations := make([]BaseStation, 0, len(discovered))
	for _, station := range discovered {
		stations = append(stations, BaseStation{
			ID:            "bs-" + strings.ReplaceAll(strings.ToLower(station.BluetoothID), ":", ""),
			BluetoothName: station.Name,
			BluetoothID:   station.BluetoothID,
			Name:          station.Name,
			PoweredOn:     station.PowerState == lighthouse.PowerStateOn,
			PowerState:    string(station.PowerState),
			PowerError:    station.PowerError,
			Icon:          "tower",
			OutlineColor:  "#8b5cf6",
			CoverageAngle: 160,
		})
	}
	return stations, nil
}

func (a *App) mergeAndSaveDiscovered(ctx context.Context, discovered []BaseStation) ([]BaseStation, error) {
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	state, err := a.store.Load(ctx)
	if err != nil {
		return nil, err
	}
	state.Stations = mergeDiscoveredStations(state.Stations, discovered)
	if err := a.store.Save(ctx, state); err != nil {
		return nil, err
	}
	return append([]BaseStation(nil), state.Stations...), nil
}

func mergeDiscoveredStations(existing []BaseStation, discovered []BaseStation) []BaseStation {
	byID := make(map[string]BaseStation, len(existing))
	byName := make(map[string]BaseStation, len(existing))
	for _, station := range existing {
		byID[station.ID] = station
		if station.BluetoothName != "" {
			byName[station.BluetoothName] = station
		}
	}
	merged := make([]BaseStation, 0, len(existing)+len(discovered))
	discoveredIDs := make(map[string]struct{}, len(discovered))
	for _, station := range discovered {
		current, exists := byID[station.ID]
		if !exists && station.BluetoothName != "" {
			current, exists = byName[station.BluetoothName]
		}
		if exists {
			station.ID = current.ID
			station.Name = current.Name
			station.Position = current.Position
			station.Icon = current.Icon
			station.OutlineColor = current.OutlineColor
			station.CoverageAngle = current.CoverageAngle
			station.CoverageRotation = current.CoverageRotation
			if station.PowerState == string(lighthouse.PowerStateUnknown) {
				station.PoweredOn = current.PoweredOn
			}
		}
		discoveredIDs[station.ID] = struct{}{}
		merged = append(merged, station)
	}
	for _, station := range existing {
		if _, found := discoveredIDs[station.ID]; !found {
			merged = append(merged, station)
		}
	}
	return merged
}

func (a *App) persistPowerResults(ctx context.Context, results []PowerResult) error {
	if len(results) == 0 {
		return nil
	}
	a.stateMu.Lock()
	state, err := a.store.Load(ctx)
	if err != nil {
		a.stateMu.Unlock()
		return err
	}
	previous := append([]BaseStation(nil), state.Stations...)
	state.Stations = applyPowerResults(state.Stations, results)
	err = a.store.Save(ctx, state)
	a.stateMu.Unlock()
	if err != nil {
		return err
	}
	a.notifyPowerResults(previous, results)
	runtime.EventsEmit(a.context(), "station-power-results", results)
	return nil
}

func applyPowerResults(stations []BaseStation, results []PowerResult) []BaseStation {
	updated := append([]BaseStation(nil), stations...)
	for _, result := range results {
		for index := range updated {
			station := &updated[index]
			if station.BluetoothID != result.BluetoothID {
				continue
			}
			if result.ResolvedBluetoothID != "" {
				station.BluetoothID = result.ResolvedBluetoothID
			}
			station.PowerState = string(result.PowerState)
			station.PowerError = result.Error
			if result.PowerState == lighthouse.PowerStateOn {
				station.PoweredOn = true
			}
			if result.PowerState == lighthouse.PowerStateOff || result.PowerState == lighthouse.PowerStateBooting {
				station.PoweredOn = false
			}
			break
		}
	}
	return updated
}
