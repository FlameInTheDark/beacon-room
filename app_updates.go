package main

import (
	"context"
	"log"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	updateCheckInterval = time.Hour
	updateCheckTimeout  = 10 * time.Second
)

func (a *App) startUpdateChecks() {
	if a.updates == nil || a.backgroundCtx == nil {
		return
	}
	go a.runUpdateChecks(a.backgroundCtx)
}

func (a *App) runUpdateChecks(ctx context.Context) {
	a.checkForUpdate(ctx)

	ticker := time.NewTicker(updateCheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			a.checkForUpdate(ctx)
		}
	}
}

func (a *App) checkForUpdate(ctx context.Context) {
	operationCtx, cancel := context.WithTimeout(ctx, updateCheckTimeout)
	release, available, err := a.updates.Check(operationCtx)
	cancel()
	if err != nil {
		if ctx.Err() == nil {
			log.Printf("check for Beacon Room update: %v", err)
		}
		return
	}
	if !available {
		return
	}

	update := UpdateAvailability{Available: true, Version: release.Version, URL: release.URL}
	a.updateMu.Lock()
	changed := a.update != update
	a.update = update
	a.updateMu.Unlock()
	if changed {
		runtime.EventsEmit(a.context(), "update-available", update)
	}
}
