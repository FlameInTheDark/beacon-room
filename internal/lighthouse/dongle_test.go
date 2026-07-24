package lighthouse

import (
	"context"
	"errors"
	"reflect"
	"runtime"
	"testing"
)

type fakeDongleTransport struct {
	responses map[string][]string
	failures  map[string]error
	commands  []string
	ports     []string
}

func (t *fakeDongleTransport) Exchange(_ context.Context, port string, command string) ([]string, error) {
	t.ports = append(t.ports, port)
	t.commands = append(t.commands, command)
	if err := t.failures[command]; err != nil {
		return nil, err
	}
	return t.responses[command], nil
}

func TestDongleGatewayProtocol(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		operation    func(*DongleGateway) error
		responses    map[string][]string
		wantCommands []string
		wantErr      string
	}{
		{
			name: "discovers stations",
			operation: func(gateway *DongleGateway) error {
				stations, err := gateway.Discover(context.Background())
				if err != nil {
					return err
				}
				want := []Station{{Name: "LHB-1", BluetoothID: "AA:BB:CC:DD:EE:FF", PowerState: PowerStateUnknown}}
				if !reflect.DeepEqual(stations, want) {
					return errors.New("discovery response was not decoded")
				}
				return nil
			},
			responses:    map[string][]string{"SCAN": {"STATION AA:BB:CC:DD:EE:FF unknown LHB-1"}},
			wantCommands: []string{"SCAN"},
		},
		{
			name: "uses stable name for state reads",
			operation: func(gateway *DongleGateway) error {
				resolved, state, err := gateway.ReadPower(context.Background(), StationTarget{BluetoothID: "OLD", BluetoothName: "LHB-1"})
				if err != nil {
					return err
				}
				if resolved.BluetoothID != "NEW" || resolved.BluetoothName != "LHB-1" || state != PowerStateOn {
					return errors.New("state response was not decoded")
				}
				return nil
			},
			responses:    map[string][]string{"STATUS LHB-1": {"STATE NEW on LHB-1"}},
			wantCommands: []string{"STATUS LHB-1"},
		},
		{
			name: "uses address when name is absent",
			operation: func(gateway *DongleGateway) error {
				_, state, err := gateway.SetPower(context.Background(), StationTarget{BluetoothID: "AA:BB"}, false)
				if err != nil {
					return err
				}
				if state != PowerStateOff {
					return errors.New("power response was not decoded")
				}
				return nil
			},
			responses:    map[string][]string{"POWER AA:BB OFF": {"STATE AA:BB off LHB-1"}},
			wantCommands: []string{"POWER AA:BB OFF"},
		},
		{
			name: "returns firmware error",
			operation: func(gateway *DongleGateway) error {
				_, err := gateway.Discover(context.Background())
				return err
			},
			responses:    map[string][]string{"SCAN": {"ERROR station_not_found"}},
			wantCommands: []string{"SCAN"},
			wantErr:      "dongle error: station_not_found",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			transport := &fakeDongleTransport{responses: test.responses, failures: map[string]error{}}
			gateway := NewDongleGateway("COM12")
			gateway.transport = transport

			err := test.operation(gateway)
			if test.wantErr == "" && err != nil {
				t.Fatalf("operation failed: %v", err)
			}
			if test.wantErr != "" && (err == nil || err.Error() != test.wantErr) {
				t.Fatalf("operation error = %v, want %q", err, test.wantErr)
			}
			if !reflect.DeepEqual(transport.commands, test.wantCommands) {
				t.Errorf("commands = %#v, want %#v", transport.commands, test.wantCommands)
			}
		})
	}
}

func TestDongleGatewayRejectsMissingPort(t *testing.T) {
	t.Parallel()

	_, err := NewDongleGateway("").Discover(context.Background())
	if err == nil || err.Error() != "usb dongle port is not configured" {
		t.Fatalf("discovery error = %v, want missing-port error", err)
	}
}

func TestNormalizeSerialPortName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		port string
		want string
	}{
		{name: "single digit COM port", port: "COM9", want: "COM9"},
		{name: "non COM path", port: "/dev/ttyACM0", want: "/dev/ttyACM0"},
	}
	if runtime.GOOS == "windows" {
		tests = append(tests, struct {
			name string
			port string
			want string
		}{name: "two digit COM port", port: "COM12", want: `\\.\COM12`})
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeSerialPortName(test.port); got != test.want {
				t.Errorf("normalizeSerialPortName(%q) = %q, want %q", test.port, got, test.want)
			}
		})
	}
}
