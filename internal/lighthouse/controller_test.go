package lighthouse

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type fakeGateway struct {
	setCalls []string
	states   map[string]PowerState
	failures map[string]error
	resolved map[string]StationTarget
	closed   int
}

type blockingGateway struct {
	entered  chan struct{}
	release  <-chan struct{}
	mu       sync.Mutex
	inFlight int
	maximum  int
}

func (g *blockingGateway) Initialize(context.Context) error            { return nil }
func (g *blockingGateway) Close()                                      {}
func (g *blockingGateway) Discover(context.Context) ([]Station, error) { return nil, nil }
func (g *blockingGateway) ReadPower(_ context.Context, target StationTarget) (StationTarget, PowerState, error) {
	return target, PowerStateOn, nil
}
func (g *blockingGateway) SetPower(_ context.Context, target StationTarget, _ bool) (StationTarget, PowerState, error) {
	g.mu.Lock()
	g.inFlight++
	if g.inFlight > g.maximum {
		g.maximum = g.inFlight
	}
	g.mu.Unlock()
	g.entered <- struct{}{}
	<-g.release
	g.mu.Lock()
	g.inFlight--
	g.mu.Unlock()
	return target, PowerStateOn, nil
}

func (g *fakeGateway) Initialize(context.Context) error            { return nil }
func (g *fakeGateway) Close()                                      { g.closed++ }
func (g *fakeGateway) Discover(context.Context) ([]Station, error) { return nil, nil }
func (g *fakeGateway) ReadPower(_ context.Context, target StationTarget) (StationTarget, PowerState, error) {
	resolved := g.resolve(target)
	if err := g.failures[resolved.BluetoothID]; err != nil {
		return resolved, PowerStateUnknown, err
	}
	return resolved, g.states[resolved.BluetoothID], nil
}
func (g *fakeGateway) SetPower(_ context.Context, target StationTarget, on bool) (StationTarget, PowerState, error) {
	resolved := g.resolve(target)
	g.setCalls = append(g.setCalls, resolved.BluetoothID)
	if err := g.failures[resolved.BluetoothID]; err != nil {
		return resolved, PowerStateUnknown, err
	}
	if on {
		g.states[resolved.BluetoothID] = PowerStateOn
	} else {
		g.states[resolved.BluetoothID] = PowerStateOff
	}
	return resolved, g.states[resolved.BluetoothID], nil
}

func (g *fakeGateway) resolve(target StationTarget) StationTarget {
	if resolved, ok := g.resolved[target.BluetoothID]; ok {
		return resolved
	}
	return target
}

func target(bluetoothID string) StationTarget {
	return StationTarget{BluetoothID: bluetoothID, BluetoothName: "LHB-" + bluetoothID}
}

func targets(bluetoothIDs []string) []StationTarget {
	output := make([]StationTarget, 0, len(bluetoothIDs))
	for _, bluetoothID := range bluetoothIDs {
		output = append(output, target(bluetoothID))
	}
	return output
}

func TestControllerSerializesConcurrentPowerOperations(t *testing.T) {
	release := make(chan struct{})
	gateway := &blockingGateway{entered: make(chan struct{}, 2), release: release}
	controller := NewController(gateway)

	var operations sync.WaitGroup
	operations.Add(2)
	go func() {
		defer operations.Done()
		controller.SetPower(context.Background(), target("A"), true)
	}()
	<-gateway.entered
	go func() {
		defer operations.Done()
		controller.SetPower(context.Background(), target("B"), true)
	}()

	select {
	case <-gateway.entered:
		t.Fatal("second BLE operation entered before the first completed")
	default:
	}
	close(release)
	<-gateway.entered
	operations.Wait()

	gateway.mu.Lock()
	maximum := gateway.maximum
	gateway.mu.Unlock()
	if maximum != 1 {
		t.Errorf("maximum concurrent BLE operations = %d, want 1", maximum)
	}
}

func TestControllerSetPowerAll(t *testing.T) {
	tests := []struct {
		name       string
		ids        []string
		on         bool
		failures   map[string]error
		wantStates []PowerState
		wantCalls  []string
	}{
		{
			name:       "confirms every station sequentially",
			ids:        []string{"A", "B"},
			on:         true,
			failures:   map[string]error{},
			wantStates: []PowerState{PowerStateOn, PowerStateOn},
			wantCalls:  []string{"A", "B"},
		},
		{
			name:       "reports partial failure without skipping later stations",
			ids:        []string{"A", "B", "C"},
			on:         false,
			failures:   map[string]error{"B": errors.New("unreachable")},
			wantStates: []PowerState{PowerStateOff, PowerStateUnknown, PowerStateOff},
			wantCalls:  []string{"A", "B", "C"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gateway := &fakeGateway{states: map[string]PowerState{}, failures: test.failures}
			controller := NewController(gateway)
			results := controller.SetPowerAll(context.Background(), targets(test.ids), test.on)
			if len(results) != len(test.wantStates) {
				t.Fatalf("result count = %d, want %d", len(results), len(test.wantStates))
			}
			for index, result := range results {
				if result.PowerState != test.wantStates[index] {
					t.Errorf("result %d state = %q, want %q", index, result.PowerState, test.wantStates[index])
				}
			}
			for index, call := range gateway.setCalls {
				if call != test.wantCalls[index] {
					t.Errorf("call %d = %q, want %q", index, call, test.wantCalls[index])
				}
			}
		})
	}
}

func TestControllerRefreshPowerAll(t *testing.T) {
	tests := []struct {
		name       string
		ids        []string
		states     map[string]PowerState
		failures   map[string]error
		wantStates []PowerState
	}{
		{
			name:       "returns current readback states",
			ids:        []string{"A", "B"},
			states:     map[string]PowerState{"A": PowerStateOn, "B": PowerStateOff},
			failures:   map[string]error{},
			wantStates: []PowerState{PowerStateOn, PowerStateOff},
		},
		{
			name:       "keeps successful readbacks when one station fails",
			ids:        []string{"A", "B"},
			states:     map[string]PowerState{"A": PowerStateOn},
			failures:   map[string]error{"B": errors.New("unreachable")},
			wantStates: []PowerState{PowerStateOn, PowerStateUnknown},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			gateway := &fakeGateway{states: test.states, failures: test.failures}
			results := NewController(gateway).RefreshPowerAll(context.Background(), targets(test.ids))
			if len(results) != len(test.wantStates) {
				t.Fatalf("result count = %d, want %d", len(results), len(test.wantStates))
			}
			for index, result := range results {
				if result.PowerState != test.wantStates[index] {
					t.Errorf("result %d state = %q, want %q", index, result.PowerState, test.wantStates[index])
				}
			}
		})
	}
}

func TestControllerPublishesResolvedBluetoothAddress(t *testing.T) {
	stale := target("OLD")
	current := target("CURRENT")
	gateway := &fakeGateway{
		states:   map[string]PowerState{current.BluetoothID: PowerStateOn},
		failures: map[string]error{},
		resolved: map[string]StationTarget{stale.BluetoothID: current},
	}

	result := NewController(gateway).RefreshPower(context.Background(), stale)
	if result.BluetoothID != stale.BluetoothID {
		t.Errorf("result request address = %q, want %q", result.BluetoothID, stale.BluetoothID)
	}
	if result.ResolvedBluetoothID != current.BluetoothID {
		t.Errorf("resolved address = %q, want %q", result.ResolvedBluetoothID, current.BluetoothID)
	}
}

func TestControllerClosesGateway(t *testing.T) {
	gateway := &fakeGateway{}
	NewController(gateway).Close()

	if gateway.closed != 1 {
		t.Errorf("gateway close calls = %d, want 1", gateway.closed)
	}
}
