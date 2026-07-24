package main

import (
	"context"
	"fmt"
	"log"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"steamvr-room-planner/internal/controlapi"
	"steamvr-room-planner/internal/layout"
	"steamvr-room-planner/internal/lighthouse"
)

// Wails model aliases keep the public boundary stable while implementation lives in focused packages.
type Point = layout.Point
type InteriorShape = layout.InteriorShape
type Room = layout.Room
type BaseStation = layout.BaseStation
type LayoutState = layout.State
type PowerResult = lighthouse.PowerResult

// AppSettings is the persisted desktop configuration exposed to the Wails frontend.
type AppSettings = layout.AppSettings

// StationService is the application-level base-station boundary used by the Wails façade.
type StationService interface {
	Initialize(context.Context) error
	Close()
	Discover(context.Context) ([]lighthouse.Station, error)
	SetPower(context.Context, lighthouse.StationTarget, bool) lighthouse.PowerResult
	SetPowerAll(context.Context, []lighthouse.StationTarget, bool) []lighthouse.PowerResult
	RefreshPowerAll(context.Context, []lighthouse.StationTarget) []lighthouse.PowerResult
}

// ConfigurableStationService can replace its hardware transport without changing application operations.
type ConfigurableStationService interface {
	StationService
	Configure(context.Context, lighthouse.GatewayConfig) error
}

// applicationTray is the small native tray boundary used by the Wails façade.
type applicationTray interface {
	Start()
	Close()
}

// App is the thin Wails-facing façade for the planner services.
type App struct {
	ctx             context.Context
	store           layout.Store
	stations        StationService
	constructionErr error

	stateMu          sync.Mutex
	settingsMu       sync.Mutex
	refreshCancel    context.CancelFunc
	backgroundCtx    context.Context
	backgroundCancel context.CancelFunc
	apiServer        *controlapi.Server
	activeAPI        layout.APISettings
	tray             applicationTray
	notificationsOn  atomic.Bool
	quitting         atomic.Bool
}

// NewApp creates the application and its production dependencies.
func NewApp() *App {
	store, err := layout.NewDefaultFileStore()
	stations := lighthouse.NewSwitchingController(lighthouse.ProductionGatewayFactory{}, lighthouse.GatewayConfig{Mode: lighthouse.GatewayModeBluetooth})
	return NewAppWithServices(store, stations, err)
}

// NewAppWithServices constructs App with injected services for deterministic testing and alternate hosts.
func NewAppWithServices(store layout.Store, stations StationService, constructionErr error) *App {
	app := &App{store: store, stations: stations, constructionErr: constructionErr}
	app.apiServer = controlapi.NewServer(&localAPIController{app: app})
	return app
}

// attachTray connects the native tray implementation after application construction.
func (a *App) attachTray(tray applicationTray) {
	a.tray = tray
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.backgroundCtx, a.backgroundCancel = context.WithCancel(ctx)
	if a.constructionErr != nil {
		return
	}
	if a.stations == nil {
		a.constructionErr = fmt.Errorf("base-station service is unavailable")
		return
	}
	state, err := a.store.Load(ctx)
	if err != nil {
		a.constructionErr = fmt.Errorf("load application settings: %w", err)
		return
	}
	if err := a.configureStationService(ctx, state.Settings); err != nil {
		a.constructionErr = err
		return
	}
	if err := a.stations.Initialize(ctx); err != nil {
		a.constructionErr = err
		return
	}
	if err := a.applyRuntimeSettings(state.Settings); err != nil {
		// A malformed or occupied API endpoint must not prevent the room planner
		// from opening. Persist the disabled state so the UI reflects reality.
		state.Settings.API.Enabled = false
		if saveErr := a.store.Save(ctx, state); saveErr != nil {
			a.constructionErr = fmt.Errorf("apply application settings: %w; save disabled API setting: %v", err, saveErr)
		}
	}
}

func (a *App) configureStationService(ctx context.Context, settings AppSettings) error {
	configurable, ok := a.stations.(ConfigurableStationService)
	if !ok {
		return nil
	}
	settings = layout.NormalizeAppSettings(settings)
	mode := lighthouse.GatewayMode(settings.StationControl.Mode)
	if err := configurable.Configure(ctx, lighthouse.GatewayConfig{Mode: mode, DonglePort: settings.StationControl.DonglePort}); err != nil {
		return fmt.Errorf("configure %s base-station controller: %w", mode, err)
	}
	return nil
}

// GetSerialPorts returns the serial devices available for the USB dongle setting.
func (a *App) GetSerialPorts() ([]string, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	return lighthouse.AvailableSerialPorts()
}

func (a *App) domReady(ctx context.Context) {
	if err := runtime.InitializeNotifications(ctx); err == nil && runtime.IsNotificationAvailable(ctx) {
		a.notificationsOn.Store(true)
	}
	if a.tray != nil {
		a.tray.Start()
	}
}

func (a *App) shutdown(_ context.Context) {
	if a.refreshCancel != nil {
		a.refreshCancel()
	}
	if a.backgroundCancel != nil {
		a.backgroundCancel()
	}
	if a.apiServer != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := a.apiServer.Stop(shutdownCtx); err != nil {
			log.Printf("stop local API server during shutdown: %v", err)
		}
		cancel()
	}
	if a.tray != nil {
		a.tray.Close()
	}
	if a.notificationsOn.Load() {
		runtime.CleanupNotifications(a.context())
	}
	if a.stations != nil {
		a.stations.Close()
	}
}

// DiscoverBaseStations scans for nearby SteamVR Lighthouse base stations.
func (a *App) DiscoverBaseStations() ([]BaseStation, error) {
	discovered, err := a.discover(a.context())
	if err != nil {
		return nil, err
	}
	if _, err := a.mergeAndSaveDiscovered(a.context(), discovered); err != nil {
		return nil, err
	}
	return discovered, nil
}

// SetStationPower changes one station and returns its confirmed power state.
func (a *App) SetStationPower(station BaseStation, poweredOn bool) (PowerResult, error) {
	if err := a.ready(); err != nil {
		return PowerResult{}, err
	}
	result := a.stations.SetPower(a.context(), stationTarget(station), poweredOn)
	if err := a.persistPowerResults(a.context(), []PowerResult{result}); err != nil {
		return PowerResult{}, err
	}
	return result, nil
}

// SetStationsPower changes all supplied stations and reports individual failures.
func (a *App) SetStationsPower(stations []BaseStation, poweredOn bool) ([]PowerResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	results := a.stations.SetPowerAll(a.context(), stationTargets(stations), poweredOn)
	if err := a.persistPowerResults(a.context(), results); err != nil {
		return nil, err
	}
	return results, nil
}

// RefreshStationPowerStates reads every supplied station without changing its power state.
func (a *App) RefreshStationPowerStates(stations []BaseStation) ([]PowerResult, error) {
	if err := a.ready(); err != nil {
		return nil, err
	}
	results := a.stations.RefreshPowerAll(a.context(), stationTargets(stations))
	if err := a.persistPowerResults(a.context(), results); err != nil {
		return nil, err
	}
	return results, nil
}

func stationTarget(station BaseStation) lighthouse.StationTarget {
	return lighthouse.StationTarget{BluetoothID: station.BluetoothID, BluetoothName: station.BluetoothName}
}

func stationTargets(stations []BaseStation) []lighthouse.StationTarget {
	targets := make([]lighthouse.StationTarget, 0, len(stations))
	for _, station := range stations {
		targets = append(targets, stationTarget(station))
	}
	return targets
}

// LoadState returns the saved layout, if one exists.
func (a *App) LoadState() (LayoutState, error) {
	if err := a.ready(); err != nil {
		return LayoutState{}, err
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	return a.store.Load(a.context())
}

// SaveRoom stores the room while keeping discovered base stations intact.
func (a *App) SaveRoom(room Room) error {
	if err := a.ready(); err != nil {
		return err
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	return a.store.SaveRoom(a.context(), room)
}

// SaveLayout stores the complete room and station layout.
func (a *App) SaveLayout(state LayoutState) error {
	if err := a.ready(); err != nil {
		return err
	}
	a.stateMu.Lock()
	defer a.stateMu.Unlock()
	existing, err := a.store.Load(a.context())
	if err != nil {
		return err
	}
	state.Settings = existing.Settings
	return a.store.Save(a.context(), state)
}

func (a *App) ready() error {
	if a.constructionErr != nil {
		return fmt.Errorf("initialize application services: %w", a.constructionErr)
	}
	if a.store == nil || a.stations == nil {
		return fmt.Errorf("application services are unavailable")
	}
	return nil
}

func (a *App) context() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}

// GetApplicationVersion returns the version embedded by release builds.
func (a *App) GetApplicationVersion() string {
	return appVersion
}
