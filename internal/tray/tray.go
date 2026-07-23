// Package tray provides the native Beacon Room system-tray integration.
package tray

import (
	"sync"

	"github.com/getlantern/systray"
)

// Actions are the application operations exposed through the system-tray menu.
type Actions interface {
	ShowWindow()
	SetAllPowerFromTray(poweredOn bool)
	QuitFromTray()
}

// Controller creates one native tray icon for the lifetime of the application.
type Controller struct {
	icon    []byte
	actions Actions

	startOnce sync.Once
	stateMu   sync.Mutex
	started   bool
}

// NewController constructs a tray controller using the supplied PNG icon.
func NewController(icon []byte, actions Actions) *Controller {
	return &Controller{icon: icon, actions: actions}
}

// Start launches the native tray event loop exactly once.
func (c *Controller) Start() {
	c.startOnce.Do(func() {
		go systray.Run(c.onReady, c.onExit)
	})
}

// Close removes the native tray icon when the application exits.
func (c *Controller) Close() {
	c.stateMu.Lock()
	started := c.started
	c.stateMu.Unlock()
	if started {
		systray.Quit()
	}
}

func (c *Controller) onReady() {
	c.stateMu.Lock()
	c.started = true
	c.stateMu.Unlock()

	if len(c.icon) > 0 {
		systray.SetIcon(c.icon)
	}
	systray.SetTitle("Beacon Room")
	systray.SetTooltip("Beacon Room")

	show := systray.AddMenuItem("Show Beacon Room", "Show the Beacon Room window")
	on := systray.AddMenuItem("Turn all base stations on", "Wake all saved base stations")
	off := systray.AddMenuItem("Turn all base stations off", "Put all saved base stations into standby")
	systray.AddSeparator()
	closeItem := systray.AddMenuItem("Close Beacon Room", "Quit Beacon Room completely")

	for {
		select {
		case <-show.ClickedCh:
			c.actions.ShowWindow()
		case <-on.ClickedCh:
			c.actions.SetAllPowerFromTray(true)
		case <-off.ClickedCh:
			c.actions.SetAllPowerFromTray(false)
		case <-closeItem.ClickedCh:
			c.actions.QuitFromTray()
			return
		}
	}
}

func (c *Controller) onExit() {
	c.stateMu.Lock()
	c.started = false
	c.stateMu.Unlock()
}
