// SPDX-License-Identifier: Apache-2.0

#ifndef BEACON_ROOM_USB_DEVICE_H
#define BEACON_ROOM_USB_DEVICE_H

#include <zephyr/usb/usbd.h>

int beacon_usb_start(usbd_msg_cb_t callback);

#endif
