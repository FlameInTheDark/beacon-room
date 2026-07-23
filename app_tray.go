package main

// trayActions keeps the public tray callback contract out of the Wails binding surface.
type trayActions struct {
	app *App
}

func (a trayActions) ShowWindow() {
	a.app.showWindow()
}

func (a trayActions) SetAllPowerFromTray(poweredOn bool) {
	a.app.setAllPowerFromTray(poweredOn)
}

func (a trayActions) QuitFromTray() {
	a.app.quitFromTray()
}
