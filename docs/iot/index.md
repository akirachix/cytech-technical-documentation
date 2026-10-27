# IoT Monitoring and Devices

## Overview

AquaTrace uses IoT monitoring devices to collect water-quality measurements from monitoring locations across a water supply network. These measurements provide the data needed to observe changes in water quality and identify conditions that may require investigation.

Each registered device carries its own location: GPS coordinates, a name and an address. This allows readings and device-health information to be interpreted in the context of the monitoring network, for example by comparing a node with the node upstream of it.

### Status labels used on this page

| Label | Meaning |
|---|---|
| **Verified** | Confirmed from backend source code |
| **Designed** | Part of the supplied system design (architecture diagrams and proposed solution); confirm against firmware and broker configuration |
| **Illustrative** | A code sketch that shows the intended pattern; the real firmware must be confirmed |

## IoT Data-Flow Diagram

Click the image to open it full screen. The diagram should show the device, connectivity layer, message broker, backend validation, and storage, and should clearly distinguish deployed components from planned functionality.

<a href="/iot-data-flow.jpg" target="_blank">
  <img src="/iot-data-flow.jpg" alt="AquaTrace secure architecture. Click to open full size." style="max-width: 100%; height: auto;" />
</a>

## Hardware

A monitoring node is built from the following parts, as shown in the architecture diagram.

| Part | Purpose | Notes |
|---|---|---|
| ESP32 | Microcontroller that reads sensors and publishes messages | 12-bit ADC |
| pH sensor | Analog pH reading | Needs two-point or three-point calibration |
| Turbidity sensor | Analog turbidity reading in NTU | Calibrate against known standards |
| Electrical conductivity (EC) sensor | Analog EC reading | Temperature compensation is needed |
| Temperature sensor | Water temperature | Also used to compensate EC |
| GPS module (NEO-6M) | Location and UTC time from NMEA sentences | Used for node coordinates and for a trustworthy `recorded_at` |
| Cellular gateway | Connects the node to the broker | Model to confirm |

<!--
  ADD YOUR IMAGES HERE (optional)
  Wiring diagram: docs/public/images/iot/wiring-diagram.png
  Photo of a built node: docs/public/images/iot/node-photo.png
-->

<ExpandableImage src="/images/iot/wiring-diagram.png" alt="Wiring diagram of the monitoring node" caption="Figure 2. Wiring diagram of the monitoring node" />

<ExpandableImage src="/images/iot/node-photo.png" alt="Assembled monitoring node" caption="Figure 3. Assembled monitoring node" />

### Pin assignment (Illustrative)

Use ADC1 pins for analog sensors on an ESP32, because ADC2 shares hardware with the radio and can give unreliable readings while it is active.

| Function | ESP32 pin | Notes |
|---|---|---|
| pH analog output | GPIO34 | Input only, ADC1 |
| Turbidity analog output | GPIO35 | Input only, ADC1. Check the sensor's output voltage range and use a divider if it exceeds 3.3 V. |
| EC analog output | GPIO32 | ADC1 |
| Temperature | GPIO4 | Depends on the probe type |
| GPS TX to ESP32 RX | GPIO16 | UART2 |
| GPS RX from ESP32 TX | GPIO17 | UART2 |
| Modem TX and RX | GPIO26 and GPIO27 | UART1, confirm against the chosen module |

The ESP32 ADC accepts at most about 3.3 V. Never connect a 5 V sensor output directly to an ADC pin.

## Device Registration and Lifecycle

A device record identifies a monitoring node and holds its installation location (coordinates, name and address).

Each device has a unique serial number and a lifecycle status. The supplied model defines `active`, `inactive`, and `revoked` states. Installation time, last-seen time, and revocation time provide additional context about device operation.

Device registration and lifecycle rules should be verified against the backend routes, database models, and migrations before being described as fully implemented.

### Device fields

| Field | Purpose |
|---|---|
| `device_id` | UUID primary key, sent by the node in every message |
| `serial_number` | Unique label, for example `AT-RES A 001` |
| `name` and `description` | Human-readable name and notes, for example "Reservoir A" |
| `address` | Reverse-geocoded address |
| `latitude` and `longitude` | Coordinates captured at installation |
| `upstream_device_id` | The node immediately upstream, used to compare neighbouring nodes |
| `registered_by` | The user who registered the node |
| `status` | `active`, `inactive` or `revoked` |
| `installed_at` | When the node was put into service |
| `last_seen_at` | When the backend last accepted a reading from this node |
| `last_calibrated_at` | Most recent calibration |
| `revoked_at` | When the node's access was withdrawn |

```sql
CREATE TABLE devices (
  device_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number      VARCHAR(50) NOT NULL UNIQUE,
  name               VARCHAR(100),
  description        TEXT,
  address            TEXT,
  latitude           DOUBLE PRECISION CHECK (latitude  BETWEEN -90  AND 90),
  longitude          DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
  upstream_device_id UUID REFERENCES devices(device_id),
  registered_by      UUID REFERENCES users(user_id),
  status             VARCHAR(20) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive', 'revoked')),
  installed_at       TIMESTAMPTZ,
  last_seen_at       TIMESTAMPTZ,
  last_calibrated_at TIMESTAMPTZ,
  revoked_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Lifecycle

```text
register (POST /api/v1/devices)  ->  active  ->  inactive (maintenance, spare)
                                       |
                                       +------>  revoked (lost, stolen, compromised)
```

| Transition | What should happen |
|---|---|
| Register | Device row created. A broker credential is issued for that device. The `device_id` is written into the firmware configuration. |
| Deactivate | Readings are no longer accepted. History is kept. |
| Revoke | The broker credential is removed, `revoked_at` is set, and any further messages are refused. |

### Registration steps for a new node

1. A Water Quality Officer registers the node in the interface with its serial number, name and coordinates.
2. The backend stores the device and, where configured, reverse-geocodes the coordinates to an address.
3. An administrator creates a broker credential for the node and limits it to that node's topics.
4. The `device_id`, broker host, username and password are loaded into the node's configuration.
5. The node is installed and calibrated, and a first reading is checked on the dashboard.
6. A maintenance record is added for the installation and calibration.

## Telemetry and Readings

The intended monitoring flow sends measurements from field devices to the AquaTrace backend. Measurements include pH, temperature, turbidity, and electrical conductivity.

Incoming messages must be validated before they are treated as trusted sensor readings. The data model includes a device identifier and message number to help identify duplicate messages. It also distinguishes the time a measurement was recorded from the time it was stored by the backend.

Messages that fail validation are refused and are not stored as readings. Because only stored readings feed the WQI calculation and alert generation, refused messages can never influence either.

### Topic layout (Designed)

```text
aquatrace/v1/nodes/{device_id}/telemetry     readings, QoS 1
aquatrace/v1/nodes/{device_id}/status        online/offline marker, retained, set as Last Will
```

Each node is allowed to publish only to its own topics. A subscriber uses a wildcard to receive all nodes:

```text
aquatrace/v1/nodes/+/telemetry
```

### Message format

The fields match what the backend ingestion service reads (Verified).

```json
{
  "device_id": "7c1f2d9e-3a48-4b6f-9a2e-5d0b1c8e4f10",
  "message_number": 10482,
  "ph": 7.2,
  "temperature": 22.4,
  "turbidity": 6.8,
  "electrical_conductivity": 520.0,
  "sensor_status": "ok",
  "recorded_at": "2026-10-14T09:12:00Z"
}
```

| Field | Rule |
|---|---|
| `device_id` | UUID of a registered, active device |
| `message_number` | Increases by one for every message and survives reboots. Together with `device_id` it makes ingestion idempotent. |
| `recorded_at` | UTC time the sample was taken, from the GPS module. Never the time the message was sent. |
| `sensor_status` | `ok` when all sensors are healthy. Any other state means the WQI is not calculated for this reading. |

### Backend validation (Verified)

| Situation | Backend result |
|---|---|
| Unknown or malformed `device_id` | 404, the message is not stored |
| Duplicate (`device_id`, `message_number`) | The earlier reading is returned. No new row. |
| Value out of range (for example pH above 14) | 422, the message is not stored |
| Sensor status is not OK | Reading stored without a WQI score |
| Recorded more than 300 seconds before receipt | Stored with `is_buffered = true` |

::: warning
The ingestion service checks that a device exists, but not that its status is `active`. A revoked device could still submit readings unless the broker refuses it first. See [Backend API](../backend/#_13-recommended-hardening).
:::

## Firmware (Illustrative)

The snippets below show the intended structure. The actual firmware must be confirmed before this section is described as verified.

### Sampling with averaging

Averaging many ADC samples reduces noise. Take the median or mean of at least 20 samples per measurement.

```cpp
#include <Arduino.h>

constexpr int PIN_PH = 34;
constexpr int PIN_TURBIDITY = 35;
constexpr int PIN_EC = 32;

float readVoltage(int pin, int samples = 30) {
  uint32_t total = 0;
  for (int i = 0; i < samples; i++) {
    total += analogRead(pin);          
    delay(10);
  }
  float raw = total / float(samples);
  return raw * 3.3f / 4095.0f;         
}
```

### Converting voltages to values

Calibration constants come from the calibration procedure and must be stored in non-volatile memory, not hard-coded.

```cpp

float phFromVoltage(float v, float v7, float v4) {
  float slope = (7.0f - 4.0f) / (v7 - v4);
  return 7.0f + slope * (v - v7);
}


float ecCompensated(float ecRaw, float tempC) {
  return ecRaw / (1.0f + 0.02f * (tempC - 25.0f));
}
```

### Marking faulty sensors

A sensor that is disconnected or stuck at an ADC limit should not produce a believable value. Set `sensor_status` to a fault state instead.

```cpp
bool valueLooksValid(float v, float lo, float hi) {
  return !isnan(v) && v >= lo && v <= hi;
}

const char* evaluateStatus(float ph, float temp, float turb, float ec) {
  bool ok = valueLooksValid(ph, 0.0f, 14.0f)
         && valueLooksValid(temp, -5.0f, 60.0f)
         && valueLooksValid(turb, 0.0f, 3000.0f)
         && valueLooksValid(ec, 0.0f, 20000.0f);
  return ok ? "ok" : "fault";
}
```

### Building the message

```cpp
#include <ArduinoJson.h>
#include <Preferences.h>

Preferences prefs;
uint32_t nextMessageNumber() {
  prefs.begin("aquatrace", false);
  uint32_t n = prefs.getUInt("msgno", 0) + 1;
  prefs.putUInt("msgno", n);            // survives reboots
  prefs.end();
  return n;
}

String buildPayload(const char* deviceId, float ph, float t, float turb, float ec,
                    const char* status, const char* isoUtc) {
  StaticJsonDocument<384> doc;
  doc["device_id"] = deviceId;
  doc["message_number"] = nextMessageNumber();
  doc["ph"] = ph;
  doc["temperature"] = t;
  doc["turbidity"] = turb;
  doc["electrical_conductivity"] = ec;
  doc["sensor_status"] = status;
  doc["recorded_at"] = isoUtc;           
  String out;
  serializeJson(doc, out);
  return out;
}
```

### Publishing over MQTT with TLS

```cpp
#include <PubSubClient.h>

PubSubClient mqtt(secureClient);

void connectMqtt() {
  mqtt.setServer(MQTT_HOST, 8883);
  String statusTopic = String("aquatrace/v1/nodes/") + DEVICE_ID + "/status";
  mqtt.connect(DEVICE_ID, MQTT_USER, MQTT_PASS, statusTopic.c_str(), 1, true, "offline");
  mqtt.publish(statusTopic.c_str(), "online", true);
}

bool publishReading(const String& payload) {
  String topic = String("aquatrace/v1/nodes/") + DEVICE_ID + "/telemetry";
  return mqtt.publish(topic.c_str(), payload.c_str());
}
```

Credentials such as `MQTT_USER` and `MQTT_PASS` are unique to each node and loaded from configuration. They must never be committed to the repository.

## Connectivity and Offline Operation

The proposed system supports cellular connectivity and MQTT-based message delivery through HiveMQ. Devices are also intended to buffer measurements when connectivity is unavailable and deliver buffered data after connectivity returns.

These behaviours are part of the supplied system design. Confirm the actual device firmware, broker configuration, message format, and backend ingestion logic before treating them as verified implementation details.

### Buffering and replay (Illustrative)

```text
sample -> assign message_number -> append to flash buffer -> try to publish
   connected: publish oldest first, delete each entry only after the broker confirms it
   not connected: keep appending, keep the oldest entries if space runs out
```

```cpp
#include <LittleFS.h>

void bufferReading(const String& json) {
  File f = LittleFS.open("/buffer.ndjson", FILE_APPEND);
  f.println(json);                  
  f.close();
}

void replayBuffer() {
  File in = LittleFS.open("/buffer.ndjson", FILE_READ);
  File keep = LittleFS.open("/buffer.tmp", FILE_WRITE);
  bool stillOnline = true;
  while (in.available()) {
    String line = in.readStringUntil('\n');
    if (line.length() == 0) continue;
    if (stillOnline && publishReading(line)) {
      continue;                        
    }
    stillOnline = false;
    keep.println(line);                
  }
  in.close(); keep.close();
  LittleFS.remove("/buffer.ndjson");
  LittleFS.rename("/buffer.tmp", "/buffer.ndjson");
}
```

How the backend treats replayed data:

- The original `recorded_at` is kept, so charts show the true time of each sample.
- A reading that arrives more than 300 seconds after it was recorded is flagged `is_buffered`.
- A repeated delivery is harmless because of the `message_number` check.

::: tip
Use QoS 1 so the broker acknowledges each message. A node that receives no acknowledgement keeps the message and retries; the backend's idempotency makes the retry safe.
:::

### Time source

The node has no reliable clock while offline. Taking `recorded_at` from GPS time keeps it correct for buffered data. If the GPS has no fix, the node should mark the reading as having an uncertain time instead of inventing one.

## Message Broker and Subscriber (Designed)

A HiveMQ broker receives the telemetry. A Node.js subscriber listens to the telemetry topics and passes validated messages on.

```js
import mqtt from "mqtt";
import { z } from "zod";

const Telemetry = z.object({
  device_id: z.string().uuid(),
  message_number: z.number().int().nonnegative(),
  ph: z.number().nullable(),
  temperature: z.number().nullable(),
  turbidity: z.number().nullable(),
  electrical_conductivity: z.number().nullable(),
  sensor_status: z.string(),
  recorded_at: z.string().datetime(),
});

const client = mqtt.connect(process.env.MQTT_URL, {   
  username: process.env.MQTT_USER,
  password: process.env.MQTT_PASS,
  clean: false,                                      
  clientId: "aquatrace-subscriber-1",
});

client.on("connect", () => client.subscribe("aquatrace/v1/nodes/+/telemetry", { qos: 1 }));

client.on("message", async (topic, buf) => {
  const parsed = Telemetry.safeParse(JSON.parse(buf.toString()));
  if (!parsed.success) {
    console.warn("Dropped invalid telemetry", { topic, issues: parsed.error.issues.length });
    return;
  }
  await forward(parsed.data);                          
});
```

Two diagrams describe the handoff differently:

- The System Architecture Diagram shows the Node.js IoT API saving node readings to the database.
- The Secure System Architecture Diagram shows the backend subscribing to HiveMQ topics.

The backend already contains an ingestion service behind `POST /sensor-readings/` that validates the device, enforces idempotency and calculates the WQI. Sending messages through that service keeps one set of rules in one place:

```js
async function forward(reading) {
  const res = await fetch(`${process.env.API_URL}/sensor-readings/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" 
    body: JSON.stringify(reading),
  });
  if (!res.ok && res.status >= 500) throw new Error("Backend unavailable, will retry");
}
```

Confirm which handoff is deployed before treating either as fact.

### Broker security (Designed)

| Control | Detail |
|---|---|
| Transport | MQTT over TLS on port 8883 |
| Identity | One credential per node. The credential is revoked when the node is revoked. |
| Authorisation | Each node may publish only to its own topics and may not subscribe to others |
| Validation | Messages are checked for structure and ranges before storage |
| Replay safety | `message_number` makes duplicate delivery harmless |

## Monitoring and Alerting

Device information and validated measurements support the wider AquaTrace monitoring workflow. The intended design includes detecting devices that become unavailable, alongside sensor faults and changes in water-quality conditions.

Alert conditions and severity should be determined by defined system rules. An AI assistant may help explain an alert using available evidence, but it should not independently validate measurements or determine that water is safe.

### Device-level alert types

The alert model supports these types. They are what the IoT layer feeds.

| Alert type | Typical cause | Evidence |
|---|---|---|
| `device_offline` | No message for longer than the allowed gap | `last_seen_at` is old |
| `sensor_fault` | A sensor reports a fault or an impossible value | `sensor_status` is not OK |
| `tamper` | Enclosure opened or unexpected movement, if the hardware supports it | Device-side flag |
| `threshold_breach` | A parameter is outside its limit | `observed_value` and `threshold_value` |
| `wqi_change` | WQI drops to a lower band | Reading's `wqi_status` |

### Offline detection (Illustrative)

```python
OFFLINE_AFTER = timedelta(minutes=15)    

def find_offline_devices(db):
    cutoff = datetime.now(timezone.utc) - OFFLINE_AFTER
    return (
        db.query(Device)
        .filter(Device.status == "active", Device.last_seen_at < cutoff)
        .all()
    )
```

Set the allowed gap to a few multiples of the sampling interval so one missed message does not raise an alert.

### Sensor fault checks

| Symptom | Likely meaning |
|---|---|
| Value stuck at exactly the same number for hours | Sensor disconnected or frozen |
| ADC at 0 or at its maximum | Open circuit or short circuit |
| Sudden jump that returns immediately | Electrical noise or a bubble on the probe |
| pH or EC drifting steadily | Probe fouling or calibration drift |

## Calibration and Maintenance

Sensors drift, so every calibration and cleaning is recorded as a maintenance record through `POST /maintenance-records`. The Nodes screen lists them under Calibration and maintenance, for example "Cleaned turbidity sensor", "Calibrated pH sensor" and "Replaced EC probe".

| Sensor | Calibration reference | Notes |
|---|---|---|
| pH | Buffer solutions (pH 4.00, 7.00 and 10.01) | Rinse the probe between buffers. Keep the probe wet. |
| EC | Standard conductivity solution (for example 1413 uS/cm) | Record the solution temperature |
| Turbidity | Formazin or AMCO-Clear standards | Clean the optical window first |
| Temperature | Compare against a reference thermometer | Needed for EC compensation |

A recommended starting schedule, to be confirmed by the operations team:

| Task | Frequency |
|---|---|
| Visual check and cleaning of probes | Monthly |
| pH calibration | Monthly or after any fault |
| EC and turbidity calibration | Quarterly |
| Probe replacement | When calibration can no longer be achieved |

After each task the Field Officer records the work and the backend can update the device's `last_calibrated_at`.

## Verification Checklist

| Check | Status |
|---|---|
| Firmware sends the documented message format | To verify |
| Broker credentials are per node and topic-restricted | To verify |
| Subscriber to backend handoff matches one of the two diagrams | To verify |
| Buffered messages replay in order after a connectivity loss | To verify |
| `recorded_at` comes from GPS time | To verify |
| Revoked devices are refused at the broker and at the API | To verify |
| Offline detection raises a `device_offline` alert | To verify |
| Calibration steps and constants are documented per sensor | To verify |

Record a check as passed only after it has actually been run on hardware.

## Related Documentation

- [System Architecture](../overview/architecture)
- [Data Flow](../overview/data-flow)
- [Backend API](../backend/)
- [Database](../database/)
- [WQI](../wqi/)
- [Security](../security/)
- [Operations](../operations/)