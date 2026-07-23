package lighthouse

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"tinygo.org/x/bluetooth"
)

const (
	powerServiceUUIDText        = "00001523-1212-efde-1523-785feabcd124"
	powerCharacteristicUUIDText = "00001525-1212-efde-1523-785feabcd124"
	defaultScanDuration         = 7 * time.Second
	preScanDelay                = time.Second
	powerOperationAttempts      = 3
	powerOperationRetryDelay    = 500 * time.Millisecond
	connectionReadyDelay        = 200 * time.Millisecond
	serviceDiscoveryAttempts    = 3
	serviceDiscoveryRetryDelay  = 500 * time.Millisecond
	powerReadbackAttempts       = 4
	powerReadbackRetryDelay     = 300 * time.Millisecond
	lighthouseSleepCommand      = byte(0x00)
	lighthouseWakeCommand       = byte(0x01)
	lighthouseStandbyState      = byte(0x02)
	lighthouseBootingState      = byte(0x09)
	lighthouseBootingStateAlt   = byte(0x08)
	lighthouseOnState           = byte(0x0B)
)

type powerOperation func(context.Context, string) (PowerState, error)

// TinyGoGateway implements Gateway using the SteamVR Lighthouse BLE service.
type TinyGoGateway struct {
	adapter             *bluetooth.Adapter
	scanDuration        time.Duration
	initializationOnce  sync.Once
	initializationError error
	serviceUUID         bluetooth.UUID
	characteristicUUID  bluetooth.UUID
	knownTargets        map[string]StationTarget
}

// NewTinyGoGateway constructs the production Bluetooth implementation.
func NewTinyGoGateway() *TinyGoGateway {
	return &TinyGoGateway{
		adapter:      bluetooth.DefaultAdapter,
		scanDuration: defaultScanDuration,
		knownTargets: make(map[string]StationTarget),
	}
}

// Initialize enables the adapter once for the process lifetime.
func (g *TinyGoGateway) Initialize(ctx context.Context) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	g.initializationOnce.Do(func() {
		if err := g.adapter.Enable(); err != nil {
			g.initializationError = fmt.Errorf("enable Bluetooth adapter: %w", err)
			return
		}
		g.serviceUUID, g.initializationError = bluetooth.ParseUUID(powerServiceUUIDText)
		if g.initializationError != nil {
			g.initializationError = fmt.Errorf("parse power service UUID: %w", g.initializationError)
			return
		}
		g.characteristicUUID, g.initializationError = bluetooth.ParseUUID(powerCharacteristicUUIDText)
		if g.initializationError != nil {
			g.initializationError = fmt.Errorf("parse power characteristic UUID: %w", g.initializationError)
		}
	})
	return g.initializationError
}

// Close satisfies the gateway lifecycle; power operations release their own GATT connection.
func (g *TinyGoGateway) Close() {}

// Discover scans for Lighthouse advertisements and reads their current power states.
func (g *TinyGoGateway) Discover(ctx context.Context) ([]Station, error) {
	if err := g.Initialize(ctx); err != nil {
		return nil, err
	}

	stations, err := g.scanLighthouseStations(ctx)
	if err != nil {
		return nil, err
	}
	for index := range stations {
		station := &stations[index]
		target := StationTarget{BluetoothID: station.BluetoothID, BluetoothName: station.Name}
		resolved, state, stateErr := g.ReadPower(ctx, target)
		station.BluetoothID = resolved.BluetoothID
		if stateErr == nil {
			station.PowerState = state
		} else {
			station.PowerError = stateErr.Error()
		}
	}
	sort.Slice(stations, func(i, j int) bool { return stations[i].BluetoothID < stations[j].BluetoothID })
	return stations, nil
}

func (g *TinyGoGateway) scanLighthouseStations(ctx context.Context) ([]Station, error) {
	if err := waitForRetry(ctx, preScanDelay); err != nil {
		return nil, err
	}

	found := make(map[string]Station)
	var foundMu sync.Mutex
	stop := make(chan struct{})
	timer := time.NewTimer(g.scanDuration)
	defer timer.Stop()
	go func() {
		select {
		case <-timer.C:
			_ = g.adapter.StopScan()
		case <-ctx.Done():
			_ = g.adapter.StopScan()
		case <-stop:
		}
	}()

	err := g.adapter.Scan(func(_ *bluetooth.Adapter, result bluetooth.ScanResult) {
		name := result.LocalName()
		if !strings.HasPrefix(name, "LHB-") {
			return
		}
		address := result.Address.String()
		if address == "" || address == "00:00:00:00:00:00" {
			return
		}
		foundMu.Lock()
		found[address] = Station{Name: name, BluetoothID: address, PowerState: PowerStateUnknown}
		foundMu.Unlock()
	})
	close(stop)
	if ctxErr := ctx.Err(); ctxErr != nil {
		return nil, ctxErr
	}
	if err != nil {
		return nil, fmt.Errorf("scan base stations: %w", err)
	}

	foundMu.Lock()
	stations := make([]Station, 0, len(found))
	for _, station := range found {
		stations = append(stations, station)
	}
	foundMu.Unlock()
	g.rememberStations(stations)
	return stations, nil
}

// ReadPower returns the power characteristic's current value without changing it.
func (g *TinyGoGateway) ReadPower(ctx context.Context, target StationTarget) (StationTarget, PowerState, error) {
	if err := g.Initialize(ctx); err != nil {
		return target, PowerStateUnknown, err
	}
	return g.runPowerOperationForTarget(ctx, target, "read power state", g.readPower)
}

// SetPower writes the desired value and returns the read-back state.
func (g *TinyGoGateway) SetPower(ctx context.Context, target StationTarget, poweredOn bool) (StationTarget, PowerState, error) {
	if err := g.Initialize(ctx); err != nil {
		return target, PowerStateUnknown, err
	}
	return g.runPowerOperationForTarget(ctx, target, "set power state", func(ctx context.Context, bluetoothID string) (PowerState, error) {
		return g.setPower(ctx, bluetoothID, poweredOn)
	})
}

func (g *TinyGoGateway) setPower(ctx context.Context, bluetoothID string, poweredOn bool) (PowerState, error) {
	device, characteristic, err := g.openPowerCharacteristic(ctx, bluetoothID)
	if err != nil {
		return PowerStateUnknown, err
	}
	defer func() { _ = device.Disconnect() }()

	command := powerCommand(poweredOn)
	if err := writePowerCommand(characteristic, command); err != nil {
		return PowerStateUnknown, err
	}

	return readRequestedPower(ctx, characteristic, poweredOn)
}

// writePowerCommand matches the proven Lighthouse control path: use a GATT
// write without response first, and only fall back when the adapter does not
// expose that mode for this characteristic.
func writePowerCommand(characteristic bluetooth.DeviceCharacteristic, command byte) error {
	written, err := characteristic.WriteWithoutResponse([]byte{command})
	if err == nil {
		if written != 1 {
			return fmt.Errorf("write power characteristic without response: expected one byte, wrote %d", written)
		}
		return nil
	}
	if !strings.Contains(strings.ToLower(err.Error()), "not supported") {
		return fmt.Errorf("write power characteristic without response: %w", err)
	}
	written, err = characteristic.Write([]byte{command})
	if err != nil {
		return fmt.Errorf("write power characteristic: %w", err)
	}
	if written != 1 {
		return fmt.Errorf("write power characteristic: expected one byte, wrote %d", written)
	}
	return nil
}

func (g *TinyGoGateway) readPower(ctx context.Context, bluetoothID string) (PowerState, error) {
	device, characteristic, err := g.openPowerCharacteristic(ctx, bluetoothID)
	if err != nil {
		return PowerStateUnknown, err
	}
	defer func() { _ = device.Disconnect() }()
	return readCharacteristic(characteristic)
}

func (g *TinyGoGateway) runPowerOperation(ctx context.Context, bluetoothID, operationName string, operation powerOperation) (PowerState, error) {
	var lastErr error
	for attempt := 1; attempt <= powerOperationAttempts; attempt++ {
		state, err := operation(ctx, bluetoothID)
		if err == nil {
			return state, nil
		}
		lastErr = err
		if attempt == powerOperationAttempts {
			break
		}
		if err := waitForRetry(ctx, powerOperationRetryDelay); err != nil {
			return PowerStateUnknown, err
		}
	}
	return PowerStateUnknown, fmt.Errorf("%s for %s after %d attempts: %w", operationName, bluetoothID, powerOperationAttempts, lastErr)
}

func (g *TinyGoGateway) runPowerOperationForTarget(ctx context.Context, target StationTarget, operationName string, operation powerOperation) (StationTarget, PowerState, error) {
	resolved, known := g.knownTarget(target)
	if !known {
		var resolveErr error
		resolved, resolveErr = g.resolveCurrentTarget(ctx, target)
		if resolveErr != nil {
			return target, PowerStateUnknown, fmt.Errorf("%s: %w", operationName, resolveErr)
		}
	}

	state, operationErr := g.runPowerOperation(ctx, resolved.BluetoothID, operationName, operation)
	if operationErr == nil {
		return resolved, state, nil
	}

	// A BLE privacy address can change while the app is open. Re-scan by the
	// stable Lighthouse name once before reporting the failed operation.
	g.forgetTarget(resolved)
	if target.BluetoothName == "" {
		return resolved, PowerStateUnknown, operationErr
	}
	refreshed, resolveErr := g.resolveCurrentTarget(ctx, target)
	if resolveErr != nil || refreshed.BluetoothID == resolved.BluetoothID {
		return resolved, PowerStateUnknown, operationErr
	}
	state, operationErr = g.runPowerOperation(ctx, refreshed.BluetoothID, operationName, operation)
	if operationErr != nil {
		return refreshed, PowerStateUnknown, operationErr
	}
	return refreshed, state, nil
}

func (g *TinyGoGateway) resolveCurrentTarget(ctx context.Context, target StationTarget) (StationTarget, error) {
	stations, err := g.scanLighthouseStations(ctx)
	if err != nil {
		return target, err
	}
	for _, station := range stations {
		if station.Name == target.BluetoothName {
			return StationTarget{BluetoothID: station.BluetoothID, BluetoothName: station.Name}, nil
		}
	}
	return target, fmt.Errorf("%q was not advertised during a %s BLE scan (%d other Lighthouse station(s) were visible)", target.BluetoothName, g.scanDuration, len(stations))
}

func (g *TinyGoGateway) rememberStations(stations []Station) {
	for _, station := range stations {
		g.rememberTarget(StationTarget{BluetoothID: station.BluetoothID, BluetoothName: station.Name})
	}
}

func (g *TinyGoGateway) rememberTarget(target StationTarget) {
	if g.knownTargets == nil {
		g.knownTargets = make(map[string]StationTarget)
	}
	if target.BluetoothName != "" {
		if previous, ok := g.knownTargets["name:"+target.BluetoothName]; ok && previous.BluetoothID != target.BluetoothID {
			delete(g.knownTargets, "id:"+previous.BluetoothID)
		}
	}
	if target.BluetoothID != "" {
		g.knownTargets["id:"+target.BluetoothID] = target
	}
	if target.BluetoothName != "" {
		g.knownTargets["name:"+target.BluetoothName] = target
	}
}

func (g *TinyGoGateway) knownTarget(target StationTarget) (StationTarget, bool) {
	if target.BluetoothName != "" {
		if known, ok := g.knownTargets["name:"+target.BluetoothName]; ok {
			return known, true
		}
	}
	known, ok := g.knownTargets["id:"+target.BluetoothID]
	return known, ok
}

func (g *TinyGoGateway) forgetTarget(target StationTarget) {
	if target.BluetoothID != "" {
		delete(g.knownTargets, "id:"+target.BluetoothID)
	}
	if target.BluetoothName != "" {
		delete(g.knownTargets, "name:"+target.BluetoothName)
	}
}

func (g *TinyGoGateway) openPowerCharacteristic(ctx context.Context, bluetoothID string) (bluetooth.Device, bluetooth.DeviceCharacteristic, error) {
	if err := ctx.Err(); err != nil {
		return bluetooth.Device{}, bluetooth.DeviceCharacteristic{}, err
	}
	mac, err := bluetooth.ParseMAC(bluetoothID)
	if err != nil {
		return bluetooth.Device{}, bluetooth.DeviceCharacteristic{}, fmt.Errorf("parse station Bluetooth address %q: %w", bluetoothID, err)
	}
	address := bluetooth.Address{MACAddress: bluetooth.MACAddress{MAC: mac}}
	device, err := g.adapter.Connect(address, bluetooth.ConnectionParams{})
	if err != nil {
		return bluetooth.Device{}, bluetooth.DeviceCharacteristic{}, fmt.Errorf("connect to %s: %w", bluetoothID, err)
	}
	if err := waitForRetry(ctx, connectionReadyDelay); err != nil {
		_ = device.Disconnect()
		return bluetooth.Device{}, bluetooth.DeviceCharacteristic{}, err
	}

	characteristic, discoverErr := g.discoverPowerCharacteristic(ctx, device, bluetoothID)
	if discoverErr != nil {
		_ = device.Disconnect()
		return bluetooth.Device{}, bluetooth.DeviceCharacteristic{}, discoverErr
	}
	return device, characteristic, nil
}

func (g *TinyGoGateway) discoverPowerCharacteristic(ctx context.Context, device bluetooth.Device, bluetoothID string) (bluetooth.DeviceCharacteristic, error) {
	var lastErr error
	for attempt := 1; attempt <= serviceDiscoveryAttempts; attempt++ {
		services, serviceErr := device.DiscoverServices([]bluetooth.UUID{g.serviceUUID})
		if serviceErr != nil {
			lastErr = fmt.Errorf("discover power service for %s: %w", bluetoothID, serviceErr)
		} else if len(services) == 0 {
			lastErr = fmt.Errorf("discover power service for %s: service not found", bluetoothID)
		} else {
			characteristics, characteristicErr := services[0].DiscoverCharacteristics([]bluetooth.UUID{g.characteristicUUID})
			if characteristicErr != nil {
				lastErr = fmt.Errorf("discover power characteristic for %s: %w", bluetoothID, characteristicErr)
			} else if len(characteristics) == 0 {
				lastErr = fmt.Errorf("discover power characteristic for %s: characteristic not found", bluetoothID)
			} else {
				return characteristics[0], nil
			}
		}
		if attempt < serviceDiscoveryAttempts {
			if err := waitForRetry(ctx, serviceDiscoveryRetryDelay); err != nil {
				return bluetooth.DeviceCharacteristic{}, err
			}
		}
	}
	return bluetooth.DeviceCharacteristic{}, fmt.Errorf("discover Lighthouse power service for %s after %d attempts: %w", bluetoothID, serviceDiscoveryAttempts, lastErr)
}

func readCharacteristic(characteristic bluetooth.DeviceCharacteristic) (PowerState, error) {
	buffer := make([]byte, 1)
	read, err := characteristic.Read(buffer)
	if err != nil {
		return PowerStateUnknown, fmt.Errorf("read power characteristic: %w", err)
	}
	if read != 1 {
		return PowerStateUnknown, fmt.Errorf("read power characteristic: expected one byte, read %d", read)
	}
	return decodePowerState(buffer[0])
}

func readRequestedPower(ctx context.Context, characteristic bluetooth.DeviceCharacteristic, poweredOn bool) (PowerState, error) {
	var lastState PowerState
	var lastErr error
	for attempt := 1; attempt <= powerReadbackAttempts; attempt++ {
		state, err := readCharacteristic(characteristic)
		if err == nil && matchesRequestedPowerState(state, poweredOn) {
			return state, nil
		}
		lastState = state
		if err != nil {
			lastErr = err
		} else {
			lastErr = fmt.Errorf("read back %q after requesting %q", state, requestedPowerState(poweredOn))
		}
		if attempt == powerReadbackAttempts {
			break
		}
		if err := waitForRetry(ctx, powerReadbackRetryDelay); err != nil {
			return PowerStateUnknown, err
		}
	}
	return PowerStateUnknown, fmt.Errorf("confirm requested power state after %d reads (last state %q): %w", powerReadbackAttempts, lastState, lastErr)
}

func requestedPowerState(poweredOn bool) PowerState {
	if poweredOn {
		return PowerStateOn
	}
	return PowerStateOff
}

func powerCommand(poweredOn bool) byte {
	if poweredOn {
		return lighthouseWakeCommand
	}
	return lighthouseSleepCommand
}

func matchesRequestedPowerState(state PowerState, poweredOn bool) bool {
	if poweredOn {
		return state == PowerStateOn || state == PowerStateBooting
	}
	return state == PowerStateOff
}

func decodePowerState(value byte) (PowerState, error) {
	switch value {
	case lighthouseSleepCommand, lighthouseStandbyState:
		return PowerStateOff, nil
	case lighthouseOnState:
		return PowerStateOn, nil
	case lighthouseWakeCommand, lighthouseBootingStateAlt, lighthouseBootingState:
		return PowerStateBooting, nil
	default:
		return PowerStateUnknown, fmt.Errorf("read power characteristic: unknown Lighthouse power value 0x%02X", value)
	}
}

func waitForRetry(ctx context.Context, delay time.Duration) error {
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
