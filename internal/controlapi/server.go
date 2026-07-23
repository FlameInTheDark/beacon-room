// Package controlapi exposes a local HTTP interface for Beacon Room automation.
package controlapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"steamvr-room-planner/internal/layout"
	"steamvr-room-planner/internal/lighthouse"
)

const (
	apiPrefix          = "/api/v1"
	serverReadTimeout  = 15 * time.Second
	serverWriteTimeout = 60 * time.Second
	serverIdleTimeout  = 60 * time.Second
)

// StationController contains the base-station operations available to local automation.
type StationController interface {
	ListStations(context.Context) ([]layout.BaseStation, error)
	DiscoverStations(context.Context) ([]layout.BaseStation, error)
	RefreshStations(context.Context) ([]lighthouse.PowerResult, error)
	SetAllStationsPower(context.Context, bool) ([]lighthouse.PowerResult, error)
	SetStationPowerByID(context.Context, string, bool) (lighthouse.PowerResult, error)
}

// Server owns the loopback HTTP listener. It never exposes control endpoints beyond the local machine.
type Server struct {
	stations StationController
	mu       sync.Mutex
	server   *http.Server
	listener net.Listener
	lastErr  error
}

// NewServer creates an API server backed by stations.
func NewServer(stations StationController) *Server {
	return &Server{stations: stations}
}

// Start begins serving requests on 127.0.0.1:port.
func (s *Server) Start(port int) error {
	if port < 1 || port > 65535 {
		return fmt.Errorf("API port %d is outside the valid range", port)
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.server != nil {
		return fmt.Errorf("API server is already running on %s", s.listener.Addr())
	}

	listener, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", fmt.Sprint(port)))
	if err != nil {
		return fmt.Errorf("listen on local API port %d: %w", port, err)
	}
	server := &http.Server{
		Handler:      s.Handler(),
		ReadTimeout:  serverReadTimeout,
		WriteTimeout: serverWriteTimeout,
		IdleTimeout:  serverIdleTimeout,
	}
	s.server = server
	s.listener = listener
	s.lastErr = nil

	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			s.mu.Lock()
			if s.server == server {
				s.server = nil
				s.listener = nil
				s.lastErr = serveErr
			}
			s.mu.Unlock()
		}
	}()
	return nil
}

// Stop gracefully shuts down the active local API server.
func (s *Server) Stop(ctx context.Context) error {
	s.mu.Lock()
	server := s.server
	s.server = nil
	s.listener = nil
	s.mu.Unlock()
	if server == nil {
		return nil
	}
	if err := server.Shutdown(ctx); err != nil {
		return fmt.Errorf("stop local API server: %w", err)
	}
	return nil
}

// Running reports whether the server has an active listener and its address.
func (s *Server) Running() (bool, string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.listener == nil {
		return false, ""
	}
	return true, "http://" + s.listener.Addr().String() + apiPrefix
}

// Handler returns the HTTP handler used by the local API server.
func (s *Server) Handler() http.Handler {
	return http.HandlerFunc(s.serveHTTP)
}

func (s *Server) serveHTTP(writer http.ResponseWriter, request *http.Request) {
	if s.stations == nil {
		writeError(writer, http.StatusServiceUnavailable, "base-station control is unavailable")
		return
	}

	path := strings.TrimPrefix(request.URL.Path, apiPrefix)
	switch {
	case request.Method == http.MethodGet && path == "/stations":
		s.handleListStations(writer, request)
	case request.Method == http.MethodPost && path == "/stations/discover":
		s.handleDiscover(writer, request)
	case request.Method == http.MethodPost && path == "/stations/refresh":
		s.handleRefresh(writer, request)
	case request.Method == http.MethodPost && path == "/stations/on":
		s.handleSetAllPower(writer, request, true)
	case request.Method == http.MethodPost && path == "/stations/off":
		s.handleSetAllPower(writer, request, false)
	case request.Method == http.MethodPost:
		s.handleSetStationPower(writer, request, path)
	default:
		writeError(writer, http.StatusNotFound, "route not found")
	}
}

func (s *Server) handleListStations(writer http.ResponseWriter, request *http.Request) {
	stations, err := s.stations.ListStations(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"stations": stations})
}

func (s *Server) handleDiscover(writer http.ResponseWriter, request *http.Request) {
	stations, err := s.stations.DiscoverStations(request.Context())
	if err != nil {
		writeError(writer, http.StatusServiceUnavailable, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"stations": stations})
}

func (s *Server) handleRefresh(writer http.ResponseWriter, request *http.Request) {
	results, err := s.stations.RefreshStations(request.Context())
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleSetAllPower(writer http.ResponseWriter, request *http.Request, poweredOn bool) {
	results, err := s.stations.SetAllStationsPower(request.Context(), poweredOn)
	if err != nil {
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{"results": results})
}

func (s *Server) handleSetStationPower(writer http.ResponseWriter, request *http.Request, path string) {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	if len(segments) != 3 || segments[0] != "stations" || segments[1] == "" || (segments[2] != "on" && segments[2] != "off") {
		writeError(writer, http.StatusNotFound, "route not found")
		return
	}
	result, err := s.stations.SetStationPowerByID(request.Context(), segments[1], segments[2] == "on")
	if err != nil {
		if errors.Is(err, ErrStationNotFound) {
			writeError(writer, http.StatusNotFound, err.Error())
			return
		}
		writeError(writer, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(writer, http.StatusOK, result)
}

// ErrStationNotFound identifies a requested station that is absent from the saved layout.
var ErrStationNotFound = errors.New("station not found")

func writeJSON(writer http.ResponseWriter, status int, payload any) {
	writer.Header().Set("Content-Type", "application/json; charset=utf-8")
	writer.WriteHeader(status)
	if err := json.NewEncoder(writer).Encode(payload); err != nil {
		return
	}
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}
