package lighthouse

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type switchingGateway struct {
	mu          sync.Mutex
	initialized int
	closed      int
	state       PowerState
}

func (g *switchingGateway) Initialize(context.Context) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.initialized++
	return nil
}

func (g *switchingGateway) Close() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.closed++
}

func (g *switchingGateway) Discover(context.Context) ([]Station, error) {
	return nil, nil
}

func (g *switchingGateway) ReadPower(_ context.Context, target StationTarget) (StationTarget, PowerState, error) {
	return target, g.state, nil
}

func (g *switchingGateway) SetPower(_ context.Context, target StationTarget, poweredOn bool) (StationTarget, PowerState, error) {
	if poweredOn {
		g.state = PowerStateOn
	} else {
		g.state = PowerStateOff
	}
	return target, g.state, nil
}

type switchingFactory struct {
	gateways map[GatewayMode]Gateway
	errors   map[GatewayMode]error
}

func (f switchingFactory) NewGateway(config GatewayConfig) (Gateway, error) {
	if err := f.errors[config.Mode]; err != nil {
		return nil, err
	}
	return f.gateways[config.Mode], nil
}

func TestSwitchingControllerChangesGateway(t *testing.T) {
	t.Parallel()

	native := &switchingGateway{state: PowerStateOn}
	dongle := &switchingGateway{state: PowerStateOff}
	controller := NewSwitchingController(switchingFactory{gateways: map[GatewayMode]Gateway{
		GatewayModeBluetooth: native,
		GatewayModeDongle:    dongle,
	}}, GatewayConfig{Mode: GatewayModeBluetooth})

	if err := controller.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize native controller: %v", err)
	}
	if result := controller.RefreshPowerAll(context.Background(), []StationTarget{{BluetoothID: "A"}}); result[0].PowerState != PowerStateOn {
		t.Fatalf("native state = %q, want on", result[0].PowerState)
	}
	if err := controller.Configure(context.Background(), GatewayConfig{Mode: GatewayModeDongle, DonglePort: "COM5"}); err != nil {
		t.Fatalf("configure dongle controller: %v", err)
	}
	if result := controller.RefreshPowerAll(context.Background(), []StationTarget{{BluetoothID: "A"}}); result[0].PowerState != PowerStateOff {
		t.Fatalf("dongle state = %q, want off", result[0].PowerState)
	}

	native.mu.Lock()
	nativeClosed := native.closed
	native.mu.Unlock()
	if nativeClosed != 1 {
		t.Errorf("native close calls = %d, want 1", nativeClosed)
	}
	dongle.mu.Lock()
	dongleInitialized := dongle.initialized
	dongle.mu.Unlock()
	if dongleInitialized != 1 {
		t.Errorf("dongle initialization calls = %d, want 1", dongleInitialized)
	}
}

func TestSwitchingControllerInitializesEachGatewayOnlyOnce(t *testing.T) {
	t.Parallel()

	native := &switchingGateway{}
	controller := NewSwitchingController(switchingFactory{gateways: map[GatewayMode]Gateway{
		GatewayModeBluetooth: native,
	}}, GatewayConfig{Mode: GatewayModeBluetooth})

	if err := controller.Configure(context.Background(), GatewayConfig{Mode: GatewayModeBluetooth}); err != nil {
		t.Fatalf("configure native controller: %v", err)
	}
	if err := controller.Initialize(context.Background()); err != nil {
		t.Fatalf("initialize native controller: %v", err)
	}

	native.mu.Lock()
	initialized := native.initialized
	native.mu.Unlock()
	if initialized != 1 {
		t.Errorf("native initialization calls = %d, want 1", initialized)
	}
}

func TestSwitchingControllerReportsFactoryFailureForEveryBulkTarget(t *testing.T) {
	t.Parallel()

	controller := NewSwitchingController(switchingFactory{errors: map[GatewayMode]error{
		GatewayModeBluetooth: errors.New("adapter unavailable"),
	}}, GatewayConfig{Mode: GatewayModeBluetooth})
	results := controller.SetPowerAll(context.Background(), []StationTarget{{BluetoothID: "A"}, {BluetoothID: "B"}}, true)

	if len(results) != 2 {
		t.Fatalf("result count = %d, want 2", len(results))
	}
	for _, result := range results {
		if result.PowerState != PowerStateUnknown || result.Error != "create bluetooth gateway: adapter unavailable" {
			t.Errorf("result = %#v, want unknown factory failure", result)
		}
	}
}
