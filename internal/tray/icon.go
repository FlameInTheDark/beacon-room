package tray

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image"
	"image/color"
	"image/png"
)

const (
	trayIconSize         = 32
	icoHeaderSize        = 22
	bitmapHeaderSize     = 40
	bitsPerPixel         = 32
	maskBytesPerScanline = 4
)

// IconFromPNG converts a PNG asset into the ICO payload required by the Windows tray API.
func IconFromPNG(source []byte) ([]byte, error) {
	imageValue, err := png.Decode(bytes.NewReader(source))
	if err != nil {
		return nil, fmt.Errorf("decode tray icon PNG: %w", err)
	}

	bounds := imageValue.Bounds()
	if bounds.Dx() == 0 || bounds.Dy() == 0 {
		return nil, fmt.Errorf("decode tray icon PNG: image has no dimensions")
	}

	pixelBytes := trayIconSize * trayIconSize * (bitsPerPixel / 8)
	maskBytes := trayIconSize * maskBytesPerScanline
	imageBytes := bitmapHeaderSize + pixelBytes + maskBytes
	ico := make([]byte, icoHeaderSize+imageBytes)
	writeIconHeader(ico, imageBytes)
	writeBitmapHeader(ico[icoHeaderSize:], pixelBytes)
	writePixels(ico[icoHeaderSize+bitmapHeaderSize:icoHeaderSize+bitmapHeaderSize+pixelBytes], imageValue)
	return ico, nil
}

func writeIconHeader(destination []byte, imageBytes int) {
	binary.LittleEndian.PutUint16(destination[2:], 1)
	binary.LittleEndian.PutUint16(destination[4:], 1)
	destination[6] = trayIconSize
	destination[7] = trayIconSize
	binary.LittleEndian.PutUint16(destination[10:], 1)
	binary.LittleEndian.PutUint16(destination[12:], bitsPerPixel)
	binary.LittleEndian.PutUint32(destination[14:], uint32(imageBytes))
	binary.LittleEndian.PutUint32(destination[18:], icoHeaderSize)
}

func writeBitmapHeader(destination []byte, pixelBytes int) {
	binary.LittleEndian.PutUint32(destination[0:], bitmapHeaderSize)
	binary.LittleEndian.PutUint32(destination[4:], trayIconSize)
	binary.LittleEndian.PutUint32(destination[8:], trayIconSize*2)
	binary.LittleEndian.PutUint16(destination[12:], 1)
	binary.LittleEndian.PutUint16(destination[14:], bitsPerPixel)
	binary.LittleEndian.PutUint32(destination[20:], uint32(pixelBytes))
}

func writePixels(destination []byte, source image.Image) {
	bounds := source.Bounds()
	bytesPerPixel := bitsPerPixel / 8
	for y := 0; y < trayIconSize; y++ {
		sourceY := bounds.Min.Y + ((trayIconSize-1-y)*bounds.Dy())/trayIconSize
		for x := 0; x < trayIconSize; x++ {
			sourceX := bounds.Min.X + (x*bounds.Dx())/trayIconSize
			pixel := color.NRGBAModel.Convert(source.At(sourceX, sourceY)).(color.NRGBA)
			offset := (y*trayIconSize + x) * bytesPerPixel
			destination[offset] = pixel.B
			destination[offset+1] = pixel.G
			destination[offset+2] = pixel.R
			destination[offset+3] = pixel.A
		}
	}
}
