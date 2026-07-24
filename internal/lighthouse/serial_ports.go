package lighthouse

import (
	"fmt"
	"sort"
	"strings"

	"go.bug.st/serial"
)

// AvailableSerialPorts returns the usable serial-device names exposed by the operating system.
func AvailableSerialPorts() ([]string, error) {
	ports, err := serial.GetPortsList()
	if err != nil {
		return nil, fmt.Errorf("list serial ports: %w", err)
	}
	return normalizeSerialPorts(ports), nil
}

func normalizeSerialPorts(ports []string) []string {
	unique := make(map[string]struct{}, len(ports))
	for _, port := range ports {
		if port = strings.TrimSpace(port); port != "" {
			unique[port] = struct{}{}
		}
	}

	normalized := make([]string, 0, len(unique))
	for port := range unique {
		normalized = append(normalized, port)
	}
	sort.Strings(normalized)
	return normalized
}
