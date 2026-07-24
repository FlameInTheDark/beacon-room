// SPDX-License-Identifier: Apache-2.0

#include <errno.h>
#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/conn.h>
#include <zephyr/bluetooth/gatt.h>
#include <zephyr/bluetooth/hci.h>
#include <zephyr/bluetooth/uuid.h>
#include <zephyr/device.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/kernel.h>
#include <zephyr/sys/printk.h>
#include <zephyr/sys/util.h>
#include <zephyr/usb/usbd.h>

#include "usb_device.h"

#define BEACON_MAX_STATIONS 8
#define BEACON_ADDRESS_LENGTH 18
#define BEACON_NAME_LENGTH 30
#define BEACON_COMMAND_LENGTH 96
#define BEACON_RESPONSE_LENGTH 128
#define BEACON_SCAN_DURATION K_SECONDS(5)
#define BEACON_GATT_TIMEOUT K_SECONDS(5)

#define LIGHTHOUSE_POWER_SERVICE_UUID \
	BT_UUID_DECLARE_128(BT_UUID_128_ENCODE(0x00001523, 0x1212, 0xefde, 0x1523, 0x785feabcd124))
#define LIGHTHOUSE_POWER_CHARACTERISTIC_UUID \
	BT_UUID_DECLARE_128(BT_UUID_128_ENCODE(0x00001525, 0x1212, 0xefde, 0x1523, 0x785feabcd124))

enum lighthouse_power_state {
	LIGHTHOUSE_POWER_ON,
	LIGHTHOUSE_POWER_OFF,
	LIGHTHOUSE_POWER_BOOTING,
	LIGHTHOUSE_POWER_UNKNOWN,
};

struct lighthouse_station {
	bt_addr_le_t address;
	char address_text[BEACON_ADDRESS_LENGTH];
	char name[BEACON_NAME_LENGTH];
};

static const struct device *const serial = DEVICE_DT_GET_ONE(zephyr_cdc_acm_uart);
static struct lighthouse_station stations[BEACON_MAX_STATIONS];
static size_t station_count;

static K_SEM_DEFINE(connection_ready, 0, 1);
static K_SEM_DEFINE(gatt_complete, 0, 1);
static int connection_error;
static int gatt_error;
static uint16_t service_start_handle;
static uint16_t service_end_handle;
static uint16_t power_characteristic_handle;
static uint8_t power_readback;
static bool power_readback_received;
static struct bt_gatt_discover_params discovery;
static struct bt_gatt_write_params write_params;
static struct bt_gatt_read_params read_params;

static void send_line(const char *format, ...)
{
	char response[BEACON_RESPONSE_LENGTH];
	va_list arguments;
	int length;

	va_start(arguments, format);
	length = vsnprintk(response, sizeof(response) - 2, format, arguments);
	va_end(arguments);
	if (length < 0) {
		return;
	}
	response[MIN((size_t)length, sizeof(response) - 2)] = '\n';
	response[MIN((size_t)length + 1, sizeof(response) - 1)] = '\0';
	for (size_t index = 0; response[index] != '\0'; index++) {
		uart_poll_out(serial, response[index]);
	}
}

static void send_error(const char *message)
{
	send_line("ERROR %s", message);
	send_line("DONE");
}

static void format_address(const bt_addr_le_t *address, char *output, size_t output_size)
{
	snprintk(output, output_size, "%02X:%02X:%02X:%02X:%02X:%02X",
		 address->a.val[5], address->a.val[4], address->a.val[3],
		 address->a.val[2], address->a.val[1], address->a.val[0]);
}

static bool read_advertised_name(struct bt_data *data, void *user_data)
{
	char *name = user_data;
	size_t length;

	if (data->type != BT_DATA_NAME_COMPLETE && data->type != BT_DATA_NAME_SHORTENED) {
		return true;
	}
	length = MIN(data->data_len, BEACON_NAME_LENGTH - 1);
	memcpy(name, data->data, length);
	name[length] = '\0';
	return false;
}

static bool same_station(const struct lighthouse_station *station, const char *address, const char *name)
{
	return strcmp(station->address_text, address) == 0 || strcmp(station->name, name) == 0;
}

static void station_found(const bt_addr_le_t *address, int8_t rssi, uint8_t type,
			  struct net_buf_simple *advertisement)
{
	char name[BEACON_NAME_LENGTH] = {0};
	char address_text[BEACON_ADDRESS_LENGTH];

	ARG_UNUSED(rssi);
	ARG_UNUSED(type);
	bt_data_parse(advertisement, read_advertised_name, name);
	if (strncmp(name, "LHB-", 4) != 0) {
		return;
	}
	format_address(address, address_text, sizeof(address_text));
	for (size_t index = 0; index < station_count; index++) {
		if (same_station(&stations[index], address_text, name)) {
			return;
		}
	}
	if (station_count == BEACON_MAX_STATIONS) {
		return;
	}
	bt_addr_le_copy(&stations[station_count].address, address);
	strcpy(stations[station_count].address_text, address_text);
	strcpy(stations[station_count].name, name);
	station_count++;
}

static int scan_lighthouse_stations(void)
{
	int error;

	station_count = 0;
	error = bt_le_scan_start(BT_LE_SCAN_ACTIVE, station_found);
	if (error != 0) {
		return error;
	}
	k_sleep(BEACON_SCAN_DURATION);
	error = bt_le_scan_stop();
	if (error == -EALREADY) {
		return 0;
	}
	return error;
}

static const struct lighthouse_station *find_station(const char *target)
{
	for (size_t index = 0; index < station_count; index++) {
		if (strcmp(stations[index].name, target) == 0 ||
		    strcmp(stations[index].address_text, target) == 0) {
			return &stations[index];
		}
	}
	return NULL;
}

static void on_connected(struct bt_conn *connection, uint8_t error)
{
	ARG_UNUSED(connection);
	connection_error = error == 0 ? 0 : -error;
	k_sem_give(&connection_ready);
}

BT_CONN_CB_DEFINE(connection_callbacks) = {
	.connected = on_connected,
};

static int connect_station(const struct lighthouse_station *station, struct bt_conn **connection)
{
	int error;

	k_sem_reset(&connection_ready);
	connection_error = 0;
	error = bt_conn_le_create(&station->address, BT_CONN_LE_CREATE_CONN,
				  BT_LE_CONN_PARAM_DEFAULT, connection);
	if (error != 0) {
		return error;
	}
	if (k_sem_take(&connection_ready, BEACON_GATT_TIMEOUT) != 0) {
		bt_conn_unref(*connection);
		*connection = NULL;
		return -ETIMEDOUT;
	}
	if (connection_error != 0) {
		bt_conn_unref(*connection);
		*connection = NULL;
		return connection_error;
	}
	return 0;
}

static void disconnect_station(struct bt_conn *connection)
{
	if (connection == NULL) {
		return;
	}
	(void)bt_conn_disconnect(connection, BT_HCI_ERR_REMOTE_USER_TERM_CONN);
	bt_conn_unref(connection);
}

static uint8_t discover_service(struct bt_conn *connection, const struct bt_gatt_attr *attribute,
				struct bt_gatt_discover_params *parameters)
{
	const struct bt_gatt_service_val *service;

	ARG_UNUSED(connection);
	ARG_UNUSED(parameters);
	if (attribute == NULL) {
		k_sem_give(&gatt_complete);
		return BT_GATT_ITER_STOP;
	}
	service = attribute->user_data;
	service_start_handle = attribute->handle + 1;
	service_end_handle = service->end_handle;
	k_sem_give(&gatt_complete);
	return BT_GATT_ITER_STOP;
}

static uint8_t discover_characteristic(struct bt_conn *connection, const struct bt_gatt_attr *attribute,
				       struct bt_gatt_discover_params *parameters)
{
	const struct bt_gatt_chrc *characteristic;

	ARG_UNUSED(connection);
	ARG_UNUSED(parameters);
	if (attribute == NULL) {
		k_sem_give(&gatt_complete);
		return BT_GATT_ITER_STOP;
	}
	characteristic = attribute->user_data;
	power_characteristic_handle = characteristic->value_handle;
	k_sem_give(&gatt_complete);
	return BT_GATT_ITER_STOP;
}

static int wait_for_gatt(void)
{
	if (k_sem_take(&gatt_complete, BEACON_GATT_TIMEOUT) != 0) {
		return -ETIMEDOUT;
	}
	return gatt_error;
}

static int discover_power_characteristic(struct bt_conn *connection)
{
	int error;

	service_start_handle = 0;
	service_end_handle = 0;
	power_characteristic_handle = 0;
	gatt_error = 0;
	k_sem_reset(&gatt_complete);
	memset(&discovery, 0, sizeof(discovery));
	discovery.uuid = LIGHTHOUSE_POWER_SERVICE_UUID;
	discovery.func = discover_service;
	discovery.start_handle = BT_ATT_FIRST_ATTRIBUTE_HANDLE;
	discovery.end_handle = BT_ATT_LAST_ATTRIBUTE_HANDLE;
	discovery.type = BT_GATT_DISCOVER_PRIMARY;
	error = bt_gatt_discover(connection, &discovery);
	if (error != 0) {
		return error;
	}
	error = wait_for_gatt();
	if (error != 0) {
		return error;
	}
	if (service_start_handle == 0 || service_end_handle == 0) {
		return -ENOENT;
	}

	gatt_error = 0;
	k_sem_reset(&gatt_complete);
	memset(&discovery, 0, sizeof(discovery));
	discovery.uuid = LIGHTHOUSE_POWER_CHARACTERISTIC_UUID;
	discovery.func = discover_characteristic;
	discovery.start_handle = service_start_handle;
	discovery.end_handle = service_end_handle;
	discovery.type = BT_GATT_DISCOVER_CHARACTERISTIC;
	error = bt_gatt_discover(connection, &discovery);
	if (error != 0) {
		return error;
	}
	error = wait_for_gatt();
	if (error != 0) {
		return error;
	}
	return power_characteristic_handle == 0 ? -ENOENT : 0;
}

static void write_power_complete(struct bt_conn *connection, uint8_t error,
				 struct bt_gatt_write_params *parameters)
{
	ARG_UNUSED(connection);
	ARG_UNUSED(parameters);
	gatt_error = error == 0 ? 0 : -error;
	k_sem_give(&gatt_complete);
}

static int write_power(struct bt_conn *connection, bool powered_on)
{
	uint8_t command = powered_on ? 0x01 : 0x00;
	int error;

	gatt_error = 0;
	k_sem_reset(&gatt_complete);
	memset(&write_params, 0, sizeof(write_params));
	write_params.func = write_power_complete;
	write_params.handle = power_characteristic_handle;
	write_params.data = &command;
	write_params.length = sizeof(command);
	error = bt_gatt_write(connection, &write_params);
	if (error != 0) {
		return error;
	}
	return wait_for_gatt();
}

static uint8_t read_power_complete(struct bt_conn *connection, uint8_t error,
					struct bt_gatt_read_params *parameters,
					const void *data, uint16_t length)
{
	ARG_UNUSED(connection);
	ARG_UNUSED(parameters);
	if (error != 0) {
		gatt_error = -error;
		k_sem_give(&gatt_complete);
		return BT_GATT_ITER_STOP;
	}
	if (data == NULL || length == 0) {
		gatt_error = -ENODATA;
		k_sem_give(&gatt_complete);
		return BT_GATT_ITER_STOP;
	}
	power_readback = ((const uint8_t *)data)[0];
	power_readback_received = true;
	k_sem_give(&gatt_complete);
	return BT_GATT_ITER_STOP;
}

static int read_power(struct bt_conn *connection, enum lighthouse_power_state *state)
{
	int error;

	gatt_error = 0;
	power_readback_received = false;
	k_sem_reset(&gatt_complete);
	memset(&read_params, 0, sizeof(read_params));
	read_params.func = read_power_complete;
	read_params.handle_count = 1;
	read_params.single.handle = power_characteristic_handle;
	read_params.single.offset = 0;
	error = bt_gatt_read(connection, &read_params);
	if (error != 0) {
		return error;
	}
	error = wait_for_gatt();
	if (error != 0) {
		return error;
	}
	if (!power_readback_received) {
		return -ENODATA;
	}
	switch (power_readback) {
	case 0x00:
	case 0x02:
		*state = LIGHTHOUSE_POWER_OFF;
		break;
	case 0x01:
	case 0x08:
	case 0x09:
		*state = LIGHTHOUSE_POWER_BOOTING;
		break;
	case 0x0B:
		*state = LIGHTHOUSE_POWER_ON;
		break;
	default:
		*state = LIGHTHOUSE_POWER_UNKNOWN;
		break;
	}
	return 0;
}

static const char *power_state_name(enum lighthouse_power_state state)
{
	switch (state) {
	case LIGHTHOUSE_POWER_ON:
		return "on";
	case LIGHTHOUSE_POWER_OFF:
		return "off";
	case LIGHTHOUSE_POWER_BOOTING:
		return "booting";
	default:
		return "unknown";
	}
}

static int query_resolved_station(const struct lighthouse_station *station, bool change_power,
				  bool powered_on, enum lighthouse_power_state *state)
{
	struct bt_conn *connection = NULL;
	int error;

	error = connect_station(station, &connection);
	if (error != 0) {
		return error;
	}
	error = discover_power_characteristic(connection);
	if (error == 0 && change_power) {
		error = write_power(connection, powered_on);
	}
	if (error == 0) {
		error = read_power(connection, state);
	}
	disconnect_station(connection);
	if (error != 0) {
		return error;
	}
	return 0;
}

static int query_station(const char *target, bool change_power, bool powered_on,
			 const struct lighthouse_station **resolved,
			 enum lighthouse_power_state *state)
{
	const struct lighthouse_station *station;
	int error;

	error = scan_lighthouse_stations();
	if (error != 0) {
		return error;
	}
	station = find_station(target);
	if (station == NULL) {
		return -ENOENT;
	}
	error = query_resolved_station(station, change_power, powered_on, state);
	if (error != 0) {
		return error;
	}
	*resolved = station;
	return 0;
}

static void handle_scan(void)
{
	int error = scan_lighthouse_stations();

	if (error != 0) {
		send_error("scan_failed");
		return;
	}
	for (size_t index = 0; index < station_count; index++) {
		enum lighthouse_power_state state = LIGHTHOUSE_POWER_UNKNOWN;

		(void)query_resolved_station(&stations[index], false, false, &state);
		send_line("STATION %s %s %s", stations[index].address_text, power_state_name(state),
			  stations[index].name);
	}
	send_line("DONE");
}

static void handle_query(const char *target, bool change_power, bool powered_on)
{
	const struct lighthouse_station *station;
	enum lighthouse_power_state state;
	int error = query_station(target, change_power, powered_on, &station, &state);

	if (error != 0) {
		send_error(error == -ENOENT ? "station_not_found" : "power_service_failed");
		return;
	}
	send_line("STATE %s %s %s", station->address_text, power_state_name(state), station->name);
	send_line("DONE");
}

static void process_command(char *command)
{
	char *save_pointer = NULL;
	char *verb = strtok_r(command, " ", &save_pointer);
	char *target;
	char *argument;

	if (verb == NULL) {
		return;
	}
	if (strcmp(verb, "PING") == 0) {
		send_line("PONG");
		send_line("DONE");
		return;
	}
	if (strcmp(verb, "SCAN") == 0) {
		handle_scan();
		return;
	}
	target = strtok_r(NULL, " ", &save_pointer);
	if (target == NULL) {
		send_error("missing_station");
		return;
	}
	if (strcmp(verb, "STATUS") == 0 && strtok_r(NULL, " ", &save_pointer) == NULL) {
		handle_query(target, false, false);
		return;
	}
	if (strcmp(verb, "POWER") != 0) {
		send_error("unknown_command");
		return;
	}
	argument = strtok_r(NULL, " ", &save_pointer);
	if (argument == NULL || strtok_r(NULL, " ", &save_pointer) != NULL) {
		send_error("invalid_power_command");
		return;
	}
	if (strcmp(argument, "ON") == 0) {
		handle_query(target, true, true);
		return;
	}
	if (strcmp(argument, "OFF") == 0) {
		handle_query(target, true, false);
		return;
	}
	send_error("invalid_power_state");
}

static void usb_message(struct usbd_context *const context, const struct usbd_msg *message)
{
	if (!usbd_can_detect_vbus(context)) {
		return;
	}
	if (message->type == USBD_MSG_VBUS_READY) {
		(void)usbd_enable(context);
	}
	if (message->type == USBD_MSG_VBUS_REMOVED) {
		(void)usbd_disable(context);
	}
}

int main(void)
{
	char command[BEACON_COMMAND_LENGTH];
	size_t command_length = 0;
	uint8_t character;
	int error;

	if (!device_is_ready(serial)) {
		return 0;
	}
	error = beacon_usb_start(usb_message);
	if (error != 0) {
		return 0;
	}
	/* The next-generation CDC ACM driver queues USB OUT transfers only after
	 * RX is enabled. Polling below then drains the driver's receive FIFO. */
	uart_irq_rx_enable(serial);
	error = bt_enable(NULL);
	if (error != 0) {
		send_error("bluetooth_start_failed");
		return 0;
	}

	while (true) {
		if (uart_poll_in(serial, &character) != 0) {
			k_sleep(K_MSEC(5));
			continue;
		}
		if (character == '\r') {
			continue;
		}
		if (character == '\n') {
			command[command_length] = '\0';
			process_command(command);
			command_length = 0;
			continue;
		}
		if (command_length + 1 >= sizeof(command)) {
			command_length = 0;
			send_error("command_too_long");
			continue;
		}
		command[command_length++] = character;
	}
}
