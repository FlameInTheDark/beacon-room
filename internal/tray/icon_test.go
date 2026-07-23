package tray

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestIconFromPNG(t *testing.T) {
	imageValue := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	imageValue.SetNRGBA(0, 0, color.NRGBA{R: 144, G: 92, B: 246, A: 255})
	imageValue.SetNRGBA(1, 1, color.NRGBA{R: 54, G: 201, B: 135, A: 255})

	var source bytes.Buffer
	if err := png.Encode(&source, imageValue); err != nil {
		t.Fatalf("encode source PNG: %v", err)
	}

	ico, err := IconFromPNG(source.Bytes())
	if err != nil {
		t.Fatalf("convert icon: %v", err)
	}

	if got, want := len(ico), icoHeaderSize+bitmapHeaderSize+trayIconSize*trayIconSize*4+trayIconSize*maskBytesPerScanline; got != want {
		t.Fatalf("icon length = %d, want %d", got, want)
	}
	if got := binary.LittleEndian.Uint16(ico[2:]); got != 1 {
		t.Errorf("icon type = %d, want 1", got)
	}
	if got := binary.LittleEndian.Uint16(ico[4:]); got != 1 {
		t.Errorf("icon image count = %d, want 1", got)
	}
	if got := binary.LittleEndian.Uint16(ico[12:]); got != bitsPerPixel {
		t.Errorf("bit count = %d, want %d", got, bitsPerPixel)
	}
}

func TestIconFromPNGRejectsInvalidData(t *testing.T) {
	if _, err := IconFromPNG([]byte("not a PNG")); err == nil {
		t.Fatal("IconFromPNG succeeded for invalid data")
	}
}
