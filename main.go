package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"steamvr-room-planner/internal/tray"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var trayIconPNG []byte

var appVersion = "dev"

func main() {
	app := NewApp()
	trayIcon, err := tray.IconFromPNG(trayIconPNG)
	if err != nil {
		log.Printf("prepare tray icon: %v", err)
	}
	app.attachTray(tray.NewController(trayIcon, trayActions{app: app}))

	err = wails.Run(&options.App{
		Title:     "Beacon Room",
		Width:     1320,
		Height:    820,
		MinWidth:  1000,
		MinHeight: 660,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 8, G: 9, B: 11, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnBeforeClose:    app.beforeClose,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		log.Fatal(err)
	}
}
