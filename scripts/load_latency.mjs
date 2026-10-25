/** k6 GetConn -> GotConn (blocked) includes DNS/TCP/TLS; duration starts after it.
 * Source: github.com/grafana/k6/blob/v2.3.0/lib/netext/httpext/tracer.go
 */
export function requestLatency(timings) {
  return timings.blocked+timings.duration;
}
