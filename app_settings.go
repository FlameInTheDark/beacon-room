package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"steamvr-room-planner/internal/layout"
	"steamvr-room-planner/internal/lighthouse"
)

const statusRefreshOperationTimeout = 60 * time.Second

// GetAppSettings returns the saved desktop preferences.
func (a *App) GetAppSettings() (AppSettings, error) {
	if err := a.ready(); err != nil {
		return AppSettings{}, err
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	state, err := a.store.Load(a.context())
	if err != nil {
		return AppSettings{}, err
	}
	return layout.NormalizeAppSettings(state.Settings), nil
}

// SaveAppSettings validates, persists, and applies desktop preferences.
func (a *App) SaveAppSettings(settings AppSettings) error {
	if err := a.ready(); err != nil {
		return err
	}
	settings = layout.NormalizeAppSettings(settings)

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	state, err := a.store.Load(a.context())
	if err != nil {
		return err
	}
	previous := state.Settings
	if err := a.configureAPI(settings.API); err != nil {
		return err
	}

	state.Settings = settings
	if err := a.store.Save(a.context(), state); err != nil {
		if rollbackErr := a.configureAPI(previous.API); rollbackErr != nil {
			return fmt.Errorf("save application settings: %w; restore API configuration: %v", err, rollbackErr)
		}
		return fmt.Errorf("save application settings: %w", err)
	}
	a.configureStatusRefresh(settings.StatusRefresh)
	return nil
}

func (a *App) applyRuntimeSettings(settings AppSettings) error {
	settings = layout.NormalizeAppSettings(settings)
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if err := a.configureAPI(settings.API); err != nil {
		return err
	}
	a.configureStatusRefresh(settings.StatusRefresh)
	return nil
}

func (a *App) configureAPI(settings layout.APISettings) error {
	if a.apiServer == nil {
		return fmt.Errorf("local API service is unavailable")
	}
	if a.activeAPI.Enabled == settings.Enabled && a.activeAPI.Port == settings.Port {
		return nil
	}

	previous := a.activeAPI
	if previous.Enabled {
		stopCtx, cancel := context.WithTimeout(a.context(), 5*time.Second)
		stopErr := a.apiServer.Stop(stopCtx)
		cancel()
		if stopErr != nil {
			return stopErr
		}
	}
	a.activeAPI = layout.APISettings{}
	if !settings.Enabled {
		a.activeAPI = settings
		return nil
	}
	if err := a.apiServer.Start(settings.Port); err != nil {
		if previous.Enabled {
			if restoreErr := a.apiServer.Start(previous.Port); restoreErr == nil {
				a.activeAPI = previous
			}
		}
		return err
	}
	a.activeAPI = settings
	return nil
}

func (a *App) configureStatusRefresh(settings layout.StatusRefreshSettings) {
	if a.refreshCancel != nil {
		a.refreshCancel()
		a.refreshCancel = nil
	}
	if !settings.Enabled || a.backgroundCtx == nil {
		return
	}

	ctx, cancel := context.WithCancel(a.backgroundCtx)
	a.refreshCancel = cancel
	interval := time.Duration(settings.IntervalSeconds) * time.Second
	go a.runStatusRefresh(ctx, interval)
}

func (a *App) runStatusRefresh(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			operationCtx, cancel := context.WithTimeout(ctx, statusRefreshOperationTimeout)
			if _, err := a.refreshSavedStations(operationCtx); err != nil {
				log.Printf("refresh base-station states: %v", err)
			}
			cancel()
		}
	}
}

func (a *App) shouldHideToTray() bool {
	if a.store == nil {
		return false
	}
	state, err := a.store.Load(a.context())
	if err != nil {
		return false
	}
	return layout.NormalizeAppSettings(state.Settings).HideToTray
}

// RequestClose applies the user's close-to-tray preference.
func (a *App) RequestClose() {
	if a.shouldHideToTray() {
		runtime.WindowHide(a.context())
		return
	}
	a.quitting.Store(true)
	runtime.Quit(a.context())
}

func (a *App) beforeClose(ctx context.Context) bool {
	if a.quitting.Load() || !a.shouldHideToTray() {
		return false
	}
	runtime.WindowHide(ctx)
	return true
}

func (a *App) showWindow() {
	runtime.WindowUnminimise(a.context())
	runtime.WindowShow(a.context())
}

func (a *App) quitFromTray() {
	a.quitting.Store(true)
	runtime.Quit(a.context())
}

func (a *App) setAllPowerFromTray(poweredOn bool) {
	if _, err := a.setAllSavedStationsPower(a.context(), poweredOn); err != nil {
		log.Printf("set all base stations from tray: %v", err)
	}
}

func (a *App) notifyPowerResults(previous []BaseStation, results []PowerResult) {
	if !a.notificationsOn.Load() || len(results) == 0 || a.store == nil {
		return
	}
	state, err := a.store.Load(a.context())
	if err != nil {
		return
	}
	settings := layout.NormalizeAppSettings(state.Settings).Notifications
	if !settings.Enabled {
		return
	}

	previousByID := make(map[string]BaseStation, len(previous))
	for _, station := range previous {
		previousByID[station.BluetoothID] = station
	}
	for _, result := range results {
		station, exists := previousByID[result.BluetoothID]
		if !exists {
			continue
		}
		if result.Error != "" && settings.StationErrors {
			a.sendNotification("Beacon Room", fmt.Sprintf("%s: %s", station.Name, result.Error), "station-error-"+station.ID)
			continue
		}
		if settings.StationStateChanges && isConfirmedState(station.PowerState) && isConfirmedState(string(result.PowerState)) && station.PowerState != string(result.PowerState) {
			a.sendNotification("Beacon Room", fmt.Sprintf("%s turned %s", station.Name, result.PowerState), "station-state-"+station.ID)
		}
	}
}

func (a *App) sendNotification(title string, body string, id string) {
	if err := runtime.SendNotification(a.context(), runtime.NotificationOptions{ID: id, Title: title, Body: body}); err != nil {
		log.Printf("send desktop notification: %v", err)
	}
}

func isConfirmedState(state string) bool {
	return state == string(lighthouse.PowerStateOn) || state == string(lighthouse.PowerStateOff)
}
