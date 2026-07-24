package lighthouse

import (
	"context"
	"fmt"
	"strings"
	"sync"
)

// GatewayMode identifies the device responsible for Bluetooth Low Energy operations.
type GatewayMode string

const (
	// GatewayModeBluetooth uses the computer's native Bluetooth adapter.
	GatewayModeBluetooth GatewayMode = "bluetooth"
	// GatewayModeDongle uses a Beacon Room nRF52840 USB gateway.
	GatewayModeDongle GatewayMode = "dongle"
)

// GatewayConfig selects a hardware gateway and supplies its connection settings.
type GatewayConfig struct {
	Mode       GatewayMode
	DonglePort string
}

// NormalizeGatewayConfig returns a valid configuration with safe defaults.
func NormalizeGatewayConfig(config GatewayConfig) GatewayConfig {
	if config.Mode != GatewayModeDongle {
		config.Mode = GatewayModeBluetooth
	}
	config.DonglePort = strings.TrimSpace(config.DonglePort)
	return config
}

// GatewayFactory creates a concrete hardware gateway for one configuration.
type GatewayFactory interface {
	NewGateway(GatewayConfig) (Gateway, error)
}

// ProductionGatewayFactory creates the gateways used by the desktop application.
type ProductionGatewayFactory struct{}

// NewGateway constructs the native Bluetooth or USB-dongle gateway.
func (ProductionGatewayFactory) NewGateway(config GatewayConfig) (Gateway, error) {
	switch NormalizeGatewayConfig(config).Mode {
	case GatewayModeBluetooth:
		return NewTinyGoGateway(), nil
	case GatewayModeDongle:
		return NewDongleGateway(config.DonglePort), nil
	default:
		return nil, fmt.Errorf("unsupported base-station gateway mode %q", config.Mode)
	}
}

// SwitchingController keeps station operations serial while allowing a user to select the hardware gateway.
type SwitchingController struct {
	factory GatewayFactory

	mu          sync.Mutex
	config      GatewayConfig
	controller  *Controller
	initialized bool
}

// NewSwitchingController constructs a controller that lazily creates the selected gateway.
func NewSwitchingController(factory GatewayFactory, config GatewayConfig) *SwitchingController {
	return &SwitchingController{factory: factory, config: NormalizeGatewayConfig(config)}
}

// Configure swaps the active gateway after successfully initializing the replacement.
func (c *SwitchingController) Configure(ctx context.Context, config GatewayConfig) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	config = NormalizeGatewayConfig(config)
	if c.controller != nil && c.config == config {
		return c.initializeLocked(ctx)
	}

	next, err := c.newControllerLocked(config)
	if err != nil {
		return err
	}
	if err := next.Initialize(ctx); err != nil {
		next.Close()
		return err
	}

	previous := c.controller
	c.controller = next
	c.config = config
	c.initialized = true
	if previous != nil {
		previous.Close()
	}
	return nil
}

// Initialize prepares the currently configured gateway.
func (c *SwitchingController) Initialize(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	return c.initializeLocked(ctx)
}

// Close releases the selected gateway.
func (c *SwitchingController) Close() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.controller != nil {
		c.controller.Close()
		c.initialized = false
	}
}

// Discover scans for Lighthouse stations with the selected gateway.
func (c *SwitchingController) Discover(ctx context.Context) ([]Station, error) {
	var stations []Station
	err := c.withController(ctx, func(controller *Controller) error {
		var discoverErr error
		stations, discoverErr = controller.Discover(ctx)
		return discoverErr
	})
	return stations, err
}

// SetPower changes one station's state using the selected gateway.
func (c *SwitchingController) SetPower(ctx context.Context, target StationTarget, poweredOn bool) PowerResult {
	var result PowerResult
	if err := c.withController(ctx, func(controller *Controller) error {
		result = controller.SetPower(ctx, target, poweredOn)
		return nil
	}); err != nil {
		return failedPowerResult(target, err)
	}
	return result
}

// SetPowerAll changes every supplied station sequentially using the selected gateway.
func (c *SwitchingController) SetPowerAll(ctx context.Context, targets []StationTarget, poweredOn bool) []PowerResult {
	var results []PowerResult
	if err := c.withController(ctx, func(controller *Controller) error {
		results = controller.SetPowerAll(ctx, targets, poweredOn)
		return nil
	}); err != nil {
		return failedPowerResults(targets, err)
	}
	return results
}

// RefreshPowerAll reads the state of every supplied station sequentially using the selected gateway.
func (c *SwitchingController) RefreshPowerAll(ctx context.Context, targets []StationTarget) []PowerResult {
	var results []PowerResult
	if err := c.withController(ctx, func(controller *Controller) error {
		results = controller.RefreshPowerAll(ctx, targets)
		return nil
	}); err != nil {
		return failedPowerResults(targets, err)
	}
	return results
}

func (c *SwitchingController) withController(ctx context.Context, operation func(*Controller) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	controller, err := c.controllerLocked()
	if err != nil {
		return err
	}
	return operation(controller)
}

func (c *SwitchingController) controllerLocked() (*Controller, error) {
	if c.controller != nil {
		return c.controller, nil
	}
	controller, err := c.newControllerLocked(c.config)
	if err != nil {
		return nil, err
	}
	c.controller = controller
	return controller, nil
}

func (c *SwitchingController) initializeLocked(ctx context.Context) error {
	if c.initialized {
		return nil
	}
	controller, err := c.controllerLocked()
	if err != nil {
		return err
	}
	if err := controller.Initialize(ctx); err != nil {
		return err
	}
	c.initialized = true
	return nil
}

func (c *SwitchingController) newControllerLocked(config GatewayConfig) (*Controller, error) {
	if c.factory == nil {
		return nil, fmt.Errorf("base-station gateway factory is unavailable")
	}
	gateway, err := c.factory.NewGateway(config)
	if err != nil {
		return nil, fmt.Errorf("create %s gateway: %w", config.Mode, err)
	}
	if gateway == nil {
		return nil, fmt.Errorf("create %s gateway: factory returned nil", config.Mode)
	}
	return NewController(gateway), nil
}

func failedPowerResult(target StationTarget, err error) PowerResult {
	return PowerResult{BluetoothID: target.BluetoothID, PowerState: PowerStateUnknown, Error: err.Error()}
}

func failedPowerResults(targets []StationTarget, err error) []PowerResult {
	results := make([]PowerResult, 0, len(targets))
	for _, target := range targets {
		results = append(results, failedPowerResult(target, err))
	}
	return results
}
