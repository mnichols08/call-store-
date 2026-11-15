// Request counts and durations in Prometheus' text format, for Grafana Cloud or any scraper.
// Labels are the route pattern ("/calls/:id") and status class, never the raw path, so the number
// of series stays small whatever people ask for.
const BUCKETS = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5];

export function createMetrics({ started = Date.now() } = {}) {
  const series = new Map();
  return {
    observe(method, route, status, seconds) {
      const key = `${method}\t${route}\t${Math.floor(status / 100)}xx`;
      const s = series.get(key) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
      s.count += 1;
      s.sum += seconds;
      BUCKETS.forEach((le, i) => seconds <= le && (s.buckets[i] += 1));
      series.set(key, s);
    },
    render(gauges = {}) {
      const lines = ['# TYPE callstore_http_request_duration_seconds histogram'];
      for (const [key, s] of series) {
        const [method, route, status] = key.split('\t');
        const labels = `method="${method}",route="${route.replace(/"/g, '')}",status="${status}"`;
        BUCKETS.forEach((le, i) => lines.push(`callstore_http_request_duration_seconds_bucket{${labels},le="${le}"} ${s.buckets[i]}`));
        lines.push(`callstore_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${s.count}`);
        lines.push(`callstore_http_request_duration_seconds_sum{${labels}} ${s.sum.toFixed(6)}`, `callstore_http_request_duration_seconds_count{${labels}} ${s.count}`);
      }
      for (const [name, value] of Object.entries(gauges)) lines.push(`# TYPE callstore_${name} gauge`, `callstore_${name} ${value}`);
      lines.push('# TYPE callstore_uptime_seconds gauge', `callstore_uptime_seconds ${Math.round((Date.now() - started) / 1000)}`);
      return `${lines.join('\n')}\n`;
    },
  };
}
