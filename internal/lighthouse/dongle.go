package lighthouse

import (
	"bytes"
	"context"
	"fmt"
	"runtime"
	"strconv"
	"strings"
	"time"

	"go.bug.st/serial"
)

const (
	dongleBaudRate         = 115200
	dongleReadTimeout      = 100 * time.Millisecond
	maximumDongleResponse  = 16 * 1024
	dongleResponseComplete = "DONE"
)

// DongleGateway implements Gateway through the Beacon Room nRF52840 USB serial protocol.
type DongleGateway struct {
	port      string
	transport dongleTransport
}

// NewDongleGateway constructs a gateway for a user-selected virtual serial port.
func NewDongleGateway(port string) *DongleGateway {
	return &DongleGateway{port: strings.TrimSpace(port), transport: serialDongleTransport{}}
}

// Initialize validates the gateway context. The USB port is opened per operation so unplugging a dongle never prevents settings from opening.
func (g *DongleGateway) Initialize(ctx context.Context) error {
	return ctx.Err()
}

// Close satisfies Gateway. Each command owns and closes its own USB serial connection.
func (g *DongleGateway) Close() {}

// Discover requests all currently visible Lighthouse stations from the dongle.
func (g *DongleGateway) Discover(ctx context.Context) ([]Station, error) {
	lines, err := g.exchange(ctx, "SCAN")
	if err != nil {
		return nil, err
	}
	return parseDongleStations(lines)
}

// ReadPower asks the dongle to resolve and query a station without changing it.
func (g *DongleGateway) ReadPower(ctx context.Context, target StationTarget) (StationTarget, PowerState, error) {
	return g.queryState(ctx, "STATUS", target, "")
}

// SetPower asks the dongle to resolve, change, and read back a station state.
func (g *DongleGateway) SetPower(ctx context.Context, target StationTarget, poweredOn bool) (StationTarget, PowerState, error) {
	state := "OFF"
	if poweredOn {
		state = "ON"
	}
	return g.queryState(ctx, "POWER", target, state)
}

func (g *DongleGateway) queryState(ctx context.Context, operation string, target StationTarget, argument string) (StationTarget, PowerState, error) {
	token, err := dongleTargetToken(target)
	if err != nil {
		return target, PowerStateUnknown, err
	}
	command := strings.TrimSpace(strings.Join([]string{operation, token, argument}, " "))
	lines, err := g.exchange(ctx, command)
	if err != nil {
		return target, PowerStateUnknown, err
	}
	return parseDongleState(lines, target)
}

func (g *DongleGateway) exchange(ctx context.Context, command string) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if g.transport == nil {
		return nil, fmt.Errorf("dongle transport is unavailable")
	}
	if g.port == "" {
		return nil, fmt.Errorf("usb dongle port is not configured")
	}
	lines, err := g.transport.Exchange(ctx, g.port, command)
	if err != nil {
		return nil, fmt.Errorf("exchange %s with Beacon Room dongle on %s: %w", strings.Fields(command)[0], g.port, err)
	}
	if protocolErr := dongleProtocolError(lines); protocolErr != nil {
		return nil, protocolErr
	}
	return lines, nil
}

type dongleTransport interface {
	Exchange(context.Context, string, string) ([]string, error)
}

type serialDongleTransport struct{}

func (serialDongleTransport) Exchange(ctx context.Context, portName string, command string) (lines []string, err error) {
	port, err := serial.Open(normalizeSerialPortName(portName), &serial.Mode{BaudRate: dongleBaudRate})
	if err != nil {
		return nil, fmt.Errorf("open serial port: %w", err)
	}
	defer func() {
		if closeErr := port.Close(); err == nil && closeErr != nil {
			err = fmt.Errorf("close serial port: %w", closeErr)
		}
	}()

	if err := port.SetReadTimeout(dongleReadTimeout); err != nil {
		return nil, fmt.Errorf("set serial read timeout: %w", err)
	}
	if err := writeSerialLine(port, command); err != nil {
		return nil, err
	}
	if err := port.Drain(); err != nil {
		return nil, fmt.Errorf("flush serial command: %w", err)
	}
	return readDongleResponse(ctx, port)
}

func writeSerialLine(port serial.Port, command string) error {
	remaining := []byte(command + "\n")
	for len(remaining) > 0 {
		written, err := port.Write(remaining)
		if err != nil {
			return fmt.Errorf("write serial command: %w", err)
		}
		if written == 0 {
			return fmt.Errorf("write serial command: no bytes written")
		}
		remaining = remaining[written:]
	}
	return nil
}

func readDongleResponse(ctx context.Context, port serial.Port) ([]string, error) {
	buffer := make([]byte, 256)
	pending := make([]byte, 0, 256)
	lines := make([]string, 0, 4)

	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		read, err := port.Read(buffer)
		if err != nil {
			return nil, fmt.Errorf("read serial response: %w", err)
		}
		if read == 0 {
			continue
		}
		pending = append(pending, buffer[:read]...)
		if len(pending) > maximumDongleResponse {
			return nil, fmt.Errorf("dongle response exceeds %d bytes", maximumDongleResponse)
		}

		for {
			newline := bytes.IndexByte(pending, '\n')
			if newline < 0 {
				break
			}
			line := strings.TrimSpace(string(pending[:newline]))
			pending = pending[newline+1:]
			if line == "" {
				continue
			}
			if line == dongleResponseComplete {
				return lines, nil
			}
			lines = append(lines, line)
		}
	}
}

func parseDongleStations(lines []string) ([]Station, error) {
	stations := make([]Station, 0, len(lines))
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) != 4 || fields[0] != "STATION" {
			return nil, fmt.Errorf("invalid dongle scan response %q", line)
		}
		state, err := parseDonglePowerState(fields[2])
		if err != nil {
			return nil, err
		}
		stations = append(stations, Station{Name: fields[3], BluetoothID: fields[1], PowerState: state})
	}
	return stations, nil
}

func parseDongleState(lines []string, fallback StationTarget) (StationTarget, PowerState, error) {
	if len(lines) != 1 {
		return fallback, PowerStateUnknown, fmt.Errorf("invalid dongle state response: expected one line, got %d", len(lines))
	}
	fields := strings.Fields(lines[0])
	if len(fields) != 4 || fields[0] != "STATE" {
		return fallback, PowerStateUnknown, fmt.Errorf("invalid dongle state response %q", lines[0])
	}
	state, err := parseDonglePowerState(fields[2])
	if err != nil {
		return fallback, PowerStateUnknown, err
	}
	return StationTarget{BluetoothID: fields[1], BluetoothName: fields[3]}, state, nil
}

func parseDonglePowerState(value string) (PowerState, error) {
	switch strings.ToLower(value) {
	case string(PowerStateOn):
		return PowerStateOn, nil
	case string(PowerStateOff):
		return PowerStateOff, nil
	case string(PowerStateBooting):
		return PowerStateBooting, nil
	case string(PowerStateUnknown):
		return PowerStateUnknown, nil
	default:
		return PowerStateUnknown, fmt.Errorf("invalid dongle power state %q", value)
	}
}

func dongleProtocolError(lines []string) error {
	for _, line := range lines {
		if message, found := strings.CutPrefix(line, "ERROR "); found {
			return fmt.Errorf("dongle error: %s", message)
		}
	}
	return nil
}

func dongleTargetToken(target StationTarget) (string, error) {
	token := target.BluetoothName
	if token == "" {
		token = target.BluetoothID
	}
	if token == "" {
		return "", fmt.Errorf("station does not have a Bluetooth name or address")
	}
	if len(strings.Fields(token)) != 1 {
		return "", fmt.Errorf("station identifier %q cannot contain whitespace", token)
	}
	return token, nil
}

func normalizeSerialPortName(port string) string {
	if runtime.GOOS != "windows" || strings.HasPrefix(port, `\\.\`) {
		return port
	}
	upper := strings.ToUpper(port)
	if !strings.HasPrefix(upper, "COM") {
		return port
	}
	value, err := strconv.Atoi(upper[3:])
	if err != nil || value < 10 {
		return port
	}
	return `\\.\` + port
}
