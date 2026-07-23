// Package lighthouse provides safe, serialised SteamVR base-station control.
package lighthouse

import (
	"context"
	"sync"
)

// PowerState describes a station state confirmed by the BLE power characteristic.
type PowerState string

const (
	// PowerStateOn means the base station confirmed that it is powered on.
	PowerStateOn PowerState = "on"
	// PowerStateOff means the base station confirmed that it is powered off or in standby.
	PowerStateOff PowerState = "off"
	// PowerStateBooting means the base station accepted a wake request but is not ready to track yet.
	PowerStateBooting PowerState = "booting"
	// PowerStateUnknown means the hardware operation could not confirm a state.
	PowerStateUnknown PowerState = "unknown"
)

// Station is the minimal hardware identity reported by a BLE scan.
type Station struct {
	Name        string
	BluetoothID string
	PowerState  PowerState
	PowerError  string
}

// StationTarget identifies a saved station by both its last address and stable advertised name.
type StationTarget struct {
	BluetoothID   string
	BluetoothName string
}

// PowerResult is returned for each requested station, including partial bulk failures.
type PowerResult struct {
	BluetoothID         string     `json:"bluetoothId"`
	ResolvedBluetoothID string     `json:"resolvedBluetoothId,omitempty"`
	PowerState          PowerState `json:"powerState"`
	Error               string     `json:"error,omitempty"`
}

// Gateway isolates the BLE implementation from orchestration and tests.
type Gateway interface {
	Initialize(context.Context) error
	Close()
	Discover(context.Context) ([]Station, error)
	ReadPower(context.Context, StationTarget) (StationTarget, PowerState, error)
	SetPower(context.Context, StationTarget, bool) (StationTarget, PowerState, error)
}

// Controller serializes all adapter interactions, which prevents scans and GATT calls from racing.
type Controller struct {
	gateway Gateway
	mu      sync.Mutex
}

// NewController creates a controller backed by gateway.
func NewController(gateway Gateway) *Controller {
	return &Controller{gateway: gateway}
}

// Initialize starts the underlying BLE adapter.
func (c *Controller) Initialize(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gateway.Initialize(ctx)
}

// Close releases any adapter resources retained by the gateway.
func (c *Controller) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.gateway.Close()
}

// Discover returns every matching base station with its best-known power state.
func (c *Controller) Discover(ctx context.Context) ([]Station, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.gateway.Discover(ctx)
}

// SetPower changes and verifies one station.
func (c *Controller) SetPower(ctx context.Context, target StationTarget, poweredOn bool) PowerResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.setPowerLocked(ctx, target, poweredOn)
}

// SetPowerAll performs a deterministic sequential batch so desktop BLE adapters stay stable.
func (c *Controller) SetPowerAll(ctx context.Context, targets []StationTarget, poweredOn bool) []PowerResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.collectResultsLocked(ctx, targets, func(ctx context.Context, target StationTarget) PowerResult {
		return c.setPowerLocked(ctx, target, poweredOn)
	})
}

// RefreshPower reads and returns the current confirmed state for one station.
func (c *Controller) RefreshPower(ctx context.Context, target StationTarget) PowerResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.refreshPowerLocked(ctx, target)
}

// RefreshPowerAll reads every supplied station sequentially without changing its state.
func (c *Controller) RefreshPowerAll(ctx context.Context, targets []StationTarget) []PowerResult {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.collectResultsLocked(ctx, targets, c.refreshPowerLocked)
}

func (c *Controller) collectResultsLocked(ctx context.Context, targets []StationTarget, operation func(context.Context, StationTarget) PowerResult) []PowerResult {
	results := make([]PowerResult, 0, len(targets))
	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			results = append(results, PowerResult{BluetoothID: target.BluetoothID, PowerState: PowerStateUnknown, Error: err.Error()})
			continue
		}
		results = append(results, operation(ctx, target))
	}
	return results
}

func (c *Controller) setPowerLocked(ctx context.Context, target StationTarget, poweredOn bool) PowerResult {
	resolved, state, err := c.gateway.SetPower(ctx, target, poweredOn)
	if err != nil {
		return PowerResult{BluetoothID: target.BluetoothID, PowerState: PowerStateUnknown, Error: err.Error()}
	}
	return PowerResult{BluetoothID: target.BluetoothID, ResolvedBluetoothID: resolved.BluetoothID, PowerState: state}
}

func (c *Controller) refreshPowerLocked(ctx context.Context, target StationTarget) PowerResult {
	resolved, state, err := c.gateway.ReadPower(ctx, target)
	if err != nil {
		return PowerResult{BluetoothID: target.BluetoothID, PowerState: PowerStateUnknown, Error: err.Error()}
	}
	return PowerResult{BluetoothID: target.BluetoothID, ResolvedBluetoothID: resolved.BluetoothID, PowerState: state}
}
