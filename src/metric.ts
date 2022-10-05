import { InfluxDB, Point } from "@influxdata/influxdb-client";

/** Environment variables **/
const url = process.env.INFLUX_URL;
const token = process.env.INFLUX_TOKEN;
const org = process.env.INFLUX_ORG;
const bucket = process.env.INFLUX_BUCKET;

/**
 * Instantiate the InfluxDB client
 * with a configuration object.
 **/
const influxDB =
  url && token && process.env.NODE_ENV === "production"
    ? new InfluxDB({ url, token, transportOptions: { rejectUnauthorized: false } })
    : null;

/**
 * Create a write client from the getWriteApi method.
 * Provide your `org` and `bucket`.
 **/
const writeApi = org && bucket ? influxDB?.getWriteApi(org, bucket) : null;

if (!writeApi) {
  console.log("Metric tracking is disabled");
}

export function trackSingle(measurementName: string, tags: Record<string, string>, value = 1) {
  if (!writeApi) {
    return;
  }
  const point = new Point(measurementName);
  Object.keys(tags).forEach((key) => point.tag(key, tags[key]));
  point.intField("value", value);
  writeApi?.writePoint(point);
}
