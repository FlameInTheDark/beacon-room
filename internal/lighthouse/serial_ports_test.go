package lighthouse

import (
	"reflect"
	"testing"
)

func TestNormalizeSerialPorts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		ports []string
		want  []string
	}{
		{name: "sorts and deduplicates", ports: []string{"COM9", "COM5", "COM9"}, want: []string{"COM5", "COM9"}},
		{name: "trims and removes empty values", ports: []string{" COM5 ", "", "  ", "/dev/ttyACM0"}, want: []string{"/dev/ttyACM0", "COM5"}},
		{name: "empty list", want: []string{}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := normalizeSerialPorts(test.ports); !reflect.DeepEqual(got, test.want) {
				t.Errorf("normalizeSerialPorts(%q) = %q, want %q", test.ports, got, test.want)
			}
		})
	}
}
