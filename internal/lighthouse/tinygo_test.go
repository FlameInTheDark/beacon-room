package lighthouse

import "testing"

func TestDecodePowerState(t *testing.T) {
	tests := []struct {
		name      string
		value     byte
		wantState PowerState
		wantError bool
	}{
		{name: "sleep is off", value: lighthouseSleepCommand, wantState: PowerStateOff},
		{name: "standby is off", value: lighthouseStandbyState, wantState: PowerStateOff},
		{name: "wake is booting", value: lighthouseWakeCommand, wantState: PowerStateBooting},
		{name: "booting is booting", value: lighthouseBootingState, wantState: PowerStateBooting},
		{name: "alternate booting is booting", value: lighthouseBootingStateAlt, wantState: PowerStateBooting},
		{name: "on is on", value: lighthouseOnState, wantState: PowerStateOn},
		{name: "unknown value is explicit", value: 0xFF, wantState: PowerStateUnknown, wantError: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state, err := decodePowerState(test.value)
			if state != test.wantState {
				t.Errorf("state = %q, want %q", state, test.wantState)
			}
			if (err != nil) != test.wantError {
				t.Errorf("error = %v, want error: %t", err, test.wantError)
			}
		})
	}
}

func TestRequestedPowerState(t *testing.T) {
	tests := []struct {
		name      string
		poweredOn bool
		want      PowerState
	}{
		{name: "on request expects on", poweredOn: true, want: PowerStateOn},
		{name: "off request expects off", poweredOn: false, want: PowerStateOff},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state := requestedPowerState(test.poweredOn)
			if state != test.want {
				t.Errorf("requested state = %q, want %q", state, test.want)
			}
		})
	}
}

func TestPowerCommand(t *testing.T) {
	if command := powerCommand(true); command != lighthouseWakeCommand {
		t.Errorf("on command = 0x%02X, want 0x%02X", command, lighthouseWakeCommand)
	}
	if command := powerCommand(false); command != lighthouseSleepCommand {
		t.Errorf("off command = 0x%02X, want 0x%02X", command, lighthouseSleepCommand)
	}
}

func TestMatchesRequestedPowerState(t *testing.T) {
	if !matchesRequestedPowerState(PowerStateOn, true) {
		t.Error("fully-on station should satisfy an on request")
	}
	if !matchesRequestedPowerState(PowerStateBooting, true) {
		t.Error("booting station should satisfy an on request")
	}
	if matchesRequestedPowerState(PowerStateOff, true) {
		t.Error("off station must not satisfy an on request")
	}
	if !matchesRequestedPowerState(PowerStateOff, false) {
		t.Error("off station should satisfy an off request")
	}
}

func TestTinyGoGatewayRemembersCurrentStationAddressByStableName(t *testing.T) {
	gateway := &TinyGoGateway{knownTargets: make(map[string]StationTarget)}
	gateway.rememberStations([]Station{{Name: "LHB-46FBEBCA", BluetoothID: "CA:37:4E:C9:CB:22"}})

	resolved, found := gateway.knownTarget(StationTarget{
		BluetoothID:   "E1:9E:D3:BC:41:C7",
		BluetoothName: "LHB-46FBEBCA",
	})
	if !found {
		t.Fatal("current target was not remembered")
	}
	if resolved.BluetoothID != "CA:37:4E:C9:CB:22" {
		t.Errorf("resolved Bluetooth ID = %q, want current address", resolved.BluetoothID)
	}
}

func TestTinyGoGatewayForgetsTargetByStableName(t *testing.T) {
	gateway := &TinyGoGateway{knownTargets: make(map[string]StationTarget)}
	target := StationTarget{BluetoothID: "CA:37:4E:C9:CB:22", BluetoothName: "LHB-46FBEBCA"}
	gateway.rememberTarget(target)
	gateway.forgetTarget(target)

	if _, found := gateway.knownTarget(target); found {
		t.Fatal("forgotten target remained cached")
	}
}
