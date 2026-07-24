// SPDX-License-Identifier: Apache-2.0

#include <errno.h>

#include <zephyr/device.h>
#include <zephyr/usb/bos.h>
#include <zephyr/usb/usbd.h>

#include "usb_device.h"

USBD_DEVICE_DEFINE(beacon_usbd,
		   DEVICE_DT_GET(DT_NODELABEL(zephyr_udc0)),
		   CONFIG_BEACON_USB_VID, CONFIG_BEACON_USB_PID);

USBD_DESC_LANG_DEFINE(beacon_lang);
USBD_DESC_MANUFACTURER_DEFINE(beacon_manufacturer, CONFIG_BEACON_USB_MANUFACTURER);
USBD_DESC_PRODUCT_DEFINE(beacon_product, CONFIG_BEACON_USB_PRODUCT);
USBD_DESC_CONFIG_DEFINE(beacon_fs_configuration, "Full speed configuration");

USBD_CONFIGURATION_DEFINE(beacon_fs_config, 0, 125, &beacon_fs_configuration);

static void beacon_set_device_class(struct usbd_context *context)
{
	usbd_device_set_code_triple(context, USBD_SPEED_FS,
				    USB_BCC_MISCELLANEOUS, 0x02, 0x01);
}

int beacon_usb_start(usbd_msg_cb_t callback)
{
	int err;

	err = usbd_add_descriptor(&beacon_usbd, &beacon_lang);
	if (err != 0) {
		return err;
	}
	err = usbd_add_descriptor(&beacon_usbd, &beacon_manufacturer);
	if (err != 0) {
		return err;
	}
	err = usbd_add_descriptor(&beacon_usbd, &beacon_product);
	if (err != 0) {
		return err;
	}
	err = usbd_add_configuration(&beacon_usbd, USBD_SPEED_FS, &beacon_fs_config);
	if (err != 0) {
		return err;
	}
	err = usbd_register_all_classes(&beacon_usbd, USBD_SPEED_FS, 1, NULL);
	if (err != 0) {
		return err;
	}
	beacon_set_device_class(&beacon_usbd);
	if (callback != NULL) {
		err = usbd_msg_register_cb(&beacon_usbd, callback);
		if (err != 0) {
			return err;
		}
	}
	err = usbd_init(&beacon_usbd);
	if (err != 0) {
		return err;
	}
	if (!usbd_can_detect_vbus(&beacon_usbd)) {
		err = usbd_enable(&beacon_usbd);
		if (err != 0) {
			return err;
		}
	}
	return 0;
}
