// Package layout owns the persisted room-planning model and file-backed storage.
package layout

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sync"
)

const (
	defaultCoverageAngle  = 160
	defaultSnapStep       = 0.1
	defaultAPIPort        = 7575
	defaultRefreshSeconds = 60
)

const (
	// ThemeDark is the default Beacon Room appearance.
	ThemeDark = "dark"
	// ThemeLight is the bright application appearance.
	ThemeLight = "light"
	// ThemeSystem follows the operating-system colour preference.
	ThemeSystem = "system"
)

// Point is a position in the two-dimensional room coordinate system.
type Point struct {
	ID string  `json:"id"`
	X  float64 `json:"x"`
	Y  float64 `json:"y"`
}

// InteriorShape is an editable room object. Tall shapes visually occlude tracking coverage.
type InteriorShape struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Points []Point `json:"points"`
	IsTall bool    `json:"isTall"`
}

// Room defines the user-drawn room boundary and interior annotations.
type Room struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Points []Point         `json:"points"`
	Closed bool            `json:"closed"`
	Shapes []InteriorShape `json:"shapes"`
}

// BaseStation contains both discovered device identity and the user-planned placement.
type BaseStation struct {
	ID               string  `json:"id"`
	BluetoothName    string  `json:"bluetoothName"`
	BluetoothID      string  `json:"bluetoothId"`
	Name             string  `json:"name"`
	Position         *Point  `json:"position,omitempty"`
	PoweredOn        bool    `json:"poweredOn"`
	PowerState       string  `json:"powerState"`
	PowerError       string  `json:"powerError,omitempty"`
	Icon             string  `json:"icon"`
	OutlineColor     string  `json:"outlineColor"`
	CoverageAngle    float64 `json:"coverageAngle"`
	CoverageRotation float64 `json:"coverageRotation"`
}

// APISettings configures the optional loopback HTTP control service.
type APISettings struct {
	Enabled bool `json:"enabled"`
	Port    int  `json:"port"`
}

// NotificationSettings controls which native desktop notifications Beacon Room emits.
type NotificationSettings struct {
	Enabled             bool `json:"enabled"`
	StationStateChanges bool `json:"stationStateChanges"`
	StationErrors       bool `json:"stationErrors"`
}

// StatusRefreshSettings controls background station-state polling while the app is running.
type StatusRefreshSettings struct {
	Enabled         bool `json:"enabled"`
	IntervalSeconds int  `json:"intervalSeconds"`
}

// AppSettings contains preferences that are independent of the room plan.
type AppSettings struct {
	HideToTray    bool                  `json:"hideToTray"`
	API           APISettings           `json:"api"`
	Theme         string                `json:"theme"`
	Notifications NotificationSettings  `json:"notifications"`
	StatusRefresh StatusRefreshSettings `json:"statusRefresh"`
}

// DefaultAppSettings returns the settings used for new and migrated layouts.
func DefaultAppSettings() AppSettings {
	return AppSettings{
		API:   APISettings{Port: defaultAPIPort},
		Theme: ThemeDark,
		Notifications: NotificationSettings{
			StationStateChanges: true,
			StationErrors:       true,
		},
		StatusRefresh: StatusRefreshSettings{IntervalSeconds: defaultRefreshSeconds},
	}
}

// NormalizeAppSettings validates preferences received from persisted state or the UI.
func NormalizeAppSettings(settings AppSettings) AppSettings {
	defaults := DefaultAppSettings()
	if settings.API.Port < 1 || settings.API.Port > 65535 {
		settings.API.Port = defaults.API.Port
	}
	if settings.StatusRefresh.IntervalSeconds < 5 || settings.StatusRefresh.IntervalSeconds > 3600 {
		settings.StatusRefresh.IntervalSeconds = defaults.StatusRefresh.IntervalSeconds
	}
	switch settings.Theme {
	case ThemeDark, ThemeLight, ThemeSystem:
	default:
		settings.Theme = defaults.Theme
	}
	return settings
}

// State is the complete persisted planner state.
type State struct {
	Room          Room          `json:"room"`
	Stations      []BaseStation `json:"stations"`
	SetupComplete bool          `json:"setupComplete"`
	SnapStep      float64       `json:"snapStep"`
	Settings      AppSettings   `json:"settings"`
}

// Store provides persistence for room layouts.
type Store interface {
	Load(context.Context) (State, error)
	Save(context.Context, State) error
	SaveRoom(context.Context, Room) error
}

// FileStore persists state as an atomically replaced JSON document.
type FileStore struct {
	path string
	mu   sync.Mutex
}

// NewDefaultFileStore constructs the platform-specific Beacon Room store.
func NewDefaultFileStore() (*FileStore, error) {
	configDirectory, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("resolve user config directory: %w", err)
	}
	return NewFileStore(filepath.Join(configDirectory, "BeaconRoom", "layout.json")), nil
}

// NewFileStore constructs a file store at path.
func NewFileStore(path string) *FileStore {
	return &FileStore{path: path}
}

// Load returns an empty state when no saved layout exists yet.
func (s *FileStore) Load(ctx context.Context) (State, error) {
	if err := ctx.Err(); err != nil {
		return State{}, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

// Save atomically replaces the saved state.
func (s *FileStore) Save(ctx context.Context, state State) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(state)
}

// SaveRoom updates only the room portion of an existing state.
func (s *FileStore) SaveRoom(ctx context.Context, room Room) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	state, err := s.loadLocked()
	if err != nil {
		return err
	}
	state.Room = room
	return s.saveLocked(state)
}

func (s *FileStore) loadLocked() (State, error) {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return State{}, nil
	}
	if err != nil {
		return State{}, fmt.Errorf("read layout: %w", err)
	}

	var state State
	if err := json.Unmarshal(data, &state); err != nil {
		return State{}, fmt.Errorf("decode layout: %w", err)
	}
	return migrate(state), nil
}

func migrate(state State) State {
	if state.Room.Shapes == nil {
		state.Room.Shapes = []InteriorShape{}
	}
	if state.Stations == nil {
		state.Stations = []BaseStation{}
	}
	if !isValidSnapStep(state.SnapStep) {
		state.SnapStep = defaultSnapStep
	}
	state.Settings = NormalizeAppSettings(state.Settings)

	roomCenter := centroid(state.Room.Points)
	for index := range state.Stations {
		station := &state.Stations[index]
		if station.CoverageAngle > 0 {
			continue
		}
		station.CoverageAngle = defaultCoverageAngle
		if station.Position != nil && len(state.Room.Points) >= 3 {
			station.CoverageRotation = normalizeDegrees(math.Atan2(roomCenter.Y-station.Position.Y, roomCenter.X-station.Position.X) * 180 / math.Pi)
		}
	}
	return state
}

func isValidSnapStep(value float64) bool {
	switch value {
	case 0.05, 0.1, 0.25, 0.5, 1:
		return true
	default:
		return false
	}
}

func centroid(points []Point) Point {
	if len(points) == 0 {
		return Point{}
	}
	var center Point
	for _, point := range points {
		center.X += point.X
		center.Y += point.Y
	}
	center.X /= float64(len(points))
	center.Y /= float64(len(points))
	return center
}

func normalizeDegrees(degrees float64) float64 {
	return math.Mod(math.Mod(degrees, 360)+360, 360)
}

func (s *FileStore) saveLocked(state State) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return fmt.Errorf("create state directory: %w", err)
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return fmt.Errorf("encode layout: %w", err)
	}

	temporaryPath := s.path + ".tmp"
	if err := os.WriteFile(temporaryPath, data, 0o600); err != nil {
		return fmt.Errorf("write temporary layout: %w", err)
	}
	if err := os.Rename(temporaryPath, s.path); err != nil {
		return fmt.Errorf("replace layout: %w", err)
	}
	return nil
}
